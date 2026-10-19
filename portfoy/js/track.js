// Otomatik takip: uygulamada yeni bir fon/hisse eklenince kodu depodaki data/config.json'a yazar.
// Bu yazma (push) GitHub Actions'ı tetikler; fiyat geçmişi birkaç dakika içinde data/series altına gelir.
const KEY = 'portfoy.github';
const API = 'https://api.github.com';
const PATH = 'portfoy/data/config.json';

// Uygulamanın yayınlandığı adresten depo bilgisi (ör. alcnergen.github.io/Try1 → alcnergen/Try1)
export function repoInfo(loc = location) {
  const owner = loc.hostname.endsWith('.github.io') ? loc.hostname.split('.')[0] : 'alcnergen';
  const repo = (loc.hostname.endsWith('.github.io') && loc.pathname.split('/')[1]) || 'Try1';
  return { owner, repo };
}

export function loadToken() {
  try { return JSON.parse(localStorage.getItem(KEY))?.token || null; } catch { return null; }
}
export function saveToken(token) {
  try { if (token) localStorage.setItem(KEY, JSON.stringify({ token })); else localStorage.removeItem(KEY); } catch { /* yok */ }
}

const enc = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const dec = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

async function gh(token, path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (res.status === 401) throw Object.assign(new Error('GitHub anahtarı geçersiz ya da süresi dolmuş'), { code: 'auth' });
  if (res.status === 403 || res.status === 404) throw Object.assign(new Error('GitHub anahtarının bu depoya yazma izni yok'), { code: 'perm' });
  if (res.status === 409) throw Object.assign(new Error('Aynı anda başka bir güncelleme oldu'), { code: 'conflict' });
  if (!res.ok) throw new Error(`GitHub hatası: ${res.status}`);
  return res.status === 204 ? null : res.json();
}

const codeOf = (e) => String(typeof e === 'string' ? e : e.kod).toUpperCase().trim();

export function isTracked(cfg, code) {
  return [...(cfg.fonlar || []), ...(cfg.hisseler || [])].some((e) => codeOf(e) === code);
}

// Yeni kodu doğru listeye ekler: TEFAS fonu → "fonlar", hisse/ETF → "hisseler"
export function addToConfig(cfg, code, kind) {
  if (isTracked(cfg, code)) return false;
  const list = kind === 'fon' ? 'fonlar' : 'hisseler';
  cfg[list] = [...(cfg[list] || []), code];
  return true;
}

// Anahtarın depoya yazabildiğini doğrular (değişiklik yapmadan)
export async function verify(token) {
  const { owner, repo } = repoInfo();
  const r = await gh(token, `/repos/${owner}/${repo}`);
  if (!r?.permissions?.push) throw Object.assign(new Error('GitHub anahtarının bu depoya yazma izni yok'), { code: 'perm' });
  return true;
}

export async function track(token, code, kind) {
  const { owner, repo } = repoInfo();
  for (let attempt = 0; attempt < 3; attempt++) {
    const file = await gh(token, `/repos/${owner}/${repo}/contents/${PATH}?ref=master`);
    const cfg = JSON.parse(dec(file.content));
    if (!addToConfig(cfg, code, kind)) return 'zaten';
    try {
      await gh(token, `/repos/${owner}/${repo}/contents/${PATH}`, {
        method: 'PUT',
        body: JSON.stringify({ message: `Takibe ekle: ${code}`, content: enc(JSON.stringify(cfg, null, 2) + '\n'), sha: file.sha, branch: 'master' }),
      });
      return 'eklendi';
    } catch (e) {
      if (e.code !== 'conflict') throw e; // veri iş akışı aynı anda yazdıysa tekrar dene
    }
  }
  throw new Error('Takip listesi güncellenemedi, biraz sonra tekrar dene');
}

// "Şimdi çek": küçük bir istek dosyası yazar; bu push veri iş akışını hemen çalıştırır
export async function requestFetch(token) {
  const { owner, repo } = repoInfo();
  const path = 'portfoy/data/istek.json';
  let sha;
  try { sha = (await gh(token, `/repos/${owner}/${repo}/contents/${path}?ref=master`)).sha; } catch (e) { if (e.code !== 'perm') throw e; }
  await gh(token, `/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({ message: 'Fiyat çekimi isteği', content: enc(JSON.stringify({ istek: new Date().toISOString() }) + '\n'), branch: 'master', ...(sha ? { sha } : {}) }),
  });
}
