# Notas para la Release de GitHub · 2.1.0 (versión estable)

**Título:** `2.1.0`
**Etiqueta:** `v2.1.0` · marcar **Set as the latest release** (NO es pre-release)

Pega este texto en la descripción (sirve igual para el repositorio de PVEMon y para el de BCKMon):

---

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
docker compose pull && docker compose up -d
```
Keeps `data/` and `.env`. Migrations are automatic. In BCKMon you have to sign in once after updating.
