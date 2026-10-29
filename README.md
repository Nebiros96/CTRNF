# CTRNF Time Trial Logger

Prototipo local para registrar partidas de Time Trial leyendo los metadatos del
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

Para construir un catálogo de todas las pistas y skins encontradas al navegar
en el juego, usa el escáner aparte:

```powershell
py .\catalog_scanner.py --watch
```

El escáner lee el historial actual del log y luego sigue sus cambios en vivo.
Guarda valores únicos en `game_catalog.csv`, con IDs consecutivos separados
para pistas y skins. Las entradas repetidas se omiten. Puedes detenerlo con
Ctrl+C.

Para ingresar tiempos desde una ventana gráfica y consultar tus mejores marcas:

```powershell
py .\time_trial_gui.py
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

El dashboard muestra las imágenes directamente desde las URLs de
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

El programa observa el log en tiempo real. Para registrar un tiempo reconocido
por OCR, introduce la cadena cuando aparezca el aviso:

```text
Tiempo detectado por OCR (Enter para ignorar): 1:20:99
```

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

`id,track_id,track,skin_id,skin,time_raw,time_seconds,pb,delta_pb,captured_at`

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

## Nota sobre OCR

La lectura de pista y personaje sale directamente del log, no de OCR. El log
revisado incluye `LOADING LEVEL` y `Loading hero`, pero no una línea con el
resultado/tiempo de carrera. Por eso el prototipo deja conectada la captura del
tiempo como entrada manual desde el aviso del monitor. Cuando se defina la
ventana/región del resultado del juego, esa entrada se puede sustituir por OCR
de pantalla sin cambiar el formato CSV ni la lógica de IDs.
