/**
 * Estado de las copias de seguridad, leído de la propia API de Proxmox (sin correo ni MQTT):
 *  - la copia más reciente de cada VM/LXC, de los almacenamientos con contenido «backup»
 *  - el resultado del último intento, del registro de las tareas vzdump
 * y comparado con el límite de antigüedad (en horas) de cada servidor.
 */
import type { FastifyBaseLogger } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { BackupState } from '../db/schema.js';
import { observe } from '../alerts/engine.js';
import type { MetricsStore, Point } from '../metrics/store.js';
import { PveClient } from '../proxmox/client.js';
import { connFor } from '../proxmox/discovery.js';

const { servers, elements, backupStatus } = schema;
const INTERVAL_MS = 10 * 60_000;
const TASK_WINDOW_SEC = 20 * 24 * 3600;
const TASKS_PER_NODE = 20;

/* ───────────── lectura del registro de vzdump ───────────── */

export interface Attempt { at: number; ok: boolean; message?: string }

/** Resultado por VMID de una tarea vzdump a partir de su registro. */
const UNIT: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
export function parseVzdumpLog(lines: string[], taskOk: boolean): Map<string, { ok: boolean; message?: string; size?: number }> {
  const res = new Map<string, { ok: boolean; message?: string; size?: number }>();
  const started = new Set<string>();
  const sizes = new Map<string, number>();
  let cur: string | null = null;
  for (const l of lines) {
    let m = /Starting Backup of VM (\d+)/.exec(l);
    if (m) { started.add(m[1]!); cur = m[1]!; continue; }
    // «archive file size: 776MB» (tamaño real del archivo de copia; no sale en PBS)
    m = /archive file size:\s*([\d.,]+)\s*([KMGT]?B)\b/i.exec(l);
    if (m && cur) { const v = Number(m[1]!.replace(',', '.')); if (Number.isFinite(v)) sizes.set(cur, Math.round(v * UNIT[m[2]!.toUpperCase()]!)); continue; }
    m = /Finished Backup of VM (\d+)/.exec(l);
    if (m) { res.set(m[1]!, { ok: true, size: sizes.get(m[1]!) }); continue; }
    m = /ERROR: Backup of VM (\d+) failed - (.*)$/.exec(l);
    if (m) res.set(m[1]!, { ok: false, message: m[2]!.trim() });
  }
  for (const id of started) if (!res.has(id)) res.set(id, taskOk ? { ok: true, size: sizes.get(id) } : { ok: false, message: 'Copia interrumpida o sin terminar' });
  return res;
}

/* ───────────── cálculo del estado ───────────── */

export interface BackupInfo {
  lastOkAt: number | null; lastAttempt: Attempt | null; excluded: boolean; maxHours: number; now: number;
}

export function decide(i: BackupInfo): { state: BackupState; message: string | null } {
  const { lastOkAt, lastAttempt } = i;
  if (lastAttempt && !lastAttempt.ok && lastAttempt.at >= (lastOkAt ?? 0)) {
    return { state: 'error', message: lastAttempt.message ?? 'La última copia falló' };
  }
  if (lastOkAt === null) {
    return i.excluded ? { state: 'excluded', message: 'Sin copia programada' } : { state: 'none', message: 'Todavía no hay ninguna copia' };
  }
  const ageH = (i.now - lastOkAt) / 3600;
  if (ageH > i.maxHours) {
    return { state: 'stale', message: `La última copia tiene ${fmtAge(i.now - lastOkAt)} y el límite es ${fmtAge(i.maxHours * 3600)}` };
  }
  return { state: 'ok', message: null };
}

export function fmtAge(sec: number): string {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600);
  return d ? (h ? `${d} d ${h} h` : `${d} d`) : `${h} h`;
}

/* ───────────── recogida por servidor ───────────── */

interface Res { type: string; node?: string; storage?: string; content?: string; status?: string; shared?: number; disk?: number; maxdisk?: number }
interface Vol { volid: string; ctime?: number; size?: number; vmid?: number | string; content?: string }
interface Task { upid: string; type?: string; status?: string; starttime: number; endtime?: number; node?: string }

/** Uso de los almacenes de copias de cada servidor (se rellena en cada pasada; lo usa el aviso de espacio y el resumen semanal) */
export interface StorageInfo { server: string; node: string; storage: string; used: number; total: number; pct: number }
export const storageUsage = new Map<string, StorageInfo[]>();
/** Almacén de copias más lleno de cada nodo (id del elemento nodo → datos), para explicar la alerta */
export const fullestByNode = new Map<string, StorageInfo>();

const attempts = new Map<string, Map<string, Attempt>>(); // servidor → vmid → último intento
const seenTasks = new Set<string>();
const okSizes = new Map<string, Map<string, { at: number; size: number }>>(); // servidor → vmid → tamaño según el registro de la última copia correcta

export async function checkServerBackups(serverId: string, store: MetricsStore): Promise<{ guests: number; problems: number }> {
  const server = db.select().from(servers).where(eq(servers.id, serverId)).get();
  if (!server || server.kind === 'mail') return { guests: 0, problems: 0 };
  const client = new PveClient(connFor(server));
  const now = Math.floor(Date.now() / 1000);
  try {
    const res = await client.get<Res[]>('/cluster/resources');

    // 1) Copia más reciente por VMID, en cada almacenamiento de copias
    const last = new Map<string, { at: number; size: number; storage: string }>();
    const done = new Set<string>();
    for (const r of res) {
      if (r.type !== 'storage' || !r.storage || !r.node) continue;
      if (!r.content?.split(',').includes('backup') || r.status === 'unknown') continue;
      if (r.shared && done.has(r.storage)) continue; // almacenamiento compartido: basta con un nodo
      done.add(r.storage);
      try {
        const vols = await client.get<Vol[]>(`/nodes/${r.node}/storage/${encodeURIComponent(r.storage)}/content?content=backup`);
        for (const v of vols) {
          if (v.vmid === undefined || !v.ctime) continue;
          const id = String(v.vmid), cur = last.get(id);
          if (!cur || v.ctime > cur.at) last.set(id, { at: v.ctime, size: v.size ?? 0, storage: r.storage });
        }
      } catch { /* un almacenamiento apagado no debe tirar la comprobación */ }
    }

    // 1b) Espacio de los almacenes de copias
    const stor: StorageInfo[] = [];
    for (const r of res) {
      if (r.type !== 'storage' || !r.storage || !r.node || r.status === 'unknown' || !r.content?.split(',').includes('backup') || !r.maxdisk) continue;
      stor.push({ server: server.name, node: r.node, storage: r.storage, used: r.disk ?? 0, total: r.maxdisk, pct: Math.round(1000 * (r.disk ?? 0) / r.maxdisk) / 10 });
    }
    storageUsage.set(serverId, stor);

    // 2) Resultado de las tareas vzdump recientes (las ya leídas no se repiten)
    const att = attempts.get(serverId) ?? new Map<string, Attempt>();
    const osz = okSizes.get(serverId) ?? new Map<string, { at: number; size: number }>();
    okSizes.set(serverId, osz);
    attempts.set(serverId, att);
    for (const n of res.filter((r) => r.type === 'node' && r.status === 'online' && r.node)) {
      let tasks: Task[] = [];
      try {
        tasks = await client.get<Task[]>(`/nodes/${n.node}/tasks?typefilter=vzdump&since=${now - TASK_WINDOW_SEC}&limit=${TASKS_PER_NODE}`);
      } catch { continue; }
      for (const t of tasks.filter((x) => x.endtime && !seenTasks.has(x.upid)).sort((a, b) => a.starttime - b.starttime)) {
        try {
          const log = await client.get<{ t: string }[]>(`/nodes/${n.node}/tasks/${encodeURIComponent(t.upid)}/log?limit=5000`);
          const taskOk = t.status === 'OK' || (t.status ?? '').startsWith('WARNINGS');
          for (const [vmid, o] of parseVzdumpLog(log.map((l) => l.t), taskOk)) {
            const cur = att.get(vmid);
            if (!cur || t.endtime! >= cur.at) att.set(vmid, { at: t.endtime!, ok: o.ok, message: o.message });
            const po = osz.get(vmid);
            if (o.ok && o.size && (!po || t.endtime! >= po.at)) osz.set(vmid, { at: t.endtime!, size: o.size });
          }
          seenTasks.add(t.upid);
        } catch { /* se reintenta en la próxima pasada */ }
      }
    }

    // 3) Máquinas que no están en ningún trabajo de copia (para no darlas por error)
    const excluded = new Set<string>();
    try {
      for (const g of await client.get<{ vmid: number }[]>('/cluster/backup-info/not-backed-up')) excluded.add(String(g.vmid));
    } catch { /* PVE antiguo o sin permiso: se tratan como "sin copias" */ }

    // 4) Estado de cada VM/LXC
    const guests = db.select().from(elements).where(eq(elements.serverId, serverId)).all()
      .filter((e) => (e.kind === 'vm' || e.kind === 'lxc') && !e.missing);
    const points: Point[] = [];
    let problems = 0;
    db.transaction((tx) => {
      for (const g of guests) {
        const l = last.get(g.externalId);
        const a = att.get(g.externalId) ?? null;
        // Si la copia no aparece en el almacenamiento pero el último intento fue bien, se usa su hora
        const lastOkAt = Math.max(l?.at ?? 0, a?.ok ? a.at : 0) || null;
        const { state, message } = decide({ lastOkAt, lastAttempt: a, excluded: excluded.has(g.externalId), maxHours: server.backupMaxHours, now });
        const row = {
          elementId: g.id, serverId, state, lastOkAt, lastOkSize: l?.size || osz.get(g.externalId)?.size || null, lastOkStorage: l?.storage ?? null,
          lastAttemptAt: a?.at ?? null, lastAttemptOk: a?.ok ?? null, message, checkedAt: now,
        };
        tx.insert(backupStatus).values(row).onConflictDoUpdate({ target: backupStatus.elementId, set: row }).run();
        if (state === 'error' || state === 'stale') problems++;
        if (g.monitored && state !== 'excluded' && state !== 'none') {
          points.push({ elementId: g.id, metricKey: 'backup.problem', ts: now, value: state === 'ok' ? 0 : 1 });
          if (lastOkAt) points.push({ elementId: g.id, metricKey: 'backup.age', ts: now, value: now - lastOkAt });
        }
      }
    });
    // Espacio del almacén de copias más lleno de cada nodo (alimenta la alerta «Almacén de copias casi lleno»)
    const nodeEls = db.select().from(elements).where(eq(elements.serverId, serverId)).all().filter((e) => e.kind === 'node' && !e.missing);
    for (const n of nodeEls) {
      const mine = stor.filter((s) => s.node === n.externalId).sort((a, b) => b.pct - a.pct)[0];
      if (!mine) { fullestByNode.delete(n.id); continue; }
      fullestByNode.set(n.id, mine);
      if (n.monitored) points.push({ elementId: n.id, metricKey: 'backup.storage', ts: now, value: mine.pct });
    }
    if (points.length) { store.write(points); void observe(points, now); }
    return { guests: guests.length, problems };
  } finally {
    await client.close();
  }
}

export function startBackupMonitor(log: FastifyBaseLogger, store: MetricsStore): () => void {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      for (const s of db.select({ id: servers.id, name: servers.name, status: servers.status, kind: servers.kind }).from(servers).all()) {
        if (s.status === 'offline' || s.kind === 'mail') continue;
        try { await checkServerBackups(s.id, store); }
        catch (e) { log.warn({ server: s.name, err: (e as Error).message }, 'comprobación de copias falló'); }
      }
    } finally { busy = false; }
  };
  const first = setTimeout(() => void run(), 45_000);
  const timer = setInterval(() => void run(), INTERVAL_MS);
  return () => { clearTimeout(first); clearInterval(timer); };
}
