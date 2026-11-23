// App shell cache. The shell opens from cache straight away and refreshes itself in the background.
const CACHE = 'gymlog-shell-v3';
// The test site lives under preview/, inside this worker's scope. Leave it alone so it never gets the real app.
// That includes the address without its last slash, which GitHub Pages redirects.
const PREVIEW = new URL('preview/', self.registration.scope).pathname;
const isPreview = (url) => url.pathname.startsWith(PREVIEW) || url.pathname === PREVIEW.slice(0, -1);

async function refreshShell() {
  const cache = await caches.open(CACHE);
  const res = await fetch('./index.html', { cache: 'no-store' });
  if (!res.ok) throw new Error('shell fetch failed');
  const html = await res.clone().text();
  const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^(https?:|data:)/.test(u));
  await Promise.all(urls.map(async (u) => { if (!(await cache.match(u))) await cache.add(u).catch(() => {}); }));
  await cache.put('./index.html', res);
  // Drop files from older versions so the cache does not keep growing.
  const keep = new Set([...urls, './index.html'].map((u) => new URL(u, self.registration.scope).href));
  for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
}

self.addEventListener('install', (e) => e.waitUntil(refreshShell().then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || isPreview(url)) return;
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
