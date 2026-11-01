/**
 * Lectura del buzón por IMAP. Leer no cambia nada en el buzón. Solo si el administrador lo activa,
 * `finish` marca como leídos y mueve a otra carpeta los correos de copias ya procesados (nunca borra).
 */
import { ImapFlow, type ListResponse } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { RawMail } from './parse.js';

export interface ImapConfig {
  host: string; port: number; secure: boolean; user: string; password: string;
}

export interface FetchOptions {
  folders: string[];
  sinceDays: number;
  /** Mensajes que no hace falta volver a descargar */
  skip: (messageId: string) => boolean;
  maxMessages?: number;
}

export interface Fetcher {
  /** Marca como leídos y mueve (por UID) los correos ya procesados de una carpeta a otra; crea la carpeta destino si no existe */
  finish?(cfg: ImapConfig, from: string, to: string, uids: number[], markSeen?: boolean): Promise<number>;
  fetch(cfg: ImapConfig, opts: FetchOptions): Promise<{ mails: RawMail[]; seen: number; missingFolders: string[]; known?: { messageId: string; folder: string; uid: number }[] }>;
  listFolders(cfg: ImapConfig): Promise<string[]>;
}

const client = (cfg: ImapConfig) => new ImapFlow({
  host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.password },
  logger: false, socketTimeout: 60_000, greetingTimeout: 20_000, connectionTimeout: 20_000,
});

const norm = (s: string) => s.split(/[/.\\]/).map((x) => x.trim().toLowerCase()).filter((x) => x && x !== 'inbox').join('/');

/** Encuentra la carpeta real aunque el usuario escriba «Alertas/Procesados» y el servidor use otro separador */
export function resolveFolder(want: string, list: Pick<ListResponse, 'path'>[]): string | null {
  const exact = list.find((l) => l.path === want);
  if (exact) return exact.path;
  const w = norm(want);
  return list.find((l) => norm(l.path) === w)?.path ?? null;
}

const textOf = async (source: Buffer): Promise<{ text: string; subject: string; from: string; date?: Date; messageId?: string }> => {
  const p = await simpleParser(source);
  const text = p.text?.trim() || (typeof p.html === 'string' ? p.html.replace(/<(br|\/p|\/div|\/tr)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ') : '');
  return { text, subject: p.subject ?? '', from: p.from?.text ?? '', date: p.date, messageId: p.messageId };
};

export const imapFetcher: Fetcher = {
  async finish(cfg, from, to, uids, markSeen = true) {
    if (!uids.length) return 0;
    const c = client(cfg);
    c.on('error', () => undefined);
    await c.connect();
    try {
      const list = await c.list();
      const src = resolveFolder(from, list);
      if (!src) throw new Error(`No existe la carpeta de entrada «${from}»`);
      let dst = resolveFolder(to, list);
      if (!dst) {
        const sep = list.find((l) => l.path === src)?.delimiter ?? '/';
        dst = to.split(/[/.\\]/).map((x) => x.trim()).filter(Boolean).join(sep);
        await c.mailboxCreate(dst);
      }
      if (dst === src) return 0;
      const lock = await c.getMailboxLock(src);
      try {
        const set = uids.join(',');
        if (markSeen) await c.messageFlagsAdd(set, ['\\Seen'], { uid: true });
        await c.messageMove(set, dst, { uid: true });
      } finally { lock.release(); }
      return uids.length;
    } finally { await c.logout().catch(() => undefined); }
  },

  async listFolders(cfg) {
    const c = client(cfg);
    await c.connect();
    try { return (await c.list()).map((l) => l.path).sort(); }
    finally { await c.logout().catch(() => undefined); }
  },

  async fetch(cfg, opts) {
    const c = client(cfg);
    c.on('error', () => undefined); // los errores llegan por las promesas
    await c.connect();
    const mails: RawMail[] = [];
    const missingFolders: string[] = [];
    const known: { messageId: string; folder: string; uid: number }[] = []; // ya leídos antes: se necesitan para marcarlos y moverlos
    let seen = 0;
    try {
      const list = await c.list();
      const since = new Date(Date.now() - opts.sinceDays * 86_400_000);
      for (const want of opts.folders) {
        const path = resolveFolder(want, list);
        if (!path) { missingFolders.push(want); continue; }
        const lock = await c.getMailboxLock(path, { readOnly: true });
        try {
          const uids = (await c.search({ since }, { uid: true })) || [];
          for (const uid of uids) {
            if (mails.length >= (opts.maxMessages ?? 400)) break;
            const head = await c.fetchOne(String(uid), { envelope: true, internalDate: true }, { uid: true });
            if (!head) continue;
            seen++;
            const mid = head.envelope?.messageId ?? `${path}#${uid}`;
            if (opts.skip(mid)) { known.push({ messageId: mid, folder: want, uid }); continue; }
            const full = await c.fetchOne(String(uid), { source: true }, { uid: true });
            if (!full || !full.source) continue;
            const p = await textOf(full.source);
            const d = p.date ?? head.envelope?.date ?? head.internalDate;
            mails.push({
              folder: want, uid,
              messageId: mid, subject: p.subject || head.envelope?.subject || '', from: p.from,
              date: Math.floor(new Date(d ?? Date.now()).getTime() / 1000), text: p.text,
            });
          }
        } finally { lock.release(); }
      }
    } finally { await c.logout().catch(() => undefined); }
    return { mails, seen, missingFolders, known };
  },
};

let current: Fetcher = imapFetcher;
export const getFetcher = (): Fetcher => current;
/** Para pruebas */
export const setFetcher = (f: Fetcher): void => { current = f; };
