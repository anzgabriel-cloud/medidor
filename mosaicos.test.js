const test = require('node:test');
const assert = require('node:assert');
const { get } = require('./cargar');
const isPh = get('isPlaceholderSample'), crop = get('parentCrop');
const fill = (fn) => { const d = new Uint8ClampedArray(32 * 32 * 4); for (let i = 0; i < 1024; i++) { const [r, g, b] = fn(i); d.set([r, g, b, 255], i * 4); } return d; };
test('gris liso con algo de texto blanco = aviso de Esri', () => {
  assert.ok(isPh(fill(i => (i % 20 === 0 ? [255, 255, 255] : [204, 204, 204]))));
});
test('gris con mucho texto blanco suave (borde difuso) sigue siendo aviso', () => {
  assert.ok(isPh(fill(i => { const v = i % 7 === 0 ? 255 : (i % 7 === 1 ? 230 : 204); return [v, v, v]; })));
});
test('nieve o nubes (casi blanco) no es aviso', () => {
  assert.ok(!isPh(fill(() => [248, 248, 250])));
});
test('imagen satelital (verde y tierra) no es aviso', () => {
  assert.ok(!isPh(fill(i => (i % 2 ? [40, 70, 35] : [120, 90, 60]))));
});
test('gris pero muy oscuro (sombra/agua) no es aviso', () => {
  assert.ok(!isPh(fill(() => [60, 60, 60])));
});
test('recorte del mosaico padre', () => {
  const c = crop(5, 9, 1, 256);
  assert.strictEqual(c.px, 2); assert.strictEqual(c.py, 4); assert.strictEqual(c.sx, 128); assert.strictEqual(c.sy, 128); assert.strictEqual(c.side, 128);
  const d = crop(8, 8, 2, 256);
  assert.strictEqual(d.px, 2); assert.strictEqual(d.sx, 0); assert.strictEqual(d.side, 64);
});
