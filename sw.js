// Service Worker - Cache First Strategy with Network Fallback
const CACHE_NAME = 'dmozz-news-v5';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './config.json',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Merriweather:wght@400;700&display=swap',
  'https://cdn.jsdelivr.net/npm/dompurify@3.0.6/dist/purify.min.js',
  'https://cdn.jsdelivr.net/npm/glightbox/dist/glightbox.min.js',
  'https://cdn.jsdelivr.net/npm/glightbox/dist/glightbox.min.css',
  'https://cdn.jsdelivr.net/npm/animate.css@4.1.1/animate.min.css'
];

// Install Event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('Cache.addAll error:', err);
        return Promise.resolve();
      });
    })
  );
  self.skipWaiting();
});

// Activate Event - Clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event - Cache First Strategy
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip chrome extension requests
  if (url.protocol === 'chrome-extension:') {
    return;
  }

  // Cache first for static assets
  if (request.mode === 'navigate' || 
      request.url.match(/\.(js|css|png|gif|ico|svg|woff|woff2)$/) ||
      url.origin === location.origin) {
    event.respondWith(
      caches.match(request).then(response => {
        if (response) {
          return response;
        }
        return fetch(request).then(response => {
          // Don't cache non-successful responses
          if (!response || response.status !== 200 || response.type === 'error') {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, responseToCache);
          });
          return response;
        }).catch(() => {
          // Return offline page or default response
          if (request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Offline', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({
              'Content-Type': 'text/plain'
            })
          });
        });
      })
    );
  }
  // Network first for API calls (RSS feeds)
  else if (url.origin !== location.origin) {
    event.respondWith(
      fetch(request).then(response => {
        if (!response || response.status !== 200) {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(request, responseToCache);
        });
        return response;
      }).catch(() => {
        return caches.match(request).then(response => {
          if (response) {
            return response;
          }
          return new Response('Offline', {
            status: 503,
            statusText: 'Service Unavailable'
          });
        });
      })
    );
  }
});

// Background Sync for comments
self.addEventListener('sync', event => {
  if (event.tag === 'sync-comments') {
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({
            type: 'SYNC_COMMENTS'
          });
        });
      })
    );
  }
});

// Push Notification
self.addEventListener('push', event => {
  const options = {
    icon: './icon-192x192.png',
    badge: './icon-192x192.png',
    tag: 'dmozz-news-notification',
    requireInteraction: false,
    vibrate: [100, 50, 100],
    actions: [
      { action: 'open', title: 'Aç' },
      { action: 'close', title: 'Kapat' }
    ]
  };

  if (event.data) {
    const data = event.data.json();
    options.title = data.title || 'DMOZZ NEWS';
    options.body = data.body || 'Yeni haber var!';
  }

  event.waitUntil(
    self.registration.showNotification('DMOZZ NEWS PRO', options)
  );
});

// Notification Click
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.matchAll().then(clientList => {
        for (let client of clientList) {
          if (client.url === '/' && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
    );
  }
});

// Message Handler
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});