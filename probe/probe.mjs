const O = 'https://alcnergen.github.io';
const show = (l, r) => console.log(l, r.status, JSON.stringify([...r.headers].filter(([k]) => k.startsWith('access-control'))));
for (const [l, u, body, ct] of [
  ['YKB', 'https://www.yapikredi.com.tr/yatirimci-kosesi/fon-detay.aspx/FundRiskData', { fundCode: 'YFBL7' }, 'application/json; charset=UTF-8'],
  ['GAR seri', 'https://www.garantibbvaportfoy.com.tr/webservice/fundsinddailyds', { lang: 'tr', code: 'TGT', firstDate: '2026-10-15', lastDate: '2026-10-31', rollBack: 'T', value: 1000 }, 'application/json'],
  ['GAR birim', 'https://www.garantibbvaportfoy.com.tr/webservice/fundgroupvalues', { Code: 'TGT', Date: '2026-10-31', Rollback: 'T', lang: 'tr' }, 'application/json'],
]) {
  try { show(l + ' OPTIONS', await fetch(u, { method: 'OPTIONS', headers: { Origin: O, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } })); } catch (e) { console.log(l, 'OPTIONS hata', e.message); }
  try { const r = await fetch(u, { method: 'POST', headers: { Origin: O, 'Content-Type': 'text/plain' }, body: JSON.stringify(body) }); show(l + ' POST text/plain', r); console.log('   ', (await r.text()).slice(0, 160)); } catch (e) { console.log(l, 'POST hata', e.message); }
  try { const r = await fetch(u, { method: 'POST', headers: { Origin: O, 'Content-Type': ct }, body: JSON.stringify(body) }); show(l + ' POST json', r); } catch (e) { console.log(l, 'POST hata', e.message); }
}
