/**
 * Envío de avisos: correo (SMTP) y notificaciones push (Web Push / VAPID).
 * A quién se avisa de cada elemento lo decide la tabla notification_prefs
 * (las casillas Push / Correo de la pantalla de usuarios).
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import { request } from 'undici';
import webpush from 'web-push';
import { allowedElementIds } from '../auth/access.js';
import { decrypt, encrypt } from '../crypto.js';
import { db, schema } from '../db/index.js';
import { log } from '../log.js';
import { parseLang, tf, tr, type Lang } from '../i18n.js';

const { settings, users, pushSubscriptions, notificationPrefs } = schema;

export interface AlertNote {
  eventId: string;
  tag: string; // mismo tag para "salta" y "resuelta": la segunda sustituye a la primera en el móvil
  state: 'firing' | 'resolved';
  severity: 'warning' | 'critical';
  elementId: string;
  title: string;
  text: string;
  path: string;
}

/* ───────────── idioma de los avisos ───────────── */

/** Idioma de un usuario (castellano si no ha elegido otro) */
export const userLang = (u: { lang?: string | null }): Lang => parseLang(u.lang);
/** Canales sin usuario concreto (Telegram, webhook, Teams): el idioma del administrador más antiguo */
export const systemLang = (): Lang =>
  parseLang(db.select({ lang: users.lang }).from(users).where(and(eq(users.role, 'admin'), eq(users.disabled, false))).orderBy(users.createdAt).get()?.lang);
export const trNote = (n: AlertNote, lang: Lang): AlertNote => (lang === 'en' ? { ...n, title: tr(n.title, lang), text: tr(n.text, lang) } : n);

/* ───────────── ajustes guardados en BD ───────────── */

export function getSetting<T>(key: string): T | null {
  const r = db.select().from(settings).where(eq(settings.key, key)).get();
  return r ? (r.value as T) : null;
}

export function setSetting(key: string, value: unknown): void {
  const now = Math.floor(Date.now() / 1000);
  db.insert(settings).values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } }).run();
}

export function deleteSetting(key: string): void {
  db.delete(settings).where(eq(settings.key, key)).run();
}

/* ───────────── correo ───────────── */

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean; // true = TLS directo (puerto 465); false = STARTTLS si el servidor lo ofrece (587)
  user: string | null;
  passEnc: string | null; // cifrada con SECRET_KEY
  from: string;
}

export const getSmtp = () => getSetting<SmtpConfig>('smtp');

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  const c = getSmtp();
  if (!c) throw new Error('El correo (SMTP) no está configurado');
  const t = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: c.user ? { user: c.user, pass: c.passEnc ? decrypt(c.passEnc) : '' } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  try {
    await t.sendMail({ from: c.from, to, subject, text });
  } finally {
    t.close();
  }
}

/* ───────────── Telegram ───────────── */

export interface TelegramConfig { tokenEnc: string | null; chatId: string; enabled: boolean }
export const getTelegram = () => getSetting<TelegramConfig>('telegram');
const TG_API = process.env.TELEGRAM_API ?? 'https://api.telegram.org';

async function tgCall<T>(token: string, method: string, body?: unknown): Promise<T> {
  const res = await request(`${TG_API}/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
    headersTimeout: 10_000, bodyTimeout: 10_000,
  });
  const j = await res.body.json().catch(() => null) as { ok?: boolean; result?: T; description?: string } | null;
  if (!j?.ok) throw new Error(j?.description ? `Telegram: ${j.description}` : `Telegram respondió ${res.statusCode}`);
  return j.result as T;
}

export async function sendTelegram(text: string, cfg: { token: string; chatId: string }): Promise<void> {
  await tgCall(cfg.token, 'sendMessage', { chat_id: cfg.chatId, text: text.slice(0, 4000), disable_web_page_preview: true });
}

/** Chats que han escrito al bot (para averiguar el Chat ID sin buscarlo a mano) */
export async function telegramChats(token: string): Promise<{ id: string; name: string }[]> {
  const ups = await tgCall<{ message?: { chat: { id: number; type: string; title?: string; first_name?: string; username?: string } } }[]>(token, 'getUpdates', { limit: 50 });
  const seen = new Map<string, string>();
  for (const u of ups) {
    const c = u.message?.chat;
    if (c) seen.set(String(c.id), c.title ?? c.first_name ?? c.username ?? String(c.id));
  }
  return [...seen].map(([id, name]) => ({ id, name }));
}

async function dispatchTelegram(notes: AlertNote[]): Promise<void> {
  const c = getTelegram();
  if (!c?.enabled || !c.tokenEnc || !c.chatId || notes.length === 0) return;
  const lang = systemLang();
  const lines = notes.slice(0, 10).map((n0) => { const n = trNote(n0, lang); return `${n.title}\n${n.text}${n.path ? `\n${n.path}` : ''}`; });
  const text = lines.join('\n\n') + (notes.length > 10 ? tf('\n\n… y {0} más', lang, notes.length - 10) : '');
  try { await sendTelegram(text, { token: decrypt(c.tokenEnc), chatId: c.chatId }); }
  catch (e) { log.warn({ err: (e as Error).message }, 'aviso por Telegram falló'); }
}

/* ───────────── webhook y Microsoft Teams (canales generales: reciben todos los avisos) ───────────── */

export interface HookConfig { urlEnc: string | null; enabled: boolean; onlyCritical: boolean; secretEnc?: string | null }
export type HookKind = 'webhook' | 'teams';
export const getHook = (k: HookKind) => getSetting<HookConfig>(k);

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<void> {
  const res = await request(url, {
    method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'pvemon', ...headers }, body: JSON.stringify(body),
    headersTimeout: 10_000, bodyTimeout: 10_000,
  });
  const text = await res.body.text().catch(() => '');
  if (res.statusCode >= 300) throw new Error(`El destino respondió ${res.statusCode}${text ? ': ' + text.slice(0, 120) : ''}`);
}

/** Cuerpo JSON genérico: un lote de avisos */
export const webhookBody = (notes0: AlertNote[], lang: Lang = 'es') => ({
  source: 'pvemon', sentAt: new Date().toISOString(),
  alerts: notes0.map((n0) => trNote(n0, lang)).map((n) => ({ event: n.state, severity: n.severity, title: n.title, text: n.text, path: n.path, elementId: n.elementId, alertId: n.eventId })),
});

/** Tarjeta adaptable: es el formato que espera el flujo «Al recibir una solicitud de webhook» de Teams (Workflows) */
export const teamsBody = (notes0: AlertNote[], lang: Lang = 'es') => { const notes = notes0.map((n) => trNote(n, lang)); return {
  type: 'message',
  attachments: [{
    contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null,
    content: {
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4',
      body: [
        { type: 'TextBlock', text: 'PVEMon', weight: 'Bolder', size: 'Medium' },
        ...notes.slice(0, 10).flatMap((n) => [
          { type: 'TextBlock', text: n.title, weight: 'Bolder', wrap: true, color: n.state === 'resolved' ? 'Good' : n.severity === 'critical' ? 'Attention' : 'Warning', separator: true },
          { type: 'TextBlock', text: n.text + (n.path ? `\n${n.path}` : ''), wrap: true, isSubtle: true, spacing: 'None' },
        ]),
        ...(notes.length > 10 ? [{ type: 'TextBlock', text: tf('… y {0} más', lang, notes.length - 10), isSubtle: true }] : []),
      ],
    },
  }],
}; };

export async function sendHook(kind: HookKind, url: string, notes: AlertNote[], secret?: string | null): Promise<void> {
  const lang = systemLang();
  if (kind === 'teams') return post(url, teamsBody(notes, lang));
  return post(url, webhookBody(notes, lang), secret ? { 'x-pvemon-token': secret } : {});
}

async function dispatchHooks(notes: AlertNote[]): Promise<void> {
  for (const kind of ['webhook', 'teams'] as const) {
    const c = getHook(kind);
    if (!c?.enabled || !c.urlEnc) continue;
    const list = c.onlyCritical ? notes.filter((n) => n.severity === 'critical') : notes;
    if (list.length === 0) continue;
    try { await sendHook(kind, decrypt(c.urlEnc), list, c.secretEnc ? decrypt(c.secretEnc) : null); }
    catch (e) { log.warn({ kind, err: (e as Error).message }, 'aviso por ' + kind + ' falló'); }
  }
}

/* ───────────── push ───────────── */

interface VapidStored { publicKey: string; privateKeyEnc: string }

/** Claves VAPID: se generan solas la primera vez y se guardan (la privada, cifrada). */
export function vapid(): { publicKey: string; privateKey: string } {
  let v = getSetting<VapidStored>('vapid');
  if (!v) {
    const k = webpush.generateVAPIDKeys();
    v = { publicKey: k.publicKey, privateKeyEnc: encrypt(k.privateKey) };
    setSetting('vapid', v);
  }
  return { publicKey: v.publicKey, privateKey: decrypt(v.privateKeyEnc) };
}

const vapidSubject = (): string => {
  const a = db.select({ email: users.email }).from(users)
    .where(and(eq(users.role, 'admin'), isNotNull(users.email))).get();
  return `mailto:${a?.email ?? 'pvemon@example.com'}`;
};

export interface PushPayload { title: string; body: string; tag?: string; url?: string }

/** Envía a todos los dispositivos de un usuario. Devuelve cuántos lo aceptaron. */
export async function sendPushTo(userId: string, payload: PushPayload): Promise<number> {
  const subs = db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).all();
  if (subs.length === 0) return 0;
  const v = vapid();
  const body = JSON.stringify({ url: '/#/alertas', ...payload });
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { vapidDetails: { subject: vapidSubject(), publicKey: v.publicKey, privateKey: v.privateKey }, TTL: 3600, urgency: 'high', timeout: 10_000 },
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        // El dispositivo ya no existe (app desinstalada, permiso retirado...): se olvida
        db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id)).run();
      } else {
        log.warn({ err: (e as Error).message, status: code }, 'envío push falló');
      }
    }
  }));
  return sent;
}

/* ───────────── reparto de avisos ───────────── */

interface Bucket { user: typeof users.$inferSelect; push: AlertNote[]; mail: AlertNote[] }

/**
 * Reparte un lote de avisos entre los usuarios que lo tienen activado.
 * Un usuario recibe como máximo UN correo por lote, y si hay más de 3 avisos push se agrupan en uno:
 * si cae un nodo entero no se manda una avalancha de notificaciones.
 */
export async function dispatch(notes: AlertNote[]): Promise<void> {
  if (notes.length === 0) return;
  await dispatchHooks(notes);
  const rows = db
    .select({ elementId: notificationPrefs.elementId, push: notificationPrefs.push, email: notificationPrefs.email, telegram: notificationPrefs.telegram, user: users })
    .from(notificationPrefs)
    .innerJoin(users, eq(users.id, notificationPrefs.userId))
    .where(inArray(notificationPrefs.elementId, [...new Set(notes.map((n) => n.elementId))]))
    .all();

  const tgIds = new Set<string>(); // elementos que algún usuario quiere recibir por Telegram
  const perUser = new Map<string, Bucket>();
  const allowedCache = new Map<string, Set<string> | null>();
  for (const r of rows) {
    if (r.user.disabled || (!r.push && !r.email && !r.telegram)) continue;
    let allowed = allowedCache.get(r.user.id);
    if (allowed === undefined) { allowed = allowedElementIds(r.user); allowedCache.set(r.user.id, allowed); }
    if (allowed && !allowed.has(r.elementId)) continue; // por si le quitaron el acceso
    if (r.telegram) tgIds.add(r.elementId);
    const b = perUser.get(r.user.id) ?? { user: r.user, push: [], mail: [] };
    perUser.set(r.user.id, b);
    for (const n of notes) {
      if (n.elementId !== r.elementId) continue;
      if (r.push) b.push.push(n);
      if (r.email) b.mail.push(n);
    }
  }

  await dispatchTelegram(notes.filter((n) => tgIds.has(n.elementId)));

  await Promise.all([...perUser.values()].map(async (b) => {
    const lang = userLang(b.user);
    try {
      if (b.push.length > 3) {
        await sendPushTo(b.user.id, {
          title: tf('{0} alertas en pvemon', lang, b.push.length),
          body: b.push.slice(0, 3).map((n) => tr(n.title, lang)).join('\n') + '\n…',
          tag: 'pvemon-grupo',
        });
      } else {
        for (const n0 of b.push) { const n = trNote(n0, lang); await sendPushTo(b.user.id, { title: n.title, body: n.text, tag: n.tag }); }
      }
    } catch (e) { log.warn({ user: b.user.username, err: (e as Error).message }, 'aviso push falló'); }

    try {
      if (b.user.email && b.mail.length > 0) {
        const subject = b.mail.length === 1 ? `[pvemon] ${tr(b.mail[0]!.title, lang)}` : tf('[pvemon] {0} alertas', lang, b.mail.length);
        const text = b.mail.map((n0) => { const n = trNote(n0, lang); return `${n.title}\n  ${n.text}${n.path ? `\n  ${n.path}` : ''}`; }).join('\n\n')
          + tf('{0}\n\n—\nRecibes este aviso porque lo tienes activado en pvemon (Ajustes → Usuarios → Avisos).', lang, '').replace(/^/, '');
        await sendMail(b.user.email, subject, text);
      }
    } catch (e) { log.warn({ user: b.user.username, err: (e as Error).message }, 'aviso por correo falló'); }
  }));
}
