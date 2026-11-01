import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { audit } from '../auth/audit.js';
import { requireAdmin } from '../auth/guard.js';
import { validHost } from '../docker/client.js';
import { DEFAULT_PORT, autodetectServer, detectIpFor, markChildrenMissing, scanDockerForServer, syncEndpoint } from '../docker/discovery.js';
import { db, schema } from '../db/index.js';

const { elements, dockerEndpoints, servers } = schema;

export const dockerRoutes: FastifyPluginAsync = async (app) => {
  const guest = (id: string) => {
    const el = db.select().from(elements).where(eq(elements.id, id)).get();
    return el && (el.kind === 'vm' || el.kind === 'lxc') && !el.missing ? el : null;
  };

  /** Todas las máquinas con su estado de Docker (para la pantalla de administración). */
  app.get('/docker/endpoints', { preHandler: requireAdmin }, async () => {
    const all = db.select().from(elements).all();
    const sv = new Map(db.select().from(servers).all().map((s) => [s.id, s.name]));
    const nodes = new Map(all.filter((e) => e.kind === 'node').map((e) => [e.id, e.alias ?? e.name]));
    const eps = new Map(db.select().from(dockerEndpoints).all().map((r) => [r.elementId, r]));
    const counts = new Map<string, number>();
    for (const e of all) if (e.kind === 'docker' && !e.missing && e.parentId) counts.set(e.parentId, (counts.get(e.parentId) ?? 0) + 1);
    return {
      guests: all.filter((e) => (e.kind === 'vm' || e.kind === 'lxc') && !e.missing).map((e) => {
        const ep = eps.get(e.id);
        return {
          id: e.id, name: e.alias ?? e.name, kind: e.kind, status: e.status,
          server: sv.get(e.serverId), node: e.parentId ? nodes.get(e.parentId) : undefined,
          endpoint: ep ? { host: ep.host, port: ep.port, enabled: ep.enabled, status: ep.status, source: ep.source, lastCheckAt: ep.lastCheckAt, lastError: ep.lastError } : null,
          containers: counts.get(e.id) ?? 0,
        };
      }),
    };
  });

  /** Alta o cambio del endpoint de una máquina. Sin `host`, se averigua la IP por Proxmox. */
  const body = z.object({
    host: z.string().trim().max(253).optional(),
    port: z.number().int().min(1).max(65535).optional(),
  });
  app.put<{ Params: { id: string } }>('/elements/:id/docker', { preHandler: requireAdmin }, async (req, reply) => {
    const b = body.safeParse(req.body ?? {});
    const el = guest(req.params.id);
    if (!b.success || !el) return reply.code(400).send({ error: 'Datos no válidos' });
    const prev = db.select().from(dockerEndpoints).where(eq(dockerEndpoints.elementId, el.id)).get();
    const host = b.data.host || prev?.host || await detectIpFor(el.id);
    if (!host) return reply.code(422).send({ error: 'No he podido averiguar la IP de la máquina. Indícala a mano.' });
    if (!validHost(host)) return reply.code(400).send({ error: 'Host no válido' });
    const port = b.data.port ?? prev?.port ?? DEFAULT_PORT;
    db.insert(dockerEndpoints).values({ elementId: el.id, host, port, enabled: true, source: 'manual' })
      .onConflictDoUpdate({ target: dockerEndpoints.elementId, set: { host, port, enabled: true, source: 'manual', status: 'unknown', lastError: null } }).run();
    // Al reactivar, los contenedores conocidos vuelven a verse
    db.update(elements).set({ missing: false }).where(and(eq(elements.parentId, el.id), eq(elements.kind, 'docker'))).run();
    audit(req.user!.id, 'docker.endpoint', el.name, { host, port });
    return syncEndpoint(el.id);
  });

  /** "Quitar": se desactiva (no se borra) para que la búsqueda automática no lo vuelva a añadir. */
  app.delete<{ Params: { id: string } }>('/elements/:id/docker', { preHandler: requireAdmin }, async (req, reply) => {
    const el = guest(req.params.id);
    if (!el) return reply.code(404).send({ error: 'Máquina no encontrada' });
    db.update(dockerEndpoints).set({ enabled: false, status: 'unknown' }).where(eq(dockerEndpoints.elementId, el.id)).run();
    markChildrenMissing(el.id);
    audit(req.user!.id, 'docker.disable', el.name);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/elements/:id/docker/scan', { preHandler: requireAdmin }, async (req, reply) => {
    const el = guest(req.params.id);
    const ep = el && db.select().from(dockerEndpoints).where(eq(dockerEndpoints.elementId, el.id)).get();
    if (!el || !ep?.enabled) return reply.code(404).send({ error: 'Esta máquina no tiene Docker configurado' });
    return syncEndpoint(el.id);
  });

  /** Busca Docker en todas las máquinas encendidas de los servidores indicados (o de todos). */
  app.post('/docker/detect', { preHandler: requireAdmin }, async (req) => {
    const ids = db.select({ id: servers.id }).from(servers).all().map((s) => s.id);
    let added = 0, endpoints = 0;
    for (const id of ids) {
      added += await autodetectServer(id, true);
      endpoints += (await scanDockerForServer(id)).endpoints;
    }
    audit(req.user!.id, 'docker.detect', undefined, { added });
    return { added, endpoints };
  });
};
