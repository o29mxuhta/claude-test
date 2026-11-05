import sys,json,gzip
from ana import *
APP_BOUND=['all',['<=','kind_detail',2],['!=','disputed',True],['any',['==','adm0_l','ISR'],['==','adm0_r','ISR']]]
MAP_MAX_ZOOM=12  # the site map's maxZoom; z10 tiles (the archive's maxzoom) are overzoomed up to this
def _bounds():
    b=set()
    for l in LAY:
        for k in ('minzoom','maxzoom'):
            if l.get(k) is not None:b.add(float(l[k]))
    return b
def zooms(z):
    # Layer visibility is constant between style zoom bounds (active when minzoom<=d<maxzoom), so the
    # interval start plus every bound inside the interval covers every display zoom the tile can be drawn at.
    lo,hi=(float(z),z+1.0) if z<10 else (10.0,float(MAP_MAX_ZOOM))
    pts={lo}|{b for b in _bounds() if lo<b<hi or (z>=10 and b==hi)}
    if z>=10:pts.add(hi)
    return sorted(pts)
def keepfeat(nm,pr,gt,z):
    if nm=='boundaries':return True
    try:
        for d in zooms(z):
            if drawn(nm,pr,gt,d) is not None:return True
        return False
    except Exception:
        return True
def slim_tile(t,z):
    raw=gzip.decompress(t) if t[:2]==b'\x1f\x8b' else t
    out=bytearray();p=0;stats={}
    while p<len(raw):
        st=p;k,p=vi(raw,p);f,w=k>>3,k&7
        if w==2:
            body,p=ld(raw,p);l=len(body)
            if f!=3:
                out+=raw[st:p];continue
            q=0;kk,q=vi(body,q);nmb,q=ld(body,q);nm=nmb.decode()
            keys,vals,feats=parse_layer(body)
            nb=bytearray();q=0;kept=0;tot=0
            while q<len(body):
                s2=q;k2,q=vi(body,q);f2,w2=k2>>3,k2&7
                if w2==2:
                    sub,q=ld(body,q);l2=len(sub)
                    if f2==2:
                        tot+=1
                        tags,gt=feat(sub)
                        pr={keys[tags[i]]:vals[tags[i+1]] for i in range(0,len(tags),2)}
                        pr['$type']={1:'Point',2:'LineString',3:'Polygon'}[gt]
                        if not keepfeat(nm,pr,gt,z):continue
                        kept+=1
                    nb+=body[s2:q]
                else:
                    q=skip(body,q,w2);nb+=body[s2:q]
            stats[nm]=(tot,kept)
            if kept==0 and nm!='earth':continue
            # varint of length
            n=len(nb);v=bytearray()
            while True:
                b=n&127;n>>=7
                if n:v.append(b|128)
                else:v.append(b);break
            out+=raw[st:st+1]+bytes(v)+nb
        else:
            p=skip(raw,p,w);out+=raw[st:p]
    return gzip.compress(bytes(out),9,mtime=0),stats
if __name__=='__main__':
    z=int(sys.argv[1]);lon,lat=float(sys.argv[2]),float(sys.argv[3]);rx,ry=int(sys.argv[4]),int(sys.argv[5])
    cx,cy=lonlat2tile(lon,lat,z);o=s=0;n=0;agg={}
    for dx in range(-rx,rx+1):
        for dy in range(-ry,ry+1):
            t=gettile(z,cx+dx,cy+dy)
            if not t:continue
            nt,st=slim_tile(t,z);o+=len(t);s+=len(nt);n+=1
            for k,(a,b) in st.items():
                g=agg.setdefault(k,[0,0]);g[0]+=a;g[1]+=b
    print(f'z{z} {lon},{lat} tiles={n} orig_gz={o} slim_gz={s} saved={o-s} ({100*(o-s)/o:.0f}%)',{k:tuple(v) for k,v in agg.items()})
