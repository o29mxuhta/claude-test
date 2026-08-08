// Bump this whenever cached assets change — the activate handler deletes
// every cache whose name differs, so a pinned name means stale entries are
// never purged.
var CACHE_NAME = 'oref-map-v2';
var SHELL_URLS = [
  '/mixkit-clear-announce-tones-2861.wav'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(SHELL_URLS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) { return n !== CACHE_NAME; })
            .map(function(n) { return caches.delete(n); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // Never intercept API calls — live alerts must always be fresh
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/api2/')) {
    return;
  }

  // Let non-GET requests hit the network directly. They are not cacheable and
  // `respondWith()` must always resolve to a real Response object.
  if (event.request.method !== 'GET') {
    return;
  }

  // Network-first: try network, fall back to cache
  event.respondWith(
    fetch(event.request).then(function(response) {
      if (response.ok && url.origin === self.location.origin) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          return cache.put(event.request, clone);
        }).catch(function() {
          // Quota errors and partial (206) responses reject here. Caching is
          // best-effort; a failure must not reject the fetch handler.
        });
      }
      return response;
    }).catch(function() {
      // ignoreSearch so an offline load of e.g. /?f-log still matches the
      // cached shell instead of falling through to the Offline stub.
      return caches.match(event.request, { ignoreSearch: true }).then(function(cached) {
        if (cached) {
          return cached;
        }
        return new Response('Offline', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      });
    })
  );
});
