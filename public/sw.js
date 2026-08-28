(function () {
  'use strict';
  const CACHE = 'life-workbench-shell-v3';
  const SHELL = ['/', '/index.html', '/styles.css', '/js/domain.js', '/js/db.js', '/js/store.js', '/js/app.js', '/manifest.webmanifest', '/icon.svg', '/pwa-192x192.png', '/pwa-512x512.png', '/maskable-icon-512x512.png'];

  self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('life-workbench-') && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
  });

  self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== self.location.origin) return;
    if (url.pathname.startsWith('/api/')) {
      event.respondWith(fetch(request));
      return;
    }
    if (request.mode === 'navigate') {
      event.respondWith(fetch(request).then((response) => { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put('/index.html', copy)); return response; }).catch(() => caches.match('/index.html')));
      return;
    }
    event.respondWith(caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => { if (response.ok) { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(request, copy)); } return response; });
      return cached || network;
    }));
  });

  self.addEventListener('message', (event) => { if (event.data === 'SKIP_WAITING') self.skipWaiting(); });
})();
