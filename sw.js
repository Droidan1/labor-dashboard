const CACHE_NAME = 'dashboard-cache-v3';
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
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Focus existing open window if available
      for (const client of windowClients) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      // Otherwise open a new window
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never cache API requests – always go to network
  if (url.hostname.includes('google') ||
      url.hostname.includes('clover') ||
      url.hostname.includes('workers.dev')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
