/* Idioma de PVEMon. El texto en castellano es la clave: T('texto') devuelve el mismo texto en español
 * y su traducción en inglés si el idioma es «en». T('{0} nodos', n) rellena los huecos {0}, {1}…
 * El castellano es siempre el idioma por defecto; se cambia desde el selector (se recuerda en este navegador y en el usuario). */
(function () {
  var L = 'es';
  try { if (localStorage.getItem('pvemon.lang') === 'en') L = 'en'; } catch (e) {}
  window.LANG = L;
  window.LOC = L === 'en' ? 'en-GB' : 'es-ES';
  window.DEC = L === 'en' ? '.' : ',';
  document.documentElement.lang = L;
  if (L === 'en') document.write('<script src="/i18n/en.js"><\/script>'); // síncrono: el diccionario ha de estar antes del script principal
  window.T = function (s) {
    var r = s;
    if (L === 'en') { var d = window.I18N_EN; if (d && typeof d[s] === 'string' && d[s]) r = d[s]; }
    if (window.EDITION === 'bckmon') r = r.replace(/PVEMON/g, 'BCKMON').replace(/PVEMon/g, 'BCKMon').replace(/(^|[^.\w])pvemon(?![-@\w])/g, '$1bckmon');
    if (arguments.length < 2) return r;
    var a = arguments;
    return r.replace(/\{(\d+)\}/g, function (m, i) { return +i + 1 < a.length ? String(a[+i + 1]) : m; });
  };
  window.langStored = function () { try { return localStorage.getItem('pvemon.lang'); } catch (e) { return null; } };
  window.setLangLocal = function (l) { try { localStorage.setItem('pvemon.lang', l); } catch (e) {} };
})();
