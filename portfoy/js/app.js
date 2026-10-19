import * as store from './store.js';
import * as backup from './backup.js';
import * as track from './track.js';
import { loadMarket, loadOne, series, benchSeries, BENCHES } from './data.js';
import {
  todayISO, addDays, daysBetween, valueAt, valueAtOrFirst, sortTx, fundState, portfolioHistory,
  replicate, periodReturn, periodStart, annualize, dailyRate, projectScenario, monthsToTarget, combine, cpiDaily, findCashDuplicates, removeCashDuplicates, nextBusinessDay, applyValuationPatch,
} from './calc.js';
import { lineChart, legend } from './chart.js';

// ---------- Durum ----------
let S = store.load();
let M = { raw: {}, names: {}, index: null, errors: [] };
let C = null; // hesaplanmış değerler
let tab = location.hash.match(/^#(ozet|fonlar|kiyas|senaryo|diger)$/)?.[1] || 'ozet';
const ui = { ozetRange: 'ALL', fundRange: '1Y', cmpRange: '1Y', cmpCcy: null, histAll: false, otherDate: null, otherCcy: 'TRY' };
const persist = () => { store.save(S); backup.schedule(() => S, () => updateStatus()); };

// ---------- Biçimlendirme ----------
const nf = (d) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
const NF = [0, 1, 2, 3, 4, 6].reduce((o, d) => ((o[d] = nf(d)), o), {});
const money = (v, ccy = 'TRY', d = 2) => (v == null || !Number.isFinite(v) ? '—' : (ccy === 'USD' ? '$' : '₺') + NF[d].format(v));
const num = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : NF[d].format(v));
const pct = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}%${NF[d].format(Math.abs(v) * 100)}`);
const signMoney = (v, ccy, d = 2) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${money(Math.abs(v), ccy, d)}`);
const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
const arrow = (v) => (v > 0 ? '▲' : v < 0 ? '▼' : '•');
// Eksen etiketleri: adım küçükse daha çok ondalık (aynı etiketin tekrarlanmaması için)
const compact = (v, step) => {
  const a = Math.abs(v);
  const dec = (unit) => (step ? Math.min(4, Math.max(1, Math.ceil(-Math.log10(step / unit) - 1e-9))) : 1);
  if (a >= 1e9) return NF[dec(1e9)].format(v / 1e9) + ' Mr';
  if (a >= 1e6) return NF[dec(1e6)].format(v / 1e6) + ' Mn';
  if (a >= 1e4) return NF[0].format(v / 1e3) + ' B';
  if (a >= 100) return NF[0].format(v);
  return NF[2].format(v);
};
const dTR = (iso) => (iso ? iso.split('-').reverse().join('.') : '—');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function parseNum(s) {
  if (typeof s === 'number') return s;
  s = String(s || '').trim().replace(/\s|₺|\$|%/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  return Number(s);
}
const COLORS = { PORT: 'var(--s1)', USD: 'var(--s2)', XU100: 'var(--s3)', ALTIN: 'var(--s4)', NDX: 'var(--s5)', DAX: 'var(--s6)', SPX: 'var(--s7)', EUR: 'var(--s8)', N225: 'var(--s9)', MSCIW: 'var(--s10)', MEVDUAT: 'var(--s11)', TUFE: 'var(--s12)', COST: 'var(--muted)' };
const FUND_COLORS = ['var(--s1)', 'var(--s7)', 'var(--s3)', 'var(--s5)', 'var(--s6)', 'var(--s8)'];
const benchName = (id) => {
  if (id !== 'MEVDUAT') return BENCHES.find((b) => b.id === id)?.ad || id;
  const d = C?.benches?.depositInfo;
  return d?.auto ? `Mevduat (TCMB faizi, net %${num(d.net * 100, 1)})` : `Mevduat (%${num((d?.net ?? S.settings.deposit) * 100, 0)} yıllık)`;
};
const fundName = (code) => S.funds.find((f) => f.code === code)?.name || M.names[code] || code;

// ---------- Hesaplama ----------
// Varlığın para birimi ve türü (veri dosyasından; yoksa kullanıcının girdiği)
const assetCcy = (code) => M.meta?.[code]?.pb || S.funds.find((f) => f.code === code)?.pb || 'TRY';
const assetKind = (code) => M.meta?.[code]?.tur || 'fon';
// Borsada işlem görenler (hisse, ETF): 2 ondalık, varsayılan stopaj %0
const isListed = (code) => ['hisse', 'etf'].includes(assetKind(code));
const KIND_LABEL = { hisse: 'Hisse', etf: 'ETF', fon: 'Fon' };
const CCY_SIGN = { TRY: '₺', USD: '$', EUR: '€', JPY: '¥', GBP: '£' };
const fmtPrice = (v, code) => {
  const ccy = assetCcy(code);
  const d = isListed(code) ? 2 : ccy === 'TRY' ? 6 : 4;
  return v == null ? '—' : (ccy === 'TRY' ? '' : CCY_SIGN[ccy] || ccy + ' ') + num(v, d);
};
const defaultTax = (code) => (isListed(code) ? 0 : S.settings.tax);

// Hesaplamalar TL ile yapılır: yabancı para birimli hisselerin fiyatı ve işlemleri o günün kuruyla TL'ye çevrilir
function toTRY(f, fx) {
  const ccy = assetCcy(f.code);
  const native = series(M, S.manual, f.code);
  const base = { ...f, tax: f.tax ?? defaultTax(f.code), ccy, native };
  const rate = fx[ccy];
  if (ccy === 'TRY' || !rate?.length) return { ...base, pts: native };
  const at = (d) => valueAtOrFirst(rate, d);
  return {
    ...base,
    pts: combine(native, rate, (p, k) => p * k),
    txs: (f.txs || []).map((t) => ({ ...t, price: t.price * at(t.date), fee: (Number(t.fee) || 0) * at(t.date) })),
  };
}

// Fiyatı henüz açıklanmamış işlemler (ör. 16:00 sonrası talimat): fiyat gelince gerçek fiyatla güncellenir
function resolvePendingPrices() {
  const done = [];
  for (const f of S.funds) for (const t of f.txs || []) {
    if (!t.autoPrice) continue;
    const exact = series(M, S.manual, f.code).find((p) => p[0] === t.date);
    if (exact) { t.price = exact[1]; delete t.autoPrice; done.push(`${f.code} ${dTR(t.date)}`); }
  }
  if (done.length) { store.save(S); setTimeout(() => toast(`İşlem fiyatı açıklandı ve güncellendi: ${done.join(', ')}`, 6000), 300); }
}

// Tek seferlik veri düzeltmeleri (yedekten geri yüklenen eski veriye de uygulanır)
function runMigrations() {
  S.migrations ||= {};
  if (!S.migrations.nakitDedupe) {
    const dups = findCashDuplicates(S.others, S.funds);
    if (dups.length) {
      removeCashDuplicates(S.others, dups);
      setTimeout(() => toast(`Fonlara geçen nakit (${dups.map((d) => money(d.value, 'TRY', 0) + ', ' + dTR(d.date)).join('; ')}) Diğer varlıklardan kaldırıldı; artık iki kez sayılmıyor.`, 8000), 500);
    }
    S.migrations.nakitDedupe = true;
    persist();
  }
}

function compute() {
  const today = todayISO();
  resolvePendingPrices();
  const usd = series(M, S.manual, 'USDTRY');
  const fx = { USD: usd, EUR: series(M, S.manual, 'EURTRY'), JPY: series(M, S.manual, 'JPYTRY') };
  const funds = S.funds.map((f) => toTRY(f, fx));
  const pmap = Object.fromEntries(funds.map((f) => [f.code, f.pts]));
  const benches = benchSeries(M, S.manual, S.settings);
  const hist = portfolioHistory(funds, pmap, usd, { taxRate: S.settings.tax, end: today });
  const last = hist[hist.length - 1] || null;
  // Bir önceki "fiyat günü" (bugünün satırı yalnızca son fiyatın tekrarıysa onu atla)
  let prev = null;
  if (last) for (let i = hist.length - 2; i >= 0; i--) if (Math.abs(hist[i].value - last.value) > 1e-6 || i === 0) { prev = hist[i]; break; }
  const states = funds.map((f) => ({ f, s: fundState(f, pmap[f.code], today, S.settings.tax), pts: pmap[f.code] }));
  // Kıyas tarihi: yatırımların en son fiyatlandığı gün (hafta sonu mevduat/enflasyon "fazladan" işlemesin)
  const priceDates = funds.map((f) => f.native[f.native.length - 1]?.[0]).filter(Boolean).sort();
  const asOf = priceDates.length ? (priceDates[priceDates.length - 1] < today ? priceDates[priceDates.length - 1] : today) : today;
  C = { today, asOf, funds, pmap, usd, benches, hist, last, prev, states, usdNow: valueAt(usd, today), cpiEst: cpiDaily(series(M, S.manual, 'TUFE')).estimatedAfter };

  // Günlük kayıt: her açılışta bugünün özetini sakla
  if (last && last.value > 0) {
    const prices = {};
    for (const { f, s } of states) prices[f.code] = s.price;
    S.snapshots[today] = { value: last.value, cost: last.cost, gross: last.gross, net: last.net, usd: last.usd, prices };
    persist();
  }
}

function startDate() {
  const d = S.funds.flatMap((f) => (f.txs || []).map((t) => t.date)).sort();
  return d[0] || C.today;
}

// ---------- Kabuk ----------
const $ = (sel, root = document) => root.querySelector(sel);
const main = () => $('#view');

function render() {
  compute();
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  updateStatus();
  const v = { ozet, fonlar, kiyas, senaryo, diger }[tab];
  main().innerHTML = '';
  v(main());
  main().scrollTop = 0;
}

const hhmm = (d) => d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
function backupText() {
  const c = backup.loadCfg();
  if (!c) return 'Yedek kapalı';
  if (c.error) return 'Yedek hatası ⚠︎';
  if (!c.last) return 'Yedek bekliyor';
  const d = new Date(c.last);
  return `Yedek ✓ ${d.toDateString() === new Date().toDateString() ? hhmm(d) : d.toLocaleDateString('tr-TR')}`;
}
function updateStatus() {
  const upd = M.index?.guncelleme ? new Date(M.index.guncelleme) : null;
  $('#status').textContent = `${upd ? `Veri: ${upd.toLocaleDateString('tr-TR')} ${hhmm(upd)}` : 'Piyasa verisi bekleniyor'} · ${backupText()}`;
}

function setTab(t) { tab = t; history.replaceState(null, '', '#' + t); render(); window.scrollTo(0, 0); }

const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content; };
function chips(name, opts, cur, onPick) {
  const wrap = document.createElement('div');
  wrap.className = 'chips';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', name);
  for (const [k, label] of opts) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.className = k === cur ? 'on' : '';
    b.setAttribute('aria-pressed', k === cur);
    b.onclick = () => onPick(k);
    wrap.appendChild(b);
  }
  return wrap;
}
const RANGES = [['1A', '1A'], ['3A', '3A'], ['6A', '6A'], ['YB', 'YB'], ['1Y', '1Y'], ['3Y', '3Y'], ['5Y', '5Y'], ['ALL', 'Tümü']];
const clip = (pts, key) => { if (key === 'ALL') return pts; const s = periodStart(key, C.today); return pts.filter((p) => p[0] >= s); };

// ---------- ÖZET ----------
function ozet(root) {
  if (!C.last) return root.append(h(emptyState()));
  const ccy = S.settings.ccy;
  const L = C.last, P = C.prev;
  const days = Math.max(1, daysBetween(startDate(), C.today));
  const netPct = L.cost > 0 ? L.net / L.cost : null;
  const grossPct = L.cost > 0 ? L.gross / L.cost : null;
  const usdPct = L.costUsd > 0 && L.valueUsd ? L.valueUsd / L.costUsd - 1 : null;
  const dayChg = P ? L.value - P.value : null;
  const dayPct = P && P.value ? L.value / P.value - 1 : null;
  const val = ccy === 'USD' ? L.valueUsd : L.value;

  const bc = backup.loadCfg();
  if (!bc || bc.error) {
    root.append(h(`<section class="card notice ${bc ? 'err' : ''}">
      <b>${bc ? 'Otomatik yedek alınamadı' : 'Verilerin yalnızca bu telefonda'}</b>
      <p class="small">${bc ? esc(bc.error) : 'Telefon değişir ya da veri silinirse portföy kaybolur. Şifreli otomatik yedeği bir kez kur, gerisi kendiliğinden olur.'}</p>
      <button class="btn small" id="bk">${bc ? 'Tekrar dene' : 'Otomatik yedeği kur'}</button></section>`));
    root.querySelector('#bk').onclick = async () => {
      if (!bc) return backupSetup();
      const r = await backup.backupNow(S, { force: true });
      if (r.error) alert(r.error);
      render();
    };
  }
  root.append(h(`
  <section class="hero card">
    <div class="row between"><span class="label">Portföy değeri</span>
      <div class="seg" role="group" aria-label="Para birimi"><button data-ccy="TRY" class="${ccy === 'TRY' ? 'on' : ''}">₺</button><button data-ccy="USD" class="${ccy === 'USD' ? 'on' : ''}">$</button></div></div>
    <div class="big">${money(val, ccy)}</div>
    <div class="muted small">Stopaj sonrası: ${ccy === 'USD' ? money((L.cost + L.net) / (L.usd || 1), 'USD') : money(L.cost + L.net)}</div>
    <div class="sub ${cls(dayChg)}">${arrow(dayChg)} ${signMoney(dayChg, 'TRY')} (${pct(dayPct)}) <span class="muted">${P ? 'son fiyat gününe göre' : ''}</span></div>
    <div class="kpis">
      <div><span class="label">Net kâr (stopaj sonrası)</span><b class="${cls(L.net)}">${signMoney(L.net, 'TRY')}</b><span class="${cls(netPct)}">${pct(netPct)}</span></div>
      <div><span class="label">Brüt kâr</span><b class="${cls(L.gross)}">${signMoney(L.gross, 'TRY')}</b><span class="${cls(grossPct)}">${pct(grossPct)}</span></div>
      <div><span class="label">Dolar bazında</span><b>${money(L.valueUsd, 'USD')}</b><span class="${cls(usdPct)}">${pct(usdPct)}</span></div>
      <div><span class="label">Maliyet</span><b>${money(L.cost, 'TRY')}</b><span class="muted">${days} gün</span></div>
      <div><span class="label">Günlük ort. (net)</span><b class="${cls(netPct)}">${pct(dailyRate(netPct, days), 4)}</b><span class="muted">USD: ${pct(dailyRate(usdPct, days), 4)}</span></div>
      <div><span class="label">Yıllık karşılığı (net)</span><b class="${cls(netPct)}">${pct(annualize(netPct, days), 1)}</b><span class="muted">USD kuru ${num(C.usdNow ?? L.usd, 4)}</span></div>
      ${(() => {
        const infVal = replicate(C.funds, C.benches.TUFE, C.asOf);
        if (!infVal) return '';
        const infl = infVal / L.cost - 1, real = (L.cost + L.net) / infVal - 1;
        const est = C.cpiEst && C.cpiEst < C.today;
        return `<div class="wide"><span class="label">Enflasyona göre gerçek getiri (net)</span><b class="${cls(real)}">${pct(real)}</b><span class="muted">Aynı dönemde enflasyon ${pct(infl)}${est ? ` · ${dTR(C.cpiEst).slice(3)} sonrası tahmini` : ''}. ${real >= 0 ? 'Paran alım gücü kazandı.' : 'Paran alım gücü kaybetti.'}</span></div>`;
      })()}
    </div>
  </section>
  ${wealthCard(ccy)}
  <section class="card"><div class="row between"><h2>Değer gelişimi</h2></div><div id="rng"></div><div id="ch1" class="chart"></div><div id="lg1"></div></section>
  <section class="card"><h2>Yatırımlar</h2><div id="hold"></div></section>
  <section class="card"><div class="row between"><h2>Günlük kayıt</h2><span class="muted small">Her gün otomatik</span></div><div id="hist"></div></section>
  `));
  root.querySelectorAll('[data-ccy]').forEach((b) => (b.onclick = () => { S.settings.ccy = b.dataset.ccy; persist(); render(); }));
  root.querySelector('#rng').append(chips('Dönem', RANGES.filter(([k]) => ['1A', '3A', '6A', '1Y', 'ALL'].includes(k)), ui.ozetRange, (k) => { ui.ozetRange = k; render(); }));

  const pick = (r) => (ccy === 'USD' ? r.valueUsd : r.value);
  const pickCost = (r) => (ccy === 'USD' ? r.costUsd : r.cost);
  const ser = [
    { name: 'Değer', color: COLORS.PORT, area: true, points: clip(C.hist.map((r) => [r.date, pick(r)]).filter((p) => p[1] != null), ui.ozetRange) },
    { name: 'Maliyet', color: COLORS.COST, dashed: true, points: clip(C.hist.map((r) => [r.date, pickCost(r)]).filter((p) => p[1] != null), ui.ozetRange) },
  ];
  requestAnimationFrame(() => lineChart(root.querySelector('#ch1'), ser, { fmtY: compact, fmtTip: (v) => money(v, ccy) }));
  root.querySelector('#lg1').innerHTML = legend(ser);

  // Fon kartları
  const hold = root.querySelector('#hold');
  for (const { f, s } of C.states) {
    if (s.qty <= 0 && !s.realized) continue;
    const pts = f.native;
    const p = pts[pts.length - 1], q = pts[pts.length - 2];
    const dch = p && q ? p[1] / q[1] - 1 : null;
    const stale = !p || daysBetween(p[0], C.today) > 4;
    const gp = s.cost > 0 ? s.gross / s.cost : null;
    const card = h(`<button class="hold" data-code="${esc(f.code)}">
      <div class="row between"><b class="code">${esc(f.code)}</b><span class="${cls(dch)}">${pct(dch)}</span></div>
      <div class="name">${esc(fundName(f.code))}</div>
      <div class="grid3">
        <div><span class="label">Fiyat</span>${fmtPrice(p?.[1], f.code)}${stale ? ' <span class="warn" title="Fiyat güncel değil">⚠︎</span>' : ''}<span class="muted small">${p ? dTR(p[0]) : 'veri yok'}</span></div>
        <div><span class="label">Değer</span>${money(s.value)}<span class="muted small">${num(s.qty, 0)} adet</span></div>
        <div><span class="label">Kâr (net)</span><span class="${cls(s.net)}">${signMoney(s.net)}</span><span class="${cls(gp)} small">${pct(gp)} brüt</span></div>
      </div></button>`);
    hold.append(card);
  }
  hold.querySelectorAll('.hold').forEach((b) => (b.onclick = () => fundDetail(b.dataset.code)));

  // Günlük kayıt tablosu
  const rows = C.hist.slice().reverse();
  const shown = ui.histAll ? rows : rows.slice(0, 30);
  const tbl = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tarih</th><th>Değer ₺</th><th>Fark ₺</th><th>Gün %</th><th>Net kâr</th><th>Kâr %</th><th>USD kuru</th><th>Değer $</th><th>$ getiri</th></tr></thead><tbody>
    ${shown.map((r, i) => {
      const pr = rows[rows.indexOf(r) + 1];
      const diff = pr ? r.value - pr.value : null;
      const dp = pr && pr.value ? r.value / pr.value - 1 : null;
      const up = r.costUsd > 0 && r.valueUsd ? r.valueUsd / r.costUsd - 1 : null;
      return `<tr><td>${dTR(r.date)}</td><td>${num(r.value)}</td><td class="${cls(diff)}">${diff == null ? '—' : num(diff)}</td><td class="${cls(dp)}">${pct(dp)}</td><td class="${cls(r.net)}">${num(r.net)}</td><td class="${cls(r.net)}">${pct(r.cost ? r.net / r.cost : null)}</td><td>${num(r.usd, 4)}</td><td>${num(r.valueUsd)}</td><td class="${cls(up)}">${pct(up)}</td></tr>`;
    }).join('')}</tbody></table></div>
    ${rows.length > 30 && !ui.histAll ? `<button class="btn ghost full" id="more">Tümünü göster (${rows.length} gün)</button>` : ''}`;
  root.querySelector('#hist').innerHTML = tbl;
  const more = root.querySelector('#more');
  if (more) more.onclick = () => { ui.histAll = true; render(); };
}

function emptyState() {
  return `<section class="card empty">
    <h2>Portföyünü ekle</h2>
    <p>Fon kodunu (ör. TGT), alış tarihini, adedi ve birim maliyetini gir. Fiyatlar her gün otomatik çekilir; değerler gün gün kaydedilir.</p>
    <button class="btn" onclick="window.__app.addFund()">Fon ekle</button>
    <button class="btn ghost" onclick="window.__app.backupRestore()">GitHub yedeğinden geri yükle</button>
    <button class="btn ghost" onclick="window.__app.importFile()">Dosyadan içe aktar</button>
  </section>`;
}

// ---------- TOPLAM SERVET ----------
// Sabit sıra ve renk: kategori hangi sırada olursa olsun rengi değişmez
const WEALTH_CATS = [
  ['Fonlar', 'var(--s1)'], ['BIST hisse', 'var(--s3)'], ['Yabancı hisse / ETF', 'var(--s7)'],
  ['Gayrimenkul', 'var(--s2)'], ['Arsa', 'var(--s4)'], ['Araç', 'var(--s9)'], ['BES', 'var(--s6)'], ['Nakit', 'var(--s10)'], ['Diğer', 'var(--s11)'],
];
function wealthParts() {
  const parts = Object.fromEntries(WEALTH_CATS.map(([k]) => [k, 0]));
  for (const { f, s } of C.states) {
    const kind = assetKind(f.code);
    const cat = kind === 'fon' ? 'Fonlar' : f.ccy === 'TRY' ? 'BIST hisse' : 'Yabancı hisse / ETF';
    parts[cat] += s.value;
  }
  const vals = S.others.vals.slice().sort((a, b) => a.date.localeCompare(b.date));
  const last = vals[vals.length - 1];
  if (last) for (const a of S.others.assets) {
    const v = Number(last.values[a.id]) || 0;
    parts[CATS.includes(a.cat) ? a.cat : 'Diğer'] += v;
  }
  return { parts, last };
}
function wealthCard(ccy) {
  const { parts, last } = wealthParts();
  if (!last) return '';
  const inv = C.states.reduce((a, x) => a + x.s.value, 0);
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  if (!(total > 0)) return '';
  const k = ccy === 'USD' ? C.usdNow || C.last?.usd || 1 : 1;
  const rows = WEALTH_CATS.filter(([cat]) => parts[cat] > 0);
  const nakit = parts.Nakit, cost = C.last?.cost || 0;
  const dup = nakit > 0 && cost > 0 && Math.abs(nakit - cost) / cost < 0.05;
  return `<section class="card"><div class="row between"><h2>Toplam servet</h2><span class="muted small">${ccy === 'USD' ? 'bugünkü kurla' : ''}</span></div>
    <div class="big">${money(total / k, ccy, 0)}</div>
    <div class="sub muted">Yatırımlar ${money(inv / k, ccy, 0)} (canlı) + diğer varlıklar ${money((total - inv) / k, ccy, 0)} (${dTR(last.date)} değerlemesi)</div>
    <div class="stack" role="img" aria-label="Varlık dağılımı">${rows.map(([cat, col]) => `<span style="flex:${parts[cat]};background:${col}" title="${cat} %${num((parts[cat] / total) * 100, 1)}"></span>`).join('')}</div>
    <div class="dist">${rows.map(([cat, col]) => `<div class="dist-row"><span class="sw" style="background:${col}"></span><span>${cat}</span><b>${money(parts[cat] / k, ccy, 0)}</b><span class="muted">%${num((parts[cat] / total) * 100, 1)}</span></div>`).join('')}</div>
    ${dup ? `<p class="small warn">⚠︎ Diğer varlıklardaki "Nakit" (${money(nakit, 'TRY', 0)}) fonlarının maliyetiyle neredeyse aynı. Aynı para iki kez sayılıyor olabilir; fonlara geçtiysen düzelt.</p><button class="btn small" onclick="window.__app.fixCash()">Çift sayımı düzelt</button>` : ''}
  </section>`;
}

// ---------- FONLAR ----------
function fonlar(root) {
  root.append(h(`<section class="card"><div class="row between"><h2>Yatırımlarım</h2><button class="btn small" id="add">+ Fon / hisse</button></div><div id="list"></div></section>`));
  root.querySelector('#add').onclick = () => addFund();
  const list = root.querySelector('#list');
  if (!S.funds.length) list.innerHTML = '<p class="muted">Henüz yatırım yok.</p>';
  for (const { f, s, pts } of C.states) {
    const last = f.native[f.native.length - 1];
    const r1 = periodReturn(pts, periodStart('1Y', C.today), C.today);
    const ra = periodReturn(pts, periodStart('1A', C.today), C.today);
    list.append(h(`<button class="hold" data-code="${esc(f.code)}">
      <div class="row between"><b class="code">${esc(f.code)} <span class="tag">${KIND_LABEL[assetKind(f.code)] || 'Fon'}${f.ccy !== 'TRY' ? ' · ' + f.ccy : ''}</span></b><span class="muted small">${last ? dTR(last[0]) : 'veri yok'}</span></div>
      <div class="name">${esc(fundName(f.code))}</div>
      <div class="grid3">
        <div><span class="label">Fiyat</span>${fmtPrice(last?.[1], f.code)}</div>
        <div><span class="label">1 ay</span><span class="${cls(ra)}">${pct(ra)}</span></div>
        <div><span class="label">1 yıl</span><span class="${cls(r1)}">${pct(r1)}</span></div>
      </div>
      <div class="grid3">
        <div><span class="label">Adet</span>${num(s.qty, 0)}</div>
        <div><span class="label">Ort. maliyet (₺)</span>${num(s.avg, isListed(f.code) ? 2 : 6)}</div>
        <div><span class="label">Net kâr</span><span class="${cls(s.net)}">${signMoney(s.net)}</span></div>
      </div></button>`));
  }
  list.querySelectorAll('.hold').forEach((b) => (b.onclick = () => fundDetail(b.dataset.code)));
}

function fundDetail(code) {
  const f = S.funds.find((x) => x.code === code);
  const fc = C.funds.find((x) => x.code === code);
  const pts = C.pmap[code];
  const s = fundState(fc, pts, C.today, S.settings.tax);
  const rate = fc.tax;
  const nat = fc.native[fc.native.length - 1];
  const body = h(`
    <div class="name">${esc(fundName(code))}</div>
    <div class="kpis">
      <div><span class="label">Fiyat</span><b>${fmtPrice(nat?.[1], code)}</b><span class="muted small">${nat ? dTR(nat[0]) : 'veri yok'}${fc.ccy !== 'TRY' ? ` · ₺${num(s.price, 2)}` : ''}</span></div>
      <div><span class="label">Değer</span><b>${money(s.value)}</b><span class="muted small">${num(s.qty, 0)} adet</span></div>
      <div><span class="label">Maliyet</span><b>${money(s.cost)}</b><span class="muted small">ort. ₺${num(s.avg, isListed(code) ? 2 : 6)}</span></div>
      <div><span class="label">Brüt / Net kâr</span><b class="${cls(s.gross)}">${signMoney(s.gross)}</b><span class="${cls(s.net)} small">net ${signMoney(s.net)} · stopaj %${num(rate * 100, 1)}</span></div>
    </div>
    ${!M.meta?.[code] ? `<div class="card notice"><b>${pending.has(code) ? 'Takibe alınıyor…' : 'Otomatik fiyat yok'}</b><p class="small">${pending.has(code) ? 'Fiyat geçmişi birkaç dakika içinde gelecek.' : 'Bu kodun fiyatı her gün otomatik çekilmiyor.'}</p>${pending.has(code) ? '' : '<div class="row gap wrap"><button class="btn small" data-a="track" data-k="fon">Fon olarak takibe al</button><button class="btn small ghost" data-a="track" data-k="hisse">Hisse / ETF olarak takibe al</button></div>'}</div>` : ''}
    <div class="row gap wrap"><button class="btn small" data-a="tx">+ Alış/Satış</button><button class="btn small ghost" data-a="price">Fiyat gir</button><button class="btn small ghost" data-a="tax">Stopaj</button></div>
    <h3>Fiyat ve kıyas (₺, 100'e endeksli)</h3><div id="frng"></div><div id="fch" class="chart"></div><div id="flg"></div>
    <h3>Dönemsel getiri (₺)</h3><div id="fret"></div>
    <h3>İşlemler</h3><div id="ftx"></div>
    <button class="btn danger ghost full" data-a="del">Fonu sil</button>`);
  const dlg = sheet(`${code}`, body);
  const draw = () => {
    const rng = dlg.querySelector('#frng');
    rng.innerHTML = '';
    rng.append(chips('Dönem', RANGES, ui.fundRange, (k) => { ui.fundRange = k; draw(); }));
    const fp = clip(pts, ui.fundRange);
    const from = fp[0]?.[0];
    const idx = (p) => { if (!p?.length || !from) return []; const b = valueAtOrFirst(p, from); return p.filter((x) => x[0] >= from).map(([d, v]) => [d, (v / b) * 100]); };
    const ser = [{ name: code, color: COLORS.PORT, points: idx(fp) }];
    for (const id of S.settings.compare.slice(0, 3)) ser.push({ name: benchName(id), color: COLORS[id], points: idx(C.benches[id]) });
    lineChart(dlg.querySelector('#fch'), ser, { fmtY: (v) => num(v, 0), fmtTip: (v) => num(v, 2), baseline: 100 });
    dlg.querySelector('#flg').innerHTML = legend(ser);
  };
  requestAnimationFrame(draw);
  dlg.querySelector('#fret').innerHTML = returnsTable([[code, pts], ...['USD', 'ALTIN', 'XU100', 'SPX'].map((id) => [benchName(id), C.benches[id]])], 'TRY');
  const txs = sortTx(f.txs || []).reverse();
  dlg.querySelector('#ftx').innerHTML = txs.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tarih</th><th>İşlem</th><th>Adet</th><th>Fiyat</th><th>Tutar</th><th></th></tr></thead><tbody>${txs.map((t) => `<tr><td>${dTR(t.date)}</td><td>${t.type === 'sell' ? 'Satış' : 'Alış'}</td><td>${num(t.qty, 0)}</td><td>${fmtPrice(t.price, code)}${t.autoPrice ? ' <span class="tag">tahmini</span>' : ''}</td><td>${(fc.ccy === 'TRY' ? '' : CCY_SIGN[fc.ccy] || '') + num(t.qty * t.price)}</td><td><button class="link" data-del="${t.id}" aria-label="İşlemi sil">Sil</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">İşlem yok</p>';
  dlg.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => {
    if (!confirm('Bu işlem silinsin mi?')) return;
    f.txs = f.txs.filter((t) => t.id !== b.dataset.del); persist(); dlg.close(); render(); fundDetail(code);
  }));
  dlg.querySelector('[data-a=tx]').onclick = () => { dlg.close(); addFund(code); };
  dlg.querySelector('[data-a=price]').onclick = () => { dlg.close(); manualPrice(code, `Birim fiyat (${fc.ccy === 'TRY' ? 'TL' : fc.ccy})`); };
  dlg.querySelector('[data-a=tax]').onclick = () => {
    const v = prompt('Bu fon için stopaj oranı (%). Hisse yoğun fonlarda 0 olabilir.', num(rate * 100, 1));
    if (v == null) return;
    const n = parseNum(v);
    if (Number.isFinite(n)) { f.tax = n / 100; persist(); dlg.close(); render(); fundDetail(code); }
  };
  dlg.querySelectorAll('[data-a=track]').forEach((b) => (b.onclick = () => { dlg.close(); startTracking(code, b.dataset.k); }));
  dlg.querySelector('[data-a=del]').onclick = () => {
    if (!confirm(`${code} ve tüm işlemleri silinsin mi?`)) return;
    S.funds = S.funds.filter((x) => x.code !== code); persist(); dlg.close(); render();
  };
}

function returnsTable(rows, ccy) {
  const keys = [['1A', '1A'], ['3A', '3A'], ['6A', '6A'], ['YB', 'YB'], ['1Y', '1Y'], ['3Y', '3Y'], ['5Y', '5Y'], ['ALL', 'Tümü']];
  const conv = (pts) => (ccy === 'USD' ? combine(pts, C.usd, (a, b) => a / b) : pts);
  return `<div class="tbl-wrap"><table class="tbl ret"><thead><tr><th>Varlık</th>${keys.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(([name, pts0]) => {
      const pts = conv(pts0 || []);
      return `<tr><td>${esc(name)}</td>${keys.map(([k]) => {
        const r = k === 'ALL' ? (pts.length > 1 ? pts[pts.length - 1][1] / pts[0][1] - 1 : null) : periodReturn(pts, periodStart(k, C.today), C.today);
        return `<td class="${cls(r)}">${pct(r, 1)}</td>`;
      }).join('')}</tr>`;
    }).join('')}</tbody></table></div><p class="muted small">"Tümü": verinin başladığı günden bu yana. Fonlarda TEFAS geçmişi, kıyaslarda son ${'10'} yıl.</p>`;
}

// ---------- KIYAS ----------
function kiyas(root) {
  if (!C.last) return root.append(h(emptyState()));
  const ccy = ui.cmpCcy || S.settings.ccy;
  const net = ui.cmpNet ?? true;
  const L = C.last;
  const start = startDate();
  const days = daysBetween(start, C.asOf);
  const conv = (v, d) => (ccy === 'USD' ? (v == null ? null : v / valueAtOrFirst(C.usd, d)) : v);
  const portVal = conv(net ? L.cost + L.net : L.value, C.asOf);
  const invested = ccy === 'USD' ? L.costUsd : L.cost;
  const portRet = invested ? portVal / invested - 1 : null;

  const all = BENCHES.map((b) => {
    const v = conv(replicate(C.funds, C.benches[b.id], C.asOf), C.asOf);
    const pts = C.benches[b.id] || [];
    return { id: b.id, name: benchName(b.id), v, ret: v != null && invested ? v / invested - 1 : null, last: pts[pts.length - 1]?.[0] };
  });
  const rows = all.filter((r) => r.ret != null).sort((a, b) => b.ret - a.ret);
  const missing = all.filter((r) => r.ret == null);
  const beat = rows.filter((r) => portRet >= r.ret).length;
  const maxAbs = Math.max(Math.abs(portRet || 0), ...rows.map((r) => Math.abs(r.ret)), 0.0001);
  const bar = (r) => {
    const w = (Math.abs(r) / maxAbs) * 50;
    return `<span class="bar"><span class="${r >= 0 ? 'pos' : 'neg'}" style="width:${w.toFixed(1)}%;${r >= 0 ? 'left:50%' : `left:${(50 - w).toFixed(1)}%`}"></span><span class="mark" style="left:${(50 + (portRet / maxAbs) * 50).toFixed(1)}%"></span></span>`;
  };

  root.append(h(`
    <section class="card">
      <div class="row between wrap"><h2>${dTR(start)} – ${dTR(C.asOf)}</h2>
        <div class="row gap">
          <div class="seg" role="group" aria-label="Kâr türü"><button data-n="1" class="${net ? 'on' : ''}">Net</button><button data-n="0" class="${net ? '' : 'on'}">Brüt</button></div>
          <div class="seg" role="group" aria-label="Para birimi"><button data-c="TRY" class="${ccy === 'TRY' ? 'on' : ''}">₺</button><button data-c="USD" class="${ccy === 'USD' ? 'on' : ''}">$</button></div>
        </div></div>
      <div class="verdict">
        <div><span class="label">Portföyün (${net ? 'stopaj sonrası' : 'brüt'}, ${ccy === 'USD' ? 'dolar' : 'TL'} bazında)</span>
          <div class="big ${cls(portRet)}">${pct(portRet)}</div>
          <div class="sub ${cls(portVal - invested)}">${signMoney(portVal - invested, ccy, 0)} · ${days} gün</div></div>
        ${rows.length ? `<div class="score"><b>${beat}/${rows.length}</b><span>piyasayı<br>geçiyorsun</span></div>` : ''}
      </div>
      ${rows.length ? `<div class="karne" role="table" aria-label="Piyasalara göre karşılaştırma">
        <div class="k-row k-head" role="row"><span>Piyasa</span><span>Getirisi</span><span>Sen</span></div>
        ${rows.map((r) => {
          const d = portRet - r.ret;
          const ahead = d >= 0;
          const tl = portVal - r.v;
          return `<div class="k-row" role="row">
            <span class="k-name"><span class="sw" style="background:${COLORS[r.id]}"></span>${esc(r.name)}</span>
            <span class="${cls(r.ret)}">${pct(r.ret)}</span>
            <span class="k-res ${ahead ? 'up' : 'down'}"><b>${ahead ? '✓ Önde' : '✗ Geride'}</b><small>${num(Math.abs(d) * 100, 2)} puan · ${money(Math.abs(tl), ccy, 0)}</small></span>
            ${bar(r.ret)}
          </div>`;
        }).join('')}
      </div>
      <p class="muted small">Her alışın tutarı aynı gün o piyasaya yatırılmış gibi hesaplanır. Çubuktaki dikey çizgi senin getirin. Yabancı borsalar TL'ye çevrilmiş haliyle (kur etkisi dahil) karşılaştırılır.${C.cpiEst && C.cpiEst < C.today ? ` Enflasyonun ${dTR(C.cpiEst).slice(3)} sonrası, son 3 ayın ortalamasıyla tahmin edilir.` : ''}${net ? ' Portföyün stopaj sonrası, kıyaslar vergisiz alınmıştır.' : ''}</p>` : '<p>Kıyas verisi henüz yok. Veriler her gün otomatik çekilir; ilk çekimden sonra burada görünür.</p>'}
      ${missing.length ? `<p class="muted small">Verisi olmayan: ${missing.map((r) => esc(r.name)).join(', ')}</p>` : ''}
    </section>
    <section class="card"><h2>Zaman içinde karşılaştırma</h2><p class="muted small">Grafikte en çok 3 kıyas gösterilir</p><div id="pick"></div><div id="ch2" class="chart"></div><div id="lg2"></div></section>
    <section class="card"><div class="row between"><h2>Tüm zamanlar: dönemsel getiriler</h2></div><div id="per"></div></section>
    <section class="card"><h2>Uzun vadeli seyir (100'e endeksli)</h2><div id="rng3"></div><div id="ch3" class="chart"></div><div id="lg3"></div></section>`));

  root.querySelectorAll('[data-n]').forEach((b) => (b.onclick = () => { ui.cmpNet = b.dataset.n === '1'; render(); }));
  root.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => { ui.cmpCcy = b.dataset.c; render(); }));
  // Kıyas seçimi
  const pick = root.querySelector('#pick');
  const sel = S.settings.compare;
  const wrap = document.createElement('div'); wrap.className = 'chips';
  for (const b of BENCHES) {
    const on = sel.includes(b.id);
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = on ? 'on' : ''; btn.setAttribute('aria-pressed', on);
    btn.innerHTML = `<span class="sw" style="background:${COLORS[b.id]}"></span>${esc(benchName(b.id))}`;
    btn.onclick = () => {
      if (on) S.settings.compare = sel.filter((x) => x !== b.id);
      else S.settings.compare = [...sel, b.id].slice(-3);
      persist(); render();
    };
    wrap.appendChild(btn);
  }
  pick.appendChild(wrap);

  const dates = C.hist.map((r) => r.date);
  const ser = [{ name: 'Portföyüm', color: COLORS.PORT, points: C.hist.map((r) => [r.date, conv(net ? r.cost + r.net : r.value, r.date)]) }];
  for (const id of S.settings.compare) ser.push({ name: benchName(id), color: COLORS[id], points: dates.map((d) => [d, conv(replicate(C.funds, C.benches[id], d), d)]).filter((p) => p[1] != null) });
  ser.push({ name: 'Yatırılan', color: COLORS.COST, dashed: true, points: C.hist.map((r) => [r.date, ccy === 'USD' ? r.costUsd : r.cost]) });
  requestAnimationFrame(() => lineChart(root.querySelector('#ch2'), ser, { fmtY: compact, fmtTip: (v) => money(v, ccy) }));
  root.querySelector('#lg2').innerHTML = legend(ser);

  // Dönemsel getiriler
  const per = root.querySelector('#per');
  const rowsR = [...S.funds.map((f) => [f.code, C.pmap[f.code]]), ...BENCHES.map((b) => [benchName(b.id), C.benches[b.id]])];
  per.innerHTML = `<p class="muted small">${ccy === 'USD' ? 'Dolar bazında' : 'TL bazında'} getiri. Para birimini yukarıdan değiştirebilirsin.</p>` + returnsTable(rowsR, ccy);

  const rng = root.querySelector('#rng3');
  rng.append(chips('Dönem', RANGES.slice(3), ui.cmpRange, (k) => { ui.cmpRange = k; render(); }));
  const from = periodStart(ui.cmpRange, C.today);
  const idx = (p0) => {
    const p = (ccy === 'USD' ? combine(p0, C.usd, (a, b) => a / b) : p0).filter((x) => x[0] >= from);
    if (p.length < 2) return [];
    const b = p[0][1];
    return p.map(([d, v]) => [d, (v / b) * 100]);
  };
  const ser3 = [
    ...S.funds.slice(0, 2).map((f, i) => ({ name: f.code, color: FUND_COLORS[i], points: idx(C.pmap[f.code]) })),
    ...S.settings.compare.slice(0, 2).map((id) => ({ name: benchName(id), color: COLORS[id], points: idx(C.benches[id]) })),
  ];
  requestAnimationFrame(() => lineChart(root.querySelector('#ch3'), ser3, { fmtY: (v) => num(v, 0), fmtTip: (v) => num(v, 1), baseline: 100 }));
  root.querySelector('#lg3').innerHTML = legend(ser3) + '<p class="muted small">İlk iki fon ve seçtiğin ilk iki kıyas gösterilir.</p>';
}

// ---------- SENARYO ----------
function scenarioDefaults() {
  const days = Math.max(1, daysBetween(startDate(), C.today));
  const perFund = {};
  for (const { f, s, pts } of C.states) {
    const r1 = periodReturn(pts, periodStart('1Y', C.today), C.today);
    const since = s.cost > 0 ? annualize(s.gross / s.cost, days) : null;
    const r = r1 ?? since ?? 0.35;
    perFund[f.code] = Math.round(Math.max(-0.5, Math.min(2, r)) * 1000) / 1000;
  }
  const u = C.usdNow || C.last?.usd || 0;
  const inf1y = periodReturn(C.benches.TUFE, periodStart('1Y', C.today), C.today);
  return { months: 12, monthly: 0, spread: 0.15, perFund, usdEnd: Math.round(u * 1.2 * 100) / 100, target: null, inflation: inf1y != null ? Math.round(inf1y * 1000) / 1000 : 0.3 };
}

function senaryo(root) {
  if (!C.last) return root.append(h(emptyState()));
  const sc = { ...scenarioDefaults(), ...(S.scenario || {}) };
  sc.perFund = { ...scenarioDefaults().perFund, ...(S.scenario?.perFund || {}) };
  const L = C.last;
  const tot = C.states.reduce((a, x) => a + x.s.value, 0) || 1;
  const base = C.states.reduce((a, x) => a + (x.s.value / tot) * (sc.perFund[x.f.code] ?? 0), 0);
  const scen = [['Kötümser', base - sc.spread, 'var(--s2)'], ['Baz', base, 'var(--s1)'], ['İyimser', base + sc.spread, 'var(--s3)']];
  const usdNowVal = L.valueUsd;
  const res = scen.map(([n, a, c]) => ({ n, a, c, ...projectScenario({ start: L.value, annual: a, months: sc.months, monthly: sc.monthly, taxRate: S.settings.tax, costBase: L.cost }) }));
  const mt = sc.target ? monthsToTarget({ start: L.value, annual: base, monthly: sc.monthly, target: sc.target }) : null;

  root.append(h(`
  <section class="card">
    <h2>Kâr senaryoları</h2>
    <p class="muted small">Varsayılan yıllık getiriler fonların son 1 yıllık performansından (yoksa başlangıçtan bu yana yıllıklandırılmış getiriden) gelir. Değiştirebilirsin.</p>
    <form id="scf" class="form">
      <label>Süre (ay)<input name="months" inputmode="numeric" value="${sc.months}"></label>
      <label>Aylık ek yatırım (₺)<input name="monthly" inputmode="decimal" value="${num(sc.monthly, 0)}"></label>
      <label>Senaryo aralığı (± yıllık %)<input name="spread" inputmode="decimal" value="${num(sc.spread * 100, 1)}"></label>
      <label>Dönem sonu USD/TL<input name="usdEnd" inputmode="decimal" value="${num(sc.usdEnd, 2)}"></label>
      <label>Beklenen yıllık enflasyon (%)<input name="inflation" inputmode="decimal" value="${num(sc.inflation * 100, 1)}"></label>
      <label>Hedef değer (₺, isteğe bağlı)<input name="target" inputmode="decimal" value="${sc.target ? num(sc.target, 0) : ''}"></label>
      <fieldset><legend>Fon bazında beklenen yıllık getiri (%)</legend>
        ${C.states.map(({ f }) => `<label>${esc(f.code)}<input name="f_${esc(f.code)}" inputmode="decimal" value="${num((sc.perFund[f.code] ?? 0) * 100, 1)}"></label>`).join('')}
      </fieldset>
      <div class="row gap"><button class="btn" type="submit">Hesapla</button><button class="btn ghost" type="button" id="screset">Varsayılana dön</button></div>
    </form>
  </section>
  <section class="card">
    <h2>${sc.months} ay sonra</h2>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th></th>${res.map((r) => `<th><span class="sw" style="background:${r.c}"></span>${r.n}</th>`).join('')}</tr></thead><tbody>
      <tr><td>Yıllık getiri</td>${res.map((r) => `<td>${pct(r.a, 1)}</td>`).join('')}</tr>
      <tr><td>Değer ₺</td>${res.map((r) => `<td>${money(r.value, 'TRY', 0)}</td>`).join('')}</tr>
      <tr><td>Brüt kâr</td>${res.map((r) => `<td class="${cls(r.gross)}">${signMoney(r.gross, 'TRY', 0)}</td>`).join('')}</tr>
      <tr><td>Net kâr (stopaj)</td>${res.map((r) => `<td class="${cls(r.net)}">${signMoney(r.net, 'TRY', 0)}</td>`).join('')}</tr>
      <tr><td>Değer $ (kur ${num(sc.usdEnd, 2)})</td>${res.map((r) => `<td>${money(r.value / sc.usdEnd, 'USD', 0)}</td>`).join('')}</tr>
      <tr><td>Bugünün parasıyla değer</td>${res.map((r) => `<td>${money(r.value / Math.pow(1 + sc.inflation, sc.months / 12), 'TRY', 0)}</td>`).join('')}</tr>
      <tr><td>Enflasyona göre getiri</td>${res.map((r) => { const g = (L.value + sc.monthly * sc.months) ? (r.value / Math.pow(1 + sc.inflation, sc.months / 12)) / (L.value + sc.monthly * sc.months) - 1 : null; return `<td class="${cls(g)}">${pct(g, 1)}</td>`; }).join('')}</tr>
      <tr><td>Dolar bazında getiri</td>${res.map((r) => { const g = usdNowVal ? (r.value - sc.monthly * sc.months) / sc.usdEnd / usdNowVal - 1 : null; return `<td class="${cls(g)}">${pct(g, 1)}</td>`; }).join('')}</tr>
    </tbody></table></div>
    ${sc.target ? `<p>Baz senaryoda <b>${money(sc.target, 'TRY', 0)}</b> hedefine ${mt == null ? '50 yılda ulaşılamıyor' : mt === 0 ? 'zaten ulaşıldı' : `<b>${mt} ay</b> sonra (${dTR(addDays(C.today, Math.round(mt * 30.44)))}) ulaşılır`}.</p>` : ''}
    <div id="ch4" class="chart"></div><div id="lg4"></div>
    <p class="muted small">Dolar bazında getiri, ek yatırımlar düşülerek hesaplanır. Stopaj yalnızca kâra uygulanır (%${num(S.settings.tax * 100, 1)}).</p>
  </section>`));

  const form = root.querySelector('#scf');
  form.onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const perFund = {};
    for (const { f } of C.states) { const v = parseNum(fd.get('f_' + f.code)); if (Number.isFinite(v)) perFund[f.code] = v / 100; }
    const t = parseNum(fd.get('target'));
    S.scenario = {
      months: Math.max(1, Math.min(360, Math.round(parseNum(fd.get('months')) || 12))),
      monthly: parseNum(fd.get('monthly')) || 0,
      spread: (parseNum(fd.get('spread')) || 0) / 100,
      usdEnd: parseNum(fd.get('usdEnd')) || sc.usdEnd,
      inflation: Number.isFinite(parseNum(fd.get('inflation'))) ? parseNum(fd.get('inflation')) / 100 : sc.inflation,
      target: Number.isFinite(t) && t > 0 ? t : null,
      perFund,
    };
    persist(); render();
  };
  root.querySelector('#screset').onclick = () => { S.scenario = null; persist(); render(); };
  const toDate = (i) => addDays(C.today, Math.round(i * 30.44));
  const ser = res.map((r) => ({ name: r.n, color: r.c, points: r.path.map(([i, v]) => [toDate(i), v]) }));
  requestAnimationFrame(() => lineChart(root.querySelector('#ch4'), ser, { fmtY: compact, fmtTip: (v) => money(v, 'TRY', 0) }));
  root.querySelector('#lg4').innerHTML = legend(ser);
}

// ---------- DİĞER VARLIKLAR ----------
const CATS = ['Gayrimenkul', 'Arsa', 'Araç', 'BES', 'Nakit', 'Diğer'];
function diger(root) {
  const O = S.others;
  const vals = O.vals.slice().sort((a, b) => a.date.localeCompare(b.date));
  const total = (v) => O.assets.reduce((a, x) => a + (Number(v.values[x.id]) || 0), 0);
  const usdOf = (v) => v.usd || valueAtOrFirst(C.usd, v.date);
  const cur = vals.find((v) => v.date === ui.otherDate) || vals[vals.length - 1];
  const prevV = cur ? vals[vals.indexOf(cur) - 1] : null;
  const ccy = ui.otherCcy;

  root.append(h(`
  <section class="card">
    <div class="row between"><h2>Diğer varlıklar</h2><div class="seg" role="group" aria-label="Para birimi"><button data-oc="TRY" class="${ccy === 'TRY' ? 'on' : ''}">₺</button><button data-oc="USD" class="${ccy === 'USD' ? 'on' : ''}">$</button></div></div>
    <p class="muted small">Gayrimenkul, arsa, araç, BES ve nakit. Fon portföyünden ayrı tutulur; değerlemeleri tarih tarih girersin.</p>
    ${cur ? `<div class="big">${money(ccy === 'USD' ? total(cur) / usdOf(cur) : total(cur), ccy, 0)}</div>
    <div class="sub">${dTR(cur.date)} değerlemesi · USD kuru ${num(usdOf(cur), 4)}</div>
    ${prevV ? (() => { const a = total(cur), b = total(prevV), au = a / usdOf(cur), bu = b / usdOf(prevV); return `<div class="sub ${cls(a - b)}">${arrow(a - b)} ${signMoney(a - b, 'TRY', 0)} (${pct(a / b - 1)}) · $ bazında ${pct(au / bu - 1)} <span class="muted">${dTR(prevV.date)}'e göre</span></div>`; })() : ''}` : '<p>Henüz değerleme yok.</p>'}
    <div class="row gap wrap"><button class="btn small" id="newval">+ Yeni değerleme</button><button class="btn small ghost" id="addas">+ Varlık ekle</button>${cur ? '<button class="btn small ghost" id="editusd">Kuru düzenle</button><button class="btn small ghost danger" id="delval">Değerlemeyi sil</button>' : ''}</div>
  </section>
  ${vals.length ? `<section class="card"><h2>Değerleme tarihi</h2><div id="dsel"></div><div id="items"></div></section>
  <section class="card"><h2>Toplam varlık seyri</h2><div id="ch5" class="chart"></div></section>
  <section class="card"><h2>Tarihlere göre izlence</h2><div id="mat"></div></section>` : ''}`));

  root.querySelectorAll('[data-oc]').forEach((b) => (b.onclick = () => { ui.otherCcy = b.dataset.oc; render(); }));
  root.querySelector('#newval').onclick = () => {
    const d = prompt('Değerleme tarihi (GG.AA.YYYY)', dTR(C.today));
    if (!d) return;
    const iso = d.split('.').reverse().join('-');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return alert('Tarih biçimi GG.AA.YYYY olmalı');
    const base = vals[vals.length - 1];
    const ex = O.vals.find((v) => v.date === iso);
    if (!ex) O.vals.push({ date: iso, usd: valueAt(C.usd, iso) || base?.usd || null, values: { ...(base?.values || {}) } });
    ui.otherDate = iso; persist(); render();
  };
  root.querySelector('#addas').onclick = () => assetEdit(null, cur);
  if (cur) {
    root.querySelector('#editusd').onclick = () => {
      const v = prompt(`${dTR(cur.date)} için USD/TL kuru`, num(usdOf(cur), 4));
      const n = parseNum(v);
      if (v != null && n > 0) { cur.usd = n; persist(); render(); }
    };
    root.querySelector('#delval').onclick = () => {
      if (!confirm(`${dTR(cur.date)} değerlemesi silinsin mi?`)) return;
      O.vals = O.vals.filter((v) => v !== cur); ui.otherDate = null; persist(); render();
    };
  }
  if (!vals.length) return;

  root.querySelector('#dsel').append(chips('Tarih', vals.slice().reverse().map((v) => [v.date, dTR(v.date)]), cur.date, (k) => { ui.otherDate = k; render(); }));
  const items = root.querySelector('#items');
  const conv = (x, v) => (ccy === 'USD' ? x / usdOf(v) : x);
  for (const cat of CATS) {
    const list = O.assets.filter((a) => (a.cat || 'Diğer') === cat);
    if (!list.length) continue;
    items.append(h(`<h3>${cat}</h3>`));
    for (const a of list) {
      const v = cur.values[a.id], p = prevV?.values[a.id];
      const ch = v != null && p ? v / p - 1 : null;
      const row = h(`<button class="asset"><span>${esc(a.name)}</span><span class="r"><b>${v == null ? '—' : money(conv(v, cur), ccy, 0)}</b><span class="${cls(ch)} small">${ch == null ? (p == null ? 'yeni' : '') : pct(ch)}</span></span></button>`);
      row.firstElementChild.onclick = () => assetEdit(a, cur);
      items.append(row);
    }
  }
  items.append(h(`<div class="asset total"><span>Toplam</span><span class="r"><b>${money(conv(total(cur), cur), ccy, 0)}</b></span></div>`));

  const pts = vals.map((v) => [v.date, conv(total(v), v)]);
  requestAnimationFrame(() => lineChart(root.querySelector('#ch5'), [{ name: 'Toplam', color: COLORS.PORT, area: true, points: pts }], { fmtY: compact, fmtTip: (x) => money(x, ccy, 0) }));

  const usedAssets = O.assets.filter((a) => vals.some((v) => v.values[a.id] != null));
  root.querySelector('#mat').innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Varlık</th>${vals.map((v) => `<th>${dTR(v.date)}</th>`).join('')}</tr></thead><tbody>
    ${usedAssets.map((a) => `<tr><td>${esc(a.name)}</td>${vals.map((v) => `<td>${v.values[a.id] == null ? '—' : num(conv(v.values[a.id], v), 0)}</td>`).join('')}</tr>`).join('')}
    <tr class="me"><td>Toplam</td>${vals.map((v) => `<td>${num(conv(total(v), v), 0)}</td>`).join('')}</tr>
    <tr><td>USD kuru</td>${vals.map((v) => `<td>${num(usdOf(v), 4)}</td>`).join('')}</tr>
    <tr><td>Toplam $</td>${vals.map((v) => `<td>${num(total(v) / usdOf(v), 0)}</td>`).join('')}</tr>
  </tbody></table></div>`;
}

function assetEdit(asset, val) {
  const isNew = !asset;
  const a = asset || { id: store.uid(), name: '', cat: 'Gayrimenkul' };
  const body = h(`<form class="form" id="af">
    <label>Ad<input name="name" required value="${esc(a.name)}"></label>
    <label>Tür<select name="cat">${CATS.map((c) => `<option ${c === a.cat ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    ${val ? `<label>${dTR(val.date)} değeri (₺)<input name="value" inputmode="decimal" value="${val.values[a.id] != null ? num(val.values[a.id], 2) : ''}" placeholder="Boş bırakılırsa bu tarihte yok sayılır"></label>
    ${S.others.vals.some((x) => x.date > val.date) ? '<label class="check"><input type="checkbox" name="later" checked> Sonraki değerlemelere de uygula</label>' : ''}` : '<p class="muted small">Önce bir değerleme tarihi oluştur, sonra değer gir.</p>'}
    <div class="row gap"><button class="btn" type="submit">Kaydet</button>${isNew ? '' : '<button class="btn ghost danger" type="button" id="adel">Varlığı sil</button>'}</div></form>`);
  const dlg = sheet(isNew ? 'Varlık ekle' : a.name, body);
  dlg.querySelector('#af').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    a.name = fd.get('name').trim(); a.cat = fd.get('cat');
    if (isNew) S.others.assets.push(a);
    if (val) {
      const n = parseNum(fd.get('value'));
      if (Number.isFinite(n)) val.values[a.id] = n; else delete val.values[a.id];
      if (fd.get('later') === 'on') for (const x of S.others.vals) if (x.date > val.date && a.id in x.values) { if (Number.isFinite(n)) x.values[a.id] = n; else delete x.values[a.id]; }
    }
    persist(); dlg.close(); render();
  };
  const del = dlg.querySelector('#adel');
  if (del) del.onclick = () => {
    if (!confirm(`${a.name} tüm tarihlerden silinsin mi?`)) return;
    S.others.assets = S.others.assets.filter((x) => x.id !== a.id);
    for (const v of S.others.vals) delete v.values[a.id];
    persist(); dlg.close(); render();
  };
}

// ---------- Diyaloglar ----------
function sheet(title, content) {
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet';
  dlg.innerHTML = `<div class="sheet-head"><h2>${esc(title)}</h2><button class="icon" aria-label="Kapat" data-close>✕</button></div><div class="sheet-body"></div>`;
  dlg.querySelector('.sheet-body').append(content);
  document.body.append(dlg);
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.showModal();
  return dlg;
}

function addFund(code = '') {
  const body = h(`<form class="form" id="ff">
    <label>Fon ya da hisse kodu<input name="code" required autocapitalize="characters" value="${esc(code)}" placeholder="ör. TGT, THYAO, AAPL" ${code ? 'readonly' : ''}></label>
    <div class="seg full" role="group" aria-label="İşlem"><label><input type="radio" name="type" value="buy" checked> Alış</label><label><input type="radio" name="type" value="sell"> Satış</label></div>
    <label>Talimat tarihi<input name="date" type="date" required value="${C.today}" max="${C.today}"></label>
    <label class="check"><input type="checkbox" name="late"> Kesim saatinden sonra verildi (fon 16:00 sonrası → bir sonraki iş gününün fiyatı)</label>
    <p class="small muted" id="pdate"></p>
    <label>Adet (pay)<input name="qty" inputmode="decimal" required></label>
    <label id="kindRow" hidden>Tür<select name="kind"><option value="fon">Fon (TEFAS)</option><option value="hisse">Hisse / ETF (borsa)</option></select></label>
    <label>Para birimi<select name="pb"><option value="TRY">TL</option><option value="USD">ABD doları</option><option value="EUR">Euro</option></select></label>
    <label><span id="plbl">Birim fiyat (TL)</span><input name="price" inputmode="decimal" placeholder="ör. 0,124680"></label>
    <label class="check" id="autoRow" hidden><input type="checkbox" name="auto" checked> Fiyat henüz açıklanmadı: açıklanınca otomatik güncelle</label>
    <label>Komisyon (aynı para biriminde, isteğe bağlı)<input name="fee" inputmode="decimal"></label>
    <p class="muted small" id="hint"></p>
    <button class="btn full" type="submit">Kaydet</button></form>`);
  const dlg = sheet(code ? `${code} işlem` : 'Fon / hisse ekle', body);
  const form = dlg.querySelector('#ff');
  const hint = dlg.querySelector('#hint');
  const fill = () => {
    const c = form.code.value.trim().toUpperCase();
    const pts = series(M, S.manual, c);
    const known = M.meta?.[c]?.pb || S.funds.find((x) => x.code === c)?.pb;
    const hasData = !!M.raw[c]?.length && !!M.meta?.[c];
    const kindRow = dlg.querySelector('#kindRow');
    kindRow.hidden = !c || hasData;
    if (!hasData && !form.kind.dataset.touched) form.kind.value = guessKind(c, form.pb.value);
    if (known) { form.pb.value = known; form.pb.disabled = true; } else form.pb.disabled = false;
    dlg.querySelector('#plbl').textContent = `Birim fiyat (${form.pb.value === 'TRY' ? 'TL' : form.pb.value})`;
    const pd = priceDate();
    dlg.querySelector('#pdate').textContent = pd !== form.date.value ? `İşlem ${dTR(pd)} tarihli fiyattan gerçekleşir.` : '';
    const exact = pts.find((x) => x[0] === pd);
    dlg.querySelector('#autoRow').hidden = !!exact || !c;
    const p = exact ? exact[1] : pts?.length ? valueAt(pts, pd) ?? pts[pts.length - 1][1] : M.tefasSon?.[c]?.[1];
    const d = isListed(c) ? 2 : form.pb.value === 'TRY' ? 6 : 4;
    hint.textContent = p ? `${fundName(c)} — ${exact ? `${dTR(pd)} fiyatı` : `son bilinen fiyat (${dTR(pd)} fiyatı henüz yok)`}: ${num(p, d)}` : c ? 'Bu kod henüz takipte değil. Kaydedince otomatik takibe alınır; geçmiş fiyatlar birkaç dakika içinde gelir. O zamana kadar alış fiyatını sen gir.' : '';
    if (p && !form.price.value) form.price.value = num(p, d);
  };
  let timer;
  form.code.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => { const c = form.code.value.trim().toUpperCase(); if (c.length >= 3) await loadOne(M, c); fill(); }, 300);
  };
  const priceDate = () => (form.late.checked ? nextBusinessDay(form.date.value) : form.date.value);
  form.date.onchange = () => { form.price.value = ''; fill(); };
  form.late.onchange = () => { form.price.value = ''; fill(); };
  form.pb.onchange = fill;
  form.kind.onchange = () => { form.kind.dataset.touched = '1'; };
  if (code) fill(); else form.code.oninput();
  form.onsubmit = (e) => {
    e.preventDefault();
    const c = form.code.value.trim().toUpperCase();
    const qty = parseNum(form.qty.value), fee = parseNum(form.fee.value) || 0;
    let price = parseNum(form.price.value);
    const pd = priceDate();
    const exact = series(M, S.manual, c).find((x) => x[0] === pd);
    const auto = !exact && !dlg.querySelector('#autoRow').hidden && form.auto.checked;
    if (!(price > 0) && auto) price = valueAt(series(M, S.manual, c), pd) ?? NaN; // geçici tahmin
    if (!c || !(qty > 0) || !(price > 0)) return alert(auto ? 'Bu kod için henüz hiç fiyat yok; geçici bir fiyat gir, açıklanınca güncellenir.' : 'Kod, adet ve fiyat gerekli');
    let f = S.funds.find((x) => x.code === c);
    if (!f) { f = { code: c, txs: [] }; S.funds.push(f); }
    if (!M.meta?.[c]?.pb && form.pb.value !== 'TRY') f.pb = form.pb.value;
    f.txs.push({ id: store.uid(), date: pd, type: form.type.value, qty, price, fee, ...(auto ? { autoPrice: true } : {}), ...(pd !== form.date.value ? { order: form.date.value } : {}) });
    persist(); dlg.close(); render();
    if (!M.raw[c]?.length || !M.meta?.[c]) startTracking(c, form.kind.value);
  };
}

// 3 harfli TL kodlar çoğunlukla TEFAS fonudur; döviz cinsinden ya da daha uzun kodlar borsa (hisse/ETF)
const guessKind = (code, pb) => (pb === 'TRY' && code.length === 3 ? 'fon' : 'hisse');

function toast(msg, ms = 4500) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, ms);
}

const pending = new Set();
async function startTracking(code, kind) {
  const token = track.loadToken();
  if (!token) return trackTokenSheet(`${code} kodunu otomatik takibe almak için uygulamanın GitHub'daki takip listesine yazabilmesi gerekiyor. Bu bir kerelik bir ayar.`, () => startTracking(code, kind));
  try {
    const r = await track.track(token, code, kind);
    pending.add(code);
    toast(r === 'zaten' ? `${code} zaten takipte; veri birkaç dakika içinde gelecek.` : `${code} takibe alındı. Fiyat geçmişi birkaç dakika içinde gelecek.`, 6000);
    pollTracked(code);
  } catch (e) {
    if (e.code === 'auth' || e.code === 'perm') trackTokenSheet(`⚠︎ ${e.message}. Aşağıdaki adımlarla yeni bir anahtar oluştur.`, () => startTracking(code, kind));
    else toast(`⚠︎ ${code} takibe alınamadı: ${e.message}`, 8000);
  }
}

// Veri iş akışı ve yayın 2-5 dk sürer; bu sürede arada bir yeni seriyi kontrol et
function pollTracked(code, tries = 0) {
  if (tries > 20) { pending.delete(code); toast(`${code} için veri henüz gelmedi. Kod doğru mu? Ayarlar → Veri durumu'na bak.`, 8000); return; }
  setTimeout(async () => {
    delete M.raw[code];
    if (await loadOne(M, code) && M.meta?.[code]) { pending.delete(code); toast(`${code} verisi geldi ✓`); refresh(); }
    else pollTracked(code, tries + 1);
  }, (window.__trackDelay ?? (tries === 0 ? 90000 : 30000)));
}

const PAT_URL = 'https://github.com/settings/personal-access-tokens/new';
function trackTokenSheet(intro, onSaved) {
  const { owner, repo } = track.repoInfo();
  const body = h(`<form class="form" id="tf">
    <p class="small">${esc(intro)}</p>
    <ol class="small steps">
      <li><a href="${PAT_URL}" target="_blank" rel="noopener">Bu bağlantıyla</a> GitHub'da yeni bir anahtar (fine-grained token) oluştur. Ad: <b>Portföyüm</b>, Expiration: <b>No expiration</b> (yoksa en uzun süre).</li>
      <li><b>Repository access</b> → <b>Only select repositories</b> → <b>${esc(repo)}</b>.</li>
      <li><b>Permissions</b> → <b>Repositories</b> → <b>Contents: Read and write</b>.</li>
      <li>İstersen aynı anahtarı yedek için de kullan: <b>Account</b> → <b>Gists: Read and write</b>.</li>
      <li>En altta <b>Generate token</b>; çıkan <code>github_pat_…</code> anahtarını yapıştır.</li>
    </ol>
    <label>GitHub anahtarı<input name="token" required autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_…"></label>
    <p class="small" id="tmsg" role="status"></p>
    <button class="btn full" type="submit">Kaydet</button></form>`);
  const dlg = sheet('Otomatik takip', body);
  const form = dlg.querySelector('#tf'), msg = dlg.querySelector('#tmsg');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const token = form.token.value.trim();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; msg.textContent = `${owner}/${repo} erişimi kontrol ediliyor…`;
    try {
      await track.verify(token);
      track.saveToken(token);
      dlg.close();
      onSaved?.();
    } catch (err) { msg.textContent = '⚠︎ ' + err.message; btn.disabled = false; }
  };
}

function manualPrice(id, label) {
  const body = h(`<form class="form" id="mp">
    <p class="muted small">Otomatik veri gelmediğinde ya da gecikmeli olduğunda kullan. Aynı gün için otomatik veri gelse bile elle girdiğin değer geçerli olur.</p>
    <label>Tarih<input name="date" type="date" value="${C.today}" max="${C.today}"></label>
    <label>${esc(label || 'Birim fiyat (₺)')}<input name="v" inputmode="decimal" required></label>
    <button class="btn full" type="submit">Kaydet</button>
    ${Object.keys(S.manual[id] || {}).length ? `<h3>Elle girilenler</h3><div class="tbl-wrap"><table class="tbl"><tbody>${Object.entries(S.manual[id]).sort().reverse().map(([d, v]) => `<tr><td>${dTR(d)}</td><td>${num(v, 6)}</td><td><button type="button" class="link" data-d="${d}">Sil</button></td></tr>`).join('')}</tbody></table></div>` : ''}
  </form>`);
  const dlg = sheet(`${id} — elle değer`, body);
  const form = dlg.querySelector('#mp');
  form.onsubmit = (e) => {
    e.preventDefault();
    const v = parseNum(form.v.value);
    if (!(v > 0)) return;
    (S.manual[id] ||= {})[form.date.value] = v;
    persist(); dlg.close(); render();
  };
  dlg.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => { delete S.manual[id][b.dataset.d]; persist(); dlg.close(); render(); manualPrice(id, label); }));
}

function settings() {
  const idx = M.index?.seriler || {};
  const repoEdit = 'https://github.com/alcnergen/Try1/edit/master/portfoy/data/config.json';
  const runUrl = 'https://github.com/alcnergen/Try1/actions/workflows/portfoy.yml';
  const body = h(`<div class="bk-top">
    <h3 style="margin-top:0">Otomatik yedek</h3>
    ${(() => {
      const c = backup.loadCfg();
      if (!c) return `<p class="small">Kapalı. Verilerin yalnızca bu cihazda.</p><div class="row gap wrap"><button class="btn small" type="button" id="bkset">Otomatik yedeği kur</button><button class="btn small ghost" type="button" id="bkres">GitHub yedeğinden geri yükle</button></div>`;
      return `<p class="small">${c.error ? `<span class="warn">⚠︎ ${esc(c.error)}</span>` : `Açık. Son yedek: ${c.last ? new Date(c.last).toLocaleString('tr-TR') : '—'}`}<br><span class="muted">Her değişiklikten birkaç saniye sonra şifrelenip GitHub'daki gizli Gist'ine yazılır. Eski sürümler Gist geçmişinde saklanır.</span></p>
        <div class="row gap wrap"><button class="btn small" type="button" id="bknow">Şimdi yedekle</button>${c.gistId ? `<a class="btn small ghost" href="https://gist.github.com/${esc(c.gistId)}/revisions" target="_blank" rel="noopener">Yedek geçmişi</a>` : ''}<button class="btn small ghost" type="button" id="bkres">Geri yükle</button><button class="btn small ghost danger" type="button" id="bkoff">Kapat</button></div>`;
    })()}
    </div><form class="form" id="st">
    <label>Varsayılan stopaj (%)<input name="tax" inputmode="decimal" value="${num(S.settings.tax * 100, 1)}"></label>
    <fieldset><legend>Mevduat kıyası</legend>
      <label class="check"><input type="checkbox" name="depositAuto" ${S.settings.depositAuto !== false ? 'checked' : ''}> TCMB mevduat faizini kullan (her ay güncellenir)</label>
      ${(() => { const d = C.benches.depositInfo; return d?.gross != null ? `<p class="muted small">Güncel: brüt %${num(d.gross * 100, 2)} (${dTR(d.asOf).slice(3)}) → stopaj sonrası %${num(d.gross * (1 - (S.settings.depositTax ?? 0.175)) * 100, 2)}</p>` : '<p class="muted small">TCMB faiz verisi henüz yok; elle girilen faiz kullanılır.</p>'; })()}
      <label>Mevduat stopajı (%)<input name="depositTax" inputmode="decimal" value="${num((S.settings.depositTax ?? 0.175) * 100, 1)}"></label>
      <label>Elle yıllık net faiz (%) — otomatik kapalıysa<input name="deposit" inputmode="decimal" value="${num(S.settings.deposit * 100, 1)}"></label>
    </fieldset>
    <button class="btn" type="submit">Kaydet</button></form>
    <h3>Veri durumu</h3>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Seri</th><th>Son</th><th>Değer</th><th></th></tr></thead><tbody>
    ${[...S.funds.map((f) => f.code), 'USDTRY', 'EURTRY', 'GOLD', 'XU100', 'SPX', 'NDX', 'DAX', 'N225', 'MSCIW', 'TUFE', 'MEVFAIZ'].map((id) => {
      const p = series(M, S.manual, id); const l = p[p.length - 1];
      return `<tr><td>${esc(id)}${idx[id]?.hata ? ' <span class="warn" title="' + esc(idx[id].hata) + '">⚠︎</span>' : ''}</td><td>${l ? dTR(l[0]) : '—'}</td><td>${l ? num(l[1], 4) : '—'}</td><td><button type="button" class="link" data-m="${esc(id)}">Elle gir</button></td></tr>`;
    }).join('')}</tbody></table></div>
    <p class="muted small">Fiyatlar GitHub Actions ile her iş günü akşam ve sabah çekilir. Yeni bir fon kodunu otomatik takibe almak için <a href="${repoEdit}" target="_blank" rel="noopener">config.json</a> dosyasındaki "fonlar" listesine ekle. Hemen güncellemek için <a href="${runUrl}" target="_blank" rel="noopener">Actions → Run workflow</a>.</p>
    <div class="row gap wrap"><button class="btn small ghost" type="button" id="fetchnow">Fiyatları şimdi çek</button></div>
    <h3>Otomatik takip</h3>
    <p class="small">${track.loadToken() ? 'Açık. Uygulamada eklediğin yeni fon ve hisseler GitHub\'daki takip listesine kendiliğinden yazılır.' : 'Kapalı. Yeni eklediğin kodların fiyatı otomatik gelmez.'}</p>
    <div class="row gap wrap"><button class="btn small ${track.loadToken() ? 'ghost' : ''}" type="button" id="trset">${track.loadToken() ? 'Anahtarı değiştir' : 'Otomatik takibi aç'}</button>${track.loadToken() ? '<button class="btn small ghost danger" type="button" id="troff">Kapat</button>' : ''}</div>
    <h3>Elle yedek</h3>
    <div class="row gap wrap"><button class="btn small ghost" type="button" id="exp">Yedeği indir</button><button class="btn small ghost" type="button" id="imp">Yedekten yükle</button><button class="btn small ghost" type="button" id="lnk">Aktarım bağlantısı oluştur</button><button class="btn small ghost" type="button" id="paste">Bağlantıyı yapıştır</button></div>
    <h3>Ana ekrana ekleme</h3>
    <p class="muted small">iPhone: Safari'de Paylaş → Ana Ekrana Ekle. Android: Chrome menüsü → Ana ekrana ekle / Uygulamayı yükle.</p>
    <button class="btn ghost danger small" type="button" id="reset">Tüm verileri sil</button>`);
  const dlg = sheet('Ayarlar', body);
  dlg.querySelector('#st').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const t = parseNum(fd.get('tax')), d = parseNum(fd.get('deposit')), dt = parseNum(fd.get('depositTax'));
    if (Number.isFinite(t)) S.settings.tax = t / 100;
    if (Number.isFinite(d)) S.settings.deposit = d / 100;
    if (Number.isFinite(dt)) S.settings.depositTax = dt / 100;
    S.settings.depositAuto = fd.get('depositAuto') === 'on';
    persist(); dlg.close(); render();
  };
  dlg.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { dlg.close(); manualPrice(b.dataset.m, ['USDTRY', 'EURTRY'].includes(b.dataset.m) ? 'Kur' : b.dataset.m === 'GOLD' ? 'Ons altın ($)' : undefined); }));
  dlg.querySelector('#exp').onclick = exportFile;
  const on = (id, fn) => { const el = dlg.querySelector(id); if (el) el.onclick = fn; };
  on('#bkset', () => { dlg.close(); backupSetup(); });
  on('#fetchnow', () => { dlg.close(); maybeRequestFetch({ force: true }); });
  on('#trset', () => { dlg.close(); trackTokenSheet('Uygulamada yeni bir fon ya da hisse eklediğinde, kodu GitHub\'daki takip listesine kendisi yazar ve fiyatlar otomatik gelmeye başlar.', () => toast('Otomatik takip açık ✓')); });
  on('#troff', () => { if (confirm('Otomatik takip kapatılsın mı? (Takipteki kodlar listede kalır.)')) { track.saveToken(null); dlg.close(); } });
  on('#bkres', () => { dlg.close(); backupRestore(); });
  on('#bknow', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Yedekleniyor…';
    const r = await backup.backupNow(S, { force: true });
    dlg.close(); updateStatus(); settings();
    if (r.error) alert(r.error);
  });
  on('#bkoff', () => {
    if (!confirm('Otomatik yedek bu cihazda kapatılsın mı? GitHub\'daki mevcut yedek silinmez.')) return;
    backup.disable(); dlg.close(); render();
  });
  dlg.querySelector('#imp').onclick = () => { dlg.close(); importFile(); };
  dlg.querySelector('#lnk').onclick = async () => {
    const { snapshots, ...rest } = S;
    const url = `${location.origin}${location.pathname}#veri=${store.encodeShare(rest)}`;
    try { await navigator.clipboard.writeText(url); alert('Bağlantı kopyalandı. Diğer cihazında açınca portföy oraya aktarılır. Bağlantıyı kimseyle paylaşma.'); } catch { prompt('Bağlantıyı kopyala:', url); }
  };
  dlg.querySelector('#paste').onclick = () => {
    const v = prompt('Aktarım ya da düzeltme bağlantısını buraya yapıştır');
    const y = v && v.match(/#yama=([A-Za-z0-9_-]+)/);
    if (y) {
      try { if (applyPatchCode(y[1])) { dlg.close(); render(); toast('Değerleme güncellendi ✓'); } } catch { alert('Düzeltme bağlantısı okunamadı'); }
      return;
    }
    const m = v && v.match(/#veri=([A-Za-z0-9_-]+)/);
    if (!m) return v && alert('Geçerli bir aktarım bağlantısı değil');
    try { S = store.normalize({ ...store.decodeShare(m[1]), snapshots: S.snapshots }); persist(); dlg.close(); refresh(); }
    catch { alert('Bağlantı okunamadı'); }
  };
  dlg.querySelector('#reset').onclick = () => {
    if (!confirm('Bu cihazdaki tüm portföy verisi silinsin mi? Önce yedek almanı öneririm.')) return;
    S = structuredClone(store.DEFAULT); persist(); dlg.close(); render();
  };
}

const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=Portf%C3%B6y%C3%BCm%20yedek';
function backupSetup() {
  const body = h(`<form class="form" id="bf">
    <p class="small">Verilerin telefonda senin parolanla <b>şifrelenir</b> ve GitHub hesabındaki <b>gizli</b> bir Gist'e yazılır. GitHub ve başkaları içeriği okuyamaz.</p>
    <ol class="small steps">
      <li><a href="${TOKEN_URL}" target="_blank" rel="noopener">Bu bağlantıyla</a> GitHub'da bir anahtar oluştur: yalnızca <b>gist</b> kutusu işaretli olsun, "Expiration" için <b>No expiration</b> seç, en altta <b>Generate token</b>'a bas.</li>
      <li>Çıkan <code>ghp_…</code> ile başlayan anahtarı kopyalayıp aşağı yapıştır.</li>
      <li>Bir yedek parolası belirle. <b>Unutma:</b> parola olmadan yedek açılamaz; kimse kurtaramaz.</li>
    </ol>
    <label>GitHub anahtarı<input name="token" required autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="ghp_…" value="${esc(track.loadToken() || '')}"></label>
    ${track.loadToken() ? '<p class="muted small">Otomatik takip anahtarın dolduruldu; ona "Gists: Read and write" izni verdiysen yeni anahtar gerekmez.</p>' : ''}
    <label>Yedek parolası (en az 8 karakter)<input name="pass" type="password" required minlength="8" autocomplete="new-password"></label>
    <label>Parola tekrar<input name="pass2" type="password" required minlength="8" autocomplete="new-password"></label>
    <p class="small" id="bmsg" role="status"></p>
    <button class="btn full" type="submit">Kur ve ilk yedeği al</button></form>`);
  const dlg = sheet('Otomatik yedek', body);
  const form = dlg.querySelector('#bf'), msg = dlg.querySelector('#bmsg');
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (form.pass.value !== form.pass2.value) { msg.textContent = 'Parolalar aynı değil'; return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; msg.textContent = 'Anahtar doğrulanıyor ve yedekleniyor…';
    try {
      const r = await backup.setup({ token: form.token.value.trim(), pass: form.pass.value }, S,
        async () => confirm('Bu GitHub hesabında farklı parolayla alınmış eski bir Portföyüm yedeği var. Bu cihazdaki verilerle üzerine yazılsın mı? (Eski sürüm Gist geçmişinde kalır.)'));
      if (r.error) throw new Error(r.error);
      dlg.close(); render();
      alert('Otomatik yedek kuruldu. Bundan sonra her değişiklik şifrelenip yedeklenecek.');
    } catch (err) { msg.textContent = '⚠︎ ' + err.message; btn.disabled = false; }
  };
}

function backupRestore() {
  const c = backup.loadCfg();
  const body = h(`<form class="form" id="rf">
    <p class="small">GitHub'daki şifreli yedeğin bu cihaza indirilir. Bu cihazdaki mevcut veriler yedektekilerle değiştirilir.</p>
    <label>GitHub anahtarı<input name="token" required autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="ghp_…" value="${esc(c?.token || '')}"></label>
    <label>Yedek parolası<input name="pass" type="password" required autocomplete="current-password"></label>
    <p class="small" id="rmsg" role="status"></p>
    <button class="btn full" type="submit">Geri yükle</button></form>`);
  const dlg = sheet('Yedekten geri yükle', body);
  const form = dlg.querySelector('#rf'), msg = dlg.querySelector('#rmsg');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; msg.textContent = 'Yedek aranıyor…';
    try {
      const r = await backup.restore({ token: form.token.value.trim(), pass: form.pass.value });
      const n = r.state.funds?.length || 0;
      if ((S.funds.length || S.others.assets.length) && !confirm(`${new Date(r.tarih).toLocaleString('tr-TR')} tarihli yedek (${n} yatırım) yüklensin mi? Bu cihazdaki veri değiştirilecek.`)) { btn.disabled = false; msg.textContent = ''; return; }
      S = store.normalize(r.state); store.save(S);
      dlg.close(); await refresh();
      alert('Yedek yüklendi; otomatik yedek bu cihazda da açık.');
    } catch (err) { msg.textContent = '⚠︎ ' + err.message; btn.disabled = false; }
  };
}

function exportFile() {
  const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `portfoy-yedek-${C.today}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function importFile() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.onchange = async () => {
    try {
      const data = JSON.parse(await inp.files[0].text());
      if (!confirm('Yedek yüklensin mi? Bu cihazdaki mevcut veri değiştirilecek.')) return;
      S = store.normalize(data); persist(); await refresh();
    } catch (e) { alert('Dosya okunamadı: ' + e.message); }
  };
  inp.click();
}

// ---------- Başlatma ----------
async function refresh() {
  $('#status').textContent = 'Güncelleniyor…';
  runMigrations();
  M = await loadMarket(S.funds.map((f) => f.code));
  for (const f of S.funds) if (!f.name && M.names[f.code] && M.names[f.code] !== f.code) f.name = M.names[f.code];
  persist();
  render();
}

// Değerleme yaması (#yama=…): yalnızca Diğer varlıklardaki bir tarihi düzeltir, başka hiçbir şeye dokunmaz
function applyPatchCode(code) {
  const p = store.decodeShare(code);
  if (p?.tip !== 'degerleme' || !p.tarih || !Array.isArray(p.kalemler)) throw new Error('geçersiz');
  const list = p.kalemler.map((k) => `• ${k.ad}: ${money(k.deger, 'TRY', 0)}`).join('\n');
  if (!confirm(`${dTR(p.tarih)} değerlemesi şu kalemlerle güncellensin mi?\n\n${list}\n\nDiğer tarihler ve yatırımların değişmez.`)) return false;
  applyValuationPatch(S.others, p, store.uid);
  persist();
  return true;
}

function importFromHash() {
  const y = location.hash.match(/^#yama=(.+)$/);
  if (y) {
    try { if (applyPatchCode(y[1])) setTimeout(() => toast('Değerleme güncellendi ✓'), 600); } catch { alert('Düzeltme bağlantısı okunamadı'); }
    history.replaceState(null, '', location.pathname + '#ozet');
    tab = 'ozet';
    return;
  }
  const m = location.hash.match(/^#veri=(.+)$/);
  if (!m) return;
  try {
    const data = store.decodeShare(m[1]);
    const has = S.funds.length || S.others.assets.length;
    if (!has || confirm('Bağlantıdaki portföy bu cihaza aktarılsın mı? Mevcut veri değiştirilecek.')) {
      S = store.normalize({ ...data, snapshots: S.snapshots });
      persist();
    }
  } catch (e) { alert('Aktarım bağlantısı okunamadı'); }
  history.replaceState(null, '', location.pathname + '#ozet');
  tab = 'ozet';
}

// Veri eskiyse (ör. banka yarının fiyatını açıkladı ama uygulamada yok) GitHub'da veri çekimini hemen başlatır
let fetchWatch = null;
async function maybeRequestFetch({ force = false } = {}) {
  const token = track.loadToken();
  const upd = M.index?.guncelleme ? Date.parse(M.index.guncelleme) : 0;
  if (!token) { if (force) toast('Şimdi çekmek için Ayarlar → Otomatik takip anahtarı gerekli'); return; }
  if (!force && Date.now() - upd < 30 * 60e3) return;
  let last = 0; try { last = Number(localStorage.getItem('portfoy.istek')) || 0; } catch { /* yok */ }
  if (Date.now() - last < 10 * 60e3) { toast('Fiyat çekimi zaten istendi; birkaç dakika içinde gelir.'); return; }
  try {
    await track.requestFetch(token);
    try { localStorage.setItem('portfoy.istek', String(Date.now())); } catch { /* yok */ }
    toast('Güncel fiyatlar çekiliyor; 3-5 dakika içinde gelir.', 6000);
    clearInterval(fetchWatch);
    let n = 0;
    fetchWatch = setInterval(async () => {
      if (++n > 16) return clearInterval(fetchWatch);
      try {
        const idx = await (await fetch('data/index.json', { cache: 'no-cache' })).json();
        if (Date.parse(idx.guncelleme) > upd) { clearInterval(fetchWatch); await refresh(); toast('Fiyatlar güncellendi ✓'); }
      } catch { /* sonra tekrar */ }
    }, 30000);
  } catch (e) { toast('⚠︎ Fiyat çekimi başlatılamadı: ' + e.message, 7000); }
}

function fixCash() {
  const dups = findCashDuplicates(S.others, S.funds, 0.05);
  if (!dups.length) return toast('Kaldırılacak bir çift sayım bulunamadı');
  if (!confirm(`${dups.map((d) => `${dTR(d.date)} değerlemesindeki nakit (${money(d.value, 'TRY', 0)})`).join(', ')} fonlarla aynı para olduğu için kaldırılsın mı? Diğer tarihlerdeki değerler değişmez.`)) return;
  removeCashDuplicates(S.others, dups); persist(); render();
}
window.__app = { addFund, importFile, backupRestore, fixCash };

export async function init() {
  importFromHash();
  document.querySelectorAll('.tabbar button').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
  $('#settings').onclick = settings;
  $('#reload').onclick = async () => { await refresh(); maybeRequestFetch(); };
  try { await navigator.storage?.persist?.(); } catch { /* yok */ }
  render();
  await refresh();
  let w = innerWidth;
  addEventListener('resize', () => { if (Math.abs(innerWidth - w) > 40) { w = innerWidth; render(); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && C.today !== todayISO()) refresh(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
