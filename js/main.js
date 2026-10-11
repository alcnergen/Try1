/* Vitrin — pazarlama sitesi etkileşimleri (bağımlılıksız) */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- üst menü: kaydırma durumu ---------- */
  const header = $('[data-header]');
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- mobil menü ---------- */
  const toggle = $('[data-menu-toggle]');
  const nav = $('[data-nav]');
  const setMenu = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Menüyü kapat' : 'Menüyü aç');
    nav.classList.toggle('is-open', open);
  };
  toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) { setMenu(false); toggle.focus(); }
  });
  window.matchMedia('(min-width: 901px)').addEventListener('change', (e) => { if (e.matches) setMenu(false); });

  /* ---------- aktif bölüm vurgusu ---------- */
  const navLinks = $$('.nav a[href^="#"]');
  const sections = navLinks.map((a) => $(a.getAttribute('href'))).filter(Boolean);
  if ('IntersectionObserver' in window && sections.length) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((a) => a.classList.toggle('is-current', a.getAttribute('href') === `#${entry.target.id}`));
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach((s) => spy.observe(s));
  }

  /* ---------- önce / sonra karşılaştırma ---------- */
  const compare = $('[data-compare]');
  const range = $('[data-compare-range]');
  if (compare && range) {
    const setPos = (v) => compare.style.setProperty('--pos', `${v}%`);
    range.addEventListener('input', () => setPos(range.value));
    const start = () => compare.classList.add('is-dragging');
    const end = () => compare.classList.remove('is-dragging');
    range.addEventListener('pointerdown', start);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);

    // Görünür olduğunda kaydırıcıyı kısa bir kez oynatarak etkileşimli olduğunu belli et.
    if (!reduceMotion && 'IntersectionObserver' in window) {
      const hint = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting) return;
        hint.disconnect();
        let touched = false;
        range.addEventListener('pointerdown', () => { touched = true; }, { once: true });
        range.addEventListener('keydown', () => { touched = true; }, { once: true });
        const frames = [50, 62, 38, 50];
        frames.forEach((v, i) => setTimeout(() => {
          if (touched) return;
          animateTo(Number(range.value), v, 450);
        }, 500 + i * 480));
      }, { threshold: 0.6 });
      hint.observe(compare);
    }

    function animateTo(from, to, dur) {
      const t0 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        const v = from + (to - from) * eased;
        range.value = v;
        setPos(v);
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }

  /* ---------- stil çipleri (radiogroup) ---------- */
  const chipGroup = $('[data-chips]');
  if (chipGroup) {
    const chips = $$('.chip', chipGroup);
    const images = $$('.compare-after img');
    const select = (chip, focus) => {
      chips.forEach((c) => {
        const on = c === chip;
        c.classList.toggle('is-active', on);
        c.setAttribute('aria-checked', String(on));
        c.tabIndex = on ? 0 : -1;
      });
      images.forEach((img) => img.classList.toggle('is-active', img.dataset.style === chip.dataset.style));
      if (focus) chip.focus();
    };
    chipGroup.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (chip) select(chip, false);
    });
    chipGroup.addEventListener('keydown', (e) => {
      const i = chips.indexOf(document.activeElement);
      if (i < 0) return;
      const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      if (e.key in keys) {
        e.preventDefault();
        select(chips[(i + keys[e.key] + chips.length) % chips.length], true);
      }
    });
  }

  /* ---------- pazaryeri sekmeleri: örnek ilan ---------- */
  const LISTINGS = {
    trendyol: {
      title: 'Kadın Adaçayı Yeşili %100 Keten Gömlek Uzun Kol Regular Fit',
      desc: [
        '%100 keten kumaşı nefes alır, sıcak günlerde bile serin tutar.',
        'Klasik yaka ve tam boy düğmeli pat; ofiste de hafta sonu da şık.',
        'Göğüste tek cep, manşetli uzun kol. Kolları kıvırarak da giyilebilir.',
      ],
    },
    hepsiburada: {
      title: 'Kadın Keten Gömlek Uzun Kollu Klasik Yaka Cepli Regular Kesim - Adaçayı Yeşili',
      desc: [
        'Doğal keten dokusu; yazın serin, ara mevsimde katmanlı kombinlere uygun.',
        'Rahat regular kesim, kalçayı kapatan boy ve düğmeli manşet detayı.',
        'S, M, L ve XL beden seçenekleri; kalıp standarttır, kendi bedeninizi seçin.',
      ],
    },
    amazon: {
      title: 'Kadın Gömlek, %100 Keten, Uzun Kollu, Klasik Yaka, Göğüs Cepli, Regular Fit, Adaçayı Yeşili',
      desc: [
        'NEFES ALAN KETEN: %100 keten kumaş, gün boyu hafif ve serin bir his sunar.',
        'ZAMANSIZ KESİM: Klasik yaka, düğmeli pat ve regular fit kalıp.',
        'KOLAY BAKIM: 30°C\'de ters yüz yıkayın, hafif nemliyken ütüleyin.',
      ],
    },
  };
  const tabList = $('[data-tabs]');
  const panel = $('[data-listing]');
  if (tabList && panel) {
    const tabs = $$('[role="tab"]', tabList);
    const titleEl = $('[data-title]', panel);
    const descEl = $('[data-desc]', panel);
    const countEl = $('[data-count]', panel);
    const render = (key) => {
      const data = LISTINGS[key];
      titleEl.textContent = data.title;
      countEl.textContent = `${data.title.length} karakter · sınır içinde`;
      descEl.replaceChildren(...data.desc.map((t) => {
        const li = document.createElement('li');
        li.textContent = t;
        return li;
      }));
    };
    const activate = (tab, focus) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
      });
      panel.setAttribute('aria-labelledby', tab.id);
      if (focus) tab.focus();
      if (reduceMotion) { render(tab.dataset.market); return; }
      panel.classList.add('is-swapping');
      setTimeout(() => { render(tab.dataset.market); panel.classList.remove('is-swapping'); }, 180);
    };
    render('trendyol');
    tabList.addEventListener('click', (e) => {
      const tab = e.target.closest('[role="tab"]');
      if (tab && tab.getAttribute('aria-selected') !== 'true') activate(tab, false);
    });
    tabList.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      let next = null;
      if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
      if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
      if (e.key === 'Home') next = tabs[0];
      if (e.key === 'End') next = tabs[tabs.length - 1];
      if (next) { e.preventDefault(); activate(next, true); }
    });
  }

  /* ---------- aylık / yıllık fiyat ---------- */
  const billing = $('[data-billing]');
  if (billing) {
    const buttons = $$('button', billing);
    billing.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const period = btn.dataset.period;
      buttons.forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      $$('.amount').forEach((el) => { el.textContent = el.dataset[period]; });
      $$('.price-note').forEach((el) => {
        el.textContent = period === 'yearly' ? el.dataset.noteYearly : el.dataset.noteMonthly;
      });
    });
  }

  /* ---------- kaydırınca beliren öğeler ---------- */
  const reveals = $$('.reveal');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    reveals.forEach((el) => el.classList.add('is-visible'));
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        el.classList.add('is-visible');
        io.unobserve(el);
        // Animasyon bitince sınıfı kaldır; kartların kendi hover geçişleri devreye girsin.
        setTimeout(() => {
          el.classList.remove('reveal', 'is-visible');
          el.style.transitionDelay = '';
        }, 1300);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    // Aynı satırdaki kartlar sırayla gelsin.
    reveals.forEach((el) => {
      const siblings = el.parentElement ? $$(':scope > .reveal', el.parentElement) : [];
      const idx = siblings.indexOf(el);
      if (idx > 0) el.style.transitionDelay = `${Math.min(idx, 5) * 80}ms`;
      io.observe(el);
    });
  }

  /* ---------- yıl ---------- */
  const year = $('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());
})();
