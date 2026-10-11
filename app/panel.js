/* Vitrin — kullanıcı paneli ve üretim aracı */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null) node.append(c);
    return node;
  };
  const nf = new Intl.NumberFormat('tr-TR');
  const nf1 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const rtf = new Intl.RelativeTimeFormat('tr', { numeric: 'auto' });
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = {
    me: null,
    works: [],
    view: 'panel',
    filter: 'all',
    query: '',
  };

  // ------------------------------------------------------------ API
  class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }
  async function api(url, { method = 'GET', body, form } = {}) {
    const opts = { method, headers: {} };
    if (form) opts.body = form;
    else if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, opts);
    } catch {
      throw new ApiError('Sunucuya ulaşılamadı. Bağlantını kontrol et.', 0);
    }
    if (res.status === 401) {
      location.assign('/giris?next=%2Fpanel');
      throw new ApiError('Oturumun sona erdi.', 401);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error || 'Bir şeyler ters gitti.', res.status);
    return data;
  }

  // ------------------------------------------------------------ yardımcılar
  const label = (list, id) => (state.me?.options[list].find((o) => o.id === id) || {}).label || id;
  const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toLocaleUpperCase('tr-TR')).join('');

  function relTime(iso) {
    const diff = (new Date(iso).getTime() - Date.now()) / 1000;
    const abs = Math.abs(diff);
    if (abs < 60) return 'az önce';
    if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
    if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
    return new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  }

  function formatMinutes(min) {
    if (min < 60) return `${min} dk`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} sa ${m} dk` : `${h} sa`;
  }

  function toast(message, kind = 'ok') {
    const node = el('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message);
    $('[data-toasts]').append(node);
    requestAnimationFrame(() => node.classList.add('is-in'));
    setTimeout(() => {
      node.classList.remove('is-in');
      setTimeout(() => node.remove(), 300);
    }, 3200);
  }

  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = el('textarea', { class: 'sr-only' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    const old = btn.textContent;
    btn.textContent = 'Kopyalandı';
    btn.classList.add('is-done');
    setTimeout(() => { btn.textContent = old; btn.classList.remove('is-done'); }, 1500);
  }

  // ------------------------------------------------------------ üst bar ve görünümler
  function renderUser() {
    const { user } = state.me;
    $('[data-avatar]').textContent = initials(user.name);
    $('[data-user-name]').textContent = user.name;
    $('[data-user-email]').textContent = user.email;
    const firstName = user.name.split(' ')[0];
    $('[data-greeting]').textContent = `Merhaba, ${firstName}`;
    $('[data-store-line]').textContent = `${user.store} · Profesyonel plan`;
  }

  function renderStats() {
    const s = state.me.stats;
    const cards = $$('[data-stats] .stat');
    const fill = (i, value, sub, extra) => {
      const v = $('.stat-value', cards[i]);
      v.classList.remove('skeleton');
      v.textContent = value;
      $('.stat-sub', cards[i]).textContent = sub;
      $('.stat-bar', cards[i])?.remove();
      if (extra) cards[i].append(extra);
    };
    fill(0, nf.format(s.generatedThisMonth), 'görsel · yeniden üretimler dahil');
    const pct = Math.round((s.remaining / s.quota) * 100);
    fill(1, nf.format(s.remaining), `/ ${nf.format(s.quota)} · %${pct} kaldı`,
      el('div', { class: 'stat-bar', 'aria-hidden': 'true' }, el('span', { style: `width:${pct}%` })));
    fill(2, formatMinutes(s.minutesSaved), `${nf.format(s.savedWorks)} kayıtlı ürün × ~25 dk çekim ve metin`);
    fill(3, s.avgSeconds ? `${nf1.format(s.avgSeconds)} sn` : '—', 'fotoğraftan hazır ilana');

    $('[data-quota-text]').textContent = `${nf.format(s.remaining)} hak`;
    $('[data-usage-used]').textContent = nf.format(s.generatedThisMonth);
    $('[data-usage-quota]').textContent = nf.format(s.quota);
    const meter = $('[data-usage-meter]');
    meter.setAttribute('aria-valuemax', s.quota);
    meter.setAttribute('aria-valuenow', s.generatedThisMonth);
    $('span', meter).style.width = `${Math.min(100, (s.generatedThisMonth / s.quota) * 100)}%`;
    const now = new Date();
    const reset = new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
    $('[data-usage-note]').textContent = `${nf.format(s.remaining)} görsel hakkın kaldı · ${reset} tarihinde yenilenir.`;

    const engine = $$('[data-engine] dd');
    engine[0].textContent = state.me.engine.segmentation ? 'IS-Net segmentasyon (sunucuda)' : 'Model yüklenmemiş';
    engine[1].textContent = state.me.engine.listing === 'claude' ? 'Claude (görseli görerek yazar)' : 'Kural tabanlı Türkçe şablon motoru';
    engine[2].textContent = s.avgSeconds ? `${nf1.format(s.avgSeconds)} saniye` : '—';
  }

  function setView(view, push = true) {
    if (!['panel', 'kutuphane', 'model3d', 'plan'].includes(view)) view = 'panel';
    state.view = view;
    $$('[data-view]').forEach((v) => { v.hidden = v.dataset.view !== view; });
    $$('.app-tabs [data-view-link]').forEach((a) => {
      if (a.dataset.viewLink === view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (push && location.hash !== `#${view}`) history.pushState(null, '', `#${view}`);
    document.title = `${{ panel: 'Panel', kutuphane: 'Kütüphane', model3d: '3B model', plan: 'Plan ve kullanım' }[view]} — Vitrin`;
    window.scrollTo(0, 0);
    if (view === 'model3d') ensureModel3d();
    window.dispatchEvent(new CustomEvent('vitrin:view', { detail: { view } }));
  }

  // 3B bölümü (ve three.js) yalnızca ilk açıldığında yüklenir.
  let model3dLoading = null;
  function ensureModel3d() {
    if (model3dLoading || !state.me) return;
    model3dLoading = import('/app/model3d.js')
      .then((m) => m.init({ api, toast, samples: state.me.options.samples }))
      .catch((err) => {
        console.error(err);
        model3dLoading = null;
        toast('3B bölümü yüklenemedi.', 'error');
      });
  }

  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-view-link]');
    if (!link) return;
    e.preventDefault();
    closeMenu();
    setView(link.dataset.viewLink);
  });
  window.addEventListener('popstate', () => setView(location.hash.slice(1), false));

  // Hesap menüsü
  const accountBtn = $('[data-account-btn]');
  const accountMenu = $('[data-account-menu]');
  function closeMenu() {
    accountMenu.hidden = true;
    accountBtn.setAttribute('aria-expanded', 'false');
  }
  accountBtn.addEventListener('click', () => {
    const open = accountMenu.hidden;
    accountMenu.hidden = !open;
    accountBtn.setAttribute('aria-expanded', String(open));
    if (open) $('[role="menuitem"]', accountMenu).focus();
  });
  document.addEventListener('click', (e) => {
    if (!accountMenu.hidden && !e.target.closest('.account')) closeMenu();
  });
  accountMenu.addEventListener('keydown', (e) => {
    const items = $$('[role="menuitem"]', accountMenu);
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    if (e.key === 'Escape') { closeMenu(); accountBtn.focus(); }
  });
  $('[data-logout]').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.assign('/giris');
  });

  // ------------------------------------------------------------ çalışma kartları
  function workCard(work) {
    const job = work.job;
    const thumb = job?.result?.thumbUrl;
    return el('li', { class: 'work' },
      el('button', { type: 'button', class: 'work-btn', onclick: () => studio.openWork(work), 'aria-label': `${work.title} — ayrıntıları aç` },
        el('div', { class: 'work-media' },
          thumb ? el('img', { src: thumb, alt: '', loading: 'lazy', width: 600, height: 750 }) : el('span', { class: 'work-missing', text: 'Görsel yok' })),
        el('div', { class: 'work-body' },
          el('p', { class: 'work-title', text: work.title }),
          el('div', { class: 'work-meta' },
            el('span', { class: 'tag', text: label('styles', work.style) }),
            el('span', { class: 'tag tag-muted', text: label('markets', work.market) }),
            el('time', { datetime: work.createdAt, text: relTime(work.createdAt) })))));
  }

  const addCard = () => el('li', { class: 'work work-add' },
    el('button', { type: 'button', class: 'work-add-btn', onclick: () => studio.open() },
      el('span', { class: 'add-plus', 'aria-hidden': 'true', text: '+' }),
      el('strong', { text: 'Yeni ekle' }),
      el('span', { text: 'Fotoğraf yükle, 30 saniyede vitrinde' })));

  function renderWorks() {
    const recent = $('[data-works="recent"]');
    recent.replaceChildren(...state.works.slice(0, 7).map(workCard), addCard());

    const q = state.query.toLocaleLowerCase('tr-TR');
    const filtered = state.works.filter((w) => (state.filter === 'all' || w.market === state.filter)
      && (!q || w.title.toLocaleLowerCase('tr-TR').includes(q)));
    const all = $('[data-works="all"]');
    all.replaceChildren(...filtered.map(workCard), addCard());
    $('[data-lib-count]').textContent = state.works.length
      ? `${nf.format(state.works.length)} kayıtlı ürün${filtered.length !== state.works.length ? ` · ${nf.format(filtered.length)} gösteriliyor` : ''}`
      : 'Henüz kayıtlı ürün yok.';
  }

  function renderFilters() {
    const wrap = $('[data-filters]');
    const items = [{ id: 'all', label: 'Tümü' }, ...state.me.options.markets];
    wrap.replaceChildren(...items.map((m) => el('button', {
      type: 'button',
      class: `chip${state.filter === m.id ? ' is-active' : ''}`,
      'aria-pressed': String(state.filter === m.id),
      onclick: () => { state.filter = m.id; renderFilters(); renderWorks(); },
    }, m.label)));
  }
  $('[data-search]').addEventListener('input', (e) => { state.query = e.target.value.trim(); renderWorks(); });

  async function refresh() {
    const [me, works] = await Promise.all([api('/api/me'), api('/api/works')]);
    state.me = me;
    state.works = works.works;
    renderUser();
    renderStats();
    renderFilters();
    renderWorks();
  }

  // ------------------------------------------------------------ üretim aracı
  const studio = (() => {
    const dlg = $('[data-studio]');
    const s = {
      step: 'input',
      file: null,
      fileUrl: null,
      sample: null,
      job: null,
      work: null,
      pollTimer: null,
      clock: null,
      startedAt: 0,
      lastInputKey: null,
    };

    // --- adımlar
    function show(step) {
      s.step = step;
      $$('[data-step]', dlg).forEach((sec) => { sec.hidden = sec.dataset.step !== step; });
      const order = ['input', 'options', 'result'];
      const current = step === 'loading' || step === 'error' ? 'result' : step;
      const idx = order.indexOf(current);
      $$('[data-step-ind]', dlg).forEach((li) => {
        const i = order.indexOf(li.dataset.stepInd);
        li.classList.toggle('is-current', i === idx);
        li.classList.toggle('is-done', i < idx);
      });
      $('.studio-shell', dlg).scrollTop = 0;
    }

    function open() {
      reset();
      show('input');
      dlg.showModal();
    }

    function reset() {
      stopPolling();
      if (s.fileUrl) URL.revokeObjectURL(s.fileUrl);
      Object.assign(s, { file: null, fileUrl: null, sample: null, job: null, work: null, lastInputKey: null });
      $('[data-file]', dlg).value = '';
      $('[data-dz-preview]', dlg).hidden = true;
      $('[data-dz-change]', dlg).hidden = true;
      $('[data-dz-empty]', dlg).hidden = false;
      $('[data-product-name]', dlg).value = '';
      $('[data-details]', dlg).value = '';
      $('[data-category]', dlg).value = 'gomlek';
      $('[data-lightfix]', dlg).checked = true;
      setChecked('style', 'studio');
      setChecked('market', 'trendyol');
      renderSamples();
      inputError('');
    }

    function close() {
      stopPolling();
      dlg.close();
    }
    $('[data-studio-close]', dlg).addEventListener('click', close);
    dlg.addEventListener('cancel', () => stopPolling());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });

    // --- girdi
    const dz = $('[data-dropzone]', dlg);
    const fileInput = $('[data-file]', dlg);

    function setPreview(url) {
      const img = $('[data-dz-preview]', dlg);
      img.src = url;
      img.hidden = false;
      $('[data-dz-empty]', dlg).hidden = true;
      $('[data-dz-change]', dlg).hidden = false;
    }

    function acceptFile(file) {
      if (!file) return;
      if (!/^image\/(jpeg|png|webp|avif)$/.test(file.type)) return inputError('Lütfen JPG, PNG ya da WEBP formatında bir fotoğraf seç.');
      if (file.size > 15 * 1024 * 1024) return inputError('Fotoğraf en fazla 15 MB olabilir.');
      inputError('');
      if (s.fileUrl) URL.revokeObjectURL(s.fileUrl);
      s.file = file;
      s.sample = null;
      s.fileUrl = URL.createObjectURL(file);
      s.lastInputKey = null;
      setPreview(s.fileUrl);
      renderSamples();
    }

    fileInput.addEventListener('change', () => acceptFile(fileInput.files[0]));
    $('[data-dz-change]', dlg).addEventListener('click', (e) => { e.preventDefault(); fileInput.click(); });
    ['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove('is-over'); }));
    dz.addEventListener('drop', (e) => acceptFile(e.dataTransfer.files[0]));
    dlg.addEventListener('paste', (e) => {
      if (s.step !== 'input') return;
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (item) acceptFile(item.getAsFile());
    });

    function renderSamples() {
      const wrap = $('[data-samples]', dlg);
      wrap.replaceChildren(...state.me.options.samples.map((smp) => el('button', {
        type: 'button',
        role: 'radio',
        'aria-checked': String(s.sample?.id === smp.id),
        class: `sample${s.sample?.id === smp.id ? ' is-active' : ''}`,
        onclick: () => {
          s.sample = smp;
          s.file = null;
          s.lastInputKey = null;
          fileInput.value = '';
          setPreview(smp.url);
          $('[data-product-name]', dlg).value = smp.productName;
          $('[data-category]', dlg).value = smp.category;
          inputError('');
          renderSamples();
        },
      }, el('img', { src: smp.url, alt: '', loading: 'lazy' }), el('span', { text: smp.label }))));
    }

    function inputError(msg) {
      const e = $('[data-input-error]', dlg);
      e.textContent = msg;
      e.hidden = !msg;
    }

    $('[data-to-options]', dlg).addEventListener('click', () => {
      if (!s.file && !s.sample) return inputError('Önce bir fotoğraf yükle ya da örneklerden birini seç.');
      show('options');
    });
    $$('[data-back-input]', dlg).forEach((b) => b.addEventListener('click', () => show('input')));

    // --- seçenekler
    const STYLE_SWATCH = {
      studio: 'linear-gradient(160deg,#fff,#e4e2de)',
      warm: 'linear-gradient(160deg,#f6ebdc,#dcc3a3)',
      pastel: 'linear-gradient(160deg,#e3eef2,#b9cfd8)',
      dark: 'radial-gradient(circle at 50% 35%,#4a4450,#141217)',
      lifestyle: 'linear-gradient(180deg,#d9b9a0 0 78%,#9c7454 78%)',
    };
    function renderOptions() {
      const { styles, markets, categories } = state.me.options;
      $('[data-style-options]', dlg).replaceChildren(...styles.map((st) => el('label', { class: 'opt opt-style' },
        el('input', { type: 'radio', name: 'style', value: st.id, class: 'sr-only' }),
        el('span', { class: 'opt-swatch', style: `background:${STYLE_SWATCH[st.id] || '#333'}`, 'aria-hidden': 'true' }),
        el('span', { class: 'opt-label', text: st.label }))));
      $('[data-market-options]', dlg).replaceChildren(...markets.map((m) => el('label', { class: 'opt opt-market' },
        el('input', { type: 'radio', name: 'market', value: m.id, class: 'sr-only' }),
        el('span', { class: 'ratio', style: `aspect-ratio:${m.width}/${m.height}`, 'aria-hidden': 'true' }),
        el('span', { class: 'opt-text' }, el('strong', { text: m.label }), el('small', { text: `${m.ratio} · ${m.width}×${m.height}` })))));
      $('[data-category]', dlg).replaceChildren(...categories.map((c) => el('option', { value: c.id, text: c.label })));
    }
    function setChecked(name, value) {
      const input = $(`input[name="${name}"][value="${value}"]`, dlg);
      if (input) input.checked = true;
    }
    const checked = (name) => $(`input[name="${name}"]:checked`, dlg)?.value;

    function collectOptions() {
      return {
        style: checked('style') || 'studio',
        market: checked('market') || 'trendyol',
        category: $('[data-category]', dlg).value,
        productName: $('[data-product-name]', dlg).value.trim(),
        details: $('[data-details]', dlg).value.trim(),
        lightFix: $('[data-lightfix]', dlg).checked,
      };
    }

    // --- üretim
    async function generate({ regenerate = false } = {}) {
      const options = collectOptions();
      const inputKey = s.sample ? `sample:${s.sample.id}` : s.file ? `file:${s.file.name}:${s.file.size}:${s.file.lastModified}` : null;
      let data;
      try {
        if (s.job && (regenerate || inputKey === s.lastInputKey)) {
          // Aynı fotoğraf: yeniden yüklemeden, (değişmiş olabilecek) seçeneklerle yeni varyant üret.
          data = await api('/api/jobs', { method: 'POST', body: { fromJobId: s.job.id, overrides: regenerate ? undefined : options } });
        } else if (s.sample) {
          data = await api('/api/jobs', { method: 'POST', body: { ...options, sample: s.sample.id } });
        } else {
          const form = new FormData();
          form.append('image', s.file);
          form.append('options', JSON.stringify(options));
          data = await api('/api/jobs', { method: 'POST', form });
        }
      } catch (err) {
        if (s.step === 'result') toast(err.message, 'error');
        else if (s.step === 'options') { show('input'); inputError(err.message); }
        else showError(err.message);
        return;
      }
      s.lastInputKey = inputKey;
      s.work = null;
      startLoading(data.job);
    }

    function startLoading(job) {
      s.job = job;
      $('[data-loading-img]', dlg).src = s.fileUrl || s.sample?.url || job.inputUrl;
      $('[data-loading-title]', dlg).textContent = 'Üretiliyor';
      renderStages(job);
      show('loading');
      s.startedAt = performance.now();
      stopPolling();
      s.clock = setInterval(() => {
        $('[data-elapsed]', dlg).textContent = nf1.format((performance.now() - s.startedAt) / 1000);
      }, 100);
      poll();
    }

    function renderStages(job) {
      const list = $('[data-stage-list]', dlg);
      const stages = job.stages.slice(1);
      const current = job.stageIndex - 1;
      list.replaceChildren(...stages.map((st, i) => el('li', {
        class: i < current || job.status === 'done' ? 'is-done' : i === current ? 'is-current' : '',
      }, el('span', { class: 'stage-dot', 'aria-hidden': 'true' }), st.label)));
      const pct = job.status === 'done' ? 100 : Math.max(4, ((current + 0.5) / stages.length) * 100);
      $('[data-progress]', dlg).style.width = `${pct}%`;
      $('[data-loading-title]', dlg).textContent = job.status === 'queued'
        ? `Sırada bekliyor${job.queuePosition ? ` (${job.queuePosition}. sıra)` : ''}`
        : 'Üretiliyor';
    }

    async function poll() {
      if (!s.job) return;
      let data;
      try {
        data = await api(`/api/jobs/${s.job.id}`);
      } catch (err) {
        if (err.status === 401) return;
        s.pollTimer = setTimeout(poll, 2000);
        return;
      }
      if (!dlg.open || data.job.id !== s.job.id) return;
      s.job = data.job;
      renderStages(data.job);
      if (data.job.status === 'done') {
        stopPolling();
        setTimeout(() => showResult(data.job), reduceMotion ? 0 : 350);
      } else if (data.job.status === 'failed') {
        stopPolling();
        showError(data.job.error);
      } else {
        s.pollTimer = setTimeout(poll, 900);
      }
    }

    function stopPolling() {
      clearTimeout(s.pollTimer);
      clearInterval(s.clock);
      s.pollTimer = null;
      s.clock = null;
    }

    function showError(msg) {
      $('[data-error-text]', dlg).textContent = msg || 'Bilinmeyen bir hata oluştu.';
      show('error');
    }
    $('[data-retry]', dlg).addEventListener('click', () => generate({ regenerate: Boolean(s.job) }));

    // --- sonuç
    const compare = $('[data-compare]', dlg);
    const range = $('[data-compare-range]', dlg);
    range.addEventListener('input', () => compare.style.setProperty('--pos', `${range.value}%`));

    function showResult(job, { saved = false } = {}) {
      s.job = job;
      const r = job.result;
      range.value = 50;
      compare.style.setProperty('--pos', '50%');
      compare.style.setProperty('--ar', String(r.width / r.height));
      $('[data-after]', dlg).src = r.imageUrl;
      $('[data-before]', dlg).src = r.beforeUrl;

      const secs = job.durationMs ? `${nf1.format(job.durationMs / 1000)} sn` : '';
      $('[data-result-meta]', dlg).replaceChildren(
        el('span', { class: 'meta-item' }, el('span', { class: 'swatch', style: `background:${r.color.hex}`, 'aria-hidden': 'true' }), `Algılanan renk: ${r.color.name}`),
        el('span', { class: 'meta-item', text: `${label('styles', r.style)} · ${label('markets', r.market)} ${r.width}×${r.height}` }),
        secs ? el('span', { class: 'meta-item', text: `${secs.replace(' sn', '')} saniyede üretildi` }) : null,
      );

      const l = r.listing;
      $('[data-listing-kicker]', dlg).textContent = `${label('markets', r.market)} ilanı`;
      $('[data-source-badge]', dlg).textContent = l.source === 'claude' ? 'Claude ile yazıldı' : 'Şablon motoru';
      const title = $('[data-result-title]', dlg);
      title.value = saved && s.work ? s.work.title : l.title;
      updateCount();
      $('[data-result-bullets]', dlg).replaceChildren(...l.bullets.map((b) => el('li', { text: b })));
      $('[data-result-attrs]', dlg).replaceChildren(...l.attributes.map((a) => el('div', {}, el('dt', { text: a.name }), el('dd', { text: a.value }))));
      $('[data-result-keywords]', dlg).replaceChildren(...l.keywords.map((k) => el('span', { class: 'kw', text: k })));

      const jpg = $('[data-download-jpg]', dlg);
      jpg.href = `${r.imageUrl}&download=1`;
      $('[data-download-png]', dlg).href = `${r.cutoutUrl}&download=1`;

      const saveBtn = $('[data-save]', dlg);
      saveBtn.hidden = saved;
      saveBtn.disabled = false;
      saveBtn.textContent = 'Kaydet';
      $('[data-delete]', dlg).hidden = !saved;
      $('[data-regenerate]', dlg).hidden = false;
      $('[data-change-options]', dlg).hidden = saved;
      show('result');
    }

    function updateCount() {
      const title = $('[data-result-title]', dlg);
      const market = state.me.options.markets.find((m) => m.id === s.job?.result?.market);
      const max = { trendyol: 100, hepsiburada: 100, amazon: 150, instagram: 90 }[market?.id] || 100;
      const n = title.value.length;
      const count = $('[data-title-count]', dlg);
      count.textContent = `${n} / ${max}`;
      count.classList.toggle('is-over', n > max);
    }
    $('[data-result-title]', dlg).addEventListener('input', updateCount);

    dlg.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-copy]');
      if (!btn || !s.job?.result) return;
      const l = s.job.result.listing;
      const text = btn.dataset.copy === 'title' ? $('[data-result-title]', dlg).value : l.bullets.map((b) => `• ${b}`).join('\n');
      copyText(text, btn);
    });

    $('[data-regenerate]', dlg).addEventListener('click', () => {
      // Kayıtlı bir çalışmadan yeniden üretim yeni bir taslak başlatır.
      s.work = null;
      generate({ regenerate: true });
    });
    $('[data-change-options]', dlg).addEventListener('click', () => {
      setChecked('style', s.job.options.style);
      setChecked('market', s.job.options.market);
      show('options');
    });

    $('[data-save]', dlg).addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Kaydediliyor…';
      try {
        const data = await api(`/api/jobs/${s.job.id}/save`, { method: 'POST', body: { title: $('[data-result-title]', dlg).value } });
        state.works = [data.work, ...state.works.filter((w) => w.id !== data.work.id)];
        state.me.stats = data.stats;
        renderWorks();
        renderStats();
        close();
        toast('Kütüphaneye eklendi');
        const first = $('[data-works="recent"] .work');
        if (first && !reduceMotion) first.classList.add('is-new');
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Kaydet';
      }
    });

    $('[data-delete]', dlg).addEventListener('click', async () => {
      if (!s.work || !confirm('Bu çalışma kütüphaneden kaldırılsın mı?')) return;
      try {
        const data = await api(`/api/works/${s.work.id}`, { method: 'DELETE' });
        state.works = state.works.filter((w) => w.id !== s.work.id);
        state.me.stats = data.stats;
        renderWorks();
        renderStats();
        close();
        toast('Kütüphaneden kaldırıldı');
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    function openWork(work) {
      if (!work.job?.result) return toast('Bu çalışmanın görseli bulunamadı.', 'error');
      reset();
      s.work = work;
      s.lastInputKey = `job:${work.job.id}`;
      dlg.showModal();
      showResult(work.job, { saved: true });
    }

    // Çalışan bir üretim varken pencere kapatılırsa sonuç geldiğinde haber ver.
    dlg.addEventListener('close', () => {
      const job = s.job;
      if (job && (job.status === 'queued' || job.status === 'running')) watchInBackground(job.id);
    });

    async function watchInBackground(id) {
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        let data;
        try { data = await api(`/api/jobs/${id}`); } catch { return; }
        if (data.job.status === 'done') {
          const node = el('div', { class: 'toast toast-ok is-in', role: 'status' },
            'Görselin hazır. ',
            el('button', {
              type: 'button',
              class: 'toast-link',
              onclick: () => { node.remove(); reset(); dlg.showModal(); showResult(data.job); },
            }, 'Sonucu aç'));
          $('[data-toasts]').append(node);
          setTimeout(() => node.remove(), 12000);
          refresh().catch(() => {});
          return;
        }
        if (data.job.status === 'failed') { toast(data.job.error, 'error'); return; }
      }
    }

    $('[data-generate]', dlg).addEventListener('click', () => generate());

    return { open, openWork, renderOptions };
  })();

  $$('[data-open-studio]').forEach((b) => b.addEventListener('click', () => studio.open()));

  // ------------------------------------------------------------ başlat
  setView(location.hash.slice(1) || 'panel', false);
  // Arka planda süren üretimler varsa (ör. demo hesabının ilk açılışı) bitene kadar paneli tazele.
  let pendingTries = 0;
  async function followPending() {
    if (!state.me?.stats.pendingJobs || pendingTries++ > 40) return;
    setTimeout(async () => {
      try { await refresh(); } catch { return; }
      followPending();
    }, 3000);
  }

  refresh()
    .then(() => {
      studio.renderOptions();
      if (state.view === 'model3d') ensureModel3d();
      followPending();
    })
    .catch((err) => toast(err.message, 'error'));
})();
