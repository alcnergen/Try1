const UA = { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', Accept: 'text/html,application/json,*/*' };
const opt = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: 'https://www.garantibbvaportfoy.com.tr', Referer: 'https://www.garantibbvaportfoy.com.tr/' }, body: JSON.stringify(body) });
const parse = async (r) => { const t = await r.json(); return typeof t === 'string' ? JSON.parse(t) : t; };
try { const s = await parse(await fetch('https://www.garantibbvaportfoy.com.tr/webservice/fundsinddailyds', opt({ lang: 'tr', code: 'TGT', firstDate: '2026-10-15', lastDate: '2026-10-31', rollBack: 'T', value: 1000 }))); console.log('GP seri', JSON.stringify((s.data?.[0]?.Data || []).slice(-3).map(([a, v]) => [new Date(a + 3 * 3600e3).toISOString().slice(0, 10), v]))); } catch (e) { console.log('GP seri hata', e.message); }
for (const d of ['2026-10-21', '2026-10-22']) try { const u = await parse(await fetch('https://www.garantibbvaportfoy.com.tr/webservice/fundgroupvalues', opt({ Code: 'TGT', Date: d, Rollback: 'T', lang: 'tr' }))); console.log('GP birim', d, u.data?.[0]?.detail?.UnitPrice); } catch (e) { console.log('GP birim hata', e.message); }
const pages = [
  'https://www.garantibbva.com.tr/yatirim/yatirim-fonlari',
  'https://www.garantibbva.com.tr/yatirim/yatirim-fonlari/fon-fiyatlari',
  'https://www.garantibbva.com.tr/yatirim/yatirim-fonlari/garanti-portfoy-kisa-vadeli-borclanma-araclari-fonu',
  'https://www.garantibbva.com.tr/tr/yatirim/fonlar/fon-fiyatlari.page',
  'https://www.garantibbvaportfoy.com.tr/fonlar/kisa-vadeli-borclanma-araclari-fonu',
];
for (const u of pages) {
  try {
    const r = await fetch(u, { headers: UA, redirect: 'follow' }); const t = await r.text();
    const hit = ['0,127182', '0.127182', '127182'].map((k) => [k, t.indexOf(k)]).filter(([, i]) => i >= 0);
    console.log('SAYFA', r.status, r.url, t.length, 'TGT', t.indexOf('TGT'), 'fiyat', JSON.stringify(hit));
    const apis = [...new Set((t.match(/["'](\/[^"'\s]*(?:api|service|fon|fund)[^"'\s]*)["']/gi) || []).map((x) => x.slice(1, -1)))].filter((x) => !/\.(png|jpg|svg|css|woff)/.test(x)).slice(0, 25);
    console.log('   api adayları', JSON.stringify(apis));
    for (const [k, i] of hit) console.log('   bağlam', t.slice(Math.max(0, i - 400), i + 100).replace(/\s+/g, ' '));
  } catch (e) { console.log('SAYFA hata', u, e.message); }
}
