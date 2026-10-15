// Minimal service worker: makes the demo installable. Network-first, no offline cache of API calls.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
