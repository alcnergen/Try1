// Uygulama dosyaları önbellekten (çevrimdışı açılır); veri dosyaları önce ağdan, olmazsa önbellekten.
const VER = 'portfoy-v27';
const SHELL = ['./', 'index.html', 'app.css', 'js/app.js', 'js/calc.js', 'js/data.js', 'js/store.js', 'js/chart.js', 'js/backup.js', 'js/track.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VER).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VER).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Her şey önce ağdan: veri günceldir, uygulama güncellemesi hemen gelir; çevrimdışıysa önbellek
  e.respondWith(
    // cache: 'no-cache' → tarayıcının HTTP önbelleği atlanır, yeni sürüm hemen gelir
    fetch(e.request, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VER).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
