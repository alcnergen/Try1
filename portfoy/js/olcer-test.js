// Ölçerin geçmiş sınaması: geçmiş fiyat serilerinden her hafta ölçeri yeniden hesaplar ve sonraki
// 1/3/6 ayda ne olduğunu ölçer. Geçmiş analist görüşü olmadığından yalnızca fiyat/faiz faktörleri kullanılır.
import { OLCER_ETF, computeOlcer } from './olcer.js';

const DAY = 864e5;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const shift = (d, days) => iso(Date.parse(d) + days * DAY);
const ok = (x) => typeof x === 'number' && Number.isFinite(x);

// Günlük seri için göstergeler (TradingView tarayıcı sütunlarıyla aynı anlamda)
export function indicators(points) {
  const n = points.length, close = points.map((p) => p[1]);
  const sma = (len) => { const out = new Array(n).fill(null); let s = 0; for (let i = 0; i < n; i++) { s += close[i]; if (i >= len) s -= close[i - len]; if (i >= len - 1) out[i] = s / len; } return out; };
  const s50 = sma(50), s200 = sma(200);
  // RSI(14), Wilder
  const rsi = new Array(n).fill(null); let ag = 0, al = 0;
  for (let i = 1; i < n; i++) {
    const ch = close[i] - close[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= 14) { ag += g / 14; al += l / 14; } else { ag = (ag * 13 + g) / 14; al = (al * 13 + l) / 14; }
    if (i >= 14) rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return { dates: points.map((p) => p[0]), close, s50, s200, rsi };
}

// tarih ≤ d olan son indeks (ikili arama)
function idx(dates, d) {
  let lo = 0, hi = dates.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (dates[m] <= d) { r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}
export const valueAt = (points, d) => { const i = idx(points.map((p) => p[0]), d); return i < 0 ? null : points[i][1]; };

function rowAt(ind, d, maxGap = 10) {
  const i = idx(ind.dates, d);
  if (i < 0 || (Date.parse(d) - Date.parse(ind.dates[i])) / DAY > maxGap) return null;
  const perf = (days) => { const j = idx(ind.dates, shift(ind.dates[i], -days)); return j >= 0 && ind.close[j] > 0 && (Date.parse(ind.dates[i]) - Date.parse(ind.dates[j])) / DAY < days + 10 ? (ind.close[i] / ind.close[j] - 1) * 100 : null; };
  return { close: ind.close[i], SMA50: ind.s50[i], SMA200: ind.s200[i], 'Perf.1M': perf(30), 'Perf.3M': perf(91), RSI: ind.rsi[i] };
}

// TR girdileri (updateOlcer ile aynı tanımlar). TÜFE yayımlanma gecikmesi için 40 gün geriden bakılır.
export function trInputs(S, d) {
  const mev = S.MEVFAIZ || [], tufe = S.TUFE || [], usd = S.USDTRY || [];
  const dt = shift(d, -40), m = valueAt(mev, d), m3 = valueAt(mev, shift(d, -91));
  const t0 = valueAt(tufe, dt), t1 = valueAt(tufe, shift(dt, -365));
  const u0 = valueAt(usd, d), u1 = valueAt(usd, shift(d, -91));
  return {
    mevduatNet: ok(m) ? (m / 100) * 0.825 : null,
    tufeYillik: ok(t0) && t1 ? t0 / t1 - 1 : null,
    usdtry3m: ok(u0) && u1 ? u0 / u1 - 1 : null,
    mevduatDegisim3m: ok(m) && ok(m3) ? m - m3 : null,
  };
}

/** S: { SPX:[[d,v]…], GOLD, USDTRY, MEVFAIZ, TUFE, K_QQQM…, G_VIX, G_DXY, G_PETROL, G_US10Y, G_US02Y, G_FED, G_USTUFE } */
export function olcerAt(S, d, ind = prepare(S)) {
  const rows = {};
  const put = (tv, id) => { const r = ind[id] ? rowAt(ind[id], d) : null; if (r) rows[tv] = r; };
  for (const e of OLCER_ETF) put(e.tv, e.gorus);
  put('SP:SPX', 'SPX'); put('TVC:GOLD', 'GOLD'); put('TVC:DXY', 'G_DXY'); put('TVC:VIX', 'G_VIX'); put('FX:USOIL', 'G_PETROL');
  put('TVC:US10Y', 'G_US10Y'); put('TVC:US02Y', 'G_US02Y');
  const fed = valueAt(S.G_FED || [], d), cpi = valueAt(S.G_USTUFE || [], shift(d, -40));
  if (ok(fed)) rows['ECONOMICS:USINTR'] = { close: fed };
  if (ok(cpi)) rows['ECONOMICS:USIRYY'] = { close: cpi };
  return computeOlcer(rows, {}, trInputs(S, d));
}

const DAILY = ['SPX', 'GOLD', 'G_VIX', 'G_DXY', 'G_PETROL', 'G_US10Y', 'G_US02Y', ...OLCER_ETF.map((e) => e.gorus)];
export function prepare(S) { return Object.fromEntries(DAILY.filter((k) => S[k]?.length > 30).map((k) => [k, indicators(S[k])])); }

// d'den h gün sonraya getiri (seri yoksa ya da o tarih henüz gelmediyse null)
function fwd(points, d, h) {
  const a = valueAt(points, d), end = shift(d, h), last = points[points.length - 1]?.[0];
  if (!ok(a) || !a || !last || last < end) return null;
  const b = valueAt(points, end);
  return ok(b) ? b / a - 1 : null;
}

const pct = (sorted, q) => { if (!sorted.length) return null; const i = (sorted.length - 1) * q, lo = Math.floor(i); return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo); };
const mean = (xs) => { const v = xs.filter(ok); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const r3 = (x) => (ok(x) ? Math.round(x * 1000) / 1000 : null);

/**
 * Haftalık geçmiş sınaması. Dönüş:
 * { baslangic, bitis, adet, gecmis: [[tarih, abd, altin, tl]], dagilim: {abd:{min,p20,…,max}}, getiri: {abd:{dusuk,orta,yuksek}, …} }
 * getiri: ölçerin geçmiş dağılımına göre üçte birlik dilimlerde, sonraki 3/6 ayın TL bazlı ortalama getirisi.
 */
export function backtest(S, { start = '2015-01-01', step = 7 } = {}) {
  const ind = prepare(S);
  const end = S.SPX?.[S.SPX.length - 1]?.[0] || iso(Date.now());
  const usd = S.USDTRY || [];
  const etfIds = OLCER_ETF.map((e) => e.gorus);
  const rows = [];
  const dates = [];
  for (let t = Date.parse(start); t <= Date.parse(end); t += step * DAY) dates.push(iso(t));
  if (dates[dates.length - 1] !== end) dates.push(end); // son nokta bugün
  for (const d of dates) {
    const o = olcerAt(S, d, ind);
    // TL bazlı getiriler: ABD = kullanıcının ETF'lerinden o tarihte var olanların ortalaması (dolar × kur)
    const g = {};
    for (const h of [91, 182]) {
      const u = fwd(usd, d, h);
      const etf = mean(etfIds.map((id) => (S[id] && S[id][0][0] <= shift(d, -200) ? fwd(S[id], d, h) : null)));
      const gold = fwd(S.GOLD || [], d, h);
      const m = valueAt(S.MEVFAIZ || [], d);
      g[h] = {
        abd: ok(etf) && ok(u) ? (1 + etf) * (1 + u) - 1 : null,
        altin: ok(gold) && ok(u) ? (1 + gold) * (1 + u) - 1 : null,
        tl: ok(m) && ok(u) ? (1 + (m / 100) * 0.825) ** (h / 365) - 1 : null,
        dolar: u,
      };
    }
    rows.push({ d, abd: o.abd.skor, altin: o.altin.skor, tl: o.tl.skor, g });
  }
  const dagilim = {}, getiri = {};
  for (const k of ['abd', 'altin', 'tl']) {
    const s = rows.map((r) => r[k]).filter(ok).sort((a, b) => a - b);
    dagilim[k] = { min: s[0], p20: pct(s, 0.2), p40: pct(s, 0.4), p50: pct(s, 0.5), p60: pct(s, 0.6), p80: pct(s, 0.8), max: s[s.length - 1] };
    const t1 = pct(s, 1 / 3), t2 = pct(s, 2 / 3);
    const dilim = (r) => (r[k] <= t1 ? 'dusuk' : r[k] < t2 ? 'orta' : 'yuksek');
    getiri[k] = { sinir: [r3(t1), r3(t2)] };
    for (const b of ['dusuk', 'orta', 'yuksek']) {
      const rs = rows.filter((r) => ok(r[k]) && dilim(r) === b);
      const o = { adet: rs.length };
      for (const h of [91, 182]) {
        const v = rs.map((r) => r.g[h]).filter((x) => ok(x.tl) && ok(x.abd) && ok(x.altin));
        // varlığın kendi getirisi ve rakibine göre fark: ABD/altın için TL mevduatı, TL için dolar
        const own = (x) => (k === 'tl' ? x.tl : x[k]), rival = (x) => (k === 'tl' ? x.dolar : x.tl);
        o[h] = { n: v.length, getiri: r3(mean(v.map(own))), fark: r3(mean(v.map((x) => own(x) - rival(x)))), isabet: v.length ? r3(v.filter((x) => own(x) > rival(x)).length / v.length) : null };
      }
      getiri[k][b] = o;
    }
  }
  return { baslangic: rows[0]?.d, bitis: rows[rows.length - 1]?.d, adet: rows.length, gecmis: rows.map((r) => [r.d, r.abd, r.altin, r.tl]), dagilim, getiri };
}
