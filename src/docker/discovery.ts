/**
 * Descubrimiento de Docker: encuentra solo los docker-socket-proxy de las VMs/LXC y mantiene
 * los contenedores como elementos hijos de la máquina donde corren.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { ElementStatus } from '../db/schema.js';
import { PveClient } from '../proxmox/client.js';
import { connFor } from '../proxmox/discovery.js';
import { containerName, listContainers, ping, type Endpoint } from './client.js';

const { elements, dockerEndpoints, servers } = schema;

export const DEFAULT_PORT = 2375;

export const dockerStatus = (state: string): ElementStatus =>
  state === 'running' ? 'running' : state === 'paused' ? 'paused' : state === 'restarting' ? 'restarting'
  : state === 'exited' || state === 'dead' || state === 'created' ? 'stopped' : 'unknown';

/* ───────────── IP de la máquina ───────────── */

// Interfaces internas de Docker/VPN: la IP útil es la de la LAN
const SKIP_IF = /^(lo|docker\d*|br-.*|veth.*|virbr.*|cni.*|flannel.*|cali.*|hassio|tailscale.*|wg.*|zt.*)$/;
const usable = (ip: string) => /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !ip.startsWith('127.') && !ip.startsWith('169.254.');

async function safe<T>(p: Promise<T>): Promise<T | null> { try { return await p; } catch { return null; } }

/** IP de una VM o LXC: de Proxmox (LXC), del agente invitado (VM) o de la configuración si es fija. */
export async function guestIp(client: PveClient, node: string, kind: 'vm' | 'lxc', vmid: string): Promise<string | null> {
  if (kind === 'lxc') {
    const ifs = await safe(client.get<{ name: string; inet?: string }[]>(`/nodes/${node}/lxc/${vmid}/interfaces`));
    for (const i of ifs ?? []) {
      const ip = i.inet?.split('/')[0] ?? '';
      if (!SKIP_IF.test(i.name) && usable(ip)) return ip;
    }
    const cfg = await safe(client.get<Record<string, string>>(`/nodes/${node}/lxc/${vmid}/config`));
    const m = Object.entries(cfg ?? {}).find(([k, v]) => /^net\d+$/.test(k) && /ip=\d/.test(v));
    return m ? /ip=(\d+\.\d+\.\d+\.\d+)/.exec(m[1])?.[1] ?? null : null;
  }
  const r = await safe(client.get<{ result?: { name: string; 'ip-addresses'?: { 'ip-address': string; 'ip-address-type': string }[] }[] }>(
    `/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`));
  for (const i of r?.result ?? []) {
    if (SKIP_IF.test(i.name)) continue;
    for (const a of i['ip-addresses'] ?? []) if (a['ip-address-type'] === 'ipv4' && usable(a['ip-address'])) return a['ip-address'];
  }
  return null;
}

/* ───────────── búsqueda automática ───────────── */

const probedAt = new Map<string, number>(); // máquina → último sondeo sin resultado
const REPROBE_SEC = 30 * 60;

/** Busca un docker-socket-proxy en el puerto por defecto de cada máquina encendida sin endpoint registrado. */
export async function autodetectServer(serverId: string, force = false): Promise<number> {
  const server = db.select().from(servers).where(eq(servers.id, serverId)).get();
  if (!server) return 0;
  const now = Math.floor(Date.now() / 1000);
  const all = db.select().from(elements).where(eq(elements.serverId, serverId)).all();
  const nodes = new Map(all.filter((e) => e.kind === 'node').map((e) => [e.id, e]));
  const known = new Set(db.select({ id: dockerEndpoints.elementId }).from(dockerEndpoints).all().map((r) => r.id));
  const todo = all.filter((e) =>
    (e.kind === 'vm' || e.kind === 'lxc') && !e.missing && e.status === 'running' && !known.has(e.id)
    && (force || now - (probedAt.get(e.id) ?? 0) > REPROBE_SEC));
  if (!todo.length) return 0;

  const client = new PveClient(connFor(server));
  let added = 0;
  try {
    const queue = [...todo];
    const worker = async () => {
      for (let g = queue.shift(); g; g = queue.shift()) {
        const node = g.parentId ? nodes.get(g.parentId) : undefined;
        if (!node) continue;
        probedAt.set(g.id, now);
        const ip = await guestIp(client, node.externalId, g.kind as 'vm' | 'lxc', g.externalId);
        if (ip && await ping({ host: ip, port: DEFAULT_PORT })) {
          db.insert(dockerEndpoints).values({ elementId: g.id, host: ip, port: DEFAULT_PORT, enabled: true, source: 'auto' })
            .onConflictDoNothing().run();
          added++;
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  } finally {
    await client.close();
  }
  return added;
}

/* ───────────── contenedores como elementos ───────────── */

export interface SyncResult { status: 'ok' | 'unreachable'; containers: number; newOnes: number; error?: string }

export function setChildrenStatus(guestId: string, status: ElementStatus): void {
  db.update(elements).set({ status }).where(and(eq(elements.parentId, guestId), eq(elements.kind, 'docker'))).run();
}

/** Quita de la vista los contenedores de una máquina (se conservan por si vuelve a activarse). */
export function markChildrenMissing(guestId: string): void {
  db.update(elements).set({ missing: true, status: 'unknown' })
    .where(and(eq(elements.parentId, guestId), eq(elements.kind, 'docker'))).run();
}

/** Lee los contenedores de una máquina y sincroniza el árbol. */
export async function syncEndpoint(guestId: string): Promise<SyncResult> {
  const row = db.select().from(dockerEndpoints).where(eq(dockerEndpoints.elementId, guestId)).get();
  const guest = db.select().from(elements).where(eq(elements.id, guestId)).get();
  if (!row || !guest) return { status: 'unreachable', containers: 0, newOnes: 0, error: 'Sin endpoint' };
  const ep: Endpoint = { host: row.host, port: row.port };
  const now = Math.floor(Date.now() / 1000);

  let list;
  try {
    list = await listContainers(ep);
  } catch (err) {
    const error = (err as Error).message;
    db.update(dockerEndpoints).set({ status: 'unreachable', lastCheckAt: now, lastError: error }).where(eq(dockerEndpoints.elementId, guestId)).run();
    setChildrenStatus(guestId, 'unknown');
    return { status: 'unreachable', containers: 0, newOnes: 0, error };
  }

  let newOnes = 0;
  db.transaction((tx) => {
    const existing = new Map(tx.select().from(elements)
      .where(and(eq(elements.parentId, guestId), eq(elements.kind, 'docker'))).all().map((e) => [e.externalId, e]));
    const seen = new Set<string>();
    for (const c of list) {
      const name = containerName(c);
      seen.add(name);
      const info = {
        image: c.Image, containerId: c.Id.slice(0, 12), created: c.Created,
        compose: c.Labels?.['com.docker.compose.project'] ? `${c.Labels['com.docker.compose.project']}/${c.Labels['com.docker.compose.service'] ?? ''}` : undefined,
      };
      const prev = existing.get(name);
      if (prev) {
        tx.update(elements).set({ status: dockerStatus(c.State), info, missing: false, lastSeenAt: now }).where(eq(elements.id, prev.id)).run();
      } else {
        newOnes++;
        tx.insert(elements).values({
          id: crypto.randomUUID(), serverId: guest.serverId, parentId: guestId, kind: 'docker', externalId: name, name,
          status: dockerStatus(c.State), info, monitored: false, isNew: true,
        }).run();
      }
    }
    const gone = [...existing].filter(([n, e]) => !seen.has(n) && !e.missing).map(([, e]) => e.id);
    if (gone.length) tx.update(elements).set({ missing: true, status: 'unknown' }).where(inArray(elements.id, gone)).run();
    tx.update(dockerEndpoints).set({ status: 'ok', lastCheckAt: now, lastError: null }).where(eq(dockerEndpoints.elementId, guestId)).run();
  });
  return { status: 'ok', containers: list.length, newOnes };
}

/** Búsqueda automática + sincronización de todas las máquinas con Docker de un servidor. */
export async function scanDockerForServer(serverId: string): Promise<{ added: number; endpoints: number }> {
  const added = await autodetectServer(serverId);
  const guests = db.select({ id: elements.id, status: elements.status }).from(elements)
    .where(and(eq(elements.serverId, serverId), eq(elements.missing, false), inArray(elements.kind, ['vm', 'lxc']))).all();
  const eps = new Map(db.select().from(dockerEndpoints).where(eq(dockerEndpoints.enabled, true)).all().map((r) => [r.elementId, r]));
  let endpoints = 0;
  for (const g of guests) {
    if (!eps.has(g.id)) continue;
    endpoints++;
    if (g.status === 'running') await syncEndpoint(g.id);
    else setChildrenStatus(g.id, 'unknown');
  }
  return { added, endpoints };
}

/** IP de una máquina concreta, preguntando a Proxmox. */
export async function detectIpFor(guestId: string): Promise<string | null> {
  const g = db.select().from(elements).where(eq(elements.id, guestId)).get();
  if (!g || (g.kind !== 'vm' && g.kind !== 'lxc') || !g.parentId) return null;
  const node = db.select().from(elements).where(eq(elements.id, g.parentId)).get();
  const server = db.select().from(servers).where(eq(servers.id, g.serverId)).get();
  if (!node || !server) return null;
  let client: PveClient;
  try { client = new PveClient(connFor(server)); } catch { return null; }
  try { return await guestIp(client, node.externalId, g.kind, g.externalId); } catch { return null; } finally { await client.close(); }
}
