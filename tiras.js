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
    var vis = mc && !mc.classList.contains('hidden') && h > 40;
    document.documentElement.style.setProperty('--strip-bottom', (vis ? h + 8 : 12) + 'px');
  }
  if (mc && window.ResizeObserver) new ResizeObserver(lift).observe(mc);
  window.addEventListener('resize', lift);
  lift();
})();
