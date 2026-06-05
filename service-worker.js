// Self-destructing service worker.
// Replaces the previous SW that cached the old RepNet site.
// Once installed, it clears all caches, unregisters itself, and
// reloads every open client so the SWA 301 redirect can fire.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (_) {}
    try {
      await self.registration.unregister();
    } catch (_) {}
    const clientList = await self.clients.matchAll({ type: 'window' });
    for (const client of clientList) {
      try {
        client.navigate(client.url);
      } catch (_) {
        try { client.postMessage({ type: 'sw-killed' }); } catch (_) {}
      }
    }
  })());
});

self.addEventListener('fetch', (event) => {
  // Pass everything straight to the network; never serve cached responses.
  event.respondWith(fetch(event.request).catch(() => Response.error()));
});
