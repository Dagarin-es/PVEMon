#!/usr/bin/env python3
"""Genera las guías de usuario en PDF (PVEMon y BCKMon, castellano e inglés).

Uso:  python3 tools/manual/build.py [salida]      (por defecto: public/manuals)
Necesita Playwright con Chromium. Las capturas están en tools/manual/shots (se regeneran con
shots.py contra un PVEMon/BCKMon en marcha) y las de nodos/VM/kiosko en img-pvemon-es|en.
"""
import base64, html, os, sys
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', 'public', 'manuals')
VER = '2.4.4'
DATE = {'es': '15 de noviembre de 2026', 'en': '15 November 2026'}


def b64(path):
    mime = 'svg+xml' if path.endswith('svg') else 'png' if path.endswith('png') else 'jpeg'
    with open(path, 'rb') as f:
        return 'data:image/' + mime + ';base64,' + base64.b64encode(f.read()).decode()


class Doc:
    def __init__(self, ed, lang):
        self.ed, self.lang = ed, lang
        self.bck = ed == 'bckmon'
        self.name = 'BCKMon' if self.bck else 'PVEMon'
        self.other = 'PVEMon' if self.bck else 'BCKMon'
        self.parts, self.toc, self.n = [], [], 0
        self.kind = 'manual'
        self.extra_css = ''
        self.title_es, self.title_en = 'Guía de usuario', 'User guide'

    # texto según idioma
    def t(self, es, en):
        return es if self.lang == 'es' else en

    def x(self, s):  # texto con **negrita** y `código`
        s = html.escape(s)
        out, bold, code = '', False, False
        i = 0
        while i < len(s):
            if s.startswith('**', i):
                out += '</b>' if bold else '<b>'; bold = not bold; i += 2
            elif s[i] == '`':
                out += '</code>' if code else '<code>'; code = not code; i += 1
            else:
                out += s[i]; i += 1
        return out

    def h1(self, es, en):
        self.n += 1
        txt = self.t(es, en)
        self.toc.append((f's{self.n}', txt))
        self.parts.append(f'<h1 id="s{self.n}">{html.escape(txt)}</h1>')

    def h2(self, es, en):
        self.parts.append(f'<h2>{html.escape(self.t(es, en))}</h2>')

    def p(self, es, en):
        self.parts.append(f'<p>{self.x(self.t(es, en))}</p>')

    def ul(self, items):
        self.parts.append('<ul>' + ''.join(f'<li>{self.x(self.t(*i))}</li>' for i in items) + '</ul>')

    def ol(self, items):
        self.parts.append('<ol>' + ''.join(f'<li>{self.x(self.t(*i))}</li>' for i in items) + '</ol>')

    def note(self, es, en, kind='note'):
        self.parts.append(f'<div class="box {kind}">{self.x(self.t(es, en))}</div>')

    def table(self, head, rows):
        h = ''.join(f'<th>{html.escape(self.t(*c))}</th>' for c in head)
        r = ''.join('<tr>' + ''.join(f'<td>{self.x(self.t(*c))}</td>' for c in row) + '</tr>' for row in rows)
        self.parts.append(f'<table><tr>{h}</tr>{r}</table>')

    def img(self, name, es, en, narrow=False, old=False):
        if old:
            path = os.path.join(HERE, f'img-pvemon-{self.lang}', name + '.jpg')
        else:
            path = os.path.join(HERE, 'shots', f'{self.ed}-{self.lang}-{name}.jpg')
        cls = 'shot narrow' if narrow else 'shot'
        self.parts.append(f'<figure class="{cls}"><img src="{b64(path)}"><figcaption>{html.escape(self.t(es, en))}</figcaption></figure>')

    def render(self):
        sub = self.t('Monitor de copias de seguridad', 'Backup monitor') if self.bck else self.t('Monitor de nodos PVE y Backups', 'PVE node and backup monitor')
        accent = '#d9822b' if self.bck else '#3a6df0'
        g1, g2 = ('#f0b070', '#d9773a') if self.bck else ('#2de2ff', '#b26bff')
        icon = b64(os.path.join(HERE, '..', '..', 'public', 'editions', 'bckmon', 'icon.svg')) if False else None
        toc = ''.join(f'<li><a href="#{i}">{html.escape(t)}</a></li>' for i, t in self.toc)
        title = self.t(self.title_es, self.title_en)
        pub = os.path.join(HERE, '..', '..', 'public')
        logo = b64(os.path.join(pub, 'palettes', 'bckmon', 'cobre', 'icon.svg') if self.bck else os.path.join(pub, 'icon.svg'))
        nm = self.name[:-3] + '<span class="mon">Mon</span>'
        css = f'''
@page{{size:A4;margin:18mm 16mm 20mm}}
*{{box-sizing:border-box}}
body{{font:10.5pt/1.5 Inter,"DejaVu Sans",sans-serif;color:#1b2233;margin:0}}
h1{{font-size:19pt;color:{accent};margin:9mm 0 4mm;padding-bottom:2mm;border-bottom:2px solid {accent};page-break-after:avoid}}
h2{{font-size:13pt;margin:6mm 0 2mm;color:#1b2233;page-break-after:avoid}}
p{{margin:0 0 3mm}} ul,ol{{margin:0 0 3mm;padding-left:6mm}} li{{margin-bottom:1.2mm}}
code{{font:9pt "DejaVu Sans Mono",monospace;background:#eef1f7;padding:0 1mm;border-radius:1mm}}
table{{border-collapse:collapse;width:100%;margin:2mm 0 4mm;font-size:9.5pt;page-break-inside:avoid}}
th{{background:{accent};color:#fff;text-align:left;padding:1.6mm 2.4mm}} td{{border-bottom:1px solid #d8deea;padding:1.6mm 2.4mm;vertical-align:top}}
.box{{border-left:3px solid {accent};background:#f2f5fb;padding:2.5mm 3.5mm;margin:2mm 0 4mm;border-radius:0 2mm 2mm 0;page-break-inside:avoid}}
.box.warn{{border-color:#d33a3a;background:#fdf1f1}}
figure{{margin:2mm 0 5mm;page-break-inside:avoid;text-align:center}} figure img{{max-width:100%;max-height:150mm;border-radius:2mm;border:1px solid #cfd6e4}}
figure.narrow img{{max-height:120mm;max-width:75%}}
figcaption{{font-size:8.5pt;color:#667089;margin-top:1.2mm}}
.cover{{height:250mm;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;page-break-after:always}}
.cover .lg{{width:42mm;height:42mm;margin-bottom:8mm}} .cover .n{{font-size:46pt;font-weight:800;color:#1b2233;letter-spacing:1px}} .cover .n .mon{{background:linear-gradient(90deg,{g1},{g2});-webkit-background-clip:text;color:transparent}} .cover .s{{font-size:15pt;color:#44506b;margin:2mm 0 14mm}}
.cover .g{{font-size:26pt;font-weight:700}} .cover .v{{margin-top:6mm;color:#667089}}
.toc li{{margin-bottom:1.6mm}} {self.extra_css} .toc a{{color:#1b2233;text-decoration:none}} .toc{{font-size:11pt}}
'''
        cover = f'''<div class="cover"><img class="lg" src="{logo}"><div class="n">{nm}</div><div class="s">{sub}</div><div class="g">{title}</div>
<div class="v">{self.t("Versión", "Version")} {VER} · {DATE[self.lang]}<br>{self.t("Licencia MIT · Dagarin", "MIT licence · Dagarin")}</div></div>'''
        return f'<!doctype html><meta charset="utf-8"><style>{css}</style>{cover}<h1 style="page-break-before:auto;margin-top:0">{self.t("Índice", "Contents")}</h1><ol class="toc">{toc}</ol>' + ''.join(self.parts)


def common_intro(d):
    N = d.name
    d.h1('Qué es y qué puedes hacer', 'What it is and what you can do')
    if d.bck:
        d.p(f'**{N}** es un monitor de copias de seguridad. Reúne en una sola pantalla el estado de todas tus copias —las de los NAS, las de los programas que avisan por correo, las comprobaciones de archivos en un disco de red y la copia de {N} mismo— y te avisa cuando una falta, falla o es demasiado antigua.',
            f'**{N}** is a backup monitor. It gathers the state of all your backups on a single screen — NAS backups, backup programs that report by e-mail, file checks on a network drive and {N}\'s own backup — and warns you when one is missing, failing or too old.')
        d.p(f'{N} es la edición de copias de PVEMon: comparten el mismo código y el mismo servidor, y solo cambian el aspecto y las pantallas (BCKMon no muestra nodos, máquinas ni Docker).',
            f'{N} is the backup edition of PVEMon: both share the same code and the same server; only the look and the screens differ ({N} shows no nodes, machines or Docker).')
        d.ul([('**Un solo panel de copias** con semáforo, última copia correcta, tamaño y cuánto falta para que salte la alarma.', '**One backup panel** with a traffic light, last successful backup, size and time left before the alarm.'),
              ('**Avisos** por correo, Telegram, notificaciones push, webhook y Microsoft Teams.', '**Notices** by e-mail, Telegram, push notifications, webhook and Microsoft Teams.'),
              ('**Resumen semanal** con el estado de todas las copias.', '**Weekly summary** with the state of every backup.'),
              ('**Copia automática de la propia aplicación** a una carpeta, NAS o nube.', '**Automatic backup of the application itself** to a folder, NAS or cloud.'),
              ('**Kioscos** para ver el panel en una pantalla fija.', '**Kiosks** to show the panel on a fixed screen.')])
    else:
        d.p(f'**{N}** es un monitor de solo lectura de tus servidores Proxmox VE: nodos, máquinas virtuales, contenedores LXC, Docker, discos y copias de seguridad. Te enseña el estado de un vistazo y te avisa cuando algo falla. Nunca modifica nada de tus servidores.',
            f'**{N}** is a read-only monitor for your Proxmox VE servers: nodes, virtual machines, LXC containers, Docker, disks and backups. It shows the state at a glance and warns you when something fails. It never changes anything on your servers.')
        d.ul([('**Panel** con anillos de CPU, memoria y disco de cada nodo y máquina, y avisos de lo que necesita atención.', '**Dashboard** with CPU, memory and disk rings for every node and machine, and warnings about what needs attention.'),
              ('**Backups**: copias de Proxmox (vzdump), de NAS y otros programas (por correo), comprobación de archivos en un disco de red y la copia de PVEMon.', '**Backups**: Proxmox (vzdump) backups, NAS and other programs (by e-mail), file checks on a network drive and PVEMon\'s own backup.'),
              ('**Alertas** por correo, Telegram, push, webhook y Microsoft Teams; resumen semanal.', '**Alerts** by e-mail, Telegram, push, webhook and Microsoft Teams; weekly summary.'),
              ('**Salud de los discos** (SMART, desgaste, temperatura, ZFS).', '**Disk health** (SMART, wear, temperature, ZFS).'),
              ('**Kioscos** para pantallas fijas, e **instalación como app** en el móvil u ordenador.', '**Kiosks** for fixed screens, and **installation as an app** on phone or computer.')])
        d.note('Si necesitas la edición solo de copias de seguridad, existe **BCKMon**, con su propia guía.', 'If you only need the backup edition, there is **BCKMon**, with its own guide.')
        d.p('PVEMon y BCKMon comparten el mismo código y la misma base: cualquier mejora llega a las dos.', 'PVEMon and BCKMon share the same code and database: every improvement reaches both.')

    d.h1(f'Entrar en {N}', f'Signing in to {N}')
    d.p('Abre la dirección que te haya dado tu administrador, escribe tu usuario y tu contraseña y pulsa **Entrar**. Si tu cuenta tiene verificación en dos pasos (2FA), te pedirá también el código de tu app de autenticación. Debajo del formulario puedes elegir el idioma (Español / English).',
        'Open the address your administrator gave you, type your username and password and press **Sign in**. If your account has two-step verification (2FA) it will also ask for the code from your authenticator app. Below the form you can choose the language (Español / English).')
    if not d.bck:
        d.img('000', 'Pantalla de acceso', 'Sign-in screen', narrow=True, old=True)
    d.note('Tras 10 intentos fallidos en 15 minutos la cuenta se bloquea un tiempo. Si olvidas la contraseña, pide a un administrador que la restablezca.', 'After 10 failed attempts in 15 minutes the account is locked for a while. If you forget your password, ask an administrator to reset it.')


def header_menu(d):
    N = d.name
    d.h1('Barra de título y menú', 'Title bar and menu')
    d.p('La cabecera tiene tres zonas: a la izquierda el nombre y el icono; **en el centro**, los botones de navegación; y a la derecha el aviso de alertas (si hay) y el botón **Menú**.',
        'The header has three areas: the name and icon on the left; **in the centre**, the navigation buttons; and on the right the alert badge (if any) and the **Menu** button.')
    if d.bck:
        d.ul([('**Backups**: el panel de todas las copias.', '**Backups**: the panel with all your backups.'), ('**Kiosko**: abre un kiosko en pantalla completa (si tienes varios, eliges cuál).', '**Kiosk**: opens a kiosk full screen (if you have several, you choose which).')])
    else:
        d.ul([('**Estado**: el panel principal.', '**Status**: the main dashboard.'), ('**Backups**: el panel de copias.', '**Backups**: the backups panel.'), ('**Kiosko**: abre un kiosko en pantalla completa.', '**Kiosk**: opens a kiosk full screen.')])
    d.img('menu', 'El menú: tema, opciones, Salir, versión y manual', 'The menu: theme, options, Log out, version and manual', narrow=True)
    d.p('El **Menú** reúne, de arriba abajo:', 'The **Menu** contains, from top to bottom:')
    d.ul([('**Tema** (Auto, Claro, Oscuro), en una sola línea, lo primero.', '**Theme** (Auto, Light, Dark), on a single line, at the very top.')])
    if d.bck:
        d.ul([('Las pantallas: **Backups, Kioscos, Personalizar** y, solo para administradores, **Ajustes** (con el escudo).', 'The screens: **Backups, Kiosks, Customise** and, for administrators only, **Settings** (with the shield).')])
    else:
        d.ul([('Las pantallas: **Panel, Nodos, VM, LXC, Docker, Backups, Kioscos, Personalizar** y **Ajustes** (administradores). Un usuario monitor solo ve Alertas y Backups además de lo común.', 'The screens: **Dashboard, Nodes, VM, LXC, Docker, Backups, Kiosks, Customise** and **Settings** (administrators). A monitor user only sees Alerts and Backups besides the common ones.')])
    d.ul([('**Salir**, justo debajo de las opciones.', '**Log out**, right below the options.'),
          ('Tu sesión, la versión y el botón **ChangeLog** (historial de cambios).', 'Your session, the version and the **ChangeLog** button (history of changes).'),
          ('**Manual · PDF**: descarga esta guía en tu idioma.', '**Manual · PDF**: downloads this guide in your language.')])


def backups_panel(d):
    N = d.name
    d.h1('Pantalla Backups', 'Backups screen')
    d.p('Es el panel de todas las copias. Arriba, el resumen: **copias vigiladas, correctas, con problema** y, si las hay, **sin datos**. Debajo, una tarjeta por tipo de copia:',
        'This is the panel for all backups. At the top, the summary: **monitored, correct, with a problem** and, if any, **no data**. Below, one card per type of backup:')
    d.ul([(f'**Copia de la propia aplicación**: la copia automática de {N} (siempre la primera), con su estado, la fecha de la última copia correcta, el tamaño y la alarma.', f'**The application\'s own backup**: {N}\'s automatic backup (always first), with its state, date of the last successful backup, size and alarm.')] +
          ([] if d.bck else [('**Copias de Proxmox**: las copias vzdump de tus máquinas y contenedores.', '**Proxmox backups**: the vzdump backups of your machines and containers.')]) +
          [('**Copias de NAS y otros programas**: las que llegan por correo (Synology Hyper Backup, Duplicati, Cobian…) y las comprobaciones de archivos en un disco de red.', '**NAS and other programs**: those arriving by e-mail (Synology Hyper Backup, Duplicati, Cobian…) and the file checks on a network drive.')])
    d.img('panel', 'Pantalla Backups' + (' de BCKMon' if d.bck else ''), 'Backups screen' + (' in BCKMon' if d.bck else ''))
    d.table([('Columna', 'Column'), ('Qué muestra', 'What it shows')],
            [(('Copia', 'Backup'), ('Nombre, origen (equipo o NAS) y un icono por tipo.', 'Name, source (machine or NAS) and an icon per type.')),
             (('Tipo', 'Type'), ('Correo, Proxmox, archivo en un disco de red o copia de la aplicación.', 'E-mail, Proxmox, file on a network drive or application backup.')),
             (('Monitorizada', 'Monitored'), ('Punto verde: se vigila y avisa. Rojo: no se vigila.', 'Green dot: it is watched and warns. Red: it is not watched.')),
             (('Resultado', 'Result'), ('Correcta, Con error, Antigua o Sin datos; con el motivo si hay problema.', 'Correct, Error, Old or No data; with the reason if there is a problem.')),
             (('Última correcta', 'Last successful'), ('Fecha y hora de la última copia buena.', 'Date and time of the last good backup.')),
             (('Tamaño', 'Size'), ('Lo que ocupó esa copia.', 'How much that backup took.')),
             (('Estado', 'Status'), ('Carita y contador del tiempo que falta para la alarma: días, después horas:minutos y, en la última hora, minutos:segundos. La cara cambia según se acerca la fecha y entra en crisis si la copia falló o se pasó.', 'Face and counter for the time left before the alarm: days, then hours:minutes and, in the last hour, minutes:seconds. The face changes as the date approaches and goes into crisis if the backup failed or the date passed.'))])
    d.p('Puedes **ordenar** por cualquier columna pulsando su título (en el móvil, con el desplegable «Ordenar por»). Pulsa una fila para abrir su ficha: arriba el estado y, junto a él, una **carita con contador** que cambia de cara y de color según se acerca la fecha de la alarma (y entra en crisis si la copia falló o se pasó la fecha); debajo, última copia correcta, tamaño, último intento y límite. La fila de la copia de la aplicación te lleva a su configuración.',
        'You can **sort** by any column by clicking its heading (on a phone, with the «Sort by» drop-down). Click a row to open its sheet: the state on top and, next to it, a **face with a counter** that changes face and colour as the alarm date approaches (and goes into crisis if the backup failed or the date has passed); below, last successful backup, size, last attempt and limit. The application-backup row takes you to its settings.')
    d.img('ficha', 'Ficha de una copia, con la carita y el contador hacia la alarma', 'Backup sheet, with the face and the counter towards the alarm')
    d.note('Si una copia sale en rojo aunque la última fue correcta, mira el motivo: suele ser que ha pasado más tiempo del permitido sin otra copia.', 'If a backup is red even though the last one was successful, read the reason: it usually means more time than allowed has passed without another backup.')


def alerts_user(d):
    d.h1('Alertas', 'Alerts')
    d.p('Cuando algo necesita atención, el botón rojo de la cabecera cuenta los avisos y la pantalla **Alertas** los lista con su histórico. Una alerta salta cuando la condición se mantiene el tiempo configurado y se resuelve sola cuando lleva un minuto estable.',
        'When something needs attention the red button in the header counts the warnings and the **Alerts** screen lists them with their history. An alert fires when the condition lasts the configured time and resolves itself after a minute of stability.')
    d.p('Recibes los avisos por los canales que haya configurado el administrador (correo, Telegram, push, webhook, Teams). En **Personalizar** eliges por cuáles quieres recibirlos tú.',
        'You receive notices through the channels the administrator configured (e-mail, Telegram, push, webhook, Teams). In **Customise** you choose which ones you want for yourself.')


def kiosk_custom(d):
    N = d.name
    d.h1('Kiosko', 'Kiosk')
    d.p('Un kiosko es una pantalla de solo lectura pensada para una tele o monitor fijo: muestra los paneles que elijas, sin menús, y puede rotar entre grupos de paneles. Se abre con el botón **Kiosko** de la cabecera (en pantalla completa) y se sale con la tecla Esc.',
        'A kiosk is a read-only screen meant for a TV or fixed monitor: it shows the panels you choose, with no menus, and can rotate between groups of panels. It opens with the **Kiosk** button in the header (full screen) and you leave it with the Esc key.')
    d.p('En **Kioscos** (menú) creas y editas los tuyos con un editor de lienzo: añades paneles (resúmenes, estado de copias, texto), los colocas y les das tamaño, y puedes deshacer y rehacer. Puedes tener varios kioscos y marcar uno como principal.',
        'In **Kiosks** (menu) you create and edit your own with a canvas editor: you add panels (summaries, backup state, text), position and size them, and can undo and redo. You can have several kiosks and mark one as the main one.')
    d.h2('Los elementos de un kiosko', 'The elements of a kiosk')
    d.table([('Elemento', 'Element'), ('Qué muestra', 'What it shows')],
            ([(('Una ficha (nodo, máquina, contenedor, copia…)', 'A tile (node, machine, container, backup…)'), ('El nombre, un LED de estado y los indicadores que elijas (CPU, memoria, disco); en versión «mini» solo nombre y LED.', 'The name, a status LED and the indicators you choose (CPU, memory, disk); in «mini» form only name and LED.')),
              (('Estado de los sistemas', 'Systems status'), ('Resumen de todos los nodos con sus máquinas, LXC y Docker en marcha.', 'Summary of all nodes with their running machines, LXC and Docker.'))] if not d.bck else
             [(('Una ficha (una copia)', 'A tile (one backup)'), ('El nombre, un LED de estado y el motivo si hay problema.', 'The name, a status LED and the reason if there is a problem.'))]) +
            [(('Estado copias', 'Backup status'), ('Un único indicador: **verde «Copias correctas»** si todo va bien, o **rojo «Copias con errores»** con el listado de **solo** las que fallan. Ideal para una vista de un vistazo.', 'A single indicator: **green «Backups OK»** if all is well, or **red «Backups with errors»** listing **only** the ones that fail. Ideal for an at-a-glance view.')),
             (('Detalle de copias', 'Backup detail'), ('Todas las copias con su resultado y la fecha de la última correcta.', 'Every backup with its result and the date of the last good one.')),
             (('Cuadro de texto', 'Text box'), ('Un texto libre (título, aviso, nota) con tamaño y alineación a tu gusto.', 'Free text (title, notice, note) with the size and alignment you like.'))])
    d.img('kiosko', 'Un kiosko con «Estado copias», «Detalle de copias» y un texto', 'A kiosk with «Backup status», «Backup detail» and a text box')
    d.p('Si algo falla, la cabecera del kiosko se tiñe de rojo y lista los problemas; los títulos de los elementos son grandes para leerse desde lejos.',
        'If something fails, the kiosk header turns red and lists the problems; the element titles are large so they can be read from a distance.')
    if not d.bck:
        d.img('008', 'Pantalla de Kioscos', 'Kiosks screen', old=True)
    d.h1('Personalizar tu cuenta', 'Customising your account')
    d.p('**Personalizar** reúne lo tuyo: tu foto (se recorta en círculo), tu nombre, el idioma, el cambio de contraseña (pide la actual y la nueva, mínimo 12 caracteres), la verificación en dos pasos (2FA, con una app de autenticación y un código QR) y **Mis avisos**, donde eliges qué canales usar.',
        '**Customise** gathers your own settings: your photo (cropped to a circle), your name, the language, the password change (asks for the current and the new one, minimum 12 characters), two-step verification (2FA, with an authenticator app and a QR code) and **My notices**, where you choose which channels to use.')
    d.img('cuenta', 'Personalizar', 'Customise', narrow=True)
    d.h1(f'Instalar {N} como app', f'Installing {N} as an app')
    d.ul([('**iPhone/iPad (Safari)**: Compartir → Añadir a pantalla de inicio.', '**iPhone/iPad (Safari)**: Share → Add to Home Screen.'),
          ('**Android (Chrome)**: menú ⋮ → Instalar aplicación.', '**Android (Chrome)**: ⋮ menu → Install app.'),
          ('**Ordenador (Edge/Chrome)**: icono de instalar en la barra de direcciones.', '**Computer (Edge/Chrome)**: install icon in the address bar.')])
    d.p('Instalada, recibe las notificaciones push con su propio icono.', 'Once installed it receives push notifications with its own icon.')
    d.h1('Privacidad y límites de acceso', 'Privacy and access limits')
    d.ul([(f'{N} solo **lee**; no modifica nada de tus servidores.', f'{N} only **reads**; it changes nothing on your servers.'),
          ('Un usuario con rol **monitor** solo ve y recibe avisos de lo que el administrador marque como visible; no entra en Ajustes.', 'A user with the **monitor** role only sees and receives notices about what the administrator marks as visible; they cannot enter Settings.'),
          (f'{N} no te muestra contraseñas, claves ni direcciones internas.', f'{N} shows you no passwords, keys or internal addresses.'),
          ('Las acciones importantes quedan en un diario de auditoría del administrador.', 'Important actions are recorded in an administrator audit log.')])


def pve_admin_nodes(d):
    d.h1('Nodos, máquinas y Docker', 'Nodes, machines and Docker')
    d.p('**Nodos** es un listado con estado, tiempo encendido, máquinas en marcha, temperatura y barras de memoria y almacenamiento. Al pulsar un nodo se abre su ficha: datos del equipo, anillos de memoria y almacenamiento, **Discos** (salud, desgaste y temperatura), **Conexión y mantenimiento** y gráficas.',
        '**Nodes** is a list with state, uptime, running machines, temperature and memory and storage bars. Clicking a node opens its sheet: machine data, memory and storage rings, **Disks** (health, wear and temperature), **Connection and maintenance** and charts.')
    d.img('016', 'Listado de nodos', 'Node list', old=True)
    d.img('018', 'Ficha de un nodo', 'Node sheet', old=True)
    d.p('Para añadir un nodo pulsa **Añadir nodo o buscar en la red**: PVEMon busca Proxmox en tu red, o lo das de alta a mano con su dirección y un token de API de **solo lectura** (la pantalla muestra los comandos para crearlo).',
        'To add a node press **Add node or search the network**: PVEMon looks for Proxmox on your network, or you add it by hand with its address and a **read-only** API token (the screen shows the commands to create it).')
    d.img('019', 'Añadir nodo', 'Add node', old=True)
    d.note('PVEMon solo lee. No instala actualizaciones ni reinicia nada; solo avisa de cuántas hay pendientes. El acceso SSH opcional (bloque «Preparar el acceso SSH») se limita a tres órdenes de lectura: check, temp y version.', 'PVEMon only reads. It installs no updates and restarts nothing; it only tells you how many are pending. The optional SSH access («Prepare SSH access» block) is limited to three read-only commands: check, temp and version.')
    d.p('**VM** y **LXC** son listados iguales, agrupados por nodo, con barras de memoria y disco. **Docker** resume los contenedores de cada máquina con Docker. En la ficha de un nodo, VM o LXC, los botones **1 h, 4 h y 24 h** activan el **modo mantenimiento**, que silencia sus alertas.',
        '**VM** and **LXC** are identical lists, grouped by node, with memory and disk bars. **Docker** summarises the containers of each Docker host. On a node, VM or LXC sheet, the **1 h, 4 h and 24 h** buttons enable **maintenance mode**, which silences its alerts.')
    d.img('020', 'Listado de VM', 'VM list', old=True)
    d.img('022', 'Docker', 'Docker', old=True)


def settings_admin(d):
    N = d.name
    d.h1('Ajustes (administradores)', 'Settings (administrators)')
    d.p('**Ajustes** se divide en pestañas. Algunas tienen a su vez pestañas de segundo nivel (por ejemplo Backups y Sistema).', '**Settings** is divided into tabs. Some have second-level tabs of their own (for example Backups and System).')
    if d.bck:
        rows = [(('Backups › Copias', 'Backups › Copies'), ('Copias por correo, por archivo en un disco de red y por origen; formatos propios de correo.', 'Backups by e-mail, by file on a network drive and by source; custom e-mail formats.')),
                (('Alertas', 'Alerts'), ('Alertas activas y pospuestas, cuándo salta el aviso de copia con problema y el histórico.', 'Active and snoozed alerts, when the backup-problem warning fires, and the history.')),
                (('Notificaciones', 'Notifications'), ('Correo (SMTP), **resumen semanal**, Telegram, webhook y Microsoft Teams.', 'E-mail (SMTP), **weekly summary**, Telegram, webhook and Microsoft Teams.')),
                (('Usuarios', 'Users'), ('Altas, roles, contraseñas, 2FA y avisos de cada usuario.', 'Accounts, roles, passwords, 2FA and each user\'s notices.')),
                (('Sistema', 'System'), ('Exportación a PVEMon, servicios externos (latido y API) y la copia de BCKMon a un destino.', 'Export to PVEMon, external services (heartbeat and API) and BCKMon\'s backup to a destination.'))]
    else:
        rows = [(('Alertas', 'Alerts'), ('Activas y pospuestas, cuándo saltan (umbral, duración y gravedad) e histórico.', 'Active and snoozed, when they fire (threshold, duration and severity) and history.')),
                (('Backups', 'Backups'), ('**Backups PVE** (copias de Proxmox por servidor) y **Otros backups** (correo, archivos en un disco de red).', '**PVE backups** (Proxmox backups per server) and **Other backups** (e-mail, files on a network drive).')),
                (('Notificaciones', 'Notifications'), ('Correo (SMTP), **resumen semanal**, Telegram, webhook y Microsoft Teams.', 'E-mail (SMTP), **weekly summary**, Telegram, webhook and Microsoft Teams.')),
                (('Usuarios', 'Users'), ('Altas, roles, contraseñas, 2FA y acceso a cada elemento.', 'Accounts, roles, passwords, 2FA and access to each element.')),
                (('Sistema', 'System'), ('Exportación a BCKMon, servicios externos (latido y API) y la copia de PVEMon a un destino.', 'Export to BCKMon, external services (heartbeat and API) and PVEMon\'s backup to a destination.'))]
    d.table([('Pestaña', 'Tab'), ('Para qué sirve', 'What it is for')], rows)

    d.h2('Alertas', 'Alerts')
    d.img('alertas', 'Ajustes › Alertas', 'Settings › Alerts')
    if d.bck:
        d.p('Una sola tarjeta: arriba el título; debajo, en una línea, **«Durante [N] min [gravedad]»** con el botón **Guardar** a la derecha; y debajo la casilla que activa o desactiva el aviso de «Copia de seguridad con problema». Quién recibe el aviso se elige en Usuarios → Avisos.',
            'A single card: the title on top; below, on one line, **«For [N] min [severity]»** with the **Save** button on the right; and under it the checkbox that enables or disables the «Backup with a problem» warning. Who receives the notice is chosen in Users → Notices.')
    else:
        d.p('Cada regla (nodo sin conexión, CPU alta, memoria alta, disco con fallo, copia con problema…) tiene su umbral, su duración y su gravedad, y un botón Guardar. Cada alerta activa se puede **posponer** (por ejemplo 1 hora): no avisa ni cuenta como activa y, si al terminar el plazo sigue fallando, se avisa de nuevo.',
            'Each rule (node offline, high CPU, high memory, failing disk, backup problem…) has its threshold, duration and severity, and a Save button. Each active alert can be **snoozed** (for example 1 hour): it does not warn or count as active and, if it still fails when the time is up, you are warned again.')

    d.h2('Backups: copias por correo y por archivo', 'Backups: backups by e-mail and by file')
    d.img('bk-otros', 'Ajustes › Backups › Otros backups' if not d.bck else 'Ajustes › Backups › Copias', 'Settings › Backups › Other backups' if not d.bck else 'Settings › Backups › Copies')
    d.p('Para los programas que solo avisan por correo (Synology Hyper Backup, Duplicati, Cobian, Proxmox…) se configura una **cuenta de correo (IMAP)** donde llegan los avisos; cada copia se asocia a un **origen** (el equipo o NAS) y se le indica cada cuántos días debe llegar una copia correcta. Los remitentes ya gestionados por otro lado se pueden excluir, y los correos que no se entienden se listan aparte.',
        'For programs that only report by e-mail (Synology Hyper Backup, Duplicati, Cobian, Proxmox…) you configure an **e-mail account (IMAP)** where the notices arrive; each backup is tied to a **source** (the machine or NAS) and you set how many days may pass without a successful backup. Senders already handled elsewhere can be excluded, and e-mails that are not understood are listed separately.')
    d.p('Para lo que no avisa, la comprobación **«Comprobar un archivo o una carpeta en un disco de red»** mira directamente el NAS por NFS: eliges el servidor, navegas por las carpetas exportadas, fijas la antigüedad máxima y el tamaño mínimo, y se revisa cada 5 minutos. PVEMon habla NFS versión 3 y solo lee tamaño y fecha.',
        'For what does not report, the **«Check a file or folder on a network drive»** check looks at the NAS directly over NFS: you pick the server, browse the exported folders, set the maximum age and minimum size, and it is checked every 5 minutes. PVEMon speaks NFS version 3 and only reads size and date.')

    d.h2('Formatos propios de correo: cómo se explican las plantillas', 'Custom e-mail formats: how templates work')
    d.p('Si un programa de copia no es Synology, hay que decirle a PVEMon cómo reconocer sus correos. En **«Añadir un formato nuevo»** puedes partir de una **plantilla** (Duplicati, Cobian, Synology, Proxmox) o de una en blanco, y rellenar:',
        'If a backup program is not Synology, you have to tell PVEMon how to recognise its e-mails. In **«Add a new format»** you can start from a **template** (Duplicati, Cobian, Synology, Proxmox) or a blank one, and fill in:')
    d.ul([('**Cuándo es de este programa**: el asunto, el remitente o el texto contienen una palabra (por ejemplo «Cobian»).', '**When it belongs to this program**: the subject, sender or text contains a word (for example «Cobian»).'),
          ('**Palabras de copia CORRECTA / FALLIDA**: separadas por comas; si el correo contiene alguna de las de fallo, la copia cuenta como fallida.', '**CORRECT / FAILED words**: separated by commas; if the e-mail contains any failure word the backup counts as failed.'),
          ('**Ignorar si el asunto contiene**: para correos que no son copias (avisos de integridad, por ejemplo).', '**Ignore if the subject contains**: for e-mails that are not backups (integrity notices, for example).')])
    d.img('formato', 'Formulario de formato nuevo, con la explicación de equipo y tarea', 'New format form, with the machine and task explanation')
    d.p('Cada correo se convierte en una fila del panel con un **equipo** (el origen: quien hace la copia) y una **tarea** (el nombre del trabajo de copia). Para cada uno hay dos campos:',
        'Each e-mail becomes a row in the panel with a **machine** (the source: who makes the backup) and a **task** (the name of the backup job). For each there are two fields:')
    d.table([('Campo', 'Field'), ('Cuándo usarlo', 'When to use it'), ('Ejemplo', 'Example')],
            [(('Equipo: nombre fijo', 'Machine: fixed name'), ('Todos los correos de este formato son del mismo equipo.', 'All e-mails of this format come from the same machine.'), ('`PC-Oficina`', '`PC-Office`')),
             (('Equipo: patrón', 'Machine: pattern'), ('El nombre del equipo viene dentro del correo y cambia. Un **patrón** (expresión regular) lo busca: lo que quede **entre paréntesis ( )** es el nombre.', 'The machine name is inside the e-mail and changes. A **pattern** (regular expression) looks for it: whatever is **between the parentheses ( )** is the name.'), ('`^\\[([^\\]]+)\\]` saca «NAS» de «[NAS] Copia completada»', '`^\\[([^\\]]+)\\]` extracts «NAS» from «[NAS] Backup completed»')),
             (('Tarea: nombre fijo', 'Task: fixed name'), ('Una sola tarea para todos los correos. Vacío = se usa el asunto.', 'One task for all e-mails. Empty = the subject is used.'), ('`Copia de Proxmox`', '`Proxmox backup`')),
             (('Tarea: patrón', 'Task: pattern'), ('El nombre de la tarea aparece en el correo.', 'The task name appears in the e-mail.'), ('`Tarea:\\s*(.+)` saca «Documentos» de «Tarea: Documentos»', '`Task:\\s*(.+)` extracts «Documents» from «Task: Documents»'))])
    d.note('Si el patrón encuentra algo, se usa; si no, se usa el nombre fijo. El **equipo es obligatorio** (fijo o patrón). Se recomienda probar la plantilla con un correo real de tu programa antes de fiarte de ella.', 'If the pattern finds something it is used; otherwise the fixed name is used. The **machine is required** (fixed or pattern). Test the template with a real e-mail from your program before relying on it.')

    d.h2('Notificaciones', 'Notifications')
    d.img('notif', 'Ajustes › Notificaciones', 'Settings › Notifications')
    d.p('En esta pestaña, de arriba abajo: el **correo (SMTP)** desde el que se envían los avisos; **Enviar resumen semanal**; **Telegram** (bot y chat); **webhook** genérico (un JSON con la alerta, con clave opcional en la cabecera `X-Pvemon-Token`) y **Microsoft Teams** (webhook de un flujo de Workflows). Cada canal tiene botón de prueba y sus direcciones y claves se guardan cifradas.',
        'On this tab, from top to bottom: the **e-mail (SMTP)** the notices are sent from; **Send weekly summary**; **Telegram** (bot and chat); a generic **webhook** (a JSON with the alert, with an optional key in the `X-Pvemon-Token` header) and **Microsoft Teams** (a Workflows flow webhook). Each channel has a test button and its addresses and keys are stored encrypted.')
    d.p('**Enviar resumen semanal**: un mensaje a la semana con el estado de todas las copias (última correcta, tamaño, tiempo para la alarma), el espacio de los almacenes y las alertas abiertas. Eliges el día y la hora, y si va por correo (a los administradores con correo) y/o Telegram. «Guardar y enviar ahora» lo prueba.',
        '**Send weekly summary**: one message per week with the state of all backups (last successful, size, time to alarm), storage space and open alerts. You choose the day and hour, and whether it goes by e-mail (to administrators with an address) and/or Telegram. «Save and send now» tests it.')

    d.h2('Usuarios', 'Users')
    d.img('usuarios', 'Ajustes › Usuarios', 'Settings › Users')
    d.p('Aquí se crean cuentas y se elige su rol (**administrador** o **monitor**). Un monitor solo ve y recibe avisos de lo que marques como visible. El administrador puede restablecer contraseñas y 2FA de los demás.',
        'Here you create accounts and choose their role (**administrator** or **monitor**). A monitor only sees and receives notices about what you mark as visible. The administrator can reset other users\' passwords and 2FA.')

    d.h2('Sistema', 'System')
    d.p('Tres pestañas de segundo nivel:', 'Three second-level tabs:')
    d.ul([(f'**Exportación {d.other}**: crea un archivo cifrado solo con la configuración de copias (orígenes, copias, correo, remitentes excluidos y comprobaciones de archivo; sin usuarios, kioscos ni alertas) para importarlo en {d.other}; y trae aquí lo exportado desde {d.other}, añadiendo solo lo que falte.', f'**{d.other} export**: creates an encrypted file with only the backup configuration (sources, backups, e-mail, excluded senders and file checks; no users, kiosks or alerts) to import into {d.other}; and brings here what was exported from {d.other}, adding only what is missing.'),
          ('**Servicios externos**: el **latido** (visita cada N minutos una dirección —Healthchecks.io, Uptime Kuma, Home Assistant— para que un servicio ajeno te avise si la aplicación deja de funcionar) y la **API de solo lectura** (claves para Home Assistant o scripts; se muestran una sola vez y no pueden cambiar nada).', '**External services**: the **heartbeat** (visits an address every N minutes — Healthchecks.io, Uptime Kuma, Home Assistant — so an outside service warns you if the application stops working) and the **read-only API** (keys for Home Assistant or scripts; shown once and unable to change anything).'),
          (f'**Backups {N}**: la copia automática de la propia aplicación (ver más abajo).', f'**{N} backups**: the automatic backup of the application itself (see below).')])
    d.img('sis-ext', 'Ajustes › Sistema › Servicios externos', 'Settings › System › External services')

    d.h2(f'Copia automática de {N} a un destino', f'Automatic {N} backup to a destination')
    d.p(f'La pestaña **Backups {N}** hace una copia cifrada de la configuración (usuarios, ajustes, claves) y la deja en el destino que elijas, con los días y horas que quieras, conservando las últimas N. La copia va cifrada con una **contraseña que tú eliges** (mínimo 8 caracteres): si la pierdes, la copia no se puede abrir.',
        f'The **{N} backups** tab makes an encrypted copy of the configuration (users, settings, keys) and leaves it at the destination you choose, on the days and times you want, keeping the last N. The copy is encrypted with a **passphrase you choose** (minimum 8 characters): if you lose it the copy cannot be opened.')
    d.img('sis-bk', f'Ajustes › Sistema › Backups {N}', f'Settings › System › {N} backups')
    d.table([('Destino', 'Destination'), ('Qué necesitas', 'What you need')],
            [(('Carpeta del servidor', 'Server folder'), ('Una carpeta (local o montada) visible desde el contenedor, por ejemplo `/backups`.', 'A folder (local or mounted) visible from the container, for example `/backups`.')),
             (('Servidor NFS', 'NFS server'), ('Servidor y carpeta exportada (NFSv3) con permiso de escritura para la IP de la aplicación.', 'Server and exported folder (NFSv3) with write permission for the application\'s IP.')),
             (('SMB/CIFS', 'SMB/CIFS'), ('Servidor, recurso compartido, usuario y contraseña.', 'Server, share, user and password.')),
             (('SFTP', 'SFTP'), ('Servidor, usuario y contraseña, y la carpeta.', 'Server, user and password, and the folder.')),
             (('Dropbox / Google Drive / OneDrive', 'Dropbox / Google Drive / OneDrive'), ('Se conecta con una autorización de la propia nube (botón **Conectar**); no se guardan tu usuario ni tu contraseña.', 'It connects with an authorisation from the cloud itself (**Connect** button); your username and password are not stored.'))])
    d.p('Los botones **Probar conexión** y **Elegir carpeta…** comprueban el destino antes de guardar; **Copiar ahora** hace una copia al momento y **Copias en el destino** lista las que hay y permite **Restaurar**. La restauración sustituye la configuración actual, cierra las sesiones y reinicia la aplicación; solo funciona con la misma clave secreta (`SECRET_KEY`) con la que se hizo. La copia aparece en el panel Backups, y si no se hace la que toca salta una alerta.',
        'The **Test connection** and **Choose folder…** buttons check the destination before saving; **Copy now** makes a copy immediately and **Copies at the destination** lists those present and lets you **Restore**. Restoring replaces the current configuration, logs everybody out and restarts the application; it only works with the same secret key (`SECRET_KEY`) it was made with. The copy appears in the Backups panel, and an alert fires if a scheduled one is not made.')
    d.note('Guarda tu `SECRET_KEY` y la contraseña de la copia en tu gestor de contraseñas: sin ellas, una restauración no es posible.', 'Keep your `SECRET_KEY` and the backup passphrase in your password manager: without them a restore is not possible.', 'warn')


def security(d):
    N = d.name
    d.h1('Seguridad y recursos', 'Security and resources')
    d.ul([('Contraseñas con scrypt, 2FA opcional y bloqueo de cuenta tras 10 intentos fallidos en 15 minutos (y límite por IP).', 'Passwords with scrypt, optional 2FA and account lock after 10 failed attempts in 15 minutes (plus a per-IP limit).'),
          ('Cookie de sesión HttpOnly + SameSite=Strict (y Secure por HTTPS); caduca a los 14 días.', 'HttpOnly + SameSite=Strict session cookie (and Secure over HTTPS); it expires after 14 days.'),
          ('Comprobación del origen de las peticiones, cabeceras de seguridad y errores genéricos.', 'Request origin checks, security headers and generic errors.'),
          ('Claves, tokens y contraseñas guardados cifrados con `SECRET_KEY`.', 'Keys, tokens and passwords stored encrypted with `SECRET_KEY`.'),
          ('Diario de auditoría de las acciones importantes.', 'Audit log of important actions.')])
    d.h2('Recomendaciones', 'Recommendations')
    d.ul([(f'Publica {N} solo con HTTPS (por ejemplo con Nginx Proxy Manager) y cierra el puerto 3000 al resto de la red.', f'Publish {N} only over HTTPS (for example with Nginx Proxy Manager) and close port 3000 to the rest of the network.'),
          ('Activa 2FA a todos los usuarios.', 'Enable 2FA for all users.'),
          ('Guarda `SECRET_KEY` y la carpeta `data` en tus copias de seguridad.', 'Keep `SECRET_KEY` and the `data` folder in your backups.')])
    d.h2('Recursos del servidor', 'Server resources')
    d.table([('Recurso', 'Resource'), ('Necesidad', 'Need')],
            [(('Procesador', 'Processor'), ('1 núcleo (uso casi nulo)', '1 core (almost no load)')),
             (('Memoria', 'Memory'), ('~180 MB en reposo; reservar 512 MB', '~180 MB idle; reserve 512 MB')),
             (('Disco', 'Disk'), ('Imagen ~400 MB más los datos', 'Image ~400 MB plus the data')),
             (('Red', 'Network'), ('Entrada: puerto 3000. Salida: correo, Telegram, push, webhooks, NFS/SMB/SFTP o nubes de copia' + ('' if d.bck else ', nodos (8006) y Docker (2375)'), 'In: port 3000. Out: e-mail, Telegram, push, webhooks, NFS/SMB/SFTP or backup clouds' + ('' if d.bck else ', nodes (8006) and Docker (2375)')))])


def install_pointer(d):
    N = d.name
    img = 'dagarines/bckmon' if d.bck else 'dagarines/pvemon'
    guide = d.t(f'{N}-Guia-de-instalacion.pdf', f'{N}-Install-Guide.pdf')
    d.h1('Instalación', 'Installation')
    d.p(f'{N} se publica como imagen Docker (`{img}`). La instalación paso a paso desde cero —con Docker Compose, con `docker run` desde Docker Hub o con un gestor gráfico como Arcane— está en su propia guía: **{guide}** (menú › «Instalación · PDF», o en la misma carpeta de manuales).',
        f'{N} is published as a Docker image (`{img}`). The step-by-step installation from scratch — with Docker Compose, with `docker run` from Docker Hub or with a graphical manager such as Arcane — is in its own guide: **{guide}** (menu › «Installation · PDF», or in the same manuals folder).')
    d.p('Las dos cosas imprescindibles: una **`SECRET_KEY`** (32 bytes en base64) y una carpeta **`/data`** persistente, ambas incluidas en tus copias. El primer administrador se crea con una orden de consola, no desde la web.',
        'The two essentials: a **`SECRET_KEY`** (32 bytes in base64) and a persistent **`/data`** folder, both included in your backups. The first administrator is created with a console command, not from the web.')
    if d.bck:
        d.h2('Primeros pasos recomendados', 'Recommended first steps')
        d.ol([('Da de alta una **cuenta de correo (IMAP)** donde lleguen los avisos de tus programas de copia.', 'Add an **e-mail account (IMAP)** where your backup programs\' notices arrive.'),
              ('Crea un **origen** por cada NAS o equipo y fija cada cuántos días debe llegar una copia correcta.', 'Create a **source** for every NAS or machine and set how many days may pass without a successful backup.'),
              ('Si un programa no es Synology, añade su **formato** con una plantilla (ver «Formatos propios»).', 'If a program is not Synology, add its **format** from a template (see «Custom e-mail formats»).'),
              ('Configura el **correo** y el **resumen semanal** en Notificaciones.', 'Set up **e-mail** and the **weekly summary** in Notifications.'),
              ('Activa la **copia automática** de BCKMon a una carpeta, NAS o nube.', 'Enable BCKMon\'s **automatic backup** to a folder, NAS or cloud.')])
        d.h2('Exportación a PVEMon', 'Export to PVEMon')
        d.p('Si usas también PVEMon, la pestaña Sistema › Exportación PVEMon crea un archivo cifrado con la configuración de copias para importarlo en PVEMon (y trae la que exportes desde allí). No lleva usuarios, kioscos ni alertas, y la importación solo añade lo que falta.',
            'If you also use PVEMon, the System › PVEMon export tab creates an encrypted file with the backup configuration to import into PVEMon (and brings in what you export from there). It carries no users, kiosks or alerts, and importing only adds what is missing.')
    else:
        d.h2('Primeros pasos recomendados', 'Recommended first steps')
        d.ol([('Añade tu primer **nodo** con un token de API de solo lectura (Nodos › Añadir nodo).', 'Add your first **node** with a read-only API token (Nodes › Add node).'),
              ('Si quieres el registro de **accesos fallidos**, da el permiso Sys.Syslog al token (ver «Accesos fallidos a Proxmox»).', 'If you want the **failed logins** log, grant the Sys.Syslog permission to the token (see «Failed logins to Proxmox»).'),
              ('Configura el **correo** y **Telegram** en Ajustes › Notificaciones y pulsa Probar.', 'Set up **e-mail** and **Telegram** in Settings › Notifications and press Test.'),
              ('Revisa las **alertas** y sus umbrales en Ajustes › Alertas.', 'Review the **alerts** and their thresholds in Settings › Alerts.'),
              ('Activa la **copia automática** de PVEMon a una carpeta, NAS o nube.', 'Enable PVEMon\'s **automatic backup** to a folder, NAS or cloud.')])


def look_feel(d):
    N = d.name
    d.h1('Colores, tema e iconos', 'Colours, theme and icons')
    d.p(f'{N} se adapta a tu gusto y a tu pantalla. Hay dos ajustes independientes: el **tema** (claro u oscuro) y la **paleta de color**.',
        f'{N} adapts to your taste and your screen. There are two independent settings: the **theme** (light or dark) and the **colour palette**.')
    d.h2('Tema: Auto, Claro u Oscuro', 'Theme: Auto, Light or Dark')
    d.p('Está al principio del **Menú**, en una sola línea con tres botones. **Auto** sigue el modo de tu sistema (claro de día, oscuro de noche si tu equipo lo hace); **Claro** y **Oscuro** lo fijan. Se recuerda en ese navegador.',
        'It is at the top of the **Menu**, on a single line with three buttons. **Auto** follows your system mode (light by day, dark by night if your device does so); **Light** and **Dark** fix it. It is remembered in that browser.')
    d.h2('Paleta de color', 'Colour palette')
    d.p('En **Personalizar › Perfil**, bajo «Color», eliges entre **cinco paletas**: **Aurora** (cian y violeta), **Lima** (verdes), **Cobre** (naranjas), **Índigo** (azul violeta) y **Grafito** (grises neutros). Un clic cambia toda la aplicación al instante, tanto en modo claro como en oscuro, y se guarda **en tu usuario**: la verás igual desde cualquier dispositivo.',
        'In **Customise › Profile**, under «Colour», you choose between **five palettes**: **Aurora** (cyan and violet), **Lime** (greens), **Copper** (oranges), **Indigo** (violet blue) and **Graphite** (neutral greys). One click changes the whole application at once, in both light and dark mode, and it is saved **on your user**: you will see it the same from any device.')
    if d.bck:
        d.note('La paleta por defecto de BCKMon es **Cobre**. PVEMon arranca con **Aurora**.', 'BCKMon\'s default palette is **Copper**. PVEMon starts with **Aurora**.')
        d.img('pal-cobre-light', 'BCKMon en Cobre, modo claro', 'BCKMon in Copper, light mode')
        d.img('pal-indigo-dark', 'BCKMon en Índigo, modo oscuro', 'BCKMon in Indigo, dark mode')
    else:
        d.note('La paleta por defecto de PVEMon es **Aurora**. BCKMon arranca con **Cobre**.', 'PVEMon\'s default palette is **Aurora**. BCKMon starts with **Copper**.')
        d.img('pal-lima-dark', 'PVEMon en Lima, modo oscuro', 'PVEMon in Lime, dark mode')
        d.img('pal-grafito-light', 'PVEMon en Grafito, modo claro', 'PVEMon in Graphite, light mode')
    d.h2('El logo y los iconos', 'The logo and the icons')
    if d.bck:
        d.p('El logo de BCKMon es una **torre de vigilancia dentro de un escudo**: la torre vigila (monitoriza) y el escudo protege tus copias. El nombre se escribe siempre «BCK**Mon**», con «Mon» resaltado.',
            'BCKMon\'s logo is a **watchtower inside a shield**: the tower watches (monitors) and the shield protects your backups. The name is always written «BCK**Mon**», with «Mon» highlighted.')
    else:
        d.p('El logo de PVEMon es una **torre de vigilancia con ondas y un anillo discontinuo**: la torre vigila tus servidores y las ondas son la señal que emite cuando algo pasa. El nombre se escribe siempre «PVE**Mon**», con «Mon» resaltado.',
            'PVEMon\'s logo is a **watchtower with waves and a dashed ring**: the tower watches your servers and the waves are the signal it sends when something happens. The name is always written «PVE**Mon**», with «Mon» highlighted.')
    d.p('Cada paleta tiene su propio juego de iconos, y la aplicación usa el de **tu** paleta: el icono de la app instalada y de la pestaña, el icono táctil de iPhone/iPad y la **insignia** de las notificaciones push (una silueta blanca que Android pinta sobre el color de tu tema). En tamaños muy pequeños (pestaña del navegador e insignia) se usa una versión **simplificada** del dibujo, con trazos más gruesos y sin anillo, para que se siga leyendo.',
        'Each palette has its own set of icons, and the application uses the one of **your** palette: the icon of the installed app and of the tab, the iPhone/iPad touch icon and the **badge** of push notifications (a white silhouette that Android paints over your theme colour). At very small sizes (browser tab and badge) a **simplified** version of the drawing is used, with thicker strokes and no ring, so it stays readable.')
    d.img('logos', 'Los cinco juegos de iconos: icono de la app, favicon e insignia', 'The five icon sets: app icon, favicon and badge')
    d.note('Si instalas la app y luego cambias de paleta, **el icono de la app ya instalada no cambia solo**: es una limitación de los sistemas. Para estrenarlo, desinstálala y vuelve a instalarla. Dentro de la aplicación, la pestaña y la cabecera sí se actualizan al momento.',
           'If you install the app and later change palette, **the icon of the already installed app does not change by itself**: it is a limitation of the systems. To get the new one, uninstall it and install it again. Inside the application, the tab and the header do update at once.')


def pve_authfail(d):
    d.h1('Accesos fallidos a Proxmox', 'Failed logins to Proxmox')
    d.p('Proxmox anota en su registro cada intento de acceso fallido a su web o a su API (contraseña mala, usuario inexistente…). PVEMon lee ese registro **cada 5 minutos** y te lo enseña de un vistazo, para que notes pronto si alguien está probando contraseñas.',
        'Proxmox records in its log every failed login attempt to its web interface or API (wrong password, non-existent user…). PVEMon reads that log **every 5 minutes** and shows it at a glance, so you notice early if someone is trying passwords.')
    d.ul([('**En Inicio**, el bloque de cada nodo incluye un resumen con el candado.', '**On Home**, each node block includes a summary with the padlock.'),
          ('**En la ficha de cada nodo**, la tarjeta «Accesos fallidos a Proxmox»: fallos de las últimas **24 horas** y de los últimos **15 minutos**, las IP más activas con los usuarios que probaron, y cuándo fue el último.', '**On each node\'s sheet**, the «Failed logins to Proxmox» card: failures in the last **24 hours** and the last **15 minutes**, the most active IPs with the users they tried, and when the last one was.'),
          ('**Alerta** «Accesos fallidos a Proxmox»: salta con **más de 4 fallos en 15 minutos** y te avisa por tus canales (por ejemplo Telegram), indicando la IP más activa. Umbral, duración y gravedad se cambian en Ajustes › Alertas.', '**Alert** «Failed logins to Proxmox»: it fires with **more than 4 failures in 15 minutes** and warns you through your channels (for example Telegram), naming the most active IP. Threshold, duration and severity are changed in Settings › Alerts.'),
          ('La **API de solo lectura** (`/api/v1/summary`) incluye un bloque `security` con esos contadores, por si quieres llevarlos a Home Assistant.', 'The **read-only API** (`/api/v1/summary`) includes a `security` block with those counters, in case you want to take them to Home Assistant.')])
    d.img('auth-ok', 'La tarjeta con accesos fallidos (datos de ejemplo)', 'The card with failed logins (sample data)')
    d.h2('Darle permiso al token (una vez)', 'Giving the token permission (once)')
    d.p('Leer el registro del nodo exige el privilegio **Sys.Syslog**, que el token de solo lectura normal no tiene. Hasta que se lo des, la tarjeta lo explica y te ofrece las órdenes ya preparadas, con el usuario y el token de ese servidor, y un botón **Copiar**:',
        'Reading the node log requires the **Sys.Syslog** privilege, which the usual read-only token does not have. Until you grant it, the card explains this and offers the ready-made commands, with that server\'s user and token, and a **Copy** button:')
    d.img('auth-err', 'La tarjeta cuando falta el permiso, con las órdenes para copiar', 'The card when the permission is missing, with the commands to copy')
    d.p('Pégalas **una sola vez como root** en la consola de un nodo (en un clúster basta con uno: los permisos son comunes). Crean un rol que permite leer el registro y se lo dan al token de PVEMon **junto con PVEAuditor** (en Proxmox, un permiso en una ruta más concreta como `/nodes` sustituye al heredado de `/`, así que hay que repetir PVEAuditor para no perder la lectura):',
        'Paste them **once as root** in a node\'s console (in a cluster one is enough: permissions are shared). They create a role that only allows reading the log and give it to the PVEMon token:')
    d.parts.append('<pre style="background:#eef1f7;padding:3mm;border-radius:2mm;font:8.5pt/1.4 \'DejaVu Sans Mono\',monospace">pveum role add MonSyslog -privs "Sys.Syslog"\npveum acl modify /nodes --users \'pvemon@pve\' --roles PVEAuditor,MonSyslog\npveum acl modify /nodes --tokens \'pvemon@pve!app\' --roles PVEAuditor,MonSyslog</pre>')
    d.p('Cambia `pvemon@pve` y `pvemon@pve!app` si tu usuario o token se llaman de otra forma (la tarjeta ya lo hace por ti). Espera unos minutos y la tarjeta dejará de mostrar el error.',
        'Change `pvemon@pve` and `pvemon@pve!app` if your user or token are named differently (the card already does it for you). Wait a few minutes and the card will stop showing the error.')
    d.note('El rol **no puede llamarse «PVE…»**: Proxmox reserva esos nombres. Por eso se llama `MonSyslog`.', 'The role **cannot be named «PVE…»**: Proxmox reserves those names. That is why it is called `MonSyslog`.')
    d.note('Qué cuenta como fallo: los intentos fallidos a la web y a la API de Proxmox (`pvedaemon`). Un aviso de **sesión caducada** de la web de Proxmox también aparece como fallo. Los intentos contra **SSH** no se leen (están en el registro de sshd).', 'What counts as a failure: failed attempts against Proxmox\'s web interface and API (`pvedaemon`). An **expired session** notice from the Proxmox web UI also shows up as a failure. **SSH** attempts are not read (they are in sshd\'s log).')


def whats_new(d):
    N = d.name
    d.h1('Novedades recientes', 'Recent changes')
    d.p('El historial completo está en el botón **ChangeLog** del menú.', 'The full history is under the **ChangeLog** button in the menu.')
    d.table([('Versión', 'Version'), ('Novedad', 'Change')],
            [(('2.4.x', '2.4.x'), ('Nueva imagen «Atalaya» (torre; escudo en BCKMon) con iconos por paleta y versión simplificada para tamaños pequeños; kiosko con «Estado copias» y «Detalle de copias»' + ('' if d.bck else '; **accesos fallidos a Proxmox** con tarjeta, alerta por Telegram y órdenes para dar el permiso') + '; carita del contador más pequeña; código depurado; guía de instalación.', 'New «Atalaya» image (tower; shield in BCKMon) with icons per palette and a simplified version for small sizes; kiosk with «Backup status» and «Backup detail»' + ('' if d.bck else '; **failed logins to Proxmox** with a card, a Telegram alert and commands to grant the permission') + '; smaller counter face; cleaned-up code; installation guide.')),
             (('2.3.x', '2.3.x'), ('Columna «Estado» con carita y contador (días, horas:minutos, minutos:segundos); tarjetas de Ajustes con banda de título; «Copias por mail» en su propia tarjeta; ficha de copia con carita y contador hacia la alarma; Tema primero en el menú. Cabecera con la navegación centrada; menú reordenado (Salir tras las opciones, Tema al final en una línea, enlace al manual); resumen semanal dentro de Notificaciones («Enviar resumen semanal»); alertas en una sola tarjeta; formatos de correo mejor explicados; copia de la aplicación primera en Backups; guías PDF actualizadas y la primera de BCKMon.', '«Status» column with face and counter (days, hours:minutes, minutes:seconds); settings cards with a title band; «Backups by mail» in its own card; backup sheet with a face and a counter towards the alarm; Theme first in the menu. Header with centred navigation; reordered menu (Log out after the options, Theme last on one line, manual link); weekly summary inside Notifications («Send weekly summary»); alerts in a single card; better-explained e-mail formats; application backup first in Backups; updated PDF guides and the first one for BCKMon.')),
             (('2.2.x', '2.2.x'), ('Copia automática de la aplicación a carpeta, NFS, SMB, SFTP, Dropbox, Google Drive y OneDrive; Ajustes reorganizados con pestañas de segundo nivel; la copia propia aparece en el panel Backups.', 'Automatic application backup to folder, NFS, SMB, SFTP, Dropbox, Google Drive and OneDrive; Settings reorganised with second-level tabs; the own backup shows in the Backups panel.')),
             (('2.0 – 2.1', '2.0 – 2.1'), ('Edición BCKMon (solo copias), cinco paletas de color y nombre propio por edición.', 'BCKMon edition (backups only), five colour palettes and a name per edition.')),
             (('1.5.x', '1.5.x'), ('Castellano e inglés; imagen Docker; guía en PDF.', 'Spanish and English; Docker image; PDF guide.')),
             (('1.x', '1.x'), ('Primera versión estable, API de solo lectura, kioscos múltiples, discos, webhook y Teams, 2FA.', 'First stable version, read-only API, multiple kiosks, disks, webhook and Teams, 2FA.'))])


def build(ed, lang):
    d = Doc(ed, lang)
    common_intro(d)
    header_menu(d)
    look_feel(d)
    if not d.bck:
        d.h1('El Panel', 'The Dashboard')
        d.p('El **Panel** es la pantalla principal: arriba, los avisos que necesitan atención; debajo, una tarjeta por nodo con anillos de CPU, memoria y disco, el estado, el tiempo encendido y la temperatura; después, las máquinas y contenedores de cada nodo. Pulsa cualquiera para abrir su detalle.',
            'The **Dashboard** is the main screen: on top, the warnings that need attention; below, one card per node with CPU, memory and disk rings, state, uptime and temperature; then the machines and containers of each node. Click any of them to open its detail.')
        d.img('001', 'El Panel', 'The Dashboard', old=True)
        d.img('005', 'Detalle de una máquina', 'Machine detail', old=True)
    backups_panel(d)
    if not d.bck:
        pve_authfail(d)
    alerts_user(d)
    kiosk_custom(d)
    d.h1('Anexo para administradores', 'Administrators\' appendix')
    d.p('Esta parte solo es útil para quien administra la aplicación; un usuario con el rol de monitor no ve estas pantallas.', 'This part is only useful to whoever administers the application; a user with the monitor role does not see these screens.')
    if not d.bck:
        pve_admin_nodes(d)
    settings_admin(d)
    install_pointer(d)
    security(d)
    whats_new(d)
    return d


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch()
        for ed in ('pvemon', 'bckmon'):
            for lang in ('es', 'en'):
                d = build(ed, lang)
                name = ('BCKMon' if ed == 'bckmon' else 'PVEMon') + ('-Guia-de-usuario' if lang == 'es' else '-User-Guide') + '.pdf'
                pg = b.new_page()
                pg.set_content(d.render(), wait_until='load')
                foot = f'<div style="font:8pt Inter,sans-serif;color:#667089;width:100%;padding:0 16mm;display:flex;justify-content:space-between"><span>{d.name} · {d.t(d.title_es, d.title_en)} · v{VER}</span><span>{d.t("Página", "Page")} <span class="pageNumber"></span> {d.t("de", "of")} <span class="totalPages"></span></span></div>'
                pg.pdf(path=os.path.join(OUT, name), format='A4', display_header_footer=True, header_template='<div></div>', footer_template=foot,
                       margin={'top': '18mm', 'bottom': '20mm', 'left': '16mm', 'right': '16mm'}, print_background=True)
                pg.close()
                print('ok', name, os.path.getsize(os.path.join(OUT, name)) // 1024, 'KB')
        b.close()


if __name__ == '__main__':
    main()
