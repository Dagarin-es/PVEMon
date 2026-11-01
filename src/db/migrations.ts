import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './index.js';

/** Se llama al arrancar el servidor: la BD siempre queda al día. */
export function runMigrations(): void {
  migrate(db, { migrationsFolder: './drizzle' });
}
