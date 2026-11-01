/**
 * Claves de la API de solo lectura (/api/v1). Se guarda solo el hash SHA-256 de cada clave:
 * la clave completa se enseña una única vez, al crearla. Una clave solo sirve para /api/v1 (todas las rutas son GET).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getSetting, setSetting } from '../alerts/notify.js';

export interface ApiToken { id: string; name: string; hash: string; prefix: string; createdAt: number; lastUsedAt: number | null; lastIp: string | null; createdBy: string | null }

const KEY = 'api.tokens';
const hashOf = (t: string) => createHash('sha256').update(t).digest('hex');
const list = (): ApiToken[] => getSetting<ApiToken[]>(KEY) ?? [];
const nowSec = () => Math.floor(Date.now() / 1000);

export const publicTokens = () => list().map(({ hash: _h, ...t }) => t);

export function createToken(name: string, createdBy: string | null): { token: string; id: string } {
  const token = 'pvm_' + randomBytes(24).toString('base64url');
  const t: ApiToken = { id: crypto.randomUUID(), name, hash: hashOf(token), prefix: token.slice(0, 8), createdAt: nowSec(), lastUsedAt: null, lastIp: null, createdBy };
  setSetting(KEY, [...list(), t]);
  return { token, id: t.id };
}

export function deleteToken(id: string): boolean {
  const cur = list();
  const next = cur.filter((t) => t.id !== id);
  if (next.length === cur.length) return false;
  setSetting(KEY, next);
  return true;
}

const lastWrite = new Map<string, number>();

/** Devuelve la clave si el texto recibido corresponde a alguna (comparación en tiempo constante). */
export function verifyToken(raw: string, ip: string): ApiToken | null {
  if (!/^pvm_[A-Za-z0-9_-]{20,80}$/.test(raw)) return null;
  const h = Buffer.from(hashOf(raw), 'hex');
  const found = list().find((t) => { const b = Buffer.from(t.hash, 'hex'); return b.length === h.length && timingSafeEqual(b, h); });
  if (!found) return null;
  // Anotar el último uso como mucho una vez cada 5 min, para no escribir en la BD en cada consulta
  const now = nowSec();
  if (now - (lastWrite.get(found.id) ?? 0) > 300) {
    lastWrite.set(found.id, now);
    setSetting(KEY, list().map((t) => (t.id === found.id ? { ...t, lastUsedAt: now, lastIp: ip } : t)));
  }
  return found;
}
