# PVEMon

🇬🇧 [English](README.md) · 🇪🇸 Castellano

**Monitor de nodos PVE y Backups.** PWA de solo lectura para vigilar servidores Proxmox, sus máquinas virtuales,
contenedores LXC y Docker, el estado de los discos y las copias de seguridad, con avisos por push, correo,
Telegram, webhook y Microsoft Teams. Versión estable 1.5. El historial de cambios está en
[`public/changelog.md`](public/changelog.md) (en inglés: [`changelog.en.md`](public/changelog.en.md); también en el botón **ChangeLog** del menú).

📘 **Guía de usuario (PDF, 33 páginas, con capturas):** [⬇ Castellano](https://github.com/Dagarin-es/PVEMon/raw/HEAD/docs/PVEMon-Guia-de-usuario.pdf) · [⬇ English](https://github.com/Dagarin-es/PVEMon/raw/HEAD/docs/PVEMon-User-Guide.pdf)

> PVEMon **solo lee**: no apaga, enciende, actualiza, reinicia ni modifica nada de los servidores. La única escritura fuera de sí mismo es opcional: mover a otra carpeta los correos de copias ya procesados.

## Qué incluye

| Área | Resumen |
|---|---|
| **Panel de estado** | Una tarjeta por nodo: estado, temperatura, tiempo encendido, datos de la máquina (con todos sus discos), salud de los discos, copias y anillos de memoria y disco. Sin mensajes de «todo OK»: el banner y la pastilla de avisos solo salen si hay problemas y llevan al primer elemento afectado. |
| **Nodos, VM, LXC, Docker** | Listados y fichas con gráficas (1 h a 90 d), modo mantenimiento (1/4/24 h) y alias. |
| **Discos** | SMART, desgaste, temperatura, horas y pools ZFS cada 30 min; alertas «Disco con fallo», «Desgaste alto del SSD» y «Disco muy caliente». |
| **Backups** | Copias de Proxmox (antigüedad y tamaño), copias de NAS por correo (IMAP: Hyper Backup, Cobian…), comprobación de un archivo en un disco de red (NFS), espacio de los almacenes y resumen semanal. |
| **Alertas** | Reglas editables, agrupación por padre, posponer/reactivar, notificación al caer y al recuperarse. |
| **Avisos** | Push (Web Push), correo SMTP, Telegram, webhook genérico JSON y Teams (Workflows). |
| **Kiosko** | Paneles de lienzo (medidores, resúmenes, texto), kioscos con varios paneles y transición (píxeles o desenfoque), selector de kiosko, deshacer y flechas en el editor, marcador de tiempo encendido con carita (estilo «días sin accidentes») y deslizar entre paneles en el móvil. |
| **Usuarios** | Roles administrador y monitor (ve solo lo asignado), 2FA TOTP, foto, cambio de contraseña propio, bloqueo de cuenta y diario de auditoría. |
| **Idiomas** | Castellano (por defecto) e inglés. Selector **Español / English** en la pantalla de acceso y en Menú → Idioma; se recuerda en el navegador y en el usuario. Se traducen pantallas, errores, alertas, correos, push y resumen semanal, cada persona en su idioma. |
| **Sistema** | Copia cifrada de PVEMon (`.pvemonbak`), latido externo (Healthchecks, Uptime Kuma…), ChangeLog. |

## Instalación

### Opción A · Imagen de Docker Hub (recomendada)

Imagen: [`dagarines/pvemon`](https://hub.docker.com/r/dagarines/pvemon) (amd64 y arm64). Crea una carpeta con este `docker-compose.yml`:

```yaml
services:
  pvemon:
    image: dagarines/pvemon:latest   # o una versión fija, p. ej. dagarines/pvemon:1.5.3
    container_name: pvemon
    restart: unless-stopped
    env_file: .env
    environment:
      DATA_DIR: /data
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
```

```bash
echo "SECRET_KEY=$(openssl rand -base64 32)" > .env     # GUÁRDALA: cifra los secretos guardados
mkdir -p data
docker compose up -d
docker compose exec pvemon node dist/cli.js create-admin admin   # muestra la contraseña UNA vez
curl localhost:3000/api/health
```

Actualizar: `docker compose pull && docker compose up -d` (las migraciones se aplican solas; conserva `data/` y `.env`).

### Opción B · Desde el código

```bash
git clone https://github.com/Dagarin-es/pvemon.git && cd pvemon
cp .env.example .env
sed -i "s|^SECRET_KEY=.*|SECRET_KEY=$(openssl rand -base64 32)|" .env
mkdir -p data
docker compose up -d --build
docker compose exec pvemon node dist/cli.js create-admin admin   # muestra la contraseña UNA vez
curl localhost:3000/api/health
```

- Recuperar acceso: `docker compose exec pvemon node dist/cli.js reset-password admin`.
- **Guarda `SECRET_KEY`**: cifra los tokens y secretos guardados; sin ella no se pueden descifrar.
- El contenedor corre como **root** (necesario para que la comprobación NFS salga desde un puerto reservado).
- Actualizar desde el código: `git pull` (o sustituye la carpeta, conservando `data/` y `.env`) y `docker compose up -d --build`.

### Variables de entorno

| Variable | Por defecto | Para qué |
|---|---|---|
| `SECRET_KEY` | (obligatoria) | 32 bytes en base64 para cifrar secretos en reposo |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Dónde escucha |
| `DATA_DIR` | `/data` (compose) | Carpeta de `config.db` y `metrics.db` |
| `TZ` | `Europe/Madrid` | Zona horaria del resumen semanal |
| `TELEGRAM_API`, `PVEMON_LAN_PORT` | api.telegram.org, `8006` | Avanzado/pruebas |

### Recursos orientativos

CPU: 1 núcleo. RAM: ~180 MB en reposo (reserva 512 MB). Disco: imagen ~400 MB + datos (histórico de
métricas, unas decenas de MB tras meses con un par de nodos). Red: sale a los nodos (8006), a Docker (2375),
SMTP/IMAP, Telegram, servicios push, webhooks y NFS; entra por el puerto 3000.

### Nginx Proxy Manager

Proxy Host: `http`, IP del LXC, puerto `3000`, Websockets y Block Common Exploits activados; SSL con
Let's Encrypt, Force SSL y HTTP/2. **Cierra el puerto 3000 al resto de la red** (solo NPM debe llegar a él):
PVEMon confía en `X-Forwarded-*`. Con HTTPS la cookie de sesión se marca `Secure` y se activa HSTS.
El push y la instalación como app exigen HTTPS.

## Alta de un servidor Proxmox

1. En Proxmox crea un usuario y un **token de API sin separación de privilegios** con el rol **PVEAuditor**
   (solo lectura; incluye lo necesario para leer discos y SMART).
2. En PVEMon: **Menú → Nodos → Añadir nodo o buscar en la red** (nombre, dirección, Token ID y secreto).
3. Confirma la **huella del certificado** (como SSH). Si el certificado cambia, PVEMon deja de conectar.

PVEMon también busca Proxmox en las redes privadas (puerto 8006) cada 30 minutos y los ofrece para agregar.
Cada nodo se consulta cada 30 s; el histórico se guarda siempre (48 h al detalle, 30 d a 5 min, 180 d por hora).

### Acceso SSH opcional (solo lectura)

Pegando una vez el bloque «Preparar el acceso SSH» (ficha del nodo → Conexión y mantenimiento) PVEMon lee la
temperatura de la CPU y comprueba al momento las actualizaciones pendientes. La clave queda limitada
(`restrict` + orden fija) a un script de tres órdenes de solo lectura: `check`, `temp` y `version`. Sin él se usa
la API de Proxmox. «Eliminar el acceso SSH» da el bloque para quitarlo del nodo y olvida el acceso en PVEMon.

## Docker en las máquinas

PVEMon lee los contenedores a través de **docker-socket-proxy** (solo lectura), en cada VM o LXC con Docker:

```yaml
services:
  docker-socket-proxy:
    image: tecnativa/docker-socket-proxy
    restart: unless-stopped
    environment:
      CONTAINERS: 1          # único permiso necesario
    ports:
      - "IP_DE_ESTA_MAQUINA:2375:2375"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

Restringe el puerto 2375 a la IP de PVEMon con el cortafuegos: quien llegue a él puede leer los datos de los
contenedores, incluidas sus variables de entorno. Los contenedores nuevos aparecen sin monitorizar.

## Copias de seguridad

- **Proxmox**: límite de antigüedad por nodo (días y horas) en Ajustes → Backups PVE; el tamaño se lee del
  registro de las tareas de copia.
- **Por correo (NAS, Cobian…)**: buzón IMAP en Ajustes → Otros backups, con carpeta de entrada y carpeta de procesados (opcionalmente pvemon marca como leídos y mueve los correos ya incorporados; nunca borra); cada origen tiene su antigüedad máxima y todo se puede editar.
- **Archivo en disco de red (NFS)**: el nombre admite comodines (`*`, `?`), p. ej. `carpeta/copia_*.ics` comprueba el más reciente que cumpla el patrón.
- **Archivo en disco de red (NFS v3)**: servidor, carpeta exportada y archivo concreto o el más reciente, con
  antigüedad máxima y tamaño mínimo; se revisa cada 5 min sin montar nada.
- **Resumen semanal** por correo y/o Telegram y alerta de espacio de los almacenes (>90 %).
- **Copia de PVEMon**: Ajustes → Sistema, archivo cifrado con contraseña (AES-256-GCM). Incluye también
  `data/` en tus copias de seguridad.

## Notificaciones

- **Push**: cada persona lo activa en Personalizar → Avisos en este dispositivo (HTTPS y salida a internet).
  En Android, instala PVEMon como app para que no aparezca el nombre del navegador.
- **Correo / Telegram**: Ajustes → Notificaciones, con botón de prueba; secretos cifrados.
- **Webhook**: JSON con la alerta; cabecera opcional `X-Pvemon-Token`. **Teams**: webhook de Workflows.
- Quién recibe cada aviso: Ajustes → Usuarios → Avisos (por dispositivo y canal).

## Kiosko

Menú → Kioscos: crea **paneles** (＋ Elemento: medidores, resúmenes, texto) y reúnelos en **kioscos**
(un panel puede estar en varios; con más de uno rotan solos con el orden, segundos y transición que elijas).
El botón **Kiosko** de la barra despliega un menú para elegir cuál abrir en pantalla completa (y el menú «⋯» del kiosko permite cambiar); con
**★ Principal** marcas el que se abre por defecto y con **Usar aquí** lo asignas a cada dispositivo.

En el editor de paneles: **Cmd/Ctrl + Z** deshace, **Cmd/Ctrl + Mayús + Z** rehace, las **flechas** mueven
la selección (con Mayús, saltos de 5).

## Seguridad

Contraseñas scrypt, 2FA TOTP, cookie `HttpOnly` + `SameSite=Strict` (+`Secure` en HTTPS), sesión de 14 días,
límite de intentos por IP y bloqueo de cuenta, comprobación de origen, CSP y cabeceras de seguridad, errores
genéricos, tokens y claves cifrados con `SECRET_KEY`, huella del certificado de cada nodo fijada, SSH limitado y
diario de auditoría. Detalles y recomendaciones en la [guía de usuario](https://github.com/Dagarin-es/PVEMon/raw/HEAD/docs/PVEMon-Guia-de-usuario.pdf).

## API principal

Todas las rutas cuelgan de `/api` y exigen sesión salvo `/health` y `/auth/login`.

| Ruta | Acceso |
|---|---|
| `GET /health` · `POST /auth/login` | público (login: 5/min por IP) |
| `POST /auth/logout` · `/auth/password` · `/auth/2fa/*` · `GET /auth/me` | autenticado |
| `/users`, `/servers`, `/alert-rules`, `/settings/*` | administrador |
| `GET /tree` · `/overview` · `/disks` · `/alerts` | autenticado (el monitor solo ve lo asignado) |
| `GET /elements/:id/metrics[/:key]?range=1h\|6h\|24h\|7d\|30d\|90d` · `/elements/:id/disks` | autenticado con permiso |
| `/kiosks`, `/kiosk-groups`, `/kiosks-main` | cada usuario, lo suyo |

### API de solo lectura (`/api/v1`)

Pensada para Home Assistant, la futura app de Android y scripts. Se crea una clave por programa en **Ajustes → Sistema → API de solo lectura** (se muestra una sola vez; en la BD solo queda su hash). Se envía como `Authorization: Bearer pvm_…` (o `X-Api-Key`). Todas las rutas son `GET`; una clave no sirve para el resto de `/api` y no puede cambiar nada. Límite: 120 consultas/min.

| Ruta | Contenido |
|---|---|
| `/api/v1/summary` | Contadores y nombres de lo que falla: nodos, máquinas, copias (total y por origen), discos, actualizaciones y alertas |
| `/api/v1/nodes` | Por nodo: estado, CPU, memoria, disco, temperatura, uptime, actualizaciones pendientes, resumen de discos |
| `/api/v1/guests` | Por VM/LXC: estado, IP, estado del agente invitado, CPU, memoria, disco, uptime, red |
| `/api/v1/backups` (`?compact=1` para listas cortas) | Cada copia que PVEMon conoce (Proxmox y orígenes por correo, monitorizada o no: campo `monitored`): estado, antigüedad, tamaño, mensaje; y uso de los almacenes de copias. El resumen solo cuenta las monitorizadas |
| `/api/v1/disks` | Cada disco: salud, desgaste, temperatura, horas y ciclos de encendido, sectores; y pools ZFS |
| `/api/v1/alerts` | Alertas abiertas (las pospuestas no salen) |

## Estructura

```
src/
  server.ts      arranque Fastify, cabeceras y comprobación de origen
  cli.ts         create-admin / reset-password
  auth/          contraseñas, sesiones, 2FA, guardas de rol, auditoría
  routes/        rutas HTTP
  proxmox/       cliente (huella fijada), colector, descubrimiento, discos
  metrics/       catálogo y almacén SQLite con retención
  alerts/        motor de reglas y notificaciones (push, SMTP, Telegram, webhook, Teams)
  mail/          lectura IMAP de avisos de copias (y, si se activa, mover los procesados)
  update/        acceso SSH de solo lectura y comprobación de actualizaciones
  db/schema.ts   BD de configuración (Drizzle)
public/          frontend (index.html, i18n.js, kiosk.js, app.css, sw.js, changelog.md, changelog.en.md)
public/i18n/     diccionarios inglés: en.json (pantalla) y en-server.json (servidor)
tools/           i18n-check.mjs (comprueba que todo texto está traducido)
docs/            guía de usuario en PDF (castellano e inglés)
drizzle/         migraciones
```

## Desarrollo

`npm ci && npm run build && node dist/db/migrate.js && node dist/server.js` (Node ≥ 22).
Al publicar una versión: sube `VER` en `public/index.html`, `version` en `package.json`, el nombre de caché
en `public/sw.js` y **añade su entrada a `public/changelog.md` y a `public/changelog.en.md`**.

### Idiomas

El texto en castellano es la clave: en el front se escribe `T('Texto en castellano')` (con huecos `{0}`, `{1}`… si lleva datos) y en el servidor `tr()` / `tf()` (`src/i18n.ts`). La traducción va en `public/i18n/en.json` (pantalla) o `public/i18n/en-server.json` (servidor). Un texto sin traducir se ve en castellano. Tras tocar textos, `npm run build && node tools/i18n-check.mjs` avisa de los que falten. Para añadir otro idioma: nuevo diccionario, ampliar `parseLang`/`T` y el selector.

## Licencia y soporte

[MIT](LICENSE) © 2026 Dagarin. Se ofrece **tal cual, sin garantías ni soporte garantizado**: los errores y sugerencias se comentan en [Issues](https://github.com/Dagarin-es/pvemon/issues) y se atienden cuando es posible. Para avisar de un fallo de seguridad, mira [SECURITY.md](SECURITY.md).
