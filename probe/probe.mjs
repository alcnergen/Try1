const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const post = async (ep, body) => (await fetch('https://www.tefas.gov.tr/api/funds/' + ep, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify(body) })).json().catch(() => ({}));
const get = async (u, h = {}) => { try { const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'text/html,application/json', ...h }, redirect: 'follow', signal: AbortSignal.timeout(25000) }); return { s: r.status, t: await r.text(), u: r.url }; } catch (e) { return { s: 'ERR ' + e.message, t: '' }; } };
const around = (t, re, n = 3) => { const out = []; let m; const rx = new RegExp(re, 'gi'); while ((m = rx.exec(t)) && out.length < n) out.push(t.slice(Math.max(0, m.index - 200), m.index + 300).replace(/\s+/g, ' ')); return out; };
console.log('saat', new Date().toISOString());
for (const c of ['TGT', 'YLB', 'YVD']) {
  const p = await post('fonProfilBilgiGetir', { fonKodu: c, dil: 'TR' });
  const prof = p.resultList?.[0] || {};
  const kap = Object.entries(prof).filter(([k, v]) => /kap|link|url/i.test(k) || /kap\.org/.test(String(v)));
  console.log(`### ${c} profil alanları:`, Object.keys(prof).join(','), '| kap:', JSON.stringify(kap));
  const link = kap.map(([, v]) => v).find((v) => /kap\.org/.test(String(v)));
  if (link) {
    const r = await get(link);
    console.log(`### ${c} KAP sayfa ${r.s} len=${r.t.length} url=${r.u}`);
    for (const a of around(r.t, 'pay de[ğg]er|birim pay|fiyat', 4)) console.log('   …', a.slice(0, 500));
    const obj = (r.t.match(/objId[\\"':]+([A-F0-9]{32})/) || [])[1]; console.log('   objId', obj);
  }
}
for (const [n, u] of [['YKB YFBL1', 'https://www.yapikredi.com.tr/yatirimci-kosesi/fon-bilgileri/YFBL1'], ['YKB YFBL7', 'https://www.yapikredi.com.tr/yatirimci-kosesi/fon-bilgileri/YFBL7'], ['YKP YLB', 'https://www.yapikrediportfoy.com.tr/fonlarimiz/YLB'], ['Garanti TGT', 'https://www.garantibbvaportfoy.com.tr/yatirim-fonlari/TGT'], ['Garanti ana', 'https://www.garantibbvaportfoy.com.tr/']]) {
  const r = await get(u);
  console.log(`### ${n} ${r.s} len=${r.t.length} url=${r.u}`);
  for (const a of around(r.t, '[0-9],[0-9]{6}|birim pay|fiyat', 3)) console.log('   …', a.slice(0, 400));
  const apis = [...new Set((r.t.match(/["'](\/?[A-Za-z0-9_\-\/.]*(api|Api|ajax|Service|svc)[A-Za-z0-9_\-\/.?=&]*)["']/g) || []))].slice(0, 15); console.log('   api?', apis.join(' '));
}
