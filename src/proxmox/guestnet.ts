/**
 * Dirección IP y estado del agente invitado (qemu-guest-agent) de cada VM/LXC, leídos de la API de Proxmox (solo lectura):
 *  - LXC: /nodes/{n}/lxc/{id}/interfaces
 *  - VM:  /nodes/{n}/qemu/{id}/agent/network-get-interfaces (necesita el agente instalado y activado en la VM)
 * Se consulta cada 5 min por máquina encendida, sin frenar el ciclo del colector. El último resultado se guarda en BD
 * para conservarlo si la máquina se apaga o pvemon se reinicia.
 */
import { getSetting, setSetting } from '../alerts/notify.js';
import type { schema } from '../db/index.js';
import { PveClient } from './client.js';
import { connFor } from './discovery.js';

/** off = el agente no está activado en las opciones de la VM; ok = responde; noresponse = activado pero no responde (no instalado o parado) */
export type AgentState = 'ok' | 'noresponse' | 'off' | null;
export interface GuestNet { ips: string[]; ip: string | null; agent: AgentState; at: number }

const KEY = 'guestnet';
const EVERY = 300;
const RETRY = 600;
const next = new Map<string, number>();
const busy = new Set<string>();
let cache: Record<string, GuestNet> | null = null;
const load = () => (cache ??= getSetting<Record<string, GuestNet>>(KEY) ?? {});
export const getGuestNet = (elementId: string): GuestNet | null => load()[elementId] ?? null;

function save(id: string, v: GuestNet): void {
  const all = load();
  const old = all[id];
  all[id] = v;
  // se escribe en BD solo si cambia algo (la hora de lectura no cuenta, salvo que haya pasado una hora)
  if (!old || old.ip !== v.ip || old.agent !== v.agent || old.ips.join() !== v.ips.join() || v.at - old.at > 3600) setSetting(KEY, all);
}

const VIRTUAL = /^(lo|docker\d*|br-|veth|virbr|cni|flannel|cali|tun|tap|vnet|lxc)/i;
const usable = (ip: string) => !/^(127\.|169\.254\.)/.test(ip) && !/^(::1|fe80)/i.test(ip);

export function pickIps(list: { name?: string; ip: string }[]): { ips: string[]; ip: string | null } {
  const v4 = (l: typeof list) => l.filter((x) => usable(x.ip) && !x.ip.includes(':'));
  const real = v4(list.filter((x) => !VIRTUAL.test(x.name ?? '')));
  const ips = [...new Set([...real, ...v4(list.filter((x) => VIRTUAL.test(x.name ?? '') && !/^lo$/i.test(x.name ?? '')))].map((x) => x.ip))];
  return { ips, ip: real[0]?.ip ?? ips[0] ?? null };
}

export const agentEnabled = (cfg: unknown): boolean => {
  const v = String(cfg ?? '').trim();
  return v === '1' || /(^|,)(enabled=)?1(,|$)/.test(v);
};

export function maybeRefreshNet(server: typeof schema.servers.$inferSelect, node: string, kind: 'vm' | 'lxc', vmid: string, elId: string, agentCfg: unknown, now: number): void {
  if (busy.has(elId) || (next.get(elId) ?? 0) > now) return;
  busy.add(elId);
  void (async () => {
    const c = new PveClient(connFor(server));
    try {
      if (kind === 'lxc') {
        const r = await c.get<{ name?: string; inet?: string }[]>(`/nodes/${node}/lxc/${vmid}/interfaces`);
        const p = pickIps(r.filter((i) => i.inet).map((i) => ({ name: i.name, ip: i.inet!.split('/')[0]! })));
        save(elId, { ...p, agent: null, at: now });
      } else if (!agentEnabled(agentCfg)) {
        save(elId, { ips: [], ip: null, agent: 'off', at: now });
      } else {
        try {
          const raw = await c.get<{ result?: unknown } | unknown[]>(`/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`);
          const list = (Array.isArray(raw) ? raw : (raw as { result?: unknown[] }).result ?? []) as { name?: string; 'ip-addresses'?: { 'ip-address-type'?: string; 'ip-address'?: string }[] }[];
          const flat = list.flatMap((i) => (i['ip-addresses'] ?? []).filter((a) => a['ip-address-type'] === 'ipv4' && a['ip-address']).map((a) => ({ name: i.name, ip: a['ip-address']! })));
          save(elId, { ...pickIps(flat), agent: 'ok', at: now });
        } catch { save(elId, { ips: getGuestNet(elId)?.ips ?? [], ip: getGuestNet(elId)?.ip ?? null, agent: 'noresponse', at: now }); }
      }
      next.set(elId, now + EVERY);
    } catch { next.set(elId, now + RETRY); }
    finally { busy.delete(elId); await c.close().catch(() => undefined); }
  })();
}
