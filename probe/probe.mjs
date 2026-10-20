const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const post = async (u, body, h = {}) => { try { const r = await fetch(u, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/json; charset=UTF-8', Accept: 'application/json, text/javascript, */*', 'X-Requested-With': 'XMLHttpRequest', ...h }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) }); return { s: r.status, t: await r.text() }; } catch (e) { return { s: 'ERR ' + e.message, t: '' }; } };
const now = new Date(); console.log('saat UTC', now.toISOString());
const iso = (d) => d.toISOString().slice(0, 10);
const today = iso(new Date(now.getTime() + 3 * 3600e3)), tomorrow = iso(new Date(now.getTime() + 27 * 3600e3)), yest = iso(new Date(now.getTime() - 21 * 3600e3));
for (const c of ['YFBL1', 'YFBL7']) {
  const r = await post('https://www.yapikredi.com.tr/yatirimci-kosesi/fon-detay.aspx/FundRiskData', { fundCode: c }, { Origin: 'https://www.yapikredi.com.tr', Referer: `https://www.yapikredi.com.tr/yatirimci-kosesi/fon-bilgileri/${c}` });
  let x = r.t.slice(0, 200); try { const f = JSON.parse(r.t).d.Data.FundList[0]; x = JSON.stringify(Object.fromEntries(Object.entries(f).filter(([k]) => /Price|Date|Time|Spk|Code|Valor|Tarih/i.test(k)))); } catch {}
  console.log(`### YKB ${c} ${r.s} ${x}`);
}
for (const [d, rb] of [[yest, 'T'], [today, 'T'], [today, 'F'], [tomorrow, 'T'], [tomorrow, 'F']]) {
  const r = await post('https://www.garantibbvaportfoy.com.tr/webservice/fundgroupvalues', { Code: 'TGT', Date: d, Rollback: rb, lang: 'tr' }, { Origin: 'https://www.garantibbvaportfoy.com.tr', Referer: 'https://www.garantibbvaportfoy.com.tr/' });
  let x = r.t.slice(0, 160); try { const j = JSON.parse(JSON.parse(r.t)); x = JSON.stringify(j.data?.[0]?.detail); } catch {}
  console.log(`### Garanti TGT Date=${d} Rollback=${rb} ${r.s} ${x}`);
}
const t = await post('https://www.tefas.gov.tr/api/funds/fonFiyatBilgiGetir', { fonKodu: 'YVD', dil: 'TR', periyod: 1 });
try { console.log('### TEFAS YVD son', JSON.stringify(JSON.parse(t.t).resultList.slice(-2).map((x) => [x.tarih, x.fiyat]))); } catch { console.log('TEFAS', t.s); }
const t2 = await post('https://www.tefas.gov.tr/api/funds/fonFiyatBilgiGetir', { fonKodu: 'TGT', dil: 'TR', periyod: 1 });
try { console.log('### TEFAS TGT son', JSON.stringify(JSON.parse(t2.t).resultList.slice(-2).map((x) => [x.tarih, x.fiyat]))); } catch { console.log('TEFAS', t2.s); }
