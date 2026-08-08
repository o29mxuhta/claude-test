const OREF_HEADERS = {
  'Referer': 'https://www.oref.org.il/',
  'X-Requested-With': 'XMLHttpRequest',
};

const NON_TLV_PROXY_HOSTS = [
  'https://oref-proxy.xanagis.workers.dev',
  //  'https://orefproxy6.oref-map.org',
  // 'https://orefproxy7.oref-map.org',
];

// Dedicated pool for TLV traffic. NOTE: currently the same single host as the
// non-TLV pool, so there is no real isolation yet — add distinct hosts here
// before relying on it. TLV traffic does not normally reach this pool at all
// (see orefProxy: TLV is served directly by this Function).
const TLV_PROXY_HOSTS = [
  'https://oref-proxy.xanagis.workers.dev',
  //  'https://oreftest.kon40.com',
  //  'https://orefproxy6.oref-map.org',
];

const PROXY_HOST_PATTERNS = [
  /^oref-proxy\d*\.xanagis\d*\.workers\.dev$/,
  /^oreftest\.kon40\.com$/,
];

// The client fetches these endpoints from a different origin (the page is on
// redmap.dev, the API on api.redmap.dev), so every response — including
// redirects and errors — must carry CORS headers or the fetch is blocked.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Expose-Headers': 'X-CF-Colo, X-Served-By, X-Upstream-Status',
};

export function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function withCors(headers) {
  return Object.assign({}, CORS_HEADERS, headers);
}

function randomFrom(hosts) {
  return hosts[Math.floor(Math.random() * hosts.length)];
}

function randomNonTlvProxy() {
  return randomFrom(NON_TLV_PROXY_HOSTS);
}

function randomTlvProxy() {
  return randomFrom(TLV_PROXY_HOSTS);
}

// Build the edge-cache key. The client appends a `_=<timestamp>` cache buster
// and may append `debugapi`; including either makes every key unique and the
// cache can never hit. Strip them so the 1s edge cache actually works.
function buildCacheKey(requestUrl) {
  const url = new URL(requestUrl);
  url.searchParams.delete('_');
  url.searchParams.delete('debugapi');
  return new Request(url.toString(), { method: 'GET' });
}

// Preserve the caller's query string across the 303 (e.g. ?date=), minus the
// params that are only meaningful to this Function.
function buildRedirectLocation(host, redirectSuffix, requestUrl) {
  const url = new URL(requestUrl);
  url.searchParams.delete('debugapi');
  const qs = url.searchParams.toString();
  return host + redirectSuffix + (qs ? '?' + qs : '');
}

// Fetch the first target that does not 404. Oref has moved these paths before
// and a 404 would look like "no alerts" to a careless caller, so a documented
// path is tried first and a known-alternative second. A 403 is not retried:
// that is the geo-block, and another path on the same host cannot fix it.
async function fetchFirstAvailable(targets) {
  let resp = null;
  for (const target of targets) {
    resp = await fetch(target, { headers: OREF_HEADERS });
    if (resp.status !== 404) return resp;
  }
  return resp;
}

async function fetchOrefDirect(context, target, kind, colo) {
  const cache = caches.default;
  const cacheKey = buildCacheKey(context.request.url);

  const cached = await cache.match(cacheKey);
  if (cached) {
    const resp = new Response(cached.body, cached);
    resp.headers.set('X-CF-Colo', colo);
    return resp;
  }

  const resp = await fetchFirstAvailable(Array.isArray(target) ? target : [target]);
  const body = await resp.arrayBuffer();

  // Propagate the upstream status honestly. A 403 (geo-block) or 5xx must reach
  // the client as an error — never as an empty-but-successful payload, which is
  // indistinguishable from "no alerts right now".
  const response = new Response(body, {
    status: resp.status,
    headers: withCors({
      'Content-Type': resp.ok ? 'application/json; charset=utf-8' : (resp.headers.get('Content-Type') || 'text/plain'),
      // s-maxage keeps the 1s edge cache that collapses simultaneous polls.
      // max-age=0 stops the browser holding a live alert across its 1s poll.
      'Cache-Control': resp.ok ? 's-maxage=1, max-age=0' : 'no-store',
      'X-CF-Colo': colo,
      'X-Served-By': 'pages-function',
      'X-Upstream-Status': String(resp.status),
    }),
  });

  if (resp.ok) {
    context.waitUntil(cache.put(cacheKey, response.clone()));

    // Check for unknown titles in the background
    const bodyText = new TextDecoder().decode(body);
    context.waitUntil(checkAndNotifyUnknownTitles(bodyText, kind, context));
  }

  return response;
}

// --- Known title classification ---
//
// Mirrors classifyTitle() in web/index.html. Both derive from the alert-title
// table in CLAUDE.md — keep all three in sync when Oref introduces a title.
// Matching is by substring (Oref ships combined forms like
// "<threat> - היכנסו למרחב המוגן"), after whitespace normalization.

const GREEN_TERMS = [
  'הסתיים',              // covers "האירוע הסתיים" and "אירוע חדירת מחבלים הסתיים"
  'החשש הוסר',
  'יכולים לצאת',
  'אינם צריכים לשהות',
  'סיום שהייה בסמיכות',
];

const YELLOW_TERMS = [
  'בדקות הקרובות',
  'לשפר את המיקום למיגון המיטבי',
  'לשהות בסמיכות למרחב המוגן',
  'להישאר בקרבתו',
  'התקרבו למרחב מוגן',      // also catches "איום מלבנון - התקרבו למרחב מוגן"
  'איום מלבנון',
  'איום מאיראן',
  'התרעה מוקדמת',
  'התראה מוקדמת',
];

const THREAT_TERMS = [
  'ירי רקטות וטילים',
  'נשק לא קונבנציונלי',
  'חדירת כלי טיס עוין',
  'חדירת מחבלים',
];

// Generic shelter commands. They specify no threat type, so the client resolves
// them against the location's existing state; here we only need to know they
// are recognized.
const INHERIT_TERMS = [
  'היכנסו מייד למרחב המוגן',
  'היכנסו למרחב המוגן',
  'בזמן ההתגוננות העומד לרשותכם',
];

function includesAny(title, terms) {
  for (const term of terms) {
    if (title.includes(term)) return true;
  }
  return false;
}

function isKnownTitle(title) {
  title = title.replace(/\s+/g, ' ').trim();
  if (!title) return true;

  // Green — all-clear / event over. "ניתן לצאת" is an all-clear only when it is
  // not qualified by "אך יש להישאר בקרבתו" (leave, but stay nearby → yellow).
  if (includesAny(title, GREEN_TERMS)) return true;
  if (title.includes('ניתן לצאת')) return true;

  if (includesAny(title, THREAT_TERMS)) return true;
  if (includesAny(title, INHERIT_TERMS)) return true;
  if (includesAny(title, YELLOW_TERMS)) return true;

  return false;
}

// --- Title extraction per API kind ---

function extractTitles(bodyText, kind) {
  try {
    const text = bodyText.replace(/^﻿/, '').trim();
    if (!text) return [];
    const parsed = JSON.parse(text);

    if (kind === 'alerts') {
      // Live API: single object with .title
      if (parsed && parsed.title) {
        return [parsed.title.replace(/\s+/g, ' ').trim()];
      }
      return [];
    }

    if (kind === 'history') {
      // History API: array of {title, ...}
      if (!Array.isArray(parsed)) return [];
      return [...new Set(
        parsed
          .map(e => e.title)
          .filter(Boolean)
          .map(t => t.replace(/\s+/g, ' ').trim())
      )];
    }

    if (kind === 'alarms-history') {
      // Extended history API: array of {category_desc, ...}
      if (!Array.isArray(parsed)) return [];
      return [...new Set(
        parsed
          .map(e => e.category_desc)
          .filter(Boolean)
          .map(t => t.replace(/\s+/g, ' ').trim())
      )];
    }

    return [];
  } catch {
    return [];
  }
}

// --- Unknown title detection & Pushover notification ---

async function checkAndNotifyUnknownTitles(bodyText, kind, context) {
  const titles = extractTitles(bodyText, kind);
  const unknown = titles.filter(t => !isKnownTitle(t));
  if (unknown.length === 0) return;

  const userKey = context.env.PUSHOVER_USER;
  const appToken = context.env.PUSHOVER_TOKEN;
  if (!userKey || !appToken) return;

  const cache = caches.default;
  // The dedup key must live on this worker's own zone — Cloudflare rejects
  // cache.put() for a URL outside it, and a hardcoded foreign host silently
  // disabled every notification.
  const origin = new URL(context.request.url).origin;

  for (const title of unknown) {
    const cacheKey = new Request(
      `${origin}/_internal/unknown-title/${encodeURIComponent(title)}`
    );

    try {
      const cached = await cache.match(cacheKey);
      if (cached) continue; // already notified recently

      // Store in cache with 1-hour TTL to deduplicate
      await cache.put(cacheKey, new Response('1', {
        headers: { 'Cache-Control': 's-maxage=3600' },
      }));
    } catch {
      // A cache failure must not stop the notification — better a duplicate
      // page than a silent one.
    }

    // Send Pushover notification
    try {
      await fetch('https://api.pushover.net/1/messages.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: appToken,
          user: userKey,
          title: 'oref-map: unknown alert title',
          message: `Kind: ${kind}\nTitle: ${title}`,
          priority: 1, // high priority
        }),
      });
    } catch {
      // Notification failure must not affect proxy behavior
    }
  }
}

// --- Shared proxy logic ---

export async function orefProxy(context, { target, redirectSuffix, kind }) {
  if (context.request.method === 'OPTIONS') return corsPreflight();

  const colo = context.request.cf?.colo || '';
  const url = new URL(context.request.url);
  const debugApi = url.searchParams.get('debugapi');

  // ?debugapi=oref-direct forces a direct fetch from the Pages Function.
  if (debugApi === 'oref-direct') {
    return fetchOrefDirect(context, target, kind, colo);
  }

  // ?debugapi=<hostname> forces redirect to that proxy (if whitelisted), even from TLV
  if (debugApi) {
    const proxyHost = PROXY_HOST_PATTERNS.some(p => p.test(debugApi)) ? 'https://' + debugApi : null;
    if (proxyHost) {
      return new Response(null, {
        status: 303,
        headers: withCors({
          'Location': buildRedirectLocation(proxyHost, redirectSuffix, context.request.url),
          'X-CF-Colo': colo,
        }),
      });
    }
  }

  // TLV requests are served directly — this Function already egresses from an
  // Israeli IP, so Oref accepts it and no Worker invocation is needed.
  if (colo === 'TLV') {
    return fetchOrefDirect(context, target, kind, colo);
  }

  // Non-TLV requests would be geo-blocked (HTTP 403) if fetched from here, so
  // hand them to the placement-pinned Worker pool.
  return new Response(null, {
    status: 303,
    headers: withCors({
      'Location': buildRedirectLocation(randomNonTlvProxy(), redirectSuffix, context.request.url),
      'X-CF-Colo': colo,
    }),
  });
}
