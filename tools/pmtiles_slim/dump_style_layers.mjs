// Dump the final MapLibre style layers (source 'protomaps') of the running page for every
// theme x language, as JSON for layers.json. Needs Node >= 22 (global WebSocket/fetch) and Chrome.
// usage: node dump_style_layers.mjs <pageUrl> <out.json> [chromePath] [--allow-host HOST] [--insecure-no-sandbox] [-- chrome flags...]
// Chrome runs with its sandbox ON. The page host must be allow-listed (dev.redmap.me, redmap.me, localhost); unsafe Chrome flags are refused.
// --insecure-no-sandbox exists only for disposable containers that cannot run the sandbox: it needs PMTILES_SLIM_ALLOW_NO_SANDBOX=1 unless the page is localhost.
// Theme is switched with localStorage 'oref-theme' (NOT prefers-color-scheme: dev hosts default to dark).
import {spawn} from 'node:child_process';import fs from 'node:fs';
import {parseArgs,chromeArgs} from './dsl_args.mjs';
let cfg;try{cfg=parseArgs(process.argv.slice(2))}catch(e){console.error(e.message);process.exit(2)}
const {url,out,chrome,extra,insecureNoSandbox}=cfg;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Chrome picks a free DevTools port itself (port 0) and reports it in <profile>/DevToolsActivePort. The profile dir is private to
// this run (mkdtemp), so the port we read always belongs to the Chrome we spawned, and parallel runs cannot attach to each other.
const dir=fs.mkdtempSync('/tmp/dsl-');
const ch=spawn(chrome,chromeArgs({port:0,dir,extra,insecureNoSandbox}),{stdio:'ignore'});
let exited=false;ch.on('exit',()=>{exited=true});
const cleanup=()=>{try{ch.kill()}catch(e){}try{fs.rmSync(dir,{recursive:true,force:true})}catch(e){}};
process.on('exit',cleanup);process.on('SIGINT',()=>process.exit(130));
ch.on('error',e=>{console.error('cannot start Chrome: '+e.message);process.exit(1)});
let port,t;for(let i=0;i<100&&!exited;i++){try{port=Number(fs.readFileSync(dir+'/DevToolsActivePort','utf8').split('\n')[0]);if(!port){await sleep(200);continue}t=await (await fetch(`http://127.0.0.1:${port}/json`)).json();if(t[0])break}catch(e){}await sleep(200)}
if(!t||!t.find(x=>x.type==='page'&&x.webSocketDebuggerUrl.startsWith(`ws://127.0.0.1:${port}/`))){console.error('Chrome did not start (is the sandbox usable here? see --insecure-no-sandbox in the header)');process.exit(1)}
const ws=new WebSocket(t.find(x=>x.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const pend={};
const send=(m,p={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method:m,params:p}))});
ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id&&pend[d.id])pend[d.id](d.result)};
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});return r&&r.result&&r.result.value};
const all={};
for(const theme of ['dark','light'])for(const lang of ['he','en','ar','ru']){
  await send('Page.navigate',{url});await sleep(1500);
  await ev(`localStorage.setItem('oref-map-lang','${lang}');localStorage.setItem('oref-theme','${theme}');0`);
  await send('Page.navigate',{url});
  for(let i=0;i<300;i++){await sleep(200);if(await ev('typeof map!=="undefined"&&map.isStyleLoaded()'))break}
  const dark=await ev('document.body.classList.contains("dark")');
  if(dark!==(theme==='dark'))throw new Error('theme not applied: '+theme);
  all[theme+'-'+lang]=JSON.parse(await ev(`JSON.stringify(map.getStyle().layers.filter(function(l){return l.source==='protomaps'}).map(function(l){return {id:l.id,type:l.type,sl:l['source-layer'],filter:l.filter||null,minzoom:l.minzoom,maxzoom:l.maxzoom,vis:(l.layout||{}).visibility||'visible'}}))`));
  console.log(theme,lang,all[theme+'-'+lang].length);
}
// union (visibility ignored on purpose: fail-open for runtime toggles) -> layers.json shape
const seen=new Map();
for(const v of Object.values(all))for(const l of v){const {vis,...rest}=l;seen.set(JSON.stringify(rest,Object.keys(rest).sort()),rest)}
fs.writeFileSync(out,JSON.stringify([...seen.values()]));console.log('union layers',seen.size);
ws.close();cleanup();
