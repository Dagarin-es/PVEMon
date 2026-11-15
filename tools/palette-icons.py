#!/usr/bin/env python3
"""Genera los logos «Atalaya» (torre) de cada edición y paleta:
  - PVEMon: torre con anillo discontinuo y ondas.   - BCKMon: torre dentro de un escudo.
Salida: public/palettes/<edición>/<paleta>/ (icon.svg, icon-192/512, apple-touch-icon, favicon-32/48, badge-96),
más los de origen: public/ (PVEMon · aurora) y public/editions/bckmon/ (BCKMon · lima).
Los iconos grandes usan el diseño completo; el favicon y la insignia monocroma usan una versión simplificada (formas gruesas, sin anillo).
Uso:  python3 tools/palette-icons.py      (necesita Python con playwright y su Chromium)
Las paletas se definen aquí y en public/app.css (data-pal)."""
import base64, os
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, 'public')

# (G1, G2, fondo claro del degradado, fondo oscuro del degradado)
PAL = {
  'aurora':  ('#2de2ff', '#b26bff', '#1a2350', '#07080f'),
  'lima':    ('#d4f26a', '#4fcf6a', '#14230a', '#050804'),
  'cobre':   ('#f0b070', '#d9773a', '#2a1608', '#0a0604'),
  'indigo':  ('#b8b4f5', '#6470d6', '#14153a', '#050510'),
  'grafito': ('#dfe6ee', '#8fa3b8', '#1c2128', '#07090b'),
}
SH = 'M0 -17 L14 -12 V0 C14 9 7 15 0 19 C-7 15 -14 9 -14 0 V-12 Z'  # escudo (centrado en 0,0)

def mix(c, w=.75):
    r, g, b = (int(c[i:i + 2], 16) for i in (1, 3, 5))
    return '#%02x%02x%02x' % tuple(round(v + (255 - v) * w) for v in (r, g, b))

def tower_old(fill, lantern):  # torre del diseño elegido (con barra en la base)
    return (f'<path d="M47 76 L50.5 50 L57.5 50 L61 76 Z" fill="{fill}"/><rect x="48.5" y="41" width="11" height="8" rx="1.5" fill="{lantern}"/>'
            f'<path d="M47 41 L54 35 L61 41 Z" fill="{fill}"/><rect x="40" y="76" width="28" height="3.4" rx="1.7" fill="{fill}" fill-opacity=".7"/>')
def waves_old(stroke):
    return (f'<g fill="none" stroke="{stroke}" stroke-width="3.4" stroke-linecap="round" transform="translate(0 1)">'
            '<path d="M39 46 A15 15 0 0 1 39 36 M33 49 A22 22 0 0 1 33 33"/><path d="M69 46 A15 15 0 0 0 69 36 M75 49 A22 22 0 0 0 75 33"/></g>')
def tower_bold(fill, lantern):  # versión gruesa para tamaños diminutos
    return (f'<path d="M45 83 L49.5 53 L58.5 53 L63 83 Z" fill="{fill}"/><rect x="45.5" y="47.5" width="17" height="5.5" rx="2" fill="{fill}"/>'
            f'<rect x="49" y="35.5" width="10" height="11" rx="2.2" fill="{lantern}"/><path d="M46 35.5 L54 27 L62 35.5 Z" fill="{fill}"/>')
def waves_bold(stroke):
    return (f'<g fill="none" stroke="{stroke}" stroke-width="4.4" stroke-linecap="round"><path d="M42.9 31 A15 15 0 0 0 42.9 51 M36.2 24.9 A24 24 0 0 0 36.2 57.1"/>'
            '<path d="M65.1 31 A15 15 0 0 1 65.1 51 M71.8 24.9 A24 24 0 0 1 71.8 57.1"/></g>')

def content(ed, pal, bold):
    g1, g2, b1, b2 = PAL[pal]; G = 'url(#g)'
    if ed == 'pvemon':
        if bold: return f'<g transform="translate(0 -1)">{tower_bold(G, g1)}{waves_bold(G)}</g>', (54, 55, .72)
        return f'<circle cx="54" cy="54" r="30" fill="none" stroke="{G}" stroke-width="1.8" stroke-opacity=".5" stroke-dasharray="4 6.2"/>{tower_old(G, g1)}{waves_old(G)}', (54, 54, .62)
    if bold: return (f'<path d="{SH}" transform="translate(54 56) scale(1.72)" fill="{G}"/><g transform="translate(54 53) scale(.74) translate(-54 -56)">{tower_bold(b2, mix(g1))}</g>'), (54, 56, .76)
    return (f'<path d="{SH}" transform="translate(54 55) scale(1.72)" fill="none" stroke="{G}" stroke-width="1.9" stroke-linejoin="round"/>'
            f'<g transform="translate(54 58) scale(.88) translate(-54 -58)">{tower_old(G, g1)}</g>'), (54, 56, .62)

def svg(ed, pal, bold=False, full=False):
    g1, g2, b1, b2 = PAL[pal]
    c, (cx, cy, k) = content(ed, pal, bold)
    bg = ('<rect width="64" height="64" fill="url(#r)"/>' if full else
          '<rect x="1" y="1" width="62" height="62" rx="15" fill="url(#r)" stroke="url(#g)" stroke-opacity=".5" stroke-width="1.2"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{g1}"/>'
            f'<stop offset="1" stop-color="{g2}"/></linearGradient><radialGradient id="r" cx=".5" cy=".5" r=".6"><stop offset="0" stop-color="{b1}"/><stop offset="1" stop-color="{b2}"/></radialGradient></defs>'
            f'{bg}<g transform="translate(32 32) scale({k}) translate(-{cx} -{cy})">{c}</g></svg>')

def badge(ed):  # silueta blanca para la insignia de notificaciones (solo cuenta la transparencia)
    if ed == 'pvemon':
        body = f'{tower_bold("#fff", "#fff")}{waves_bold("#fff")}'
    else:
        body = (f'<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="108" height="108"><rect width="108" height="108" fill="#fff"/><g transform="translate(54 53) scale(.74) translate(-54 -56)">{tower_bold("#000", "#000")}</g></mask>'
                f'<g mask="url(#m)"><path d="{SH}" transform="translate(54 56) scale(1.72)" fill="#fff"/></g>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="22 18 64 72">{body}</svg>'

def png(page, s, w, h, path, transparent=False):
    uri = 'data:image/svg+xml;base64,' + base64.b64encode(s.encode()).decode()
    page.set_viewport_size({'width': w, 'height': h})
    page.set_content(f'<body style="margin:0;background:transparent"><img src="{uri}" width="{w}" height="{h}" style="display:block">')
    page.wait_for_timeout(80)
    page.screenshot(path=path, omit_background=transparent, clip={'x': 0, 'y': 0, 'width': w, 'height': h})

def write_set(pg, ed, pal, d):
    os.makedirs(d, exist_ok=True)
    main = svg(ed, pal)
    open(os.path.join(d, 'icon.svg'), 'w', encoding='utf-8').write(main)
    full = svg(ed, pal, full=True)
    png(pg, full, 192, 192, os.path.join(d, 'icon-192.png'))
    png(pg, full, 512, 512, os.path.join(d, 'icon-512.png'))
    png(pg, full, 180, 180, os.path.join(d, 'apple-touch-icon.png'))
    small = svg(ed, pal, bold=True)
    png(pg, small, 32, 32, os.path.join(d, 'favicon-32.png'), True)
    png(pg, small, 48, 48, os.path.join(d, 'favicon-48.png'), True)
    png(pg, badge(ed), 96, 108, os.path.join(d, 'badge-96.png'), True)

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page()
    write_set(pg, 'pvemon', 'aurora', PUB)                                   # origen de PVEMon
    write_set(pg, 'bckmon', 'lima', os.path.join(PUB, 'editions', 'bckmon'))  # origen de BCKMon
    for ed in ('pvemon', 'bckmon'):
        for pal in PAL:
            if ed == 'pvemon' and pal == 'aurora': continue  # lo sirve public/ directamente
            write_set(pg, ed, pal, os.path.join(PUB, 'palettes', ed, pal))
    b.close()
print('listo')
