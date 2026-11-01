import { eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { allowedElementIds } from '../auth/access.js';
import { audit } from '../auth/audit.js';
import { requireAdmin, requireAuth } from '../auth/guard.js';
import { db, schema } from '../db/index.js';

const { notificationPrefs, elements, users } = schema;

const body = z.object({
  items: z.array(z.object({ elementId: z.string(), push: z.boolean(), email: z.boolean(), telegram: z.boolean().default(false) })).max(2000),
});

const load = (userId: string) =>
  db.select({ elementId: notificationPrefs.elementId, push: notificationPrefs.push, email: notificationPrefs.email, telegram: notificationPrefs.telegram })
    .from(notificationPrefs).where(eq(notificationPrefs.userId, userId)).all();

/** Sustituye los avisos de un usuario. Un Monitor solo puede elegir entre lo que tiene asignado. */
function save(target: { id: string; role: string }, items: z.infer<typeof body>['items']): string | null {
  const wanted = new Map(items.filter((i) => i.push || i.email || i.telegram).map((i) => [i.elementId, i]));
  const ids = [...wanted.keys()];
  if (ids.length && db.select({ id: elements.id }).from(elements).where(inArray(elements.id, ids)).all().length !== ids.length) {
    return 'Alguno de los elementos no existe';
  }
  const allowed = allowedElementIds(target);
  if (allowed && ids.some((id) => !allowed.has(id))) return 'Alguno de los elementos no está asignado a este usuario';
  db.transaction((tx) => {
    tx.delete(notificationPrefs).where(eq(notificationPrefs.userId, target.id)).run();
    if (ids.length) tx.insert(notificationPrefs).values([...wanted.values()].map((i) => ({ userId: target.id, ...i }))).run();
  });
  return null;
}

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me/notifications', { preHandler: requireAuth }, async (req) => ({ items: load(req.user!.id) }));

  app.put('/me/notifications', { preHandler: requireAuth }, async (req, reply) => {
    const b = body.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Datos no válidos' });
    const err = save(req.user!, b.data.items);
    return err ? reply.code(400).send({ error: err }) : { ok: true };
  });

  app.get<{ Params: { id: string } }>('/users/:id/notifications', { preHandler: requireAdmin }, async (req) => ({ items: load(req.params.id) }));

  app.put<{ Params: { id: string } }>('/users/:id/notifications', { preHandler: requireAdmin }, async (req, reply) => {
    const b = body.safeParse(req.body);
    const target = db.select().from(users).where(eq(users.id, req.params.id)).get();
    if (!b.success) return reply.code(400).send({ error: 'Datos no válidos' });
    if (!target) return reply.code(404).send({ error: 'Usuario no encontrado' });
    const err = save(target, b.data.items);
    if (err) return reply.code(400).send({ error: err });
    audit(req.user!.id, 'user.notifications', target.username, { count: b.data.items.filter((i) => i.push || i.email || i.telegram).length });
    return { ok: true };
  });
};
