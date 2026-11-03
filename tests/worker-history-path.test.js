// Deployed Oref proxy workers: history upstream path is case-sensitive.
// Run: node tests/worker-history-path.test.js
const fs=require('fs'),path=require('path'),assert=require('assert');
const WORKERS=['redmap-live-api','redmap-live-backup'];
let SRC;
function load(fetchImpl){
  let handler;
  const g={addEventListener:(t,fn)=>{handler=fn;},fetch:fetchImpl,Response,Headers,URL,TextDecoder};
  new Function('addEventListener','fetch','Response','Headers','URL','TextDecoder',fs.readFileSync(SRC,'utf8')+';')(g.addEventListener,g.fetch,Response,Headers,URL,TextDecoder);
  return async(path,origin='https://redmap.me')=>{let r;handler({request:new Request('https://x.dev'+path,{headers:{Origin:origin}}),respondWith:p=>{r=p}});return await r;};
}
const hist='[{"data":"תל אביב","alertDate":"2026-11-03 20:00:00","title":"x"}]';
async function suite(){
 // 1: first path ok
 let calls=[];let get=load(async u=>{calls.push(u);return new Response(hist,{status:200});});
 let r=await get('/api/history');assert.equal(r.status,200);assert.equal(r.headers.get('X-Upstream-Target'),'0');assert.equal(calls.length,1);assert(calls[0].includes('/warningMessages/alert/History/'));
 // 2: 404 then ok -> falls through
 calls=[];get=load(async u=>{calls.push(u);return calls.length<3?new Response('nf',{status:404}):new Response(hist,{status:200});});
 r=await get('/api/history');assert.equal(r.status,200);assert.equal(r.headers.get('X-Upstream-Target'),'2');
 // 3: all 404 -> 404 returned, not empty
 get=load(async u=>new Response('nf',{status:404}));r=await get('/api/history');assert.equal(r.status,404);assert.equal(r.headers.get('X-Upstream-Status'),'404');
 // 4: 403 not retried
 calls=[];get=load(async u=>{calls.push(u);return new Response('no',{status:403});});r=await get('/api/history');assert.equal(r.status,403);assert.equal(calls.length,1);
 // 5: 200 empty body -> [] (existing rolling-history behaviour)
 get=load(async u=>new Response('\ufeff\r\n',{status:200}));r=await get('/api/history');assert.equal(r.status,200);assert.equal(await r.text(),'[]');
 // 6: alerts single target, unchanged
 calls=[];get=load(async u=>{calls.push(u);return new Response('\ufeff\r\n',{status:200});});r=await get('/api/alerts');assert.equal(r.status,200);assert.equal(calls.length,1);assert(calls[0].includes('alerts.json'));
 // 7: invalid payload still 502
 get=load(async u=>new Response('{"x":1}',{status:200}));r=await get('/api/history');assert.equal(r.status,502);
 }
(async()=>{for(const w of WORKERS){SRC=path.join(__dirname,'..','workers',w,'worker.js');await suite();console.log(w+': 7 tests passed');}})().catch(e=>{console.error(e);process.exit(1)});
