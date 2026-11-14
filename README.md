# Medidor de Terrenos — Versión reorganizada

Estructura de archivos:

- **index.html** — Estructura HTML limpia. Solo markup y enlaces a CSS/JS.
- **styles.css** — Todos los estilos (antes embebidos). Agrupados con los comentarios originales.
- **app.js** — Toda la lógica JavaScript (~3300 líneas).
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

La versión está escrita en tres lugares y deben coincidir; si no, la app avisa «Actualización incompleta»:

- `index.html` → `<meta name="app-version" content="…">`
- `styles.css` → `:root { --app-version: "…"; }`
- `app.js` → `const APP_VERSION = '…';`
- `backup.js` → `const BACKUP_VERSION = '…';`

Al publicar cambios, subir siempre `index.html`, `styles.css`, `app.js` y `backup.js` juntos (y `sw.js` / `manifest` / íconos solo si cambiaron).

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
