/** Datos de discos de un nodo: tipos y lectura de lo último guardado (lo usan alertas y rutas). */
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export interface DiskInfo {
  dev: string; model: string; serial: string; size: number; type: string; health: string;
  wear: number | null;      // % de vida gastada (100 - wearout de Proxmox)
  temp: number | null;      // °C
  hours: number | null;     // horas encendido
  cycles?: number | null;   // ciclos de encendido
  realloc: number | null; pending: number | null; mediaErr: number | null;
  bad: boolean;             // fallo SMART, sectores pendientes o errores de medio
  why: string | null;
}
export interface PoolInfo { name: string; health: string; size: number; alloc: number; frag: number | null; bad: boolean }
export interface NodeDisks { disks: DiskInfo[]; pools: PoolInfo[]; error: string | null; at: number }

export function getNodeDisks(elementId: string): NodeDisks | null {
  const r = db.select().from(schema.nodeDisks).where(eq(schema.nodeDisks.elementId, elementId)).get();
  return r ? { ...(r.data as Omit<NodeDisks, 'at'>), at: r.updatedAt } : null;
}

const label = (d: DiskInfo) => `${d.model.trim() || d.dev} (${d.dev})`;

/** Texto de una alerta de discos, con el nombre de los discos afectados. */
export function describeDisks(key: string, v: number, elementId?: string): string {
  const nd = elementId ? getNodeDisks(elementId) : null;
  const n = (x: number) => x.toLocaleString('es-ES', { maximumFractionDigits: 0 });
  if (key === 'disks.bad') {
    const list = [...(nd?.disks.filter((d) => d.bad).map((d) => `${label(d)}${d.why ? ': ' + d.why : ''}`) ?? []), ...(nd?.pools.filter((p) => p.bad).map((p) => `ZFS «${p.name}»: ${p.health}`) ?? [])];
    return list.length ? `Problema de disco: ${list.slice(0, 4).join(' · ')}${list.length > 4 ? '…' : ''}` : `${v} disco(s) con problemas`;
  }
  if (key === 'disks.wear') {
    const d = nd?.disks.filter((x) => x.wear !== null).sort((a, b) => (b.wear ?? 0) - (a.wear ?? 0))[0];
    return d ? `Desgaste del SSD ${label(d)}: ${n(d.wear!)} % de su vida gastada` : `Desgaste de SSD: ${n(v)} %`;
  }
  if (key === 'disks.temp') {
    const d = nd?.disks.filter((x) => x.temp !== null).sort((a, b) => (b.temp ?? 0) - (a.temp ?? 0))[0];
    return d ? `Temperatura de ${label(d)}: ${n(d.temp!)} °C` : `Temperatura de disco: ${n(v)} °C`;
  }
  return '';
}
