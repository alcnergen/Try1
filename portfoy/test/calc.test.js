import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valueAt, positionAt, fundState, portfolioHistory, replicate, periodReturn, projectScenario, monthsToTarget, combine, cpiDaily } from '../js/calc.js';
import { parseTefas, parseTvMessage, tvDate, parseCanli, mergePoints, pickTvSymbol, assetEntry } from '../scripts/veri-cek.mjs';

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
