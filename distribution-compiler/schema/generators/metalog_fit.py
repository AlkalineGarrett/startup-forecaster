# -*- coding: utf-8 -*-
# Lower-semi-bounded metalog (bound at 0), k=5 terms, fit by OLS to the paid-price
# quantile anchors (fictional example: field-crew route-planning add-on list prices) at plotting positions i/(n+1); the $0 free tier is a separate mass.
# Dumps the density curve + two-part percentiles for the figure (build_metalog_example.py).
import math, json
import os
_HERE=os.path.dirname(os.path.abspath(__file__))
def _data(name): return os.path.join(_HERE,"data",name)

PAID=[12,18,24.99,32,44.99,72]
anch=[((i+1)/(len(PAID)+1), PAID[i]) for i in range(len(PAID))]
K=5; MASS=0.13
def basis(y):
    z=math.log(y/(1-y)); c=y-0.5
    return [1.0,z,c*z,c,c*c][:K]
def solve(A,b):
    n=len(b); M=[A[i][:]+[b[i]] for i in range(n)]
    for col in range(n):
        piv=max(range(col,n),key=lambda r:abs(M[r][col])); M[col],M[piv]=M[piv],M[col]
        dv=M[col][col]
        for j in range(col,n+1): M[col][j]/=dv
        for r in range(n):
            if r==col: continue
            f=M[r][col]
            for j in range(col,n+1): M[r][j]-=f*M[col][j]
    return [M[i][n] for i in range(n)]
tp=[(p, math.log(x)) for p,x in anch]           # lower-semi-bounded: log transform
AtA=[[0.0]*K for _ in range(K)]; Atx=[0.0]*K
for p,t in tp:
    g=basis(p)
    for i in range(K):
        Atx[i]+=g[i]*t
        for j in range(K): AtA[i][j]+=g[i]*g[j]
a=solve(AtA,Atx)
def Q(y): return math.exp(sum(a[i]*basis(y)[i] for i in range(K)))
def dens(y):                                     # paid density = 1/Q'(y)
    h=1e-4; yp=min(0.9999,y+h); ym=max(1e-4,y-h)
    dq=(Q(yp)-Q(ym))/(yp-ym); return 1.0/dq if dq>0 else 0.0
def oq(P): return 0.0 if P<=MASS else Q((P-MASS)/(1-MASS))

assert all(Q((i+1)/5000)<Q((i+2)/5000) for i in range(4996)), "metalog non-monotonic — infeasible fit"
N=40000; paid_mean=sum(Q(i/N) for i in range(1,N))/(N-1); overall_mean=(1-MASS)*paid_mean
tbl={p:oq(p) for p in (0.05,0.10,0.25,0.50,0.75,0.90,0.95)}

# density curve (paid part, scaled by paid prob) up to ~$140 tail
curve=[]
for i in range(1,990):
    y=i/1000.0; x=Q(y)
    if x>150: break
    curve.append((x,(1-MASS)*dens(y)))
anchor_pts=[(PAID[i],(1-MASS)*dens((i+1)/7.0)) for i in range(6)]
json.dump({"curve":curve,"anchors":anchor_pts,
           "overall":{("p%02d"%round(p*100)):round(v,2) for p,v in tbl.items()},
           "mean":round(overall_mean,1)}, open(_data("metalog_curve.json"),"w"))
print("lower-semi-bounded k=5; anchor fit:", ["%.1f"%Q(p) for p,_ in anch])
print("OVERALL:", {("p%02d"%round(p*100)):round(v) for p,v in tbl.items()}, "mean=%.0f"%overall_mean)
