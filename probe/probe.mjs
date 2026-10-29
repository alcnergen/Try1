const H = { 'Content-Type': 'text/plain', Origin: 'https://www.tradingview.com' };
for (const [m, t] of [['cfd', 'TVC:USOIL'], ['global', 'TVC:USOIL'], ['futures', 'NYMEX:CL1!'], ['cfd', 'TVC:UKOIL'], ['cfd', 'NYMEX:CL1!'], ['futures', 'ICEEUR:BRN1!'], ['cfd', 'FX:USOIL'], ['cfd', 'OANDA:WTICOUSD']]) {
  const r = await fetch(`https://scanner.tradingview.com/${m}/scan`, { method: 'POST', headers: H, body: JSON.stringify({ symbols: { tickers: [t] }, columns: ['close', 'Perf.3M', 'SMA200'] }) });
  const x = await r.text(); console.log(m, t, r.status, x.slice(0, 160));
}
