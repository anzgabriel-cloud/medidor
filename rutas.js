/* Ruta a mano alzada: croquis / guía visual para seguir con el punto azul del GPS (no es una medición de precisión).
   Un dedo dibuja, dos dedos mueven y hacen zoom. Cada apoyar-y-levantar es un "tramo"; cada tramo nuevo se une
   (imán) al final del anterior, así la ruta queda continua hasta [Guardar]. Se guarda aparte ('medidor_rutas'),
   se ve en Guardados > Rutas. */
(function () {
  'use strict';
  var KEY = 'medidor_rutas', DKEY = 'medidor_ruta_borrador';
  var $ = function (id) { return document.getElementById(id); };
  var body = document.body;
  var ui = !!$('modeFreeBtn') && !!$('freeSaveBtn');

  var active = false, drawing = false;   // active: modo ruta abierto; drawing: sesión de dibujo iniciada con [+]
  var strokes = [], redo = [];          // tramos: cada uno es [[lat,lng],...] (el primero ya incluye el punto de unión)
  var draftLine = null, liveLine = null, endMark = null, startMark = null;
  var saved = load(), savedLayers = {};
  var pointers = {}, nPtr = 0, cur = null, multi = false;   // cur: { px:[{x,y}], anchor:[lat,lng]|null }
  var wasDragging = false, wasDbl = false;
  strokes = loadDraft();

  function load() { try { var a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) {} }
  function loadDraft() {
    try {
      var a = JSON.parse(localStorage.getItem(DKEY) || '[]');
      if (!Array.isArray(a)) return [];
      return a.filter(function (s) { return Array.isArray(s) && s.length >= 2 && s.every(function (p) { return Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]); }); });
    } catch (e) { return []; }
  }
  function persistDraft() {
    try { if (strokes.length) localStorage.setItem(DKEY, JSON.stringify(strokes)); else localStorage.removeItem(DKEY); } catch (e) {}
  }
  function getMap() { try { return (typeof map !== 'undefined' && map && map.getContainer) ? map : null; } catch (e) { return null; } }
  function safeColor(c) { return /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#00ff66'; }
  function curColor() { try { return safeColor(themeColor); } catch (e) { return '#00ff66'; } }
  function fmtKm(m) { return Math.round(m) >= 1000 ? (Math.round(m / 10) / 100).toString().replace('.', ',') + ' km' : Math.round(m) + ' m'; }
  function allPts() { var r = []; strokes.forEach(function (s) { r = r.concat(s); }); return r; }
  function dist(pts) {
    var m = getMap(), d = 0; if (!m) return 0;
    for (var i = 1; i < pts.length; i++) d += m.distance(pts[i - 1], pts[i]);
    return d;
  }

  // --- Simplificación Ramer-Douglas-Peucker en píxeles ---
  function rdp(p, eps) {
    if (p.length < 3) return p;
    var keep = new Array(p.length).fill(false); keep[0] = keep[p.length - 1] = true;
    var st = [[0, p.length - 1]];
    while (st.length) {
      var se = st.pop(), a = se[0], b = se[1], mx = 0, ix = -1;
      var A = p[a], B = p[b], dx = B.x - A.x, dy = B.y - A.y, L = dx * dx + dy * dy;
      for (var i = a + 1; i < b; i++) {
        var t = L ? Math.max(0, Math.min(1, ((p[i].x - A.x) * dx + (p[i].y - A.y) * dy) / L)) : 0;
        var ex = A.x + t * dx - p[i].x, ey = A.y + t * dy - p[i].y, d = ex * ex + ey * ey;
        if (d > mx) { mx = d; ix = i; }
      }
      if (mx > eps * eps && ix > 0) { keep[ix] = true; st.push([a, ix], [ix, b]); }
    }
    return p.filter(function (_, i) { return keep[i]; });
  }

  // --- Dibujo ---
  var dash = '9,6';
  function removeDraftLayers() {
    var m = getMap(); if (!m) return;
    [draftLine, liveLine, endMark, startMark].forEach(function (l) { if (l) m.removeLayer(l); });
    draftLine = liveLine = endMark = startMark = null;
  }
  function drawDraft() {
    persistDraft();
    var m = getMap(); if (!m || !ui) return;
    var col = curColor(), pts = allPts();
    if (!draftLine) draftLine = L.polyline(pts, { color: col, weight: 4, opacity: 0.95, dashArray: dash, lineCap: 'round', interactive: false }).addTo(m);
    else draftLine.setLatLngs(pts).setStyle({ color: col });
    if (endMark) { m.removeLayer(endMark); endMark = null; }
    if (startMark) { m.removeLayer(startMark); startMark = null; }
    if (pts.length) {
      startMark = L.circleMarker(pts[0], { radius: 5, color: '#fff', weight: 2, fillColor: col, fillOpacity: 1, interactive: false }).addTo(m);
      endMark = L.circleMarker(pts[pts.length - 1], { radius: 8, color: '#fff', weight: 3, fillColor: col, fillOpacity: 0.55, interactive: false }).addTo(m);
    }
    syncUI();
  }
  function syncUI() {
    var pts = allPts(), n = pts.length;
    function en(id, on) { var b = $(id); if (b) { b.disabled = !on; b.style.opacity = on ? '' : '.35'; } }
    en('freeUndoBtn', strokes.length > 0); en('freeRedoBtn', redo.length > 0);
    en('freeSaveBtn', n >= 2); en('freeClearBtn', strokes.length > 0 || redo.length > 0);
    updateNum(n >= 2 ? dist(pts) : 0);
  }
  function updateNum(d) {
    var el = $('freeNum'); if (!el) return;
    var col = curColor();
    el.style.textShadow = '0 0 6px ' + col + ', 0 0 14px ' + col;
    el.classList.toggle('on', active && d > 0);
    $('freeNumV').textContent = '≈ ' + fmtKm(d);
  }
  function renderSaved() {
    var m = getMap(); if (!m || !ui) return;
    Object.keys(savedLayers).forEach(function (k) { m.removeLayer(savedLayers[k]); });
    savedLayers = {};
    saved.forEach(function (r) {
      if (r.hidden) return;
      var line = L.polyline(r.pts, { color: safeColor(r.color), weight: 4, opacity: 0.9, dashArray: dash, lineCap: 'round', interactive: false });
      // trazo ancho e invisible: facilita tocar la ruta para consultarla
      var hit = L.polyline(r.pts, { color: '#000', weight: 26, opacity: 0.01, interactive: true });
      hit.on('click', function (ev) { selectRoute(r, ev); });
      savedLayers[r.id] = L.layerGroup([line, hit]).addTo(m);
    });
    var n = $('fmFreeN'); if (n) n.textContent = String(saved.length);
  }
  // --- Consulta: tocar la ruta en Modo vista abre la tarjeta con datos y menú ⋯ ---
  var hlLayer = null;
  function clearHl() { var m = getMap(); if (hlLayer && m) m.removeLayer(hlLayer); hlLayer = null; }
  function canSelect() {
    try { return typeof appView !== 'undefined' && appView === 'ver' && !(typeof poiMode !== 'undefined' && poiMode) && !!window.MedidorConsulta; } catch (e) { return false; }
  }
  function selectRoute(rt, ev) {
    if (!canSelect()) return;
    L.DomEvent.stopPropagation(ev);
    var m = getMap(); if (!m) return;
    var nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
    var pts = rt.pts, a = L.latLng(pts[0][0], pts[0][1]), b = L.latLng(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    var total = rt.dist || dist(pts), straight = m.distance(a, b);
    var T = lenMain(total), S = lenMain(straight);
    var brg = trueBearing(a, b);
    var d = rt.ts ? new Date(rt.ts).toLocaleDateString('es-AR') : (rt.date || '');
    clearHl();
    hlLayer = L.polyline(pts, { color: '#fff', weight: 9, opacity: 0.5, interactive: false }).addTo(m);
    window.MedidorConsulta.open({
      color: rt.color, title: 'Ruta a mano alzada', meta: pts.length + ' puntos · ' + d + ' · distancia aproximada',
      metrics: [[{ label: 'Distancia', value: '≈ ' + nf.format(T.v), unit: T.u, sub: lenSub(total), cls: 'text-violet-300' },
                 { label: 'Recta inicio-fin', value: nf.format(S.v), unit: S.u, sub: straight > 1 ? brg0(brg) + '° V · ' + bearingCardinal(brg) : lenSub(straight) }]],
      extra: 'Inicio: ' + fmtCoord(a.lat, a.lng) + '   Fin: ' + fmtCoord(b.lat, b.lng),
      rows: [
        { icon: 'crosshair', label: 'Ir', cls: 'text-slate-200', run: function () { try { m.fitBounds(L.latLngBounds(pts), { padding: [30, 30] }); } catch (e) {} } },
        { icon: 'copy', label: 'Copiar coordenadas', cls: 'text-sky-300', run: function () { copyToClipboard(pts.map(function (p) { return p[0].toFixed(6) + ', ' + p[1].toFixed(6); }).join('\n'), null); } },
        { icon: 'eye-off', label: 'Ocultar', cls: 'text-slate-200', run: function () { rt.hidden = true; persist(); renderSaved(); window.MedidorConsulta.close(); } },
        { icon: 'trash-2', label: 'Eliminar', cls: 'text-red-400', run: function () {
          confirmToast({ title: '¿Eliminar esta ruta de ≈ ' + fmtKm(total) + '?', message: 'No se puede deshacer.', confirmLabel: 'Eliminar', danger: true }).then(function (ok) {
            if (!ok) return;
            saved = saved.filter(function (x) { return x.id !== rt.id; }); persist(); renderSaved(); window.MedidorConsulta.close();
          });
        } }
      ],
      onClose: clearHl
    });
  }
  var tries = 0;
  (function waitMap() {
    if (getMap()) {
      renderSaved();
      if (ui && strokes.length) {
        drawDraft();
        if (typeof toast === 'function') toast({ type: 'info', title: 'Ruta sin guardar recuperada', message: '≈ ' + fmtKm(dist(allPts())) + '. Entrá a la herramienta de ruta para seguir o guardarla.', duration: 4500 });
      }
    } else if (tries++ < 60) setTimeout(waitMap, 250);
  })();

  // API de datos (copias de seguridad y "Borrar todo")
  var sig = function (x) { var p = x.pts; return p.length + ':' + p[0][0] + ',' + p[0][1] + ':' + p[p.length - 1][0] + ',' + p[p.length - 1][1]; };
  window.MedidorRutas = {
    list: function () { return saved.map(function (r) { return { pts: r.pts, color: r.color, date: r.date || new Date(r.ts || Date.now()).toLocaleDateString('es-AR'), dist: r.dist || 0 }; }); },
    add: function (items) {
      var n = 0, d = 0, have = {}; saved.forEach(function (r) { have[sig(r)] = 1; });
      items.forEach(function (it) {
        var pts = it.pts.map(function (p) { return [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]; });
        var x = { id: 'g' + Date.now().toString(36) + Math.random().toString(16).slice(2, 6), pts: pts, color: safeColor(it.color), dist: 0, hidden: false, ts: Date.now(), date: it.date || null };
        if (have[sig(x)]) { d++; return; }
        have[sig(x)] = 1;
        var m = getMap(), t = 0; for (var i = 1; i < pts.length; i++) t += (m ? m.distance(pts[i - 1], pts[i]) : 0);
        x.dist = it.dist || t; saved.push(x); n++;
      });
      if (n) { persist(); renderSaved(); }
      return { added: n, dupes: d };
    },
    clear: function () { saved = []; strokes = []; redo = []; persist(); renderSaved(); drawDraft(); }
  };
  if (!ui) return;


  // --- Gestos: un dedo dibuja, dos dedos mueven / zoom (Leaflet) ---
  function inMap(e) { var t = e.target; return t && t.closest && t.closest('#map') && !t.closest('.leaflet-control'); }
  function pt(e) { var m = getMap(); var p = m.mouseEventToContainerPoint(e); return { x: p.x, y: p.y }; }
  function lastEnd() { var p = allPts(); return p.length ? p[p.length - 1] : null; }
  function liveRender() {
    var m = getMap(); if (!m || !cur) return;
    var simp = rdp(cur.px, 1.5);
    var ll = simp.map(function (p) { var c = m.containerPointToLatLng(L.point(p.x, p.y)); return [c.lat, c.lng]; });
    if (cur.anchor) ll.unshift(cur.anchor);
    if (!liveLine) liveLine = L.polyline(ll, { color: curColor(), weight: 4, opacity: 0.95, dashArray: dash, lineCap: 'round', interactive: false }).addTo(m);
    else liveLine.setLatLngs(ll).setStyle({ color: curColor() });
    var base = allPts(); updateNum(dist(base.concat(cur.anchor ? ll.slice(1) : ll)));
  }
  function finishStroke(commit) {
    var m = getMap(); var c = cur; cur = null;
    if (liveLine && m) { m.removeLayer(liveLine); liveLine = null; }
    if (!c || !m) { drawDraft(); return; }
    var len = 0; for (var i = 1; i < c.px.length; i++) len += Math.hypot(c.px[i].x - c.px[i - 1].x, c.px[i].y - c.px[i - 1].y);
    if (!commit || len < 8) { drawDraft(); return; }       // un toque suelto no hace nada
    var simp = rdp(c.px, 2.5);
    var ll = simp.map(function (p) { var q = m.containerPointToLatLng(L.point(p.x, p.y)); return [Math.round(q.lat * 1e6) / 1e6, Math.round(q.lng * 1e6) / 1e6]; });
    if (c.anchor) ll.unshift(c.anchor);                     // imán: el tramo nuevo nace exacto en el final del anterior
    if (ll.length >= 2) { strokes.push(ll); redo = []; }
    drawDraft();
  }
  function onDown(e) {
    if (!active || !drawing || !inMap(e)) return;
    pointers[e.pointerId] = 1; nPtr++;
    if (nPtr > 1) {                                          // segundo dedo: es mover/zoom, se corta el trazo
      multi = true;
      if (cur) { var big = cur.px.length > 6; finishStroke(big); }
      return;
    }
    multi = false;
    var m = getMap(); if (!m) return;
    cur = { px: [pt(e)], anchor: lastEnd() };
    try { e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId); } catch (x) {}
  }
  function onMove(e) {
    if (!active || !cur || multi || !pointers[e.pointerId]) return;
    var p = pt(e), l = cur.px[cur.px.length - 1];
    if (Math.hypot(p.x - l.x, p.y - l.y) < 2) return;
    cur.px.push(p);
    if (e.cancelable) e.preventDefault();
    liveRender();
  }
  function onUp(e) {
    if (!pointers[e.pointerId]) return;
    delete pointers[e.pointerId]; nPtr = Math.max(0, nPtr - 1);
    if (!active) return;
    if (cur && !multi) finishStroke(e.type === 'pointerup');
    if (nPtr === 0) multi = false;
  }
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointermove', onMove, { capture: true, passive: false });
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('pointercancel', onUp, true);
  // El toque que cierra un trazo no debe abrir POI ni mediciones debajo
  ['click', 'dblclick'].forEach(function (t) {
    document.addEventListener(t, function (e) { if (active && drawing && inMap(e)) { e.stopPropagation(); e.preventDefault(); } }, true);
  });

  // --- Modo ---
  function forceMode() { var mc = $('mainControls'); if (mc && active && mc.getAttribute('data-mode') !== 'free') mc.setAttribute('data-mode', 'free'); }
  function enter() {
    if (typeof ensureMedir === 'function') ensureMedir();
    if (typeof isLocked !== 'undefined' && isLocked) return;
    if (typeof poiMode !== 'undefined' && poiMode && typeof exitPoiMode === 'function') exitPoiMode(false);
    if (typeof gpsWatchId !== 'undefined' && gpsWatchId !== null && typeof stopGpsTracking === 'function') stopGpsTracking();
    else if (typeof trackMode !== 'undefined' && trackMode) { trackMode = false; if (typeof setGpsBtnState === 'function') setGpsBtnState(false); if (typeof refreshTrackBar === 'function') refreshTrackBar(); }
    if (typeof setDrawingActive === 'function') setDrawingActive(false);
    var m = getMap(); if (!m) return;
    active = true;
    var off = 'w-full flex items-center gap-2 py-2 px-2 rounded-lg text-xs font-bold text-slate-300 bg-slate-800/70 border border-slate-600/50 min-h-[36px]';
    ['modePolyBtn', 'modeLineBtn', 'modeTrackBtn', 'modePoiBtn'].forEach(function (id) { var b = $(id); if (b) b.className = off; });
    $('modeFreeBtn').setAttribute('aria-pressed', 'true');
    wasDragging = m.dragging.enabled(); wasDbl = m.doubleClickZoom.enabled();
    forceMode(); drawDraft();
    setDrawing(strokes.length > 0);      // con un borrador pendiente se retoma dibujando; si no, se espera al botón [+]
  }
  // El mapa solo dibuja durante una sesión iniciada con [+] (un dedo dibuja, dos mueven); fuera de ella se mueve normal
  function setDrawing(on) {
    var m = getMap(); if (!m) return;
    if (!on && cur) finishStroke(true);
    drawing = !!on;
    if (on) { m.dragging.disable(); m.doubleClickZoom.disable(); }
    else { if (wasDragging) m.dragging.enable(); if (wasDbl) m.doubleClickZoom.enable(); }
    m.getContainer().classList.toggle('free-draw', drawing);
    var nb = $('freeNewBtn'); if (nb) { nb.setAttribute('aria-pressed', drawing ? 'true' : 'false'); nb.title = drawing ? 'Pausar el dibujo (mover el mapa con un dedo)' : 'Empezar a dibujar'; }
  }
  function exit() {
    if (!active) return;
    setDrawing(false);
    active = false;
    $('modeFreeBtn').setAttribute('aria-pressed', 'false');
    $('freeNum').classList.remove('on');
    if (typeof setMode === 'function') { try { setMode(mode); } catch (e) {} }
    else if (typeof updateModeTheme === 'function') updateModeTheme();
  }
  $('modeFreeBtn').onclick = function () { if (!active) enter(); };
  // Otra herramienta o volver a Ver: se sale del modo (el borrador sin guardar se conserva en el mapa para retomarlo)
  ['modePolyBtn', 'modeLineBtn', 'modeTrackBtn', 'modePoiBtn', 'modeRingBtn', 'viewVerBtn'].forEach(function (id) {
    var b = $(id); if (b) b.addEventListener('click', exit, true);
  });
  var mc = $('mainControls');
  if (mc) new MutationObserver(function () { forceMode(); }).observe(mc, { attributes: true, attributeFilter: ['data-mode'] });

  // --- Acciones ---
  $('freeNewBtn').onclick = function () { if (active) setDrawing(!drawing); };
  $('freeUndoBtn').onclick = function () { if (!strokes.length) return; redo.push(strokes.pop()); drawDraft(); };
  $('freeRedoBtn').onclick = function () { if (!redo.length) return; strokes.push(redo.pop()); drawDraft(); };
  $('freeClearBtn').onclick = function () {
    if (!strokes.length && !redo.length) return;
    if (allPts().length > 20 && !window.confirm('¿Descartar toda la ruta sin guardar?')) return;
    strokes = []; redo = []; drawDraft(); setDrawing(false);
  };
  $('freeSaveBtn').onclick = function () {
    var pts = allPts(); if (pts.length < 2) return;
    var d = dist(pts);
    saved.push({ id: 'g' + Date.now().toString(36), pts: pts, color: curColor(), dist: d, hidden: false, ts: Date.now() });
    persist(); strokes = []; redo = []; renderSaved(); drawDraft(); setDrawing(false);   // fin de la sesión
    if (typeof toast === 'function') toast({ type: 'success', title: 'Ruta guardada', message: '≈ ' + fmtKm(d) + '. La ves en Guardados > Rutas.', duration: 2500 });
  };
  var pal = $('colorPalette');
  if (pal) pal.addEventListener('click', function () { if (active) setTimeout(drawDraft, 0); });

  // --- Lista de rutas guardadas ---
  function closeList() { $('freeList').classList.add('hidden'); }
  function renderList() {
    var box = $('freeItems'); box.innerHTML = '';
    if (!saved.length) { var p = document.createElement('p'); p.className = 'ring-empty'; p.textContent = 'Todavía no hay rutas guardadas.'; box.appendChild(p); }
    saved.forEach(function (r) {
      var row = document.createElement('div'); row.className = 'ring-row';
      var dot = document.createElement('span'); dot.className = 'ring-dot'; dot.style.background = safeColor(r.color); if (r.hidden) dot.style.opacity = '.3';
      var nm = document.createElement('div'); nm.className = 'ring-nm'; nm.textContent = 'Ruta ≈ ' + fmtKm(r.dist || 0);
      var sm = document.createElement('small'); sm.textContent = new Date(r.ts).toLocaleDateString('es-AR') + (r.hidden ? ' · oculta' : ''); nm.appendChild(sm);
      var go = document.createElement('button'); go.type = 'button'; go.className = 'ring-go'; go.textContent = 'Ir'; go.setAttribute('aria-label', 'Ir a la ruta');
      go.onclick = function () {
        var m = getMap(); if (!m) return;
        if (r.hidden) { r.hidden = false; persist(); renderSaved(); }
        try { m.fitBounds(L.latLngBounds(r.pts), { padding: [30, 30] }); } catch (e) {}
        closeList();
      };
      var eye = document.createElement('button'); eye.type = 'button'; eye.className = 'ring-ic'; eye.textContent = r.hidden ? '○' : '●'; eye.setAttribute('aria-label', r.hidden ? 'Mostrar' : 'Ocultar');
      eye.onclick = function () { r.hidden = !r.hidden; persist(); renderSaved(); renderList(); };
      var del = document.createElement('button'); del.type = 'button'; del.className = 'ring-ic'; del.textContent = '✕'; del.setAttribute('aria-label', 'Borrar ruta');
      del.onclick = function () {
        if (!window.confirm('¿Borrar esta ruta de ' + fmtKm(r.dist || 0) + '?')) return;
        saved = saved.filter(function (x) { return x.id !== r.id; }); persist(); renderSaved(); renderList();
      };
      row.appendChild(dot); row.appendChild(nm); row.appendChild(go); row.appendChild(eye); row.appendChild(del);
      box.appendChild(row);
    });
  }
  var fm = $('fmFree');
  if (fm) fm.onclick = function () {
    $('folderMenu').classList.add('hidden'); $('tpFolder').setAttribute('aria-expanded', 'false');
    body.classList.remove('pop-open');
    var rl = $('ringList'); if (rl) rl.classList.add('hidden');
    renderList(); $('freeList').classList.remove('hidden');
  };
  $('freeListClose').onclick = closeList;
  document.addEventListener('pointerdown', function (e) {
    var l = $('freeList');
    if (l && !l.classList.contains('hidden') && !e.target.closest('#freeList, #fmFree')) closeList();
  }, true);
  ['tpSearch', 'tpFolder', 'tpMeasure'].forEach(function (id) { var b = $(id); if (b) b.addEventListener('click', closeList, true); });
  var n0 = $('fmFreeN'); if (n0) n0.textContent = String(saved.length);
  syncUI();
})();
