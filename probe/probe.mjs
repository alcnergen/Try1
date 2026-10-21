const H = { 'Content-Type': 'text/plain', Origin: 'https://www.tradingview.com' };
const scan = async (market, body) => { const r = await fetch(`https://scanner.tradingview.com/${market}/scan`, { method: 'POST', headers: H, body: JSON.stringify(body) }); const t = await r.text(); return { st: r.status, len: t.length, j: (() => { try { return JSON.parse(t); } catch { return t.slice(0, 300); } })() }; };
for (const [m, t] of [['america', 'NASDAQ:MSFT'], ['america', 'NASDAQ:PLTR'], ['japan', 'TSE:7203'], ['germany', 'XETR:SAP'], ['turkey', 'BIST:THYAO'], ['america', 'NASDAQ:MU'], ['america', 'NASDAQ:RKLB']]) {
  const r = await scan(m, { symbols: { tickers: [t] }, columns: ['indexes'] });
  console.log('IDX', t, JSON.stringify((r.j.data?.[0]?.d?.[0] || []).map((x) => x.proname)));
}
// tüm pazarı tara (büyükten küçüğe), boyut ve süre
for (const [m, n] of [['america', 1500], ['germany', 300], ['japan', 600], ['turkey', 300]]) {
  const t0 = Date.now();
  const r = await scan(m, { columns: ['name', 'indexes', 'market_cap_basic', 'recommendation_buy', 'recommendation_over', 'recommendation_hold', 'recommendation_under', 'recommendation_sell', 'recommendation_total', 'price_target_average', 'close'], range: [0, n], sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' }, filter: [{ left: 'type', operation: 'equal', right: 'stock' }] });
  const rows = r.j.data || [];
  const cnt = (p) => rows.filter((x) => (x.d[1] || []).some((i) => i.proname === p));
  const cov = (p) => { const a = cnt(p); return `${p}: ${a.length} üye, analistli ${a.filter((x) => x.d[8] > 0).length}`; };
  console.log('SCAN', m, r.st, 'satır', rows.length, 'bayt', r.len, 'ms', Date.now() - t0, typeof r.j === 'string' ? r.j : '');
  if (m === 'america') console.log('  ', cov('SP:SPX'), '|', cov('NASDAQ:NDX'), '|', cov('NASDAQ:SOX'));
  if (m === 'germany') console.log('  ', cov('XETR:DAX'));
  if (m === 'japan') console.log('  ', cov('TVC:NI225'));
  if (m === 'turkey') console.log('  ', cov('BIST:XU100'));
}
const page = async (u) => { try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36' } }); return [r.status, await r.text()]; } catch (e) { return [0, e.message]; } };
let [st, t] = await page('https://www.ishares.com/us/products/239771/');
console.log('ISH', st, (t.match(/[^"']*1467271812596\.ajax\?[^"']*/g) || []).slice(0, 3));
[st, t] = await page('https://www.ishares.com/us/products/239696/');
console.log('ISH URTH', st, (t.match(/[^"']*1467271812596\.ajax\?[^"']*/g) || []).slice(0, 3));
[st, t] = await page('https://www.roundhillinvestments.com/etf/dram/');
console.log('RH', st, (t.match(/holdings[^"']{0,80}/gi) || []).slice(0, 8), (t.match(/\.csv[^"']*/g) || []).slice(0, 5));
const i = t.toLowerCase().indexOf('micron'); console.log('RH micron', i, t.slice(Math.max(0, i - 300), i + 200).replace(/\s+/g, ' '));
[st, t] = await page('https://temaetfs.com/nasa');
console.log('TEMA', st, (t.match(/\.csv[^"']*/g) || []).slice(0, 5));
const k = t.indexOf('Rocket'); console.log('TEMA rocket', k, t.slice(Math.max(0, k - 300), k + 200).replace(/\s+/g, ' '));
