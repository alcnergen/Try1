#!/usr/bin/env node
// Günlük piyasa verisi toplayıcı. GitHub Actions'ta çalışır, bağımlılığı yoktur (Node 22+).
// - Fon fiyatları: TEFAS'ın 2026'daki yeni JSON API'si (/api/funds/fonFiyatBilgiGetir)
// - Kıyaslar (döviz, altın, endeksler): TradingView günlük mumları; döviz için canlidoviz, BIST 100 için İş Yatırım yedek
//   (Yahoo ve Stooq GitHub sunucularını engellediği için kullanılmıyor)
// Çıktı: data/series/<ID>.json, data/index.json
// Kişisel portföy bilgisi (adet, maliyet) burada YOKTUR; yalnızca herkese açık fiyatlar yazılır.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function tvHistory(symbol, bars, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://data.tradingview.com/socket.io/websocket?type=chart', { headers: { Origin: 'https://www.tradingview.com', 'User-Agent': UA } });
    const cs = 'cs_' + Math.random().toString(36).slice(2, 14);
    const out = new Map();
    let err = null, finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* kapalı */ }
      if (!out.size) reject(new Error(err || 'veri yok'));
      else resolve([...out.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => [tvDate(t), v]));
    };
    const timer = setTimeout(() => { err ||= 'zaman aşımı'; done(); }, timeoutMs);
    ws.onopen = () => {
      ws.send(tvPacket({ m: 'set_auth_token', p: ['unauthorized_user_token'] }));
      ws.send(tvPacket({ m: 'chart_create_session', p: [cs, ''] }));
      ws.send(tvPacket({ m: 'resolve_symbol', p: [cs, 'ser_1', '=' + JSON.stringify({ symbol, adjustment: 'splits', session: 'regular' })] }));
      ws.send(tvPacket({ m: 'create_series', p: [cs, '$prices', 's1', 'ser_1', '1D', bars, ''] }));
    };
    ws.onerror = (e) => { err = 'bağlantı hatası ' + (e?.message || ''); done(); };
    ws.onclose = () => done();
    ws.onmessage = (ev) => {
      for (const e of parseTvMessage(ev.data, (t, v) => out.set(t, v))) {
        if (e.heartbeat) ws.send(`~m~${e.heartbeat.length}~m~${e.heartbeat}`);
        else if (e.m === 'series_completed') done();
        else if (e.m === 'symbol_error' || e.m === 'critical_error') { err = JSON.stringify(e.p); done(); }
      }
    };
  });
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
// Bankaların kendi kodu TEFAS kodundan farklı olabilir (ör. Yapı Kredi YFBL1 = TEFAS YLB)
async function updateFund(code, tefasCode = code) {
  const prev = await loadSeries(code);
  const source = `tefas:${tefasCode}`;
  const full = !prev?.points?.length || prev.source !== source;
  try {
    const rows = await tefas(tefasCode, full ? 60 : 1);
    if (!rows.length) throw new Error(`TEFAS'ta ${tefasCode} koduyla fon bulunamadı`);
    const s = { id: code, ad: rows[rows.length - 1].name || code, tur: 'fon', pb: 'TRY', source, points: mergePoints(full ? [] : prev.points, rows.map((r) => [r.date, r.price])) };
    await saveSeries(s);
    log(`${code}${tefasCode !== code ? ` (${tefasCode})` : ''}: TEFAS ${rows.length} satır, son ${rows[rows.length - 1].date} ${rows[rows.length - 1].price}`);
    return s;
  } catch (e) {
    log(`${code}: ${e.message}`);
    return prev ? { ...prev, hata: e.message } : { id: code, ad: code, tur: 'fon', points: [], hata: e.message };
  }
}

async function updateBench(b, years) {
  const prev = await loadSeries(b.id);
  const fresh = !prev?.points?.length || !String(prev.source || '').startsWith('tv:');
  const bars = fresh ? Math.round(years * 365) : 40;
  const from = new Date(Date.now() - (fresh ? years * 365 : 40) * 864e5);
  const attempts = [];
  if (b.tv) attempts.push([`tv:${b.tv}`, () => tvHistory(b.tv, bars)]);
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

async function main() {
  await mkdir(SERIES, { recursive: true });
  const cfg = JSON.parse(await readFile(path.join(DATA, 'config.json'), 'utf8'));
  const index = { guncelleme: new Date().toISOString(), seriler: {} };
  const put = (s) => {
    const last = s.points?.[s.points.length - 1];
    index.seriler[s.id] = { ad: s.ad, tur: s.tur, kaynak: s.source || null, ilk: s.points?.[0]?.[0] || null, son: last?.[0] || null, deger: last?.[1] ?? null, adet: s.points?.length || 0, ...(s.hata ? { hata: s.hata } : {}) };
  };
  for (const f of cfg.fonlar || []) {
    const code = (typeof f === 'string' ? f : f.kod).toUpperCase().trim();
    put(await updateFund(code, (typeof f === 'string' ? code : f.tefas || code).toUpperCase().trim()));
    await sleep(500);
  }
  for (const b of cfg.kiyaslar || []) put(await updateBench(b, cfg.gecmisYil || 10));
  await writeFile(path.join(DATA, 'index.json'), JSON.stringify(index, null, 1));
  const errs = Object.entries(index.seriler).filter(([, v]) => v.hata);
  log(`bitti. ${Object.keys(index.seriler).length} seri, ${errs.length} hatalı${errs.length ? ': ' + errs.map(([k]) => k).join(', ') : ''}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
