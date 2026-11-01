import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { config } from '../config.js';
import * as schema from './schema.js';
import { applyPendingRestore, localSnapshot } from '../system/restore.js';

/** Pragmas comunes: WAL permite leer mientras se escribe. */
export function openSqlite(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

// Restauración pendiente (desde Ajustes › Sistema) y copia local diaria: antes de abrir la BD
export const restored = applyPendingRestore(config.dataDir, config.configDbPath);
localSnapshot(config.dataDir, config.configDbPath);
export const sqlite = openSqlite(config.configDbPath);
export const db = drizzle(sqlite, { schema });
export type Db = typeof db;
export { schema };
