// Argument validation and Chrome launch flags for dump_style_layers.mjs (kept separate so tests can import it).
// Chrome runs WITH its sandbox by default. The page is only loaded from an allow-listed origin.
export const DEFAULT_HOSTS=['dev.redmap.me','redmap.me','localhost','127.0.0.1'];
// Flags that weaken isolation or retarget the browser; never accepted as passthrough flags.
const FORBIDDEN=/^--(no-sandbox|disable-setuid-sandbox|disable-web-security|disable-site-isolation-trials|disable-features|remote-debugging-address|remote-allow-origins|remote-debugging-port|user-data-dir|headless|allow-running-insecure-content|ignore-certificate-errors|unsafely-treat-insecure-origin-as-secure|proxy-server|host-resolver-rules)\b/;
export function parseArgs(argv){
  const pos=[],hosts=[...DEFAULT_HOSTS],extra=[];let insecureNoSandbox=false,i=0;
  for(;i<argv.length;i++){
    const a=argv[i];
    if(a==='--')   {extra.push(...argv.slice(i+1));break}
    if(a==='--insecure-no-sandbox')insecureNoSandbox=true;
    else if(a==='--allow-host'){const h=argv[++i];if(!h||h.startsWith('--'))throw new Error('--allow-host needs a hostname');hosts.push(h.toLowerCase())}
    else if(a.startsWith('--'))throw new Error('unknown option '+a+' (put Chrome flags after --)');
    else pos.push(a);
  }
  if(pos.length<2||pos.length>3)throw new Error('usage: node dump_style_layers.mjs <pageUrl> <out.json> [chromePath] [--allow-host HOST] [--insecure-no-sandbox] [-- chrome flags...]');
  const [url,out,chrome='google-chrome']=pos;
  for(const f of extra)if(FORBIDDEN.test(f))throw new Error('refusing Chrome flag '+f+' (weakens isolation or retargets the browser)');
  let u;try{u=new URL(url)}catch(e){throw new Error('invalid page URL')}
  const local=u.hostname==='localhost'||u.hostname==='127.0.0.1';
  if(!(u.protocol==='https:'||(u.protocol==='http:'&&local)))throw new Error('page URL must be https (http only for localhost)');
  if(u.username||u.password)throw new Error('page URL must not contain credentials');
  if(!hosts.includes(u.hostname.toLowerCase()))throw new Error('host '+u.hostname+' is not allow-listed; pass --allow-host '+u.hostname+' if you trust it');
  if(insecureNoSandbox&&!local&&process.env.PMTILES_SLIM_ALLOW_NO_SANDBOX!=='1')throw new Error('--insecure-no-sandbox is only allowed with PMTILES_SLIM_ALLOW_NO_SANDBOX=1 (e.g. inside a disposable container)');
  return {url:u.href,out,chrome,extra,insecureNoSandbox,origin:u.origin};
}
export function chromeArgs({port,dir,extra,insecureNoSandbox}){
  return ['--headless=new',...(insecureNoSandbox?['--no-sandbox']:[]),'--use-gl=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port,'--user-data-dir='+dir,...extra,'about:blank'];
}
