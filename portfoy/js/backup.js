// Şifreli otomatik yedek: veri telefonda AES-GCM ile şifrelenir, GitHub'daki gizli bir Gist'e yazılır.
// Parola cihazdan çıkmaz; GitHub yalnızca şifreli metni görür. Gist her güncellemede eski sürümü saklar.
const CFG_KEY = 'portfoy.yedek';
const FILE = 'portfoyum-yedek.json';
const DESC = 'Portföyüm şifreli yedek (otomatik)';
const ITER = 310000;
const API = 'https://api.github.com';

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function loadCfg() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || null; } catch { return null; }
}
function saveCfg(c) {
  try { if (c) localStorage.setItem(CFG_KEY, JSON.stringify(c)); else localStorage.removeItem(CFG_KEY); } catch { /* depolama yok */ }
}
export const disable = () => saveCfg(null);

async function deriveBits(pass, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, base, 256);
}
const aesKey = (bits) => crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);

export async function encrypt(obj, keyB64, saltB64) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(unb64(keyB64));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { v: 1, app: 'portfoyum', alg: 'AES-GCM-256', kdf: 'PBKDF2-SHA256', iter: ITER, salt: saltB64, iv: b64(iv), data: b64(data), tarih: new Date().toISOString() };
}

export async function decrypt(box, pass) {
  const bits = await deriveBits(pass, unb64(box.salt));
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, await aesKey(bits), unb64(box.data));
    return { obj: JSON.parse(new TextDecoder().decode(plain)), keyB64: b64(bits) };
  } catch {
    throw new Error('Parola yanlış ya da yedek bozuk');
  }
}

async function gh(token, path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (res.status === 401) throw new Error('GitHub anahtarı geçersiz ya da süresi dolmuş');
  if (res.status === 403 || res.status === 404) throw new Error('GitHub anahtarının "gist" izni yok');
  if (!res.ok) throw new Error(`GitHub hatası: ${res.status}`);
  return res.json();
}

async function findGist(token) {
  for (let page = 1; page <= 5; page++) {
    const list = await gh(token, `/gists?per_page=100&page=${page}`);
    const g = list.find((x) => x.files?.[FILE]);
    if (g) return g;
    if (list.length < 100) break;
  }
  return null;
}

async function readGist(token, id) {
  const g = await gh(token, `/gists/${id}`);
  const f = g.files?.[FILE];
  if (!f) throw new Error('Yedek dosyası bulunamadı');
  const text = f.truncated ? await (await fetch(f.raw_url)).text() : f.content;
  return JSON.parse(text);
}

async function hash(obj) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(obj)));
  return b64(d);
}

// İlk kurulum: yeni parola ile anahtar üretir; hesapta eski bir yedek varsa onun üzerine yazmadan önce sorar
export async function setup({ token, pass }, state, confirmOverwrite) {
  await gh(token, '/user');
  const existing = await findGist(token);
  let salt;
  if (existing) {
    const box = await readGist(token, existing.id);
    try {
      await decrypt(box, pass); // aynı parola: mevcut yedeği kullanmaya devam
      salt = box.salt;
    } catch {
      if (!(await confirmOverwrite())) throw new Error('Kurulum iptal edildi');
    }
  }
  salt ||= b64(crypto.getRandomValues(new Uint8Array(16)));
  const keyB64 = b64(await deriveBits(pass, unb64(salt)));
  saveCfg({ token, salt, key: keyB64, gistId: existing?.id || null, last: null, lastHash: null, error: null });
  return backupNow(state, { force: true });
}

// Yedek al: veri değişmediyse ağ isteği yapmaz
export async function backupNow(state, { force = false } = {}) {
  const c = loadCfg();
  if (!c) return { skipped: 'kurulu değil' };
  const h = await hash(state);
  if (!force && h === c.lastHash) return { skipped: 'değişiklik yok' };
  try {
    const box = await encrypt(state, c.key, c.salt);
    const body = JSON.stringify({ description: DESC, files: { [FILE]: { content: JSON.stringify(box) } } });
    let g;
    if (c.gistId) {
      try { g = await gh(c.token, `/gists/${c.gistId}`, { method: 'PATCH', body }); }
      catch (e) { if (!/izni yok/.test(e.message)) throw e; c.gistId = null; }
    }
    if (!c.gistId) g = await gh(c.token, '/gists', { method: 'POST', body: JSON.stringify({ ...JSON.parse(body), public: false }) });
    saveCfg({ ...c, gistId: g.id, last: new Date().toISOString(), lastHash: h, error: null });
    return { ok: true };
  } catch (e) {
    saveCfg({ ...c, error: e.message, errorAt: new Date().toISOString() });
    return { error: e.message };
  }
}

// Başka cihazda geri yükleme: anahtar + parola ile yedeği bulur, çözer ve otomatik yedeği o cihazda da açar
export async function restore({ token, pass }) {
  const g = await findGist(token);
  if (!g) throw new Error('Bu GitHub hesabında Portföyüm yedeği bulunamadı');
  const box = await readGist(token, g.id);
  const { obj, keyB64 } = await decrypt(box, pass);
  saveCfg({ token, salt: box.salt, key: keyB64, gistId: g.id, last: box.tarih, lastHash: await hash(obj), error: null });
  return { state: obj, tarih: box.tarih };
}

let timer = null;
// Veri her değiştiğinde çağrılır; art arda değişiklikleri tek yedekte toplar
export function schedule(getState, onDone, delay = 4000) {
  if (!loadCfg()) return;
  clearTimeout(timer);
  timer = setTimeout(async () => onDone?.(await backupNow(getState())), delay);
}
