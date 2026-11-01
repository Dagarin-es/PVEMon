import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from './config.js';

/** Cifrado AES-256-GCM de secretos en reposo (tokens de Proxmox). Clave: SECRET_KEY. */
let key: Buffer | null = null;

function getKey(): Buffer {
  if (key) return key;
  const k = Buffer.from(config.secretKey, 'base64');
  if (k.length !== 32) {
    throw new Error('SECRET_KEY no válida: debe ser de 32 bytes en base64 (openssl rand -base64 32)');
  }
  return (key = k);
}

export const assertSecretKey = (): void => void getKey();

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function decrypt(payload: string): string {
  const [v, iv, tag, ct] = payload.split(':');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Formato de secreto cifrado desconocido');
  const d = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}
