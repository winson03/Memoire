// Mémoire service worker — one job: while a new version is going live, Render
// answers with its own 502/503/504 page (or nothing at all). For page loads
// only, show our "Your library is developing" page instead; it checks
// /healthz every few seconds and reloads the page once the site is back.
// Everything else (API calls, media, uploads) goes straight to the network.
const CACHE = 'memoire-updating-v1';
const ASSETS = ['/offline.html', '/img/logo.png', '/img/favicon-32.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('memoire-updating-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function serverUp() {
  try {
    const r = await fetch('/healthz?t=' + Date.now(), { cache: 'no-store' });
    return r.ok;
  } catch (_) { return false; }
}

async function updatingPage() {
  const hit = await caches.match('/offline.html');
  return hit
    ? new Response(hit.body, { status: 503, statusText: 'Updating', headers: hit.headers })
    : new Response('Mémoire is updating — try again in a minute.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && req.method === 'GET' && ASSETS.includes(url.pathname) && url.pathname !== '/offline.html') {
    // The updating page's own pictures: network first, cache when the server is down.
    event.respondWith(fetch(req).catch(() => caches.match(url.pathname)));
    return;
  }
  if (req.mode !== 'navigate' || req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        // The app sends its own 502s too (e.g. a photo that failed to load).
        // Only treat it as an update when the server itself isn't answering.
        if (await serverUp()) return res;
        return updatingPage();
      }
      return res;
    } catch (_) {
      // No answer at all (server restarting, or this device is offline —
      // the page itself tells the two apart).
      return updatingPage();
    }
  })());
});
