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
    paintPanelBtns(); lift();
  }
  document.querySelectorAll('.set-panel').forEach(function (b) {
    b.onclick = function () {
      try { localStorage.setItem(PANEL_KEY, b.dataset.panel === 'nuevo' ? '1' : '0'); } catch (e) {}
      applyPanel();
    };
  });
  applyPanel();

  // --- Colores del panel nuevo: Visibles / Compacto (ícono de paleta). Se elige en Ajustes y se recuerda ---
  var COL_KEY = 'medidor_colores_compacto';
  function coloresCompacto() { try { return localStorage.getItem(COL_KEY) === '1'; } catch (e) { return false; } }
  function paintColorBtns() {
    var c = body.classList.contains('col-compact');
    document.querySelectorAll('.set-colors').forEach(function (b) {
      var on = (b.dataset.colors === 'compacto') === c;
      b.className = 'set-colors py-2 rounded-xl text-xs font-bold border ' +
        (on ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-slate-800 text-slate-300 border-slate-600');
    });
  }
  function applyColors() {
    body.classList.toggle('col-compact', coloresCompacto());
    body.classList.remove('colors-open');
    paintColorBtns();
  }
  document.querySelectorAll('.set-colors').forEach(function (b) {
    b.onclick = function () {
      try { localStorage.setItem(COL_KEY, b.dataset.colors === 'compacto' ? '1' : '0'); } catch (e) {}
      applyColors();
    };
  });
  var ct = $('colorToggleBtn');
  if (ct) ct.onclick = function () { body.classList.toggle('colors-open'); };
  var pal = $('colorPalette');
  if (pal) pal.addEventListener('click', function (e) {
    if (e.target.closest('.color-swatch')) setTimeout(function () { body.classList.remove('colors-open'); }, 0);
  });
  applyColors();

  // --- Herramienta que todavía no existe (ruta a mano alzada): solo avisan ---
  ['modeFreeBtn'].forEach(function (id) {
    var b = $(id); if (!b) return;
    b.onclick = function () {
      if (typeof toast === 'function') toast({ type: 'info', title: 'Próximamente', message: 'Esta herramienta todavía no está disponible.', duration: 2500 });
    };
  });

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
