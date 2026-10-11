// Vitrin sunucusu: tanıtım sitesi + giriş + panel + üretim API'si.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { config } from './config.js';
import { load, flush, db, save } from './db.js';
import {
  login, logout, readToken, userFromRequest, requireUser, setSessionCookie, clearSessionCookie,
  publicUser, ensureUser, AuthError, newId,
} from './auth.js';
import { createJob, publicJob, recoverJobs, userDir, jobDir, onJobDone } from './jobs.js';
import { STYLES } from './pipeline/backgrounds.js';
import { MARKETS, CATEGORIES, claudeEnabled } from './pipeline/listing.js';
import { modelAvailable, warmup } from './pipeline/segment.js';

load();
recoverJobs();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// ---------------------------------------------------------------- güvenlik başlıkları
const indexHtml = fs.readFileSync(path.join(config.root, 'index.html'), 'utf8');
const panelHtml = fs.readFileSync(path.join(config.root, 'server', 'views', 'panel.html'), 'utf8');
const kurumsalHtml = fs.readFileSync(path.join(config.root, 'kurumsal.html'), 'utf8');
// Satır içi betikler (sayfa başı sınıfı, import map) CSP'ye özetleriyle izinli.
const inlineScripts = [indexHtml, panelHtml, kurumsalHtml]
  .flatMap((html) => [...html.matchAll(/<script(?: type="importmap")?>([\s\S]*?)<\/script>/g)])
  .map((m) => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
const CSP = [
  "default-src 'self'",
  `script-src 'self' ${inlineScripts.join(' ')}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  next();
});

// Durum değiştiren API çağrılarında başka bir siteden gelen istekleri reddet (CSRF).
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.headers.origin;
  let host = null;
  try { host = origin ? new URL(origin).host : null; } catch { host = 'invalid'; }
  if (origin && host !== req.headers.host) {
    return res.status(403).json({ error: 'Geçersiz istek kaynağı.' });
  }
  next();
});

// ---------------------------------------------------------------- sayfalar
const view = (name) => path.join(config.root, 'server', 'views', name);
const noStore = (res) => res.setHeader('Cache-Control', 'no-store');

app.get('/giris', (req, res) => {
  if (userFromRequest(req)) return res.redirect('/panel');
  noStore(res);
  res.sendFile(view('giris.html'));
});
app.get('/kayit', (req, res) => res.redirect('/giris?kayit=1'));
app.get('/panel', (req, res) => {
  if (!userFromRequest(req)) return res.redirect('/giris?next=%2Fpanel');
  noStore(res);
  res.sendFile(view('panel.html'));
});

const staticOpts = { index: false, maxAge: config.isProduction ? '7d' : 0 };
app.use('/app', express.static(path.join(config.root, 'app'), staticOpts));
for (const dir of ['css', 'js', 'img', 'fonts']) {
  app.use(`/${dir}`, express.static(path.join(config.root, dir), staticOpts));
}
// three.js modülleri (3B görüntüleyici için), import map ile /vendor/three altından yüklenir.
const threeDir = path.join(config.root, 'node_modules', 'three');
app.use('/vendor/three/addons', express.static(path.join(threeDir, 'examples', 'jsm'), staticOpts));
app.use('/vendor/three', express.static(path.join(threeDir, 'build'), staticOpts));
app.get('/favicon.svg', (req, res) => res.sendFile(path.join(config.root, 'favicon.svg')));
app.get('/', (req, res) => res.type('html').send(indexHtml));
app.get('/kurumsal', (req, res) => res.type('html').send(kurumsalHtml));

// ---------------------------------------------------------------- yardımcılar
app.use('/api', express.json({ limit: '32kb' }));

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

function statsFor(user) {
  const start = monthStart();
  const imageJobs = db.jobs.filter((j) => j.userId === user.id && j.kind !== '3d');
  const done = imageJobs.filter((j) => j.status === 'done');
  const thisMonth = done.filter((j) => j.finishedAt >= start).length;
  const works = db.works.filter((w) => w.userId === user.id);
  const recent = done.slice(-20);
  const avgMs = recent.length ? recent.reduce((s, j) => s + j.durationMs, 0) / recent.length : 0;
  return {
    generatedThisMonth: thisMonth,
    quota: config.monthlyQuota,
    remaining: Math.max(0, config.monthlyQuota - thisMonth),
    savedWorks: works.length,
    minutesSaved: works.length * 25,
    avgSeconds: Math.round(avgMs / 100) / 10,
    pendingJobs: imageJobs.filter((j) => j.status === 'queued' || j.status === 'running').length,
    models3d: db.jobs.filter((j) => j.userId === user.id && j.kind === '3d' && j.status === 'done').length,
  };
}

function publicWork(work) {
  const job = db.jobs.find((j) => j.id === work.jobId);
  return {
    id: work.id,
    title: work.title,
    style: work.style,
    market: work.market,
    createdAt: work.createdAt,
    job: job ? publicJob(job) : null,
  };
}

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------------------------------------------------------------- oturum
app.post('/api/auth/login', asyncRoute(async (req, res) => {
  try {
    const { user, token, expiresAt, created } = await login(req.body?.email, req.body?.password);
    setSessionCookie(res, token, expiresAt);
    res.json({ user: publicUser(user), created });
  } catch (err) {
    if (err instanceof AuthError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
}));

app.post('/api/auth/logout', (req, res) => {
  logout(readToken(req));
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', requireUser, (req, res) => {
  res.json({
    user: publicUser(req.user),
    stats: statsFor(req.user),
    options: {
      styles: Object.entries(STYLES).map(([id, s]) => ({ id, label: s.label })),
      markets: Object.entries(MARKETS).map(([id, m]) => ({ id, label: m.label, width: m.width, height: m.height, ratio: m.ratio })),
      categories: Object.entries(CATEGORIES).map(([id, c]) => ({ id, label: c.label })),
      samples: SAMPLES.map(({ id, label, category, productName }) => ({ id, label, category, productName, url: `/app/samples/${id}.jpg` })),
    },
    engine: { segmentation: modelAvailable(), listing: claudeEnabled() ? 'claude' : 'template' },
  });
});

// ---------------------------------------------------------------- üretim
const SAMPLES = [
  { id: 'gomlek', label: 'Keten gömlek', category: 'gomlek', productName: 'Kadın keten gömlek uzun kol' },
  { id: 'elbise', label: 'Puantiyeli elbise', category: 'elbise', productName: 'Kadın puantiyeli midi elbise' },
  { id: 'kazak', label: 'Örgü kazak', category: 'kazak', productName: 'Kadın saç örgü desenli kazak' },
  { id: 'ceket', label: 'Kot ceket', category: 'ceket', productName: 'Unisex klasik kot ceket' },
  { id: 'canta', label: 'Deri çanta', category: 'canta', productName: 'Kadın deri el çantası' },
  { id: 'sneaker', label: 'Sneaker', category: 'ayakkabi', productName: 'Unisex beyaz deri sneaker' },
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 20 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});
const ACCEPTED = new Set(['jpeg', 'png', 'webp', 'avif', 'heif', 'tiff']);

function parseOptions(body) {
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const options = {
    style: STYLES[body.style] ? body.style : 'studio',
    market: MARKETS[body.market] ? body.market : 'trendyol',
    category: CATEGORIES[body.category] ? body.category : 'diger',
    productName: str(body.productName, 120),
    details: str(body.details, 500),
    lightFix: !(body.lightFix === false || body.lightFix === 'false'),
    variant: 0,
  };
  return options;
}

function guardQuota(user, res) {
  if (statsFor(user).remaining <= 0) {
    res.status(402).json({ error: 'Bu ayki görsel hakkın doldu. Planını yükselterek devam edebilirsin.' });
    return false;
  }
  return guardCapacity(user, res);
}

function guardCapacity(user, res) {
  const active = db.jobs.filter((j) => j.userId === user.id && (j.status === 'queued' || j.status === 'running')).length;
  if (active >= 3) {
    res.status(429).json({ error: 'Aynı anda en fazla 3 üretim çalıştırabilirsin. Birinin bitmesini bekle.' });
    return false;
  }
  if (!modelAvailable()) {
    res.status(503).json({ error: 'Görsel motoru hazır değil (segmentasyon modeli yüklenmemiş).' });
    return false;
  }
  return true;
}

async function storeInput(user, buffer, ext) {
  const rel = path.join('inputs', `${newId('in')}.${ext}`);
  const abs = path.join(userDir(user.id), rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, buffer);
  return rel;
}

const handleUpload = (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Fotoğraf en fazla 15 MB olabilir.' : 'Fotoğraf yüklenemedi.';
      return res.status(400).json({ error: msg });
    }
    next();
  });
};

function readBody(req) {
  let body = req.body || {};
  if (typeof body.options === 'string') {
    try { body = { ...body, ...JSON.parse(body.options) }; } catch { /* yok say */ }
  }
  return body;
}

/** Yüklenen dosyayı ya da seçilen örneği doğrulayıp kullanıcı klasörüne yazar. Hata varsa yanıtı gönderir ve null döner. */
async function readInputFile(req, res, body, user) {
  if (body.sample) {
    const sample = SAMPLES.find((s) => s.id === body.sample);
    if (!sample) { res.status(400).json({ error: 'Örnek fotoğraf bulunamadı.' }); return null; }
    const buf = await fsp.readFile(path.join(config.root, 'app', 'samples', `${sample.id}.jpg`));
    return storeInput(user, buf, 'jpg');
  }
  if (!req.file) {
    res.status(400).json({ error: 'Bir fotoğraf yükle ya da örnek fotoğraflardan birini seç.' });
    return null;
  }
  let meta;
  try {
    meta = await sharp(req.file.buffer).metadata();
  } catch {
    res.status(400).json({ error: 'Bu dosya okunamadı. JPG, PNG ya da WEBP formatında bir fotoğraf yükle.' });
    return null;
  }
  if (!ACCEPTED.has(meta.format)) { res.status(400).json({ error: 'Desteklenmeyen format. JPG, PNG ya da WEBP yükle.' }); return null; }
  if (Math.min(meta.width, meta.height) < 300) { res.status(400).json({ error: 'Fotoğraf çok küçük; en az 300 piksel genişlik/yükseklik gerekli.' }); return null; }
  return storeInput(user, req.file.buffer, meta.format === 'jpeg' ? 'jpg' : meta.format);
}

app.post('/api/jobs', requireUser, handleUpload, asyncRoute(async (req, res) => {
  const user = req.user;
  const body = readBody(req);

  // Yeniden üret: önceki işin girdisini ve seçeneklerini kullan, yeni bir varyant iste.
  if (body.fromJobId) {
    const parent = db.jobs.find((j) => j.id === body.fromJobId && j.userId === user.id && j.kind !== '3d');
    if (!parent) return res.status(404).json({ error: 'Kaynak üretim bulunamadı.' });
    if (!guardQuota(user, res)) return;
    const siblings = db.jobs.filter((j) => j.inputFile === parent.inputFile).length;
    const options = { ...parent.options, ...(body.overrides ? parseOptions({ ...parent.options, ...body.overrides }) : {}), variant: siblings };
    const job = createJob({ userId: user.id, inputFile: parent.inputFile, options, parentId: parent.id });
    return res.status(202).json({ job: publicJob(job) });
  }

  const options = parseOptions(body);
  if (!guardQuota(user, res)) return;
  const inputFile = await readInputFile(req, res, body, user);
  if (!inputFile) return;
  const job = createJob({ userId: user.id, inputFile, options });
  res.status(202).json({ job: publicJob(job) });
}));

// Görselden 3B model. Görsel hakkından düşmez; yaklaşık bir dakika sürer.
app.post('/api/3d/jobs', requireUser, handleUpload, asyncRoute(async (req, res) => {
  const user = req.user;
  const body = readBody(req);
  if (!guardCapacity(user, res)) return;
  const inputFile = await readInputFile(req, res, body, user);
  if (!inputFile) return;
  const job = createJob({ userId: user.id, inputFile, kind: '3d' });
  res.status(202).json({ job: publicJob(job) });
}));

app.get('/api/jobs/:id', requireUser, (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id && j.userId === req.user.id);
  if (!job) return res.status(404).json({ error: 'Üretim bulunamadı.' });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ job: publicJob(job) });
});

app.post('/api/jobs/:id/save', requireUser, (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id && j.userId === req.user.id);
  if (!job) return res.status(404).json({ error: 'Üretim bulunamadı.' });
  if (job.kind === '3d') return res.status(400).json({ error: '3B modeller kütüphaneye kaydedilmez; GLB olarak indirebilirsin.' });
  if (job.status !== 'done') return res.status(409).json({ error: 'Üretim henüz tamamlanmadı.' });
  let work = db.works.find((w) => w.jobId === job.id);
  if (!work) {
    work = {
      id: newId('wrk'),
      userId: req.user.id,
      jobId: job.id,
      title: (typeof req.body?.title === 'string' && req.body.title.trim().slice(0, 150)) || job.result.listing.title,
      style: job.result.style,
      market: job.result.market,
      createdAt: new Date().toISOString(),
    };
    db.works.push(work);
    save();
  }
  res.status(201).json({ work: publicWork(work), stats: statsFor(req.user) });
});

app.get('/api/works', requireUser, (req, res) => {
  const works = db.works
    .filter((w) => w.userId === req.user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(publicWork);
  res.json({ works });
});

app.delete('/api/works/:id', requireUser, asyncRoute(async (req, res) => {
  const work = db.works.find((w) => w.id === req.params.id && w.userId === req.user.id);
  if (!work) return res.status(404).json({ error: 'Kayıt bulunamadı.' });
  db.works = db.works.filter((w) => w.id !== work.id);
  save();
  res.json({ ok: true, stats: statsFor(req.user) });
}));

// Kullanıcıya ait üretim dosyaları (yalnızca sahibi görebilir).
const FILES = new Set(['result.jpg', 'before.jpg', 'thumb.webp', 'cutout.png', 'model.glb', 'input']);
app.get('/files/:jobId/:name', (req, res) => {
  const user = userFromRequest(req);
  if (!user) return res.status(401).end();
  const job = db.jobs.find((j) => j.id === req.params.jobId && j.userId === user.id);
  if (!job || !FILES.has(req.params.name)) return res.status(404).end();
  const file = req.params.name === 'input'
    ? path.join(userDir(user.id), job.inputFile)
    : path.join(jobDir(job), req.params.name);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  if (req.params.name === 'model.glb') res.type('model/gltf-binary');
  if (req.query.download) {
    const ext = path.extname(file) || '.jpg';
    res.attachment(`vitrin-${job.id.slice(4, 12)}${req.params.name === 'cutout.png' ? '-seffaf' : ''}${ext}`);
  }
  res.sendFile(file, (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

// ---------------------------------------------------------------- hata ve 404
app.use('/api', (req, res) => res.status(404).json({ error: 'Bulunamadı.' }));
app.use((req, res) => res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><title>Sayfa bulunamadı</title><p style="font-family:sans-serif;padding:40px">Sayfa bulunamadı. <a href="/">Ana sayfaya dön</a></p>'));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith('/api')) return res.status(500).json({ error: 'Sunucu hatası. Lütfen tekrar dene.' });
  res.status(500).send('Sunucu hatası');
});

// ---------------------------------------------------------------- demo hesabı
async function seedDemo() {
  const demo = await ensureUser(config.demo);
  if (db.works.some((w) => w.userId === demo.id) || db.jobs.some((j) => j.userId === demo.id)) return;
  if (!modelAvailable()) return;
  const plan = [
    ['gomlek', { style: 'studio', market: 'trendyol', details: '%100 keten, regular fit, S-M-L-XL' }],
    ['canta', { style: 'dark', market: 'amazon', details: 'Hakiki deri, altın rengi kilit' }],
    ['kazak', { style: 'lifestyle', market: 'instagram', details: 'Yumuşak örme, oversize' }],
    ['elbise', { style: 'warm', market: 'hepsiburada', details: 'Viskon, kemerli, S-M-L' }],
  ];
  console.log('[demo] Demo hesabı için örnek çalışmalar üretiliyor…');
  for (const [i, [id, extra]] of plan.entries()) {
    const sample = SAMPLES.find((s) => s.id === id);
    const buf = await fsp.readFile(path.join(config.root, 'app', 'samples', `${id}.jpg`));
    const inputFile = await storeInput(demo, buf, 'jpg');
    const job = createJob({
      userId: demo.id,
      inputFile,
      options: parseOptions({ ...extra, category: sample.category, productName: sample.productName }),
    });
    onJobDone(job.id, (done) => {
      if (done.status !== 'done') return;
      db.works.push({
        id: newId('wrk'),
        userId: demo.id,
        jobId: done.id,
        title: done.result.listing.title,
        style: done.result.style,
        market: done.result.market,
        // Panelde farklı günlere yayılmış görünsün.
        createdAt: new Date(Date.now() - (plan.length - i) * 26 * 3600e3).toISOString(),
      });
      save();
    });
  }
}

// ---------------------------------------------------------------- başlat
const server = app.listen(config.port, async () => {
  console.log(`Vitrin http://localhost:${config.port} adresinde çalışıyor`);
  console.log(`  segmentasyon modeli: ${modelAvailable() ? 'hazır' : 'YOK — npm run model'}`);
  console.log(`  ilan metni: ${claudeEnabled() ? 'Claude (ANTHROPIC_API_KEY)' : 'şablon motoru'}`);
  try {
    await warmup();
    await seedDemo();
  } catch (err) {
    console.error('[başlangıç]', err);
  }
});

async function shutdown() {
  server.close();
  await flush();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { app };
