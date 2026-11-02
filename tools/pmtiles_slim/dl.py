import urllib.request,urllib.error,re,sys
URL='https://assets.redmap.dev/middle-east.pmtiles';C=4*1024*1024
H={'Origin':'https://dev.redmap.me','Referer':'https://dev.redmap.me/','User-Agent':'Mozilla/5.0 Chrome/130'}
def download(url=URL,out='full-orig.pmtiles',chunk=C,headers=H):
    """Download a whole archive with range reads pinned to one object version.
    The first read records the ETag and total size. Every later read sends If-Match and its response ETag must
    equal the first one, so a replaced object fails the download instead of mixing two versions into one file.
    (The response check is needed because a CDN cache may answer without honouring If-Match.)"""
    def get(o,e,etag=None):
        h=dict(headers,Range=f'bytes={o}-{e}')
        if etag:h['If-Match']=etag
        r=urllib.request.urlopen(urllib.request.Request(url,headers=h))
        return r.read(),r.headers
    d,hd=get(0,chunk-1)
    etag=hd.get('ETag');total=int(re.match(r'bytes \d+-\d+/(\d+)',hd['Content-Range']).group(1))
    if not etag:raise RuntimeError('server sent no ETag, cannot pin the object version')
    with open(out,'wb') as f:
        f.write(d);o=len(d);n=1
        while o<total:
            e=min(o+chunk,total)-1
            d,h2=get(o,e,etag)
            if h2.get('ETag')!=etag:raise RuntimeError('object changed during download: %r -> %r'%(etag,h2.get('ETag')))
            assert len(d)==e-o+1,(len(d),o)
            f.write(d);o=e+1;n+=1;print(n,o,flush=True)
    return etag,total
if __name__=='__main__':
    print(download())
