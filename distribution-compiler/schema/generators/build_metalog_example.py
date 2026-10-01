# -*- coding: utf-8 -*-
import json
import os
_HERE=os.path.dirname(os.path.abspath(__file__))
def _data(name): return os.path.join(_HERE,"data",name)
d=_data("")+os.sep
data=json.load(open(d+"metalog_curve.json"))
curve=data["curve"]; anchors=data["anchors"]

TEAL="#0e6e78"; TEALS="#e2f1f2"; STOP="#a63a2b"; AMBER="#b06d12"
INK="#151922"; SLATE="#59636f"; RULE="#e2e5ea"; FAINT="#9aa3ad"; MONO="ui-monospace,Menlo,monospace"
W,H=860,212; PL,PR,PT,PB=64,834,40,150
XMAX=140.0
def px(x): return PL+(x/XMAX)*(PR-PL)
# restrict curve to plot range and get ymax
cv=[(x,f) for x,f in curve if x<=XMAX]
ymax=max(f for _,f in cv)*1.18
def py(f): return PB-min(f,ymax)/ymax*(PB-PT)
def txt(x,y,s,size=10.5,fill=SLATE,anchor="start",weight="400"):
    return '<text x="%.1f" y="%.1f" font-family="%s" font-size="%s" fill="%s" text-anchor="%s" font-weight="%s">%s</text>'%(x,y,MONO,size,fill,anchor,weight,s)
area="M %.1f %.1f "%(px(cv[0][0]),PB)+" ".join("L %.1f %.1f"%(px(x),py(f)) for x,f in cv)+" L %.1f %.1f Z"%(px(cv[-1][0]),PB)
line="M "+" L ".join("%.1f %.1f"%(px(x),py(f)) for x,f in cv)
P50=round(data["overall"]["p50"]); P90=round(data["overall"]["p90"])
o=['<svg viewBox="0 0 %d %d" role="img" aria-label="A lower-semi-bounded metalog density fit to six observed paid prices (dots) up to about 140 dollars, plus a red stem at 0 dollars for the 13 percent free-tier mass; overall p05 and p10 are 0, p50 is %d, p90 is %d.">'%(W,H,P50,P90)]
o.append(txt(PL,26,"metalog — six observed prices, fit to a lower-semi-bounded quantile curve (+ $0 mass)",11.5,TEAL,weight="700"))
o.append('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s"/>'%(PL,PB,PR,PB,RULE))
for t in (0,30,60,90,120):
    x=px(t); o.append('<line x1="%.1f" y1="%d" x2="%.1f" y2="%d" stroke="%s"/>'%(x,PB,x,PB+4,FAINT))
    o.append(txt(x,PB+16,"$%d"%t,9,FAINT,anchor="middle"))
o.append(txt((PL+PR)/2,PB+34,"monthly list price ($)",9.5,SLATE,anchor="middle"))
o.append('<path d="%s" fill="%s"/>'%(area,TEALS))
o.append('<path d="%s" fill="none" stroke="%s" stroke-width="2"/>'%(line,TEAL))
# $0 mass stem (red)
x0=px(0); o.append('<line x1="%.1f" y1="%d" x2="%.1f" y2="%d" stroke="%s" stroke-width="6" stroke-linecap="round"/>'%(x0,PB,x0,PT+14,STOP))
o.append('<circle cx="%.1f" cy="%d" r="4.5" fill="%s"/>'%(x0,PT+14,STOP))
o.append(txt(x0+9,PT+14,"$0 · mass 13% (free tier)",9.5,STOP,weight="700"))
# anchor dots on the curve
for xp,f in anchors:
    o.append('<circle cx="%.1f" cy="%.1f" r="3.4" fill="%s" stroke="#fff" stroke-width="1.5"/>'%(px(xp),py(f),INK))
o.append(txt(px(anchors[-1][0])+2,py(anchors[-1][1])-8,"the 6 observed prices",9,INK))
# percentile markers p50, p90 (overall)
for lab,val in (("p50",data["overall"]["p50"]),("p90",data["overall"]["p90"])):
    x=px(val); o.append('<line x1="%.1f" y1="%d" x2="%.1f" y2="%d" stroke="%s" stroke-width="1" stroke-dasharray="3 3" opacity="0.55"/>'%(x,PB,x,PT,INK))
    o.append(txt(x,PB+30,lab,8.5,INK,anchor="middle",weight="700"))
    o.append(txt(x,PB+41,"$%d"%round(val),8.5,SLATE,anchor="middle"))
o.append('</svg>')
svg="\n      ".join(o)
FIG='  <div class="figure">\n      '+svg+'\n    <p class="figcap">The six paid prices (ink dots) sit at their rank-percentiles on a lower-semi-bounded metalog (teal); the red stem is the 13%% free-tier <b>mass</b> at $0. Because that mass fills the bottom 13%%, the overall <span class="mono">p05 = p10 = $0</span>, then <span class="mono">p50/p90 = $%d / $%d</span> — all read off the two-part fit.</p>\n  </div>'%(P50,P90)

open(d+"metalog_figure.html","w",encoding="utf-8").write(FIG)
print("figure built; overall:",data["overall"],"mean",data["mean"])
