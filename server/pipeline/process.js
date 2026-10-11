// Ana üretim hattı: fotoğraf → maske → ışık/renk dengeleme → sahne + gölge → çıktılar + ilan metni.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { segment } from './segment.js';
import { backgroundSvg, STYLES } from './backgrounds.js';
import { dominantColor } from './color.js';
import { generateListing, MARKETS } from './listing.js';

const WORK_SIZE = 1600;

export class PipelineError extends Error {}

/** Arka plan piksellerinden renk kaymasını ve ürünün pozlamasını tahmin eder. */
function estimateCorrection(rgb, alpha) {
  let br = 0;
  let bg = 0;
  let bb = 0;
  let bn = 0;
  const lum = [];
  for (let i = 0; i < alpha.length; i += 2) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    if (alpha[i] < 16) { br += r; bg += g; bb += b; bn++; } else if (alpha[i] > 230) {
      lum.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
    }
  }
  const wb = [1, 1, 1];
  if (bn > 500) {
    const mean = [br / bn, bg / bn, bb / bn];
    const gray = (mean[0] + mean[1] + mean[2]) / 3;
    // Arka planın nötr olduğunu varsayan gri-dünya düzeltmesi; ürünün rengini bozmamak için yarı şiddette ve sınırlı.
    for (let c = 0; c < 3; c++) wb[c] = Math.min(1.18, Math.max(0.85, 1 + 0.55 * (gray / Math.max(1, mean[c]) - 1)));
  }
  let exposure = 1;
  if (lum.length > 200) {
    lum.sort((x, y) => x - y);
    const p97 = lum[Math.floor(lum.length * 0.97)];
    if (p97 < 220) exposure = Math.min(1.15, 226 / Math.max(1, p97));
  }
  return { wb, gains: wb.map((g) => g * exposure), exposure };
}

function refineAlpha(mask) {
  const out = Buffer.alloc(mask.length);
  for (let i = 0; i < mask.length; i++) {
    // Yumuşak eşik: zayıf olasılıkları temizle, kenarları keskinleştir.
    const v = (mask[i] - 28) / (226 - 28);
    out[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * v * (3 - 2 * v) * 255);
  }
  return out;
}

function boundingBox(alpha, width, height) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  let count = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (alpha[row + x] > 127) {
        count++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, coverage: count / (width * height) };
}

/**
 * @param {object} job
 * @param {(stage: string) => void} onStage
 */
export async function runPipeline(job, onStage) {
  const { inputPath, outDir, options } = job;
  const market = MARKETS[options.market] ? options.market : 'trendyol';
  const style = STYLES[options.style] ? options.style : 'studio';
  const variant = options.variant || 0;
  const { width: W, height: H } = MARKETS[market];

  // 1) Hazırlık
  onStage('prepare');
  const { data: rgb, info } = await sharp(inputPath, { failOn: 'error' })
    .rotate()
    .resize(WORK_SIZE, WORK_SIZE, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  // 2) Segmentasyon
  onStage('segment');
  const alpha = refineAlpha(await segment(rgb, width, height));
  const box = boundingBox(alpha, width, height);
  if (!box || box.coverage < 0.01) {
    throw new PipelineError('Fotoğrafta belirgin bir ürün bulamadık. Ürünün kadrajın ortasında ve tamamen göründüğü bir fotoğraf dene.');
  }

  // 3) Işık ve renk
  onStage('light');
  const lightFix = options.lightFix !== false;
  const correction = lightFix ? estimateCorrection(rgb, alpha) : { wb: [1, 1, 1], gains: [1, 1, 1], exposure: 1 };
  const corrected = await sharp(rgb, { raw: { width, height, channels: 3 } })
    .linear(correction.gains, [0, 0, 0])
    .modulate({ saturation: lightFix ? 1.04 : 1 })
    .raw()
    .toBuffer();
  // Renk adı, pozlama artışından etkilenmesin diye yalnızca beyaz dengesi uygulanmış piksellerden hesaplanır.
  const color = dominantColor(rgb, alpha, correction.wb);

  // 4) Sahne kurulumu
  onStage('compose');
  const fill = STYLES[style].fill;
  const scale = Math.min((W * fill) / box.w, (H * fill) / box.h);
  const pw = Math.max(1, Math.round(box.w * scale));
  const ph = Math.max(1, Math.round(box.h * scale));
  const left = Math.round((W - pw) / 2);
  const top = Math.round(Math.min((H - ph) / 2 + H * 0.02, H - ph - H * 0.04));

  const crop = { left: box.x, top: box.y, width: box.w, height: box.h };
  // sharp, joinChannel'ı yeniden boyutlandırmadan sonra uygular; bu yüzden önce ayrı bir adımda birleştiriyoruz.
  const fullRgba = await sharp(corrected, { raw: { width, height, channels: 3 } })
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .png({ compressionLevel: 1 })
    .toBuffer();
  const productRgba = await sharp(fullRgba)
    .extract(crop)
    .resize(pw, ph, { kernel: 'lanczos3' })
    .sharpen({ sigma: 0.6 })
    .png()
    .toBuffer();
  const productAlpha = await sharp(productRgba).extractChannel(3).raw().toBuffer();

  // Gölgeler: yumuşak yansıyan gölge + zemine temas gölgesi
  const shadowStrength = style === 'dark' ? 0.55 : 0.26;
  const blur = Math.max(4, Math.round(Math.min(W, H) * 0.018));
  const pad = blur * 3;
  const shadowAlpha = Buffer.alloc(pw * ph);
  for (let i = 0; i < shadowAlpha.length; i++) shadowAlpha[i] = Math.round(productAlpha[i] * shadowStrength);
  const shadowLayer = await sharp({ create: { width: pw, height: ph, channels: 3, background: '#000' } })
    .joinChannel(shadowAlpha, { raw: { width: pw, height: ph, channels: 1 } })
    .png({ compressionLevel: 1 })
    .toBuffer();
  const dropShadow = await sharp(shadowLayer)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .blur(blur)
    .png()
    .toBuffer();
  const ew = Math.round(pw * 0.75);
  const eh = Math.max(6, Math.round(ph * 0.05));
  const contact = await sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ew + pad * 2}" height="${eh + pad * 2}">
      <ellipse cx="${ew / 2 + pad}" cy="${eh / 2 + pad}" rx="${ew / 2}" ry="${eh / 2}" fill="#000" fill-opacity="${style === 'dark' ? 0.6 : 0.3}"/></svg>`,
  )).blur(Math.max(3, blur * 0.8)).png().toBuffer();

  const background = await sharp(backgroundSvg(style, W, H, variant)).resize(W, H).png().toBuffer();
  const offsetY = Math.round(H * 0.012);
  const resultImage = sharp(background).composite([
    { input: contact, left: Math.round(W / 2 - ew / 2 - pad), top: Math.min(H - eh - pad * 2, top + ph - Math.round(eh / 2) - pad), blend: 'multiply' },
    { input: dropShadow, left: left - pad, top: top - pad + offsetY, blend: 'multiply' },
    { input: productRgba, left, top },
  ]);

  // "Önce" görseli: orijinal fotoğraf, ürünü sonuçla aynı yere ve ölçeğe getirecek şekilde yerleştirilir.
  const sw = Math.round(width * scale);
  const sh = Math.round(height * scale);
  const ox = left - Math.round(box.x * scale);
  const oy = top - Math.round(box.y * scale);
  const scaledOriginal = await sharp(rgb, { raw: { width, height, channels: 3 } }).resize(sw, sh).png().toBuffer();
  const beforeBase = await sharp(rgb, { raw: { width, height, channels: 3 } })
    .resize(W, H, { fit: 'cover' })
    .blur(30)
    .modulate({ brightness: 0.85 })
    .png()
    .toBuffer();
  const ix0 = Math.max(0, ox);
  const iy0 = Math.max(0, oy);
  const ix1 = Math.min(W, ox + sw);
  const iy1 = Math.min(H, oy + sh);
  const beforeLayers = [];
  if (ix1 > ix0 && iy1 > iy0) {
    beforeLayers.push({
      input: await sharp(scaledOriginal).extract({ left: ix0 - ox, top: iy0 - oy, width: ix1 - ix0, height: iy1 - iy0 }).toBuffer(),
      left: ix0,
      top: iy0,
    });
  }

  // 5) Dosyalar
  onStage('export');
  await fs.mkdir(outDir, { recursive: true });
  const resultPath = path.join(outDir, 'result.jpg');
  await resultImage.clone().jpeg({ quality: 90, mozjpeg: true }).toFile(resultPath);
  await sharp(beforeBase).composite(beforeLayers).jpeg({ quality: 84, mozjpeg: true }).toFile(path.join(outDir, 'before.jpg'));
  await sharp(resultPath).resize(600).webp({ quality: 80 }).toFile(path.join(outDir, 'thumb.webp'));
  await sharp(productRgba).png({ compressionLevel: 9 }).toFile(path.join(outDir, 'cutout.png'));

  // 6) İlan metni
  onStage('text');
  const preview = await sharp(resultPath).resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 82 }).toBuffer();
  const listing = await generateListing({
    imageJpeg: preview,
    productName: options.productName,
    details: options.details,
    category: options.category,
    market,
    colorName: color.name,
    variant,
  });

  return {
    width: W,
    height: H,
    market,
    style,
    color,
    correction: { exposure: Number(correction.exposure.toFixed(2)), lightFix },
    coverage: Number(box.coverage.toFixed(3)),
    listing,
  };
}
