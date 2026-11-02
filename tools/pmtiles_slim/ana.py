import sys,json,struct
from pm import *
from kinds import tile_layers
LAY=[l for l in json.load(open('layers.json')) if l.get('sl')]
def parse_value(sub):
    p=0;v=None
    while p<len(sub):
        k,p=vi(sub,p);f,w=k>>3,k&7
        if w==2:
            l,p=vi(sub,p);v=sub[p:p+l].decode('utf8','replace');p+=l
        elif w==0:
            x,p=vi(sub,p)
            if f==7:v=bool(x)
            elif f==6:v=(x>>1)^-(x&1)
            else:v=x
        elif w==5:v=struct.unpack('<f',sub[p:p+4])[0];p+=4
        elif w==1:v=struct.unpack('<d',sub[p:p+8])[0];p+=8
    return v
def parse_layer(body):
    keys=[];vals=[];feats=[]
    q=0
    kk,q=vi(body,q);ll,q=vi(body,q);q+=ll
    while q<len(body):
        kk,q=vi(body,q);f,w=kk>>3,kk&7
        if w==2:
            l,q=vi(body,q);sub=body[q:q+l];q+=l
            if f==3:keys.append(sub.decode())
            elif f==4:vals.append(parse_value(sub))
            elif f==2:feats.append(sub)
        elif w==0:_,q=vi(body,q)
        elif w==5:q+=4
        elif w==1:q+=8
    return keys,vals,feats
def feat(fb):
    p=0;tags=[];gt=0
    while p<len(fb):
        k,p=vi(fb,p);f,w=k>>3,k&7
        if w==2:
            l,p=vi(fb,p);sub=fb[p:p+l];p+=l
            if f==2:
                q=0
                while q<len(sub):
                    v,q=vi(sub,q);tags.append(v)
        elif w==0:
            x,p=vi(fb,p)
            if f==3:gt=x
    return tags,gt
def ev(e,pr):
    if not isinstance(e,list):return e
    op=e[0]
    if op=='all':return all(ev(x,pr) for x in e[1:])
    if op=='any':return any(ev(x,pr) for x in e[1:])
    if op=='!':return not ev(e[1],pr)
    if op=='has':return (e[1] if isinstance(e[1],str) else None) in pr
    if op=='!has':return e[1] not in pr
    if op=='get':return pr.get(e[1])
    if op=='literal':return e[1]
    k=e[1];kv=pr.get(k) if isinstance(k,str) else ev(k,pr)
    if op=='==':return kv==ev(e[2],pr)
    if op=='!=':return kv!=ev(e[2],pr)
    if op=='in':
        lst=e[2:]
        if len(lst)==1 and isinstance(lst[0],list) and lst[0] and lst[0][0]=='literal':lst=lst[0][1]
        return kv in lst
    if op=='<=':return kv is not None and kv<=e[2]
    raise Exception('op '+op)
def drawn(sl,pr,gt,z):
    for l in LAY:
        if l['sl']!=sl:continue
        if l.get('minzoom') is not None and z<l['minzoom']:continue
        if l.get('maxzoom') is not None and z>=l['maxzoom']:continue
        if l['type']=='fill' and gt!=3:continue
        if l['type']=='line' and gt==1:continue
        f=l['filter']
        if f is None or ev(f,pr):return l['id']
    return None
def run(z,lon,lat,rx,ry,disp):
    cx,cy=lonlat2tile(lon,lat,z)
    st={};comp=0;n=0
    for dx in range(-rx,rx+1):
        for dy in range(-ry,ry+1):
            t=gettile(z,cx+dx,cy+dy)
            if not t:continue
            n+=1;comp+=len(t)
            for nm,body in tile_layers(t).items():
                keys,vals,feats=parse_layer(body)
                s=st.setdefault(nm,[0,0,0,0])
                for fb in feats:
                    tags,gt=feat(fb)
                    pr={keys[tags[i]]:vals[tags[i+1]] for i in range(0,len(tags),2)}
                    d=drawn(nm,pr,gt,disp)
                    s[0]+=1;s[1]+=len(fb)
                    if d is None:s[2]+=1;s[3]+=len(fb)
    return n,comp,st
if __name__=='__main__':
    z,lon,lat,rx,ry=int(sys.argv[1]),float(sys.argv[2]),float(sys.argv[3]),int(sys.argv[4]),int(sys.argv[5])
    disp=float(sys.argv[6]) if len(sys.argv)>6 else z+0.2
    n,comp,st=run(z,lon,lat,rx,ry,disp)
    tot=sum(v[1] for v in st.values());un=sum(v[3] for v in st.values())
    print(f'z{z} tiles={n} compressed={comp} rawfeatbytes={tot} never-drawn={un} ({100*un/tot:.0f}%)')
    for k,v in sorted(st.items(),key=lambda a:-a[1][1]):print(f'  {k:11s} feats={v[0]:6d} bytes={v[1]:8d} undrawn_feats={v[2]:6d} undrawn_bytes={v[3]:8d} ({100*v[3]/max(1,v[1]):.0f}%)')
