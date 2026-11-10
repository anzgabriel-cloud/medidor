# Medidor de Terrenos — Versión reorganizada

Estructura de archivos:

- **index.html** — Estructura HTML limpia. Solo markup y enlaces a CSS/JS.
- **styles.css** — Todos los estilos (antes embebidos). Agrupados con los comentarios originales.
- **app.js** — Toda la lógica JavaScript (~3300 líneas).
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

Al publicar cambios, subir siempre `index.html`, `styles.css` y `app.js` juntos (y `sw.js` / `manifest` / íconos solo si cambiaron).

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
node --test tests/calculos.test.js
```
