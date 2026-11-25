# Medidor de Terrenos — Versión reorganizada

Estructura de archivos:

- **index.html** — Estructura HTML limpia. Solo markup y enlaces a CSS/JS.
- **styles.css** — Todos los estilos (antes embebidos). Agrupados con los comentarios originales.
- **app.js** — Lógica principal: mediciones (superficie, distancia, recorrido GPS), POI, listas, búsqueda, perfil de elevación, ajustes (~5000 líneas).
- **tiras.js** — Barras de íconos (Ajustes/Capas/GPS, Buscar/Medir/Carpeta, herramientas de medición) y la lógica de bloqueo de botones.
- **rutas.js** — Rutas/senderos a mano alzada (borrador, estilo de línea, consulta, perfil).
- **anillos.js** — Anillos con radio (crear, editar, consulta).
- **tarjetas.js** — Tarjeta de Consulta compartida (acciones agrupadas a la izquierda; `right:true` queda a la derecha).
- **tailwind-3.4.16.js** — Tailwind local (si falta, se usa el de internet).
- **wmm.js** — Modelo magnético WMM2025 (declinación sin conexión, coeficientes oficiales de NOAA).
- **backup.js** — Exportación e importación de copias de seguridad en GeoJSON, KML y GPX (escritores y lectores, sin dependencias de la app).
- **sw.js** — Service worker: guarda la app completa desde la primera visita y permite usarla sin conexión.
- **manifest.webmanifest** e **icon-*.png** — Hacen que la app se pueda instalar (pantalla completa en el iPhone).

## Secciones principales en `app.js`

El código mantiene los comentarios de sección originales para facilitar la navegación:

- STATE
- HELPERS
- AJUSTES / UNIDADES / COORDENADAS
- BORRADOR AUTOMÁTICO
- ICONS / TOASTS
- INIT
- LOCK UI
- DRAG
- LIVE LABELS
- BEARING / DECLINATION
- HISTORY
- POINTS / DRAW
- SAVED LAYERS
- VISTA: Ver / Medir
- MODE
- LAYERS / LOCATION / SEARCH
- IR A COORDENADAS
- BÚSQUEDA DE LUGARES
- POIs
- SAVE / LOAD
- GPS

## Versión (para no mezclar archivos)

La versión está escrita en varios lugares y deben coincidir; si no, la app avisa «Actualización incompleta»:

- `index.html` → `<meta name="app-version" content="…">`
- `styles.css` → `:root { --app-version: "…"; }`
- `app.js` → `const APP_VERSION = '…';`
- `backup.js` → `const BACKUP_VERSION = '…';`
- `tiras.js`, `rutas.js`, `anillos.js`, `tarjetas.js` → primera línea `window.MV.<nombre> = '…';`

Al publicar cambios de versión, subir siempre `index.html`, `styles.css`, `app.js`, `backup.js`, `tiras.js`, `rutas.js`, `anillos.js` y `tarjetas.js` juntos (y `wmm.js` si cambió; la app avisa si falta) (y `sw.js` / `manifest` / íconos solo si cambiaron).

## Instalar en el iPhone (pantalla completa)

Safari → Compartir → **Añadir a pantalla de inicio**. La app instalada guarda sus datos aparte de Safari: hay que **Exportar** las mediciones y POI en Safari e **Importar** el archivo en la app instalada (los Ajustes se vuelven a configurar).

## Cómo usar

1. Serví la carpeta con un servidor local (necesario para geolocalización y service worker):
   ```bash
   python3 -m http.server 8080
   ```
2. Abrí `http://localhost:8080`

## Notas

- Código muerto eliminado (flecha de colapsar, panel de datos oculto, funciones sin uso).
- Se eliminó la indentación artificial que tenía el JS por estar dentro del `<script>`.
- El comportamiento es idéntico al original.
- Próximos pasos recomendados (si querés seguir):
  - Modularizar `app.js` en archivos más pequeños (estado, mapa, mediciones, pois, gps…).
  - Extraer constantes y helpers puros.
  - Añadir tests básicos para las funciones de cálculo (área, rumbo, conversiones UTM/GK).

El código original no fue modificado en lógica, solo reorganizado para ser más mantenible.

## Tests (solo desarrollo)

Verifican los cálculos puros (ángulos, rumbos, declinación, UTM y Gauss-Krüger, parseo de coordenadas).
No hace falta subir la carpeta `tests/` a GitHub Pages.

```
node --test tests/calculos.test.js tests/altitud.test.js tests/cercania.test.js
```

## Altitud (s.n.m.) y perfil

- Se pide a [Open-Meteo](https://open-meteo.com/en/docs/elevation-api) (Copernicus DEM GLO-90, 90 m); si falla, a Open Topo Data (SRTM).
- Hace falta conexión la primera vez; después queda guardada en el navegador (caché por punto y dentro de cada medición).
- Es un modelo de superficie: precisión de varios metros y, bajo monte, incluye la copa de los árboles.
- Superficies: media por malla interior (pesa por área) + mínimo, máximo y desnivel. Distancias y recorridos: perfil con subida y bajada acumuladas.


## Copias de seguridad y mosaicos
- Ajustes → Copia de seguridad: elegir GeoJSON (copia completa), KML (Google Earth) o GPX (GPS). Al importar el formato se detecta solo. Los polígonos con huecos no se importan.
- Ajustes → Mapas guardados: cuenta y borra la caché `medidor-v1-tiles` del service worker (no toca mediciones ni POI). No cambiar `VERSION` en sw.js: borraría también esa caché.
- El service worker guarda los mosaicos pidiéndolos en modo CORS: las respuestas con error (404/500) no se guardan. Si el servidor no admite CORS, se usa el pedido normal.

## Listas y Consulta
- Las listas de POI y Mediciones se ordenan por cercanía a la ubicación GPS (si hay fix); una superficie en la que estás parado figura "estás adentro". Sin GPS mantienen el orden de creación.
- El menú ⋯ de Consulta ofrece Editar, Navegar (solo POI), Ir y Eliminar. Al editar una medición se puede cambiar el nombre.
- Borrar un punto de una superficie o distancia: tocarlo (sin arrastrar) lo selecciona y aparece "Borrar punto"; se recupera con Deshacer. Mínimo 3 puntos en superficie y 2 en distancia. No aplica a recorridos.

## Brújula (Modo vista)
Siempre visible arriba a la derecha (y en cualquier modo mientras hay una Consulta abierta). La **flecha verde** y su línea quedan fijas (hacia donde mirás) y la **rosa de los vientos gira** debajo; la etiqueta verde de abajo muestra el rumbo verdadero (V), el magnético (M) y el punto cardinal, p. ej. «341° V - 358° M - NNO». El mapa no rota. El rumbo sale del sensor del teléfono (corregido por declinación) y del GPS cuando te movés rápido (la etiqueta agrega «- GPS»). En iPhone, la primera vez hay que tocar la brújula para dar el permiso del sensor. Dos tamaños: 1× y 2× (botones a la izquierda).

## Navegación a un POI
La cuerda punteada lleva una etiqueta con rumbo y distancia que se mantiene siempre dentro de la pantalla (zoom o desplazamiento) y se actualiza con el GPS. En el POI donde estás parado (a menos de 15 m) "Navegar" queda desactivado ("Estás aquí"); al llegar, la navegación termina sola.

## Zoom alto en satélite
Donde Esri no tiene imagen a cierto zoom devuelve un mosaico gris "Map data not yet available". La app lo detecta (en zoom ≥ 13) y lo reemplaza por el mosaico del nivel anterior ampliado, hasta 8 niveles arriba. Requiere que el servidor permita leer los píxeles (CORS); si no, se muestra el mosaico tal cual.
Ajustes → "Zoom máximo de la imagen satelital": Automático (detecta el cartel) o un nivel fijo (16/17/18) como respaldo si la detección no funciona.

## Apertura con mala señal y almacenamiento
- `sw.js`: los archivos de la app se piden primero a la red, pero si ya hay copia guardada y la red no responde en 3 s (`NETWORK_TIMEOUT_MS`), se abre desde la copia y la versión nueva queda lista para la próxima vez.
- Ajustes → Copia de seguridad: en una pestaña de Safari el recordatorio salta a los 6 días (el sistema puede borrar los datos de un sitio sin uso por ~7 días); instalada en la pantalla de inicio, a los 14. La app pide además almacenamiento persistente (`navigator.storage.persist()`); si no se concede y no está instalada, Ajustes lo advierte.
- Tests nuevos: `tests/gps-grabacion.test.js`, `tests/sw-y-respaldo.test.js`. Se ejecutan todos con `node --test tests/*.test.js`.

## Declinación magnética (WMM2025)
- `wmm.js` calcula la declinación con el modelo oficial WMM2025 (NOAA/NCEI y BGS), sin conexión. Se verificó contra los 100 valores de prueba de NOAA (`tests/datos/WMM2025_TestValues.txt`, `tests/wmm.test.js`): diferencia máxima 0,005° (el redondeo del archivo oficial).
- El valor manual de Ajustes sigue teniendo prioridad; "Auto" usa el modelo.
- **Vence a fines de 2029.** Entonces NOAA publica WMM2030: regenerar `WMM_COF` con el nuevo `WMM.COF` y actualizar `WMM_EPOCH` / `WMM_VALID_UNTIL`.
- Si `wmm.js` no carga, la app usa la estimación antigua (solo buena cerca de Buenos Aires).
