// Interfaz mínima: dos tiras de íconos que manejan los botones y paneles que ya existen.
// Para volver a la interfaz anterior: abrir la app con ?clasica al final de la dirección.
(function () {
  'use strict';
  var body = document.body;
  if (/[?&]clasica\b/.test(location.search)) { body.classList.remove('ui-min'); return; }
  var $ = function (id) { return document.getElementById(id); };
  function click(id) { var el = $(id); if (el) el.click(); }

  // --- Tira de arriba: ajustes, capas, ubicación ---
  $('tpSettings').onclick = function () { closeAll(); click('settingsBtn'); };
  $('tpLayers').onclick = function () { click('layerBtn'); };
  $('tpLocate').onclick = function () { click('locateBtn'); };

  // --- Buscar: abre/cierra el buscador (lugar + coordenadas) arriba de la tira ---
  function closeSearch() {
    body.classList.remove('search-open');
    $('tpSearch').setAttribute('aria-pressed', 'false');
    if (typeof setSearchMode === 'function') setSearchMode('place');
    var si = $('searchInput'); if (si) si.blur();
  }
  function closeFolder() { $('folderMenu').classList.add('hidden'); $('tpFolder').setAttribute('aria-expanded', 'false'); }
  function closeAll() { closeSearch(); closeFolder(); }
  $('tpSearch').onclick = function () {
    var open = !body.classList.contains('search-open');
    closeFolder();
    if (!open) { closeSearch(); return; }
    body.classList.add('search-open');
    $('tpSearch').setAttribute('aria-pressed', 'true');
  };

  // --- Medir: alterna Modo vista / Modo medición (el panel de medición se abre solo en medición) ---
  $('tpMeasure').onclick = function () {
    closeAll();
    var medirOn = $('viewMedirBtn').getAttribute('aria-pressed') === 'true';
    click(medirOn ? 'viewVerBtn' : 'viewMedirBtn');
  };
  function syncMeasure() {
    $('tpMeasure').setAttribute('aria-pressed', $('viewMedirBtn').getAttribute('aria-pressed') === 'true' ? 'true' : 'false');
  }
  new MutationObserver(syncMeasure).observe($('viewMedirBtn'), { attributes: true, attributeFilter: ['aria-pressed'] });
  syncMeasure();

  // --- Guardados: menú con POI y Mediciones (abren las listas de siempre) ---
  $('tpFolder').onclick = function () {
    var m = $('folderMenu'), open = m.classList.contains('hidden');
    closeSearch();
    m.classList.toggle('hidden', !open);
    $('tpFolder').setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  $('fmPoi').onclick = function () { closeFolder(); click('poiBtn'); };
  $('fmSaved').onclick = function () { closeFolder(); click('savedBtn'); };
  function mirror(from, to) {
    var a = $(from), b = $(to); if (!a || !b) return;
    var sync = function () { b.textContent = a.textContent; };
    new MutationObserver(sync).observe(a, { childList: true, characterData: true, subtree: true }); sync();
  }
  mirror('poiBadge', 'fmPoiN'); mirror('savedBadge', 'fmSavedN');
  document.addEventListener('pointerdown', function (e) {
    if (!$('folderMenu').classList.contains('hidden') && !e.target.closest('#folderMenu, #tpFolder')) closeFolder();
  }, true);

  // --- La tira de abajo sube sobre el panel de medición cuando está abierto ---
  var mc = $('mainControls');
  function lift() {
    var h = mc ? Math.round(mc.getBoundingClientRect().height) : 0;
    var vis = mc && !mc.classList.contains('hidden') && h > 40 && !body.classList.contains('med2');
    document.documentElement.style.setProperty('--strip-bottom', (vis ? h + 8 : 12) + 'px');
  }
  if (mc && window.ResizeObserver) new ResizeObserver(lift).observe(mc);
  window.addEventListener('resize', lift);
  lift();

  // --- Panel de medición: Clásico / Nuevo (prueba). Se elige en Ajustes y se recuerda ---
  var PANEL_KEY = 'medidor_panel_nuevo';
  function panelNuevo() { try { return localStorage.getItem(PANEL_KEY) === '1'; } catch (e) { return false; } }
  function paintPanelBtns() {
    var nuevo = body.classList.contains('med2');
    document.querySelectorAll('.set-panel').forEach(function (b) {
      var on = (b.dataset.panel === 'nuevo') === nuevo;
      b.className = 'set-panel py-2 rounded-xl text-xs font-bold border ' +
        (on ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-slate-800 text-slate-300 border-slate-600');
    });
  }
  function applyPanel() {
    body.classList.toggle('med2', panelNuevo());
    if (mc) mc.classList.remove('rail-open');
    body.classList.remove('palette-open');
    paintPanelBtns(); lift();
  }
  document.querySelectorAll('.set-panel').forEach(function (b) {
    b.onclick = function () {
      try { localStorage.setItem(PANEL_KEY, b.dataset.panel === 'nuevo' ? '1' : '0'); } catch (e) {}
      applyPanel();
    };
  });
  // Herramientas: tocar la activa despliega la lista; elegir otra la cierra
  var modeOf = { modePolyBtn: 'polygon', modeLineBtn: 'line', modeTrackBtn: 'track', modePoiBtn: 'poi' };
  var bt = $('bottomToolbar');
  if (bt && mc) bt.addEventListener('click', function (e) {
    if (!body.classList.contains('med2')) return;
    var btn = e.target.closest('#modePolyBtn, #modeLineBtn, #modeTrackBtn, #modePoiBtn');
    if (!btn) return;
    var open = mc.classList.contains('rail-open');
    var active = mc.getAttribute('data-mode') === modeOf[btn.id];
    if (!open && active) { e.stopImmediatePropagation(); e.preventDefault(); mc.classList.add('rail-open'); return; }
    if (open) { mc.classList.remove('rail-open'); if (active) { e.stopImmediatePropagation(); e.preventDefault(); } }
  }, true);
  // Color: el ícono abre la paleta; al elegir un color se cierra
  var cb = $('colorRailBtn');
  if (cb) cb.onclick = function () { body.classList.toggle('palette-open'); };
  var pal = $('colorPalette');
  if (pal) pal.addEventListener('click', function () { setTimeout(function () { body.classList.remove('palette-open'); }, 0); });
  applyPanel();
})();
