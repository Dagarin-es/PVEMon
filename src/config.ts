import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dataDir = resolve(process.env.DATA_DIR ?? './data');
mkdirSync(dataDir, { recursive: true });

export const config = {
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 3000),
  dataDir,
  configDbPath: join(dataDir, 'config.db'),
  metricsDbPath: join(dataDir, 'metrics.db'),
  secretKey: process.env.SECRET_KEY ?? '',
} as const;
