// Görselden 3B model üretimi.
//
// Şu an yalnızca "demo" sağlayıcısı var: fotoğraf gerçekten hazırlanır ve nesne IS-Net ile arka plandan
// ayrılır (kullanıcıya önizleme olarak gösterilir), ardından aşamalar yaklaşık bir dakikaya yayılır ve
// sonuç olarak projedeki hazır model (app/3d/canta.glb) döndürülür. Gerçek bir görselden-3B servisi
// bağlandığında yalnızca runModel3d içindeki sağlayıcı adımları değişir; API ve arayüz aynı kalır.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';
import { segment } from './segment.js';

export const PROVIDER = process.env.MODEL3D_PROVIDER || 'demo';
export const DEMO_MODEL = path.join(config.root, 'app', '3d', 'canta.glb');
export const TOTAL_MS = Number(process.env.MODEL3D_DURATION_MS) || 60_000;

// Her aşamanın toplam süre içindeki payı (toplam 1).
export const STAGES_3D = [
  { key: 'queued', label: 'Sıraya alındı', share: 0 },
  { key: 'prepare', label: 'Görsel hazırlanıyor', share: 0.07 },
  { key: 'segment', label: 'Nesne arka plandan ayrılıyor', share: 0.13 },
  { key: 'depth', label: 'Derinlik ve biçim tahmin ediliyor', share: 0.23 },
  { key: 'mesh', label: '3B ağ örülüyor', share: 0.27 },
  { key: 'texture', label: 'Doku ve malzemeler işleniyor', share: 0.2 },
  { key: 'optimize', label: 'Model optimize ediliyor', share: 0.1 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

async function cutout(inputPath, outDir) {
  const { data: rgb, info } = await sharp(inputPath)
    .rotate()
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mask = await segment(rgb, info.width, info.height);
  const rgba = await sharp(rgb, { raw: { width: info.width, height: info.height, channels: 3 } })
    .joinChannel(mask, { raw: { width: info.width, height: info.height, channels: 1 } })
    .png({ compressionLevel: 1 })
    .toBuffer();
  await sharp(rgba).trim({ threshold: 1 }).resize(640, 640, { fit: 'inside' }).png().toFile(path.join(outDir, 'cutout.png'));
}

/**
 * @param {{ inputPath: string, outDir: string }} job
 * @param {(stage: string) => void} onStage
 */
export async function runModel3d({ inputPath, outDir }, onStage) {
  await fs.mkdir(outDir, { recursive: true });
  const t0 = Date.now();
  let elapsedShare = 0;
  const stage = async (key, work) => {
    const def = STAGES_3D.find((s) => s.key === key);
    onStage(key);
    if (work) await work();
    elapsedShare += def.share;
    // Aşama, toplam sürenin kendi payına düşen ana kadar sürer (gerçek iş daha uzunsa beklenmez).
    await sleep(t0 + elapsedShare * TOTAL_MS - Date.now());
  };

  await stage('prepare', async () => {
    const meta = await sharp(inputPath).metadata();
    if (!meta.width || !meta.height) throw new Error('Görsel okunamadı');
  });
  await stage('segment', () => cutout(inputPath, outDir));
  await stage('depth');
  await stage('mesh');
  await stage('texture');
  await stage('optimize', () => fs.copyFile(DEMO_MODEL, path.join(outDir, 'model.glb')));

  const { size } = await fs.stat(path.join(outDir, 'model.glb'));
  return { provider: PROVIDER, format: 'glb', sizeBytes: size };
}
