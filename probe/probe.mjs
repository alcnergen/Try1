const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const get = async (u) => { try { const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', Referer: 'https://www.kap.org.tr/tr/' }, signal: AbortSignal.timeout(25000) }); return { s: r.status, t: await r.text() }; } catch (e) { return { s: 'ERR ' + e.message, t: '' }; } };
console.log('saat', new Date().toISOString());
const ids = { TGT: '33E5FED7E6A300EAE0530A4A622B2AEA', YLB: '33E5FED7E4E300EAE0530A4A622B2AEA' };
for (const [c, id] of Object.entries(ids)) {
  for (const type of ['ALL', '0', '8aca490d502e34b801502e380044002b']) {
    for (const host of ['https://www.kap.org.tr', 'https://kap.org.tr']) {
      const r = await get(`${host}/tr/api/disclosure/filter/FILTERYFBF/${id}/${type}/10`);
      let summary = r.t.slice(0, 200);
      try { const j = JSON.parse(r.t); summary = `${j.length} kayıt: ` + j.slice(0, 12).map((x) => `${x.disclosureBasic?.publishDate} | ${x.disclosureBasic?.title} | ${x.disclosureBasic?.summary || ''} | ${x.disclosureBasic?.disclosureType || ''} | ${x.disclosureBasic?.disclosureIndex}`).join('\n      '); } catch {}
      console.log(`### ${c} type=${type} ${host} -> ${r.s}\n      ${summary}`);
      if (r.s === 200) break;
    }
  }
}
const page = await get('https://www.kap.org.tr/tr/fon-bilgileri/genel/tgt-garanti-portfoy-kisa-vadeli-borclanma-araclari-fonu');
const subj = [...new Set((page.t.match(/(disclosureType|disclosureClass|subject|typeName|itemName)\\?":\\?"[^"\\]{2,60}/g) || []))].slice(0, 60);
console.log('### sayfa alanları', subj.join(' || '));
