/**
 * Catálogo de métricas posibles. Es la fuente de verdad de:
 *  - qué se puede monitorizar en cada tipo de elemento
 *  - cómo se muestra por defecto (el equivalente a tu panel de Home Assistant)
 * El usuario solo guarda excepciones en element_metrics.
 */
import type { ElementKind } from '../db/schema.js';

export type Widget = 'gauge' | 'line' | 'chip' | 'number';

export interface MetricDef {
  key: string;
  label: string;
  unit: '%' | 'B' | 'B/s' | 's' | '°C' | '';
  appliesTo: ElementKind[];
  source: 'pve' | 'docker' | 'backup' | 'host'; // 'host' = requiere sensores/agente (fase posterior)
  widget: Widget;
  /** Umbrales por defecto para colorear (verde/amarillo/rojo). */
  thresholds?: { warn: number; crit: number };
  /** Se activa por defecto al marcar el elemento como monitorizado. */
  defaultOn: boolean;
}

const G = ['node', 'vm', 'lxc'] as const;

export const METRICS: MetricDef[] = [
  { key: 'status',       label: 'Estado',            unit: '',    appliesTo: ['node', 'vm', 'lxc', 'docker'], source: 'pve',    widget: 'chip',   defaultOn: true },
  { key: 'cpu.usage',    label: 'CPU',               unit: '%',   appliesTo: [...G, 'docker'], source: 'pve',    widget: 'gauge',  thresholds: { warn: 75, crit: 90 }, defaultOn: true },
  { key: 'mem.usage',    label: 'Memoria',           unit: '%',   appliesTo: [...G, 'docker'], source: 'pve',    widget: 'gauge',  thresholds: { warn: 80, crit: 90 }, defaultOn: true },
  { key: 'mem.used',     label: 'Memoria usada',     unit: 'B',   appliesTo: [...G, 'docker'], source: 'pve',    widget: 'line',   defaultOn: false },
  { key: 'disk.usage',   label: 'Disco',             unit: '%',   appliesTo: ['node', 'vm', 'lxc'],     source: 'pve',    widget: 'gauge',  thresholds: { warn: 80, crit: 90 }, defaultOn: true },
  { key: 'disk.fs.used', label: 'Disco usado (agente)', unit: 'B', appliesTo: ['vm'], source: 'pve', widget: 'line', defaultOn: false },
  { key: 'disk.fs.total', label: 'Disco total (agente)', unit: 'B', appliesTo: ['vm'], source: 'pve', widget: 'line', defaultOn: false },
  { key: 'disk.size',   label: 'Disco usado (capa del contenedor)', unit: 'B', appliesTo: ['docker'], source: 'docker', widget: 'line', defaultOn: false },
  { key: 'net.in',       label: 'Red entrada',       unit: 'B/s', appliesTo: [...G, 'docker'], source: 'pve',    widget: 'line',   defaultOn: false },
  { key: 'net.out',      label: 'Red salida',        unit: 'B/s', appliesTo: [...G, 'docker'], source: 'pve',    widget: 'line',   defaultOn: false },
  { key: 'uptime',       label: 'Tiempo encendido',  unit: 's',   appliesTo: [...G, 'docker'], source: 'pve',    widget: 'number', defaultOn: true },
  { key: 'load.1m',      label: 'Carga (1 min)',     unit: '',    appliesTo: ['node'],         source: 'pve',    widget: 'line',   defaultOn: false },
  { key: 'docker.online', label: 'Docker responde',  unit: '',    appliesTo: ['vm', 'lxc'],     source: 'docker', widget: 'chip',   defaultOn: true },
  { key: 'docker.down', label: 'Contenedores caídos', unit: '', appliesTo: ['vm', 'lxc'], source: 'docker', widget: 'number', defaultOn: false },
  { key: 'health',       label: 'Salud (healthcheck)', unit: '',  appliesTo: ['docker'],       source: 'docker', widget: 'chip',   defaultOn: true },
  { key: 'backup.problem', label: 'Copia de seguridad', unit: '', appliesTo: ['vm', 'lxc', 'backup'], source: 'backup', widget: 'chip',   defaultOn: true },
  { key: 'backup.age',   label: 'Antigüedad de la copia', unit: 's', appliesTo: ['vm', 'lxc', 'backup'], source: 'backup', widget: 'number', defaultOn: true },
  { key: 'backup.storage', label: 'Almacén de copias (uso)', unit: '%', appliesTo: ['node'], source: 'backup', widget: 'gauge', thresholds: { warn: 80, crit: 90 }, defaultOn: false },
  { key: 'disks.bad',    label: 'Discos con problemas', unit: '',   appliesTo: ['node'],         source: 'pve',    widget: 'number', defaultOn: false },
  { key: 'disks.wear',   label: 'Desgaste de SSD',   unit: '%',   appliesTo: ['node'],         source: 'pve',    widget: 'gauge',  thresholds: { warn: 80, crit: 90 }, defaultOn: false },
  { key: 'disks.temp',   label: 'Temperatura de discos', unit: '°C', appliesTo: ['node'],      source: 'pve',    widget: 'gauge',  thresholds: { warn: 55, crit: 65 }, defaultOn: false },
  { key: 'temp.cpu',     label: 'Temperatura CPU',   unit: '°C',  appliesTo: ['node'],         source: 'pve',    widget: 'gauge',  thresholds: { warn: 80, crit: 90 }, defaultOn: false },
];

export const metricsFor = (kind: ElementKind) => METRICS.filter((m) => m.appliesTo.includes(kind));
export const metricByKey = (key: string) => METRICS.find((m) => m.key === key);
