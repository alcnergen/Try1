import test from 'node:test';
import assert from 'node:assert/strict';
import { templateListing, MARKETS } from '../server/pipeline/listing.js';
import { nameColor, dominantColor } from '../server/pipeline/color.js';

test('Trendyol başlığı cinsiyet + renk + materyal sırasını izler ve tekrar etmez', () => {
  const l = templateListing({
    productName: 'Kadın keten gömlek uzun kol',
    details: '%100 keten, regular fit, S-M-L-XL',
    category: 'gomlek',
    market: 'trendyol',
    colorName: 'Adaçayı Yeşili',
  });
  assert.equal(l.title, 'Kadın Adaçayı Yeşili %100 Keten Gömlek Uzun Kol Regular Fit');
  assert.ok(l.attributes.some((a) => a.name === 'Beden' && a.value === 'S-M-L-XL'));
});

test('başlıklar kanalın karakter sınırını aşmaz', () => {
  for (const market of Object.keys(MARKETS)) {
    const l = templateListing({ productName: 'Kadın '.repeat(40) + 'elbise', category: 'elbise', market, colorName: 'Lacivert' });
    assert.ok(l.title.length <= MARKETS[market].titleMax, `${market}: ${l.title.length}`);
  }
});

test('deri ürünlerde "kumaş" denmez', () => {
  const l = templateListing({ productName: 'Deri el çantası', category: 'canta', market: 'trendyol', colorName: 'Taba' });
  assert.ok(!l.bullets.join(' ').includes('kumaş'));
});

test('renk adlandırma', () => {
  assert.equal(nameColor([20, 22, 25]), 'Siyah');
  assert.equal(nameColor([160, 175, 135]), 'Adaçayı Yeşili');
  assert.equal(nameColor([30, 42, 86]), 'Lacivert');
});

test('baskın renk küçük ayrıntılardan etkilenmez', () => {
  const n = 1000;
  const rgb = Buffer.alloc(n * 3);
  const alpha = Buffer.alloc(n, 255);
  for (let i = 0; i < n; i++) {
    const dot = i % 5 === 0; // %20 beyaz puantiye
    rgb[i * 3] = dot ? 245 : 30;
    rgb[i * 3 + 1] = dot ? 245 : 42;
    rgb[i * 3 + 2] = dot ? 240 : 86;
  }
  assert.equal(dominantColor(rgb, alpha, [1, 1, 1], 1).name, 'Lacivert');
});
