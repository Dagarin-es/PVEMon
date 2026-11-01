/**
 * Recogida periódica de métricas de Proxmox.
 *
 * Una sola llamada a /cluster/resources por servidor y ciclo da CPU, memoria, disco,
 * red y uptime de TODOS los nodos y máquinas: el coste crece con los servidores, no con las máquinas.
 * Se guardan todas las métricas disponibles de los elementos monitorizados; lo que el usuario
 * "active" o "desactive" solo cambia lo que se muestra, así el histórico ya existe si activa algo después.
 */
import type { FastifyBaseLogger } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { MetricsStore, Point } from '../metrics/store.js';
import { maybeRefreshNet } from './guestnet.js';
import { PveClient } from './client.js';
import { observe, serverPoint } from '../alerts/engine.js';
import { cpuTemp } from '../update/service.js';
import { connFor, toStatus } from './discovery.js';
import { maybeRefreshDisks } from './disks.js';

const { servers, elements } = schema;

interface Res {
  type: string; node?: string; vmid?: number; status?: string;
  cpu?: number; mem?: number; maxmem?: number; disk?: number; maxdisk?: number;
  netin?: number; netout?: number; uptime?: number;
  storage?: string; content?: string; shared?: number; plugintype?: string;
}

/* Disco real de las VM con agente invitado (qemu-guest-agent). La llamada puede tardar hasta ~30 s si la VM no tiene agente,
 * así que va aparte, sin frenar el ciclo: se guarda el último resultado y se reintenta cada 5 min si falla. */
interface Fs { used: number; total: number; at: number }
const fsCache = new Map<string, Fs>();
const fsRetry = new Map<string, number>();
const fsBusy = new Set<string>();
const FS_EVERY = 120;

export function sumFs(list: { name?: string; type?: string; mountpoint?: string; 'total-bytes'?: number; 'used-bytes'?: number }[]): { used: number; total: number } | null {
  const seen = new Set<string>(); // btrfs/zfs listan varias veces el mismo dispositivo
  let used = 0, total = 0;
  for (const f of list) {
    const t = f['total-bytes'], u = f['used-bytes'];
    if (!t || u === undefined || /^(tmpfs|devtmpfs|overlay|squashfs|iso9660)$/.test(f.type ?? '')) continue;
    const key = `${f.name ?? f.mountpoint}|${t}`;
    if (seen.has(key)) continue;
    seen.add(key); used += u; total += t;
  }
  return total > 0 ? { used, total } : null;
}

function refreshFs(server: typeof servers.$inferSelect, node: string, vmid: string, elId: string, now: number): void {
  if (fsBusy.has(elId) || (fsRetry.get(elId) ?? 0) > now) return;
  const last = fsCache.get(elId);
  if (last && now - last.at < FS_EVERY) return;
  fsBusy.add(elId);
  void (async () => {
    const c = new PveClient(connFor(server));
    try {
      const r = await c.get<{ result?: Parameters<typeof sumFs>[0] } | Parameters<typeof sumFs>[0]>(`/nodes/${node}/qemu/${vmid}/agent/get-fsinfo`);
      const t = sumFs(Array.isArray(r) ? r : r.result ?? []);
      if (t) fsCache.set(elId, { ...t, at: Math.floor(Date.now() / 1000) });
      else fsRetry.set(elId, now + 300);
    } catch { fsRetry.set(elId, now + 300); fsCache.delete(elId); }
    finally { fsBusy.delete(elId); await c.close().catch(() => undefined); }
  })();
}

// Contadores de red anteriores para calcular bytes/s (Proxmox da el acumulado)
const prevNet = new Map<string, { ts: number; inn: number; out: number }>();

export async function collectServer(server: typeof servers.$inferSelect, store: MetricsStore): Promise<number> {
  const client = new PveClient(connFor(server));
  try {
    const now = Math.floor(Date.now() / 1000);
    const resources = await client.get<Res[]>('/cluster/resources');

    const els = db.select().from(elements)
      .where(and(eq(elements.serverId, server.id), eq(elements.missing, false))).all();
    const byKey = new Map(els.filter((e) => ['node', 'vm', 'lxc'].includes(e.kind)).map((e) => [`${e.kind}|${e.externalId}`, e]));

    const points: Point[] = [];
    const statusChanges: { id: string; status: ReturnType<typeof toStatus> }[] = [];

    for (const r of resources) {
      const kind = r.type === 'node' ? 'node' : r.type === 'qemu' ? 'vm' : r.type === 'lxc' ? 'lxc' : null;
      const ext = r.type === 'node' ? r.node : r.vmid !== undefined ? String(r.vmid) : undefined;
      if (!kind || !ext) continue;
      const el = byKey.get(`${kind}|${ext}`);
      if (!el) continue;

      const status = toStatus(r.status);
      if (status !== el.status) statusChanges.push({ id: el.id, status });
      if (!el.monitored) continue;

      const add = (metricKey: string, value: number | undefined) => {
        if (value !== undefined && Number.isFinite(value)) points.push({ elementId: el.id, metricKey, ts: now, value });
      };
      add('status', status === 'running' ? 1 : 0);
      if (r.cpu !== undefined) add('cpu.usage', r.cpu * 100);
      if (r.maxmem) { add('mem.usage', ((r.mem ?? 0) / r.maxmem) * 100); add('mem.used', r.mem ?? 0); }
      // El disco de una VM no se conoce sin agente invitado: solo nodos y LXC
      if (kind !== 'vm' && r.maxdisk) add('disk.usage', ((r.disk ?? 0) / r.maxdisk) * 100);
      add('uptime', r.uptime);
      if ((kind === 'vm' || kind === 'lxc') && status === 'running' && r.node) maybeRefreshNet(server, r.node, kind, ext, el.id, (el.info as Record<string, unknown>)?.agent, now);
      if (kind === 'vm') {
        if (status === 'running' && r.node) refreshFs(server, r.node, ext, el.id, now);
        const fs = fsCache.get(el.id);
        if (status === 'running' && fs && now - fs.at < 900) { add('disk.fs.used', fs.used); add('disk.fs.total', fs.total); add('disk.usage', (fs.used / fs.total) * 100); }
      }

      if (kind !== 'node' && r.netin !== undefined && r.netout !== undefined) {
        const prev = prevNet.get(el.id);
        prevNet.set(el.id, { ts: now, inn: r.netin, out: r.netout });
        if (prev && now > prev.ts && r.netin >= prev.inn && r.netout >= prev.out) { // si baja, hubo reinicio: se salta
          add('net.in', (r.netin - prev.inn) / (now - prev.ts));
          add('net.out', (r.netout - prev.out) / (now - prev.ts));
        }
      }
    }

    // Almacenamiento donde viven los discos de las máquinas (total y usado real), sumado por nodo
    // Solo discos locales: los almacenamientos de red (NAS por NFS/SMB, PBS, Ceph...) no son el disco de la máquina
    const NET = new Set(['nfs', 'cifs', 'smb', 'pbs', 'iscsi', 'iscsidirect', 'cephfs', 'rbd', 'glusterfs', 'zfs', 'esxi']);
    let types: Map<string, string> | null = null;
    const typeOf = async (r: Res): Promise<string | undefined> => {
      if (r.plugintype) return r.plugintype;
      if (!types) {
        try { types = new Map((await client.get<{ storage: string; type: string }[]>('/storage')).map((x) => [x.storage, x.type])); }
        catch { types = new Map(); }
      }
      return r.storage ? types.get(r.storage) : undefined;
    };
    const seenShared = new Set<string>();
    const store_ = new Map<string, { total: number; used: number }>();
    for (const r of resources) {
      if (r.type !== 'storage' || !r.node || !r.maxdisk || r.status === 'unknown') continue;
      if (!(r.content ?? '').split(',').some((c) => c === 'images' || c === 'rootdir')) continue;
      const t = await typeOf(r);
      if (t && NET.has(t)) continue;
      if (r.shared && r.storage) { if (seenShared.has(r.storage)) continue; seenShared.add(r.storage); }
      const cur = store_.get(r.node) ?? { total: 0, used: 0 };
      cur.total += r.maxdisk; cur.used += r.disk ?? 0;
      store_.set(r.node, cur);
    }
    for (const [node, v] of store_) {
      const el = byKey.get(`node|${node}`);
      if (!el?.monitored) continue;
      points.push({ elementId: el.id, metricKey: 'storage.total', ts: now, value: v.total }, { elementId: el.id, metricKey: 'storage.used', ts: now, value: v.used });
    }

    // Temperatura (por SSH, si el servidor tiene un solo nodo y el acceso SSH está preparado)
    const nodeEls = els.filter((e) => e.kind === 'node' && e.monitored);
    if (nodeEls.length === 1 && nodeEls[0]!.status !== 'stopped') {
      const t = cpuTemp(server);
      if (t !== null) points.push({ elementId: nodeEls[0]!.id, metricKey: 'temp.cpu', ts: now, value: t });
    }

    // Carga media del nodo (una llamada extra por nodo monitorizado y online)
    for (const el of els) {
      if (el.kind !== 'node' || !el.monitored || el.status === 'stopped') continue;
      maybeRefreshDisks(server, el, store, now); // discos: SMART, desgaste y ZFS (cada 30 min, en segundo plano)
      try {
        const st = await client.get<{ loadavg?: string[] }>(`/nodes/${el.externalId}/status`);
        const load = Number(st.loadavg?.[0]);
        if (Number.isFinite(load)) points.push({ elementId: el.id, metricKey: 'load.1m', ts: now, value: load });
      } catch { /* un nodo sin respuesta no debe tirar el ciclo entero */ }
    }

    db.transaction((tx) => {
      for (const c of statusChanges) tx.update(elements).set({ status: c.status }).where(eq(elements.id, c.id)).run();
      tx.update(servers).set({ status: 'online', lastSeenAt: now, lastError: null }).where(eq(servers.id, server.id)).run();
    });
    store.write(points);
    const sp = serverPoint(server.id, true, now);
    void observe(sp ? [...points, sp] : points, now);
    return points.length;
  } finally {
    await client.close();
  }
}

/** Bucle principal: un solo temporizador; cada servidor con su propio intervalo y retroceso si falla. */
export function startCollector(log: FastifyBaseLogger, store: MetricsStore): () => void {
  const due = new Map<string, number>();
  const fails = new Map<string, number>();
  const running = new Set<string>();

  const tick = () => {
    for (const s of db.select().from(servers).all()) {
      if (s.kind === 'mail') continue;
      if (running.has(s.id) || (due.get(s.id) ?? 0) > Date.now()) continue;
      running.add(s.id);
      collectServer(s, store)
        .then(() => {
          if ((fails.get(s.id) ?? 0) > 0) log.info({ server: s.name }, 'recogida de métricas recuperada');
          fails.delete(s.id);
        })
        .catch((err: Error) => {
          const n = (fails.get(s.id) ?? 0) + 1;
          fails.set(s.id, n);
          if (n === 1) log.warn({ server: s.name, err: err.message }, 'recogida de métricas falló'); // solo el primer fallo
          db.update(servers).set({ status: 'offline', lastError: err.message }).where(eq(servers.id, s.id)).run();
          const now = Math.floor(Date.now() / 1000);
          const sp = serverPoint(s.id, false, now);
          if (sp) void observe([sp], now);
        })
        .finally(() => {
          running.delete(s.id);
          const base = Math.max(5, s.pollIntervalSec) * 1000;
          const backoff = 2 ** Math.min(fails.get(s.id) ?? 0, 4); // 1×, 2×, 4×... hasta 16×
          due.set(s.id, Date.now() + Math.min(base * backoff, 5 * 60_000));
        });
    }
  };
  const first = setTimeout(tick, 1000);
  const timer = setInterval(tick, 2000);
  return () => { clearTimeout(first); clearInterval(timer); };
}
