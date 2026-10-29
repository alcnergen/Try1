import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valueAt, positionAt, fundState, portfolioHistory, replicate, periodReturn, projectScenario, monthsToTarget, combine, cpiDaily, findCashDuplicates, removeCashDuplicates, nextBusinessDay, applyValuationPatch } from '../js/calc.js';
import { addToConfig, isTracked, repoInfo } from '../js/track.js';
import { depositSeries, series } from '../js/data.js';
import { parseTefas, parseTvMessage, tvDate, parseCanli, mergePoints, pickTvSymbol, assetEntry, ykbEarly, garantiEarly, nextBizDay, parseScanRow, aggregate } from '../scripts/veri-cek.mjs';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('valueAt son bilinen değeri döndürür', () => {
  const p = [['2026-01-01', 1], ['2026-01-05', 2]];
  assert.equal(valueAt(p, '2025-12-31'), null);
  assert.equal(valueAt(p, '2026-01-03'), 1);
  assert.equal(valueAt(p, '2026-01-05'), 2);
  assert.equal(valueAt(p, '2027-01-01'), 2);
});

test('ortalama maliyet ve satış kârı', () => {
  const txs = [
    { date: '2026-01-01', type: 'buy', qty: 100, price: 10 },
    { date: '2026-02-01', type: 'buy', qty: 100, price: 20 },
    { date: '2026-03-01', type: 'sell', qty: 50, price: 30 },
  ];
  const p = positionAt(txs, '2026-12-31');
  assert.equal(p.qty, 150);
  close(p.avg, 15);
  close(p.realized, 50 * 15);
});

test('net kâr = brüt kâr × (1 − stopaj)', () => {
  const f = { code: 'ABC', txs: [{ date: '2026-10-02', type: 'buy', qty: 1000000, price: 0.12 }] };
  const s = fundState(f, [['2026-10-16', 0.125]], '2026-10-16', 0.175);
  close(s.value, 125000);
  close(s.gross, 5000);
  close(s.net, 4125);
});

test('portföy geçmişi ve dolar maliyeti', () => {
  const funds = [{ code: 'A', txs: [{ date: '2026-10-02', type: 'buy', qty: 1000, price: 10 }] }];
  const h = portfolioHistory(funds, { A: [['2026-10-02', 10], ['2026-10-03', 11]] }, [['2026-10-02', 50], ['2026-10-03', 55]], { end: '2026-10-03' });
  assert.equal(h.length, 2);
  close(h[1].value, 11000);
  close(h[1].costUsd, 200);
  close(h[1].valueUsd, 200);
});

test('kıyas: aynı para dolara yatırılsaydı', () => {
  const funds = [{ code: 'A', txs: [{ date: '2026-01-01', type: 'buy', qty: 100, price: 10 }] }];
  close(replicate(funds, [['2026-01-01', 40], ['2026-06-01', 50]], '2026-06-01'), 1250);
});

test('dönem getirisi ve seri birleştirme', () => {
  close(periodReturn([['2026-01-01', 100], ['2026-06-01', 120]], '2026-01-01', '2026-06-01'), 0.2);
  assert.equal(periodReturn([['2026-01-01', 100]], '2025-01-01', '2026-06-01'), null);
  assert.deepEqual(combine([['d1', 2]], [['d1', 3]], (a, b) => a * b), [['d1', 6]]);
});

test('senaryo projeksiyonu', () => {
  const r = projectScenario({ start: 1000, annual: 0.12, months: 12, costBase: 1000, taxRate: 0.175 });
  close(r.value, 1120, 1e-6);
  close(r.net, 120 * 0.825, 1e-6);
  assert.equal(monthsToTarget({ start: 1000, annual: 1, target: 2000 }), 12);
});

test('TEFAS, TradingView ve canlidoviz yanıtlarını ayrıştırma', () => {
  const t = parseTefas({ errorCode: null, errorMessage: null, resultList: [
    { fonKodu: 'ABC', fonUnvan: 'X Fonu', tarih: '2026-10-16', fiyat: 0.5 },
    { fonKodu: 'ABC', fonUnvan: 'X Fonu', tarih: '2026-10-17', fiyat: '0,75' },
    { fonKodu: 'ABC', tarih: '2026-10-18', fiyat: 0 },
  ] });
  assert.deepEqual(t.map((r) => [r.date, r.price]), [['2026-10-16', 0.5], ['2026-10-17', 0.75]]);
  assert.throws(() => parseTefas({ errorMessage: 'Sistem Hatası!!' }));

  // ABD endeksi 13:30Z, döviz 21:00Z (ertesi gün), Japonya 00:00Z
  assert.equal(tvDate(Date.parse('2026-10-16T13:30:00Z') / 1000), '2026-10-16');
  assert.equal(tvDate(Date.parse('2026-10-15T21:00:00Z') / 1000), '2026-10-16');
  assert.equal(tvDate(Date.parse('2026-10-16T00:00:00Z') / 1000), '2026-10-16');
  const bars = [];
  const msg = '~m~5~m~~h~12~m~80~m~{"m":"timescale_update","p":["cs",{"$prices":{"s":[{"i":0,"v":[1792157400,1,2,0.5,7659.44,0]}]}}]}';
  const ev = parseTvMessage(msg, (t, v) => bars.push([t, v]));
  assert.deepEqual(bars, [[1792157400, 7659.44]]);
  assert.equal(ev[0].heartbeat, '~h~12');

  assert.deepEqual(parseCanli({ 1790553600: '49.0102|49.1733|48.9702|48.9824' }), [['2026-09-28', 48.9824]]);
  assert.deepEqual(mergePoints([['a', 1], ['b', 2]], [['b', 3], ['c', 4]]), [['a', 1], ['b', 3], ['c', 4]]);
});

test('hisse kodu çözümleme', () => {
  const res = { symbols: [
    { symbol: 'AAPL', type: 'stock', exchange: 'BMV' },
    { symbol: 'AAPL', type: 'stock', exchange: 'NASDAQ' },
    { symbol: 'AAPLX', type: 'stock', exchange: 'NASDAQ' },
  ] };
  assert.equal(pickTvSymbol(res, 'AAPL'), 'NASDAQ:AAPL');
  assert.equal(pickTvSymbol({ symbols: [{ symbol: 'THYAO', type: 'stock', exchange: 'BIST' }] }, 'THYAO'), 'BIST:THYAO');
  assert.equal(pickTvSymbol({ symbols: [] }, 'YOK'), null);
  assert.deepEqual(assetEntry(' thyao '), { kod: 'THYAO' });
  assert.deepEqual(assetEntry('sap', 'hisse'), { kod: 'SAP', tip: 'hisse' });
  assert.deepEqual(assetEntry({ kod: 'yfbl1', tefas: 'ylb' }), { kod: 'YFBL1', tefas: 'YLB' });
});

test('aylık TÜFE günlük seriye çevrilir, son aydan sonrası tahmin edilir', () => {
  const { points, estimatedAfter } = cpiDaily([['2026-07-01', 98], ['2026-08-01', 100], ['2026-09-01', 102]], '2026-10-15');
  assert.equal(estimatedAfter, '2026-09-15');
  assert.deepEqual(points[0], ['2026-07-15', 98]);
  close(valueAt(points, '2026-08-15'), 100);
  close(valueAt(points, '2026-09-15'), 102);
  // son iki ayın ortalama artışı ~%2,02/ay; 30 gün sonra ≈ 102 × 1,0202^(12×30/365)
  const m = Math.sqrt(102 / 98);
  close(valueAt(points, '2026-10-15'), 102 * Math.pow(m, 12 * 30 / 365), 1e-9);
});

test('otomatik takip: kod doğru listeye bir kez eklenir', () => {
  const cfg = { fonlar: ['TGT', { kod: 'YFBL1', tefas: 'YLB' }], hisseler: [] };
  assert.equal(isTracked(cfg, 'YFBL1'), true);
  assert.equal(addToConfig(cfg, 'TGT', 'fon'), false);
  assert.equal(addToConfig(cfg, 'AAPL', 'hisse'), true);
  assert.equal(addToConfig(cfg, 'IPB', 'fon'), true);
  assert.deepEqual(cfg.hisseler, ['AAPL']);
  assert.deepEqual(cfg.fonlar.at(-1), 'IPB');
  assert.deepEqual(repoInfo({ hostname: 'alcnergen.github.io', pathname: '/Try1/' }), { owner: 'alcnergen', repo: 'Try1' });
});

test('mevduat: TCMB faizi stopaj sonrası günlük işler, değişen faizi izler', () => {
  const end = '2026-10-18';
  const rates = [['2000-01-01', 36.5]];
  const d = depositSeries(rates, { auto: true, tax: 0.2 }, end);
  assert.equal(d.auto, true);
  close(d.net, 0.292);
  const p = d.points;
  close(p[p.length - 1][1] / p[p.length - 2][1], 1 + 0.292 / 365);
  const m = depositSeries([], { auto: true, manualRate: 0.4 }, end);
  assert.equal(m.auto, false);
  close(m.points[1][1] / m.points[0][1], 1 + 0.4 / 365);
});

test('nakit çift sayımı bulunur ve yalnızca o değerlemeden kaldırılır', () => {
  const others = {
    assets: [{ id: 'ev', name: 'Ev', cat: 'Gayrimenkul' }, { id: 'nakit', name: 'Nakit', cat: 'Nakit' }],
    vals: [
      { date: '2026-06-30', values: { ev: 100 } },
      { date: '2026-10-02', values: { ev: 100, nakit: 5253066.1 } },
    ],
  };
  const funds = [
    { code: 'A', txs: [{ date: '2026-10-02', type: 'buy', qty: 134000, price: 1.89566597014925 }] },
    { code: 'B', txs: [{ date: '2026-10-02', type: 'buy', qty: 90000, price: 4.599854 }] },
    { code: 'C', txs: [{ date: '2026-10-02', type: 'buy', qty: 36774600, price: 0.124680078097382 }] },
  ];
  const d = findCashDuplicates(others, funds);
  assert.equal(d.length, 1);
  assert.equal(d[0].date, '2026-10-02');
  removeCashDuplicates(others, d);
  assert.deepEqual(others.vals[1].values, { ev: 100 });
  assert.deepEqual(others.vals[0].values, { ev: 100 });
  assert.deepEqual(others.assets.map((a) => a.id), ['ev']);
  // farklı tutardaki nakit dokunulmaz
  const o2 = { assets: [{ id: 'n', cat: 'Nakit' }], vals: [{ date: '2026-10-02', values: { n: 1000000 } }] };
  assert.equal(findCashDuplicates(o2, funds).length, 0);
});

test('sonraki iş günü hafta sonunu atlar', () => {
  assert.equal(nextBusinessDay('2026-10-16'), '2026-10-19');
  assert.equal(nextBusinessDay('2026-10-19'), '2026-10-20');
});

test('değerleme yaması ada göre yazar, eksik kalemi oluşturur, diğer tarihlere dokunmaz', () => {
  const others = {
    assets: [{ id: 'g', name: 'Göztepe Ev', cat: 'Gayrimenkul' }, { id: 'b', name: 'Bademli Arsa', cat: 'Arsa' }, { id: 'o', name: 'Opel Corsa', cat: 'Araç' }],
    vals: [{ date: '2026-06-30', usd: 48.24, values: { g: 23000000, b: 500000, o: 400000 } }],
  };
  let n = 0;
  applyValuationPatch(others, { tarih: '2026-10-02', usd: 49.15, kalemler: [
    { ad: 'göztepe ev', deger: 23000000 }, { ad: 'Bademli Arsa', tur: 'Arsa', deger: 600000 }, { ad: 'Volvo Ex30', tur: 'Araç', deger: 2500000 },
  ] }, () => 'yeni' + n++);
  assert.deepEqual(others.vals[0].values, { g: 23000000, b: 500000, o: 400000 });
  assert.deepEqual(others.vals[1], { date: '2026-10-02', usd: 49.15, values: { g: 23000000, b: 600000, yeni0: 2500000 } });
  assert.equal(others.assets.find((a) => a.id === 'yeni0').cat, 'Araç');
});

test('kurucu sitelerinden erken (ertesi gün) fiyat', () => {
  assert.equal(nextBizDay('2026-10-16'), '2026-10-19'); // cuma → pazartesi
  // Yapı Kredi: alış = TEFAS'taki son fiyat → satış ertesi iş gününün fiyatı
  assert.deepEqual(ykbEarly({ BankSellsPrice: 4.684, BankBuysPrice: 4.680003 }, '2026-10-20', 4.680003), [['2026-10-21', 4.684]]);
  assert.deepEqual(ykbEarly({ BankSellsPrice: 4.680003, BankBuysPrice: 4.675786 }, '2026-10-20', 4.680003), []); // henüz yeni fiyat yok
  assert.deepEqual(ykbEarly({ BankSellsPrice: 4.69, BankBuysPrice: 4.685 }, '2026-10-20', 4.680003), []); // eşleşmiyor → tarih belirsiz
  // Garanti: seri hesap günüyle tarihli (TEFAS'ta ertesi iş günü); TEFAS'taki son iki fiyatın oranıyla eşleştirilir
  const ts = (d) => Date.parse(d + 'T00:00:00Z') - 3 * 3600e3;
  const tefasPts = [['2026-10-19', 0.126811], ['2026-10-20', 0.126931]];
  const ser = [[ts('2026-10-15'), 1001.51262], [ts('2026-10-16'), 1004.276516], [ts('2026-10-19'), 1005.226853], [ts('2026-10-20'), 1006.2]];
  const est = Math.round(0.126931 * 1006.2 / 1005.226853 * 1e6) / 1e6;
  assert.deepEqual(garantiEarly(ser, tefasPts, 0.126931), [['2026-10-21', est]]);
  assert.deepEqual(garantiEarly(ser, tefasPts, est + 1e-6), [['2026-10-21', est + 1e-6]]); // kesin birim fiyat
  assert.deepEqual(garantiEarly(ser.slice(0, 3), tefasPts, 0.126931), []); // henüz yeni gün yok
  assert.deepEqual(garantiEarly(ser, [['2026-10-19', 0.126811], ['2026-10-20', 0.127]], 0), []); // oran tutmuyor
});

test('elle girilen fiyat yalnızca otomatik verinin ulaşmadığı günlerde geçerli', () => {
  const market = { raw: { TGT: [['2026-10-16', 0.126462], ['2026-10-19', 0.126811], ['2026-10-20', 0.126931]] } };
  const manual = { TGT: { '2026-10-18': 0.126811, '2026-10-19': 0.126931, '2026-10-21': 0.127056 } };
  assert.deepEqual(series(market, manual, 'TGT'), [['2026-10-16', 0.126462], ['2026-10-19', 0.126811], ['2026-10-20', 0.126931], ['2026-10-21', 0.127056]]);
  assert.deepEqual(series({ raw: {} }, manual, 'TGT').length, 3); // otomatik veri yoksa hepsi kullanılır
});

test('piyasa görüşü satırı (TradingView tarayıcısı)', () => {
  // NVDA: analist dağılımı + hedef fiyat
  assert.deepEqual(parseScanRow([216.47, 40.903, -0.0879, 62, 7, 2, 0, 1, 72, 334.45]), { rsi: 40.9, teknik: -0.088, fiyat: 216.47, analist: { al: 69, tut: 2, sat: 1, toplam: 72, hedef: 0.545, hedefFiyat: 334.45 } });
  // endeks: analist yok
  assert.deepEqual(parseScanRow([7712.57, 49.43, -0.0242, null, null, null, null, null, null, null]), { rsi: 49.4, teknik: -0.024, fiyat: 7712.57 });
});

test('içerik bazlı analist görüşü (ağırlıklı)', () => {
  const rows = [
    { w: 3, total: 10, buy: 8, over: 0, hold: 2, under: 0, sell: 0, hedef: 120, close: 100 }, // %80 al, hedef +%20
    { w: 1, total: 4, buy: 0, over: 0, hold: 2, under: 1, sell: 1, hedef: 90, close: 100 }, // %50 tut %50 sat, hedef −%10
    { w: 1, total: null }, // analist yok → kapsam dışı
  ];
  const a = aggregate(rows);
  assert.equal(a.hisse, 2); assert.equal(a.gorus, 14); assert.equal(a.kapsam, 0.8);
  assert.equal(a.al, 0.6); assert.equal(a.tut, 0.275); assert.equal(a.sat, 0.125); assert.equal(a.hedef, 0.125);
  // tavan: tek hisse en fazla %50
  const t = aggregate([{ w: 9, total: 1, buy: 1 }, { w: 1, total: 1, sell: 1 }], { tavan: 0.5 });
  assert.equal(t.al, 0.5); assert.equal(t.sat, 0.5);
});

test('dağılım ölçeri: puanlama ve dağılım', async () => {
  const { computeOlcer, allocation, trendScore } = await import('../js/olcer.js');
  assert.equal(trendScore({ close: 110, SMA50: 105, SMA200: 100 }), 1);
  assert.equal(trendScore({ close: 90, SMA50: 95, SMA200: 100 }), -1);
  assert.equal(trendScore(null), null);
  const up = { close: 110, SMA50: 105, SMA200: 100, 'Perf.3M': 10, RSI: 50 };
  const rows = { 'NASDAQ:QQQM': up, 'NASDAQ:SMH': up, 'CBOE:DRAM': up, 'CBOE:IGV': up, 'AMEX:NASA': up, 'NASDAQ:CIBR': up, 'SP:SPX': up,
    'TVC:GOLD': { close: 90, SMA50: 95, SMA200: 100, 'Perf.3M': -8, RSI: 50 }, 'TVC:VIX': { close: 14 }, 'TVC:DXY': { close: 104, 'Perf.3M': 4 }, 'TVC:USOIL': { close: 70, 'Perf.3M': 0 },
    'TVC:US10Y': { close: 4, 'Perf.1M': -5 }, 'TVC:US02Y': { close: 3.5 }, 'ECONOMICS:USINTR': { close: 4 }, 'ECONOMICS:USIRYY': { close: 3 } };
  const o = computeOlcer(rows, { K_QQQM: { al: 0.8, hedef: 0.2 } }, { mevduatNet: 0.3, tufeYillik: 0.3, usdtry3m: 0.05, mevduatDegisim3m: -1 });
  assert.ok(o.abd.skor > 65, `ABD güçlü olmalı: ${o.abd.skor}`);
  assert.ok(o.altin.skor < 45, `altın zayıf olmalı: ${o.altin.skor}`);
  assert.ok(o.tl.skor >= 0 && o.tl.skor <= 100);
  const a = allocation(o, 0.5);
  assert.ok(Math.abs(a.abd.hedef + a.altin.hedef - 0.5) < 1e-9);
  assert.ok(Math.abs(a.abd.simdi + a.altin.simdi + a.tl.simdi - 1) < 1e-9);
  assert.equal(a.abd.simdi, a.abd.hedef); // güçlü ölçerde hedefin tamamı
  assert.ok(a.altin.simdi < a.altin.hedef);
  assert.ok(Math.abs(a.etf.reduce((s, e) => s + e.pay, 0) - 1) < 1e-9);
  // veri yoksa nötr (50) ve çökmez
  const bos = computeOlcer({}, {}, {});
  assert.equal(bos.abd.skor, 50); assert.equal(bos.altin.skor, 50);
});
