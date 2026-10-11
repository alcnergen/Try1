// İlan metni üretimi. ANTHROPIC_API_KEY tanımlıysa Claude ürün görselini görerek yazar;
// tanımlı değilse (ya da çağrı başarısız olursa) kural tabanlı Türkçe şablon motoru devreye girer.
import Anthropic from '@anthropic-ai/sdk';

export const MARKETS = {
  trendyol: { label: 'Trendyol', width: 1200, height: 1800, ratio: '2:3', titleMax: 100 },
  hepsiburada: { label: 'Hepsiburada', width: 1500, height: 1500, ratio: '1:1', titleMax: 100 },
  amazon: { label: 'Amazon', width: 2000, height: 2000, ratio: '1:1', titleMax: 150 },
  instagram: { label: 'Instagram', width: 1080, height: 1350, ratio: '4:5', titleMax: 90 },
};

export const CATEGORIES = {
  gomlek: { label: 'Gömlek', noun: 'Gömlek', apparel: true, top: true },
  tisort: { label: 'Tişört', noun: 'Tişört', apparel: true, top: true },
  elbise: { label: 'Elbise', noun: 'Elbise', apparel: true },
  kazak: { label: 'Kazak / Triko', noun: 'Kazak', apparel: true, top: true },
  ceket: { label: 'Ceket / Mont', noun: 'Ceket', apparel: true, top: true },
  pantolon: { label: 'Pantolon / Etek', noun: 'Pantolon', apparel: true },
  canta: { label: 'Çanta', noun: 'Çanta' },
  ayakkabi: { label: 'Ayakkabı', noun: 'Ayakkabı' },
  aksesuar: { label: 'Aksesuar', noun: 'Aksesuar' },
  ev: { label: 'Ev tekstili', noun: 'Ev Tekstili Ürünü' },
  diger: { label: 'Diğer', noun: 'Ürün' },
};

const MATERIALS = [
  ['keten', 'Keten'], ['pamuk', 'Pamuk'], ['pamuklu', 'Pamuk'], ['viskon', 'Viskon'], ['ipek', 'İpek'],
  ['saten', 'Saten'], ['yün', 'Yün'], ['kaşmir', 'Kaşmir'], ['triko', 'Triko'], ['denim', 'Denim'],
  ['kot', 'Denim'], ['deri', 'Deri'], ['süet', 'Süet'], ['polyester', 'Polyester'], ['şifon', 'Şifon'],
  ['kadife', 'Kadife'], ['müslin', 'Müslin'], ['krep', 'Krep'], ['poplin', 'Poplin'], ['örme', 'Örme'],
];
const GENDERS = [['kadın', 'Kadın'], ['erkek', 'Erkek'], ['unisex', 'Unisex'], ['çocuk', 'Çocuk'], ['kız çocuk', 'Kız Çocuk'], ['erkek çocuk', 'Erkek Çocuk']];
const FITS = [['oversize', 'Oversize'], ['slim fit', 'Slim Fit'], ['slim', 'Slim Fit'], ['regular', 'Regular Fit'], ['relaxed', 'Relaxed Fit'], ['bol kesim', 'Oversize'], ['dar kesim', 'Slim Fit']];
const SLEEVES = [['uzun kol', 'Uzun Kol'], ['kısa kol', 'Kısa Kol'], ['kolsuz', 'Kolsuz'], ['askılı', 'Askılı'], ['truvakar', 'Truvakar Kol']];

const lower = (s) => String(s || '').toLocaleLowerCase('tr-TR');
const titleCase = (s) => String(s || '')
  .split(/\s+/)
  .filter(Boolean)
  .map((w) => (/^[%\d]/.test(w) ? w : w.charAt(0).toLocaleUpperCase('tr-TR') + w.slice(1)))
  .join(' ');
const findAll = (text, table) => {
  const t = lower(text);
  const out = [];
  for (const [key, val] of table) if (t.includes(key) && !out.includes(val)) out.push(val);
  return out;
};
const pickV = (list, variant) => list[((variant % list.length) + list.length) % list.length];

function clampTitle(title, max) {
  if (title.length <= max) return title;
  const cut = title.slice(0, max + 1);
  return cut.slice(0, cut.lastIndexOf(' ')).trim();
}

function analyse({ productName, details, category }) {
  const text = `${productName || ''} ${details || ''}`;
  const percent = /%\s?(\d{2,3})\s*([a-zçğıöşü]+)/i.exec(text);
  const materials = findAll(text, MATERIALS);
  let materialLabel = materials.join(' - ');
  if (percent) materialLabel = `%${percent[1]} ${titleCase(percent[2])}`;
  return {
    gender: findAll(productName || text, GENDERS).pop() || '',
    materials,
    materialLabel,
    fit: findAll(text, FITS)[0] || '',
    sleeve: findAll(text, SLEEVES)[0] || '',
    sizes: (/\b((?:XXS|XS|S|M|L|XL|XXL|3XL)(?:\s*[-–,/]\s*(?:XXS|XS|S|M|L|XL|XXL|3XL))+)\b/.exec(text) || [])[1] || '',
    cat: CATEGORIES[category] || CATEGORIES.diger,
  };
}

/** Kural tabanlı üretim: kullanıcının yazdıkları + görselden bulunan renk. */
export function templateListing({ productName, details, category, market, colorName, variant = 0 }) {
  const a = analyse({ productName, details, category });
  const m = MARKETS[market] || MARKETS.trendyol;
  let base = titleCase(productName) || [a.gender, a.cat.noun].filter(Boolean).join(' ');
  // Materyal adı üründe geçiyorsa ("Keten Gömlek") onu çıkarıp tek, daha bilgili etiketle ("%100 Keten") yaz.
  if (a.materialLabel) {
    for (const mat of a.materials) base = base.replace(new RegExp(`(^|\\s)${mat}(?=\\s|$)`, 'iu'), ' ');
    base = base.replace(/\s+/g, ' ').trim();
  }
  const has = (w) => lower(base).includes(lower(w));
  const extras = [a.sleeve, a.fit].filter((w) => w && !has(w));

  let title;
  if (market === 'amazon') {
    title = [base, a.materialLabel && !has(a.materialLabel) ? a.materialLabel : '', ...extras, colorName && !has(colorName) ? colorName : '', a.sizes]
      .filter(Boolean).join(', ');
  } else if (market === 'instagram') {
    title = pickV([
      `Yeni sezon: ${colorName && !has(colorName) ? `${colorName} ` : ''}${base}`,
      `${base}${colorName && !has(colorName) ? ` · ${colorName}` : ''} şimdi stokta`,
      `Gardırobun yeni favorisi: ${base}`,
    ], variant);
  } else {
    // Pazaryeri sırası: cinsiyet + renk + materyal + ürün + ayırt edici özellikler.
    let rest = base;
    if (a.gender && lower(rest).startsWith(lower(a.gender))) rest = rest.slice(a.gender.length).trim();
    const restHas = (w) => lower(rest).includes(lower(w));
    const parts = [];
    if (a.gender) parts.push(a.gender);
    if (colorName && !restHas(colorName)) parts.push(colorName);
    if (a.materialLabel && !restHas(a.materialLabel)) parts.push(a.materialLabel);
    parts.push(rest, ...extras);
    title = parts.join(' ');
  }
  title = clampTitle(title.replace(/\s+/g, ' ').trim(), m.titleMax);

  const mat = a.materialLabel || '';
  const noun = lower(a.cat.noun);
  const solid = a.materials.some((x) => ['Deri', 'Süet'].includes(x));
  const fabric = mat
    ? (solid
      ? pickV([
        `${mat} malzemesi zamanla güzelleşen, uzun ömürlü bir kullanım sunar.`,
        `Özenle işlenmiş ${lower(mat)} yüzeyi şık ve dayanıklıdır.`,
        `${mat} yapısıyla hem sağlam hem de dokunuşu yumuşak bir ${noun}.`,
      ], variant)
      : pickV([
        `${mat} kumaşı sayesinde gün boyu rahat ve nefes alan bir kullanım sunar.`,
        `${mat} dokusu hem şık görünür hem de cilde yumuşak bir his bırakır.`,
        `Özenle seçilmiş ${lower(mat)} kumaş; yıkamalardan sonra formunu korur.`,
      ], variant))
    : (a.cat.apparel
      ? pickV([
        'Yumuşak dokulu kumaşı gün boyu rahat bir kullanım sunar.',
        'Kaliteli kumaşı ve temiz dikişleriyle uzun ömürlü bir parça.',
        'Hafif dokusu sayesinde mevsim geçişlerinde de rahatlıkla kullanılır.',
      ], variant)
      : pickV([
        'Özenli işçiliği ve sağlam yapısıyla uzun ömürlü bir kullanım sunar.',
        'Sade tasarımı ve kaliteli malzemesiyle her gün rahatça kullanılır.',
        'Detaylarına özen gösterilerek üretilmiş, dayanıklı bir parça.',
      ], variant));
  const style = a.cat.apparel
    ? pickV([
      `${titleCase(colorName || 'Zamansız')} rengiyle ofiste de hafta sonu da kolayca kombinlenir.`,
      `${a.fit || 'Rahat'} kalıbıyla vücuda oturur, hareket özgürlüğü sağlar.`,
      `Jean, kumaş pantolon ya da etekle; günlükten şıka her stile uyum sağlar.`,
    ], variant)
    : pickV([
      `${titleCase(colorName || 'Zamansız')} tonuyla gardırobundaki pek çok parçayla uyum sağlar.`,
      `Günlük kullanımda da özel davetlerde de şık bir tamamlayıcı.`,
      `Hediye olarak da gönül rahatlığıyla seçebileceğin bir ${noun}.`,
    ], variant);
  const care = a.cat.apparel
    ? (a.materials.includes('Yün') || a.materials.includes('Kaşmir') || a.materials.includes('İpek')
      ? 'Bakım: 30°C hassas programda ya da kuru temizlemede yıkayın, sermeden kurutun.'
      : 'Bakım: 30°C\'de ters yüz yıkayın, düşük ısıda ütüleyin.')
    : 'Bakım: Nemli bezle silerek temizleyin, doğrudan güneş ışığından uzak saklayın.';
  const sizing = a.sizes
    ? `${a.sizes.replace(/\s/g, '')} beden seçenekleri; kalıp standarttır, kendi bedeninizi seçebilirsiniz.`
    : (a.cat.apparel ? 'Kalıp standarttır; kendi bedeninizi seçmenizi öneririz.' : '');

  let bullets = [fabric, style, sizing, care].filter(Boolean);
  if (market === 'amazon') {
    const heads = ['KUMAŞ VE KONFOR', 'KOLAY KOMBİN', 'BEDEN', 'KOLAY BAKIM'];
    bullets = [fabric, style, sizing, care.replace(/^Bakım:\s*/, '')]
      .map((b, i) => (b ? `${heads[i]}: ${b}` : ''))
      .filter(Boolean);
  }
  if (market === 'instagram') {
    bullets = [fabric, style, 'Sipariş ve beden bilgisi için DM\'den yazabilirsin.'];
  }

  const attributes = [];
  if (a.materialLabel) attributes.push({ name: 'Materyal', value: a.materialLabel });
  if (colorName) attributes.push({ name: 'Renk', value: colorName });
  if (a.cat.apparel) {
    if (a.fit) attributes.push({ name: 'Kalıp', value: a.fit });
    if (a.sleeve) attributes.push({ name: 'Kol boyu', value: a.sleeve });
    if (a.gender) attributes.push({ name: 'Cinsiyet', value: a.gender });
    if (a.sizes) attributes.push({ name: 'Beden', value: a.sizes.replace(/\s/g, '') });
  }
  attributes.push({ name: 'Kategori', value: a.cat.label });

  const kw = [a.cat.noun, colorName, ...a.materials, a.fit, a.gender, 'yeni sezon']
    .filter(Boolean)
    .map((k) => lower(k));
  const keywords = market === 'instagram'
    ? [...new Set([...kw.map((k) => `#${k.replace(/\s+/g, '')}`), '#butik', '#yenisezon'])]
    : [...new Set(kw)];

  return { title, bullets, attributes, keywords: keywords.slice(0, 8), source: 'template' };
}

// ---------------------------------------------------------------- Claude
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'bullets', 'attributes', 'keywords'],
  properties: {
    title: { type: 'string', description: 'Pazaryeri ürün başlığı' },
    bullets: { type: 'array', items: { type: 'string' }, description: '3-5 madde açıklama' },
    attributes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'value'],
        properties: { name: { type: 'string' }, value: { type: 'string' } },
      },
    },
    keywords: { type: 'array', items: { type: 'string' } },
  },
};

const SYSTEM = `Sen Türkiye'deki pazaryeri satıcıları için ürün ilanı yazan deneyimli bir e-ticaret metin yazarısın.
Görseldeki ürünü ve satıcının verdiği bilgileri kullanarak seçilen kanala uygun, doğal ve satış odaklı Türkçe bir ilan yaz.

Kurallar:
- Yalnızca görselde açıkça görülen ya da satıcının yazdığı bilgileri kullan. Materyal, beden, ölçü veya marka uydurma; emin olmadığın özelliği yazma.
- Başlık kanalın karakter sınırını aşmasın. Trendyol ve Hepsiburada: cinsiyet + renk + materyal + ürün tipi + ayırt edici özellik sırası. Amazon: virgülle ayrılmış, bilgi yoğun başlık. Instagram: kısa, merak uyandıran bir giriş cümlesi.
- Açıklama 3-5 maddeden oluşsun; her madde tek cümle olsun. Amazon için her maddeye BÜYÜK HARFLİ kısa bir başlık ekle ("KUMAŞ VE KONFOR: ..."). Instagram için son madde satın alma çağrısı olsun.
- Özellikler pazaryerinin filtre alanlarına uygun olsun (Materyal, Renk, Kalıp, Yaka tipi, Kol boyu, Desen, Kategori gibi); yalnızca bilinenleri ekle.
- Anahtar kelimeler küçük harfli, 5-8 adet arama terimi olsun. Instagram için # ile başlayan etiketler kullan.
- Abartılı vaatlerden ve emojiden kaçın.`;

let client = null;
export function claudeEnabled() {
  if (process.env.LISTING_PROVIDER === 'template') return false;
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

async function claudeListing({ imageJpeg, productName, details, category, market, colorName, variant }) {
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 90_000, maxRetries: 2 });
  const m = MARKETS[market] || MARKETS.trendyol;
  const cat = CATEGORIES[category] || CATEGORIES.diger;
  const info = [
    `Kanal: ${m.label} (başlık en fazla ${m.titleMax} karakter)`,
    `Kategori: ${cat.label}`,
    `Satıcının ürün adı: ${productName || '(belirtilmedi)'}`,
    `Satıcının notları: ${details || '(yok)'}`,
    `Görselden ölçülen baskın renk: ${colorName}`,
    variant > 0 ? `Bu bir yeniden üretim (#${variant + 1}); öncekinden farklı bir anlatım ve kelime seçimi kullan.` : '',
  ].filter(Boolean).join('\n');

  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageJpeg.toString('base64') } },
        { type: 'text', text: info },
      ],
    }],
  });

  if (response.stop_reason === 'refusal') throw new Error('Model isteği reddetti');
  if (response.stop_reason === 'max_tokens') throw new Error('Yanıt yarıda kesildi');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const data = JSON.parse(text);
  return {
    title: clampTitle(String(data.title).trim(), m.titleMax),
    bullets: data.bullets.map(String).slice(0, 5),
    attributes: data.attributes.slice(0, 10),
    keywords: data.keywords.map(String).slice(0, 8),
    source: 'claude',
  };
}

export async function generateListing(input) {
  if (claudeEnabled()) {
    try {
      return await claudeListing(input);
    } catch (err) {
      const kind = err instanceof Anthropic.RateLimitError ? 'hız sınırı'
        : err instanceof Anthropic.AuthenticationError ? 'kimlik doğrulama'
          : err instanceof Anthropic.APIError ? `API ${err.status}`
            : err.message;
      console.warn(`[listing] Claude kullanılamadı (${kind}); şablon motoruna geçiliyor.`);
    }
  }
  return templateListing(input);
}
