const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "X-Upstream-Status, X-Source-Checked-At, X-Source-Request-Id, X-Upstream-Target",
};

const orefHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Referer": "https://www.oref.org.il/",
    "Accept": "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
    "Connection": "keep-alive"
};

const ALLOWED_ORIGINS = new Set(['https://redmap.me', 'https://redmap.dev']);
async function withAllowedCors(request) {
    const origin = request.headers.get('Origin');
    if (origin && !ALLOWED_ORIGINS.has(origin)) return new Response('Origin not allowed', {status:403,headers:{Vary:'Origin'}});
    const response = await handleRequest(request);
    const headers = new Headers(response.headers);
    headers.delete('Access-Control-Allow-Origin');
    if (origin) headers.set('Access-Control-Allow-Origin',origin);
    headers.set('Vary','Origin');
    return new Response(response.body,{status:response.status,headers});
}
addEventListener('fetch',event=>event.respondWith(withAllowedCors(event.request)));

async function handleRequest(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    const url = new URL(request.url);
    const pathname = url.pathname.toLowerCase();

    try {
        if (request.method !== "GET") return new Response("Method Not Allowed", {status:405,headers:{...corsHeaders,Allow:"GET, OPTIONS"}});
        // ==========================================
        // 1. OREF PROXY (Stealth Tunnel)
        // ==========================================
        if (['/api/alerts','/api2/alerts','/api/history','/api2/history'].includes(pathname)) {
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
            const headers = { ...corsHeaders, 'Content-Type': 'application/json', 'X-Upstream-Status': String(response.status), 'X-Upstream-Target': String(targetIndex) };
            if (!response.ok) {
                return new Response(body, { status: response.status, headers });
            }
            const text = new TextDecoder().decode(body).replace(/^\ufeff/, '').trim();
            const quietRollingHistory = response.status === 200 && !text && (pathname === '/api/history' || pathname === '/api2/history');
            let parsed;
            try { parsed = quietRollingHistory ? [] : (text ? JSON.parse(text) : null); }
            catch (err) { return new Response(JSON.stringify({ error: 'Invalid upstream JSON' }), { status: 502, headers }); }
            const isAlerts = pathname.includes('alert');
            const records = Array.isArray(parsed) ? parsed : [parsed];
            const valid = isAlerts
                ? (!text || (records.every(item => item && typeof item === 'object' && Array.isArray(item.data) && item.data.every(location => typeof location === 'string'))))
                : (Array.isArray(parsed) && parsed.every(item => item && typeof item === 'object' && (typeof item.data === 'string' || Array.isArray(item.data)) && typeof item.alertDate === 'string'));
            if (!valid) return new Response(JSON.stringify({ error: 'Invalid upstream payload' }), { status: 502, headers });
            headers['X-Source-Checked-At'] = new Date().toISOString();
            const requestId = url.searchParams.get('_source_request');
            if (requestId && /^[a-zA-Z0-9-]{16,100}$/.test(requestId)) headers['X-Source-Request-Id'] = requestId;
            return new Response(quietRollingHistory ? '[]' : body, { status: response.status, headers });
        }

        return new Response(JSON.stringify({ error: "Not Found: " + pathname }), { status: 404, headers: corsHeaders });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
}
