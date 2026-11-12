# Notas para la Release de GitHub · 2.1.0 (versión estable)

**Título:** `2.1.0`
**Etiqueta:** `v2.1.0` · marcar **Set as the latest release** (NO es pre-release)

Pega este texto en la descripción (sirve igual para el repositorio de PVEMon y para el de BCKMon):

📘 **User guides (PDF, with screenshots):** PVEMon [⬇ English](https://github.com/Dagarin-es/PVEMon/raw/HEAD/public/manuals/PVEMon-User-Guide.pdf) · [⬇ Castellano](https://github.com/Dagarin-es/PVEMon/raw/HEAD/public/manuals/PVEMon-Guia-de-usuario.pdf) — BCKMon [⬇ English](https://github.com/Dagarin-es/PVEMon/raw/HEAD/public/manuals/BCKMon-User-Guide.pdf) · [⬇ Castellano](https://github.com/Dagarin-es/PVEMon/raw/HEAD/public/manuals/BCKMon-Guia-de-usuario.pdf)

## 🇪🇸 Castellano

**Primera versión estable de la serie 2.** Reúne todo lo de las betas 2.0.0-beta.1 a beta.16. La estable anterior, la **1.5.7**, sigue disponible
([`docs/VOLVER-A-1.5.7.md`](docs/VOLVER-A-1.5.7.md)); la base de datos no cambia entre ellas.

### Imágenes
- `dagarines/pvemon:2.1.0` · `dagarines/pvemon:latest`
- `dagarines/bckmon:2.1.0` · `dagarines/bckmon:latest`

### Novedades respecto a la 1.5.7
- **BCKMon**: segunda aplicación, con el mismo código, centrada solo en las **copias de seguridad** (correo IMAP, comprobación de archivos NFS, alertas, notificaciones, kioscos y usuarios). No se conecta a Proxmox ni a Docker.
- **5 paletas de color** (Aurora, Lima, Cobre, Índigo y Grafito) en las dos aplicaciones, con modo oscuro y claro y logo propio; se eligen en Personalizar. PVEMon sigue en Aurora por defecto; BCKMon usa Cobre.
- **Nodos y máquinas**: tres anillos (CPU, Memoria y Disco) con semáforo (verde < 80 %, amarillo 80–95 %, rojo > 95 %) y una tabla con cada máquina o contenedor; al marcar una fila se resalta en los tres anillos. Ficha de contenedor con sus tres anillos.
- **Varias cuentas de correo** para leer los avisos de copias, con editar y duplicar.
- **Formatos de correo**: plantillas (Duplicati, Cobian, Synology Hyper Backup, Proxmox y en blanco), editar y duplicar, «Ignorar si el asunto contiene…» y botón para desactivar el formato integrado de Synology.
- **Exportar / importar la configuración de copias entre PVEMon y BCKMon** (`.bckmonx`, cifrado con una frase).
- **Personalizar** reorganizado (Perfil y Avisos); selector de idioma del login más discreto.
- **Sesiones independientes**: BCKMon usa su propia cookie, así que no cierra la sesión de PVEMon en el mismo navegador e IP.
- Imagen basada en Debian 13 (`node:22-trixie-slim`); BCKMon tiene su propio repositorio e imagen.

### Actualizar
```
docker compose pull && docker compose up -d
```
Conserva `data/` y `.env`. Las migraciones son automáticas. En BCKMon hay que iniciar sesión una vez tras actualizar.

---

## 🇬🇧 English

**First stable release of the 2 series.** It gathers everything from betas 2.0.0-beta.1 to beta.16. The previous stable version, **1.5.7**, is still available
([`docs/VOLVER-A-1.5.7.md`](docs/VOLVER-A-1.5.7.md), in Spanish); the database does not change between them.

### Images
- `dagarines/pvemon:2.1.0` · `dagarines/pvemon:latest`
- `dagarines/bckmon:2.1.0` · `dagarines/bckmon:latest`

### What's new compared with 1.5.7
- **BCKMon**: a second application built from the same code, focused only on **backups** (IMAP mail, NFS file checks, alerts, notifications, kiosks and users). It does not connect to Proxmox or Docker.
- **5 colour palettes** (Aurora, Lima, Cobre, Índigo and Grafito) in both applications, with dark and light mode and their own logo; pick one in Personalize. PVEMon stays on Aurora by default; BCKMon uses Cobre.
- **Nodes and machines**: three rings (CPU, Memory and Disk) with a traffic light (green < 80 %, yellow 80–95 %, red > 95 %) and a table with each machine or container; selecting a row highlights it in all three rings. Container page with its three rings.
- **Several mail accounts** to read backup notices, with edit and duplicate.
- **Mail formats**: templates (Duplicati, Cobian, Synology Hyper Backup, Proxmox and blank), edit and duplicate, “Ignore if the subject contains…” and a button to turn off the built-in Synology format.
- **Export / import backup settings between PVEMon and BCKMon** (`.bckmonx`, passphrase-encrypted).
- **Personalize** reorganised (Profile and Notifications); a more discreet login language selector.
- **Independent sessions**: BCKMon uses its own cookie, so it no longer logs you out of PVEMon in the same browser and IP.
- Image based on Debian 13 (`node:22-trixie-slim`); BCKMon has its own repository and image.

### Update
```

- Recover access: `docker compose exec pvemon node dist/cli.js reset-password admin`.
- **Keep `SECRET_KEY`**: it encrypts the stored tokens and secrets; without it they cannot be decrypted.
- The container runs as **root** (needed so the NFS check can come from a reserved port).
- Update from source: `git pull` (or replace the folder, keeping `data/` and `.env`) and `docker compose up -d --build`.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `SECRET_KEY` | (required) | 32 bytes in base64 to encrypt secrets at rest |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Where it listens |
| `DATA_DIR` | `/data` (compose) | Folder of `config.db` and `metrics.db` |
| `TZ` | `Europe/Madrid` | Time zone of the weekly summary |
| `TELEGRAM_API`, `PVEMON_LAN_PORT` | api.telegram.org, `8006` | Advanced/testing |
| `EDITION` | `pvemon` | `bckmon` turns on the BCKMon edition (backups only; see below). The `dagarines/bckmon` image already has it set |

### Version 2.1 and BCKMon

**2.1** is the first stable release of the 2 series (`dagarines/pvemon:2.1.0`; `latest` points to it). The previous stable version, **1.5.7**, is still available and you can go back to it at any time: [`docs/VOLVER-A-1.5.7.md`](docs/VOLVER-A-1.5.7.md) (in Spanish). The database does not change between them.

New in the 2 series: **BCKMon**, a second application built from the same code and focused only on **backups** (IMAP mail, NFS file checks, alerts, notifications, kiosks and users). It does not connect to Proxmox or Docker, nor scan the network. Install it like PVEMon with the `dagarines/bckmon` image (or with `EDITION=bckmon`). BCKMon has its own repository for Issues and releases: [github.com/Dagarin-es/BCKMon](https://github.com/Dagarin-es/BCKMon).

### Automatic backup to a destination (2.2)

Settings → **Backup** (administrators only): scheduled encrypted backups (days and times of your choice, keep the last N) to a server folder, an SMB/CIFS share (Synology, Ugreen…), SFTP, Dropbox or Google Drive, with a folder browser and restore from the app. Cloud, SMB and SFTP use rclone, included in the image. Details (in Spanish): [`docs/COPIA-A-DESTINOS.md`](docs/COPIA-A-DESTINOS.md).

### Approximate resources

CPU: 1 core. RAM: ~180 MB idle (reserve 512 MB). Disk: image ~400 MB + data (metrics history, a few tens of MB
after months with a couple of nodes). Network: outbound to nodes (8006), Docker (2375), SMTP/IMAP, Telegram,
push services, webhooks and NFS; inbound on port 3000.

### Nginx Proxy Manager

Proxy Host: `http`, the host IP, port `3000`, Websockets and Block Common Exploits on; SSL with Let's Encrypt,
Force SSL and HTTP/2. **Close port 3000 to the rest of the network** (only NPM should reach it): PVEMon trusts
`X-Forwarded-*`. With HTTPS the session cookie is marked `Secure` and HSTS is enabled. Push and installing as an
app require HTTPS.

## Adding a Proxmox server

1. In Proxmox create a user and an **API token without privilege separation** with the **PVEAuditor** role
   (read-only; it includes what is needed to read disks and SMART).
2. In PVEMon: **Menu → Nodes → Add a node or search the network** (name, address, Token ID and secret).
3. Confirm the **certificate fingerprint** (like SSH). If the certificate changes, PVEMon stops connecting.

PVEMon also searches private networks for Proxmox (port 8006) every 30 minutes and offers them to be added.
Each node is queried every 30 s; history is always stored (48 h in detail, 30 d at 5 min, 180 d hourly).

### Optional SSH access (read-only)

By pasting the “Set up SSH access” block once (node card → Connection and maintenance), PVEMon reads the CPU
temperature and checks pending updates instantly. The key is restricted (`restrict` + fixed command) to a
script with three read-only commands: `check`, `temp` and `version`. Without it, the Proxmox API is used.
“Remove SSH access” gives the block to remove it from the node and forgets the access in PVEMon.

## Docker on the machines

PVEMon reads containers through **docker-socket-proxy** (read-only), on each VM or LXC with Docker:

```yaml
services:
  docker-socket-proxy:
    image: tecnativa/docker-socket-proxy
    restart: unless-stopped
    environment:
      CONTAINERS: 1          # the only permission needed
    ports:
      - "THIS_MACHINE_IP:2375:2375"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
```
Keeps `data/` and `.env`. Migrations are automatic. In BCKMon you have to sign in once after updating.
