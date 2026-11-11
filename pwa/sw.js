/* Hair Loss Counter — service worker. Serves the app's own files from the device so it works offline.
   It only ever requests this app's own files from this site; it never sends anything. */
var CACHE = 'hlc-4ade2c160cbf';
var FILES = ["./", "index.html", "styles.css", "app.js", "engine.js", "worker.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf('hlc-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) { e.respondWith(Response.error()); return; }   // nothing leaves this site
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
    if (hit) return hit;
    if (e.request.mode === 'navigate') return caches.match('./');
    return fetch(e.request);
  }));
});
