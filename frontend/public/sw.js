// BUSGO Transit Service Worker (v1.0.0)
// Offline protection for Kenyan Highway Dead Zones (Great Rift Valley, Kinungi, Salgaa, Tsavo)

const CACHE_NAME = 'busgo-cache-v1';
const STATIC_ASSETS = [
  '/',
  '/driver',
  '/dispatcher',
  '/onboard',
  '/lost-found',
  '/radar',
  '/ussd',
  '/user',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
];

// Install event: cache essential app shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Best effort cache - don't fail entire install if one route fails (e.g. dynamic auth)
      for (const asset of STATIC_ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn('[SW] Could not pre-cache asset:', asset, err);
        }
      }
      return self.skipWaiting();
    })
  );
});

// Activate event: clean up stale caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log('[SW] Clearing old cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event: Network-first for pages with offline cache fallback; Cache-first for images & static scripts
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Ignore non-GET requests or browser extension schemes
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }

  // API calls & WebSocket bypass cache (IndexedDB offlineStore handles API data offline)
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) {
    return;
  }

  // Navigation (HTML document requests): Network first, fallback to cached page
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cachedResponse = await caches.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }
          // Fallback to cached driver or user page if specifically navigating there
          if (url.pathname.startsWith('/driver')) {
            const driverFallback = await caches.match('/driver');
            if (driverFallback) return driverFallback;
          }
          if (url.pathname.startsWith('/user')) {
            const userFallback = await caches.match('/user');
            if (userFallback) return userFallback;
          }
          const rootFallback = await caches.match('/');
          if (rootFallback) return rootFallback;

          // Offline dead-zone fallback HTML
          return new Response(
            `<!DOCTYPE html>
            <html lang="en">
              <head>
                <meta charset="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <title>BUSGO — Offline Mode</title>
                <style>
                  body { background: #090c15; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; text-align: center; }
                  .card { background: #111827; border: 1px solid #1e293b; border-radius: 1.5rem; padding: 2rem; max-width: 440px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
                  h1 { color: #06b6d4; font-size: 1.5rem; margin-bottom: 0.5rem; }
                  p { color: #94a3b8; font-size: 0.875rem; line-height: 1.5; }
                  .badge { display: inline-block; background: rgba(245,158,11,0.15); color: #fbbf24; border: 1px solid rgba(245,158,11,0.3); border-radius: 9999px; padding: 4px 12px; font-size: 0.75rem; font-weight: bold; margin-bottom: 1rem; }
                  button { background: #06b6d4; color: #090c15; border: none; border-radius: 0.75rem; padding: 10px 20px; font-weight: bold; cursor: pointer; margin-top: 1rem; }
                </style>
              </head>
              <body>
                <div class="card">
                  <div class="badge">⚡ HIGHWAY DEAD ZONE DETECTED</div>
                  <h1>BUSGO Offline Protection</h1>
                  <p>You are currently in a cellular dead zone. If you are a driver or conductor, your previously cached manifest and offline QR boarding scanner remain functional.</p>
                  <button onclick="window.location.reload()">Retry Connection 🔄</button>
                </div>
              </body>
            </html>`,
            { headers: { 'Content-Type': 'text/html' } }
          );
        })
    );
    return;
  }

  // Static assets (Next.js chunks, images, icons, fonts): Cache-first with background network update
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Asynchronously update cache in background
        fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse));
            }
          })
          .catch(() => {});
        return cachedResponse;
      }
      return fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return networkResponse;
      });
    })
  );
});

