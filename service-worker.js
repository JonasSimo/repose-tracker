// RepNet service worker — app shell cache.
// Strategy: stale-while-revalidate for index.html and static assets.
// User sees the cached shell instantly; a background fetch updates the cache so
// the next reload picks up any deploy. Graph / MSAL / SharePoint are never cached.
//
// Bump CACHE_VERSION when shipping a breaking shell change to force a refresh.
const CACHE_VERSION = 'repnet-shell-v20';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
  '/msal-browser.min.js',
  '/chart.umd.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // Best-effort precache. Don't fail install if a single asset 404s.
      Promise.all(SHELL_ASSETS.map((url) => cache.add(url).catch(() => null)))
    )
    // Don't skipWaiting — let users finish their current action before activating new SW
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// URLs that must always go to the network — never cache.
function _bypass(url) {
  return (
    url.includes('graph.microsoft.com') ||
    url.includes('login.microsoftonline.com') ||
    url.includes('sharepoint.com') ||
    url.includes('login.live.com')
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (_bypass(req.url)) return;

  // Stale-while-revalidate for everything else (shell + same-origin static).
  event.respondWith(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req).then((res) => {
          // Only cache same-origin successful responses.
          if (res && res.status === 200 && res.type === 'basic') {
            cache.put(req, res.clone()).catch(() => {});
          }
          return res;
        }).catch(() => cached); // offline fallback
        return cached || network;
      })
    )
  );
});
