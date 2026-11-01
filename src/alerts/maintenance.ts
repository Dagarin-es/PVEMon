/**
 * Modo mantenimiento: silencia las alertas de un elemento (y de todo lo que cuelga de él) durante un rato.
 * Útil para reiniciar o tocar un nodo a mano sin que salten avisos. Se guarda en ajustes: {idElemento: hasta (s)}.
 */
import { getSetting, setSetting } from './notify.js';

type Map_ = Record<string, number>;
const KEY = 'maintenance';
const nowSec = () => Math.floor(Date.now() / 1000);

export function activeMaintenance(): Map_ {
  const m = getSetting<Map_>(KEY) ?? {};
  const now = nowSec();
  const live = Object.fromEntries(Object.entries(m).filter(([, until]) => until > now));
  if (Object.keys(live).length !== Object.keys(m).length) setSetting(KEY, live); // limpia lo caducado
  return live;
}

export function startMaintenance(elementId: string, hours: number): number {
  const m = activeMaintenance();
  const until = nowSec() + Math.round(hours * 3600);
  m[elementId] = until;
  setSetting(KEY, m);
  return until;
}

export function endMaintenance(elementId: string): void {
  const m = activeMaintenance();
  delete m[elementId];
  setSetting(KEY, m);
}

/** ¿Está el elemento, o alguno de sus padres, en mantenimiento? */
export function inMaintenance(el: { id: string; parentId: string | null }, els: Map<string, { id: string; parentId: string | null }>, m: Map_): boolean {
  if (Object.keys(m).length === 0) return false;
  for (let c: { id: string; parentId: string | null } | undefined = el, i = 0; c && i < 10; c = c.parentId ? els.get(c.parentId) : undefined, i++) {
    if ((m[c.id] ?? 0) > nowSec()) return true;
  }
  return false;
}
