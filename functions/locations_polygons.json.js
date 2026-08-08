// Proxies locations_polygons.json from the private oref-polygons Pages project.
// Uses Cache API for 1h edge caching (polygons change only when pipeline re-runs).
// In local dev, falls back to the static file via ASSETS binding.
export async function onRequestGet(context) {
  const hostname = new URL(context.request.url).hostname;
  if (hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '127.0.0.1') {
    // Local dev: serve static web/locations_polygons.json directly.
    return context.next();
  }
  const cache = caches.default;
  const upstream = 'https://assets.redmap.dev/locations_polygons.json';
  const cacheKey = new Request(context.request.url);

  let response = await cache.match(cacheKey);
  if (response) return response;

  try {
    response = await fetch(upstream);
  } catch (err) {
    // An unguarded throw here surfaces as an opaque 500; the map then has no
    // polygons at all, so make the failure explicit and retryable.
    return new Response('Failed to load polygons: upstream unreachable', {
      status: 502,
      headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
    });
  }
  if (!response.ok) {
    return new Response('Failed to load polygons', {
      status: 502,
      headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const toCache = new Response(response.body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });

  context.waitUntil(cache.put(cacheKey, toCache.clone()));
  return toCache;
}
