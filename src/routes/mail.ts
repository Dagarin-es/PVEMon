import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { audit } from '../auth/audit.js';
import { requireAdmin } from '../auth/guard.js';
import { db, schema } from '../db/index.js';
import { lastFiles, listChecks, runChecks } from '../filecheck/monitor.js';
import { getFetcher, resolveFolder } from '../mail/imap.js';
import {
  applyCache, createMailSource, evaluateAll, getExcluded, getFormats, getImapView, getLastPoll, ignoreTask, imapConn, isPolling,
  mailSources, pendingSources, pollMail, resetMailCache, setExcluded, setFormats, setImap, unrecognized,
} from '../mail/monitor.js';

const { servers, elements, backupStatus } = schema;

const imapBody = z.object({
  host: z.string().trim().max(200),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().trim().max(200),
  password: z.string().max(300).optional(),
  inFolder: z.string().trim().min(1).max(200),
  doneFolder: z.string().trim().min(1).max(200),
  moveDone: z.boolean(),
  lookbackDays: z.number().int().min(3).max(90),
  enabled: z.boolean(),
});

const limitBody = z.object({ days: z.number().int().min(0).max(365), hours: z.number().int().min(0).max(23) })
  .refine((b) => b.days * 24 + b.hours >= 1, { message: 'El límite debe ser de al menos 1 hora' });

const formatBody = z.array(z.object({
  name: z.string().trim().min(1).max(60),
  subjectContains: z.string().trim().max(200).optional(),
  fromContains: z.string().trim().max(200).optional(),
  bodyContains: z.string().trim().max(200).optional(),
  fail: z.array(z.string().trim().min(1).max(200)).max(20),
  ok: z.array(z.string().trim().min(1).max(200)).max(20),
  taskRegex: z.string().trim().max(300).optional(),
  sourceRegex: z.string().trim().max(300).optional(),
  defaultSource: z.string().trim().max(80).optional(),
  defaultTask: z.string().trim().max(80).optional(),
}).refine((f) => f.subjectContains || f.fromContains || f.bodyContains, { message: 'Cada formato necesita al menos una condición (asunto, remitente o texto)' })
  .refine((f) => f.ok.length + f.fail.length > 0, { message: 'Indica qué textos significan «bien» o «mal»' })
  .refine((f) => [f.taskRegex, f.sourceRegex].every((r) => { if (!r) return true; try { new RegExp(r); return true; } catch { return false; } }), { message: 'Una expresión regular no es válida' })
  .refine((f) => f.sourceRegex || f.defaultSource, { message: 'Indica el nombre del origen (equipo) fijo o cómo sacarlo del correo' })).max(20);

export const mailRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin);

  const view = () => {
    const srv = mailSources();
    const els = db.select().from(elements).all().filter((e) => e.kind === 'backup');
    const bk = new Map(db.select().from(backupStatus).all().map((b) => [b.elementId, b]));
    const fc = new Map(listChecks().map((c) => [c.elementId, c]));
    return {
      imap: getImapView(),
      formats: getFormats(),
      excludedSenders: getExcluded(),
      sources: srv.map((s) => ({
        id: s.id, name: s.name, backupMaxHours: s.backupMaxHours,
        tasks: els.filter((e) => e.serverId === s.id).map((e) => {
          const b = bk.get(e.id);
          return {
            id: e.id, name: e.alias ?? e.name, state: b?.state ?? 'none', lastOkAt: b?.lastOkAt ?? null, lastAttemptAt: b?.lastAttemptAt ?? null,
            message: b?.message ?? null, maxHours: b?.maxHoursOverride ?? s.backupMaxHours, ownLimit: b?.maxHoursOverride != null,
            lastOkSize: b?.lastOkSize ?? null,
            fileCheck: fc.has(e.id) ? { protocol: 'nfs', host: fc.get(e.id)!.host, exportPath: fc.get(e.id)!.exportPath, file: fc.get(e.id)!.file, minBytes: Math.max(1, fc.get(e.id)!.minBytes ?? 1024), kind: fc.get(e.id)!.kind ?? 'file', lastFile: lastFiles.get(e.id) ?? null } : null,
          };
        }),
      })),
      pending: pendingSources(),
      unrecognized: unrecognized(),
      lastPoll: getLastPoll(),
      polling: isPolling(),
    };
  };

  app.get('/mail', async () => view());

  app.put('/mail/imap', async (req, reply) => {
    const b = imapBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Datos no válidos' });
    if (b.data.enabled && !(b.data.host && b.data.user && (b.data.password || getImapView().hasPassword))) {
      return reply.code(400).send({ error: 'Para activarlo hacen falta servidor, usuario y contraseña' });
    }
    setImap(b.data);
    resetMailCache();
    audit(req.user!.id, 'mail.imap', b.data.host, { user: b.data.user, inFolder: b.data.inFolder, doneFolder: b.data.doneFolder, moveDone: b.data.moveDone, enabled: b.data.enabled });
    return view();
  });

  /** Prueba la conexión (con los datos del formulario) y comprueba que existen las carpetas */
  app.post('/mail/imap/test', async (req, reply) => {
    const b = imapBody.partial().safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Datos no válidos' });
    const conn = imapConn(b.data);
    if (!conn) return reply.code(400).send({ error: 'Faltan servidor, usuario o contraseña' });
    try {
      const folders = await getFetcher().listFolders(conn);
      const v = getImapView();
      const want = [b.data.inFolder ?? v.inFolder, b.data.doneFolder ?? v.doneFolder].filter(Boolean);
      const missing = want.filter((w) => !resolveFolder(w, folders.map((path) => ({ path }))));
      return { ok: true, folders, missing, canCreate: true };
    } catch (e) {
      return reply.code(502).send({ error: `No se pudo conectar: ${(e as Error).message}` });
    }
  });

  app.post('/mail/check', async (_req, reply) => {
    const r = await pollMail(app.metrics);
    if (!r.ok) return reply.code(502).send({ error: r.error ?? 'Falló la consulta del correo' });
    return view();
  });

  app.post('/mail/sources', async (req, reply) => {
    const nb = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(req.body);
    if (!nb.success) return reply.code(400).send({ error: 'Escribe el nombre del NAS o equipo' });
    const lim = limitBody.safeParse(req.body);
    const hours = lim.success ? lim.data.days * 24 + lim.data.hours : undefined;
    const r = createMailSource(nb.data.name, hours);
    if (!r.created) return reply.code(409).send({ error: 'Ya existe un origen con ese nombre' });
    applyCache();
    evaluateAll(app.metrics);
    audit(req.user!.id, 'mail.source.add', nb.data.name);
    return reply.code(201).send(view());
  });

  /** Cambia el nombre de un origen y/o su límite general */
  app.put<{ Params: { id: string } }>('/mail/sources/:id', async (req, reply) => {
    const s = db.select().from(servers).where(eq(servers.id, req.params.id)).get();
    if (!s || s.kind !== 'mail') return reply.code(404).send({ error: 'Origen no encontrado' });
    const b = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Escribe el nombre del origen' });
    const same = (x: string) => x.trim().toLowerCase() === b.data.name.toLowerCase();
    if (mailSources().some((o) => o.id !== s.id && same(o.name))) return reply.code(409).send({ error: 'Ya existe un origen con ese nombre' });
    const lim = limitBody.safeParse(req.body);
    db.transaction((tx) => {
      tx.update(servers).set({ name: b.data.name, baseUrl: `mail://${encodeURIComponent(b.data.name)}`, ...(lim.success ? { backupMaxHours: lim.data.days * 24 + lim.data.hours } : {}) }).where(eq(servers.id, s.id)).run();
      tx.update(elements).set({ name: b.data.name }).where(and(eq(elements.serverId, s.id), eq(elements.kind, 'server'))).run();
    });
    resetMailCache(); // los correos se vuelven a asociar con el nombre nuevo
    applyCache();
    evaluateAll(app.metrics);
    audit(req.user!.id, 'mail.source.edit', b.data.name, { from: s.name });
    return view();
  });

  /** Nombre con el que se muestra una tarea (el original, el que viene en los correos, no cambia) */
  app.put<{ Params: { id: string } }>('/mail/tasks/:id', async (req, reply) => {
    const e = db.select().from(elements).where(eq(elements.id, req.params.id)).get();
    if (!e || e.kind !== 'backup') return reply.code(404).send({ error: 'Tarea no encontrada' });
    const b = z.object({ name: z.string().trim().max(80) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Nombre no válido' });
    db.update(elements).set({ alias: b.data.name && b.data.name !== e.name ? b.data.name : null }).where(eq(elements.id, e.id)).run();
    audit(req.user!.id, 'mail.task.edit', e.name, { alias: b.data.name });
    return view();
  });

  app.delete<{ Params: { id: string } }>('/mail/sources/:id', async (req, reply) => {
    const s = db.select().from(servers).where(eq(servers.id, req.params.id)).get();
    if (!s || s.kind !== 'mail') return reply.code(404).send({ error: 'Origen no encontrado' });
    db.delete(servers).where(eq(servers.id, s.id)).run();
    audit(req.user!.id, 'mail.source.delete', s.name);
    return view();
  });

  /** Quita una tarea y no la vuelve a crear aunque lleguen más correos suyos */
  app.delete<{ Params: { id: string } }>('/mail/tasks/:id', async (req, reply) => {
    const e = db.select().from(elements).where(eq(elements.id, req.params.id)).get();
    if (!e || e.kind !== 'backup') return reply.code(404).send({ error: 'Tarea no encontrada' });
    ignoreTask(e.serverId, e.externalId);
    db.delete(elements).where(eq(elements.id, e.id)).run();
    audit(req.user!.id, 'mail.task.delete', e.name);
    return view();
  });

  app.put('/mail/excluded', async (req, reply) => {
    const b = z.object({ senders: z.array(z.string().trim().min(1).max(200)).max(100) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Datos no válidos' });
    setExcluded(b.data.senders);
    audit(req.user!.id, 'mail.excluded', undefined, { n: b.data.senders.length });
    if (getImapView().enabled) void pollMail(app.metrics).catch(() => undefined); else evaluateAll(app.metrics);
    return view();
  });

  app.put('/mail/formats', async (req, reply) => {
    const b = formatBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.issues[0]?.message ?? 'Datos no válidos' });
    setFormats(b.data);
    resetMailCache(); // se vuelven a interpretar todos los correos con los formatos nuevos
    audit(req.user!.id, 'mail.formats', undefined, { n: b.data.length });
    // Releer todo el buzón puede tardar (y el proxy cortaría la petición): se hace en segundo plano y la pantalla se refresca sola
    if (getImapView().enabled) void pollMail(app.metrics).catch(() => undefined);
    return view();
  });

  /** Límite propio de una copia (o null para volver al del origen) */
  app.put<{ Params: { id: string } }>('/elements/:id/backup-limit', async (req, reply) => {
    const e = db.select().from(elements).where(eq(elements.id, req.params.id)).get();
    if (!e || e.kind !== 'backup') return reply.code(404).send({ error: 'Copia no encontrada' });
    const body = req.body as { reset?: boolean } | null;
    let maxHours: number | null = null;
    if (!body?.reset) {
      const b = limitBody.safeParse(req.body);
      if (!b.success) return reply.code(400).send({ error: b.error.issues[0]?.message ?? 'Datos no válidos' });
      maxHours = b.data.days * 24 + b.data.hours;
    }
    const row = db.select().from(backupStatus).where(eq(backupStatus.elementId, e.id)).get();
    if (row) db.update(backupStatus).set({ maxHoursOverride: maxHours }).where(eq(backupStatus.elementId, e.id)).run();
    else db.insert(backupStatus).values({ elementId: e.id, serverId: e.serverId, state: 'none', checkedAt: Math.floor(Date.now() / 1000), maxHoursOverride: maxHours }).run();
    audit(req.user!.id, 'backup.limit.task', e.name, { maxHours });
    evaluateAll(app.metrics);
    await runChecks(app.metrics, e.id); // si es una comprobación de archivo, se reevalúa con el nuevo límite
    return { ok: true, maxHours };
  });
};
