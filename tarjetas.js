window.MV = window.MV || {}; window.MV.tarjetas = '2026.11.26-v2-84';   // versión: debe coincidir con app.js (se controla al iniciar)
/* Tarjeta de consulta para anillos y rutas a mano alzada: mismo aspecto y lugar que la Consulta de mediciones y POI,
   con el menú de tres puntos. La usan anillos.js y rutas.js (window.MedidorConsulta). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var cur = null;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  var el = document.createElement('div');
  el.id = 'xInfo';
  el.className = 'fixed left-3 right-3 z-30 hidden pointer-events-none';
  el.style.bottom = 'max(12px, env(safe-area-inset-bottom))';
  el.innerHTML =
    '<div class="pointer-events-auto max-w-xl mx-auto rounded-2xl shadow-2xl overflow-hidden border-2 border-amber-500/50 bg-slate-900/95 backdrop-blur-md">' +
    '<div class="h-1 w-full bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500"></div>' +
    '<div class="p-3">' +
    '<div class="flex items-start justify-between gap-2 mb-1.5">' +
    '<div class="min-w-0">' +
    '<p id="xLabel" class="hidden text-[10px] font-bold uppercase tracking-wider text-amber-400 mb-0.5">Consulta</p>' +
    '<div class="flex items-center gap-2"><span id="xColor" class="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-2 ring-white/20"></span>' +
    '<h3 id="xName" class="font-bold text-sm text-slate-50 truncate">—</h3></div>' +
    '<p id="xMeta" class="text-[10px] text-slate-400 mt-0.5"></p></div>' +
    '<div class="flex items-center gap-1.5 flex-shrink-0">' +
    '<button id="xMenuBtn" type="button" class="flex items-center justify-center px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-600 text-slate-200 flex-shrink-0" aria-label="Más opciones" aria-haspopup="true">' +
    '<svg viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></button>' +
    '<button id="xCloseBtn" type="button" class="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-600 text-slate-200 text-xs font-semibold flex-shrink-0" aria-label="Cerrar consulta">' +
    '<i data-lucide="x" class="w-4 h-4"></i> Cerrar</button></div></div>' +
    '<div id="xMetrics" class="grid grid-cols-1 gap-1.5"></div>' +
    '<div id="xActions" class="hidden flex gap-1.5 mt-2"></div>' +
    '</div></div>';
  document.body.appendChild(el);

  function metricsHtml(rows, extra) {
    var h = '<div class="bg-slate-950/80 rounded-xl px-2.5 py-2 border border-slate-800">';
    (rows || []).forEach(function (cols, ri) {
      h += '<div class="flex items-start gap-3' + (ri ? ' mt-1.5 pt-1.5 border-t-2 border-slate-700' : '') + '">';
      cols.forEach(function (c, ci) {
        h += '<div class="flex-1 min-w-0' + (ci ? ' pl-3 border-l-2 border-slate-700' : '') + '">' +
          '<div class="text-[10px] text-slate-400 uppercase">' + esc(c.label) + '</div>' +
          '<div class="text-base font-bold ' + esc(c.cls || 'text-sky-400') + '">' + esc(c.value) + (c.unit ? ' <span class="text-xs font-normal">' + esc(c.unit) + '</span>' : '') + '</div>' +
          (c.sub ? '<div class="text-[11px] text-slate-500">' + esc(c.sub) + '</div>' : '') + '</div>';
      });
      h += '</div>';
    });
    if (extra) h += '<div class="mt-1.5 pt-1.5 border-t-2 border-slate-700 text-[11px] text-slate-300 break-words" style="white-space:pre-line">' + esc(extra) + '</div>';
    return h + '</div>';
  }

  function closeMenu() {
    var m = $('xMenu'); if (m) m.remove();
    document.removeEventListener('pointerdown', onOutside, true);
  }
  function onOutside(e) {
    var m = $('xMenu'), b = $('xMenuBtn');
    if (m && !m.contains(e.target) && !(b && b.contains(e.target))) closeMenu();
  }
  function openMenu() {
    if ($('xMenu')) return closeMenu();
    if (!cur) return;
    var rows = cur.rows || [];
    var menu = document.createElement('div');
    menu.id = 'xMenu';
    menu.className = 'fixed z-[60] min-w-[11rem] rounded-xl border border-slate-600 bg-slate-900 shadow-2xl py-1';
    menu.innerHTML = rows.map(function (r, i) {
      return '<button type="button" data-i="' + i + '" class="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold ' + esc(r.cls || 'text-slate-200') + ' text-left"><i data-lucide="' + esc(r.icon) + '" class="w-4 h-4"></i> ' + esc(r.label) + '</button>';
    }).join('');
    document.body.appendChild(menu);
    var br = $('xMenuBtn').getBoundingClientRect(), mh = menu.offsetHeight;
    var top = br.bottom + 6 + mh > window.innerHeight - 8 ? Math.max(8, br.top - 6 - mh) : br.bottom + 6;
    menu.style.top = top + 'px';
    menu.style.right = Math.max(8, window.innerWidth - br.right) + 'px';
    menu.querySelectorAll('button').forEach(function (b) { b.onclick = function () { var r = rows[+b.dataset.i]; closeMenu(); if (r && r.run) r.run(); }; });
    if (window.lucide) lucide.createIcons();
    setTimeout(function () { document.addEventListener('pointerdown', onOutside, true); }, 0);
  }

  function close() {
    closeMenu();
    if (!cur) return;
    var c = cur; cur = null;
    el.classList.add('hidden');
    try { if (c.onClose) c.onClose(); } catch (e) {}
  }
  // spec: { color, title, meta, metrics: [[{label,value,unit,sub,cls}]], extra, rows: [{icon,label,cls,run}] (menú ⋯), actions: [{icon,label,cls,run}] (botones abajo), onClose }
  function open(spec) {
    if (cur) close();
    try { if (typeof inspectItem !== 'undefined' && (inspectItem || inspectPoi) && typeof hideMeasurementInfo === 'function') hideMeasurementInfo(); } catch (e) {}
    cur = spec;
    $('xColor').style.background = /^#[0-9a-f]{6}$/i.test(spec.color || '') ? spec.color : '#00ff66';
    $('xName').textContent = spec.title || '';
    $('xMeta').textContent = spec.meta || '';
    $('xMetrics').innerHTML = metricsHtml(spec.metrics, spec.extra);
    // Con 'rows' se muestra el menú ⋯; con 'actions', botones abajo del panel (sin menú)
    $('xMenuBtn').classList.toggle('hidden', !(spec.rows && spec.rows.length));
    var ab = $('xActions'); ab.innerHTML = '';
    var grouped = true;   // siempre: los botones se agrupan a la izquierda y el que tenga 'right' queda a la derecha
    (spec.actions || []).forEach(function (a) {
      var b = document.createElement('button'); b.type = 'button';
      b.className = (grouped ? (a.right ? 'ml-auto ' : '') + 'flex items-center justify-center gap-1.5 px-4' : 'flex-1 flex items-center justify-center gap-1.5 px-3') + ' py-2 rounded-lg bg-slate-800 border border-slate-600 text-xs font-semibold ' + (a.cls || 'text-slate-200');
      b.innerHTML = '<i data-lucide="' + esc(a.icon) + '" class="w-4 h-4"></i> ' + esc(a.label);
      b.onclick = function () { if (a.run) a.run(); };
      ab.appendChild(b);
    });
    ab.classList.toggle('hidden', !(spec.actions && spec.actions.length));
    if (window.lucide) lucide.createIcons();
    el.classList.remove('hidden');
  }
  $('xMenuBtn').onclick = openMenu;
  $('xCloseBtn').onclick = close;

  // Si se abre la Consulta de una medición o de un POI, esta se cierra; en Modo medición tampoco queda abierta
  ['showMeasurementInfo', 'showPoiInfo'].forEach(function (n) {
    var orig = window[n];
    if (typeof orig !== 'function') return;
    window[n] = function () { close(); return orig.apply(this, arguments); };
  });
  var vm = $('viewMedirBtn');
  if (vm) new MutationObserver(function () { if (vm.getAttribute('aria-pressed') === 'true') close(); }).observe(vm, { attributes: true, attributeFilter: ['aria-pressed'] });

  // Actualiza datos de la tarjeta abierta (p. ej. una altitud que llega después); se ignora si ya se cerró o se abrió otra
  function update(spec, patch) {
    if (!cur || cur !== spec) return;
    Object.keys(patch || {}).forEach(function (k) { spec[k] = patch[k]; });
    $('xMetrics').innerHTML = metricsHtml(spec.metrics, spec.extra);
  }
  window.MedidorConsulta = { open: open, close: close, update: update, isOpen: function () { return !!cur; }, kind: function () { return cur ? (cur.kind || '') : ''; } };
})();
