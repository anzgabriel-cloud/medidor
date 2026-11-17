const test = require('node:test');
const assert = require('node:assert');
const { get, ctx } = require('./cargar');
const fmt = get('fmtSpeed');
test('km/h con un decimal', () => { assert.strictEqual(fmt(10), '36.0 km/h'); });
test('sin dato', () => { assert.strictEqual(fmt(null), '—'); assert.strictEqual(fmt(NaN), '—'); });
test('ruido del GPS parado = 0', () => { assert.strictEqual(fmt(0.2), '0.0 km/h'); });
test('millas por hora en imperial', () => {
  const prev = ctx.settings.units; ctx.settings.units = 'imperial';
  assert.strictEqual(fmt(10), '22.4 mph'); ctx.settings.units = prev;
});
