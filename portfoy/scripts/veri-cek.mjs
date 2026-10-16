#!/usr/bin/env node
// Günlük piyasa verisi toplayıcı. GitHub Actions'ta çalışır, bağımlılığı yoktur (Node 20+).
// - Fon fiyatları: TEFAS (YAT/EMK/BYF), bulunamazsa Yahoo Finance (KOD.IS)
// - Kıyaslar (döviz, altın, endeksler): Yahoo Finance; Dolar/Euro için TCMB yedek
// Çıktı: data/series/<ID>.json, data/index.json, data/tefas-son.json
// Kişisel portföy bilgisi (adet, maliyet) burada YOKTUR; yalnızca herkese açık fiyatlar yazılır.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const SERIES = path.join(DATA, 'series');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

export const iso = (d) => d.toISOString().slice(0, 10);
const trDate = (d) => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[veri]', ...a);

async function fetchRetry(url, opts = {}, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(30000) });
      if (res.ok) return res;
      last = new Error(`${res.status} ${res.statusText}`);
      if (res.status === 404) break;
    } catch (e) { last = e; }
    await sleep(1500 * (i + 1));
  }
  throw last;
}

// ---------- TEFAS ----------
let tefasCookie = '';
async function tefasSession() {
  if (tefasCookie) return;
  try {
    const res = await fetchRetry('https://www.tefas.gov.tr/TarihselVeriler.aspx', { headers: { 'User-Agent': UA } }, 2);
    const set = res.headers.getSetCookie?.() || [];
    tefasCookie = set.map((c) => c.split(';')[0]).join('; ');
  } catch (e) { log('TEFAS oturum alınamadı:', e.message); }
}

export function parseTefas(json) {
  const rows = json?.data || [];
  return rows
    .filter((r) => r.FIYAT != null && Number(r.FIYAT) > 0)
    .map((r) => ({
      // TARIH Türkiye gece yarısının epoch ms değeri; +3 saat ile UTC gününe sabitlenir
      date: iso(new Date(Number(r.TARIH) + 3 * 3600e3)),
      code: r.FONKODU,
      name: r.FONUNVAN,
      price: Number(r.FIYAT),
    }));
}

async function tefasQuery({ fontip, fonkod = '', from, to }) {
  await tefasSession();
  const body = new URLSearchParams({
    fontip, sfontur: '', fonkod, fongrup: '', bastarih: trDate(from), bittarih: trDate(to), fonturkod: '', fonunvantip: '',
  });
  const res = await fetchRetry('https://www.tefas.gov.tr/api/DB/BindHistoryInfo', {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: 'https://www.tefas.gov.tr',
      Referer: 'https://www.tefas.gov.tr/TarihselVeriler.aspx',
      ...(tefasCookie ? { Cookie: tefasCookie } : {}),
    },
    body,
  });
  const text = await res.text();
  if (!text.trim().startsWith('{')) throw new Error('TEFAS JSON dönmedi');
  return parseTefas(JSON.parse(text));
}

// TEFAS bir sorguda ~3 ay veriyor; geriye doğru pencerelerle iner, veri bitince durur.
async function tefasHistory(code, fontip, from, to) {
  const out = [];
  let end = new Date(to);
  let empty = 0;
  while (end >= from) {
    const start = new Date(Math.max(from.getTime(), end.getTime() - 88 * 864e5));
    const rows = await tefasQuery({ fontip, fonkod: code, from: start, to: end });
    if (rows.length === 0) { if (++empty >= 2) break; } else empty = 0;
    out.push(...rows.filter((r) => r.code === code));
    end = new Date(start.getTime() - 864e5);
    await sleep(400);
  }
  return out;
}

// ---------- Yahoo ----------
export function parseYahoo(json) {
  const r = json?.chart?.result?.[0];
  if (!r || !r.timestamp) return { points: [], meta: r?.meta || {} };
  const off = (r.meta?.gmtoffset || 0) * 1000;
  const close = r.indicators?.quote?.[0]?.close || [];
  const adj = r.indicators?.adjclose?.[0]?.adjclose;
  const map = new Map();
  r.timestamp.forEach((t, i) => {
    const v = close[i] ?? adj?.[i];
    if (v != null && Number.isFinite(v) && v > 0) map.set(iso(new Date(t * 1000 + off)), v);
  });
  return { points: [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])), meta: r.meta || {} };
}

async function yahoo(symbol, from) {
  const p1 = Math.floor(from.getTime() / 1000);
  const p2 = Math.floor(Date.now() / 1000) + 86400;
  const q = `/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d&includePrePost=false`;
  let lastErr;
  for (const host of ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']) {
    try {
      const res = await fetchRetry(host + q, { headers: { 'User-Agent': UA, Accept: 'application/json' } }, 2);
      return parseYahoo(await res.json());
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// ---------- TCMB (yalnızca son gün, döviz yedeği) ----------
async function tcmbToday() {
  const res = await fetchRetry('https://www.tcmb.gov.tr/kurlar/today.xml', { headers: { 'User-Agent': UA } }, 2);
  const xml = await res.text();
  const date = (xml.match(/Date="(\d{2})\/(\d{2})\/(\d{4})"/) || []).slice(1);
  const pick = (code) => {
    const m = xml.match(new RegExp(`CurrencyCode="${code}"[\\s\\S]*?<ForexSelling>([\\d.]+)</ForexSelling>`));
    return m ? Number(m[1]) : null;
  };
  if (date.length !== 3) return null;
  return { date: `${date[2]}-${date[0]}-${date[1]}`, USD: pick('USD'), EUR: pick('EUR'), JPY: pick('JPY') };
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
async function updateFund(code, years, today) {
  const prev = await loadSeries(code);
  const fullFrom = new Date(today.getTime() - years * 365 * 864e5);
  const incFrom = new Date(today.getTime() - 20 * 864e5);
  const tryOrder = prev?.source?.startsWith('tefas:') ? [prev.source.slice(6)] : ['YAT', 'EMK', 'BYF'];
  const needFull = !prev || !prev.points?.length;

  for (const fontip of tryOrder) {
    try {
      const rows = needFull
        ? await tefasHistory(code, fontip, fullFrom, today)
        : await tefasQuery({ fontip, fonkod: code, from: incFrom, to: today }).then((r) => r.filter((x) => x.code === code));
      if (rows.length) {
        const pts = rows.map((r) => [r.date, r.price]);
        const s = { id: code, ad: rows[rows.length - 1].name || prev?.ad || code, tur: 'fon', pb: 'TRY', source: `tefas:${fontip}`, points: mergePoints(prev?.points, pts) };
        await saveSeries(s);
        log(`${code}: TEFAS ${fontip}, ${rows.length} satır`);
        return s;
      }
    } catch (e) { log(`${code}: TEFAS ${fontip} hata: ${e.message}`); }
  }
  // Borsada işlem gören fonlar / sertifikalar için Yahoo yedeği
  try {
    const { points, meta } = await yahoo(`${code}.IS`, needFull ? fullFrom : incFrom);
    if (points.length) {
      const s = { id: code, ad: meta.longName || meta.shortName || prev?.ad || code, tur: 'fon', pb: 'TRY', source: 'yahoo', points: mergePoints(prev?.points, points) };
      await saveSeries(s);
      log(`${code}: Yahoo ${points.length} satır`);
      return s;
    }
  } catch (e) { log(`${code}: Yahoo hata: ${e.message}`); }
  log(`${code}: veri bulunamadı`);
  return prev ? { ...prev, hata: 'Bu çalıştırmada yeni veri alınamadı' } : { id: code, ad: code, tur: 'fon', points: [], hata: 'Kaynak bulunamadı' };
}

async function updateBench(b, years, today) {
  const prev = await loadSeries(b.id);
  const from = prev?.points?.length ? new Date(today.getTime() - 20 * 864e5) : new Date(today.getTime() - years * 365 * 864e5);
  try {
    const { points } = await yahoo(b.yahoo, from);
    if (!points.length) throw new Error('boş');
    const s = { id: b.id, ad: b.ad, tur: 'kiyas', source: `yahoo:${b.yahoo}`, points: mergePoints(prev?.points, points) };
    await saveSeries(s);
    log(`${b.id}: ${points.length} satır`);
    return s;
  } catch (e) {
    log(`${b.id}: Yahoo hata: ${e.message}`);
    return prev ? { ...prev, hata: e.message } : { id: b.id, ad: b.ad, tur: 'kiyas', points: [], hata: e.message };
  }
}

async function main() {
  await mkdir(SERIES, { recursive: true });
  const cfg = JSON.parse(await readFile(path.join(DATA, 'config.json'), 'utf8'));
  const today = new Date(iso(new Date()) + 'T00:00:00Z');
  const index = { guncelleme: new Date().toISOString(), seriler: {} };
  const put = (s) => {
    const last = s.points?.[s.points.length - 1];
    index.seriler[s.id] = { ad: s.ad, tur: s.tur, kaynak: s.source || null, ilk: s.points?.[0]?.[0] || null, son: last?.[0] || null, deger: last?.[1] ?? null, adet: s.points?.length || 0, ...(s.hata ? { hata: s.hata } : {}) };
  };

  for (const code of cfg.fonlar || []) put(await updateFund(code.toUpperCase().trim(), cfg.gecmisYil || 10, today));
  for (const b of cfg.kiyaslar || []) put(await updateBench(b, cfg.gecmisYil || 10, today));

  // TCMB yedeği: Yahoo döviz kuru eskiyse bugünün kurunu ekle
  try {
    const t = await tcmbToday();
    if (t) for (const [id, key] of [['USDTRY', 'USD'], ['EURTRY', 'EUR'], ['JPYTRY', 'JPY']]) {
      const s = (await loadSeries(id)) || { id, ad: id, tur: 'kiyas', source: 'tcmb', points: [] };
      const last = s.points[s.points.length - 1]?.[0];
      const v = key === 'JPY' && t[key] ? t[key] / 100 : t[key];
      if (v && (!last || last < t.date)) {
        s.points = mergePoints(s.points, [[t.date, v]]);
        await saveSeries(s);
        put(s);
        log(`${id}: TCMB ${t.date} ${v}`);
      }
    }
  } catch (e) { log('TCMB hata:', e.message); }

  // Tüm TEFAS fonlarının son fiyatı: uygulamada listede olmayan bir fonu eklerken anında fiyat gösterebilmek için
  try {
    const son = {};
    for (const fontip of ['YAT', 'EMK', 'BYF']) {
      const rows = await tefasQuery({ fontip, from: new Date(today.getTime() - 7 * 864e5), to: today });
      for (const r of rows) if (!son[r.code] || son[r.code][0] < r.date) son[r.code] = [r.date, r.price, r.name];
      await sleep(500);
    }
    if (Object.keys(son).length) {
      await writeFile(path.join(DATA, 'tefas-son.json'), JSON.stringify(son));
      log(`tefas-son: ${Object.keys(son).length} fon`);
    }
  } catch (e) { log('tefas-son hata:', e.message); }

  await writeFile(path.join(DATA, 'index.json'), JSON.stringify(index, null, 1));
  const errs = Object.entries(index.seriler).filter(([, v]) => v.hata);
  log(`bitti. ${Object.keys(index.seriler).length} seri, ${errs.length} hatalı`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
