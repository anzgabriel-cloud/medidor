// Interfaz mínima: dos tiras de íconos que manejan los botones y paneles que ya existen.
(function () {
  'use strict';
  var body = document.body;
  var $ = function (id) { return document.getElementById(id); };
  function click(id) { var el = $(id); if (el) el.click(); }

  // --- Tira de arriba: ajustes, capas, ubicación ---
  $('tpSettings').onclick = function () { closeAll(); click('settingsBtn'); };
  $('tpLayers').onclick = function () { click('layerBtn'); };
  $('tpLocate').onclick = function () { click('locateBtn'); };

  // --- Buscar: abre/cierra el buscador (lugar + coordenadas) arriba de la tira ---
  function updatePop() {
    body.classList.toggle('pop-open', body.classList.contains('search-open') || !$('folderMenu').classList.contains('hidden'));
  }
  function closeSearch() {
    body.classList.remove('search-open');
    $('tpSearch').setAttribute('aria-pressed', 'false');
    if (typeof setSearchMode === 'function') setSearchMode('place');
    var si = $('searchInput'); if (si) si.blur();
    updatePop();
  }
  function closeFolder() { $('folderMenu').classList.add('hidden'); $('tpFolder').setAttribute('aria-expanded', 'false'); updatePop(); }
  function closeAll() { closeSearch(); closeFolder(); }
  // Si se abre buscar/carpeta estando en medición, se pasa a Ver (así la regla se desmarca)
  function leaveMeasure() { if ($('viewMedirBtn').getAttribute('aria-pressed') === 'true') click('viewVerBtn'); }
  $('tpSearch').onclick = function () {
    var open = !body.classList.contains('search-open');
    closeFolder();
    if (!open) { closeSearch(); return; }
    leaveMeasure();
    body.classList.add('search-open');
    $('tpSearch').setAttribute('aria-pressed', 'true');
    updatePop();
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
    if (open) leaveMeasure();
    m.classList.toggle('hidden', !open);
    $('tpFolder').setAttribute('aria-expanded', open ? 'true' : 'false');
    updatePop();
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

  // --- Brújula permanente: si algo la oculta con la interfaz mínima activa (por ejemplo un app.js viejo en el caché), vuelve a mostrarse ---
  var cmp = $('fixedCompass');
  if (cmp) {
    var keepCompass = function () {
      if (!cmp.classList.contains('hidden')) return;
      cmp.classList.remove('hidden');
      if (typeof applyCompassScale === 'function') applyCompassScale();
      if (typeof positionFixedCompass === 'function') positionFixedCompass();
      if (typeof compassActive === 'function' && !document.hidden) compassActive(true);
    };
    new MutationObserver(keepCompass).observe(cmp, { attributes: true, attributeFilter: ['class'] });
    keepCompass();
  }
})();
