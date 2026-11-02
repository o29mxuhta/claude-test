// Dump the final MapLibre style layers (source 'protomaps') of the running page for every
// theme x language, as JSON for layers.json. Needs Node >= 22 (global WebSocket/fetch) and Chrome.
// usage: node dump_style_layers.mjs <pageUrl> <out.json> [chromePath] [extra chrome flags...]
// Theme is switched with localStorage 'oref-theme' (NOT prefers-color-scheme: dev hosts default to dark).
import {spawn} from 'node:child_process';import fs from 'node:fs';
const [url,out,chrome='google-chrome',...extra]=process.argv.slice(2);
if(!url||!out){console.error('usage: node dump_style_layers.mjs <pageUrl> <out.json> [chrome] [flags]');process.exit(2)}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const port=9300+Math.floor(Math.random()*500),dir=fs.mkdtempSync('/tmp/dsl-');
const ch=spawn(chrome,['--headless=new','--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port='+port,'--user-data-dir='+dir,...extra,'about:blank'],{stdio:'ignore'});
let t;for(let i=0;i<50;i++){try{t=await (await fetch(`http://127.0.0.1:${port}/json`)).json();if(t[0])break}catch(e){}await sleep(200)}
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
ws.close();ch.kill();
