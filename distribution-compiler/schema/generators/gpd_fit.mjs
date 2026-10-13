import { writeFileSync } from "node:fs";
import { data, dumps, fx, N, sig } from "./_shared.mjs";

function erfinv(y) {
  const a = 0.147, ln = Math.log(1 - y * y), t = 2 / (Math.PI * a) + ln / 2;
  return Math.sign(y || 1 / y) * Math.sqrt(Math.sqrt(t * t - ln / a) - t);
}
const median = 20.0, sigma = (Math.log(400) - Math.log(20)) / 1.2816;   // p50=20, p90=400
const mu = Math.log(median), pstar = 0.90, xi = 0.927;
const bpdf = (x) => (x <= 0 ? 0.0 : Math.exp(-((Math.log(x) - mu) * (Math.log(x) - mu)) / (2 * sigma * sigma)) / (x * sigma * Math.sqrt(2 * Math.PI)));
const bq = (p) => Math.exp(mu + sigma * Math.sqrt(2) * erfinv(2 * p - 1));
const xstar = bq(pstar), sg = (1 - pstar) / bpdf(xstar);
function sq(p) {
  if (p <= pstar) return bq(p);
  const u = (p - pstar) / (1 - pstar); return xstar + sg / xi * (Math.pow(1 - u, -xi) - 1);
}
function spdf(x) {
  if (x <= xstar) return bpdf(x);
  const y = x - xstar; return (1 - pstar) * (1 / sg) * Math.pow(1 + xi * y / sg, -1 / xi - 1);
}
const NN = 400000;
let s = 0.0;
for (let i = 1; i <= NN; i++) {
  const x0 = (i - 1) / NN * xstar, x1 = i / NN * xstar;
  s += 0.5 * (x0 * bpdf(x0) + x1 * bpdf(x1)) * (xstar / NN);
}
const mean = s + (1 - pstar) * (xstar + sg / (1 - xi));
const xs = Array.from({ length: 301 }, (_, i) => Math.pow(10, 6 * i / 300));
const q = () => Object.fromEntries([0.5, 0.9, 0.95, 0.99, 0.999, 0.9999].map((p) => [`p${sig(p * 100)}`, Math.round(sq(p))]));
writeFileSync(data("gpd_curve.json"), dumps({
  body: xs.map((x) => [(x), (x * bpdf(x))]), splice: xs.map((x) => [(x), (x * spdf(x))]),
  xstar: (xstar), sigma: (sigma), sigma_gpd: (sg), xi: (xi), mean: (mean), q: q(),
}));
console.log(`GPD: sigma=${fx(sigma, 3)} x*=${fx(xstar, 0)} sigma_gpd=${fx(sg, 0)} xi=${fx(xi, 3)} mean=${fx(mean, 0)}`);
console.log("  q:", JSON.stringify(q()));
