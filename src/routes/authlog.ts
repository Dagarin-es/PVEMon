import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { allowedElementIds } from '../auth/access.js';
import { requireAuth } from '../auth/guard.js';
import { db, schema } from '../db/index.js';
import { authSummary } from '../proxmox/authlog.js';

/** Órdenes para dar al token de PVEMon el privilegio Sys.Syslog en /nodes (se pegan una vez, como root, en la consola del nodo). */
function permScript(tokenId: string): string {
  const user = tokenId.split('!')[0];
  return [
    'pveum role add MonSyslog -privs "Sys.Syslog" || pveum role modify MonSyslog -privs "Sys.Syslog"',
    `pveum acl modify /nodes --users '${user}' --roles PVEAuditor,MonSyslog`,
    `pveum acl modify /nodes --tokens '${tokenId}' --roles PVEAuditor,MonSyslog`,
  ].join('\n');
}

/** Accesos fallidos a Proxmox de cada nodo visible (solo PVEMon). */
export const authLogRoutes: FastifyPluginAsync = async (app) => {
  app.get('/auth-failures', { preHandler: requireAuth }, async (req) => {
    const allowed = allowedElementIds(req.user!);
    const out: Record<string, unknown> = {};
    for (const e of db.select().from(schema.elements).where(eq(schema.elements.kind, 'node')).all()) {
      if (e.missing || !e.monitored || (allowed && !allowed.has(e.id))) continue;
      const s = authSummary(e.id);
      if (!s) continue;
      const tokenId = db.select().from(schema.servers).where(eq(schema.servers.id, e.serverId)).get()?.tokenId ?? '';
      out[e.id] = { ...s, setup: permScript(tokenId) };
    }
    return { nodes: out };
  });
};
