# CTRNF Time Trial Logger

Prototipo local para registrar partidas de Time Trial y Ring Rally leyendo los metadatos del
log `last_run` y guardando cada resultado en un CSV.

## Requisitos

- Windows 10/11
- Python 3.10 o posterior (sin paquetes externos)
- El juego/port debe escribir en el log indicado

## Uso

Desde esta carpeta:

```powershell
py .\time_trial_logger.py --watch
```

Para usar la aplicación, ejecuta `dist/CTRNF.exe` (CTR Nitro Fueled - Personal Dashboard). Es un ejecutable único para
Windows; abre el lanzador de escritorio con el logo y permite arrancar/detener el
servidor local. Al arrancarlo, el dashboard se abre en el navegador. No requiere
Python instalado en el equipo de quien lo ejecuta.

Los resultados y la ruta configurada del log se guardan en
`%LOCALAPPDATA%\CTRNF\data`, fuera del ejecutable, para que persistan entre
inicios y actualizaciones. Los catálogos se empaquetan como recursos de la app.
El launcher comprueba las GitHub Releases del repositorio al iniciar. Si encuentra
una versión más reciente, muestra botones para abrir la descarga, consultar las
novedades o descartar el aviso; la actualización se descarga e instala manualmente.

Para abrir el lanzador desde el código fuente con Python:

```powershell
py .\time_trial_gui.py
```

Para iniciar el servidor sin la ventana lanzadora:

```powershell
py .\time_trial_gui.py --server-only
```

Para reconstruir el ejecutable (requiere PyInstaller y Pillow):

```powershell
py -3 -m PyInstaller --noconfirm --clean --onefile --windowed --name CTRNF --icon utils\ctrnf.ico --exclude-module catalog_scanner --add-data "web;web" --add-data "utils\logo_by_LexiLoo826.png;utils" --add-data "utils\fondo_launcher.png;utils" --add-data "utils\ctrnf.ico;utils" --add-data "utils\achievements;utils\achievements" --add-data "data\game_tracks.csv;data" --add-data "data\game_skins.csv;data" --add-data "data\game_characters.csv;data" --add-data "data\achievements.csv;data" time_trial_gui.py
```

## Herramientas de desarrollo

`catalog_scanner.py` es una utilidad opcional para explorar el log del juego y
generar `game_catalog.csv`. Se conserva en el repositorio para trabajo de
desarrollo; no es parte del flujo del dashboard ni se empaqueta en el ejecutable
o en sus releases.

```powershell
py .\catalog_scanner.py --watch
```

El dashboard usa el puerto local `8899`; si ya está ocupado, intenta los
siguientes puertos disponibles. Puedes indicar uno explícito, por ejemplo
`py .\time_trial_gui.py --port 9001`.

El servidor y la interfaz están separados. `time_trial_gui.py` mantiene el
backend/API conectado a `time_trial_logger.py`; los archivos visuales viven en
`web/index.html`, `web/style.css` y `web/app.js`. Puedes editar y guardar esos
archivos con el servidor abierto: el navegador detecta los cambios y recarga la
interfaz automáticamente. Los cambios al código Python del backend sí requieren
reiniciar el servidor.

El dashboard tiene vistas separadas para Time Trial y Ring Rally. Ring Rally guarda puntajes enteros en `data/rally_ring.csv`, ordena los mejores puntajes de mayor a menor y muestra la diferencia en puntos. El dashboard muestra las imágenes directamente desde las URLs de
`data/game_tracks.csv` y `data/game_skins.csv`, y muestra `null` cuando falta una
imagen. La sección de registro enseña como guía `track_clean` y el nombre del
personaje asociado a la skin, actualizados desde `last_run`; los valores crudos
siguen siendo los que se escriben en el CSV. También muestra el nombre crudo
completo de la skin en texto pequeño como referencia para completar sus URLs de
imagen. Para registrar una partida solo
hay que ingresar el tiempo y guardarlo. Los tiempos se guardan mediante
`time_trial_logger.py` en `data/time_trials.csv`. El top 10
filtra por la pista actual; si el juego está cerrado, usa la pista del último
Time Trial guardado. En una sola columna muestra los diez registros más rápidos
de esa pista, sin agrupar por personaje ni skin. Cada puesto enseña únicamente
el `time_raw` legible, la fecha de captura (`dd/mm/yyyy`) y la imagen de la
skin de ese registro. Solo el primer puesto tiene borde dorado. Usa
`track_clean` para el nombre visible de la pista.

Las configuraciones están en la sección **Configuración** del ejecutable. La app
busca inicialmente `last_run*.log` en ubicaciones comunes y permite seleccionar
otro archivo manualmente; la ruta se guarda localmente junto a los datos del
usuario. Desde allí se puede exportar un respaldo ZIP de `time_trials.csv` y
`rally_ring.csv`. La importación solo restaura un CSV si ese dataset no existe o
está vacío; nunca sobrescribe registros existentes.

También se puede pasar un tiempo directamente (útil para comprobar el formato):

```powershell
py .\time_trial_logger.py --record "1:20:99"
```

El CSV se crea junto al programa como `time_trials.csv`. Cada fila contiene el
ID consecutivo de la partida, `track_id` y `skin_id`, los valores crudos de
pista y skin, el tiempo original, el tiempo en segundos y la fecha local
de captura. Los IDs de pista/skin comienzan en 1 y se reutilizan cuando el
valor ya apareció en el CSV. Si se elimina el CSV, ambos catálogos empiezan de
nuevo en 1. Al iniciar el seguimiento, se escanea el log existente para obtener
pista/personaje actuales; el historial anterior no se convierte en carreras.

## Formatos de tiempo

Se aceptan `M:SS:CC` (minutos, segundos, centésimas; por ejemplo `1:20:99` =
`80.99` segundos), `M:SS.CC` y `SS.CC`. Se valida que los segundos estén entre
00 y 59 y las centésimas entre 00 y 99.

## Campos CSV

`id,track_id,track,skin_id,skin,time_raw,time_seconds,pb,delta_pb,captured_at` para Time Trial. Ring Rally usa `data/rally_ring.csv` con `id,track_id,track,skin_id,skin,score,laps,pb,delta_pb,captured_at`. `score` y `laps` son enteros; `pb` marca si es el mayor puntaje registrado hasta ese momento para la pista y `delta_pb` es puntaje actual menos PB anterior.

`pb` vale `1` si ese tiempo fue el mejor de su pista hasta ese registro, sin
importar la skin; de lo contrario vale `0`. Los flags históricos se recalculan
en orden de ID al migrar un CSV antiguo. En la interfaz, solo se muestra la
etiqueta `PB` para las filas cuyo flag es `1`.

`delta_pb` es `time_seconds` menos el mejor tiempo que existía en esa pista
antes de la partida. Los negativos indican mejora, los positivos indican que
el intento fue más lento y `0.00` representa la primera marca o un empate. Se
calcula una vez y queda como dato histórico; no se actualiza al cambiar el récord
absoluto.

El CSV anterior tenía otro esquema. Si todavía existe cuando se guarde el
próximo tiempo, el programa avisará que hay que eliminarlo o renombrarlo antes
de continuar.

## Umbrales

`time_threshold` y `score_threshold` de cada pista en `data/game_tracks.csv` son la fuente de validación. Se calcularon aplicando el 5% a los récords mundiales del modo _GLITCHLESS_ publicados en https://crashteamranking.com/. No se permite guardar un tiempo inferior a `time_threshold` ni un puntaje superior a `score_threshold` para esa pista.
Fecha de actualización de umbrales: 31 de octubre de 2026.
