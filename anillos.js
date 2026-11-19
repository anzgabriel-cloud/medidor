/* Anillos por radio: círculo alrededor de un punto (1 m a 100 km o más), solo visual.
   Flujo: herramienta anillo → mira en el centro del mapa → [+] deja caer el anillo → se escribe el radio → [guardar].
   Se guarda aparte (localStorage 'medidor_anillos'); la lista está en Guardados > Anillos. */
(function () {
  'use strict';
  if (/[?&]clasica/.test(location.search)) return;
  var KEY = 'medidor_anillos';
  var $ = function (id) { return document.getElementById(id); };
  var body = document.body;
  if (!$('modeRingBtn') || !$('ringNewBtn')) return;

  var ringMode = false, aiming = false;
  var draft = null;            // { lat, lng, r, color } mientras no se guarda
  var draftLayer = null;       // L.layerGroup del borrador
  var savedLayers = {};        // id -> L.layerGroup
  var rings = load();
  var unit = 'km';

  function load() { try { var a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(rings)); } catch (e) {} }
  function getMap() { try { return (typeof map !== 'undefined' && map && map.getContainer) ? map : null; } catch (e) { return null; } }
  function fmt(r) {
    if (r >= 1000) { var k = r / 1000; return (k >= 10 ? Math.round(k * 10) / 10 : Math.round(k * 100) / 100).toString().replace('.', ',') + ' km'; }
    return Math.round(r).toString() + ' m';
  }
  function safeColor(c) { return /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#00ff66'; }
  function curColor() { try { return safeColor(themeColor); } catch (e) { return '#00ff66'; } }

  // --- Dibujo: círculo + radio hacia el este + etiqueta ---
  function build(m, a, interactive) {
    var g = L.layerGroup();
    var c = L.latLng(a.lat, a.lng), col = safeColor(a.color);
    L.circle(c, { radius: a.r, color: col, weight: 3, fillColor: col, fillOpacity: 0.1, interactive: false }).addTo(g);
    var dLng = a.r / (111320 * Math.max(0.05, Math.cos(a.lat * Math.PI / 180)));
    var e = L.latLng(a.lat, a.lng + dLng);
    L.polyline([c, e], { color: col, weight: 2, dashArray: '6,5', interactive: false }).addTo(g);
    L.circleMarker(c, { radius: 5, color: '#fff', weight: 2, fillColor: col, fillOpacity: 1, interactive: false }).addTo(g);
    var mid = L.latLng(a.lat, a.lng + dLng / 2);
    L.marker(mid, { interactive: false, keyboard: false, icon: L.divIcon({
      className: 'ring-label', html: '<span style="color:' + col + '">' + fmt(a.r) + '</span>', iconSize: [0, 0]
    }) }).addTo(g);
    g.addTo(m);
    return g;
  }
  function clearDraftLayer() { var m = getMap(); if (draftLayer && m) m.removeLayer(draftLayer); draftLayer = null; }
  function drawDraft() {
    var m = getMap(); if (!m) return;
    clearDraftLayer();
    if (draft) draftLayer = build(m, draft);
  }
  function renderSaved() {
    var m = getMap(); if (!m) return;
    Object.keys(savedLayers).forEach(function (k) { m.removeLayer(savedLayers[k]); });
    savedLayers = {};
    rings.forEach(function (a) { if (!a.hidden) savedLayers[a.id] = build(m, a); });
    var n = $('fmRingN'); if (n) n.textContent = String(rings.length);
  }
  var tries = 0;
  (function waitMap() { if (getMap()) { renderSaved(); } else if (tries++ < 60) setTimeout(waitMap, 250); })();

  // --- Estados del modo ---
  function setCross(on) { aiming = on; var c = $('poiCrosshair'); if (c) c.classList.toggle('visible', on); }
  function showRow(on) { var r = $('ringRow'); if (r) r.classList.toggle('off', !on); }
  function syncButtons() {
    var ok = !!(draft && draft.r > 0);
    var s = $('ringSaveBtn'); if (s) { s.disabled = !ok; s.style.opacity = ok ? '' : '.35'; }
    var t = $('ringClearBtn'); if (t) { t.disabled = !draft; t.style.opacity = draft ? '' : '.35'; }
    var n = $('ringNewBtn'); if (n) n.title = draft ? 'Nuevo anillo (descarta el actual)' : 'Dejar caer el anillo en la mira';
  }
  function startAiming() {
    draft = null; clearDraftLayer(); showRow(false); setCross(true); syncButtons();
  }
  function forceMode() { var mc = $('mainControls'); if (mc && ringMode && mc.getAttribute('data-mode') !== 'ring') mc.setAttribute('data-mode', 'ring'); }
  function enter() {
    if (typeof ensureMedir === 'function') ensureMedir();
    if (typeof isLocked !== 'undefined' && isLocked) return;
    if (typeof poiMode !== 'undefined' && poiMode && typeof exitPoiMode === 'function') exitPoiMode(false);
    if (typeof gpsWatchId !== 'undefined' && gpsWatchId !== null && typeof stopGpsTracking === 'function') stopGpsTracking();
    else if (typeof trackMode !== 'undefined' && trackMode) { trackMode = false; if (typeof setGpsBtnState === 'function') setGpsBtnState(false); if (typeof refreshTrackBar === 'function') refreshTrackBar(); }
    if (typeof setDrawingActive === 'function') setDrawingActive(false);   // los toques en el mapa no agregan vértices
    ringMode = true;
    var off = 'w-full flex items-center gap-2 py-2 px-2 rounded-lg text-xs font-bold text-slate-300 bg-slate-800/70 border border-slate-600/50 min-h-[36px]';
    ['modePolyBtn', 'modeLineBtn', 'modeTrackBtn', 'modePoiBtn'].forEach(function (id) { var b = $(id); if (b) b.className = off; });
    $('modeRingBtn').setAttribute('aria-pressed', 'true');
    forceMode();
    startAiming();
  }
  function exit() {
    if (!ringMode) return;
    ringMode = false; draft = null; clearDraftLayer(); setCross(false); showRow(false);
    $('modeRingBtn').setAttribute('aria-pressed', 'false');
    if (typeof setMode === 'function') { try { setMode(mode); } catch (e) {} }
    else if (typeof updateModeTheme === 'function') updateModeTheme();
  }

  $('modeRingBtn').onclick = function () { if (ringMode) return; enter(); };
  // Cualquier otra herramienta o volver a Ver cierra el modo anillo (el borrador se descarta)
  ['modePolyBtn', 'modeLineBtn', 'modeTrackBtn', 'modePoiBtn', 'modeFreeBtn', 'viewVerBtn'].forEach(function (id) {
    var b = $(id); if (b) b.addEventListener('click', exit, true);
  });
  var mc = $('mainControls');
  if (mc) new MutationObserver(function () { forceMode(); }).observe(mc, { attributes: true, attributeFilter: ['data-mode'] });

  // --- Acciones ---
  $('ringNewBtn').onclick = function () {
    if (!ringMode) return;
    if (draft || !aiming) { startAiming(); return; }   // con un anillo caído: vuelve a apuntar
    var m = getMap(); if (!m) return;
    var c = m.getCenter();
    draft = { lat: c.lat, lng: c.lng, r: 1000, color: curColor() };
    setCross(false); drawDraft(); showRow(true); syncButtons();
    var inp = $('ringRadius');
    unit = 'km'; $('ringUnit').textContent = 'km'; inp.value = '1';
    applyRadius(false);
    try { inp.focus(); inp.select(); } catch (e) {}
  };
  function parseRadius() {
    var v = parseFloat(String($('ringRadius').value).replace(',', '.'));
    if (!isFinite(v) || v <= 0) return 0;
    return unit === 'km' ? v * 1000 : v;
  }
  function applyRadius(fit) {
    if (!draft) return;
    var r = parseRadius();
    if (!r) { syncButtons(); return; }
    draft.r = Math.min(r, 2000000);
    drawDraft(); syncButtons();
    if (fit) { var m = getMap(); if (m && draftLayer) { try { m.fitBounds(L.latLng(draft.lat, draft.lng).toBounds(draft.r * 2), { padding: [30, 30], animate: true }); } catch (e) {} } }
  }
  $('ringRadius').addEventListener('input', function () { applyRadius(false); });
  $('ringRadius').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); applyRadius(true); this.blur(); } });
  $('ringApply').onclick = function () { applyRadius(true); $('ringRadius').blur(); };
  $('ringUnit').onclick = function () { unit = unit === 'km' ? 'm' : 'km'; this.textContent = unit; applyRadius(false); };
  $('ringClearBtn').onclick = function () { if (draft) startAiming(); };
  $('ringSaveBtn').onclick = function () {
    if (!draft || !(draft.r > 0)) return;
    rings.push({ id: 'r' + Date.now().toString(36), lat: draft.lat, lng: draft.lng, r: draft.r, color: draft.color, hidden: false, ts: Date.now() });
    persist(); renderSaved();
    var r = draft.r;
    startAiming();
    if (typeof toast === 'function') toast({ type: 'success', title: 'Anillo guardado', message: 'Radio ' + fmt(r) + '. Lo ves en Guardados > Anillos.', duration: 2500 });
  };
  // Cambiar el color con el anillo caído lo repinta
  var pal = $('colorPalette');
  if (pal) pal.addEventListener('click', function () {
    if (!ringMode || !draft) return;
    setTimeout(function () { draft.color = curColor(); drawDraft(); }, 0);
  });

  // --- Lista de anillos guardados ---
  function closeList() { $('ringList').classList.add('hidden'); }
  function renderList() {
    var box = $('ringItems'); box.innerHTML = '';
    if (!rings.length) { var p = document.createElement('p'); p.className = 'ring-empty'; p.textContent = 'Todavía no hay anillos guardados.'; box.appendChild(p); }
    rings.forEach(function (a) {
      var row = document.createElement('div'); row.className = 'ring-row';
      var dot = document.createElement('span'); dot.className = 'ring-dot'; dot.style.background = safeColor(a.color); if (a.hidden) dot.style.opacity = '.3';
      var nm = document.createElement('div'); nm.className = 'ring-nm'; nm.textContent = 'Radio ' + fmt(a.r);
      var sm = document.createElement('small'); sm.textContent = a.lat.toFixed(4) + ', ' + a.lng.toFixed(4) + (a.hidden ? ' · oculto' : ''); nm.appendChild(sm);
      var go = document.createElement('button'); go.type = 'button'; go.className = 'ring-go'; go.textContent = 'Ir'; go.setAttribute('aria-label', 'Ir al anillo');
      go.onclick = function () {
        var m = getMap(); if (!m) return;
        if (a.hidden) { a.hidden = false; persist(); renderSaved(); }
        try { m.fitBounds(L.latLng(a.lat, a.lng).toBounds(a.r * 2), { padding: [30, 30] }); } catch (e) {}
        closeList();
      };
      var eye = document.createElement('button'); eye.type = 'button'; eye.className = 'ring-ic'; eye.textContent = a.hidden ? '○' : '●'; eye.setAttribute('aria-label', a.hidden ? 'Mostrar' : 'Ocultar');
      eye.onclick = function () { a.hidden = !a.hidden; persist(); renderSaved(); renderList(); };
      var del = document.createElement('button'); del.type = 'button'; del.className = 'ring-ic'; del.textContent = '✕'; del.setAttribute('aria-label', 'Borrar anillo');
      del.onclick = function () {
        if (!window.confirm('¿Borrar el anillo de ' + fmt(a.r) + '?')) return;
        rings = rings.filter(function (x) { return x.id !== a.id; }); persist(); renderSaved(); renderList();
      };
      row.appendChild(dot); row.appendChild(nm); row.appendChild(go); row.appendChild(eye); row.appendChild(del);
      box.appendChild(row);
    });
  }
  var fmRing = $('fmRing');
  if (fmRing) fmRing.onclick = function () {
    $('folderMenu').classList.add('hidden'); $('tpFolder').setAttribute('aria-expanded', 'false');
    body.classList.remove('pop-open');
    var fl = $('freeList'); if (fl) fl.classList.add('hidden');
    renderList(); $('ringList').classList.remove('hidden');
  };
  $('ringListClose').onclick = closeList;
  document.addEventListener('pointerdown', function (e) {
    var l = $('ringList');
    if (l && !l.classList.contains('hidden') && !e.target.closest('#ringList, #fmRing')) closeList();
  }, true);
  // Abrir buscar / carpeta / medir cierra la lista
  ['tpSearch', 'tpFolder', 'tpMeasure'].forEach(function (id) { var b = $(id); if (b) b.addEventListener('click', closeList, true); });
  var n0 = $('fmRingN'); if (n0) n0.textContent = String(rings.length);
  syncButtons();
})();
