const cols = ['name', 'description', 'close', 'RSI', 'Recommend.All', 'Recommend.MA', 'Recommend.Other', 'recommendation_buy', 'recommendation_over', 'recommendation_hold', 'recommendation_under', 'recommendation_sell', 'recommendation_total', 'recommendation_mark', 'price_target_average'];
const groups = {
  america: ['NASDAQ:NVDA', 'NASDAQ:SMH', 'AMEX:IGV', 'AMEX:DRAM', 'AMEX:NASA', 'AMEX:URTH', 'SP:SPX', 'NASDAQ:NDX'],
  crypto: ['BITSTAMP:BTCUSD', 'BITSTAMP:XRPUSD'],
  forex: ['FX_IDC:USDTRY', 'FX_IDC:EURTRY'],
  cfd: ['TVC:GOLD', 'TVC:SILVER', 'TVC:NI225'],
  global: ['XETR:DAX', 'TVC:NI225', 'TVC:GOLD'],
  turkey: ['BIST:XU100', 'BIST:THYAO'],
  germany: ['XETR:DAX'],
};
for (const [m, tickers] of Object.entries(groups)) {
  try {
    const r = await fetch(`https://scanner.tradingview.com/${m}/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://www.tradingview.com', Referer: 'https://www.tradingview.com/' }, body: JSON.stringify({ symbols: { tickers, query: { types: [] } }, columns: cols }) });
    const t = await r.text();
    console.log('==', m, r.status);
    try { for (const row of JSON.parse(t).data || []) console.log('  ', row.s, JSON.stringify(Object.fromEntries(cols.map((c, i) => [c, row.d[i]])))); } catch { console.log(t.slice(0, 400)); }
  } catch (e) { console.log(m, 'err', e.message); }
}
