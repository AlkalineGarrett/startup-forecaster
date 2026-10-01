# -*- coding: utf-8 -*-
import math, bisect
import os
_HERE=os.path.dirname(os.path.abspath(__file__))
def _data(name): return os.path.join(_HERE,"data",name)

TEAL="#0e6e78"; TEALS="#e2f1f2"; AMBER="#b06d12"; AMBERS="#f6ecda"
INK="#151922"; SLATE="#59636f"; RULE="#e2e5ea"; FAINT="#9aa3ad"; MONO="ui-monospace,Menlo,monospace"

# geometry
W,H=860,212
PL,PR,PT,PB=64,834,40,150

def txt(x,y,s,size=10.5,fill=SLATE,anchor="start",weight="400"):
    return f'<text x="{x:.1f}" y="{y:.1f}" font-family="{MONO}" font-size="{size}" fill="{fill}" text-anchor="{anchor}" font-weight="{weight}">{s}</text>'

def cdf_percentiles(pdf, lo, hi, ps, N=200000):
    xs=[lo+(hi-lo)*i/N for i in range(N+1)]; cdf=[0.0]*(N+1); h=(hi-lo)/N
    for i in range(1,N+1): cdf[i]=cdf[i-1]+0.5*(pdf(xs[i])+pdf(xs[i-1]))*h
    tot=cdf[-1]; cdfn=[c/tot for c in cdf]; mean=0.0
    for i in range(1,N+1): mean+=0.5*(xs[i]*pdf(xs[i])+xs[i-1]*pdf(xs[i-1]))*h
    mean/=tot
    out={}
    for p in ps:
        j=bisect.bisect_left(cdfn,p)
        out[p]= lo if j<=0 else xs[j-1]+(p-cdfn[j-1])/(cdfn[j]-cdfn[j-1])*(xs[j]-xs[j-1])
    return out, mean

def density_chart(title, unit_label, pdf, xlo, xhi, ticks, fmt, pmark, mean,
                  ycap=None, trunc=None, aria=""):
    px=lambda x: PL+(x-xlo)/(xhi-xlo)*(PR-PL)
    S=[pdf(xlo+(xhi-xlo)*i/240) for i in range(241)]
    ymax=ycap if ycap else max(S)*1.10
    py=lambda d: PB-min(d,ymax)/ymax*(PB-PT)
    pts=[(px(xlo+(xhi-xlo)*i/240), py(S[i])) for i in range(241)]
    area="M %.1f %.1f "%(px(xlo),PB)+" ".join("L %.1f %.1f"%(x,y) for x,y in pts)+" L %.1f %.1f Z"%(px(xhi),PB)
    line="M "+" L ".join("%.1f %.1f"%(x,y) for x,y in pts)
    o=[f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="{aria}">']
    o.append(txt(PL,26,title,11.5,TEAL,weight="700"))
    o.append(f'<line x1="{PL}" y1="{PB}" x2="{PR}" y2="{PB}" stroke="{RULE}"/>')
    o.append(f'<path d="{area}" fill="{TEALS}"/>')
    o.append(f'<path d="{line}" fill="none" stroke="{TEAL}" stroke-width="2"/>')
    for t in ticks:
        x=px(t); o.append(f'<line x1="{x:.1f}" y1="{PB}" x2="{x:.1f}" y2="{PB+4}" stroke="{FAINT}"/>')
        o.append(txt(x,PB+16,fmt(t),9,FAINT,anchor="middle"))
    o.append(txt((PL+PR)/2,PB+34,unit_label,9.5,SLATE,anchor="middle"))
    if trunc is not None:
        xt=px(trunc[0]); o.append(f'<line x1="{xt:.1f}" y1="{PT}" x2="{xt:.1f}" y2="{PB}" stroke="{AMBER}" stroke-width="1.4" stroke-dasharray="5 3"/>')
        o.append(txt(xt-6,PT+12,trunc[1],9,AMBER,anchor="end"))
    # mean (amber dotted)
    xm=px(mean); o.append(f'<line x1="{xm:.1f}" y1="{PT}" x2="{xm:.1f}" y2="{PB}" stroke="{AMBER}" stroke-width="1" stroke-dasharray="1 3"/>')
    o.append(txt(xm+4,PT+10,"mean "+fmt(mean),8.5,AMBER))
    # percentile markers
    for p,lab in pmark:
        x=px(p); dy=next(yy for xx,yy in pts if xx>=x-2) if x<=px(xhi) else PB
        o.append(f'<line x1="{x:.1f}" y1="{PB}" x2="{x:.1f}" y2="{PT}" stroke="{INK}" stroke-width="1" stroke-dasharray="3 3" opacity="0.55"/>')
        o.append(f'<circle cx="{x:.1f}" cy="{py(pdf(p)):.1f}" r="2.6" fill="{INK}"/>')
        o.append(txt(x,PB+30,lab,8.5,INK,anchor="middle",weight="700"))
        o.append(txt(x,PB+41,fmt(p),8.5,SLATE,anchor="middle"))
    o.append('</svg>')
    return "\n      ".join(o)

def figure(svg,cap):
    return f'  <div class="figure">\n      {svg}\n    <p class="figcap">{cap}</p>\n  </div>'

# ---------- pdfs ----------
def lognormal_pdf(mu,sig):
    return lambda x:0.0 if x<=0 else math.exp(-(math.log(x)-mu)**2/(2*sig*sig))/(x*sig*math.sqrt(2*math.pi))
def beta_pdf(a,b):
    lnB=math.lgamma(a)+math.lgamma(b)-math.lgamma(a+b)
    return lambda x:0.0 if x<=0 or x>=1 else math.exp((a-1)*math.log(x)+(b-1)*math.log(1-x)-lnB)
def normal_pdf(mu,sd):
    return lambda x: math.exp(-(x-mu)**2/(2*sd*sd))/(sd*math.sqrt(2*math.pi))
def gamma_pdf(k,rate):
    lg=math.lgamma(k)
    return lambda x:0.0 if x<=0 else math.exp(k*math.log(rate)+(k-1)*math.log(x)-rate*x-lg)

graphs={}

# ===== point_mass : field-crew::platform_bundling_severity =====
atoms=[(0.15,0.15),(0.55,0.25),(1.00,0.45),(1.30,0.15)]; xlo,xhi=0.0,1.5
pm_mean=round(sum(a*w for a,w in atoms)+1e-9,2)   # 0.805 -> 0.81 (round half up)
px=lambda x: PL+(x-xlo)/(xhi-xlo)*(PR-PL)
wmax=max(w for _,w in atoms); py=lambda w: PB-w/(wmax*1.15)*(PB-PT)
o=[f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="point_mass: four weighted atoms at x=0.15,0.55,1.00,1.30 with weights 0.15,0.25,0.45,0.15; mean {pm_mean:.2f}.">']
o.append(txt(PL,26,"point_mass — four atoms, one allocation of mass",11.5,TEAL,weight="700"))
o.append(f'<line x1="{PL}" y1="{PB}" x2="{PR}" y2="{PB}" stroke="{RULE}"/>')
for pos,w in atoms:
    x=px(pos); o.append(f'<line x1="{x:.1f}" y1="{PB}" x2="{x:.1f}" y2="{py(w):.1f}" stroke="{TEAL}" stroke-width="3"/>')
    o.append(f'<circle cx="{x:.1f}" cy="{py(w):.1f}" r="4.5" fill="{TEAL}"/>')
    o.append(txt(x,py(w)-8,"%.0f%%"%(w*100),9,TEAL,anchor="middle",weight="700"))
    o.append(txt(x,PB+16,"×%.2f"%pos,9,FAINT,anchor="middle"))
o.append(txt((PL+PR)/2,PB+34,"revenue multiplier ×",9.5,SLATE,anchor="middle"))
xm=px(pm_mean); o.append(f'<line x1="{xm:.1f}" y1="{PT}" x2="{xm:.1f}" y2="{PB}" stroke="{AMBER}" stroke-width="1" stroke-dasharray="1 3"/>')
o.append(txt(xm+4,PT+10,"mean ×%.2f"%pm_mean,8.5,AMBER))
o.append('</svg>')
graphs["field-crew::platform_bundling_severity"]=figure("\n      ".join(o),
  "Four fixed positions, each a spike whose height is its <span class=\"mono\">weight</span> (one <span class=\"mono\">allocation</span>, summing to 1). The mean ×%.2f is the derived readout — no smooth curve, the support <em>is</em> the four atoms."%pm_mean)

# ===== lognormal : field-crew::n_crews_reachable =====
FIRMS=14260   # latest value of the (fictional) business-register series — see series_extrapolate.py
mu=math.log(3400); pdf=lognormal_pdf(mu,0.5); xlo,xhi=0.0,15000.0
# truncated percentiles/mean below the firm count
pmt,meant=cdf_percentiles(pdf,1e-6,FIRMS,[0.10,0.50,0.90])
q10,q50,q90=(round(pmt[p]) for p in (0.10,0.50,0.90))
graphs["field-crew::n_crews_reachable"]=figure(density_chart(
  "lognormal — median 3,400, σ 0.5, clipped at the firm count","reachable field-service firms (count)",
  pdf,xlo,xhi,[0,2000,4000,6000,8000,10000,12000,14000],lambda v:("%.0f"%v if v<1000 else "%.0fk"%(v/1000)),
  [(pmt[0.10],"p10"),(pmt[0.50],"p50"),(pmt[0.90],"p90")],meant,
  trunc=(FIRMS,"truncation {:,}".format(FIRMS)),
  aria=f"lognormal density around a median of 3400 with a right tail, hard-clipped at the firm count {FIRMS}; p10/p50/p90 at {q10}/{q50}/{q90}."),
  "A right-skewed body around the register-derived median; the <span class=\"mono\">truncation</span> at the registered firm count ({:,}) cuts the far tail. <span class=\"mono\">p10/p50/p90 = {:,} / {:,} / {:,}</span> are read straight off the curve.".format(FIRMS,q10,q50,q90))

# ===== weighted_combination : field-crew::adoption_rate =====
uni=lambda x:(1.0/0.009) if 0.003<=x<=0.012 else 0.0
bpdf=beta_pdf(2,24); mix=lambda x:0.2*uni(x)+0.8*bpdf(x); xlo,xhi=0.0,0.30
pm,mean=cdf_percentiles(mix,1e-6,1.0,[0.10,0.50,0.90],N=300000)
graphs["field-crew::adoption_rate"]=figure(density_chart(
  "weighted_combination — 20% near-zero band + 80% Beta(2,24)","adoption share at maturity",
  mix,xlo,xhi,[0,0.05,0.10,0.15,0.20,0.25,0.30],lambda v:("0" if v==0 else "%d%%"%round(v*100)),
  [(pm[0.10],"p10"),(pm[0.50],"p50"),(pm[0.90],"p90")],mean,ycap=12.0,
  aria="a tall near-zero amber band holding 20 percent of the mass plus the 80 percent Beta(2,24) body; p10/p50/p90 at %.1f,%.1f,%.1f percent."%(pm[0.10]*100,pm[0.50]*100,pm[0.90]*100)),
  "The amber near-zero band (20%% of the mass, clipped here — its true density ≈ 22) plus the teal Beta body (80%%). The full density + CDF is on its own page; <span class=\"mono\">p10/p50/p90 = %.1f%% / %.1f%% / %.1f%%</span>."%(pm[0.10]*100,pm[0.50]*100,pm[0.90]*100))

# ===== beta : field-crew::share_of_jobs_scheduled =====
pdf=beta_pdf(4.5,2.4); pm,mean=cdf_percentiles(pdf,1e-6,1-1e-6,[0.10,0.50,0.90])
graphs["field-crew::share_of_jobs_scheduled"]=figure(density_chart(
  "beta — Beta(4.5, 2.4), left-skewed toward high capture","share of jobs scheduled in the app",
  pdf,0.0,1.0,[0,0.2,0.4,0.6,0.8,1.0],lambda v:("0" if v==0 else "%d%%"%round(v*100)),
  [(pm[0.10],"p10"),(pm[0.50],"p50"),(pm[0.90],"p90")],mean,
  aria="Beta(4.5,2.4) density on 0 to 1, unimodal and left-skewed with the peak near 0.7; p10/p50/p90 at %d,%d,%d percent."%tuple(round(pm[p]*100) for p in (0.10,0.50,0.90))),
  "Bounded on <span class=\"mono\">[0,1]</span> — no truncation needed. The mode sits high (α &gt; β); <span class=\"mono\">p10/p50/p90 = %d%% / %d%% / %d%%</span> are read off Beta(4.5, 2.4)."%tuple(round(pm[p]*100) for p in (0.10,0.50,0.90)))

# ===== normal : habit-app::active_days_per_year =====
pdf=normal_pdf(110,41); pm,mean=cdf_percentiles(pdf,-50,300,[0.10,0.50,0.90])
graphs["habit-app::active_days_per_year"]=figure(density_chart(
  "normal — Normal(110, 41), symmetric","active days / year (retained user)",
  pdf,0.0,220.0,[0,55,110,165,220],lambda v:"%d"%round(v),
  [(pm[0.10],"p10"),(pm[0.50],"p50"),(pm[0.90],"p90")],mean,
  aria="a symmetric bell centred at 110 with sd 41; p10/p50/p90 at %d,%d,%d days."%tuple(round(pm[p]) for p in (0.10,0.50,0.90))),
  "Symmetric, so <span class=\"mono\">mean = p50 = 110</span>. The derived <span class=\"mono\">p10/p90 = %d / %d</span> fall out of <span class=\"mono\">(mean 110, sd 41)</span>; the tiny mass below zero is why a floor would go in <span class=\"mono\">truncation</span>."%(round(pm[0.10]),round(pm[0.90])))

# ===== gamma : habit-app::referrals_per_user =====
pdf=gamma_pdf(1.25,2.0); pm,mean=cdf_percentiles(pdf,1e-6,8,[0.10,0.50,0.90])
gq=tuple(pm[p] for p in (0.10,0.50,0.90))
graphs["habit-app::referrals_per_user"]=figure(density_chart(
  "gamma — Gamma(1.25, 2.0), heavy near zero","referred sign-ups per paying user",
  pdf,0.0,4.0,[0,1,2,3,4],lambda v:"%.1f"%v if v not in (0,1,2,3,4) else "%d"%v,
  [(pm[0.10],"p10"),(pm[0.50],"p50"),(pm[0.90],"p90")],mean,
  aria="Gamma(1.25,2.0) density on 0 to infinity, piled toward zero with a long right tail; p10/p50/p90 at %.2f,%.2f,%.2f."%gq),
  "Non-negative and right-skewed — most users refer no one, a minority bring several friends along the tail. <span class=\"mono\">p10/p50/p90 = %.2f / %.2f / %.2f</span> come off Gamma(1.25, 2.0)."%gq)

# ===== uniform : structural band =====
lo,hi=0.003,0.012; pdf=lambda x:(1.0/(hi-lo)) if lo<=x<=hi else 0.0
xlo,xhi=0.0,0.016
graphs["the structural non-adopter band"]=figure(density_chart(
  "uniform — flat over [0.003, 0.012]","subscribe share (the near-zero band)",
  pdf,xlo,xhi,[0,0.004,0.008,0.012,0.016],lambda v:("0" if v==0 else "%.1f%%"%(v*100)),
  [(lo+0.1*(hi-lo),"p10"),(lo+0.5*(hi-lo),"p50"),(lo+0.9*(hi-lo),"p90")],(lo+hi)/2,
  aria="a flat rectangular density over 0.003 to 0.012; p10/p50/p90 at 0.39,0.75,1.11 percent, evenly spaced."),
  "Flat between the two grounded bounds, zero outside — the band <em>is</em> its own support. Percentiles are linear: <span class=\"mono\">p10/p50/p90 = 0.39% / 0.75% / 1.11%</span> are just positions along <span class=\"mono\">[0.003, 0.012]</span>.")

import json
open(_data("graphs.json"),"w",encoding="utf-8").write(json.dumps(graphs,ensure_ascii=False))
print("generated",len(graphs),"graphs:",", ".join(graphs.keys()))
