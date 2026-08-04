const CACHE_NAME = 'dashboard-cache-v65';

// Pre-fetched and cached on install
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './tailwind.css',
  './apple-touch-icon.png',
  './icon-192.png',
  './retjg-logo.png',
];

// CDN + font hosts: versioned/immutable — serve cache-first
function isCdnRequest(hostname) {
  return hostname === 'cdnjs.cloudflare.com' ||
         hostname === 'cdn.jsdelivr.net'      ||
         hostname === 'fonts.googleapis.com'  ||
         hostname === 'fonts.gstatic.com';
}

// API hosts: never intercept — pass straight to network.
// ⚠️ Must match the API host EXACTLY, not by substring. This previously tested
// hostname.includes('retjghub.com'), which is also true for www.retjghub.com and
// the bare apex — i.e. the app's own origin. Every app-shell request therefore
// returned early here and never reached the caching branches below, so the
// precache was dead, offline did not work, and the shell was re-downloaded in
// full on every launch.
function isApiRequest(hostname) {
  return hostname.includes('clover')       ||
         hostname.includes('workers.dev')  ||
         hostname === 'api.retjghub.com'   ||
         hostname === 'api-staging.retjghub.com' ||
         // Google APIs (Sheets, OAuth) but NOT Google Fonts
         (hostname.endsWith('googleapis.com') && !hostname.startsWith('fonts.')) ||
         hostname === 'accounts.google.com';
}

// ── Install: precache app shell ───────────────────────────────────────────────

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    // Bypass the HTTP cache when precaching so a fresh deploy's index.html /
    // tailwind.css are actually re-fetched (not served stale from the browser cache).
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_ASSETS.map(u => new Request(u, { cache: 'reload' }))))
  );
});

// ── Activate: purge old caches ────────────────────────────────────────────────

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Push notification handlers ────────────────────────────────────────────────

self.addEventListener('push', event => {
  let data = { title: 'RETJG HUB', body: 'New update', tag: 'default' };
  if (event.data) {
    try { data = { ...data, ...JSON.parse(event.data.text()) }; }
    catch (e) { data.body = event.data.text(); }
  }
  const options = {
    body: data.body,
    tag: data.tag || 'default',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    requireInteraction: false,
    data: data.url ? { url: data.url } : {},
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || null;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      const appClient = windowClients.find(c =>
        c.url.startsWith(self.registration.scope) || c.url.includes('/index.html')
      );
      if (appClient) {
        return appClient.focus().then(() => {
          if (targetUrl) appClient.postMessage({ type: 'sw-navigate', url: targetUrl });
        });
      }
      const openUrl = targetUrl
        ? (targetUrl.startsWith('/') ? self.registration.scope.replace(/\/$/, '') + targetUrl : targetUrl)
        : self.registration.scope;
      if (clients.openWindow) return clients.openWindow(openUrl);
    })
  );
});

// ── Fetch: tiered caching strategy ───────────────────────────────────────────

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 0. Only GET is cacheable — cache.put() rejects on POST/PUT/DELETE, which
  //    previously produced a swallowed rejection on every non-GET that reached
  //    the app-shell branch.
  if (event.request.method !== 'GET') return;

  // 1. API requests — never intercept
  if (isApiRequest(url.hostname)) return;

  // 2. CDN + font requests — cache-first, fall back to network
  //    These URLs are versioned/immutable so stale-while-revalidate is unnecessary.
  if (isCdnRequest(url.hostname)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  // 3. App shell + local assets — STALE-WHILE-REVALIDATE.
  //    Was network-first, which meant every single launch re-downloaded
  //    index.html (231 KB compressed, carrying ~750 KB of inline JS) and only
  //    fell back to cache when offline. Measured: a cache hit loads in ~133 ms
  //    versus ~2.5 s over the network, so the cache was doing nothing for the
  //    common case — an installed PWA opened many times a day.
  //    Now: serve the cached copy immediately (instant paint) and refresh it in
  //    the background for next time.
  //    Updates are NOT affected: they flow through sw.js itself, which the
  //    browser revalidates outside this handler — a deploy bumps CACHE_NAME,
  //    the new worker installs, activate() drops old caches, and the existing
  //    controllerchange listener reloads open clients. Worst case after a
  //    deploy is one launch on the previous build, then an automatic reload.
  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(event.request).then(cached => {
        const network = fetch(event.request)
          .then(response => {
            if (response && response.ok) cache.put(event.request, response.clone());
            return response;
          })
          .catch(() => null);
        // Keep the worker alive for the background refresh — otherwise the
        // browser can terminate it as soon as respondWith settles and the
        // cache would never actually be updated.
        event.waitUntil(network);
        // Cached copy wins the race when present; otherwise wait for the network.
        return cached || network.then(r =>
          r || new Response('Network error — offline', { status: 503, statusText: 'Service Unavailable' })
        );
      })
    )
  );
});
