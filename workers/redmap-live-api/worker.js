const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "X-Upstream-Status, X-Source-Checked-At, X-Source-Request-Id, X-Upstream-Target, X-Cache",
};

const orefHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Referer": "https://www.oref.org.il/",
    "Accept": "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
    "Connection": "keep-alive"
};

// Short edge cache: collapses simultaneous client polls into one upstream
// request, lowering request volume against oref.org.il. Only validated 200
// payloads are cached, for 4 seconds. 403/5xx/502 responses are never cached
// and pass through unchanged, so a blocked or broken upstream still surfaces
// as an error, never as "no alerts".
const EDGE_CACHE_CONTROL = 's-maxage=4, max-age=3';

const ALLOWED_ORIGINS = new Set(['https://redmap.me', 'https://redmap.dev', 'https://dev.redmap.me']);
const PREVIEW_HOST_SUFFIX = '.claude-test-lmz.pages.dev';
function isAllowedOrigin(origin) {
    if (ALLOWED_ORIGINS.has(origin)) return true;
    try {
        const u = new URL(origin);
        if (u.origin !== origin || u.protocol !== 'https:' || u.username || u.password || u.port) return false;
        return u.hostname === 'claude-test-lmz.pages.dev' || u.hostname.endsWith(PREVIEW_HOST_SUFFIX);
    } catch (e) {
        return false;
    }
}
async function withAllowedCors(request, event) {
    const origin = request.headers.get('Origin');
    if (origin && !isAllowedOrigin(origin)) return new Response('Origin not allowed', {status:403,headers:{Vary:'Origin'}});
    const response = await handleRequest(request, event);
    const headers = new Headers(response.headers);
    headers.delete('Access-Control-Allow-Origin');
    if (origin) headers.set('Access-Control-Allow-Origin',origin);
    headers.set('Vary','Origin');
    return new Response(response.body,{status:response.status,headers});
}
addEventListener('fetch',event=>event.respondWith(withAllowedCors(event.request,event)));

async function handleRequest(request, event) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    const url = new URL(request.url);
    const pathname = url.pathname.toLowerCase();

    try {
        if (request.method !== "GET") return new Response("Method Not Allowed", {status:405,headers:{...corsHeaders,Allow:"GET, OPTIONS"}});
        // ==========================================
        // 1. OREF PROXY (Stealth Tunnel)
        // ==========================================
        if (['/api/alerts','/api2/alerts','/api/history','/api2/history'].includes(pathname)) {
            const edgeCache = (typeof caches !== 'undefined' && caches.default) ? caches.default : null;
            // Cache by path only: the client appends cache-busting query params
            // (_=timestamp, _source_request, debugapi) that would make every key
            // unique and the cache would never hit. These endpoints ignore the
            // query string entirely.
            const edgeCacheKey = url.origin + pathname;
            if (edgeCache) {
                try {
                    const cached = await edgeCache.match(edgeCacheKey);
                    if (cached) {
                        const hitHeaders = new Headers(cached.headers);
                        hitHeaders.set('X-Cache', 'HIT');
                        // X-Source-Request-Id is a per-request echo: re-apply it from
                        // THIS request, never serve the id stored with the cached body.
                        hitHeaders.delete('X-Source-Request-Id');
                        const hitRequestId = url.searchParams.get('_source_request');
                        if (hitRequestId && /^[a-zA-Z0-9-]{16,100}$/.test(hitRequestId)) hitHeaders.set('X-Source-Request-Id', hitRequestId);
                        // X-Source-Checked-At stays as stored: it is when the upstream
                        // was actually checked, so clients can see the data's age.
                        return new Response(cached.body, { status: 200, headers: hitHeaders });
                    }
                } catch (cacheErr) { /* a cache failure falls through to a live fetch */ }
            }
            const targets = pathname.includes('alert')
                ? ["https://www.oref.org.il/warningMessages/alert/Alerts.json", "https://www.oref.org.il/WarningMessages/alert/alerts.json"]
                : [
                    "https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json",
                    "https://www.oref.org.il/WarningMessages/History/AlertsHistory.json",
                    "https://www.oref.org.il/WarningMessages/alert/History/AlertsHistory.json"
                ];
            // Try each documented path; move on only when Oref answers 404. Any other
            // status (including 403/5xx) is returned unchanged so errors stay visible.
            let response = null;
            let targetIndex = 0;
            for (let i = 0; i < targets.length; i++) {
                targetIndex = i;
                response = await fetch(targets[i], {
                    headers: orefHeaders,
                    cf: { mirage: true, scrapeShield: true } // Cloudflare-specific bypass rules
                });
                if (response.status !== 404) break;
            }

            const body = await response.arrayBuffer();
            const headers = { ...corsHeaders, 'Content-Type': 'application/json', 'X-Upstream-Status': String(response.status), 'X-Upstream-Target': String(targetIndex), 'X-Cache': 'MISS' };
            if (!response.ok) {
                headers['Cache-Control'] = 'no-store';
                return new Response(body, { status: response.status, headers });
            }
            const text = new TextDecoder().decode(body).replace(/^\ufeff/, '').trim();
            const quietRollingHistory = response.status === 200 && !text && (pathname === '/api/history' || pathname === '/api2/history');
            let parsed;
            try { parsed = quietRollingHistory ? [] : (text ? JSON.parse(text) : null); }
            catch (err) { headers['Cache-Control'] = 'no-store'; return new Response(JSON.stringify({ error: 'Invalid upstream JSON' }), { status: 502, headers }); }
            const isAlerts = pathname.includes('alert');
            const records = Array.isArray(parsed) ? parsed : [parsed];
            const valid = isAlerts
                ? (!text || (records.every(item => item && typeof item === 'object' && Array.isArray(item.data) && item.data.every(location => typeof location === 'string'))))
                : (Array.isArray(parsed) && parsed.every(item => item && typeof item === 'object' && (typeof item.data === 'string' || Array.isArray(item.data)) && typeof item.alertDate === 'string'));
            if (!valid) { headers['Cache-Control'] = 'no-store'; return new Response(JSON.stringify({ error: 'Invalid upstream payload' }), { status: 502, headers }); }
            headers['X-Source-Checked-At'] = new Date().toISOString();
            const requestId = url.searchParams.get('_source_request');
            if (requestId && /^[a-zA-Z0-9-]{16,100}$/.test(requestId)) headers['X-Source-Request-Id'] = requestId;
            headers['Cache-Control'] = EDGE_CACHE_CONTROL;
            const okResponse = new Response(quietRollingHistory ? '[]' : body, { status: response.status, headers });
            if (edgeCache && event && typeof event.waitUntil === 'function') {
                event.waitUntil(edgeCache.put(edgeCacheKey, okResponse.clone()));
            }
            return okResponse;
        }

        return new Response(JSON.stringify({ error: "Not Found: " + pathname }), { status: 404, headers: corsHeaders });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
}
