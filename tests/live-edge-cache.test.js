// Deployed Oref proxy workers: short edge cache (s-maxage=4) collapses
// simultaneous client polls into one upstream request. Only validated 200
// payloads are cached; 403/5xx/502 are never cached and never served from
// cache, so a blocked upstream cannot be masked as "no alerts".
// Run: node tests/live-edge-cache.test.js
const fs=require('fs'),path=require('path'),assert=require('assert');
const WORKERS=['redmap-live-api','redmap-live-backup'];
let SRC;

// Minimal caches.default stand-in that honours s-maxage, with a settable clock.
function mockCaches(){
  const store=new Map(); let now=0;
  return {
    advance:ms=>{now+=ms;},
    default:{
      match:async k=>{const e=store.get(k);if(!e)return undefined;if(now>=e.expires){store.delete(k);return undefined;}return new Response(e.body,{status:e.status,headers:new Headers(e.headers)});},
      put:async(k,r)=>{const cc=r.headers.get('Cache-Control')||'';const m=/s-maxage=(\d+)/.exec(cc);if(!m)return;store.set(k,{body:await r.text(),status:r.status,headers:[...r.headers.entries()],expires:now+Number(m[1])*1000});}
    }
  };
}

function load(fetchImpl,caches){
  let handler;
  const g={addEventListener:(t,fn)=>{handler=fn;}};
  new Function('addEventListener','fetch','Response','Headers','URL','TextDecoder','caches',fs.readFileSync(SRC,'utf8')+';')(g.addEventListener,fetchImpl,Response,Headers,URL,TextDecoder,caches);
  return async(path,qs='',origin='https://redmap.me')=>{
    let r;const pending=[];
    handler({request:new Request('https://x.dev'+path+qs,{headers:{Origin:origin}}),respondWith:p=>{r=p},waitUntil:p=>{pending.push(Promise.resolve(p));}});
    const resp=await r;await Promise.all(pending);return resp;
  };
}

const ALERTS='[{"data":["תל אביב - מרכז"],"title":"ירי רקטות וטילים","category":1}]';
const HIST='[{"data":"תל אביב - מרכז","alertDate":"2026-11-12 09:00:00","title":"ירי רקטות וטילים"}]';

async function suite(){
  // 1: repeat polls within the TTL collapse into one upstream fetch
  let calls=0;let caches=mockCaches();
  let get=load(async()=>{calls++;return new Response(ALERTS,{status:200});},caches);
  let r1=await get('/api2/alerts','?_=1000');
  let r2=await get('/api2/alerts','?_=1001');
  assert.equal(r1.status,200);assert.equal(r2.status,200);
  assert.equal(calls,1,'second poll within TTL must not hit upstream');
  assert.equal(r1.headers.get('X-Cache'),'MISS');
  assert.equal(r2.headers.get('X-Cache'),'HIT');
  assert.equal(await r1.text(),await r2.text());

  // 2: cached entry expires after s-maxage (4s)
  caches.advance(4001);
  let r3=await get('/api2/alerts','?_=1002');
  assert.equal(calls,2,'poll after TTL must fetch upstream again');
  assert.equal(r3.headers.get('X-Cache'),'MISS');

  // 3: success carries Maor-style cache headers; X-Cache is browser-readable
  assert.equal(r3.headers.get('Cache-Control'),'s-maxage=4, max-age=3');
  assert(r3.headers.get('Access-Control-Expose-Headers').includes('X-Cache'));

  // 4: X-Source-Checked-At on a HIT is the original upstream check time
  calls=0;caches=mockCaches();
  get=load(async()=>{calls++;return new Response(ALERTS,{status:200});},caches);
  r1=await get('/api2/alerts');
  caches.advance(1000);
  r2=await get('/api2/alerts');
  assert.equal(r2.headers.get('X-Cache'),'HIT');
  assert.equal(r1.headers.get('X-Source-Checked-At'),r2.headers.get('X-Source-Checked-At'));

  // 5: X-Source-Request-Id is echoed per request, never served from the cache
  calls=0;caches=mockCaches();
  get=load(async()=>{calls++;return new Response(ALERTS,{status:200});},caches);
  r1=await get('/api2/alerts','?_source_request=aaaaaaaaaaaaaaaa');
  r2=await get('/api2/alerts','?_source_request=bbbbbbbbbbbbbbbb');
  assert.equal(r1.headers.get('X-Source-Request-Id'),'aaaaaaaaaaaaaaaa');
  assert.equal(r2.headers.get('X-Cache'),'HIT');
  assert.equal(r2.headers.get('X-Source-Request-Id'),'bbbbbbbbbbbbbbbb');
  r3=await get('/api2/alerts');
  assert.equal(r3.headers.get('X-Cache'),'HIT');
  assert.equal(r3.headers.get('X-Source-Request-Id'),null);

  // 6: 403 is never cached and never masked; recovery is served as soon as upstream recovers
  calls=0;caches=mockCaches();
  let mode=403;
  get=load(async()=>{calls++;return mode===403?new Response('no',{status:403}):new Response(ALERTS,{status:200});},caches);
  r1=await get('/api2/alerts');assert.equal(r1.status,403);assert.equal(r1.headers.get('Cache-Control'),'no-store');
  r2=await get('/api2/alerts');assert.equal(r2.status,403);assert.equal(calls,2,'403 must not be served from cache');
  mode=200;r3=await get('/api2/alerts');assert.equal(r3.status,200);assert.equal(calls,3);
  let r4=await get('/api2/alerts');assert.equal(r4.headers.get('X-Cache'),'HIT','recovered 200 is cached normally');

  // 7: invalid payload (502) is never cached
  calls=0;caches=mockCaches();
  get=load(async()=>{calls++;return new Response('{"x":1}',{status:200});},caches);
  r1=await get('/api2/alerts');assert.equal(r1.status,502);assert.equal(r1.headers.get('Cache-Control'),'no-store');
  r2=await get('/api2/alerts');assert.equal(calls,2,'502 must not be served from cache');

  // 8: history endpoint is cached the same way
  calls=0;caches=mockCaches();
  get=load(async()=>{calls++;return new Response(HIST,{status:200});},caches);
  r1=await get('/api2/history','?_=1');r2=await get('/api2/history','?_=2');
  assert.equal(calls,1);assert.equal(r2.headers.get('X-Cache'),'HIT');

  // 9: quiet rolling history (empty 200 -> []) is cached as a valid 200
  calls=0;caches=mockCaches();
  get=load(async()=>{calls++;return new Response('﻿\r\n',{status:200});},caches);
  r1=await get('/api2/history');assert.equal(await r1.text(),'[]');
  r2=await get('/api2/history');assert.equal(calls,1);assert.equal(await r2.text(),'[]');

  // 10: without a caches global (older runtimes) the worker still proxies live
  calls=0;
  get=load(async()=>{calls++;return new Response(ALERTS,{status:200});},undefined);
  r1=await get('/api2/alerts');r2=await get('/api2/alerts');
  assert.equal(r1.status,200);assert.equal(calls,2,'no cache global -> every poll fetches upstream');
}

(async()=>{for(const w of WORKERS){SRC=path.join(__dirname,'..','workers',w,'worker.js');await suite();console.log(w+': 10 tests passed');}})().catch(e=>{console.error(e);process.exit(1)});
