import { isIP } from 'node:net';
import tls from 'node:tls';
import { Agent, buildConnector, fetch } from 'undici';

export interface PveConn {
  baseUrl: string;
  tokenId: string; // usuario@realm!nombre
  tokenSecret: string;
  verifyTls: boolean; // true = certificado válido (CA); false = fijado por huella
  fingerprint?: string | null;
}

export class PveError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

/** Acepta "192.168.1.10", "pve.local:8006" o una URL completa. Sin esquema asume https y puerto 8006. */
export function normalizeBaseUrl(input: string): string {
  let s = input.trim();
  const hadScheme = /^https?:\/\//i.test(s);
  if (!hadScheme) s = `https://${s}`;
  let u: URL;
  try { u = new URL(s); } catch { throw new PveError('La dirección no es válida'); }
  if (u.protocol !== 'https:') throw new PveError('Proxmox debe contactarse por https');
  if (!hadScheme && !u.port) u.port = '8006';
  return u.origin;
}

/** Lee la huella SHA-256 del certificado presentado (primer contacto, como SSH). */
export function probeFingerprint(baseUrl: string): Promise<string> {
  const u = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const sock = tls.connect(
      {
        host: u.hostname,
        port: Number(u.port || 443),
        servername: isIP(u.hostname) ? undefined : u.hostname,
        rejectUnauthorized: false,
        timeout: 8000,
      },
      () => {
        const fp = sock.getPeerCertificate().fingerprint256;
        sock.end();
        fp ? resolve(fp) : reject(new PveError('El Proxmox no presentó certificado'));
      },
    );
    sock.on('timeout', () => { sock.destroy(); reject(new PveError('Tiempo de espera agotado al conectar')); });
    sock.on('error', (e) => reject(new PveError(`No se pudo conectar: ${e.message}`)));
  });
}

export interface CertInfo { fingerprint: string; trusted: boolean; subject: string; issuer: string; validTo: string }

/** Datos del certificado que presenta el servidor, para que el administrador confirme la huella antes de fiarse. */
export function probeCert(baseUrl: string): Promise<CertInfo> {
  const u = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const sock = tls.connect(
      { host: u.hostname, port: Number(u.port || 443), servername: isIP(u.hostname) ? undefined : u.hostname, rejectUnauthorized: false, timeout: 8000 },
      () => {
        const c = sock.getPeerCertificate();
        const trusted = sock.authorized;
        sock.end();
        if (!c?.fingerprint256) return reject(new PveError('El Proxmox no presentó certificado'));
        resolve({
          fingerprint: c.fingerprint256, trusted,
          subject: String(c.subject?.CN ?? ''), issuer: String(c.issuer?.CN ?? c.issuer?.O ?? ''), validTo: String(c.valid_to ?? ''),
        });
      },
    );
    sock.on('timeout', () => { sock.destroy(); reject(new PveError('Tiempo de espera agotado: ¿llega pvemon a esa dirección?')); });
    sock.on('error', (e) => reject(new PveError(`No se pudo conectar: ${e.message}`)));
  });
}

function makeDispatcher(c: PveConn): Agent {
  if (c.verifyTls) return new Agent({ connect: { timeout: 8000 } });
  const pinned = c.fingerprint?.toUpperCase();
  const connector = buildConnector({
    rejectUnauthorized: false,
    timeout: 8000,
    // Sin reanudar sesiones TLS: al reanudar, Node no expone el certificado y no se podría comprobar la huella.
    maxCachedSessions: 0,
  });
  return new Agent({
    connect: (opts, cb) =>
      connector(opts, (err, socket) => {
        if (err || !socket) return cb(err, null);
        const fp = (socket as tls.TLSSocket).getPeerCertificate?.().fingerprint256?.toUpperCase();
        if (!pinned || fp !== pinned) {
          socket.destroy();
          return cb(new PveError('El certificado del nodo no coincide con la huella guardada'), null);
        }
        cb(null, socket);
      }),
  });
}

export class PveClient {
  private dispatcher: Agent;
  constructor(private conn: PveConn) {
    this.dispatcher = makeDispatcher(conn);
  }

  async get<T>(path: string): Promise<T> {
    let res;
    try {
      res = await fetch(`${this.conn.baseUrl}/api2/json${path}`, {
        headers: { Authorization: `PVEAPIToken=${this.conn.tokenId}=${this.conn.tokenSecret}` },
        dispatcher: this.dispatcher,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      const err = e as Error & { cause?: Error };
      throw new PveError(`No se pudo conectar: ${err.cause?.message ?? err.message}`);
    }
    if (res.status === 401) throw new PveError('Token no válido o caducado', 401);
    if (res.status === 403) throw new PveError('El token no tiene permisos suficientes', 403);
    if (!res.ok) throw new PveError(`Proxmox respondió ${res.status}`, res.status);
    return ((await res.json()) as { data: T }).data;
  }

  close(): Promise<void> {
    return this.dispatcher.close();
  }
}
