const H = { 'Content-Type': 'text/plain', Origin: 'https://www.tradingview.com' };
const scan = async (market, body) => { const r = await fetch(`https://scanner.tradingview.com/${market}/scan`, { method: 'POST', headers: H, body: JSON.stringify(body) }); return [r.status, await r.text()]; };
const show = (label, [st, t]) => console.log(label, st, t.slice(0, 700).replace(/\s+/g, ' '));
// 1) endeks üyeliği sütunu
show('indexes col', await scan('america', { symbols: { tickers: ['NASDAQ:NVDA', 'NASDAQ:AAPL'] }, columns: ['indexes'] }));
// 2) endeks filtresi
for (const f of [{ left: 'indexes', operation: 'has', right: ['SP:SPX'] }, { left: 'indexes', operation: 'has', right: ['S&P 500'] }]) {
  show('filter ' + JSON.stringify(f.right), await scan('america', { filter: [f], columns: ['name', 'market_cap_basic', 'recommendation_total'], range: [0, 3], sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' } }));
}
// 3) ETF içerik sütunu adayları
for (const c of ['holdings', 'top_holdings', 'etf_holdings', 'fund_holdings', 'number_of_holdings', 'aum', 'expense_ratio']) show('col ' + c, await scan('america', { symbols: { tickers: ['NASDAQ:SMH'] }, columns: [c] }));
// 4) dış kaynaklar
const tryUrl = async (u, opts = {}) => { try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' }, ...opts }); const t = await r.text(); console.log('URL', r.status, u, t.length, t.slice(0, 300).replace(/\s+/g, ' ')); } catch (e) { console.log('URL err', u, e.message); } };
await tryUrl('https://stockanalysis.com/etf/smh/holdings/');
await tryUrl('https://www.ishares.com/us/products/239771/ishares-north-american-techsoftware-etf/1467271812596.ajax?fileType=csv&fileName=IGV_holdings&dataType=fund');
await tryUrl('https://www.ishares.com/us/products/239696/ishares-msci-world-etf/1467271812596.ajax?fileType=csv&fileName=URTH_holdings&dataType=fund');
await tryUrl('https://www.vaneck.com/us/en/investments/semiconductor-etf-smh/holdings/');
await tryUrl('https://www.roundhillinvestments.com/etf/dram/');
await tryUrl('https://temaetfs.com/nasa');
await tryUrl('https://www.slickcharts.com/sp500');
await tryUrl('https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx');
