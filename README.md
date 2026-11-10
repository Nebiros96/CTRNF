# Crash™ Team Racing NF - Dashboard (v0.9)

Tablero personal para Crash Team Racing Nitro-Fueled desde el Port Nativo de [Ryu7w7](https://github.com/Ryu7w7/OCTR-NitroFueled-PC). 

## Información importante para el primer arranque

* TOTALMENTE RECOEMNDADO haber arrancado el Juego desde el Port antes de abrir el ejecutable, esto crea el archivo log que es el que lee el ejecutable.
* Es posible que el ejecutable no pueda leer automáticamente el log, para ello desde el ejecutable puedes seleccionar el archivo manualmente navegando la ruta del PORT instalado.
* Abres `CTRNF.exe`, el lanzador enciende la aplicación y el tablero aparece en el navegador. Los registros se quedan en el equipo, en `%LOCALAPPDATA%\CTRNF\data`, y siguen ahí cuando actualices. Si hay una versión nueva en las Releases de este repositorio, el lanzador te avisa; descargas y reemplaza el ejecutable.

![Versión 0.8 del ejecutable](utils/ejecutable.JPG)

## Time Trial

Eliges la pista que acabas de correr, registras el tiempo y lo guardas. El formato es minutos, segundos y centésimas, por ejemplo `1:25:03`.

A la derecha queda el top 10 de esa pista: puesto, skin, tiempo, fecha y la diferencia con tu mejor marca. El primer puesto va con borde dorado. Abajo, en la misma vista, están los tiempos de los fantasmas del juego para compararlos con lo que acabas de hacer.

![Time Trial en Retro Stadium, con el formulario de registro y el top 10 de la pista](utils/TimeTrial.JPG)

Para la pista en curso también ves cuántas veces la registraste, cuánto mejoraste desde el primer tiempo y qué tan parecidos son entre sí tus intentos.

![Indicadores de la pista: registros, mejora absoluta, mejora relativa y desviación estándar](utils/TTStats.JPG)

## Ring Rally

El mismo gesto, ahora con puntaje. Anotas los puntos y el número de vueltas de la carrera. El top 10 de la pista ordena de mayor a menor y señala cuándo ese intento fue tu mejor marca, o por cuántos puntos se quedó atrás.

![Ring Rally en Jungle Boogie, con el registro de puntaje y el top de la pista](utils/RingRally.JPG)

Cuando una skin llega a los puntos que le faltaban, el tablero te lo dice antes de seguir.

![Aviso de skin desbloqueada al terminar un Ring Rally](utils/unlock.JPG)

## Álbum de skins

El álbum junta las skins por personaje y por rareza: Basic, Exotic, Legendary y Beenox. Arriba ves cuántas llevas desbloqueadas y el multiplicador global que usa la siguiente carrera, con cualquier personaje.

![Álbum de skins de Dr. N. Gin, con el progreso por rareza y el multiplicador global](utils/SkinsAlbum.JPG)

## Trofeos

Cada trofeo muestra en qué vas, de qué nivel es y cuánto suma al multiplicador. Si ya lo completaste, aparece la fecha.

![Lista de trofeos con progreso, nivel y fecha de desbloqueo](utils/Trophies.JPG)

## Overlays para OBS

![Overlay del Time Trial](utils/overlayTT.jpg)
![Overlay de Ring Rally](utils/overlayRR.png)

## Respaldo

En Configuración puedes exportar un ZIP con tus tiempos de Contrarreloj y tus puntajes de Ring Rally. Al abrir, el programa intenta encontrar el log del juego. Si no aparece, lo eliges una vez y esa ruta queda guardada en el equipo; puedes cambiarla si mueves el juego. Al importar un respaldo, solo se completa un registro que todavía está vacío.

Cada pista tiene un límite para no guardar un tiempo imposible o un puntaje fuera de rango. Esos límites salen de los récords mundiales del modo glitchless publicados en [crashteamranking.com](https://crashteamranking.com/), con un margen del 5 %. Se actualizaron el 31 de octubre de 2026.

Crash Team Racing Nitro-Fueled es una marca de Activision. Este tablero es un proyecto de fans y no está asociado al juego.
