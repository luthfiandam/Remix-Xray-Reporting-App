/**
 * X-RAY REPORTING APP — SERVICE WORKER CLEANUP
 * Self-purges old caches and unregisters to prevent stale asset locks
 */
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    }).then(() => self.registration.unregister()).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', () => {
  // Direct network pass-through
});
