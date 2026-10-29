#!/usr/bin/env node
// Günlük piyasa verisi toplayıcı. GitHub Actions'ta çalışır, bağımlılığı yoktur (Node 22+).
// - Fon fiyatları: TEFAS'ın 2026'daki yeni JSON API'si (/api/funds/fonFiyatBilgiGetir)
// - Hisseler (BIST ve yabancı): TradingView; para birimi seriye yazılır, uygulama TL'ye çevirir
// - Kıyaslar (döviz, altın, endeksler): TradingView günlük mumları; döviz için canlidoviz, BIST 100 için İş Yatırım yedek
//   (Yahoo ve Stooq GitHub sunucularını engellediği için kullanılmıyor)
// Çıktı: data/series/<ID>.json, data/index.json
// Kişisel portföy bilgisi (adet, maliyet) burada YOKTUR; yalnızca herkese açık fiyatlar yazılır.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCAN_COLS, parseScanRow } from '../js/data.js';
import { OLCER_SCAN, OLCER_COLS, rowObj, computeOlcer } from '../js/olcer.js';
export { parseScanRow };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const SERIES = path.join(DATA, 'series');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

export const iso = (d) => d.toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[veri]', ...a);
const num = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.')));

async function fetchRetry(url, opts = {}, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(30000) });
      if (res.ok) return res;
      last = new Error(`${res.status} ${res.statusText}`);
      if (res.status === 404 || res.status === 403) break;
      await sleep(res.status === 429 ? 30000 : 1500 * (i + 1)); // TEFAS 429 engeli ~45 sn sürer
      continue;
    } catch (e) { last = e; }
    await sleep(1500 * (i + 1));
  }
  throw last;
}

// ---------- TEFAS (yeni API) ----------
// periyod yalnızca şu değerleri kabul eder: 1, 3, 6, 12, 36, 60 (ay). En fazla 5 yıl.
export function parseTefas(json) {
  if (json?.errorMessage) throw new Error(`TEFAS: ${json.errorMessage}`);
  return (json?.resultList || [])
    .filter((r) => r.tarih && num(r.fiyat) > 0)
    .map((r) => ({ date: String(r.tarih).slice(0, 10), code: r.fonKodu, name: r.fonUnvan, price: num(r.fiyat) }));
}

async function tefas(code, periyod) {
  const res = await fetchRetry('https://www.tefas.gov.tr/api/funds/fonFiyatBilgiGetir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ fonKodu: code, dil: 'TR', periyod }),
  });
  return parseTefas(await res.json());
}

// ---------- Kurucu siteleri: ertesi günün fiyatı (TEFAS'tan saatler önce) ----------
// Fon fiyatı her iş günü 18:00'de ertesi iş günü için belirlenir; kurucular hemen yayınlar, TEFAS gece/sabah.
// Tarih saate göre tahmin edilmez: kurucunun verdiği fiyatlar TEFAS'taki son fiyatla eşleştirilerek bulunur.
export const nextBizDay = (isoDate) => {
  let d = new Date(isoDate + 'T00:00:00Z');
  do d = new Date(d.getTime() + 864e5); while ([0, 6].includes(d.getUTCDay()));
  return iso(d);
};
const same = (a, b) => Math.abs(Number(a) - Number(b)) < 5e-7;

// Yapı Kredi: BankBuysPrice = bir önceki fiyat, BankSellsPrice = en yeni fiyat
export function ykbEarly(fund, lastDate, lastPrice) {
  const sells = Number(fund?.BankSellsPrice), buys = Number(fund?.BankBuysPrice);
  if (!(sells > 0) || same(sells, lastPrice)) return []; // yeni bilgi yok
  return same(buys, lastPrice) ? [[nextBizDay(lastDate), sells]] : []; // eşleşmiyorsa tarihi bilinemez, yazma
}
async function ykb(code) {
  const res = await fetchRetry('https://www.yapikredi.com.tr/yatirimci-kosesi/fon-detay.aspx/FundRiskData', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', Origin: 'https://www.yapikredi.com.tr', Referer: `https://www.yapikredi.com.tr/yatirimci-kosesi/fon-bilgileri/${code}` },
    body: JSON.stringify({ fundCode: code }),
  });
  return (await res.json())?.d?.Data?.FundList?.[0];
}

// Garanti BBVA Portföy: 1000'e endeksli günlük seri + son birim fiyat. Seri fiyatı hesaplandığı günle tarihler
// (TEFAS'ta ertesi iş günü); bu yüzden tarihler bir iş günü kaydırılır ve kayma TEFAS'taki son iki fiyatın
// oranıyla doğrulanır. Tutmazsa (tatil vb.) hiçbir şey yazılmaz.
export function garantiEarly(series, tefasPts, latestUnit) {
  const rows = (series || []).map(([t, v]) => [nextBizDay(iso(new Date(t + 3 * 3600e3))), Number(v)]);
  const [p0, p1] = tefasPts.slice(-2);
  if (!p0 || !p1) return [];
  const i = rows.findIndex((r) => r[0] === p1[0]);
  if (i < 1 || rows[i - 1][0] !== p0[0] || Math.abs(rows[i][1] / rows[i - 1][1] / (p1[1] / p0[1]) - 1) > 2e-5) return [];
  const later = rows.slice(i + 1);
  return later.map(([d, v], k) => {
    const est = Math.round(((p1[1] * v) / rows[i][1]) * 1e6) / 1e6;
    // son gün için sitenin verdiği kesin birim fiyat, endeksten hesaplanana yakınsa (aynı güne aitse) kullanılır
    const exact = k === later.length - 1 && latestUnit > 0 && !same(latestUnit, p1[1]) && Math.abs(latestUnit / est - 1) < 2e-4;
    return [d, exact ? latestUnit : est];
  });
}
async function garanti(code, from, to) {
  const opt = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: 'https://www.garantibbvaportfoy.com.tr', Referer: 'https://www.garantibbvaportfoy.com.tr/' }, body: JSON.stringify(body) });
  const parse = async (r) => { const t = await r.json(); return typeof t === 'string' ? JSON.parse(t) : t; };
  const ser = await parse(await fetchRetry('https://www.garantibbvaportfoy.com.tr/webservice/fundsinddailyds', opt({ lang: 'tr', code, firstDate: from, lastDate: to, rollBack: 'T', value: 1000 })));
  const unit = await parse(await fetchRetry('https://www.garantibbvaportfoy.com.tr/webservice/fundgroupvalues', opt({ Code: code, Date: to, Rollback: 'T', lang: 'tr' })));
  return { series: ser?.data?.[0]?.Data || [], unit: Number(unit?.data?.[0]?.detail?.UnitPrice) || 0 };
}

async function earlyPrices(entry, s) {
  const last = s.points[s.points.length - 1];
  if (!last || !entry.erken) return [];
  if (entry.erken === 'ykb') return ykbEarly(await ykb(entry.ykbKod || entry.kod), last[0], last[1]);
  if (entry.erken === 'garanti') {
    const from = iso(new Date(Date.parse(last[0]) - 10 * 864e5)), to = iso(new Date(Date.now() + 10 * 864e5));
    const g = await garanti(entry.garantiKod || entry.tefas || entry.kod, from, to);
    return garantiEarly(g.series, s.points, g.unit);
  }
  return [];
}

// ---------- TradingView (WebSocket, günlük mumlar) ----------
const tvPacket = (o) => { const s = JSON.stringify(o); return `~m~${s.length}~m~${s}`; };

// Mum zamanı borsanın gece yarısı/açılışıdır; 18:00 UTC sonrası bir sonraki güne aittir (ör. USDTRY 21:00Z)
export const tvDate = (sec) => {
  const d = new Date(sec * 1000);
  return iso(d.getUTCHours() >= 18 ? new Date(d.getTime() + 864e5) : d);
};

export function parseTvMessage(raw, onBar) {
  const events = [];
  for (const part of String(raw).split(/~m~\d+~m~/)) {
    if (!part) continue;
    if (part.startsWith('~h~')) { events.push({ heartbeat: part }); continue; }
    let p;
    try { p = JSON.parse(part); } catch { continue; }
    if (p.m === 'timescale_update') for (const c of p.p?.[1]?.$prices?.s || []) if (c.v?.length >= 5) onBar(c.v[0], c.v[4]);
    events.push({ m: p.m, p: p.p });
  }
  return events;
}

function tvHistory(symbol, bars, timeoutMs = 25000, tf = '1D') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://data.tradingview.com/socket.io/websocket?type=chart', { headers: { Origin: 'https://www.tradingview.com', 'User-Agent': UA } });
    const cs = 'cs_' + Math.random().toString(36).slice(2, 14);
    const out = new Map();
    let err = null, finished = false, info = {};
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* kapalı */ }
      if (!out.size) reject(new Error(err || 'veri yok'));
      else {
        const pts = [...out.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => [tvDate(t), v]);
        pts.info = info; // sembol bilgisi: para birimi, ad, tür
        resolve(pts);
      }
    };
    const timer = setTimeout(() => { err ||= 'zaman aşımı'; done(); }, timeoutMs);
    ws.onopen = () => {
      ws.send(tvPacket({ m: 'set_auth_token', p: ['unauthorized_user_token'] }));
      ws.send(tvPacket({ m: 'chart_create_session', p: [cs, ''] }));
      ws.send(tvPacket({ m: 'resolve_symbol', p: [cs, 'ser_1', '=' + JSON.stringify({ symbol, adjustment: 'splits', session: 'regular' })] }));
      ws.send(tvPacket({ m: 'create_series', p: [cs, '$prices', 's1', 'ser_1', tf, bars, ''] }));
    };
    ws.onerror = (e) => { err = 'bağlantı hatası ' + (e?.message || ''); done(); };
    ws.onclose = () => done();
    ws.onmessage = (ev) => {
      for (const e of parseTvMessage(ev.data, (t, v) => out.set(t, v))) {
        if (e.heartbeat) ws.send(`~m~${e.heartbeat.length}~m~${e.heartbeat}`);
        else if (e.m === 'symbol_resolved' && e.p?.[2]) info = { pb: e.p[2].currency_code, ad: e.p[2].description, tip: e.p[2].type, borsa: e.p[2].exchange };
        else if (e.m === 'series_completed') done();
        else if (e.m === 'symbol_error' || e.m === 'critical_error') { err = JSON.stringify(e.p); done(); }
      }
    };
  });
}

// TradingView sembol araması: "AAPL" → "NASDAQ:AAPL"
export function pickTvSymbol(json, code) {
  const list = (json?.symbols || json || []).filter((x) => ['stock', 'fund', 'dr', 'index'].includes(x.type));
  const exact = list.filter((x) => String(x.symbol).replace(/<\/?em>/g, '').toUpperCase() === code);
  const best = exact.find((x) => x.exchange === 'BIST') || exact.find((x) => ['NASDAQ', 'NYSE', 'AMEX', 'NYSE ARCA', 'XETR'].includes(x.exchange)) || exact[0];
  return best ? `${best.prefix || best.exchange}:${String(best.symbol).replace(/<\/?em>/g, '')}` : null;
}
async function tvSearch(code) {
  const res = await fetchRetry(`https://symbol-search.tradingview.com/symbol_search/v3/?text=${encodeURIComponent(code)}&hl=0&exchange=&lang=tr&search_type=undefined&domain=production`, {
    headers: { Origin: 'https://www.tradingview.com', Referer: 'https://www.tradingview.com/' },
  });
  return pickTvSymbol(await res.json(), code);
}

// ---------- canlidoviz (döviz yedeği, TL karşılığı) ----------
export function parseCanli(json, divisor = 1) {
  return Object.entries(json || {})
    .map(([ts, s]) => [iso(new Date((Number(ts) + 3 * 3600) * 1000)), Number(String(s).split('|')[3]) / divisor])
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a[0].localeCompare(b[0]));
}
async function canlidoviz(id, from, divisor = 1) {
  const f = (d) => d.toISOString().slice(0, 19);
  const res = await fetchRetry(`https://a.canlidoviz.com/items/history?period=DAILY&itemDataId=${id}&startDate=${f(from)}&endDate=${f(new Date())}`, {
    headers: { Accept: '*/*', Origin: 'https://canlidoviz.com', Referer: 'https://canlidoviz.com/' },
  });
  return parseCanli(await res.json(), divisor);
}

// ---------- İş Yatırım (BIST endeks yedeği) ----------
async function isyatirim(endeks, from) {
  const f = (d) => iso(d).replace(/-/g, '') + '000000';
  const res = await fetchRetry(`https://www.isyatirim.com.tr/_Layouts/15/IsYatirim.Website/Common/ChartData.aspx/IndexHistoricalAll?endeks=${endeks}&period=1440&from=${f(from)}&to=${f(new Date())}`, {
    headers: { Referer: 'https://www.isyatirim.com.tr/tr-tr/analiz/Sayfalar/default.aspx' },
  });
  const j = await res.json();
  return (j?.data || []).map(([t, v]) => [iso(new Date(t + 3 * 3600e3)), Number(v)]).filter(([, v]) => v > 0);
}

// ---------- Depolama ----------
async function loadSeries(id) {
  const f = path.join(SERIES, `${id}.json`);
  if (!existsSync(f)) return null;
  try { return JSON.parse(await readFile(f, 'utf8')); } catch { return null; }
}

export function mergePoints(oldPts = [], newPts = []) {
  const m = new Map(oldPts);
  for (const [d, v] of newPts) m.set(d, Math.round(v * 1e6) / 1e6);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

async function saveSeries(s) {
  await writeFile(path.join(SERIES, `${s.id}.json`), JSON.stringify(s).replace(/\],\[/g, '],\n['));
}

// ---------- Ana akış ----------
// Yatırım kalemi: TEFAS fonu ya da hisse (BIST/yabancı).
// Bankanın kodu TEFAS kodundan farklı olabilir (ör. Yapı Kredi YFBL1 = TEFAS YLB).
// Kaynak bulunduktan sonra seriye yazılır; sonraki çalıştırmalar aynı kaynaktan devam eder.
export function assetEntry(f, tip) {
  const base = typeof f === 'string' ? { kod: f } : { ...f };
  return { ...base, kod: String(base.kod).toUpperCase().trim(), ...(base.tefas ? { tefas: String(base.tefas).toUpperCase().trim() } : {}), ...(tip ? { tip } : {}) };
}

async function fromTefas(code, tefasCode, prev) {
  const source = `tefas:${tefasCode}`;
  const full = !prev?.points?.length || prev.source !== source;
  const rows = await tefas(tefasCode, full ? 60 : 1);
  const early = new Set(prev?.erken || []); // erken fiyatlar resmi seriye karışmaz; applyEarly yeniden ekler
  if (prev) prev = { ...prev, points: prev.points.filter((p) => !early.has(p[0])) };
  if (!rows.length) throw new Error(`TEFAS'ta ${tefasCode} yok`);
  return { id: code, ad: rows[rows.length - 1].name || code, tur: 'fon', pb: 'TRY', source, points: mergePoints(full ? [] : prev.points, rows.map((r) => [r.date, r.price])) };
}

async function fromTv(code, sym, prev, years) {
  const source = `tv:${sym}`;
  const full = !prev?.points?.length || prev.source !== source;
  const pts = await tvHistory(sym, full ? Math.round(years * 365) : 40);
  const i = pts.info || {};
  // Borsada işlem gören fonlar (ETF) TradingView'da 'fund' türündedir; TEFAS fonlarından ayrı tutulur
  const tur = i.tip === 'fund' ? 'etf' : 'hisse';
  return { id: code, ad: i.ad || prev?.ad || code, tur, pb: i.pb || prev?.pb || 'TRY', borsa: i.borsa || sym.split(':')[0], source, points: mergePoints(full ? [] : prev.points, pts) };
}

// Kurucu sitesinden gelen erken fiyatlar seriye "erken" işaretiyle eklenir; TEFAS aynı günü yayınlayınca
// resmi fiyat yerine geçer. TEFAS'ın atladığı bir gün (ör. tatil) için yazılmış erken fiyat silinir.
async function applyEarly(entry, s, prev) {
  const tefasDates = new Set(s.points.map((p) => p[0]));
  const lastTefas = s.points[s.points.length - 1]?.[0];
  // önceki erken fiyatlar: TEFAS onayladıysa ya da geçtiyse işaret kalkar
  const stillEarly = (prev?.erken || []).filter((d) => d > lastTefas);
  const oldPts = new Map(prev?.points || []);
  for (const d of stillEarly) s.points.push([d, oldPts.get(d)]);
  let fresh = [];
  try { fresh = await earlyPrices(entry, { points: s.points.filter((p) => tefasDates.has(p[0])) }); } catch (e) { log(`${entry.kod}: erken fiyat alınamadı: ${e.message}`); }
  for (const [d, v] of fresh) if (d > lastTefas) { s.points = s.points.filter((p) => p[0] !== d); s.points.push([d, v]); }
  s.points.sort((a, b) => a[0].localeCompare(b[0]));
  s.erken = s.points.filter((p) => p[0] > lastTefas).map((p) => p[0]);
  if (!s.erken.length) delete s.erken;
}

async function updateAsset(entry, years) {
  const { kod } = entry;
  const prev = await loadSeries(kod);
  const tries = [];
  const known = prev?.source;
  if (entry.tv) tries.push(['tv', entry.tv]);
  else if (entry.tefas) tries.push(['tefas', entry.tefas]);
  else if (known?.startsWith('tefas:')) tries.push(['tefas', known.slice(6)]);
  else if (known?.startsWith('tv:')) tries.push(['tv', known.slice(3)]);
  else if (entry.tip === 'hisse') tries.push(['tv', `BIST:${kod}`], ['ara', kod]); // hisseler TEFAS'ta aranmaz (ör. SAP bir fon kodu da)
  else {
    // Bilinmeyen kod: 3 harfli kodlar çoğunlukla TEFAS fonudur, 4-5 harfliler BIST hissesi
    if (kod.length === 3) tries.push(['tefas', kod], ['tv', `BIST:${kod}`]);
    else tries.push(['tv', `BIST:${kod}`], ['tefas', kod]);
    tries.push(['ara', kod]);
  }
  const errs = [];
  for (const [kind, arg] of tries) {
    try {
      let s;
      if (kind === 'tefas') s = await fromTefas(kod, arg, prev);
      else if (kind === 'tv') s = await fromTv(kod, arg, prev, years);
      else {
        const sym = await tvSearch(arg);
        if (!sym) throw new Error('TradingView aramasında bulunamadı');
        s = await fromTv(kod, sym, prev, years);
      }
      if (kind === 'tefas') await applyEarly(entry, s, prev);
      await saveSeries(s);
      const last = s.points[s.points.length - 1];
      log(`${kod}: ${s.source} (${s.tur}, ${s.pb}) ${s.points.length} satır, son ${last[0]} ${last[1]}${s.erken?.length ? ` (erken: ${s.erken.join(', ')})` : ''}`);
      return s;
    } catch (e) { errs.push(`${kind}:${arg} → ${e.message}`); }
  }
  const hata = errs.join(' | ');
  log(`${kod}: bulunamadı — ${hata}`);
  return prev ? { ...prev, hata } : { id: kod, ad: kod, tur: 'fon', points: [], hata };
}

async function updateBench(b, years) {
  const prev = await loadSeries(b.id);
  const fresh = !prev?.points?.length || !String(prev.source || '').startsWith('tv:');
  const monthly = b.tf === '1M'; // ekonomik veriler (TÜFE) aylık
  const bars = monthly ? (fresh ? Math.round(years * 12) + 12 : 6) : fresh ? Math.round(years * 365) : 40;
  const from = new Date(Date.now() - (fresh ? years * 365 : 40) * 864e5);
  const attempts = [];
  if (b.tv) attempts.push([`tv:${b.tv}`, () => tvHistory(b.tv, bars, 25000, b.tf || '1D')]);
  if (b.canli) attempts.push([`canlidoviz:${b.canli}`, () => canlidoviz(b.canli, from, b.bolen || 1)]);
  if (b.isyatirim) attempts.push([`isyatirim:${b.isyatirim}`, () => isyatirim(b.isyatirim, from)]);
  const errs = [];
  for (const [source, run] of attempts) {
    try {
      const pts = await run();
      if (!pts.length) throw new Error('boş');
      // Kaynak değişirse eski seriyle karıştırma (ölçek farkı olabilir)
      const base = prev && prev.source === source ? prev.points : [];
      const s = { id: b.id, ad: b.ad, tur: 'kiyas', source, points: mergePoints(base, pts) };
      await saveSeries(s);
      log(`${b.id}: ${source} ${pts.length} satır, son ${pts[pts.length - 1][0]} ${pts[pts.length - 1][1]}`);
      return s;
    } catch (e) { errs.push(`${source}: ${e.message}`); }
  }
  log(`${b.id}: hata — ${errs.join(' | ')}`);
  return prev ? { ...prev, hata: errs.join(' | ') } : { id: b.id, ad: b.ad, tur: 'kiyas', points: [], hata: errs.join(' | ') };
}

// ---------- İçerik bazlı analist görüşü (ETF ve endeksler için: içindeki hisselerin ağırlıklı dağılımı) ----------
// rows: [{ w, total, buy, over, hold, under, sell, hedef, close }] — w: ağırlık (piyasa değeri ya da fon payı)
export function aggregate(rows, { tavan = null } = {}) {
  const all = rows.filter((r) => r.w > 0);
  const sumAll = all.reduce((a, r) => a + r.w, 0);
  if (!sumAll) return null;
  // tek hisse tavanı (ör. SMH %20): fazla ağırlık diğerlerine oranla dağıtılır
  let w = all.map((r) => r.w / sumAll);
  if (tavan) for (let k = 0; k < 10; k++) {
    const over = w.reduce((a, x) => a + Math.max(0, x - tavan), 0);
    if (over < 1e-9) break;
    const free = w.reduce((a, x) => a + (x < tavan ? x : 0), 0);
    w = w.map((x) => (x >= tavan ? tavan : x + (over * x) / free));
  }
  let cw = 0, al = 0, tut = 0, sat = 0, hw = 0, hedef = 0, n = 0, gorus = 0;
  all.forEach((r, i) => {
    if (!(r.total > 0)) return;
    const x = w[i];
    cw += x; n++; gorus += r.total;
    al += x * ((r.buy || 0) + (r.over || 0)) / r.total;
    tut += x * (r.hold || 0) / r.total;
    sat += x * ((r.under || 0) + (r.sell || 0)) / r.total;
    if (r.hedef > 0 && r.close > 0) { hw += x; hedef += x * (r.hedef / r.close - 1); }
  });
  if (!cw) return null;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return { al: r3(al / cw), tut: r3(tut / cw), sat: r3(sat / cw), ...(hw ? { hedef: r3(hedef / hw) } : {}), hisse: n, gorus, kapsam: r3(cw) };
}

const STOCK_COLS = ['name', 'market_cap_basic', 'recommendation_buy', 'recommendation_over', 'recommendation_hold', 'recommendation_under', 'recommendation_sell', 'recommendation_total', 'price_target_average', 'close', 'indexes'];
const toRow = (d, w) => ({ w: w ?? d[1], buy: d[2], over: d[3], hold: d[4], under: d[5], sell: d[6], total: d[7], hedef: d[8], close: d[9] });
async function scanTV(market, body) {
  const res = await fetchRetry(`https://scanner.tradingview.com/${market}/scan`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: 'https://www.tradingview.com' }, body: JSON.stringify(body) });
  const j = await res.json();
  if (!j?.data) throw new Error(j?.error || 'tarayıcı yanıtı boş');
  return j.data;
}
const scanCache = new Map();
async function scanMarket(pazar, adet, filter = []) {
  const key = JSON.stringify([pazar, adet, filter]);
  if (!scanCache.has(key)) scanCache.set(key, scanTV(pazar, { columns: STOCK_COLS, range: [0, adet], sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' }, filter: [{ left: 'type', operation: 'equal', right: 'stock' }, ...filter] }));
  return scanCache.get(key);
}

async function composite(spec) {
  if (spec.tip === 'endeks') {
    // endeks üyeleri, piyasa değeri ağırlıklı
    const data = await scanMarket(spec.pazar, spec.adet || 1000, spec.borsa ? [{ left: 'exchange', operation: 'equal', right: spec.borsa }] : []);
    const rows = data.filter((r) => (r.d[10] || []).some((i) => i.proname === spec.endeks)).map((r) => toRow(r.d));
    return rows.length ? { ...aggregate(rows, spec), kaynak: spec.not || 'endeks üyeleri' } : null;
  }
  if (spec.tip === 'sanayi') {
    const data = await scanMarket(spec.pazar, spec.adet || 40, [{ left: 'industry', operation: 'equal', right: spec.sanayi }]);
    const rows = data.map((r) => toRow(r.d));
    return rows.length ? { ...aggregate(rows, spec), kaynak: spec.not || spec.sanayi } : null;
  }
  if (spec.tip === 'liste') {
    // sabit hisse listesi (eşit ağırlık); semboller pazara göre gruplanır
    const by = {};
    for (const [m, sym] of spec.semboller) (by[m] ||= []).push(sym);
    const rows = [];
    for (const [m, syms] of Object.entries(by)) for (const r of await scanTV(m, { symbols: { tickers: syms }, columns: STOCK_COLS })) rows.push(toRow(r.d, 1));
    return rows.length ? { ...aggregate(rows, spec), kaynak: spec.not || 'ana hisseler' } : null;
  }
  if (spec.tip === 'tema') {
    // Tema ETF: sitedeki günlük içerik dosyası (CSV); ABD'de işlem gören hisseler eşleştirilir, kalan kısım kapsam dışı sayılır
    const page = await (await fetchRetry(spec.url, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
    const url = page.match(/https:[^"'()\s]*holdings[^"'()\s]*\.csv[^"'()\s]*/i)?.[0];
    if (!url) throw new Error('içerik dosyası bulunamadı');
    const lines = (await (await fetchRetry(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text()).trim().split(/\r?\n/);
    const head = lines.shift().split(',');
    const iT = head.indexOf('ticker'), iP = head.indexOf('percent_of_nav'), iC = head.indexOf('is_cash');
    const hold = lines.map((l) => l.split(',')).filter((c) => c[iC] !== '1' && /^[A-Z.]{1,6}$/.test(c[iT])).map((c) => [c[iT], Number(c[iP])]);
    const data = await scanTV('america', { columns: STOCK_COLS, filter: [{ left: 'name', operation: 'in_range', right: hold.map((h) => h[0]) }, { left: 'type', operation: 'equal', right: 'stock' }] });
    const best = {};
    for (const r of data) if (!best[r.d[0]] || r.d[1] > best[r.d[0]].d[1]) best[r.d[0]] = r;
    const rows = hold.filter(([t]) => best[t]).map(([t, p]) => toRow(best[t].d, p));
    const agg = aggregate(rows, spec);
    if (!agg) return null;
    // kapsam: fonun tamamına göre (ABD dışı ve halka açık olmayanlar dahil değil)
    const covered = rows.filter((r) => r.total > 0).reduce((a, r) => a + r.w, 0);
    return { ...agg, kapsam: Math.round(covered * 1000) / 1000, kaynak: spec.not || 'fonun günlük içerik listesi' };
  }
  return null;
}

// ---------- Piyasa görüşü: analist dağılımı (yalnızca hisselerde), teknik özet ve RSI (TradingView tarayıcısı) ----------
async function updateViews(cfg) {
  const groups = {};
  for (const b of cfg.kiyaslar || []) if (b.tarama) (groups[b.tarama] ||= []).push([b.id, b.taramaSembol || b.tv]);
  const varliklar = {};
  // Not: aynı istek uygulamada tarayıcıdan da yapılır (js/data.js liveViews)
  for (const [market, list] of Object.entries(groups)) {
    try {
      const res = await fetchRetry(`https://scanner.tradingview.com/${market}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://www.tradingview.com', Referer: 'https://www.tradingview.com/' },
        body: JSON.stringify({ symbols: { tickers: list.map((x) => x[1]), query: { types: [] } }, columns: SCAN_COLS }),
      });
      const rows = Object.fromEntries(((await res.json())?.data || []).map((r) => [r.s, r.d]));
      for (const [id, sym] of list) if (rows[sym]) varliklar[id] = parseScanRow(rows[sym]); else log(`görüş: ${sym} bulunamadı`);
    } catch (e) { log(`görüş (${market}) alınamadı: ${e.message}`); }
  }
  if (!Object.keys(varliklar).length) return;
  for (const b of cfg.kiyaslar || []) {
    if (!b.icerik) continue;
    try {
      const ic = await composite(b.icerik);
      // ima edilen hedef fiyat: bugünkü fiyat × (1 + içerikteki hisselerin ağırlıklı hedef farkı)
      const px = varliklar[b.id]?.fiyat;
      if (ic && ic.hedef != null && px > 0) ic.hedefFiyat = Math.round(px * (1 + ic.hedef) * 100) / 100;
      if (ic) { (varliklar[b.id] ||= {}).icerik = ic; log(`görüş: ${b.id} içerik bazlı ${ic.hisse} hisse, ${ic.gorus} görüş, kapsam %${Math.round(ic.kapsam * 100)}`); }
    } catch (e) { log(`görüş: ${b.id} içerik alınamadı: ${e.message}`); }
  }
  await writeFile(path.join(DATA, 'gorus.json'), JSON.stringify({ guncelleme: new Date().toISOString(), varliklar }, null, 1));
  log(`görüş: ${Object.keys(varliklar).length} varlık`);
  return varliklar;
}

// ---------- Dağılım ölçeri: günlük puan ve geçmişi (data/olcer.json) ----------
async function updateOlcer(varliklar) {
  const rows = {};
  for (const [market, tickers] of Object.entries(OLCER_SCAN)) {
    try { for (const r of await scanTV(market, { symbols: { tickers }, columns: OLCER_COLS })) rows[r.s] = rowObj(r.d); }
    catch (e) { log(`ölçer (${market}) alınamadı: ${e.message}`); }
  }
  const icerik = Object.fromEntries(Object.entries(varliklar || {}).filter(([, v]) => v.icerik).map(([k, v]) => [k, v.icerik]));
  // TR girdileri: TCMB mevduat faizi (net, %17,5 stopaj), TÜFE yıllık, dolar/TL 3 aylık değişim
  const pts = async (id) => (await loadSeries(id))?.points || [];
  const at = (p, d) => { let v = null; for (const [x, y] of p) { if (x <= d) v = y; else break; } return v; };
  const [mev, tufe, usd] = await Promise.all([pts('MEVFAIZ'), pts('TUFE'), pts('USDTRY')]);
  const last = (p) => p[p.length - 1];
  const ago = (p, days) => (last(p) ? at(p, iso(new Date(Date.parse(last(p)[0]) - days * 864e5))) : null);
  const tr = {
    mevduatNet: last(mev) ? (last(mev)[1] / 100) * (1 - 0.175) : null,
    tufeYillik: last(tufe) && ago(tufe, 365) ? last(tufe)[1] / ago(tufe, 365) - 1 : null,
    usdtry3m: last(usd) && ago(usd, 91) ? last(usd)[1] / ago(usd, 91) - 1 : null,
    mevduatDegisim3m: last(mev) && ago(mev, 91) != null ? last(mev)[1] - ago(mev, 91) : null,
  };
  const son = computeOlcer(rows, icerik, tr);
  const f = path.join(DATA, 'olcer.json');
  let gecmis = [];
  try { gecmis = JSON.parse(await readFile(f, 'utf8')).gecmis || []; } catch { /* ilk kez */ }
  const today = iso(new Date(Date.now() + 3 * 3600e3)); // TR günü
  gecmis = gecmis.filter((g) => g[0] !== today);
  gecmis.push([today, son.abd.skor, son.altin.skor, son.tl.skor]);
  await writeFile(f, JSON.stringify({ guncelleme: new Date().toISOString(), tr, son, gecmis: gecmis.slice(-1500) }, null, 1));
  log(`ölçer: ABD ${son.abd.skor} · altın ${son.altin.skor} · TL ${son.tl.skor} (${Object.keys(rows).length} veri)`);
}

async function main() {
  await mkdir(SERIES, { recursive: true });
  const cfg = JSON.parse(await readFile(path.join(DATA, 'config.json'), 'utf8'));
  const index = { guncelleme: new Date().toISOString(), seriler: {} };
  const put = (s) => {
    const last = s.points?.[s.points.length - 1];
    index.seriler[s.id] = { ad: s.ad, tur: s.tur, pb: s.pb || 'TRY', ...(s.erken ? { erken: s.erken } : {}), kaynak: s.source || null, ilk: s.points?.[0]?.[0] || null, son: last?.[0] || null, deger: last?.[1] ?? null, adet: s.points?.length || 0, ...(s.hata ? { hata: s.hata } : {}) };
  };
  const assets = [...(cfg.fonlar || []).map((f) => assetEntry(f)), ...(cfg.hisseler || []).map((f) => assetEntry(f, 'hisse'))];
  for (const a of assets) {
    put(await updateAsset(a, cfg.gecmisYil || 10));
    await sleep(500);
  }
  for (const b of cfg.kiyaslar || []) put(await updateBench(b, cfg.gecmisYil || 10));
  await writeFile(path.join(DATA, 'index.json'), JSON.stringify(index, null, 1));
  const varliklar = await updateViews(cfg);
  try { await updateOlcer(varliklar); } catch (e) { log(`ölçer hesaplanamadı: ${e.message}`); }
  const errs = Object.entries(index.seriler).filter(([, v]) => v.hata);
  log(`bitti. ${Object.keys(index.seriler).length} seri, ${errs.length} hatalı${errs.length ? ': ' + errs.map(([k]) => k).join(', ') : ''}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
