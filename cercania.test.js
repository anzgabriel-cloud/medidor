// Pruebas de la distancia usada para ordenar las listas por cercanía. Ejecutar: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { get } = require('./cargar');

const M = 111320;                                   // metros por grado de latitud (aprox.)
const casi = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} esperado ${b}, obtenido ${a}`);
const ll = (lat, lng) => ({ lat, lng });
const base = ll(-27, -55);
const dLat = (m) => m / M;
const dLng = (m) => m / (M * Math.cos(27 * Math.PI / 180));

test('distancia a un punto único', () => {
  casi(get('distToPathM')(base, [ll(-27 + dLat(100), -55)], false), 100, 1);
});
test('distancia a un segmento: perpendicular, no al vértice', () => {
  // línea E-O 80 m al norte de la posición, larga: la distancia es 80, no la del vértice más cercano
  const linea = [ll(-27 + dLat(80), -55 - dLng(500)), ll(-27 + dLat(80), -55 + dLng(500))];
  casi(get('distToPathM')(base, linea, false), 80, 1);
});
test('más allá del extremo del segmento mide al extremo', () => {
  const linea = [ll(-27, -55 + dLng(100)), ll(-27, -55 + dLng(300))];
  casi(get('distToPathM')(base, linea, false), 100, 1);
});
test('polígono cerrado: el lado de cierre cuenta', () => {
  const sq = [ll(-27 + dLat(50), -55 - dLng(50)), ll(-27 + dLat(50), -55 + dLng(50)), ll(-27 + dLat(150), -55 + dLng(50)), ll(-27 + dLat(150), -55 - dLng(50))];
  casi(get('distToPathM')(base, sq, true), 50, 1);
});
test('punto dentro y fuera de un polígono', () => {
  const sq = [ll(-26.99, -55.01), ll(-26.99, -54.99), ll(-27.01, -54.99), ll(-27.01, -55.01)];
  assert.equal(get('pointInRing')(base, sq), true);
  assert.equal(get('pointInRing')(ll(-26.5, -55), sq), false);
});
test('savedDistance: adentro devuelve 0 y marca inside', () => {
  const item = { mode: 'polygon', points: [ll(-26.99, -55.01), ll(-26.99, -54.99), ll(-27.01, -54.99), ll(-27.01, -55.01)] };
  const r = get('savedDistance')(item, base);
  assert.equal(r.inside, true); assert.equal(r.d, 0);
});
test('savedDistance: polígono lejano y línea', () => {
  const poly = { mode: 'polygon', points: [ll(-26.9, -55.01), ll(-26.9, -54.99), ll(-26.89, -55)] };
  const r = get('savedDistance')(poly, base);
  assert.equal(r.inside, false); casi(r.d, 0.1 * M, 60);
  const lin = { mode: 'line', points: [ll(-27 + dLat(30), -55), ll(-27 + dLat(30), -54.99)] };
  casi(get('savedDistance')(lin, base).d, 30, 1);
});
