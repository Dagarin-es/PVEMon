/**
 * Cliente NFSv3 mínimo, solo lectura de metadatos (existe / tamaño / fecha), sin montar nada.
 * Así funciona dentro del contenedor sin privilegios especiales: habla directamente con portmap (111), mountd y nfsd por TCP.
 * Intenta salir desde un puerto reservado (<1024), que es lo que muchos NAS exigen por defecto.
 */
import net from 'node:net';

export class NfsError extends Error {
  constructor(message: string, readonly code: 'connect' | 'export' | 'denied' | 'notfound' | 'notfile' | 'proto' = 'proto') { super(message); }
}

const TIMEOUT_MS = 8000;

/* ───────── XDR ───────── */
class W {
  private b: Buffer[] = [];
  u32(v: number) { const x = Buffer.alloc(4); x.writeUInt32BE(v >>> 0); this.b.push(x); return this; }
  opaque(d: Buffer) { this.u32(d.length); this.b.push(d); const p = (4 - (d.length % 4)) % 4; if (p) this.b.push(Buffer.alloc(p)); return this; }
  str(s: string) { return this.opaque(Buffer.from(s, 'utf8')); }
  raw(d: Buffer) { this.b.push(d); return this; }
  done() { return Buffer.concat(this.b); }
}
class R {
  constructor(private b: Buffer, public o = 0) {}
  u32() { if (this.o + 4 > this.b.length) throw new NfsError('Respuesta corta del servidor NFS'); const v = this.b.readUInt32BE(this.o); this.o += 4; return v; }
  u64() { const hi = this.u32(), lo = this.u32(); return hi * 2 ** 32 + lo; }
  fixed(n: number) { if (this.o + n > this.b.length) throw new NfsError('Respuesta corta del servidor NFS'); const d = this.b.subarray(this.o, this.o + n); this.o += n; return d; }
  opaque() { const n = this.u32(); if (this.o + n > this.b.length) throw new NfsError('Respuesta corta del servidor NFS'); const d = this.b.subarray(this.o, this.o + n); this.o += n + ((4 - (n % 4)) % 4); return d; }
}

/* ───────── RPC sobre TCP ───────── */
function connect(host: string, port: number): Promise<net.Socket> {
  const tryPort = (localPort?: number) => new Promise<net.Socket>((resolve, reject) => {
    const s = net.connect({ host, port, ...(localPort ? { localPort } : {}) });
    const t = setTimeout(() => { s.destroy(); reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })); }, TIMEOUT_MS);
    s.once('connect', () => { clearTimeout(t); resolve(s); });
    s.once('error', (e) => { clearTimeout(t); reject(e); });
  });
  return (async () => {
    // puerto de origen reservado (hace falta ser root, como en el contenedor); si no se puede, uno normal
    const start = 1023 - Math.floor(Math.random() * 100);
    for (let i = 0; i < 12; i++) {
      try { return await tryPort(start - i); } catch (e) {
        const c = (e as NodeJS.ErrnoException).code;
        if (c === 'EACCES' || c === 'EPERM') break;
        if (c !== 'EADDRINUSE' && c !== 'EADDRNOTAVAIL') throw e;
      }
    }
    return tryPort();
  })();
}

let xidSeq = Math.floor(Math.random() * 1e9);
async function rpcCall(host: string, port: number, prog: number, vers: number, proc: number, args: Buffer, sock?: net.Socket): Promise<{ r: R; sock: net.Socket }> {
  const s = sock ?? (await connect(host, port));
  const xid = ++xidSeq >>> 0;
  const m = new W().u32(xid).u32(0).u32(2).u32(prog).u32(vers).u32(proc)
    .u32(1).opaque(new W().u32(0).str('pvemon').u32(0).u32(0).u32(0).done()) // AUTH_SYS (uid 0)
    .u32(0).u32(0) // verificador: AUTH_NONE
    .raw(args).done();
  const frame = Buffer.concat([Buffer.from([0x80 | ((m.length >>> 24) & 0x7f), (m.length >>> 16) & 255, (m.length >>> 8) & 255, m.length & 255]), m]);
  const reply = await new Promise<Buffer>((resolve, reject) => {
    let buf = Buffer.alloc(0), parts: Buffer[] = [];
    const t = setTimeout(() => { cleanup(); reject(new NfsError('El servidor NFS no responde', 'connect')); }, TIMEOUT_MS);
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4) {
        const h = buf.readUInt32BE(0), len = h & 0x7fffffff, last = (h & 0x80000000) !== 0;
        if (buf.length < 4 + len) return;
        parts.push(buf.subarray(4, 4 + len)); buf = buf.subarray(4 + len);
        if (last) { cleanup(); resolve(Buffer.concat(parts)); return; }
      }
    };
    const onErr = (e: Error) => { cleanup(); reject(new NfsError(`Conexión NFS fallida: ${e.message}`, 'connect')); };
    const onEnd = () => { cleanup(); reject(new NfsError('El servidor NFS cerró la conexión', 'connect')); };
    const cleanup = () => { clearTimeout(t); s.off('data', onData); s.off('error', onErr); s.off('close', onEnd); };
    s.on('data', onData); s.once('error', onErr); s.once('close', onEnd);
    s.write(frame);
  });
  const r = new R(reply);
  if (r.u32() !== xid) throw new NfsError('Respuesta NFS que no corresponde');
  if (r.u32() !== 1) throw new NfsError('Respuesta RPC no válida');
  if (r.u32() !== 0) { // MSG_DENIED
    const why = r.u32();
    throw new NfsError(why === 1 ? 'El servidor NFS rechaza la autenticación (¿exportación restringida a otras IP o a puertos reservados?)' : 'El servidor NFS rechazó la llamada', 'denied');
  }
  r.u32(); r.opaque(); // verificador
  const acc = r.u32();
  if (acc === 1) throw new NfsError('El servidor NFS no ofrece ese servicio (NFSv3). ¿Solo tiene NFSv4?', 'proto');
  if (acc === 2) throw new NfsError('Versión de NFS no compatible: pvemon necesita NFSv3', 'proto');
  if (acc !== 0) throw new NfsError('Error RPC en el servidor NFS');
  return { r, sock: s };
}

async function getPort(host: string, prog: number, vers: number): Promise<number | null> {
  const a = new W().u32(prog).u32(vers).u32(6).u32(0).done();
  const { r, sock } = await rpcCall(host, 111, 100000, 2, 3, a);
  sock.destroy();
  const p = r.u32();
  return p || null;
}

export interface NfsFile { size: number; mtime: number }
export interface NfsEntry { name: string; type: 'dir' | 'file' | 'other'; size: number; mtime: number }

const NFS3 = 100003, MOUNT = 100005;
const NFSERR: Record<number, [string, NfsError['code']]> = {
  1: ['Sin permiso (el servidor NFS no deja ver este archivo)', 'denied'], 28: ['No queda espacio en el servidor NFS', 'proto'], 30: ['El servidor NFS contesta «sistema de archivos de solo lectura»: la regla NFS que se aplica a la IP de pvemon no permite escribir (en Synology, mira el permiso de esa regla y que no haya otra regla anterior, por subred, que sea de solo lectura)', 'denied'], 2: ['No existe', 'notfound'], 13: ['Acceso denegado en el servidor NFS', 'denied'],
  20: ['La ruta pasa por algo que no es una carpeta', 'notfound'], 70: ['Referencia caducada en el servidor NFS', 'proto'], 10001: ['Acceso denegado en el servidor NFS', 'denied'],
};
const nfsErr = (st: number, what: string) => { const [m, c] = NFSERR[st] ?? [`Error NFS ${st}`, 'proto']; return new NfsError(`${what}: ${m}`, c); };

type Attr = { type: number; size: number; mtime: number };
function parseFattr(r: R): Attr {
  const type = r.u32(); r.u32(); r.u32(); r.u32(); r.u32();
  const size = r.u64(); r.u64(); r.u32(); r.u32(); r.u64(); r.u64();
  r.u32(); r.u32(); // atime
  const mtime = r.u32(); r.u32();
  r.u32(); r.u32(); // ctime
  return { type, size, mtime };
}
const postOpAttr = (r: R) => (r.u32() ? parseFattr(r) : null);
const typeName = (t: number): NfsEntry['type'] => (t === 2 ? 'dir' : t === 1 ? 'file' : 'other');

const portsFor = async (host: string) => {
  try { return [await getPort(host, MOUNT, 3), await getPort(host, NFS3, 3)] as const; } catch (e) {
    if (e instanceof NfsError) throw e;
    throw new NfsError(`No se pudo contactar con ${host}: ${(e as Error).message}`, 'connect');
  }
};

/** Exportaciones que publica el servidor (lo que se ve con «showmount -e») */
export async function listExports(host: string): Promise<{ path: string; groups: string[] }[]> {
  const [mountPort] = await portsFor(host);
  if (!mountPort) throw new NfsError('El servidor no ofrece NFSv3 (mountd). Activa NFSv3 en el NAS', 'proto');
  const sock = await connect(host, mountPort).catch((e: Error) => { throw new NfsError(`No se pudo conectar con mountd: ${e.message}`, 'connect'); });
  try {
    const { r } = await rpcCall(host, mountPort, MOUNT, 3, 5, Buffer.alloc(0), sock);
    const out: { path: string; groups: string[] }[] = [];
    while (r.u32() === 1 && out.length < 500) {
      const path = r.opaque().toString('utf8'), groups: string[] = [];
      while (r.u32() === 1 && groups.length < 200) groups.push(r.opaque().toString('utf8'));
      out.push({ path, groups });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  } finally { sock.destroy(); }
}

interface Sess {
  call(proc: number, args: Buffer): Promise<R>;
  walk(parts: string[]): Promise<{ fh: Buffer; attrs: Attr | null }>;
  getattr(fh: Buffer): Promise<Attr>;
  readdir(fh: Buffer): Promise<NfsEntry[]>;
}

/** Monta (solo a nivel de protocolo) una exportación y ejecuta fn con ella */
async function withExport<T>(host: string, exportPath: string, fn: (s: Sess) => Promise<T>): Promise<T> {
  const [mountPort, nfsPortRaw] = await portsFor(host);
  const nfsPort = nfsPortRaw ?? 2049;
  if (!mountPort) throw new NfsError('El servidor no ofrece NFSv3 (mountd). Activa NFSv3 en el NAS', 'proto');
  const mountSock = await connect(host, mountPort).catch((e: Error) => { throw new NfsError(`No se pudo conectar con mountd: ${e.message}`, 'connect'); });
  let root: Buffer;
  try {
    const { r } = await rpcCall(host, mountPort, MOUNT, 3, 1, new W().str(exportPath).done(), mountSock);
    const st = r.u32();
    if (st === 2 || st === 20) throw new NfsError(`La carpeta ${exportPath} no está exportada por el servidor`, 'export');
    if (st === 13 || st === 1) throw new NfsError('El servidor NFS no deja acceder a esa carpeta: comprueba que está exportada tal como la has escrito y que la IP de pvemon está permitida en las reglas NFS del NAS', 'denied');
    if (st !== 0) throw new NfsError(`El servidor rechazó la carpeta (código ${st})`, 'export');
    root = Buffer.from(r.opaque());
  } finally { mountSock.destroy(); }
  const sock = await connect(host, nfsPort).catch((e: Error) => { throw new NfsError(`No se pudo conectar con el servicio NFS: ${e.message}`, 'connect'); });
  const call = async (proc: number, args: Buffer) => (await rpcCall(host, nfsPort, NFS3, 3, proc, args, sock)).r;
  const getattr = async (fh: Buffer) => {
    const r = await call(1, new W().opaque(fh).done());
    const st = r.u32();
    if (st !== 0) throw nfsErr(st, 'La ruta');
    return parseFattr(r);
  };
  const lookup = async (fh: Buffer, name: string) => {
    const r = await call(3, new W().opaque(fh).str(name).done());
    const st = r.u32();
    if (st !== 0) return { st };
    const nfh = Buffer.from(r.opaque());
    return { st, fh: nfh, attrs: postOpAttr(r) };
  };
  const sess: Sess = {
    call, getattr,
    async walk(parts) {
      let fh = root, attrs: Attr | null = null;
      for (let i = 0; i < parts.length; i++) {
        const l = await lookup(fh, parts[i]!);
        if (l.st !== 0) throw nfsErr(l.st, i === parts.length - 1 ? 'La ruta' : `La carpeta «${parts[i]}»`);
        fh = l.fh!; attrs = l.attrs ?? null;
      }
      if (!attrs) attrs = await getattr(fh);
      return { fh, attrs };
    },
    async readdir(fh) {
      const out: NfsEntry[] = [];
      let cookie = 0, verf = Buffer.alloc(8), plus = true;
      for (let page = 0; page < 200 && out.length < 5000; page++) {
        const hi = Math.floor(cookie / 2 ** 32), lo = cookie % 2 ** 32;
        const r = await call(plus ? 17 : 16, plus ? new W().opaque(fh).u32(hi).u32(lo).raw(verf).u32(8192).u32(65536).done() : new W().opaque(fh).u32(hi).u32(lo).raw(verf).u32(16384).done());
        const st = r.u32();
        if (st === 10004 && plus) { plus = false; page--; continue; } // sin READDIRPLUS: se usa READDIR
        if (st !== 0) throw nfsErr(st, 'La carpeta');
        postOpAttr(r);
        verf = Buffer.from(r.fixed(8));
        const batch: { name: string; attrs: Attr | null; fh: Buffer | null }[] = [];
        while (r.u32() === 1) {
          r.u64();
          const name = r.opaque().toString('utf8');
          const c = r.u64();
          let attrs: Attr | null = null, nfh: Buffer | null = null;
          if (plus) { attrs = postOpAttr(r); if (r.u32()) nfh = Buffer.from(r.opaque()); }
          cookie = c;
          if (name !== '.' && name !== '..') batch.push({ name, attrs, fh: nfh });
        }
        const eof = r.u32() === 1;
        for (const b of batch) {
          let attrs = b.attrs;
          if (!attrs) { const l = await lookup(fh, b.name); if (l.st !== 0) continue; attrs = l.attrs ?? (await getattr(l.fh!)); }
          out.push({ name: b.name, type: typeName(attrs.type), size: attrs.size, mtime: attrs.mtime });
        }
        if (eof || !batch.length) break;
      }
      return out;
    },
  };
  try { return await fn(sess); } finally { sock.destroy(); }
}

const split = (p: string) => p.split('/').filter(Boolean);

/** Comprueba un archivo de una exportación NFSv3 (ruta dentro de la exportación, con subcarpetas si hace falta) */
export async function statNfsFile(host: string, exportPath: string, file: string): Promise<NfsFile> {
  const parts = split(file);
  if (!parts.length) throw new NfsError('Falta el archivo a comprobar', 'notfound');
  return withExport(host, exportPath, async (s) => {
    const { attrs } = await s.walk(parts);
    if (!attrs || attrs.type !== 1) throw new NfsError('La ruta indicada no es un archivo (es una carpeta u otro tipo)', 'notfile');
    return { size: attrs.size, mtime: attrs.mtime };
  });
}

/** El archivo más reciente (por fecha de modificación) de una carpeta; no entra en subcarpetas ni cuenta los ocultos (.algo) */
/** Patrón con comodines (* = cualquier texto, ? = un carácter) → expresión regular; sin distinguir mayúsculas */
export const hasWildcard = (s: string) => /[*?]/.test(s);
export function globToRegex(pattern: string): RegExp {
  const re = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${re}$`, 'i');
}

/** Archivo más reciente de una carpeta; con «pattern» (comodines), solo entre los que coinciden con el nombre */
export async function statNfsNewest(host: string, exportPath: string, dir: string, pattern?: string): Promise<NfsFile & { name: string; files: number }> {
  return withExport(host, exportPath, async (s) => {
    const { fh, attrs } = await s.walk(split(dir));
    if (!attrs || attrs.type !== 2) throw new NfsError('La ruta indicada no es una carpeta', 'notfile');
    const rx = pattern ? globToRegex(pattern) : null;
    const files = (await s.readdir(fh)).filter((e) => e.type === 'file' && !e.name.startsWith('.') && (!rx || rx.test(e.name)));
    if (!files.length) throw new NfsError(pattern ? `Ningún archivo de la carpeta coincide con «${pattern}»` : 'La carpeta no tiene ningún archivo', 'notfound');
    const best = files.reduce((a, b) => (b.mtime > a.mtime ? b : a));
    return { name: best.name, size: best.size, mtime: best.mtime, files: files.length };
  });
}

/** Contenido de una carpeta, para el navegador de la pantalla */
export async function browseNfs(host: string, exportPath: string, dir: string): Promise<NfsEntry[]> {
  return withExport(host, exportPath, async (s) => {
    const { fh, attrs } = await s.walk(split(dir));
    if (!attrs || attrs.type !== 2) throw new NfsError('La ruta indicada no es una carpeta', 'notfile');
    return (await s.readdir(fh))
      .filter((e) => !e.name.startsWith('.') && e.type !== 'other')
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'es') : a.type === 'dir' ? -1 : 1));
  });
}


/* ───────── escritura (copias automáticas a un servidor NFS) ───────── */

/** sattr3 con permisos (modo) y nada más */
const sattrMode = (mode: number) => new W().u32(1).u32(mode).u32(0).u32(0).u32(0).u32(0).u32(0).done();
const CHUNK = 32768;

/** Busca la carpeta; si «create», crea las que falten */
async function dirFh(s: Sess, parts: string[], create: boolean): Promise<Buffer> {
  let fh = (await s.walk([])).fh;
  for (const name of parts) {
    let r = await s.call(3, new W().opaque(fh).str(name).done());
    let st = r.u32();
    if (st === 2 && create) {
      r = await s.call(9, new W().opaque(fh).str(name).raw(sattrMode(0o755)).done());
      st = r.u32();
      if (st !== 0) throw nfsErr(st, `No se pudo crear la carpeta «${name}»`);
      if (!r.u32()) { r = await s.call(3, new W().opaque(fh).str(name).done()); st = r.u32(); if (st !== 0) throw nfsErr(st, `La carpeta «${name}»`); }
      fh = Buffer.from(r.opaque());
      continue;
    }
    if (st !== 0) throw nfsErr(st, `La carpeta «${name}»`);
    fh = Buffer.from(r.opaque());
  }
  return fh;
}

/** Crea la carpeta (y las intermedias) dentro de la exportación */
export async function nfsMkdirs(host: string, exportPath: string, dir: string): Promise<void> {
  await withExport(host, exportPath, async (s) => { await dirFh(s, split(dir), true); });
}

/** Archivos de una carpeta con tamaño y fecha */
export async function nfsListFiles(host: string, exportPath: string, dir: string): Promise<NfsEntry[]> {
  return withExport(host, exportPath, async (s) => {
    const fh = await dirFh(s, split(dir), false);
    return (await s.readdir(fh)).filter((e) => e.type === 'file');
  });
}

/** Escribe un archivo nuevo (crea la carpeta si falta) */
export async function nfsWriteFile(host: string, exportPath: string, dir: string, name: string, data: Buffer): Promise<void> {
  await withExport(host, exportPath, async (s) => {
    const d = await dirFh(s, split(dir), true);
    let r = await s.call(8, new W().opaque(d).str(name).u32(0).raw(sattrMode(0o644)).done()); // CREATE (UNCHECKED)
    let st = r.u32();
    if (st !== 0) throw nfsErr(st, 'No se pudo crear el archivo');
    let fh = r.u32() ? Buffer.from(r.opaque()) : null;
    if (!fh) { r = await s.call(3, new W().opaque(d).str(name).done()); st = r.u32(); if (st !== 0) throw nfsErr(st, 'El archivo'); fh = Buffer.from(r.opaque()); }
    for (let off = 0; off < data.length;) {
      const part = data.subarray(off, off + CHUNK);
      const w = await s.call(7, new W().opaque(fh).u32(Math.floor(off / 2 ** 32)).u32(off % 2 ** 32).u32(part.length).u32(2).opaque(part).done()); // WRITE, FILE_SYNC
      st = w.u32();
      if (st !== 0) throw nfsErr(st, 'No se pudo escribir en el archivo');
      const wcc = w.u32(); if (wcc) { /* pre_op_attr */ w.u64(); w.u32(); w.u32(); w.u32(); w.u32(); }
      postOpAttr(w);
      const n = w.u32();
      if (!n) throw new NfsError('El servidor NFS no escribe datos en el archivo', 'proto');
      off += n;
    }
  });
}

/** Lee un archivo entero */
export async function nfsReadFile(host: string, exportPath: string, dir: string, name: string): Promise<Buffer> {
  return withExport(host, exportPath, async (s) => {
    const d = await dirFh(s, split(dir), false);
    const l = await s.call(3, new W().opaque(d).str(name).done());
    const ls = l.u32();
    if (ls !== 0) throw nfsErr(ls, 'El archivo');
    const fh = Buffer.from(l.opaque());
    const out: Buffer[] = [];
    let off = 0;
    for (let i = 0; i < 100000; i++) {
      const r = await s.call(6, new W().opaque(fh).u32(Math.floor(off / 2 ** 32)).u32(off % 2 ** 32).u32(CHUNK).done());
      const st = r.u32();
      if (st !== 0) throw nfsErr(st, 'No se pudo leer el archivo');
      postOpAttr(r);
      r.u32();
      const eof = r.u32() === 1, part = r.opaque();
      out.push(Buffer.from(part)); off += part.length;
      if (eof || !part.length) break;
    }
    return Buffer.concat(out);
  });
}

/** Borra un archivo (si no existe, no es error) */
export async function nfsRemoveFile(host: string, exportPath: string, dir: string, name: string): Promise<void> {
  await withExport(host, exportPath, async (s) => {
    const d = await dirFh(s, split(dir), false);
    const r = await s.call(12, new W().opaque(d).str(name).done());
    const st = r.u32();
    if (st !== 0 && st !== 2) throw nfsErr(st, 'No se pudo borrar el archivo');
  });
}
