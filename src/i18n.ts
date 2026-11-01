/**
 * Idiomas de PVEMon (castellano e inglés). El texto en castellano es la clave del diccionario.
 *  - public/i18n/en.json         textos de la pantalla (los usa también el navegador)
 *  - public/i18n/en-server.json  textos que genera el servidor (errores, alertas, avisos, resumen…)
 * Las plantillas llevan huecos {0}, {1}…; al traducir, los huecos que son a su vez textos conocidos también se traducen.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type Lang = 'es' | 'en';
export const parseLang = (v: unknown): Lang => (v === 'en' ? 'en' : 'es');

const dir = resolve('public', 'i18n');
const load = (f: string): Record<string, string> => {
  try { return existsSync(resolve(dir, f)) ? (JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as Record<string, string>) : {}; }
  catch { return {}; }
};
const clientDict = load('en.json');
const dict: Record<string, string> = { ...clientDict, ...load('en-server.json') };

/** Diccionario del navegador como script (se carga de forma síncrona antes del script principal) */
export const clientDictScript = (): string => 'window.I18N_EN=' + JSON.stringify(clientDict).replace(/</g, '\\u003c') + ';';

const exact = new Map(Object.entries(dict).filter(([k, v]) => v));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = Object.entries(dict)
  .filter(([k, v]) => v && /\{\d+\}/.test(k))
  .map(([k, v]) => {
    const lit = k.replace(/\{\d+\}/g, '');
    const idx: number[] = [];
    const src = k.split(/(\{\d+\})/).map((p) => { const m = /^\{(\d+)\}$/.exec(p); if (m) { idx.push(Number(m[1])); return '([\\s\\S]*?)'; } return esc(p); }).join('');
    return { re: new RegExp('^' + src + '$'), idx, en: v, litLen: lit.length };
  })
  .filter((p) => p.litLen >= 4)
  .sort((a, b) => b.litLen - a.litLen);

const memo = new Map<string, string>();

/** Traduce un texto del servidor (exacto o por plantilla). Si no lo conoce, lo devuelve igual. */
export function tr(s: string, lang: Lang, depth = 0): string {
  if (lang !== 'en' || !s || s.length > 2000) return s;
  const hit = exact.get(s);
  if (hit !== undefined) return hit;
  const m0 = memo.get(s);
  if (m0 !== undefined) return m0;
  let out = s;
  if (depth < 3 && /[a-záéíóúñ]{3}/i.test(s)) {
    for (const p of patterns) {
      const m = p.re.exec(s);
      if (!m) continue;
      const args = p.idx.map((_, i) => tr(m[i + 1] ?? '', lang, depth + 1));
      const byIdx = new Map<number, string>();
      p.idx.forEach((n, i) => byIdx.set(n, args[i]!));
      out = p.en.replace(/\{(\d+)\}/g, (_, n: string) => byIdx.get(Number(n)) ?? '');
      break;
    }
    if (out === s && depth === 0) {
      // textos con varias líneas o frases: se traduce trozo a trozo
      if (s.includes('\n')) out = s.split('\n').map((l) => tr(l, lang, depth + 1)).join('\n');
      else if (s.includes(' · ')) { const parts = s.split(' · '); const t = parts.map((x) => tr(x, lang, depth + 1)); if (t.some((x, i) => x !== parts[i])) out = t.join(' · '); }
    }
  }
  if (memo.size > 5000) memo.clear();
  memo.set(s, out);
  return out;
}

/** T con huecos, para textos que escribe el servidor: tf('{0} alertas en pvemon', lang, n) */
export function tf(s: string, lang: Lang, ...a: unknown[]): string {
  const base = lang === 'en' ? (exact.get(s) ?? s) : s;
  return base.replace(/\{(\d+)\}/g, (m, i: string) => (Number(i) < a.length ? String(a[Number(i)]) : m));
}

/* Campos que nunca se traducen aunque su texto coincida con una frase conocida: son datos del usuario o de la configuración */
const KEEP = new Set(['name', 'displayName', 'alias', 'username', 'email', 'host', 'address', 'folder', 'processedFolder', 'inbox', 'mailbox', 'subject',
  'sender', 'from', 'to', 'format', 'formats', 'path', 'url', 'id', 'kind', 'state', 'token', 'tokenId', 'user', 'password', 'origin', 'serverName', 'elementName', 'groups', 'tags', 'file', 'dir', 'share', 'server', 'exportPath', 'serverHost']);

/** Traduce todos los textos de una respuesta JSON (menos los campos de datos del usuario) */
export function trDeep(v: unknown, lang: Lang, key = '', depth = 0): unknown {
  if (depth > 12) return v;
  if (typeof v === 'string') return KEEP.has(key) ? v : tr(v, lang);
  if (Array.isArray(v)) return v.map((x) => trDeep(x, lang, key, depth + 1));
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    const isRule = 'severity' in v && 'name' in v; // reglas de alerta: su nombre es un texto del sistema
    for (const [k, x] of Object.entries(v)) o[k] = isRule && k === 'name' && typeof x === 'string' ? tr(x, lang) : trDeep(x, lang, k, depth + 1);
    return o;
  }
  return v;
}
