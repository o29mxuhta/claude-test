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
    return gzip.compress(bytes(d),9)
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
if __name__=='__main__':
    B,H,(mo,ml),(do,dl),tiles=load('full-orig.pmtiles')
    print('entries',len(tiles),'addressed',sum(t[1] for t in tiles),flush=True)
    blobs={};order=[]
    for t in tiles:
        k=(t[2],t[3])
        if k not in blobs:blobs[k]=None;order.append((t[0],k))
    print('unique blobs',len(blobs),flush=True)
    data=bytearray();t0=time.time();newoff={}
    for i,(tid,k) in enumerate(order):
        raw=B[do+k[0]:do+k[0]+k[1]]
        z=idz(tid)
        nt,_=slim_tile(raw,z)
        newoff[k]=(len(data),len(nt));data+=nt
        if i%500==0:print(i,round(time.time()-t0),len(data),flush=True)
    new=[(t[0],t[1],newoff[(t[2],t[3])][0],newoff[(t[2],t[3])][1]) for t in tiles]
    LEAF=1500;leaves=bytearray();rootents=[]
    for i in range(0,len(new),LEAF):
        ch=new[i:i+LEAF];blob=encdir(ch)
        rootents.append((ch[0][0],0,len(leaves),len(blob)));leaves+=blob
    root=encdir(rootents)
    meta=B[mo:mo+ml]
    ro=127;mo2=ro+len(root);lo2=mo2+len(meta);do2=lo2+len(leaves)
    H2=bytearray(H)
    struct.pack_into('<8Q',H2,8,ro,len(root),mo2,len(meta),lo2,len(leaves),do2,len(data))
    struct.pack_into('<3Q',H2,72,sum(t[1] for t in new),len(new),len(newoff))
    open('full-slim.pmtiles','wb').write(bytes(H2)+root+meta+leaves+bytes(data))
    print('DONE',len(root),len(leaves),len(data),flush=True)
