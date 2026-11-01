# Volver a PVEMon 1.5.7 (última versión estable antes de la 2.0)

La 2.0 se publica primero como **beta** (`2.0.0-beta.N`). La **1.5.7** sigue disponible tal cual, en tres sitios:

| Dónde | Cómo |
|---|---|
| **Imagen de Docker** | `dagarines/pvemon:1.5.7` (y `latest` apunta a la estable mientras la 2.0 esté en beta) |
| **Código en GitHub** | etiqueta `v1.5.7` → `git checkout v1.5.7` |
| **Zip del código** | Releases del repositorio, etiqueta `v1.5.7` → «Source code (zip)» |

## Docker: volver a la 1.5.7

1. Haz una **copia de la carpeta `data/`** y de `.env` antes de probar la beta.
2. En tu `docker-compose.yml` pon `image: dagarines/pvemon:1.5.7`.
3. `docker compose pull && docker compose up -d`.

La 2.0 beta **no cambia la base de datos**: no añade migraciones, así que `data/` sigue valiendo para la 1.5.7 en los dos sentidos. Aun así, la copia previa es la red de seguridad.

## Qué tenía la 1.5.7

Panel de nodos Proxmox, VM, LXC y Docker; discos y SMART; copias de Proxmox y de NAS por correo (IMAP, con carpeta de procesados y de excluidos), comprobación de archivos por NFS; alertas, avisos (push, correo, Telegram, webhook, Teams), kioscos, usuarios con roles y 2FA, API de solo lectura, copia cifrada, castellano e inglés. El historial completo está en `public/changelog.md`.
