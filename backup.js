// Copias de seguridad: exporta e importa mediciones y POI en GeoJSON, KML y GPX.
// Modelo común (lo que lee y devuelve este archivo):
//   mediciones: { name, mode: 'polygon' | 'line', color: '#rrggbb', date, points: [{ lat, lng }] }
//   POI:        { name, note, color: '#rrggbb', lat, lng, elev? }
const BACKUP_VERSION = '2026.11.09-42';
const BACKUP_FORMATS = {
  geojson: {
    label: 'GeoJSON', ext: 'geojson', mime: 'application/geo+json',
    help: 'Copia completa de la app (nombre, color, fecha, notas). Es el formato recomendado para respaldar.'
  },
  kml: {
    label: 'KML', ext: 'kml', mime: 'application/vnd.google-earth.kml+xml',
    help: 'Para Google Earth y Google Maps. Conserva nombre, color, fecha y notas.'
  },
  gpx: {
    label: 'GPX', ext: 'gpx', mime: 'application/gpx+xml',
    help: 'Para GPS y apps de senderismo. Las superficies se guardan como un trazado cerrado y los POI como waypoints.'
  }
};

// ---------- utilidades ----------
const bkEsc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')   // caracteres no permitidos en XML 1.0
  .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const bkHex = (c) => /^#[0-9a-f]{6}$/i.test(c || '');
const bkColor = (c, fallback) => bkHex(c) ? c.toLowerCase() : fallback;
const bkValidLL = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
const bkToday = () => new Date().toLocaleDateString('es-AR');
const bkFix = (n) => (+n).toFixed(7).replace(/\.?0+$/, '');   // ≈ 1 cm, sin ceros de más
const bkIsPoly = (m) => m.mode === 'polygon' && m.points.length >= 3;   // 2 puntos no forman polígono

// ---------- exportación ----------
function buildGeoJSON(saved, pois) {
  const features = saved.map(m => {
    const coords = m.points.map(p => [p.lng, p.lat]);
    const poly = bkIsPoly(m);
    if (poly) coords.push(coords[0]);
    return {
      type: 'Feature',
      properties: { name: m.name, mode: poly ? 'polygon' : 'line', color: m.color, date: m.date },
      geometry: poly ? { type: 'Polygon', coordinates: [coords] } : { type: 'LineString', coordinates: coords }
    };
  });
  pois.forEach(p => {
    if (!bkValidLL(+p.lat, +p.lng)) return;
    features.push({
      type: 'Feature',
      properties: { kind: 'poi', name: p.name, note: p.note || '', color: p.color },
      geometry: { type: 'Point', coordinates: [+p.lng, +p.lat] }
    });
  });
  return JSON.stringify({ type: 'FeatureCollection', features }, null, 2);
}

// KML usa colores aabbggrr
const bkKmlColor = (hex, alpha) => {
  const h = bkColor(hex, '#00ff66').slice(1);
  return alpha + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2);
};
const bkFromKmlColor = (c) => {
  const m = /^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec((c || '').trim());
  return m ? ('#' + m[4] + m[3] + m[2]).toLowerCase() : null;
};
function buildKML(saved, pois) {
  const data = (k, v) => `<Data name="${k}"><value>${bkEsc(v)}</value></Data>`;
  const out = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">', '<Document>', '<name>Medidor de Terrenos</name>'];
  saved.forEach(m => {
    const poly = bkIsPoly(m);
    const ring = m.points.map(p => `${bkFix(p.lng)},${bkFix(p.lat)},0`);
    if (poly) ring.push(ring[0]);
    out.push('<Placemark>',
      `<name>${bkEsc(m.name)}</name>`,
      `<description>${bkEsc(m.date || '')}</description>`,
      `<Style><LineStyle><color>${bkKmlColor(m.color, 'ff')}</color><width>3</width></LineStyle>` +
        (poly ? `<PolyStyle><color>${bkKmlColor(m.color, '59')}</color></PolyStyle>` : '') + '</Style>',
      `<ExtendedData>${data('mode', poly ? 'polygon' : 'line')}${data('color', bkColor(m.color, '#00ff66'))}${data('date', m.date || '')}</ExtendedData>`,
      poly
        ? `<Polygon><outerBoundaryIs><LinearRing><coordinates>${ring.join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon>`
        : `<LineString><tessellate>1</tessellate><coordinates>${ring.join(' ')}</coordinates></LineString>`,
      '</Placemark>');
  });
  pois.forEach(p => {
    if (!bkValidLL(+p.lat, +p.lng)) return;
    const z = Number.isFinite(+p.elev) && p.elev !== null ? Math.round(p.elev * 10) / 10 : 0;
    out.push('<Placemark>',
      `<name>${bkEsc(p.name)}</name>`,
      `<description>${bkEsc(p.note || '')}</description>`,
      `<Style><IconStyle><color>${bkKmlColor(p.color, 'ff')}</color><Icon><href>http://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href></Icon></IconStyle></Style>`,
      `<ExtendedData>${data('kind', 'poi')}${data('color', bkColor(p.color, '#f59e0b'))}</ExtendedData>`,
      `<Point><coordinates>${bkFix(p.lng)},${bkFix(p.lat)},${z}</coordinates></Point>`,
      '</Placemark>');
  });
  out.push('</Document>', '</kml>');
  return out.join('\n');
}

function buildGPX(saved, pois) {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Medidor de Terrenos" xmlns="http://www.topografix.com/GPX/1/1" xmlns:md="https://anzgabriel-cloud.github.io/medidor">',
    `<metadata><name>Medidor de Terrenos</name><time>${new Date().toISOString()}</time></metadata>`];
  pois.forEach(p => {
    if (!bkValidLL(+p.lat, +p.lng)) return;
    out.push(`<wpt lat="${bkFix(p.lat)}" lon="${bkFix(p.lng)}">` +
      (Number.isFinite(+p.elev) && p.elev !== null ? `<ele>${Math.round(p.elev * 10) / 10}</ele>` : '') +
      `<name>${bkEsc(p.name)}</name>` +
      (p.note ? `<desc>${bkEsc(p.note)}</desc>` : '') +
      `<extensions><md:color>${bkColor(p.color, '#f59e0b')}</md:color></extensions></wpt>`);
  });
  saved.forEach(m => {
    const poly = bkIsPoly(m);
    const pts = m.points.slice();
    if (poly) pts.push(pts[0]);
    out.push('<trk>',
      `<name>${bkEsc(m.name)}</name>`,
      `<desc>${bkEsc(m.date || '')}</desc>`,
      `<type>${poly ? 'polygon' : 'line'}</type>`,
      `<extensions><md:color>${bkColor(m.color, '#00ff66')}</md:color></extensions>`,
      '<trkseg>',
      ...pts.map(p => `<trkpt lat="${bkFix(p.lat)}" lon="${bkFix(p.lng)}"/>`),
      '</trkseg>', '</trk>');
  });
  out.push('</gpx>');
  return out.join('\n');
}

/** Arma el archivo de respaldo: { text, mime, ext } */
function buildBackup(fmt, saved, pois) {
  const f = BACKUP_FORMATS[fmt] || BACKUP_FORMATS.geojson;
  const text = fmt === 'kml' ? buildKML(saved, pois) : fmt === 'gpx' ? buildGPX(saved, pois) : buildGeoJSON(saved, pois);
  return { text, mime: f.mime, ext: f.ext };
}

// ---------- importación ----------
// Cada lector devuelve { measures, pois, holes, invalid }:
//   holes = polígonos con huecos (no soportados) · invalid = geometrías sin puntos válidos o de tipo no soportado
function bkNewModel() { return { measures: [], pois: [], holes: 0, invalid: 0 }; }

function bkAddMeasure(model, { name, color, date, coords, poly, suffix }) {
  // coords: [[lng, lat], ...]
  let c = (coords || []).filter(x => Array.isArray(x) && bkValidLL(+x[1], +x[0])).map(x => [+x[0], +x[1]]);
  if (poly && c.length > 1 && c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1]) c = c.slice(0, -1);
  if (c.length < (poly ? 3 : 2)) { model.invalid++; return; }
  model.measures.push({
    name: String(name || 'Importado') + (suffix || ''),
    mode: poly ? 'polygon' : 'line',
    color: bkColor(color, '#00ff66'),
    date: String(date || bkToday()).replace(/[<>&"']/g, '').slice(0, 40),
    points: c.map(x => ({ lat: x[1], lng: x[0] }))
  });
}
function bkAddPoi(model, { name, note, color, lat, lng, suffix }) {
  if (!bkValidLL(+lat, +lng)) { model.invalid++; return; }
  model.pois.push({ name: String(name || 'POI importado') + (suffix || ''), note: String(note || ''), color: bkColor(color, '#f59e0b'), lat: +lat, lng: +lng });
}

function parseGeoJSON(text) {
  const json = JSON.parse(text);
  const features = json.type === 'FeatureCollection' ? (json.features || []) : (json.type === 'Feature' ? [json] : []);
  if (!features.length) throw new Error('Sin features');
  const model = bkNewModel();
  features.forEach(f => {
    if (!f.geometry || !f.geometry.coordinates) { model.invalid++; return; }
    const t = f.geometry.type, g = f.geometry.coordinates, p = f.properties || {};
    const base = { name: p.name, color: p.color, date: typeof p.date === 'string' ? p.date : null };
    const multi = (arr, fn) => (Array.isArray(arr) ? arr : []).forEach((x, i) => fn(x, ` (${i + 1})`));
    if (t === 'Point') bkAddPoi(model, { name: p.name, note: p.note, color: p.color, lat: g[1], lng: g[0] });
    else if (t === 'MultiPoint') multi(g, (c, s) => bkAddPoi(model, { name: p.name, note: p.note, color: p.color, lat: c && c[1], lng: c && c[0], suffix: s }));
    else if (t === 'LineString') bkAddMeasure(model, { ...base, coords: g, poly: false });
    else if (t === 'MultiLineString') multi(g, (l, s) => bkAddMeasure(model, { ...base, coords: l, poly: false, suffix: s }));
    else if (t === 'Polygon') { if (g.length === 1) bkAddMeasure(model, { ...base, coords: g[0], poly: true }); else model.holes++; }
    else if (t === 'MultiPolygon') multi(g, (poly, s) => { if (poly.length === 1) bkAddMeasure(model, { ...base, coords: poly[0], poly: true, suffix: s }); else model.holes++; });
    else model.invalid++;
  });
  return model;
}

const bkParseXml = (text) => {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML inválido');
  return doc;
};
const bkKids = (el, name) => Array.from(el.getElementsByTagNameNS('*', name));
const bkChild = (el, name) => Array.from(el.children).find(c => c.localName === name) || null;
const bkChildText = (el, name) => { const c = bkChild(el, name); return c ? c.textContent.trim() : ''; };
const bkPlain = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);   // KML trae HTML en las descripciones
const bkCoords = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).map(t => t.split(',').map(Number)).filter(a => a.length >= 2);

function parseKML(text) {
  const doc = bkParseXml(text);
  const placemarks = bkKids(doc, 'Placemark');
  if (!placemarks.length) throw new Error('Sin Placemark');
  const model = bkNewModel();
  // Estilos compartidos (Google Earth los define aparte y los referencia con styleUrl)
  const styleColor = (s) => {
    for (const tag of ['LineStyle', 'PolyStyle', 'IconStyle']) {
      const el = bkKids(s, tag)[0];
      const c = el && bkFromKmlColor(bkChildText(el, 'color'));
      if (c) return c;
    }
    return null;
  };
  const styles = {};
  bkKids(doc, 'Style').forEach(s => { const id = s.getAttribute('id'); const c = id && styleColor(s); if (c) styles['#' + id] = c; });
  bkKids(doc, 'StyleMap').forEach(sm => {
    const id = sm.getAttribute('id');
    bkKids(sm, 'Pair').forEach(pr => { if (bkChildText(pr, 'key') === 'normal' && id && styles[bkChildText(pr, 'styleUrl')]) styles['#' + id] = styles[bkChildText(pr, 'styleUrl')]; });
  });
  placemarks.forEach(pm => {
    const ext = {};
    bkKids(pm, 'Data').forEach(d => { ext[d.getAttribute('name')] = bkChildText(d, 'value'); });
    const inline = bkChild(pm, 'Style');
    const color = bkHex(ext.color) ? ext.color : ((inline && styleColor(inline)) || styles[bkChildText(pm, 'styleUrl')] || null);
    const name = bkChildText(pm, 'name');
    const desc = bkPlain(bkChildText(pm, 'description'));
    const date = ext.date || null;
    let found = 0;
    const points = bkKids(pm, 'Point'), lines = bkKids(pm, 'LineString'), polys = bkKids(pm, 'Polygon');
    const total = points.length + lines.length + polys.length;
    const sfx = (i) => total > 1 ? ` (${i})` : '';
    let n = 0;
    points.forEach(pt => {
      const c = bkCoords(bkChildText(pt, 'coordinates'))[0];
      n++; found++;
      bkAddPoi(model, { name, note: desc, color, lat: c && c[1], lng: c && c[0], suffix: sfx(n) });
    });
    lines.forEach(ln => { n++; found++; bkAddMeasure(model, { name, color, date, coords: bkCoords(bkChildText(ln, 'coordinates')), poly: false, suffix: sfx(n) }); });
    polys.forEach(pg => {
      n++; found++;
      if (bkKids(pg, 'innerBoundaryIs').length) { model.holes++; return; }
      const outer = bkKids(pg, 'outerBoundaryIs')[0];
      const cs = outer ? bkKids(outer, 'coordinates')[0] : null;
      bkAddMeasure(model, { name, color, date, coords: bkCoords(cs ? cs.textContent : ''), poly: true, suffix: sfx(n) });
    });
    if (!found) model.invalid++;   // p. ej. gx:Track u otros tipos no soportados
  });
  return model;
}

function parseGPX(text) {
  const doc = bkParseXml(text);
  if (doc.documentElement.localName !== 'gpx') throw new Error('No es GPX');
  const model = bkNewModel();
  const colorOf = (el) => { const c = bkKids(el, 'color')[0]; return c ? c.textContent.trim() : null; };
  const pts = (seg, tag) => bkKids(seg, tag).map(p => [+p.getAttribute('lon'), +p.getAttribute('lat')]);
  bkKids(doc, 'wpt').forEach(w => bkAddPoi(model, {
    name: bkChildText(w, 'name'), note: bkPlain(bkChildText(w, 'desc')), color: colorOf(w),
    lat: +w.getAttribute('lat'), lng: +w.getAttribute('lon')
  }));
  bkKids(doc, 'rte').forEach(r => bkAddMeasure(model, { name: bkChildText(r, 'name'), color: colorOf(r), coords: pts(r, 'rtept'), poly: false }));
  bkKids(doc, 'trk').forEach(t => {
    const segs = bkKids(t, 'trkseg');
    const poly = bkChildText(t, 'type') === 'polygon';
    const desc = bkChildText(t, 'desc');
    const date = /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(desc) ? desc : null;   // la app guarda la fecha en desc
    segs.forEach((s, i) => bkAddMeasure(model, {
      name: bkChildText(t, 'name'), color: colorOf(t), date, coords: pts(s, 'trkpt'), poly,
      suffix: segs.length > 1 ? ` (${i + 1})` : ''
    }));
    if (!segs.length) model.invalid++;
  });
  if (!model.measures.length && !model.pois.length && !model.invalid) throw new Error('Sin datos');
  return model;
}

/** Detecta el formato por extensión y, si no alcanza, por el contenido */
function detectBackupFormat(filename, text) {
  const ext = (String(filename || '').split('.').pop() || '').toLowerCase();
  if (ext === 'kml') return 'kml';
  if (ext === 'gpx') return 'gpx';
  if (ext === 'geojson' || ext === 'json') return 'geojson';
  const head = String(text || '').slice(0, 600).trimStart();
  if (head.startsWith('{')) return 'geojson';
  if (/<kml[\s>]/i.test(head)) return 'kml';
  if (/<gpx[\s>]/i.test(head)) return 'gpx';
  return null;
}
function parseBackup(fmt, text) {
  if (fmt === 'kml') return parseKML(text);
  if (fmt === 'gpx') return parseGPX(text);
  if (fmt === 'geojson') return parseGeoJSON(text);
  throw new Error('Formato no reconocido');
}
