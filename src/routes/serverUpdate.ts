import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { audit } from '../auth/audit.js';
import { requireAdmin } from '../auth/guard.js';
import { db, schema } from '../db/index.js';
import { SshError } from '../update/ssh.js';
import { checkUpdates, forgetSsh, info, testSsh } from '../update/service.js';

const { servers } = schema;

export const serverUpdateRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin);

  const find = (id: string) => db.select().from(servers).where(eq(servers.id, id)).get();
  const guard = (s: ReturnType<typeof find>) => (!s || s.kind === 'mail' ? null : s);

  app.get<{ Params: { id: string } }>('/servers/:id/update', async (req, reply) => {
    const s = guard(find(req.params.id));
    if (!s) return reply.code(404).send({ error: 'Nodo no encontrado' });
    return info(s);
  });

  app.post<{ Params: { id: string } }>('/servers/:id/update/check', async (req, reply) => {
    const s = guard(find(req.params.id));
    if (!s) return reply.code(404).send({ error: 'Nodo no encontrado' });
    try {
      const r = await checkUpdates(s);
      return { ...info(s), note: r.note ?? null };
    } catch (e) { return reply.code(502).send({ error: (e as Error).message }); }
  });

  app.post<{ Params: { id: string } }>('/servers/:id/update/test', async (req, reply) => {
    const s = guard(find(req.params.id));
    if (!s) return reply.code(404).send({ error: 'Nodo no encontrado' });
    try { await testSsh(s); } catch (e) {
      return reply.code(e instanceof SshError ? 502 : 500).send({ error: (e as Error).message });
    }
    audit(req.user!.id, 'server.update.ssh', s.name);
    return info(s);
  });

  /** Olvida el acceso SSH en pvemon; el bloque para quitar la clave del nodo va en info().remove */
  app.post<{ Params: { id: string } }>('/servers/:id/update/forget', async (req, reply) => {
    const s = guard(find(req.params.id));
    if (!s) return reply.code(404).send({ error: 'Nodo no encontrado' });
    forgetSsh(s);
    audit(req.user!.id, 'server.update.ssh.forget', s.name);
    return info(s);
  });
};
