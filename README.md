# Medidor de Terrenos — Versión reorganizada

Estructura de archivos:

- **index.html** — Estructura HTML limpia. Solo markup y enlaces a CSS/JS.
- **styles.css** — Todos los estilos (antes embebidos). Agrupados con los comentarios originales.
- **app.js** — Toda la lógica JavaScript (~3500 líneas). 

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

## Cómo usar

1. Serví la carpeta con un servidor local (necesario para geolocalización y service worker):
   ```bash
   python3 -m http.server 8080
   ```
2. Abrí `http://localhost:8080`

## Notas

- Se eliminó la indentación artificial que tenía el JS por estar dentro del `<script>`.
- El comportamiento es idéntico al original.
- Próximos pasos recomendados (si querés seguir):
  - Modularizar `app.js` en archivos más pequeños (estado, mapa, mediciones, pois, gps…).
  - Extraer constantes y helpers puros.
  - Añadir tests básicos para las funciones de cálculo (área, rumbo, conversiones UTM/GK).

El código original no fue modificado en lógica, solo reorganizado para ser más mantenible.
