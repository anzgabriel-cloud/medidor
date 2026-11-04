// Service worker de "Medidor de Terrenos": uso sin conexión.
// Guarda en caché (la primera vez que hay internet) la app, las librerías y los
// mosaicos del mapa que se hayan visto. Requiere servir index.html y sw.js por https.
const VERSION = 'medidor-v1';
const APP_CACHE = VERSION + '-app';
const TILE_CACHE = VERSION + '-tiles';
const MAX_TILES = 4000;
const TILE_HOSTS = ['server.arcgisonline.com', 'tile.openstreetmap.org'];
const LIB_HOSTS = ['unpkg.com', 'cdn.jsdelivr.net', 'cdn.tailwindcss.com'];

self.addEventListener('install', () => self.skipWaiting());
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
    const hit = await cache.match(req, { ignoreSearch: false });
    if (hit) return hit;
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
