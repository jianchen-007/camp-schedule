const CACHE = 'camp-app-v11';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './map.jpg', './qr-code.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// The schedule changes daily during camp week, so serve fresh content whenever
// there's signal: try the network (3s budget), cache the response, and fall
// back to the saved copy only when offline or slow.
const NETWORK_TIMEOUT_MS = 3000;

function fetchAndCache(request) {
  return fetch(request).then(res => {
    if (res && res.ok && new URL(request.url).origin === location.origin) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(request, copy));
    }
    return res;
  });
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    new Promise(resolve => {
      let settled = false;
      const useCache = () => caches.match(e.request, { ignoreSearch: true });

      const timer = setTimeout(() => {
        useCache().then(cached => {
          if (cached && !settled) { settled = true; resolve(cached); }
          // No cached copy: leave the network request to settle this fetch.
        });
      }, NETWORK_TIMEOUT_MS);

      fetchAndCache(e.request)
        .then(res => {
          clearTimeout(timer);
          if (!settled) { settled = true; resolve(res); }
        })
        .catch(() => {
          clearTimeout(timer);
          useCache().then(cached => {
            if (!settled) { settled = true; resolve(cached || Response.error()); }
          });
        });
    })
  );
});
