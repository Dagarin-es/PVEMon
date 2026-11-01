/**
 * Pasar las copias entre PVEMon y BCKMon (en los dos sentidos): archivo cifrado con SOLO la configuración de copias (correo, orígenes,
 * remitentes excluidos, formatos propios y comprobaciones NFS). No lleva servidores Proxmox, Docker, usuarios, kioscos ni alertas.
 * Formato: "BCKMONX1" + sal(16) + iv(12) + etiqueta(16) + datos (AES-256-GCM, clave = scrypt(contraseña)).
 * Dentro: gzip de un JSON. La contraseña del correo viaja descifrada DENTRO del archivo cifrado, porque cada instalación tiene otra SECRET_KEY
 * y la vuelve a cifrar con la suya al importar.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { gunzipSync, gzipSync } from 'node:zlib';
import { getSetting, setSetting } from '../alerts/notify.js';
import { decrypt, encrypt } from '../crypto.js';
import { db, schema } from '../db/index.js';
import { BackupError, kdf } from './backup.js';

const { servers, elements, backupStatus, mailEvents } = schema;
const MAGIC = Buffer.from('BCKMONX1');
const norm = (s: string) => s.trim().toLowerCase();

type Row = Record<string, unknown>;
interface Payload {
  v: 1; kind: 'bckmon-export'; app: string; at: number;
  imap: Row | null; imapPassword: string; excludedSenders: string[]; formats: unknown[]; ignored: string[]; filechecks: Row[];
  servers: Row[]; elements: Row[]; backupStatus: Row[]; mailEvents: Row[];
}

export function exportCopias(pass: string, version: string): { file: Buffer; counts: { origenes: number; copias: number; correos: number } } {
  const srv = db.select().from(servers).where(eq(servers.kind, 'mail')).all();
  const ids = new Set(srv.map((s) => s.id));
  const els = db.select().from(elements).all().filter((e) => ids.has(e.serverId) && (e.kind === 'server' || e.kind === 'backup'));
  const elIds = new Set(els.map((e) => e.id));
  const imap = getSetting<Row & { passwordEnc?: string }>('mail.imap');
  let imapPassword = '';
  try { if (imap?.passwordEnc) imapPassword = decrypt(imap.passwordEnc); } catch { /* clave antigua: sin contraseña */ }
  const { passwordEnc: _p, ...imapClean } = (imap ?? {}) as Row & { passwordEnc?: string };
  const bs = db.select().from(backupStatus).all().filter((b) => elIds.has(b.elementId));
  const me = db.select().from(mailEvents).all().filter((m) => elIds.has(m.elementId));
  const payload: Payload = {
    v: 1, kind: 'bckmon-export', app: version, at: Math.floor(Date.now() / 1000),
    imap: imap ? imapClean : null, imapPassword,
    excludedSenders: getSetting<string[]>('mail.excludedSenders') ?? [], formats: getSetting<unknown[]>('mail.formats') ?? [], ignored: getSetting<string[]>('mail.ignored') ?? [],
    filechecks: (getSetting<Row[]>('filechecks') ?? []).filter((c) => elIds.has(String(c.elementId))),
    servers: srv.map((s) => ({ id: s.id, name: s.name, backupMaxHours: s.backupMaxHours })),
    elements: els.map((e) => ({ id: e.id, serverId: e.serverId, parentId: e.parentId, kind: e.kind, externalId: e.externalId, name: e.name, alias: e.alias, monitored: e.monitored, info: e.info })),
    backupStatus: bs as unknown as Row[], mailEvents: me as unknown as Row[],
  };
  const salt = randomBytes(16), iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', kdf(pass, salt), iv);
  const ct = Buffer.concat([c.update(gzipSync(Buffer.from(JSON.stringify(payload)))), c.final()]);
  return { file: Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), ct]), counts: { origenes: srv.length, copias: els.filter((e) => e.kind === 'backup').length, correos: me.length } };
}

export interface ImportResult { origenes: number; copias: number; correos: number; correoConfigurado: boolean; comprobaciones: number; excluidos: number }

export function importCopias(file: Buffer, pass: string): ImportResult {
  if (file.length < MAGIC.length + 44 || !file.subarray(0, MAGIC.length).equals(MAGIC)) throw new BackupError('Este archivo no es una exportación de copias (se crea en la otra aplicación: Ajustes › Sistema)');
  let o = MAGIC.length;
  const salt = file.subarray(o, o += 16), iv = file.subarray(o, o += 12), tag = file.subarray(o, o += 16), ct = file.subarray(o);
  let p: Payload;
  try {
    const d = createDecipheriv('aes-256-gcm', kdf(pass, salt), iv);
    d.setAuthTag(tag);
    p = JSON.parse(gunzipSync(Buffer.concat([d.update(ct), d.final()])).toString('utf8'));
  } catch { throw new BackupError('Contraseña incorrecta o archivo dañado'); }
  if (p.kind !== 'bckmon-export' || !Array.isArray(p.servers) || !Array.isArray(p.elements)) throw new BackupError('El archivo no tiene el formato esperado');

  const res: ImportResult = { origenes: 0, copias: 0, correos: 0, correoConfigurado: false, comprobaciones: 0, excluidos: 0 };
  const sMap = new Map<string, string>(), eMap = new Map<string, string>();
  db.transaction((tx) => {
    // orígenes: si ya existe uno con el mismo nombre se reutiliza
    const cur = tx.select().from(servers).where(eq(servers.kind, 'mail')).all();
    for (const s of p.servers as { id: string; name: string; backupMaxHours?: number }[]) {
      const ex = cur.find((c) => norm(c.name) === norm(s.name));
      if (ex) { sMap.set(s.id, ex.id); continue; }
      const id = crypto.randomUUID();
      tx.insert(servers).values({
        id, name: s.name, baseUrl: `mail://${encodeURIComponent(s.name)}`, tokenId: 'mail', tokenSecretEnc: encrypt('mail'), status: 'online', kind: 'mail', source: 'manual',
        lastSeenAt: Math.floor(Date.now() / 1000), ...(s.backupMaxHours ? { backupMaxHours: s.backupMaxHours } : {}),
      }).run();
      sMap.set(s.id, id); res.origenes++;
    }
    // elementos: primero las raíces de cada origen, luego las copias
    const list = p.elements as { id: string; serverId: string; parentId: string | null; kind: 'server' | 'backup'; externalId: string; name: string; alias: string | null; monitored: boolean; info: Record<string, unknown> }[];
    for (const pass2 of ['server', 'backup'] as const) {
      for (const e of list.filter((x) => x.kind === pass2)) {
        const sid = sMap.get(e.serverId);
        if (!sid) continue;
        const parentNew = e.parentId ? eMap.get(e.parentId) ?? null : null;
        const found = tx.select().from(elements).where(and(eq(elements.serverId, sid), eq(elements.kind, e.kind), eq(elements.externalId, e.kind === 'server' ? sid : e.externalId))).get()
          ?? (e.kind === 'server' ? tx.select().from(elements).where(and(eq(elements.serverId, sid), eq(elements.kind, 'server'))).get() : undefined);
        if (found) { eMap.set(e.id, found.id); continue; }
        const id = crypto.randomUUID();
        tx.insert(elements).values({
          id, serverId: sid, parentId: parentNew, kind: e.kind, externalId: e.kind === 'server' ? sid : e.externalId, name: e.name, alias: e.alias ?? null,
          status: e.kind === 'server' ? 'running' : 'unknown', monitored: e.monitored ?? true, isNew: false, info: e.info ?? {},
        }).run();
        eMap.set(e.id, id);
        if (e.kind === 'backup') res.copias++;
      }
    }
    for (const b of p.backupStatus as (Row & { elementId: string })[]) {
      const el = eMap.get(b.elementId);
      if (!el || tx.select().from(backupStatus).where(eq(backupStatus.elementId, el)).get()) continue;
      tx.insert(backupStatus).values({ ...(b as object), elementId: el, serverId: sMap.get(String((b as Row).serverId)) ?? [...sMap.values()][0]! } as typeof backupStatus.$inferInsert).run();
    }
    for (const m of p.mailEvents as (Row & { elementId: string })[]) {
      const el = eMap.get(m.elementId);
      if (!el) continue;
      const { id: _id, ...rest } = m as Row;
      const r = tx.insert(mailEvents).values({ ...(rest as object), elementId: el } as typeof mailEvents.$inferInsert).onConflictDoNothing().run();
      if (r.changes) res.correos++;
    }
  });

  // ajustes
  const curImap = getSetting<{ host?: string }>('mail.imap');
  if (p.imap && !curImap?.host) {
    setSetting('mail.imap', { ...p.imap, passwordEnc: p.imapPassword ? encrypt(p.imapPassword) : '' });
    res.correoConfigurado = true;
  }
  const ex = getSetting<string[]>('mail.excludedSenders') ?? [];
  const exNew = [...new Set([...ex, ...(p.excludedSenders ?? [])])];
  res.excluidos = exNew.length - ex.length;
  if (res.excluidos) setSetting('mail.excludedSenders', exNew);
  const fm = getSetting<unknown[]>('mail.formats') ?? [];
  const seen = new Set(fm.map((f) => JSON.stringify(f)));
  const fmNew = [...fm, ...(p.formats ?? []).filter((f) => !seen.has(JSON.stringify(f)))];
  if (fmNew.length !== fm.length) setSetting('mail.formats', fmNew);
  const ig = getSetting<string[]>('mail.ignored') ?? [];
  const igNew = [...new Set([...ig, ...(p.ignored ?? []).map((k) => { const [sid, ...t] = k.split('|'); const n = sMap.get(sid ?? ''); return n ? `${n}|${t.join('|')}` : null; }).filter((k): k is string => !!k)])];
  if (igNew.length !== ig.length) setSetting('mail.ignored', igNew);
  const fc = getSetting<Row[]>('filechecks') ?? [];
  for (const c of p.filechecks ?? []) {
    const el = eMap.get(String(c.elementId));
    if (!el || fc.some((x) => x.elementId === el)) continue;
    fc.push({ ...c, elementId: el }); res.comprobaciones++;
  }
  if (res.comprobaciones) setSetting('filechecks', fc);
  return res;
}
