/**
 * Salud de los discos de cada nodo, leída de la API de Proxmox (necesita Sys.Audit, que ya trae PVEAuditor):
 *   /nodes/{n}/disks/list   → modelo, tamaño, tipo, salud SMART y desgaste
 *   /nodes/{n}/disks/smart  → temperatura, horas, sectores pendientes... (por disco)
 *   /nodes/{n}/disks/zfs    → estado de los pools ZFS
 * Se consulta cada 30 min (SMART despierta los discos) y se convierte en métricas del nodo para las alertas.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { observe } from '../alerts/engine.js';
import type { MetricsStore, Point } from '../metrics/store.js';
import { log } from '../log.js';
import { PveClient } from './client.js';
import { connFor } from './discovery.js';
import type { DiskInfo, NodeDisks, PoolInfo } from './disk-data.js';

const EVERY = 30 * 60;
const RETRY = 5 * 60;
const next = new Map<string, number>();
const busy = new Set<string>();

const num = (x: unknown): number | null => { const n = typeof x === 'string' ? Number(x.replace(/[, ]/g, '')) : (x as number); return typeof n === 'number' && Number.isFinite(n) ? n : null; };

interface RawDisk { devpath: string; model?: string; serial?: string; size?: number; type?: string; health?: string; wearout?: number | string }
interface Smart { health?: string; type?: string; text?: string; attributes?: { id: number | string; name?: string; raw?: string | number; value?: number }[] }

export function parseSmart(s: Smart): { temp: number | null; hours: number | null; cycles: number | null; realloc: number | null; pending: number | null; mediaErr: number | null; wearUsed: number | null } {
  const r = { temp: null as number | null, hours: null as number | null, cycles: null as number | null, realloc: null as number | null, pending: null as number | null, mediaErr: null as number | null, wearUsed: null as number | null };
  for (const a of s.attributes ?? []) {
    const id = Number(a.id), raw = num(String(a.raw ?? '').split(/[\s(]/)[0]);
    if ((id === 194 || id === 190) && r.temp === null) r.temp = raw;
    else if (id === 9) r.hours = raw;
    else if (id === 12) r.cycles = raw;
    else if (id === 5) r.realloc = raw;
    else if (id === 197) r.pending = raw;
  }
  const t = s.text ?? '';
  if (t) {
    const g = (re: RegExp) => { const m = re.exec(t); return m ? num(m[1]) : null; };
    r.temp ??= g(/Temperature:\s+(\d+)\s*Celsius/i) ?? g(/Current Drive Temperature:\s+(\d+)/i);
    r.hours ??= g(/Power On Hours:\s+([\d,]+)/i);
    r.cycles ??= g(/Power Cycles:\s+([\d,]+)/i);
    r.mediaErr = g(/Media and Data Integrity Errors:\s+(\d+)/i);
    r.wearUsed = g(/Percentage Used:\s+(\d+)\s*%/i);
  }
  return r;
}

export function judge(d: Pick<DiskInfo, 'health' | 'pending' | 'mediaErr'>): { bad: boolean; why: string | null } {
  if (/fail|bad/i.test(d.health)) return { bad: true, why: 'SMART indica fallo' };
  if ((d.pending ?? 0) > 0) return { bad: true, why: `${d.pending} sectores pendientes de reasignar` };
  if ((d.mediaErr ?? 0) > 0) return { bad: true, why: `${d.mediaErr} errores de medio` };
  return { bad: false, why: null };
}

async function readNode(client: PveClient, node: string): Promise<NodeDisks> {
  const at = Math.floor(Date.now() / 1000);
  let list: RawDisk[];
  try { list = await client.get<RawDisk[]>(`/nodes/${node}/disks/list`); }
  catch (e) {
    const err = e as Error & { status?: number };
    return { disks: [], pools: [], at, error: err.status === 403 ? 'El token no tiene permiso para ver los discos (necesita Sys.Audit en /nodes)' : err.message };
  }
  const disks: DiskInfo[] = [];
  for (const d of list.slice(0, 24)) {
    if (!d.devpath) continue;
    const wearout = num(d.wearout);
    let sm: ReturnType<typeof parseSmart> = { temp: null, hours: null, cycles: null, realloc: null, pending: null, mediaErr: null, wearUsed: null };
    let health = d.health ?? 'UNKNOWN';
    if (d.type !== 'usb') {
      try {
        const s = await client.get<Smart>(`/nodes/${node}/disks/smart?disk=${encodeURIComponent(d.devpath)}`);
        sm = parseSmart(s);
        if (s.health && (health === 'UNKNOWN' || !health)) health = s.health;
      } catch { /* disco sin SMART (virtual, RAID...): se sigue con lo de la lista */ }
    }
    const wear = wearout !== null ? Math.max(0, Math.min(100, 100 - wearout)) : sm.wearUsed;
    const base = { dev: d.devpath, model: d.model ?? '', serial: d.serial ?? '', size: d.size ?? 0, type: d.type ?? 'unknown', health, wear, temp: sm.temp, hours: sm.hours, cycles: sm.cycles, realloc: sm.realloc, pending: sm.pending, mediaErr: sm.mediaErr };
    disks.push({ ...base, ...judge(base) });
  }
  let pools: PoolInfo[] = [];
  try {
    const z = await client.get<{ name: string; health?: string; size?: number; alloc?: number; frag?: number }[]>(`/nodes/${node}/disks/zfs`);
    pools = z.map((p) => ({ name: p.name, health: p.health ?? 'UNKNOWN', size: p.size ?? 0, alloc: p.alloc ?? 0, frag: p.frag ?? null, bad: !!p.health && p.health !== 'ONLINE' }));
  } catch { /* sin ZFS o sin permiso */ }
  return { disks, pools, at, error: null };
}

export function pointsFor(elementId: string, nd: NodeDisks, ts: number): Point[] {
  if (nd.error) return [];
  const pts: Point[] = [{ elementId, metricKey: 'disks.bad', ts, value: nd.disks.filter((d) => d.bad).length + nd.pools.filter((p) => p.bad).length }];
  const wear = nd.disks.map((d) => d.wear).filter((x): x is number => x !== null);
  const temp = nd.disks.map((d) => d.temp).filter((x): x is number => x !== null);
  if (wear.length) pts.push({ elementId, metricKey: 'disks.wear', ts, value: Math.max(...wear) });
  if (temp.length) pts.push({ elementId, metricKey: 'disks.temp', ts, value: Math.max(...temp) });
  return pts;
}

/** Llamado en cada ciclo del colector: solo trabaja cuando toca (cada 30 min por nodo) y sin bloquear el ciclo. */
export function maybeRefreshDisks(server: typeof schema.servers.$inferSelect, el: { id: string; externalId: string }, store: MetricsStore, now: number): void {
  if (busy.has(el.id) || (next.get(el.id) ?? 0) > now) return;
  busy.add(el.id);
  void (async () => {
    const c = new PveClient(connFor(server));
    try {
      const nd = await readNode(c, el.externalId);
      const stored = { disks: nd.disks, pools: nd.pools, error: nd.error };
      db.insert(schema.nodeDisks).values({ elementId: el.id, data: stored, updatedAt: nd.at })
        .onConflictDoUpdate({ target: schema.nodeDisks.elementId, set: { data: stored, updatedAt: nd.at } }).run();
      next.set(el.id, now + (nd.error ? RETRY * 6 : EVERY));
      const pts = pointsFor(el.id, nd, nd.at);
      if (pts.length) { store.write(pts); await observe(pts, nd.at); }
    } catch (e) {
      next.set(el.id, now + RETRY);
      log.warn({ node: el.externalId, err: (e as Error).message }, 'lectura de discos falló');
    } finally { busy.delete(el.id); await c.close().catch(() => undefined); }
  })();
}

export const forgetDisks = (elementId: string) => { db.delete(schema.nodeDisks).where(eq(schema.nodeDisks.elementId, elementId)).run(); next.delete(elementId); };
