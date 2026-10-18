// Piyasa verisini (GitHub Actions'ın kaydettiği JSON'lar) yükler ve kıyas serilerini türetir.
import { combine, mergePoints, addDays, todayISO } from './calc.js';

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
  { id: 'MEVDUAT', ad: 'Mevduat', renk: 11, need: [], tl: null },
];

async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

export async function loadMarket(fundCodes) {
  const market = { index: null, raw: {}, names: {}, meta: {}, errors: [], tefasSon: null };
  try { market.index = await getJSON('data/index.json'); } catch (e) { market.errors.push('Veri dizini yok (Actions henüz çalışmamış olabilir)'); }
  const ids = new Set([...fundCodes, 'USDTRY', 'EURTRY', 'JPYTRY', 'GOLD', 'XU100', 'SPX', 'NDX', 'DAX', 'N225', 'MSCIW']);
  await Promise.all([...ids].map(async (id) => {
    try {
      const s = await getJSON(`data/series/${encodeURIComponent(id)}.json`);
      market.raw[id] = s.points || [];
      market.names[id] = s.ad;
      market.meta[id] = { pb: s.pb || 'TRY', tur: s.tur };
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
    market.raw[code] = s.points || []; market.names[code] = s.ad; market.meta[code] = { pb: s.pb || 'TRY', tur: s.tur };
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
export function series(market, manual, id) {
  const m = manual?.[id] ? Object.entries(manual[id]) : [];
  return mergePoints(market.raw[id] || [], m);
}

export function benchSeries(market, manual, depositRate) {
  const s = {};
  for (const id of ['USDTRY', 'EURTRY', 'JPYTRY', 'GOLD', 'XU100', 'SPX', 'NDX', 'DAX', 'N225', 'MSCIW']) s[id] = series(market, manual, id);
  const out = {};
  for (const b of BENCHES) {
    if (b.id === 'MEVDUAT') continue;
    out[b.id] = b.need.every((n) => s[n]?.length) ? b.tl(s) : [];
  }
  // Mevduat: yıllık net faizle günlük bileşik büyüyen sentetik seri (son 10 yıl)
  const t = todayISO();
  const pts = [];
  const r = Math.pow(1 + (depositRate || 0), 1 / 365);
  let v = 100;
  for (let d = addDays(t, -3650); d <= t; d = addDays(d, 1)) { pts.push([d, v]); v *= r; }
  out.MEVDUAT = pts;
  return out;
}
