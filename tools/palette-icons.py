#!/usr/bin/env python3
"""Genera los logos de cada paleta y edición en public/palettes/<edición>/<paleta>/ (icon.svg y PNG).
Uso:  python3 tools/palette-icons.py      (necesita Python con playwright y su Chromium)
Las paletas se definen aquí y en public/app.css (data-pal). Aurora de PVEMon es el icono original y no se genera."""
import base64, os, shutil, sys
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
SVG = {
  'pvemon': open(os.path.join(PUB, 'icon.svg'), encoding='utf-8').read(),
  'bckmon': open(os.path.join(PUB, 'editions', 'bckmon', 'icon.svg'), encoding='utf-8').read(),
}
# colores de las plantillas originales (PVEMon = aurora, BCKMon = lima)
BASE = {'pvemon': PAL['aurora'], 'bckmon': PAL['lima']}
BADGE = {'pvemon': os.path.join(PUB, 'badge-96.png'), 'bckmon': os.path.join(PUB, 'editions', 'bckmon', 'badge-96.png')}
ROUND = '<rect x="1" y="1" width="62" height="62" rx="15" fill="url(#r)" stroke="url(#g)" stroke-opacity=".5" stroke-width="1.2"/>'
FULL = '<rect width="64" height="64" fill="url(#r)"/>'

def recolor(ed, pal):
    s = SVG[ed]
    for a, b in zip(BASE[ed], PAL[pal]):
        s = s.replace(a, '@@' + b)
    return s.replace('@@', '')

def png(page, svg, size, path, transparent=False):
    uri = 'data:image/svg+xml;base64,' + base64.b64encode(svg.encode()).decode()
    page.set_viewport_size({'width': size, 'height': size})
    page.set_content(f'<body style="margin:0;background:transparent"><img src="{uri}" width="{size}" height="{size}" style="display:block">')
    page.wait_for_timeout(60)
    page.screenshot(path=path, omit_background=transparent, clip={'x': 0, 'y': 0, 'width': size, 'height': size})

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page()
    for ed in SVG:
        for pal in PAL:
            if ed == 'pvemon' and pal == 'aurora':
                continue  # el original de PVEMon queda como está
            d = os.path.join(PUB, 'palettes', ed, pal); os.makedirs(d, exist_ok=True)
            svg = recolor(ed, pal)
            assert ROUND in svg, 'plantilla inesperada'
            open(os.path.join(d, 'icon.svg'), 'w', encoding='utf-8').write(svg)
            full = svg.replace(ROUND, FULL)
            png(pg, full, 192, os.path.join(d, 'icon-192.png'))
            png(pg, full, 512, os.path.join(d, 'icon-512.png'))
            png(pg, full, 180, os.path.join(d, 'apple-touch-icon.png'))
            png(pg, svg, 32, os.path.join(d, 'favicon-32.png'), True)
            png(pg, svg, 48, os.path.join(d, 'favicon-48.png'), True)
            shutil.copy(BADGE[ed], os.path.join(d, 'badge-96.png'))
    b.close()
print('listo')
