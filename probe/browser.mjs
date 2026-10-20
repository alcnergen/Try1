import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'tr-TR', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' });
async function sniff(name, url, extra) {
  const p = await ctx.newPage();
  const seen = [];
  p.on('response', async (r) => {
    const u = r.url(); const ct = r.headers()['content-type'] || '';
    if (!/json|text\/plain|javascript/.test(ct) || /\.js(\?|$)|google|facebook|analytics|hotjar|criteo|doubleclick|insider|gtm/.test(u)) return;
    try { const t = await r.text(); if (/[0-9][.,][0-9]{4,6}/.test(t) && /(fiyat|price|fon|pay|YFBL|TGT|YLB|YVD)/i.test(t)) seen.push(`${r.request().method()} ${u}\n      ${r.request().postData()?.slice(0, 300) || ''}\n      => ${t.slice(0, 700).replace(/\s+/g, ' ')}`); } catch {}
  });
  try { await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }); } catch (e) { console.log(name, 'goto hata', e.message); }
  if (extra) await extra(p);
  await p.waitForTimeout(4000);
  const txt = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  const hits = [...txt.matchAll(/.{0,80}[0-9],[0-9]{4,6}.{0,60}/g)].slice(0, 8).map((m) => m[0]);
  console.log(`### ${name} ${p.url()}\n  sayfadaki sayılar: ${hits.join(' || ')}\n  XHR:\n    ${seen.slice(0, 8).join('\n    ')}`);
  return p;
}
console.log('saat', new Date().toISOString());
await sniff('YKB YFBL1', 'https://www.yapikredi.com.tr/yatirimci-kosesi/fon-bilgileri/YFBL1');
await sniff('YKB YFBL7', 'https://www.yapikredi.com.tr/yatirimci-kosesi/fon-bilgileri/YFBL7');
const g = await sniff('Garanti ana', 'https://www.garantibbvaportfoy.com.tr/');
const links = await g.evaluate(() => [...document.querySelectorAll('a')].map((a) => a.href).filter((h) => /fon/i.test(h)).slice(0, 40));
console.log('### Garanti fon bağlantıları', [...new Set(links)].join(' '));
const tgt = links.find((h) => /tgt|kisa-vadeli-borclanma/i.test(h));
if (tgt) await sniff('Garanti TGT', tgt);
await b.close();
