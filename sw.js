// Wunsch-Werkstatt Service Worker: zuerst vom Netz, Cache nur offline
var CACHE = 'ww-shell-v2';
var CORE = ['./', './index.html', './app.js', './manifest.webmanifest', './models.json', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE.map(function (u) { return new Request(u, { cache: 'reload' }); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var u = new URL(e.request.url);
  if (u.origin !== location.origin) return;          // KI-Anfragen nie anfassen
  if (/\/version\.json$/.test(u.pathname)) return;    // Versionspruefung nie cachen
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(function (r) {
    if (r && r.ok) { var c = r.clone(); caches.open(CACHE).then(function (x) { x.put(e.request, c); }); }
    return r;
  }).catch(function () { return caches.match(e.request, { ignoreSearch: true }).then(function (h) { return h || caches.match('./index.html'); }); }));
});
