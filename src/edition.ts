/**
 * Edición de la aplicación: la misma base de código se publica como PVEMon (nodos Proxmox + copias) o como BCKMon (solo copias).
 * Se elige al arrancar con la variable de entorno EDITION (la imagen de Docker de BCKMon la lleva ya puesta).
 */
export type Edition = 'pvemon' | 'bckmon';
export const EDITION: Edition = process.env.EDITION?.toLowerCase() === 'bckmon' ? 'bckmon' : 'pvemon';

export interface Brand { name: string; a: string; b: string; desc: string; bg: string; bgLight: string }
const BRANDS: Record<Edition, Brand> = {
  pvemon: { name: 'PVEMon', a: 'PVE', b: 'Mon', desc: 'Monitor de nodos PVE y Backups', bg: '#06070d', bgLight: '#e8ecf6' },
  bckmon: { name: 'BCKMon', a: 'BCK', b: 'Mon', desc: 'Monitor de copias de seguridad', bg: '#060a05', bgLight: '#eef3e6' },
};
export const BRAND: Brand = BRANDS[EDITION];

/** Cambia el nombre «pvemon» por el de la edición en los textos (no toca nombres técnicos: .pvemonbak, pvemon@pve, pvemon-update…) */
export const brand = (s: string): string => !s ? s : s
  .replace(/PVEMON/g, BRAND.name.toUpperCase())
  .replace(/PVEMon/g, BRAND.name)
  .replace(/(^|[^.\w])pvemon(?![-@\w])/g, '$1' + BRAND.name);

/** Paletas de color (data-pal): cada edición tiene la suya por defecto. El color de fondo se usa en el manifiesto de la app instalada */
export const PALETTES = ['aurora', 'lima', 'cobre', 'indigo', 'grafito'] as const;
export type Palette = (typeof PALETTES)[number];
export const PAL_DEFAULT: Palette = EDITION === 'bckmon' ? 'cobre' : 'aurora';
export const isPalette = (p: unknown): p is Palette => typeof p === 'string' && (PALETTES as readonly string[]).includes(p);
const PAL_BG: Record<Palette, string> = { aurora: '#06070d', lima: '#060a05', cobre: '#0a0706', indigo: '#080810', grafito: '#0b0d10' };
const PAL_BG_LIGHT: Record<Palette, string> = { aurora: '#e8ecf6', lima: '#eef3e6', cobre: '#f7efe7', indigo: '#eef0fb', grafito: '#eef0f3' };
/** Parte de la dirección de los iconos y del manifiesto: ?e=bckmon (para no heredar iconos guardados de PVEMon) y &p=paleta */
export const iconQuery = (pal: Palette): string => (EDITION === 'bckmon' ? '?e=bckmon&p=' : '?p=') + pal;

/** Script que el navegador carga antes que nada: identifica la edición, la marca y la paleta */
export const brandScript = (): string =>
  `window.EDITION=${JSON.stringify(EDITION)};window.BRAND=${JSON.stringify(BRAND)};` +
  `document.documentElement.setAttribute('data-ed',window.EDITION);document.title=window.BRAND.name;` +
  `window.PALS=${JSON.stringify(PALETTES)};window.PALDEF=${JSON.stringify(PAL_DEFAULT)};window.PALBG=${JSON.stringify(PAL_BG)};window.PALBGL=${JSON.stringify(PAL_BG_LIGHT)};` +
  // paleta elegida (guardada en el navegador); sin elección, la de la edición
  `window.PAL=window.PALDEF;try{var _p=localStorage.getItem('pvemon.pal');if(_p&&window.PALS.indexOf(_p)>=0)window.PAL=_p}catch(e){}` +
  `document.documentElement.setAttribute('data-pal',window.PAL);` +
  `window.setIcons=function(pal){window.ICQ=(window.EDITION==='bckmon'?'?e=bckmon&p=':'?p=')+pal;` +
  `document.querySelectorAll('link[rel=icon],link[rel=apple-touch-icon]').forEach(function(l){l.setAttribute('href',l.getAttribute('href').split('?')[0]+window.ICQ)});` +
  `var m=document.querySelector('link[rel=manifest]');if(m)m.setAttribute('href','/manifest.webmanifest'+window.ICQ)};window.setIcons(window.PAL);`;

export const manifest = (pal: Palette = PAL_DEFAULT) => {
  const q = iconQuery(pal), bg = PAL_BG[pal];
  return {
    name: BRAND.name, short_name: BRAND.name, description: BRAND.desc, start_url: '/', display: 'standalone',
    background_color: bg, theme_color: bg,
    icons: [
      { src: '/icon-192.png' + q, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icon-512.png' + q, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      { src: '/icon.svg' + q, sizes: 'any', type: 'image/svg+xml' },
    ],
  };
};
