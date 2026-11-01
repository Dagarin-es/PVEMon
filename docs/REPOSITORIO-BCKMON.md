# Repositorio de BCKMON en GitHub (guía de puesta en marcha)

PVEMon y BCKMon salen del **mismo código**. Cada uno tiene su repositorio para tener Issues y Releases separados y
cada repositorio publica **su** imagen en Docker Hub:

| Repositorio | Imagen que construye |
|---|---|
| `Dagarin-es/PVEMon` | `dagarines/pvemon` |
| `Dagarin-es/BCKMon` | `dagarines/bckmon` |

El flujo (`.github/workflows/docker.yml`) decide según el nombre del repositorio: si termina en `BCKMon` construye la
edición BCKMon; en cualquier otro, la de PVEMon. **A partir de la beta.10 el repositorio de PVEMon deja de construir
la imagen de BCKMon**, así que hasta que el repositorio de BCKMon esté creado y con sus secretos, no habrá imagen
nueva de `dagarines/bckmon` en Docker Hub (tu `bckmon-local` sigue funcionando).

## Una sola vez

1. **Crear el repositorio** en GitHub: *New repository* › nombre **BCKMon** (propietario `Dagarin-es`), público,
   **sin** README, sin .gitignore y sin licencia (lo sube el script).
2. **Secretos** del repositorio nuevo (Settings › Secrets and variables › Actions › New repository secret), los
   mismos del de PVEMon:
   - `DOCKERHUB_USERNAME` = `dagarines`
   - `DOCKERHUB_TOKEN` = el token de acceso de Docker Hub con permiso de escritura
3. **Clonarlo en el servidor** (como root), junto al de PVEMon:

   ```
   git clone https://github.com/Dagarin-es/BCKMon.git /root/bckmon-repo
   ```

   Con una clave de despliegue (*deploy key*) en SSH, usa la dirección `git@github.com:Dagarin-es/BCKMon.git`.
   Cada repositorio necesita su propia clave de despliegue (una clave de despliegue no sirve para dos repositorios),
   o un token con acceso a los dos si usas HTTPS.
4. **Copiar el nuevo `actualizar.sh`** a `/opt` y ejecutarlo como siempre:

   ```
   bash /opt/actualizar.sh
   ```

   Al decir que sí a «subir a GitHub», sube PVEMon y, si encuentra el clon `/root/bckmon-repo`, también BCKMon.

## Qué sube el script a cada repositorio

- **PVEMon:** todo el código, con sus README. Sin la carpeta `repo-bckmon/`.
- **BCKMon:** el mismo código, pero con el README de BCKMon (ES/EN) y su `docker-compose.yml`. Los README de PVEMon
  quedan como `README-PVEMON.md` y `README-PVEMON.es.md`. Tampoco lleva `repo-bckmon/`.
- Las betas van a la rama `beta` de cada repositorio y llevan su etiqueta (`v2.0.0-beta.10`); las estables, a `main`.
- La etiqueta lanza la construcción de la imagen en cada repositorio (pestaña *Actions*).

## Después de cada beta

Crear la Release de la etiqueta **en cada repositorio** marcando *Set as a pre-release*. Las notas están en
`NOTAS-RELEASE-2.0.0-beta.10.md` (PVEMon y BCKMon comparten el texto).
