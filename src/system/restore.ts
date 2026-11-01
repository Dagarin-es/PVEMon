/**
 * Arranque con restauración pendiente y copias locales automáticas de la BD de configuración.
 * Se ejecuta ANTES de abrir la base de datos (ver db/index.ts).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const pendingPath = (dataDir: string) => join(dataDir, 'restore.pending.db');
export const snapDir = (dataDir: string) => join(dataDir, 'backups');

const stamp = (d = new Date()) => d.toISOString().slice(0, 10).replace(/-/g, '');

/** Si hay una restauración pendiente, la aplica (la BD actual se guarda al lado, por si acaso). */
export function applyPendingRestore(dataDir: string, dbPath: string): boolean {
  const pend = pendingPath(dataDir);
  if (!existsSync(pend)) return false;
  if (existsSync(dbPath)) {
    mkdirSync(snapDir(dataDir), { recursive: true });
    renameSync(dbPath, join(snapDir(dataDir), `config-antes-de-restaurar-${Date.now()}.db`));
  }
  for (const ext of ['-wal', '-shm']) rmSync(dbPath + ext, { force: true });
  renameSync(pend, dbPath);
  return true;
}

/** Una copia de config.db al arrancar (máximo una al día, se guardan las 7 últimas). */
export function localSnapshot(dataDir: string, dbPath: string): void {
  try {
    if (!existsSync(dbPath)) return;
    const dir = snapDir(dataDir);
    mkdirSync(dir, { recursive: true });
    const name = `config-${stamp()}.db`;
    if (!existsSync(join(dir, name))) copyFileSync(dbPath, join(dir, name));
    const old = readdirSync(dir).filter((f) => /^config-\d{8}\.db$/.test(f)).sort().reverse().slice(7);
    for (const f of old) rmSync(join(dir, f), { force: true });
  } catch { /* una copia local que falla no debe impedir arrancar */ }
}

export function listSnapshots(dataDir: string): { name: string; size: number }[] {
  try {
    return readdirSync(snapDir(dataDir)).filter((f) => /^config-\d{8}\.db$/.test(f)).sort().reverse().map((name) => ({ name, size: 0 }));
  } catch { return []; }
}
