import type { FastifyPluginAsync } from 'fastify';
import { allowedElementIds } from '../auth/access.js';
import { requireAuth } from '../auth/guard.js';
import { db, schema } from '../db/index.js';

const { elements } = schema;
const KEYS = ['uptime', 'mem.used', 'mem.usage', 'disk.usage', 'cpu.usage', 'temp.cpu', 'storage.total', 'storage.used', 'disk.size', 'disk.fs.used', 'disk.fs.total', 'disks.bad', 'disks.wear', 'disks.temp'];

export const overviewRoutes: FastifyPluginAsync = async (app) => {
  /** Últimos valores de las métricas que alimentan el panel principal, solo de lo que el usuario puede ver. */
  app.get('/overview', { preHandler: requireAuth }, async (req) => {
    const user = req.user!;
    const allowed = allowedElementIds(user);
    const out: Record<string, Record<string, number>> = {};
    for (const e of db.select().from(elements).all()) {
      if (!['node', 'vm', 'lxc', 'docker'].includes(e.kind) || e.missing || !e.monitored) continue;
      if (allowed !== null && !allowed.has(e.id)) continue;
      const l = app.metrics.latest(e.id, KEYS);
      const o: Record<string, number> = {};
      for (const [k, v] of Object.entries(l)) o[k] = v.value;
      out[e.id] = o;
    }
    return { latest: out, at: Math.floor(Date.now() / 1000) };
  });
};
