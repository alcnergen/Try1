// Dağılım ölçeri: ABD borsası (kullanıcının ETF'leri), altın ve TL fonları için kural tabanlı, şeffaf puanlama.
// Her faktör −1…+1 arası puan alır; ağırlıklı ortalama 0–100'e çevrilir (50 nötr). Tahmin değil, mevcut
// verilerin (trend, analist görüşü, faizler, petrol, dolar, volatilite, TL reel getirisi) özetidir.

export const OLCER_ETF = [
  { kod: 'QQQM', tv: 'NASDAQ:QQQM', gorus: 'K_QQQM', ad: 'Nasdaq 100' },
  { kod: 'SMH', tv: 'NASDAQ:SMH', gorus: 'K_SMH', ad: 'Yarı iletken' },
  { kod: 'DRAM', tv: 'CBOE:DRAM', gorus: 'K_DRAM', ad: 'Bellek' },
  { kod: 'IGV', tv: 'CBOE:IGV', gorus: 'K_IGV', ad: 'Yazılım' },
  { kod: 'NASA', tv: 'AMEX:NASA', gorus: 'K_NASA', ad: 'Uzay' },
  { kod: 'CIBR', tv: 'NASDAQ:CIBR', gorus: 'K_CIBR', ad: 'Siber güvenlik' },
];
export const OLCER_SCAN = {
  america: [...OLCER_ETF.map((e) => e.tv), 'SP:SPX'],
  cfd: ['TVC:GOLD', 'TVC:DXY', 'TVC:VIX', 'FX:USOIL'],
  global: ['TVC:US10Y', 'TVC:US02Y'],
  economics2: ['ECONOMICS:USINTR', 'ECONOMICS:USIRYY'],
};
export const OLCER_COLS = ['close', 'SMA50', 'SMA200', 'Perf.1M', 'Perf.3M', 'Perf.Y', 'RSI', 'Recommend.All'];

const clamp = (x, a = -1, b = 1) => Math.max(a, Math.min(b, x));
const ok = (x) => typeof x === 'number' && Number.isFinite(x);
// x0 → −1, x1 → +1 arası doğrusal (x0 > x1 olabilir: ters yön)
const lin = (x, x0, x1) => (ok(x) ? clamp(-1 + (2 * (x - x0)) / (x1 - x0)) : null);
// parçalı doğrusal: [[x, puan], …] artan x
const pw = (x, pts) => {
  if (!ok(x)) return null;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [a, pa] = pts[i - 1], [b, pb] = pts[i]; return pa + ((x - a) / (b - a)) * (pb - pa); }
  return pts[pts.length - 1][1];
};
const avg = (xs) => { const v = xs.filter(ok); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const r2 = (x) => (ok(x) ? Math.round(x * 100) / 100 : null);

export function rowObj(d) { return Object.fromEntries(OLCER_COLS.map((c, i) => [c, d?.[i] ?? null])); }

// Fiyat 200 günlük ortalamanın üstünde mi, 50 günlük 200 günlüğün üstünde mi
export function trendScore(r) {
  if (!r || !ok(r.close)) return null;
  const s = [];
  if (ok(r.SMA200)) s.push(r.close > r.SMA200 ? 1 : -1);
  if (ok(r.SMA50) && ok(r.SMA200)) s.push(r.SMA50 > r.SMA200 ? 1 : -1);
  else if (ok(r.SMA50)) s.push(r.close > r.SMA50 ? 1 : -1);
  return avg(s);
}
const momScore = (r) => lin(r?.['Perf.3M'], -15, 15);
// RSI: aşırı satım (30) olumlu, aşırı alım (70) olumsuz, 45–55 nötr
const rsiScore = (r) => pw(r?.RSI, [[30, 1], [45, 0], [55, 0], [70, -1]]);
// Analist: "al" oranı (%50 → −1, %90 → +1) ve ortalama hedef farkı (%0 → −1, %30 → +1)
export const analystScore = (ic) => (ic ? avg([lin(ic.al, 0.5, 0.9), lin(ic.hedef, 0, 0.3)]) : null);

function gauge(factors) {
  const score = (fs) => {
    const used = fs.filter((f) => ok(f.puan));
    const w = used.reduce((a, f) => a + f.agirlik, 0);
    return Math.round(50 + 50 * (w ? used.reduce((a, f) => a + f.agirlik * f.puan, 0) / w : 0));
  };
  // taban: analist görüşü hariç puan; geçmiş sınamayla (analist verisi yok) karşılaştırılabilir olan budur
  return { skor: score(factors), taban: score(factors.filter((f) => !f.analist)), faktorler: factors.map(({ analist, ...f }) => ({ ...f, puan: r2(f.puan) })) };
}

/**
 * rows: { 'NASDAQ:QQQM': {close, SMA50, …}, … } (tarayıcı satırları, rowObj ile)
 * icerik: { K_QQQM: {al, tut, sat, hedef, …}, … } (gorus.json içerik bazlı analist özeti)
 * tr: { mevduatNet (yıllık, ör. 0.285), tufeYillik (ör. 0.33), usdtry3m (3 aylık değişim, ör. 0.02), mevduatDegisim3m (puan, ör. -1) }
 */
export function computeOlcer(rows, icerik = {}, tr = {}) {
  const R = (s) => rows[s] || null;
  const etfler = OLCER_ETF.map((e) => {
    const r = R(e.tv), ic = icerik[e.gorus];
    const parts = { trend: trendScore(r), momentum: momScore(r), analist: analystScore(ic), rsi: rsiScore(r) };
    const W = { trend: 0.35, momentum: 0.2, analist: 0.3, rsi: 0.15 };
    const used = Object.entries(parts).filter(([, v]) => ok(v));
    const w = used.reduce((a, [k]) => a + W[k], 0);
    const s = w ? used.reduce((a, [k, v]) => a + W[k] * v, 0) / w : null;
    return { kod: e.kod, ad: e.ad, skor: ok(s) ? Math.round(50 + 50 * s) : null, fiyat: r?.close ?? null, perf3m: r2(r?.['Perf.3M']), rsi: r2(r?.RSI), analistAl: ic?.al ?? null, hedef: ic?.hedef ?? null, parcalar: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, r2(v)])) };
  });

  const us10 = R('TVC:US10Y'), us2 = R('TVC:US02Y'), ff = R('ECONOMICS:USINTR'), cpi = R('ECONOMICS:USIRYY');
  const vix = R('TVC:VIX'), oil = R('FX:USOIL'), dxy = R('TVC:DXY'), gold = R('TVC:GOLD'), spx = R('SP:SPX');
  const realTL = ok(tr.mevduatNet) && ok(tr.tufeYillik) ? (1 + tr.mevduatNet) / (1 + tr.tufeYillik) - 1 : null;
  const realUS = ok(us10?.close) && ok(cpi?.close) ? us10.close - cpi.close : null;
  const spread2y = ok(us2?.close) && ok(ff?.close) ? us2.close - ff.close : null;
  const tlFaktor = { ad: "TL'de kalmanın reel getirisi", deger: ok(realTL) ? `mevduat (net) − enflasyon ≈ %${(realTL * 100).toFixed(1)}` : 'veri yok', puan: lin(realTL, 0.08, -0.04), agirlik: 0.1, aciklama: 'TL fonlarının enflasyon üstü getirisi yüksekse dışarı kaydırmanın cazibesi azalır' };

  const abd = gauge([
    { ad: "ETF'lerin trendi ve ivmesi", deger: `${etfler.filter((e) => ok(e.parcalar.trend) && e.parcalar.trend > 0).length}/${etfler.length} ETF yükseliş trendinde`, puan: avg(etfler.map((e) => (ok(e.parcalar.trend) || ok(e.parcalar.momentum) ? (e.parcalar.trend ?? 0) * 0.6 + (e.parcalar.momentum ?? 0) * 0.4 : null))), agirlik: 0.2, aciklama: 'Fiyat 50/200 günlük ortalamaların üstünde mi, son 3 ayda ne kadar değişti' },
    { ad: 'Analist görüşü (ETF içerikleri)', deger: (() => { const v = etfler.filter((e) => ok(e.analistAl)); return v.length ? `ort. %${Math.round(avg(v.map((e) => e.analistAl)) * 100)} al · hedef +%${Math.round(avg(v.map((e) => e.hedef)) * 100)}` : 'veri yok'; })(), puan: avg(etfler.map((e) => e.parcalar.analist)), agirlik: 0.2, analist: true, aciklama: 'İçlerindeki hisselerin analist al oranı ve ortalama hedef fiyat farkı' },
    { ad: 'S&P 500 trendi', deger: spx ? `${r2(spx['Perf.3M'])}% (3 ay)` : 'veri yok', puan: trendScore(spx), agirlik: 0.05, aciklama: 'Geniş piyasa 200 günlük ortalamanın üstünde mi' },
    { ad: 'Fed ve tahvil faizleri', deger: `10Y %${r2(us10?.close) ?? '—'} (1 ay ${r2(us10?.['Perf.1M']) ?? '—'}%) · 2Y−Fed ${ok(spread2y) ? (spread2y >= 0 ? '+' : '') + spread2y.toFixed(2) : '—'} puan`, puan: avg([lin(us10?.['Perf.1M'], 10, -10), lin(spread2y, 1, -1)]), agirlik: 0.15, aciklama: 'Faizler düşüyorsa ve piyasa indirim bekliyorsa (2 yıllık < Fed faizi) hisseler için olumlu' },
    { ad: 'Korku endeksi (VIX)', deger: ok(vix?.close) ? `${r2(vix.close)}` : 'veri yok', puan: pw(vix?.close, [[12, -0.5], [18, 0], [30, 1]]), agirlik: 0.15, aciklama: '30 üstü panik: geçmişte sonraki aylar için iyi alım fırsatı oldu; 12 altı aşırı rahatlık' },
    { ad: 'Petrol (WTI)', deger: ok(oil?.close) ? `${r2(oil.close)}$ · 3 ay ${r2(oil['Perf.3M'])}%` : 'veri yok', puan: lin(oil?.['Perf.3M'], 25, -15), agirlik: 0.1, aciklama: 'Hızlı petrol artışı enflasyon ve faiz baskısı demek' },
    tlFaktor,
  ]);

  const altin = gauge([
    { ad: 'Altın trendi', deger: gold ? `${r2(gold.close)}$ · 200 gün ort. ${r2(gold.SMA200)}$` : 'veri yok', puan: trendScore(gold), agirlik: 0.25, aciklama: 'Fiyat 50/200 günlük ortalamaların üstünde mi' },
    { ad: 'Altın ivmesi', deger: gold ? `3 ay ${r2(gold['Perf.3M'])}%` : 'veri yok', puan: momScore(gold), agirlik: 0.15, aciklama: 'Son 3 aylık değişim' },
    { ad: 'ABD reel faizi', deger: ok(realUS) ? `10Y − enflasyon ≈ %${realUS.toFixed(2)}` : 'veri yok', puan: lin(realUS, 2.5, 0), agirlik: 0.2, aciklama: 'Reel faiz yüksekse faiz getirmeyen altın baskılanır' },
    { ad: 'Dolar endeksi (DXY)', deger: dxy ? `${r2(dxy.close)} · 3 ay ${r2(dxy['Perf.3M'])}%` : 'veri yok', puan: lin(dxy?.['Perf.3M'], 5, -5), agirlik: 0.1, aciklama: 'Güçlenen dolar altını baskılar' },
    { ad: 'Risk algısı (VIX)', deger: ok(vix?.close) ? `${r2(vix.close)}` : 'veri yok', puan: pw(vix?.close, [[12, -0.5], [20, 0], [30, 1]]), agirlik: 0.1, aciklama: 'Panik dönemlerinde altına talep artar' },
    { ad: 'RSI (aşırı alım/satım)', deger: ok(gold?.RSI) ? `${r2(gold.RSI)}` : 'veri yok', puan: rsiScore(gold), agirlik: 0.05, aciklama: '30 altı aşırı satım (fırsat), 70 üstü aşırı alım' },
    { ...tlFaktor, agirlik: 0.15 },
  ]);

  const tl = gauge([
    { ad: 'Reel TL getirisi', deger: tlFaktor.deger, puan: lin(realTL, -0.04, 0.08), agirlik: 0.5, aciklama: 'Mevduat/para piyasası getirisi enflasyonun ne kadar üstünde' },
    { ad: 'Kura karşı getiri (3 ay)', deger: ok(tr.usdtry3m) && ok(tr.mevduatNet) ? `TL getirisi ~%${(tr.mevduatNet * 25).toFixed(1)} · dolar/TL %${(tr.usdtry3m * 100).toFixed(1)}` : 'veri yok', puan: ok(tr.usdtry3m) && ok(tr.mevduatNet) ? lin(tr.mevduatNet / 4 - tr.usdtry3m, -0.05, 0.05) : null, agirlik: 0.3, aciklama: 'Son 3 ayda TL faizi kurdaki artışı geçti mi' },
    { ad: 'TR faiz yönü', deger: ok(tr.mevduatDegisim3m) ? `mevduat faizi 3 ayda ${tr.mevduatDegisim3m >= 0 ? '+' : ''}${tr.mevduatDegisim3m.toFixed(1)} puan` : 'veri yok', puan: lin(tr.mevduatDegisim3m, -3, 3), agirlik: 0.2, aciklama: 'Faizler düşüyorsa TL fonlarının ileriki getirisi de düşer' },
  ]);

  return { abd, altin, tl, etfler };
}

// Geçmiş dağılımındaki yer (0–1): olcer.json → sinama.dagilim çeyreklik noktaları arasında doğrusal
export function yuzdelik(skor, dg) {
  if (!dg || !ok(skor)) return null;
  const pts = [[dg.min, 0], [dg.p20, 0.2], [dg.p40, 0.4], [dg.p50, 0.5], [dg.p60, 0.6], [dg.p80, 0.8], [dg.max, 1]].filter(([x]) => ok(x));
  return pw(skor, pts);
}
// Geçmişe göre etiket ("barem"): her ölçer kendi geçmişindeki yerine göre okunur. TL ölçeri hiç 70'i
// geçmediyse 40 "zayıf" değil, geçmişin üst dilimidir.
export function baremEtiket(skor, dg) {
  const p = yuzdelik(skor, dg);
  if (p == null) return skorEtiket(skor);
  return p >= 0.8 ? 'Geçmişe göre çok yüksek' : p >= 0.6 ? 'Ortalamanın üstü' : p > 0.4 ? 'Geçmiş ortalaması' : p > 0.2 ? 'Ortalamanın altı' : 'Geçmişe göre çok düşük';
}

/**
 * Ölçere göre dağılım. hedef: orta vadede ABD + altına ayrılacak toplam pay (ör. 0.5).
 * yer: { abd, altin } geçmiş dağılımındaki yer (0–1, yuzdelik). Yoksa puandan (35 → 0, 65 → 1) türetilir.
 * Hedef iki kalem arasında bu yerlere göre bölünür. "Şimdi" payı, alt dilimde (%20 ve altı) hedefin dörtte biri,
 * üst dilimde (%80 ve üstü) tamamıdır: geçmiş sınamada ABD ETF'leri ve altın, ölçer düşükken de çoğu dönemde
 * TL mevduatını geçti; bu yüzden ölçer zamanlama için değil geçişin hızı için kullanılır.
 */
export function allocation(olcer, hedef = 0.5, yer = null) {
  const sU = olcer.abd.skor, sG = olcer.altin.skor;
  const yU = ok(yer?.abd) ? yer.abd : clamp((sU - 35) / 30, 0, 1) * 0.6 + 0.2;
  const yG = ok(yer?.altin) ? yer.altin : clamp((sG - 35) / 30, 0, 1) * 0.6 + 0.2;
  const pU = (0.25 + yU) / (0.5 + yU + yG), pG = 1 - pU;
  const hazir = (y) => 0.25 + 0.75 * clamp((y - 0.2) / 0.6, 0, 1);
  const abdHedef = hedef * pU, altinHedef = hedef * pG;
  const abdSimdi = abdHedef * hazir(yU), altinSimdi = altinHedef * hazir(yG);
  // ABD payı ETF'lere puanlarına göre (30 puanın üstü) dağıtılır
  const ws = olcer.etfler.map((e) => Math.max((e.skor ?? 0) - 30, 0));
  const tw = ws.reduce((a, b) => a + b, 0);
  const etf = olcer.etfler.map((e, i) => ({ kod: e.kod, pay: tw ? ws[i] / tw : 1 / olcer.etfler.length }));
  return { abd: { hedef: abdHedef, simdi: abdSimdi }, altin: { hedef: altinHedef, simdi: altinSimdi }, tl: { hedef: 1 - hedef, simdi: 1 - abdSimdi - altinSimdi }, etf };
}

export const skorEtiket = (s) => (s >= 65 ? 'Güçlü' : s >= 55 ? 'Olumlu' : s > 45 ? 'Nötr' : s > 35 ? 'Zayıf' : 'Çok zayıf');

/**
 * Faiz senaryosu (12 ay). Faizler bugünden dönem sonuna doğrusal iner/çıkar, aylık bileşik işler.
 * { tcmb, tcmbSon, mevFark (mevduat − politika faizi, puan), vergi, enf, kur (dolar/TL yıllık artış), fed, fedSon, ay }
 */
export function faizSenaryo({ tcmb, tcmbSon, mevFark = 0, vergi = 0.175, enf, kur, fed, fedSon, ay = 12 }) {
  const path = (a, b) => Array.from({ length: ay }, (_, i) => a + ((b - a) * (i + 0.5)) / ay);
  const tlYol = path(tcmb + mevFark, tcmbSon + mevFark), usdYol = path(fed, fedSon ?? fed);
  const tlNet = tlYol.reduce((g, r) => g * (1 + ((r / 100) * (1 - vergi)) / 12), 1) - 1;
  const usdGetiri = usdYol.reduce((g, r) => g * (1 + r / 100 / 12), 1) - 1;
  const kurAy = (1 + kur) ** (ay / 12) - 1, enfAy = (1 + enf) ** (ay / 12) - 1;
  const dolarTL = (1 + usdGetiri) * (1 + kurAy) - 1;
  // dönem sonundaki koşullarla TL ölçeri (enflasyon beklentisi yıllık enflasyon yerine kullanılır)
  const mevSon = tcmbSon + mevFark;
  const tlOlcer = computeOlcer({}, {}, { mevduatNet: (mevSon / 100) * (1 - vergi), tufeYillik: enf, usdtry3m: (1 + kur) ** 0.25 - 1, mevduatDegisim3m: (tcmbSon - tcmb) / 4 }).tl.skor;
  return { ortFaiz: tlYol.reduce((a, b) => a + b, 0) / ay, tlNet, reel: (1 + tlNet) / (1 + enfAy) - 1, dolarTL, fark: tlNet - dolarTL, kurAy, usdGetiri, tlOlcer };
}
