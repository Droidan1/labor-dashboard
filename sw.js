const CACHE_NAME = 'dashboard-cache-v4';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS_TO_CACHE))
  );
});

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
    icon: '/BLlogo.svg',
    badge: '/BLlogo.svg',
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
      // Find any open app window (same scope/origin — ignore hash differences)
      const appClient = windowClients.find(c =>
        c.url.startsWith(self.registration.scope) || c.url.includes('/index.html')
      );
      if (appClient) {
        // Focus the existing window, then tell the app to navigate
        return appClient.focus().then(() => {
          if (targetUrl) appClient.postMessage({ type: 'sw-navigate', url: targetUrl });
        });
      }
      // No window open — open a new one at the target URL
      const openUrl = targetUrl
        ? (targetUrl.startsWith('/') ? self.registration.scope.replace(/\/$/, '') + targetUrl : targetUrl)
        : self.registration.scope;
      if (clients.openWindow) return clients.openWindow(openUrl);
    })
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never intercept API requests — pass straight to network
  if (url.hostname.includes('google') ||
      url.hostname.includes('clover') ||
      url.hostname.includes('workers.dev') ||
      url.hostname.includes('retjghub.com')) {
    return;
  }

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
