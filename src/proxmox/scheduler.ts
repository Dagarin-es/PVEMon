import type { FastifyBaseLogger } from 'fastify';
import { db, schema } from '../db/index.js';
import { scanDockerForServer } from '../docker/discovery.js';
import { scanServer } from './discovery.js';

const running = new Set<string>();
const INTERVAL_MS = 5 * 60_000;

export async function scanAllServers(log: FastifyBaseLogger): Promise<void> {
  for (const s of db.select({ id: schema.servers.id, name: schema.servers.name, kind: schema.servers.kind }).from(schema.servers).all()) {
    if (s.kind === 'mail') continue;
    if (running.has(s.id)) continue;
    running.add(s.id);
    try {
      const r = await scanServer(s.id);
      log.info({ server: s.name, ...r }, 'escaneo de servidor completado');
      try {
        const d = await scanDockerForServer(s.id);
        if (d.added) log.info({ server: s.name, ...d }, 'Docker detectado en máquinas nuevas');
      } catch (err) {
        log.warn({ server: s.name, err: (err as Error).message }, 'escaneo de Docker falló');
      }
    } catch (err) {
      log.warn({ server: s.name, err: (err as Error).message }, 'escaneo de servidor falló');
    } finally {
      running.delete(s.id);
    }
  }
}

export function startScheduler(log: FastifyBaseLogger): () => void {
  const first = setTimeout(() => void scanAllServers(log), 5_000);
  const timer = setInterval(() => void scanAllServers(log), INTERVAL_MS);
  return () => { clearTimeout(first); clearInterval(timer); };
}
