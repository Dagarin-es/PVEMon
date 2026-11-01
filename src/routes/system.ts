import { VERSION } from '../version.js';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { audit } from '../auth/audit.js';
import { requireAdmin } from '../auth/guard.js';
import { activeMaintenance, endMaintenance, startMaintenance } from '../alerts/maintenance.js';
import { setSetting } from '../alerts/notify.js';
import { storageUsage } from '../backups/collector.js';
import { config } from '../config.js';
import { db, restored, schema } from '../db/index.js';
import { BackupError, exportBackup, openBackup, stageRestore } from '../system/backup.js';
import { DEFAULT_DIGEST, getDigest, sendDigest } from '../system/digest.js';
import { getHeartbeat, getHeartbeatLast, maskUrl, pingNow, saveUrl, validUrl } from '../system/heartbeat.js';
import { listSnapshots } from '../system/restore.js';

const { elements } = schema;

const strict = { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } };

const hbBody = z.object({
  url: z.string().trim().max(1000).optional(), // vacío/ausente = conservar la actual
  intervalMin: z.number().int().min(1).max(1440),
  enabled: z.boolean(),
});
const digestBody = z.object({
  enabled: z.boolean(), day: z.number().int().min(0).max(6), hour: z.number().int().min(0).max(23), email: z.boolean(), telegram: z.boolean(),
});

export const systemRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin);

  app.get('/system/info', async () => {
    const hb = getHeartbeat();
    return {
      version: VERSION, restored,
      snapshots: listSnapshots(config.dataDir).map((s) => s.name),
      heartbeat: { enabled: !!hb?.enabled, intervalMin: hb?.intervalMin ?? 5, url: maskUrl(hb?.urlEnc ?? null), last: getHeartbeatLast() },
      digest: { ...DEFAULT_DIGEST, ...getDigest() },
    };
  });

  /* ───── copia y restauración de pvemon ───── */
  app.post('/system/backup/export', strict, async (req, reply) => {
    const b = z.object({ passphrase: z.string().min(8).max(200) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'La contraseña de la copia debe tener al menos 8 caracteres' });
    const file = await exportBackup(b.data.passphrase, VERSION);
    audit(req.user!.id, 'system.backup.export');
    const d = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    return reply.header('Content-Type', 'application/octet-stream').header('Content-Disposition', `attachment; filename="pvemon-${d}.pvemonbak"`).send(file);
  });

  app.post('/system/backup/restore', { ...strict, bodyLimit: 40 * 1024 * 1024 }, async (req, reply) => {
    const b = z.object({ passphrase: z.string().min(1).max(200), data: z.string().min(100), confirm: z.literal(true) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Falta el archivo, la contraseña o la confirmación' });
    try {
      const opened = openBackup(Buffer.from(b.data.data, 'base64'), b.data.passphrase);
      if (opened.secretKey && opened.secretKey !== config.secretKey) {
        return reply.code(409).send({ error: 'Esta copia se hizo con otra SECRET_KEY. Para poder leer sus claves cifradas, pon en el archivo .env: SECRET_KEY=' + opened.secretKey + ' , reinicia con «docker compose up -d» y vuelve a restaurar.' });
      }
      stageRestore(opened);
    } catch (e) {
      if (e instanceof BackupError) return reply.code(400).send({ error: e.message });
      throw e;
    }
    audit(req.user!.id, 'system.backup.restore');
    setTimeout(() => process.exit(0), 1500); // Docker lo vuelve a arrancar (restart: unless-stopped) y entonces se aplica la restauración
    return { ok: true, restarting: true };
  });

  /* ───── latido externo ───── */
  app.put('/settings/heartbeat', async (req, reply) => {
    const b = hbBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Revisa los datos del latido' });
    const prev = getHeartbeat();
    if (b.data.url && !validUrl(b.data.url)) return reply.code(400).send({ error: 'La dirección debe empezar por http:// o https://' });
    const urlEnc = b.data.url ? saveUrl(b.data.url) : prev?.urlEnc ?? null;
    if (b.data.enabled && !urlEnc) return reply.code(400).send({ error: 'Falta la dirección a la que enviar el latido' });
    setSetting('heartbeat', { urlEnc, intervalMin: b.data.intervalMin, enabled: b.data.enabled });
    audit(req.user!.id, 'settings.heartbeat');
    return { ok: true };
  });

  app.post('/settings/heartbeat/test', strict, async (_req, reply) => {
    if (!getHeartbeat()?.urlEnc) return reply.code(400).send({ error: 'Guarda antes la dirección' });
    return pingNow();
  });

  /* ───── resumen semanal ───── */
  app.put('/settings/digest', async (req, reply) => {
    const b = digestBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Revisa los datos del resumen' });
    setSetting('digest', { ...getDigest(), ...b.data });
    audit(req.user!.id, 'settings.digest');
    return { ok: true };
  });

  app.post('/settings/digest/send', strict, async (_req, reply) => {
    try { return { ok: true, to: await sendDigest() }; }
    catch (e) { return reply.code(502).send({ error: (e as Error).message }); }
  });

  /* ───── mantenimiento ───── */
  app.get('/maintenance', async () => ({ active: activeMaintenance() }));

  app.put<{ Params: { id: string } }>('/elements/:id/maintenance', async (req, reply) => {
    const b = z.object({ hours: z.number().min(0.25).max(24 * 14) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Duración no válida' });
    const el = db.select().from(elements).where(eq(elements.id, req.params.id)).get();
    if (!el) return reply.code(404).send({ error: 'Elemento no encontrado' });
    const until = startMaintenance(el.id, b.data.hours);
    audit(req.user!.id, 'maintenance.start', el.name, { hours: b.data.hours });
    return { ok: true, until };
  });

  app.delete<{ Params: { id: string } }>('/elements/:id/maintenance', async (req, reply) => {
    const el = db.select().from(elements).where(eq(elements.id, req.params.id)).get();
    if (!el) return reply.code(404).send({ error: 'Elemento no encontrado' });
    endMaintenance(el.id);
    audit(req.user!.id, 'maintenance.end', el.name);
    return { ok: true };
  });

  /* ───── espacio de los almacenes de copias ───── */
  app.get('/backups/storage', async () => ({ storages: [...storageUsage.values()].flat().sort((a, b) => b.pct - a.pct) }));
};
