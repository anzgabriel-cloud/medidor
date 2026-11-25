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
    if (typeof lineBusy === 'function' && lineBusy()) {
      if (typeof toast === 'function') toast({ type: 'info', title: 'Medición en curso', message: 'Guardala o cancelala antes de abrir Buscar o las listas.', duration: 2500 });
      return;
    }
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
    if (!medirOn) openLastTool();
  };

  // --- Herramienta seleccionada al abrir Medir: POI la primera vez, después la última que se usó ---
  var TOOL_KEY = 'medidor_herramienta';
  var TOOLS = { poi: 'modePoiBtn', polygon: 'modePolyBtn', line: 'modeLineBtn', track: 'modeTrackBtn', free: 'modeFreeBtn', ring: 'modeRingBtn' };
  Object.keys(TOOLS).forEach(function (k) {
    var b = $(TOOLS[k]);
    if (b) b.addEventListener('click', function () { try { localStorage.setItem(TOOL_KEY, k); } catch (e) {} });
  });
  function openLastTool() {
    if (typeof hasPendingWork === 'function' && hasPendingWork()) return;    // hay una medición o grabación en curso: no se pisa
    var k = 'poi'; try { k = localStorage.getItem(TOOL_KEY) || 'poi'; } catch (e) {}
    if (!TOOLS[k]) k = 'poi';
    click(TOOLS[k]);
  }
  // --- Bloqueo: con una medición en curso, lo que la interrumpiría queda desactivado (el POI sigue libre durante un recorrido) ---
  function lockEl(id, on) { var e = $(id); if (!e) return; if (on) { e.setAttribute('data-locked', '1'); e.setAttribute('aria-disabled', 'true'); } else { e.removeAttribute('data-locked'); e.removeAttribute('aria-disabled'); } }
  // Al entrar en Modo medición no se traba nada: recién al tocar una herramienta las demás quedan desactivadas.
  // Tocar de nuevo la herramienta activa (sin nada en curso) las libera; tocarla otra vez las traba.
  var picked = false, released = false;
  Object.keys(TOOLS).forEach(function (k) {
    var b = $(TOOLS[k]); if (!b) return;
    b.addEventListener('click', function (ev) {
      if (!ev.isTrusted) return;   // solo toques reales: la entrada automática a la última herramienta no cuenta
      if ($('viewMedirBtn').getAttribute('aria-pressed') !== 'true') return;
      var cur = (typeof poiMode !== 'undefined' && poiMode) ? 'poi' : (typeof trackMode !== 'undefined' && trackMode) ? 'track' : ($('mainControls') ? $('mainControls').getAttribute('data-mode') : '');
      var busy = (typeof lineBusy === 'function' && lineBusy()) || (typeof trackSession === 'function' && trackSession());
      if (picked && !released && k === cur && !busy) {
        released = true;
        if (typeof toast === 'function') toast({ type: 'info', title: 'Herramientas liberadas', message: 'Elegí otra. Se traban de nuevo al seleccionarla.', duration: 2200 });
      } else { released = false; picked = true; }
    }, true);
  });
  function syncLocks() {
    var lb = typeof lineBusy === 'function' && lineBusy();
    var ts = typeof trackSession === 'function' && trackSession();
    var fr = !!(window.MedidorRutas && window.MedidorRutas.busy && window.MedidorRutas.busy());
    var busy = lb || ts;   // el borrador de una ruta a mano alzada se conserva al cambiar de herramienta: no cuenta como trabado
    var cur = (typeof poiMode !== 'undefined' && poiMode) ? 'poi' : (typeof trackMode !== 'undefined' && trackMode) ? 'track' : ($('mainControls') ? $('mainControls').getAttribute('data-mode') : '');
    lockEl('tpSearch', lb); lockEl('tpFolder', lb);
    // Herramienta elegida en Modo medición: las demás quedan desactivadas (salvo que se las libere tocando de nuevo la activa)
    var medirOn = $('viewMedirBtn').getAttribute('aria-pressed') === 'true';
    if (!medirOn) { picked = false; released = false; }
    var chosen = medirOn && picked && !!cur && !released;
    Object.keys(TOOLS).forEach(function (k) {
      var lock = ((busy || chosen) && k !== cur);
      if (ts && k === cur) lock = false;                   // el botón del recorrido en curso nunca se bloquea a sí mismo
      if (k === 'poi' && ts) lock = false;                 // ubicar un POI sobre la marcha, sin cortar la grabación
      if (k === 'track' && ts && cur === 'poi') lock = false;   // y volver al recorrido
      lockEl(TOOLS[k], lock);
    });
  }
  setInterval(syncLocks, 350); syncLocks();
  function syncMeasure() {
    $('tpMeasure').setAttribute('aria-pressed', $('viewMedirBtn').getAttribute('aria-pressed') === 'true' ? 'true' : 'false');
  }
  new MutationObserver(syncMeasure).observe($('viewMedirBtn'), { attributes: true, attributeFilter: ['aria-pressed'] });
  syncMeasure();

  // --- Guardados: menú con POI y Mediciones (abren las listas de siempre) ---
  $('tpFolder').onclick = function () {
    if (typeof lineBusy === 'function' && lineBusy()) {
      if (typeof toast === 'function') toast({ type: 'info', title: 'Medición en curso', message: 'Guardala o cancelala antes de abrir Buscar o las listas.', duration: 2500 });
      return;
    }
    var m = $('folderMenu'), open = m.classList.contains('hidden');
    closeSearch();
    if (open) leaveMeasure();
    m.classList.toggle('hidden', !open);
    $('tpFolder').setAttribute('aria-expanded', open ? 'true' : 'false');
    updatePop();
  };
  $('fmPoi').onclick = function () { closeFolder(); click('poiBtn'); };
  ['polygon', 'line', 'track'].forEach(function (k) {
    $('fm' + k.charAt(0).toUpperCase() + k.slice(1)).onclick = function () { closeFolder(); if (typeof openSaved === 'function') openSaved(k); };
  });
  function mirror(from, to) {
    var a = $(from), b = $(to); if (!a || !b) return;
    var sync = function () { b.textContent = a.textContent; };
    new MutationObserver(sync).observe(a, { childList: true, characterData: true, subtree: true }); sync();
  }
  mirror('poiBadge', 'fmPoiN');
  document.addEventListener('pointerdown', function (e) {
    if (!$('folderMenu').classList.contains('hidden') && !e.target.closest('#folderMenu, #tpFolder')) closeFolder();
  }, true);

  // --- Selector de colores: solo colores completos (sin el último cortado) y flechas si hay más para deslizar ---
  (function () {
    var pal = $('colorPalette'), row = $('colorRow'), less = $('colorLess'), more = $('colorMore');
    if (!pal || !row || !less || !more) return;
    var PITCH = 32;                                          // 24 px de color + 8 px de separación
    function arrows() {
      var max = pal.scrollWidth - pal.clientWidth;
      less.classList.toggle('off', max <= 2 || pal.scrollLeft <= 2);
      more.classList.toggle('off', max <= 2 || pal.scrollLeft >= max - 2);
    }
    function fit() {
      var w = row.clientWidth; if (!w) return;
      var total = pal.querySelectorAll('.color-swatch').length;
      var n = Math.max(3, Math.min(total, Math.floor((w - 36) / PITCH)));
      pal.style.width = (n * PITCH) + 'px';
      var a = pal.querySelector('.color-swatch.active');
      if (a && (a.offsetLeft < pal.scrollLeft || a.offsetLeft + a.offsetWidth > pal.scrollLeft + pal.clientWidth)) pal.scrollLeft = Math.max(0, a.offsetLeft - 4);
      arrows();
    }
    function page(dir) { pal.scrollBy({ left: dir * Math.max(1, Math.round(pal.clientWidth / PITCH) - 1) * PITCH, behavior: 'smooth' }); }
    less.onclick = function () { page(-1); };
    more.onclick = function () { page(1); };
    pal.addEventListener('scroll', arrows, { passive: true });
    if (window.ResizeObserver) new ResizeObserver(fit).observe(row);
    window.addEventListener('resize', fit);
    fit();
  })();

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
