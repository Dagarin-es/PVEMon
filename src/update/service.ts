/**
 * Avisos de actualizaciones pendientes de un servidor Proxmox (SOLO LECTURA: pvemon no instala nada).
 *  - Por SSH (si la clave de pvemon está instalada): apt update + simulación, sin instalar.
 *  - Si no, con la lista que ya tiene Proxmox (API, solo lectura; se refresca sola cada día).
 */
import { and, eq } from 'drizzle-orm';
import { deleteSetting, getSetting, setSetting } from '../alerts/notify.js';
import { db, schema } from '../db/index.js';
import { PveClient } from '../proxmox/client.js';
import { connFor } from '../proxmox/discovery.js';
import { SshError, getPin, removeScript, setupScript, sshExec, type Target } from './ssh.js';

const { servers, elements } = schema;
type Server = typeof servers.$inferSelect;

export interface Pkg { name: string; from?: string; to: string }
export interface UpdateStatus {
  state: 'unknown' | 'uptodate' | 'available'; count: number; packages: Pkg[]; checkedAt: number; source: 'ssh' | 'api';
}
const status = new Map<string, UpdateStatus>();

const nowSec = () => Math.floor(Date.now() / 1000);
const target = (s: Server): Target => ({ serverId: s.id, host: new URL(s.baseUrl).hostname, port: 22 });

const sshOk = (id: string) => getSetting<{ at: number }>(`ssh.ok.${id}`);

/** «Inst pkg [viejo] (nuevo origen …)» → paquetes pendientes */
export function parseInst(out: string): Pkg[] {
  const res: Pkg[] = [];
  for (const l of out.split('\n')) {
    const m = /^Inst (\S+)(?: \[([^\]]+)\])? \((\S+)/.exec(l.trim());
    if (m) res.push({ name: m[1]!, from: m[2], to: m[3]! });
  }
  return res;
}

const mk = (packages: Pkg[], source: 'ssh' | 'api'): UpdateStatus => ({
  state: packages.length ? 'available' : 'uptodate', count: packages.length, packages, checkedAt: nowSec(), source,
});

async function apiCheck(s: Server): Promise<UpdateStatus> {
  const client = new PveClient(connFor(s));
  try {
    const nodes = db.select().from(elements).where(and(eq(elements.serverId, s.id), eq(elements.kind, 'node'), eq(elements.missing, false))).all();
    const seen = new Map<string, Pkg>();
    for (const n of nodes) {
      const list = await client.get<{ Package: string; OldVersion?: string; Version: string }[]>(`/nodes/${n.externalId}/apt/update`);
      for (const p of list) if (!seen.has(p.Package)) seen.set(p.Package, { name: p.Package, from: p.OldVersion, to: p.Version });
    }
    return mk([...seen.values()], 'api');
  } finally { await client.close(); }
}

/** Comprueba por SSH si se puede; si no, por API. Guarda el resultado. */
export async function checkUpdates(s: Server, forceApi = false): Promise<{ status: UpdateStatus; note?: string }> {
  if (!forceApi && sshOk(s.id)) {
    try {
      const r = await sshExec(target(s), 'check', undefined, 180_000);
      const st = mk(parseInst(r.out), 'ssh');
      status.set(s.id, st);
      return { status: st };
    } catch (e) {
      if (!(e instanceof SshError)) throw e;
      // sigue con la API y avisa
      const st = await apiCheck(s).catch(() => null);
      if (st) { status.set(s.id, st); return { status: st, note: e.message }; }
      throw e;
    }
  }
  try {
    const st = await apiCheck(s);
    status.set(s.id, st);
    return { status: st };
  } catch (e) {
    const prev = status.get(s.id);
    if (prev) return { status: prev, note: (e as Error).message };
    throw e;
  }
}

/** Primera prueba de la clave SSH: ejecuta «check» y, si funciona, queda marcada como instalada */
export async function testSsh(s: Server): Promise<UpdateStatus> {
  const r = await sshExec(target(s), 'check', undefined, 180_000);
  setSetting(`ssh.ok.${s.id}`, { at: nowSec() });
  const st = mk(parseInst(r.out), 'ssh');
  status.set(s.id, st);
  return st;
}

/** Último resultado de actualizaciones pendientes de un servidor (null si todavía no se ha comprobado) */
export const cachedUpdates = (serverId: string): UpdateStatus | null => status.get(serverId) ?? null;

export function info(s: Server) {
  return {
    status: status.get(s.id) ?? null,
    ssh: { ready: !!sshOk(s.id), fingerprint: getPin(s.id)?.fp ?? null, host: target(s).host },
    setup: setupScript(),
    remove: removeScript(),
  };
}

/** Olvida el acceso SSH de este nodo en pvemon (la clave del nodo se quita pegando el bloque de «eliminar acceso») */
export function forgetSsh(s: Server): void {
  deleteSetting(`ssh.ok.${s.id}`);
  deleteSetting(`ssh.host.${s.id}`);
  tempCache.delete(s.id);
}

/** Temperatura de la CPU del servidor (solo servidores con un nodo): lee el sensor por SSH con el script de pvemon */
const tempCache = new Map<string, { v: number; at: number }>();
const tempRetry = new Map<string, number>();
const tempBusy = new Set<string>();
export const sshReady = (id: string) => !!sshOk(id);
export function cpuTemp(s: Server): number | null {
  const now = nowSec();
  const c = tempCache.get(s.id);
  if (sshOk(s.id) && !tempBusy.has(s.id) && (tempRetry.get(s.id) ?? 0) <= now && (!c || now - c.at >= 60)) {
    tempBusy.add(s.id);
    void sshExec(target(s), 'temp', undefined, 10_000).then((r) => {
      const m = /CPU (\d+)/.exec(r.out);
      if (m) tempCache.set(s.id, { v: Number(m[1]), at: nowSec() });
      else tempRetry.set(s.id, nowSec() + 600); // script antiguo o sin sensor: se reintenta más tarde
    }).catch(() => tempRetry.set(s.id, nowSec() + 300)).finally(() => tempBusy.delete(s.id));
  }
  return c && now - c.at < 300 ? c.v : null;
}

/** Comprueba las actualizaciones pendientes de cada servidor una vez al arrancar y cada 6 h (solo lectura), para que la API y los avisos tengan el dato sin pulsar nada. */
export function startUpdateWatcher(log: { warn: (o: object, m: string) => void }): () => void {
  const run = async () => {
    for (const s of db.select().from(servers).all()) {
      if (s.kind === 'mail' || s.status === 'offline') continue;
      try { await checkUpdates(s); } catch (e) { log.warn({ server: s.name, err: (e as Error).message }, 'comprobación de actualizaciones falló'); }
    }
  };
  const first = setTimeout(() => void run(), 90_000);
  const t = setInterval(() => void run(), 6 * 3600_000);
  return () => { clearTimeout(first); clearInterval(t); };
}
