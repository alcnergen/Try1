// Basit, dosya tabanlı JSON veri deposu. Tek süreçli MVP için yeterli;
// yazımlar birleştirilir ve geçici dosya + rename ile atomik yapılır.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const file = path.join(config.dataDir, 'db.json');
const EMPTY = { users: [], sessions: [], jobs: [], works: [] };

let state = structuredClone(EMPTY);
let writeTimer = null;
let writing = Promise.resolve();

export function load() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (fs.existsSync(file)) {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    state = { ...structuredClone(EMPTY), ...parsed };
  }
  return state;
}

export function save() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const snapshot = JSON.stringify(state);
    writing = writing.then(async () => {
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.promises.writeFile(tmp, snapshot);
      await fs.promises.rename(tmp, file);
    }).catch((err) => console.error('[db] yazma hatası', err));
  }, 50);
}

/** Bekleyen yazımı hemen diske geçirir (kapanışta). */
export async function flush() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file);
  }
  await writing;
}

export const db = {
  get users() { return state.users; },
  get sessions() { return state.sessions; },
  get jobs() { return state.jobs; },
  get works() { return state.works; },
  set sessions(v) { state.sessions = v; },
  set works(v) { state.works = v; },
};
