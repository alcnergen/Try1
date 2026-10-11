/* Vitrin Kurumsal — marka seçici: panel önizlemesini seçilen markanın adına, renklerine ve etiketlerine büründürür. */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Örnek markalar hayalidir.
  const BRANDS = {
    vitrin: {
      name: 'Vitrin', initial: 'V', color: '#ff7a3d', theme: 'dark', shape: 'rounded',
      domain: 'studyo.vitrin.app', sector: 'Varsayılan Vitrin paneli',
      tabs: ['Panel', 'Kütüphane', '3B model'], pill: '244 görsel hakkı', avatar: 'AD',
      greeting: 'Merhaba, Ayşe', sub: 'Demir Butik · Profesyonel plan', cta: '+ Yeni görsel',
      stats: [['Bu ay üretilen', '128'], ['Kalan hak', '122'], ['Kazanılan zaman', '41 sa'], ['Ortalama süre', '5,4 sn']],
      section: 'Son çalışmalar', sectionLink: 'Tümünü gör →',
      cards: ['Puantiyeli midi elbise', 'Deri el çantası', 'Örgü kazak', 'Beyaz deri sneaker'],
      tags: ['Yaşam alanı', 'Koyu stüdyo', 'Düz yatırma', 'Pastel'],
      powered: 'vitrin.app',
    },
    pervaz: {
      name: 'Pervaz Dijital', initial: 'P', color: '#7c5cff', theme: 'dark', shape: 'circle',
      domain: 'studyo.pervazdijital.com', sector: 'E-ticaret ajansı',
      tabs: ['Müşteriler', 'Projeler', 'Raporlar'], pill: 'Ajans planı', avatar: 'PD',
      greeting: 'Günaydın, Pervaz ekibi', sub: '12 müşteri markası · 3 onay bekliyor', cta: '+ Müşteri için üret',
      stats: [['Aktif müşteri', '12'], ['Bu ay teslim', '1.840'], ['Ort. onay süresi', '3,2 sa'], ['Müşteri puanı', '4,8/5']],
      section: 'Onay bekleyenler', sectionLink: 'Tüm projeler →',
      cards: ['Nehir Kids · Elbise', 'Lale Deri · Çanta', 'Ada Triko · Kazak', 'Koşu Atölyesi · Sneaker'],
      tags: ['Onay bekliyor', 'Onaylandı', 'Revizyon', 'Teslim edildi'],
      powered: 'Pervaz Dijital Stüdyo',
    },
    mavera: {
      name: 'Mavera Moda', initial: 'M', color: '#0f9f74', theme: 'light', shape: 'arch',
      domain: 'katalog.maveramoda.com.tr', sector: 'Perakende zinciri',
      tabs: ['Koleksiyon', 'Mağazalar', 'Kampanyalar'], pill: 'SK 26 sezonu', avatar: 'ME',
      greeting: 'Merhaba, Mavera e-ticaret', sub: 'Sonbahar–Kış 26 · 48 mağaza', cta: '+ Koleksiyona ekle',
      stats: [['Sezonda çekilen', '1.260'], ['Yayında', '1.104'], ['Mağaza başına', '26'], ['Stüdyo tasarrufu', '₺412 B']],
      section: 'Yeni koleksiyon', sectionLink: 'Koleksiyona git →',
      cards: ['MV-2611 Midi elbise', 'MV-2604 El çantası', 'MV-2619 Örgü kazak', 'MV-2622 Sneaker'],
      tags: ['Web + mağaza', 'Kampanya', 'Yeni sezon', 'Outlet'],
      powered: 'Mavera Moda Katalog',
    },
    kozalak: {
      name: 'Kozalak Pazar', initial: 'K', color: '#2f7cf6', theme: 'dark', shape: 'hex',
      domain: 'satici.kozalakpazar.com', sector: 'Pazaryeri operatörü',
      tabs: ['Satıcılar', 'Kalite kontrol', 'Kategoriler'], pill: 'Satıcı stüdyosu', avatar: 'KP',
      greeting: 'Satıcı stüdyosu', sub: 'Kozalak satıcılarına ücretsiz · 3.420 aktif satıcı', cta: '+ Satıcı davet et',
      stats: [['Aktif satıcı', '3.420'], ['Bu hafta iyileşen ilan', '9.870'], ['Görsel kalite skoru', '92/100'], ['Reddedilen görsel', '%1,4']],
      section: 'Kalite kontrolünden geçenler', sectionLink: 'Tüm ilanlar →',
      cards: ['Satıcı #20418 · Elbise', 'Satıcı #11502 · Çanta', 'Satıcı #30877 · Kazak', 'Satıcı #09126 · Sneaker'],
      tags: ['Kurala uygun', 'Kurala uygun', 'Düzeltildi', 'Kurala uygun'],
      powered: 'Kozalak Pazar Satıcı Merkezi',
    },
    tezgah: {
      name: 'Tezgâh Toptan', initial: 'T', color: '#e8445a', theme: 'dark', shape: 'square',
      domain: 'katalog.tezgahtoptan.com', sector: 'Üretici ve toptancı',
      tabs: ['Katalog', 'Bayiler', 'Siparişler'], pill: '6 dilde katalog', avatar: 'TT',
      greeting: 'Merhaba, Tezgâh', sub: 'Toptan katalog · 85 bayi · 6 dil', cta: '+ Kataloğu yayınla',
      stats: [['Katalogdaki ürün', '640'], ['Bayi', '85'], ['Dil', '6'], ['Güncelleme süresi', '2 dk']],
      section: 'Bayilere açık ürünler', sectionLink: 'Kataloğu aç →',
      cards: ['TZ-118 Elbise · 12 renk', 'TZ-207 Çanta · 4 renk', 'TZ-311 Kazak · 8 renk', 'TZ-405 Sneaker · 3 renk'],
      tags: ['Stokta', 'Ön sipariş', 'Stokta', 'Yeni'],
      powered: 'Tezgâh Toptan B2B',
    },
  };

  // ------------------------------------------------------------ renk yardımcıları
  const hexToRgb = (hex) => {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const rgbToHex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
  const mix = (hex, target, t) => {
    const a = hexToRgb(hex);
    const b = hexToRgb(target);
    return rgbToHex(a.map((v, i) => v + (b[i] - v) * t));
  };
  const luminance = (hex) => {
    const [r, g, b] = hexToRgb(hex).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  // Buton yazısı için okunaklı renk (WCAG kontrastına göre siyah ya da beyaz).
  const inkFor = (hex) => {
    const L = luminance(hex);
    return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? '#14110d' : '#ffffff';
  };

  // ------------------------------------------------------------ uygula
  const app = $('[data-wl-app]');
  const frame = $('.wl-frame');
  const set = (key, value) => $$(`[data-b="${key}"]`).forEach((el) => { el.textContent = value; });

  function apply(brand) {
    const b2 = mix(brand.color, '#ffffff', 0.32);
    const vars = { '--b': brand.color, '--b2': b2, '--b-ink': inkFor(brand.color) };
    for (const [k, v] of Object.entries(vars)) {
      app.style.setProperty(k, v);
      document.body.style.setProperty(k.replace('--b', '--wl'), v);
    }
    app.dataset.theme = brand.theme;

    const mark = $('[data-b="mark"]', app);
    mark.textContent = brand.initial;
    mark.dataset.shape = brand.shape;

    set('name', brand.name);
    set('domain', brand.domain);
    set('sector', brand.sector);
    set('pill', brand.pill);
    set('avatar', brand.avatar);
    set('greeting', brand.greeting);
    set('sub', brand.sub);
    set('cta', brand.cta);
    set('section', brand.section);
    set('sectionLink', brand.sectionLink);
    set('powered', brand.powered);
    brand.cards.forEach((c, i) => set(`card${i}`, c));
    brand.tags.forEach((t, i) => set(`tag${i}`, t));

    $('[data-b="tabs"]', app).replaceChildren(...brand.tabs.map((t, i) => {
      const s = document.createElement('span');
      s.textContent = t;
      if (i === 0) s.className = 'is-on';
      return s;
    }));
    $('[data-b="stats"]', app).replaceChildren(...brand.stats.map(([label, value]) => {
      const d = document.createElement('div');
      const l = document.createElement('span');
      l.textContent = label;
      const v = document.createElement('strong');
      v.textContent = value;
      d.append(l, v);
      return d;
    }));

    // Kısa bir "yeniden boyama" vurgusu
    frame.classList.remove('is-switching');
    void frame.offsetWidth;
    frame.classList.add('is-switching');
  }

  // ------------------------------------------------------------ özel marka
  const form = $('[data-custom-form]');
  const nameInput = $('[data-custom-name]');
  const colorInput = $('[data-custom-color]');
  const themeInput = $('[data-custom-theme]');

  function customBrand() {
    const name = nameInput.value.trim() || 'Markanız';
    const slug = name.toLocaleLowerCase('tr-TR')
      .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
      .replace(/[^a-z0-9]+/g, '') || 'markaniz';
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toLocaleUpperCase('tr-TR')).join('');
    return {
      ...BRANDS.vitrin,
      name,
      initial: initials.charAt(0) || 'M',
      avatar: initials || 'M',
      color: colorInput.value,
      theme: themeInput.value,
      shape: 'rounded',
      domain: `studyo.${slug}.com`,
      sector: 'Sizin markanız',
      greeting: `Merhaba, ${name} ekibi`,
      sub: `${name} · Kurumsal plan`,
      pill: 'Kurumsal plan',
      powered: `${name} Stüdyo`,
    };
  }

  [nameInput, colorInput, themeInput].forEach((el) => el.addEventListener('input', () => apply(customBrand())));
  form.addEventListener('submit', (e) => e.preventDefault());

  // ------------------------------------------------------------ çipler (radiogroup)
  const chips = $$('[data-brand-chips] .wl-chip');

  function select(chip, focus) {
    chips.forEach((c) => {
      const on = c === chip;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-checked', String(on));
      c.tabIndex = on ? 0 : -1;
    });
    const isCustom = chip.dataset.brand === 'custom';
    form.hidden = !isCustom;
    apply(isCustom ? customBrand() : BRANDS[chip.dataset.brand]);
    if (focus) chip.focus();
  }

  $('[data-brand-chips]').addEventListener('click', (e) => {
    const chip = e.target.closest('.wl-chip');
    if (chip) select(chip, false);
  });
  $('[data-brand-chips]').addEventListener('keydown', (e) => {
    const i = chips.indexOf(document.activeElement);
    if (i < 0) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (step) {
      e.preventDefault();
      select(chips[(i + step + chips.length) % chips.length], true);
    }
  });
  colorInput.addEventListener('input', () => {
    $('.wl-chip-custom').style.setProperty('--c', colorInput.value);
  });
})();
