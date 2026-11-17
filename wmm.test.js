// Modelo magnético WMM2025: se compara con los 100 valores de prueba oficiales de NOAA (tests/datos/WMM2025_TestValues.txt)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');

const ctx = vm.createContext({ Math, Date, Map, Array });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'wmm.js'), 'utf8'), ctx, { filename: 'wmm.js' });
const wmmField = vm.runInContext('wmmField', ctx), wmmDeclination = vm.runInContext('wmmDeclination', ctx);

const filas = fs.readFileSync(path.join(__dirname, 'datos', 'WMM2025_TestValues.txt'), 'utf8')
  .split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => l.trim().split(/\s+/).map(Number));

test('hay 100 valores de prueba', () => assert.equal(filas.length, 100));

test('coincide con los valores oficiales de NOAA (D, I, H, X, Y, Z, F)', () => {
  const peor = { D: 0, I: 0, H: 0, X: 0, Y: 0, Z: 0, F: 0 };
  for (const [yr, alt, lat, lng, D, I, H, X, Y, Z, F] of filas) {
    const r = wmmField(lat, lng, yr, alt);
    const exp = { D, I, H, X, Y, Z, F };
    for (const k of Object.keys(exp)) {
      let d = Math.abs(r[k] - exp[k]);
      if (k === 'D') d = Math.min(d, 360 - d);
      peor[k] = Math.max(peor[k], d);
    }
  }
  console.log('# diferencia máxima', JSON.stringify(peor));
  assert.ok(peor.D < 0.01 && peor.I < 0.01, 'ángulos');            // los valores oficiales vienen redondeados a 0,01°
  for (const k of ['H', 'X', 'Y', 'Z', 'F']) assert.ok(peor[k] < 0.01, k + ' ' + peor[k]);   // nT
});

test('wmmDeclination es el mismo D y usa memoria', () => {
  const a = wmmDeclination(-38.95, -68.06, 2026.9, 0.3);
  assert.equal(a, wmmField(-38.95, -68.06, 2026.9, 0.3).D);
  assert.equal(wmmDeclination(-38.95, -68.06, 2026.9, 0.3), a);
});

// Integración: magneticDeclination de la app usa WMM cuando wmm.js está cargado, y el valor manual sigue mandando
test('app: magneticDeclination usa WMM, y el valor manual tiene prioridad', () => {
  const { ctx: app, get, storage } = require('./cargar');
  app.Date = Date; app.Map = Map;
  const antes = get('magneticDeclination')(-38.95, -68.06);                 // sin wmm.js: respaldo antiguo
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'wmm.js'), 'utf8'), app, { filename: 'wmm.js' });
  const ahora = get('magneticDeclination')(-38.95, -68.06);
  assert.equal(ahora, vm.runInContext('wmmDeclination', app)(-38.95, -68.06));
  assert.notEqual(ahora, antes);
  storage.set('medidor_decl_override', '-3.5');
  assert.equal(get('magneticDeclination')(-38.95, -68.06), -3.5);
  storage.delete('medidor_decl_override');
});
