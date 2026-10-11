import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  root,
  port: Number(process.env.PORT) || 3000,
  isProduction: process.env.NODE_ENV === 'production',
  dataDir: path.resolve(process.env.DATA_DIR || path.join(root, 'data')),
  modelPath: path.resolve(process.env.MODEL_PATH || path.join(root, 'models', 'isnet-general-use.onnx')),
  inferenceThreads: Number(process.env.INFERENCE_THREADS) || Math.max(1, Math.min(4, os.cpus().length)),
  jobConcurrency: Number(process.env.JOB_CONCURRENCY) || 1,
  maxUploadBytes: 15 * 1024 * 1024,
  sessionDays: 30,
  monthlyQuota: 250,
  demo: { email: 'demo@vitrin.app', password: 'vitrin2026', name: 'Ayşe Demir', store: 'Demir Butik' },
};
