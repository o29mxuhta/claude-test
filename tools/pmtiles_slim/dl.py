import urllib.request
URL='https://assets.redmap.dev/middle-east.pmtiles';N=75316759;C=4*1024*1024
h={'Origin':'https://dev.redmap.me','Referer':'https://dev.redmap.me/','User-Agent':'Mozilla/5.0 Chrome/130'}
f=open('full-orig.pmtiles','wb');o=0;n=0
while o<N:
    e=min(o+C,N)-1
    r=urllib.request.Request(URL,headers=dict(h,Range=f'bytes={o}-{e}'))
    d=urllib.request.urlopen(r).read();assert len(d)==e-o+1,(len(d),o)
    f.write(d);o=e+1;n+=1;print(n,o,flush=True)
f.close()
