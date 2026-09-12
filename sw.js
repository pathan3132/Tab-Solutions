const CACHE_NAME = 'ktc-app-cache-v1'; // Files change karne par ye number badhao (v2, v3...) taaki purana cache clear ho
// REMINDER: Jab bhi naya update deploy karein — is number ko badhao (v2 -> v3...)
// AUR script.js mein APP_VERSION + APP_CHANGELOG bhi update karo, taaki:
//   1. Sabhi users ko purana cache clear hokar naye files (turant) milein
//   2. Sabko "What's New" popup mein dikhe ki kya update hua hai

const APP_SHELL = [
  './',
  'index.html',
  'style.css',
  'script.js',
  'manifest.json',
  'Images/ATC_Logo.png'
];

// INSTALL: App ke zaroori files ko cache me daal do
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// ACTIVATE: Purane cache versions delete kar do
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// FETCH: Google Sheet/Apps Script API calls hamesha LIVE (network) se jayengi — cache nahi karte,
// warna purana/stale data (trips, ledger, docs) dikhega. Baaki sab (HTML/CSS/JS/images) cache-first.
self.addEventListener('fetch', (e) => {
  const url = e.request.url;

  if (e.request.method !== 'GET' || url.includes('script.google.com')) {
    return; // Normal network request hone do, service worker beech me nahi aayega
  }

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const networkFetch = fetch(e.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => cached);

      return cached || networkFetch;
    })
  );
});











