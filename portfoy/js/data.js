// Piyasa verisini (GitHub Actions'ın kaydettiği JSON'lar) yükler ve kıyas serilerini türetir.
import { combine, mergePoints, addDays, todayISO, cpiDaily, valueAtOrFirst } from './calc.js';

const OZ = 31.1034768;

// Renk varlığa bağlıdır, sıraya değil (grafikte hep aynı renk)
export const BENCHES = [
  { id: 'USD', ad: 'Dolar', renk: 2, need: ['USDTRY'], tl: (s) => s.USDTRY },
  { id: 'ALTIN', ad: 'Gram altın', renk: 4, need: ['GOLD', 'USDTRY'], tl: (s) => combine(s.GOLD, s.USDTRY, (g, k) => (g * k) / OZ) },
  { id: 'EUR', ad: 'Euro', renk: 8, need: ['EURTRY'], tl: (s) => s.EURTRY },
  { id: 'XU100', ad: 'BIST 100', renk: 3, need: ['XU100'], tl: (s) => s.XU100 },
  { id: 'SPX', ad: 'S&P 500', renk: 7, need: ['SPX', 'USDTRY'], tl: (s) => combine(s.SPX, s.USDTRY, (a, b) => a * b) },
  { id: 'NDX', ad: 'Nasdaq 100', renk: 5, need: ['NDX', 'USDTRY'], tl: (s) => combine(s.NDX, s.USDTRY, (a, b) => a * b) },
  { id: 'DAX', ad: 'DAX', renk: 6, need: ['DAX', 'EURTRY'], tl: (s) => combine(s.DAX, s.EURTRY, (a, b) => a * b) },
  { id: 'N225', ad: 'Nikkei 225', renk: 9, need: ['N225', 'JPYTRY'], tl: (s) => combine(s.N225, s.JPYTRY, (a, b) => a * b) },
  { id: 'MSCIW', ad: 'MSCI Dünya', renk: 10, need: ['MSCIW', 'USDTRY'], tl: (s) => combine(s.MSCIW, s.USDTRY, (a, b) => a * b) },
  { id: 'BTC', ad: 'Bitcoin', renk: 13, need: ['BTCUSD', 'USDTRY'], tl: (s) => combine(s.BTCUSD, s.USDTRY, (a, b) => a * b) },
  { id: 'XRP', ad: 'Ripple (XRP)', renk: 14, need: ['XRPUSD', 'USDTRY'], tl: (s) => combine(s.XRPUSD, s.USDTRY, (a, b) => a * b) },
  { id: 'GUMUS', ad: 'Gram gümüş', renk: 15, need: ['SILVER', 'USDTRY'], tl: (s) => combine(s.SILVER, s.USDTRY, (g, k) => (g * k) / OZ) },
  { id: 'SMH', ad: 'SMH (yarı iletken ETF)', renk: 16, need: ['K_SMH', 'USDTRY'], tl: (s) => combine(s.K_SMH, s.USDTRY, (a, b) => a * b) },
  { id: 'NVDA', ad: 'Nvidia', renk: 17, need: ['K_NVDA', 'USDTRY'], tl: (s) => combine(s.K_NVDA, s.USDTRY, (a, b) => a * b) },
  { id: 'IGV', ad: 'IGV (yazılım ETF)', renk: 18, need: ['K_IGV', 'USDTRY'], tl: (s) => combine(s.K_IGV, s.USDTRY, (a, b) => a * b) },
  { id: 'DRAM', ad: 'DRAM (bellek ETF)', renk: 19, need: ['K_DRAM', 'USDTRY'], tl: (s) => combine(s.K_DRAM, s.USDTRY, (a, b) => a * b) },
  { id: 'NASA', ad: 'NASA (uzay ETF)', renk: 20, need: ['K_NASA', 'USDTRY'], tl: (s) => combine(s.K_NASA, s.USDTRY, (a, b) => a * b) },
  { id: 'QQQM', ad: 'QQQM (Nasdaq 100 ETF)', renk: 21, need: ['K_QQQM', 'USDTRY'], tl: (s) => combine(s.K_QQQM, s.USDTRY, (a, b) => a * b) },
  { id: 'CIBR', ad: 'CIBR (siber güvenlik ETF)', renk: 22, need: ['K_CIBR', 'USDTRY'], tl: (s) => combine(s.K_CIBR, s.USDTRY, (a, b) => a * b) },
  { id: 'TUFE', ad: 'Enflasyon (TÜFE)', renk: 12, need: ['TUFE'], tl: (s) => cpiDaily(s.TUFE).points },
  { id: 'MEVDUAT', ad: 'Mevduat', renk: 11, need: [], tl: null },
];

// Kıyasların ihtiyaç duyduğu ham seriler (data/series altındaki dosya adları)
const BENCH_SERIES = [...new Set(BENCHES.flatMap((b) => b.need))];

async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

export async function loadMarket(fundCodes) {
  const market = { index: null, raw: {}, names: {}, meta: {}, errors: [], tefasSon: null };
  try { market.index = await getJSON('data/index.json'); } catch (e) { market.errors.push('Veri dizini yok (Actions henüz çalışmamış olabilir)'); }
  try { market.gorus = await getJSON('data/gorus.json'); } catch { market.gorus = null; }
  try { market.olcer = await getJSON('data/olcer.json'); } catch { market.olcer = null; }
  // telefonda anlık çekilmiş daha yeni görüş varsa o kullanılır
  try { const c = JSON.parse(localStorage.getItem('portfoy.gorus')); if (c?.guncelleme > (market.gorus?.guncelleme || '')) market.gorus = withHoldings(c, market.gorus); } catch { /* yok */ }
  const ids = new Set([...fundCodes, ...BENCH_SERIES, 'EURTRY', 'JPYTRY', 'MEVFAIZ']);
  await Promise.all([...ids].map(async (id) => {
    try {
      const s = await getJSON(`data/series/${encodeURIComponent(id)}.json`);
      market.raw[id] = s.points || [];
      market.names[id] = s.ad;
      market.meta[id] = { pb: s.pb || 'TRY', tur: s.tur, erken: s.erken || [] };
    } catch { market.raw[id] = []; }
  }));
  const missing = fundCodes.filter((c) => !market.raw[c]?.length);
  if (missing.length) {
    try {
      market.tefasSon = await getJSON('data/tefas-son.json');
      for (const c of missing) {
        const r = market.tefasSon[c];
        if (r) { market.raw[c] = [[r[0], r[1]]]; market.names[c] = r[2]; }
      }
    } catch { /* yok */ }
  }
  return market;
}

// Yeni eklenen bir fon kodu için seriyi (yoksa TEFAS son fiyatını) yükler
export async function loadOne(market, code) {
  if (market.raw[code]?.length) return true;
  try {
    const s = await getJSON(`data/series/${encodeURIComponent(code)}.json`);
    market.raw[code] = s.points || []; market.names[code] = s.ad; market.meta[code] = { pb: s.pb || 'TRY', tur: s.tur, erken: s.erken || [] };
  } catch {
    try {
      market.tefasSon ||= await getJSON('data/tefas-son.json');
      const r = market.tefasSon[code];
      if (r) { market.raw[code] = [[r[0], r[1]]]; market.names[code] = r[2]; }
    } catch { /* yok */ }
  }
  return !!market.raw[code]?.length;
}

// El ile girilen fiyatlar/kurlar veri ile birleşir (aynı günde el ile girilen kazanır)
// Elle girilen fiyatlar yalnızca otomatik verinin henüz ulaşmadığı günler için kullanılır; resmi fiyat gelince
// (ya da elle girilen gün resmi serinin içinde kalıyorsa, ör. hafta sonu) resmi seri geçerlidir.
export function series(market, manual, id) {
  const raw = market.raw[id] || [];
  const lastRaw = raw[raw.length - 1]?.[0] || '';
  const m = manual?.[id] ? Object.entries(manual[id]).filter(([d]) => d > lastRaw) : [];
  return mergePoints(raw, m);
}

// Mevduat: her gün o günkü yıllık faizin stopaj sonrası kısmıyla büyüyen sentetik seri.
// Otomatikte TCMB mevduat faizi (aylık) kullanılır; yoksa ya da kapalıysa elle girilen net faiz.
export function depositSeries(rates, { auto = true, tax = 0.175, manualRate = 0.4 } = {}, end = todayISO()) {
  const useAuto = auto && rates?.length;
  const start = addDays(end, -3650);
  const pts = [];
  let v = 100;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    pts.push([d, v]);
    const net = useAuto ? (valueAtOrFirst(rates, d) / 100) * (1 - tax) : manualRate;
    v *= 1 + net / 365;
  }
  const gross = useAuto ? rates[rates.length - 1][1] / 100 : null;
  return { points: pts, auto: !!useAuto, gross, net: useAuto ? gross * (1 - tax) : manualRate, asOf: useAuto ? rates[rates.length - 1][0] : null };
}

export function benchSeries(market, manual, settings = {}) {
  const s = {};
  for (const id of BENCH_SERIES) s[id] = series(market, manual, id);
  const out = {};
  for (const b of BENCHES) {
    if (b.id === 'MEVDUAT') continue;
    out[b.id] = b.need.every((n) => s[n]?.length) ? b.tl(s) : [];
  }
  const dep = depositSeries(series(market, manual, 'MEVFAIZ'), { auto: settings.depositAuto !== false, tax: settings.depositTax ?? 0.175, manualRate: settings.deposit ?? 0.4 });
  out.MEVDUAT = dep.points;
  out.depositInfo = dep;
  return out;
}

// ---------- Piyasa görüşü: analist dağılımı (yalnızca hisselerde), teknik özet ve RSI (TradingView tarayıcısı) ----------
export const SCAN_COLS = ['close', 'RSI', 'Recommend.All', 'recommendation_buy', 'recommendation_over', 'recommendation_hold', 'recommendation_under', 'recommendation_sell', 'recommendation_total', 'price_target_average'];
export function parseScanRow(d) {
  const [close, rsi, teknik, buy, over, hold, under, sell, total, hedef] = d;
  const out = { rsi: Number.isFinite(rsi) ? Math.round(rsi * 10) / 10 : null, teknik: Number.isFinite(teknik) ? Math.round(teknik * 1000) / 1000 : null, ...(close > 0 ? { fiyat: close } : {}) };
  if (total > 0) out.analist = { al: (buy || 0) + (over || 0), tut: hold || 0, sat: (under || 0) + (sell || 0), toplam: total, ...(hedef > 0 && close > 0 ? { hedef: Math.round((hedef / close - 1) * 1000) / 1000, hedefFiyat: hedef } : {}) };
  return out;
}

// Görüşleri telefondan anlık çeker (TradingView tarayıcısı CORS'a izin veriyor; text/plain ile ön istek gerekmez)
export async function liveViews() {
  const cfg = await getJSON('data/config.json');
  const groups = {};
  for (const b of cfg.kiyaslar || []) if (b.tarama) (groups[b.tarama] ||= []).push([b.id, b.taramaSembol || b.tv]);
  const varliklar = {};
  await Promise.all(Object.entries(groups).map(async ([market, list]) => {
    const res = await fetch(`https://scanner.tradingview.com/${market}/scan`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ symbols: { tickers: list.map((x) => x[1]), query: { types: [] } }, columns: SCAN_COLS }),
    });
    if (!res.ok) throw new Error(`${market}: ${res.status}`);
    const rows = Object.fromEntries(((await res.json())?.data || []).map((r) => [r.s, r.d]));
    for (const [id, sym] of list) if (rows[sym]) varliklar[id] = parseScanRow(rows[sym]);
  }));
  if (!Object.keys(varliklar).length) throw new Error('veri gelmedi');
  return { guncelleme: new Date().toISOString(), varliklar, anlik: true };
}

// Telefondan anlık çekilen görüşte içerik bazlı analist özeti yoktur (sunucuda hesaplanır); öncekinden taşınır
export function withHoldings(fresh, prev) {
  const v = { ...fresh.varliklar };
  for (const [id, x] of Object.entries(prev?.varliklar || {})) if (x.icerik && !v[id]?.icerik) v[id] = { ...v[id], icerik: x.icerik };
  return { ...fresh, varliklar: v, icerikTarih: fresh.icerikTarih || prev?.icerikTarih || prev?.guncelleme };
}
