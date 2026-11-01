/**
 * Métricas de contenedores Docker. Cada ciclo, por cada máquina con endpoint:
 *  1 llamada a la lista (estado de todos) + inspect y stats solo de los contenedores monitorizados y encendidos.
 */
import type { FastifyBaseLogger } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { observe } from '../alerts/engine.js';
import type { MetricsStore, Point } from '../metrics/store.js';
import { containerName, inspect, listContainers, stats, type Endpoint } from './client.js';
import { dockerStatus, setChildrenStatus, syncEndpoint } from './discovery.js';

const { elements, dockerEndpoints } = schema;
const INTERVAL_MS = 30_000;
const CONCURRENCY = 6;

interface Prev { ts: number; cpu: number; sys: number; rx: number; tx: number }
const prev = new Map<string, Prev>();
// El tamaño en disco lo calcula Docker recorriendo ficheros: se pide cada 10 min por contenedor, no cada ciclo
const SIZE_EVERY = 600;
const sizeAt = new Map<string, number>();
const resync = new Map<string, number>(); // límite de resincronizaciones por nuevo contenedor

async function pool<T>(items: T[], fn: (t: T) => Promise<void>) {
  const q = [...items];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, q.length) }, async () => {
    for (let t = q.shift(); t !== undefined; t = q.shift()) await fn(t);
  }));
}

/** Una máquina: devuelve los puntos. Lanza si el endpoint no responde. */
export async function collectGuest(guestId: string, ep: Endpoint, now: number): Promise<Point[]> {
  const children = db.select().from(elements).where(and(eq(elements.parentId, guestId), eq(elements.kind, 'docker'), eq(elements.missing, false))).all();
  const byName = new Map(children.map((c) => [c.externalId, c]));
  const list = await listContainers(ep);

  // Contenedores nuevos: se dan de alta sin esperar a la revisión de cada 5 minutos
  if (list.some((c) => !byName.has(containerName(c))) && now - (resync.get(guestId) ?? 0) > 60) {
    resync.set(guestId, now);
    await syncEndpoint(guestId);
  }

  const points: Point[] = [];
  const work: { el: (typeof children)[number]; id: string }[] = [];
  for (const c of list) {
    const el = byName.get(containerName(c));
    if (!el) continue;
    const status = dockerStatus(c.State);
    if (status !== el.status) db.update(elements).set({ status }).where(eq(elements.id, el.id)).run();
    if (!el.monitored) continue;
    points.push({ elementId: el.id, metricKey: 'status', ts: now, value: status === 'running' ? 1 : 0 });
    if (status === 'running') work.push({ el, id: c.Id });
  }

  await pool(work, async ({ el, id }) => {
    try {
      const wantSize = now - (sizeAt.get(el.id) ?? 0) >= SIZE_EVERY;
      if (wantSize) sizeAt.set(el.id, now);
      const [ins, st] = await Promise.all([inspect(ep, id, wantSize), stats(ep, id)]);
      const add = (metricKey: string, value: number) => { if (Number.isFinite(value)) points.push({ elementId: el.id, metricKey, ts: now, value }); };

      const started = Date.parse(ins.State.StartedAt);
      if (Number.isFinite(started)) add('uptime', Math.max(0, now - started / 1000));
      if (ins.State.Health?.Status === 'healthy' || ins.State.Health?.Status === 'unhealthy') add('health', ins.State.Health.Status === 'healthy' ? 1 : 0);

      // Disco: lo que el contenedor ha escrito en su capa (como la columna SIZE de `docker ps -s`; no incluye volúmenes)
      if (wantSize && typeof ins.SizeRw === 'number') add('disk.size', ins.SizeRw);

      // Memoria como la muestra `docker stats`: sin la caché de ficheros
      const m = st.memory_stats;
      if (m.usage && m.limit) {
        const used = m.usage - (m.stats?.inactive_file ?? m.stats?.total_inactive_file ?? 0);
        add('mem.used', used);
        add('mem.usage', (used / m.limit) * 100);
      }

      const net = Object.values(st.networks ?? {});
      const rx = net.reduce((a, n) => a + n.rx_bytes, 0), tx = net.reduce((a, n) => a + n.tx_bytes, 0);
      const cpu = st.cpu_stats.cpu_usage.total_usage, sys = st.cpu_stats.system_cpu_usage ?? 0;
      const p = prev.get(el.id);
      prev.set(el.id, { ts: now, cpu, sys, rx, tx });
      if (p && now > p.ts) {
        // % sobre el total de la máquina (0–100), como las gráficas de VM y LXC
        if (sys > p.sys && cpu >= p.cpu) add('cpu.usage', Math.min(100, ((cpu - p.cpu) / (sys - p.sys)) * 100));
        if (net.length && rx >= p.rx && tx >= p.tx) { add('net.in', (rx - p.rx) / (now - p.ts)); add('net.out', (tx - p.tx) / (now - p.ts)); }
      }
    } catch { /* un contenedor que se está parando no debe tirar el ciclo */ }
  });
  return points;
}

export function startDockerCollector(log: FastifyBaseLogger, store: MetricsStore): () => void {
  let busy = false;
  const fails = new Map<string, number>();

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const now = Math.floor(Date.now() / 1000);
      const eps = db.select({ ep: dockerEndpoints, g: elements }).from(dockerEndpoints)
        .innerJoin(elements, eq(elements.id, dockerEndpoints.elementId))
        .where(and(eq(dockerEndpoints.enabled, true), eq(elements.missing, false))).all();
      const all: Point[] = [];
      await Promise.all(eps.map(async ({ ep, g }) => {
        if (g.status !== 'running') { setChildrenStatus(g.id, 'unknown'); return; } // lo cubre el aviso de la máquina
        try {
          const pts = await collectGuest(g.id, { host: ep.host, port: ep.port }, now);
          all.push(...pts);
          // máquina encendida con contenedores monitorizados parados: nº de caídos (la alerta se configura en Ajustes)
          if (g.monitored) all.push({ elementId: g.id, metricKey: 'docker.down', ts: now, value: pts.filter((p) => p.metricKey === 'status' && p.value === 0).length });
          if (ep.status !== 'ok') db.update(dockerEndpoints).set({ status: 'ok', lastError: null, lastCheckAt: now }).where(eq(dockerEndpoints.elementId, g.id)).run();
          if (g.monitored) all.push({ elementId: g.id, metricKey: 'docker.online', ts: now, value: 1 });
          fails.delete(g.id);
        } catch (err) {
          const n = (fails.get(g.id) ?? 0) + 1;
          fails.set(g.id, n);
          if (n === 1) log.warn({ guest: g.name, err: (err as Error).message }, 'Docker no responde');
          db.update(dockerEndpoints).set({ status: 'unreachable', lastError: (err as Error).message, lastCheckAt: now }).where(eq(dockerEndpoints.elementId, g.id)).run();
          setChildrenStatus(g.id, 'unknown');
          if (g.monitored) all.push({ elementId: g.id, metricKey: 'docker.online', ts: now, value: 0 });
        }
      }));
      if (all.length) { store.write(all); void observe(all, now); }
    } catch (err) {
      log.error({ err: (err as Error).message }, 'recogida de Docker falló');
    } finally {
      busy = false;
    }
  };
  const first = setTimeout(() => void tick(), 15_000);
  const timer = setInterval(() => void tick(), INTERVAL_MS);
  return () => { clearTimeout(first); clearInterval(timer); };
}
