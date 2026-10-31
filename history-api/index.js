const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET, OPTIONS","Access-Control-Allow-Headers":"Content-Type"};
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
async function handleRequest(request){
 const url=new URL(request.url);const pathname=url.pathname.toLowerCase();
 if(request.method==='OPTIONS') return new Response(null,{status:204,headers:corsHeaders});
 if(request.method!=='GET') return archiveResponse(JSON.stringify({error:'Method Not Allowed'}),405);
 if(pathname==='/api/day-history'||pathname==='/api2/day-history') return serveArchiveDay(url);
 if(pathname==='/api/history-range'||pathname==='/api2/history-range') return serveArchiveRange();
 return archiveResponse(JSON.stringify({error:'Not Found'}),404);
}

function jsonlToArray(text) {
  const trimmed = text.replace(/^﻿/, '').trimEnd();
  if (!trimmed) return { body: '[]', recovered: false };

  const candidate = '[' + (trimmed.endsWith(',') ? trimmed.slice(0, -1) : trimmed) + ']';
  try {
    JSON.parse(candidate);
    return { body: candidate, recovered: false };
  } catch {
    // Salvage path: keep every line that parses, drop only the damaged ones.
    const entries = [];
    let dropped = 0;
    for (const rawLine of trimmed.split('\n')) {
      const line = rawLine.trim().replace(/,$/, '');
      if (!line) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        dropped++;
      }
    }
    return { body: JSON.stringify(entries), recovered: true, dropped };
  }
}


function archiveResponse(body, status=200, cacheControl="no-store") {
    return new Response(body,{status,headers:{...corsHeaders,"Content-Type":"application/json; charset=utf-8","Cache-Control":cacheControl}});
}
async function serveArchiveDay(url) {
    const date=url.searchParams.get("date");
    if(!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return archiveResponse(JSON.stringify({error:"Bad Request: ?date=YYYY-MM-DD required"}),400);
    if(typeof HISTORY_BUCKET === "undefined") return archiveResponse(JSON.stringify({error:"Archive unavailable"}),503);
    try {
        const obj=await HISTORY_BUCKET.get(`${date}.jsonl`);
        const todayIsrael = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Jerusalem'}).format(new Date());
        if(!obj) return date === todayIsrael ? archiveResponse('[]',200,'public, max-age=60') : archiveResponse(JSON.stringify({error:"Not Found"}),404);
        const result=jsonlToArray(await obj.text());
        return archiveResponse(result.body,200,result.recovered?"public, max-age=60":(date < todayIsrael?"public, max-age=3600":"public, max-age=60"));
    } catch { return archiveResponse(JSON.stringify({error:"Archive unavailable"}),502); }
}
async function serveArchiveRange() {
    if(typeof HISTORY_BUCKET === "undefined") return archiveResponse(JSON.stringify({error:"Archive unavailable"}),503);
    try {
        const obj=await HISTORY_BUCKET.get("meta/history-range.json");
        if(!obj) return archiveResponse(JSON.stringify({error:"Range metadata missing"}),503);
        const cfg=JSON.parse(await obj.text());
        if(!/^\d{4}-\d{2}-\d{2}$/.test(cfg.minDate||"")) return archiveResponse(JSON.stringify({error:"Invalid range metadata"}),502);
        return archiveResponse(JSON.stringify({minDate:cfg.minDate, coverage:cfg.coverage}),200,"public, max-age=300");
    } catch { return archiveResponse(JSON.stringify({error:"Archive unavailable"}),502); }
}
