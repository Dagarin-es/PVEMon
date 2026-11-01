import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { audit } from '../auth/audit.js';
import { requireAdmin } from '../auth/guard.js';
import { db, schema } from '../db/index.js';
import { browseNfs, listExports, NfsError } from '../filecheck/nfs.js';
import { addCheck, editCheck, cleanExport, cleanFile, cleanHost, listChecks, probe, removeCheck, runChecks, setMinBytes } from '../filecheck/monitor.js';
import { mailSources } from '../mail/monitor.js';

const { elements } = schema;

const target = z.object({
  protocol: z.literal('nfs'),
  host: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$|^nfs:\/\/[A-Za-z0-9._:/-]+$/, 'Servidor no válido'),
  exportPath: z.string().trim().min(1).max(300),
  file: z.string().trim().max(500),
  kind: z.enum(['file', 'dir']).default('file'),
  minBytes: z.number().int().min(1).max(2 ** 50).optional(),
});
const hostOnly = target.pick({ host: true });
const needFile = (b: { kind: string; file: string }) => b.kind === 'dir' || b.file.length > 0;
const addBody = target.extend({
  name: z.string().trim().min(1).max(80),
  source: z.string().trim().min(1).max(80),
  days: z.number().int().min(0).max(365).optional(),
  hours: z.number().int().min(0).max(23).optional(),
}).refine(needFile, { message: 'Indica el archivo a comprobar' });

const editBody = target.extend({
  protocol: z.literal('nfs').default('nfs'),
  name: z.string().trim().min(1).max(80),
  days: z.number().int().min(0).max(365).optional(),
  hours: z.number().int().min(0).max(23).optional(),
}).refine(needFile, { message: 'Indica el archivo a comprobar' });

export const filecheckRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin);

  const view = () => ({
    checks: listChecks().map((c) => {
      const e = db.select().from(elements).where(eq(elements.id, c.elementId)).get();
      return { ...c, name: e?.name ?? '?', serverId: e?.serverId ?? null };
    }),
    sources: mailSources().map((s) => s.name),
  });

  app.get('/filecheck', async () => view());

  /** Prueba una conexión sin guardar nada */
  app.post('/filecheck/test', async (req, reply) => {
    const b = target.safeParse(req.body);
    if (!b.success || !needFile(b.data)) return reply.code(400).send({ error: (b.success ? null : b.error.issues[0]?.message) ?? 'Indica el archivo a comprobar' });
    const r = await probe({ host: cleanHost(b.data.host), exportPath: cleanExport(b.data.exportPath), file: cleanFile(b.data.file), minBytes: b.data.minBytes, kind: b.data.kind });
    return r;
  });

  /** Exportaciones que publica el servidor NFS */
  app.post('/filecheck/exports', async (req, reply) => {
    const b = hostOnly.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Servidor no válido' });
    try { return { exports: await listExports(cleanHost(b.data.host)) }; } catch (e) {
      return reply.code(502).send({ error: (e as Error).message, code: e instanceof NfsError ? e.code : 'proto' });
    }
  });

  /** Contenido de una carpeta del servidor, para elegir sin escribir */
  app.post('/filecheck/browse', async (req, reply) => {
    const b = z.object({ host: target.shape.host, exportPath: z.string().trim().min(1).max(300), path: z.string().trim().max(500) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Datos no válidos' });
    try { return { entries: await browseNfs(cleanHost(b.data.host), cleanExport(b.data.exportPath), cleanFile(b.data.path)) }; } catch (e) {
      return reply.code(502).send({ error: (e as Error).message, code: e instanceof NfsError ? e.code : 'proto' });
    }
  });

  app.post('/filecheck', async (req, reply) => {
    const b = addBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.issues[0]?.message ?? 'Datos no válidos' });
    const r = addCheck(b.data);
    if (r.error) return reply.code(409).send({ error: r.error });
    audit(req.user!.id, 'filecheck.add', b.data.name, { host: b.data.host, exportPath: b.data.exportPath });
    await runChecks(app.metrics, r.elementId);
    return reply.code(201).send(view());
  });

  /** Edita una comprobación existente (todo menos el origen al que pertenece) */
  app.put<{ Params: { id: string } }>('/filecheck/:id', async (req, reply) => {
    const b = editBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.issues[0]?.message ?? 'Datos no válidos' });
    if (!listChecks().some((c) => c.elementId === req.params.id)) return reply.code(404).send({ error: 'Comprobación no encontrada' });
    const r = editCheck(req.params.id, b.data);
    if (r.error) return reply.code(409).send({ error: r.error });
    audit(req.user!.id, 'filecheck.edit', b.data.name, { host: b.data.host, exportPath: b.data.exportPath, file: b.data.file });
    await runChecks(app.metrics, req.params.id);
    return view();
  });

  app.post<{ Params: { id: string } }>('/filecheck/:id/run', async (req, reply) => {
    if (!listChecks().some((c) => c.elementId === req.params.id)) return reply.code(404).send({ error: 'Comprobación no encontrada' });
    await runChecks(app.metrics, req.params.id);
    return view();
  });

  /** Tamaño mínimo (en bytes) para dar el archivo por bueno */
  app.put<{ Params: { id: string } }>('/filecheck/:id/min-size', async (req, reply) => {
    const b = z.object({ minBytes: z.number().int().min(1).max(2 ** 50) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Tamaño mínimo no válido' });
    if (!setMinBytes(req.params.id, b.data.minBytes)) return reply.code(404).send({ error: 'Comprobación no encontrada' });
    audit(req.user!.id, 'filecheck.minsize', req.params.id, { minBytes: b.data.minBytes });
    await runChecks(app.metrics, req.params.id);
    return view();
  });

  app.delete<{ Params: { id: string } }>('/filecheck/:id', async (req, reply) => {
    const c = listChecks().find((x) => x.elementId === req.params.id);
    if (!c) return reply.code(404).send({ error: 'Comprobación no encontrada' });
    removeCheck(c.elementId);
    db.delete(elements).where(eq(elements.id, c.elementId)).run();
    audit(req.user!.id, 'filecheck.delete', c.file);
    return view();
  });
};
