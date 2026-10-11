// Üretim işleri: sıraya alınır, sınırlı eşzamanlılıkla çalıştırılır; istemci durumu yoklar (polling).
import path from 'node:path';
import { db, save } from './db.js';
import { config } from './config.js';
import { newId } from './auth.js';
import { runPipeline, PipelineError } from './pipeline/process.js';

export const STAGES = [
  { key: 'queued', label: 'Sıraya alındı' },
  { key: 'prepare', label: 'Fotoğraf hazırlanıyor' },
  { key: 'segment', label: 'Ürün arka plandan ayrılıyor' },
  { key: 'light', label: 'Işık ve renk dengeleniyor' },
  { key: 'compose', label: 'Sahne ve gölgeler oluşturuluyor' },
  { key: 'export', label: 'Pazaryeri ölçülerinde dışa aktarılıyor' },
  { key: 'text', label: 'İlan metni yazılıyor' },
];
const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));

const queue = [];
let running = 0;
const listeners = new Map(); // jobId -> Set<fn>

export function userDir(userId) {
  return path.join(config.dataDir, 'files', userId);
}

export function jobDir(job) {
  return path.join(userDir(job.userId), job.id);
}

export function createJob({ userId, inputFile, options, parentId = null }) {
  const job = {
    id: newId('job'),
    userId,
    parentId,
    status: 'queued',
    stage: 'queued',
    options,
    inputFile, // kullanıcı klasörüne göre göreli yol
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    result: null,
    error: null,
  };
  db.jobs.push(job);
  save();
  queue.push(job.id);
  pump();
  return job;
}

export function onJobDone(jobId, fn) {
  if (!listeners.has(jobId)) listeners.set(jobId, new Set());
  listeners.get(jobId).add(fn);
}

function emitDone(job) {
  const set = listeners.get(job.id);
  if (!set) return;
  listeners.delete(job.id);
  for (const fn of set) {
    try { fn(job); } catch (err) { console.error(err); }
  }
}

function pump() {
  while (running < config.jobConcurrency && queue.length) {
    const id = queue.shift();
    const job = db.jobs.find((j) => j.id === id);
    if (!job) continue;
    running++;
    run(job).finally(() => {
      running--;
      pump();
    });
  }
}

async function run(job) {
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  save();
  const t0 = Date.now();
  try {
    const result = await runPipeline(
      {
        inputPath: path.join(userDir(job.userId), job.inputFile),
        outDir: jobDir(job),
        options: job.options,
      },
      (stage) => {
        job.stage = stage;
        save();
      },
    );
    job.result = result;
    job.status = 'done';
  } catch (err) {
    job.status = 'failed';
    job.error = err instanceof PipelineError ? err.message : 'Görsel üretilirken beklenmeyen bir hata oluştu. Lütfen tekrar dene.';
    if (!(err instanceof PipelineError)) console.error(`[job ${job.id}]`, err);
  } finally {
    job.durationMs = Date.now() - t0;
    job.finishedAt = new Date().toISOString();
    save();
    emitDone(job);
  }
}

/** Sunucu yeniden başladığında yarım kalan işleri başarısız say. */
export function recoverJobs() {
  for (const job of db.jobs) {
    if (job.status === 'queued' || job.status === 'running') {
      job.status = 'failed';
      job.error = 'Sunucu yeniden başlatıldığı için üretim yarıda kaldı. Lütfen tekrar dene.';
      job.finishedAt = new Date().toISOString();
    }
  }
  save();
}

const fileUrl = (job, name) => `/files/${job.id}/${name}?v=${encodeURIComponent(job.finishedAt || '')}`;

export function publicJob(job) {
  const out = {
    id: job.id,
    parentId: job.parentId,
    status: job.status,
    stage: job.stage,
    stageIndex: STAGE_INDEX[job.stage] ?? 0,
    stages: STAGES,
    options: job.options,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    durationMs: job.durationMs,
    error: job.error,
    inputUrl: `/files/${job.id}/input`,
  };
  if (job.status === 'queued') out.queuePosition = queue.indexOf(job.id) + 1;
  if (job.status === 'done') {
    out.result = {
      ...job.result,
      imageUrl: fileUrl(job, 'result.jpg'),
      beforeUrl: fileUrl(job, 'before.jpg'),
      thumbUrl: fileUrl(job, 'thumb.webp'),
      cutoutUrl: fileUrl(job, 'cutout.png'),
    };
  }
  return out;
}
