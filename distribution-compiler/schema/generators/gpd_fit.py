# -*- coding: utf-8 -*-
import math, json
import os
_HERE=os.path.dirname(os.path.abspath(__file__))
def _data(name): return os.path.join(_HERE,"data",name)
def erfinv(y):
    a=0.147; ln=math.log(1-y*y); t=2/(math.pi*a)+ln/2
    return math.copysign(math.sqrt(math.sqrt(t*t-ln/a)-t), y)
median=20.0; sigma=(math.log(400)-math.log(20))/1.2816   # p50=20, p90=400
mu=math.log(median); pstar=0.90; xi=0.927
bpdf=lambda x:0.0 if x<=0 else math.exp(-(math.log(x)-mu)**2/(2*sigma*sigma))/(x*sigma*math.sqrt(2*math.pi))
bq=lambda p:math.exp(mu+sigma*math.sqrt(2)*erfinv(2*p-1))
xstar=bq(pstar); sg=(1-pstar)/bpdf(xstar)
def sq(p):
    if p<=pstar: return bq(p)
    u=(p-pstar)/(1-pstar); return xstar+sg/xi*((1-u)**(-xi)-1)
def spdf(x):
    if x<=xstar: return bpdf(x)
    y=x-xstar; return (1-pstar)*(1/sg)*(1+xi*y/sg)**(-1/xi-1)
N=400000; s=0.0
for i in range(1,N+1):
    x0=(i-1)/N*xstar; x1=i/N*xstar
    s+=0.5*(x0*bpdf(x0)+x1*bpdf(x1))*(xstar/N)
mean=s+(1-pstar)*(xstar+sg/(1-xi))
xs=[10**(6*i/300) for i in range(301)]
json.dump({"body":[(x,x*bpdf(x)) for x in xs],"splice":[(x,x*spdf(x)) for x in xs],
  "xstar":xstar,"sigma":sigma,"sigma_gpd":sg,"xi":xi,"mean":mean,
  "q":{("p%g"%(p*100)):round(sq(p)) for p in (0.5,0.9,0.95,0.99,0.999,0.9999)}},
  open(_data("gpd_curve.json"),"w"))
print("GPD: sigma=%.3f x*=%.0f sigma_gpd=%.0f xi=%.3f mean=%.0f"%(sigma,xstar,sg,xi,mean))
print("  q:", {("p%g"%(p*100)):round(sq(p)) for p in (0.5,0.9,0.95,0.99,0.999,0.9999)})
