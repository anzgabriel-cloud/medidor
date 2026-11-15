const test = require('node:test');
const assert = require('node:assert');
const { get } = require('./cargar');
const vm = get('visibleMidpoint');
const R = { left: 0, right: 100, top: 0, bottom: 100 };
test('segmento dentro: punto medio', () => {
  const p = vm({ x: 10, y: 50 }, { x: 90, y: 50 }, R);
  assert.strictEqual(p.x, 50); assert.strictEqual(p.y, 50);
});
test('un extremo afuera: medio de la parte visible', () => {
  const p = vm({ x: 50, y: 50 }, { x: 250, y: 50 }, R);
  assert.ok(Math.abs(p.x - 75) < 1e-9 && p.y === 50);
});
test('ambos afuera pero la cuerda cruza la pantalla', () => {
  const p = vm({ x: -100, y: 50 }, { x: 300, y: 50 }, R);
  assert.ok(Math.abs(p.x - 50) < 1e-9);
});
test('cuerda fuera de pantalla: queda dentro del rectángulo', () => {
  const p = vm({ x: 200, y: 200 }, { x: 400, y: 300 }, R);
  assert.ok(p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100);
});
