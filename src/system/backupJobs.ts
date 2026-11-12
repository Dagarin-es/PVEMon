/**
 * Copia de seguridad automática de la configuración a un destino: carpeta local, carpeta compartida SMB, SFTP, Dropbox o Google Drive.
 * Local = sistema de archivos del contenedor (puede ser una carpeta montada: NAS por NFS, disco USB…).
 * El resto va con rclone (instalado en la imagen); la configuración de rclone se pasa por variables de entorno, nunca se escribe a disco.
 * El archivo es el mismo .pvemonbak cifrado de «Descargar copia cifrada» (ver backup.ts).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { and, eq, isNotNull } from 'drizzle-orm';
import { getSetting, getTelegram, sendMail, sendTelegram, setSetting, systemLang } from '../alerts/notify.js';
import { decrypt, encrypt } from '../crypto.js';
import { db, schema } from '../db/index.js';
import { BRAND } from '../edition.js';
import { tf } from '../i18n.js';
import { VERSION } from '../version.js';
import { listExports, nfsListFiles, nfsMkdirs, nfsReadFile, nfsRemoveFile, nfsWriteFile, NfsError, browseNfs } from '../filecheck/nfs.js';
import { BackupError, exportBackup } from './backup.js';

export type DestType = 'local' | 'nfs' | 'smb' | 'sftp' | 'dropbox' | 'drive' | 'onedrive';
export const DEST_TYPES: DestType[] = ['local', 'nfs', 'smb', 'sftp', 'dropbox', 'drive', 'onedrive'];

/** Destino tal y como se guarda: las claves y el token, cifrados */
export interface Dest {
  type: DestType;
  path: string; // carpeta dentro del destino (en SMB, el primer tramo es el recurso compartido)
  host?: string; port?: number; user?: string; domain?: string;
  passEnc?: string; tokenEnc?: string;
  driveId?: string; driveType?: string; // OneDrive: se descubren al autorizar
}
/** Destino que llega de la pantalla: las claves en claro; vacío = conservar la guardada */
export interface DestIn { type: DestType; path: string; host?: string; port?: number; user?: string; domain?: string; pass?: string; token?: string; driveId?: string; driveType?: string }

export interface RunInfo { at: number; ok: boolean; msg: string; name?: string; size?: number; how: 'auto' | 'manual'; ms?: number }
export interface Cfg {
  enabled: boolean;
  dest: Dest;
  days: number[]; // 0 = domingo … 6 = sábado
  times: string[]; // HH:MM
  keep: number;
  passEnc?: string;
  lastSlot?: string; // «AAAA-MM-DD HH:MM» de la última hora programada ya atendida
  last?: RunInfo;
}
export const DEFAULT_CFG: Cfg = { enabled: false, dest: { type: 'local', path: '/backups' }, days: [1, 2, 3, 4, 5, 6, 0], times: ['03:00'], keep: 7 };

const KEY = 'backup.config', LOGKEY = 'backup.log';
export const getCfg = (): Cfg => { const c = getSetting<Cfg>(KEY); return { ...DEFAULT_CFG, ...(c ?? {}), dest: { ...DEFAULT_CFG.dest, ...(c?.dest ?? {}) } }; };
const putCfg = (c: Cfg) => setSetting(KEY, c);
export const getLog = (): RunInfo[] => getSetting<RunInfo[]>(LOGKEY) ?? [];
const pushLog = (r: RunInfo) => setSetting(LOGKEY, [r, ...getLog()].slice(0, 15));

export const TZ = process.env.TZ || 'Europe/Madrid';
const RCLONE = process.env.RCLONE_BIN || 'rclone';
const PREFIX = BRAND.name.toLowerCase();
const NAME_RE = new RegExp(`^${PREFIX}-\\d{8}-\\d{6}\\.pvemonbak$`);

/* ───────────── destino resuelto (con las claves ya descifradas) ───────────── */

export interface Resolved { type: DestType; path: string; host?: string; port?: number; user?: string; domain?: string; pass?: string; token?: string; driveId?: string; driveType?: string; /** guarda el token renovado por rclone (solo si es el destino guardado) */ persist?: (token: string) => void }

/** Une lo que llega de la pantalla con lo guardado (claves vacías = las guardadas, si el destino es el mismo) */
export function resolveDest(inp: DestIn | undefined, saved: Dest): Resolved {
  const d: DestIn = inp ?? { type: saved.type, path: saved.path, host: saved.host, port: saved.port, user: saved.user, domain: saved.domain };
  const same = d.type === saved.type && (d.host ?? '') === (saved.host ?? '') && (d.user ?? '') === (saved.user ?? '');
  const pass = d.pass ? d.pass : same && saved.passEnc ? decrypt(saved.passEnc) : undefined;
  const token = d.token ? d.token : d.type === saved.type && saved.tokenEnc ? decrypt(saved.tokenEnc) : undefined;
  const useSaved = !d.token && d.type === saved.type && !!saved.tokenEnc;
  return {
    type: d.type, path: d.path ?? '', host: d.host?.trim(), port: d.port, user: d.user?.trim(), domain: d.domain?.trim(), pass, token,
    driveId: d.driveId ?? (useSaved ? saved.driveId : undefined), driveType: d.driveType ?? (useSaved ? saved.driveType : undefined),
    persist: useSaved ? (t: string) => { const c = getCfg(); if (c.dest.type === saved.type) putCfg({ ...c, dest: { ...c.dest, tokenEnc: encrypt(t) } }); } : undefined,
  };
}

/* ───────────── rclone ───────────── */

function run(cmd: string, args: string[], env: Record<string, string>, opt: { input?: Buffer | string; timeoutMs?: number } = {}): Promise<{ out: string; err: string }> {
  return new Promise((resolve, reject) => {
    let p;
    try { p = spawn(cmd, args, { env: { PATH: process.env.PATH ?? '', HOME: tmpdir(), ...env }, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { reject(e); return; }
    let out = '', err = '', done = false;
    const t = setTimeout(() => { if (!done) { p.kill('SIGKILL'); fin(new BackupError('Se ha agotado el tiempo de espera del destino')); } }, opt.timeoutMs ?? 30_000);
    const fin = (e?: Error) => { if (done) return; done = true; clearTimeout(t); e ? reject(e) : resolve({ out, err }); };
    p.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    p.stderr.on('data', (d: Buffer) => { if (err.length < 8000) err += d.toString(); });
    p.on('error', (e: NodeJS.ErrnoException) => fin(e.code === 'ENOENT' ? new BackupError('rclone no está instalado en este contenedor (actualiza a la imagen nueva)') : e));
    p.on('close', (code) => code === 0 ? fin() : fin(new BackupError(cleanErr(err) || `rclone terminó con error ${code}`)));
    p.stdin.on('error', () => { /* si el proceso muere antes de leer, ya se informa en close */ });
    p.stdin.end(opt.input);
  });
}

/** Última línea útil del error de rclone, sin fecha ni nivel, para enseñarla al usuario */
function cleanErr(e: string): string {
  const lines = e.split('\n').map((l) => l.replace(/^\d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d\s+(ERROR|NOTICE|CRITICAL|Failed to [a-z ]+)\s*:?\s*/i, '').trim()).filter(Boolean);
  const l = [...lines].reverse().find((x) => !/^(Attempt|Errors:|Checks:|Transferred:|Elapsed)/i.test(x)) ?? lines.at(-1) ?? '';
  const map: [RegExp, string][] = [
    [/unable to authenticate|LOGON_FAILURE|permission denied \(publickey|invalid_grant|401|invalid credentials/i, 'Usuario o contraseña incorrectos (o la autorización de la cuenta ha caducado)'],
    [/connection refused/i, 'No se puede conectar: revisa la dirección y el puerto, y que el servicio esté activado en el equipo'],
    [/no such host|lookup .* on|name resolution/i, 'No se encuentra ese equipo: revisa la dirección'],
    [/i\/o timeout|timed out|deadline exceeded/i, 'El equipo no responde (tiempo agotado): revisa la dirección y el cortafuegos'],
    [/directory not found|object not found|STATUS_OBJECT_(PATH|NAME)_NOT_FOUND|no such file|STATUS_BAD_NETWORK_NAME|bad network name/i, 'No existe esa carpeta o ese recurso compartido'],
    [/STATUS_ACCESS_DENIED|access denied|insufficient permission|forbidden|403/i, 'No hay permiso para escribir en esa carpeta'],
  ];
  const all = lines.join(' ');
  return (map.find(([re]) => re.test(all))?.[1] ?? l).slice(0, 300);
}

async function obscure(pass: string): Promise<string> {
  const { out } = await run(RCLONE, ['obscure', '-'], {}, { input: pass });
  return out.trim();
}

/** Datos de la unidad de OneDrive (hacen falta para que rclone funcione): se piden a Microsoft con el token autorizado */
const MS_CLIENT = 'b15665d9-eda6-4092-8539-0eec376afd59'; // el mismo que usa rclone
export async function oneDriveInfo(tokenJson: string): Promise<{ driveId: string; driveType: string; token: string }> {
  let tk: { access_token?: string; refresh_token?: string; expiry?: string; token_type?: string };
  try { tk = JSON.parse(tokenJson); } catch { throw new BackupError('El token no es válido: pega el texto completo {"access_token":…} que muestra «rclone authorize»'); }
  let token = tokenJson;
  const expired = !tk.access_token || (tk.expiry && Date.parse(tk.expiry) - Date.now() < 60_000);
  try {
    if (expired) {
      if (!tk.refresh_token) throw new BackupError('El token de OneDrive ha caducado: vuelve a ejecutar «rclone authorize "onedrive"» y pega el nuevo');
      const r = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: MS_CLIENT, grant_type: 'refresh_token', refresh_token: tk.refresh_token, scope: 'Files.Read Files.ReadWrite Files.Read.All Files.ReadWrite.All Sites.Read.All offline_access' }), signal: AbortSignal.timeout(20_000) });
      const j = (await r.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!r.ok || !j.access_token) throw new BackupError('Microsoft no acepta el token (¿ha caducado o se ha revocado?): vuelve a autorizar la cuenta con «rclone authorize "onedrive"»');
      tk = { access_token: j.access_token, token_type: 'Bearer', refresh_token: j.refresh_token ?? tk.refresh_token, expiry: new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString() };
      token = JSON.stringify(tk);
    }
    const r = await fetch('https://graph.microsoft.com/v1.0/me/drive', { headers: { Authorization: 'Bearer ' + tk.access_token }, signal: AbortSignal.timeout(20_000) });
    const j = (await r.json()) as { id?: string; driveType?: string };
    if (!r.ok || !j.id) throw new BackupError('No se pudo leer la unidad de OneDrive de esa cuenta');
    return { driveId: j.id, driveType: j.driveType ?? 'personal', token };
  } catch (e) {
    if (e instanceof BackupError) throw e;
    throw new BackupError(`No se puede contactar con Microsoft: ${(e as Error).message}`);
  }
}

/** Variables de entorno de rclone y, para las cuentas en la nube, el texto de su archivo de configuración (con el token, que rclone renueva) */
async function remoteEnv(d: Resolved): Promise<{ env: Record<string, string>; conf?: string }> {
  const e: Record<string, string> = { RCLONE_CONFIG: '/nonexistent.conf', RCLONE_CONFIG_D_TYPE: d.type };
  const need = (v: string | undefined, msg: string) => { if (!v) throw new BackupError(msg); return v; };
  if (d.type === 'smb') {
    e.RCLONE_CONFIG_D_HOST = need(d.host, 'Falta la dirección del equipo (IP o nombre del NAS)');
    e.RCLONE_CONFIG_D_USER = need(d.user, 'Falta el usuario');
    if (d.port) e.RCLONE_CONFIG_D_PORT = String(d.port);
    if (d.domain) e.RCLONE_CONFIG_D_DOMAIN = d.domain;
    e.RCLONE_CONFIG_D_PASS = await obscure(need(d.pass, 'Falta la contraseña'));
  } else if (d.type === 'sftp') {
    e.RCLONE_CONFIG_D_HOST = need(d.host, 'Falta la dirección del equipo');
    e.RCLONE_CONFIG_D_USER = need(d.user, 'Falta el usuario');
    if (d.port) e.RCLONE_CONFIG_D_PORT = String(d.port);
    e.RCLONE_CONFIG_D_PASS = await obscure(need(d.pass, 'Falta la contraseña'));
    e.RCLONE_CONFIG_D_SHELL_TYPE = 'unix';
  } else if (d.type === 'dropbox' || d.type === 'drive' || d.type === 'onedrive') {
    let t = need(d.token, 'Falta autorizar la cuenta: pega el token que da «rclone authorize»').trim();
    try { const j = JSON.parse(t) as { access_token?: string; refresh_token?: string }; if (!j.access_token && !j.refresh_token) throw new Error('x'); }
    catch { throw new BackupError('El token no es válido: pega el texto completo {"access_token":…} que muestra «rclone authorize»'); }
    const lines = [`type = ${d.type}`];
    if (d.type === 'drive') lines.push('scope = drive');
    if (d.type === 'onedrive') {
      if (!d.driveId) { const i = await oneDriveInfo(t); d.driveId = i.driveId; d.driveType = i.driveType; t = i.token; d.token = t; }
      lines.push(`drive_id = ${d.driveId}`, `drive_type = ${d.driveType ?? 'personal'}`);
    }
    lines.push(`token = ${t}`);
    return { env: { RCLONE_CONFIG: '' }, conf: '[D]\n' + lines.join('\n') + '\n' };
  }
  return { env: e };
}

/** Ruta limpia dentro del destino: sin «..», sin barras repetidas */
const clean = (p: string) => posix.normalize('/' + (p ?? '').replace(/\\/g, '/')).replace(/^\/+/, '').replace(/\/+$/, '');
const localAbs = (p: string) => posix.resolve('/', (p ?? '').replace(/\\/g, '/') || '/');

export interface Entry { name: string; size?: number; mtime?: number }

/** Operaciones sobre un destino; todas reciben la carpeta como texto */
export interface Driver {
  dirs(path: string): Promise<string[]>;
  mkdir(path: string): Promise<void>;
  files(path: string): Promise<Entry[]>;
  put(path: string, name: string, data: Buffer): Promise<void>;
  get(path: string, name: string): Promise<Buffer>;
  del(path: string, name: string): Promise<void>;
}

const localDriver: Driver = {
  async dirs(p) {
    const d = localAbs(p);
    try {
      return readdirSync(d, { withFileTypes: true }).filter((x) => (x.isDirectory() || (x.isSymbolicLink() && safeIsDir(join(d, x.name)))) && !(d === '/' && ['proc', 'sys', 'dev'].includes(x.name))).map((x) => x.name).sort((a, b) => a.localeCompare(b));
    } catch (e) { throw new BackupError(`No se puede abrir la carpeta ${d}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`); }
  },
  async mkdir(p) { try { mkdirSync(localAbs(p), { recursive: true }); } catch (e) { throw new BackupError(`No se puede crear la carpeta: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`); } },
  async files(p) {
    const d = localAbs(p);
    try { return readdirSync(d).filter((n) => NAME_RE.test(n)).map((n) => { const s = statSync(join(d, n)); return { name: n, size: s.size, mtime: Math.floor(s.mtimeMs / 1000) }; }); }
    catch (e) { throw new BackupError(`No se puede leer la carpeta ${d}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`); }
  },
  async put(p, name, data) {
    const d = localAbs(p);
    try { mkdirSync(d, { recursive: true }); writeFileSync(join(d, name), data); }
    catch (e) { throw new BackupError(`No se puede escribir en ${d}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`); }
  },
  async get(p, name) { return readFileSync(join(localAbs(p), safeName(name))); },
  async del(p, name) { rmSync(join(localAbs(p), safeName(name)), { force: true }); },
};
function safeIsDir(p: string): boolean { try { return statSync(p).isDirectory(); } catch { return false; } }
function safeName(n: string): string { if (!NAME_RE.test(n)) throw new BackupError('Nombre de archivo no válido'); return n; }

function rcloneDriver(d: Resolved): Driver {
  const rem = (p: string, name?: string) => {
    const c = clean(p);
    return 'D:' + (d.type === 'sftp' ? '/' + c : c) + (name ? (c ? '/' : '') + name : '');
  };
  let envP: ReturnType<typeof remoteEnv> | undefined;
  const env = () => (envP ??= remoteEnv(d));
  /** Cada llamada usa un archivo de configuración temporal (solo para cuentas en la nube) y, al acabar, guarda el token si rclone lo ha renovado */
  const r = async (args: string[], o: { input?: Buffer; timeoutMs?: number } = {}) => {
    const { env: e, conf } = await env();
    const full = [...args, '--contimeout', '15s', '--low-level-retries', '1', '--retries', '1'];
    if (!conf) return run(RCLONE, full, e, o);
    const dir = mkdtempSync(join(tmpdir(), 'pvemon-rc-')), file = join(dir, 'rclone.conf');
    try {
      writeFileSync(file, conf, { mode: 0o600 });
      try { return await run(RCLONE, full, { ...e, RCLONE_CONFIG: file }, o); }
      finally {
        try {
          const m = /^token\s*=\s*(.+)$/m.exec(readFileSync(file, 'utf8'));
          const nt = m?.[1]?.trim();
          if (nt && nt !== d.token?.trim() && d.persist) { d.persist(nt); d.token = nt; }
        } catch { /* si no se puede leer, se sigue con el token anterior */ }
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  return {
    async dirs(p) {
      const { out } = await r(['lsjson', '--dirs-only', rem(p)]);
      return (JSON.parse(out || '[]') as { Name: string }[]).map((x) => x.Name).sort((a, b) => a.localeCompare(b));
    },
    async mkdir(p) { await r(['mkdir', rem(p)]); },
    async files(p) {
      const { out } = await r(['lsjson', '--files-only', rem(p)]);
      return (JSON.parse(out || '[]') as { Name: string; Size: number; ModTime: string }[]).filter((x) => NAME_RE.test(x.Name)).map((x) => ({ name: x.Name, size: x.Size, mtime: Math.floor(Date.parse(x.ModTime) / 1000) || undefined }));
    },
    async put(p, name, data) {
      await r(['mkdir', rem(p)]).catch(() => { /* si ya existe o no se puede crear, el envío dirá el motivo */ });
      await r(['rcat', rem(p, safeName(name))], { input: data, timeoutMs: 10 * 60_000 });
    },
    async get(p, name) {
      const dir = mkdtempSync(join(tmpdir(), 'pvemon-dl-'));
      try {
        const f = join(dir, 'in.bak');
        await r(['copyto', rem(p, safeName(name)), f], { timeoutMs: 10 * 60_000 });
        return readFileSync(f);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    },
    async del(p, name) { await r(['deletefile', rem(p, safeName(name))]); },
  };
}

/** Servidor NFS (v3), con el cliente propio de pvemon (no monta nada). La ruta es absoluta: «exportación/subcarpetas».
 *  Al principio (rutas por encima de las exportaciones) se muestran las exportaciones del servidor como carpetas. */
function nfsDriver(d: Resolved): Driver {
  const host = (d.host ?? '').trim();
  if (!host) throw new BackupError('Falta la dirección del servidor NFS');
  const wrap = async <T>(f: () => Promise<T>): Promise<T> => { try { return await f(); } catch (e) { throw e instanceof NfsError ? new BackupError(e.message) : e; } };
  const norm = (p: string) => '/' + clean(p);
  const locate = async (p: string): Promise<{ exp: string; sub: string }> => {
    const full = norm(p), exps = (await listExports(host)).map((x) => x.path.replace(/\/+$/, '') || '/');
    const e = exps.filter((x) => full === x || full.startsWith(x === '/' ? '/' : x + '/')).sort((a, b) => b.length - a.length)[0];
    if (!e) throw new BackupError('Esa carpeta no está exportada por el servidor NFS: elige una de las que aparecen en la lista');
    return { exp: e, sub: full.slice(e.length) };
  };
  return {
    async dirs(p) {
      return wrap(async () => {
        const full = norm(p), exps = (await listExports(host)).map((x) => x.path.replace(/\/+$/, '') || '/');
        const inside = exps.some((x) => full === x || full.startsWith(x === '/' ? '/' : x + '/'));
        if (inside) { const { exp, sub } = await locate(p); return (await browseNfs(host, exp, sub)).filter((e) => e.type === 'dir').map((e) => e.name); }
        const pre = full === '/' ? '/' : full + '/';
        const names = new Set(exps.filter((x) => x.startsWith(pre)).map((x) => x.slice(pre.length).split('/')[0]!).filter(Boolean));
        if (!names.size) throw new BackupError('El servidor NFS no publica ninguna carpeta aquí');
        return [...names].sort((a, b) => a.localeCompare(b));
      });
    },
    async mkdir(p) { return wrap(async () => { const { exp, sub } = await locate(p); await nfsMkdirs(host, exp, sub); }); },
    async files(p) {
      return wrap(async () => { const { exp, sub } = await locate(p); return (await nfsListFiles(host, exp, sub)).filter((f) => NAME_RE.test(f.name)).map((f) => ({ name: f.name, size: f.size, mtime: f.mtime })); });
    },
    async put(p, name, data) { return wrap(async () => { const { exp, sub } = await locate(p); await nfsWriteFile(host, exp, sub, safeName(name), data); }); },
    async get(p, name) { return wrap(async () => { const { exp, sub } = await locate(p); return nfsReadFile(host, exp, sub, safeName(name)); }); },
    async del(p, name) { return wrap(async () => { const { exp, sub } = await locate(p); await nfsRemoveFile(host, exp, sub, safeName(name)); }); },
  };
}

export const driverFor = (d: Resolved): Driver => (d.type === 'local' ? localDriver : d.type === 'nfs' ? nfsDriver(d) : rcloneDriver(d));

/* ───────────── ejecución ───────────── */

/** Nombre con la hora del servidor (la zona configurada), para que coincida con la que ve el usuario */
const fileName = (d = new Date()) => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return `${PREFIX}-${g('year')}${g('month')}${g('day')}-${g('hour')}${g('minute')}${g('second')}.pvemonbak`;
};

let busy = false;
export const isBusy = () => busy;

/** Hace una copia ahora, la sube al destino guardado y aplica la retención. Lanza error si algo falla. */
export async function runBackup(how: 'auto' | 'manual', logger?: FastifyBaseLogger): Promise<RunInfo> {
  if (busy) throw new BackupError('Ya hay una copia en marcha');
  busy = true;
  const t0 = Date.now();
  const c = getCfg();
  let info: RunInfo;
  try {
    if (!c.passEnc) throw new BackupError('Falta la contraseña con la que se cifran las copias');
    const drv = driverFor(resolveDest(undefined, c.dest));
    const data = await exportBackup(decrypt(c.passEnc), VERSION);
    const name = fileName();
    await drv.put(c.dest.path, name, data);
    try {
      const all = (await drv.files(c.dest.path)).sort((a, b) => b.name.localeCompare(a.name));
      for (const f of all.slice(Math.max(1, c.keep))) await drv.del(c.dest.path, f.name);
    } catch (e) { logger?.warn({ err: (e as Error).message }, 'copia: no se pudieron borrar las antiguas'); }
    info = { at: Math.floor(Date.now() / 1000), ok: true, msg: 'Copia subida', name, size: data.length, how, ms: Date.now() - t0 };
  } catch (e) {
    info = { at: Math.floor(Date.now() / 1000), ok: false, msg: (e as Error).message.slice(0, 400), how, ms: Date.now() - t0 };
  } finally { busy = false; }
  putCfg({ ...getCfg(), last: info });
  pushLog(info);
  if (!info.ok) { logger?.warn({ err: info.msg }, 'copia automática falló'); if (how === 'auto') void notifyFail(info.msg); throw new BackupError(info.msg); }
  logger?.info({ name: info.name, size: info.size }, 'copia a destino hecha');
  return info;
}

async function notifyFail(msg: string): Promise<void> {
  const lang = systemLang();
  const subject = tf('[pvemon] ⚠ La copia de seguridad automática ha fallado', lang);
  const text = tf('{0}\n\nRevisa el destino en Ajustes → Copia de seguridad.', lang, msg);
  try {
    const to = db.select({ email: schema.users.email }).from(schema.users).where(and(eq(schema.users.role, 'admin'), eq(schema.users.disabled, false), isNotNull(schema.users.email))).all();
    for (const u of to) await sendMail(u.email!, subject, text).catch(() => { /* sin SMTP no hay correo */ });
    const t = getTelegram();
    if (t?.enabled && t.tokenEnc && t.chatId) await sendTelegram(`${subject}\n\n${text}`, { token: decrypt(t.tokenEnc), chatId: t.chatId }).catch(() => { /* idem */ });
  } catch { /* un aviso que falla no debe tumbar nada */ }
}

/* ───────────── programación ───────────── */

export function localNow(at = new Date()): { date: string; day: number; hm: string } {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(at);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return { date: `${g('year')}-${g('month')}-${g('day')}`, day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday')), hm: `${g('hour')}:${g('minute')}` };
}

/** Última hora programada de HOY que ya ha pasado («AAAA-MM-DD HH:MM»), o null */
export function dueSlot(c: Pick<Cfg, 'days' | 'times'>, now = localNow()): string | null {
  if (!c.days.includes(now.day)) return null;
  const t = [...c.times].sort().filter((x) => x <= now.hm).at(-1);
  return t ? `${now.date} ${t}` : null;
}

export function startBackupJobs(logger: FastifyBaseLogger): () => void {
  const t = setInterval(() => {
    const c = getCfg();
    if (!c.enabled || busy) return;
    const slot = dueSlot(c);
    if (!slot || slot <= (c.lastSlot ?? '')) return; // si estaba apagado a la hora, sale en cuanto arranca ese día
    putCfg({ ...c, lastSlot: slot });
    void runBackup('auto', logger).catch(() => { /* ya registrado y avisado */ });
  }, 30_000);
  return () => clearInterval(t);
}

/** Mayor hueco, en horas, entre dos copias programadas seguidas a lo largo de la semana */
function maxGapHours(c: Pick<Cfg, 'days' | 'times'>): number | null {
  const slots: number[] = [];
  for (const d of c.days) for (const t of c.times) { const [h, m] = t.split(':').map(Number); slots.push(d * 1440 + h! * 60 + m!); }
  slots.sort((a, b) => a - b);
  if (!slots.length) return null;
  let gap = slots.length === 1 ? 7 * 1440 : 0;
  for (let i = 0; i < slots.length; i++) gap = Math.max(gap, ((slots[(i + 1) % slots.length]! - slots[i]! + 7 * 1440) % (7 * 1440)) || 7 * 1440);
  return gap / 60;
}

/** Estado de la copia de la propia aplicación, para enseñarla en el panel Backups como una copia más (null = todavía no se ha usado) */
export function selfStatus() {
  const c = getCfg(), log = getLog();
  if (!c.enabled && !c.last && !log.length) return null;
  const lastOk = c.last?.ok ? c.last : log.find((r) => r.ok);
  const gap = c.enabled ? maxGapHours(c) : null;
  const maxHours = gap == null ? null : Math.ceil(gap + 3); // 3 h de margen por si tarda o el servidor estaba apagado
  const now = Math.floor(Date.now() / 1000);
  let state: 'ok' | 'error' | 'stale' | 'none' = 'ok', message: string | undefined;
  if (c.last && !c.last.ok) { state = 'error'; message = c.last.msg; }
  else if (!lastOk) state = 'none';
  else if (maxHours && now - lastOk.at > maxHours * 3600) { state = 'stale'; message = 'Hace más tiempo del previsto que no se hace una copia'; }
  return { state, message, lastOkAt: lastOk?.at ?? null, lastOkSize: lastOk?.size ?? null, maxHours, monitored: c.enabled, dest: c.dest.type };
}

/* ───────────── lo que ve la pantalla (sin claves) ───────────── */

export function view() {
  const c = getCfg();
  const { passEnc, tokenEnc, ...d } = c.dest;
  return {
    enabled: c.enabled, days: c.days, times: c.times, keep: c.keep, hasPass: !!c.passEnc,
    dest: { ...d, hasPass: !!passEnc, hasToken: !!tokenEnc },
    last: c.last ?? null, log: getLog(), running: busy,
    tz: TZ, now: localNow(), next: nextSlot(c),
  };
}

/** Próxima copia programada, para enseñarla («AAAA-MM-DD HH:MM», hora del servidor) */
function nextSlot(c: Cfg): string | null {
  if (!c.enabled || !c.times.length || !c.days.length) return null;
  const now = localNow();
  for (let i = 0; i < 8; i++) {
    const at = new Date(Date.now() + i * 86400_000), n = localNow(at);
    if (!c.days.includes(n.day)) continue;
    const t = [...c.times].sort().find((x) => i > 0 || x > now.hm);
    if (t) return `${n.date} ${t}`;
  }
  return null;
}

export interface CfgIn { enabled: boolean; dest: DestIn; days: number[]; times: string[]; keep: number; passphrase?: string }

/** Guarda la configuración conservando las claves que no se hayan vuelto a escribir */
export function saveCfg(inp: CfgIn): void {
  const old = getCfg();
  const dest: Dest = { type: inp.dest.type, path: inp.dest.path, host: inp.dest.host?.trim() || undefined, port: inp.dest.port || undefined, user: inp.dest.user?.trim() || undefined, domain: inp.dest.domain?.trim() || undefined };
  const same = dest.type === old.dest.type && (dest.host ?? '') === (old.dest.host ?? '') && (dest.user ?? '') === (old.dest.user ?? '');
  if (inp.dest.pass) dest.passEnc = encrypt(inp.dest.pass); else if (same && old.dest.passEnc) dest.passEnc = old.dest.passEnc;
  if (inp.dest.token) dest.tokenEnc = encrypt(inp.dest.token.trim()); else if (dest.type === old.dest.type && old.dest.tokenEnc) dest.tokenEnc = old.dest.tokenEnc;
  if (dest.type === 'onedrive') { dest.driveId = inp.dest.driveId ?? (inp.dest.token ? undefined : old.dest.driveId); dest.driveType = inp.dest.driveType ?? (inp.dest.token ? undefined : old.dest.driveType); }
  const days = [...new Set(inp.days)].sort(), times = [...new Set(inp.times)].sort();
  // al guardar, las horas que ya han pasado hoy no cuentan como atrasadas: solo salen las próximas
  const next: Cfg = { ...old, enabled: inp.enabled, dest, days, times, keep: inp.keep, passEnc: inp.passphrase ? encrypt(inp.passphrase) : old.passEnc };
  next.lastSlot = dueSlot(next) ?? old.lastSlot;
  putCfg(next);
}
