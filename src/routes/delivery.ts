import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { audit } from '../auth/audit.js';
import { requireAdmin, requireAuth } from '../auth/guard.js';
import { encrypt } from '../crypto.js';
import { db, schema } from '../db/index.js';
import { tf } from '../i18n.js';
import { systemLang, userLang, getHook, sendHook, type HookConfig, type HookKind, getSmtp, getTelegram, sendMail, sendPushTo, sendTelegram, setSetting, telegramChats, vapid, type SmtpConfig, type TelegramConfig } from '../alerts/notify.js';
import { decrypt } from '../crypto.js';

const { pushSubscriptions } = schema;

const smtpBody = z.object({
  host: z.string().trim().min(1).max(200),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().trim().max(200).nullable().optional(),
  password: z.string().max(500).optional(), // vacío/ausente = conservar la actual
  from: z.string().trim().min(3).max(200),
});

const subBody = z.object({
  endpoint: z.string().max(1000).startsWith('https://'),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(10).max(100) }),
});

const tgBody = z.object({
  token: z.string().trim().max(200).optional(), // vacío/ausente = conservar el actual
  chatId: z.string().trim().max(100),
  enabled: z.boolean(),
});
const TOKEN_RE = /^\d{6,}:[A-Za-z0-9_-]{30,}$/;

const hookBody = z.object({
  url: z.string().trim().max(2000).optional(), // vacío/ausente = conservar la actual
  secret: z.string().max(200).optional(),
  clearSecret: z.boolean().optional(),
  enabled: z.boolean(),
  onlyCritical: z.boolean(),
});
const KINDS: HookKind[] = ['webhook', 'teams'];

const testLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

export const deliveryRoutes: FastifyPluginAsync = async (app) => {
  /* ───── correo ───── */
  app.get('/settings/smtp', { preHandler: requireAdmin }, async () => {
    const c = getSmtp();
    return { smtp: c
      ? { host: c.host, port: c.port, secure: c.secure, user: c.user, from: c.from, hasPassword: !!c.passEnc }
      : { host: '', port: 465, secure: true, user: null, from: '', hasPassword: false } };
  });

  app.put('/settings/smtp', { preHandler: requireAdmin }, async (req, reply) => {
    const b = smtpBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Revisa los datos: servidor, puerto y remitente son obligatorios' });
    const prev = getSmtp();
    const user = b.data.user || null;
    const cfg: SmtpConfig = {
      host: b.data.host, port: b.data.port, secure: b.data.secure, user, from: b.data.from,
      passEnc: !user ? null : b.data.password ? encrypt(b.data.password) : prev?.passEnc ?? null,
    };
    setSetting('smtp', cfg);
    audit(req.user!.id, 'settings.smtp', b.data.host);
    return { ok: true };
  });

  /** Envía un correo de prueba a la dirección del propio administrador. */
  app.post('/settings/smtp/test', { preHandler: requireAdmin, ...testLimit }, async (req, reply) => {
    const to = req.user!.email;
    if (!to) return reply.code(400).send({ error: 'Tu usuario no tiene correo: añádelo en Ajustes → Usuarios → Editar' });
    try {
      { const lg = userLang(req.user!); await sendMail(to, tf('[pvemon] Correo de prueba', lg), tf('Si lees esto, el envío de correo de pvemon funciona.', lg)); }
      return { ok: true, to };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  /* ───── Telegram ───── */
  app.get('/telegram/status', { preHandler: requireAuth }, async () => {
    const c = getTelegram();
    return { enabled: !!(c?.enabled && c.tokenEnc && c.chatId) };
  });

  app.get('/settings/telegram', { preHandler: requireAdmin }, async () => {
    const c = getTelegram();
    return { telegram: { chatId: c?.chatId ?? '', enabled: !!c?.enabled, hasToken: !!c?.tokenEnc } };
  });

  app.put('/settings/telegram', { preHandler: requireAdmin }, async (req, reply) => {
    const b = tgBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Revisa los datos' });
    const prev = getTelegram();
    if (b.data.token && !TOKEN_RE.test(b.data.token)) return reply.code(400).send({ error: 'El token no tiene el formato de Telegram (123456789:ABC…). Cópialo entero desde @BotFather.' });
    const tokenEnc = b.data.token ? encrypt(b.data.token) : prev?.tokenEnc ?? null;
    if (b.data.enabled && (!tokenEnc || !b.data.chatId)) return reply.code(400).send({ error: 'Para activarlo hacen falta el token y el Chat ID' });
    const cfg: TelegramConfig = { tokenEnc, chatId: b.data.chatId, enabled: b.data.enabled };
    setSetting('telegram', cfg);
    audit(req.user!.id, 'settings.telegram', b.data.enabled ? 'activado' : 'desactivado');
    return { ok: true };
  });

  const tgToken = (given?: string): string | null => {
    if (given) return TOKEN_RE.test(given) ? given : null;
    const c = getTelegram();
    return c?.tokenEnc ? decrypt(c.tokenEnc) : null;
  };

  app.post('/settings/telegram/test', { preHandler: requireAdmin, ...testLimit }, async (req, reply) => {
    const c = getTelegram();
    const token = tgToken();
    if (!token || !c?.chatId) return reply.code(400).send({ error: 'Guarda primero el token y el Chat ID' });
    try { await sendTelegram(tf('✅ pvemon: mensaje de prueba. Si lo lees, Telegram funciona.', systemLang()), { token, chatId: c.chatId }); return { ok: true }; }
    catch (e) { return reply.code(502).send({ error: (e as Error).message }); }
  });

  /** Busca el Chat ID entre quienes han escrito al bot */
  app.post('/settings/telegram/chats', { preHandler: requireAdmin, ...testLimit }, async (req, reply) => {
    const b = z.object({ token: z.string().trim().max(200).optional() }).safeParse(req.body);
    const token = tgToken(b.success ? b.data.token : undefined);
    if (!token) return reply.code(400).send({ error: 'Falta el token del bot (o no tiene el formato correcto)' });
    try { return { chats: await telegramChats(token) }; }
    catch (e) { return reply.code(502).send({ error: (e as Error).message }); }
  });

  /* ───── webhook y Teams ───── */
  for (const kind of KINDS) {
    app.get(`/settings/${kind}`, { preHandler: requireAdmin }, async () => {
      const c = getHook(kind);
      return { hook: { enabled: !!c?.enabled, onlyCritical: !!c?.onlyCritical, hasUrl: !!c?.urlEnc, hasSecret: !!c?.secretEnc } };
    });
    app.put(`/settings/${kind}`, { preHandler: requireAdmin }, async (req, reply) => {
      const b = hookBody.safeParse(req.body);
      if (!b.success) return reply.code(400).send({ error: 'Revisa los datos' });
      const prev = getHook(kind);
      if (b.data.url) {
        let u: URL;
        try { u = new URL(b.data.url); } catch { return reply.code(400).send({ error: 'La dirección no es válida' }); }
        if (u.protocol !== 'https:' && !(kind === 'webhook' && u.protocol === 'http:')) return reply.code(400).send({ error: kind === 'teams' ? 'La dirección de Teams debe empezar por https://' : 'La dirección debe empezar por http:// o https://' });
      }
      const urlEnc = b.data.url ? encrypt(b.data.url) : prev?.urlEnc ?? null;
      if (b.data.enabled && !urlEnc) return reply.code(400).send({ error: 'Para activarlo hace falta la dirección' });
      const secretEnc = b.data.clearSecret ? null : b.data.secret ? encrypt(b.data.secret) : prev?.secretEnc ?? null;
      const cfg: HookConfig = { urlEnc, enabled: b.data.enabled, onlyCritical: b.data.onlyCritical, ...(kind === 'webhook' ? { secretEnc } : {}) };
      setSetting(kind, cfg);
      audit(req.user!.id, `settings.${kind}`, b.data.enabled ? 'activado' : 'desactivado');
      return { ok: true };
    });
    app.post(`/settings/${kind}/test`, { preHandler: requireAdmin, ...testLimit }, async (req, reply) => {
      const c = getHook(kind);
      if (!c?.urlEnc) return reply.code(400).send({ error: 'Guarda primero la dirección' });
      try {
        await sendHook(kind, decrypt(c.urlEnc), [{ eventId: 'prueba', tag: 'prueba', state: 'firing', severity: 'warning', elementId: 'prueba', title: '🟠 pvemon: aviso de prueba', text: 'Si lo lees, este canal funciona.', path: '' }], c.secretEnc ? decrypt(c.secretEnc) : null);
        return { ok: true };
      } catch (e) { return reply.code(502).send({ error: (e as Error).message }); }
    });
  }

  /* ───── push ───── */
  app.get('/push/key', { preHandler: requireAuth }, async () => ({ key: vapid().publicKey }));

  app.post('/push/subscribe', { preHandler: requireAuth }, async (req, reply) => {
    const b = subBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Suscripción no válida' });
    const mine = db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, req.user!.id)).all();
    if (mine.length >= 10 && !mine.some((m) => m.endpoint === b.data.endpoint)) {
      return reply.code(400).send({ error: 'Demasiados dispositivos activados (máximo 10)' });
    }
    const values = {
      userId: req.user!.id, endpoint: b.data.endpoint, p256dh: b.data.keys.p256dh, auth: b.data.keys.auth,
      userAgent: req.headers['user-agent']?.slice(0, 200),
    };
    db.insert(pushSubscriptions).values(values)
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: values.userId, p256dh: values.p256dh, auth: values.auth, userAgent: values.userAgent } }).run();
    return { ok: true };
  });

  app.post('/push/unsubscribe', { preHandler: requireAuth }, async (req, reply) => {
    const b = z.object({ endpoint: z.string().max(1000) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Datos no válidos' });
    db.delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, b.data.endpoint), eq(pushSubscriptions.userId, req.user!.id))).run();
    return { ok: true };
  });

  app.post('/push/test', { preHandler: requireAuth, ...testLimit }, async (req, reply) => {
    const sent = await sendPushTo(req.user!.id, { title: 'pvemon', body: tf('Notificación de prueba ✅', userLang(req.user!)), tag: 'pvemon-test' });
    return sent > 0 ? { ok: true, sent } : reply.code(400).send({ error: 'No se pudo enviar: no hay ningún dispositivo activado o el servicio de notificaciones no respondió' });
  });
};
