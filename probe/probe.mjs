for (const origin of ['https://alcnergen.github.io', 'https://www.tradingview.com']) {
  const pre = await fetch('https://scanner.tradingview.com/america/scan', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  console.log('OPTIONS', origin, pre.status, JSON.stringify([...pre.headers].filter(([k]) => k.startsWith('access-control'))));
  const r = await fetch('https://scanner.tradingview.com/america/scan', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain' }, body: JSON.stringify({ symbols: { tickers: ['NASDAQ:NVDA'], query: { types: [] } }, columns: ['RSI'] }) });
  console.log('POST', origin, r.status, JSON.stringify([...r.headers].filter(([k]) => k.startsWith('access-control'))), (await r.text()).slice(0, 120));
}
