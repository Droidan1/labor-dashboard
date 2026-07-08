const CACHE_NAME = 'dashboard-cache-v17';

// Pre-fetched and cached on install
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './tailwind.css',
  './apple-touch-icon.png',
  './icon-192.png',
];

// CDN + font hosts: versioned/immutable — serve cache-first
function isCdnRequest(hostname) {
  return hostname === 'cdnjs.cloudflare.com' ||
         hostname === 'cdn.jsdelivr.net'      ||
         hostname === 'fonts.googleapis.com'  ||
         hostname === 'fonts.gstatic.com';
}

// API hosts: never intercept — pass straight to network
function isApiRequest(hostname) {
  return hostname.includes('clover')       ||
         hostname.includes('workers.dev')  ||
         hostname.includes('retjghub.com') ||
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
  let data = { title: 'Bargain Lane Dashboard', body: 'New update', tag: 'default' };
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

  // 3. Everything else (app shell, local assets) — network-first, cache fallback
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request)
        .then(r => r || new Response('Network error — offline', { status: 503, statusText: 'Service Unavailable' }))
      )
  );
});
