#!/usr/bin/env python3
"""Genera las guías de instalación desde cero en PDF (PVEMon y BCKMon, castellano e inglés).
Uso:  python3 tools/manual/install.py [salida]      (por defecto: public/manuals)
Reutiliza la clase Doc de build.py."""
import os, sys
from playwright.sync_api import sync_playwright
import build
from build import Doc, VER, DATE

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', 'public', 'manuals')


def ol(d, items):
    if getattr(d, '_sec', None) != d.n:
        d._sec, d._cnt = d.n, 0
    start = d._cnt + 1
    d._cnt += len(items)
    d.parts.append(f'<ol start="{start}">' + ''.join(f'<li>{d.x(d.t(*i))}</li>' for i in items) + '</ol>')


def code(d, txt):
    import html as _h
    d.parts.append('<pre style="background:#eef1f7;padding:3mm;border-radius:2mm;font:8.5pt/1.4 \'DejaVu Sans Mono\',monospace;white-space:pre-wrap;page-break-inside:avoid">' + _h.escape(txt) + '</pre>')


def build_install(ed, lang):
    d = Doc(ed, lang)
    d.kind = 'install'
    d.extra_css = 'h1{page-break-before:always}'
    d.title_es, d.title_en = 'Guía de instalación', 'Installation guide'
    N, bck = d.name, d.bck
    low = N.lower()
    img = f'dagarines/{low}'
    port = '3001' if bck else '3000'
    other = d.other

    compose = f'''services:
  {low}:
    image: {img}:latest
    container_name: {low}
    restart: unless-stopped
    env_file: .env
    environment:
      DATA_DIR: /data
      TZ: Europe/Madrid
    ports:
      - "{port}:3000"
    volumes:
      - ./data:/data'''
    compose_gui = f'''services:
  {low}:
    image: {img}:latest
    container_name: {low}
    restart: unless-stopped
    environment:
      DATA_DIR: /data
      TZ: Europe/Madrid
      SECRET_KEY: ${{SECRET_KEY}}
    ports:
      - "{port}:3000"
    volumes:
      - ./data:/data'''

    d.h1('Antes de empezar', 'Before you start')
    d.p(f'Esta guía te lleva **desde cero** hasta tener {N} funcionando, con tres caminos a elegir según cómo gestiones tus contenedores. Elige **uno**:',
        f'This guide takes you **from scratch** to a working {N}, with three paths depending on how you manage your containers. Choose **one**:')
    d.table([('Camino', 'Path'), ('Es para ti si…', 'It is for you if…'), ('Capítulo', 'Chapter')],
            [(('A · Docker Compose', 'A · Docker Compose'), ('Tienes acceso a una terminal del servidor y quieres lo más ordenado y fácil de actualizar (recomendado).', 'You have terminal access to the server and want the tidiest, easiest to update (recommended).'), ('2', '2')),
             (('B · Docker Hub (`docker run`)', 'B · Docker Hub (`docker run`)'), ('Prefieres una sola orden, sin ficheros de configuración.', 'You prefer a single command, with no configuration files.'), ('3', '3')),
             (('C · Gestor gráfico (Arcane, Portainer, Dockge, Synology…)', 'C · Graphical manager (Arcane, Portainer, Dockge, Synology…)'), ('Gestionas tus contenedores desde una web y no quieres escribir órdenes largas.', 'You manage your containers from a web page and do not want to type long commands.'), ('4', '4'))])
    d.h2('Qué necesitas', 'What you need')
    d.ul([('Un equipo con **Linux y Docker** (Docker Engine 24 o superior con el plugin Compose v2): un servidor, un NAS con Docker, una máquina virtual o un contenedor LXC de Proxmox con Docker.', 'A machine with **Linux and Docker** (Docker Engine 24 or newer with the Compose v2 plugin): a server, a NAS with Docker, a virtual machine or a Proxmox LXC container with Docker.'),
          ('Unos **512 MB de memoria libres**, 1 núcleo y ~1 GB de disco (la imagen son ~400 MB más tus datos).', 'About **512 MB of free memory**, 1 core and ~1 GB of disk (the image is ~400 MB plus your data).'),
          (f'Un **puerto libre** (aquí usamos el `{port}`).', f'A **free port** (here we use `{port}`).')] +
         ([('Acceso de red desde el servidor a tus **nodos Proxmox** (puerto 8006).', 'Network access from the server to your **Proxmox nodes** (port 8006).')] if not bck else
          [('Una **cuenta de correo con IMAP** (o más de una) donde lleguen los avisos de tus programas de copia.', 'An **e-mail account with IMAP** (or more than one) where your backup programs\' notices arrive.')]))
    d.note('La imagen funciona en **amd64** y **arm64** (por ejemplo, una Raspberry Pi 4/5). Si Docker no está instalado, mira docs.docker.com/engine/install.', 'The image runs on **amd64** and **arm64** (for example a Raspberry Pi 4/5). If Docker is not installed, see docs.docker.com/engine/install.')
    d.h2('Las dos piezas imprescindibles', 'The two essential pieces')
    d.ul([('**`SECRET_KEY`**: una clave de 32 bytes en base64 que cifra tus contraseñas y tokens guardados. Se genera una vez con `openssl rand -base64 32` (o `head -c 32 /dev/urandom | base64`). **Guárdala en tu gestor de contraseñas**: si la pierdes, no se podrán descifrar los datos ni restaurar copias.', '**`SECRET_KEY`**: a 32-byte key in base64 that encrypts your stored passwords and tokens. Generate it once with `openssl rand -base64 32` (or `head -c 32 /dev/urandom | base64`). **Keep it in your password manager**: if you lose it, the data cannot be decrypted nor backups restored.'),
          ('**La carpeta `/data`**: aquí vive todo (configuración e histórico). Debe ser **persistente**: una carpeta del servidor, no «dentro» del contenedor. Inclúyela en tus copias de seguridad.', '**The `/data` folder**: everything lives here (configuration and history). It must be **persistent**: a server folder, not «inside» the container. Include it in your backups.')])
    d.note('Si vas a usar a la vez PVEMon y BCKMon, cada uno necesita **su propia** `SECRET_KEY`, su propia carpeta `data` y su propio puerto (3000 y 3001 en los ejemplos). Son dos aplicaciones independientes.', 'If you will use PVEMon and BCKMon together, each needs **its own** `SECRET_KEY`, its own `data` folder and its own port (3000 and 3001 in the examples). They are two independent applications.', 'note')

    d.h1('Camino A · Docker Compose', 'Path A · Docker Compose')
    ol(d, [('Crea una carpeta para la aplicación y entra en ella:', 'Create a folder for the application and enter it:')])
    code(d, f'mkdir -p /opt/{low}/data && cd /opt/{low}')
    ol(d, [('Crea el fichero `.env` con tu clave (se genera y se guarda en un solo paso):', 'Create the `.env` file with your key (generated and saved in a single step):')])
    code(d, 'echo "SECRET_KEY=$(openssl rand -base64 32)" > .env\nchmod 600 .env\ncat .env      # copia la clave a tu gestor de contraseñas' if lang == 'es' else 'echo "SECRET_KEY=$(openssl rand -base64 32)" > .env\nchmod 600 .env\ncat .env      # copy the key to your password manager')
    ol(d, [('Crea el fichero `docker-compose.yml` con este contenido (puedes copiarlo tal cual):', 'Create the `docker-compose.yml` file with this content (you can copy it as is):')])
    code(d, compose)
    ol(d, [('Descarga la imagen y arranca:', 'Download the image and start:')])
    code(d, 'docker compose pull\ndocker compose up -d')
    ol(d, [('Comprueba que está sano (debe responder `{"ok":true,…}`):', 'Check that it is healthy (it must answer `{"ok":true,…}`):')])
    code(d, f'curl http://localhost:{port}/api/health')
    ol(d, [('Crea el **primer administrador**. La contraseña se muestra **una sola vez**: guárdala.', 'Create the **first administrator**. The password is shown **only once**: keep it.')])
    code(d, f'docker compose exec {low} node dist/cli.js create-admin admin')
    ol(d, [(f'Abre `http://IP-DEL-SERVIDOR:{port}` en tu navegador y entra con ese usuario (ver «Primer acceso»).', f'Open `http://SERVER-IP:{port}` in your browser and sign in with that user (see «First sign-in»).')])
    d.note('Estos ejemplos usan `/opt/' + low + '` como carpeta, pero puede ser la que prefieras (por ejemplo `/srv/docker/' + low + '`). Si usas **Arcane**, elige una carpeta que no esté dentro de `/opt` si no quieres que se mezcle con sus proyectos.', 'These examples use `/opt/' + low + '` as the folder, but it can be any you prefer (for example `/srv/docker/' + low + '`). If you use **Arcane**, choose a folder outside `/opt` if you do not want it mixed with its projects.')

    d.h1('Camino B · Docker Hub con docker run', 'Path B · Docker Hub with docker run')
    d.p(f'La imagen oficial es **`{img}`** en Docker Hub. No necesitas ningún fichero: una orden lo hace todo.', f'The official image is **`{img}`** on Docker Hub. You need no files: one command does it all.')
    ol(d, [('Prepara la carpeta de datos y genera la clave (anótala):', 'Prepare the data folder and generate the key (write it down):')])
    code(d, f'mkdir -p /opt/{low}/data\nopenssl rand -base64 32')
    ol(d, [('Arranca el contenedor sustituyendo `TU_CLAVE` por la clave que acabas de generar:', 'Start the container, replacing `YOUR_KEY` with the key you just generated:')])
    k = 'TU_CLAVE' if lang == 'es' else 'YOUR_KEY'
    code(d, f'docker run -d --name {low} --restart unless-stopped \\\n  -p {port}:3000 \\\n  -e SECRET_KEY="{k}" \\\n  -e DATA_DIR=/data -e TZ=Europe/Madrid \\\n  -v /opt/{low}/data:/data \\\n  {img}:latest')
    ol(d, [('Comprueba la salud y crea el primer administrador:', 'Check the health and create the first administrator:')])
    code(d, f'curl http://localhost:{port}/api/health\ndocker exec {low} node dist/cli.js create-admin admin')
    ol(d, [(f'Abre `http://IP-DEL-SERVIDOR:{port}` y entra.', f'Open `http://SERVER-IP:{port}` and sign in.')])
    d.note('Para **actualizar** con `docker run` hay que recrear el contenedor: `docker pull ' + img + ':latest`, `docker stop ' + low + '`, `docker rm ' + low + '` y volver a lanzar la **misma** orden `docker run` (los datos están en la carpeta, no se pierden). Por eso Compose es más cómodo.', 'To **update** with `docker run` you must recreate the container: `docker pull ' + img + ':latest`, `docker stop ' + low + '`, `docker rm ' + low + '` and run the **same** `docker run` command again (the data is in the folder, it is not lost). That is why Compose is more convenient.')

    d.h1('Camino C · Gestor gráfico (Arcane, Portainer, Dockge, Synology…)', 'Path C · Graphical manager (Arcane, Portainer, Dockge, Synology…)')
    d.p('Todos estos gestores hacen lo mismo con distintos nombres de menú: crear un **proyecto o «stack»** pegando un fichero Compose, definir **variables de entorno**, desplegarlo y abrir una **consola** en el contenedor. Los nombres exactos pueden variar un poco según la versión de tu gestor.',
        'All these managers do the same with different menu names: create a **project or «stack»** by pasting a Compose file, define **environment variables**, deploy it and open a **console** in the container. Exact names may vary slightly depending on your manager\'s version.')
    ol(d, [('**Genera la clave** en cualquier terminal (o en una web de generación de contraseñas, pidiendo 32 bytes en base64): `openssl rand -base64 32`. Guárdala en tu gestor de contraseñas.', '**Generate the key** in any terminal (or on a password-generator site, asking for 32 bytes in base64): `openssl rand -base64 32`. Keep it in your password manager.'),
          ('Crea un **proyecto nuevo** llamado `' + low + '` (en Arcane: **Projects › Create project**; en Portainer: **Stacks › Add stack**; en Dockge: **Compose › +**; en Synology: **Container Manager › Project › Create**).', 'Create a **new project** called `' + low + '` (in Arcane: **Projects › Create project**; in Portainer: **Stacks › Add stack**; in Dockge: **Compose › +**; on Synology: **Container Manager › Project › Create**).'),
          ('Pega este Compose en el editor. La clave no va escrita aquí: se lee de la variable `SECRET_KEY`:', 'Paste this Compose in the editor. The key is not written here: it is read from the `SECRET_KEY` variable:')])
    code(d, compose_gui)
    ol(d, [('En el apartado de **variables de entorno** (el `.env` del proyecto) añade una línea con tu clave:', 'In the **environment variables** section (the project\'s `.env`) add a line with your key:')])
    code(d, 'SECRET_KEY=TU_CLAVE' if lang == 'es' else 'SECRET_KEY=YOUR_KEY')
    ol(d, [('Comprueba que la carpeta de la izquierda del volumen (`./data`) existe y es **persistente**. Si tu gestor no usa carpetas relativas, pon una ruta completa del servidor, por ejemplo `/opt/' + low + '/data:/data`.', 'Check that the folder on the left of the volume (`./data`) exists and is **persistent**. If your manager does not use relative folders, put a full server path, for example `/opt/' + low + '/data:/data`.'),
          ('Pulsa **Deploy / Desplegar / Up**. El gestor descarga la imagen y arranca el contenedor. Debe quedar en estado **running / healthy**.', 'Press **Deploy / Up**. The manager downloads the image and starts the container. It must end up **running / healthy**.'),
          ('Abre la **consola (terminal)** del contenedor `' + low + '` (en Arcane y Portainer, desde la ficha del contenedor; en Synology, **Container Manager › Container › Details › Terminal**) y ejecuta:', 'Open the **console (terminal)** of the `' + low + '` container (in Arcane and Portainer, from the container\'s page; on Synology, **Container Manager › Container › Details › Terminal**) and run:')])
    code(d, 'node dist/cli.js create-admin admin')
    ol(d, [('Copia la contraseña que aparece (solo se muestra una vez) y entra en `http://IP-DEL-SERVIDOR:' + port + '`.', 'Copy the password shown (it appears only once) and sign in at `http://SERVER-IP:' + port + '`.')])
    d.note('Si tu gestor no ofrece consola, entra por SSH al servidor y ejecuta `docker exec ' + low + ' node dist/cli.js create-admin admin`.', 'If your manager offers no console, connect to the server by SSH and run `docker exec ' + low + ' node dist/cli.js create-admin admin`.')
    d.note('Para actualizar: en el gestor, **descarga de nuevo la imagen** (Pull) y **redespliega** el proyecto. Los datos se conservan.', 'To update: in the manager, **pull the image again** and **redeploy** the project. The data is kept.')

    d.h1('Primer acceso', 'First sign-in')
    ol(d, [('Entra con el usuario `admin` y la contraseña que mostró la orden `create-admin`.', 'Sign in with the user `admin` and the password shown by the `create-admin` command.'),
          ('Ve a **Personalizar › Perfil** y **cambia la contraseña** por una tuya (mínimo 12 caracteres).', 'Go to **Customise › Profile** and **change the password** to one of your own (minimum 12 characters).'),
          ('En esa misma pantalla activa la **verificación en dos pasos (2FA)** con tu app de autenticación y elige tu **idioma** y tu **paleta de color**.', 'On that same screen enable **two-step verification (2FA)** with your authenticator app and choose your **language** and **colour palette**.'),
          ('Crea los demás usuarios en **Ajustes › Usuarios** (rol administrador o monitor).', 'Create the other users in **Settings › Users** (administrator or monitor role).')])
    d.note('Si pierdes la contraseña: `docker exec ' + low + ' node dist/cli.js reset-password admin`. Si pierdes el móvil del 2FA: `docker exec ' + low + ' node dist/cli.js reset-2fa admin`.', 'If you lose the password: `docker exec ' + low + ' node dist/cli.js reset-password admin`. If you lose the 2FA phone: `docker exec ' + low + ' node dist/cli.js reset-2fa admin`.')

    if not bck:
        d.h1('Conectar tus nodos Proxmox', 'Connecting your Proxmox nodes')
        d.p('PVEMon **solo lee**. Para conectarse necesita un usuario y un **token de API de solo lectura** en Proxmox. En la consola de un nodo, como root, pega:',
            'PVEMon **only reads**. To connect it needs a user and a **read-only API token** in Proxmox. In a node\'s console, as root, paste:')
        code(d, 'pveum user add pvemon@pve\npveum acl modify / --users pvemon@pve --roles PVEAuditor\npveum user token add pvemon@pve app --privsep 0')
        ol(d, [('La última orden muestra el **valor del token** (un código largo) **una sola vez**: cópialo.', 'The last command shows the **token value** (a long code) **only once**: copy it.'),
              ('En PVEMon, abre **Nodos › Añadir nodo o buscar en la red**. Puede encontrar tus nodos solo, o los añades a mano con su dirección (`https://IP-DEL-NODO:8006`), el **Token ID** `pvemon@pve!app` y el valor del token.', 'In PVEMon, open **Nodes › Add node or search the network**. It may find your nodes by itself, or you add them by hand with their address (`https://NODE-IP:8006`), the **Token ID** `pvemon@pve!app` and the token value.'),
              ('Si tu Proxmox usa un certificado propio, desmarca «Verificar TLS» o instala un certificado válido.', 'If your Proxmox uses its own certificate, untick «Verify TLS» or install a valid certificate.'),
              ('Repite para cada servidor Proxmox. En un clúster basta con añadir uno de los nodos.', 'Repeat for each Proxmox server. In a cluster, adding one of the nodes is enough.')])
        d.p('**Opcional**: para ver los **accesos fallidos** a Proxmox, la tarjeta de cada nodo te dará las órdenes exactas (rol `MonSyslog` + PVEAuditor) para copiar y pegar; el manual lo explica. Y para leer la temperatura y las actualizaciones pendientes al instante existe un **acceso SSH opcional** de solo lectura, también guiado desde la ficha del nodo.',
            '**Optional**: to see **failed logins** to Proxmox, each node\'s card gives you the exact commands (role `MonSyslog` + PVEAuditor) to copy and paste; the manual explains it. And to read temperature and pending updates instantly there is an **optional read-only SSH access**, also guided from the node\'s sheet.')
    else:
        d.h1('Primeros pasos en BCKMon', 'First steps in BCKMon')
        ol(d, [('**Notificaciones**: en Ajustes › Notificaciones configura el correo (SMTP) y, si quieres, Telegram, y pulsa **Probar**.', '**Notifications**: in Settings › Notifications configure e-mail (SMTP) and, if you want, Telegram, and press **Test**.'),
              ('**Copias por correo**: en Ajustes › Backups da de alta la **cuenta de correo (IMAP)** donde llegan los avisos de tus programas de copia.', '**Backups by e-mail**: in Settings › Backups add the **e-mail account (IMAP)** where your backup programs\' notices arrive.'),
              ('Crea un **origen** por cada NAS o equipo y cada **copia** esperada, con cada cuántos días debe llegar una correcta.', 'Create a **source** for every NAS or machine and each expected **backup**, with how many days may pass without a successful one.'),
              ('Si un programa no es Synology, añade su **formato** con una plantilla (Duplicati, Cobian, Proxmox…).', 'If a program is not Synology, add its **format** from a template (Duplicati, Cobian, Proxmox…).'),
              ('Activa la **copia automática** de BCKMon (Ajustes › Sistema › Backups BCKMon).', 'Enable BCKMon\'s **automatic backup** (Settings › System › BCKMon backups).')])
        d.note('Si ya usas PVEMon, puedes llevar su configuración de copias a BCKMon desde Ajustes › Sistema › Exportación.', 'If you already use PVEMon, you can bring its backup configuration to BCKMon from Settings › System › Export.')

    d.h1('Acceso desde fuera y HTTPS', 'Access from outside and HTTPS')
    d.p(f'Para entrar desde fuera de casa, instalar {N} como app en el móvil y recibir notificaciones push hace falta **HTTPS**. La forma habitual es **Nginx Proxy Manager** (NPM):',
        f'To sign in from outside your home, install {N} as a phone app and receive push notifications you need **HTTPS**. The usual way is **Nginx Proxy Manager** (NPM):')
    ol(d, [('En NPM crea un **Proxy Host** con tu dominio (por ejemplo `' + low + '.tudominio.com`).', 'In NPM create a **Proxy Host** with your domain (for example `' + low + '.yourdomain.com`).'),
          (f'Esquema `http`, **IP del servidor** y puerto `{port}`. Activa **Websockets Support** y **Block Common Exploits**.', f'Scheme `http`, the **server IP** and port `{port}`. Enable **Websockets Support** and **Block Common Exploits**.'),
          ('En la pestaña SSL pide un certificado de **Let\'s Encrypt** y activa **Force SSL** y **HTTP/2**.', 'In the SSL tab request a **Let\'s Encrypt** certificate and enable **Force SSL** and **HTTP/2**.'),
          (f'**Cierra el puerto {port}** al resto de la red (solo NPM debe llegar a él): {N} se fía de las cabeceras del proxy para conocer la IP real.', f'**Close port {port}** to the rest of the network (only NPM should reach it): {N} trusts the proxy headers to learn the real IP.')])
    d.note('Si prefieres no abrir nada a Internet, accede por una VPN (WireGuard, Tailscale): sigue siendo más seguro que exponerlo.', 'If you prefer not to open anything to the Internet, connect through a VPN (WireGuard, Tailscale): it is still safer than exposing it.')

    d.h1('Mantenimiento', 'Maintenance')
    d.h2('Actualizar', 'Updating')
    d.p('Se hace sin perder nada: los datos están en `/data` y las migraciones se aplican solas al arrancar.', 'It is done without losing anything: the data is in `/data` and migrations are applied by themselves on start.')
    code(d, f'cd /opt/{low}\ndocker compose pull\ndocker compose up -d')
    d.p('Antes de actualizar, el botón **ChangeLog** del menú muestra qué cambia. Si prefieres fijar una versión, cambia `latest` por la etiqueta (por ejemplo `' + img + ':' + VER + '`).', 'Before updating, the **ChangeLog** button in the menu shows what changes. If you prefer to pin a version, replace `latest` with the tag (for example `' + img + ':' + VER + '`).')
    d.h2('Copias de seguridad', 'Backups')
    d.ul([('Incluye en tu copia la carpeta **`data`** y tu **`SECRET_KEY`** (el fichero `.env`).', 'Include the **`data`** folder and your **`SECRET_KEY`** (the `.env` file) in your backup.'),
          (f'Además, {N} puede hacer **copias cifradas de sí mismo** a una carpeta, NAS o nube: Ajustes › Sistema › Backups {N}.', f'In addition, {N} can make **encrypted copies of itself** to a folder, NAS or cloud: Settings › System › {N} backups.')])
    d.p(f'Para **restaurar en otro servidor**: instala {N} con la **misma `SECRET_KEY`**, crea el administrador y usa «Restaurar» (desde un archivo o desde el destino).', f'To **restore on another server**: install {N} with the **same `SECRET_KEY`**, create the administrator and use «Restore» (from a file or from the destination).')
    d.h2('Ver los registros y reiniciar', 'Viewing logs and restarting')
    code(d, f'docker logs --tail 100 -f {low}\ndocker compose restart\ndocker compose down        # parar y quitar el contenedor (los datos se conservan)' if lang == 'es' else f'docker logs --tail 100 -f {low}\ndocker compose restart\ndocker compose down        # stop and remove the container (data is kept)')
    d.h2('Desinstalar', 'Uninstalling')
    d.p('`docker compose down` y, si quieres borrar también los datos, elimina la carpeta `data`. **Esto no se puede deshacer.**', '`docker compose down` and, if you also want to delete the data, remove the `data` folder. **This cannot be undone.**')

    d.h1('Problemas frecuentes', 'Common problems')
    d.table([('Síntoma', 'Symptom'), ('Causa y solución', 'Cause and solution')],
            [(('El contenedor se reinicia sin parar', 'The container restarts over and over'), ('Mira `docker logs`. Casi siempre es una `SECRET_KEY` vacía o con formato incorrecto: debe ser de 32 bytes en base64 (`openssl rand -base64 32`).', 'Check `docker logs`. It is almost always an empty or malformed `SECRET_KEY`: it must be 32 bytes in base64 (`openssl rand -base64 32`).')),
             (('«port is already allocated»', '«port is already allocated»'), ('Otro servicio usa ese puerto. Cambia la parte izquierda de `ports` (por ejemplo `"3010:3000"`).', 'Another service uses that port. Change the left part of `ports` (for example `"3010:3000"`).')),
             (('No puedo entrar / olvidé la contraseña', 'I cannot sign in / forgot the password'), (f'`docker exec {low} node dist/cli.js reset-password admin`.', f'`docker exec {low} node dist/cli.js reset-password admin`.')),
             (('Tras actualizar, los datos «han desaparecido»', 'After updating, the data «has disappeared»'), ('Se ha cambiado la carpeta `data` o la `SECRET_KEY`. Vuelve a la anterior: el contenido se guarda en esa carpeta.', 'The `data` folder or the `SECRET_KEY` was changed. Go back to the previous one: the content is stored in that folder.')),
             (('Entro por HTTPS pero me echa / no guarda la sesión', 'I use HTTPS but it logs me out / does not keep the session'), ('Comprueba en NPM que el esquema es `http` hacia el contenedor y que envía las cabeceras `X-Forwarded-*` (es lo normal).', 'Check in NPM that the scheme is `http` towards the container and that it sends the `X-Forwarded-*` headers (the default).')),
             (('No llegan las notificaciones push', 'Push notifications do not arrive'), ('Hace falta HTTPS, instalar la app y aceptar los permisos del navegador. Prueba antes con Telegram o el correo.', 'HTTPS is needed, install the app and accept the browser permissions. Try Telegram or e-mail first.'))] +
            ([(('«Verificar TLS» falla al añadir un nodo', '«Verify TLS» fails when adding a node'), ('El nodo usa un certificado propio. Desmarca «Verificar TLS» para ese servidor.', 'The node uses its own certificate. Untick «Verify TLS» for that server.')),
              (('Un nodo sale «sin conexión»', 'A node shows «offline»'), ('Comprueba desde el servidor de PVEMon que llega al puerto 8006 del nodo y que el token no ha caducado.', 'Check from the PVEMon server that it reaches the node\'s port 8006 and that the token has not expired.'))] if not bck else
             [(('No entran los correos de una copia', 'E-mails of a backup do not arrive'), ('Revisa en Ajustes › Backups que la cuenta IMAP conecta (botón de prueba) y que el formato del programa reconoce el asunto del correo.', 'Check in Settings › Backups that the IMAP account connects (test button) and that the program\'s format recognises the e-mail subject.'))]))
    d.p('¿Algo más? Abre un Issue en el repositorio de GitHub o consulta la guía de usuario.', 'Anything else? Open an Issue in the GitHub repository or consult the user guide.')
    return d


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch()
        for ed in ('pvemon', 'bckmon'):
            for lang in ('es', 'en'):
                d = build_install(ed, lang)
                name = ('BCKMon' if ed == 'bckmon' else 'PVEMon') + ('-Guia-de-instalacion' if lang == 'es' else '-Install-Guide') + '.pdf'
                pg = b.new_page(); pg.set_content(d.render(), wait_until='load')
                foot = f'<div style="font:8pt Inter,sans-serif;color:#667089;width:100%;padding:0 16mm;display:flex;justify-content:space-between"><span>{d.name} · {d.t(d.title_es, d.title_en)} · v{VER}</span><span>{d.t("Página", "Page")} <span class="pageNumber"></span> {d.t("de", "of")} <span class="totalPages"></span></span></div>'
                pg.pdf(path=os.path.join(OUT, name), format='A4', display_header_footer=True, header_template='<div></div>', footer_template=foot,
                       margin={'top': '18mm', 'bottom': '20mm', 'left': '16mm', 'right': '16mm'}, print_background=True)
                pg.close(); print('ok', name, os.path.getsize(os.path.join(OUT, name)) // 1024, 'KB')
        b.close()


if __name__ == '__main__':
    main()
