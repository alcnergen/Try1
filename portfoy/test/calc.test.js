import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valueAt, positionAt, fundState, portfolioHistory, replicate, periodReturn, projectScenario, monthsToTarget, combine } from '../js/calc.js';
import { parseTefas, parseYahoo, mergePoints } from '../scripts/veri-cek.mjs';

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

test('TEFAS ve Yahoo yanıtlarını ayrıştırma', () => {
  const t = parseTefas({ data: [{ TARIH: '1760302800000', FONKODU: 'ABC', FONUNVAN: 'X Fonu', FIYAT: 0.5 }, { TARIH: '1760389200000', FONKODU: 'ABC', FIYAT: 0 }] });
  assert.deepEqual(t, [{ date: '2025-10-13', code: 'ABC', name: 'X Fonu', price: 0.5 }]);
  const y = parseYahoo({ chart: { result: [{ meta: { gmtoffset: 10800 }, timestamp: [1760331600, 1760418000], indicators: { quote: [{ close: [41.5, null] }] } }] } });
  assert.deepEqual(y.points, [['2025-10-13', 41.5]]);
  assert.deepEqual(mergePoints([['a', 1], ['b', 2]], [['b', 3], ['c', 4]]), [['a', 1], ['b', 3], ['c', 4]]);
});
