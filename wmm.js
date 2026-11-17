// Modelo Magnético Mundial WMM2025 (NOAA/NCEI y British Geological Survey): declinación magnética sin conexión.
// Coeficientes oficiales de WMM.COF (época 2025.0, publicados el 13/11/2024). Obra del gobierno de EE. UU. (dominio público).
// Válido hasta fines de 2029: pasada esa fecha NOAA publica coeficientes nuevos (hay que reemplazar WMM_COF).
// Fórmulas: informe técnico del WMM (armónicos esféricos de grado 12, Legendre con normalización semi-Schmidt).
// Verificado contra los 100 valores de prueba oficiales (tests/wmm.test.js).
const WMM_EPOCH = 2025.0;
const WMM_VALID_UNTIL = 2030.0;
// [n, m, g, h, g'/año, h'/año]  (nT, nT/año)
const WMM_COF = [
  [1, 0, -29351.8, 0.0, 12.0, 0.0],
  [1, 1, -1410.8, 4545.4, 9.7, -21.5],
  [2, 0, -2556.6, 0.0, -11.6, 0.0],
  [2, 1, 2951.1, -3133.6, -5.2, -27.7],
  [2, 2, 1649.3, -815.1, -8.0, -12.1],
  [3, 0, 1361.0, 0.0, -1.3, 0.0],
  [3, 1, -2404.1, -56.6, -4.2, 4.0],
  [3, 2, 1243.8, 237.5, 0.4, -0.3],
  [3, 3, 453.6, -549.5, -15.6, -4.1],
  [4, 0, 895.0, 0.0, -1.6, 0.0],
  [4, 1, 799.5, 278.6, -2.4, -1.1],
  [4, 2, 55.7, -133.9, -6.0, 4.1],
  [4, 3, -281.1, 212.0, 5.6, 1.6],
  [4, 4, 12.1, -375.6, -7.0, -4.4],
  [5, 0, -233.2, 0.0, 0.6, 0.0],
  [5, 1, 368.9, 45.4, 1.4, -0.5],
  [5, 2, 187.2, 220.2, 0.0, 2.2],
  [5, 3, -138.7, -122.9, 0.6, 0.4],
  [5, 4, -142.0, 43.0, 2.2, 1.7],
  [5, 5, 20.9, 106.1, 0.9, 1.9],
  [6, 0, 64.4, 0.0, -0.2, 0.0],
  [6, 1, 63.8, -18.4, -0.4, 0.3],
  [6, 2, 76.9, 16.8, 0.9, -1.6],
  [6, 3, -115.7, 48.8, 1.2, -0.4],
  [6, 4, -40.9, -59.8, -0.9, 0.9],
  [6, 5, 14.9, 10.9, 0.3, 0.7],
  [6, 6, -60.7, 72.7, 0.9, 0.9],
  [7, 0, 79.5, 0.0, -0.0, 0.0],
  [7, 1, -77.0, -48.9, -0.1, 0.6],
  [7, 2, -8.8, -14.4, -0.1, 0.5],
  [7, 3, 59.3, -1.0, 0.5, -0.8],
  [7, 4, 15.8, 23.4, -0.1, 0.0],
  [7, 5, 2.5, -7.4, -0.8, -1.0],
  [7, 6, -11.1, -25.1, -0.8, 0.6],
  [7, 7, 14.2, -2.3, 0.8, -0.2],
  [8, 0, 23.2, 0.0, -0.1, 0.0],
  [8, 1, 10.8, 7.1, 0.2, -0.2],
  [8, 2, -17.5, -12.6, 0.0, 0.5],
  [8, 3, 2.0, 11.4, 0.5, -0.4],
  [8, 4, -21.7, -9.7, -0.1, 0.4],
  [8, 5, 16.9, 12.7, 0.3, -0.5],
  [8, 6, 15.0, 0.7, 0.2, -0.6],
  [8, 7, -16.8, -5.2, -0.0, 0.3],
  [8, 8, 0.9, 3.9, 0.2, 0.2],
  [9, 0, 4.6, 0.0, -0.0, 0.0],
  [9, 1, 7.8, -24.8, -0.1, -0.3],
  [9, 2, 3.0, 12.2, 0.1, 0.3],
  [9, 3, -0.2, 8.3, 0.3, -0.3],
  [9, 4, -2.5, -3.3, -0.3, 0.3],
  [9, 5, -13.1, -5.2, 0.0, 0.2],
  [9, 6, 2.4, 7.2, 0.3, -0.1],
  [9, 7, 8.6, -0.6, -0.1, -0.2],
  [9, 8, -8.7, 0.8, 0.1, 0.4],
  [9, 9, -12.9, 10.0, -0.1, 0.1],
  [10, 0, -1.3, 0.0, 0.1, 0.0],
  [10, 1, -6.4, 3.3, 0.0, 0.0],
  [10, 2, 0.2, 0.0, 0.1, -0.0],
  [10, 3, 2.0, 2.4, 0.1, -0.2],
  [10, 4, -1.0, 5.3, -0.0, 0.1],
  [10, 5, -0.6, -9.1, -0.3, -0.1],
  [10, 6, -0.9, 0.4, 0.0, 0.1],
  [10, 7, 1.5, -4.2, -0.1, 0.0],
  [10, 8, 0.9, -3.8, -0.1, -0.1],
  [10, 9, -2.7, 0.9, -0.0, 0.2],
  [10, 10, -3.9, -9.1, -0.0, -0.0],
  [11, 0, 2.9, 0.0, 0.0, 0.0],
  [11, 1, -1.5, 0.0, -0.0, -0.0],
  [11, 2, -2.5, 2.9, 0.0, 0.1],
  [11, 3, 2.4, -0.6, 0.0, -0.0],
  [11, 4, -0.6, 0.2, 0.0, 0.1],
  [11, 5, -0.1, 0.5, -0.1, -0.0],
  [11, 6, -0.6, -0.3, 0.0, -0.0],
  [11, 7, -0.1, -1.2, -0.0, 0.1],
  [11, 8, 1.1, -1.7, -0.1, -0.0],
  [11, 9, -1.0, -2.9, -0.1, 0.0],
  [11, 10, -0.2, -1.8, -0.1, 0.0],
  [11, 11, 2.6, -2.3, -0.1, 0.0],
  [12, 0, -2.0, 0.0, 0.0, 0.0],
  [12, 1, -0.2, -1.3, 0.0, -0.0],
  [12, 2, 0.3, 0.7, -0.0, 0.0],
  [12, 3, 1.2, 1.0, -0.0, -0.1],
  [12, 4, -1.3, -1.4, -0.0, 0.1],
  [12, 5, 0.6, -0.0, -0.0, -0.0],
  [12, 6, 0.6, 0.6, 0.1, -0.0],
  [12, 7, 0.5, -0.1, -0.0, -0.0],
  [12, 8, -0.1, 0.8, 0.0, 0.0],
  [12, 9, -0.4, 0.1, 0.0, -0.0],
  [12, 10, -0.2, -1.0, -0.1, -0.0],
  [12, 11, -1.3, 0.1, -0.0, 0.0],
  [12, 12, -0.7, 0.2, -0.1, -0.1]
];

/** Año decimal de una fecha (por defecto, hoy) */
function wmmDecimalYear(date) {
  const d = date || new Date(), y = d.getUTCFullYear();
  return y + (d.getTime() - Date.UTC(y, 0, 1)) / (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1));
}

/** Campo magnético en (lat, lng) geodésicas, altura sobre el elipsoide en km:
 *  { D: declinación (° Este +), I: inclinación (°), H, X (norte), Y (este), Z (abajo), F: en nT } */
function wmmField(lat, lng, year, altKm) {
  const N = 12, rad = Math.PI / 180, aRef = 6371.2;
  const a = 6378.137, f = 1 / 298.257223563, e2 = f * (2 - f);
  const h0 = altKm || 0, yr = (year === undefined || year === null) ? wmmDecimalYear() : year;
  // geodésicas -> esféricas geocéntricas
  const phi = lat * rad, sp = Math.sin(phi), cp = Math.cos(phi);
  const rc = a / Math.sqrt(1 - e2 * sp * sp);
  const pp = (rc + h0) * cp, zz = (rc * (1 - e2) + h0) * sp;
  const r = Math.hypot(pp, zz), phiG = Math.asin(zz / r);
  const lam = lng * rad;
  const x = Math.sin(phiG), s = Math.max(1e-12, Math.cos(phiG));   // cos(colatitud), sen(colatitud)
  // Legendre semi-Schmidt P(n,m) y su derivada respecto de la colatitud
  const idx = (n, m) => n * (n + 1) / 2 + m;
  const P = new Array(idx(N, N) + 1).fill(0), dP = new Array(idx(N, N) + 1).fill(0);
  P[0] = 1;
  for (let n = 1; n <= N; n++) {
    for (let m = 0; m <= n; m++) {
      const i = idx(n, m);
      if (n === m) {
        const k = n === 1 ? 1 : Math.sqrt((2 * n - 1) / (2 * n));
        P[i] = k * s * P[idx(n - 1, n - 1)];
        dP[i] = k * (s * dP[idx(n - 1, n - 1)] + x * P[idx(n - 1, n - 1)]);
      } else {
        const d = Math.sqrt(n * n - m * m), e = n - 2 >= m ? Math.sqrt((n - 1) * (n - 1) - m * m) : 0;
        const p2 = n - 2 >= m ? P[idx(n - 2, m)] : 0, dp2 = n - 2 >= m ? dP[idx(n - 2, m)] : 0;
        P[i] = ((2 * n - 1) * x * P[idx(n - 1, m)] - e * p2) / d;
        dP[i] = ((2 * n - 1) * (x * dP[idx(n - 1, m)] - s * P[idx(n - 1, m)]) - e * dp2) / d;
      }
    }
  }
  const cm = [], sm = [];
  for (let m = 0; m <= N; m++) { cm.push(Math.cos(m * lam)); sm.push(Math.sin(m * lam)); }
  const t = yr - WMM_EPOCH;
  let Br = 0, Bt = 0, Bp = 0;
  for (const [n, m, g0, h0c, gd, hd] of WMM_COF) {
    const g = g0 + t * gd, h = h0c + t * hd;
    const ar = Math.pow(aRef / r, n + 2), i = idx(n, m);
    const c = g * cm[m] + h * sm[m];
    Br += (n + 1) * ar * c * P[i];
    Bt -= ar * c * dP[i];
    Bp -= ar * m * (h * cm[m] - g * sm[m]) * P[i] / s;
  }
  const Xg = -Bt, Yg = Bp, Zg = -Br;           // norte, este, abajo geocéntricos
  const psi = phiG - phi;                      // -> geodésicos
  const X = Xg * Math.cos(psi) - Zg * Math.sin(psi);
  const Z = Xg * Math.sin(psi) + Zg * Math.cos(psi);
  const H = Math.hypot(X, Yg);
  return { D: Math.atan2(Yg, X) / rad, I: Math.atan2(Z, H) / rad, H, X, Y: Yg, Z, F: Math.hypot(H, Z) };
}

// Memoria: el cálculo cuesta poco, pero se pide por cada tramo al redibujar; se agrupa por ~1 km y por día
const _wmmMemo = new Map();
/** Declinación magnética (°, Este positivo) en el punto y fecha dados (por defecto, hoy, a nivel del elipsoide) */
function wmmDeclination(lat, lng, year, altKm) {
  const yr = (year === undefined || year === null) ? wmmDecimalYear() : year;
  const key = lat.toFixed(2) + ',' + lng.toFixed(2) + ',' + yr.toFixed(3) + ',' + (altKm || 0);
  if (_wmmMemo.has(key)) return _wmmMemo.get(key);
  const v = wmmField(lat, lng, yr, altKm).D;
  if (_wmmMemo.size > 2000) _wmmMemo.clear();
  _wmmMemo.set(key, v);
  return v;
}
