import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { allowedElementIds } from '../auth/access.js';
import { requireAuth } from '../auth/guard.js';
import { db, schema } from '../db/index.js';
import { getNodeDisks } from '../proxmox/disk-data.js';

/** Estado de los discos de un nodo (solo de los elementos que el usuario puede ver). */
export const diskRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/elements/:id/disks', { preHandler: requireAuth }, async (req, reply) => {
    const el = db.select().from(schema.elements).where(eq(schema.elements.id, req.params.id)).get();
    const allowed = allowedElementIds(req.user!);
    if (!el || el.kind !== 'node' || (allowed && !allowed.has(el.id))) return reply.code(404).send({ error: 'No encontrado' });
    return { disks: getNodeDisks(el.id) };
  });

  /** Discos de todos los nodos visibles (para el panel principal) */
  app.get('/disks', { preHandler: requireAuth }, async (req) => {
    const allowed = allowedElementIds(req.user!);
    const out: Record<string, unknown> = {};
    for (const e of db.select().from(schema.elements).all()) {
      if (e.kind !== 'node' || e.missing || !e.monitored || (allowed && !allowed.has(e.id))) continue;
      const nd = getNodeDisks(e.id);
      if (nd && !nd.error) out[e.id] = { at: nd.at, disks: nd.disks.map((d) => ({ dev: d.dev, model: d.model, size: d.size, type: d.type, health: d.health, bad: d.bad, wear: d.wear, temp: d.temp, why: d.why })), pools: nd.pools };
    }
    return { nodes: out };
  });
};
