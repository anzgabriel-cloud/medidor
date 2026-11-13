/* Medidor de Terrenos - Lógica principal
   Reorganizado: estado, helpers, UI, mapa, mediciones, POIs, GPS, persistencia
*/

lucide.createIcons();

// ========== STATE ==========
let map, tileLayer;
let mode = 'polygon';
let themeColor = '#00ff66';

/** Color de texto legible: los colores muy oscuros (negro) se muestran en blanco */
function labelLuminance(color) {
  const hex = String(color || '#00ff66').replace('#', '');
  const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return { r, g, b, lum: (0.299 * r + 0.587 * g + 0.114 * b) / 255 };
}
function labelTextColor(color) {
  return labelLuminance(color).lum < 0.22 ? '#ffffff' : (color || '#00ff66');
}
function applyLabelTint(color, inspect = false) {
  const { r, g, b, lum } = labelLuminance(color);
  const dark = lum < 0.22;
  // Colores muy oscuros: texto blanco sobre un halo oscuro para que se lea
  const center = dark ? 'rgba(0,0,0,0.7)' : `rgba(${r},${g},${b},0.55)`;
  const mid = dark ? 'rgba(0,0,0,0.35)' : `rgba(${r},${g},${b},0.2)`;
  const text = dark ? '#ffffff' : (color || '#00ff66');
  const root = document.documentElement.style;
  if (inspect) {
    root.setProperty('--inspect-label-center', center);
    root.setProperty('--inspect-label-mid', mid);
    root.setProperty('--inspect-label-text', text);
  } else {
    root.setProperty('--label-center', center);
    root.setProperty('--label-mid', mid);
    root.setProperty('--label-text', text);
  }
}
let points = [];
let history = [];
let historyIndex = -1;
let markers = [];
let midMarkers = [];
let labels = [];
let kinkMarkers = [];
let polyLayer = null;
let lineLayer = null;
let guideLine = null;
let touchDot = null;
let saved = [];
let dragging = false;
let dragIndex = -1;
let currentTiles = 'esri';
let lockedLayers = [];
let editingId = null;
let liveLabels = [];
let inspectLayers = [];
let inspectItem = null;
let inspectShowSegs = true;
let inspectShowBearings = false;
let inspectShowAngles = false;
let inspectShowCoords = false;
let isLocked = false;
let drawingActive = false; // solo se agregan puntos tras pulsar Nueva (o al editar)
let lastPauseToastAt = 0; // evita spam de toasts al tocar el mapa en pausa
let clearConfirmOpen = false;
let closePromptOpen = false;
let closeMagnet = null;
let gpsWatchId = null;
let trackMode = false;
let trackStarted = false;  // hubo grabación en este recorrido
let trackEnded = false;    // se tocó Detener (ya no se puede reanudar)
let lastGpsPoint = null;
let userLocMarker = null;
let userAccCircle = null;
let userLocWatchId = null;
let pois = [];
let poiLayers = [];
let poiMode = false;
let poiAiming = false;
let pendingPoi = null;
let editingPoiId = null;
let poiColor = '#f59e0b';
let poiSession = [];
let poiSessionRedo = [];
let navPoi = null;
let navLine = null;

const OFFSET = 70;
let dragGrabOffsetX = 0;
let dragGrabOffsetY = 0;
let dragStartFinger = null;
let dragAnim = null;

const tiles = {
  esri:   { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 22, nativeZoom: 18, name: 'Satélite', attr: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' },
  osm:    { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 22, nativeZoom: 19, name: 'Calles', attr: '&copy; OpenStreetMap contributors' }
};

// ========== HELPERS ==========
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function safeColor(c, fallback = '#00ff66') {
  return /^#[0-9a-fA-F]{6}$/.test(String(c || '')) ? c : fallback;
}

// ========== AJUSTES / UNIDADES / COORDENADAS ==========
const SETTINGS_KEY = 'medidor_settings';
const DEFAULT_SETTINGS = { units: 'metric', coords: 'dec', gpsMaxAcc: 20, gpsMinStep: 3 };
let settings = { ...DEFAULT_SETTINGS };
function loadSettings() {
  try {
    const r = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (r && typeof r === 'object') {
      if (r.units === 'metric' || r.units === 'imperial') settings.units = r.units;
      if (['dec', 'dms', 'utm', 'gk'].includes(r.coords)) settings.coords = r.coords;
      if ([5, 10, 20, 30, 50].includes(+r.gpsMaxAcc)) settings.gpsMaxAcc = +r.gpsMaxAcc;
      if ([1, 2, 3, 5, 10, 20, 50, 100].includes(+r.gpsMinStep)) settings.gpsMinStep = +r.gpsMinStep;
    }
  } catch (e) {}
}
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {} }

const FT = 3.280839895, MI = 1609.344, ACRE = 4046.8564224, FT2 = 10.763910417;
const nf2 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const isImp = () => settings.units === 'imperial';
/** Distancia corta para etiquetas: 250 m / 1,20 km  ·  820 ft / 0,85 mi */
function fmtLenShort(m) {
  if (isImp()) { const mi = m / MI; return mi >= 0.5 ? mi.toFixed(2) + ' mi' : Math.round(m * FT) + ' ft'; }
  return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';
}
function fmtAcc(m) { return isImp() ? Math.round(m * FT) + ' ft' : Math.round(m) + ' m'; }
const lenMain = (m) => isImp() ? { v: m / MI, u: 'mi' } : { v: m / 1000, u: 'km' };
const lenSub = (m) => isImp() ? `${nf0.format(m * FT)} ft` : `${nf0.format(m)} m`;
const areaMain = (a) => isImp() ? { v: a / ACRE, u: 'ac' } : { v: a / 10000, u: 'ha' };
const areaSub = (a) => isImp() ? `${nf0.format(a * FT2)} ft²` : `${nf0.format(a)} m²`;

// Proyección Transversal de Mercator (serie de Krüger, WGS84)
function tmForward(lat, lng, lon0, k0, fe) {
  const a = 6378137, f = 1 / 298.257223563, n = f / (2 - f);
  const A = a / (1 + n) * (1 + n * n / 4 + n ** 4 / 64 + n ** 6 / 256);
  const al = [n / 2 - 2 * n ** 2 / 3 + 5 * n ** 3 / 16, 13 * n ** 2 / 48 - 3 * n ** 3 / 5, 61 * n ** 3 / 240];
  const phi = lat * Math.PI / 180, dl = (lng - lon0) * Math.PI / 180;
  const c = 2 * Math.sqrt(n) / (1 + n);
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - c * Math.atanh(c * Math.sin(phi)));
  const xi0 = Math.atan2(t, Math.cos(dl));
  const eta0 = Math.asinh(Math.sin(dl) / Math.sqrt(t * t + Math.cos(dl) ** 2));
  let xi = xi0, eta = eta0;
  for (let j = 1; j <= 3; j++) {
    xi += al[j - 1] * Math.sin(2 * j * xi0) * Math.cosh(2 * j * eta0);
    eta += al[j - 1] * Math.cos(2 * j * xi0) * Math.sinh(2 * j * eta0);
  }
  return { E: fe + k0 * A * eta, N: k0 * A * xi, A };
}
function toUTM(lat, lng) {
  const zone = Math.min(60, Math.max(1, Math.floor((lng + 180) / 6) + 1));
  const r = tmForward(lat, lng, zone * 6 - 183, 0.9996, 500000);
  const N = r.N + (lat < 0 ? 10000000 : 0);
  const band = 'CDEFGHJKLMNPQRSTUVWXX'[Math.min(20, Math.max(0, Math.floor((lat + 80) / 8)))];
  return { zone, band, E: r.E, N };
}
function toGaussKruger(lat, lng) {
  const faja = Math.min(7, Math.max(1, Math.round((lng + 72) / 3) + 1));
  const r = tmForward(lat, lng, -72 + 3 * (faja - 1), 1, faja * 1000000 + 500000);
  return { faja, Y: r.E, X: r.N + r.A * Math.PI / 2 }; // origen de latitud en el polo sur
}
function dmsStr(v, pos, neg) {
  const h = v >= 0 ? pos : neg; v = Math.abs(v);
  let d = Math.floor(v), m = Math.floor((v - d) * 60), sec = Math.round((((v - d) * 60) - m) * 60 * 100) / 100;
  if (sec >= 60) { sec -= 60; m++; }
  if (m >= 60) { m -= 60; d++; }
  return `${d}°${String(m).padStart(2, '0')}'${sec.toFixed(2).padStart(5, '0')}"${h}`;
}
/** Coordenada en dos líneas, según el formato elegido */
function fmtCoordLines(lat, lng) {
  lat = +lat; lng = +lng;
  if (settings.coords === 'dms') return [dmsStr(lat, 'N', 'S'), dmsStr(lng, 'E', 'O')];
  if (settings.coords === 'utm') {
    const u = toUTM(lat, lng);
    return [`${u.zone}${u.band}  ${nf0.format(u.E).replace(/\./g, ' ')} E`, `${nf0.format(u.N).replace(/\./g, ' ')} N`];
  }
  if (settings.coords === 'gk') {
    const g = toGaussKruger(lat, lng);
    return [`X ${nf0.format(g.X).replace(/\./g, ' ')}`, `Y ${nf0.format(g.Y).replace(/\./g, ' ')} (faja ${g.faja})`];
  }
  return [lat.toFixed(6), lng.toFixed(6)];
}
function fmtCoord(lat, lng) {
  const l = fmtCoordLines(lat, lng);
  return settings.coords === 'dec' ? `${l[0]}, ${l[1]}` : `${l[0]}  ·  ${l[1]}`;
}

/** Refresca todo lo que muestra unidades o coordenadas */
function applySettings() {
  try { if (points.length) redraw(); else updateMetrics(0, 0); } catch (e) {}
  try { updatePoiCenterCoords(); } catch (e) {}
  try { if (!document.getElementById('poiDrawer').classList.contains('hidden')) renderPoiList(); } catch (e) {}
  try {
    if (inspectItem) {
      const f = [inspectShowSegs, inspectShowBearings, inspectShowAngles, inspectShowCoords];
      showMeasurementInfo(inspectItem);
      [inspectShowSegs, inspectShowBearings, inspectShowAngles, inspectShowCoords] = f;
      updateInfoToggleUI();
      refreshInspectOverlays();
    }
  } catch (e) {}
}

function refreshSettingsUI() {
  document.querySelectorAll('.set-units').forEach(b => {
    const on = b.dataset.units === settings.units;
    b.className = 'set-units py-2 rounded-xl text-xs font-bold border ' +
      (on ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-slate-800 text-slate-300 border-slate-600');
  });
  document.getElementById('setCoords').value = settings.coords;
  const c = map ? map.getCenter() : { lat: -38.95, lng: -68.06 };
  document.getElementById('setCoordsExample').textContent = 'Ej. centro del mapa: ' + fmtCoord(c.lat, c.lng);
  const ov = getDeclOverride();
  const est = (() => { const o = ov; setDeclOverride(null); const v = magneticDeclination(c.lat, c.lng); if (o !== null) setDeclOverride(o); return v; })();
  // El teclado numérico del iPhone no tiene signo: se escribe el valor y se elige Este (+) u Oeste (−)
  if (ov !== null) declSign = ov < 0 ? -1 : 1;
  else declSign = est < 0 ? -1 : 1;          // por defecto, el sentido de la estimación del lugar
  document.getElementById('setDecl').value = ov === null ? '' : String(Math.abs(ov));
  document.getElementById('setDecl').placeholder = `Auto: ${Math.abs(est).toFixed(1)}° ${est < 0 ? 'O' : 'E'}`;
  updateDeclSignUI();
  document.getElementById('setDeclHint').textContent = ov === null
    ? `Usando estimación aproximada: ${fmtDecl(est)} (puede tener varios grados de error). Escribí el valor real del lugar (NOAA/NCEI) y elegí Este u Oeste.`
    : `Valor manual en uso: ${fmtDecl(ov)}. La estimación aquí sería ${fmtDecl(est)}.`;
  const accSel = document.getElementById('setGpsAcc'), stepSel = document.getElementById('setGpsStep');
  const u = (m) => isImp() ? `${Math.round(m * FT)} ft` : `${m} m`;
  accSel.innerHTML = [5, 10, 20, 30, 50].map(v => `<option value="${v}">±${u(v)}</option>`).join('');
  stepSel.innerHTML = [1, 2, 3, 5, 10, 20, 50, 100].map(v => `<option value="${v}">${u(v)}</option>`).join('');
  accSel.value = String(settings.gpsMaxAcc);
  stepSel.value = String(settings.gpsMinStep);
}
let declSign = -1;
const fmtDecl = (v) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1)}° (${v < 0 ? 'Oeste' : 'Este'})`;
function updateDeclSignUI() {
  document.querySelectorAll('.set-decl-sign').forEach(b => {
    const on = +b.dataset.declSign === declSign;
    b.className = 'set-decl-sign px-2.5 py-2 rounded-xl text-xs font-bold border ' +
      (on ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-slate-800 text-slate-300 border-slate-600');
  });
}
/** Aplica lo escrito en el campo de declinación junto con el sentido elegido (Este +, Oeste −) */
function applyDeclInput() {
  const input = document.getElementById('setDecl');
  const t = input.value.trim().replace(',', '.');
  if (t === '') { setDeclOverride(null); refreshSettingsUI(); applySettings(); return; }
  let v = parseFloat(t);
  if (/^[-−]/.test(t)) declSign = -1;        // con teclado externo también se acepta el signo
  v = declSign * Math.abs(v);
  if (!Number.isFinite(v) || Math.abs(v) > 40) {
    toast({ type: 'error', title: 'Valor inválido', message: 'Ingresá un número entre 0 y 40 y elegí Este u Oeste.' });
    return refreshSettingsUI();
  }
  setDeclOverride(v);
  refreshSettingsUI(); applySettings();
}
function openSettings() { refreshSettingsUI(); document.getElementById('settingsModal').classList.remove('hidden'); }
function closeSettings() { document.getElementById('settingsModal').classList.add('hidden'); }
function initSettingsUI() {
  document.getElementById('settingsBtn').onclick = openSettings;
  document.getElementById('closeSettingsBtn').onclick = closeSettings;
  document.getElementById('settingsModal').onclick = (e) => { if (e.target.id === 'settingsModal') closeSettings(); };
  document.querySelectorAll('.set-units').forEach(b => b.onclick = () => {
    settings.units = b.dataset.units; saveSettings(); refreshSettingsUI(); applySettings();
  });
  document.getElementById('setCoords').onchange = (e) => {
    settings.coords = e.target.value; saveSettings(); refreshSettingsUI(); applySettings();
  };
  document.getElementById('setDecl').onchange = applyDeclInput;
  document.querySelectorAll('.set-decl-sign').forEach(b => b.onclick = () => {
    declSign = +b.dataset.declSign;
    updateDeclSignUI();
    if (document.getElementById('setDecl').value.trim() !== '') applyDeclInput();  // con campo vacío solo cambia el sentido para lo que se escriba
  });
  document.getElementById('setDeclAuto').onclick = () => { setDeclOverride(null); refreshSettingsUI(); applySettings(); };
  document.getElementById('setGpsAcc').onchange = (e) => { settings.gpsMaxAcc = +e.target.value; saveSettings(); };
  document.getElementById('setGpsStep').onchange = (e) => { settings.gpsMinStep = +e.target.value; saveSettings(); };
  document.getElementById('setReset').onclick = () => {
    settings = { ...DEFAULT_SETTINGS }; saveSettings(); setDeclOverride(null);
    refreshSettingsUI(); applySettings();
    toast({ type: 'success', title: 'Ajustes restablecidos', duration: 1800 });
  };
}

// ========== BORRADOR AUTOMÁTICO ==========
const DRAFT_KEY = 'medidor_draft';
let draftTimer = null;
let draftPending = false; // mientras se decide si recuperar, no se toca el borrador guardado
function readDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!d || !Array.isArray(d.points)) return null;
    const pts = d.points.filter(p => p && Number.isFinite(+p.lat) && Number.isFinite(+p.lng) && Math.abs(+p.lat) <= 90 && Math.abs(+p.lng) <= 180)
                        .map(p => ({ lat: +p.lat, lng: +p.lng }));
    if (pts.length < 2) return null;
    return { points: pts, mode: d.mode === 'line' ? 'line' : 'polygon', color: safeColor(d.color), editingId: d.editingId || null, ts: +d.ts || 0 };
  } catch (e) { return null; }
}
function saveDraft() {
  draftTimer = null;
  if (draftPending) return;
  try {
    if (isLocked || poiMode) return; // no pisar el borrador mientras se consulta o se cargan POI
    if (points.length < 2) { localStorage.removeItem(DRAFT_KEY); return; }
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      points: points.map(p => ({ lat: p.lat, lng: p.lng })),
      mode, color: themeColor, editingId: editingId || null, ts: Date.now()
    }));
  } catch (e) {}
}
function scheduleDraftSave() {
  if (draftPending) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 600);
}
function clearDraft() {
  clearTimeout(draftTimer); draftTimer = null;
  try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
}
function agoText(ts) {
  if (!ts) return '';
  const min = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}
function restoreDraft(d) {
  const item = d.editingId ? saved.find(s => s.id === d.editingId) : null;
  if (item) { editingId = item.id; removeLockedLayer(item.id); } else { editingId = null; }
  isLocked = false;
  setDrawingActive(true);
  updateLockUI();
  setMode(d.mode);
  themeColor = d.color;
  document.documentElement.style.setProperty('--theme-color', themeColor);
  applyLabelTint(themeColor);
  document.querySelectorAll('.color-swatch').forEach(b => b.classList.toggle('active', b.dataset.color === themeColor));
  points = d.points.map(p => L.latLng(p.lat, p.lng));
  rebuildMarkers();
  redraw();
  resetHistory();
  pushHistory();
  map.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lng])), { padding: [60, 60], maxZoom: 18 });
}
function checkDraft() {
  const d = readDraft();
  if (!d) { draftPending = false; clearDraft(); return; }
  draftPending = true;
  const item = d.editingId ? saved.find(s => s.id === d.editingId) : null;
  const kind = d.mode === 'polygon' ? 'superficie' : 'distancia';
  document.getElementById('draftModalText').textContent =
    `Quedó una medición de ${kind} con ${d.points.length} puntos ${agoText(d.ts)}` +
    (item ? `, editando "${item.name}"` : '') + '. ¿Querés recuperarla?';
  const modal = document.getElementById('draftModal');
  modal.classList.remove('hidden');
  document.getElementById('draftRestoreBtn').onclick = () => {
    modal.classList.add('hidden');
    draftPending = false;
    restoreDraft(d);
    toast({ type: 'success', title: 'Medición recuperada', message: 'Revisala y tocá Guardar cuando termines.', duration: 3000 });
  };
  document.getElementById('draftDiscardBtn').onclick = () => {
    modal.classList.add('hidden');
    draftPending = false;
    clearDraft();
  };
}
// iOS puede descartar la pestaña al pasar a segundo plano: guardar en ese momento
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { clearTimeout(draftTimer); saveDraft(); } });
window.addEventListener('pagehide', () => { clearTimeout(draftTimer); saveDraft(); });

// ========== ICONS ==========
function vertexIcon(dr = false, locked = false) {
  let cls = 'vertex-marker';
  if (dr) cls += ' dragging';
  else if (locked) cls += ' locked';
  else if (gpsWatchId !== null) cls += ' recording';
  const recording = !dr && !locked && gpsWatchId !== null;
  return L.divIcon({
    className: cls,
    iconSize: dr ? [64, 64] : (recording ? [10, 10] : [22, 22]),
    iconAnchor: dr ? [32, 32] : (recording ? [5, 5] : [11, 11])
  });
}
const midIcon = L.divIcon({ className: 'midpoint-marker', iconSize: [18, 18], iconAnchor: [9, 9] });
const touchIcon = L.divIcon({ className: 'touch-dot', iconSize: [16, 16], iconAnchor: [8, 8] });
const kinkIcon = L.divIcon({ className: 'kink-marker', iconSize: [22, 22], iconAnchor: [11, 11] });

// ========== TOASTS ==========
function toast({ type = 'info', title = '', message = '', duration = 3500, actions = [] }) {
  const container = document.getElementById('toastContainer');
  if (!actions.length) {
    [...container.children].forEach(c => c.remove());
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const iconName = { success: 'check-circle-2', warning: 'alert-triangle', error: 'alert-circle', info: 'info' }[type] || 'info';
  const icon = document.createElement('i');
  icon.setAttribute('data-lucide', iconName);
  icon.className = 'toast-icon';
  el.appendChild(icon);
  const body = document.createElement('div');
  body.className = 'toast-body';
  if (title) {
    const t = document.createElement('div');
    t.className = 'toast-title';
    t.textContent = title;
    body.appendChild(t);
  }
  if (message) {
    const m = document.createElement('div');
    m.textContent = message;
    body.appendChild(m);
  }
  if (actions.length) {
    const wrap = document.createElement('div');
    wrap.className = 'toast-actions';
    actions.forEach(a => {
      const btn = document.createElement('button');
      btn.className = `toast-btn ${a.style === 'danger' ? 'toast-btn-danger' : a.style === 'secondary' ? 'toast-btn-secondary' : 'toast-btn-primary'}`;
      btn.textContent = a.label;
      btn.onclick = () => { dismissToast(el); a.onClick && a.onClick(); };
      wrap.appendChild(btn);
    });
    body.appendChild(wrap);
  }
  el.appendChild(body);
  container.appendChild(el);
  lucide.createIcons();
  if (duration > 0 && !actions.length) setTimeout(() => dismissToast(el), duration);
  return el;
}
function dismissToast(el) {
  if (!el || !el.parentNode) return;
  el.classList.add('leaving');
  setTimeout(() => el.remove(), 200);
}
function confirmToast({ title, message = '', confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false }) {
  return new Promise(resolve => {
    let resolved = false;
    const done = (v) => { if (!resolved) { resolved = true; resolve(v); } };
    const el = toast({ type: danger ? 'warning' : 'info', title, message, duration: 0,
      actions: [
        { label: cancelLabel, style: 'secondary', onClick: () => done(false) },
        { label: confirmLabel, style: danger ? 'danger' : 'primary', onClick: () => done(true) }
      ]
    });
    if (el) {
      el.style.position = 'fixed';
      el.style.left = '16px';
      el.style.right = '16px';
      el.style.bottom = 'max(24px, env(safe-area-inset-bottom))';
      el.style.zIndex = '70';
      document.body.appendChild(el);
    }
    setTimeout(() => done(false), 20000);
  });
}

// ========== INIT ==========
function init() {
  loadSettings();
  draftPending = !!readDraft(); // protege el borrador hasta resolver si se recupera
  document.documentElement.style.setProperty('--theme-color', themeColor);
  applyLabelTint(themeColor);

  // Vista inicial: última conocida o BA; luego se centra en GPS si está disponible
  let startLat = -34.6037, startLng = -58.3816, startZoom = 15;
  try {
    const raw = localStorage.getItem('medidor_last_view');
    if (raw) {
      const v = JSON.parse(raw);
      if (typeof v.lat === 'number' && typeof v.lng === 'number') { startLat = v.lat; startLng = v.lng; }
      if (typeof v.zoom === 'number') startZoom = v.zoom;
    }
  } catch (e) {}

  map = L.map('map', { zoomControl: false, attributionControl: true, tapTolerance: 25, maxZoom: 22 })
    .setView([startLat, startLng], startZoom);
  map.attributionControl.setPrefix('');
  tileLayer = L.tileLayer(tiles.esri.url, { maxZoom: 22, maxNativeZoom: tiles.esri.nativeZoom, attribution: tiles.esri.attr }).addTo(map);

  // Ubicación del dispositivo: punto azul + centrar al iniciar
  startUserLocationWatch(true);

  const saveMapView = () => {
    try {
      const c = map.getCenter();
      localStorage.setItem('medidor_last_view', JSON.stringify({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }));
    } catch (e) {}
  };
  map.on('moveend', saveMapView);
  map.on('zoomend', saveMapView);

  map.on('click', (e) => {
    if (dragging || isLocked || closePromptOpen) return;
    if (inspectItem) return;
    if (navPoi) { stopNav(); return; }
    if (appView === 'ver') return; // modo Ver: el mapa no agrega puntos
    if (poiMode) {
      openPoiModal(e.latlng);
      return;
    }
    if (trackMode) {
      const now = Date.now();
      if (now - lastPauseToastAt > 3500) {
        lastPauseToastAt = now;
        toast({ type: 'info', title: 'Modo recorrido', message: 'Los puntos se agregan solos al grabar. Tocá Iniciar grabación.', duration: 2200 });
      }
      return;
    }
    if (!drawingActive) {
      const now = Date.now();
      if (now - lastPauseToastAt > 2500) {
        lastPauseToastAt = now;
        toast({ type: 'info', title: 'Medición en pausa', message: 'Tocá «Nueva medición» para empezar a agregar puntos.', duration: 2200 });
      }
      return;
    }
    addPoint(e.latlng);
  });

  map.on('zoomend', () => {
    if (inspectItem) refreshInspectOverlays();
    else if (points.length >= 2 && !dragging) redraw();
  });
  map.on('moveend', () => {
    if (inspectItem) refreshInspectOverlays();
  });

  window.addEventListener('pointermove', onPointerMove, { passive: false, capture: true });
  window.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
  window.addEventListener('pointerup', endDrag, { capture: true });
  window.addEventListener('pointercancel', endDrag, { capture: true });
  window.addEventListener('touchend', endDrag, { capture: true });
  window.addEventListener('touchcancel', endDrag, { capture: true });
  window.addEventListener('beforeunload', stopGpsTracking);
  window.addEventListener('pagehide', stopGpsTracking);

  document.getElementById('modePolyBtn').onclick = () => { if (!isLocked) setMode('polygon'); };
  document.getElementById('modeLineBtn').onclick = () => { if (!isLocked) setMode('line'); };
  document.getElementById('modePoiBtn').onclick = () => { if (!isLocked) enterPoiMode(); };
  document.getElementById('modeTrackBtn').onclick = enterTrackMode;
  document.getElementById('trackPauseBtn').onclick = () => {
    const ph = trackPhase();
    if (ph === 'rec') {
      stopGpsTracking({ keepMode: true, noClose: true });
      toast({ type: 'info', title: 'Grabación en pausa', message: 'Tocá Reanudar para seguir sumando puntos.', duration: 2200 });
    } else if (ph === 'paused') startGpsRecording();
  };
  document.getElementById('trackStopBtn').onclick = () => {
    const ph = trackPhase();
    if (ph !== 'rec' && ph !== 'paused') return;
    trackEnded = true;
    if (ph === 'rec') stopGpsTracking({ keepMode: true });
    else { refreshTrackBar(); updateSessionButtons(); }
    toast({ type: 'info', title: 'Recorrido detenido', message: 'Guardalo o empezá una nueva medición.', duration: 2400 });
  };
  document.getElementById('undoBtn').onclick = undo;
  document.getElementById('redoBtn').onclick = redo;
  document.getElementById('clearBtn').onclick = () => {
    if (clearConfirmOpen) return;
    if (isLocked) {
      const now = Date.now();
      if (now - lastPauseToastAt > 3500) {
        lastPauseToastAt = now;
        toast({ type: 'warning', title: 'Medición bloqueada', message: 'Entrá en Editar para modificarla.' });
      }
      return;
    }
    if (!points.length && !(poiMode && poiSession.length)) return;
    clearConfirmOpen = true;
    const poiClear = poiMode && poiSession.length > 0;
    confirmToast({
      title: poiClear ? '¿Limpiar POI de esta sesión?' : '¿Limpiar medición?',
      message: poiClear ? 'Se borrarán los POI colocados ahora.' : 'Se borrarán todos los puntos actuales.',
      confirmLabel: 'Limpiar',
      danger: true
    }).then(ok => {
        clearConfirmOpen = false;
        if (!ok) return;
        if (poiClear) clearPoiSession();
        else clearActiveMeasurement({ keepDrawing: drawingActive });
      });
  };
  document.getElementById('saveBtn').onclick = () => {
    pulseButton('saveBtn');
    // En recorrido: si se está grabando, Guardar detiene la grabación y abre el guardado
    if (trackMode && gpsWatchId !== null && points.length >= 2) stopGpsTracking({ keepMode: true });
    openSaveModal();
  };
  document.getElementById('newBtn').onclick = () => {
    if (isLocked) return toast({ type: 'warning', title: 'Medición bloqueada', message: 'Entrá en Editar para modificarla.' });
    if (trackMode) return newTrack();
    stopGpsTracking();
    clearActiveMeasurement({ keepDrawing: true });
    setDrawingActive(true);
    pulseButton('newBtn');
    toast({ type: 'success', title: 'Nueva medición', message: 'Tocá el mapa para agregar puntos.', duration: 2200 });
  };
  document.getElementById('layerBtn').onclick = cycleLayer;
  document.getElementById('locateBtn').onclick = locateMe;
  document.getElementById('savedBtn').onclick = openSaved;
  document.getElementById('poiBtn').onclick = openPoiDrawer;
  document.getElementById('poiPlaceHeaderBtn').onclick = () => {
    if (!poiMode || !map) return;
    pulseButton('poiPlaceHeaderBtn');
    const ll = poiAimLatLng();
    const el = document.getElementById('poiCrosshair');
    const r = el ? el.getBoundingClientRect() : null;
    if (r && r.width) {
      const pin = document.createElement('div');
      pin.className = 'poi-drop';
      pin.style.left = (r.left + r.width / 2 - 11) + 'px';
      pin.style.top = (r.top + r.height / 2 - 34) + 'px';
      pin.innerHTML = `<svg viewBox="0 0 22 34" width="22" height="34"><path d="M11 33.2 C11 33.2 1.4 20.2 1.4 12.4 C1.4 6.4 5.6 1.6 11 1.6 C16.4 1.6 20.6 6.4 20.6 12.4 C20.6 20.2 11 33.2 11 33.2 Z" fill="${safeColor(poiColor, '#f59e0b')}" stroke="#fff" stroke-width="1.6"/><circle cx="11" cy="12.2" r="3.2" fill="#fff"/></svg>`;
      document.body.appendChild(pin);
      setTimeout(() => pin.remove(), 1500);
    }
    setTimeout(() => openPoiModal(ll), 880);
  };
  document.getElementById('poiDoneBtn').onclick = () => {
    if (!poiMode || !poiSession.length) return;
    exitPoiMode(false);
    setMode('polygon');
    toast({ type: 'success', title: 'POI listo', message: 'Saliste del modo POI.', duration: 1600 });
  };
  map.on('move', updatePoiCenterCoords);
  map.on('zoom', updatePoiCenterCoords);
document.getElementById('closePoiBtn').onclick = (e) => { e.preventDefault(); e.stopPropagation(); document.getElementById('poiDrawer').classList.add('hidden'); };
  document.getElementById('poiDrawer').onclick = (e) => { if (e.target.id === 'poiDrawer') { document.getElementById('poiDrawer').classList.add('hidden'); } };
  const poiPanel = document.getElementById('poiDrawerPanel');
  if (poiPanel) poiPanel.onclick = (e) => e.stopPropagation();
  document.getElementById('cancelPoiBtn').onclick = () => {
    pendingPoi = null;
    editingPoiId = null;
    document.getElementById('poiModal').classList.add('hidden');
    if (poiMode) setPoiAim(true);
  };
  document.querySelectorAll('.poi-color').forEach(btn => {
    btn.onclick = () => {
      poiColor = btn.dataset.color;
      document.querySelectorAll('.poi-color').forEach(b => b.style.borderColor = b === btn ? '#fff' : 'transparent');
    };
  });
  document.getElementById('confirmPoiBtn').onclick = confirmPoi;
  document.getElementById('deletePoiBtn').onclick = () => {
    if (!editingPoiId) return;
    const id = editingPoiId;
    editingPoiId = null;
    pendingPoi = null;
    document.getElementById('poiModal').classList.add('hidden');
    deletePoi(id);
  };
  document.getElementById('poiCopyCoordsBtn').onclick = () => {
    const t = document.getElementById('poiCoordsText');
    const btn = document.getElementById('poiCopyCoordsBtn');
    if (!t || !btn) return;
    const show = () => {
      const r = btn.getBoundingClientRect();
      const tip = document.createElement('div');
      tip.textContent = 'Copiado';
      tip.style.cssText = `position:fixed;left:${r.left}px;top:${r.top - 28}px;z-index:60;background:rgba(15,23,42,0.95);color:#fff;font-size:11px;font-weight:700;padding:4px 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.25);pointer-events:none;`;
      document.body.appendChild(tip);
      setTimeout(() => tip.remove(), 1200);
    };
    navigator.clipboard?.writeText(t.dataset.dec || t.textContent || '').then(show, show);
  };
  document.getElementById('closeSavedBtn').onclick = (e) => { e.preventDefault(); e.stopPropagation(); document.getElementById('savedDrawer').classList.add('hidden'); };
  document.getElementById('savedDrawer').onclick = (e) => { if (e.target.id === 'savedDrawer') { document.getElementById('savedDrawer').classList.add('hidden'); } };
  const savedPanel = document.getElementById('savedDrawerPanel');
  if (savedPanel) savedPanel.onclick = (e) => e.stopPropagation();
  document.getElementById('cancelSaveBtn').onclick = () => document.getElementById('saveModal').classList.add('hidden');
  document.getElementById('confirmSaveBtn').onclick = confirmSave;
  document.getElementById('poiNameClear').onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    const i = document.getElementById('poiNameInput');
    if (i) { i.value = ''; i.focus(); }
  };
  document.getElementById('saveNameClear').onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    const i = document.getElementById('saveNameInput');
    if (i) { i.value = ''; i.focus(); }
  };
  document.getElementById('infoCloseBtn').onclick = hideMeasurementInfo;
  document.getElementById('infoBackdrop').onclick = hideMeasurementInfo;
  document.getElementById('infoToggleSegs').onclick = () => {
    inspectShowSegs = true; inspectShowBearings = false; inspectShowAngles = false; inspectShowCoords = false;
    updateInfoToggleUI(); refreshInspectOverlays();
  };
  document.getElementById('infoToggleBearings').onclick = () => {
    inspectShowSegs = false; inspectShowBearings = true; inspectShowAngles = false; inspectShowCoords = false;
    updateInfoToggleUI(); refreshInspectOverlays();
  };
  document.getElementById('infoToggleAngles').onclick = () => {
    inspectShowSegs = false; inspectShowBearings = false; inspectShowAngles = true; inspectShowCoords = false;
    updateInfoToggleUI(); refreshInspectOverlays();
  };
  document.getElementById('infoToggleCoords').onclick = () => {
    inspectShowSegs = false; inspectShowBearings = false; inspectShowAngles = false; inspectShowCoords = true;
    updateInfoToggleUI(); refreshInspectOverlays();
  };
  document.getElementById('exportBtn').onclick = exportGeoJSON;
  document.getElementById('importInput').onchange = importGeoJSON;

  document.querySelectorAll('.color-swatch').forEach(btn => {
    btn.onclick = () => {
      if (isLocked) return toast({ type: 'warning', title: 'Medición bloqueada', message: 'Entrá en Editar para cambiar el estilo.' });
      document.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (poiMode) {
        poiColor = btn.dataset.color;
        themeColor = btn.dataset.color;
      } else {
        themeColor = btn.dataset.color;
        poiColor = btn.dataset.color;
        document.documentElement.style.setProperty('--theme-color', themeColor);
        applyLabelTint(themeColor);
        redraw();
      }
    };
  });

  const searchInput = document.getElementById('searchInput');
  const clearBtn = document.getElementById('clearSearchBtn');
  const searchBox = document.getElementById('searchResults');
  let searchTimer = null;
  searchInput.oninput = () => {
    const q = searchInput.value.trim();
    clearBtn.classList.toggle('hidden', !q);
    clearTimeout(searchTimer);
    if (q.length < 3) { searchSeq++; searchBox.classList.add('hidden'); return; }
    searchTimer = setTimeout(() => doSearch(q), 600);
  };
  searchInput.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = searchInput.value.trim();
    clearTimeout(searchTimer);
    if (q.length >= 2) { searchInput.blur(); doSearch(q); }
  };
  clearBtn.onclick = () => {
    searchInput.value = '';
    searchSeq++;
    clearBtn.classList.add('hidden');
    searchBox.classList.add('hidden');
    clearGotoMarker();
  };
  // Tocar fuera del buscador cierra la lista de resultados
  document.addEventListener('pointerdown', (e) => {
    if (!searchBox.classList.contains('hidden') && !searchInput.closest('.relative').contains(e.target)) searchBox.classList.add('hidden');
  });
  initCoordUI();
  initProfileUI();

  loadSaved();
  loadPois();
  initSettingsUI();
  applySettings();
  updateLockUI();
  setTimeout(checkDraft, 700);

  setDrawingActive(false);
  updateLockUI();
  document.getElementById('viewVerBtn').onclick = () => onViewSwitch('ver');
  document.getElementById('viewMedirBtn').onclick = () => onViewSwitch('medir');
  document.getElementById('viewHintOk').onclick = () => hideViewHint(true);
  applyAppView(); // arranca en Medir
  checkAppVersion();
  setTimeout(checkBackupReminder, 3500);
  setTimeout(showViewHint, 900);
  updateModeTheme();
}

// ========== LOCK UI ==========
/** Detecta archivos de distintas versiones (p. ej. se subió app.js nuevo pero no index.html) */
function checkAppVersion() {
  try {
    const html = document.querySelector('meta[name="app-version"]')?.content || '';
    const css = getComputedStyle(document.documentElement).getPropertyValue('--app-version').replace(/["'\s]/g, '');
    const bad = [];
    if (html !== APP_VERSION) bad.push('index.html');
    if (css !== APP_VERSION) bad.push('styles.css');
    if (bad.length) {
      toast({ type: 'warning', title: 'Actualización incompleta', message: `Falta actualizar ${bad.join(' y ')} (la app es ${APP_VERSION}). Subí index.html, styles.css y app.js juntos y recargá.`, duration: 15000 });
    }
  } catch (e) {}
}

function updateSaveBtnLabel() {
  const label = document.getElementById('saveBtnLabel');
  const btn = document.getElementById('saveBtn');
  if (!label || !btn) return;
  if (editingId) {
    label.textContent = 'Guardar cambios';
    btn.setAttribute('aria-label', 'Guardar cambios');
    btn.title = 'Guardar los cambios de esta medición';
  } else {
    label.textContent = 'Guardar medición';
    btn.setAttribute('aria-label', 'Guardar medición');
    btn.title = 'Guardar medición';
  }
}

function updateLockUI() {
  // Nueva siempre habilitada (sirve para arrancar o reiniciar)
  ['modePolyBtn', 'modeLineBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = isLocked;
  });
  const newBtn = document.getElementById('newBtn');
  if (newBtn) newBtn.disabled = false;
  document.querySelectorAll('.color-swatch').forEach(b => b.disabled = isLocked);
  updateSaveBtnLabel();
  updateClearBtnState();
  updateSessionButtons();
  updateUndoRedoUI();
  updateDrawingUI();
}

/** Guardar y recorrido GPS: solo activos con medición iniciada (Nueva o Editar) */
function updateSessionButtons() {
  try { updateLiveBadge(); } catch (e) {}
  const saveBtn = document.getElementById('saveBtn');
  const gpsBtn = document.getElementById('modeTrackBtn');
  if (saveBtn) {
    const recording = trackMode && gpsWatchId !== null;
    const canSave = !isLocked && points.length >= 2 && (drawingActive || trackMode) && !recording;
    saveBtn.disabled = !canSave;
    saveBtn.title = canSave
      ? (editingId ? 'Guardar los cambios de esta medición' : 'Guardar medición')
      : (recording ? 'Pausá o detené la grabación para guardar' : 'Agregá al menos 2 puntos para guardar');
    saveBtn.classList.toggle('opacity-35', !canSave);
  }
  updateTrackButtons();
  if (gpsBtn && gpsWatchId === null) {
    gpsBtn.disabled = isLocked;
    gpsBtn.title = isLocked
      ? 'Medición bloqueada'
      : 'Grabar recorrido GPS (agrega puntos al caminar)';
    gpsBtn.classList.toggle('opacity-35', isLocked);
  }
}

/** Tacho: solo activo si hay puntos de una medición en curso (sin guardar) */
function updateClearBtnState() {
  const clearBtn = document.getElementById('clearBtn');
  if (!clearBtn) return;
  const canClear = !isLocked && (points.length > 0 || (poiMode && poiSession.length > 0));
  clearBtn.disabled = !canClear;
  clearBtn.title = canClear
    ? (poiMode ? 'Limpiar los POI de esta sesión' : 'Limpiar la medición en curso')
    : (poiMode ? 'No hay POI de esta sesión' : 'Solo borra la medición en curso (no hay puntos)');
  clearBtn.classList.toggle('opacity-35', !canClear);
}

// ========== DRAG ==========
function startDrag(index, e) {
  if (isLocked || appView === 'ver') { e.preventDefault(); e.stopPropagation(); return; }
  e.preventDefault(); e.stopPropagation();
  if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  dragging = true;
  dragIndex = index;
  document.body.classList.add('is-dragging');
  map.dragging.disable(); map.touchZoom.disable(); map.doubleClickZoom.disable(); map.scrollWheelZoom.disable();
  if (markers[index]) markers[index].setIcon(vertexIcon(true));
  const touch = e.touches ? e.touches[0] : e;
  if (touch && touch.clientX != null && points[index]) {
    const rect = map.getContainer().getBoundingClientRect();
    const touchX = touch.clientX - rect.left;
    const touchY = touch.clientY - rect.top;
    const markerPx = map.latLngToContainerPoint(points[index]);
    dragGrabOffsetX = markerPx.x - touchX;
    dragGrabOffsetY = markerPx.y - touchY;
    dragStartFinger = { x: touchX, y: touchY };
    updateDragVisuals(touchX, touchY, points[index]);
    updateLiveSegmentLabels();
    startOffsetEase();
  }
}
function startOffsetEase() {
  if (dragAnim) cancelAnimationFrame(dragAnim);
  const fromX = dragGrabOffsetX, fromY = dragGrabOffsetY, toX = 0, toY = -OFFSET;
  const t0 = performance.now(), dur = 400;
  function frame(now) {
    if (!dragging) return;
    const t = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - t, 3);
    dragGrabOffsetX = fromX + (toX - fromX) * e;
    dragGrabOffsetY = fromY + (toY - fromY) * e;
    if (dragStartFinger) {
      const tx = dragStartFinger.x, ty = dragStartFinger.y;
      const target = map.containerPointToLatLng(L.point(tx + dragGrabOffsetX, ty + dragGrabOffsetY));
      if (dragIndex >= 0 && dragIndex < points.length) {
        points[dragIndex] = target;
        markers[dragIndex].setLatLng(target);
        updateDragVisuals(tx, ty, target);
        updateGeometry();
        updateLiveSegmentLabels();
      }
    }
    if (t < 1) dragAnim = requestAnimationFrame(frame);
    else { dragAnim = null; dragGrabOffsetX = toX; dragGrabOffsetY = toY; }
  }
  dragAnim = requestAnimationFrame(frame);
}
function updateDragVisuals(touchX, touchY, targetLatLng) {
  const finger = map.containerPointToLatLng(L.point(touchX, touchY));
  if (!guideLine) {
    guideLine = L.polyline([finger, targetLatLng], { color: themeColor, weight: 1.5, opacity: 0.45, dashArray: '3,3', interactive: false }).addTo(map);
  } else {
    guideLine.setLatLngs([finger, targetLatLng]);
    guideLine.setStyle({ color: themeColor });
  }
  if (!touchDot) touchDot = L.marker(finger, { icon: touchIcon, interactive: false }).addTo(map);
  else touchDot.setLatLng(finger);
}
function onPointerMove(e) { if (!dragging) return; e.preventDefault(); moveVertex(e.clientX, e.clientY); }
function onTouchMove(e) { if (!dragging || !e.touches.length) return; e.preventDefault(); moveVertex(e.touches[0].clientX, e.touches[0].clientY); }
function moveVertex(clientX, clientY) {
  if (dragIndex < 0 || dragIndex >= points.length) return;
  const rect = map.getContainer().getBoundingClientRect();
  const x = clientX - rect.left, y = clientY - rect.top;
  dragStartFinger = { x, y };
  const target = map.containerPointToLatLng(L.point(x + dragGrabOffsetX, y + dragGrabOffsetY));
  points[dragIndex] = target;
  markers[dragIndex].setLatLng(target);
  updateDragVisuals(x, y, target);
  updateGeometry();
  updateLiveSegmentLabels();
  // Imán visual al acercar un extremo al otro en modo distancia
  if (mode === 'line' && points.length >= 3 && (dragIndex === 0 || dragIndex === points.length - 1)) {
    const other = dragIndex === 0 ? points[points.length - 1] : points[0];
    if (target.distanceTo(other) <= closeThresholdMeters()) showCloseMagnet(other);
    else hideCloseMagnet();
  } else hideCloseMagnet();
}
function endDrag() {
  if (!dragging) return;
  dragging = false;
  document.body.classList.remove('is-dragging');
  if (dragAnim) { cancelAnimationFrame(dragAnim); dragAnim = null; }
  dragStartFinger = null;
  map.dragging.enable(); map.touchZoom.enable(); map.doubleClickZoom.enable(); map.scrollWheelZoom.enable();
  if (dragIndex >= 0 && markers[dragIndex]) markers[dragIndex].setIcon(vertexIcon(false));
  if (guideLine) { map.removeLayer(guideLine); guideLine = null; }
  if (touchDot) { map.removeLayer(touchDot); touchDot = null; }
  clearLiveSegmentLabels();
  hideCloseMagnet();
  const endedIndex = dragIndex;
  const last = history[historyIndex];
  const current = snapshotPoints();
  const moved = !last || JSON.stringify(last) !== JSON.stringify(current);
  dragIndex = -1;
  redraw();
  if (moved) pushHistory();
  // Imán de cierre: último o primer punto cerca del otro extremo en modo distancia
  if (mode === 'line' && points.length >= 3 && (endedIndex === points.length - 1 || endedIndex === 0)) {
    const a = points[0];
    const b = points[points.length - 1];
    if (a.distanceTo(b) <= closeThresholdMeters()) offerClosePolygon();
  }
}

// ========== LIVE LABELS ==========
function clearLiveSegmentLabels() { liveLabels.forEach(l => map.removeLayer(l)); liveLabels = []; }
function updateLiveSegmentLabels() {
  clearLiveSegmentLabels();
  const n = points.length;
  if (n < 2 || dragIndex < 0 || dragIndex >= n) return;
  const closed = mode === 'polygon' && n >= 3;

  // Distancias de segmentos adyacentes al vértice arrastrado
  const segments = [];
  if (closed) {
    segments.push([(dragIndex - 1 + n) % n, dragIndex]);
    segments.push([dragIndex, (dragIndex + 1) % n]);
  } else {
    if (dragIndex > 0) segments.push([dragIndex - 1, dragIndex]);
    if (dragIndex < n - 1) segments.push([dragIndex, dragIndex + 1]);
  }
  segments.forEach(([i, j]) => {
    const a = points[i], b = points[j];
    const dist = a.distanceTo(b);
    const distTxt = fmtLenShort(dist);
    let html = distTxt;
    let iconW = 70, iconH = 22;
    if (mode === 'line') {
      const brg = trueBearing(a, b);
      const decl = magneticDeclination((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
      const mag = magneticBearing(brg, decl);
      html = `<span style="line-height:1.2">${distTxt}<br><span style="font-size:11px">${brg0(brg)}° V · ${brg0(mag)}° M</span></span>`;
      iconW = 90; iconH = 36;
    }
    const aPx = map.latLngToContainerPoint(a), bPx = map.latLngToContainerPoint(b);
    const midPx = L.point((aPx.x + bPx.x) / 2, (aPx.y + bPx.y) / 2);
    const dx = bPx.x - aPx.x, dy = bPx.y - aPx.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const labelPx = L.point(midPx.x + (-dy / len) * 22, midPx.y + (dx / len) * 22);
    const labelLL = map.containerPointToLatLng(labelPx);
    const marker = L.marker(labelLL, {
      icon: L.divIcon({ className: 'dist-label-live', html, iconSize: [iconW, iconH], iconAnchor: [iconW / 2, iconH / 2] }),
      interactive: false, zIndexOffset: 1000
    }).addTo(map);
    liveLabels.push(marker);
  });

  // Ángulos de los vértices involucrados (el arrastrado + vecinos)
  if (n < 3) return;
  const angleIdxs = new Set([dragIndex]);
  if (closed) {
    angleIdxs.add((dragIndex - 1 + n) % n);
    angleIdxs.add((dragIndex + 1) % n);
  } else {
    if (dragIndex > 0) angleIdxs.add(dragIndex - 1);
    if (dragIndex < n - 1) angleIdxs.add(dragIndex + 1);
  }
  const ccwLive = closed ? polygonIsCCW(points) : true;

  angleIdxs.forEach(i => {
    // Ángulo interior real (puede superar 180° en vértices cóncavos)
    const info = vertexAngleInfo(points, i, closed, ccwLive);
    if (!info) return;
    const ang = info.deg;
    const prev = closed ? points[(i - 1 + n) % n] : (i > 0 ? points[i - 1] : null);
    const next = closed ? points[(i + 1) % n] : (i < n - 1 ? points[i + 1] : null);
    if (!prev || !next) return;

    const vPx = map.latLngToContainerPoint(points[i]);
    const pPx = map.latLngToContainerPoint(prev);
    const nPx = map.latLngToContainerPoint(next);
    const g = angleArcGeometry(vPx, pPx, nPx, ang);

    // Etiqueta sobre la bisectriz del arco (lado interior)
    const isMain = i === dragIndex;
    const offset = isMain ? 36 : 28;
    const labelPx = L.point(vPx.x + Math.cos(g.mid) * offset, vPx.y + Math.sin(g.mid) * offset);
    const labelLL = map.containerPointToLatLng(labelPx);
    const txt = `<span style="font-size:${isMain ? 13 : 11}px">${ang.toFixed(1)}°</span>`;
    const marker = L.marker(labelLL, {
      icon: L.divIcon({
        className: 'angle-label-live',
        html: txt,
        iconSize: [isMain ? 56 : 48, isMain ? 24 : 20],
        iconAnchor: [isMain ? 28 : 24, isMain ? 12 : 10]
      }),
      interactive: false,
      zIndexOffset: isMain ? 1100 : 1050
    }).addTo(map);
    liveLabels.push(marker);

    // Arco visual solo en el vértice que se arrastra
    if (isMain) {
      const ARC_R = 22;
      const steps = Math.max(6, Math.ceil(Math.abs(g.sweep) * 10 / Math.PI));
      const arcLatLngs = [];
      for (let s = 0; s <= steps; s++) {
        const angR = g.a1 + g.sweep * (s / steps);
        const px = L.point(vPx.x + Math.cos(angR) * ARC_R, vPx.y + Math.sin(angR) * ARC_R);
        arcLatLngs.push(map.containerPointToLatLng(px));
      }
      const arc = L.polyline(arcLatLngs, {
        color: '#fbbf24', weight: 2, opacity: 0.9, interactive: false, lineCap: 'round'
      }).addTo(map);
      liveLabels.push(arc);
    }
  });
}

// ========== BEARING / DECLINATION ==========
/** Rumbo geodésico (norte verdadero), 0–360° */
function trueBearing(from, to) {
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const dLng = (to.lng - from.lng) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/**
 * Declinación magnética (°). Este positivo = este.
 * Si el usuario cargó un valor manual (Ajustes), se usa ese.
 * Si no, se usa una ESTIMACIÓN regional muy gruesa ajustada a Buenos Aires
 * (~ -9,5°). Lejos de Buenos Aires, sobre todo en el sur patagónico, el error
 * puede ser de varios grados: para trabajo de campo cargar el valor real
 * del lugar (calculador NOAA/NCEI o IGRF) como valor manual.
 */
const DECL_KEY = 'medidor_decl_override';
function getDeclOverride() {
  try {
    const v = parseFloat(localStorage.getItem(DECL_KEY));
    return Number.isFinite(v) && Math.abs(v) <= 40 ? v : null;
  } catch (e) { return null; }
}
function setDeclOverride(v) {
  try {
    if (v === null) localStorage.removeItem(DECL_KEY);
    else localStorage.setItem(DECL_KEY, String(v));
  } catch (e) {}
}
function magneticDeclination(lat, lng) {
  const manual = getDeclOverride();
  if (manual !== null) return manual;
  if (lat >= -56 && lat <= -20 && lng >= -75 && lng <= -48) {
    const dLat = lat + 34.6;
    const dLng = lng + 58.4;
    return -9.5 + 0.18 * dLat - 0.06 * dLng - 0.004 * dLat * dLat;
  }
  return -10 * Math.sin(lng * Math.PI / 180) * Math.cos(lat * Math.PI / 180);
}

function magneticBearing(trueBrg, decl) {
  // Magnético = Verdadero − declinación (declinación este = positiva)
  return (trueBrg - decl + 360) % 360;
}

function brg0(deg) { return String(Math.round((((deg % 360) + 360) % 360)) % 360); }

function bearingCardinal(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
  const idx = Math.round(deg / 22.5) % 16;
  return dirs[idx];
}

// ========== HISTORY ==========
function snapshotPoints() { return points.map(p => ({ lat: p.lat, lng: p.lng })); }
function pushHistory() {
  history = history.slice(0, historyIndex + 1);
  history.push(snapshotPoints());
  historyIndex = history.length - 1;
  if (history.length > 50) { history.shift(); historyIndex--; }
  updateUndoRedoUI();
}
function applySnapshot(snap) {
  points = (snap || []).map(p => L.latLng(p.lat, p.lng));
  rebuildMarkers();
  redraw();
  updateUndoRedoUI();
}
function undo() {
  if (isLocked) return;
  if (poiMode) return undoPoi();
  if (historyIndex <= 0) { if (historyIndex === 0) { historyIndex = -1; applySnapshot([]); } return; }
  historyIndex--;
  applySnapshot(history[historyIndex]);
}
function redo() {
  if (isLocked) return;
  if (poiMode) return redoPoi();
  if (historyIndex >= history.length - 1) return;
  historyIndex++;
  applySnapshot(history[historyIndex]);
}
function resetHistory() { history = []; historyIndex = -1; updateUndoRedoUI(); }
function updateUndoRedoUI() {
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  if (poiMode) {
    const canUndo = !isLocked && poiSession.length > 0;
    const canRedo = !isLocked && poiSessionRedo.length > 0;
    if (undoBtn) {
      undoBtn.disabled = !canUndo;
      undoBtn.title = canUndo ? 'Deshacer último POI' : 'Nada para deshacer';
      undoBtn.style.opacity = canUndo ? '1' : '0.35';
    }
    if (redoBtn) {
      redoBtn.disabled = !canRedo;
      redoBtn.title = canRedo ? 'Rehacer POI' : 'Nada para rehacer';
      redoBtn.style.opacity = canRedo ? '1' : '0.35';
    }
    updateClearBtnState();
    return;
  }
  // Solo con medición en curso (puntos o historial de la sesión activa)
  const inSession = drawingActive || points.length > 0 || history.length > 0;
  const canUndo = !isLocked && inSession && historyIndex >= 0 &&
    (historyIndex > 0 || (history[0] && history[0].length > 0));
  const canRedo = !isLocked && inSession && historyIndex < history.length - 1;
  if (undoBtn) {
    undoBtn.disabled = !canUndo;
    undoBtn.title = canUndo ? 'Deshacer' : 'Nada para deshacer';
    undoBtn.style.opacity = canUndo ? '1' : '0.35';
  }
  if (redoBtn) {
    redoBtn.disabled = !canRedo;
    redoBtn.title = canRedo ? 'Rehacer' : 'Nada para rehacer';
    redoBtn.style.opacity = canRedo ? '1' : '0.35';
  }
}

// ========== POINTS ==========
function addPoint(latlng, insertAt = null) {
  if (isLocked) return;
  if (!drawingActive && !(trackMode && gpsWatchId !== null)) return;
  if (insertAt !== null) points.splice(insertAt, 0, latlng);
  else points.push(latlng);
  rebuildMarkers();
  redraw();
  pushHistory();
  updateClearBtnState();
  // Imán de cierre solo al agregar al final en modo distancia
  if (insertAt === null && mode === 'line' && points.length >= 3) {
    const last = points[points.length - 1];
    if (last.distanceTo(points[0]) <= closeThresholdMeters()) offerClosePolygon();
  }
}

/** Distancia (m) equivalente a ~32 px en el zoom actual — imán de cierre */
function closeThresholdMeters() {
  if (!map) return 8;
  const c = map.getCenter();
  const a = map.latLngToContainerPoint(c);
  const b = map.containerPointToLatLng(L.point(a.x + 32, a.y));
  return Math.max(4, c.distanceTo(b));
}

function showCloseMagnet(at) {
  if (!closeMagnet) {
    closeMagnet = L.circleMarker(at, {
      radius: 18, color: '#fbbf24', weight: 2, opacity: 0.95,
      fillColor: '#fbbf24', fillOpacity: 0.18, interactive: false
    }).addTo(map);
  } else {
    closeMagnet.setLatLng(at);
  }
}
function hideCloseMagnet() {
  if (closeMagnet) { map.removeLayer(closeMagnet); closeMagnet = null; }
}

async function offerClosePolygon() {
  if (closePromptOpen || mode !== 'line' || points.length < 3) return;
  closePromptOpen = true;
  hideCloseMagnet();
  const ok = await confirmToast({
    title: '¿Cerrar polígono?',
    message: 'El extremo está cerca del inicio. ¿Querés cerrar polígono y pasar a Superficie?',
    confirmLabel: 'Cerrar polígono',
    cancelLabel: 'Seguir en modo distancia'
  });
  closePromptOpen = false;
  if (!ok || mode !== 'line' || points.length < 3) return;
  // Quitar el punto casi coincidente con el inicio para no dejar un segmento de 0 m
  const last = points[points.length - 1];
  if (last.distanceTo(points[0]) <= closeThresholdMeters()) points.pop();
  if (points.length < 3) return;
  rebuildMarkers();
  setMode('polygon');
  pushHistory();
  toast({ type: 'success', title: 'Polígono cerrado', message: 'Pasó a modo Superficie.', duration: 2200 });
}
function rebuildMarkers() {
  markers.forEach(m => map.removeLayer(m));
  markers = [];
  points.forEach((ll, idx) => {
    const m = L.marker(ll, { icon: vertexIcon(false, isLocked), draggable: false, keyboard: false }).addTo(map);
    const attachHandlers = () => {
      const iconEl = m.getElement();
      if (!iconEl) return;
      iconEl.style.touchAction = 'none';
      const handler = (e) => startDrag(idx, e);
      iconEl.addEventListener('pointerdown', handler, { passive: false });
      iconEl.addEventListener('touchstart', handler, { passive: false });
      iconEl.addEventListener('mousedown', handler, { passive: false });
    };
    // getElement() puede ser null justo después de addTo; reintentar en el próximo frame
    if (m.getElement()) attachHandlers();
    else {
      m.once('add', () => requestAnimationFrame(attachHandlers));
      requestAnimationFrame(attachHandlers);
    }
    markers.push(m);
  });
}

// ========== DRAW ==========
function updateGeometry() {
  if (polyLayer) map.removeLayer(polyLayer);
  if (lineLayer) map.removeLayer(lineLayer);
  polyLayer = lineLayer = null;
  if (points.length < 2) { updateMetrics(0, 0); clearKinkMarkers(); updateSelfIntersectWarning(false); return; }
  if (mode === 'polygon') {
    lineLayer = L.polyline(points, { color: themeColor, weight: 3 }).addTo(map);
    if (points.length >= 3) polyLayer = L.polygon(points, { color: themeColor, fillColor: themeColor, fillOpacity: 0.22, weight: 3 }).addTo(map);
    calcPolygon();
  } else {
    lineLayer = L.polyline(points, { color: themeColor, weight: 4 }).addTo(map);
    calcLine();
  }
}
function redraw() {
  scheduleDraftSave();
  midMarkers.forEach(m => map.removeLayer(m));
  labels.forEach(l => map.removeLayer(l));
  midMarkers = []; labels = [];
  updateGeometry();
  const n = points.length;
  updateClearBtnState();
  updateSessionButtons();
  if (n < 2) return;
  // Durante la grabación GPS: solo la línea y puntos chicos, sin etiquetas
  if (gpsWatchId !== null) return;
  const segmentCount = (mode === 'polygon' && n >= 3) ? n : n - 1;
  for (let i = 0; i < segmentCount; i++) {
    const a = points[i], b = points[(i + 1) % n];
    const dist = a.distanceTo(b);
    const aPx = map.latLngToContainerPoint(a), bPx = map.latLngToContainerPoint(b);
    const midPx = L.point((aPx.x + bPx.x) / 2, (aPx.y + bPx.y) / 2);
    const dx = bPx.x - aPx.x, dy = bPx.y - aPx.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const labelPx = L.point(midPx.x + (-dy / len) * 18, midPx.y + (dx / len) * 18);
    const labelLL = map.containerPointToLatLng(labelPx);
    const midLL = map.containerPointToLatLng(midPx);
    const distTxt = fmtLenShort(dist);
    const zDraw = map.getZoom();
    const scaleDraw = Math.pow(1.18, zDraw - 15);
    const fontDraw = Math.max(9, Math.min(18, 10.5 * scaleDraw));
    let html, iconW, iconH;
    if (mode === 'line') {
      const brg = trueBearing(a, b);
      const decl = magneticDeclination((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
      const mag = magneticBearing(brg, decl);
      html = `<span style="font-size:${fontDraw}px;line-height:1.2">${distTxt}<br><span style="font-size:${Math.max(8, fontDraw * 0.85)}px;opacity:0.95">${brg0(brg)}° V · ${brg0(mag)}° M</span></span>`;
      iconW = Math.round(fontDraw * 7.5);
      iconH = Math.round(fontDraw * 2.8);
    } else {
      html = `<span style="font-size:${fontDraw}px">${distTxt}</span>`;
      iconW = Math.round(fontDraw * 4.2);
      iconH = Math.round(fontDraw * 1.5);
    }
    const label = L.marker(labelLL, {
      icon: L.divIcon({
        className: 'dist-label',
        html,
        iconSize: [iconW, iconH],
        iconAnchor: [Math.round(iconW / 2), Math.round(iconH / 2)]
      }),
      interactive: false
    }).addTo(map);
    labels.push(label);
    if (!isLocked && appView === 'medir') {
      const mid = L.marker(midLL, { icon: midIcon }).addTo(map);
      mid.on('click', (e) => { L.DomEvent.stopPropagation(e); if (isLocked) return; addPoint(midLL, i + 1); });
      midMarkers.push(mid);
    }
  }
}
function calcPolygon() {
  if (points.length < 3) {
    updateMetrics(0, points.length === 2 ? points[0].distanceTo(points[1]) : 0);
    updateSelfIntersectWarning(false);
    clearKinkMarkers();
    return;
  }
  try {
    const coords = points.map(p => [p.lng, p.lat]);
    coords.push(coords[0]);
    const area = turf.area(turf.polygon([coords]));
    let perim = 0;
    for (let i = 0; i < points.length; i++) perim += points[i].distanceTo(points[(i + 1) % points.length]);
    updateMetrics(area, perim);
    const kinks = turf.kinks(turf.polygon([coords]));
    if (kinks && kinks.features && kinks.features.length > 0) {
      updateSelfIntersectWarning(true);
      drawKinkMarkers(kinks.features);
    } else {
      updateSelfIntersectWarning(false);
      clearKinkMarkers();
    }
  } catch (e) { updateMetrics(0, 0); }
}
function calcLine() {
  let d = 0;
  for (let i = 0; i < points.length - 1; i++) d += points[i].distanceTo(points[i + 1]);
  updateMetrics(0, d);
  updateSelfIntersectWarning(false);
  clearKinkMarkers();
}
// Medidas en vivo: números flotantes en un costado de la pantalla (solo al crear/editar)
let liveArea = 0, liveDist = 0;
function removeLiveBadge() { document.getElementById('liveReadout')?.classList.remove('on'); }
const lrItem = (cap, val, sub) =>
  `<div class="lr-item"><div class="lr-cap">${cap}</div><div class="lr-val">${val}</div>${sub ? `<div class="lr-sub">${sub}</div>` : ''}</div>`;
function clearReadoutTint(el) { el.style.removeProperty('--label-center'); el.style.removeProperty('--label-mid'); }
/** Navegación hacia un POI: rumbo (verdadero y magnético) y distancia en vivo, con el halo del color del POI */
function renderNavReadout(el) {
  const from = userLocMarker.getLatLng();
  const to = L.latLng(navPoi.lat, navPoi.lng);
  const brg = trueBearing(from, to);
  const mag = magneticBearing(brg, magneticDeclination(from.lat, from.lng));
  const color = safeColor(navPoi.color, '#38bdf8');
  const { r, g, b, lum } = labelLuminance(color);
  const dark = lum < 0.22;
  el.style.setProperty('--label-center', dark ? 'rgba(0,0,0,0.7)' : `rgba(${r},${g},${b},0.55)`);
  el.style.setProperty('--label-mid', dark ? 'rgba(0,0,0,0.35)' : `rgba(${r},${g},${b},0.2)`);
  el.innerHTML = lrItem('Rumbo', `${brg0(brg)}° V`, `${brg0(mag)}° M · ${bearingCardinal(brg)}`)
    + lrItem('Distancia', fmtLenShort(from.distanceTo(to)), `a ${escapeHtml(navPoi.name || 'POI')}`);
  el.classList.add('on');
}
function updateLiveBadge() {
  const el = document.getElementById('liveReadout');
  if (!el) return;
  updateViewSwitchUI();
  const info = document.getElementById('infoPanel');
  const infoOpen = !!(info && !info.classList.contains('hidden'));
  const recording = gpsWatchId !== null;
  const active = (drawingActive || trackMode || !!editingId) && !infoOpen && !poiMode && (appView === 'medir' || recording);
  if (!active || (points.length < 2 && !(trackMode && recording))) {
    // Sin medición en curso: si se navega hacia un POI, se muestran rumbo y distancia a ese punto
    if (navPoi && userLocMarker && !infoOpen && !poiMode) { renderNavReadout(el); return; }
    clearReadoutTint(el); removeLiveBadge(); return;
  }
  clearReadoutTint(el);
  const item = lrItem;
  const bearingItem = (brg, ref) => {
    if (brg === null || !ref) return item('Rumbo', '—');
    const mag = magneticBearing(brg, magneticDeclination(ref.lat, ref.lng));
    return item('Rumbo', `${brg0(brg)}° V`, `${brg0(mag)}° M · ${bearingCardinal(brg)}`);
  };
  let html;
  if (trackMode) {
    const n = points.length;
    const speedTxt = (v) => v === null ? '—' : (isImp() ? `${(v * 2.23694).toFixed(1)} mph` : `${(v * 3.6).toFixed(1)} km/h`);
    // Rumbo: el del GPS en marcha; si no, el del último tramo
    let brg = gpsLive.heading;
    if (brg === null && n >= 2) brg = trueBearing(points[n - 2], points[n - 1]);
    const brgHtml = bearingItem(brg, n >= 1 ? points[n - 1] : null);
    const secs = (gpsLive.recMs + (gpsLive.recStart ? Date.now() - gpsLive.recStart : 0)) / 1000;
    const avg = secs > 5 && liveDist > 0 ? liveDist / secs : null;
    html = item('Recorrido', fmtLenShort(liveDist))
      + brgHtml
      + item('Velocidad', speedTxt(gpsLive.speed), avg !== null ? `prom. ${speedTxt(avg)}` : '')
      + (gpsLive.msg ? item('GPS', gpsLive.msg) : '');
  } else if (mode === 'polygon' && points.length >= 3) {
    const am = areaMain(liveArea);
    html = item('Superficie', `${nf2.format(am.v)} ${am.u}`, areaSub(liveArea)) + item('Perímetro', fmtLenShort(liveDist));
    if (liveSelfIntersect) {
      html += '<div class="lr-item lr-warn"><div class="lr-cap">Atención</div><div class="lr-val">Se cruza</div><div class="lr-sub">la superficie puede ser incorrecta</div></div>';
    }
  } else {
    html = item(mode === 'polygon' ? 'Distancia' : 'Largo', fmtLenShort(liveDist));
    if (mode === 'line' && points.length >= 2) {
      // Rumbo del último tramo (verdadero y magnético)
      html += bearingItem(trueBearing(points[points.length - 2], points[points.length - 1]), points[points.length - 1]);
    }
  }
  el.innerHTML = html;
  el.classList.add('on');
}
function updateMetrics(areaM2, distM) {
  liveArea = areaM2; liveDist = distM;
  updateLiveBadge();
}
const APP_VERSION = '2026.11.09-26';
let liveSelfIntersect = false; // el polígono se cruza a sí mismo (los marcadores rojos ya lo señalan)
function updateSelfIntersectWarning(show) {
  const v = !!show;
  if (v === liveSelfIntersect) return;
  liveSelfIntersect = v;
  updateLiveBadge();
}
function drawKinkMarkers(features) {
  clearKinkMarkers();
  features.forEach(f => {
    if (!f.geometry || !f.geometry.coordinates) return;
    const [lng, lat] = f.geometry.coordinates;
    kinkMarkers.push(L.marker([lat, lng], { icon: kinkIcon, interactive: false }).addTo(map));
  });
}
function clearKinkMarkers() {
  kinkMarkers.forEach(m => map.removeLayer(m));
  kinkMarkers = [];
}

// ========== SAVED LAYERS (read-only) ==========
function formatDist(m) {
  return fmtLenShort(m);
}

function computeItemStats(item) {
  const latlngs = item.points.map(p => L.latLng(p.lat, p.lng));
  const n = latlngs.length;
  const segs = [];
  const isPoly = item.mode === 'polygon' && n >= 3;
  const segCount = isPoly ? n : n - 1;
  let total = 0;
  for (let i = 0; i < segCount; i++) {
    const a = latlngs[i], b = latlngs[(i + 1) % n];
    const d = a.distanceTo(b);
    total += d;
    segs.push(d);
  }
  let area = 0;
  if (isPoly) {
    try {
      const coords = latlngs.map(p => [p.lng, p.lat]);
      coords.push(coords[0]);
      area = turf.area(turf.polygon([coords]));
    } catch (e) {}
  }
  return { latlngs, segs, total, area, isPoly };
}

function clearInspectLayers() {
  inspectLayers.forEach(l => map.removeLayer(l));
  inspectLayers = [];
}

/** Orientación del polígono: true = antihorario (en plano local, x=este, y=norte) */
function polygonIsCCW(latlngs) {
  const n = latlngs.length;
  if (n < 3) return true;
  const lat0 = latlngs[0].lat, lng0 = latlngs[0].lng;
  const k = Math.cos(lat0 * Math.PI / 180);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = latlngs[i], b = latlngs[(i + 1) % n];
    const ax = (a.lng - lng0) * k, ay = a.lat - lat0;
    const bx = (b.lng - lng0) * k, by = b.lat - lat0;
    s += ax * by - bx * ay;
  }
  return s >= 0;
}

/**
 * Ángulo en el vértice i, calculado con rumbos geodésicos.
 * - Polígono cerrado: ángulo INTERIOR real (0–360°; >180° = vértice cóncavo/reflejo).
 * - Línea abierta: ángulo geométrico entre tramos (0–180°).
 * Devuelve null si falta un vecino o hay puntos coincidentes.
 */
function vertexAngleInfo(latlngs, i, closed, ccw) {
  const n = latlngs.length;
  if (n < 3) return null;
  const prev = closed ? latlngs[(i - 1 + n) % n] : (i > 0 ? latlngs[i - 1] : null);
  const curr = latlngs[i];
  const next = closed ? latlngs[(i + 1) % n] : (i < n - 1 ? latlngs[i + 1] : null);
  if (!prev || !next) return null;
  const R = 111320, k = Math.cos(curr.lat * Math.PI / 180);
  const d = (p) => Math.hypot((p.lng - curr.lng) * R * k, (p.lat - curr.lat) * R);
  if (d(prev) < 0.01 || d(next) < 0.01) return null;
  const bP = trueBearing(curr, prev), bN = trueBearing(curr, next);
  const swing = (((bN - bP) % 360) + 360) % 360; // giro antihorario de "siguiente" a "anterior"
  if (!closed) return { deg: swing > 180 ? 360 - swing : swing, reflex: false };
  const isCCW = (ccw === undefined) ? polygonIsCCW(latlngs) : ccw;
  const deg = isCCW ? swing : 360 - swing;
  return { deg, reflex: deg > 180 };
}

/** Geometría del arco en pantalla (Mercator es conforme: los ángulos se conservan). */
function angleArcGeometry(vPx, pPx, nPx, deg) {
  const a1 = Math.atan2(pPx.y - vPx.y, pPx.x - vPx.x);
  const a2 = Math.atan2(nPx.y - vPx.y, nPx.x - vPx.x);
  let sweep = a2 - a1;
  while (sweep <= -Math.PI) sweep += 2 * Math.PI;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  if (deg > 180) sweep = sweep > 0 ? sweep - 2 * Math.PI : sweep + 2 * Math.PI;
  return { a1, sweep, mid: a1 + sweep / 2 };
}

function addInspectCompass(latlngs, isPoly, color) {
  if (!latlngs || latlngs.length < 1) return;
  const bounds = L.latLngBounds(latlngs);
  const center = bounds.getCenter();
  const ne = bounds.getNorthEast(), sw = bounds.getSouthWest();
  const cPx = map.latLngToContainerPoint(center);
  const nePx = map.latLngToContainerPoint(ne);
  const swPx = map.latLngToContainerPoint(sw);
  const shapeW = Math.max(20, nePx.x - swPx.x);
  const shapeH = Math.max(20, nePx.y - swPx.y);
  const sizeGuess = 48;
  const pad = sizeGuess * 0.85;
  const compassPx = L.point(nePx.x + pad, cPx.y);
  const compassLL = map.containerPointToLatLng(compassPx);
  const z = map.getZoom();
  const scale = Math.pow(1.15, z - 15);
  const size = Math.max(36, Math.min(64, 48 * scale));
  const half = size / 2;
  const svg = `
    <svg class="inspect-compass" width="${size}" height="${size}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <circle cx="32" cy="32" r="30" fill="rgba(15,23,42,0.82)" stroke="${color}" stroke-width="2"/>
      <circle cx="32" cy="32" r="22" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
      <polygon points="32,8 36,32 32,28 28,32" fill="#ef4444"/>
      <polygon points="32,56 28,32 32,36 36,32" fill="rgba(255,255,255,0.55)"/>
      <polygon points="56,32 32,28 36,32 32,36" fill="rgba(255,255,255,0.35)"/>
      <polygon points="8,32 32,36 28,32 32,28" fill="rgba(255,255,255,0.35)"/>
      <circle cx="32" cy="32" r="3.5" fill="#fff"/>
      <text x="32" y="14" text-anchor="middle" font-size="9" font-weight="800" fill="#ef4444" font-family="system-ui,sans-serif">N</text>
      <text x="32" y="58" text-anchor="middle" font-size="7" font-weight="700" fill="rgba(255,255,255,0.7)" font-family="system-ui,sans-serif">S</text>
      <text x="56" y="34" text-anchor="middle" font-size="7" font-weight="700" fill="rgba(255,255,255,0.55)" font-family="system-ui,sans-serif">E</text>
      <text x="10" y="34" text-anchor="middle" font-size="7" font-weight="700" fill="rgba(255,255,255,0.55)" font-family="system-ui,sans-serif">O</text>
    </svg>`;
  const marker = L.marker(compassLL, {
    icon: L.divIcon({ className: '', html: svg, iconSize: [size, size], iconAnchor: [half, half] }),
    interactive: false, zIndexOffset: 1900
  }).addTo(map);
  inspectLayers.push(marker);
}

function refreshInspectOverlays() {
  clearInspectLayers();
  if (!inspectItem) return;
  const item = inspectItem;
  const stats = computeItemStats(item);
  const color = item.color || '#00ff66';
  document.documentElement.style.setProperty('--inspect-color', color);
  applyLabelTint(color, true);
  const latlngs = stats.latlngs;
  const n = latlngs.length;
  addInspectCompass(latlngs, stats.isPoly, color);

  if (inspectShowSegs || inspectShowBearings) {
    const z = map.getZoom();
    const scale = Math.pow(1.18, z - 15);
    const fontPx = Math.max(9, Math.min(18, 11 * scale));
    const segCount = stats.isPoly ? n : n - 1;
    for (let i = 0; i < segCount; i++) {
      const a = latlngs[i], b = latlngs[(i + 1) % n];
      const aPx = map.latLngToContainerPoint(a), bPx = map.latLngToContainerPoint(b);
      const midPx = L.point((aPx.x + bPx.x) / 2, (aPx.y + bPx.y) / 2);
      const dx = bPx.x - aPx.x, dy = bPx.y - aPx.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const labelPx = L.point(midPx.x + (-dy / len) * 10, midPx.y + (dx / len) * 10);
      const labelLL = map.containerPointToLatLng(labelPx);

      let html, iconW, iconH;
      if (inspectShowBearings) {
        const brg = trueBearing(a, b);
        const decl = magneticDeclination((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
        const mag = magneticBearing(brg, decl);
        html = `<span style="font-size:${fontPx}px;line-height:1.2;text-align:center">${brg0(brg)}° V<br><span style="font-size:${Math.max(8, fontPx * 0.85)}px;opacity:0.95">${brg0(mag)}° M</span></span>`;
        iconW = Math.round(fontPx * 5.5);
        iconH = Math.round(fontPx * 2.7);
      } else {
        html = `<span style="font-size:${fontPx}px">${formatDist(stats.segs[i])}</span>`;
        iconW = Math.round(fontPx * 4.2);
        iconH = Math.round(fontPx * 1.5);
      }

      const lab = L.marker(labelLL, {
        icon: L.divIcon({
          className: 'inspect-seg-label',
          html,
          iconSize: [iconW, iconH],
          iconAnchor: [Math.round(iconW / 2), Math.round(iconH / 2)]
        }),
        interactive: false, zIndexOffset: 2000
      }).addTo(map);
      inspectLayers.push(lab);
    }
  }

  if (inspectShowAngles) {
    const closed = stats.isPoly;
    const z = map.getZoom();
    const scale = Math.pow(1.18, z - 15);
    const ARC_R = Math.max(16, Math.min(56, 28 * scale));
    const fontPx = Math.max(9, Math.min(18, 11 * scale));
    const ccw = closed ? polygonIsCCW(latlngs) : true;
    for (let i = 0; i < n; i++) {
      const info = vertexAngleInfo(latlngs, i, closed, ccw);
      if (!info) continue;
      const ang = info.deg;
      const prev = closed ? latlngs[(i - 1 + n) % n] : (i > 0 ? latlngs[i - 1] : null);
      const next = closed ? latlngs[(i + 1) % n] : (i < n - 1 ? latlngs[i + 1] : null);
      if (!prev || !next) continue;
      const vPx = map.latLngToContainerPoint(latlngs[i]);
      const pPx = map.latLngToContainerPoint(prev);
      const nPx = map.latLngToContainerPoint(next);
      const { a1, sweep } = angleArcGeometry(vPx, pPx, nPx, ang);
      const steps = Math.max(8, Math.ceil(Math.abs(sweep) * 12 / Math.PI));
      const arcLatLngs = [];
      for (let s = 0; s <= steps; s++) {
        const ang = a1 + sweep * (s / steps);
        const px = L.point(vPx.x + Math.cos(ang) * ARC_R, vPx.y + Math.sin(ang) * ARC_R);
        arcLatLngs.push(map.containerPointToLatLng(px));
      }
      const arc = L.polyline(arcLatLngs, { color, weight: 1.25, opacity: 0.85, dashArray: '3, 4', interactive: false, lineCap: 'round' }).addTo(map);
      inspectLayers.push(arc);
      const midAng = a1 + sweep / 2;
      const labelPx = L.point(vPx.x + Math.cos(midAng) * (ARC_R + fontPx), vPx.y + Math.sin(midAng) * (ARC_R + fontPx));
      const labelLL = map.containerPointToLatLng(labelPx);
      const lab = L.marker(labelLL, {
        icon: L.divIcon({
          className: 'inspect-angle-text',
          html: `<span style="font-size:${fontPx}px">${ang.toFixed(1)}°</span>`,
          iconSize: [Math.round(fontPx * 3.6), Math.round(fontPx * 1.5)],
          iconAnchor: [Math.round(fontPx * 1.8), Math.round(fontPx * 0.75)]
        }),
        interactive: false, zIndexOffset: 2000
      }).addTo(map);
      inspectLayers.push(lab);
    }
  }

  if (inspectShowCoords) {
    const z = map.getZoom();
    const scale = Math.pow(1.18, z - 15);
    const fontPx = Math.max(8, Math.min(15, 10 * scale));
    let centroidPx = null;
    if (stats.isPoly && n >= 3) {
      try {
        const coords = latlngs.map(p => [p.lng, p.lat]);
        coords.push(coords[0]);
        const c = turf.centroid(turf.polygon([coords]));
        centroidPx = map.latLngToContainerPoint(L.latLng(c.geometry.coordinates[1], c.geometry.coordinates[0]));
      } catch (e) {}
    }
    latlngs.forEach((ll) => {
      const vPx = map.latLngToContainerPoint(ll);
      let labelPx = L.point(vPx.x, vPx.y - 14 * scale);
      if (centroidPx) {
        const vx = centroidPx.x - vPx.x, vy = centroidPx.y - vPx.y;
        const vlen = Math.sqrt(vx * vx + vy * vy) || 1;
        const inset = Math.min(22 * scale, vlen * 0.2);
        labelPx = L.point(vPx.x + (vx / vlen) * inset, vPx.y + (vy / vlen) * inset);
      }
      const html = `<span style="font-size:${fontPx}px;line-height:1.25;display:block;text-align:center">${fmtCoordLines(ll.lat, ll.lng).join('<br>')}</span>`;
      const lab = L.marker(map.containerPointToLatLng(labelPx), {
        icon: L.divIcon({
          className: 'inspect-angle-text',
          html,
          iconSize: [Math.round(fontPx * 8), Math.round(fontPx * 2.6)],
          iconAnchor: [Math.round(fontPx * 4), Math.round(fontPx * 1.3)]
        }),
        interactive: false, zIndexOffset: 2000
      }).addTo(map);
      inspectLayers.push(lab);
    });
  }
}

function updateInfoToggleUI() {
  const baseOn = 'flex-1 min-w-[22%] text-[10px] font-semibold py-2 rounded-lg border flex items-center justify-center gap-1';
  const baseOff = baseOn + ' bg-slate-800 text-slate-300 border-slate-700';
  const segBtn = document.getElementById('infoToggleSegs');
  const brgBtn = document.getElementById('infoToggleBearings');
  const angBtn = document.getElementById('infoToggleAngles');
  const coordBtn = document.getElementById('infoToggleCoords');
  if (segBtn) segBtn.className = inspectShowSegs ? baseOn + ' bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : baseOff;
  if (brgBtn) brgBtn.className = inspectShowBearings ? baseOn + ' bg-rose-500/15 text-rose-300 border-rose-500/40' : baseOff;
  if (angBtn) angBtn.className = inspectShowAngles ? baseOn + ' bg-amber-500/15 text-amber-300 border-amber-500/40' : baseOff;
  if (coordBtn) coordBtn.className = inspectShowCoords ? baseOn + ' bg-sky-500/15 text-sky-300 border-sky-500/40' : baseOff;

  // Declinación solo visible al consultar rumbos
  const declBox = document.getElementById('infoDeclination');
  const declVal = document.getElementById('infoDeclinationValue');
  if (declBox && declVal) {
    if (inspectShowBearings && inspectItem && inspectItem.points && inspectItem.points.length) {
      let lat = 0, lng = 0;
      inspectItem.points.forEach(p => { lat += p.lat; lng += p.lng; });
      lat /= inspectItem.points.length;
      lng /= inspectItem.points.length;
      const decl = magneticDeclination(lat, lng);
      const absDecl = Math.abs(decl).toFixed(1);
      const side = decl >= 0 ? 'E' : 'O';
      const sign = decl >= 0 ? '+' : '−';
      const declTag = getDeclOverride() !== null ? 'manual' : 'estimada';
      declVal.textContent = `${sign}${absDecl}° ${side} (${declTag})`;
      declBox.classList.remove('hidden');
      lucide.createIcons();
    } else {
      declBox.classList.add('hidden');
    }
  }
}

function showMeasurementInfo(item) {
  inspectItem = item;
  inspectShowSegs = true;
  inspectShowBearings = false;
  inspectShowAngles = false;
  inspectShowCoords = false;
  const stats = computeItemStats(item);
  const fmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
  const fmt0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
  const color = item.color || '#00ff66';
  document.getElementById('infoColorDot').style.background = color;
  document.getElementById('infoName').textContent = item.name || 'Medición';
  document.getElementById('infoMeta').textContent = `${stats.latlngs.length} puntos · ${item.mode === 'polygon' ? 'Superficie' : 'Distancia'} · ${item.date || ''}`;
  const metrics = document.getElementById('infoMetrics');
  if (stats.isPoly) {
    metrics.innerHTML = `
      <div class="bg-slate-950/80 rounded-xl p-2.5 border border-slate-800">
        <div class="text-[10px] text-slate-400 uppercase">Superficie</div>
        <div class="text-lg font-bold text-emerald-400">${fmt.format(areaMain(stats.area).v)} <span class="text-xs font-normal">${areaMain(stats.area).u}</span></div>
        <div class="text-[11px] text-slate-500">${areaSub(stats.area)}</div>
      </div>
      <div class="bg-slate-950/80 rounded-xl p-2.5 border border-slate-800">
        <div class="text-[10px] text-slate-400 uppercase">Perímetro</div>
        <div class="text-lg font-bold text-sky-400">${fmt.format(lenMain(stats.total).v)} <span class="text-xs font-normal">${lenMain(stats.total).u}</span></div>
        <div class="text-[11px] text-slate-500">${lenSub(stats.total)}</div>
      </div>`;
  } else {
    const pts = stats.latlngs;
    let straight = pts.length === 2;
    if (pts.length > 2) {
      straight = true;
      for (let i = 1; i < pts.length - 1; i++) {
        const a = trueBearing(pts[i], pts[i - 1]);
        const b = trueBearing(pts[i], pts[i + 1]);
        let diff = Math.abs(a - b);
        if (diff > 180) diff = 360 - diff;
        if (Math.abs(diff - 180) > 1.5) { straight = false; break; }
      }
    }
    let bearingHtml = '';
    if (straight && pts.length >= 2) {
      const brg = trueBearing(pts[0], pts[pts.length - 1]);
      const decl = magneticDeclination((pts[0].lat + pts[pts.length - 1].lat) / 2, (pts[0].lng + pts[pts.length - 1].lng) / 2);
      const mag = magneticBearing(brg, decl);
      bearingHtml = `
        <div class="bg-slate-950/80 rounded-xl p-2.5 border border-slate-800">
          <div class="text-[10px] text-slate-400 uppercase">Rumbo</div>
          <div class="text-lg font-bold text-amber-300">${brg0(brg)}° <span class="text-xs font-normal">V</span></div>
          <div class="text-[11px] text-slate-500">${brg0(mag)}° M · ${bearingCardinal(brg)}</div>
        </div>`;
    }
    metrics.innerHTML = `
      <div class="bg-slate-950/80 rounded-xl p-2.5 border border-slate-800 ${straight ? '' : 'col-span-2'}">
        <div class="text-[10px] text-slate-400 uppercase">Distancia total</div>
        <div class="text-lg font-bold text-sky-400">${fmt.format(lenMain(stats.total).v)} <span class="text-xs font-normal">${lenMain(stats.total).u}</span></div>
        <div class="text-[11px] text-slate-500">${lenSub(stats.total)}</div>
      </div>${bearingHtml}`;
  }
  metrics.insertAdjacentHTML('beforeend', elevCard(''));
  inspectPoi = null;
  loadInfoElevForItem(item);
  updateInfoToggleUI();
  refreshInspectOverlays();
  const main = document.getElementById('mainControls');
  if (main) main.classList.remove('hidden');
  updateModeTheme();
  document.getElementById('infoPanel').classList.remove('hidden');
  try { updateLiveBadge(); } catch (e) {}
  lucide.createIcons();
}

function showPoiInfo(p) {
  inspectItem = null;
  inspectPoi = p;
  const color = safeColor(p.color, '#f59e0b');
  document.getElementById('infoColorDot').style.background = color;
  document.getElementById('infoName').textContent = p.name || 'POI';
  document.getElementById('infoMeta').textContent = 'Punto de interés';
  let distHtml = '<div class="text-[11px] text-slate-500">Sin ubicación</div>';
  if (userLocMarker) {
    const from = userLocMarker.getLatLng();
    const dist = from.distanceTo(L.latLng(p.lat, p.lng));
    const txt = fmtLenShort(dist);
    distHtml = `<div class="text-lg font-bold text-sky-400">${txt}</div>`;
  }
  document.getElementById('infoMetrics').innerHTML = `
    <div class="bg-slate-950/80 rounded-xl p-2.5 border border-slate-800">
      <div class="text-[10px] text-slate-400 uppercase">Distancia desde vos</div>
      ${distHtml}
    </div>
    <div class="bg-slate-950/80 rounded-xl p-2.5 border border-slate-800">
      <div class="text-[10px] text-slate-400 uppercase">Coordenadas</div>
      ${fmtCoordLines(p.lat, p.lng).map(t => `<div class="text-[12px] font-mono text-slate-200">${escapeHtml(t)}</div>`).join('')}
    </div>`;
  document.getElementById('infoMetrics').insertAdjacentHTML('beforeend', elevCard(''));
  loadInfoElevForPoi(p);
  document.getElementById('infoDeclination')?.classList.add('hidden');
  document.querySelector('#infoPanel .flex.gap-1')?.classList.add('hidden');
  const main = document.getElementById('mainControls');
  if (main) main.classList.add('hidden');
  document.getElementById('infoPanel').classList.remove('hidden');
  try { updateLiveBadge(); } catch (e) {}
  lucide.createIcons();
}

function hideMeasurementInfo() {
  document.getElementById('infoPanel').classList.add('hidden');
  inspectPoi = null;
  try { updateLiveBadge(); } catch (e) {}
  document.querySelector('#infoPanel .flex.gap-1')?.classList.remove('hidden');
  const main = document.getElementById('mainControls');
  if (main) main.classList.remove('hidden');
  updateModeTheme();
  clearInspectLayers();
  inspectItem = null;
}

function addLockedLayer(item) {
  removeLockedLayer(item.id);
  const latlngs = item.points.map(p => L.latLng(p.lat, p.lng));
  if (latlngs.length < 2) return;
  const color = item.color || '#00ff66';
  const layers = [];
  const onShapeClick = (e) => {
    // Midiendo o ubicando POI, las mediciones guardadas no interceptan el toque: pasa al mapa
    if ((drawingActive && !isLocked) || poiMode) {
      if (e.target instanceof L.Marker && e.originalEvent) {
        // los marcadores no propagan el clic al mapa: se reenvía
        map.fire('click', { latlng: map.mouseEventToLatLng(e.originalEvent), originalEvent: e.originalEvent });
      }
      return;
    }
    L.DomEvent.stopPropagation(e);
    if (e.originalEvent) e.originalEvent.stopPropagation();
    showMeasurementInfo(item);
  };
  if (item.mode === 'polygon' && latlngs.length >= 3) {
    const poly = L.polygon(latlngs, { color, fillColor: color, fillOpacity: 0.18, weight: 2.5, interactive: true }).addTo(map);
    poly.on('click', onShapeClick);
    layers.push(poly);
  } else {
    const line = L.polyline(latlngs, { color, weight: 5, interactive: true }).addTo(map);
    line.on('click', onShapeClick);
    layers.push(line);
  }
  latlngs.forEach(ll => {
    layers.push(L.circleMarker(ll, { radius: 5, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1, interactive: false }).addTo(map));
  });
  try {
    let labelLL;
    if (item.mode === 'polygon' && latlngs.length >= 3) {
      const coords = latlngs.map(p => [p.lng, p.lat]);
      coords.push(coords[0]);
      const center = turf.centroid(turf.polygon([coords]));
      labelLL = L.latLng(center.geometry.coordinates[1], center.geometry.coordinates[0]);
    } else {
      labelLL = latlngs[Math.floor(latlngs.length / 2)];
    }
    const nameText = item.name || 'Medición';
    // Medir ancho real del texto para ajustar el tag
    let textW = Math.max(40, nameText.length * 6.2);
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.font = '700 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
        textW = Math.ceil(ctx.measureText(nameText).width);
      }
    } catch (e) {}
    const padX = 14; // padding horizontal + borde
    const tagW = Math.min(220, Math.max(36, textW + padX));
    const tagH = 20;
    const nameIcon = L.divIcon({
      className: '',
      html: `<div style="background:rgba(15,23,42,0.9);border:1px solid ${color === '#111827' ? '#94a3b8' : color};color:${labelTextColor(color)};font-size:10px;font-weight:700;padding:2px 6px;border-radius:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:${tagW}px;box-shadow:0 2px 8px rgba(0,0,0,0.5);pointer-events:auto;cursor:pointer;line-height:14px;">${escapeHtml(nameText)}</div>`,
      iconSize: [tagW, tagH],
      iconAnchor: [Math.round(tagW / 2), Math.round(tagH / 2)]
    });
    const nameMarker = L.marker(labelLL, { icon: nameIcon, interactive: true }).addTo(map);
    nameMarker.on('click', onShapeClick);
    layers.push(nameMarker);
  } catch (e) {}
  lockedLayers.push({ id: item.id, layers });
}

function removeLockedLayer(id) {
  const entry = lockedLayers.find(l => l.id === id);
  if (entry) {
    entry.layers.forEach(l => map.removeLayer(l));
    lockedLayers = lockedLayers.filter(l => l.id !== id);
  }
}

function refreshLockedLayers() {
  lockedLayers.forEach(e => e.layers.forEach(l => map.removeLayer(l)));
  lockedLayers = [];
  saved.forEach(item => { if (item.visible !== false) addLockedLayer(item); });
}

/** Limpia solo la medición activa (no borra las guardadas) y desbloquea el editor */
function clearActiveMeasurement(opts = {}) {
  clearDraft();
  stopGpsTracking();
  gpsLive.recMs = 0; gpsLive.recStart = null;
  hideMeasurementInfo();
  markers.forEach(m => map.removeLayer(m));
  midMarkers.forEach(m => map.removeLayer(m));
  labels.forEach(l => map.removeLayer(l));
  clearKinkMarkers();
  if (polyLayer) map.removeLayer(polyLayer);
  if (lineLayer) map.removeLayer(lineLayer);
  if (guideLine) map.removeLayer(guideLine);
  if (touchDot) map.removeLayer(touchDot);
  hideCloseMagnet();
  markers = []; midMarkers = []; labels = [];
  points = [];
  polyLayer = lineLayer = guideLine = touchDot = null;
  updateMetrics(0, 0);
  updateSelfIntersectWarning(false);
  resetHistory();

  // Si se estaba editando una medición guardada y se cancela, restaurarla en el mapa
  const wasEditing = editingId;
  editingId = null;
  isLocked = false;
  if (!opts.keepDrawing) setDrawingActive(false);
  else updateDrawingUI();
  updateLockUI();
  if (wasEditing) {
    const item = saved.find(s => s.id === wasEditing);
    if (item && item.visible !== false) {
      removeLockedLayer(item.id);
      addLockedLayer(item);
    }
  }
}

/** Marca el modo activo en el panel para que los botones de acción tomen su color */
function updateModeTheme() {
  const m = poiMode ? 'poi' : (trackMode ? 'track' : mode);
  const mc = document.getElementById('mainControls');
  mc?.setAttribute('data-mode', m);
  mc?.setAttribute('data-rec', (trackMode && gpsWatchId !== null) ? '1' : '0');
}
// ========== VISTA: Ver / Medir ==========
// Ver = mapa limpio, solo consulta. Medir = panel de medición. La app arranca en Medir.
let appView = 'medir';
function hasPendingWork() { return points.length > 0 || gpsWatchId !== null || !!editingId; }
function ensureMedir() { if (appView !== 'medir') { appView = 'medir'; applyAppView(); } }
function setAppView(v) {
  if (v === appView) return;
  if (v === 'ver') {
    if (poiMode) exitPoiMode(false);
    // Si no hay nada en curso, todo vuelve a reposo; si hay grabación o borrador, se conservan
    if (!hasPendingWork()) {
      if (trackMode) setMode('polygon');
      setDrawingActive(false);
    }
  }
  appView = v;
  applyAppView();
}
function updateViewSwitchUI() {
  const ver = document.getElementById('viewVerBtn'), med = document.getElementById('viewMedirBtn');
  if (!ver || !med) return;
  // El aspecto (3D naranja si está activo) lo define styles.css según aria-pressed
  ver.setAttribute('aria-pressed', appView === 'ver' ? 'true' : 'false');
  med.setAttribute('aria-pressed', appView === 'medir' ? 'true' : 'false');
  document.getElementById('viewMedirDot')?.classList.toggle('hidden', !(appView === 'ver' && hasPendingWork()));
}
// Aviso de bienvenida: explica los dos modos hasta que el usuario los usa o toca "Entendido"
const VIEW_HINT_KEY = 'medidor_view_hint';
let viewHintTimer = null;
function showViewHint() {
  try { if (localStorage.getItem(VIEW_HINT_KEY) === '1') return; } catch (e) {}
  document.getElementById('viewHint')?.classList.remove('hidden');
  document.getElementById('viewSwitch')?.classList.add('attention');
  lucide.createIcons();
  clearTimeout(viewHintTimer);
  viewHintTimer = setTimeout(() => hideViewHint(false), 14000);
}
function hideViewHint(learned) {
  clearTimeout(viewHintTimer);
  document.getElementById('viewHint')?.classList.add('hidden');
  document.getElementById('viewSwitch')?.classList.remove('attention');
  if (learned) { try { localStorage.setItem(VIEW_HINT_KEY, '1'); } catch (e) {} }
}
// Al cambiar de modo se cierra la ficha de datos que haya abierta
function onViewSwitch(v) {
  hideViewHint(true);
  const info = document.getElementById('infoPanel');
  if (info && !info.classList.contains('hidden')) hideMeasurementInfo();
  setAppView(v);
}
function applyAppView() {
  document.getElementById('mainControls')?.classList.toggle('view-only', appView === 'ver');
  updateViewSwitchUI();
  updateLiveBadge();
  if (points.length) { try { rebuildMarkers(); redraw(); } catch (e) {} }
  updateModeTheme();
}

function setDrawingActive(on) {
  if (on) ensureMedir();
  drawingActive = !!on;
  updateDrawingUI();
  updateSessionButtons();
  updateModeTheme();
}

function updateDrawingUI() {
  updateModeTheme();
  const newBtn = document.getElementById('newBtn');
  if (newBtn) {
    if (drawingActive && !isLocked) {
      newBtn.classList.remove('bg-sky-500/20', 'text-sky-300', 'border-sky-500/40');
      newBtn.classList.add('bg-sky-500', 'text-white', 'border-sky-400', 'ring-2', 'ring-sky-400/40');
      newBtn.title = 'Medición activa · tocá de nuevo para reiniciar';
    } else {
      newBtn.classList.add('bg-sky-500/20', 'text-sky-300', 'border-sky-500/40');
      newBtn.classList.remove('bg-sky-500', 'text-white', 'border-sky-400', 'ring-2', 'ring-sky-400/40');
      newBtn.title = 'Empezar una medición nueva (habilita tocar el mapa)';
    }
  }
  try {
    if (map && map.getContainer) {
      map.getContainer().style.cursor = (drawingActive && !isLocked) ? 'crosshair' : '';
    }
  } catch (e) {}
}

function pulseButton(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('btn-pulse');
  setTimeout(() => el.classList.remove('btn-pulse'), 450);
}

// ========== MODE ==========
function setMode(m) {
  if (isLocked) return;
  if (gpsWatchId !== null) stopGpsTracking();
  else if (trackMode) { trackMode = false; setGpsBtnState(false); refreshTrackBar(); }
  if (poiMode) exitPoiMode(false);
  mode = m;
  const polyBtn = document.getElementById('modePolyBtn');
  const lineBtn = document.getElementById('modeLineBtn');
  const poiBtn = document.getElementById('modePoiBtn');
  const on = 'w-full flex items-center gap-2 py-2 px-2 rounded-lg text-xs font-bold text-white shadow min-h-[36px]';
  const off = 'w-full flex items-center gap-2 py-2 px-2 rounded-lg text-xs font-bold text-slate-300 bg-slate-800/70 border border-slate-600/50 min-h-[36px]';
  if (polyBtn) polyBtn.className = off;
  if (lineBtn) lineBtn.className = off;
  if (poiBtn) poiBtn.className = off;
  if (m === 'polygon') {
    polyBtn.className = on + ' bg-emerald-600';
  } else if (m === 'line') {
    lineBtn.className = on + ' bg-sky-600';
  }
  lucide.createIcons();
  updateModeTheme();
  redraw();
}

function enterPoiMode() {
  ensureMedir();
  if (isLocked) return;
  if (gpsWatchId !== null) stopGpsTracking();
  else if (trackMode) { trackMode = false; setGpsBtnState(false); refreshTrackBar(); }
  poiMode = true;
  poiColor = themeColor;
  poiSession = [];
  poiSessionRedo = [];
  updateUndoRedoUI();
  const poiBtn = document.getElementById('modePoiBtn');
  const polyBtn = document.getElementById('modePolyBtn');
  const lineBtn = document.getElementById('modeLineBtn');
  const on = 'w-full flex items-center gap-2 py-2 px-2 rounded-lg text-xs font-bold text-white shadow min-h-[36px]';
  const off = 'w-full flex items-center gap-2 py-2 px-2 rounded-lg text-xs font-bold text-slate-300 bg-slate-800/70 border border-slate-600/50 min-h-[36px]';
  if (polyBtn) polyBtn.className = off;
  if (lineBtn) lineBtn.className = off;
  if (poiBtn) poiBtn.className = on + ' bg-amber-500 text-slate-950';
  setPoiAim(true);
  updateModeTheme();
  const nb = document.getElementById('newBtn');
  if (nb) nb.disabled = true;
  const done = document.getElementById('poiDoneBtn');
  if (done) done.disabled = true;
}

function exitPoiMode(openList) {
  poiMode = false;
  setPoiAim(false);
  const nb = document.getElementById('newBtn');
  if (nb) nb.disabled = false;
  updateModeTheme();
  setMode(mode);
  if (openList !== false) { /* stay on map */ }
}

// ========== LAYERS / LOCATION / SEARCH ==========
function cycleLayer() {
  currentTiles = currentTiles === 'esri' ? 'osm' : 'esri';
  map.removeLayer(tileLayer);
  const t = tiles[currentTiles];
  tileLayer = L.tileLayer(t.url, { maxZoom: t.maxZoom, maxNativeZoom: t.nativeZoom, attribution: t.attr }).addTo(map);
  document.getElementById('layerText').textContent = t.name;
}

function updateUserLocation(lat, lng, accuracy) {
  const ll = L.latLng(lat, lng);
  const acc = Math.max(8, Math.min(accuracy || 40, 200));
  if (!userLocMarker) {
    const icon = L.divIcon({
      className: '',
      html: '<div class="user-loc-wrap"><div class="user-loc-pulse"></div><div class="user-loc-dot"></div></div>',
      iconSize: [48, 48],
      iconAnchor: [24, 24]
    });
    userLocMarker = L.marker(ll, { icon, interactive: false, zIndexOffset: 1500 }).addTo(map);
  } else {
    userLocMarker.setLatLng(ll);
  }
  if (!userAccCircle) {
    userAccCircle = L.circle(ll, {
      radius: acc,
      color: '#4285F4',
      weight: 1,
      opacity: 0.35,
      fillColor: '#4285F4',
      fillOpacity: 0.12,
      interactive: false
    }).addTo(map);
  } else {
    userAccCircle.setLatLng(ll);
    userAccCircle.setRadius(acc);
  }
}

function startUserLocationWatch(centerOnFirst) {
  if (!navigator.geolocation) return;
  let didCenter = !centerOnFirst;
  const onPos = (pos) => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const acc = pos.coords.accuracy || 40;
    updateUserLocation(lat, lng, acc);
    if (navPoi) updateNavLine();
    if (!didCenter) {
      didCenter = true;
      map.flyTo([lat, lng], Math.max(map.getZoom(), 16), { duration: 1.0 });
      try {
        localStorage.setItem('medidor_last_view', JSON.stringify({ lat, lng, zoom: Math.max(map.getZoom(), 16) }));
      } catch (e) {}
    }
  };
  // Posición rápida inicial
  navigator.geolocation.getCurrentPosition(onPos, () => {}, {
    enableHighAccuracy: true, timeout: 12000, maximumAge: 60000
  });
  // Seguimiento suave del punto azul (independiente del track de medición)
  if (userLocWatchId === null) {
    userLocWatchId = navigator.geolocation.watchPosition(
      onPos,
      () => {},
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
    );
  }
}

function geoErrorInfo(err) {
  const secure = window.isSecureContext;
  const code = err && err.code;
  if (!secure) return 'La página no está en https: el navegador bloquea la ubicación.';
  if (code === 1) return 'Permiso rechazado (código 1). Revisá Ajustes del sitio web → Localización en Safari y Ajustes → Privacidad → Localización.';
  if (code === 2) return 'Ubicación no disponible (código 2): el iPhone no pudo calcularla. Probá al aire libre y con Localización activada.';
  if (code === 3) return 'Tiempo agotado (código 3): no hubo señal a tiempo. Probá de nuevo al aire libre.';
  return 'Error desconocido' + (err && err.message ? ': ' + err.message : '') + '.';
}
function locateMe() {
  if (!navigator.geolocation) return toast({ type: 'error', title: 'GPS no disponible', message: 'Tu navegador no soporta geolocalización.' });
  toast({ type: 'info', title: 'Centrando mapa…', message: 'Solo mueve la vista; no agrega puntos.', duration: 2000 });
  startUserLocationWatch(false);
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      updateUserLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
      map.flyTo([pos.coords.latitude, pos.coords.longitude], 17, { duration: 1.1 });
    },
    (err) => toast({ type: 'error', title: 'No se pudo obtener la ubicación', message: geoErrorInfo(err), duration: 9000 }),
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 }
  );
}

// ========== IR A COORDENADAS ==========
function tmInverse(E, Nrel, lon0, k0, fe) {
  const a = 6378137, f = 1 / 298.257223563, n = f / (2 - f);
  const A = a / (1 + n) * (1 + n * n / 4 + n ** 4 / 64 + n ** 6 / 256);
  const be = [n / 2 - 2 * n ** 2 / 3 + 37 * n ** 3 / 96, n ** 2 / 48 + n ** 3 / 15, 17 * n ** 3 / 480];
  const de = [2 * n - 2 * n ** 2 / 3 - 2 * n ** 3, 7 * n ** 2 / 3 - 8 * n ** 3 / 5, 56 * n ** 3 / 15];
  const xi = Nrel / (k0 * A), eta = (E - fe) / (k0 * A);
  let xi0 = xi, eta0 = eta;
  for (let j = 1; j <= 3; j++) {
    xi0 -= be[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    eta0 -= be[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xi0) / Math.cosh(eta0));
  let phi = chi;
  for (let j = 1; j <= 3; j++) phi += de[j - 1] * Math.sin(2 * j * chi);
  const lam = Math.atan2(Math.sinh(eta0), Math.cos(xi0));
  return { lat: phi * 180 / Math.PI, lng: lon0 + lam * 180 / Math.PI };
}
function fromUTM(zone, south, E, N) {
  return tmInverse(E, N - (south ? 10000000 : 0), zone * 6 - 183, 0.9996, 500000);
}
function fromGaussKruger(faja, X, Y) {
  const A = 6378137 / (1 + (1 / 298.257223563) / (2 - 1 / 298.257223563)) *
    (1 + (((1 / 298.257223563) / (2 - 1 / 298.257223563)) ** 2) / 4 + (((1 / 298.257223563) / (2 - 1 / 298.257223563)) ** 4) / 64 + (((1 / 298.257223563) / (2 - 1 / 298.257223563)) ** 6) / 256);
  return tmInverse(Y, X - A * Math.PI / 2, -72 + 3 * (faja - 1), 1, faja * 1000000 + 500000);
}

/** Número tolerante: acepta coma o punto decimal. */
function parseDecimalStr(t) {
  t = String(t ?? '').trim().replace(/\s+/g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(t) ? parseFloat(t) : NaN;
}
/** Metros: acepta separadores de miles ("581.454", "581 454") y decimales ("581454,32"). */
function parseMetersStr(t) {
  t = String(t ?? '').trim().replace(/\s+/g, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) t = t.replace(/[.,]/g, '');
  else if (t.includes(',') && t.includes('.')) {
    const dec = t.lastIndexOf(',') > t.lastIndexOf('.') ? ',' : '.';
    t = t.split(dec === ',' ? '.' : ',').join('').replace(dec, '.');
  } else t = t.replace(',', '.');
  return /^\d+(\.\d+)?$/.test(t) ? parseFloat(t) : NaN;
}
const isBlank = (t) => String(t ?? '').trim() === '';

/** v: valores de los campos (texto). Devuelve {empty} | {error} | {lat,lng}. */
function parseCoordForm(fmt, v) {
  const neg = (t) => /^\s*[-−–+]/.test(String(t ?? ''));
  if (fmt === 'dec') {
    if (isBlank(v.lat) && isBlank(v.lng)) return { empty: true };
    if (isBlank(v.lat) || isBlank(v.lng)) return { empty: true };
    if (neg(v.lat) || neg(v.lng)) return { error: 'Escribí el valor sin signo y elegí Norte/Sur y Este/Oeste.' };
    const la = parseDecimalStr(v.lat), lo = parseDecimalStr(v.lng);
    if (isNaN(la)) return { error: 'La latitud no es un número válido.' };
    if (isNaN(lo)) return { error: 'La longitud no es un número válido.' };
    if (la > 90) return { error: 'La latitud debe estar entre 0 y 90.' };
    if (lo > 180) return { error: 'La longitud debe estar entre 0 y 180.' };
    return { lat: (v.latH === 'S' ? -1 : 1) * la, lng: (v.lngH === 'O' ? -1 : 1) * lo };
  }
  if (fmt === 'dms') {
    const parts = (d, m, sec, name, max, h, hs) => {
      if (isBlank(d)) return { empty: true };
      if (neg(d) || neg(m) || neg(sec)) return { error: 'Escribí los valores sin signo y elegí el hemisferio.' };
      const dd = /^\d+$/.test(String(d).trim()) ? +d : NaN;
      const mm = isBlank(m) ? 0 : (/^\d+$/.test(String(m).trim()) ? +m : NaN);
      const ss = isBlank(sec) ? 0 : parseDecimalStr(sec);
      if (isNaN(dd)) return { error: `Los grados de la ${name} deben ser un número entero.` };
      if (isNaN(mm)) return { error: `Los minutos de la ${name} deben ser un número entero.` };
      if (isNaN(ss)) return { error: `Los segundos de la ${name} no son un número válido.` };
      if (dd > max) return { error: `Los grados de la ${name} deben estar entre 0 y ${max}.` };
      if (mm > 59) return { error: `Los minutos de la ${name} deben estar entre 0 y 59.` };
      if (ss >= 60) return { error: `Los segundos de la ${name} deben ser menores que 60.` };
      const val = dd + mm / 60 + ss / 3600;
      if (val > max) return { error: `La ${name} no puede superar ${max}°.` };
      return { val: (h === hs ? -1 : 1) * val };
    };
    const la = parts(v.latD, v.latM, v.latS, 'latitud', 90, v.latH, 'S');
    const lo = parts(v.lngD, v.lngM, v.lngS, 'longitud', 180, v.lngH, 'O');
    if (la.error) return la; if (lo.error) return lo;
    if (la.empty || lo.empty) return { empty: true };
    return { lat: la.val, lng: lo.val };
  }
  if (fmt === 'utm') {
    if (isBlank(v.E) || isBlank(v.N)) return { empty: true };
    const E = parseMetersStr(v.E), N = parseMetersStr(v.N);
    if (isNaN(E)) return { error: 'El valor Este no es un número válido.' };
    if (isNaN(N)) return { error: 'El valor Norte no es un número válido.' };
    if (E < 100000 || E > 900000) return { error: 'El Este UTM debe estar entre 100.000 y 900.000 m.' };
    const south = v.hemi === 'S';
    if (south && (N < 1000000 || N > 10000000)) return { error: 'En hemisferio Sur el Norte UTM debe estar entre 1.000.000 y 10.000.000 m.' };
    if (!south && (N < 0 || N > 9400000)) return { error: 'En hemisferio Norte el Norte UTM debe estar entre 0 y 9.400.000 m.' };
    const r = fromUTM(+v.zone, south, E, N);
    if (!isFinite(r.lat) || !isFinite(r.lng)) return { error: 'No se pudo convertir esa coordenada.' };
    return r;
  }
  if (fmt === 'gk') {
    if (isBlank(v.X) || isBlank(v.Y)) return { empty: true };
    const X = parseMetersStr(v.X), Y = parseMetersStr(v.Y), faja = +v.faja;
    if (isNaN(X)) return { error: 'El valor X (Norte) no es un número válido.' };
    if (isNaN(Y)) return { error: 'El valor Y (Este) no es un número válido.' };
    if (X < 3900000 || X > 8000000) return { error: 'X (Norte) debe estar entre 3.900.000 y 8.000.000 m.' };
    const y0 = faja * 1000000 + 500000;
    if (Y < y0 - 300000 || Y > y0 + 300000) return { error: `Y (Este) de la faja ${faja} debe estar entre ${nf0.format(y0 - 300000)} y ${nf0.format(y0 + 300000)} m. Incluí el primer dígito de la faja.` };
    const r = fromGaussKruger(faja, X, Y);
    if (!isFinite(r.lat) || !isFinite(r.lng)) return { error: 'No se pudo convertir esa coordenada.' };
    return r;
  }
  return { empty: true };
}

// Marcador temporal (resultado de búsqueda o de coordenadas)
let gotoMarker = null;
function clearGotoMarker() { if (gotoMarker) { map.removeLayer(gotoMarker); gotoMarker = null; } }
function showGotoMarker(lat, lng, label) {
  clearGotoMarker();
  gotoMarker = L.marker([lat, lng], { icon: poiIcon('#fbbf24'), zIndexOffset: 1200 }).addTo(map);
  gotoMarker.bindTooltip(`${escapeHtml(label)} ✕`, { permanent: true, direction: 'top', className: 'poi-label', offset: [0, -36] });
  gotoMarker.on('click', (e) => { L.DomEvent.stopPropagation(e); clearGotoMarker(); });
}

let cgLast = null;
const cgVal = (id) => document.getElementById(id).value;
function readCoordForm() {
  const fmt = cgVal('cgFormat');
  if (fmt === 'dec') return [fmt, { lat: cgVal('cgDecLat'), lng: cgVal('cgDecLng'), latH: cgVal('cgDecLatH'), lngH: cgVal('cgDecLngH') }];
  if (fmt === 'dms') return [fmt, {
    latD: cgVal('cgDmsLatD'), latM: cgVal('cgDmsLatM'), latS: cgVal('cgDmsLatS'), latH: cgVal('cgDmsLatH'),
    lngD: cgVal('cgDmsLngD'), lngM: cgVal('cgDmsLngM'), lngS: cgVal('cgDmsLngS'), lngH: cgVal('cgDmsLngH') }];
  if (fmt === 'utm') return [fmt, { zone: cgVal('cgUtmZone'), hemi: cgVal('cgUtmHemi'), E: cgVal('cgUtmE'), N: cgVal('cgUtmN') }];
  return [fmt, { faja: cgVal('cgGkFaja'), X: cgVal('cgGkX'), Y: cgVal('cgGkY') }];
}
function updateCoordForm() {
  const [fmt, v] = readCoordForm();
  document.querySelectorAll('#coordPanel .cg-panel').forEach(p => p.classList.toggle('hidden', p.id !== 'cg-' + fmt));
  const r = parseCoordForm(fmt, v);
  const ok = !r.error && !r.empty;
  cgLast = ok ? r : null;
  document.getElementById('cgError').textContent = r.error || '';
  document.getElementById('cgPreview').textContent = ok ? `→ ${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}` : '';
  ['cgGo', 'cgPoi'].forEach(id => { const b = document.getElementById(id); b.disabled = !ok; });
}
/** Un signo "-" en grados decimales se convierte solo en hemisferio Sur/Oeste. */
function autoSignToHemisphere(inputId, selectId, negValue) {
  const el = document.getElementById(inputId);
  if (/^\s*[-−–]/.test(el.value)) {
    el.value = el.value.replace(/^\s*[-−–]\s*/, '');
    document.getElementById(selectId).value = negValue;
  } else if (/^\s*\+/.test(el.value)) el.value = el.value.replace(/^\s*\+\s*/, '');
}
let searchMode = 'place';
function prefillCoordForm() {
  const c = map.getCenter();
  document.getElementById('cgFormat').value = settings.coords;
  document.getElementById('cgUtmZone').value = String(toUTM(c.lat, c.lng).zone);
  document.getElementById('cgUtmHemi').value = c.lat < 0 ? 'S' : 'N';
  document.getElementById('cgGkFaja').value = String(toGaussKruger(c.lat, c.lng).faja);
  ['cgDecLatH', 'cgDmsLatH'].forEach(id => document.getElementById(id).value = c.lat < 0 ? 'S' : 'N');
  ['cgDecLngH', 'cgDmsLngH'].forEach(id => document.getElementById(id).value = c.lng < 0 ? 'O' : 'E');
  document.querySelectorAll('#coordPanel input.cg-input').forEach(i => i.value = '');
  updateCoordForm();
}
/** Abre/cierra el panel de coordenadas; el buscador por lugar queda siempre visible */
function setSearchMode(m) {
  searchMode = m;
  const coords = m === 'coords';
  document.getElementById('coordPanel').classList.toggle('hidden', !coords);
  document.getElementById('searchResults').classList.add('hidden');
  const btn = document.getElementById('modeCoordsBtn');
  btn.classList.toggle('open', coords);
  btn.setAttribute('aria-expanded', coords ? 'true' : 'false');
  if (coords) prefillCoordForm();
  updateSearchLock();
}
/** Mientras se busca (panel de coordenadas abierto o cursor en el campo de lugar) no se puede cambiar de modo */
function updateSearchLock() {
  const lock = searchMode === 'coords' || document.activeElement === document.getElementById('searchInput');
  document.getElementById('viewSwitch')?.classList.toggle('locked', lock);
  ['viewVerBtn', 'viewMedirBtn'].forEach(id => { const b = document.getElementById(id); if (b) b.disabled = lock; });
  if (lock) hideViewHint(false);
}
function openCoordModal() { setSearchMode('coords'); }
function closeCoordModal() { setSearchMode('place'); }
function initCoordUI() {
  const si = document.getElementById('searchInput');
  si.addEventListener('focus', () => { si.placeholder = 'Escribe un nombre de lugar'; if (searchMode === 'coords') setSearchMode('place'); updateSearchLock(); });
  si.addEventListener('blur', () => { si.placeholder = 'Buscar por lugar'; setTimeout(updateSearchLock, 0); });
  document.getElementById('modeCoordsBtn').onclick = () => setSearchMode(searchMode === 'coords' ? 'place' : 'coords');
  const modal = document.getElementById('coordPanel');
  modal.addEventListener('input', (e) => {
    if (e.target.id === 'cgDecLat') autoSignToHemisphere('cgDecLat', 'cgDecLatH', 'S');
    if (e.target.id === 'cgDecLng') autoSignToHemisphere('cgDecLng', 'cgDecLngH', 'O');
    updateCoordForm();
  });
  modal.addEventListener('change', updateCoordForm);
  document.getElementById('cgGo').onclick = () => {
    if (!cgLast) return;
    const { lat, lng } = cgLast;
    closeCoordModal();
    showGotoMarker(lat, lng, fmtCoord(lat, lng));
    map.flyTo([lat, lng], 17, { duration: 1.1 });
  };
  document.getElementById('cgPoi').onclick = () => {
    if (!cgLast) return;
    const { lat, lng } = cgLast;
    closeCoordModal();
    map.flyTo([lat, lng], 17, { duration: 1.1 });
    openPoiModal(L.latLng(lat, lng));
  };
}

// ========== BÚSQUEDA DE LUGARES ==========
let searchSeq = 0;
function looksLikeCoordinates(q) {
  return /^[\d\s.,;:°'"′″\-+−NSEOWnseow]+$/.test(q) && (q.match(/\d+/g) || []).length >= 2;
}
async function doSearch(q) {
  const box = document.getElementById('searchResults');
  const info = (html) => { box.innerHTML = `<div class="p-3 text-xs text-slate-400 text-center">${html}</div>`; box.classList.remove('hidden'); };
  if (looksLikeCoordinates(q)) {
    box.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'p-3 text-xs text-slate-200 cursor-pointer flex items-center gap-2';
    div.innerHTML = '<i data-lucide="crosshair" class="w-4 h-4 text-amber-300 flex-shrink-0"></i><span>Eso parece una coordenada. Tocá para abrir el formulario de coordenadas.</span>';
    div.onclick = () => { box.classList.add('hidden'); openCoordModal(); };
    box.appendChild(div);
    lucide.createIcons();
    box.classList.remove('hidden');
    return;
  }
  if (navigator.onLine === false) return info('Sin conexión: la búsqueda de lugares necesita internet.');
  const seq = ++searchSeq;
  info('Buscando…');
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&accept-language=es&limit=6&q=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (seq !== searchSeq) return; // llegó una respuesta vieja
    if (!data.length) return info('Sin resultados. Probá con otro nombre o agregá la localidad.');
    box.innerHTML = '';
    data.forEach(item => {
      const div = document.createElement('div');
      div.className = 'p-2.5 text-xs text-slate-200 hover:bg-slate-800 cursor-pointer border-b border-slate-800/50 flex items-center gap-2';
      div.innerHTML = `<i data-lucide="map-pin" class="w-4 h-4 text-emerald-400 flex-shrink-0"></i><span class="truncate">${escapeHtml(item.display_name)}</span>`;
      div.onclick = () => {
        box.classList.add('hidden');
        const short = String(item.display_name).split(',')[0];
        showGotoMarker(+item.lat, +item.lon, short);
        map.flyTo([+item.lat, +item.lon], 16, { duration: 1.1 });
      };
      box.appendChild(div);
    });
    lucide.createIcons();
    box.classList.remove('hidden');
  } catch (e) {
    if (seq !== searchSeq) return;
    info('No se pudo conectar con el buscador. Revisá tu conexión.');
  }
}

// ========== POIs ==========
const POI_DEFAULT_COLOR = '#f59e0b';

function poiAimLatLng() {
  const el = document.getElementById('poiCrosshair');
  if (!el || !map) return map.getCenter();
  const r = el.getBoundingClientRect();
  const mapR = map.getContainer().getBoundingClientRect();
  const x = (r.left + r.width / 2) - mapR.left;
  const y = (r.top + r.height / 2) - mapR.top;
  return map.containerPointToLatLng(L.point(x, y));
}

function updatePoiCenterCoords() {
  const el = document.getElementById('poiCenterCoords');
  if (!el || !map || !poiMode) return;
  const c = poiAimLatLng();
  el.textContent = fmtCoord(c.lat, c.lng);
}

function setPoiAim(on) {
  poiAiming = !!on;
  document.getElementById('poiCrosshair')?.classList.toggle('visible', on);
  document.getElementById('poiPlaceBar')?.classList.toggle('visible', on);
  ['newBtn', 'saveBtn'].forEach(id => {
    const b = document.getElementById(id);
    if (!b) return;
    b.disabled = poiMode;
    b.classList.toggle('opacity-35', poiMode);
  });
  const placeBtn = document.getElementById('poiPlaceHeaderBtn');
  if (placeBtn) {
    placeBtn.disabled = !poiMode;
    placeBtn.className = poiMode
      ? 'text-xs font-semibold bg-amber-500 text-slate-950 border border-amber-400 rounded-md inline-flex items-center justify-center gap-1 h-8 px-2 act-btn act-poi'
      : 'text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-md inline-flex items-center justify-center gap-1 h-8 px-2 act-btn act-poi';
    placeBtn.title = poiMode ? 'Ubicar el POI en la cruz' : 'Se activa en modo POI';
  }
  if (on) updatePoiCenterCoords();
  updateDrawingUI();
}

function openPoiModal(latlng, existing) {
  pendingPoi = latlng;
  editingPoiId = existing ? existing.id : null;
  const input = document.getElementById('poiNameInput');
  const note = document.getElementById('poiNoteInput');
  const title = document.getElementById('poiModalTitle');
  const hint = document.getElementById('poiModalHint');
  const coordsBox = document.getElementById('poiCoordsBox');
  const coordsText = document.getElementById('poiCoordsText');
  const delBtn = document.getElementById('deletePoiBtn');
  const confirmBtn = document.getElementById('confirmPoiBtn');
  if (existing) {
    if (title) title.textContent = 'Editar POI';
    if (hint) hint.textContent = 'Cambiá el nombre, el color o la nota.';
    if (input) input.value = existing.name || '';
    if (note) note.value = existing.note || '';
    poiColor = existing.color || poiColor;
    document.querySelectorAll('.poi-color').forEach(b => b.style.borderColor = b.dataset.color === poiColor ? '#fff' : 'transparent');
    document.getElementById('poiColorLabel')?.classList.remove('hidden');
    document.getElementById('poiColorPicker')?.classList.remove('hidden');
    document.getElementById('poiColorPicker')?.classList.add('flex');
    if (delBtn) delBtn.classList.remove('hidden');
    if (confirmBtn) confirmBtn.textContent = 'Guardar cambios';
  } else {
    if (title) title.textContent = 'Nuevo POI';
    if (hint) hint.textContent = 'Punto de interés. Complementa las mediciones: no forma parte del polígono ni de la línea.';
    if (input) input.value = `POI ${pois.length + 1}`;
    if (note) note.value = '';
    document.getElementById('poiColorLabel')?.classList.add('hidden');
    document.getElementById('poiColorPicker')?.classList.add('hidden');
    document.getElementById('poiColorPicker')?.classList.remove('flex');
    if (delBtn) delBtn.classList.add('hidden');
    if (confirmBtn) confirmBtn.textContent = 'Guardar POI';
  }
  if (coordsBox && coordsText && latlng) {
    coordsBox.classList.remove('hidden');
    coordsText.textContent = fmtCoord(latlng.lat, latlng.lng);
    coordsText.dataset.dec = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
  }
  document.getElementById('poiModal').classList.remove('hidden');
  setPoiAim(false);
  setTimeout(() => input && input.focus(), 50);
}

function confirmPoi() {
  if (!pendingPoi && !editingPoiId) return;
  const name = (document.getElementById('poiNameInput').value || '').trim() || `POI ${pois.length + 1}`;
  const note = (document.getElementById('poiNoteInput').value || '').trim();
  if (editingPoiId) {
    const idx = pois.findIndex(p => p.id === editingPoiId);
    if (idx >= 0) {
      pois[idx] = { ...pois[idx], name, note, color: safeColor(poiColor, themeColor) };
    }
  } else if (pendingPoi) {
    const created = {
      id: Date.now().toString(),
      name,
      note,
      color: safeColor(poiColor || themeColor, '#00ff66'),
      lat: pendingPoi.lat,
      lng: pendingPoi.lng,
      visible: true
    };
    pois.push(created);
    fetchElevations([L.latLng(created.lat, created.lng)]).then(v => {
      if (v[0] !== null) { created.elev = v[0]; created.elevAt = elevKey(created); persistPois(); renderPoiList(); }
    });
    if (poiMode) {
      poiSession.push(created.id);
      poiSessionRedo = [];
      updateUndoRedoUI();
      const done = document.getElementById('poiDoneBtn');
      if (done) done.disabled = false;
    }
  }
  pendingPoi = null;
  editingPoiId = null;
  document.getElementById('poiModal').classList.add('hidden');
  persistPois();
  renderPois();
  if (poiMode) setPoiAim(true);
  toast({ type: 'success', title: 'POI guardado', message: `"${name}" quedó actualizado.`, duration: 2000 });
}

function undoPoi() {
  if (!poiSession.length) return;
  const id = poiSession.pop();
  const idx = pois.findIndex(p => p.id === id);
  if (idx >= 0) poiSessionRedo.push(pois.splice(idx, 1)[0]);
  persistPois();
  renderPois();
  updateUndoRedoUI();
  const done = document.getElementById('poiDoneBtn');
  if (done) done.disabled = poiSession.length === 0;
}
function redoPoi() {
  if (!poiSessionRedo.length) return;
  const p = poiSessionRedo.pop();
  pois.push(p);
  poiSession.push(p.id);
  persistPois();
  renderPois();
  updateUndoRedoUI();
  const done = document.getElementById('poiDoneBtn');
  if (done) done.disabled = poiSession.length === 0;
}
function clearPoiSession() {
  if (!poiSession.length) return;
  const ids = new Set(poiSession);
  if (navPoi && ids.has(navPoi.id)) stopNav();
  pois = pois.filter(p => !ids.has(p.id));
  poiSession = [];
  poiSessionRedo = [];
  persistPois();
  renderPois();
  updateUndoRedoUI();
  toast({ type: 'info', title: 'POI de la sesión eliminados', duration: 1600 });
}

function persistPois() {
  try { localStorage.setItem('medidor_pois', JSON.stringify(pois)); } catch (e) {}
  const badge = document.getElementById('poiBadge');
  if (badge) badge.textContent = pois.length;
  const btn = document.getElementById('poiBtn');
  if (btn) btn.disabled = pois.length === 0;
}

function loadPois() {
  try {
    const raw = localStorage.getItem('medidor_pois');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('formato');
        pois = parsed;
      } catch (err) {
        try { localStorage.setItem('medidor_pois_corrupto_' + Date.now(), raw); } catch (e2) {}
        pois = [];
      }
    }
  } catch (e) { pois = []; }
  persistPois();
  renderPois();
}

function poiIcon(color) {
  const fill = safeColor(color, POI_DEFAULT_COLOR);
  const svg = `<svg class="poi-pin" viewBox="0 0 22 34" xmlns="http://www.w3.org/2000/svg">
    <path d="M11 33.2 C11 33.2 1.4 20.2 1.4 12.4 C1.4 6.4 5.6 1.6 11 1.6 C16.4 1.6 20.6 6.4 20.6 12.4 C20.6 20.2 11 33.2 11 33.2 Z" fill="${fill}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
    <circle cx="11" cy="12.2" r="3.2" fill="#fff"/>
  </svg>`;
  return L.divIcon({
    className: '',
    html: svg,
    iconSize: [22, 34],
    iconAnchor: [11, 34]
  });
}

function renderPois() {
  poiLayers.forEach(l => map.removeLayer(l));
  poiLayers = [];
  pois.forEach(p => {
    if (p.visible === false) return;
    const marker = L.marker([p.lat, p.lng], { icon: poiIcon(p.color), zIndexOffset: 1200 }).addTo(map);
    marker.bindTooltip(escapeHtml(p.name), { permanent: true, direction: 'top', className: 'poi-label', offset: [0, -36] });
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      if (poiMode) return;
      showPoiInfo(p);
    });
    poiLayers.push(marker);
  });
  renderPoiList();
}

function renderPoiList() {
  const list = document.getElementById('poiList');
  if (!list) return;
  list.innerHTML = '';
  if (!pois.length) {
    list.innerHTML = '<div class="text-center py-10 text-slate-500 text-xs">Sin puntos de interés</div>';
    return;
  }
  pois.forEach(p => {
    const div = document.createElement('div');
    div.className = 'bg-slate-950 border border-slate-800 rounded-xl p-3';
    const navigating = navPoi && navPoi.id === p.id;
    div.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${safeColor(p.color, POI_DEFAULT_COLOR)}"></span>
        <div class="flex-1 min-w-0">
          <div class="font-bold text-xs truncate">${escapeHtml(p.name)}</div>
          <div class="text-[10px] text-slate-500">${escapeHtml(settings.coords === 'dec' ? (+p.lat).toFixed(5) + ', ' + (+p.lng).toFixed(5) : fmtCoord(p.lat, p.lng))}${(typeof p.elev === 'number' && p.elevAt === elevKey(p)) ? ' · ' + fmtElev(p.elev) + ' s.n.m.' : ''}</div>
        </div>
        <button data-nav="${p.id}" class="text-[11px] font-semibold px-2 py-1 rounded-lg border ${navigating ? 'bg-rose-500/15 text-rose-300 border-rose-500/40' : 'bg-sky-500/15 text-sky-300 border-sky-500/40'}">${navigating ? 'Dejar de navegar' : 'Navegar'}</button>
        <button data-edit="${p.id}" class="text-[11px] font-semibold px-2 py-1 rounded-lg border bg-amber-500/15 text-amber-200 border-amber-500/30">Editar</button>
        <button data-go="${p.id}" class="text-[11px] font-semibold px-2 py-1 rounded-lg border bg-slate-800 text-slate-300 border-slate-700">Ir</button>
        <button data-del="${p.id}" class="p-1.5 text-red-500" title="Eliminar"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
      </div>`;
    list.appendChild(div);
    div.querySelector(`[data-edit="${p.id}"]`).onclick = () => openPoiModal(L.latLng(p.lat, p.lng), p);
    div.querySelector(`[data-nav="${p.id}"]`).onclick = () => {
      if (navPoi && navPoi.id === p.id) { stopNav(); renderPoiList(); toast({ type: 'info', title: 'Navegación cancelada', duration: 1400 }); }
      else startNavToPoi(p);
    };
    div.querySelector(`[data-go="${p.id}"]`).onclick = () => {
      map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 17), { duration: 0.8 });
      document.getElementById('poiDrawer').classList.add('hidden');
    };
    div.querySelector(`[data-del="${p.id}"]`).onclick = () => deletePoi(p.id);
  });
  lucide.createIcons();
}

function stopNav() {
  navPoi = null;
  setTimeout(updateLiveBadge, 0);
  if (navLine) { map.removeLayer(navLine); navLine = null; }
}

function startNavToPoi(p) {
  if (!p) return;
  navPoi = p;
  document.getElementById('poiDrawer').classList.add('hidden');
  if (!userLocMarker) {
    toast({ type: 'info', title: 'Buscando ubicación', message: 'Esperá la señal GPS para trazar la cuerda.', duration: 2000 });
    startUserLocationWatch(true);
  } else {
    updateNavLine();
  }
  toast({ type: 'success', title: 'Navegando', message: `Hacia «${p.name}». Tocá el mapa o Dejar de navegar para cancelar.`, duration: 2600 });
}

function updateNavLine() {
  if (!navPoi || !userLocMarker) return;
  const from = userLocMarker.getLatLng();
  const to = L.latLng(navPoi.lat, navPoi.lng);
  const dist = from.distanceTo(to);
  const color = safeColor(navPoi.color, '#38bdf8');
  if (!navLine) {
    navLine = L.polyline([from, to], { color, weight: 3, dashArray: '8,6', interactive: false }).addTo(map);
  } else {
    navLine.setLatLngs([from, to]);
    navLine.setStyle({ color });
  }
  updateLiveBadge();   // rumbo y distancia en vivo en los números flotantes
  if (dist < 15) {
    toast({ type: 'success', title: 'Llegaste', message: `Estás en «${navPoi.name}».`, duration: 2500 });
    stopNav();
  }
}

function deletePoi(id) {
  if (navPoi && navPoi.id === id) stopNav();
  pois = pois.filter(p => p.id !== id);
  persistPois();
  renderPois();
  toast({ type: 'info', title: 'POI eliminado', duration: 1600 });
}

function openPoiDrawer() {
  renderPoiList();
  document.getElementById('poiDrawer').classList.remove('hidden');
}

// ========== SAVE / LOAD ==========
function openSaveModal() {
  if (!drawingActive && !trackMode) return;
  if (isLocked) return toast({ type: 'warning', title: 'Medición bloqueada', message: 'Entrá en Editar para modificarla.' });
  if (points.length < 2) return toast({ type: 'warning', title: 'Muy pocos puntos', message: 'Agregá al menos 2 puntos antes de guardar.' });
  if (trackMode && gpsWatchId !== null) return toast({ type: 'info', title: 'Grabación en curso', message: 'Detené la grabación antes de guardar.' });
  // Al editar: guardar cambios directo, sin modal
  if (editingId) {
    const existing = saved.find(s => s.id === editingId);
    commitSave(existing ? existing.name : `Medición ${saved.length + 1}`);
    return;
  }
  const isTrack = trackMode;
  document.getElementById('saveNameInput').value = isTrack ? `Recorrido ${saved.length + 1}` : `Medición ${saved.length + 1}`;
  const title = document.querySelector('#saveModal h3');
  if (title) title.textContent = isTrack ? 'Guardar recorrido' : 'Guardar Medición';
  const confirmBtn = document.getElementById('confirmSaveBtn');
  if (confirmBtn) confirmBtn.textContent = 'Guardar';
  document.getElementById('saveModal').classList.remove('hidden');
}

function confirmSave() {
  if (points.length < 2) return toast({ type: 'warning', title: 'Muy pocos puntos', message: 'Agregá al menos 2 puntos.' });
  const name = document.getElementById('saveNameInput').value.trim() || `Medición ${saved.length + 1}`;
  document.getElementById('saveModal').classList.add('hidden');
  commitSave(name);
}

function commitSave(name) {
  if (points.length < 2) return toast({ type: 'warning', title: 'Muy pocos puntos', message: 'Agregá al menos 2 puntos.' });
  const pts = points.map(p => ({ lat: p.lat, lng: p.lng }));
  let item;
  const wasEdit = !!editingId;
  const savedMode = mode;
  if (editingId) {
    const idx = saved.findIndex(s => s.id === editingId);
    if (idx >= 0) {
      saved[idx] = { ...saved[idx], name, mode: savedMode, color: safeColor(themeColor), date: new Date().toLocaleDateString('es-AR'), points: pts, visible: true };
      item = saved[idx];
    }
  }
  if (!item) {
    item = { id: Date.now().toString(), name, mode: savedMode, color: safeColor(themeColor), date: new Date().toLocaleDateString('es-AR'), points: pts, visible: true };
    saved.push(item);
  }
  persist();
  renderSaved();
  removeLockedLayer(item.id);
  addLockedLayer(item);
  const wasTrack = trackMode;
  clearActiveMeasurement();
  if (wasTrack) enterTrackMode();
  const badge = document.getElementById('savedBadge');
  badge.classList.add('scale-125');
  setTimeout(() => badge.classList.remove('scale-125'), 300);
  toast({
    type: 'success',
    title: wasEdit ? 'Cambios guardados' : 'Guardado',
    message: wasEdit ? `"${name}" se actualizó correctamente.` : `"${name}" se guardó correctamente.`
  });
}

function persist() {
  try {
    localStorage.setItem('medidor_v2', JSON.stringify(saved));
    document.getElementById('savedBadge').textContent = saved.length;
    const btn = document.getElementById('savedBtn');
    if (btn) btn.disabled = saved.length === 0;
  } catch (e) {
    toast({ type: 'error', title: 'No se pudo guardar', message: 'El almacenamiento del navegador está lleno o bloqueado.' });
  }
}

function loadSaved() {
  try {
    const raw = localStorage.getItem('medidor_v2');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('formato');
        saved = parsed.filter(s => s && Array.isArray(s.points));
      } catch (err) {
        // No pisar datos ilegibles: se resguardan antes de seguir
        try { localStorage.setItem('medidor_v2_corrupto_' + Date.now(), raw); } catch (e2) {}
        saved = [];
        setTimeout(() => toast({ type: 'error', title: 'Datos dañados', message: 'No se pudieron leer las mediciones guardadas. Se conservó una copia de respaldo en el navegador.', duration: 8000 }), 600);
      }
    }
  } catch (e) {}
  document.getElementById('savedBadge').textContent = saved.length;
  const btn = document.getElementById('savedBtn');
  if (btn) btn.disabled = saved.length === 0;
  setTimeout(() => refreshLockedLayers(), 300);
}

function openSaved() {
  renderSaved();
  updateBackupInfo();
  document.getElementById('savedDrawer').classList.remove('hidden');
}

function renderSaved() {
  const list = document.getElementById('savedList');
  list.innerHTML = '';
  if (!saved.length) {
    list.innerHTML = '<div class="text-center py-10 text-slate-500 text-xs">Sin mediciones guardadas</div>';
    return;
  }
  saved.forEach(item => {
    const isVisible = item.visible !== false;
    const div = document.createElement('div');
    div.className = 'bg-slate-950 border border-slate-800 rounded-xl p-3';
    div.innerHTML = `
      <div class="flex justify-between items-start gap-2">
        <div class="flex flex-col flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${safeColor(item.color)}"></span>
            <span class="font-bold text-xs truncate">${escapeHtml(item.name)}</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 uppercase flex-shrink-0">${item.mode}</span>
          </div>
          <span class="text-[11px] text-slate-500 mt-0.5">${item.points.length} pts · ${item.date}</span>
        </div>
      </div>
      <div class="flex items-center gap-1.5 mt-2">
        <button data-vis="${item.id}" class="flex-1 text-[11px] font-semibold py-1.5 rounded-lg border ${isVisible ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-slate-800 text-slate-400 border-slate-700'}">
          ${isVisible ? 'Visible' : 'Oculta'}
        </button>
        <button data-edit="${item.id}" class="flex-1 text-[11px] font-semibold py-1.5 rounded-lg border bg-sky-500/15 text-sky-300 border-sky-500/30">
          Editar
        </button>
        <button data-focus="${item.id}" class="flex-1 text-[11px] font-semibold py-1.5 rounded-lg border bg-slate-800 text-slate-300 border-slate-700">
          Ir
        </button>
        <button class="p-1.5 text-red-500 hover:text-red-400 flex-shrink-0" data-del="${item.id}" title="Eliminar">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      </div>`;
    list.appendChild(div);

    div.querySelector(`[data-vis="${item.id}"]`).onclick = (e) => {
      e.stopPropagation();
      item.visible = !(item.visible !== false);
      persist();
      if (item.visible) addLockedLayer(item);
      else removeLockedLayer(item.id);
      renderSaved();
    };

    // Editar: carga la medición en el editor y la desbloquea
    div.querySelector(`[data-edit="${item.id}"]`).onclick = (e) => {
      e.stopPropagation();
      document.getElementById('savedDrawer').classList.add('hidden');
      hideMeasurementInfo();
      stopGpsTracking();

      // Si se estaba editando otra medición, restaurarla en el mapa
      if (editingId && editingId !== item.id) {
        const prev = saved.find(s => s.id === editingId);
        if (prev && prev.visible !== false) {
          removeLockedLayer(prev.id);
          addLockedLayer(prev);
        }
      }

      // Limpiar medición activa sin tocar las guardadas
      markers.forEach(m => map.removeLayer(m));
      midMarkers.forEach(m => map.removeLayer(m));
      labels.forEach(l => map.removeLayer(l));
      clearKinkMarkers();
      if (polyLayer) map.removeLayer(polyLayer);
      if (lineLayer) map.removeLayer(lineLayer);
      if (guideLine) { map.removeLayer(guideLine); guideLine = null; }
      if (touchDot) { map.removeLayer(touchDot); touchDot = null; }
      markers = []; midMarkers = []; labels = [];
      polyLayer = lineLayer = null;
      points = [];

      // Quitar esta medición de las locked layers mientras se edita
      removeLockedLayer(item.id);

      editingId = item.id;
      isLocked = false;
      setDrawingActive(true);
      updateLockUI();

      setMode(item.mode || 'polygon');
      themeColor = item.color || '#00ff66';
      document.documentElement.style.setProperty('--theme-color', themeColor);
      applyLabelTint(themeColor);
      document.querySelectorAll('.color-swatch').forEach(b => {
        b.classList.toggle('active', b.dataset.color === themeColor);
      });
      points = item.points.map(p => L.latLng(p.lat, p.lng));
      rebuildMarkers();
      redraw();
      resetHistory();
      if (points.length) pushHistory();
      if (points.length) {
        map.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lng])), { padding: [60, 60], maxZoom: 18 });
      }

      toast({ type: 'info', title: 'Edición activa', message: `"${item.name}" está lista para editar. Usá Nueva para cancelar sin guardar.` });
    };

    // Ir: hacer fitBounds a la medición
    div.querySelector(`[data-focus="${item.id}"]`).onclick = (e) => {
      e.stopPropagation();
      if (item.points && item.points.length) {
        map.fitBounds(L.latLngBounds(item.points.map(p => [p.lat, p.lng])), { padding: [60, 60], maxZoom: 18 });
      }
      document.getElementById('savedDrawer').classList.add('hidden');
    };

    // Eliminar con confirmación
    div.querySelector(`[data-del="${item.id}"]`).onclick = async (e) => {
      e.stopPropagation();
      const ok = await confirmToast({
        title: '¿Eliminar medición?',
        message: `"${item.name}" se va a borrar. Esta acción no se puede deshacer.`,
        confirmLabel: 'Eliminar',
        danger: true
      });
      if (!ok) return;
      removeLockedLayer(item.id);
      if (inspectItem && inspectItem.id === item.id) hideMeasurementInfo();
      saved = saved.filter(s => s.id !== item.id);
      if (editingId === item.id) editingId = null;
      persist();
      renderSaved();
      toast({ type: 'success', title: 'Eliminada', message: `"${item.name}" fue eliminada.` });
    };
  });
  lucide.createIcons();
}

// ----- Recordatorio de respaldo: los datos viven solo en este navegador -----
const LAST_BACKUP_KEY = 'medidor_last_backup';
const BACKUP_SNOOZE_KEY = 'medidor_backup_snooze';
const BACKUP_EVERY_DAYS = 14;
function readNum(key) { try { return +localStorage.getItem(key) || 0; } catch (e) { return 0; } }
function backupAgeDays() { const t = readNum(LAST_BACKUP_KEY); return t ? (Date.now() - t) / 86400000 : null; }
function updateBackupInfo() {
  const el = document.getElementById('backupInfo');
  if (!el) return;
  const d = backupAgeDays();
  el.textContent = d === null ? 'Todavía no exportaste una copia de tus datos.'
    : d < 1 ? 'Última copia exportada: hoy.' : `Última copia exportada: hace ${Math.floor(d)} día${Math.floor(d) === 1 ? '' : 's'}.`;
  el.classList.toggle('text-amber-300', d === null || d > BACKUP_EVERY_DAYS);
  el.classList.toggle('text-slate-500', !(d === null || d > BACKUP_EVERY_DAYS));
}
function checkBackupReminder() {
  if (!saved.length && !pois.length) return;
  if (gpsWatchId !== null || Date.now() < readNum(BACKUP_SNOOZE_KEY)) return;
  const d = backupAgeDays();
  if (d !== null && d <= BACKUP_EVERY_DAYS) return;
  toast({
    type: 'warning', title: 'Copia de seguridad',
    message: d === null
      ? 'Tus mediciones y POI solo están en este navegador. Exportá una copia para no perderlos.'
      : `Hace ${Math.floor(d)} días que no exportás una copia de tus datos.`,
    duration: 0,
    actions: [
      { label: 'Luego', style: 'secondary', onClick: () => { try { localStorage.setItem(BACKUP_SNOOZE_KEY, String(Date.now() + 3 * 86400000)); } catch (e) {} } },
      { label: 'Exportar ahora', onClick: exportGeoJSON }
    ]
  });
}

function exportGeoJSON() {
  if (!saved.length && !pois.length) {
    toast({ type: 'warning', title: 'Nada para exportar', message: 'Todavía no hay mediciones ni POI guardados.' });
    return;
  }
  const features = saved.map(m => {
    const coords = m.points.map(p => [p.lng, p.lat]);
    const asPoly = m.mode === 'polygon' && coords.length >= 3; // 2 puntos no forman polígono válido
    if (asPoly) coords.push(coords[0]);
    return {
      type: 'Feature',
      properties: { name: m.name, mode: asPoly ? 'polygon' : (m.mode === 'polygon' ? 'line' : m.mode), color: m.color, date: m.date },
      geometry: {
        type: asPoly ? 'Polygon' : 'LineString',
        coordinates: asPoly ? [coords] : coords
      }
    };
  });
  pois.forEach(p => {
    if (!Number.isFinite(+p.lat) || !Number.isFinite(+p.lng)) return;
    features.push({
      type: 'Feature',
      properties: { kind: 'poi', name: p.name, note: p.note || '', color: p.color },
      geometry: { type: 'Point', coordinates: [+p.lng, +p.lat] }
    });
  });
  const blob = new Blob([JSON.stringify({ type: 'FeatureCollection', features }, null, 2)], { type: 'application/geo+json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mediciones_${Date.now()}.geojson`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  try { localStorage.setItem(LAST_BACKUP_KEY, String(Date.now())); } catch (e) {}
  updateBackupInfo();
  toast({ type: 'success', title: 'Exportado', message: `${features.length - pois.length} medición(es) y ${pois.length} POI exportados.` });
}

function importGeoJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const json = JSON.parse(ev.target.result);
      const features = json.type === 'FeatureCollection'
        ? (json.features || [])
        : (json.type === 'Feature' ? [json] : []);
      if (!features.length) throw new Error('Sin features');
      let count = 0;
      let poiCount = 0;
      let holes = 0;     // polígonos con huecos (no soportados)
      let invalid = 0;   // geometrías sin puntos válidos o de tipo no soportado
      let dupes = 0;     // POI ya existentes
      features.forEach(f => {
        if (!f.geometry || !f.geometry.coordinates) { invalid++; return; }
        const t = f.geometry.type;
        const props = f.properties || {};
        const push = (raw, isPoly, suffix = '') => {
          if (!Array.isArray(raw)) { invalid++; return; }
          let coords = raw;
          if (isPoly && coords.length > 1 &&
              coords[0][0] === coords[coords.length-1][0] &&
              coords[0][1] === coords[coords.length-1][1]) {
            coords = coords.slice(0, -1);
          }
          const clean = coords.filter(c =>
            Array.isArray(c) && Number.isFinite(+c[0]) && Number.isFinite(+c[1]) &&
            Math.abs(+c[0]) <= 180 && Math.abs(+c[1]) <= 90
          );
          if (clean.length < (isPoly ? 3 : 2)) { invalid++; return; }
          saved.push({
            id: Date.now().toString() + Math.random().toString(16).slice(2),
            name: String(props.name || 'Importado') + suffix,
            mode: isPoly ? 'polygon' : 'line',
            color: /^#[0-9a-f]{6}$/i.test(props.color || '') ? props.color : '#00ff66',
            date: new Date().toLocaleDateString('es-AR'),
            points: clean.map(c => ({ lat: +c[1], lng: +c[0] })),
            visible: true
          });
          count++;
        };
        if (t === 'Point' || t === 'MultiPoint') {
          const pts = t === 'Point' ? [f.geometry.coordinates] : f.geometry.coordinates;
          pts.forEach((c, i) => {
            if (!Array.isArray(c) || !Number.isFinite(+c[0]) || !Number.isFinite(+c[1]) ||
                Math.abs(+c[0]) > 180 || Math.abs(+c[1]) > 90) { invalid++; return; }
            const lat = +c[1], lng = +c[0];
            const name = String(props.name || 'POI importado') + (t === 'MultiPoint' ? ` (${i + 1})` : '');
            if (pois.some(p => p.name === name && Math.abs(p.lat - lat) < 1e-7 && Math.abs(p.lng - lng) < 1e-7)) { dupes++; return; }
            pois.push({
              id: Date.now().toString() + Math.random().toString(16).slice(2),
              name, note: String(props.note || ''),
              color: safeColor(props.color, POI_DEFAULT_COLOR),
              lat, lng, visible: true
            });
            poiCount++;
          });
          return;
        }
        if (t === 'Polygon') {
          if (f.geometry.coordinates.length === 1) push(f.geometry.coordinates[0], true);
          else holes++;
        }
        else if (t === 'MultiPolygon') f.geometry.coordinates.forEach((poly, i) => {
          if (poly.length === 1) push(poly[0], true, ` (${i+1})`); else holes++;
        });
        else if (t === 'LineString') push(f.geometry.coordinates, false);
        else if (t === 'MultiLineString') f.geometry.coordinates.forEach((line, i) => push(line, false, ` (${i+1})`));
        else invalid++;
      });
      if (!count && !poiCount) throw new Error('Sin geometrías válidas');
      if (count) { persist(); renderSaved(); refreshLockedLayers(); }
      if (poiCount) { persistPois(); renderPois(); }
      const omitted = [];
      if (holes) omitted.push(`${holes} polígono(s) con huecos`);
      if (invalid) omitted.push(`${invalid} geometría(s) inválida(s) o no soportada(s)`);
      if (dupes) omitted.push(`${dupes} POI ya existente(s)`);
      toast({
        type: omitted.length ? 'warning' : 'success',
        title: 'Importado',
        duration: omitted.length ? 8000 : 3500,
        message: `${count} medición(es) y ${poiCount} POI importados.` +
          (omitted.length ? ` Omitidos: ${omitted.join(', ')}.` : '')
      });
    } catch (err) {
      toast({ type: 'error', title: 'Error al importar', message: 'Verificá que sea un GeoJSON válido (Polygon, MultiPolygon, LineString, MultiLineString o Point).' });
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}
// ========== ALTITUD (s.n.m.) y PERFIL ==========
// Fuente: Copernicus DEM GLO-90 (90 m) vía Open-Meteo; respaldo: Open Topo Data (SRTM).
// Es un modelo de superficie: precisión de varios metros y, bajo monte, incluye la copa de los árboles.
const ELEV_CACHE_KEY = 'medidor_elev_v1';
let elevCache = null;
const elevKey = (ll) => (+ll.lat).toFixed(4) + ',' + (+ll.lng).toFixed(4); // ≈ 11 m
function loadElevCache() {
  if (elevCache) return;
  try { elevCache = JSON.parse(localStorage.getItem(ELEV_CACHE_KEY)) || {}; } catch (e) { elevCache = {}; }
}
function saveElevCache() {
  try {
    const keys = Object.keys(elevCache);
    if (keys.length > 4000) keys.slice(0, keys.length - 4000).forEach(k => delete elevCache[k]);
    localStorage.setItem(ELEV_CACHE_KEY, JSON.stringify(elevCache));
  } catch (e) {}
}
const elevConv = (m) => isImp() ? m * FT : m;
const elevUnit = () => isImp() ? 'ft' : 'm';
const fmtElev = (m) => `${nf0.format(elevConv(m))} ${elevUnit()}`;

async function requestElevations(chunk) {
  if (navigator.onLine === false) return null;
  const get = async (url, parse) => {
    for (let intento = 0; intento < 2; intento++) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 9000);
      try {
        const r = await fetch(url, { signal: ctl.signal });
        if (r.ok) return parse(await r.json());
        if (r.status >= 400 && r.status < 500 && r.status !== 429) return null; // pedido inválido: reintentar no sirve
      } catch (e) { /* corte de red o tiempo agotado: se reintenta una vez */ } finally { clearTimeout(t); }
      if (intento === 0) await new Promise(res => setTimeout(res, 800));
    }
    return null;
  };
  const lat = chunk.map(c => c.lat).join(','), lng = chunk.map(c => c.lng).join(',');
  let v = await get(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`,
    j => Array.isArray(j.elevation) ? j.elevation : null);
  if (v && v.length === chunk.length) return v;
  const locs = chunk.map(c => c.lat + ',' + c.lng).join('|');
  v = await get(`https://api.opentopodata.org/v1/srtm30m?locations=${locs}`,
    j => Array.isArray(j.results) ? j.results.map(r => r.elevation) : null);
  return (v && v.length === chunk.length) ? v : null;
}
/** Altitudes (m) de una lista de puntos; null donde no se pudo obtener (sin conexión, etc.) */
async function fetchElevations(lls) {
  loadElevCache();
  const out = new Array(lls.length).fill(null);
  const idx = new Map(), need = [];
  lls.forEach((ll, i) => {
    const k = elevKey(ll);
    if (typeof elevCache[k] === 'number') { out[i] = elevCache[k]; return; }
    if (!idx.has(k)) { idx.set(k, []); need.push({ k, lat: +(+ll.lat).toFixed(4), lng: +(+ll.lng).toFixed(4) }); }
    idx.get(k).push(i);
  });
  for (let s = 0; s < need.length; s += 100) {
    const chunk = need.slice(s, s + 100);
    const vals = await requestElevations(chunk);
    if (!vals) break;
    chunk.forEach((c, j) => {
      const v = vals[j];
      if (typeof v === 'number' && isFinite(v)) { elevCache[c.k] = v; idx.get(c.k).forEach(i => { out[i] = v; }); }
    });
  }
  if (need.length) saveElevCache();
  return out;
}
function itemSig(item) {
  const str = item.mode + '|' + item.points.map(p => (+p.lat).toFixed(6) + ',' + (+p.lng).toFixed(6)).join(';');
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return String(h);
}

/** Superficie: puntos de muestra = vértices + malla interior uniforme (la media de la malla pesa por área) */
function polygonElevStats(item) {
  const lls = item.points.map(p => L.latLng(p.lat, p.lng));
  const ring = lls.map(p => [p.lng, p.lat]); ring.push(ring[0]);
  let inner = [];
  let extra = [];
  try {
    const poly = turf.polygon([ring]);
    const pof = turf.pointOnFeature(poly).geometry.coordinates;
    extra.push(L.latLng(pof[1], pof[0]));
    const room = Math.max(0, 100 - lls.length - 1);
    if (room >= 4) {
      const cell = Math.max(30, Math.sqrt(turf.area(poly) / Math.min(room, 64)));
      const grid = turf.pointGrid(turf.bbox(poly), cell / 1000, { units: 'kilometers', mask: poly }).features;
      const step = Math.max(1, Math.ceil(grid.length / room));
      for (let i = 0; i < grid.length; i += step) inner.push(L.latLng(grid[i].geometry.coordinates[1], grid[i].geometry.coordinates[0]));
    }
  } catch (e) {}
  return { lls, inner, extra };
}
async function getItemElev(item) {
  const sig = itemSig(item);
  if (item.elev && item.elev.sig === sig) return item.elev;
  const { lls, inner, extra } = polygonElevStats(item);
  const all = lls.concat(extra, inner);
  const z = await fetchElevations(all);
  const ok = z.filter(v => v !== null);
  if (!ok.length) return null;
  const zi = z.slice(lls.length + extra.length).filter(v => v !== null);
  const zb = z.slice(0, lls.length + extra.length).filter(v => v !== null);
  const base = zi.length >= 3 ? zi : zb;             // malla interior si hay; si no, vértices
  const mean = base.reduce((a, b) => a + b, 0) / base.length;
  item.elev = { sig, mean, min: Math.min(...ok), max: Math.max(...ok), n: ok.length };
  persist();
  return item.elev;
}

/** Línea/recorrido: muestras equiespaciadas a lo largo del trazado (≤ 100) */
function lineSamples(lls) {
  const cum = [0];
  for (let i = 1; i < lls.length; i++) cum.push(cum[i - 1] + lls[i - 1].distanceTo(lls[i]));
  const total = cum[cum.length - 1];
  if (!(total >= 1)) return null;
  const n = Math.min(100, Math.max(2, Math.ceil(total / 50) + 1));
  const out = [];
  let seg = 1;
  for (let k = 0; k < n; k++) {
    const d = total * k / (n - 1);
    while (seg < cum.length - 1 && cum[seg] < d) seg++;
    const a = lls[seg - 1], b = lls[seg];
    const t = Math.min(1, Math.max(0, (d - cum[seg - 1]) / ((cum[seg] - cum[seg - 1]) || 1)));
    out.push({ d, ll: L.latLng(a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t) });
  }
  return { samples: out, total };
}
function profileStats(z) {
  // Subida/bajada sobre serie suavizada (media móvil de 3) para no inflar el ruido del modelo
  const zs = z.map((v, i) => { if (i === 0 || i === z.length - 1) return v; const w = z.slice(i - 1, i + 2); return (w[0] + w[1] + w[2]) / 3; });
  let up = 0, down = 0;
  for (let i = 1; i < zs.length; i++) { const d = zs[i] - zs[i - 1]; if (d > 0) up += d; else down -= d; }
  return { min: Math.min(...z), max: Math.max(...z), start: z[0], end: z[z.length - 1], up, down };
}
async function getItemProfile(item) {
  const sig = itemSig(item);
  if (item.prof && item.prof.sig === sig) return item.prof;
  const smp = lineSamples(item.points.map(p => L.latLng(p.lat, p.lng)));
  if (!smp) return null;
  const z = await fetchElevations(smp.samples.map(s => s.ll));
  if (z.every(v => v === null)) return null;
  // huecos sueltos: se interpolan con los vecinos
  for (let i = 0; i < z.length; i++) {
    if (z[i] !== null) continue;
    let a = i - 1; while (a >= 0 && z[a] === null) a--;
    let b = i + 1; while (b < z.length && z[b] === null) b++;
    z[i] = a < 0 ? z[b] : b >= z.length ? z[a] : z[a] + (z[b] - z[a]) * (i - a) / (b - a);
  }
  item.prof = { sig, d: smp.samples.map(s => Math.round(s.d)), z: z.map(v => Math.round(v * 10) / 10), total: smp.total };
  persist();
  return item.prof;
}

const elevCard = (inner) => `<div id="infoElev" class="col-span-2 bg-slate-950/80 rounded-xl p-2.5 border border-slate-800">${inner}</div>`;
const elevMsg = (t) => `<div class="text-[10px] text-slate-400 uppercase">Altitud s.n.m.</div><div class="text-[11px] text-slate-500">${t}</div>`;
const elevFail = '<span>No disponible sin conexión.</span> <button id="infoElevRetry" class="underline text-amber-300">Reintentar</button>';
function setInfoElev(html, itemOrPoi, retry) {
  if (inspectItem !== itemOrPoi && inspectPoi !== itemOrPoi) return;   // ya se cerró o se abrió otra consulta
  const el = document.getElementById('infoElev');
  if (!el) return;
  el.innerHTML = html;
  const r = document.getElementById('infoElevRetry');
  if (r && retry) r.onclick = retry;
  lucide.createIcons();
}
let inspectPoi = null;
function loadInfoElevForItem(item) {
  setInfoElev(elevMsg('Calculando…'), item);
  const retry = () => loadInfoElevForItem(item);
  if (item.mode === 'polygon') {
    getItemElev(item).then(e => {
      if (!e) return setInfoElev(elevMsg(elevFail), item, retry);
      setInfoElev(`<div class="text-[10px] text-slate-400 uppercase">Altitud media s.n.m.</div>
        <div class="text-lg font-bold text-amber-300">${fmtElev(e.mean)}</div>
        <div class="text-[11px] text-slate-500">mín ${fmtElev(e.min)} · máx ${fmtElev(e.max)} · desnivel ${fmtElev(e.max - e.min)}</div>`, item);
    });
  } else {
    getItemProfile(item).then(p => {
      if (!p) return setInfoElev(elevMsg(elevFail), item, retry);
      const st = profileStats(p.z);
      setInfoElev(`<div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-[10px] text-slate-400 uppercase">Altitud s.n.m.</div>
          <div class="text-sm font-bold text-amber-300">${fmtElev(st.start)} → ${fmtElev(st.end)}</div>
          <div class="text-[11px] text-slate-500">subida +${fmtElev(st.up)} · bajada −${fmtElev(st.down)}</div>
        </div>
        <button id="infoProfileBtn" class="flex-shrink-0 text-[11px] font-bold px-3 py-2 rounded-lg border bg-amber-500/20 text-amber-200 border-amber-500/40 inline-flex items-center gap-1"><i data-lucide="mountain" class="w-3.5 h-3.5"></i> Ver perfil</button>
      </div>`, item);
      const b = document.getElementById('infoProfileBtn');
      if (b) b.onclick = () => openProfile(item);
    });
  }
}
function loadInfoElevForPoi(p) {
  const key = elevKey(p);
  if (typeof p.elev === 'number' && p.elevAt === key) {
    setInfoElev(`<div class="text-[10px] text-slate-400 uppercase">Altitud s.n.m.</div><div class="text-lg font-bold text-amber-300">${fmtElev(p.elev)}</div>`, p);
    return;
  }
  setInfoElev(elevMsg('Calculando…'), p);
  fetchElevations([L.latLng(p.lat, p.lng)]).then(v => {
    if (v[0] === null) return setInfoElev(elevMsg(elevFail), p, () => loadInfoElevForPoi(p));
    p.elev = v[0]; p.elevAt = key;
    persistPois(); renderPoiList();
    loadInfoElevForPoi(p);
  });
}

// ----- Perfil de altura (gráfico) -----
function openProfile(item) {
  const modal = document.getElementById('profileModal');
  document.getElementById('profileTitle').textContent = item.name || 'Perfil de altura';
  const body = document.getElementById('profileBody');
  body.innerHTML = '<div class="py-10 text-center text-xs text-slate-400">Calculando perfil…</div>';
  modal.classList.remove('hidden');
  lucide.createIcons();
  getItemProfile(item).then(p => {
    if (modal.classList.contains('hidden')) return;
    if (!p) { body.innerHTML = '<div class="py-10 text-center text-xs text-slate-400">No hay datos de altura (se necesita conexión la primera vez).</div>'; return; }
    drawProfile(body, item, p);
  });
}
function closeProfile() { document.getElementById('profileModal')?.classList.add('hidden'); }
function drawProfile(body, item, p) {
  const W = 340, H = 180, l = 40, r = 10, t = 12, b = 24;
  const zs = p.z.map(elevConv);
  let zmin = Math.min(...zs), zmax = Math.max(...zs);
  if (zmax - zmin < 4) { const c = (zmax + zmin) / 2; zmin = c - 2; zmax = c + 2; }
  const pad = (zmax - zmin) * 0.08; zmin -= pad; zmax += pad;
  const total = p.total || p.d[p.d.length - 1] || 1;
  const X = (d) => l + (d / total) * (W - l - r);
  const Y = (z) => t + (1 - (z - zmin) / (zmax - zmin)) * (H - t - b);
  const pts = p.d.map((d, i) => [X(d), Y(zs[i])]);
  const line = pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
  const area = `${line} L${X(total).toFixed(1)} ${H - b} L${l} ${H - b} Z`;
  const color = safeColor(item.color, '#f59e0b');
  const yTicks = [0, 0.5, 1].map(f => zmin + (zmax - zmin) * f);
  const grid = yTicks.map(v => `<line x1="${l}" x2="${W - r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="#334155" stroke-width="0.6" stroke-dasharray="3 3"/>
    <text x="${l - 4}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#94a3b8">${nf0.format(v)}</text>`).join('');
  const xTicks = [0, 0.5, 1].map((f, i) => `<text x="${X(total * f).toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}" font-size="9" fill="#94a3b8">${escapeHtml(fmtLenShort(total * f))}</text>`).join('');
  const st = profileStats(p.z);
  const stat = (cap, val, cls) => `<div class="bg-slate-950/80 rounded-lg p-2 border border-slate-800 text-center"><div class="text-[9px] text-slate-400 uppercase">${cap}</div><div class="text-xs font-bold ${cls}">${val}</div></div>`;
  body.innerHTML = `
    <div id="profReadout" class="text-[11px] text-slate-300 h-4 mb-1 font-mono">Deslizá el dedo sobre el gráfico</div>
    <svg id="profSvg" viewBox="0 0 ${W} ${H}" class="w-full rounded-lg bg-slate-950 border border-slate-800" style="touch-action:none">
      <defs><linearGradient id="profGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".55"/><stop offset="100%" stop-color="${color}" stop-opacity=".05"/></linearGradient></defs>
      ${grid}${xTicks}
      <path d="${area}" fill="url(#profGrad)"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
      <line id="profCur" x1="0" x2="0" y1="${t}" y2="${H - b}" stroke="#fff" stroke-width="1" visibility="hidden"/>
      <circle id="profDot" r="4" fill="#fff" stroke="${color}" stroke-width="2" visibility="hidden"/>
    </svg>
    <div class="text-[9px] text-slate-500 mt-1">Altura en ${elevUnit()} s.n.m. · distancia a lo largo del trazado</div>
    <div class="grid grid-cols-4 gap-1.5 mt-2">
      ${stat('Mínima', fmtElev(st.min), 'text-sky-300')}${stat('Máxima', fmtElev(st.max), 'text-rose-300')}
      ${stat('Subida', '+' + fmtElev(st.up), 'text-emerald-300')}${stat('Bajada', '−' + fmtElev(st.down), 'text-amber-300')}
    </div>
    <p class="text-[10px] text-slate-500 mt-2 leading-snug">Datos: Copernicus DEM (90 m) vía Open-Meteo. Son aproximados: pueden variar varios metros y, bajo monte, incluyen la copa de los árboles.</p>`;
  const svg = document.getElementById('profSvg');
  const cur = document.getElementById('profCur'), dot = document.getElementById('profDot'), ro = document.getElementById('profReadout');
  const move = (ev) => {
    const rect = svg.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / rect.width * W;
    const d = Math.min(total, Math.max(0, (x - l) / (W - l - r) * total));
    let i = 0; while (i < p.d.length - 1 && p.d[i + 1] <= d) i++;
    if (i < p.d.length - 1 && d - p.d[i] > p.d[i + 1] - d) i++;
    cur.setAttribute('x1', pts[i][0]); cur.setAttribute('x2', pts[i][0]); cur.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', pts[i][0]); dot.setAttribute('cy', pts[i][1]); dot.setAttribute('visibility', 'visible');
    const j = Math.min(p.d.length - 1, i + 1), k = Math.max(0, i - 1);
    const run = p.d[j] - p.d[k];
    const slope = run > 0 ? (p.z[j] - p.z[k]) / run * 100 : 0;
    ro.textContent = `${fmtLenShort(p.d[i])} · ${fmtElev(p.z[i])} · pendiente ${slope >= 0 ? '+' : '−'}${Math.abs(slope).toFixed(0)}%`;
  };
  svg.onpointerdown = (ev) => { svg.setPointerCapture?.(ev.pointerId); move(ev); };
  svg.onpointermove = move;
}
function initProfileUI() {
  document.getElementById('profileCloseBtn').onclick = closeProfile;
  document.getElementById('profileModal').onclick = (e) => { if (e.target.id === 'profileModal') closeProfile(); };
}

// ========== GPS ==========
// Mantener la pantalla encendida mientras se graba: si el iPhone la apaga, Safari suspende el GPS y queda una brecha
let wakeLock = null;
async function acquireWakeLock() {
  try {
    if (!('wakeLock' in navigator)) return false;
    if (wakeLock) return true;
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
      // si el sistema lo soltó con la app a la vista y se sigue grabando, se vuelve a pedir
      if (gpsWatchId !== null && document.visibilityState === 'visible') acquireWakeLock();
    });
    return true;
  } catch (e) { wakeLock = null; return false; }
}
function releaseWakeLock() {
  try { if (wakeLock) wakeLock.release(); } catch (e) {}
  wakeLock = null;
}
let hiddenAt = null;
document.addEventListener('visibilitychange', () => {
  const recording = gpsWatchId !== null;
  if (document.visibilityState === 'hidden') {
    hiddenAt = recording ? Date.now() : null;
    return;
  }
  if (!recording) { hiddenAt = null; return; }
  acquireWakeLock(); // el bloqueo se pierde al apagarse la pantalla: se vuelve a pedir
  if (hiddenAt && Date.now() - hiddenAt > 20000) {
    const secs = Math.round((Date.now() - hiddenAt) / 1000);
    toast({ type: 'warning', title: 'Se perdió un tramo', message: `La pantalla estuvo apagada ${secs} s y el GPS no registró puntos. Se unió con una línea recta. Mantené la pantalla encendida al grabar.`, duration: 9000 });
  }
  hiddenAt = null;
});
// Estado en vivo del recorrido (se muestra en los números flotantes de la derecha)
const gpsLive = { msg: '', speed: null, heading: null, lastFix: null, recStart: null, recMs: 0 };

function setGpsBtnState(active) {
  const gpsBtn = document.getElementById('modeTrackBtn');
  if (!gpsBtn) return;
  const on = 'w-full flex items-center gap-2 py-2 px-2 rounded-lg text-xs font-bold text-white shadow min-h-[36px]';
  const off = 'w-full flex items-center gap-2 py-2 px-2 rounded-lg text-xs font-bold text-slate-300 bg-slate-800/70 border border-slate-600/50 min-h-[36px]';
  const selected = trackMode || active;
  gpsBtn.className = selected ? on + ' bg-rose-500/80' : off;
  gpsBtn.title = 'Modo recorrido';
  gpsBtn.setAttribute('aria-label', 'Modo recorrido');
  gpsBtn.disabled = false;
  gpsBtn.innerHTML = `<i id="gpsBtnIcon" data-lucide="route" class="w-4 h-4"></i> Medir recorrido`;
  lucide.createIcons();
  if (selected) {
    const idle = 'w-full flex items-center gap-2 py-2 px-2 rounded-lg text-xs font-bold text-slate-300 bg-slate-800/70 border border-slate-600/50 min-h-[36px]';
    ['modePolyBtn', 'modeLineBtn', 'modePoiBtn'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.className = idle;
    });
  }
}

function refreshTrackBar() {
  updateModeTheme();
  updateTrackButtons();
  const saveLabel = document.getElementById('saveBtnLabel');
  if (saveLabel && !document.getElementById('saveBtn')?.dataset.editing) {
    saveLabel.textContent = trackMode ? 'Guardar recorrido' : (editingId ? 'Guardar cambios' : 'Guardar medición');
  }
  try { updateLiveBadge(); } catch (e) {}
  const place = document.getElementById('poiPlaceHeaderBtn');
  if (place) {
    place.disabled = !poiMode;
    place.className = poiMode
      ? 'text-xs font-semibold bg-amber-500 text-slate-950 border border-amber-400 rounded-md inline-flex items-center justify-center gap-1 h-8 px-2 act-btn act-poi'
      : 'text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-md inline-flex items-center justify-center gap-1 h-8 px-2 act-btn act-poi';
  }
}

/** Fase del recorrido: idle (sin empezar) · rec (grabando) · paused · done (detenido) */
function trackPhase() {
  if (gpsWatchId !== null) return 'rec';
  if (trackEnded) return 'done';
  return trackStarted ? 'paused' : 'idle';
}
function updateTrackButtons() {
  const pause = document.getElementById('trackPauseBtn');
  const stop = document.getElementById('trackStopBtn');
  if (!pause || !stop) return;
  const ph = trackPhase();
  const label = ph === 'paused' ? 'Reanudar' : 'Pausar';
  if (pause.dataset.state !== label) {
    pause.dataset.state = label;
    pause.innerHTML = `<i data-lucide="${ph === 'paused' ? 'play' : 'pause'}" class="w-3.5 h-3.5"></i> ${label}`;
    pause.setAttribute('aria-label', label);
    lucide.createIcons();
  }
  const active = (ph === 'rec' || ph === 'paused') && !isLocked;
  pause.disabled = !active;
  stop.disabled = !active;
}
function enterTrackMode() {
  ensureMedir();
  if (isLocked) return toast({ type: 'warning', title: 'Medición bloqueada', message: 'Entrá en Editar para modificarla.' });
  if (poiMode) exitPoiMode(false);
  setDrawingActive(false);
  trackMode = true;
  trackStarted = false; trackEnded = false;
  mode = 'line';
  setGpsBtnState(false);
  refreshTrackBar();
  updateModeTheme();
}

/** Nueva medición en modo recorrido: descarta lo grabado y empieza a grabar de cero */
async function newTrack() {
  if (points.length >= 2) {
    const ok = await confirmToast({ title: '¿Empezar un recorrido nuevo?', message: 'Se descarta el recorrido actual si no lo guardaste.', confirmLabel: 'Descartar', danger: true });
    if (!ok) return;
  }
  pulseButton('newBtn');
  clearActiveMeasurement({ keepDrawing: false });
  enterTrackMode();
  startGpsRecording();
}

/** Empieza (o reanuda) la grabación de puntos por GPS */
function startGpsRecording() {
  if (isLocked) return toast({ type: 'warning', title: 'Medición bloqueada', message: 'Entrá en Editar para modificarla.' });
  if (!trackMode) enterTrackMode();
  if (gpsWatchId !== null) return;
  if (!navigator.geolocation) {
    return toast({ type: 'error', title: 'GPS no disponible', message: 'Tu navegador no soporta geolocalización.' });
  }
  gpsLive.msg = 'Buscando señal…'; gpsLive.speed = null; gpsLive.heading = null; gpsLive.lastFix = null;
  gpsLive.recStart = Date.now();
  trackStarted = true; trackEnded = false;
  const wakeOk = acquireWakeLock();
  setGpsBtnState(true);

  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const accuracy = pos.coords.accuracy;
      if (accuracy > settings.gpsMaxAcc) {
        gpsLive.msg = `Esperando señal ±${fmtAcc(accuracy)}`;
        updateLiveBadge();
        return;
      }
      gpsLive.msg = `±${fmtAcc(accuracy)}`;
      const next = L.latLng(pos.coords.latitude, pos.coords.longitude);
      // Velocidad (m/s): la del GPS si existe; si no, desplazamiento / tiempo entre fijos
      const nowT = pos.timestamp || Date.now();
      let sp = (typeof pos.coords.speed === 'number' && isFinite(pos.coords.speed)) ? pos.coords.speed : null;
      if (sp === null && gpsLive.lastFix && nowT > gpsLive.lastFix.t) {
        sp = gpsLive.lastFix.ll.distanceTo(next) / ((nowT - gpsLive.lastFix.t) / 1000);
      }
      gpsLive.speed = sp;
      gpsLive.heading = (typeof pos.coords.heading === 'number' && isFinite(pos.coords.heading) && sp !== null && sp > 0.5) ? pos.coords.heading : null;
      gpsLive.lastFix = { t: nowT, ll: next };
      if (!lastGpsPoint || lastGpsPoint.distanceTo(next) >= settings.gpsMinStep) {
        addPoint(next);
        lastGpsPoint = next;
        if (points.length === 1) map.setView(next, 18);
      }
      updateLiveBadge();
    },
    (err) => {
      gpsLive.msg = 'Sin señal GPS';
      stopGpsTracking({ keepMode: true });
      toast({ type: 'error', title: 'GPS interrumpido', message: geoErrorInfo(err), duration: 9000 });
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
  );
  refreshTrackBar();
  updateSessionButtons();

  if (points.length) {
    rebuildMarkers();
    redraw();
  }

  wakeOk.then(ok => {
    const base = `Caminá: se agregarán puntos solos (mín. ${fmtAcc(settings.gpsMinStep)}, precisión ≤ ${fmtAcc(settings.gpsMaxAcc)}). Usá Pausar o Detener.`;
    if (ok) return toast({ type: 'info', title: 'Grabando recorrido', message: base + ' La pantalla se mantiene encendida.' });
    // No se pudo mantener la pantalla encendida: si se apaga, el GPS deja de registrar puntos
    const msg = 'Este iPhone no permite mantener la pantalla encendida desde la app. Poné Ajustes › Pantalla y brillo › Bloqueo automático en «Nunca» mientras grabás, o se perderán tramos.';
    toast({ type: 'warning', title: 'Grabando, pero ojo con la pantalla', message: msg, duration: 12000 });
  });
}

function stopGpsTracking(opts = {}) {
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
  lastGpsPoint = null;
  releaseWakeLock();
  if (gpsLive.recStart) { gpsLive.recMs += Date.now() - gpsLive.recStart; gpsLive.recStart = null; }
  gpsLive.msg = ''; gpsLive.speed = null; gpsLive.heading = null; gpsLive.lastFix = null;
  if (!opts.keepMode) trackMode = false;
  refreshTrackBar();
  setGpsBtnState(false);
  updateSessionButtons();
  updateModeTheme();
  if (points.length) {
    rebuildMarkers();
    redraw();
    if (opts.keepMode && !opts.noClose && points.length >= 3 && points[points.length - 1].distanceTo(points[0]) <= closeThresholdMeters()) {
      offerClosePolygon();
    }
  }
}

// Modo sin conexión: requiere servir la app por https (o localhost) junto a sw.js
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// Start
window.addEventListener('DOMContentLoaded', init);
