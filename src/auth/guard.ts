import type { FastifyReply, FastifyRequest } from 'fastify';
import type { users } from '../db/schema.js';
import { COOKIE_NAME, resolveSession } from './sessions.js';

type User = typeof users.$inferSelect;

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    sessionId: string | null;
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[COOKIE_NAME];
  const s = token ? resolveSession(token) : null;
  if (!s) return reply.code(401).send({ error: 'No autenticado' });
  req.user = s.user;
  req.sessionId = s.sessionId;
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireAuth(req, reply);
  if (reply.sent) return;
  if (req.user?.role !== 'admin') return reply.code(403).send({ error: 'Requiere administrador' });
}
