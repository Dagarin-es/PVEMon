/* Herramienta de una sola vez: envuelve los textos en castellano del front en T('…') para poder traducirlos.
 * Uso: node tools/i18n-codemod.mjs <fichero.js> [--write] [--report out.json]
 * El texto original (castellano) es la clave; con idioma es, T() devuelve el mismo texto. */
import fs from 'node:fs';
import * as acorn from 'acorn';

const [file, ...rest] = process.argv.slice(2);
const write = rest.includes('--write');
const reportFile = rest.includes('--report') ? rest[rest.indexOf('--report') + 1] : null;
const src = fs.readFileSync(file, 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', allowReturnOutsideFunction: true });

const SKIP_KEYS = new Set(['class', 'id', 'type', 'href', 'style', 'role', 'name', 'for', 'd', 'viewBox', 'fill', 'stroke', 'src', 'rel', 'target', 'autocomplete', 'inputmode', 'accept', 'min', 'max', 'step', 'pattern', 'method', 'enctype', 'tabindex', 'tabIndex', 'rows', 'cols', 'maxlength', 'width', 'height', 'x', 'y', 'rx', 'cx', 'cy', 'r', 'transform', 'points', 'data-id', 'aria-haspopup', 'aria-expanded', 'aria-pressed', 'aria-current', 'aria-modal', 'aria-hidden', 'aria-live', 'lang', 'value']);
const SKIP_CALLEE = new Set(['querySelector', 'querySelectorAll', 'closest', 'matches', 'getElementById', 'test', 'match', 'matchAll', 'getItem', 'setItem', 'removeItem', 'addEventListener', 'removeEventListener', 'add', 'remove', 'toggle', 'contains', 'getAttribute', 'removeAttribute', 'createElement', 'createElementNS', 'startsWith', 'endsWith', 'includes', 'indexOf', 'split', 'join', 'replace', 'replaceAll', 'padStart', 'padEnd', 'localeCompare', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'request', 'getPropertyValue', 'setProperty', 'getComputedStyle', 'append', 'fromEntries', 'has', 'get', 'set', 'delete', 'push', 'concat', 'dispatchEvent', 'scrollIntoView', 'focus', 'select', 'parse', 'stringify', 'matchMedia']);
const isEs = (s) => /[a-záéíóúñ¿¡]{3,}/i.test(s) && (/[ áéíóúñ¿¡«»…—·]/.test(s) || /^[A-ZÁÉÍÓÚ][a-záéíóúñ]{3,}$/.test(s));
const isMarkup = (s) => /^\s*</.test(s) || /\bd="|="[^"]*"/.test(s);

const edits = []; // {s,e,text}
const report = { wrapped: [], chains: [], skipped: [], markup: [] };
const slice = (s, e) => {
  const inner = edits.filter((x) => x.s >= s && x.e <= e).sort((a, b) => a.s - b.s);
  let out = '', p = s;
  for (const x of inner) { out += src.slice(p, x.s) + x.text; p = x.e; }
  return out + src.slice(p, e);
};
const dropEdits = (s, e) => { for (let i = edits.length - 1; i >= 0; i--) if (edits[i].s >= s && edits[i].e <= e) edits.splice(i, 1); };
const q = (s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
const keyName = (p) => (p.key.type === 'Identifier' ? p.key.name : p.key.type === 'Literal' ? String(p.key.value) : null);

function childrenOf(n) {
  const out = [];
  for (const k of Object.keys(n)) {
    if (k === 'type' || k === 'start' || k === 'end') continue;
    const v = n[k];
    if (Array.isArray(v)) v.forEach((x) => x && typeof x.type === 'string' && out.push([k, x]));
    else if (v && typeof v.type === 'string') out.push([k, v]);
  }
  return out;
}

/* ¿Es un texto que se muestra? Decide por el contexto del literal */
function contextSkip(node, parent, key, gp) {
  if (!parent) return false;
  if (parent.type === 'Property' && key === 'key' && !parent.computed) return true;
  if (parent.type === 'MethodDefinition' || parent.type === 'ImportDeclaration' || parent.type === 'ExportNamedDeclaration') return true;
  if (parent.type === 'Property' && key === 'value') { const k = keyName(parent); if (k && (SKIP_KEYS.has(k) || k.startsWith('data-'))) return true; }
  if (parent.type === 'BinaryExpression' && ['==', '===', '!=', '!=='].includes(parent.operator)) return true;
  if (parent.type === 'SwitchCase' && key === 'test') return true;
  if (parent.type === 'MemberExpression' && key === 'property' && parent.computed) return true;
  if (parent.type === 'CallExpression' && key === 'arguments') {
    const c = parent.callee;
    if (c.type === 'Identifier' && c.name === 'h' && parent.arguments[0] === node) return true;
    if (c.type === 'Identifier' && ['api', 'fetch', 'ic', 'KI', 'BKI', 'tIc', 'RegExp'].includes(c.name) && parent.arguments[0] === node) return true;
    if (c.type === 'MemberExpression' && !c.computed && SKIP_CALLEE.has(c.property.name)) {
      if (c.property.name === 'setAttribute' && parent.arguments[0] !== node) {
        const a0 = parent.arguments[0]; return !(a0 && a0.type === 'Literal' && ['title', 'aria-label', 'placeholder', 'alt'].includes(a0.value));
      }
      return true;
    }
    if (c.type === 'MemberExpression' && !c.computed && c.property.name === 'setAttribute') {
      const a0 = parent.arguments[0]; return parent.arguments[0] === node || !(a0 && a0.type === 'Literal' && ['title', 'aria-label', 'placeholder', 'alt'].includes(a0.value));
    }
  }
  if (parent.type === 'AssignmentExpression' && key === 'right') {
    const l = parent.left;
    if (l.type === 'MemberExpression' && !l.computed && ['hash', 'className', 'href', 'id', 'type', 'cssText', 'src', 'value', 'display', 'width', 'height', 'left', 'top', 'right', 'bottom', 'color', 'background'].includes(l.property.name)) return true;
    if (l.type === 'MemberExpression' && !l.computed && l.object.type === 'MemberExpression' && l.object.property.name === 'style') return true;
  }
  if (parent.type === 'NewExpression') return true;
  return false;
}

/* Cadenas a+'x'+b y plantillas `x${b}`: un único texto con huecos {0},{1}… */
function chainParts(node) {
  if (node.type === 'TemplateLiteral') {
    const parts = [];
    node.quasis.forEach((q2, i) => { parts.push({ lit: q2.value.cooked }); if (node.expressions[i]) parts.push({ expr: node.expressions[i] }); });
    return parts;
  }
  // BinaryExpression '+': aplanar por la izquierda mientras un lado sea literal de texto
  const parts = [];
  let cur = node;
  const right = [];
  while (cur.type === 'BinaryExpression' && cur.operator === '+' && (isStr(cur.left) || isStr(cur.right) || (cur.left.type === 'BinaryExpression' && cur.left.operator === '+' && hasStr(cur.left)))) {
    right.unshift(cur.right);
    cur = cur.left;
  }
  if (cur === node) return null;
  const all = [cur, ...right];
  for (const x of all) parts.push(isStr(x) ? { lit: x.type === 'Literal' ? x.value : x.quasis.map((q2) => q2.value.cooked).join('') } : { expr: x });
  return parts;
}
const isStr = (n) => (n.type === 'Literal' && typeof n.value === 'string');
const hasStr = (n) => n.type === 'BinaryExpression' && n.operator === '+' && (isStr(n.left) || isStr(n.right) || hasStr(n.left));

function visit(node, parent, key) {
  // 1) cadenas y plantillas
  if ((node.type === 'BinaryExpression' && node.operator === '+') || node.type === 'TemplateLiteral') {
    if (!(parent && parent.type === 'TaggedTemplateExpression') && !contextSkipChain(node, parent, key)) {
      const parts = chainParts(node);
      if (parts && parts.some((p) => 'lit' in p) && parts.filter((p) => 'expr' in p).length >= 1) {
        const lits = parts.filter((p) => 'lit' in p).map((p) => p.lit).join('');
        if (isEs(lits) && !isMarkup(lits)) {
          // primero los hijos dinámicos (pueden llevar sus propios textos)
          for (const p of parts) if (p.expr) visit(p.expr, node, 'part');
          let tpl = '', n = 0; const args = [];
          for (const p of parts) { if ('lit' in p) tpl += p.lit.replace(/\{(\d+)\}/g, '{ $1 }'); else { tpl += '{' + n++ + '}'; args.push(slice(p.expr.start, p.expr.end)); } }
          const text = 'T(' + q(tpl) + ', ' + args.join(', ') + ')';
          dropEdits(node.start, node.end);
          edits.push({ s: node.start, e: node.end, text });
          report.chains.push(tpl);
          return;
        }
      }
    }
  }
  // 2) literales sueltos
  if (node.type === 'Literal' && typeof node.value === 'string') {
    if (isEs(node.value)) {
      if (isMarkup(node.value)) report.markup.push(node.value.slice(0, 90));
      else if (contextSkip(node, parent, key)) report.skipped.push(node.value);
      else { edits.push({ s: node.start, e: node.end, text: 'T(' + q(node.value) + ')' }); report.wrapped.push(node.value); }
    }
    return;
  }
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    const v = node.quasis[0].value.cooked;
    if (isEs(v) && !isMarkup(v) && !contextSkip(node, parent, key)) { edits.push({ s: node.start, e: node.end, text: 'T(' + q(v) + ')' }); report.wrapped.push(v); }
    return;
  }
  for (const [k, c] of childrenOf(node)) visit(c, node, k);
}
function contextSkipChain(node, parent, key) {
  if (!parent) return false;
  if (parent.type === 'CallExpression' && key === 'arguments') {
    const c = parent.callee;
    if (c.type === 'Identifier' && ['api', 'fetch'].includes(c.name) && parent.arguments[0] === node) return true;
    if (c.type === 'Identifier' && c.name === 'h' && parent.arguments[0] === node) return true;
    if (c.type === 'MemberExpression' && !c.computed && ['querySelector', 'querySelectorAll', 'closest', 'getItem', 'setItem', 'addEventListener', 'getAttribute', 'matches'].includes(c.property.name)) return true;
  }
  if (parent.type === 'AssignmentExpression' && key === 'right') {
    const l = parent.left;
    if (l.type === 'MemberExpression' && !l.computed && ['hash', 'className', 'href', 'src', 'cssText', 'id'].includes(l.property.name)) return true;
    if (l.type === 'MemberExpression' && !l.computed && l.object.type === 'MemberExpression' && l.object.property.name === 'style') return true;
  }
  if (parent.type === 'Property' && key === 'value') { const k = keyName(parent); if (k && (SKIP_KEYS.has(k) || k.startsWith('data-'))) return true; }
  if (parent.type === 'BinaryExpression' && ['==', '===', '!=', '!=='].includes(parent.operator)) return true;
  return false;
}

visit(ast, null, null);
const sorted = edits.sort((a, b) => a.s - b.s);
for (let i = 1; i < sorted.length; i++) if (sorted[i].s < sorted[i - 1].e) throw new Error('edits solapados en ' + sorted[i].s);
let out = '', p = 0;
for (const x of sorted) { out += src.slice(p, x.s) + x.text; p = x.e; }
out += src.slice(p);
acorn.parse(out, { ecmaVersion: 'latest', allowReturnOutsideFunction: true }); // ha de seguir siendo válido
console.log(file, 'literales:', report.wrapped.length, 'cadenas:', report.chains.length, 'omitidos:', report.skipped.length, 'marcado:', report.markup.length);
if (reportFile) fs.writeFileSync(reportFile, JSON.stringify(report, null, 1));
if (write) fs.writeFileSync(file, out);
