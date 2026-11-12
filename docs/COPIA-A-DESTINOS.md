# Copia de seguridad automática a un destino (2.2)

Ajustes → **Copia de seguridad** (solo administradores). Guarda el mismo archivo cifrado `.pvemonbak` (o `bckmon-….pvemonbak`) que «Descargar copia cifrada», en los días y horas que marques, y borra las más antiguas.

## Destinos

| Destino | Qué hace falta |
|---|---|
| **Carpeta del servidor** | Una carpeta montada en el contenedor. En `docker-compose.yml`, descomenta `- /ruta/en/tu/equipo:/backups` y elige `/backups`. Sirve para un disco USB o un NAS ya montado en el host (NFS/SMB). |
| **Servidor NFS** | Dirección del NAS y ruta absoluta que empieza por una carpeta exportada (por ejemplo `/volume1/copias/pvemon`). Usa NFSv3 con el cliente propio de pvemon (no monta nada). El NAS debe permitir escribir a la IP de pvemon: en Synology, regla NFS de lectura/escritura con «Asignar todos los usuarios a admin» (o sin asignación). |
| **Carpeta de red SMB/CIFS** | Dirección del NAS, usuario y contraseña. En la ruta, el primer nombre es el **recurso compartido** (por ejemplo `copias/pvemon`). El explorador de carpetas lista los recursos compartidos al empezar. |
| **SFTP/SSH** | Dirección, puerto (22 si lo dejas vacío), usuario y contraseña. Ruta absoluta (por ejemplo `/home/usuario/copias`). |
| **Dropbox / Google Drive / OneDrive** | Hay que autorizar la cuenta una vez (ver abajo). OneDrive (personal o de empresa) usa la unidad principal de la cuenta; pvemon la detecta solo al guardar. |

## Autorizar Dropbox, Google Drive u OneDrive

1. En un ordenador con navegador, instala rclone (https://rclone.org/downloads/).
2. En una terminal: `rclone authorize "dropbox"` (o `"drive"`, o `"onedrive"`).
3. Se abre el navegador: inicia sesión y acepta. Al terminar, la terminal muestra un texto `{"access_token":"…"}`.
4. Pégalo en el recuadro de la pantalla y pulsa «Elegir carpeta…». Ese texto da acceso a tu cuenta: no lo pegues en ningún otro sitio. Se guarda cifrado y no se vuelve a mostrar. Si rclone renueva el token (OneDrive lo hace con frecuencia), pvemon guarda el nuevo solo.

## Programación

- Marca los días y una o varias horas (hasta 6). Se usa la hora del servidor (zona `TZ`, por defecto Europe/Madrid; se muestra en la pantalla).
- Si pvemon estaba apagado a la hora, la copia sale en cuanto arranca ese mismo día. Al guardar, las horas que ya han pasado hoy no cuentan como atrasadas.
- Si una copia automática falla, se avisa por correo y Telegram a los administradores.

## Restaurar

«Ver copias del destino» → **Restaurar**: descarga, descifra con la contraseña guardada, comprueba y aplica la copia, y reinicia. La configuración anterior se guarda en `data/backups`. Si la copia se hizo con otra `SECRET_KEY`, la pantalla indica cuál poner en `.env`.
Si has perdido todo el servidor: instala pvemon de nuevo, descarga el archivo del destino a mano y usa «Restaurar desde una copia» en Ajustes → Sistema.

## Importante

- **Guarda la contraseña de cifrado** en tu gestor de contraseñas: sin ella la copia no se puede abrir.
- No incluye el histórico de gráficas (se vuelve a generar solo).
