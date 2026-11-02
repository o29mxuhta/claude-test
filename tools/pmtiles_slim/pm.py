import urllib.request,struct,gzip,zlib,math,json,sys
URL='https://assets.redmap.dev/middle-east.pmtiles'
def rng(o,n):
    r=urllib.request.Request(URL,headers={'Range':f'bytes={o}-{o+n-1}','Origin':'https://dev.redmap.me','Referer':'https://dev.redmap.me/','User-Agent':'Mozilla/5.0 Chrome/130'})
    return urllib.request.urlopen(r).read()
H=root_off=root_len=meta_off=meta_len=leaf_off=leaf_len=data_off=data_len=ic=tc=tt=minz=maxz=root=None
def init():
    """Read the remote archive header on first use, so importing this module needs no network."""
    global H,root_off,root_len,meta_off,meta_len,leaf_off,leaf_len,data_off,data_len,ic,tc,tt,minz,maxz,root
    if H is not None:return
    H=rng(0,16384)
    assert H[:7]==b'PMTiles'
    rd=lambda o:struct.unpack('<Q',H[o:o+8])[0]
    root_off,root_len,meta_off,meta_len,leaf_off,leaf_len,data_off,data_len=[rd(8+8*i) for i in range(8)]
    ic,tc,tt=H[97],H[98],H[99]
    minz,maxz=H[100],H[101]
    root=readdir(dec(H[root_off:root_off+root_len],ic)) if root_off+root_len<=len(H) else readdir(dec(rng(root_off,root_len),ic))
def dec(b,c):
    return gzip.decompress(b) if c==2 else b
def vi(b,p):
    r=0;s=0
    while True:
        x=b[p];p+=1;r|=(x&127)<<s;s+=7
        if x<128:return r,p
def readdir(b):
    n,p=vi(b,0);e=[];last=0
    ids=[]
    for i in range(n):
        d,p=vi(b,p);last+=d;ids.append(last)
    runs=[]
    for i in range(n):
        r,p=vi(b,p);runs.append(r)
    lens=[]
    for i in range(n):
        l,p=vi(b,p);lens.append(l)
    offs=[];
    for i in range(n):
        o,p=vi(b,p)
        if o==0 and i>0: o=offs[i-1][0]+offs[i-1][1] if False else None
        offs.append([o,lens[i]])
    # fix offsets
    out=[]
    prev=None
    for i in range(n):
        o=offs[i][0]
        if o is None: o=prev[0]+prev[1]
        else: o=o-1
        prev=(o,lens[i]);out.append((ids[i],runs[i],o,lens[i]))
    return out
def xyz2id(z,x,y):
    acc=0
    for t in range(z): acc+=(1<<t)*(1<<t)
    n=1<<z;d=0;s=n//2
    rx=ry=0
    xx,yy=x,y
    while s>0:
        rx=1 if (xx&s)>0 else 0
        ry=1 if (yy&s)>0 else 0
        d+=s*s*((3*rx)^ry)
        if ry==0:
            if rx==1:
                xx=s-1-xx;yy=s-1-yy
            xx,yy=yy,xx
        s//=2
    return acc+d
def find(entries,tid):
    lo,hi=0,len(entries)-1
    while lo<=hi:
        m=(lo+hi)//2
        if entries[m][0]<=tid: lo=m+1
        else: hi=m-1
    if hi>=0:
        e=entries[hi]
        if e[3]>0 and tid<e[0]+e[1] if e[1]>0 else False: return ('tile',e)
        if e[1]==0: return ('leaf',e)
        if e[0]+e[1]>tid: return ('tile',e)
    return None
cache={}
def gettile(z,x,y):
    init()
    tid=xyz2id(z,x,y);ents=root
    for depth in range(4):
        r=find(ents,tid)
        if not r: return None
        k,e=r
        if k=='tile': return rng(data_off+e[2],e[3])
        key=e[2]
        if key not in cache: cache[key]=readdir(dec(rng(leaf_off+e[2],e[3]),ic))
        ents=cache[key]
def layers(b):
    init()
    b=dec(b,tc) if tc==2 else b
    if b[:2]==b'\x1f\x8b': b=gzip.decompress(b)
    p=0;out={}
    while p<len(b):
        k,p=vi(b,p);fn,wt=k>>3,k&7
        if wt==2:
            l,p=vi(b,p);body=b[p:p+l];p+=l
            if fn==3:
                q=0;name=None
                while q<len(body):
                    kk,q=vi(body,q);f2,w2=kk>>3,kk&7
                    if w2==2:
                        ll,q=vi(body,q)
                        if f2==1 and name is None: name=body[q:q+ll].decode()
                        q+=ll
                    elif w2==0: _,q=vi(body,q)
                    elif w2==5:q+=4
                    elif w2==1:q+=8
                out[name]=l
        elif wt==0: _,p=vi(b,p)
        else: break
    return out,len(b)
def lonlat2tile(lon,lat,z):
    n=2**z;x=int((lon+180)/360*n);y=int((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n);return x,y
if __name__=='__main__':
    z=int(sys.argv[1]);c=(float(sys.argv[2]),float(sys.argv[3]));rx=int(sys.argv[4]);ry=int(sys.argv[5])
    cx,cy=lonlat2tile(c[0],c[1],z)
    tot={};comp=0;raw=0;n=0
    for dx in range(-rx,rx+1):
        for dy in range(-ry,ry+1):
            t=gettile(z,cx+dx,cy+dy)
            if not t: continue
            comp+=len(t);L,rawl=layers(t);raw+=rawl;n+=1
            for k,v in L.items(): tot[k]=tot.get(k,0)+v
    print('z',z,'tiles',n,'compressed',comp,'raw',raw)
    for k,v in sorted(tot.items(),key=lambda a:-a[1]): print(f'{k:12s}{v:9d} {100*v/raw:5.1f}%')
