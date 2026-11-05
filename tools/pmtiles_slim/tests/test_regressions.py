"""Regression fixtures for the pmtiles_slim review findings. Run from tools/pmtiles_slim:
   python3 -m unittest discover -s tests -v
No network is used (local HTTP server for the download test)."""
import sys,os,gzip,struct,threading,http.server,tempfile,unittest
sys.path.insert(0,os.path.join(os.path.dirname(__file__),'..'))
os.chdir(os.path.join(os.path.dirname(__file__),'..'))
import urllib.request
_orig=urllib.request.urlopen
def _no_net(*a,**k):
    raise RuntimeError('network used')
urllib.request.urlopen=_no_net      # importing the tool must not touch the network (finding 4)
import ana,slim,full,pm,dl
urllib.request.urlopen=_orig

def vi_enc(n):
    v=bytearray()
    while True:
        b=n&127;n>>=7
        if n:v.append(b|128)
        else:v.append(b);break
    return bytes(v)
def fld(f,w,payload):return vi_enc(f<<3|w)+payload
def ld(f,b):return fld(f,2,vi_enc(len(b))+b)
def val_int(x):return ld(4,fld(4,0,vi_enc(x)))      # value{int_value=x}
def val_bool(b):return ld(4,fld(7,0,vi_enc(int(b))))
def val_str(s):return ld(4,fld(1,2,vi_enc(len(s))+s.encode()))
def feature(tags,gt=3):
    return ld(2,ld(2,b''.join(vi_enc(t) for t in tags))+fld(3,0,vi_enc(gt)))
def layer(name,keys,vals,feats):
    return ld(3,ld(1,name.encode())+b''.join(ld(3,k.encode()) for k in keys)+b''.join(vals)+b''.join(feats)+fld(15,0,vi_enc(2)))
def layers_of(raw):
    raw=gzip.decompress(raw) if raw[:2]==b'\x1f\x8b' else raw
    out={};p=0
    while p<len(raw):
        k,p=pm.vi(raw,p)
        if k&7==2:
            l,p=pm.vi(raw,p);body=raw[p:p+l];p+=l
            if k>>3==3:
                q=0;_,q=pm.vi(body,q);nl,q=pm.vi(body,q);name=body[q:q+nl].decode()
                out[name]=len(ana.parse_layer(body)[2])
        elif k&7==0:_,p=pm.vi(raw,p)
        elif k&7==5:p+=4
        elif k&7==1:p+=8
    return out
class L:  # swap the style layer list for one test
    def __init__(s,layers):s.l=layers
    def __enter__(s):s.o=ana.LAY[:];ana.LAY[:]=s.l
    def __exit__(s,*a):ana.LAY[:]=s.o

class Findings(unittest.TestCase):
    def test1_shared_blob_is_slimmed_per_zoom(self):
        # same bytes used at z3 and z4; the fake slimmer keeps different output per zoom
        tiles=[(0,1,0,10),(5,1,0,10),(21,1,0,10)]   # tile ids at z0, z2, z3
        data=bytearray()
        zs=full.idz
        fake=lambda raw,z:(b'Z%d'%z,{})
        off,_=full.slim_blobs(tiles,lambda k:b'x'*10,data,slim=fake)
        outs={bytes(data[off[k][0]:off[k][0]+off[k][1]]) for k in off}
        self.assertEqual(outs,{b'Z0',b'Z2',b'Z3'})
        self.assertEqual(len(off),3)
        # when the output is identical at every zoom the copy is shared
        data=bytearray();same=lambda raw,z:(b'same',{})
        off,_=full.slim_blobs(tiles,lambda k:b'x'*10,data,slim=same)
        self.assertEqual(len(data),4)
    def test2_zoom_sampling_covers_fractional_bounds_and_maxzoom(self):
        lay={'id':'a','type':'fill','sl':'x','filter':None,'minzoom':3.25,'maxzoom':3.4}
        with L([lay]):
            self.assertTrue(slim.keepfeat('x',{},3,3))     # old sampling (z, z+.5, z+.99) missed [3.25,3.4)
        hi={'id':'b','type':'fill','sl':'x','filter':None,'minzoom':12.5}
        with L([hi]):
            old=slim.MAP_MAX_ZOOM
            try:
                slim.MAP_MAX_ZOOM=12;self.assertFalse(slim.keepfeat('x',{},3,10))
                slim.MAP_MAX_ZOOM=13;self.assertTrue(slim.keepfeat('x',{},3,10))   # maxZoom above 12 is honoured
            finally:slim.MAP_MAX_ZOOM=old
        with L([{'id':'c','type':'fill','sl':'x','filter':None,'minzoom':12}]):
            self.assertTrue(slim.keepfeat('x',{},3,10))   # layer active exactly at the map's max zoom
    def test3_negative_int_value(self):
        sub=fld(4,0,vi_enc((1<<64)-5))
        self.assertEqual(ana.parse_value(sub),-5)
        self.assertEqual(ana.parse_value(fld(4,0,vi_enc(7))),7)
        self.assertEqual(ana.parse_value(fld(6,0,vi_enc(9))),-5)   # sint zigzag unchanged
    def test4_import_is_offline(self):
        self.assertTrue(pm.H is None)     # header is read on first use only
    def test5_typed_equality(self):
        self.assertFalse(ana.ev(['==','disputed',True],{'disputed':1}))
        self.assertTrue(ana.ev(['!=','disputed',True],{'disputed':1}))
        self.assertTrue(ana.ev(['==','disputed',True],{'disputed':True}))
        self.assertFalse(ana.ev(['==','k',1],{'k':True}))
        self.assertTrue(ana.ev(['in','k',1,2],{'k':2}))
        self.assertFalse(ana.ev(['in','k',1],{'k':True}))
    def test6_unknown_fields_kept_or_loud(self):
        keep={'id':'a','type':'fill','sl':'x','filter':None}
        feats=[feature([0,0])]
        lay=layer('x',['k'],[val_int(1)],feats)
        tile=fld(9,5,b'abcd')+lay+fld(10,1,b'12345678')   # fixed-width unknown fields around a layer
        with L([keep]):
            out,_=slim.slim_tile(tile,5)
            self.assertEqual(layers_of(out),{'x':1})
            raw=gzip.decompress(out)
            self.assertIn(fld(9,5,b'abcd'),raw);self.assertIn(fld(10,1,b'12345678'),raw)
            with self.assertRaises(ValueError):slim.slim_tile(fld(11,3,b'')+lay,5)   # group wire type: fail, never truncate
    def test8_build_is_deterministic(self):
        keep={'id':'a','type':'fill','sl':'x','filter':None}
        tile=layer('x',['k'],[val_int(1)],[feature([0,0])])
        with L([keep]):
            a=slim.slim_tile(tile,5)[0];import time;time.sleep(1.1);b=slim.slim_tile(tile,5)[0]
        self.assertEqual(a,b)   # gzip mtime is fixed, so identical output shares one blob and rebuilds are byte-identical
    def test7_download_pins_object_version(self):
        blobs=[b'A'*30,b'B'*30];state={'i':0}
        class Hd(http.server.BaseHTTPRequestHandler):
            def log_message(s,*a):pass
            def do_GET(s):
                data=blobs[0] if (state['i']<1 or not s.headers.get('If-Match')) else blobs[1]
                state['i']+=1
                a,b=s.headers['Range'].split('=')[1].split('-');a=int(a);b=min(int(b),len(data)-1)
                s.send_response(206);s.send_header('ETag','"v1"' if data is blobs[0] else '"v2"')
                s.send_header('Content-Range','bytes %d-%d/%d'%(a,b,len(data)));s.send_header('Content-Length',str(b-a+1));s.end_headers()
                s.wfile.write(data[a:b+1])
        srv=http.server.HTTPServer(('127.0.0.1',0),Hd);threading.Thread(target=srv.serve_forever,daemon=True).start()
        url='http://127.0.0.1:%d/x'%srv.server_port;out=tempfile.mktemp()
        with self.assertRaises(RuntimeError):dl.download(url,out,chunk=10,headers={})
        state['i']=-99      # stable object: the same download succeeds
        et,total=dl.download(url,out,chunk=10,headers={})
        self.assertEqual((et,total,open(out,'rb').read()),('"v1"',30,b'A'*30))
        srv.shutdown()
if __name__=='__main__':unittest.main()
