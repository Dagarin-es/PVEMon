/**
 * Comprobación de un archivo en un disco de red (NFS).
 * Cada comprobación es una «tarea de copia» (elemento 'backup') colgada de un origen, como las de los NAS y las de correo,
 * así que comparte pantalla, límite de antigüedad, alertas y notificaciones con ellas.
 * Es correcta si el archivo existe, pesa al menos el tamaño mínimo (por defecto 1 KB) y se modificó hace menos del límite.
 */
import type { FastifyBaseLogger } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { getSetting, setSetting } from '../alerts/notify.js';
import { observe } from '../alerts/engine.js';
import { decide, fmtAge } from '../backups/collector.js';
import { db, schema } from '../db/index.js';
import { createMailSource } from '../mail/monitor.js';
import type { MetricsStore, Point } from '../metrics/store.js';
import { NfsError, hasWildcard, statNfsFile, statNfsNewest } from './nfs.js';

const { servers, elements, backupStatus } = schema;
const INTERVAL_MS = 5 * 60_000;
const nowSec = () => Math.floor(Date.now() / 1000);

export interface FileCheck { elementId: string; protocol: 'nfs'; host: string; exportPath: string; file: string; minBytes?: number; kind?: 'file' | 'dir' }
export interface CheckInput { name: string; source: string; host: string; exportPath: string; file: string; days?: number; hours?: number; minBytes?: number; kind?: 'file' | 'dir' }

const read = (): FileCheck[] => getSetting<FileCheck[]>('filechecks') ?? [];
const write = (l: FileCheck[]) => setSetting('filechecks', l);

/** Lista las comprobaciones que siguen existiendo (limpia las de elementos borrados) */
export function listChecks(): FileCheck[] {
  const all = read();
  const live = new Set(db.select({ id: elements.id }).from(elements).where(eq(elements.kind, 'backup')).all().map((e) => e.id));
  const keep = all.filter((c) => live.has(c.elementId));
  if (keep.length !== all.length) write(keep);
  return keep;
}

export const cleanHost = (h: string) => h.trim().replace(/^nfs:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
export const cleanExport = (p: string) => { const t = p.trim().replace(/\/+$/, ''); return t.startsWith('/') ? t || '/' : '/' + t; };
export const cleanFile = (f: string) => f.trim().replace(/^\/+/, '').replace(/\/{2,}/g, '/');

export interface Probe { ok: boolean; size?: number; mtime?: number; error?: string; code?: string; name?: string }
/** Último archivo elegido en las comprobaciones de carpeta (solo para mostrarlo) */
export const lastFiles = new Map<string, string>();

export const minOf = (c: Pick<FileCheck, 'minBytes'>) => Math.max(1, c.minBytes ?? 1024);
const fmtBytes = (v: number) => { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (v >= 1024 && i < 4) { v /= 1024; i++; } return `${i ? v.toFixed(1).replace(/\.0$/, '') : v} ${u[i]}`; };

export async function probe(c: Pick<FileCheck, 'host' | 'exportPath' | 'file' | 'minBytes' | 'kind'>): Promise<Probe> {
  try {
    let r: { size: number; mtime: number; name?: string };
    if (c.kind === 'dir') r = await statNfsNewest(c.host, c.exportPath, c.file);
    else if (hasWildcard(c.file)) {
      // «carpeta/copia_*.ics»: se elige el más reciente de los que cumplen el patrón (los comodines solo valen en el nombre del archivo)
      const i = c.file.lastIndexOf('/'), dir = i < 0 ? '' : c.file.slice(0, i), pat = c.file.slice(i + 1);
      if (hasWildcard(dir)) return { ok: false, error: 'Los comodines (* y ?) solo se pueden usar en el nombre del archivo, no en las carpetas', code: 'notfile' };
      r = await statNfsNewest(c.host, c.exportPath, dir, pat);
    } else r = await statNfsFile(c.host, c.exportPath, c.file);
    const name = r.name;
    if (r.size <= 0) return { ok: false, size: 0, mtime: r.mtime, name, error: name ? `El archivo más reciente («${name}») está vacío (0 bytes)` : 'El archivo existe pero está vacío (0 bytes)', code: 'empty' };
    if (r.size < minOf(c)) return { ok: false, size: r.size, mtime: r.mtime, name, error: `${name ? `El archivo más reciente («${name}»)` : 'El archivo'} pesa ${fmtBytes(r.size)} y el mínimo para darlo por bueno es ${fmtBytes(minOf(c))}`, code: 'small' };
    return { ok: true, size: r.size, mtime: r.mtime, name };
  } catch (e) {
    return { ok: false, error: (e as Error).message, code: e instanceof NfsError ? e.code : 'proto' };
  }
}

export function addCheck(i: CheckInput): { error?: string; elementId?: string } {
  const name = i.name.trim(), source = i.source.trim();
  const { server } = createMailSource(source, i.days != null && i.hours != null && i.days * 24 + i.hours >= 1 ? i.days * 24 + i.hours : undefined);
  if (server.kind !== 'mail') return { error: 'Ese nombre de origen no es válido' };
  const dup = db.select().from(elements).where(and(eq(elements.serverId, server.id), eq(elements.kind, 'backup'), eq(elements.externalId, name))).get();
  if (dup) return { error: 'Ya existe una copia con ese nombre en ese origen' };
  const parent = db.select().from(elements).where(and(eq(elements.serverId, server.id), eq(elements.kind, 'server'))).get();
  const id = crypto.randomUUID();
  db.insert(elements).values({
    id, serverId: server.id, parentId: parent?.id ?? null, kind: 'backup', externalId: name, name, status: 'unknown', monitored: true, isNew: false,
    info: { fileCheck: true, protocol: 'nfs' },
  }).run();
  if (i.days != null && i.hours != null && i.days * 24 + i.hours >= 1 && i.days * 24 + i.hours !== server.backupMaxHours) {
    db.insert(backupStatus).values({ elementId: id, serverId: server.id, state: 'none', checkedAt: nowSec(), maxHoursOverride: i.days * 24 + i.hours }).run();
  }
  write([...read(), { elementId: id, protocol: 'nfs', host: cleanHost(i.host), exportPath: cleanExport(i.exportPath), file: cleanFile(i.file), minBytes: Math.max(1, Math.floor(i.minBytes ?? 1024)), kind: i.kind === 'dir' ? 'dir' : 'file' }]);
  return { elementId: id };
}

export interface EditInput { name: string; host: string; exportPath: string; file: string; kind: 'file' | 'dir'; minBytes?: number; days?: number; hours?: number }

/** Cambia cualquier dato de una comprobación ya creada */
export function editCheck(elementId: string, i: EditInput): { error?: string } {
  const all = read();
  const c = all.find((x) => x.elementId === elementId);
  const el = db.select().from(elements).where(eq(elements.id, elementId)).get();
  if (!c || !el) return { error: 'Comprobación no encontrada' };
  const name = i.name.trim();
  const dup = db.select().from(elements).where(and(eq(elements.serverId, el.serverId), eq(elements.kind, 'backup'), eq(elements.externalId, name))).get();
  if (dup && dup.id !== el.id) return { error: 'Ya existe una copia con ese nombre en ese origen' };
  Object.assign(c, { host: cleanHost(i.host), exportPath: cleanExport(i.exportPath), file: cleanFile(i.file), kind: i.kind, minBytes: Math.max(1, Math.floor(i.minBytes ?? c.minBytes ?? 1024)) });
  write(all);
  db.update(elements).set({ name, externalId: name, alias: null }).where(eq(elements.id, el.id)).run();
  if (i.days != null && i.hours != null && i.days * 24 + i.hours >= 1) {
    const h = i.days * 24 + i.hours;
    const srv = db.select().from(servers).where(eq(servers.id, el.serverId)).get();
    const own = h === srv?.backupMaxHours ? null : h;
    const row = db.select().from(backupStatus).where(eq(backupStatus.elementId, el.id)).get();
    if (row) db.update(backupStatus).set({ maxHoursOverride: own }).where(eq(backupStatus.elementId, el.id)).run();
    else db.insert(backupStatus).values({ elementId: el.id, serverId: el.serverId, state: 'none', checkedAt: nowSec(), maxHoursOverride: own }).run();
  }
  lastFiles.delete(el.id);
  return {};
}

export function setMinBytes(elementId: string, minBytes: number): boolean {
  const all = read();
  const c = all.find((x) => x.elementId === elementId);
  if (!c) return false;
  c.minBytes = Math.max(1, Math.floor(minBytes));
  write(all);
  return true;
}

export function removeCheck(elementId: string): void {
  write(read().filter((c) => c.elementId !== elementId));
}

let running = false;

/** Comprueba todas las comprobaciones (o una) y actualiza estado, métricas y alertas */
export async function runChecks(store: MetricsStore, only?: string): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const checks = listChecks().filter((c) => !only || c.elementId === only);
    const now = nowSec();
    const prev = new Map(db.select().from(backupStatus).all().map((b) => [b.elementId, b]));
    const srv = new Map(db.select().from(servers).all().map((s) => [s.id, s]));
    const results = await Promise.all(checks.map(async (c) => ({ c, p: await probe(c) })));
    const points: Point[] = [];
    db.transaction((tx) => {
      for (const { c, p } of results) {
        const el = tx.select().from(elements).where(eq(elements.id, c.elementId)).get();
        if (!el) continue;
        const old = prev.get(el.id);
        const maxHours = old?.maxHoursOverride ?? srv.get(el.serverId)?.backupMaxHours ?? 192;
        if (p.name) lastFiles.set(el.id, p.name); else if (c.kind !== 'dir' && !hasWildcard(c.file)) lastFiles.delete(el.id);
        const lastOkAt = p.ok ? p.mtime! : null;
        let { state, message } = decide({ lastOkAt, lastAttempt: { at: now, ok: p.ok, message: p.error }, excluded: false, maxHours, now });
        if (state === 'stale' && lastOkAt) message = `${p.name ? `El archivo más reciente («${p.name}») se modificó` : 'El archivo se modificó'} hace ${fmtAge(now - lastOkAt)} y el límite es ${fmtAge(maxHours * 3600)}`;
        const row = {
          elementId: el.id, serverId: el.serverId, state, lastOkAt, lastOkSize: p.ok ? p.size! : null, lastOkStorage: `${c.host}:${c.exportPath}`,
          lastAttemptAt: now, lastAttemptOk: p.ok, message, checkedAt: now,
        };
        tx.insert(backupStatus).values(row).onConflictDoUpdate({ target: backupStatus.elementId, set: row }).run();
        tx.update(elements).set({ status: state === 'ok' ? 'running' : 'stopped', lastSeenAt: now, missing: false }).where(eq(elements.id, el.id)).run();
        if (el.monitored) {
          points.push({ elementId: el.id, metricKey: 'backup.problem', ts: now, value: state === 'ok' ? 0 : 1 });
          if (lastOkAt) points.push({ elementId: el.id, metricKey: 'backup.age', ts: now, value: now - lastOkAt });
        }
        tx.update(servers).set({ lastSeenAt: now }).where(eq(servers.id, el.serverId)).run();
      }
    });
    if (points.length) { store.write(points); void observe(points, now); }
    return results.length;
  } finally { running = false; }
}

export function startFileChecks(log: FastifyBaseLogger, store: MetricsStore): () => void {
  const run = () => runChecks(store).catch((e) => log.warn({ err: (e as Error).message }, 'comprobación de archivos falló'));
  const first = setTimeout(() => void run(), 45_000);
  const timer = setInterval(() => void run(), INTERVAL_MS);
  return () => { clearTimeout(first); clearInterval(timer); };
}
