window.MV = window.MV || {}; window.MV.anillos = '2026.11.26-v2-84';   // versión: debe coincidir con app.js (se controla al iniciar)
/* Anillos con radio: círculo alrededor de un punto (1 m a 100 km o más), solo visual.
   Flujo: herramienta anillo → mira en el centro del mapa → [+] deja caer el anillo → se escribe el radio → [guardar].
   Se guarda aparte (localStorage 'medidor_anillos'); la lista está en Guardados > Anillos. */
(function () {
  'use strict';
  var KEY = 'medidor_anillos';
  var $ = function (id) { return document.getElementById(id); };
  var body = document.body;
  var ui = !!$('modeRingBtn') && !!$('ringNewBtn');

  var ringMode = false, aiming = false;
  var draft = null;            // { lat, lng, r, color } mientras no se guarda
  var draftLayer = null;       // L.layerGroup del borrador
  var savedLayers = {};        // id -> L.layerGroup
  var rings = load();
  var unit = 'km';
  var sessionIds = [];         // anillos guardados en esta sesión del modo (para deshacer)
  var redoStack = [];          // { kind:'draft', d } | { kind:'saved', r }

  function load() {
    try {
      var a = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(a) ? a.filter(function (x) { return x && Number.isFinite(x.lat) && Number.isFinite(x.lng) && Number.isFinite(x.r) && x.r > 0; }) : [];   // descarta registros dañados
    } catch (e) { return []; }
  }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(rings)); } catch (e) {} }
  function getMap() { try { return (typeof map !== 'undefined' && map && map.getContainer) ? map : null; } catch (e) { return null; } }
  function fmt(r) {
    if (Math.round(r) >= 1000) { var k = r / 1000; return (k >= 10 ? Math.round(k * 10) / 10 : Math.round(k * 100) / 100).toString().replace('.', ',') + ' km'; }
    return Math.round(r).toString() + ' m';
  }
  var ANGS = [90, 135, 45, 180, 0, 225, 315, 270];
  function pickAng(lat, lng) {
    var n = 0;
    rings.forEach(function (x) { if (Math.abs(x.lat - lat) < 0.0004 && Math.abs(x.lng - lng) < 0.0004) n++; });   // ~40 m: mismo centro
    return ANGS[n % ANGS.length];
  }
  function safeColor(c) { return /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#00ff66'; }
  function curColor() { try { return safeColor(themeColor); } catch (e) { return '#00ff66'; } }

  // --- Dibujo: círculo + radio hacia el este + etiqueta ---
  function build(m, a, interactive) {
    var g = L.layerGroup();
    var c = L.latLng(a.lat, a.lng), col = safeColor(a.color);
    L.circle(c, { radius: a.r, color: col, weight: 3, fill: false, interactive: false }).addTo(g);
    if (interactive) {   // borde ancho e invisible: se toca el aro (no el interior) para consultar el anillo
      var hitC = L.circle(c, { radius: a.r, fill: false, color: '#000', weight: 26, opacity: 0.01, interactive: true }).addTo(g);
      var ent = window.MedidorPick && window.MedidorPick.add({ map: m, hit: hitC, d: window.MedidorPick.ringDist(a.lat, a.lng, a.r), open: function (ev) { selectRing(a, ev); } });
      hitC.on('click', function (ev) { var t = ent ? window.MedidorPick.pick(ev, ent) : null; if (t && t !== ent) t.open(ev); else selectRing(a, ev); });
    }
    var b = (a.ang == null ? 90 : a.ang) * Math.PI / 180;   // rumbo del radio: cada anillo concéntrico gira el suyo para no pisar las etiquetas
    var e = L.latLng(a.lat + a.r * Math.cos(b) / 111320, a.lng + a.r * Math.sin(b) / (111320 * Math.max(0.05, Math.cos(a.lat * Math.PI / 180))));
    L.polyline([c, e], { color: col, weight: 2, dashArray: '6,5', interactive: false }).addTo(g);
    L.circleMarker(c, { radius: 5, color: '#fff', weight: 2, fillColor: col, fillOpacity: 1, interactive: false }).addTo(g);
    var mid = L.latLng((a.lat + e.lat) / 2, (a.lng + e.lng) / 2);
    L.marker(mid, { interactive: false, keyboard: false, icon: L.divIcon({
      className: 'ring-label', html: '<span style="border-color:' + col + '">' + fmt(a.r) + '</span>', iconSize: [0, 0]
    }) }).addTo(g);
    if (firstAtCenter(a)) {   // etiqueta del centro (una sola por centro, aunque haya anillos concéntricos)
      L.marker(c, { interactive: false, keyboard: false, icon: L.divIcon({
        className: 'ring-label ring-center', html: '<span style="border-color:' + col + '">Centro de radio</span>', iconSize: [0, 0]
      }) }).addTo(g);
    }
    g.addTo(m);
    return g;
  }
  /** ¿Es este el primer anillo visible de su centro (~40 m)? Evita repetir "Centro de radio" en anillos concéntricos */
  function firstAtCenter(a) {
    for (var i = 0; i < rings.length; i++) {
      var x = rings[i];
      if (x === a) return true;
      if (!x.hidden && Math.abs(x.lat - a.lat) < 0.0004 && Math.abs(x.lng - a.lng) < 0.0004) return false;
    }
    return true;
  }
  function clearDraftLayer() { var m = getMap(); if (draftLayer && m) m.removeLayer(draftLayer); draftLayer = null; }
  function drawDraft() {
    var m = getMap(); if (!m) return;
    clearDraftLayer();
    if (draft) draftLayer = build(m, draft);
  }
  function renderSaved() {
    var m = getMap(); if (!m || !ui) return;
    Object.keys(savedLayers).forEach(function (k) { m.removeLayer(savedLayers[k]); });
    savedLayers = {};
    rings.forEach(function (a) { if (!a.hidden) savedLayers[a.id] = build(m, a, true); });
    var n = $('fmRingN'); if (n) n.textContent = String(rings.length);
  }
  // --- Consulta: tocar el aro en Modo vista abre la tarjeta con datos y menú ⋯ ---
  var hlLayer = null;
  function clearHl() { var m = getMap(); if (hlLayer && m) m.removeLayer(hlLayer); hlLayer = null; }
  function canSelect() {
    try { return typeof appView !== 'undefined' && appView === 'ver' && !(typeof poiMode !== 'undefined' && poiMode) && !!window.MedidorConsulta; } catch (e) { return false; }
  }
  function selectRing(a, ev) {
    if (!canSelect()) return;
    if (ev) L.DomEvent.stopPropagation(ev);
    var m = getMap(); if (!m) return;
    var nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
    var r = a.r, R = lenMain(r), Di = lenMain(2 * r), Ci = lenMain(2 * Math.PI * r), area = Math.PI * r * r, A = areaMain(area);
    var d = a.ts ? new Date(a.ts).toLocaleDateString('es-AR') : '';
    var go = function () { try { m.fitBounds(L.latLng(a.lat, a.lng).toBounds(r * 2), { padding: [30, 30] }); } catch (e) {} };
    clearHl();
    hlLayer = L.circle([a.lat, a.lng], { radius: r, fill: false, color: '#fff', weight: 8, opacity: 0.55, interactive: false }).addTo(m);
    window.MedidorConsulta.open({
      kind: 'ring', color: a.color, title: 'Anillo ' + fmt(r), meta: 'Radio desde un punto · ' + d,
      metrics: [[{ label: 'Radio', value: nf.format(R.v), unit: R.u, sub: lenSub(r), cls: 'text-orange-300' }, { label: 'Diámetro', value: nf.format(Di.v), unit: Di.u, sub: lenSub(2 * r) }],
                [{ label: 'Circunferencia', value: nf.format(Ci.v), unit: Ci.u, sub: lenSub(2 * Math.PI * r) }, { label: 'Superficie', value: nf.format(A.v), unit: A.u, sub: areaSub(area), cls: 'text-emerald-400' }]],
      extra: 'Centro de radio: ' + fmtCoord(a.lat, a.lng),
      actions: [
        { icon: 'pencil', label: 'Editar', cls: 'text-slate-200', run: function () { editRing(a); } },
        { icon: 'trash-2', label: 'Borrar', cls: 'text-red-400', run: function () {
          confirmToast({ title: '¿Borrar el anillo de ' + fmt(r) + '?', message: 'No se puede deshacer.', confirmLabel: 'Borrar', danger: true }).then(function (ok) {
            if (!ok) return;
            rings = rings.filter(function (x) { return x.id !== a.id; }); persist(); renderSaved(); window.MedidorConsulta.close();
          });
        } }
      ],
      onClose: clearHl
    });
  }
  // Editar: radio (m o km) y color; el anillo no lleva nombre
  var RCOLORS = ['#00ff66', '#ffe600', '#ff6600', '#48cae4', '#3b82f6', '#ff00a0', '#e10600', '#ffffff', '#9ca3af', '#111827', '#8b5a2b'];
  function editRing(a) {
    var modal = $('ringEditModal'), inp = $('ringEditRadius'), ub = $('ringEditUnit'), box = $('ringEditColors'), err = $('ringEditErr');
    if (!modal || !inp || !ub || !box) return;
    var col = safeColor(a.color), u = a.r >= 1000 ? 'km' : 'm';
    function showR() { var v = u === 'km' ? a.r / 1000 : a.r; inp.value = String(Math.round(v * 1000) / 1000).replace('.', ','); ub.textContent = u; }
    showR(); err.classList.add('hidden');
    ub.onclick = function () {
      var v = parseFloat(String(inp.value).replace(',', '.'));
      if (isFinite(v) && v > 0) { var meters = u === 'km' ? v * 1000 : v; u = u === 'km' ? 'm' : 'km'; var nv = u === 'km' ? meters / 1000 : meters; inp.value = String(Math.round(nv * 1000) / 1000).replace('.', ','); }
      else u = u === 'km' ? 'm' : 'km';
      ub.textContent = u;
    };
    function paint() { Array.prototype.forEach.call(box.children, function (b) { b.classList.toggle('active', b.getAttribute('data-color').toLowerCase() === col.toLowerCase()); }); }
    box.innerHTML = '';
    RCOLORS.forEach(function (c) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'color-swatch'; b.style.background = c; b.setAttribute('data-color', c); b.setAttribute('aria-label', 'Color ' + c);
      b.onclick = function () { col = c; paint(); };
      box.appendChild(b);
    });
    paint();
    function close() { modal.classList.add('hidden'); }
    $('ringEditCancel').onclick = close;
    $('ringEditOk').onclick = function () {
      var v = parseFloat(String(inp.value).replace(',', '.'));
      var meters = isFinite(v) ? (u === 'km' ? v * 1000 : v) : 0;
      if (!(meters > 0) || meters > 2000000) { err.classList.remove('hidden'); return; }
      a.r = meters; a.color = col;
      persist(); renderSaved(); close();
      selectRing(a);
    };
    modal.classList.remove('hidden');
    try { inp.focus(); inp.select(); } catch (e) {}
  }
  var sig = function (x) { return x.lat.toFixed(6) + ',' + x.lng.toFixed(6) + ',' + Math.round(x.r); };
  window.MedidorAnillos = {
    busy: function () { return !!(ringMode && draft); },
    list: function () { return rings.map(function (a) { return { lat: a.lat, lng: a.lng, r: a.r, color: a.color, ang: a.ang }; }); },
    add: function (items) {
      var n = 0, d = 0, have = {}; rings.forEach(function (a) { have[sig(a)] = 1; });
      items.forEach(function (it) {
        var x = { id: 'r' + Date.now().toString(36) + Math.random().toString(16).slice(2, 6), lat: it.lat, lng: it.lng, r: it.r, color: safeColor(it.color), ang: it.ang != null ? it.ang : pickAng(it.lat, it.lng), hidden: false, ts: Date.now() };
        if (have[sig(x)]) { d++; return; }
        have[sig(x)] = 1; rings.push(x); n++;
      });
      if (n) { persist(); renderSaved(); }
      return { added: n, dupes: d };
    },
    clear: function () { rings = []; persist(); renderSaved(); }
  };
  if (!ui) return;
  var tries = 0;
  (function waitMap() { if (getMap()) { renderSaved(); } else if (tries++ < 60) setTimeout(waitMap, 250); })();

  // --- Estados del modo ---
  function setCross(on) { aiming = on; var c = $('poiCrosshair'); if (c) c.classList.toggle('visible', on); }
  function showRow(on) { var r = $('ringRow'); if (r) r.classList.toggle('off', !on); }
  function syncButtons() {
    var ok = !!(draft && draft.r > 0);
    var s = $('ringSaveBtn'); if (s) { s.disabled = !ok; s.style.opacity = ok ? '' : '.35'; }
    var t = $('ringClearBtn'); if (t) { t.disabled = !draft; t.style.opacity = draft ? '' : '.35'; }
    var u = $('ringUndoBtn'), uo = !!(draft || sessionIds.length); if (u) { u.disabled = !uo; u.style.opacity = uo ? '' : '.35'; }
    var rd = $('ringRedoBtn'), ro = redoStack.length > 0; if (rd) { rd.disabled = !ro; rd.style.opacity = ro ? '' : '.35'; }
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
    ringMode = true; sessionIds = []; redoStack = [];
    var off = 'w-full flex items-center gap-2 py-2 px-2 rounded-lg text-xs font-bold text-slate-300 bg-slate-800/70 border border-slate-600/50 min-h-[36px]';
    ['modePolyBtn', 'modeLineBtn', 'modeTrackBtn', 'modePoiBtn'].forEach(function (id) { var b = $(id); if (b) b.className = off; });
    $('modeRingBtn').setAttribute('aria-pressed', 'true');
    forceMode();
    startAiming();
  }
  function exit() {
    if (!ringMode) return;
    ringMode = false; draft = null; sessionIds = []; redoStack = []; clearDraftLayer(); setCross(false); showRow(false);
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
    if (draft || !aiming) { redoStack = []; startAiming(); return; }   // con un anillo caído: vuelve a apuntar
    redoStack = [];
    var m = getMap(); if (!m) return;
    var c; try { c = (typeof poiAimLatLng === 'function') ? poiAimLatLng() : m.getCenter(); } catch (e) { c = m.getCenter(); }   // donde apunta la mira
    draft = { lat: c.lat, lng: c.lng, r: 1000, color: curColor(), ang: pickAng(c.lat, c.lng) };
    setCross(false); drawDraft(); showRow(true); syncButtons();
    var inp = $('ringRadius');
    unit = 'km'; $('ringUnit').textContent = 'km'; inp.value = '1';
    applyRadius(false);
    // sin foco automático: el teclado no tapa el panel; se abre solo si se toca el campo de radio
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
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
  // Confirmar el radio: se ve el anillo completo y la fila de radio se cierra (queda [+] [guardar])
  function confirmRadius() { applyRadius(true); $('ringRadius').blur(); if (draft && draft.r > 0) showRow(false); }
  $('ringRadius').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); confirmRadius(); } });
  $('ringUnit').onclick = function () { unit = unit === 'km' ? 'm' : 'km'; this.textContent = unit; applyRadius(false); };
  function setRadiusInput(r) {
    var inp = $('ringRadius'); if (!inp) return;
    unit = r >= 1000 ? 'km' : 'm'; $('ringUnit').textContent = unit;
    var v = unit === 'km' ? r / 1000 : r;
    inp.value = String(Math.round(v * 1000) / 1000).replace('.', ',');
  }
  $('ringClearBtn').onclick = function () { if (draft) { redoStack = []; startAiming(); } };
  $('ringUndoBtn').onclick = function () {
    if (!ringMode) return;
    if (draft) { redoStack.push({ kind: 'draft', d: draft }); startAiming(); return; }
    var id = sessionIds.pop(); if (!id) return;
    var r = rings.filter(function (x) { return x.id === id; })[0];
    if (r) { redoStack.push({ kind: 'saved', r: r }); rings = rings.filter(function (x) { return x.id !== id; }); persist(); renderSaved(); }
    syncButtons();
  };
  $('ringRedoBtn').onclick = function () {
    if (!ringMode) return;
    var it = redoStack.pop(); if (!it) return;
    if (it.kind === 'saved') { rings.push(it.r); sessionIds.push(it.r.id); persist(); renderSaved(); syncButtons(); return; }
    draft = it.d; setCross(false); drawDraft(); showRow(true); setRadiusInput(draft.r); syncButtons();
  };
  $('ringSaveBtn').onclick = function () {
    if (!draft || !(draft.r > 0)) return;
    var nr = { id: 'r' + Date.now().toString(36) + Math.random().toString(16).slice(2, 5), lat: draft.lat, lng: draft.lng, r: draft.r, color: draft.color, ang: draft.ang, hidden: false, ts: Date.now() };
    rings.push(nr); sessionIds.push(nr.id); redoStack = [];
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
