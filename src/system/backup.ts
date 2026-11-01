/**
 * Copia cifrada de la configuración de pvemon (config.db) para guardarla fuera del servidor.
 * Formato: "PVEMONBK1" + sal(16) + iv(12) + etiqueta(16) + datos cifrados (AES-256-GCM, clave = scrypt(contraseña)).
 * Dentro (gzip de un JSON): versión de la app, fecha, SECRET_KEY (para restaurar en otro equipo) y la base de datos.
 * El histórico de métricas (metrics.db) NO se incluye: se vuelve a generar solo.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { sqlite } from '../db/index.js';
import { pendingPath } from './restore.js';

const MAGIC = Buffer.from('PVEMONBK1');
export const kdf = (pass: string, salt: Buffer) => scryptSync(pass, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });

export class BackupError extends Error {}

export async function exportBackup(pass: string, version: string): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'pvemon-bk-'));
  try {
    const tmp = join(dir, 'config.db');
    await sqlite.backup(tmp); // copia coherente aunque la BD esté en uso
    const payload = gzipSync(Buffer.from(JSON.stringify({
      v: 1, app: version, at: Math.floor(Date.now() / 1000), secretKey: config.secretKey, db: readFileSync(tmp).toString('base64'),
    })));
    const salt = randomBytes(16), iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', kdf(pass, salt), iv);
    const ct = Buffer.concat([c.update(payload), c.final()]);
    return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), ct]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export interface Opened { app: string; at: number; secretKey: string; db: Buffer }

export function openBackup(file: Buffer, pass: string): Opened {
  if (file.length < MAGIC.length + 44 || !file.subarray(0, MAGIC.length).equals(MAGIC)) throw new BackupError('Este archivo no es una copia de pvemon');
  let o = MAGIC.length;
  const salt = file.subarray(o, o += 16), iv = file.subarray(o, o += 12), tag = file.subarray(o, o += 16), ct = file.subarray(o);
  let json: { app?: string; at?: number; secretKey?: string; db?: string };
  try {
    const d = createDecipheriv('aes-256-gcm', kdf(pass, salt), iv);
    d.setAuthTag(tag);
    json = JSON.parse(gunzipSync(Buffer.concat([d.update(ct), d.final()])).toString('utf8'));
  } catch { throw new BackupError('Contraseña incorrecta o archivo dañado'); }
  if (!json.db) throw new BackupError('La copia no contiene la base de datos');
  return { app: json.app ?? '?', at: json.at ?? 0, secretKey: json.secretKey ?? '', db: Buffer.from(json.db, 'base64') };
}

/** Comprueba que la BD de la copia es de pvemon y la deja como restauración pendiente (se aplica al reiniciar). */
export function stageRestore(b: Opened): void {
  const dir = mkdtempSync(join(tmpdir(), 'pvemon-rs-'));
  try {
    const tmp = join(dir, 'in.db');
    writeFileSync(tmp, b.db);
    const t = new Database(tmp, { readonly: true });
    try {
      const has = (n: string) => !!t.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(n);
      if (!has('users') || !has('servers') || !has('settings')) throw new BackupError('La base de datos de la copia no es de pvemon');
      const n = (t.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
      if (n < 1) throw new BackupError('La copia no tiene ningún usuario');
      if (t.pragma('integrity_check', { simple: true }) !== 'ok') throw new BackupError('La base de datos de la copia está dañada');
    } finally { t.close(); }
    writeFileSync(pendingPath(config.dataDir), b.db);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
