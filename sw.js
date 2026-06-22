// Höj VERSION (v3 -> v4 osv.) varje gång du laddar upp nya filer,
// så hämtas och cachas den nya versionen säkert.
const VERSION = 'v5';
const CACHE = 'rita-' + VERSION;

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Installera: cacha allt och ta över direkt
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

// Aktivera: radera gamla cache-versioner och ta kontroll över sidan
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys.filter(function (k) { return k !== CACHE; })
              .map(function (k) { return caches.delete(k); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

// Låter sidan be en väntande service worker att ta över direkt.
self.addEventListener('message', function (e) {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

// Hämta: nätet först (så uppdateringar syns), cachen som reserv offline.
// Endast egna GET-anrop hanteras, och bara lyckade svar cachas.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(req)
      .then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        }
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (r) {
          return r || caches.match('./index.html');
        });
      })
  );
});
