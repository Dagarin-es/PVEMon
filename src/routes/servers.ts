import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { audit } from '../auth/audit.js';
import { requireAdmin } from '../auth/guard.js';
import { encrypt } from '../crypto.js';
import { db, schema } from '../db/index.js';
import { PveClient, PveError, normalizeBaseUrl, probeCert, probeFingerprint } from '../proxmox/client.js';
import { evaluateAll } from '../mail/monitor.js';
import { checkServerBackups } from '../backups/collector.js';
import { scanServer } from '../proxmox/discovery.js';
import { effectiveRanges, getConfig, isScanning, isPrivateIp, listPending, parseCidr, scanLan, setConfig } from '../discovery/lan.js';

const { servers } = schema;

const publicServer = (s: typeof servers.$inferSelect) => ({
  id: s.id, name: s.name, baseUrl: s.baseUrl, tokenId: s.tokenId, verifyTls: s.verifyTls,
  tlsFingerprint: s.tlsFingerprint, pveVersion: s.pveVersion, status: s.status,
  lastSeenAt: s.lastSeenAt, lastError: s.lastError, createdAt: s.createdAt, source: s.source, backupMaxHours: s.backupMaxHours, kind: s.kind,
});

const createBody = z.object({
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().trim().min(1).max(200),
  tokenId: z.string().trim().regex(/^[^@!\s]+@[^@!\s]+![^!\s]+$/, 'El Token ID debe tener la forma usuario@realm!nombre'),
  tokenSecret: z.string().trim().min(8).max(200),
  verifyTls: z.boolean().default(false),
  /** Huella que el administrador vio y aceptó; si cambia entre la comprobación y el alta, se rechaza. */
  fingerprint: z.string().trim().max(120).optional(),
});

const probeBody = z.object({ baseUrl: z.string().trim().min(1).max(200) });

export const serverRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin);

  app.get('/servers', async () => ({ servers: db.select().from(servers).all().map(publicServer) }));

  /* ── Búsqueda automática de Proxmox en la red ── */
  const discoveryView = () => {
    const cfg = getConfig();
    return { ...listPending(), enabled: cfg.enabled, cidrs: cfg.cidrs, ranges: effectiveRanges(cfg), ignored: cfg.ignored.length, scanning: isScanning() };
  };
  app.get('/servers/discovery', async () => discoveryView());

  const cfgBody = z.object({
    enabled: z.boolean(),
    cidrs: z.array(z.string().trim()).max(8),
    resetIgnored: z.boolean().optional(),
  });
  app.put('/servers/discovery', async (req, reply) => {
    const b = cfgBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Datos no válidos' });
    const bad = b.data.cidrs.find((c) => !parseCidr(c));
    if (bad) return reply.code(400).send({ error: `«${bad}» no vale: usa una red privada con máscara entre /22 y /30, por ejemplo 192.168.1.0/24` });
    setConfig({ enabled: b.data.enabled, cidrs: b.data.cidrs, ignored: b.data.resetIgnored ? [] : getConfig().ignored });
    audit(req.user!.id, 'discovery.config', undefined, { cidrs: b.data.cidrs, enabled: b.data.enabled });
    return discoveryView();
  });

  app.post('/servers/discovery/scan', async () => {
    const r = await scanLan();
    return { ...discoveryView(), scanned: r.scanned };
  });

  app.post('/servers/discovery/ignore', async (req, reply) => {
    const ip = (req.body as { ip?: string } | null)?.ip ?? '';
    if (!isPrivateIp(ip)) return reply.code(400).send({ error: 'IP no válida' });
    const cfg = getConfig();
    setConfig({ ...cfg, ignored: [...new Set([...cfg.ignored, ip])] });
    return discoveryView();
  });

  /** Paso previo al alta: muestra el certificado del servidor para confirmar su huella. */
  app.post('/servers/probe', async (req, reply) => {
    const b = probeBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Dirección no válida' });
    try {
      const baseUrl = normalizeBaseUrl(b.data.baseUrl);
      return { baseUrl, cert: await probeCert(baseUrl) };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post('/servers', async (req, reply) => {
    const body = createBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'Datos no válidos' });
    const { name, tokenId, tokenSecret, verifyTls } = body.data;

    let baseUrl: string;
    let fingerprint: string | null = null;
    try {
      baseUrl = normalizeBaseUrl(body.data.baseUrl);
      if (db.select().from(servers).where(and(eq(servers.baseUrl, baseUrl), eq(servers.tokenId, tokenId))).get()) {
        return reply.code(409).send({ error: 'Ese nodo con ese token ya está dado de alta' });
      }
      // Primer contacto: se fija la huella del certificado (como SSH). Compárala con la de tu Proxmox.
      if (!verifyTls) {
        fingerprint = await probeFingerprint(baseUrl);
        if (body.data.fingerprint && body.data.fingerprint.toUpperCase() !== fingerprint.toUpperCase()) {
          return reply.code(400).send({ error: 'La huella del certificado ha cambiado desde que la comprobaste. No sigas: revisa la conexión.' });
        }
      }
      const probe = new PveClient({ baseUrl, tokenId, tokenSecret, verifyTls, fingerprint });
      try { await probe.get('/version'); } finally { await probe.close(); }
    } catch (e) {
      return reply.code(400).send({ error: e instanceof PveError ? e.message : (e as Error).message });
    }

    // Si lo había encontrado la búsqueda automática, queda marcado como autodescubierto
    const host = new URL(baseUrl).hostname;
    const wasFound = listPending().found.some((f) => f.ip === host || (fingerprint && f.fingerprint.toUpperCase() === fingerprint.toUpperCase()));
    const server = db.insert(servers)
      .values({ name, baseUrl, tokenId, tokenSecretEnc: encrypt(tokenSecret), verifyTls, tlsFingerprint: fingerprint, source: wasFound ? 'auto' : 'manual' })
      .returning().get();

    try {
      const summary = await scanServer(server.id);
      audit(req.user!.id, 'server.add', name, { baseUrl });
      return reply.code(201).send({ server: publicServer(db.select().from(servers).where(eq(servers.id, server.id)).get()!), summary });
    } catch (e) {
      db.delete(servers).where(eq(servers.id, server.id)).run(); // sin escaneo no hay alta
      return reply.code(400).send({ error: `Conectó, pero el escaneo falló: ${(e as Error).message}` });
    }
  });

  app.post<{ Params: { id: string } }>('/servers/:id/scan', async (req, reply) => {
    const sv = db.select().from(servers).where(eq(servers.id, req.params.id)).get();
    if (!sv) return reply.code(404).send({ error: 'Nodo no encontrado' });
    if (sv.kind === 'mail') return reply.code(400).send({ error: 'Este origen se vigila por correo, no hay nada que escanear' });
    try { return { summary: await scanServer(req.params.id) }; }
    catch (e) { return reply.code(502).send({ error: (e as Error).message }); }
  });

  /** Límite de antigüedad de la última copia, en días y horas (se suman). */
  const limitBody = z.object({ days: z.number().int().min(0).max(365), hours: z.number().int().min(0).max(23) })
    .refine((b) => b.days * 24 + b.hours >= 1, { message: 'El límite debe ser de al menos 1 hora' });
  app.put<{ Params: { id: string } }>('/servers/:id/backup-limit', async (req, reply) => {
    const b = limitBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.issues[0]?.message ?? 'Datos no válidos' });
    const s = db.select().from(servers).where(eq(servers.id, req.params.id)).get();
    if (!s) return reply.code(404).send({ error: 'Nodo no encontrado' });
    const maxHours = b.data.days * 24 + b.data.hours;
    db.update(servers).set({ backupMaxHours: maxHours }).where(eq(servers.id, s.id)).run();
    audit(req.user!.id, 'backup.limit', s.name, { maxHours });
    try {
      if (s.kind === 'mail') evaluateAll(app.metrics); else await checkServerBackups(s.id, app.metrics);
    } catch { /* se recalcula en la próxima pasada */ }
    return { ok: true, backupMaxHours: maxHours };
  });

  app.post<{ Params: { id: string } }>('/servers/:id/backups/check', async (req, reply) => {
    const sv = db.select().from(servers).where(eq(servers.id, req.params.id)).get();
    if (!sv) return reply.code(404).send({ error: 'Nodo no encontrado' });
    if (sv.kind === 'mail') return evaluateAll(app.metrics);
    try { return await checkServerBackups(req.params.id, app.metrics); }
    catch (e) { return reply.code(502).send({ error: (e as Error).message }); }
  });

  app.delete<{ Params: { id: string } }>('/servers/:id', async (req, reply) => {
    const s = db.select().from(servers).where(eq(servers.id, req.params.id)).get();
    if (!s) return reply.code(404).send({ error: 'Nodo no encontrado' });
    db.delete(servers).where(eq(servers.id, s.id)).run(); // cascada: elementos, permisos...
    audit(req.user!.id, 'server.delete', s.name);
    return { ok: true };
  });
};
