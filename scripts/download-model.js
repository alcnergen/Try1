// Segmentasyon modelini (IS-Net general use, Apache-2.0) models/ klasörüne indirir.
// Kaynak: rembg projesinin GitHub sürümleri.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { config } from '../server/config.js';

const URL = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx';
const SHA256 = '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a';
const target = config.modelPath;

function verify(file) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return hash === SHA256;
}

if (fs.existsSync(target) && verify(target)) {
  console.log(`Model zaten hazır: ${path.relative(process.cwd(), target)}`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
const tmp = `${target}.download`;
console.log('Model indiriliyor (~170 MB)…');
// curl, kurumsal vekil sunucu (HTTPS_PROXY) ayarlarını kendiliğinden kullanır.
execFileSync('curl', ['-fL', '--retry', '3', '-o', tmp, URL], { stdio: 'inherit' });
if (!verify(tmp)) {
  fs.rmSync(tmp, { force: true });
  console.error('İndirilen dosyanın SHA-256 özeti eşleşmedi; indirme iptal edildi.');
  process.exit(1);
}
fs.renameSync(tmp, target);
console.log(`Model kaydedildi: ${path.relative(process.cwd(), target)}`);
