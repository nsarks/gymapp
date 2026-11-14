// App shell cache. The shell opens from cache straight away and refreshes itself in the background.
const CACHE = 'gymlog-shell-v1';

async function refreshShell() {
  const cache = await caches.open(CACHE);
  const res = await fetch('./index.html', { cache: 'no-store' });
  if (!res.ok) throw new Error('shell fetch failed');
  const html = await res.clone().text();
  const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^(https?:|data:)/.test(u));
  await Promise.all(urls.map(async (u) => { if (!(await cache.match(u))) await cache.add(u).catch(() => {}); }));
  await cache.put('./index.html', res);
}

self.addEventListener('install', (e) => e.waitUntil(refreshShell().then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cached = await caches.match('./index.html');
      if (cached) { e.waitUntil(refreshShell().catch(() => {})); return cached; }
      return fetch(req);
    })());
    return;
  }
  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    const res = await fetch(req);
    if (res.ok) { const copy = res.clone(); e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy))); }
    return res;
  })());
});
