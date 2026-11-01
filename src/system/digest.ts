/**
 * Resumen semanal por correo y/o Telegram: copias (bien / con problema / cuánto falta para que salte la alarma),
 * espacio de los almacenes de copias y alertas abiertas.
 */
import type { FastifyBaseLogger } from 'fastify';
import { and, eq, isNotNull } from 'drizzle-orm';
import { getSetting, getTelegram, sendMail, sendTelegram, setSetting, systemLang, userLang } from '../alerts/notify.js';
import { tf, tr, type Lang } from '../i18n.js';
import { storageUsage } from '../backups/collector.js';
import { decrypt } from '../crypto.js';
import { db, schema } from '../db/index.js';

const { backupStatus, elements, servers, users, alertEvents } = schema;

export interface DigestCfg { enabled: boolean; day: number; hour: number; email: boolean; telegram: boolean; lastSent?: string }
export const DEFAULT_DIGEST: DigestCfg = { enabled: false, day: 1, hour: 8, email: true, telegram: false };
export const getDigest = (): DigestCfg => ({ ...DEFAULT_DIGEST, ...(getSetting<DigestCfg>('digest') ?? {}) });
const TZ = process.env.TZ || 'Europe/Madrid';

const fmtSize = (b: number, lang: Lang) => { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = b; while (v >= 1024 && i < 4) { v /= 1024; i++; } return `${v.toFixed(i ? 1 : 0).replace('.', lang === 'en' ? '.' : ',')} ${u[i]}`; };
const fmtDate = (t: number, lang: Lang) => new Date(t * 1000).toLocaleString(lang === 'en' ? 'en-GB' : 'es-ES', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
function fmtLeft(sec: number, lang: Lang): string {
  if (sec <= 0) return tf('vencida', lang);
  if (sec >= 2 * 86400) return tf('{0} días', lang, Math.floor(sec / 86400));
  if (sec >= 3600) return `${Math.floor(sec / 3600)} h`;
  return `${Math.max(1, Math.floor(sec / 60))} min`;
}

export function buildDigest(now = Math.floor(Date.now() / 1000), lang: Lang = 'es'): { subject: string; text: string } {
  const els = new Map(db.select().from(elements).all().map((e) => [e.id, e]));
  const srv = new Map(db.select().from(servers).all().map((s) => [s.id, s]));
  const rows = db.select().from(backupStatus).all()
    .map((b) => ({ b, e: els.get(b.elementId) }))
    .filter((x): x is { b: typeof x.b; e: NonNullable<typeof x.e> } => !!x.e && !x.e.missing && x.e.monitored && x.b.state !== 'excluded');
  const maxOf = (b: (typeof rows)[number]['b']) => b.maxHoursOverride ?? srv.get(b.serverId)?.backupMaxHours ?? 0;
  const bad = rows.filter((x) => x.b.state === 'error' || x.b.state === 'stale' || x.b.state === 'none');
  const ok = rows.filter((x) => x.b.state === 'ok');
  const name = (e: (typeof rows)[number]['e']) => `${e.alias ?? e.name}${srv.get(e.serverId) ? ` (${srv.get(e.serverId)!.name})` : ''}`;

  const L: string[] = [];
  L.push(tf('Copias vigiladas: {0} · correctas: {1} · con problema: {2}', lang, rows.length, ok.length, bad.length));
  if (bad.length) {
    L.push('', tf('CON PROBLEMA:', lang));
    for (const { b, e } of bad) {
      L.push(`• ${name(e)}: ${b.state === 'none' ? tf('todavía no hay ninguna copia', lang) : tr(b.message ?? tf('revisar', lang), lang)}${b.lastOkAt ? tf(' · última correcta {0}', lang, fmtDate(b.lastOkAt, lang)) : ''}`);
    }
  }
  if (ok.length) {
    L.push('', tf('CORRECTAS (última copia · tamaño · falta para la alarma):', lang));
    for (const { b, e } of ok.sort((x, y) => (x.b.lastOkAt ?? 0) - (y.b.lastOkAt ?? 0))) {
      const left = b.lastOkAt && maxOf(b) ? fmtLeft(maxOf(b) * 3600 - (now - b.lastOkAt), lang) : '—';
      L.push(`• ${name(e)}: ${b.lastOkAt ? fmtDate(b.lastOkAt, lang) : '—'} · ${b.lastOkSize ? fmtSize(b.lastOkSize, lang) : '—'} · ${left}`);
    }
  }
  const stor = [...storageUsage.values()].flat();
  if (stor.length) {
    L.push('', tf('ALMACENES DE COPIAS:', lang));
    for (const s of stor.sort((a, b) => b.pct - a.pct)) L.push(tf('• {0} ({1} › {2}): {3} % usado · quedan {4}', lang, s.storage, s.server, s.node, s.pct.toString().replace('.', lang === 'en' ? '.' : ','), fmtSize(Math.max(0, s.total - s.used), lang)));
  }
  const firing = db.select().from(alertEvents).where(eq(alertEvents.state, 'firing')).all().length;
  const offline = [...srv.values()].filter((s) => s.kind !== 'mail' && s.status === 'offline').map((s) => s.name);
  L.push('', tf('Alertas abiertas ahora: {0}{1}', lang, firing, offline.length ? tf(' · nodos sin conexión: {0}', lang, offline.join(', ')) : ''));
  const icon = bad.length ? '⚠' : '✔';
  return { subject: tf('[pvemon] {0} Resumen semanal de copias: {1}', lang, icon, bad.length ? tf('{0} con problema', lang, bad.length) : tf('todo correcto', lang)), text: L.join('\n') };
}

/** Envía el resumen por los canales marcados. Devuelve a dónde ha llegado. */
export async function sendDigest(): Promise<string[]> {
  const c = getDigest();
  const sent: string[] = [];
  const errs: string[] = [];
  if (c.email) {
    const to = db.select({ email: users.email, lang: users.lang }).from(users).where(and(eq(users.role, 'admin'), eq(users.disabled, false), isNotNull(users.email))).all();
    for (const u of to) {
      const a = u.email!, lang = userLang(u);
      const { subject, text } = buildDigest(undefined, lang);
      try { await sendMail(a, subject, text + tf('{0}\n\n—\nResumen semanal de pvemon (Ajustes → Sistema).', lang, '')); sent.push(tf('correo a {0}', systemLang(), a)); }
      catch (e) { errs.push(tf('correo a {0}: {1}', systemLang(), a, tr((e as Error).message, systemLang()))); }
    }
  }
  if (c.telegram) {
    const t = getTelegram();
    if (t?.enabled && t.tokenEnc && t.chatId) {
      const lang = systemLang();
      const { subject, text } = buildDigest(undefined, lang);
      try { await sendTelegram(`${subject}\n\n${text}`, { token: decrypt(t.tokenEnc), chatId: t.chatId }); sent.push('Telegram'); }
      catch (e) { errs.push(`Telegram: ${tr((e as Error).message, lang)}`); }
    } else errs.push(tf('Telegram no está configurado', systemLang()));
  }
  if (!sent.length) throw new Error(errs.join(' · ') || 'No hay ningún canal marcado (correo o Telegram)');
  return sent;
}

/** Hora actual en la zona configurada */
function localNow(): { date: string; day: number; hour: number } {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday'));
  return { date: `${g('year')}-${g('month')}-${g('day')}`, day, hour: Number(g('hour')) };
}

export function startDigest(logger: FastifyBaseLogger): () => void {
  let busy = false;
  const t = setInterval(() => {
    const c = getDigest();
    if (!c.enabled || busy) return;
    const n = localNow();
    if (n.day !== c.day || n.hour < c.hour || c.lastSent === n.date) return; // si estaba apagado a la hora, sale en cuanto arranca ese día
    busy = true;
    setSetting('digest', { ...c, lastSent: n.date });
    void sendDigest().then((s) => logger.info({ to: s }, 'resumen semanal enviado'))
      .catch((e) => logger.warn({ err: (e as Error).message }, 'resumen semanal falló'))
      .finally(() => { busy = false; });
  }, 60_000);
  return () => clearInterval(t);
}
