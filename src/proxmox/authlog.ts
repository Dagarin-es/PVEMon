/**
 * Accesos fallidos a Proxmox, leídos del registro del nodo por la API (servicio pvedaemon):
 *   «pvedaemon[123]: authentication failure; rhost=::ffff:1.2.3.4 user=root@pam msg=Authentication failure»
 * Se consulta cada 5 min por nodo. Necesita el permiso Sys.Syslog en /nodes (PVEAuditor NO lo trae: hay que crear un rol de solo
 * lectura que lo incluya). Se guardan en memoria los eventos de las últimas 24 h; tras un reinicio se recuperan de nuevo del registro.
 * Métricas del nodo: auth.fail (últimas 24 h) y auth.fail.recent (últimos 15 min), esta última alimenta la alerta.
 */
import { observe } from '../alerts/engine.js';
import type { MetricsStore, Point } from '../metrics/store.js';
import { log } from '../log.js';
import { PveClient } from './client.js';
import { connFor } from './discovery.js';
import type { schema } from '../db/index.js';

export interface AuthEvent { ts: number; ip: string; user: string; msg: string }
interface NodeAuth { events: AuthEvent[]; until: number | null; lastLines: Set<string>; at: number | null; error: string | null }

const EVERY = 5 * 60;
const RETRY = 10 * 60;
const DAY = 86400;
const RECENT = 15 * 60;
const next = new Map<string, number>();
const busy = new Set<string>();
const state = new Map<string, NodeAuth>();

const RE = /authentication (?:verification )?failure; rhost=(\S+) user=(\S+) msg=(.*)$/i;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Extrae los accesos fallidos de las líneas del registro (cadenas del journal o {n,t} del syslog). */
export function parseAuthLines(lines: unknown[], fallbackTs: number, backfill = false): AuthEvent[] {
  const out: AuthEvent[] = [];
  for (const l of lines) {
    const line = typeof l === 'string' ? l : typeof (l as { t?: unknown })?.t === 'string' ? (l as { t: string }).t : '';
    const m = RE.exec(line);
    if (!m) continue;
    let ts = fallbackTs;
    if (backfill) { // en la carga inicial cada línea lleva su fecha («Nov 15 09:12:33», sin año)
      const d = /^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d\d):(\d\d):(\d\d)/.exec(line);
      const mi = d ? MONTHS.indexOf(d[1]!) : -1;
      if (d && mi >= 0) {
        const y = new Date(fallbackTs * 1000).getFullYear();
        let t = Math.floor(new Date(y, mi, Number(d[2]), Number(d[3]), Number(d[4]), Number(d[5])).getTime() / 1000);
        if (t > fallbackTs + DAY) t = Math.floor(new Date(y - 1, mi, Number(d[2]), Number(d[3]), Number(d[4]), Number(d[5])).getTime() / 1000);
        ts = Math.min(fallbackTs, Math.max(fallbackTs - DAY, t));
      }
    }
    out.push({ ts, ip: m[1]!.replace(/^::ffff:/i, '').slice(0, 64), user: m[2]!.slice(0, 64), msg: m[3]!.trim().slice(0, 120) });
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');
const fmtDate = (s: number) => { const d = new Date(s * 1000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

async function readLines(c: PveClient, node: string, since: number, until: number): Promise<unknown[]> {
  try { return await c.get<unknown[]>(`/nodes/${node}/journal?since=${since}&until=${until}`); }
  catch (e) {
    const st = (e as { status?: number }).status;
    if (st === 403 || st === 401) throw e;
  }
  return c.get<unknown[]>(`/nodes/${node}/syslog?service=pvedaemon&limit=5000&since=${encodeURIComponent(fmtDate(since))}&until=${encodeURIComponent(fmtDate(until))}`);
}

export function authSummary(elementId: string, now = Math.floor(Date.now() / 1000)) {
  const s = state.get(elementId);
  if (!s) return null;
  const ev = s.events.filter((e) => e.ts >= now - DAY);
  const byIp = new Map<string, { ip: string; count: number; users: Set<string>; last: number }>();
  for (const e of ev) {
    const x = byIp.get(e.ip) ?? { ip: e.ip, count: 0, users: new Set<string>(), last: 0 };
    x.count++; x.users.add(e.user); x.last = Math.max(x.last, e.ts); byIp.set(e.ip, x);
  }
  return {
    at: s.at, error: s.error, count24h: ev.length, recent: ev.filter((e) => e.ts >= now - RECENT).length,
    top: [...byIp.values()].sort((a, b) => b.count - a.count || b.last - a.last).slice(0, 5).map((x) => ({ ip: x.ip, count: x.count, users: [...x.users].slice(0, 3), last: x.last })),
    last: ev.slice(-8).reverse(),
  };
}

/** Texto de la alerta: cuántos fallos y desde qué IP. */
export function describeAuth(v: number, elementId?: string): string {
  const s = elementId ? authSummary(elementId) : null;
  const top = s?.top[0];
  const who = top ? `${top.ip} (${top.users.join(', ')})` : '';
  if (v === 1) return top ? `1 acceso fallido a Proxmox en los últimos 15 min · más activa: ${who}` : '1 acceso fallido a Proxmox en los últimos 15 min';
  return top ? `${v} accesos fallidos a Proxmox en los últimos 15 min · más activa: ${who}` : `${v} accesos fallidos a Proxmox en los últimos 15 min`;
}

export function pointsFor(elementId: string, now: number): Point[] {
  const s = authSummary(elementId, now);
  return s ? [{ elementId, metricKey: 'auth.fail', ts: now, value: s.count24h }, { elementId, metricKey: 'auth.fail.recent', ts: now, value: s.recent }] : [];
}

/** Llamado en cada ciclo del colector: solo trabaja cuando toca (cada 5 min por nodo) y sin bloquear el ciclo. */
export function maybeRefreshAuth(server: typeof schema.servers.$inferSelect, el: { id: string; externalId: string }, store: MetricsStore, now: number): void {
  if (busy.has(el.id) || (next.get(el.id) ?? 0) > now) return;
  busy.add(el.id);
  void (async () => {
    const c = new PveClient(connFor(server));
    const st = state.get(el.id) ?? { events: [], until: null, lastLines: new Set<string>(), at: null, error: null };
    state.set(el.id, st);
    try {
      const first = st.until === null;
      const since = first ? now - DAY : st.until!;
      const lines = await readLines(c, el.externalId, since, now);
      const fresh = (Array.isArray(lines) ? lines : []).filter((l) => { const k = typeof l === 'string' ? l : JSON.stringify(l); return !st.lastLines.has(k); });
      st.lastLines = new Set((Array.isArray(lines) ? lines : []).map((l) => (typeof l === 'string' ? l : JSON.stringify(l))));
      st.events = [...st.events, ...parseAuthLines(fresh, now, first)].filter((e) => e.ts >= now - DAY).slice(-2000);
      st.until = now; st.at = now; st.error = null;
      next.set(el.id, now + EVERY);
      const pts = pointsFor(el.id, now);
      if (pts.length) { store.write(pts); await observe(pts, now); }
    } catch (e) {
      const err = e as Error & { status?: number };
      st.error = err.status === 403 ? 'El token no tiene permiso para leer el registro del nodo (necesita Sys.Syslog en /nodes)' : err.message;
      st.at = now;
      next.set(el.id, now + RETRY);
      if (err.status !== 403) log.warn({ node: el.externalId, err: err.message }, 'lectura de accesos fallidos falló');
    } finally { busy.delete(el.id); await c.close().catch(() => undefined); }
  })();
}

