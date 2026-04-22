// ============================================================
//  TES Pro Service Worker — v2.0 (Merged & Stabilized)
//  ============================================================
//  Based on App A structure with stability fixes from App B:
//    • Only ONE respondWith() per fetch event
//    • No interception of cross-origin requests (Firebase, Paystack, CDNs)
//    • Cache-first for same-origin assets
//    • Network-first for navigation (HTML)
//    • Safe cloning — never clone a response twice
//    • No pre‑caching of external resources that can't be cloned
// ============================================================

const CACHE_NAME = 'tes-pro-v3';
const OFFLINE_URL = 'index.html';

// Files to pre-cache on install (only same-origin essentials)
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './styles.css',
  './app.js',
  './firebase.js'
];

// ── Install ────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll may fail if one file is missing, but we catch to keep install alive
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[SW] Pre-cache partial failure (non-fatal):', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ── Activate ───────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ──────────────────────────────────────────────────
// Rules to prevent errors:
//   1. Only handle GET requests
//   2. Never intercept cross-origin requests (Firebase, Paystack, CDNs)
//   3. Never intercept chrome-extension or data: URIs
//   4. Navigation requests → network-first, fallback to offline.html
//   5. Same-origin assets → cache-first (served offline)
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Rule 1: Only GET
  if (request.method !== 'GET') return;

  // Rule 2 & 3: Skip cross-origin, chrome-extension, data:
  if (url.origin !== self.location.origin) return;
  if (url.protocol === 'chrome-extension:') return;
  if (url.protocol === 'data:') return;

  // Rule 4: Navigation (HTML pages) → network-first
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache a clone for offline fallback
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
          return response;
        })
        .catch(() => {
          // Offline: serve cached index.html
          return caches.match(OFFLINE_URL);
        })
    );
    return;
  }

  // Rule 5: Same-origin static assets → cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Cache successful responses
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
        }
        return response;
      }).catch(() => {
        // Network failed and no cache → fallback (browser shows its own error)
        return new Response('Offline - content not available', { status: 503, statusText: 'Service Unavailable' });
      });
    })
  );
});
