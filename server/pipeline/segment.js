// Ürünü arka plandan ayıran segmentasyon (IS-Net, ONNX Runtime ile CPU üzerinde).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import { config } from '../config.js';

const SIZE = 1024;
let sessionPromise = null;

export function modelAvailable() {
  return fs.existsSync(config.modelPath);
}

function getSession() {
  if (!sessionPromise) {
    if (!modelAvailable()) {
      throw new Error(`Segmentasyon modeli bulunamadı: ${path.relative(process.cwd(), config.modelPath)}. "npm run model" ile indirin.`);
    }
    sessionPromise = ort.InferenceSession.create(config.modelPath, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      intraOpNumThreads: config.inferenceThreads,
    });
  }
  return sessionPromise;
}

/** Modeli önceden belleğe alır; ilk işin beklemesini kısaltır. */
export async function warmup() {
  if (modelAvailable()) await getSession();
}

/**
 * Görüntü için 0-255 arası tek kanallı maske döndürür (ürün = beyaz).
 * @param {Buffer} rgb  width*height*3 ham RGB
 */
export async function segment(rgb, width, height) {
  const session = await getSession();
  const resized = await sharp(rgb, { raw: { width, height, channels: 3 } })
    .resize(SIZE, SIZE, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer();

  // rembg ile aynı normalizasyon: [0,1] aralığı, ortalama 0.5, std 1.0, CHW sırası.
  const plane = SIZE * SIZE;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    input[i] = resized[i * 3] / 255 - 0.5;
    input[plane + i] = resized[i * 3 + 1] / 255 - 0.5;
    input[2 * plane + i] = resized[i * 3 + 2] / 255 - 0.5;
  }
  const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) };
  const out = await session.run(feeds);
  const pred = out[session.outputNames[0]].data;

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < plane; i++) {
    if (pred[i] < min) min = pred[i];
    if (pred[i] > max) max = pred[i];
  }
  const range = max - min || 1;
  const small = Buffer.alloc(plane);
  for (let i = 0; i < plane; i++) small[i] = Math.round(((pred[i] - min) / range) * 255);

  return sharp(small, { raw: { width: SIZE, height: SIZE, channels: 1 } })
    .resize(width, height, { fit: 'fill', kernel: 'cubic' })
    .extractChannel(0)
    .raw()
    .toBuffer();
}
