"""Tests for dump_style_layers.mjs argument validation and Chrome flags (Sourcery finding: --no-sandbox).
Needs node >= 22; the last test also needs google-chrome and is skipped without it. No external network."""
import os,json,shutil,subprocess,tempfile,time,unittest,urllib.request
D=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..')
NODE=shutil.which('node');CHROME=shutil.which('google-chrome')
def js(code):
    r=subprocess.run([NODE,'--input-type=module','-e',"import {parseArgs,chromeArgs} from './dsl_args.mjs';"+code],cwd=D,capture_output=True,text=True)
    return r.returncode,r.stdout.strip(),r.stderr.strip()
def parse(*a):
    return js('try{console.log(JSON.stringify(parseArgs(%s)))}catch(e){console.log("ERR:"+e.message)}'%json.dumps(list(a)))[1]
@unittest.skipUnless(NODE,'node not installed')
class Launcher(unittest.TestCase):
    def test_sandbox_on_by_default(self):
        o=json.loads(parse('https://dev.redmap.me/','o.json'))
        self.assertFalse(o['insecureNoSandbox'])
        _,out,_=js('console.log(JSON.stringify(chromeArgs({port:9300,dir:"/tmp/x",extra:[],insecureNoSandbox:false})))')
        self.assertNotIn('--no-sandbox',json.loads(out))
    def test_no_sandbox_only_with_explicit_flag(self):
        _,out,_=js('console.log(JSON.stringify(chromeArgs({port:9300,dir:"/tmp/x",extra:[],insecureNoSandbox:true})))')
        self.assertIn('--no-sandbox',json.loads(out))
        self.assertTrue(json.loads(parse('http://localhost:8080/','o.json','--insecure-no-sandbox'))['insecureNoSandbox'])
        self.assertIn('ERR:',parse('https://dev.redmap.me/','o.json','--insecure-no-sandbox'))   # needs the env opt-in off localhost
    def test_untrusted_urls_refused(self):
        for u in ['https://evil.example/','http://dev.redmap.me/','file:///etc/passwd','javascript:alert(1)','https://user:pw@dev.redmap.me/','https://dev.redmap.me.evil.example/','not a url']:
            self.assertTrue(parse(u,'o.json').startswith('ERR:'),u)
        self.assertEqual(json.loads(parse('https://evil.example/','o.json','--allow-host','evil.example'))['origin'],'https://evil.example')
    def test_unsafe_passthrough_flags_refused(self):
        for f in ['--no-sandbox','--disable-web-security','--remote-debugging-address=0.0.0.0','--proxy-server=x','--disable-features=IsolateOrigins']:
            self.assertTrue(parse('https://dev.redmap.me/','o.json','--',f).startswith('ERR:'),f)
        self.assertFalse(parse('https://dev.redmap.me/','o.json','--','--window-size=900,900').startswith('ERR:'))
    def test_script_refuses_before_starting_chrome(self):
        marker=tempfile.mktemp();fake=tempfile.mktemp();open(fake,'w').write('#!/bin/sh\ntouch %s\n'%marker);os.chmod(fake,0o755)
        for a in (['https://evil.example/','o.json',fake],['https://dev.redmap.me/','o.json',fake,'--','--no-sandbox']):
            r=subprocess.run([NODE,'dump_style_layers.mjs']+a,cwd=D,capture_output=True,text=True)
            self.assertEqual(r.returncode,2,r.stderr)
        self.assertFalse(os.path.exists(marker),'chrome must not be started for refused input')
    def test_default_launch_passes_no_unsafe_flags(self):
        argv=tempfile.mktemp();fake=tempfile.mktemp()
        open(fake,'w').write('#!/bin/sh\nprintf "%%s\\n" "$@" > %s\nsleep 1\n'%argv);os.chmod(fake,0o755)
        subprocess.run([NODE,'dump_style_layers.mjs','http://127.0.0.1:1/','o.json',fake],cwd=D,capture_output=True,text=True,timeout=40)
        a=open(argv).read().split('\n')
        self.assertIn('--remote-debugging-port=0',a)   # Chrome picks its own free port: parallel runs cannot collide
        self.assertIn('--headless=new',a);self.assertNotIn('--no-sandbox',a);self.assertIn('--remote-debugging-address=127.0.0.1',a)
    @unittest.skipUnless(CHROME,'google-chrome not installed')
    def test_chrome_really_starts_with_sandbox(self):
        d=tempfile.mkdtemp();_,out,_=js('console.log(JSON.stringify(chromeArgs({port:9871,dir:%s,extra:[],insecureNoSandbox:false})))'%json.dumps(d))
        p=subprocess.Popen([CHROME]+json.loads(out),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            ok=False
            for _ in range(60):
                try: ok='Browser' in json.load(urllib.request.urlopen('http://127.0.0.1:9871/json/version',timeout=1));break
                except Exception: time.sleep(0.5)
            self.assertTrue(ok,'sandboxed Chrome did not start; use --insecure-no-sandbox only in a disposable container')
        finally:
            p.kill();shutil.rmtree(d,ignore_errors=True)
if __name__=='__main__':unittest.main()

PAGE=b"""<!doctype html><body><script>
var th=localStorage.getItem('oref-theme')||'dark';
if(th==='dark')document.body.classList.add('dark');
window.map={isStyleLoaded:function(){return true},getStyle:function(){return {layers:[{id:'bg-'+th,type:'fill',source:'protomaps','source-layer':'earth'}]}}};
</script></body>"""
@unittest.skipUnless(NODE and CHROME,'node/google-chrome not installed')
class ParallelDumps(unittest.TestCase):
    def test_two_parallel_dumps_do_not_interfere(self):
        import http.server,threading
        class H(http.server.BaseHTTPRequestHandler):
            def do_GET(s):
                s.send_response(200);s.send_header('Content-Type','text/html');s.end_headers();s.wfile.write(PAGE)
            def log_message(*a):pass
        srv=http.server.ThreadingHTTPServer(('127.0.0.1',0),H);threading.Thread(target=srv.serve_forever,daemon=True).start()
        url='http://127.0.0.1:%d/'%srv.server_address[1];tmp=tempfile.mkdtemp()
        try:
            ps=[subprocess.Popen([NODE,'dump_style_layers.mjs',url,os.path.join(tmp,'o%d.json'%i)],cwd=D,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True) for i in range(3)]
            for p in ps:
                o,e=p.communicate(timeout=100);self.assertEqual(p.returncode,0,e+o)
            for i in range(3):
                ids=sorted(l['id'] for l in json.load(open(os.path.join(tmp,'o%d.json'%i))))
                self.assertEqual(ids,['bg-dark','bg-light'])      # both themes captured by every run
        finally:
            srv.shutdown();shutil.rmtree(tmp,ignore_errors=True)
