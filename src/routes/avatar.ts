/**
 * Foto de perfil. El navegador recorta y reduce la imagen (256×256, JPEG) antes de subirla;
 * aquí solo se comprueba que de verdad es un JPEG pequeño y se guarda.
 * Ver: cualquier usuario con sesión. Cambiar o quitar: el propio usuario o un administrador.
 */
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { audit } from '../auth/audit.js';
import { requireAuth } from '../auth/guard.js';
import { db, schema } from '../db/index.js';

const { users, userAvatars } = schema;

const MAX_BYTES = 200_000;
const body = z.object({ data: z.string().min(100).max(Math.ceil(MAX_BYTES * 1.4)) });

/** JPEG de verdad: empieza por FF D8 FF y acaba en FF D9 */
const isJpeg = (b: Buffer) => b.length > 100 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;

export const avatarRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get<{ Params: { id: string } }>('/avatars/:id', async (req, reply) => {
    const row = db.select().from(userAvatars).where(eq(userAvatars.userId, req.params.id)).get();
    if (!row) return reply.code(404).send({ error: 'Sin foto' });
    return reply
      .header('Content-Type', 'image/jpeg')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, max-age=31536000, immutable') // la URL lleva ?v=fecha: si cambia la foto, cambia la URL
      .send(row.data);
  });

  const allowed = (req: { user: { id: string; role: string } | null }, id: string) => req.user!.id === id || req.user!.role === 'admin';

  app.put<{ Params: { id: string } }>('/users/:id/avatar', async (req, reply) => {
    if (!allowed(req, req.params.id)) return reply.code(403).send({ error: 'Solo puedes cambiar tu propia foto' });
    const target = db.select().from(users).where(eq(users.id, req.params.id)).get();
    if (!target) return reply.code(404).send({ error: 'Usuario no encontrado' });
    const b = body.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Imagen no válida o demasiado grande' });
    const raw = Buffer.from(b.data.data.replace(/^data:image\/jpeg;base64,/, ''), 'base64');
    if (raw.length > MAX_BYTES || !isJpeg(raw)) return reply.code(400).send({ error: 'La imagen debe ser un JPEG de menos de 200 KB' });
    const at = Math.floor(Date.now() / 1000);
    db.insert(userAvatars).values({ userId: target.id, data: raw, updatedAt: at })
      .onConflictDoUpdate({ target: userAvatars.userId, set: { data: raw, updatedAt: at } }).run();
    audit(req.user!.id, 'user.avatar.set', target.username);
    return { avatarAt: at };
  });

  app.delete<{ Params: { id: string } }>('/users/:id/avatar', async (req, reply) => {
    if (!allowed(req, req.params.id)) return reply.code(403).send({ error: 'Solo puedes quitar tu propia foto' });
    const target = db.select().from(users).where(eq(users.id, req.params.id)).get();
    if (!target) return reply.code(404).send({ error: 'Usuario no encontrado' });
    db.delete(userAvatars).where(eq(userAvatars.userId, target.id)).run();
    audit(req.user!.id, 'user.avatar.delete', target.username);
    return { avatarAt: null };
  });
};
