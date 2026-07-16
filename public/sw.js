// CampusIQ Service Worker — offline support for timetable, results, and careers.
// Uses a NETWORK-FIRST (with cache fallback) strategy for HTML and a
// STALE-WHILE-REVALIDATE strategy for other static assets, so that updates to
// pages such as careers.html are always picked up on the next visit instead of
// being served from a stale cached copy forever.
const CACHE_NAME = 'campusiq-v4';
const RUNTIME_CACHE = 'campusiq-runtime-v4';
const STATIC_ASSETS = [
  '/frontend/index.html',
  '/frontend/careers.html',
  '/shared/api.js',
  '/',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== RUNTIME_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always fetch API calls from network — do NOT mask failures with a fake
  // response, otherwise the frontend can't tell "server down" from "offline".
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => new Response(
        JSON.stringify({ success: false, message: 'API server unavailable' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      ))
    );
    return;
  }

  // Only handle same-origin GET requests.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Network-first for navigations (HTML pages): always try the network so
  // updated pages reach the user; fall back to cache (then landing page) when offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request).then(c => c || caches.match('/frontend/index.html')))
    );
    return;
  }

  // Stale-while-revalidate for other static assets (js, css, images, fonts, etc).
  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request).then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(RUNTIME_CACHE).then(c => c.put(event.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
