const opt = (body, h) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...h }, body: JSON.stringify(body) });
console.log('now', new Date().toISOString());
for (const code of ['YFBL1', 'YFBL7']) {
  try { const r = await fetch('https://www.yapikredi.com.tr/yatirimci-kosesi/fon-detay.aspx/FundRiskData', opt({ fundCode: code }, { 'X-Requested-With': 'XMLHttpRequest', Origin: 'https://www.yapikredi.com.tr', Referer: `https://www.yapikredi.com.tr/yatirimci-kosesi/fon-bilgileri/${code}` })); const t = await r.text(); console.log('YKB', code, r.status, t.slice(0, 1500)); } catch (e) { console.log('YKB err', code, e.message); }
}
const G = { Origin: 'https://www.garantibbvaportfoy.com.tr', Referer: 'https://www.garantibbvaportfoy.com.tr/' };
try { const r = await fetch('https://www.garantibbvaportfoy.com.tr/webservice/fundsinddailyds', opt({ lang: 'tr', code: 'TGT', firstDate: '2026-10-13', lastDate: '2026-10-30', rollBack: 'T', value: 1000 }, G)); let t = await r.json(); if (typeof t === 'string') t = JSON.parse(t); console.log('GARser', JSON.stringify(t).slice(0, 300)); console.log('GARlast', JSON.stringify((t.data?.[0]?.Data || []).slice(-3).map(([a, v]) => [new Date(a + 3 * 3600e3).toISOString(), v]))); } catch (e) { console.log('GAR err', e.message); }
for (const d of ['2026-10-20', '2026-10-21', '2026-10-30']) {
  try { const r = await fetch('https://www.garantibbvaportfoy.com.tr/webservice/fundgroupvalues', opt({ Code: 'TGT', Date: d, Rollback: 'T', lang: 'tr' }, G)); let t = await r.json(); if (typeof t === 'string') t = JSON.parse(t); console.log('GARunit', d, JSON.stringify(t).slice(0, 600)); } catch (e) { console.log('GARu err', e.message); }
}
