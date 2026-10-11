// Ürün piksellerinden baskın rengi bulur ve Türkçe renk adına eşler (CIELAB uzayında en yakın renk).

const PALETTE = [
  ['Siyah', [24, 24, 26]],
  ['Antrasit', [62, 64, 68]],
  ['Gri', [128, 130, 132]],
  ['Açık Gri', [190, 191, 192]],
  ['Beyaz', [245, 245, 242]],
  ['Ekru', [236, 228, 210]],
  ['Krem', [240, 226, 190]],
  ['Bej', [214, 196, 166]],
  ['Camel', [190, 148, 100]],
  ['Taba', [166, 98, 48]],
  ['Kahverengi', [102, 68, 44]],
  ['Haki', [120, 118, 76]],
  ['Adaçayı Yeşili', [158, 174, 136]],
  ['Yeşil', [56, 136, 72]],
  ['Zümrüt Yeşili', [20, 110, 84]],
  ['Mint', [170, 220, 196]],
  ['Lacivert', [32, 44, 84]],
  ['Mavi', [52, 98, 180]],
  ['Kot Mavisi', [78, 108, 150]],
  ['Bebe Mavisi', [168, 200, 228]],
  ['Turkuaz', [40, 170, 176]],
  ['Mor', [102, 52, 132]],
  ['Lila', [190, 160, 214]],
  ['Pembe', [232, 132, 168]],
  ['Pudra', [226, 186, 182]],
  ['Fuşya', [204, 40, 128]],
  ['Kırmızı', [196, 36, 40]],
  ['Bordo', [112, 26, 40]],
  ['Kiremit', [192, 104, 72]],
  ['Somon', [236, 150, 118]],
  ['Mercan', [240, 118, 96]],
  ['Turuncu', [236, 120, 40]],
  ['Hardal', [204, 160, 48]],
  ['Sarı', [240, 206, 60]],
];

function toLab([r, g, b]) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

const PALETTE_LAB = PALETTE.map(([name, rgb]) => ({ name, rgb, lab: toLab(rgb) }));

export function nameColor(rgb) {
  const lab = toLab(rgb);
  let best = PALETTE_LAB[0];
  let bestD = Infinity;
  for (const p of PALETTE_LAB) {
    // Adlandırmada ton, parlaklıktan daha belirleyici: L farkını yarı ağırlıkla say.
    const d = (0.5 * (lab[0] - p.lab[0])) ** 2 + (lab[1] - p.lab[1]) ** 2 + (lab[2] - p.lab[2]) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best.name;
}

/**
 * Maskeye göre ürün piksellerinin baskın rengini döndürür.
 * Renkler kaba bir 3B histogramda toplanır ve en kalabalık kutunun ortalaması alınır;
 * böylece puantiye, düğme ya da parlama gibi küçük ayrıntılar sonucu kaydırmaz.
 */
export function dominantColor(rgb, alpha, gains = [1, 1, 1], step = 3) {
  const buckets = new Map();
  for (let i = 0; i < alpha.length; i += step) {
    if (alpha[i] < 220) continue;
    const r = Math.min(255, rgb[i * 3] * gains[0]);
    const g = Math.min(255, rgb[i * 3 + 1] * gains[1]);
    const b = Math.min(255, rgb[i * 3 + 2] * gains[2]);
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    let bucket = buckets.get(key);
    if (!bucket) { bucket = [0, 0, 0, 0]; buckets.set(key, bucket); }
    bucket[0] += r; bucket[1] += g; bucket[2] += b; bucket[3]++;
  }
  let best = null;
  for (const bucket of buckets.values()) if (!best || bucket[3] > best[3]) best = bucket;
  if (!best) return { rgb: [128, 128, 128], hex: '#808080', name: 'Gri' };
  const out = [best[0], best[1], best[2]].map((v) => Math.round(v / best[3]));
  const hex = `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  return { rgb: out, hex, name: nameColor(out) };
}
