import { readFileSync } from 'node:fs';
import { composite } from './vc.mjs';
const cfg = JSON.parse(readFileSync(new URL('./config.json', import.meta.url)));
for (const b of cfg.kiyaslar) if (b.icerik) {
  const t0 = Date.now();
  try { console.log('IC', b.id, Date.now() - t0, JSON.stringify(await composite(b.icerik))); } catch (e) { console.log('IC', b.id, 'HATA', e.message); }
}
