import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import { newSecret, verifyTotp } from '../auth/totp.js';
import { encrypt } from '../crypto.js';
import { audit } from '../auth/audit.js';
import { requireAdmin } from '../auth/guard.js';
import { MIN_PASSWORD_LENGTH, hashPassword } from '../auth/password.js';
import { deleteUserSessions } from '../auth/sessions.js';
import { db, schema } from '../db/index.js';
import { publicUser } from './auth.js';

const { users } = schema;

const createBody = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/, 'Usuario: 3-32 caracteres (a-z, 0-9, . _ -)'),
  password: z.string().min(MIN_PASSWORD_LENGTH, `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`).max(256),
  role: z.enum(['admin', 'monitor']),
  displayName: z.string().max(80).optional(),
  email: z.email().optional(),
});

const patchBody = z.object({
  role: z.enum(['admin', 'monitor']).optional(),
  disabled: z.boolean().optional(),
  displayName: z.string().trim().max(80).nullable().optional(),
  email: z.union([z.email(), z.literal('')]).nullable().optional(),
  password: z.string().min(MIN_PASSWORD_LENGTH, `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`).max(256).optional(),
  resetTotp: z.boolean().optional(),
});

export const userRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin);

  app.get('/users', async () => ({ users: db.select().from(users).all().map(publicUser) }));

  app.post('/users', async (req, reply) => {
    const body = createBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'Datos no válidos' });
    if (db.select().from(users).where(eq(users.username, body.data.username)).get()) {
      return reply.code(409).send({ error: 'Ese usuario ya existe' });
    }
    const { password, ...rest } = body.data;
    const created = db.insert(users).values({ ...rest, passwordHash: await hashPassword(password) }).returning().get();
    audit(req.user!.id, 'user.create', created.username, { role: created.role });
    return reply.code(201).send({ user: publicUser(created) });
  });

  app.patch<{ Params: { id: string } }>('/users/:id', async (req, reply) => {
    const body = patchBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'Datos no válidos' });
    const target = db.select().from(users).where(eq(users.id, req.params.id)).get();
    if (!target) return reply.code(404).send({ error: 'Usuario no encontrado' });
    if (target.id === req.user!.id && (body.data.disabled || body.data.role === 'monitor')) {
      return reply.code(400).send({ error: 'No puedes desactivarte ni quitarte el rol de administrador a ti mismo' });
    }
    const { password, resetTotp, ...rest } = body.data;
    const patch: Partial<typeof users.$inferInsert> = { ...rest };
    if (rest.email === '') patch.email = null;
    if (resetTotp) patch.totpSecretEnc = null;
    if (password) patch.passwordHash = await hashPassword(password);
    if (Object.keys(patch).length > 0) db.update(users).set(patch).where(eq(users.id, target.id)).run();
    if (password || body.data.disabled) deleteUserSessions(target.id); // fuerza cerrar sus sesiones
    audit(req.user!.id, 'user.update', target.username, { fields: Object.keys(body.data) });
    return { user: publicUser(db.select().from(users).where(eq(users.id, target.id)).get()!) };
  });

  // Alta de 2FA hecha por un administrador: quien escanee el QR podrá generar los códigos de ese usuario.
  const pending = new Map<string, { secret: string; exp: number }>();
  app.post<{ Params: { id: string } }>('/users/:id/2fa/setup', async (req, reply) => {
    const t = db.select().from(users).where(eq(users.id, req.params.id)).get();
    if (!t) return reply.code(404).send({ error: 'Usuario no encontrado' });
    if (t.totpSecretEnc) return reply.code(400).send({ error: 'Ya tiene 2FA activado' });
    const secret = newSecret();
    pending.set(t.id, { secret, exp: Date.now() + 10 * 60_000 });
    const uri = `otpauth://totp/pvemon:${encodeURIComponent(t.username)}?secret=${secret}&issuer=pvemon`;
    return { secret, svg: await QRCode.toString(uri, { type: 'svg', margin: 1 }) };
  });

  app.post<{ Params: { id: string } }>('/users/:id/2fa/enable', async (req, reply) => {
    const body = z.object({ code: z.string().max(12) }).safeParse(req.body);
    const p = pending.get(req.params.id);
    if (!body.success || !p || p.exp < Date.now() || verifyTotp(p.secret, body.data.code.replace(/\s/g, '')) === null) {
      return reply.code(400).send({ error: 'Código incorrecto o caducado' });
    }
    db.update(users).set({ totpSecretEnc: encrypt(p.secret) }).where(eq(users.id, req.params.id)).run();
    pending.delete(req.params.id);
    audit(req.user!.id, 'user.2fa.enable', req.params.id);
    return { ok: true };
  });
};
