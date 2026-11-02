import sys,gzip
from pm import *
def vi2(b,p):
    return vi(b,p)
def parse_layer(body):
    keys=[];vals=[];feats=[]
    q=0
    while q<len(body):
        kk,q=vi(body,q);f,w=kk>>3,kk&7
        if w==2:
            sub,q=ld(body,q);l=len(sub)
            if f==3:keys.append(sub.decode())
            elif f==4:
                # value msg: string_value field1
                p=0;v=None
                while p<len(sub):
                    k2,p=vi(sub,p);f2,w2=k2>>3,k2&7
                    if w2==2:
                        sv,p=ld(sub,p);v=sv.decode('utf8','replace')
                    elif w2==0:
                        v,p=vi(sub,p)
                    elif w2==5:p=skip(sub,p,5);v='f'
                    elif w2==1:p=skip(sub,p,1);v='d'
                    else:p=skip(sub,p,w2)
                vals.append(v)
            elif f==2:feats.append(sub)
        else:q=skip(body,q,w)
    return keys,vals,feats
def feat_tags(fb):
    p=0;tags=[];gl=0
    while p<len(fb):
        k,p=vi(fb,p);f,w=k>>3,k&7
        if w==2:
            sub,p=ld(fb,p);l=len(sub)
            if f==2:
                q=0
                while q<len(sub):
                    v,q=vi(sub,q);tags.append(v)
            elif f==4:gl=l
        else:p=skip(fb,p,w)
    return tags,gl
def tile_layers(t):
    b=gzip.decompress(t) if t[:2]==b'\x1f\x8b' else t
    p=0;out={}
    while p<len(b):
        k,p=vi(b,p);f,w=k>>3,k&7
        if w==2:
            body,p=ld(b,p);l=len(body)
            if f==3:
                q=0
                nm=None
                # name
                kk,q=vi(body,q);nmb,q=ld(body,q);nm=nmb.decode()
                out[nm]=body
        else:p=skip(b,p,w)
    return out
if __name__=='__main__':
    z=int(sys.argv[1]);lay=sys.argv[2];cx,cy=lonlat2tile(34.9,31.4,z)
    agg={}
    for dx in range(-1,2):
        for dy in range(-2,3):
            t=gettile(z,cx+dx,cy+dy)
            if not t:continue
            L=tile_layers(t)
            if lay not in L:continue
            keys,vals,feats=parse_layer(L[lay])
            for fb in feats:
                tags,gl=feat_tags(fb)
                d={keys[tags[i]]:vals[tags[i+1]] for i in range(0,len(tags),2)}
                k=str(d.get('kind'))+'/'+str(d.get('kind_detail',''))
                a=agg.setdefault(k,[0,0]);a[0]+=1;a[1]+=len(fb)
    for k,(n,b) in sorted(agg.items(),key=lambda a:-a[1][1])[:15]:print(f'{k:35s} n={n:6d} bytes={b}')
