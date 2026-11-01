/**
 * Búsqueda de servidores Proxmox en la red local.
 * Solo comprueba el puerto 8006 de redes PRIVADAS y no envía ninguna credencial: lo encontrado queda
 * como «Encontrado. Pendiente de agregar» hasta que un administrador lo da de alta con su token.
 */
import { isIP } from 'node:net';
import type { FastifyBaseLogger } from 'fastify';
import { Agent, request } from 'undici';
import { getSetting, setSetting } from '../alerts/notify.js';
import { db, schema } from '../db/index.js';
import { probeCert } from '../proxmox/client.js';

const { servers } = schema;
const PORT = Number(process.env.PVEMON_LAN_PORT ?? 8006);
const MAX_HOSTS_PER_RANGE = 1024;
const MAX_HOSTS_TOTAL = 2048;
const CONCURRENCY = 64;
const INTERVAL_MS = 30 * 60_000;
const FORGET_AFTER_SEC = 24 * 3600;

export interface LanConfig { enabled: boolean; cidrs: string[]; ignored: string[] }
export interface Found { ip: string; port: number; fingerprint: string; subject: string; firstSeenAt: number; lastSeenAt: number }
interface FoundState { found: Found[]; lastRunAt: number | null }

const DEFAULT_CFG: LanConfig = { enabled: true, cidrs: [], ignored: [] };
export const getConfig = (): LanConfig => ({ ...DEFAULT_CFG, ...(getSetting<Partial<LanConfig>>('lanscan') ?? {}) });
export const setConfig = (c: LanConfig) => setSetting('lanscan', c);
const getState = (): FoundState => getSetting<FoundState>('lanscan.found') ?? { found: [], lastRunAt: null };

/* ───────────── redes ───────────── */

const ip2n = (ip: string) => ip.split('.').reduce((a, o) => a * 256 + Number(o), 0);
const n2ip = (n: number) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join('.');

/** Solo redes privadas (RFC 1918): pvemon nunca explora Internet. */
export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split('.').map(Number) as [number, number];
  if (process.env.PVEMON_LAN_TEST === '1' && a === 127) return true; // solo para las pruebas automáticas
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function parseCidr(s: string): { base: number; bits: number } | null {
  const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec(s.trim());
  if (!m || isIP(m[1]!) !== 4) return null;
  const bits = Number(m[2]);
  if (bits < 22 || bits > 30) return null; // como mucho 1024 direcciones por red
  const size = 2 ** (32 - bits);
  const base = Math.floor(ip2n(m[1]!) / size) * size;
  return isPrivateIp(n2ip(base)) ? { base, bits } : null;
}

/** Redes a buscar: las indicadas o, si no hay, la /24 de cada servidor ya dado de alta. */
export function effectiveRanges(cfg = getConfig()): string[] {
  if (cfg.cidrs.length) return cfg.cidrs;
  const out = new Set<string>();
  for (const s of db.select({ baseUrl: servers.baseUrl }).from(servers).all()) {
    const host = new URL(s.baseUrl).hostname;
    if (isPrivateIp(host)) out.add(`${host.split('.').slice(0, 3).join('.')}.0/24`);
  }
  return [...out];
}

export function hostsOf(cidrs: string[]): string[] {
  const all = new Set<string>();
  for (const c of cidrs) {
    const r = parseCidr(c);
    if (!r) continue;
    const size = 2 ** (32 - r.bits);
    for (let i = 1; i < Math.min(size - 1, MAX_HOSTS_PER_RANGE); i++) all.add(n2ip(r.base + i));
    if (all.size >= MAX_HOSTS_TOTAL) break;
  }
  return [...all].slice(0, MAX_HOSTS_TOTAL);
}

/* ───────────── sondeo ───────────── */

const agent = new Agent({ connect: { rejectUnauthorized: false, timeout: 800 }, headersTimeout: 1500, bodyTimeout: 1500, keepAliveTimeout: 1, pipelining: 0 });

/** ¿Responde un Proxmox VE en ese host? Sin credenciales: solo mira la cabecera del servidor. */
async function isProxmox(ip: string): Promise<boolean> {
  try {
    const res = await request(`https://${ip}:${PORT}/`, { method: 'GET', dispatcher: agent, signal: AbortSignal.timeout(2500) });
    await res.body.dump();
    return String(res.headers.server ?? '').toLowerCase().startsWith('pve-api-daemon');
  } catch { return false; }
}

const knownServers = () => {
  const hosts = new Set<string>(), fps = new Set<string>();
  for (const s of db.select({ baseUrl: servers.baseUrl, fp: servers.tlsFingerprint }).from(servers).all()) {
    hosts.add(new URL(s.baseUrl).hostname);
    if (s.fp) fps.add(s.fp.toUpperCase());
  }
  return { hosts, fps };
};

/** Quita de la lista lo que ya está dado de alta (por IP o por huella de certificado). */
export function pending(found: Found[], cfg = getConfig()): Found[] {
  const { hosts, fps } = knownServers();
  return found.filter((f) => !hosts.has(f.ip) && !fps.has(f.fingerprint.toUpperCase()) && !cfg.ignored.includes(f.ip));
}

let running = false;
export const isScanning = () => running;

export async function scanLan(): Promise<{ scanned: number; found: number }> {
  if (running) return { scanned: 0, found: 0 };
  running = true;
  try {
    const cfg = getConfig();
    const hosts = hostsOf(effectiveRanges(cfg));
    const now = Math.floor(Date.now() / 1000);
    const prev = new Map(getState().found.map((f) => [f.ip, f]));
    const seen: Found[] = [];
    const queue = [...hosts];
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let ip = queue.shift(); ip; ip = queue.shift()) {
        if (!(await isProxmox(ip))) continue;
        try {
          const c = await probeCert(`https://${ip}:${PORT}`);
          seen.push({ ip, port: PORT, fingerprint: c.fingerprint, subject: c.subject, firstSeenAt: prev.get(ip)?.firstSeenAt ?? now, lastSeenAt: now });
        } catch { /* se reintenta en la próxima pasada */ }
      }
    }));
    // Lo no visto se conserva un día (por si el equipo está apagado un rato)
    const kept = [...prev.values()].filter((f) => !seen.some((s) => s.ip === f.ip) && now - f.lastSeenAt < FORGET_AFTER_SEC);
    setSetting('lanscan.found', { found: [...seen, ...kept].sort((a, b) => ip2n(a.ip) - ip2n(b.ip)), lastRunAt: now } satisfies FoundState);
    return { scanned: hosts.length, found: pending([...seen, ...kept], cfg).length };
  } finally {
    running = false;
  }
}

export const listPending = () => ({ found: pending(getState().found), lastRunAt: getState().lastRunAt });

export function startLanScan(log: FastifyBaseLogger): () => void {
  const run = () => {
    if (!getConfig().enabled) return;
    scanLan().then((r) => { if (r.scanned) log.info(r, 'búsqueda de Proxmox en la red'); })
      .catch((e: Error) => log.warn({ err: e.message }, 'búsqueda de Proxmox en la red falló'));
  };
  const first = setTimeout(run, 30_000);
  const timer = setInterval(run, INTERVAL_MS);
  return () => { clearTimeout(first); clearInterval(timer); };
}
