/* Comprueba que cada texto de la pantalla (T('…') en public/) y del servidor (dist/, tras «npm run build») tiene su traducción al inglés.
 * Uso: node tools/i18n-check.mjs   → lista lo que falta y termina con error si hay algo sin traducir. */
import fs from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, 'public/i18n', f), 'utf8'));
const en = read('en.json');
const enSrv = fs.existsSync(path.join(root, 'public/i18n/en-server.json')) ? read('en-server.json') : {};
const IGNORE = /^(pill |banner |dot |big |dkr go|row kp|\s?bkbad|no-store|no-cache|no-referrer|config-antes|nombre de la tarea|tarea de copia de seguridad|nombre del servidor|duración|destino de la copia de seguridad|\n?\[pvemon\] Primera ejecución|upm m-|\s?bad|\s?off|\s?dim|\s?cur|led |card k-|row k-|kre kre-|margin:|Docker|Backups|CPU|PVEMon v\{0\}|© |Proxmox VE \{0\}|Notification|pveum |\{0\} min$)/;

const parse = (src) => acorn.parse(src, { ecmaVersion: 'latest', allowReturnOutsideFunction: true, sourceType: 'script' });
const walk = (n, f) => { if (!n || typeof n.type !== 'string') return; f(n); for (const k of Object.keys(n)) { const c = n[k]; if (Array.isArray(c)) c.forEach((x) => walk(x, f)); else if (c && typeof c.type === 'string') walk(c, f); } };

const missing = [];
const client = [];
for (const f of ['public/index.html', 'public/kiosk.js']) {
  let src = fs.readFileSync(path.join(root, f), 'utf8');
  if (f.endsWith('.html')) { const a = src.lastIndexOf('<script>') + 8; src = src.slice(a, src.indexOf('</script>', a)); }
  walk(parse(src), (n) => { if (n.type === 'CallExpression' && n.callee.name === 'T' && n.arguments[0]?.type === 'Literal') client.push(n.arguments[0].value); });
}
for (const k of new Set(client)) if (!en[k] && !IGNORE.test(k) && /[a-záéíóúñ]{3,}/i.test(k)) missing.push(['pantalla', k]);

/* Servidor: se buscan los textos en castellano del código compilado */
const distDir = path.join(root, 'dist');
if (fs.existsSync(distDir)) {
  const files = []; (function w(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) w(p); else if (p.endsWith('.js')) files.push(p); } })(distDir);
  const isEs = (s) => /[áéíóúñ¿¡«»…]|\b(el|la|los|las|de|del|que|no|se|un|una|por|con|para|es|está|al|ya|hay|sin|tu|su)\b/i.test(s) && /[a-záéíóúñ]{3,}/i.test(s) && !/^(SELECT|INSERT|DELETE|CREATE|#!|cat |chmod|mkdir|grep|sed |rm |journal|default-src|attachment|private,|public,|camera)/.test(s);
  const isStr = (n) => n.type === 'Literal' && typeof n.value === 'string';
  const hasStr = (n) => n.type === 'BinaryExpression' && n.operator === '+' && (isStr(n.left) || isStr(n.right) || hasStr(n.left));
  const dyn = (n) => { const r = []; (function f(x) { if (x.type === 'BinaryExpression' && x.operator === '+' && (hasStr(x) || isStr(x.left) || isStr(x.right))) { f(x.left); f(x.right); } else if (isStr(x)) { /* literal */ } else if (x.type === 'TemplateLiteral') x.expressions.forEach((e) => r.push(e)); else r.push(x); })(n); return r; };
  const tplOf = (n) => {
    const r = [];
    (function f(x) {
      if (x.type === 'BinaryExpression' && x.operator === '+' && (hasStr(x) || isStr(x.left) || isStr(x.right))) { f(x.left); f(x.right); }
      else if (isStr(x)) r.push(x.value);
      else if (x.type === 'TemplateLiteral') x.quasis.forEach((q, i) => { r.push(q.value.cooked); if (x.expressions[i]) r.push(null); });
      else r.push(null);
    })(n);
    let i = 0; return r.map((p) => (p === null ? '{' + i++ + '}' : p)).join('');
  };
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    let ast; try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' }); } catch { continue; }
    const seen = new Set();
    const visit = (n, p, k) => {
      if (!n || typeof n.type !== 'string') return;
      if (p && p.type === 'CallExpression' && p.callee.type === 'MemberExpression' && /^(info|warn|error|debug|trace|fatal|log)$/.test(p.callee.property.name || '') && k === 'arguments') return;
      if (n.type === 'ImportDeclaration') return;
      const chain = (n.type === 'BinaryExpression' && n.operator === '+' && hasStr(n)) || (n.type === 'TemplateLiteral' && n.expressions.length);
      let t = null;
      if (chain) t = tplOf(n); else if (isStr(n)) t = n.value; else if (n.type === 'TemplateLiteral') t = n.quasis[0].value.cooked;
      if (t !== null && isEs(t) && !(p && p.type === 'Property' && k === 'key')) {
        if (!en[t] && !enSrv[t] && !IGNORE.test(t) && !seen.has(t)) { seen.add(t); missing.push([path.relative(distDir, f), t]); }
      }
      if (chain) { for (const e of dyn(n)) visit(e, n, 'part'); return; }
      for (const key of Object.keys(n)) { if (key === 'type') continue; const c = n[key]; if (Array.isArray(c)) c.forEach((x) => visit(x, n, key)); else if (c && typeof c.type === 'string') visit(c, n, key); }
    };
    visit(ast, null, null);
  }
} else console.log('(dist/ no existe: solo se ha comprobado la pantalla; ejecuta «npm run build» para comprobar también el servidor)');

if (missing.length) {
  console.log(`Faltan ${missing.length} traducciones:`);
  for (const [w, k] of missing) console.log(`  [${w}] ${JSON.stringify(k.length > 110 ? k.slice(0, 110) + '…' : k)}`);
  process.exit(1);
}
console.log(`✔ Todo traducido (${Object.keys(en).length} textos de pantalla, ${Object.keys(enSrv).length} del servidor).`);
