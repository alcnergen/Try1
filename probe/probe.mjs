const UA = { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', Accept: 'text/html,application/json,*/*' };
for (const u of ['https://www.garantibbva.com.tr/yatirim/borclanma-araclari-fonlari', 'https://www.garantibbva.com.tr/yatirim/para-piyasasi-fonlari']) {
  try {
    const r = await fetch(u, { headers: UA }); const t = await r.text();
    console.log('SAYFA', r.status, u, t.length);
    for (const k of ['TGT', '0,127', '0.127', 'Kısa Vadeli', 'birim', 'Birim']) { const i = t.indexOf(k); console.log('  ', k, i, i >= 0 ? t.slice(Math.max(0, i - 200), i + 250).replace(/\s+/g, ' ') : ''); }
    const js = [...new Set((t.match(/["']([^"'\s]*(?:\.json|\/api\/|webservice|service|servlet|graphql)[^"'\s]*)["']/gi) || []).map((x) => x.slice(1, -1)))].slice(0, 30);
    console.log('   uç adayları', JSON.stringify(js));
    const scripts = [...new Set((t.match(/src=["']([^"']+\.js[^"']*)["']/g) || []).map((x) => x.slice(5, -1)))].filter((x) => !/insider|gtm|analytics|adobe|launch/i.test(x)).slice(0, 15);
    console.log('   scriptler', JSON.stringify(scripts));
  } catch (e) { console.log('hata', u, e.message); }
}
