# ChangeLog de PVEMon
Historial reconstruido desde la primera versión numerada. Lo más reciente, primero.

## 2.0.0-beta.10 · 01/11/2026
- «BCKMon» se escribe con mayúsculas en todos los textos de la edición BCKMon (antes salía «bckmon» en la tarjeta del latido y su ayuda).
- Las copias del formato integrado de Synology Hyper Backup tienen su propio icono (un NAS azul) en las listas de copias y en los ajustes.
- Imagen Docker basada en Debian 13 (`node:22-trixie-slim`) en lugar de Debian 12: menos vulnerabilidades conocidas en el informe de Docker Scout. El código y las dependencias de la aplicación ya salían limpios.
- Repositorio propio para BCKMon: el flujo de GitHub Actions construye solo la imagen del repositorio en el que se ejecuta (PVEMon → `dagarines/pvemon`, BCKMon → `dagarines/bckmon`). Incluye README y docker-compose de BCKMon.

## 2.0.0-beta.9 · 01/11/2026
- Las reglas del formato integrado de Synology Hyper Backup (Backup_local, NAS externo…) ya se pueden ver en «Otros programas de copia» y hay un botón **Crear copia editable** que genera un formato propio equivalente, con todos sus campos modificables. Los formatos propios se aplican antes que el integrado.
- Los formatos propios tienen un campo nuevo: «Ignorar si el asunto contiene…» (para avisos que no son una copia, como comprobaciones de integridad).

## 2.0.0-beta.8 · 01/11/2026
- Nuevo: botón **Duplicar** en los formatos de correo propios («Otros programas de copia»). Crea una copia con otro nombre y abre el formulario con todos sus campos (asunto, remitente, texto, palabras de bien/mal, origen y tarea) para cambiar lo que haga falta. Útil con formatos parecidos o si cambia el formato de un correo.

## 2.0.0-beta.7 · 01/11/2026
- Al editar una copia que llega por correo ahora aparecen todos sus campos: origen, nombre y el plazo (días y horas) tras el cual avisa si no llega una copia correcta, con botón «Usar el límite del origen».
- Al editar una comprobación de archivo se ve el origen y hay botón **Probar** para comprobar la conexión antes de guardar.
- Botón **Cancelar** también en el formulario de añadir comprobación de archivo.

## 2.0.0-beta.6 · 01/11/2026
- Corregido: no se podían editar las cuentas de correo (error de orden en el código de la beta 4) ni las copias que llegan por correo (fallo antiguo: el formulario de edición se rompía). Ya se editan en PVEMon y en BCKMon.
- Nuevo: botón **Duplicar** en las cuentas de correo (la copia queda desactivada, con la misma contraseña) y en las comprobaciones de archivo (misma ruta y límites, con otro nombre). Al duplicar se abre el formulario para ajustar lo que haga falta. Las copias que llegan por correo no se duplican: se crean solas con cada correo, y una copia sin correos propios se quedaría siempre «sin datos».

## 2.0.0-beta.5 · 01/11/2026
- Corregido: la etiqueta BETA de la cabecera ya no ocupa ancho. Ahora es un pequeño superíndice pegado al nombre, así que en el móvil el menú y el avatar ya no se descuadran (PVEMon y BCKMon).

## 2.0.0-beta.4 · 01/11/2026
- Nuevo: **varias cuentas de correo**. En Ajustes › Copias puedes añadir, editar, probar y quitar cuentas; cada una tiene sus carpetas (entrada, procesados, excluidos), su marcado como leído y su interruptor. La cuenta que ya tenías se convierte sola en la primera (la configuración antigua queda intacta, por si vuelves a la 1.5.7). Los remitentes excluidos y los formatos propios valen para todas.
- Nuevo: Ajustes › Copias se reorganiza en tres vistas: **Por correo** (cuentas, copias que llegan por correo, remitentes excluidos, correos que no se entienden y formatos propios), **Por archivo** (comprobaciones NFS y las copias que se comprueban así) y **Por origen** (cada NAS o equipo con todas sus copias).
- Nuevo: la pantalla de acceso muestra la versión (y BETA).
- Pasar las copias entre aplicaciones: las cuentas de correo se exportan con la contraseña (el archivo va cifrado) y al importar quedan **desactivadas**, para que PVEMon y BCKMon no lean y muevan a la vez los mismos correos. Los archivos de la beta 2 y 3 siguen valiendo.

## 2.0.0-beta.3 · 01/11/2026
- Las copias ahora se pueden pasar **en los dos sentidos**: exportar en PVEMon e importar en BCKMon, o exportar en BCKMon e importar en PVEMon (Ajustes › Sistema tiene las dos tarjetas en ambas aplicaciones). Mismo formato de archivo (`.bckmonx`); solo añade lo que falta.
- Nuevo script `actualizar.sh` para actualizar en local las dos imágenes y los dos contenedores a partir de un zip en `/opt`.

## 2.0.0-beta.2 · 01/11/2026
- Nuevo: **Exportar a BCKMon** (PVEMon, Ajustes › Sistema). Crea un archivo cifrado (`.bckmonx`) solo con lo que necesita BCKMon: orígenes de copias, copias, correo IMAP, remitentes excluidos, formatos propios y comprobaciones de archivo (NFS), con su historial. No lleva servidores Proxmox, Docker, usuarios, kioscos ni alertas.
- Nuevo: **Importar desde PVEMon** (BCKMon, Ajustes › Sistema). Solo añade lo que falta, no sustituye nada; el correo se configura únicamente si BCKMon aún no tiene uno. La contraseña del correo se vuelve a cifrar con la `SECRET_KEY` de BCKMon.
- Corregido: BCKMon podía seguir mostrando el icono de PVEMon si el navegador lo tenía guardado en la misma dirección (los iconos se guardan 30 días). Ahora BCKMon pide sus iconos con una dirección propia.

## 2.0.0-beta.1 · 01/11/2026
- **Versión beta.** La cabecera muestra «BETA» mientras la versión lleve «-beta». La estable sigue siendo la 1.5.7 (`dagarines/pvemon:1.5.7`); en Docker Hub `latest` no apunta a la beta. Guía para volver: `docs/VOLVER-A-1.5.7.md`.
- **Nace BCKMon**, una segunda aplicación hecha con la misma base de código y centrada solo en las copias de seguridad: se llega con `EDITION=bckmon` (imagen `dagarines/bckmon`). Otro nombre, icono y colores (verdes), la pantalla de inicio es Backups, Ajustes reordenados (Copias, Alertas de copias, Notificaciones, Usuarios, Sistema), sin nodos, VM, LXC, Docker, discos ni actualizaciones, y la API de solo lectura solo ofrece copias y alertas. No se conecta a Proxmox, ni a Docker, ni explora la red.
- PVEMon sigue exactamente igual (salvo el distintivo «BETA»). No hay cambios en la base de datos: `data/` vale también para la 1.5.7.
- Interno: nueva variable `EDITION` (`pvemon` por defecto) y archivos `/brand.js`, `/manifest.webmanifest` e iconos propios de cada edición.

## 1.5.7 · 01/11/2026
- Nuevo: tercera carpeta en «Correo donde llegan los avisos de copias»: «Carpeta a la que se mueven los excluidos». Los correos de remitentes excluidos se mueven ahí **sin marcarlos como leídos**, para que puedas revisarlos y decidir si ya no hace falta excluirlos. Déjala vacía para no moverlos. Funciona aunque «Marcar como leído y mover» esté desactivado. La carpeta se crea si no existe.
- Los correos excluidos ya no salen en el aviso «sin mover» cuando esta carpeta está configurada.

## 1.5.6 · 01/11/2026
- Mejorado: la línea de estado del buzón ahora dice qué correos de la carpeta de entrada no se han movido y por qué (formato no reconocido, tipo de correo que PVEMon ignora, remitente excluido, o el origen «X» no está dado de alta).

## 1.5.5 · 01/11/2026
- Corregido: con «Marcar como leído y mover», los correos de una tarea a la que se había dado «Dejar de monitorizar» se quedaban siempre en la carpeta de entrada. Ahora se mueven igualmente (el origen está dado de alta y el correo se reconoce).
- Nuevo: tras cada consulta, la línea de estado del buzón indica cuántos correos de la carpeta de entrada no se han movido y por qué («sin mover: N (su origen no está dado de alta o no se reconoce el correo)»). Para que se muevan, da de alta su origen en «Orígenes de copias».

## 1.5.4 · 01/11/2026
- Corregido: con «Marcar como leído y mover» activado, los correos que PVEMon ya había leído en una consulta anterior (por ejemplo, porque activaste la opción después, o un intento anterior falló) no se marcaban ni se movían nunca a la carpeta de procesados; solo se movían los recién llegados. Ahora se procesan también esos.
- Mejorado: todos los campos de los Ajustes (correo, notificaciones, usuarios, copias, API, kioskos…) llevan ahora un título visible encima, que no desaparece al rellenarlos. El ejemplo sigue dentro del campo.

## 1.5.3 · 01/11/2026
- Nuevo en GitHub: formularios para abrir Issues (fallo y sugerencia) en castellano e inglés, que piden versión, logs y avisan de no pegar claves ni IPs. No cambia nada en la aplicación.

## 1.5.2 · 01/11/2026
- Corregido: la API de solo lectura (`/api/v1/backups`) dejaba fuera copias que la pantalla Backups sí mostraba: las de elementos sin monitorizar y las tareas recién dadas de alta que aún no tenían estado. Ahora lista todas las copias que PVEMon conoce, con un campo nuevo `monitored`, y una tarea nueva sale como «none» hasta su primera evaluación.
- El resumen (`/api/v1/summary`) y su «ok» siguen contando solo las copias monitorizadas, igual que las alertas.
- Home Assistant: si el sensor cuenta las copias con `backups | length`, usa `backups | selectattr('monitored') | list | length` para contar solo las vigiladas.

## 1.5.1 · 01/11/2026
- Corregido: en el kiosko (vista y editor), cualquier ficha de un nodo, VM, LXC, contenedor o copia mostraba «T is not a function» en lugar de la ficha. Era un fallo de la 1.5.0 (el parámetro de una función ocultaba la función de traducción).
- Corregido: la pantalla «Mis avisos» de cada usuario tenía el mismo problema de nombres y no se podía abrir.
- Corregido: en el resumen semanal, el selector del día salía en castellano en la interfaz en inglés (lunes, martes…).
- Ejemplos de la interfaz y de los changelogs con datos genéricos (correo, IP y nombre de archivo).
- Guía de usuario en PDF, en castellano e inglés, con capturas nuevas hechas con datos ficticios; se descarga desde el README.
- Interno: la caché del navegador pasa a `pvemon-v90`.

## 1.5.0 · 31/10/2026
- **PVEMon ya está en dos idiomas: castellano e inglés.** El castellano es el idioma por defecto. Se cambia con el selector **Español / English** de la pantalla de acceso y de Menú → Idioma. La elección se recuerda en el navegador y en tu usuario, así que en otro dispositivo aparece en tu idioma al entrar.
- Se traduce todo: pantallas, ayudas, kioscos y editor de paneles, el ChangeLog, los errores y mensajes del servidor, las alertas y sus reglas, los correos, las notificaciones push y el resumen semanal. Cada persona recibe los avisos en su idioma. Los canales sin usuario concreto (Telegram, webhook y Teams) usan el idioma del administrador más antiguo.
- Fechas, horas y decimales siguen el idioma elegido (coma decimal en castellano, punto en inglés).
- La API de solo lectura (/api/v1) no cambia: sigue en castellano para no romper lo que ya la usa.
- Seguridad: dependencias actualizadas (`@fastify/static` 10.1.8 con `glob`/`minimatch` corregidos): 0 vulnerabilidades en producción.
- Interno: el texto en castellano es la clave del diccionario (public/i18n/en.json y en-server.json); un texto sin traducción se ve en castellano. Nueva columna de idioma por usuario (migración automática) y herramienta tools/i18n-check.mjs para comprobar que no queda ningún texto sin traducir.

## 1.4.3 · 31/10/2026
- El **marcador de tiempo encendido** también aparece en las pantallas **Nodos**, **VM** y **LXC**, en cada fila, entre el nombre y los medidores de memoria y almacenamiento/disco.
- En la pantalla principal (Estado), el marcador está en la cabecera de cada nodo, justo a la izquierda del indicador «ENCENDIDO».
- Tema claro: las cifras del marcador ya no son negras; ahora son tarjetas claras con la cifra en el color de acento, a juego con el resto de la interfaz. El tema oscuro conserva el aspecto de cartel luminoso.

## 1.4.2 · 31/10/2026
- Nuevo **marcador de tiempo encendido**, al estilo de los carteles de «días sin accidentes» de las fábricas: un contador de cifras luminosas con los **días sin reiniciar** (horas o minutos si lleva menos de un día) y una carita que cambia de humor según lo que lleve encendido el servidor.
- Aparece en la ficha de cada **nodo**, **VM** y **LXC**, junto al estado, y en las tarjetas de cada servidor de Menú → Nodos (donde sustituye al dato «Encendido desde hace»; al pasar el ratón por el marcador se ve el tiempo exacto).
- Humores: recién arrancado (< 1 h, mareado), con ganas de aguantar más (< 1 día, triste), cogiendo ritmo (< 3 días), todo en orden (< 30 días, contento), estable como una roca (30-100 días, ojos de estrella) y leyenda del uptime (100+ días, con corona). Apagado: cara en reposo y contador apagado.
- Animaciones suaves que respetan «reducir movimiento» del sistema; funciona en tema claro y oscuro y en el móvil.

## 1.4.1 · 27/10/2026
- El botón **Kiosko** ahora **despliega un menú** bajo el propio botón para elegir qué kiosko abrir, en lugar de abrir una pantalla de selección. Muestra primero los kioscos y después los paneles sueltos, con ★ en el principal y resaltado el último usado. Se cierra con Escape o pulsando fuera.
- Dentro del kiosko, el menú «⋯» incluye «Cambiar de kiosko» con la misma lista.

## 1.4.0 · 27/10/2026
- Editor de paneles del kiosko: **Cmd/Ctrl + Z** deshace el último cambio (varias veces) y **Cmd/Ctrl + Mayús + Z** (o Ctrl + Y) lo rehace. Deshace mover, redimensionar, añadir, quitar, indicadores, texto y proporción de pantalla. Dentro de un campo de texto sigue valiendo el deshacer normal del navegador.
- Editor de paneles: las **flechas del teclado** mueven la ficha (o fichas) seleccionada de medio en medio punto; con Mayús, de 5 en 5.
- **Varios kioscos**: lo que antes eran «grupos rotativos» pasa a llamarse **kioscos**. Un kiosko reúne los paneles que quieras (un mismo panel puede estar en varios) y rota entre ellos. El botón **Kiosko** de arriba permite **elegir cuál abrir** (recuerda el último usado); si solo hay uno, lo abre directamente.
- El resumen «Estado de backups» (y los avisos y resúmenes de copias de los nodos) **ya no muestran las máquinas que no se monitorizan**.

## 1.3.0 · 25/10/2026
- Fichas de máquinas: ahora muestran la dirección IP (y las demás si tiene varias) de cada VM y LXC, junto a núcleos, memoria y disco.
- Fichas de VM: muestran el estado del agente invitado (qemu-guest-agent): instalado y respondiendo, activado pero sin respuesta, o no activado en Proxmox.
- Ficha del nodo: muestra la dirección con la que pvemon se conecta a él (cuando el servidor tiene un único nodo).

## 1.2.2 · 25/10/2026
- Corregido: al editar una comprobación de archivo salía «Invalid input: expected "nfs"» y no se guardaba.

## 1.2.1 · 25/10/2026
- Copiar la clave de API funciona también cuando pvemon se abre por HTTP (sin portapapeles del navegador).
- Los errores al guardar una edición (tareas, formatos, comprobaciones) ahora se ven dentro del formulario.
- Al guardar formatos o remitentes excluidos, la relectura del correo se hace en segundo plano para que el guardado no se quede esperando.

## 1.2.0 · 25/10/2026
- Correo de copias: dos ajustes nuevos, «carpeta donde llegan los correos» y «carpeta a la que se mueven». Con «Marcar como leído y mover», pvemon marca como leído y mueve los correos ya incorporados (solo de orígenes dados de alta; nunca borra). Crea la carpeta de procesados si no existe. Así Home Assistant ya no tiene que encargarse.
- Botón «Editar» en orígenes (nombre), tareas (nombre; en las comprobaciones de archivo, todos los datos) y formatos propios (todos los campos, incluidas las expresiones regulares de origen y tarea).
- Comprobación de archivos: el nombre admite comodines (* y ?). Por ejemplo «carpeta/copia_*.ics» comprueba el archivo más reciente que cumpla el patrón, con los mismos límites de antigüedad y tamaño.
- Máquinas: pvemon guarda la IP de cada VM/LXC y si el agente invitado (qemu-guest-agent) está activado y responde. Salen en /api/v1/guests (ip, ips, guestAgent).

## 1.1.0 · 25/10/2026
- Nueva API de solo lectura (/api/v1) para Home Assistant, la futura app de Android y scripts: resumen, nodos, máquinas, copias de seguridad, discos y alertas. Ninguna clave puede cambiar nada.
- Claves de API en Ajustes → Sistema: una por programa, se muestran una sola vez, con fecha del último uso y botón de borrar.
- Discos: ahora se guardan también los ciclos de encendido (junto a las horas, la temperatura y el desgaste).
- Actualizaciones pendientes: pvemon las comprueba solo (al arrancar y cada 6 h, solo lectura) para tener el dato sin pulsar nada.

## 1.0.0 · 25/10/2026
- Primera versión estable: se quita la etiqueta BETA.
- Nuevo subtítulo «Monitor de nodos PVE y Backups» en la pantalla de acceso, la barra y el manifiesto.
- Comprobación de archivos en disco de red: se retiran las opciones SMB y FTP «en desarrollo» (solo NFS).
- Dependencias actualizadas (Fastify, Nodemailer, Mailparser y otras): 0 vulnerabilidades en producción.
- README reescrito y ordenado.

## 0.14.7 · 24/10/2026
- Panel de estado y ficha del nodo: se identifican todos los discos físicos del nodo (modelo, tipo, tamaño y dispositivo), no solo el del sistema, y «Salud de los discos» lista cada disco (y pool ZFS) con su estado.

## 0.14.6 · 24/10/2026
- Notificaciones push: icono pequeño propio de PVEMon (silueta blanca sobre transparente) en la barra de estado de Android, en lugar del de Edge.

## 0.14.5 · 24/10/2026
- Se quita la flecha «atrás» de la cabecera en todas las pantallas.
- Móvil: Estado, Backups y Kiosko caben en la primera línea junto al menú; los avisos van en una línea propia debajo, más visibles.
- Ajustes: si las pestañas no caben pasan a una segunda línea en vez de deslizarse.
- ChangeLog: botón pequeño en la misma línea que la versión, antes de BETA.

## 0.14.4 · 24/10/2026
- Móvil: la cabecera pasa a dos líneas (marca, avisos y menú arriba; Estado, Backups y Kiosko debajo) y el menú queda solo con la foto.
- El panel de estado ya no muestra «Todo en orden» ni «Todo OK»: el banner y el aviso solo aparecen cuando hay problemas.
- Kiosko: en un grupo rotativo se pasa al panel siguiente o anterior deslizando el dedo (también «Panel anterior» en el menú ⋯).

## 0.14.3 · 24/10/2026
- Corregido: el usuario activo ya puede cambiar su propia contraseña desde Ajustes → Usuarios (pide la actual y la nueva).
- Nuevo botón ChangeLog junto a la versión en el menú y aviso de copyright.

## 0.14.2 · 24/10/2026
- Alineado el texto de actualizaciones pendientes con su botón y la casilla de cada regla de alertas con su título.
- «Eliminar el acceso SSH» deja el nodo limpio (clave, script y gancho de apt antiguo).

## 0.14.1 · 24/10/2026
- Corregido el error interno al pulsar «Olvidar acceso».
- Iconos en los títulos «Memoria» y «Disco» del panel de estado.

## 0.14.0 · 24/10/2026
- PVEMon solo lee: se elimina actualizar/reiniciar desde la app y el arreglo del aviso de suscripción; solo avisa de actualizaciones pendientes.
- Script SSH v4 de solo lectura (check, temp, version), opcional, y apartado «Eliminar el acceso SSH».
- Tarjeta Discos antes de «Conexión y mantenimiento».
- Panel de estado: nueva fila «Salud de los discos» y títulos de las cajas con icono y tamaño unificado.

## 0.13.0
- Monitorización de discos: SMART, desgaste, temperatura y ZFS cada 30 minutos, con alertas.
- Notificaciones por webhook genérico y por Microsoft Teams.
- Posponer alertas activas.
- Verificación en dos pasos (2FA) con app autenticadora.

## 0.12.1
- Kiosko: grupos de paneles rotativos con orden, tiempo y transición (difusión de píxeles o desenfoque).
- Botón «Kiosko» en la barra: abre en pantalla completa el panel o grupo marcado como ★ Principal.
- Cuadro de texto, selección múltiple con recuadro y tamaños personalizados.
- Los avisos llevan al primer elemento con problema.

## 0.11.2
- Kiosko: tema por panel, fichas de resumen (sistemas y backups) y fichas MINI más ajustadas.

## 0.11.1
- Kiosko: redimensionar por los lados, botón MINI, clic en una ficha para abrir el elemento y vista previa.

## 0.11.0
- Modo kiosko: pantallas limpias con fichas de nodos, VM, LXC, Docker y copias, editor de lienzo, banda de errores y un panel por dispositivo.

## 0.10.3
- Ajustes de pantalla estrecha (barras del listado de Nodos y botón de menú en el móvil).

## 0.10.2
- Icono de PVEMon en la pantalla de bienvenida.

## 0.10.1
- Tamaño mínimo por defecto de 1 KB en comprobaciones de archivo e iconos por tipo de copia.

## 0.10.0
- Comprobar un archivo en un disco de red (NFS) con navegador de carpetas y «archivo más reciente».

## 0.9.3
- La gestión de cada nodo pasa a su ficha («Conexión y mantenimiento») y botón «Añadir nodo o buscar en la red».

## 0.9.2
- Nodos como listado y ficha de nodo con datos del equipo y gráficas.

## 0.9.1
- Fichas de VM y LXC; anillos de memoria y disco con usado y libre.

## 0.9.0
- Menús VM y LXC agrupados por nodo y ayuda para configurar el latido.

## 0.8.0
- Copia de seguridad cifrada de PVEMon y restauración.
- Latido externo (Healthchecks, Uptime Kuma…).
- Modo mantenimiento de 1 h, 4 h o 24 h.
- Resumen semanal de copias y control del espacio de los almacenes.

## 0.7.2
- Botones Estado y Backups en la barra de título.

## 0.7.1
- Tamaño de las copias de Hyper Backup, diagnóstico de almacenes y tamaño de copias de Proxmox desde el registro de tareas.

## 0.7.0
- Pantalla Backups con el estado de todas las copias y Docker desplegable por máquina.

## 0.6.6
- Botón para corregir el aviso «No hay una suscripción válida» (retirado en 0.14.0).

## 0.6.5
- Arreglo del acceso desde redes con proxy, oficina o VPN.

## 0.6.4
- Seguridad: cabeceras, comprobación de origen, bloqueo de cuenta y límites de peticiones.

## 0.6.3
- Rendimiento: compresión de respuestas y caché de tipografías e iconos.

## 0.6.2
- Pestañas de Ajustes con el mismo ancho.

## 0.6.1
- Modo oscuro con degradado apagado en botones y ayudas.

## 0.6.0
- Docker desplegable en la lista de máquinas.

## 0.5.x
- 0.5.0: versiones numeradas, Ajustes con pestañas y avisos por Telegram.
- 0.5.3: actualización con barra de progreso (retirada en 0.14.0).
- 0.5.4 y 0.5.5: ayudas emergentes «?».
- 0.5.6: iconos y color por tipo de elemento.

## Antes de la 0.5 (fases 1–26)
- Monitorización de nodos, VM, LXC y Docker por la API de Proxmox con token de solo lectura.
- Alertas con reglas, avisos por correo y notificaciones push.
- Usuarios con roles administrador y monitor, y acceso por elemento.
- Copias de Proxmox y copias de NAS por correo (IMAP).
- Temas claro y oscuro, foto de perfil, búsqueda de nodos en la red y despliegue con Docker.
- Todo pasa a ser «Nodos», sin el concepto de clúster en la interfaz.
