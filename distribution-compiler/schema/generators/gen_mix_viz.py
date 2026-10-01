import math, bisect, os
_HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(_HERE, "..", "field-crew-adoption-mixture.html")

lo, hi = 0.003, 0.012
a, b = 2.0, 24.0
wA, wB = 0.20, 0.80
XMAX = 0.30  # plot domain for adoption fraction

def beta_pdf(x):
    if x <= 0 or x >= 1: return 0.0
    return 600.0 * x**(a-1) * (1-x)**(b-1)      # 1/B(2,24)=600
def unif_pdf(x):
    return (1.0/(hi-lo)) if lo <= x <= hi else 0.0
def mix_pdf(x):
    return wA*unif_pdf(x) + wB*beta_pdf(x)

# fine CDF grid
N = 300000
xs = [i/N for i in range(N+1)]
cdf = [0.0]*(N+1)
for i in range(1, N+1):
    cdf[i] = cdf[i-1] + 0.5*(mix_pdf(xs[i])+mix_pdf(xs[i-1]))*(1.0/N)
tot = cdf[-1]
cdf = [c/tot for c in cdf]
def CDF(x):
    if x <= 0: return 0.0
    if x >= 1: return 1.0
    j = int(x*N); f = x*N - j
    return cdf[j] + f*(cdf[min(j+1,N)]-cdf[j])
def quant(p):
    j = bisect.bisect_left(cdf, p)
    if j <= 0: return 0.0
    x0, x1 = xs[j-1], xs[j]; c0, c1 = cdf[j-1], cdf[j]
    return x1 if c1 == c0 else x0 + (p-c0)/(c1-c0)*(x1-x0)
mean = wA*(lo+hi)/2 + wB*(a/(a+b))
P = {p: quant(p) for p in (0.05,0.10,0.25,0.50,0.75,0.90,0.95)}

# ---------- SVG geometry ----------
# PDF panel
PL, PR, PT, PB = 66, 862, 54, 250     # plot box
YCLIP = 10.0
def px(x): return PL + (x/XMAX)*(PR-PL)
def pyd(d): return PB - (min(d, YCLIP)/YCLIP)*(PB-PT)
# CDF panel
CT, CB = 336, 560
def pyc(c): return CB - c*(CB-CT)

# beta-body area (weighted) path
pts = [i for i in range(0, 601)]
def X(i): return i/600*XMAX
beta_area = "M %.1f %.1f " % (px(0), pyd(0))
for i in pts:
    beta_area += "L %.1f %.1f " % (px(X(i)), pyd(wB*beta_pdf(X(i))))
beta_area += "L %.1f %.1f Z" % (px(XMAX), pyd(0))
# beta-body outline (stroke)
beta_line = "M " + " L ".join("%.1f %.1f" % (px(X(i)), pyd(wB*beta_pdf(X(i)))) for i in pts)

# CDF curve
cdf_line = "M " + " L ".join("%.1f %.1f" % (px(X(i)), pyc(CDF(X(i)))) for i in pts)

# x ticks
xticks = [0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30]
def pct(x): return ("0" if x==0 else "%d%%" % round(x*100))

TEAL="#0e6e78"; TEALS="#dcedee"; AMBER="#b06d12"; AMBERS="#f3e7d2"
INK="#151922"; SLATE="#59636f"; RULE="#e2e5ea"; FAINT="#9aa3ad"

def txt(x,y,s,size=11,fill=SLATE,anchor="start",weight="400",mono=True):
    fam='ui-monospace,Menlo,monospace' if mono else 'ui-sans-serif,system-ui,sans-serif'
    return f'<text x="{x}" y="{y}" font-family="{fam}" font-size="{size}" fill="{fill}" text-anchor="{anchor}" font-weight="{weight}">{s}</text>'

svg = []
svg.append(f'<svg viewBox="0 0 900 600" role="img" aria-label="The adoption_rate weighted_combination: a uniform near-zero band weighted 20 percent plus a Beta(2,24) body weighted 80 percent. Top panel shows the combined density with a tall amber spike for the non-adopter band and the teal beta body. Bottom panel shows the cumulative distribution rising 20 percent across the narrow band then following the beta S-curve to 100 percent, with p10 p50 p90 marked.">')

# ---- PDF panel ----
svg.append(txt(PL, 34, "DENSITY — the two components add up", 12, TEAL, weight="700"))
# axes
svg.append(f'<line x1="{PL}" y1="{PB}" x2="{PR}" y2="{PB}" stroke="{RULE}"/>')
svg.append(f'<line x1="{PL}" y1="{PT}" x2="{PL}" y2="{PB}" stroke="{RULE}"/>')
for d in (0,5,10):
    y=pyd(d); svg.append(f'<line x1="{PL-4}" y1="{y:.1f}" x2="{PL}" y2="{y:.1f}" stroke="{FAINT}"/>')
    svg.append(txt(PL-8, y+3, str(d), 9, FAINT, anchor="end"))
for xt in xticks:
    x=px(xt); svg.append(f'<line x1="{x:.1f}" y1="{PB}" x2="{x:.1f}" y2="{PB+4}" stroke="{FAINT}"/>')
    svg.append(txt(x, PB+16, pct(xt), 9, FAINT, anchor="middle"))
svg.append(txt((PL+PR)/2, PB+30, "adoption share at maturity", 9.5, SLATE, anchor="middle"))
# beta body area + line
svg.append(f'<path d="{beta_area}" fill="{TEALS}" stroke="none"/>')
svg.append(f'<path d="{beta_line}" fill="none" stroke="{TEAL}" stroke-width="2"/>')
# band spike (clipped) amber
bx0, bx1 = px(lo), px(hi)
svg.append(f'<rect x="{bx0:.1f}" y="{PT}" width="{(bx1-bx0):.1f}" height="{PB-PT}" fill="{AMBERS}" stroke="{AMBER}" stroke-width="1.5"/>')
svg.append(f'<path d="M {(bx0+bx1)/2:.1f} {PT+2} l -4 8 M {(bx0+bx1)/2:.1f} {PT+2} l 4 8" stroke="{AMBER}" stroke-width="1.5" fill="none"/>')
svg.append(txt(bx1+8, PT+16, "20% of the mass — a near-zero band,", 9.5, AMBER, weight="700"))
svg.append(txt(bx1+8, PT+29, "density ≈ 22 (off the top of this scale)", 9, AMBER))
svg.append(txt(px(0.075), pyd(wB*beta_pdf(1/24))-8, "80% — the Beta(2,24) body", 9.5, TEAL, weight="700", anchor="middle"))
# note the sum
svg.append(txt(PR, 34, "f(x) = 0.20·uniform(x) + 0.80·beta(x)", 10, SLATE, anchor="end"))

# ---- CDF panel ----
svg.append(txt(PL, 316, "CUMULATIVE — how the mass accrues, left to right", 12, TEAL, weight="700"))
svg.append(f'<line x1="{PL}" y1="{CB}" x2="{PR}" y2="{CB}" stroke="{RULE}"/>')
svg.append(f'<line x1="{PL}" y1="{CT}" x2="{PL}" y2="{CB}" stroke="{RULE}"/>')
for c in (0,0.2,0.5,0.9,1.0):
    y=pyc(c); svg.append(f'<line x1="{PL-4}" y1="{y:.1f}" x2="{PR}" y2="{y:.1f}" stroke="{("#eef1f4") if c not in (0.2,) else "#f0e6d4"}"/>')
    svg.append(txt(PL-8, y+3, ("%d%%"%round(c*100)), 9, FAINT, anchor="end"))
for xt in xticks:
    x=px(xt); svg.append(f'<line x1="{x:.1f}" y1="{CB}" x2="{x:.1f}" y2="{CB+4}" stroke="{FAINT}"/>')
    svg.append(txt(x, CB+16, pct(xt), 9, FAINT, anchor="middle"))
# band region shade + label
svg.append(f'<rect x="{bx0:.1f}" y="{CT}" width="{(bx1-bx0):.1f}" height="{CB-CT}" fill="{AMBERS}" opacity="0.7"/>')
svg.append(txt(bx1+6, CT+40, "the band lifts the curve", 9, AMBER))
svg.append(txt(bx1+6, CT+52, "0 → 20% in 0.9% of width", 9, AMBER, weight="700"))
# cdf curve
svg.append(f'<path d="{cdf_line}" fill="none" stroke="{TEAL}" stroke-width="2.4"/>')
svg.append(txt(px(0.16), pyc(CDF(0.16))-10, "then the Beta body carries it to 100%", 9, TEAL))
# percentile markers
for p,lab in ((0.10,"p10"),(0.50,"p50"),(0.90,"p90")):
    xq=P[p]; x=px(xq); y=pyc(p)
    svg.append(f'<line x1="{x:.1f}" y1="{CB}" x2="{x:.1f}" y2="{y:.1f}" stroke="{INK}" stroke-width="1" stroke-dasharray="3 3"/>')
    svg.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3" fill="{INK}"/>')
    svg.append(txt(x, CB+30, f"{lab}", 9, INK, anchor="middle", weight="700"))
    svg.append(txt(x, CB+42, f"{xq*100:.1f}%", 9, SLATE, anchor="middle"))
# mean marker
xm=px(mean); svg.append(f'<line x1="{xm:.1f}" y1="{CT}" x2="{xm:.1f}" y2="{CB}" stroke="{AMBER}" stroke-width="1" stroke-dasharray="1 3"/>')
svg.append(txt(xm+4, CT+12, f"mean {mean*100:.1f}%", 9, AMBER))
svg.append(txt((PL+PR)/2, CB+30, "", 9))
svg.append('</svg>')
SVG = "\n      ".join(svg)

rows = "".join(f"<tr><td>{('p%02d'%round(p*100))}</td><td>{P[p]*100:.1f}%</td></tr>" for p in (0.05,0.10,0.25,0.50,0.75,0.90,0.95))

html = f"""<title>field-crew::adoption_rate — how the weighted_combination combines</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root{{--paper:#f5f6f8;--panel:#fff;--ink:#151922;--slate:#59636f;--rule:#e2e5ea;--teal:#0e6e78;--teal-soft:#e2f1f2;--amber:#b06d12;--amber-soft:#f6ecda;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;}}
  *{{box-sizing:border-box}} body{{margin:0}}
  .wrap{{background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.6;padding:0 0 5rem}}
  .col{{max-width:960px;margin:0 auto;padding:0 24px}}
  header.hero{{border-bottom:1px solid var(--rule);background:linear-gradient(180deg,#fbfcfd,#f5f6f8)}}
  .hero-inner{{padding:2.6rem 0 2rem}}
  .eyebrow{{font-family:var(--mono);font-size:.72rem;letter-spacing:.15em;text-transform:uppercase;color:var(--teal);font-weight:600}}
  h1{{font-size:1.8rem;font-weight:800;letter-spacing:-.02em;margin:.4rem 0 0;text-wrap:balance}}
  .lede{{font-size:1.05rem;color:var(--slate);max-width:72ch;margin:1rem 0 0}}
  h2{{font-size:1.15rem;font-weight:750;margin:2.2rem 0 .3rem}}
  p{{margin:.6rem 0;max-width:78ch}} .muted{{color:var(--slate)}}
  code{{font-family:var(--mono);font-size:.88em;background:#eceef2;border:1px solid var(--rule);border-radius:4px;padding:.03em .34em}}
  .chip{{display:inline-flex;align-items:center;gap:.4rem;font-family:var(--mono);font-size:.8rem;margin-right:1rem}}
  .sw{{width:.9em;height:.9em;border-radius:3px;display:inline-block}}
  .figure{{background:var(--panel);border:1px solid var(--rule);border-radius:14px;padding:14px 16px;overflow-x:auto;margin-top:1rem}}
  .figure svg{{display:block;min-width:840px;width:100%;height:auto}}
  ol{{max-width:78ch}} li{{margin:.35rem 0}}
  table.q{{border-collapse:collapse;font-family:var(--mono);font-size:.92rem;margin-top:.6rem}}
  table.q td{{padding:.28rem 1.2rem .28rem 0}}
  table.q td:first-child{{color:var(--slate)}} table.q td:nth-child(2){{font-weight:650;text-align:right}}
  .note{{background:var(--teal-soft);border:1px solid #8fc4c8;border-radius:10px;padding:.8rem 1rem;margin:1rem 0;font-size:.95rem}}
  .codebox{{background:#0f141b;border-radius:10px;overflow-x:auto;margin:.6rem 0}}
  .codebox pre{{margin:0;padding:.9rem 1.1rem;font-family:var(--mono);font-size:.78rem;line-height:1.6;color:#cdd6e0;white-space:pre-wrap;overflow-wrap:break-word}}
  .codebox .cmt{{color:#6b7787}} .codebox .a{{color:#e6b566}} .codebox .b{{color:#8fd0ad}}
  footer{{margin-top:2.5rem;border-top:1px solid var(--rule);padding-top:1.1rem;color:var(--slate);font-size:.88rem}}
</style>

<div class="wrap">
<header class="hero"><div class="col hero-inner">
  <div class="eyebrow">field-crew::adoption_rate · distribution = weighted_combination</div>
  <h1>How the uniform band and the Beta body combine</h1>
  <p class="lede">A <code style="font-family:var(--mono)">weighted_combination</code> is a <b>weighted blend of two sub-distributions</b> (a mixture distribution, in the usual stats sense). Here: a near-zero <b>uniform</b> band for
  the 20% who structurally never adopt, and a <b>Beta(2,24)</b> body for the 80% who do. They combine by weight — both
  as a sampling recipe and as a sum of densities.</p>
  <div style="margin-top:1.2rem">
    <span class="chip"><span class="sw" style="background:{AMBERS};border:1.5px solid {AMBER}"></span> uniform [0.003, 0.012] · weight 0.20</span>
    <span class="chip"><span class="sw" style="background:{TEALS};border:1.5px solid {TEAL}"></span> Beta(2,24) · weight 0.80</span>
  </div>
</div></header>

<div class="col">

<h2>Two ways to read “combine”</h2>
<ol>
  <li><b>As a recipe (how you'd sample it).</b> Flip a weighted coin: with probability <b>0.20</b> the firm is a
  structural non-adopter — draw its share from <code>uniform(0.003, 0.012)</code> (essentially nil). With probability
  <b>0.80</b> it's an adopter — draw from <code>Beta(2, 24)</code>. One draw, one component.</li>
  <li><b>As a density (how the curves add).</b> The <code>weighted_combination</code>'s density is the <b>weighted sum</b> of the two component
  densities: <code>f(x) = 0.20·uniform(x) + 0.80·beta(x)</code>. At any x you add the two (weighted) heights — which is
  why the near-zero band shows up as a tall amber spike, and the rest is the teal Beta hump.</li>
</ol>
<div class="note">The <code>allocation</code>'s <code>constraint: "sum(components[].weight) == 1"</code> is exactly what makes
this a valid blend: 0.20 + 0.80 = 1, so no probability is created or lost — the two pieces partition all the mass.</div>

<h2>The picture</h2>
<div class="figure">
      {SVG}
</div>
<p class="muted" style="font-size:.92rem">Top: the combined <b>density</b>. The amber band is drawn to the top of the frame
with an arrow because its true height (≈ 22) is far off this scale — that's 20% of the mass squeezed into a 0.9%-wide
sliver. Bottom: the combined <b>CDF</b>. Read it left to right: across the tiny amber band the curve jumps from 0 to 20%,
then the Beta body carries it the rest of the way to 100%. Percentiles are read straight off this curve.</p>

<h2>What falls out (the derived percentiles)</h2>
<p>Because 20% of the mass sits in the near-zero band, the bottom fifth of the distribution is essentially zero, and the
median lands inside the Beta body:</p>
<table class="q">
  <tr><td>mean</td><td>{mean*100:.1f}%</td></tr>
  {rows}
</table>
<p class="muted" style="font-size:.92rem">These are the node's <code>debug_computed_percentiles</code> — read off this
exact distribution by Monte-Carlo/quadrature, never authored.</p>

<h2>The distribution that produced it</h2>
<div class="codebox"><pre>"distribution": {{
  "kind": "weighted_combination",
  "components": [
    {{
      <span class="a">"name": "structural non-adopters"</span>,
      "distribution": {{
        "kind": "uniform",
        "low": 0.003,
        "high": 0.012
      }},
      "weight": 0.20
    }},
    {{
      <span class="b">"name": "adopting body"</span>,
      "distribution": {{
        "kind": "beta",
        "alpha": 2,
        "beta": 24
      }},
      "weight": 0.80
    }}
  ],
  "allocation": {{
    "constraint": "sum(components[].weight) == 1",
    "confidence": 30
  }}
}}</pre></div>

<footer>
  Curves and percentiles computed directly from <code>0.20·uniform(0.003,0.012) + 0.80·Beta(2,24)</code> (numerical
  quadrature of the density, inverse-CDF for the quantiles). Mean = 0.20·{(lo+hi)/2:.4f} + 0.80·{a/(a+b):.4f} = {mean:.4f}.
</footer>
</div></div>
"""
open(OUT, "w", encoding="utf-8").write(html)
print("mean", round(mean,4), "p10", round(P[0.10],4), "p50", round(P[0.50],4), "p90", round(P[0.90],4), "p95", round(P[0.95],4))
print("wrote", len(html), "bytes")
