/**
 * Interpreta los correos de copias de seguridad.
 *  - Formato integrado: Synology Hyper Backup (en español y en inglés).
 *  - Formatos propios (Cobian, Veeam, etc.): el administrador indica qué texto significa «bien» y cuál «mal».
 * La hora de la copia es la cabecera Date del correo (evita problemas de zona horaria).
 */

export interface RawMail { /** carpeta (tal como se pidió) y UID dentro de ella, para poder moverlo después */ folder?: string; uid?: number; messageId: string; subject: string; from: string; date: number; text: string }

export interface Parsed { source: string; task: string; ok: boolean; at: number; detail: string | null; format: string; /** bytes (tamaño total de origen, si el correo lo trae) */ size?: number }

export interface CustomFormat {
  name: string;
  subjectContains?: string;
  fromContains?: string;
  bodyContains?: string;
  /** Si el correo contiene alguno de estos textos, la copia ha fallado (se mira primero) */
  fail: string[];
  /** Si contiene alguno de estos, ha ido bien */
  ok: string[];
  /** Expresión con un grupo que captura el nombre de la tarea (opcional) */
  taskRegex?: string;
  /** Idem para el nombre del equipo/NAS de origen (opcional) */
  sourceRegex?: string;
  defaultSource?: string;
  defaultTask?: string;
}

export type ParseResult = { kind: 'parsed'; parsed: Parsed } | { kind: 'ignored' } | { kind: 'unknown' };

const has = (hay: string, needle?: string) => !needle || hay.toLowerCase().includes(needle.toLowerCase());
const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function rx(src: string | undefined, text: string): string | null {
  if (!src) return null;
  try {
    const m = new RegExp(src, 'im').exec(text);
    return m?.[1] ? clean(m[1]) : null;
  } catch { return null; }
}

/** Líneas «Clave: valor» del cuerpo, con la clave en minúsculas */
function fields(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of text.split(/\r?\n/)) {
    const m = /^\s*([^:\n]{2,40}?)\s*:\s*(.+?)\s*$/.exec(l);
    if (m && !out.has(m[1]!.toLowerCase())) out.set(m[1]!.toLowerCase(), m[2]!);
  }
  return out;
}

/** «Tamaño de fuente total:» seguido de líneas «- Carpeta compartida: 617.8 GB»: suma de todas (en bytes) */
export function synologySourceSize(text: string): number | undefined {
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex((l) => /^\s*(tama[ñn]o de fuente total|total source size)\s*:?\s*$/i.test(l));
  if (i < 0) return undefined;
  const mult: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  let total = 0, n = 0;
  for (const l of lines.slice(i + 1)) {
    if (!l.trim()) { if (n) break; else continue; }
    const m = /^\s*[-•*]\s*[^:]+:\s*([\d.,]+)\s*(B|KB|MB|GB|TB)\b/i.exec(l);
    if (!m) { if (n) break; else continue; }
    const v = Number(m[1]!.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
    if (Number.isFinite(v)) { total += v * mult[m[2]!.toUpperCase()]!; n++; }
  }
  return n ? Math.round(total) : undefined;
}

/* ───────────── Synology Hyper Backup ───────────── */

const SYNO_HINT = /hyper backup|nombre de la tarea|tarea de copia de seguridad|network backup|backup task|task name/i;
const SYNO_IGNORE = /integridad|rotaci[oó]n|versiones antiguas|restaur|integrity|rotation|restor|version/i;

function parseSynology(m: RawMail): ParseResult {
  const all = `${m.subject}\n${m.text}`;
  if (!SYNO_HINT.test(all)) return { kind: 'unknown' };
  if (SYNO_IGNORE.test(m.subject)) return { kind: 'ignored' };

  const f = fields(m.text);
  const task = clean(
    f.get('nombre de la tarea') ?? f.get('tarea de copia de seguridad') ?? f.get('task name') ?? f.get('backup task')
    ?? /(?:network backup|backup task|tarea)\s*[-–:]\s*(.+?)\s+(?:se ha|has|ha )/i.exec(m.subject)?.[1]
    ?? /^\[[^\]]+\]\s*(.+?)\s+(?:se ha|has|ha )/i.exec(m.subject)?.[1],
  );
  if (!task) return { kind: 'unknown' };

  let source = /^\s*\[([^\]]+)\]/.exec(m.subject)?.[1]
    ?? /^\s*(?:de|desde|from)\s+(\S+)\s*$/im.exec(m.text)?.[1]
    ?? f.get('nombre del servidor') ?? f.get('server name') ?? f.get('servidor');
  source = clean(source);
  if (!source) return { kind: 'unknown' };

  const subj = m.subject.toLowerCase();
  let ok: boolean;
  if (/parcialmente|partially/.test(all.toLowerCase())) ok = false;
  else if (/ha fallado|fall[oó]|failed/.test(subj) || /ha fallado|failed/.test(all.toLowerCase()) && !/se ha completado|se ha realizado|completed|performed/.test(all.toLowerCase())) ok = false;
  else if (/se ha completado|se ha realizado|has completed|has been performed|completed/.test(all.toLowerCase())) ok = true;
  else return { kind: 'unknown' };

  let detail: string | null = null;
  if (!ok) {
    const dur = f.get('duración') ?? f.get('duracion') ?? f.get('duration');
    const dest = f.get('destino de la copia de seguridad') ?? f.get('destino') ?? f.get('backup destination');
    const partial = /parcialmente|partially/.test(all.toLowerCase());
    detail = `${partial ? 'La copia se completó solo parcialmente' : 'La copia falló'}${dur ? ` (duración: ${dur})` : ''}${dest ? ` · destino: ${dest}` : ''} · revisa Hyper Backup > Registro`;
  }
  return { kind: 'parsed', parsed: { source, task, ok, at: m.date, detail, format: 'Synology Hyper Backup', size: ok ? synologySourceSize(m.text) : undefined } };
}

/* ───────────── Formatos propios ───────────── */

function parseCustom(m: RawMail, fm: CustomFormat): ParseResult {
  const all = `${m.subject}\n${m.text}`.toLowerCase();
  if (!fm.subjectContains && !fm.fromContains && !fm.bodyContains) return { kind: 'unknown' };
  if (!has(m.subject, fm.subjectContains) || !has(m.from, fm.fromContains) || !has(m.text, fm.bodyContains)) return { kind: 'unknown' };
  const full = `${m.subject}\n${m.text}`;
  const isFail = fm.fail.some((t) => t && all.includes(t.toLowerCase()));
  const isOk = fm.ok.some((t) => t && all.includes(t.toLowerCase()));
  if (!isFail && !isOk) return { kind: 'ignored' };
  const task = rx(fm.taskRegex, full) ?? clean(fm.defaultTask) ?? clean(m.subject);
  const source = rx(fm.sourceRegex, full) ?? clean(fm.defaultSource);
  if (!source || !task) return { kind: 'unknown' };
  return {
    kind: 'parsed',
    parsed: { source, task, ok: !isFail, at: m.date, detail: isFail ? `La copia falló: «${clean(m.subject).slice(0, 120)}»` : null, format: fm.name },
  };
}

export function parseMail(m: RawMail, formats: CustomFormat[]): ParseResult {
  for (const fm of formats) {
    const r = parseCustom(m, fm);
    if (r.kind !== 'unknown') return r;
  }
  return parseSynology(m);
}
