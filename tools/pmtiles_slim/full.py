import sys,struct,gzip,time
from slim import slim_tile
from pm import vi,xyz2id
def readdir(b):
    n,p=vi(b,0);ids=[];last=0
    for i in range(n):
        d,p=vi(b,p);last+=d;ids.append(last)
    runs=[];lens=[];offs=[]
    for i in range(n):r,p=vi(b,p);runs.append(r)
    for i in range(n):l,p=vi(b,p);lens.append(l)
    for i in range(n):o,p=vi(b,p);offs.append(o)
    out=[];prev=None
    for i in range(n):
        o=offs[i]
        if o==0 and i>0:o=prev[2]+prev[3]
        else:o-=1
        prev=(ids[i],runs[i],o,lens[i]);out.append(prev)
    return out
def varint(n):
    v=bytearray()
    while True:
        b=n&127;n>>=7
        if n:v.append(b|128)
        else:v.append(b);break
    return bytes(v)
def encdir(ents):
    d=bytearray(varint(len(ents)));last=0
    for e in ents:d+=varint(e[0]-last);last=e[0]
    for e in ents:d+=varint(e[1])
    for e in ents:d+=varint(e[3])
    prev=None
    for e in ents:
        if prev is not None and e[2]==prev[2]+prev[3]:d+=varint(0)
        else:d+=varint(e[2]+1)
        prev=e
    return gzip.compress(bytes(d),9,mtime=0)
def idz(tid):
    z=0;acc=0
    while True:
        n=(1<<z)*(1<<z)
        if tid<acc+n:return z
        acc+=n;z+=1
def load(path):
    B=open(path,'rb').read()
    H=B[:127];ro,rl,mo,ml,lo,ll,do,dl=struct.unpack('<8Q',H[8:72])
    root=readdir(gzip.decompress(B[ro:ro+rl]))
    tiles=[]
    for e in root:
        if e[1]==0:tiles+=readdir(gzip.decompress(B[lo+e[2]:lo+e[2]+e[3]]))
        else:tiles.append(e)
    return B,H,(mo,ml),(do,dl),tiles
def slim_blobs(tiles,getraw,data,slim=None):
    """Slim every distinct (blob, zoom) pair. A blob shared by tiles at different zooms is slimmed once per zoom,
    because which features are drawn depends on the zoom. A blob whose slimmed output is identical at every zoom it is used at keeps one copy in `data`."""
    slim=slim or slim_tile
    newoff={};seen={};t0=time.time();n=0
    for t in tiles:
        k=(t[2],t[3],idz(t[0]))
        if k in newoff:continue
        nt,_=slim(getraw(k),k[2])
        sk=(k[0],k[1],nt)
        if sk not in seen:seen[sk]=(len(data),len(nt));data+=nt
        newoff[k]=seen[sk];n+=1
        if n%500==0:print(n,round(time.time()-t0),len(data),flush=True)
    return newoff,seen
if __name__=='__main__':
    B,H,(mo,ml),(do,dl),tiles=load('full-orig.pmtiles')
    print('entries',len(tiles),'addressed',sum(t[1] for t in tiles),flush=True)
    data=bytearray();newoff,stats=slim_blobs(tiles,lambda k:B[do+k[0]:do+k[0]+k[1]],data)
    print('unique (blob,zoom) slimmed',len(newoff),flush=True)
    new=[(t[0],t[1],newoff[(t[2],t[3],idz(t[0]))][0],newoff[(t[2],t[3],idz(t[0]))][1]) for t in tiles]
    LEAF=1500;leaves=bytearray();rootents=[]
    for i in range(0,len(new),LEAF):
        ch=new[i:i+LEAF];blob=encdir(ch)
        rootents.append((ch[0][0],0,len(leaves),len(blob)));leaves+=blob
    root=encdir(rootents)
    meta=B[mo:mo+ml]
    ro=127;mo2=ro+len(root);lo2=mo2+len(meta);do2=lo2+len(leaves)
    H2=bytearray(H)
    struct.pack_into('<8Q',H2,8,ro,len(root),mo2,len(meta),lo2,len(leaves),do2,len(data))
    struct.pack_into('<3Q',H2,72,sum(t[1] for t in new),len(new),len(set((e[2],e[3]) for e in new)))
    open('full-slim.pmtiles','wb').write(bytes(H2)+root+meta+leaves+bytes(data))
    print('DONE',len(root),len(leaves),len(data),flush=True)
