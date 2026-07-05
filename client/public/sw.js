// Minimal offline cache for the app shell so solo play works offline.
// Network-first for navigations, cache-first for other same-origin GETs.
const CACHE = 'qix-v1';

// Resolve URLs relative to the SW location so it works under any base path
// (root for local/Render, "/<repo>/" for GitHub Pages project sites).
const ROOT = new URL('./', self.location).href;
const SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Never cache the WebSocket upgrade or cross-origin requests.
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.endsWith('/ws')) {
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(ROOT, copy));
          return res;
        })
        .catch(() => caches.match(ROOT).then((r) => r || caches.match(new URL('./index.html', self.location).href))),
    );
    return;
  }
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
