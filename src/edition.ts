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
export const brand = (s: string): string => EDITION === 'pvemon' || !s ? s : s
  .replace(/PVEMON/g, BRAND.name.toUpperCase())
  .replace(/PVEMon/g, BRAND.name)
  .replace(/(^|[^.\w])pvemon(?![-@\w])/g, '$1' + BRAND.name.toLowerCase());

/** Script que el navegador carga antes que nada: identifica la edición y la marca */
export const brandScript = (): string =>
  `window.EDITION=${JSON.stringify(EDITION)};window.BRAND=${JSON.stringify(BRAND)};` +
  `document.documentElement.setAttribute('data-ed',window.EDITION);document.title=window.BRAND.name;` +
  // BCKMon: direcciones de icono propias (?e=bckmon) para no heredar los iconos que el navegador tenga guardados de PVEMon en la misma dirección
  `window.ICQ=window.EDITION==='bckmon'?'?e=bckmon':'';` +
  `document.querySelectorAll('link[rel=icon],link[rel=apple-touch-icon]').forEach(function(l){l.setAttribute('href',l.getAttribute('href').split('?')[0]+window.ICQ)});`;

const ICQ = EDITION === 'bckmon' ? '?e=bckmon' : '';
export const manifest = () => ({
  name: BRAND.name, short_name: BRAND.name, description: BRAND.desc, start_url: '/', display: 'standalone',
  background_color: BRAND.bg, theme_color: BRAND.bg,
  icons: [
    { src: '/icon-192.png' + ICQ, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
    { src: '/icon-512.png' + ICQ, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    { src: '/icon.svg' + ICQ, sizes: 'any', type: 'image/svg+xml' },
  ],
});
