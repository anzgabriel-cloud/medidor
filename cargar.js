// Carga funciones y constantes puras de app.js dentro de un contexto aislado (sin navegador).
// Uso: const { get, ctx } = require('./cargar');  get('trueBearing')(a, b)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function bloque(desde, fin) {       // texto desde `desde` hasta cerrar la función (fin='}') o la sentencia const (fin=';')
  let d = 0, i = desde, enCadena = null;
  for (; i < SRC.length; i++) {
    const c = SRC[i];
    if (enCadena) { if (c === '\\') i++; else if (c === enCadena) enCadena = null; continue; }
    if (c === '"' || c === "'" || c === '`') { enCadena = c; continue; }
    if ('([{'.includes(c)) d++;
    else if (')]}'.includes(c)) { d--; }
    if (d === 0 && c === fin) return SRC.slice(desde, i + 1);
  }
  throw new Error('bloque sin cerrar');
}
function extraer(nombre) {
  const f = new RegExp(`^(?:async\\s+)?function ${nombre}\\(`, 'm').exec(SRC);
  if (f) return bloque(f.index, '}');
  const c = new RegExp(`^const ${nombre} = `, 'm').exec(SRC);
  if (c) return bloque(c.index, ';');
  throw new Error(`No encontré «${nombre}» en app.js (¿se renombró o se borró?)`);
}

const mem = new Map();
const ctx = vm.createContext({
  Math, Number, String, Array, Object, JSON, Intl, isFinite, isNaN, parseFloat, parseInt,
  localStorage: { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) }
});
vm.runInContext("var settings = { units: 'metric', coords: 'dec', gpsMaxAcc: 20, gpsMinStep: 3 };", ctx);

// FT define también MI, ACRE y FT2 (misma sentencia const)
const NOMBRES = [
  'FT', 'nf0', 'isImp', 'lenMain', 'lenSub', 'areaMain', 'areaSub', 'fmtLenShort',
  'trueBearing', 'DECL_KEY', 'getDeclOverride', 'setDeclOverride', 'magneticDeclination', 'magneticBearing', 'brg0', 'bearingCardinal',
  'polygonIsCCW', 'vertexAngleInfo', 'angleArcGeometry',
  'tmForward', 'toUTM', 'toGaussKruger', 'tmInverse', 'fromUTM', 'fromGaussKruger',
  'dmsStr', 'fmtCoordLines', 'fmtCoord',
  'parseDecimalStr', 'parseMetersStr', 'isBlank', 'parseCoordForm'
];
for (const n of NOMBRES) vm.runInContext(extraer(n), ctx, { filename: `app.js:${n}` });

module.exports = {
  ctx,
  get: (n) => vm.runInContext(n, ctx),
  settings: (o) => Object.assign(ctx.settings, o),
  storage: mem
};
