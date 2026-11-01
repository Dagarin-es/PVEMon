import { eq } from 'drizzle-orm';
import { decrypt } from '../crypto.js';
import { db, schema } from '../db/index.js';
import type { ElementKind, ElementStatus } from '../db/schema.js';
import { PveClient, PveError } from './client.js';

const { servers, elements } = schema;

interface Resource {
  id: string;
  type: string;
  node?: string;
  vmid?: number;
  name?: string;
  status?: string;
  maxcpu?: number;
  maxmem?: number;
  maxdisk?: number;
  uptime?: number;
  template?: number;
  tags?: string;
}

interface Desired {
  kind: ElementKind;
  externalId: string;
  name: string;
  status: ElementStatus;
  parentKey: string | null; // "kind|externalId" del padre
  info: Record<string, unknown>;
  firstTimeMonitored: boolean;
}

const key = (kind: string, externalId: string) => `${kind}|${externalId}`;
export const toStatus = (s?: string): ElementStatus =>
  s === 'running' || s === 'online' ? 'running' : s === 'stopped' || s === 'offline' ? 'stopped' : s === 'paused' ? 'paused' : 'unknown';

/** Solo campos útiles de la configuración de un invitado (sin credenciales ni redes completas). */
const pick = (cfg: Record<string, unknown>, fields: string[]) =>
  Object.fromEntries(fields.filter((f) => cfg[f] !== undefined).map((f) => [f, cfg[f]]));

export interface ScanSummary {
  nodes: number;
  vms: number;
  lxc: number;
  newElements: number;
  missing: number;
}

export function connFor(server: typeof servers.$inferSelect) {
  return {
    baseUrl: server.baseUrl,
    tokenId: server.tokenId,
    tokenSecret: decrypt(server.tokenSecretEnc),
    verifyTls: server.verifyTls,
    fingerprint: server.tlsFingerprint,
  };
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try { return await p; } catch { return null; }
}

/** Escanea un servidor Proxmox y sincroniza el árbol de elementos. Lanza si no hay conexión. */
export async function scanServer(serverId: string): Promise<ScanSummary> {
  const server = db.select().from(servers).where(eq(servers.id, serverId)).get();
  if (!server) throw new PveError('Nodo no encontrado');
  const client = new PveClient(connFor(server));

  try {
    const version = await client.get<{ version: string }>('/version');
    const resources = await client.get<Resource[]>('/cluster/resources');

    const desired: Desired[] = [
      { kind: 'server', externalId: server.id, name: server.name, status: 'running', parentKey: null, info: {}, firstTimeMonitored: true },
    ];

    const nodes = resources.filter((r) => r.type === 'node' && r.node);
    for (const n of nodes) {
      const st = n.status === 'online'
        ? await safe(client.get<Record<string, any>>(`/nodes/${n.node}/status`))
        : null;
      // Tarjetas gráficas: lista PCI del nodo (necesita permiso de auditoría; si falta, simplemente no se muestran)
      const pci = n.status === 'online'
        ? await safe(client.get<{ class?: string; device_name?: string; vendor_name?: string }[]>(`/nodes/${n.node}/hardware/pci`))
        : null;
      const gpus = (pci ?? []).filter((d) => /^0x03/i.test(d.class ?? ''))
        .map((d) => [d.vendor_name, d.device_name].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
      desired.push({
        kind: 'node',
        externalId: n.node!,
        name: n.node!,
        status: toStatus(n.status),
        parentKey: key('server', server.id),
        firstTimeMonitored: true,
        info: {
          cpuModel: st?.cpuinfo?.model,
          cpuCores: st?.cpuinfo?.cpus ?? n.maxcpu,
          cpuSockets: st?.cpuinfo?.sockets,
          memoryTotal: st?.memory?.total ?? n.maxmem,
          diskTotal: st?.rootfs?.total ?? n.maxdisk,
          cpuMhz: st?.cpuinfo?.mhz ? Math.round(Number(st.cpuinfo.mhz)) : undefined,
          swapTotal: st?.swap?.total,
          gpus: pci ? gpus : undefined,
          kernel: st?.['current-kernel']?.release ? `Linux ${st['current-kernel'].release}` : st?.kversion,
          arch: st?.['current-kernel']?.machine,
          boot: st?.['boot-info']?.mode ? (st['boot-info'].mode === 'efi' ? 'UEFI' : 'BIOS') : undefined,
          pveVersion: st?.pveversion,
        },
      });
    }

    let vms = 0, lxc = 0;
    for (const r of resources) {
      if ((r.type !== 'qemu' && r.type !== 'lxc') || !r.node || r.vmid === undefined || r.template) continue;
      const isVm = r.type === 'qemu';
      const cfg = await safe(client.get<Record<string, unknown>>(`/nodes/${r.node}/${r.type}/${r.vmid}/config`));
      isVm ? vms++ : lxc++;
      desired.push({
        kind: isVm ? 'vm' : 'lxc',
        externalId: String(r.vmid),
        name: r.name ?? `${r.type}-${r.vmid}`,
        status: toStatus(r.status),
        parentKey: key('node', r.node),
        firstTimeMonitored: false,
        info: {
          vmid: r.vmid,
          cpuCores: r.maxcpu,
          memoryTotal: r.maxmem,
          diskTotal: r.maxdisk,
          tags: r.tags,
          ...(cfg ? pick(cfg, isVm ? ['ostype', 'agent', 'bios', 'machine', 'onboot'] : ['ostype', 'arch', 'unprivileged', 'features', 'onboot', 'swap']) : {}),
        },
      });
    }

    // ── Sincronizar con la BD en una sola transacción ──
    const now = Math.floor(Date.now() / 1000);
    let newElements = 0, missing = 0;
    db.transaction((tx) => {
      const existing = new Map(
        tx.select().from(elements).where(eq(elements.serverId, server.id)).all().map((e) => [key(e.kind, e.externalId), e]),
      );
      const ids = new Map<string, string>(); // key → element id
      const seen = new Set<string>();

      for (const d of desired) {
        const k = key(d.kind, d.externalId);
        seen.add(k);
        const parentId = d.parentKey ? ids.get(d.parentKey) ?? null : null;
        const prev = existing.get(k);
        if (prev) {
          ids.set(k, prev.id);
          tx.update(elements)
            .set({ parentId, name: d.name, status: d.status, info: d.info, missing: false, lastSeenAt: now })
            .where(eq(elements.id, prev.id)).run();
        } else {
          const id = crypto.randomUUID();
          ids.set(k, id);
          newElements += d.kind === 'server' ? 0 : 1;
          tx.insert(elements).values({
            id, serverId: server.id, parentId, kind: d.kind, externalId: d.externalId, name: d.name,
            status: d.status, info: d.info,
            monitored: d.firstTimeMonitored, isNew: !d.firstTimeMonitored,
          }).run();
        }
      }
      // Lo que ya no aparece (solo nodos y máquinas; Docker se gestiona aparte)
      for (const [k, e] of existing) {
        if (!seen.has(k) && ['node', 'vm', 'lxc'].includes(e.kind) && !e.missing) {
          missing++;
          tx.update(elements).set({ missing: true, status: 'unknown' }).where(eq(elements.id, e.id)).run();
        }
      }
      tx.update(servers)
        .set({ status: 'online', lastSeenAt: now, lastError: null, pveVersion: version.version })
        .where(eq(servers.id, server.id)).run();
    });

    return { nodes: nodes.length, vms, lxc, newElements, missing };
  } catch (err) {
    // Un fallo de conexión NO marca los elementos como ausentes: solo el servidor como offline.
    const msg = err instanceof Error ? err.message : String(err);
    db.update(servers).set({ status: 'offline', lastError: msg }).where(eq(servers.id, server.id)).run();
    throw err;
  } finally {
    await client.close();
  }
}
