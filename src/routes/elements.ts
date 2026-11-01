import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { audit } from '../auth/audit.js';
import { allowedElementIds } from '../auth/access.js';
import { requireAdmin, requireAuth } from '../auth/guard.js';
import { db, schema } from '../db/index.js';
import { activeMaintenance } from '../alerts/maintenance.js';
import { getGuestNet } from '../proxmox/guestnet.js';

const { elements, servers, users, elementAccess, notificationPrefs, backupStatus } = schema;

interface TreeNode {
  id: string; kind: string; name: string; originalName: string; alias: string | null; status: string; monitored: boolean; isNew: boolean;
  missing: boolean; serverId: string; maintenanceUntil?: number; backup?: unknown; origin: 'manual' | 'auto' | 'mail'; accessible: boolean; info?: unknown; server?: unknown; children: TreeNode[];
}

export const elementRoutes: FastifyPluginAsync = async (app) => {
  /** Árbol servidor → nodo → VM/LXC (→ Docker). El Monitor solo ve lo monitorizado y permitido. */
  app.get('/tree', { preHandler: requireAuth }, async (req) => {
    const user = req.user!;
    const allowed = allowedElementIds(user);
    const all = db.select().from(elements).all();
    const conn = new Map(db.select().from(servers).all().map((s) => [s.id, s]));
    const bk = new Map(db.select().from(backupStatus).all().map((b) => [b.elementId, b]));
    const visible = (e: (typeof all)[number]) => allowed === null || (allowed.has(e.id) && e.monitored && !e.missing);

    const byId = new Map(all.map((e) => [e.id, e]));
    const show = new Set<string>(); // visibles + sus ancestros (para poder navegar)
    for (const e of all.filter(visible)) {
      for (let cur: (typeof all)[number] | undefined = e; cur && !show.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) show.add(cur.id);
    }

    const maint = activeMaintenance();
    const hostOf = (u?: string) => { try { return u ? new URL(u).hostname : ''; } catch { return ''; } };
    const nodeCount = new Map<string, number>();
    for (const e of all) if (e.kind === 'node') nodeCount.set(e.serverId, (nodeCount.get(e.serverId) ?? 0) + 1);
    /** Añade a la ficha la IP (y el estado del agente en las VM). Solo lectura: son datos ya recogidos de Proxmox. */
    const withNet = (e: (typeof all)[number]) => {
      if (e.kind === 'vm' || e.kind === 'lxc') {
        const n = getGuestNet(e.id);
        return n ? { ...(e.info ?? {}), ip: n.ip, ips: n.ips, agent: e.kind === 'vm' ? n.agent : undefined } : e.info;
      }
      if (e.kind === 'node' && nodeCount.get(e.serverId) === 1) {
        const host = hostOf(conn.get(e.serverId)?.baseUrl);
        return host ? { ...(e.info ?? {}), ip: host } : e.info;
      }
      return e.info;
    };
    const nodes = new Map<string, TreeNode>();
    for (const e of all.filter((x) => show.has(x.id))) {
      const ok = visible(e);
      const s = e.kind === 'server' ? conn.get(e.serverId) : undefined;
      nodes.set(e.id, {
        id: e.id, serverId: e.serverId, kind: e.kind, name: e.alias ?? e.name, originalName: e.name, alias: e.alias, origin: e.kind === 'server' ? (conn.get(e.serverId)?.kind === 'mail' ? 'mail' : conn.get(e.serverId)?.source ?? 'auto') : 'auto', status: e.status, monitored: e.monitored, isNew: e.isNew, missing: e.missing,
        maintenanceUntil: ok ? maint[e.id] : undefined, accessible: ok, info: ok ? withNet(e) : undefined,
        backup: ok && bk.has(e.id) ? (({ state, lastOkAt, lastOkSize, lastOkStorage, lastAttemptAt, lastAttemptOk, message, checkedAt, maxHoursOverride }) =>
          ({ state, lastOkAt, lastOkSize, lastOkStorage, lastAttemptAt, lastAttemptOk, message, checkedAt, maxHours: maxHoursOverride ?? conn.get(e.serverId)?.backupMaxHours, ownLimit: maxHoursOverride != null }))(bk.get(e.id)!) : undefined,
        server: s && ok ? { source: s.source, status: s.status, lastSeenAt: s.lastSeenAt, lastError: s.lastError, pveVersion: s.pveVersion } : undefined,
        children: [],
      });
    }
    const roots: TreeNode[] = [];
    for (const e of all.filter((x) => show.has(x.id))) {
      const n = nodes.get(e.id)!;
      const parent = e.parentId ? nodes.get(e.parentId) : undefined;
      (parent ? parent.children : roots).push(n);
    }
    return { tree: roots };
  });

  const patchBody = z.object({ monitored: z.boolean() });
  const elBody = z.object({
    monitored: z.boolean().optional(),
    /** Nombre propio; vacío o null = volver al original */
    alias: z.string().trim().max(60).nullable().optional(),
  }).refine((b) => b.monitored !== undefined || b.alias !== undefined);
  app.patch<{ Params: { id: string } }>('/elements/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const body = elBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Datos no válidos' });
    const el = db.select().from(elements).where(eq(elements.id, req.params.id)).get();
    if (!el) return reply.code(404).send({ error: 'Elemento no encontrado' });
    const set: Partial<typeof elements.$inferInsert> = {};
    if (body.data.monitored !== undefined) { set.monitored = body.data.monitored; set.isNew = false; }
    if (body.data.alias !== undefined) set.alias = body.data.alias || null;
    db.update(elements).set(set).where(eq(elements.id, el.id)).run();
    audit(req.user!.id, body.data.alias !== undefined ? 'element.rename' : 'element.monitor', el.name, body.data);
    return { ok: true };
  });

  /** Atajo: marcar de golpe todo lo de un servidor (nodos, VMs y LXC) como monitorizado o no. */
  app.post<{ Params: { id: string } }>('/servers/:id/monitor-all', { preHandler: requireAdmin }, async (req, reply) => {
    const body = patchBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Datos no válidos' });
    if (!db.select().from(servers).where(eq(servers.id, req.params.id)).get()) {
      return reply.code(404).send({ error: 'Nodo no encontrado' });
    }
    const targets = db.select({ id: elements.id }).from(elements)
      .where(and(eq(elements.serverId, req.params.id), eq(elements.missing, false), inArray(elements.kind, ['node', 'vm', 'lxc', 'docker']))).all();
    if (targets.length) {
      db.update(elements).set({ monitored: body.data.monitored, isNew: false })
        .where(inArray(elements.id, targets.map((t) => t.id))).run();
    }
    audit(req.user!.id, 'server.monitor-all', req.params.id, { monitored: body.data.monitored, count: targets.length });
    return { ok: true, count: targets.length };
  });

  /** Permisos de un usuario Monitor: sustituye la lista completa. */
  const accessBody = z.object({ elementIds: z.array(z.string()).max(1000) });
  app.get<{ Params: { id: string } }>('/users/:id/access', { preHandler: requireAdmin }, async (req) => ({
    elementIds: db.select({ id: elementAccess.elementId }).from(elementAccess).where(eq(elementAccess.userId, req.params.id)).all().map((r) => r.id),
  }));

  app.put<{ Params: { id: string } }>('/users/:id/access', { preHandler: requireAdmin }, async (req, reply) => {
    const body = accessBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Datos no válidos' });
    const user = db.select().from(users).where(eq(users.id, req.params.id)).get();
    if (!user) return reply.code(404).send({ error: 'Usuario no encontrado' });
    const ids = [...new Set(body.data.elementIds)];
    if (ids.length && db.select({ id: elements.id }).from(elements).where(inArray(elements.id, ids)).all().length !== ids.length) {
      return reply.code(400).send({ error: 'Alguno de los elementos no existe' });
    }
    db.transaction((tx) => {
      tx.delete(elementAccess).where(eq(elementAccess.userId, user.id)).run();
      if (ids.length) tx.insert(elementAccess).values(ids.map((elementId) => ({ userId: user.id, elementId }))).run();
    });
    const allowed = allowedElementIds(user);
    if (allowed) {
      for (const n of db.select({ id: notificationPrefs.elementId }).from(notificationPrefs).where(eq(notificationPrefs.userId, user.id)).all()) {
        if (!allowed.has(n.id)) db.delete(notificationPrefs).where(and(eq(notificationPrefs.userId, user.id), eq(notificationPrefs.elementId, n.id))).run();
      }
    }
    audit(req.user!.id, 'user.access', user.username, { count: ids.length });
    return { ok: true, count: ids.length };
  });
};
