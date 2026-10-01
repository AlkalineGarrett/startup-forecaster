# -*- coding: utf-8 -*-
import json, math
import os
_HERE=os.path.dirname(os.path.abspath(__file__))
def _data(name): return os.path.join(_HERE,"data",name)
d=_data("")+os.sep
gpd=json.load(open(_data("gpd_curve.json"))); ts=json.load(open(_data("ts_curve.json")))
TEAL="#0e6e78";TEALS="#e2f1f2";AMBER="#b06d12";STOP="#a63a2b";INK="#151922";SLATE="#59636f";RULE="#e2e5ea";FAINT="#9aa3ad";MONO="ui-monospace,Menlo,monospace"
def txt(x,y,s,size=10.5,fill=SLATE,anchor="start",weight="400"):
    return '<text x="%.1f" y="%.1f" font-family="%s" font-size="%s" fill="%s" text-anchor="%s" font-weight="%s">%s</text>'%(x,y,MONO,size,fill,anchor,weight,s)

# ---------------- GPD graph (log-x density) ----------------
W,H,PL,PR,PT,PB=860,224,64,834,42,158
lx=lambda x: PL+(math.log10(x))/6.0*(PR-PL)   # x in [1,1e6]
body=[(x,v) for x,v in gpd["body"] if x>=1]
spl=[(x,v) for x,v in gpd["splice"] if x>=1]
ymax=max(max(v for _,v in body),max(v for _,v in spl))*1.12
py=lambda v: PB-min(v,ymax)/ymax*(PB-PT)
def path(pts): return "M "+" L ".join("%.1f %.1f"%(lx(x),py(v)) for x,v in pts)
o=['<svg viewBox="0 0 %d %d" role="img" aria-label="A log-x density of daily new installs. A lognormal body peaks near 20 per day; a dashed line shows the body tail dying by ~2000, while the solid spliced Generalized Pareto tail carries much heavier to ~347000 per day at p99.99. Threshold at the body p90 (400). Mean 815 per day, 41 times the median.">'%(W,H)]
o.append(txt(PL,26,"lognormal body + Generalized Pareto tail — the mean demands the heavy tail",11.5,TEAL,weight="700"))
o.append('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s"/>'%(PL,PB,PR,PB,RULE))
for e in range(0,7):
    x=PL+e/6.0*(PR-PL); lab=["1","10","100","1k","10k","100k","1M"][e]
    o.append('<line x1="%.1f" y1="%d" x2="%.1f" y2="%d" stroke="%s"/>'%(x,PB,x,PB+4,FAINT))
    o.append(txt(x,PB+16,lab,9,FAINT,anchor="middle"))
o.append(txt((PL+PR)/2,PB+34,"new installs per day (log scale)",9.5,SLATE,anchor="middle"))
o.append('<path d="%s L %.1f %.1f L %.1f %.1f Z" fill="%s"/>'%(path(spl),lx(spl[-1][0]),PB,lx(spl[0][0]),PB,TEALS))
o.append('<path d="%s" fill="none" stroke="%s" stroke-width="2.2"/>'%(path(spl),TEAL))
o.append('<path d="%s" fill="none" stroke="%s" stroke-width="1.4" stroke-dasharray="4 3" opacity="0.85"/>'%(path(body),SLATE))
# threshold
xt=lx(gpd["xstar"]); o.append('<line x1="%.1f" y1="%d" x2="%.1f" y2="%d" stroke="%s" stroke-width="1.3" stroke-dasharray="5 3"/>'%(xt,PT,xt,PB,AMBER))
o.append(txt(xt+5,PT+11,"splice at p90 (~400/day)",9,AMBER))
# percentile marks
for lab,val in (("p50",20),("p99",gpd["q"]["p99"]),("p99.9",gpd["q"]["p99.9"]),("p99.99",gpd["q"]["p99.99"])):
    x=lx(val); o.append('<line x1="%.1f" y1="%d" x2="%.1f" y2="%d" stroke="%s" stroke-width="1" stroke-dasharray="2 3" opacity="0.5"/>'%(x,PT,x,PB,INK))
    o.append(txt(x,PB+30,lab,8.5,INK,anchor="middle",weight="700"))
    o.append(txt(x,PB+41,("%.0f"%val if val<1000 else "%.0fk"%(val/1000)),8.5,SLATE,anchor="middle"))
o.append(txt(PR,26,"the body alone (dashed) dies; ξ=0.927, mean 815/day = 41× median",9,SLATE,anchor="end"))
o.append('</svg>')
GPD_FIG='  <div class="figure">\n      '+"\n      ".join(o)+'\n    <p class="figcap">The lognormal body (peak ~20/day) fits the quiet-app regime; the <b>dashed</b> line is the body\'s own tail — it dies by ~2,000/day. The archived <b>mean</b> (41× the median) demands the <b>solid</b> Generalized Pareto tail, which carries the rare viral launches: <span class="mono">p99.9 ≈ 41k</span>, <span class="mono">p99.99 ≈ 347k/day</span>. Shape ξ solved from the mean, scale slope-matched at the splice — no hard cap.</p>\n  </div>'

# ---------------- Time-series graph ----------------
W2,H2,QL,QR,QT,QB=860,196,66,834,40,146
yrs=[2019,2026]; ylo,yhi=12800,15600
qx=lambda y: QL+(y-yrs[0])/(yrs[1]-yrs[0])*(QR-QL)
qy=lambda v: QB-(v-ylo)/(yhi-ylo)*(QB-QT)
o2=['<svg viewBox="0 0 %d %d" role="img" aria-label="Registered small field-service firms 2019 to 2023 as four rising points from %d to %d, then a dashed CAGR extrapolation to %d in %d.">'%(W2,H2,ts["points"][0][1],ts["points"][-1][1],ts["extrapolated"],ts["target"])]
o2.append(txt(QL,26,"measure.series → extrapolate_cagr — a dated source, carried forward",11.5,TEAL,weight="700"))
o2.append('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s"/>'%(QL,QB,QR,QB,RULE))
for yv in (13000,13500,14000,14500,15000,15500):
    y=qy(yv); o2.append('<line x1="%d" y1="%.1f" x2="%d" y2="%.1f" stroke="#eef1f4"/>'%(QL,y,QR,y))
    o2.append(txt(QL-8,y+3,"%s"%("{:,}".format(yv)),8.5,FAINT,anchor="end"))
for yr in range(2019,2027):
    x=qx(yr); o2.append(txt(x,QB+15,str(yr),8.5,FAINT,anchor="middle"))
# observed line + points
pts=ts["points"]
o2.append('<path d="M '+" L ".join("%.1f %.1f"%(qx(y),qy(v)) for y,v in pts)+'" fill="none" stroke="%s" stroke-width="2.2"/>'%TEAL)
for y,v in pts:
    o2.append('<circle cx="%.1f" cy="%.1f" r="3.6" fill="%s" stroke="#fff" stroke-width="1.5"/>'%(qx(y),qy(v),INK))
    o2.append(txt(qx(y),qy(v)-9,"{:,}".format(v),8.5,INK,anchor="middle",weight="700"))
# extrapolation dashed
ly,lv=pts[-1]; ty,tv=ts["target"],ts["extrapolated"]
o2.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="2" stroke-dasharray="5 3"/>'%(qx(ly),qy(lv),qx(ty),qy(tv),AMBER))
o2.append('<circle cx="%.1f" cy="%.1f" r="4" fill="none" stroke="%s" stroke-width="2"/>'%(qx(ty),qy(tv),AMBER))
o2.append(txt(qx(ty),qy(tv)-10,"{:,}".format(tv),9,AMBER,anchor="middle",weight="700"))
o2.append(txt(qx(ty),qy(tv)+16,"extrapolate_cagr",8.5,AMBER,anchor="middle"))
o2.append(txt(QL+6,QT+12,"CAGR %.1f%%/yr (2019→2023)"%(ts["cagr"]*100),9,SLATE))
o2.append('</svg>')
TS_FIG='  <div class="figure">\n      '+"\n      ".join(o2)+'\n    <p class="figcap">The four observed counts are a <span class="mono">measure.series</span>; <span class="mono">extrapolate_cagr(series, 2026)</span> reads their %.1f%%/yr trend and carries it three years past the 2023 latest to <b>~{:,}</b> — a <span class="mono">computed_value</span> whose formula is auditable, not a hand-typed projection.</p>\n  </div>'.format(ts["extrapolated"])%(ts["cagr"]*100)

open(_data("gpd_fig.html"),"w").write(GPD_FIG)
open(_data("ts_fig.html"),"w").write(TS_FIG)
print("figures built. gpd text elems ok, ts ok.")
