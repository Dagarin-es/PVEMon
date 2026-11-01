/**
 * Motor de alertas.
 *
 * Recibe las mediciones que recoge el colector y, por cada regla activa:
 *  - cuando la condición se cumple de forma continuada durante `forSeconds`, abre una alerta y avisa;
 *  - cuando deja de cumplirse durante RESOLVE_AFTER_SEC, la cierra y avisa de la recuperación
 *    (ese margen evita que una métrica que oscila alrededor del umbral genere avisos sin parar);
 *  - si un servidor o nodo está caído, no se abren alertas de lo que cuelga de él: avisa una sola vez del padre.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { and, eq, gt, isNotNull, lte, ne, or } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { log, setLogger } from '../log.js';
import { metricByKey } from '../metrics/catalog.js';
import type { Point } from '../metrics/store.js';
import { fullestByNode } from '../backups/collector.js';
import { describeDisks } from '../proxmox/disk-data.js';
import { activeMaintenance, inMaintenance } from './maintenance.js';
import { dispatch, type AlertNote } from './notify.js';

const { alertRules, alertEvents, elements, servers, backupStatus } = schema;
type Rule = typeof alertRules.$inferSelect;

export const RESOLVE_AFTER_SEC = 60;
const DOWN_METRICS = new Set(['status', 'server.online']);
const ICON = { critical: '🔴', warning: '🟠' } as const;
const KIND: Record<string, string> = { server: 'Nodo', node: 'Nodo', vm: 'VM', lxc: 'LXC', docker: 'Docker', backup: 'Copia' };

interface El { id: string; kind: string; name: string; parentId: string | null; serverId: string; monitored: boolean; missing: boolean }
interface St { ruleId: string; elementId: string; since: number; value: number; firing: boolean; eventId?: string; clearSince?: number }

const states = new Map<string, St>();
const sk = (ruleId: string, elementId: string) => `${ruleId}|${elementId}`;
const nowSec = () => Math.floor(Date.now() / 1000);

/* ───────────── utilidades de formato ───────────── */

export function fmtDur(s: number): string {
  if (s < 90) return `${Math.max(0, Math.round(s))} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${(s / 3600).toFixed(1).replace('.', ',').replace(/,0$/, '')} h`;
  return `${Math.round(s / 86400)} d`;
}

export function describeValue(rule: { metricKey: string }, v: number, elementId?: string): string {
  if (rule.metricKey === 'backup.problem') {
    const b = elementId ? db.select({ m: backupStatus.message }).from(backupStatus).where(eq(backupStatus.elementId, elementId)).get() : null;
    return b?.m ?? 'Copia de seguridad con problema';
  }
  if (rule.metricKey === 'server.online') return 'Sin conexión con el nodo';
  if (rule.metricKey === 'status') return 'Parado o sin respuesta';
  if (rule.metricKey === 'docker.online') return 'Docker no responde (revisa el socket-proxy)';
  if (rule.metricKey === 'docker.down') {
    const names = elementId ? db.select({ n: elements.name, a: elements.alias }).from(elements)
      .where(and(eq(elements.parentId, elementId), eq(elements.kind, 'docker'), eq(elements.monitored, true), eq(elements.missing, false), ne(elements.status, 'running'))).all().map((x) => x.a ?? x.n) : [];
    return `Encendida, pero ${v === 1 ? 'un contenedor está parado' : `${v} contenedores están parados`}${names.length ? ': ' + names.slice(0, 5).join(', ') + (names.length > 5 ? '…' : '') : ''}`;
  }
  if (rule.metricKey === 'backup.storage') {
    const s = elementId ? fullestByNode.get(elementId) : undefined;
    const free = s ? Math.max(0, s.total - s.used) : 0;
    const gb = (b: number) => (b / 1024 ** 3).toLocaleString('es-ES', { maximumFractionDigits: 0 });
    return s ? `El almacén de copias «${s.storage}» está al ${v.toLocaleString('es-ES', { maximumFractionDigits: 1 })} % (quedan ${gb(free)} GB de ${gb(s.total)} GB)` : `Almacén de copias al ${v} %`;
  }
  if (rule.metricKey.startsWith('disks.')) return describeDisks(rule.metricKey, v, elementId);
  if (rule.metricKey === 'health') return 'El contenedor está en mal estado (healthcheck)';
  const def = metricByKey(rule.metricKey);
  const n = v.toLocaleString('es-ES', { maximumFractionDigits: 1 });
  return `${def?.label ?? rule.metricKey}: ${n}${def?.unit === '%' ? ' %' : def?.unit ? ` ${def.unit}` : ''}`;
}

export function pathOf(el: { parentId: string | null }, els: Map<string, { name: string; parentId: string | null }>): string {
  const parts: string[] = [];
  for (let c = el.parentId ? els.get(el.parentId) : undefined, i = 0; c && i < 10; c = c.parentId ? els.get(c.parentId) : undefined, i++) {
    parts.unshift(c.name);
  }
  return parts.join(' › ');
}

/* ───────────── reglas por defecto ───────────── */

/** Reglas que se crean solas la primera vez: cubren lo esencial sin configurar nada. */
export function seedDefaultRules(): void {
  // reglas añadidas después de la primera versión: también en bases de datos que ya existían
  if (db.select({ id: alertRules.id }).from(alertRules).limit(1).get()) {
    db.update(alertRules).set({ name: 'Nodo sin conexión' }).where(or(eq(alertRules.name, 'Servidor sin conexión'), eq(alertRules.name, 'Cluster sin conexión'))).run();
    const extra = [
      { name: 'Máquina encendida con contenedores caídos', metricKey: 'docker.down', operator: '>' as const, threshold: 0, forSeconds: 300, severity: 'warning' as const },
      { name: 'Temperatura alta del nodo', metricKey: 'temp.cpu', operator: '>' as const, threshold: 85, forSeconds: 300, severity: 'warning' as const },
      { name: 'Almacén de copias casi lleno', metricKey: 'backup.storage', operator: '>' as const, threshold: 90, forSeconds: 600, severity: 'warning' as const },
      { name: 'Disco con fallo (SMART o ZFS)', metricKey: 'disks.bad', operator: '>' as const, threshold: 0, forSeconds: 60, severity: 'critical' as const },
      { name: 'Desgaste alto del SSD', metricKey: 'disks.wear', operator: '>' as const, threshold: 90, forSeconds: 60, severity: 'warning' as const },
      { name: 'Disco muy caliente', metricKey: 'disks.temp', operator: '>' as const, threshold: 65, forSeconds: 600, severity: 'warning' as const },
    ];
    for (const r of extra) if (!db.select({ id: alertRules.id }).from(alertRules).where(eq(alertRules.metricKey, r.metricKey)).get()) db.insert(alertRules).values(r).run();
  }
  if (db.select({ id: alertRules.id }).from(alertRules).limit(1).get()) return;
  db.insert(alertRules).values([
    { name: 'Nodo sin conexión', metricKey: 'server.online', operator: '==', threshold: 0, forSeconds: 180, severity: 'critical' },
    { name: 'Parado o sin respuesta', metricKey: 'status', operator: '==', threshold: 0, forSeconds: 120, severity: 'critical' },
    { name: 'Docker sin respuesta', metricKey: 'docker.online', operator: '==', threshold: 0, forSeconds: 180, severity: 'warning' },
    { name: 'Contenedor en mal estado', metricKey: 'health', operator: '==', threshold: 0, forSeconds: 120, severity: 'warning' },
    { name: 'Máquina encendida con contenedores caídos', metricKey: 'docker.down', operator: '>', threshold: 0, forSeconds: 300, severity: 'warning' },
    { name: 'Temperatura alta del nodo', metricKey: 'temp.cpu', operator: '>', threshold: 85, forSeconds: 300, severity: 'warning' },
    { name: 'Copia de seguridad con problema', metricKey: 'backup.problem', operator: '==', threshold: 1, forSeconds: 60, severity: 'critical' },
    { name: 'CPU alta', metricKey: 'cpu.usage', operator: '>', threshold: 90, forSeconds: 300, severity: 'warning' },
    // Las VMs quedan fuera: Proxmox cuenta la caché del invitado como memoria usada y daría falsas alarmas
    { name: 'Memoria alta (LXC)', elementKind: 'lxc', metricKey: 'mem.usage', operator: '>', threshold: 90, forSeconds: 300, severity: 'warning' },
    { name: 'Memoria alta (nodo)', elementKind: 'node', metricKey: 'mem.usage', operator: '>', threshold: 90, forSeconds: 300, severity: 'warning' },
    { name: 'Disco casi lleno', metricKey: 'disk.usage', operator: '>', threshold: 90, forSeconds: 600, severity: 'critical' },
    { name: 'Almacén de copias casi lleno', metricKey: 'backup.storage', operator: '>', threshold: 90, forSeconds: 600, severity: 'warning' },
    { name: 'Disco con fallo (SMART o ZFS)', metricKey: 'disks.bad', operator: '>', threshold: 0, forSeconds: 60, severity: 'critical' },
    { name: 'Desgaste alto del SSD', metricKey: 'disks.wear', operator: '>', threshold: 90, forSeconds: 60, severity: 'warning' },
    { name: 'Disco muy caliente', metricKey: 'disks.temp', operator: '>', threshold: 65, forSeconds: 600, severity: 'warning' },
  ]).run();
}

/** Al reiniciar la app se recuerdan las alertas abiertas, para no volver a avisar de ellas. */
export function loadState(): void {
  states.clear();
  for (const ev of db.select().from(alertEvents).where(eq(alertEvents.state, 'firing')).all()) {
    states.set(sk(ev.ruleId, ev.elementId), {
      ruleId: ev.ruleId, elementId: ev.elementId, since: ev.startedAt,
      value: Number(ev.value) || 0, firing: true, eventId: ev.id,
    });
  }
}

/* ───────────── evaluación ───────────── */

const loadElements = (): Map<string, El> =>
  new Map(db.select({
    id: elements.id, kind: elements.kind, name: elements.name, alias: elements.alias, parentId: elements.parentId,
    serverId: elements.serverId, monitored: elements.monitored, missing: elements.missing,
  }).from(elements).all().map(({ alias, ...e }) => [e.id, { ...e, name: alias ?? e.name }]));

function matches(rule: Rule, el: El): boolean {
  if (rule.elementId) return rule.elementId === el.id;
  if (rule.elementKind) return rule.elementKind === el.kind;
  if (rule.metricKey === 'server.online') return el.kind === 'server';
  const def = metricByKey(rule.metricKey);
  return !!def && (def.appliesTo as string[]).includes(el.kind);
}

const cmp = (op: Rule['operator'], v: number, t: number) => (op === '>' ? v > t : op === '<' ? v < t : v === t);

/** Punto "el servidor responde / no responde" para alimentar la regla de servidor sin conexión. */
export function serverPoint(serverId: string, online: boolean, ts: number): Point | null {
  const el = db.select({ id: elements.id }).from(elements)
    .where(and(eq(elements.serverId, serverId), eq(elements.kind, 'server'))).get();
  return el ? { elementId: el.id, metricKey: 'server.online', ts, value: online ? 1 : 0 } : null;
}

/** Punto de entrada: el colector llama aquí tras cada ciclo. Nunca lanza. */
export async function observe(points: Point[], now = nowSec()): Promise<void> {
  try {
    const rules = db.select().from(alertRules).where(eq(alertRules.enabled, true)).all();
    if (rules.length > 0 && points.length > 0) {
      const els = loadElements();
      for (const p of points) {
        const el = els.get(p.elementId);
        if (!el) continue;
        for (const rule of rules) {
          if (rule.metricKey !== p.metricKey || !matches(rule, el)) continue;
          const key = sk(rule.id, el.id);
          const st = states.get(key);
          if (cmp(rule.operator, p.value, rule.threshold)) {
            if (st) { st.value = p.value; st.clearSince = undefined; }
            else states.set(key, { ruleId: rule.id, elementId: el.id, since: now, value: p.value, firing: false });
          } else if (st) {
            st.value = p.value;
            if (!st.firing) states.delete(key); // ya no se cumple y aún no había saltado: falsa alarma
            else st.clearSince ??= now;
          }
        }
      }
    }
    await settle(now);
  } catch (e) {
    log.error({ err: (e as Error).message }, 'evaluación de alertas falló');
  }
}

let chain: Promise<void> = Promise.resolve();

/** Abre y cierra alertas según el tiempo transcurrido. Se serializa para no avisar dos veces. */
export function settle(now = nowSec()): Promise<void> {
  chain = chain.then(() => doSettle(now)).catch((e) => log.error({ err: (e as Error).message }, 'alertas: settle falló'));
  return chain;
}

async function doSettle(now: number): Promise<void> {
  if (states.size === 0) return;
  const rules = new Map(db.select().from(alertRules).all().map((r) => [r.id, r]));
  const els = loadElements();
  const lastErr = new Map(db.select({ id: servers.id, e: servers.lastError }).from(servers).all().map((s) => [s.id, s.e]));

  const depth = (el: El) => { let d = 0; for (let c: El | undefined = el; c?.parentId && d < 10; d++) c = els.get(c.parentId); return d; };
  const maint = activeMaintenance();
  const down = new Set<string>(); // elementos con una alerta de "caído" abierta
  for (const st of states.values()) {
    const r = rules.get(st.ruleId);
    if (st.firing && r && DOWN_METRICS.has(r.metricKey)) down.add(st.elementId);
  }
  const ancestorDown = (el: El) => {
    for (let c = el.parentId ? els.get(el.parentId) : undefined, i = 0; c && i < 10; c = c.parentId ? els.get(c.parentId) : undefined, i++) {
      if (down.has(c.id)) return true;
    }
    return false;
  };

  const mk = (kind: 'firing' | 'resolved', rule: Rule, el: El, st: St, eventId: string): AlertNote => {
    const base = `${el.name} (${KIND[el.kind] ?? el.kind}): ${rule.name}`;
    let text: string;
    if (kind === 'firing') {
      const err = rule.metricKey === 'server.online' ? lastErr.get(el.serverId) : null;
      text = `${describeValue(rule, st.value, el.id)} · desde hace ${fmtDur(now - st.since)}${err ? ` (${err})` : ''}`;
    } else {
      text = `Recuperado tras ${fmtDur(now - st.since)}`;
    }
    return {
      eventId, tag: `${el.id}|${rule.id}`, state: kind, severity: rule.severity, elementId: el.id,
      title: kind === 'firing' ? `${ICON[rule.severity]} ${base}` : `✅ ${base} · resuelto`,
      text, path: pathOf(el, els),
    };
  };

  const notes: AlertNote[] = [];
  // Alertas pospuestas: mientras dura el aplazamiento no avisan; al terminar, si siguen abiertas, avisan de nuevo
  const snooze = new Map(db.select({ id: alertEvents.id, until: alertEvents.snoozedUntil }).from(alertEvents)
    .where(and(eq(alertEvents.state, 'firing'), isNotNull(alertEvents.snoozedUntil))).all().map((e) => [e.id, e.until ?? 0]));
  const entries = [...states.entries()]
    .map(([key, st]) => ({ key, st, el: els.get(st.elementId) }))
    .sort((a, b) => (a.el ? depth(a.el) : 99) - (b.el ? depth(b.el) : 99)); // primero los padres

  for (const { key, st, el } of entries) {
    const rule = rules.get(st.ruleId);
    if (!rule || !rule.enabled || !el || !el.monitored || el.missing || !matches(rule, el)) {
      // La regla ya no existe/está desactivada o el elemento deja de monitorizarse: se cierra sin avisar
      if (st.firing && st.eventId) db.update(alertEvents).set({ state: 'resolved', resolvedAt: now }).where(eq(alertEvents.id, st.eventId)).run();
      states.delete(key);
      continue;
    }
    if (inMaintenance(el, els, maint)) {
      // En mantenimiento: no se abren alertas nuevas y las abiertas se cierran sin avisar cuando se recuperan
      if (!st.firing) { st.since = now; continue; }
      if (st.clearSince !== undefined && now - st.clearSince >= RESOLVE_AFTER_SEC) {
        if (st.eventId) db.update(alertEvents).set({ state: 'resolved', resolvedAt: now }).where(eq(alertEvents.id, st.eventId)).run();
        states.delete(key);
        if (DOWN_METRICS.has(rule.metricKey)) down.delete(el.id);
      }
      continue;
    }
    if (!st.firing) {
      if (now - st.since < rule.forSeconds) continue;
      if (ancestorDown(el)) { st.since = now; continue; } // lo cubre el aviso del padre
      const id = randomUUID();
      // si ya estaba pospuesta (la alerta rebotó), la nueva hereda el aplazamiento y no avisa
      const prev = db.select({ u: alertEvents.snoozedUntil }).from(alertEvents)
        .where(and(eq(alertEvents.ruleId, rule.id), eq(alertEvents.elementId, el.id), gt(alertEvents.snoozedUntil, now))).get();
      db.insert(alertEvents).values({ id, ruleId: rule.id, elementId: el.id, state: 'firing', value: String(st.value), startedAt: now, snoozedUntil: prev?.u ?? null }).run();
      st.firing = true; st.eventId = id; st.clearSince = undefined;
      if (DOWN_METRICS.has(rule.metricKey)) down.add(el.id);
      if (!prev) notes.push(mk('firing', rule, el, st, id));
    } else if (st.clearSince !== undefined && now - st.clearSince >= RESOLVE_AFTER_SEC) {
      if (st.eventId) db.update(alertEvents).set({ state: 'resolved', resolvedAt: now }).where(eq(alertEvents.id, st.eventId)).run();
      if (!((snooze.get(st.eventId ?? '') ?? 0) > now)) notes.push(mk('resolved', rule, el, st, st.eventId ?? ''));
      states.delete(key);
      if (DOWN_METRICS.has(rule.metricKey)) down.delete(el.id);
    }
  }

  // Fin del aplazamiento de alertas que siguen abiertas: se vuelve a avisar
  for (const e of db.select().from(alertEvents).where(and(eq(alertEvents.state, 'firing'), isNotNull(alertEvents.snoozedUntil), lte(alertEvents.snoozedUntil, now))).all()) {
    db.update(alertEvents).set({ snoozedUntil: null }).where(eq(alertEvents.id, e.id)).run();
    const st = states.get(sk(e.ruleId, e.elementId)), rule = rules.get(e.ruleId), el = els.get(e.elementId);
    if (st?.firing && rule && el) { const n = mk('firing', rule, el, st, e.id); notes.push({ ...n, title: '⏰ ' + n.title.replace(/^\S+ /, '') + ' · sigue activo' }); }
  }

  if (notes.length > 0) {
    await dispatch(notes);
    for (const n of notes) {
      if (n.eventId) db.update(alertEvents).set({ notifiedAt: now }).where(eq(alertEvents.id, n.eventId)).run();
    }
  }
}

/** Arranque: reglas por defecto, estado previo y un barrido cada 10 s (para las alertas que maduran con el tiempo). */
export function startAlerts(logger: FastifyBaseLogger): () => void {
  setLogger(logger);
  seedDefaultRules();
  loadState();
  const t = setInterval(() => void settle(), 10_000);
  return () => clearInterval(t);
}
