// Service worker de "Medidor de Terrenos": uso sin conexión.
// Guarda en caché (la primera vez que hay internet) la app, las librerías y los
// mosaicos del mapa que se hayan visto. Requiere servir index.html y sw.js por https.
const VERSION = 'medidor-v1';
const APP_CACHE = VERSION + '-app';
const TILE_CACHE = VERSION + '-tiles';
const MAX_TILES = 4000;
const TILE_HOSTS = ['server.arcgisonline.com', 'tile.openstreetmap.org'];
const LIB_HOSTS = ['unpkg.com', 'cdn.jsdelivr.net', 'cdn.tailwindcss.com'];

// Se guarda TODO al instalar (primera visita), así la app abre sin conexión desde el principio.
const CORE_FILES = ['./', 'index.html', 'styles.css', 'app.js', 'backup.js', 'manifest.webmanifest',
  'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
const CORE_LIBS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.tailwindcss.com/3.4.16',
  'https://cdn.jsdelivr.net/npm/@turf/turf@6.5.0/turf.min.js',
  'https://unpkg.com/lucide@0.469.0'
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
      .then(() => self.clients.claim())
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES).map(k => cache.delete(k)));
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    // 'no-cache': revalida con el servidor y no usa la copia del caché HTTP del navegador
    // (GitHub Pages permite reutilizarla ~10 min, por eso a veces se veía la versión vieja).
    const res = await fetch(req, { cache: 'no-cache' });
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    // Abrir la app sin conexión (inicio, ?parámetros, etc.): servir index.html guardado
    if (req.mode === 'navigate') {
      const home = await cache.match('index.html') || await cache.match('./');
      if (home) return home;
    }
    throw err;
  }
}

async function cacheFirst(req, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) {
    cache.put(req, res.clone());
    if (limit) trim(cache);
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'nominatim.openstreetmap.org') return; // búsqueda: siempre en línea
  if (TILE_HOSTS.includes(url.hostname)) {
    e.respondWith(cacheFirst(req, TILE_CACHE, true));
  } else if (LIB_HOSTS.includes(url.hostname)) {
    e.respondWith(cacheFirst(req, APP_CACHE));
  } else if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(req, APP_CACHE));
  }
});
