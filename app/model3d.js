// Vitrin — panelde "3B model" bölümü: görsel yükle → üretim (adımlar + ilerleme) → döndürülebilir görüntüleyici.
const STORE_KEY = 'vitrin.m3d.job';
const nf = new Intl.NumberFormat('tr-TR');

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function store(id) {
  try {
    if (id) sessionStorage.setItem(STORE_KEY, id);
    else sessionStorage.removeItem(STORE_KEY);
  } catch { /* gizli mod vb. */ }
}
function stored() {
  try { return sessionStorage.getItem(STORE_KEY); } catch { return null; }
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function init({ api, toast, samples }) {
  const root = $('[data-view="model3d"]');
  const out = $('[data-m3d-output]', root);
  const drop = $('[data-m3d-drop]', root);
  const fileInput = $('[data-m3d-file]', root);
  const generateBtn = $('[data-m3d-generate]', root);

  const s = {
    file: null,
    fileUrl: null,
    sample: null,
    job: null,
    pollTimer: null,
    raf: null,
    sync: null, // { at: performance.now(), elapsed, expected }
    viewer: null,
    visible: true,
  };

  // ---------------------------------------------------------- durumlar
  function setState(state) {
    out.dataset.state = state;
    $$('[data-m3d-state]', out).forEach((el) => { el.hidden = el.dataset.m3dState !== state; });
    const busy = state === 'loading';
    generateBtn.disabled = busy;
    generateBtn.classList.toggle('is-busy', busy);
    if (s.viewer) s.viewer.pause(state !== 'done' || !s.visible);
  }

  function error(msg) {
    const e = $('[data-m3d-error]', root);
    e.textContent = msg;
    e.hidden = !msg;
  }

  // ---------------------------------------------------------- girdi
  function setPreview(url) {
    const img = $('[data-m3d-preview]', root);
    img.src = url;
    img.hidden = false;
    $('[data-m3d-empty]', root).hidden = true;
    $('[data-m3d-change]', root).hidden = false;
  }

  function acceptFile(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp|avif)$/.test(file.type)) return error('Lütfen JPG, PNG ya da WEBP formatında bir görsel seç.');
    if (file.size > 15 * 1024 * 1024) return error('Görsel en fazla 15 MB olabilir.');
    error('');
    if (s.fileUrl) URL.revokeObjectURL(s.fileUrl);
    s.file = file;
    s.sample = null;
    s.fileUrl = URL.createObjectURL(file);
    setPreview(s.fileUrl);
    renderSamples();
  }

  fileInput.addEventListener('change', () => acceptFile(fileInput.files[0]));
  $('[data-m3d-change]', root).addEventListener('click', (e) => { e.preventDefault(); fileInput.click(); });
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (e) => acceptFile(e.dataTransfer.files[0]));

  function renderSamples() {
    const wrap = $('[data-m3d-samples]', root);
    wrap.replaceChildren(...samples.map((smp) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `sample${s.sample?.id === smp.id ? ' is-active' : ''}`;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(s.sample?.id === smp.id));
      const img = document.createElement('img');
      img.src = smp.url;
      img.alt = '';
      img.loading = 'lazy';
      const label = document.createElement('span');
      label.textContent = smp.label;
      b.append(img, label);
      b.addEventListener('click', () => {
        s.sample = smp;
        s.file = null;
        fileInput.value = '';
        error('');
        setPreview(smp.url);
        renderSamples();
      });
      return b;
    }));
  }
  renderSamples();

  // ---------------------------------------------------------- üretim
  generateBtn.addEventListener('click', async () => {
    if (!s.file && !s.sample) return error('Önce bir görsel yükle ya da örneklerden birini seç.');
    error('');
    let data;
    try {
      if (s.sample) {
        data = await api('/api/3d/jobs', { method: 'POST', body: { sample: s.sample.id } });
      } else {
        const form = new FormData();
        form.append('image', s.file);
        data = await api('/api/3d/jobs', { method: 'POST', form });
      }
    } catch (err) {
      return error(err.message);
    }
    start(data.job, s.fileUrl || s.sample?.url);
  });

  function start(job, previewUrl) {
    s.job = job;
    store(job.id);
    $('[data-m3d-demo]', out).hidden = true;
    const img = $('[data-m3d-loading-img]', out);
    img.src = previewUrl || job.inputUrl;
    img.classList.remove('is-cutout');
    renderStages(job);
    syncClock(job);
    setState('loading');
    // Dar ekranda çıktı alanı girdinin altında kalır; üretim başlayınca oraya kaydır.
    if (matchMedia('(max-width: 860px)').matches) out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    tick();
    poll();
  }

  function syncClock(job) {
    s.sync = { at: performance.now(), elapsed: job.elapsedMs || 0, expected: job.expectedMs || 60000 };
  }

  function renderStages(job) {
    const stages = job.stages.slice(1);
    const current = job.stageIndex - 1;
    $('[data-m3d-stages]', out).replaceChildren(...stages.map((st, i) => {
      const li = document.createElement('li');
      li.className = job.status === 'done' || i < current ? 'is-done' : i === current ? 'is-current' : '';
      const dot = document.createElement('span');
      dot.className = 'stage-dot';
      dot.setAttribute('aria-hidden', 'true');
      li.append(dot, st.label);
      return li;
    }));
    // Nesne ayrıldıktan sonra kesilmiş görseli göster.
    if (job.cutoutUrl) {
      const img = $('[data-m3d-loading-img]', out);
      if (!img.classList.contains('is-cutout')) {
        img.src = job.cutoutUrl;
        img.classList.add('is-cutout');
      }
    }
  }

  // İlerleme çubuğu sunucunun bildirdiği süreye göre akıcı ilerler (her yoklamada yeniden eşitlenir).
  function tick() {
    cancelAnimationFrame(s.raf);
    const frame = () => {
      if (!s.sync || out.dataset.state !== 'loading') return;
      const elapsed = s.sync.elapsed + (performance.now() - s.sync.at);
      const p = Math.min(0.99, elapsed / s.sync.expected);
      const pct = Math.floor(p * 100);
      const bar = $('[data-m3d-bar]', out);
      $('span', bar).style.width = `${p * 100}%`;
      bar.setAttribute('aria-valuenow', String(pct));
      $('[data-m3d-pct]', out).textContent = nf.format(pct);
      const left = Math.max(0, Math.ceil((s.sync.expected - elapsed) / 1000));
      $('[data-m3d-eta]', out).textContent = left > 0 ? `Tahmini kalan süre: ${left} sn` : 'Son dokunuşlar yapılıyor…';
      s.raf = requestAnimationFrame(frame);
    };
    s.raf = requestAnimationFrame(frame);
  }

  async function poll() {
    clearTimeout(s.pollTimer);
    if (!s.job) return;
    let data;
    try {
      data = await api(`/api/jobs/${s.job.id}`);
    } catch (err) {
      if (err.status === 404) { store(null); setState('empty'); return; }
      s.pollTimer = setTimeout(poll, 2000);
      return;
    }
    const job = data.job;
    if (job.id !== s.job?.id) return;
    s.job = job;
    renderStages(job);
    if (job.status === 'running') syncClock(job);
    if (job.status === 'done') {
      finish(job);
    } else if (job.status === 'failed') {
      store(null);
      $('[data-m3d-error-text]', out).textContent = job.error || 'Bilinmeyen bir hata oluştu.';
      setState('error');
    } else {
      s.pollTimer = setTimeout(poll, 800);
    }
  }

  async function finish(job) {
    $('[data-m3d-bar] span', out).style.width = '100%';
    $('[data-m3d-pct]', out).textContent = '100';
    const r = job.result;
    $('[data-m3d-download]', out).href = `${r.modelUrl}&download=1`;
    $('[data-m3d-meta]', out).textContent = `GLB · ${nf.format(Math.round(r.sizeBytes / 1024))} KB`;
    $('[data-m3d-demo]', out).hidden = r.provider !== 'demo';

    const container = $('[data-m3d-viewer]', out);
    if (!webglAvailable()) {
      setState('done');
      container.classList.add('no-webgl');
      $('.m3d-hint', container).textContent = 'Tarayıcın WebGL desteklemiyor; modeli GLB olarak indirip başka bir görüntüleyicide açabilirsin.';
      return;
    }
    try {
      if (!s.viewer) {
        const { createViewer } = await import('./viewer3d.js');
        s.viewer = createViewer(container);
      }
      setState('done');
      await s.viewer.load(r.modelUrl);
      const rotate = $('[data-m3d-rotate]', out);
      rotate.setAttribute('aria-pressed', String(s.viewer.autoRotate));
      toast('3B modelin hazır');
    } catch (err) {
      console.error(err);
      $('[data-m3d-error-text]', out).textContent = 'Model yüklenemedi. Sayfayı yenileyip tekrar dene.';
      setState('error');
    }
  }

  // ---------------------------------------------------------- görüntüleyici araçları
  $('[data-m3d-rotate]', out).addEventListener('click', (e) => {
    if (!s.viewer) return;
    const on = !s.viewer.autoRotate;
    s.viewer.setAutoRotate(on);
    e.currentTarget.setAttribute('aria-pressed', String(on));
  });
  $$('[data-m3d-zoom]', out).forEach((b) => b.addEventListener('click', () => {
    s.viewer?.zoom(b.dataset.m3dZoom === 'in' ? 0.8 : 1.25);
  }));
  $('[data-m3d-reset]', out).addEventListener('click', () => s.viewer?.reset());

  // Bölüm görünür değilken çizimi durdur.
  window.addEventListener('vitrin:view', (e) => {
    s.visible = e.detail.view === 'model3d';
    if (s.viewer) s.viewer.pause(!s.visible || out.dataset.state !== 'done');
  });

  // ---------------------------------------------------------- sayfa yenilenirse kaldığı yerden devam et
  const last = stored();
  if (last) {
    api(`/api/jobs/${last}`).then(({ job }) => {
      if (job.kind !== '3d') return store(null);
      setPreview(job.inputUrl);
      if (job.status === 'running' || job.status === 'queued') start(job, job.inputUrl);
      else if (job.status === 'done') { s.job = job; finish(job); }
      else store(null);
    }).catch(() => store(null));
  }

  return {
    setVisible(v) { s.visible = v; },
  };
}
