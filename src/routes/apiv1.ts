/**
 * API de SOLO LECTURA para integraciones (Home Assistant, la futura app de Android, scripts).
 *  - Autenticación: cabecera «Authorization: Bearer pvm_…» (o «X-Api-Key»). Las claves se crean en Ajustes → Sistema.
 *  - Todas las rutas son GET: ninguna clave puede cambiar nada en pvemon ni en Proxmox.
 *  - Una clave ve todo lo monitorizado (como un administrador) pero NO sirve para el resto de la API (la de la web usa cookie).
 *  - Fechas en ISO 8601 (UTC); tiempos en horas o segundos, siempre indicado en el nombre del campo.
 */
import { EDITION } from '../edition.js';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit } from '../auth/audit.js';
import { requireAdmin } from '../auth/guard.js';
import { createToken, deleteToken, publicTokens, verifyToken } from '../api/tokens.js';
import { db, schema } from '../db/index.js';
import { getGuestNet } from '../proxmox/guestnet.js';
import { getNodeDisks } from '../proxmox/disk-data.js';
import { cachedUpdates } from '../update/service.js';
import { storageUsage } from '../backups/collector.js';
import { describeValue } from '../alerts/engine.js';
import { VERSION } from '../version.js';

const { elements, servers, backupStatus, alertEvents, alertRules } = schema;
type El = typeof elements.$inferSelect;

const iso = (s: number | null | undefined) => (s ? new Date(s * 1000).toISOString() : null);
const r1 = (x: number | undefined) => (x === undefined ? null : Math.round(x * 10) / 10);
const nowSec = () => Math.floor(Date.now() / 1000);

async function apiAuth(req: FastifyRequest, reply: FastifyReply) {
  const h = req.headers.authorization;
  const raw = (h && /^Bearer\s+/i.test(h) ? h.replace(/^Bearer\s+/i, '') : String(req.headers['x-api-key'] ?? '')).trim();
  const t = raw ? verifyToken(raw, req.ip) : null;
  if (!t) {
    req.log.warn({ ip: req.ip }, 'API: clave no válida');
    return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ error: 'Clave de API no válida' });
  }
}

function snapshot(app: { metrics: { latest: (id: string, keys: string[]) => Record<string, { value: number }> } }) {
  const all = db.select().from(elements).all();
  const byId = new Map(all.map((e) => [e.id, e]));
  const srv = new Map(db.select().from(servers).all().map((s) => [s.id, s]));
  const bk = new Map(db.select().from(backupStatus).all().map((b) => [b.elementId, b]));
  const live = all.filter((e) => !e.missing && e.monitored);
  const name = (e: El) => e.alias ?? e.name;
  const nodeOf = (e: El): El | undefined => { let c: El | undefined = e; while (c && c.kind !== 'node') c = c.parentId ? byId.get(c.parentId) : undefined; return c; };
  const M = (e: El, keys: string[]) => { const o: Record<string, number> = {}; for (const [k, v] of Object.entries(app.metrics.latest(e.id, keys))) o[k] = v.value; return o; };

  /* nodos */
  const nodes = live.filter((e) => e.kind === 'node').map((e) => {
    const s = srv.get(e.serverId);
    const m = M(e, ['cpu.usage', 'mem.usage', 'disk.usage', 'uptime', 'temp.cpu', 'load.1m', 'backup.storage']);
    const nd = getNodeDisks(e.id);
    const upd = s ? cachedUpdates(s.id) : null;
    const info = e.info as Record<string, unknown>;
    return {
      id: e.id, name: name(e), server: s?.name ?? null, online: e.status === 'running', status: e.status,
      cpuPercent: r1(m['cpu.usage']), memPercent: r1(m['mem.usage']), diskPercent: r1(m['disk.usage']), uptimeSeconds: m['uptime'] ?? null,
      cpuTempC: r1(m['temp.cpu']), load1m: r1(m['load.1m']), backupStoragePercent: r1(m['backup.storage']),
      cpuModel: info.cpuModel ?? null, cpuCores: info.cpuCores ?? null, memoryTotalBytes: info.memoryTotal ?? null,
      pveVersion: s?.pveVersion ?? null, lastSeenAt: iso(s?.lastSeenAt),
      updates: upd ? { pending: upd.count, checkedAt: iso(upd.checkedAt), packages: upd.packages.slice(0, 50).map((p) => p.name) } : null,
      disks: nd && !nd.error ? { problems: nd.disks.filter((d) => d.bad).length + nd.pools.filter((p) => p.bad).length, maxWearPercent: Math.max(0, ...nd.disks.map((d) => d.wear ?? 0)), maxTempC: Math.max(0, ...nd.disks.map((d) => d.temp ?? 0)), count: nd.disks.length } : null,
    };
  });

  /* VMs y LXC */
  const guests = live.filter((e) => e.kind === 'vm' || e.kind === 'lxc').map((e) => {
    const m = M(e, ['cpu.usage', 'mem.usage', 'mem.used', 'disk.usage', 'uptime', 'net.in', 'net.out']);
    const info = e.info as Record<string, unknown>;
    const b = bk.get(e.id);
    return {
      id: e.id, vmid: Number(e.externalId), name: name(e), type: e.kind, node: nodeOf(e) ? name(nodeOf(e)!) : null, server: srv.get(e.serverId)?.name ?? null,
      running: e.status === 'running', status: e.status,
      cpuPercent: r1(m['cpu.usage']), memPercent: r1(m['mem.usage']), memUsedBytes: m['mem.used'] ?? null, memTotalBytes: info.memoryTotal ?? null,
      diskPercent: r1(m['disk.usage']), uptimeSeconds: m['uptime'] ?? null, netInBytesPerSec: m['net.in'] ?? null, netOutBytesPerSec: m['net.out'] ?? null,
      ip: getGuestNet(e.id)?.ip ?? null, ips: getGuestNet(e.id)?.ips ?? [], guestAgent: getGuestNet(e.id)?.agent ?? null, netCheckedAt: iso(getGuestNet(e.id)?.at),
      backupState: b?.state ?? null,
    };
  });

  /* copias de seguridad: VMs/LXC de Proxmox + tareas de los orígenes por correo (NAS, Fastmail…) */
  const now = nowSec();
  // Misma regla que la pantalla Backups: cualquier copia que PVEMon conozca (no desaparecida), la vigile o no.
  // `monitored` indica si cuenta en el resumen y en las alertas. Una tarea de correo o de archivo recién dada de alta,
  // aún sin estado, sale como «none» en vez de quedar fuera hasta la primera evaluación.
  const backups = all.filter((e) => !e.missing && ['vm', 'lxc', 'backup'].includes(e.kind)).flatMap((e) => {
    const b = bk.get(e.id);
    const s = srv.get(e.serverId);
    if (!s || (!b && e.kind !== 'backup')) return [];
    const isMail = s.kind === 'mail';
    const state = b?.state ?? 'none';
    const maxHours = b?.maxHoursOverride ?? s.backupMaxHours;
    const problem = state === 'error' || state === 'stale';
    return [{
      id: e.id, group: s.name, type: isMail ? 'mail' : 'proxmox', node: isMail ? null : (nodeOf(e) ? name(nodeOf(e)!) : null),
      vmid: isMail ? null : Number(e.externalId), name: name(e), monitored: e.monitored, state,
      ok: state === 'ok' ? true : problem ? false : null, problem,
      lastOkAt: iso(b?.lastOkAt ?? null), ageHours: b?.lastOkAt ? Math.round((now - b.lastOkAt) / 360) / 10 : null, maxHours,
      lastOkSizeBytes: b?.lastOkSize ?? null, lastOkStorage: b?.lastOkStorage ?? null, lastAttemptAt: iso(b?.lastAttemptAt ?? null), lastAttemptOk: b?.lastAttemptOk ?? null,
      message: b?.message ?? null, checkedAt: iso(b?.checkedAt ?? null),
    }];
  }).sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));

  /* discos */
  const disks = live.filter((e) => e.kind === 'node').flatMap((e) => {
    const nd = getNodeDisks(e.id);
    if (!nd || nd.error) return [];
    return nd.disks.map((d) => ({
      node: name(e), device: d.dev, model: d.model.trim(), serial: d.serial, type: d.type, sizeBytes: d.size, health: d.health, problem: d.bad, why: d.why,
      wearPercent: d.wear, tempC: d.temp, powerOnHours: d.hours, powerCycles: d.cycles ?? null, reallocatedSectors: d.realloc, pendingSectors: d.pending, readAt: iso(nd.at),
    }));
  });
  const pools = live.filter((e) => e.kind === 'node').flatMap((e) => (getNodeDisks(e.id)?.pools ?? []).map((p) => ({ node: name(e), pool: p.name, health: p.health, problem: p.bad, sizeBytes: p.size, allocBytes: p.alloc })));

  /* alertas abiertas */
  const rules = new Map(db.select().from(alertRules).all().map((r) => [r.id, r]));
  const alerts = db.select().from(alertEvents).where(eq(alertEvents.state, 'firing')).all()
    .filter((a) => (a.snoozedUntil ?? 0) <= now).map((a) => {
      const el = byId.get(a.elementId), rule = rules.get(a.ruleId);
      return { id: a.id, severity: rule?.severity ?? 'warning', rule: rule?.name ?? '', element: el ? name(el) : '?', kind: el?.kind ?? '', text: rule ? describeValue(rule, Number(a.value), a.elementId) : '', since: iso(a.startedAt) };
    });

  return { nodes, guests, backups, disks, pools, alerts };
}

export const apiV1Routes: FastifyPluginAsync = async (app) => {
  /* ───── gestión de claves (administrador, con la sesión web) ───── */
  app.get('/settings/api-tokens', { preHandler: requireAdmin }, async () => ({ tokens: publicTokens() }));

  app.post('/settings/api-tokens', { preHandler: requireAdmin, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Pon un nombre a la clave (por ejemplo «Home Assistant»)' });
    if (publicTokens().length >= 20) return reply.code(400).send({ error: 'Demasiadas claves (máximo 20): borra alguna que no uses' });
    const r = createToken(b.data.name, req.user!.id);
    audit(req.user!.id, 'api.token.create', b.data.name);
    return { ok: true, token: r.token, id: r.id };
  });

  app.delete<{ Params: { id: string } }>('/settings/api-tokens/:id', { preHandler: requireAdmin }, async (req, reply) => {
    if (!deleteToken(req.params.id)) return reply.code(404).send({ error: 'Clave no encontrada' });
    audit(req.user!.id, 'api.token.delete', req.params.id);
    return { ok: true };
  });

  /* ───── API de lectura ───── */
  await app.register(async (v1) => {
    v1.addHook('preHandler', apiAuth);
    v1.addHook('onSend', async (_req, reply) => { reply.header('Cache-Control', 'no-store'); });
    const limit = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };

    v1.get('/', limit, async () => ({ name: 'pvemon', version: VERSION, readOnly: true, at: new Date().toISOString(), endpoints: ['/api/v1/summary', '/api/v1/nodes', '/api/v1/guests', '/api/v1/backups', '/api/v1/disks', '/api/v1/alerts'] }));

    /** Todo lo que suele necesitar un sensor: contadores y nombres de lo que falla. */
    v1.get('/summary', limit, async () => {
      const s = snapshot(app);
      const bks = s.backups.filter((b) => b.monitored); // el resumen y las alertas solo cuentan lo que se vigila
      const names = <T extends { name: string }>(l: T[]) => l.map((x) => x.name);
      const bkBy = (f: (b: (typeof s.backups)[number]) => boolean) => bks.filter(f);
      const groups: Record<string, { total: number; ok: number; problems: number; failed: string[] }> = {};
      for (const b of bks) {
        const g = (groups[b.group] ??= { total: 0, ok: 0, problems: 0, failed: [] });
        g.total++; if (b.ok) g.ok++; if (b.problem) { g.problems++; g.failed.push(b.name); }
      }
      const storages = [...storageUsage.values()].flat().sort((a, b) => b.pct - a.pct);
      const upd = s.nodes.map((n) => n.updates?.pending ?? 0);
      const out: Record<string, unknown> = {
        at: new Date().toISOString(), version: VERSION,
        ok: !s.alerts.length && !s.nodes.some((n) => !n.online) && !bks.some((b) => b.problem),
        nodes: { total: s.nodes.length, online: s.nodes.filter((n) => n.online).length, offline: s.nodes.filter((n) => !n.online).length, offlineNames: names(s.nodes.filter((n) => !n.online)) },
        guests: { total: s.guests.length, running: s.guests.filter((g) => g.running).length, stopped: s.guests.filter((g) => !g.running).length, stoppedNames: names(s.guests.filter((g) => !g.running)) },
        backups: {
          total: bks.length, ok: bkBy((b) => b.ok === true).length, problems: bkBy((b) => b.problem).length,
          error: bkBy((b) => b.state === 'error').length, stale: bkBy((b) => b.state === 'stale').length, none: bkBy((b) => b.state === 'none').length,
          failedNames: bkBy((b) => b.problem).map((b) => `${b.group}: ${b.name}`), oldestOkAgeHours: Math.max(0, ...bks.map((b) => b.ageHours ?? 0)), groups,
        },
        backupStorageMaxPercent: storages[0]?.pct ?? null,
        disks: {
          total: s.disks.length, problems: s.disks.filter((d) => d.problem).length + s.pools.filter((p) => p.problem).length,
          maxWearPercent: Math.max(0, ...s.disks.map((d) => d.wearPercent ?? 0)), maxTempC: Math.max(0, ...s.disks.map((d) => d.tempC ?? 0)),
          problemNames: [...s.disks.filter((d) => d.problem).map((d) => `${d.node}: ${d.model || d.device}`), ...s.pools.filter((p) => p.problem).map((p) => `${p.node}: ZFS ${p.pool}`)],
        },
        updates: { pending: upd.reduce((a, b) => a + b, 0), nodesWithUpdates: s.nodes.filter((n) => (n.updates?.pending ?? 0) > 0).map((n) => n.name) },
        alerts: { firing: s.alerts.length, critical: s.alerts.filter((a) => a.severity === 'critical').length, texts: s.alerts.slice(0, 10).map((a) => `${a.element}: ${a.text}`) },
      };
      // BCKMon: solo copias y alertas
      if (EDITION === 'bckmon') for (const k of ['nodes', 'guests', 'disks', 'updates', 'backupStorageMaxPercent']) delete out[k];
      return out;
    });

    if (EDITION === 'pvemon') {
      v1.get('/nodes', limit, async () => ({ at: new Date().toISOString(), nodes: snapshot(app).nodes }));
      v1.get('/guests', limit, async () => ({ at: new Date().toISOString(), guests: snapshot(app).guests }));
    }
    /** ?compact=1 deja solo lo necesario para pintar una lista (cabe de sobra en el límite de 16 KB de los atributos de Home Assistant) */
    v1.get<{ Querystring: { compact?: string } }>('/backups', limit, async (req) => {
      const s = snapshot(app);
      const backups = req.query.compact ? s.backups.map((b) => ({ group: b.group, name: b.name, node: b.node, vmid: b.vmid, monitored: b.monitored, state: b.state, ok: b.ok, problem: b.problem, lastOkAt: b.lastOkAt, ageHours: b.ageHours, sizeBytes: b.lastOkSizeBytes, message: b.message })) : s.backups;
      return { at: new Date().toISOString(), backups, storages: [...storageUsage.values()].flat().sort((a, b) => b.pct - a.pct) };
    });
    if (EDITION === 'pvemon') v1.get('/disks', limit, async () => { const s = snapshot(app); return { at: new Date().toISOString(), disks: s.disks, pools: s.pools }; });
    v1.get('/alerts', limit, async () => ({ at: new Date().toISOString(), alerts: snapshot(app).alerts }));
  }, { prefix: '/v1' });
};
