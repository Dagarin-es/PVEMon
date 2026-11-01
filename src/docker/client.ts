/**
 * Cliente mínimo de la API de Docker a través de docker-socket-proxy (HTTP, solo lectura).
 * Solo se usan cuatro rutas: /_ping, /containers/json, /containers/{id}/json y /containers/{id}/stats.
 */
import { Agent, request } from 'undici';

const agent = new Agent({ connect: { timeout: 3000 }, headersTimeout: 6000, bodyTimeout: 8000, keepAliveTimeout: 1000, pipelining: 0 });

export interface Endpoint { host: string; port: number }

export class DockerError extends Error {}

/** Solo IPs o nombres de host sencillos: nada de rutas, usuarios ni esquemas. */
export const validHost = (h: string) => /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(h);

async function get(ep: Endpoint, path: string, timeoutMs = 6000): Promise<{ status: number; text: string }> {
  try {
    const res = await request(`http://${ep.host}:${ep.port}${path}`, {
      method: 'GET', dispatcher: agent, signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.body.text();
    return { status: res.statusCode, text };
  } catch (err) {
    const e = err as Error & { code?: string; cause?: { code?: string } };
    const code = e.code ?? e.cause?.code;
    throw new DockerError(
      code === 'ECONNREFUSED' ? 'Conexión rechazada (¿está el socket-proxy en marcha y escuchando en esa IP y puerto?)'
      : code === 'UND_ERR_SOCKET' || /other side closed/.test(e.message) ? 'La conexión se cerró sin respuesta (¿es el puerto del socket-proxy?)'
      : code === 'UND_ERR_CONNECT_TIMEOUT' || e.name === 'TimeoutError' ? 'Sin respuesta (¿cortafuegos?)'
      : e.message,
    );
  }
}

async function getJson<T>(ep: Endpoint, path: string): Promise<T> {
  const r = await get(ep, path);
  if (r.status === 403) throw new DockerError('El socket-proxy no permite esta consulta: falta CONTAINERS=1');
  if (r.status !== 200) throw new DockerError(`Docker respondió ${r.status}`);
  try { return JSON.parse(r.text) as T; } catch { throw new DockerError('Respuesta no válida de Docker'); }
}

/** ¿Hay un API de Docker en ese puerto? */
export async function ping(ep: Endpoint, timeoutMs = 1500): Promise<boolean> {
  try {
    const r = await get(ep, '/_ping', timeoutMs);
    return r.status === 200 && r.text.trim() === 'OK';
  } catch { return false; }
}

export interface DockerListItem {
  Id: string; Names: string[]; Image: string; State: string; Status: string; Created: number;
  Labels?: Record<string, string>;
}
export const listContainers = (ep: Endpoint) => getJson<DockerListItem[]>(ep, '/containers/json?all=1');

export interface DockerInspect {
  RestartCount: number;
  SizeRw?: number; SizeRootFs?: number;
  State: { Status: string; Running: boolean; StartedAt: string; Health?: { Status: string } };
}
export const inspect = (ep: Endpoint, id: string, withSize = false) =>
  getJson<DockerInspect>(ep, `/containers/${encodeURIComponent(id)}/json${withSize ? '?size=true' : ''}`);

export interface DockerStats {
  cpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number; online_cpus?: number };
  memory_stats: { usage?: number; limit?: number; stats?: Record<string, number> };
  networks?: Record<string, { rx_bytes: number; tx_bytes: number }>;
}
export const stats = (ep: Endpoint, id: string) =>
  getJson<DockerStats>(ep, `/containers/${encodeURIComponent(id)}/stats?stream=false&one-shot=true`);

/** Nombre de un contenedor sin la barra inicial que pone Docker. */
export const containerName = (c: DockerListItem) => (c.Names[0] ?? c.Id.slice(0, 12)).replace(/^\//, '');
