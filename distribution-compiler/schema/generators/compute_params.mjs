import { bisectLeft, fx, N } from "./_shared.mjs";

// ---------- generic numeric CDF/quantile on a grid ----------
function gridPercentiles(pdf, lo, hi, ps, n = 400000) {
  const xs = Array.from({ length: n + 1 }, (_, i) => lo + (hi - lo) * i / n);
  const cdf = new Array(n + 1).fill(0.0), h = (hi - lo) / n;
  for (let i = 1; i <= n; i++) cdf[i] = cdf[i - 1] + 0.5 * (pdf(xs[i]) + pdf(xs[i - 1])) * h;
  const tot = cdf[n];
  for (let i = 0; i <= n; i++) cdf[i] = cdf[i] / tot;
  const out = new Map();
  for (const p of ps) {
    const j = bisectLeft(cdf, p);
    if (j <= 0) out.set(p, lo);
    else {
      const x0 = xs[j - 1], x1 = xs[j], c0 = cdf[j - 1], c1 = cdf[j];
      out.set(p, c1 === c0 ? x1 : x0 + (p - c0) / (c1 - c0) * (x1 - x0));
    }
  }
  return [out, tot];
}
const pk = (p) => String(Math.round(p * 100)).padStart(2, "0");

// ---------- BETA(4.5, 2.4) ----------
{
  const a = 4.5, b = 2.4;
  const lnB = N.lgamma(a) + N.lgamma(b) - N.lgamma(a + b);
  const betaPdf = (x) => (x <= 0 || x >= 1 ? 0.0 : Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - lnB));
  const ps = [0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95];
  const [bp] = gridPercentiles(betaPdf, 0, 1, ps);
  console.log(`BETA(4.5,2.4) mean=${fx(a / (a + b), 4)}`);
  for (const p of ps) console.log(`   p${pk(p)}=${fx(bp.get(p), 4)}`);
}

// ---------- NORMAL(mean=110, sd=41) ----------
{
  const mu = 110.0, sd = 41.0;
  const ncdf = (x) => 0.5 * (1 + N.erf((x - mu) / (sd * Math.sqrt(2))));
  const nquant = (p) => {   // bisection
    let lo = -1000, hi = 2000;
    for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (ncdf(m) < p) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  console.log("\nNORMAL(110,41) mean=110");
  for (const p of [0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95]) console.log(`   p${pk(p)}=${fx(nquant(p), 1)}`);
}

// ---------- GAMMA fit to (p10,p50,p90)=(0.1,0.47,1.5) ----------
{
  const gammaPdfFactory = (k, rate) => {
    const lg = N.lgamma(k);
    return (x) => (x <= 0 ? 0.0 : Math.exp(k * Math.log(rate) + (k - 1) * Math.log(x) - rate * x - lg));
  };
  let best = null, kk = 0.30;
  while (kk <= 2.501) {
    // choose rate to hit p50 target: p50 of gamma(k,rate) scales as 1/rate
    const [q] = gridPercentiles(gammaPdfFactory(kk, 1.0), 0, 60, [0.10, 0.50, 0.90], 120000);
    const rate = q.get(0.50) / 0.47;   // rate so that q50/rate == 0.47
    const [qq] = gridPercentiles(gammaPdfFactory(kk, rate), 0, 60, [0.10, 0.50, 0.90], 200000);
    const e1 = Math.log(qq.get(0.10) / 0.1), e2 = Math.log(qq.get(0.90) / 1.5), err = e1 * e1 + e2 * e2;
    if (best === null || err < best[0]) best = [err, kk, rate, qq];
    kk += 0.02;
  }
  const [, k, rate] = best;
  console.log(`\nGAMMA fit: shape k=${fx(k, 3)} rate=${fx(rate, 3)} (mean=${fx(k / rate, 3)})`);
  const ppg = [0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95];
  const [qg] = gridPercentiles(gammaPdfFactory(k, rate), 0, 80, ppg, 300000);
  for (const p of ppg) console.log(`   p${pk(p)}=${fx(qg.get(p), 3)}`);
  console.log(`   check p10=${fx(qg.get(0.10), 3)} p50=${fx(qg.get(0.50), 3)} p90=${fx(qg.get(0.90), 3)} (targets .1/.47/1.5)`);
}

// ---------- UNIFORM(0.003, 0.012) : trivial ----------
console.log(`\nUNIFORM(0.003,0.012) mean=${fx((0.003 + 0.012) / 2, 5)}  p10=${fx(0.003 + 0.1 * 0.009, 5)} p50=${fx(0.003 + 0.5 * 0.009, 5)} p90=${fx(0.003 + 0.9 * 0.009, 5)}`);
