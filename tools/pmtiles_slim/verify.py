import struct,gzip,collections
from full import load,idz
from pm import vi,skip
def split(raw):
    p=0;out=[]
    while p<len(raw):
        k,p=vi(raw,p);f,w=k>>3,k&7
        if w==2:
            pl,p=ld(raw,p);out.append((f,pl))
        elif w==0:
            s=p;_,p=vi(raw,p);out.append((f,('v',raw[s:p])))
        elif w==5:out.append((f,('f4',raw[p:p+4])));p=skip(raw,p,5)
        elif w==1:out.append((f,('f8',raw[p:p+8])));p=skip(raw,p,1)
        else:p=skip(raw,p,w)   # groups / unknown wire types raise
    return out
def layers(t):
    raw=gzip.decompress(t) if t[:2]==b'\x1f\x8b' else t
    res=[];tops=[]
    for f,b in split(raw):
        if f==3:
            L=split(b);d={'feats':[],'rest':[]}
            for f2,b2 in L:
                if f2==2:d['feats'].append(b2)
                else:d['rest'].append((f2,b2))
                if f2==1:d['name']=b2
            res.append(d)
        else:tops.append((f,b))
    return res,tops
B1,H1,m1,d1,t1=load('full-orig.pmtiles')
B2,H2,m2,d2,t2=load('full-slim.pmtiles')
print('header same except offsets:',H1[:8]==H2[:8],H1[72+24:]==H2[72+24:] )
print('metadata identical:',B1[m1[0]:m1[0]+m1[1]]==B2[m2[0]:m2[0]+m2[1]])
print('entries',len(t1),len(t2),'ids equal',[(a[0],a[1]) for a in t1]==[(a[0],a[1]) for a in t2])
assert [t[0] for t in t2]==sorted(t[0] for t in t2)
bad=0;dropped=collections.Counter();kept=collections.Counter();lost_layers=collections.Counter();tot=0;nonempty=0
seen=set()
for a,b in zip(t1,t2):
    assert b[2]+b[3]<=d2[1]
    k=(a[2],a[3])
    if k in seen:continue
    seen.add(k)
    o=B1[d1[0]+a[2]:d1[0]+a[2]+a[3]];s=B2[d2[0]+b[2]:d2[0]+b[2]+b[3]]
    lo,to=layers(o);ls,ts=layers(s);tot+=1
    if to!=ts:bad+=1;print('top mismatch',a[0]);continue
    on={l['name']:l for l in lo};sn={l['name']:l for l in ls}
    if [l['name'] for l in ls]!=[n for n in [l['name'] for l in lo] if n in sn]:bad+=1;print('order',a[0])
    for n,l in on.items():
        if n not in sn:lost_layers[n]+=1;dropped[n]+=len(l['feats']);continue
        m=sn[n]
        if m['rest']!=l['rest']:bad+=1;print('layer meta mismatch',a[0],n)
        c=collections.Counter(l['feats']);c2=collections.Counter(m['feats'])
        if c2-c:bad+=1;print('slim has feature not in orig',a[0],n)
        # order preserved
        it=iter(l['feats']);
        if not all(any(x==y for y in it) for x in m['feats']):bad+=1;print('order feats',a[0],n)
        dropped[n]+=len(l['feats'])-len(m['feats']);kept[n]+=len(m['feats'])
print('unique tiles checked',tot,'problems',bad)
print('kept',dict(kept));print('dropped',dict(dropped));print('layers fully removed from tiles',dict(lost_layers))
