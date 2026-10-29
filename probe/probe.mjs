import { tvHistory } from './vc.mjs';
const H = { 'Content-Type': 'text/plain', Origin: 'https://www.tradingview.com' };
const scan = async (m, tickers, columns) => { const r = await fetch(`https://scanner.tradingview.com/${m}/scan`, { method: 'POST', headers: H, body: JSON.stringify({ symbols: { tickers }, columns }) }); const t = await r.text(); try { return JSON.parse(t); } catch { return { err: t.slice(0, 200) }; } };
const cols = ['close', 'SMA50', 'SMA200', 'Perf.1M', 'Perf.3M', 'Perf.6M', 'Perf.Y', 'RSI', 'Recommend.All', 'recommendation_total', 'price_target_average'];
for (const [m, t] of [['america', ['NASDAQ:QQQM', 'NASDAQ:CIBR', 'NASDAQ:SMH', 'AMEX:IGV', 'AMEX:DRAM', 'AMEX:NASA', 'SP:SPX']], ['cfd', ['TVC:USOIL', 'TVC:UKOIL', 'TVC:DXY', 'TVC:VIX', 'TVC:GOLD']], ['bond', ['TVC:US10Y', 'TVC:US02Y']], ['global', ['TVC:US10Y', 'TVC:US02Y', 'TVC:VIX', 'CBOE:VIX']], ['economics2', ['ECONOMICS:USINTR']]]) {
  const r = await scan(m, t, cols);
  console.log('==', m, r.err || '');
  for (const x of r.data || []) console.log('  ', x.s, JSON.stringify(Object.fromEntries(cols.map((c, i) => [c, typeof x.d[i] === 'number' ? Math.round(x.d[i] * 1000) / 1000 : x.d[i]]))));
}
for (const sym of ['TVC:US10Y', 'TVC:US02Y', 'ECONOMICS:USINTR', 'TVC:USOIL', 'TVC:DXY', 'TVC:VIX', 'NASDAQ:QQQM', 'NASDAQ:CIBR', 'ECONOMICS:USIRYY']) {
  try { const p = await tvHistory(sym, sym.startsWith('ECONOMICS') ? 24 : 30, 15000, sym.startsWith('ECONOMICS') ? '1M' : '1D'); console.log('H', sym, p.length, JSON.stringify(p.slice(-2)), JSON.stringify(p.info)); } catch (e) { console.log('H', sym, 'err', e.message); }
}
// CIBR endeksi: CRWD, PANW üyelikleri
const r = await scan('america', ['NASDAQ:CRWD', 'NASDAQ:PANW'], ['indexes']);
for (const x of r.data || []) console.log('IDX', x.s, JSON.stringify((x.d[0] || []).map((i) => i.proname + ' ' + i.name).filter((s) => /cyber|siber|security|CYBR|HXR/i.test(s))));
