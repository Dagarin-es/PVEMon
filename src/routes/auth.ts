import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import { decrypt, encrypt } from '../crypto.js';
import { newSecret, verifyTotp } from '../auth/totp.js';
import { audit } from '../auth/audit.js';
import { requireAuth } from '../auth/guard.js';
import { DUMMY_HASH, MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from '../auth/password.js';
import { COOKIE_NAME, SESSION_TTL_SEC, createSession, deleteSession, deleteUserSessions } from '../auth/sessions.js';
import { db, schema } from '../db/index.js';

const { users, userAvatars } = schema;

const loginBody = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(256), code: z.string().max(12).optional() });
const passwordBody = z.object({
  current: z.string().min(1).max(256),
  next: z.string().min(MIN_PASSWORD_LENGTH).max(256),
});

/** Cuándo se cambió la foto (sirve para refrescar la caché del navegador); null si no tiene */
const avatarAt = (userId: string): number | null =>
  db.select({ at: userAvatars.updatedAt }).from(userAvatars).where(eq(userAvatars.userId, userId)).get()?.at ?? null;

export const publicUser = (u: typeof users.$inferSelect) => ({
  avatarAt: avatarAt(u.id),
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  email: u.email,
  role: u.role,
  totp: !!u.totpSecretEnc,
  disabled: u.disabled,
  createdAt: u.createdAt,
  lastLoginAt: u.lastLoginAt,
  lang: u.lang === 'en' ? 'en' : 'es',
});

/* Bloqueo por cuenta: 10 fallos en 15 min => 15 min sin poder entrar con ese usuario (además del límite por IP) */
const fails = new Map<string, { n: number; since: number; until: number }>();
const FAIL_MAX = 10, FAIL_WINDOW = 15 * 60_000;
const lockedFor = (u: string): number => { const f = fails.get(u); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60_000) : 0; };
const noteFail = (u: string) => {
  const now = Date.now();
  const f = fails.get(u);
  const cur = !f || now - f.since > FAIL_WINDOW ? { n: 0, since: now, until: 0 } : f;
  cur.n++;
  if (cur.n >= FAIL_MAX) cur.until = now + FAIL_WINDOW;
  fails.set(u, cur);
  if (fails.size > 5000) for (const [k, v] of fails) if (now - v.since > FAIL_WINDOW) fails.delete(k);
};

const lastStep = new Map<string, number>(); // anti-reutilización de códigos
const pending = new Map<string, { secret: string; exp: number }>(); // alta de 2FA a medias

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, // por IP real (trustProxy)
    async (req, reply) => {
      const body = loginBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'Datos no válidos' });
      const username = body.data.username.trim().toLowerCase();

      const wait = lockedFor(username);
      if (wait) {
        audit(null, 'login.locked', username, { ip: req.ip });
        return reply.code(429).send({ error: `Demasiados intentos fallidos. Espera ${wait} min antes de volver a probar.` });
      }
      const user = db.select().from(users).where(eq(users.username, username)).get();
      const ok = await verifyPassword(body.data.password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || user.disabled || !ok) {
        noteFail(username);
        audit(user?.id ?? null, 'login.fail', username, { ip: req.ip });
        return reply.code(401).send({ error: 'Usuario o contraseña incorrectos' });
      }

      if (user.totpSecretEnc) {
        const code = body.data.code?.replace(/\s/g, '');
        if (!code) return { needTotp: true }; // contraseña correcta, falta el código
        const step = verifyTotp(decrypt(user.totpSecretEnc), code, lastStep.get(user.id));
        if (step === null) {
          noteFail(username);
          audit(user.id, 'login.fail', username, { ip: req.ip, totp: true });
          return reply.code(401).send({ error: 'Código incorrecto' });
        }
        lastStep.set(user.id, step);
      }
      fails.delete(username);
      const token = createSession(user.id, req.headers['user-agent']);
      db.update(users).set({ lastLoginAt: Math.floor(Date.now() / 1000) }).where(eq(users.id, user.id)).run();
      audit(user.id, 'login.ok', username, { ip: req.ip });

      reply.setCookie(COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: 'auto', // Secure cuando llega por HTTPS (NPM envía X-Forwarded-Proto)
        path: '/',
        maxAge: SESSION_TTL_SEC,
      });
      return { user: publicUser(user) };
    },
  );

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[COOKIE_NAME];
    if (token) deleteSession(token);
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: requireAuth }, async (req) => ({ user: publicUser(req.user!) }));

  app.put('/auth/lang', { preHandler: requireAuth }, async (req, reply) => {
    const lang = (req.body as { lang?: string } | null)?.lang;
    if (lang !== 'es' && lang !== 'en') return reply.code(400).send({ error: 'Idioma no válido' });
    db.update(users).set({ lang }).where(eq(users.id, req.user!.id)).run();
    return { ok: true };
  });

  app.post('/auth/password', { preHandler: requireAuth }, async (req, reply) => {
    const body = passwordBody.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: `La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres` });
    }
    const user = req.user!;
    if (!(await verifyPassword(body.data.current, user.passwordHash))) {
      return reply.code(403).send({ error: 'Contraseña actual incorrecta' });
    }
    db.update(users).set({ passwordHash: await hashPassword(body.data.next) }).where(eq(users.id, user.id)).run();
    deleteUserSessions(user.id, req.sessionId!); // cierra el resto de sesiones
    audit(user.id, 'password.change', user.username);
    return { ok: true };
  });

  app.post('/auth/2fa/setup', { preHandler: requireAuth }, async (req, reply) => {
    const u = req.user!;
    if (u.totpSecretEnc) return reply.code(400).send({ error: 'Ya está activada' });
    const secret = newSecret();
    pending.set(u.id, { secret, exp: Date.now() + 10 * 60_000 });
    const uri = `otpauth://totp/pvemon:${encodeURIComponent(u.username)}?secret=${secret}&issuer=pvemon`;
    return { secret, uri, svg: await QRCode.toString(uri, { type: 'svg', margin: 1 }) };
  });

  const codeBody = z.object({ code: z.string().max(12), password: z.string().max(256).optional() });
  app.post('/auth/2fa/enable', { preHandler: requireAuth }, async (req, reply) => {
    const b = codeBody.safeParse(req.body);
    const p = pending.get(req.user!.id);
    const step = b.success && p && p.exp > Date.now() ? verifyTotp(p.secret, b.data.code.replace(/\s/g, '')) : null;
    if (!p || step === null) return reply.code(400).send({ error: 'Código incorrecto o caducado' });
    db.update(users).set({ totpSecretEnc: encrypt(p.secret) }).where(eq(users.id, req.user!.id)).run();
    lastStep.set(req.user!.id, step);
    pending.delete(req.user!.id);
    audit(req.user!.id, '2fa.enable', req.user!.username);
    return { ok: true };
  });

  app.post('/auth/2fa/disable', { preHandler: requireAuth }, async (req, reply) => {
    const b = codeBody.safeParse(req.body);
    const u = req.user!;
    if (!b.success || !u.totpSecretEnc || !(await verifyPassword(b.data.password ?? '', u.passwordHash)) ||
        verifyTotp(decrypt(u.totpSecretEnc), b.data.code.replace(/\s/g, ''), lastStep.get(u.id)) === null) {
      return reply.code(403).send({ error: 'Contraseña o código incorrectos' });
    }
    db.update(users).set({ totpSecretEnc: null }).where(eq(users.id, u.id)).run();
    audit(u.id, '2fa.disable', u.username);
    return { ok: true };
  });
};
