/**
 * Latido externo: pvemon avisa cada N minutos a un servicio de fuera (Healthchecks, Uptime Kuma «push»,
 * un webhook de Home Assistant…). Si dejan de llegar los latidos, ese servicio te avisa de que pvemon se ha caído.
 */
import type { FastifyBaseLogger } from 'fastify';
import { request } from 'undici';
import { getSetting, setSetting } from '../alerts/notify.js';
import { decrypt, encrypt } from '../crypto.js';

export interface HeartbeatCfg { urlEnc: string | null; intervalMin: number; enabled: boolean }
export interface HeartbeatLast { at: number; ok: boolean; status?: number; error?: string }

export const getHeartbeat = () => getSetting<HeartbeatCfg>('heartbeat');
export const getHeartbeatLast = () => getSetting<HeartbeatLast>('heartbeat.last');

export function validUrl(u: string): boolean {
  try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:'; } catch { return false; }
}

/** Muestra solo el servidor de la URL (el resto puede ser una clave secreta) */
export function maskUrl(enc: string | null): string {
  if (!enc) return '';
  try { const x = new URL(decrypt(enc)); return `${x.protocol}//${x.host}/…`; } catch { return ''; }
}

export function saveUrl(u: string): string { return encrypt(u); }

export async function pingNow(): Promise<HeartbeatLast> {
  const c = getHeartbeat();
  const at = Math.floor(Date.now() / 1000);
  let res: HeartbeatLast;
  try {
    if (!c?.urlEnc) throw new Error('No hay dirección configurada');
    const r = await request(decrypt(c.urlEnc), { method: 'GET', headersTimeout: 10_000, bodyTimeout: 10_000 });
    await r.body.dump().catch(() => undefined);
    res = r.statusCode >= 200 && r.statusCode < 300 ? { at, ok: true, status: r.statusCode } : { at, ok: false, status: r.statusCode, error: `El servicio respondió ${r.statusCode}` };
  } catch (e) {
    res = { at, ok: false, error: (e as Error).message.slice(0, 200) };
  }
  setSetting('heartbeat.last', res);
  return res;
}

export function startHeartbeat(logger: FastifyBaseLogger): () => void {
  let busy = false;
  const t = setInterval(() => {
    const c = getHeartbeat();
    if (!c?.enabled || !c.urlEnc || busy) return;
    const last = getHeartbeatLast();
    const now = Math.floor(Date.now() / 1000);
    if (last && now - last.at < Math.max(1, c.intervalMin) * 60 - 5) return;
    busy = true;
    void pingNow().then((r) => { if (!r.ok) logger.warn({ err: r.error }, 'latido externo falló'); }).finally(() => { busy = false; });
  }, 30_000);
  return () => clearInterval(t);
}
