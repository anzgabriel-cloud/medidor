// Service worker de "Medidor de Terrenos": uso sin conexión.
// Guarda en caché (la primera vez que hay internet) la app, las librerías y los
// mosaicos del mapa que se hayan visto. Requiere servir index.html y sw.js por https.
const VERSION = 'medidor-v1';
const APP_CACHE = VERSION + '-app';
// Mosaicos separados por tipo: cada uno con su depósito y su tope, así uno no desplaza al otro
const TILE_CACHE_SAT = VERSION + '-tiles-sat';   // foto satelital (Esri): mosaicos más pesados
const TILE_CACHE_OSM = VERSION + '-tiles-osm';   // OpenStreetMap: más livianos
const TILE_CACHE_DEM = VERSION + '-tiles-dem';   // mosaicos de terreno (altitud) de AWS
const MAX_TILES_DEM = 400;
const TILE_CACHE_OLD = VERSION + '-tiles';       // depósito único anterior: se migra al activar
const MAX_TILES_SAT = 3000;
const MAX_TILES_OSM = 2500;
const TILE_HOSTS = ['server.arcgisonline.com', 'tile.openstreetmap.org'];
const DEM_PATH = '/elevation-tiles-prod/terrarium/';   // s3.amazonaws.com
const isDem = (u) => u.hostname === 's3.amazonaws.com' && u.pathname.indexOf(DEM_PATH) === 0;
const LIB_HOSTS = ['cdn.tailwindcss.com'];
// OpenStreetMap reparte los mosaicos en subdominios (a., b., c.tile.openstreetmap.org): hay que aceptar también esos
const isTileHost = (h) => TILE_HOSTS.some(t => h === t || h.endsWith('.' + t));

// Se guarda TODO al instalar (primera visita), así la app abre sin conexión desde el principio.
const CORE_FILES = ['./', 'index.html', 'styles.css', 'app.js', 'tiras.js', 'anillos.js', 'rutas.js', 'tarjetas.js', 'backup.js', 'wmm.js', 'manifest.webmanifest',
  'leaflet.css', 'leaflet.js', 'turf.min.js', 'lucide.min.js', 'tailwind-3.4.16.js',
  'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
const CORE_LIBS = [
  'https://cdn.tailwindcss.com/3.4.16'
];

// Descarga con tope de tiempo: una librería lenta no debe trabar la instalación
function fetchWithTimeout(url, opts, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { ...opts, signal: ctl.signal }).finally(() => clearTimeout(t));
}

async function precache() {
  const cache = await caches.open(APP_CACHE);
  // allSettled: si un archivo falla (p. ej. sin internet) no se cancela la instalación
  await Promise.allSettled([
    ...CORE_FILES.map(f => fetchWithTimeout(f, { cache: 'reload' }, 15000).then(r => { if (r.ok) return cache.put(f, r); })),
    ...CORE_LIBS.map(u => fetchWithTimeout(u, { mode: 'no-cors' }, 15000).then(r => cache.put(u, r)))
  ]);
}

self.addEventListener('install', (e) => { e.waitUntil(precache().then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))))
      .then(migrateOldTiles)
      .then(() => self.clients.claim())
  );
});

async function trim(cache, max) {
  const keys = await cache.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map(k => cache.delete(k)));
}
const tileCacheFor = (host) => host.endsWith('openstreetmap.org') ? TILE_CACHE_OSM : TILE_CACHE_SAT;
const tileMaxFor = (name) => name === TILE_CACHE_OSM ? MAX_TILES_OSM : (name === TILE_CACHE_DEM ? MAX_TILES_DEM : MAX_TILES_SAT);

// Reparte los mosaicos del depósito único anterior en los dos nuevos (por su servidor) y lo elimina.
// Si algo falla, el depósito viejo se deja y se reintenta en la próxima activación.
async function migrateOldTiles() {
  try {
    if (!(await caches.has(TILE_CACHE_OLD))) return;
    const old = await caches.open(TILE_CACHE_OLD);
    const keys = await old.keys();
    for (const k of keys) {
      const res = await old.match(k);
      if (!res) continue;
      const dest = await caches.open(tileCacheFor(new URL(k.url).hostname));
      await dest.put(k, res);
    }
    await caches.delete(TILE_CACHE_OLD);
  } catch (e) { /* se reintenta luego */ }
}

// Con mala señal (campo) un fetch puede quedar colgado minutos: si ya hay copia guardada, se espera la red
// solo NETWORK_TIMEOUT_MS y se abre desde la copia; el pedido sigue en segundo plano y deja la versión nueva para la próxima vez.
const NETWORK_TIMEOUT_MS = 3000;
async function networkFirst(req, cacheName, evt) {
  const cache = await caches.open(cacheName);
  // 'no-cache': revalida con el servidor y no usa la copia del caché HTTP del navegador
  // (GitHub Pages permite reutilizarla ~10 min, por eso a veces se veía la versión vieja).
  const fresh = fetch(req, { cache: 'no-cache' }).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  });
  fresh.catch(() => {});   // si falla cuando ya se abrió desde la copia, que no quede como error sin atender
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), NETWORK_TIMEOUT_MS); });
  try {
    return await Promise.race([fresh, timeout]);
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    // Abrir la app sin conexión (inicio, ?parámetros, etc.): servir index.html guardado
    const home = hit || (req.mode === 'navigate' ? (await cache.match('index.html') || await cache.match('./')) : null);
    if (home) {
      if (evt && evt.waitUntil) evt.waitUntil(fresh.catch(() => {}));   // que termine de actualizar la copia
      return home;
    }
    return fresh;   // sin copia guardada: no queda más que esperar a la red (si falla, el error sale igual que antes)
  } finally { clearTimeout(timer); }
}

// Mosaicos: se pide en modo CORS para poder ver el estado HTTP y NO guardar errores
// (una respuesta opaca no deja ver si fue un 404/500 y quedaría rota para siempre).
// Si el servidor no admite CORS, se usa el pedido normal como respaldo.
// Con tope de tiempo: un mosaico colgado (mala señal o servidor lento) no debe dejar el mapa "cargando" para siempre;
// al vencer devuelve error y el mapa lo reintenta.
const TILE_TIMEOUT_MS = 9000;
async function fetchTile(req) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TILE_TIMEOUT_MS);
  try {
    try {
      return await fetch(req.url, { mode: 'cors', credentials: 'omit', signal: ctl.signal });
    } catch (e) {
      if (ctl.signal.aborted) return Response.error();   // se agotó el tiempo
      return await fetch(req.url, { mode: 'no-cors', credentials: 'omit', signal: ctl.signal });   // el servidor no admite CORS: respaldo
    }
  } catch (e) {
    return Response.error();
  } finally { clearTimeout(timer); }
}

// Recortar el caché de mosaicos recorre todas las claves: se hace cada tanto, no con cada mosaico nuevo
let putsSinceTrim = 0;

async function cacheFirst(req, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = limit ? await fetchTile(req) : await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) {
    cache.put(req, res.clone());
    if (limit && ++putsSinceTrim >= 100) { putsSinceTrim = 0; trim(cache, tileMaxFor(cacheName)); }
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'nominatim.openstreetmap.org') return; // búsqueda: siempre en línea
  if (isDem(url)) { e.respondWith(cacheFirst(req, TILE_CACHE_DEM, true)); return; }
  if (isTileHost(url.hostname)) {
    e.respondWith(cacheFirst(req, tileCacheFor(url.hostname), true));
  } else if (LIB_HOSTS.includes(url.hostname)) {
    e.respondWith(cacheFirst(req, APP_CACHE));
  } else if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(req, APP_CACHE, e));
  }
});
