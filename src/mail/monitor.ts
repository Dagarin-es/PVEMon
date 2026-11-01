/**
 * Copias de seguridad por correo.
 * Cada «origen» (un NAS, un PC…) es un pseudo-servidor de tipo 'mail'; cada tarea de copia, un elemento 'backup'
 * hijo suyo que se crea solo al llegar su primer correo. El estado se calcula con las mismas reglas que las copias de Proxmox.
 */
import type { FastifyBaseLogger } from 'fastify';
import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import { getSetting, setSetting } from '../alerts/notify.js';
import { observe } from '../alerts/engine.js';
import { decide } from '../backups/collector.js';
import { decrypt, encrypt } from '../crypto.js';
import { db, schema } from '../db/index.js';
import type { MetricsStore, Point } from '../metrics/store.js';
import { getFetcher, type ImapConfig } from './imap.js';
import { parseMail, type CustomFormat, type Parsed } from './parse.js';

const { servers, elements, backupStatus, mailEvents } = schema;
const INTERVAL_MS = 5 * 60_000;
const KEEP_DAYS = 90;
const nowSec = () => Math.floor(Date.now() / 1000);

/* ───────────── ajustes ───────────── */

interface ImapStored {
  host: string; port: number; secure: boolean; user: string; passwordEnc: string;
  /** carpeta donde llegan los correos de copias y carpeta a la que se mueven una vez procesados */
  inFolder: string; doneFolder: string; moveDone: boolean;
  /** carpeta a la que se mueven (sin marcar como leídos) los correos de remitentes excluidos; vacía = no se mueven */
  excludedFolder: string;
  lookbackDays: number; enabled: boolean;
}
const DEFAULT_IMAP: ImapStored = {
  host: '', port: 993, secure: true, user: '', passwordEnc: '', inFolder: 'Alertas', doneFolder: 'Alertas/Procesados', moveDone: false, excludedFolder: '', lookbackDays: 60, enabled: false,
};
const readImap = (): ImapStored => {
  const raw = getSetting<Partial<ImapStored> & { folders?: string[] }>('mail.imap') ?? {};
  // Ajustes anteriores a la 1.1: una lista de carpetas (la primera era la de entrada, la segunda la de procesados)
  const legacy = raw.folders ?? [];
  return { ...DEFAULT_IMAP, ...raw, inFolder: raw.inFolder ?? legacy[0] ?? DEFAULT_IMAP.inFolder, doneFolder: raw.doneFolder ?? legacy[1] ?? DEFAULT_IMAP.doneFolder };
};

/** Una cuenta de correo (un buzón IMAP) de la que se leen avisos de copias. */
export interface MailAccount extends ImapStored { id: string; name: string }

/** Lista de cuentas. La primera vez migra la cuenta única de versiones anteriores (se deja intacta «mail.imap» por si se vuelve atrás). */
export function readAccounts(): MailAccount[] {
  const list = getSetting<MailAccount[]>('mail.accounts');
  if (Array.isArray(list)) return list.map((a) => ({ ...DEFAULT_IMAP, ...a }));
  const old = readImap();
  if (!old.host && !old.user) return [];
  const acc: MailAccount = { ...old, id: crypto.randomUUID(), name: old.user || old.host };
  setSetting('mail.accounts', [acc]);
  return [acc];
}
const writeAccounts = (l: MailAccount[]): void => setSetting('mail.accounts', l);

export function getAccountsView() {
  return readAccounts().map((c) => ({
    id: c.id, name: c.name, host: c.host, port: c.port, secure: c.secure, user: c.user, hasPassword: !!c.passwordEnc,
    inFolder: c.inFolder, doneFolder: c.doneFolder, excludedFolder: c.excludedFolder, moveDone: c.moveDone, lookbackDays: c.lookbackDays, enabled: c.enabled,
    poll: lastPolls.get(c.id) ?? null,
  }));
}

export interface ImapInput {
  host: string; port: number; secure: boolean; user: string; password?: string;
  inFolder: string; doneFolder: string; excludedFolder?: string; moveDone: boolean; lookbackDays: number; enabled: boolean;
}
export interface AccountInput extends ImapInput { name?: string }

/** Crea (sin id) o modifica (con id) una cuenta. Si la contraseña viene vacía en una modificación, se conserva la anterior. */
export function saveAccount(i: AccountInput, id?: string): string {
  const all = readAccounts();
  const prev = id ? all.find((a) => a.id === id) : undefined;
  if (id && !prev) throw new Error('Cuenta no encontrada');
  const acc: MailAccount = {
    id: prev?.id ?? crypto.randomUUID(), name: (i.name?.trim() || i.user || i.host).slice(0, 80),
    host: i.host, port: i.port, secure: i.secure, user: i.user,
    passwordEnc: i.password ? encrypt(i.password) : prev?.passwordEnc ?? '',
    inFolder: i.inFolder, doneFolder: i.doneFolder, excludedFolder: i.excludedFolder ?? '', moveDone: i.moveDone, lookbackDays: i.lookbackDays, enabled: i.enabled,
  };
  writeAccounts(prev ? all.map((a) => (a.id === prev.id ? acc : a)) : [...all, acc]);
  return acc.id;
}

export function deleteAccount(id: string): boolean {
  const all = readAccounts();
  if (!all.some((a) => a.id === id)) return false;
  writeAccounts(all.filter((a) => a.id !== id));
  lastPolls.delete(id);
  return true;
}

/** Datos de conexión de una cuenta (con la contraseña descifrada) o de los valores sueltos del formulario; null si falta algo. */
export function imapConn(accountId?: string, over?: Partial<ImapInput>): ImapConfig | null {
  const c = accountId ? readAccounts().find((a) => a.id === accountId) : undefined;
  const password = over?.password || (c?.passwordEnc ? decrypt(c.passwordEnc) : '');
  const cfg = {
    host: over?.host ?? c?.host ?? '', port: over?.port ?? c?.port ?? 993, secure: over?.secure ?? c?.secure ?? true, user: over?.user ?? c?.user ?? '', password,
  };
  return cfg.host && cfg.user && cfg.password ? cfg : null;
}

export const getFormats = (): CustomFormat[] => getSetting<CustomFormat[]>('mail.formats') ?? [];
export const setFormats = (f: CustomFormat[]): void => setSetting('mail.formats', f);
/* Remitentes excluidos: si el «De» del correo contiene alguno de estos textos, no se procesa */
export const getExcluded = (): string[] => getSetting<string[]>('mail.excludedSenders') ?? [];
export const isExcluded = (from: string): boolean => {
  const f = from.toLowerCase();
  return getExcluded().some((x) => x && f.includes(x.toLowerCase()));
};
/** Guarda la lista y retira lo ya procesado de esos remitentes (y lo anterior sin remitente, que se vuelve a leer). */
export function setExcluded(list: string[]): void {
  const clean = [...new Set(list.map((x) => x.trim()).filter(Boolean))];
  setSetting('mail.excludedSenders', clean);
  const rows = db.select({ id: mailEvents.id, s: mailEvents.sender, el: mailEvents.elementId }).from(mailEvents).all();
  const drop = rows.filter((r) => r.s === null || clean.some((x) => r.s!.toLowerCase().includes(x.toLowerCase())));
  db.transaction((tx) => {
    for (const r of drop) tx.delete(mailEvents).where(eq(mailEvents.id, r.id)).run();
    for (const el of new Set(drop.map((r) => r.el))) {
      if (!tx.select({ id: mailEvents.id }).from(mailEvents).where(eq(mailEvents.elementId, el)).get()) tx.delete(elements).where(eq(elements.id, el)).run();
    }
  });
  cache.clear();
}

const getIgnored = (): string[] => getSetting<string[]>('mail.ignored') ?? [];
export const ignoreTask = (serverId: string, task: string): void => {
  const k = `${serverId}|${task.toLowerCase()}`;
  const cur = getIgnored();
  if (!cur.includes(k)) setSetting('mail.ignored', [...cur, k]);
};

/* ───────────── orígenes (NAS) ───────────── */

const norm = (s: string) => s.trim().toLowerCase();

export function mailSources() {
  return db.select().from(servers).where(eq(servers.kind, 'mail')).all();
}

export function createMailSource(name: string, backupMaxHours?: number) {
  const clean = name.trim();
  const exists = mailSources().find((s) => norm(s.name) === norm(clean));
  if (exists) return { server: exists, created: false };
  const id = crypto.randomUUID();
  db.transaction((tx) => {
    tx.insert(servers).values({
      id, name: clean, baseUrl: `mail://${encodeURIComponent(clean)}`, tokenId: 'mail', tokenSecretEnc: encrypt('mail'),
      status: 'online', kind: 'mail', source: 'manual', lastSeenAt: nowSec(),
      ...(backupMaxHours ? { backupMaxHours } : {}),
    }).run();
    tx.insert(elements).values({
      serverId: id, parentId: null, kind: 'server', externalId: id, name: clean, status: 'running', monitored: true, isNew: false, info: { mail: true },
    }).run();
  });
  return { server: db.select().from(servers).where(eq(servers.id, id)).get()!, created: true };
}

/* ───────────── estado en memoria ───────────── */

type Entry = { kind: 'parsed'; parsed: Parsed; from: string } | { kind: 'ignored'; why?: 'excluded' | 'type'; subject?: string } | { kind: 'unknown'; subject: string; from: string; date: number };
const cache = new Map<string, Entry>();

export interface PollInfo { at: number; ok: boolean; error: string | null; seen: number; fetched: number; missingFolders: string[]; moved?: number; moveError?: string | null; notMoved?: number; movedExcluded?: number; notMovedList?: { subject: string; why: 'unknown' | 'excluded' | 'type' | 'source' | 'unseen'; source?: string }[] }
let lastPoll: PollInfo | null = null;
const lastPolls = new Map<string, PollInfo>(); // última consulta de cada cuenta
let polling = false;
export const isPolling = () => polling;
export const getLastPoll = () => lastPoll;

export function pendingSources() {
  const known = new Set(mailSources().map((s) => norm(s.name)));
  const out = new Map<string, { name: string; tasks: Map<string, { ok: boolean; at: number }>; last: number; count: number }>();
  for (const e of cache.values()) {
    if (e.kind !== 'parsed' || known.has(norm(e.parsed.source))) continue;
    const key = norm(e.parsed.source);
    const o = out.get(key) ?? { name: e.parsed.source, tasks: new Map(), last: 0, count: 0 };
    o.count++; o.last = Math.max(o.last, e.parsed.at);
    const t = o.tasks.get(e.parsed.task);
    if (!t || e.parsed.at > t.at) o.tasks.set(e.parsed.task, { ok: e.parsed.ok, at: e.parsed.at });
    out.set(key, o);
  }
  return [...out.values()].sort((a, b) => b.last - a.last)
    .map((o) => ({ name: o.name, count: o.count, lastAt: o.last, tasks: [...o.tasks].map(([task, v]) => ({ task, ...v })) }));
}

export function unrecognized() {
  return [...cache.entries()].flatMap(([id, e]) => (e.kind === 'unknown' ? [{ id, subject: e.subject, from: e.from, date: e.date }] : []))
    .sort((a, b) => b.date - a.date).slice(0, 30);
}

/* ───────────── aplicar correos y evaluar ───────────── */

/** Pasa a la BD los correos de orígenes ya dados de alta (idempotente). */
export function applyCache(): number {
  const src = new Map(mailSources().map((s) => [norm(s.name), s]));
  if (!src.size) return 0;
  const have = new Set(db.select({ m: mailEvents.messageId }).from(mailEvents).all().map((r) => r.m));
  // Correos ya guardados antes de que se leyera el tamaño: se rellena (una sola vez por correo)
  for (const [mid, e] of cache) {
    if (e.kind === 'parsed' && e.parsed.size != null && have.has(mid)) {
      db.update(mailEvents).set({ size: e.parsed.size }).where(and(eq(mailEvents.messageId, mid), isNull(mailEvents.size))).run();
    }
  }
  const ignored = new Set(getIgnored());
  let added = 0;
  db.transaction((tx) => {
    for (const [mid, e] of cache) {
      if (e.kind !== 'parsed' || have.has(mid)) continue;
      const s = src.get(norm(e.parsed.source));
      if (!s || ignored.has(`${s.id}|${e.parsed.task.toLowerCase()}`)) continue;
      let el = tx.select().from(elements)
        .where(and(eq(elements.serverId, s.id), eq(elements.kind, 'backup'), eq(elements.externalId, e.parsed.task))).get();
      if (!el) {
        const parent = tx.select().from(elements).where(and(eq(elements.serverId, s.id), eq(elements.kind, 'server'))).get();
        const id = crypto.randomUUID();
        tx.insert(elements).values({
          id, serverId: s.id, parentId: parent?.id ?? null, kind: 'backup', externalId: e.parsed.task, name: e.parsed.task,
          status: 'unknown', monitored: true, isNew: false, info: { format: e.parsed.format },
        }).run();
        el = tx.select().from(elements).where(eq(elements.id, id)).get()!;
      }
      tx.insert(mailEvents).values({ elementId: el.id, messageId: mid, ok: e.parsed.ok, at: e.parsed.at, detail: e.parsed.detail, sender: e.from, size: e.parsed.size ?? null }).onConflictDoNothing().run();
      have.add(mid); added++;
    }
  });
  return added;
}

export function evaluateAll(store: MetricsStore): { tasks: number; problems: number } {
  const now = nowSec();
  db.delete(mailEvents).where(lt(mailEvents.at, now - KEEP_DAYS * 86400)).run();
  const srv = new Map(mailSources().map((s) => [s.id, s]));
  if (!srv.size) return { tasks: 0, problems: 0 };
  const els = db.select().from(elements).where(and(eq(elements.kind, 'backup'), inArray(elements.serverId, [...srv.keys()]))).all();
  const prev = new Map(db.select().from(backupStatus).all().map((b) => [b.elementId, b]));
  const points: Point[] = [];
  let problems = 0;
  db.transaction((tx) => {
    for (const el of els) {
      if ((el.info as { fileCheck?: boolean } | null)?.fileCheck) continue; // lo evalúa filecheck/monitor.ts
      const evs = tx.select().from(mailEvents).where(eq(mailEvents.elementId, el.id)).orderBy(desc(mailEvents.at)).all();
      const lastOk = evs.find((e) => e.ok) ?? null;
      const last = evs[0] ?? null;
      const maxHours = prev.get(el.id)?.maxHoursOverride ?? srv.get(el.serverId)!.backupMaxHours;
      const { state, message } = decide({
        lastOkAt: lastOk?.at ?? null,
        lastAttempt: last ? { at: last.at, ok: last.ok, message: last.detail ?? undefined } : null,
        excluded: false, maxHours, now,
      });
      const row = {
        elementId: el.id, serverId: el.serverId, state, lastOkAt: lastOk?.at ?? null, lastOkSize: lastOk?.size ?? null, lastOkStorage: null,
        lastAttemptAt: last?.at ?? null, lastAttemptOk: last?.ok ?? null, message, checkedAt: now,
      };
      tx.insert(backupStatus).values(row).onConflictDoUpdate({ target: backupStatus.elementId, set: row }).run();
      tx.update(elements).set({ status: state === 'ok' ? 'running' : state === 'none' ? 'unknown' : 'stopped', lastSeenAt: now, missing: false })
        .where(eq(elements.id, el.id)).run();
      if (state === 'error' || state === 'stale') problems++;
      if (el.monitored && state !== 'none' && state !== 'excluded') {
        points.push({ elementId: el.id, metricKey: 'backup.problem', ts: now, value: state === 'ok' ? 0 : 1 });
        if (lastOk) points.push({ elementId: el.id, metricKey: 'backup.age', ts: now, value: now - lastOk.at });
      }
    }
    for (const s of srv.values()) tx.update(servers).set({ lastSeenAt: now }).where(eq(servers.id, s.id)).run();
  });
  if (points.length) { store.write(points); void observe(points, now); }
  return { tasks: els.length, problems };
}

/* ───────────── consulta del buzón ───────────── */

function joinPolls(at: number, list: { name: string; info: PollInfo }[]): PollInfo {
  const bad = list.filter((x) => !x.info.ok);
  const sum = (f: (i: PollInfo) => number | undefined) => list.reduce((n, x) => n + (f(x.info) ?? 0), 0);
  return {
    at, ok: bad.length === 0, error: bad.length ? bad.map((x) => (list.length > 1 ? `${x.name}: ` : '') + (x.info.error ?? '')).join(' · ') : null,
    seen: sum((i) => i.seen), fetched: sum((i) => i.fetched), missingFolders: [...new Set(list.flatMap((x) => x.info.missingFolders))],
    moved: sum((i) => i.moved), movedExcluded: sum((i) => i.movedExcluded), moveError: list.map((x) => x.info.moveError).find(Boolean) ?? null,
    notMoved: sum((i) => i.notMoved), notMovedList: list.flatMap((x) => x.info.notMovedList ?? []).slice(0, 3),
  };
}

/** Consulta una cuenta: descarga los correos nuevos, los interpreta y (si está activado) mueve los ya incorporados. */
async function pollAccount(stored: MailAccount, store: MetricsStore): Promise<PollInfo> {
  const at = nowSec();
  const conn = imapConn(stored.id);
  if (!conn) return { at, ok: false, error: 'Falta configurar el servidor de correo (IMAP)', seen: 0, fetched: 0, missingFolders: [] };
  try {
    const formats = getFormats();
    const folders = [...new Set([stored.inFolder, stored.doneFolder].filter(Boolean))];
    const r = await getFetcher().fetch(conn, {
      folders, sinceDays: stored.lookbackDays, skip: (id) => cache.has(id),
    });
    for (const m of r.mails) {
      if (isExcluded(m.from)) { cache.set(m.messageId, { kind: 'ignored', why: 'excluded', subject: m.subject }); continue; }
      const p = parseMail(m, formats);
      cache.set(m.messageId, p.kind === 'parsed' ? { kind: 'parsed', parsed: p.parsed, from: m.from } : p.kind === 'ignored' ? { kind: 'ignored', why: 'type', subject: m.subject } : { kind: 'unknown', subject: m.subject, from: m.from, date: m.date });
    }
    applyCache();
    evaluateAll(store);
    // Opcional: marcar como leídos y mover los correos ya incorporados (solo los de la carpeta de entrada y de orígenes dados de alta)
    let moved = 0, movedExcluded = 0, notMoved = 0, moveError: string | null = null; let notMovedList: PollInfo['notMovedList'] = [];
    const fetcher = getFetcher();
    if (((stored.moveDone && stored.doneFolder) || stored.excludedFolder) && fetcher.finish) {
      const done = new Set(db.select({ m: mailEvents.messageId }).from(mailEvents).all().map((x) => x.m));
      // También los correos reconocidos de un origen dado de alta cuya tarea se dejó de monitorizar: no generan datos, pero ya están gestionados
      const regs = new Set(mailSources().map((s) => norm(s.name)));
      for (const [mid, e] of cache) if (e.kind === 'parsed' && regs.has(norm(e.parsed.source))) done.add(mid);
      // Incluye los correos nuevos y los ya leídos en consultas anteriores (si se activó la opción después, o un intento falló)
      const cands = [...r.mails.map((m) => ({ messageId: m.messageId, folder: m.folder, uid: m.uid })), ...(r.known ?? [])];
      const inIn = cands.filter((m) => m.folder === stored.inFolder && m.uid);
      const doMove = stored.moveDone && !!stored.doneFolder;
      const isEx = (id: string) => { const e = cache.get(id); return e?.kind === 'ignored' && e.why === 'excluded'; };
      const exUids = stored.excludedFolder ? [...new Set(inIn.filter((m) => isEx(m.messageId)).map((m) => m.uid!))] : [];
      const uids = doMove ? [...new Set(inIn.filter((m) => done.has(m.messageId)).map((m) => m.uid!))] : [];
      const pend = new Map<string, NonNullable<PollInfo['notMovedList']>[number]>();
      const subj = new Map(r.mails.map((x) => [x.messageId, x.subject]));
      for (const m of inIn) {
        if (!doMove || done.has(m.messageId) || pend.has(m.messageId) || (stored.excludedFolder && isEx(m.messageId))) continue;
        const e = cache.get(m.messageId);
        pend.set(m.messageId, !e ? { subject: subj.get(m.messageId) ?? m.messageId, why: 'unseen' }
          : e.kind === 'unknown' ? { subject: e.subject, why: 'unknown' }
          : e.kind === 'ignored' ? { subject: e.subject ?? subj.get(m.messageId) ?? '', why: e.why ?? 'type' }
          : { subject: `${e.parsed.task}`, why: 'source', source: e.parsed.source });
      }
      notMoved = pend.size; notMovedList = [...pend.values()].slice(0, 3);
      try {
        // Los excluidos se mueven sin marcarlos como leídos (para poder revisarlos)
        if (exUids.length) movedExcluded = await fetcher.finish(conn, stored.inFolder, stored.excludedFolder, exUids, false);
        if (uids.length) moved = await fetcher.finish(conn, stored.inFolder, stored.doneFolder, uids);
      } catch (e) { moveError = (e as Error).message || String(e); }
    }
    return { at, ok: true, error: null, seen: r.seen, fetched: r.mails.length, missingFolders: r.missingFolders, moved, movedExcluded, moveError, notMoved, notMovedList };
  } catch (e) {
    return { at, ok: false, error: (e as Error).message || String(e), seen: 0, fetched: 0, missingFolders: [] };
  }
}

/** Consulta todas las cuentas activadas (o solo la indicada, aunque esté desactivada: «Comprobar ahora»). */
export async function pollMail(store: MetricsStore, onlyId?: string): Promise<PollInfo> {
  const at = nowSec();
  const accs = readAccounts().filter((a) => (onlyId ? a.id === onlyId : a.enabled));
  if (!accs.length) {
    return (lastPoll = { at, ok: false, error: 'Falta configurar el servidor de correo (IMAP)', seen: 0, fetched: 0, missingFolders: [] });
  }
  if (polling) return lastPoll ?? { at, ok: true, error: null, seen: 0, fetched: 0, missingFolders: [] };
  polling = true;
  try {
    const done: { name: string; info: PollInfo }[] = [];
    for (const a of accs) {
      const info = await pollAccount(a, store);
      lastPolls.set(a.id, info);
      done.push({ name: a.name, info });
    }
    lastPoll = joinPolls(at, done);
  } finally { polling = false; }
  return lastPoll;
}

/** Vuelve a interpretar todo lo ya descargado (tras añadir un formato propio). */
export function resetMailCache(): void { cache.clear(); }

export function startMailMonitor(log: FastifyBaseLogger, store: MetricsStore): () => void {
  const run = async () => {
    try {
      if (readAccounts().some((a) => a.enabled)) {
        const r = await pollMail(store);
        if (!r.ok) log.warn({ err: r.error }, 'consulta del correo de copias falló');
      } else { applyCache(); evaluateAll(store); }
    } catch (e) { log.warn({ err: (e as Error).message }, 'revisión de copias por correo falló'); }
  };
  const first = setTimeout(() => void run(), 30_000);
  const timer = setInterval(() => void run(), INTERVAL_MS);
  return () => { clearTimeout(first); clearInterval(timer); };
}
