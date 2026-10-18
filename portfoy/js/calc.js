// Saf hesaplama fonksiyonları (DOM yok) — testlerde de kullanılır.

export const DAY = 864e5;
export const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
};
export const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

// Sıralı [tarih, değer] dizisinde tarihe eşit ya da önceki son değer
export function valueAt(points, date) {
  if (!points || !points.length || date < points[0][0]) return null;
  let lo = 0, hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid][0] <= date) lo = mid; else hi = mid - 1;
  }
  return points[lo][1];
}
// Tarihten önceki ilk değer yoksa ilk değeri döndürür (alım öncesi kur gibi durumlar için)
export const valueAtOrFirst = (points, date) => valueAt(points, date) ?? points?.[0]?.[1] ?? null;

export function mergePoints(...lists) {
  const m = new Map();
  for (const l of lists) for (const [d, v] of l || []) if (v != null && Number.isFinite(v)) m.set(d, v);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

// İki seriyi tarih bazında birleştirip fonksiyon uygular (ör. ons × kur)
export function combine(a, b, fn) {
  if (!a?.length || !b?.length) return [];
  const dates = [...new Set([...a.map((p) => p[0]), ...b.map((p) => p[0])])].sort();
  const out = [];
  for (const d of dates) {
    const x = valueAt(a, d), y = valueAt(b, d);
    if (x != null && y != null) out.push([d, fn(x, y)]);
  }
  return out;
}

// İşlemlerden (alış/satış) pozisyon: ortalama maliyet yöntemi
export function positionAt(txs, date) {
  let qty = 0, cost = 0, realized = 0, invested = 0;
  for (const t of txs) {
    if (t.date > date) break;
    const fee = Number(t.fee) || 0;
    if (t.type === 'sell') {
      const avg = qty > 0 ? cost / qty : 0;
      const q = Math.min(t.qty, qty);
      realized += q * t.price - q * avg - fee;
      cost -= q * avg;
      qty -= q;
      invested -= q * t.price - fee;
    } else {
      qty += t.qty;
      cost += t.qty * t.price + fee;
      invested += t.qty * t.price + fee;
    }
  }
  return { qty, cost, realized, invested, avg: qty > 0 ? cost / qty : 0 };
}

export const sortTx = (txs) => [...txs].sort((a, b) => a.date.localeCompare(b.date) || (a.type === 'sell') - (b.type === 'sell'));

// Belirli bir günde fon fiyatı: veri > el ile girilen > son işlem fiyatı
export function priceOn(fundPts, txs, date) {
  const p = valueAt(fundPts, date);
  if (p != null) return p;
  let last = null;
  for (const t of txs) if (t.date <= date) last = t.price;
  return last;
}

// Tek fonun belirli bir gündeki durumu
export function fundState(f, pts, date, taxRate) {
  const txs = sortTx(f.txs || []);
  const pos = positionAt(txs, date);
  const price = priceOn(pts, txs, date);
  const value = pos.qty * (price || 0);
  const unreal = value - pos.cost;
  const gross = unreal + pos.realized;
  const rate = f.tax ?? taxRate;
  const tax = unreal > 0 ? unreal * rate : 0;
  return { ...pos, price, value, unreal, gross, tax, net: gross - tax };
}

// Portföyün gün gün geçmişi
export function portfolioHistory(funds, priceMap, usdPts, { taxRate = 0.175, end = todayISO() } = {}) {
  const all = funds.flatMap((f) => (f.txs || []).map((t) => t.date));
  if (!all.length) return [];
  const start = all.sort()[0];
  const dates = new Set([start, end]);
  for (const f of funds) for (const [d] of priceMap[f.code] || []) if (d >= start && d <= end) dates.add(d);
  for (const f of funds) for (const t of f.txs || []) dates.add(t.date);
  const out = [];
  for (const d of [...dates].sort()) {
    let value = 0, cost = 0, gross = 0, net = 0, invested = 0, costUsd = 0;
    const usd = valueAtOrFirst(usdPts, d);
    for (const f of funds) {
      const s = fundState(f, priceMap[f.code], d, taxRate);
      value += s.value; cost += s.cost; gross += s.gross; net += s.net; invested += s.invested;
    }
    // USD maliyet: her alımın kendi günündeki kurla
    for (const f of funds) for (const t of f.txs || []) {
      if (t.date > d) continue;
      const k = valueAtOrFirst(usdPts, t.date);
      if (!k) continue;
      const amt = t.qty * t.price;
      costUsd += t.type === 'sell' ? -amt / k : (amt + (Number(t.fee) || 0)) / k;
    }
    out.push({ date: d, value, cost, invested, gross, net, usd, valueUsd: usd ? value / usd : null, costUsd });
  }
  return out;
}

// Para akışlarını bir kıyas varlığa uygulayıp "aynı parayı oraya koysaydım" değeri
export function replicate(funds, benchPts, date) {
  let units = 0;
  const flows = funds.flatMap((f) => (f.txs || []).map((t) => ({ ...t }))).sort((a, b) => a.date.localeCompare(b.date));
  for (const t of flows) {
    if (t.date > date) break;
    // Kıyas verisi işlem gününü kapsamalı (en fazla 7 gün sonra başlıyorsa ilk değer kabul edilir)
    let p = valueAt(benchPts, t.date);
    if (p == null && benchPts?.length && daysBetween(t.date, benchPts[0][0]) <= 7) p = benchPts[0][1];
    if (!p) return null;
    const amt = t.qty * t.price + (t.type === 'sell' ? -(Number(t.fee) || 0) : Number(t.fee) || 0);
    units += t.type === 'sell' ? -amt / p : amt / p;
  }
  const now = valueAt(benchPts, date) ?? benchPts?.[benchPts.length - 1]?.[1];
  return now ? units * now : null;
}

// Dönem getirisi: son değer / dönem başındaki değer - 1
export function periodReturn(pts, fromDate, toDate) {
  if (!pts?.length) return null;
  const end = valueAt(pts, toDate);
  if (fromDate < pts[0][0]) return null;
  const start = valueAt(pts, fromDate);
  return end != null && start ? end / start - 1 : null;
}

export function periodStart(key, today) {
  const y = +today.slice(0, 4);
  switch (key) {
    case '1H': return addDays(today, -7);
    case '1A': return addDays(today, -30);
    case '3A': return addDays(today, -91);
    case '6A': return addDays(today, -182);
    case 'YB': return `${y - 1}-12-31`;
    case '1Y': return addDays(today, -365);
    case '3Y': return addDays(today, -365 * 3);
    case '5Y': return addDays(today, -365 * 5);
    default: return '1900-01-01';
  }
}

export const annualize = (r, days) => (r == null || days <= 0 ? null : Math.pow(1 + r, 365 / days) - 1);
export const dailyRate = (r, days) => (r == null || days <= 0 ? null : Math.pow(1 + r, 1 / days) - 1);

// Senaryo: aylık bileşik büyüme + aylık ek yatırım
export function projectScenario({ start, annual, months, monthly = 0, taxRate = 0.175, costBase }) {
  const m = Math.pow(1 + annual, 1 / 12) - 1;
  let v = start, cost = costBase;
  const path = [[0, v]];
  for (let i = 1; i <= months; i++) {
    v = v * (1 + m) + monthly;
    cost += monthly;
    path.push([i, v]);
  }
  const gross = v - cost;
  return { value: v, cost, gross, net: gross > 0 ? gross * (1 - taxRate) : gross, path };
}

export function monthsToTarget({ start, annual, monthly = 0, target }) {
  if (start >= target) return 0;
  const m = Math.pow(1 + annual, 1 / 12) - 1;
  let v = start;
  for (let i = 1; i <= 600; i++) {
    v = v * (1 + m) + monthly;
    if (v >= target) return i;
  }
  return null;
}
