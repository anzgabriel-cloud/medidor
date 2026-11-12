// Pruebas de la altitud (s.n.m.) y del perfil: red simulada, sin internet.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ctx, get, storage } = require('./cargar');

const reset = () => { ctx.elevCache = null; storage.clear(); ctx.navigator.onLine = true; };
const llist = (n) => Array.from({ length: n }, (_, i) => ctx.L.latLng(-27 - i * 0.001, -55.9 + i * 0.001));
const respMeteo = (alt) => async (url) => {
  const u = new URL(url);
  if (u.hostname !== 'api.open-meteo.com') throw new Error('otro host');
  const lat = u.searchParams.get('latitude').split(',');
  return { ok: true, json: async () => ({ elevation: lat.map((_, i) => alt(i)) }) };
};

test('consulta en lotes de 100 puntos', async () => {
  reset();
  const pedidos = [];
  ctx.fetch = async (url) => { pedidos.push(url); return respMeteo(i => 100 + i)(url); };
  const z = await get('fetchElevations')(llist(250));
  assert.equal(pedidos.length, 3);
  assert.equal(z.filter(v => v !== null).length, 250);
});

test('usa el caché: la segunda vez no pide nada', async () => {
  reset();
  let n = 0;
  ctx.fetch = async (url) => { n++; return respMeteo(() => 321)(url); };
  await get('fetchElevations')(llist(5));
  const antes = n;
  const z = await get('fetchElevations')(llist(5));
  assert.equal(n, antes);
  assert.deepEqual(Array.from(z), [321, 321, 321, 321, 321]);
});

test('el caché sobrevive a recargar la página (localStorage)', async () => {
  reset();
  ctx.fetch = respMeteo(() => 77);
  await get('fetchElevations')(llist(3));
  ctx.elevCache = null;                       // como al reabrir la app
  ctx.fetch = async () => { throw new Error('sin red'); };
  const z = await get('fetchElevations')(llist(3));
  assert.deepEqual(Array.from(z), [77, 77, 77]);
});

test('si Open-Meteo falla, usa Open Topo Data', async () => {
  reset();
  ctx.fetch = async (url) => {
    if (url.includes('open-meteo')) return { ok: false };
    return { ok: true, json: async () => ({ status: 'OK', results: url.split('locations=')[1].split('|').map(() => ({ elevation: 55 })) }) };
  };
  const z = await get('fetchElevations')(llist(2));
  assert.deepEqual(Array.from(z), [55, 55]);
});

test('sin conexión: devuelve null y no inventa valores', async () => {
  reset();
  ctx.navigator.onLine = false;
  const z = await get('fetchElevations')(llist(3));
  assert.deepEqual(Array.from(z), [null, null, null]);
});

test('respuesta con menos datos que puntos se descarta', async () => {
  reset();
  ctx.fetch = async () => ({ ok: true, json: async () => ({ elevation: [1] }) });
  const z = await get('fetchElevations')(llist(3));
  assert.deepEqual(Array.from(z), [null, null, null]);
});

test('lineSamples: equiespaciado, empieza y termina en los extremos', () => {
  const pts = [ctx.L.latLng(-27, -55.9), ctx.L.latLng(-27, -55.89), ctx.L.latLng(-27.01, -55.89)];
  const r = get('lineSamples')(pts);
  const s = r.samples;
  assert.ok(s.length >= 2 && s.length <= 100);
  assert.equal(s[0].d, 0);
  assert.ok(Math.abs(s[s.length - 1].d - r.total) < 1e-6);
  const pasos = s.slice(1).map((q, i) => q.d - s[i].d);
  assert.ok(Math.max(...pasos) - Math.min(...pasos) < 1e-6, 'pasos desiguales');
  // el último punto cae en el extremo real
  assert.ok(Math.abs(s[s.length - 1].ll.lat - (-27.01)) < 1e-9);
  assert.equal(get('lineSamples')([pts[0], pts[0]]), null);
});

test('lineSamples: nunca más de 100 puntos aunque el trazado sea larguísimo', () => {
  const r = get('lineSamples')([ctx.L.latLng(-27, -56), ctx.L.latLng(-30, -50)]);
  assert.equal(r.samples.length, 100);
});

test('profileStats: subida y bajada de una rampa limpia', () => {
  const z = [100, 110, 120, 130, 120, 110, 100];
  const s = get('profileStats')(z);
  assert.equal(s.min, 100); assert.equal(s.max, 130);
  assert.equal(s.start, 100); assert.equal(s.end, 100);
  assert.ok(s.up > 20 && s.up <= 30, 'subida ' + s.up);
  assert.ok(Math.abs(s.up - s.down) < 1e-9);
});

test('profileStats: el ruido pequeño no se acumula como desnivel', () => {
  const ruido = Array.from({ length: 50 }, (_, i) => 200 + (i % 2 ? 0.6 : -0.6));
  const s = get('profileStats')(ruido);
  const sinSuavizar = ruido.slice(1).reduce((a, v, i) => a + Math.max(0, v - ruido[i]), 0);
  assert.ok(s.up < sinSuavizar / 2, `suavizado ${s.up} vs crudo ${sinSuavizar}`);
});

test('perfil: rellena huecos sueltos y guarda en el item', async () => {
  reset();
  let call = 0;
  ctx.fetch = async (url) => {
    const n = new URL(url).searchParams.get('latitude').split(',').length;
    call++;
    return { ok: true, json: async () => ({ elevation: Array.from({ length: n }, (_, i) => 100 + i) }) };
  };
  const item = { mode: 'line', points: [{ lat: -27, lng: -55.9 }, { lat: -27.01, lng: -55.9 }] };
  const p = await get('getItemProfile')(item);
  assert.ok(p.z.every(Number.isFinite));
  assert.equal(p.z[0], 100);
  assert.ok(item.prof, 'quedó guardado en el item');
  const antes = call;
  await get('getItemProfile')(item);
  assert.equal(call, antes, 'segunda vez usa lo guardado');
  item.points[1].lat = -27.02;                // si se edita el trazado, se recalcula
  ctx.elevCache = {}; 
  await get('getItemProfile')(item);
  assert.ok(call > antes, 'recalcula tras editar');
});

test('itemSig cambia si se mueve un punto', () => {
  const a = { mode: 'line', points: [{ lat: -27, lng: -55 }, { lat: -27.1, lng: -55 }] };
  const b = { mode: 'line', points: [{ lat: -27, lng: -55 }, { lat: -27.1, lng: -55.0001 }] };
  assert.notEqual(get('itemSig')(a), get('itemSig')(b));
  assert.equal(get('itemSig')(a), get('itemSig')(JSON.parse(JSON.stringify(a))));
});

test('unidades: metros y pies', () => {
  ctx.settings.units = 'metric';
  assert.equal(get('fmtElev')(300).replace(/\s/g, ' '), '300 m');
  ctx.settings.units = 'imperial';
  assert.match(get('fmtElev')(300).replace(/\s/g, ' '), /^984 ft$/);
  ctx.settings.units = 'metric';
});
