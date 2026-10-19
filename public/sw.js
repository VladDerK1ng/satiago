// Offline cache: network-first for navigations, cache-first for hashed assets.
const CACHE = 'satiago-v2';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './icon.svg', './apple-touch-icon.png', './icon-192.png', './manifest.webmanifest'])));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // Only the app shell is cached as index.html; other pages (e.g. privacypolicy.html) are not.
    const path = new URL(req.url).pathname;
    const isShell = path.endsWith('/') || path.endsWith('/index.html');
    e.respondWith(
      fetch(req)
        .then((r) => {
          if (isShell && r.ok) caches.open(CACHE).then((c) => c.put('./index.html', r.clone()));
          return r;
        })
        .catch(() => (isShell ? caches.match('./index.html') : caches.match(req))),
    );
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok) caches.open(CACHE).then((c) => c.put(req, r.clone()));
      return r;
    })),
  );
});
