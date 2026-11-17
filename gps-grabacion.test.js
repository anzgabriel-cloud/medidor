// Grabación GPS: errores pasajeros y costo de agregar puntos. Ejecutar: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { ctx, get } = require('./cargar');
const vm = require('vm');

test('solo el permiso rechazado (código 1) detiene la grabación', () => {
  const f = get('gpsErrorIsFatal');
  assert.equal(f({ code: 1 }), true);
  assert.equal(f({ code: 2 }), false);   // ubicación no disponible
  assert.equal(f({ code: 3 }), false);   // tiempo agotado
  assert.equal(f(null), false);
});

// Mapa y Leaflet simulados que cuentan cuántos marcadores/polilíneas se crean y quitan
function montar() {
  const c = { creados: 0, quitados: 0, polis: 0, setLatLngs: 0 };
  vm.runInContext(`var points = [], markers = [], mode = 'line', themeColor = '#00ff66', isLocked = false, gpsWatchId = null,
    drawingActive = true, trackMode = true, selectedVertex = -1, polyLayer = null, lineLayer = null, map = null;`, ctx);
  ctx.positionVertexBtn = () => {}; ctx.vertexIcon = () => ({}); ctx.startDrag = () => {};
  ctx.redraw = () => {}; ctx.pushHistory = () => {}; ctx.updateClearBtnState = () => {};
  ctx.closeThresholdMeters = () => 8; ctx.offerClosePolygon = () => {};
  ctx.requestAnimationFrame = (fn) => fn();
  ctx.updateMetrics = () => {}; ctx.clearKinkMarkers = () => {}; ctx.updateSelfIntersectWarning = () => {}; ctx.calcLine = () => {}; ctx.calcPolygon = () => {};
  ctx.map = { removeLayer: () => { c.quitados++; } };
  ctx.L.marker = () => { const m = { addTo() { c.creados++; return m; }, getElement: () => ({ style: {}, addEventListener() {} }), once() {}, setIcon() {} }; return m; };
  ctx.L.polyline = () => { c.polis++; const l = { addTo() { return l; }, setLatLngs() { c.setLatLngs++; return l; }, setStyle() { return l; } }; return l; };
  return c;
}
const pt = (i) => ctx.L.latLng(-27 + i * 1e-5, -55 + i * 1e-5);

test('grabando: cada punto nuevo crea un solo marcador (no rehace todos)', () => {
  const c = montar();
  ctx.gpsWatchId = 1;
  for (let i = 0; i < 300; i++) get('addPoint')(pt(i));
  assert.equal(ctx.points.length, 300);
  assert.equal(ctx.markers.length, 300);
  assert.equal(c.creados, 300);        // antes: 1+2+…+300 = 45.150
  assert.equal(c.quitados, 0);
});

test('sin grabar (o al insertar en el medio) se rehacen los marcadores como antes', () => {
  const c = montar();
  ctx.gpsWatchId = null;
  for (let i = 0; i < 4; i++) get('addPoint')(pt(i));
  assert.equal(ctx.markers.length, 4);
  assert.equal(c.creados, 1 + 2 + 3 + 4);
  ctx.gpsWatchId = 1;
  get('addPoint')(pt(9), 1);           // insertar en el medio: rebuild completo, índices coherentes
  assert.equal(ctx.markers.length, 5);
  assert.equal(c.creados, 10 + 5);
});

test('distancia: la polilínea se reutiliza; en superficie y al pasar de modo se recrea', () => {
  const c = montar();
  ctx.points = [pt(0), pt(1), pt(2)];
  get('updateGeometry')();
  assert.equal(c.polis, 1);
  get('updateGeometry')(); get('updateGeometry')();
  assert.equal(c.polis, 1); assert.equal(c.setLatLngs, 2);
  ctx.points = [pt(0)];                // menos de 2 puntos: se quita
  get('updateGeometry')();
  assert.equal(ctx.lineLayer, null);
  ctx.points = [pt(0), pt(1), pt(2)];
  get('updateGeometry')();
  assert.equal(c.polis, 2);
});
