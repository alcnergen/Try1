const H = { 'Content-Type': 'text/plain', Origin: 'https://www.tradingview.com' };
const scan = async (market, body) => { const r = await fetch(`https://scanner.tradingview.com/${market}/scan`, { method: 'POST', headers: H, body: JSON.stringify(body) }); const t = await r.text(); try { return JSON.parse(t); } catch { return { err: t.slice(0, 300) }; } };
let r = await scan('germany', { columns: ['name', 'indexes', 'exchange'], range: [0, 60], sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' }, filter: [{ left: 'type', operation: 'equal', right: 'stock' }] });
const cnt = {}; for (const x of r.data || []) for (const i of x.d[1] || []) if (/DAX|DE40/i.test(i.proname + i.name)) cnt[i.proname + ' ' + i.name] = (cnt[i.proname + ' ' + i.name] || 0) + 1;
console.log('DE top60', JSON.stringify(cnt)); console.log('DE örnek', JSON.stringify((r.data || []).slice(0, 5).map((x) => [x.s, x.d[2]])));
r = await scan('germany', { symbols: { tickers: ['XETR:SAP', 'XETR:SIE'] }, columns: ['indexes', 'recommendation_total', 'market_cap_basic'] });
console.log('SAP', JSON.stringify(r.data?.map((x) => [x.s, x.d[0]?.map((i) => i.proname).slice(0, 12), x.d[1], x.d[2]])));
r = await scan('korea', { symbols: { tickers: ['KRX:005930', 'KRX:000660'] }, columns: ['name', 'recommendation_total', 'recommendation_buy', 'market_cap_basic', 'currency'] });
console.log('KR', JSON.stringify(r));
const page = async (u) => { try { const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36' } }); return [res.status, await res.text()]; } catch (e) { return [0, e.message]; } };
let [st, t] = await page('https://temaetfs.com/nasa');
const m = t.match(/["'(]([^"'()]*\.csv\?temaHoldingsCacheBuster=\d+)/); console.log('TEMA url', m?.[1]);
const tcsv = (t.match(/["']([^"']*\.csv[^"']*)["']/g) || []).slice(0, 5); console.log('TEMA tüm', tcsv);
if (m) { let u = m[1]; if (u.startsWith('/')) u = 'https://temaetfs.com' + u; const [s2, c] = await page(u); console.log('TEMA csv', s2, c.slice(0, 900)); }
[st, t] = await page('https://www.roundhillinvestments.com/etf/dram/');
console.log('RH json/api', (t.match(/["']([^"']*(?:\.json|api|holding)[^"']*)["']/gi) || []).slice(0, 15));
const j = t.indexOf('Top 10'); console.log('RH top10', t.slice(j, j + 1500).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
