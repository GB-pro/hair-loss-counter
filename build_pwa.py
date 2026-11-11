"""Copy the engine into pwa/ and write pwa/sw.js with a cache name derived from the files' contents."""
import hashlib, os, shutil
here = os.path.dirname(os.path.abspath(__file__)); pwa = os.path.join(here, 'pwa')
eng = os.path.join(here, 'src', 'engine.js') if os.path.isdir(os.path.join(here, 'src')) else os.path.join(here, 'engine.js')
shutil.copyfile(eng, os.path.join(pwa, 'engine.js'))
files = ['index.html', 'styles.css', 'app.js', 'engine.js', 'worker.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png']
h = hashlib.sha256()
for f in files: h.update(open(os.path.join(pwa, f), 'rb').read())
ver = h.hexdigest()[:12]
sw = """/* Hair Loss Counter — service worker. Serves the app's own files from the device so it works offline.
   It only ever requests this app's own files from this site; it never sends anything. */
var CACHE = 'hlc-%s';
var FILES = %s;
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
""" % (ver, repr(['./'] + files).replace("'", '"'))
open(os.path.join(pwa, 'sw.js'), 'w', encoding='utf-8').write(sw)
print('pwa built, cache', ver, sum(os.path.getsize(os.path.join(pwa, f)) for f in files) // 1024, 'KiB')
