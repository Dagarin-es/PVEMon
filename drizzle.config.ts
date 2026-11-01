import { defineConfig } from 'drizzle-kit';

// Solo la BD de CONFIGURACIÓN usa Drizzle. La BD de métricas va por MetricsStore.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.CONFIG_DB_PATH ?? './data/config.db' },
});
