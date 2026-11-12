import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { audit } from '../auth/audit.js';
import { requireAdmin } from '../auth/guard.js';
import { decrypt } from '../crypto.js';
import { config } from '../config.js';
import { BackupError, openBackup, stageRestore } from '../system/backup.js';
import { tr, parseLang } from '../i18n.js';
import { DEST_TYPES, driverFor, getCfg, oneDriveInfo, resolveDest, runBackup, saveCfg, selfStatus, view } from '../system/backupJobs.js';

const strict = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

const dest = z.object({
  type: z.enum(DEST_TYPES as [string, ...string[]]),
  path: z.string().max(500).default(''),
  host: z.string().max(200).optional(), port: z.number().int().min(1).max(65535).optional(),
  user: z.string().max(200).optional(), domain: z.string().max(200).optional(),
  pass: z.string().max(500).optional(), token: z.string().max(8000).optional(),
});
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const cfgBody = z.object({
  enabled: z.boolean(), dest,
  days: z.array(z.number().int().min(0).max(6)).max(7), times: z.array(hhmm).max(6),
  keep: z.number().int().min(1).max(365),
  passphrase: z.string().min(8).max(200).optional(),
});

/** Los errores del destino son mensajes para el usuario */
const fail = (e: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
  if (e instanceof BackupError) return reply.code(400).send({ error: e.message });
  return reply.code(400).send({ error: (e as Error).message || 'Error' });
};

export const backupRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin);

  /** Los mensajes de la última copia se guardaron en castellano: se traducen al idioma de quien mira */
  const shown = (req: { user?: { lang?: string | null } | null }) => {
    const lang = parseLang(req.user?.lang), v = view(), t = <T extends { msg: string }>(r: T): T => ({ ...r, msg: tr(r.msg, lang) });
    return { ...v, last: v.last ? t(v.last) : null, log: v.log.map(t) };
  };

  app.get('/backup/config', async (req) => shown(req));

  /** Para el panel Backups */
  app.get('/backup/status', async (req) => {
    const s = selfStatus();
    return { status: s ? { ...s, message: s.message ? tr(s.message, parseLang(req.user?.lang)) : undefined } : null };
  });

  app.put('/backup/config', async (req, reply) => {
    const b = cfgBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Revisa los datos: días, horas (HH:MM), copias a guardar y contraseña (mínimo 8 caracteres)' });
    if (b.data.enabled && (!b.data.days.length || !b.data.times.length)) return reply.code(400).send({ error: 'Marca al menos un día y una hora' });
    if (b.data.enabled && !b.data.passphrase && !getCfg().passEnc) return reply.code(400).send({ error: 'Pon la contraseña con la que se cifran las copias' });
    if (b.data.enabled && !b.data.dest.path && b.data.dest.type === 'local') return reply.code(400).send({ error: 'Elige la carpeta de destino' });
    const cin = b.data as Parameters<typeof saveCfg>[0];
    if (cin.dest.type === 'onedrive' && (cin.dest.token || !getCfg().dest.driveId)) {
      try {
        const tk = resolveDest(cin.dest, getCfg().dest).token;
        if (!tk) return reply.code(400).send({ error: 'Falta autorizar la cuenta: pega el token que da «rclone authorize»' });
        const i = await oneDriveInfo(tk); cin.dest.driveId = i.driveId; cin.dest.driveType = i.driveType; cin.dest.token = i.token;
      } catch (e) { return fail(e, reply); }
    }
    saveCfg(cin);
    audit(req.user!.id, 'backup.config', undefined, { enabled: b.data.enabled, type: b.data.dest.type, days: b.data.days, times: b.data.times, keep: b.data.keep });
    return shown(req);
  });

  const draft = z.object({ dest, path: z.string().max(500).default('') });

  app.post('/backup/browse', strict, async (req, reply) => {
    const b = draft.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Datos no válidos' });
    try {
      const d = resolveDest(b.data.dest as never, getCfg().dest);
      return { path: b.data.path, dirs: await driverFor(d).dirs(b.data.path) };
    } catch (e) { return fail(e, reply); }
  });

  app.post('/backup/mkdir', strict, async (req, reply) => {
    const b = z.object({ dest, path: z.string().max(500), name: z.string().trim().min(1).max(100).regex(/^[^/\\]+$/).refine((n) => n !== '.' && n !== '..') }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'El nombre de la carpeta no es válido' });
    try {
      const d = resolveDest(b.data.dest as never, getCfg().dest);
      const p = (b.data.path.replace(/\/+$/, '') + '/' + b.data.name).replace(/^\/{2,}/, '/');
      await driverFor(d).mkdir(p);
      audit(req.user!.id, 'backup.mkdir', undefined, { type: d.type });
      return { ok: true, path: p };
    } catch (e) { return fail(e, reply); }
  });

  app.post('/backup/test', strict, async (req, reply) => {
    const b = z.object({ dest }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Datos no válidos' });
    try {
      const d = resolveDest(b.data.dest as never, getCfg().dest);
      const n = (await driverFor(d).files(d.path)).length;
      return { ok: true, found: n };
    } catch (e) { return fail(e, reply); }
  });

  app.post('/backup/run', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    try {
      const r = await runBackup('manual', app.log);
      audit(req.user!.id, 'backup.run', undefined, { name: r.name });
      return { ...r };
    } catch (e) { return fail(e, reply); }
  });

  app.get('/backup/list', async (_req, reply) => {
    const c = getCfg();
    try {
      const files = (await driverFor(resolveDest(undefined, c.dest)).files(c.dest.path)).sort((a, b) => b.name.localeCompare(a.name));
      return { files };
    } catch (e) { return fail(e, reply); }
  });

  app.post('/backup/restore', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({ name: z.string().max(100), passphrase: z.string().max(200).optional(), confirm: z.literal(true) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Falta elegir la copia o confirmar' });
    const c = getCfg();
    const pass = b.data.passphrase || (c.passEnc ? decrypt(c.passEnc) : '');
    if (!pass) return reply.code(400).send({ error: 'Falta la contraseña de la copia' });
    try {
      const data = await driverFor(resolveDest(undefined, c.dest)).get(c.dest.path, b.data.name);
      const opened = openBackup(data, pass);
      if (opened.secretKey && opened.secretKey !== config.secretKey) {
        return reply.code(409).send({ error: 'Esta copia se hizo con otra SECRET_KEY. Para poder leer sus claves cifradas, pon en el archivo .env: SECRET_KEY=' + opened.secretKey + ' , reinicia con «docker compose up -d» y vuelve a restaurar.' });
      }
      stageRestore(opened);
    } catch (e) { return fail(e, reply); }
    audit(req.user!.id, 'backup.restore.destino', undefined, { name: b.data.name });
    setTimeout(() => process.exit(0), 1500); // Docker lo vuelve a arrancar y entonces se aplica la restauración
    return { ok: true, restarting: true };
  });
};
