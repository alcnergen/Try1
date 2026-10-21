import { tvHistory } from './vc.mjs';
for (const q of ['NASA', 'DRAM', 'IGV', 'SMH', 'NVDA', 'BTCUSD', 'XRPUSD', 'SILVER', 'XAGUSD']) {
  try {
    const r = await fetch(`https://symbol-search.tradingview.com/symbol_search/v3/?text=${q}&hl=0&exchange=&lang=en&search_type=undefined&domain=production`, { headers: { Origin: 'https://www.tradingview.com', Referer: 'https://www.tradingview.com/' } });
    const j = await r.json();
    console.log('==', q); for (const s of (j.symbols || []).slice(0, 6)) console.log('  ', `${s.source_id || s.exchange}:${s.symbol}`.replace(/<\/?em>/g, ''), '|', s.type, '|', s.description?.replace(/<\/?em>/g, ''), '|', s.currency_code, '|', s.country);
  } catch (e) { console.log(q, 'err', e.message); }
}
for (const sym of ['BITSTAMP:BTCUSD', 'BITSTAMP:XRPUSD', 'TVC:SILVER', 'NASDAQ:SMH', 'NASDAQ:NVDA', 'NASDAQ:IGV', 'AMEX:IGV', 'CBOE:IGV', 'NASDAQ:DRAM', 'AMEX:DRAM', 'NASDAQ:NASA', 'AMEX:NASA', 'CBOE:NASA']) {
  try { const p = await tvHistory(sym, 30, 15000); const i = p.info || {}; console.log('H', sym, p.length, JSON.stringify(p.slice(-1)), JSON.stringify(i), p.length ? 'ilk ' + p[0][0] : ''); } catch (e) { console.log('H', sym, 'err', e.message); }
}
const all = await tvHistory('NASDAQ:SMH', 4500, 25000); console.log('SMH uzun', all.length, all[0]);
