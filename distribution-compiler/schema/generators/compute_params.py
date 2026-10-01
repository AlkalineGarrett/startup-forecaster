# -*- coding: utf-8 -*-
import math

# ---------- generic numeric CDF/quantile on a grid ----------
def grid_percentiles(pdf, lo, hi, ps, N=400000):
    xs = [lo + (hi-lo)*i/N for i in range(N+1)]
    cdf = [0.0]*(N+1)
    h = (hi-lo)/N
    for i in range(1, N+1):
        cdf[i] = cdf[i-1] + 0.5*(pdf(xs[i])+pdf(xs[i-1]))*h
    tot = cdf[-1]
    cdf = [c/tot for c in cdf]
    import bisect
    out = {}
    for p in ps:
        j = bisect.bisect_left(cdf, p)
        if j <= 0:
            out[p] = lo
        else:
            x0,x1 = xs[j-1],xs[j]; c0,c1 = cdf[j-1],cdf[j]
            out[p] = x1 if c1==c0 else x0 + (p-c0)/(c1-c0)*(x1-x0)
    return out, tot

# ---------- BETA(4.5, 2.4) ----------
a,b = 4.5,2.4
lnB = math.lgamma(a)+math.lgamma(b)-math.lgamma(a+b)
def beta_pdf(x):
    if x<=0 or x>=1: return 0.0
    return math.exp((a-1)*math.log(x)+(b-1)*math.log(1-x)-lnB)
ps=[0.05,0.10,0.25,0.50,0.75,0.90,0.95]
bp,_ = grid_percentiles(beta_pdf,0,1,ps)
beta_mean = a/(a+b)
print("BETA(4.5,2.4) mean=%.4f"%beta_mean)
for p in ps: print("   p%02d=%.4f"%(round(p*100),bp[p]))

# ---------- NORMAL(mean=110, sd=41) ----------
mu,sd = 110.0,41.0
def ncdf(x): return 0.5*(1+math.erf((x-mu)/(sd*math.sqrt(2))))
def nquant(p):
    # bisection
    lo,hi=-1000,2000
    for _ in range(200):
        m=(lo+hi)/2
        if ncdf(m)<p: lo=m
        else: hi=m
    return (lo+hi)/2
print("\nNORMAL(110,41) mean=110")
for p in [0.05,0.10,0.25,0.50,0.75,0.90,0.95]:
    print("   p%02d=%.1f"%(round(p*100),nquant(p)))

# ---------- GAMMA fit to (p10,p50,p90)=(0.1,0.47,1.5) ----------
def gamma_pdf_factory(k, rate):
    lg = math.lgamma(k)
    def f(x):
        if x<=0: return 0.0
        return math.exp(k*math.log(rate) + (k-1)*math.log(x) - rate*x - lg)
    return f
targets = {0.10:0.1, 0.50:0.47, 0.90:1.5}
best=None
kk=0.30
while kk<=2.501:
    # choose rate to hit p50 target: p50 of gamma(k,rate) scales as 1/rate
    f1 = gamma_pdf_factory(kk,1.0)
    q,_=grid_percentiles(f1,0,60,[0.10,0.50,0.90],N=120000)
    # rate so that q50/rate == 0.47  => rate = q50/0.47
    rate = q[0.50]/0.47
    fk = gamma_pdf_factory(kk,rate)
    qq,_=grid_percentiles(fk,0,60,[0.10,0.50,0.90],N=200000)
    err = (math.log(qq[0.10]/0.1))**2 + (math.log(qq[0.90]/1.5))**2
    if best is None or err<best[0]:
        best=(err,kk,rate,qq)
    kk+=0.02
err,k,rate,qq=best
print("\nGAMMA fit: shape k=%.3f rate=%.3f (mean=%.3f)"%(k,rate,k/rate))
ppg=[0.05,0.10,0.25,0.50,0.75,0.90,0.95]
fk=gamma_pdf_factory(k,rate)
qg,_=grid_percentiles(fk,0,80,ppg,N=300000)
for p in ppg: print("   p%02d=%.3f"%(round(p*100),qg[p]))
print("   check p10=%.3f p50=%.3f p90=%.3f (targets .1/.47/1.5)"%(qg[0.10],qg[0.50],qg[0.90]))

# ---------- UNIFORM(0.003, 0.012) : trivial ----------
print("\nUNIFORM(0.003,0.012) mean=%.5f  p10=%.5f p50=%.5f p90=%.5f"%(
    (0.003+0.012)/2, 0.003+0.1*0.009, 0.003+0.5*0.009, 0.003+0.9*0.009))
