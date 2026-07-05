const CACHE = 'top-dash-v1';
const ASSETS = ['./', './index.html', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(()=>{})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(resp => { const cc = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, cc)); return resp; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
