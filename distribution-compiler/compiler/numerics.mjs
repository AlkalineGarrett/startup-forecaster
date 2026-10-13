// The numerical routines the compiler needs, with no dependencies.
//
//   normal      ndtr / ndtri / erf / erfc — Cephes' rational approximations
//   gamma fn    lgamma — log Γ(1+z) series near 1–2, Stirling's series above (absolute error ~1e-15)
//   beta        betainc / betaincinv — continued fraction + Halley-refined inverse
//   gamma       gammainc / gammaincinv — series / continued fraction + Halley-refined inverse
//   roots       brentq — Brent's method (the classic brentq.c); newton2 — 2-D Newton with a
//               forward-difference Jacobian
//   arrays      linspace, interp, mean, dot, lstsq (Householder QR with iterative refinement;
//               minimum-norm for underdetermined systems)
//
// Accuracy: ~1e-15 relative for the normal family, ~1e-13 or better elsewhere.

// error-free transformations (Dekker / Knuth), for lstsq's exact residuals
function twoSum(a, b) { const s = a + b, bb = s - a; return [s, (a - (s - bb)) + (b - bb)]; }
const SPLIT = 134217729;   // 2^27 + 1
function twoProd(a, b) {
  const p = a * b;
  let t = SPLIT * a; const ah = t - (t - a), al = a - ah;
  t = SPLIT * b; const bh = t - (t - b), bl = b - bh;
  return [p, ((ah * bh - p) + ah * bl + al * bh) + al * bl];
}

// ---------- polynomial helpers (Cephes polevl / p1evl) ----------
function polevl(x, c, n) {
  let ans = c[0];
  for (let i = 1; i <= n; i++) ans = ans * x + c[i];
  return ans;
}
function p1evl(x, c, n) {
  let ans = x + c[0];
  for (let i = 1; i < n; i++) ans = ans * x + c[i];
  return ans;
}

// ---------- erf / erfc (Cephes ndtr.c) ----------
const MAXLOG = 7.09782712893383996843e2;
const EP = [
  2.46196981473530512524e-10, 5.64189564831068821977e-1, 7.46321056442269912687e0, 4.86371970985681366614e1,
  1.96520832956077098242e2, 5.26445194995477358631e2, 9.34528527171957607540e2, 1.02755188689515710272e3,
  5.57535335369399327526e2,
];
const EQ = [
  1.32281951154744992508e1, 8.67072140885989742329e1, 3.54937778887819891062e2, 9.75708501743205489753e2,
  1.82390916687909736289e3, 2.24633760818710981792e3, 1.65666309194161350182e3, 5.57535340817727675546e2,
];
const ER = [
  5.64189583547755073984e-1, 1.27536670759978104416e0, 5.01905042251180477414e0, 6.16021097993053585195e0,
  7.40974269950448939160e0, 2.97886665372100240670e0,
];
const ES = [
  2.26052863220117276590e0, 9.39603524938001434673e0, 1.20489539808096656605e1, 1.70814450747565897222e1,
  9.60896809063285878198e0, 3.36907645100081516050e0,
];
const ET = [
  9.60497373987051638749e0, 9.00260197203842689217e1, 2.23200534594684319226e3, 7.00332514112805075473e3,
  5.55923013010394962768e4,
];
const EU = [
  3.35617141647503099647e1, 5.21357949780152679795e2, 4.59432382970980127987e3, 2.26290000613890934246e4,
  4.92673942608635921086e4,
];

export function erfc(a) {
  if (Number.isNaN(a)) return NaN;
  const x = Math.abs(a);
  if (x < 1.0) return 1.0 - erf(a);
  let z = -a * a;
  if (z < -MAXLOG) return a < 0 ? 2.0 : 0.0;
  z = Math.exp(z);
  let p, q;
  if (x < 8.0) { p = polevl(x, EP, 8); q = p1evl(x, EQ, 8); }
  else { p = polevl(x, ER, 5); q = p1evl(x, ES, 6); }
  let y = (z * p) / q;
  if (a < 0) y = 2.0 - y;
  if (y === 0.0) return a < 0 ? 2.0 : 0.0;
  return y;
}

export function erf(x) {
  if (Number.isNaN(x)) return NaN;
  if (x < 0.0) return -erf(-x);
  if (Math.abs(x) > 1.0) return 1.0 - erfc(x);
  const z = x * x;
  return (x * polevl(z, ET, 4)) / p1evl(z, EU, 5);
}

const SQRT1_2 = 0.70710678118654752440;
/** The standard normal CDF. */
export function ndtr(a) {
  if (Number.isNaN(a)) return NaN;
  const x = a * SQRT1_2;
  const z = Math.abs(x);
  if (z < SQRT1_2) return 0.5 + 0.5 * erf(x);
  let y = 0.5 * erfc(z);
  if (x > 0) y = 1.0 - y;
  return y;
}

// ---------- ndtri (Cephes ndtri.c) ----------
const S2PI = 2.50662827463100050242e0;
const NP0 = [-5.99633501014107895267e1, 9.80010754185999661536e1, -5.66762857469070293439e1, 1.39312609387279679503e1, -1.23916583867381258016e0];
const NQ0 = [
  1.95448858338141759834e0, 4.67627912898881538453e0, 8.63602421390890590575e1, -2.25462687854119370527e2,
  2.00260212380060660359e2, -8.20372256168333339912e1, 1.59056225126211695515e1, -1.18331621121330003142e0,
];
const NP1 = [
  4.05544892305962419923e0, 3.15251094599893866154e1, 5.71628192246421288162e1, 4.40805073893200834700e1,
  1.46849561928858024014e1, 2.18663306850790267539e0, -1.40256079171354495875e-1, -3.50424626827848203418e-2,
  -8.57456785154685413611e-4,
];
const NQ1 = [
  1.57799883256466749731e1, 4.53907635128879210584e1, 4.13172038254672030440e1, 1.50425385692907503408e1,
  2.50464946208309415979e0, -1.42182922854787788574e-1, -3.80806407691578277194e-2, -9.33259480895457427372e-4,
];
const NP2 = [
  3.23774891776946035970e0, 6.91522889068984211695e0, 3.93881025292474443415e0, 1.33303460815807542389e0,
  2.01485389549179081538e-1, 1.23716634817820021358e-2, 3.01581553508235416007e-4, 2.65806974686737550832e-6,
  6.23974539184983293730e-9,
];
const NQ2 = [
  6.02427039364742014255e0, 3.67983563856160859403e0, 1.37702099489081330271e0, 2.16236993594496635890e-1,
  1.34204006088543189037e-2, 3.28014464682127739104e-4, 2.89247864745380683936e-6, 6.79019408009981274425e-9,
];
const EXPM2 = 0.13533528323661269189;   // Math.exp(-2)

/** The standard normal quantile. */
export function ndtri(y0) {
  if (y0 === 0.0) return -Infinity;
  if (y0 === 1.0) return Infinity;
  if (!(y0 > 0.0 && y0 < 1.0)) return NaN;
  let code = 1, y = y0;
  if (y > 1.0 - EXPM2) { y = 1.0 - y; code = 0; }
  if (y > EXPM2) {
    y = y - 0.5;
    const y2 = y * y;
    const x = y + y * ((y2 * polevl(y2, NP0, 4)) / p1evl(y2, NQ0, 8));
    return x * S2PI;
  }
  let x = Math.sqrt(-2.0 * Math.log(y));
  const x0 = x - Math.log(x) / x;
  const z = 1.0 / x;
  const x1 = x < 8.0 ? (z * polevl(z, NP1, 8)) / p1evl(z, NQ1, 8) : (z * polevl(z, NP2, 8)) / p1evl(z, NQ2, 8);
  x = x0 - x1;
  if (code !== 0) x = -x;
  return x;
}

// ---------- log-gamma ----------
const HALF_LOG_2PI = 0.91893853320467274178;
const EULER = 0.57721566490153286061;
// ζ(k) - 1 for k = 2..60 (Euler–Maclaurin from N = 20), the coefficients of the log Γ(1+z) series
const ZETA_M1 = (() => {
  const out = [0, 0];
  const N = 20;
  for (let k = 2; k <= 60; k++) {
    let s = 0;
    for (let n = N - 1; n >= 2; n--) s += Math.pow(n, -k);
    const t = Math.pow(N, -k);
    s += (N * t) / (k - 1) + t / 2 + (k * t) / (12 * N) - (k * (k + 1) * (k + 2) * t) / (720 * N * N * N)
      + (k * (k + 1) * (k + 2) * (k + 3) * (k + 4) * t) / (30240 * N ** 5);
    out.push(s);
  }
  return out;
})();
/** log Γ(1+z) for |z| <= 0.5: -Math.log1p(z) + z(1-γ) + Σ (-1)^k (ζ(k)-1) z^k / k (no cancellation near 1 and 2). */
function lgamma1p(z) {
  let s = 0, zk = z;
  for (let k = 2; k <= 60; k++) {
    zk *= z;
    const t = ((k % 2 ? -1 : 1) * ZETA_M1[k] * zk) / k;
    s += t;
    if (Math.abs(t) < 1e-18 * Math.abs(s)) break;
  }
  return -Math.log1p(z) + z * (1 - EULER) + s;
}
/** log Γ(x) for x > 0: the log Γ(1+z) series near 1–2, the recurrence below 15, Stirling's series above. */
export function lgamma(x) {
  if (Number.isNaN(x)) return NaN;
  if (x <= 0) return x === Math.floor(x) ? Infinity : lgammaReflect(x);
  if (x === 1 || x === 2) return 0;
  if (x < 0.5) return lgamma1p(x) - Math.log(x);                // Γ(x) = Γ(1+x)/x
  if (x <= 1.5) return lgamma1p(x - 1);
  if (x <= 2.5) return lgamma1p(x - 2) + Math.log(x - 1);       // Γ(x) = (x-1)Γ(x-1)
  if (x < 15) {
    let prod = 1, y = x;
    while (y > 2.5) { y -= 1; prod *= y; }
    return lgamma(y) + Math.log(prod);
  }
  const r = 1 / x, r2 = r * r;
  const series = r * (1 / 12 - r2 * (1 / 360 - r2 * (1 / 1260 - r2 * (1 / 1680 - r2 * (1 / 1188 - r2 * (691 / 360360 - r2 / 156))))));
  return (x - 0.5) * Math.log(x) - x + HALF_LOG_2PI + series;
}
function lgammaReflect(x) {   // log|Γ(x)| for negative non-integer x
  return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
}
/** lgamma(x) minus its Stirling approximation, for x >= 10 (the "lgammacor" of R / TOMS 708). */
function lgammacor(x) {
  const r = 1 / x, r2 = r * r;
  return r * (1 / 12 - r2 * (1 / 360 - r2 * (1 / 1260 - r2 * (1 / 1680 - r2 * (1 / 1188 - r2 * (691 / 360360 - r2 * (1 / 156 - r2 * (3617 / 122400))))))));
}
/** log B(a, b), arranged so large arguments do not cancel (R's lbeta). */
export function lbeta(a, b) {
  const p = Math.min(a, b), q = Math.max(a, b);
  if (p >= 10) {
    const corr = lgammacor(p) + lgammacor(q) - lgammacor(p + q);
    return Math.log(q) * -0.5 + HALF_LOG_2PI + corr + (p - 0.5) * Math.log(p / (p + q)) + q * Math.log1p(-p / (p + q));
  }
  if (q >= 10) {
    const corr = lgammacor(q) - lgammacor(p + q);
    return lgamma(p) + corr + p - p * Math.log(p + q) + (q - 0.5) * Math.log1p(-p / (p + q));
  }
  return lgamma(p) + lgamma(q) - lgamma(p + q);
}
/** x - Math.log(1 + x), accurate near 0. */
function rlog1(x) {
  if (Math.abs(x) > 0.5) return x - Math.log1p(x);
  const t = x / (2 + x), t2 = t * t;
  let term = t * t2, s = 0;
  for (let k = 1; k < 60; k++) {
    const d = term / (2 * k + 1);
    s += d;
    if (Math.abs(d) < 1e-18 * Math.abs(s)) break;
    term *= t2;
  }
  return x * t - 2 * s;
}

// ---------- regularized incomplete beta ----------
function betacf(a, b, x) {
  const FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 10000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return h;
}
/** x^a (1-x)^b / B(a,b) — the incomplete-beta front factor (TOMS 708 brcomp for large a, b). */
function betaFront(a, b, x) {
  const y = 1 - x;
  if (a >= 8 && b >= 8) {
    let h, x0, y0, lambda;
    if (a <= b) { h = a / b; x0 = h / (1 + h); y0 = 1 / (1 + h); lambda = a - (a + b) * x; }
    else { h = b / a; x0 = 1 / (1 + h); y0 = h / (1 + h); lambda = (a + b) * y - b; }
    let e = -lambda / a;
    const u = Math.abs(e) > 0.6 ? e - Math.log(x / x0) : rlog1(e);
    e = lambda / b;
    const v = Math.abs(e) > 0.6 ? e - Math.log(y / y0) : rlog1(e);
    const z = Math.exp(-(a * u + b * v));
    return (1 / Math.sqrt(2 * Math.PI)) * Math.sqrt(b * x0) * z * Math.exp(-(lgammacor(a) + lgammacor(b) - lgammacor(a + b)));
  }
  return Math.exp(a * Math.log(x) + b * Math.log1p(-x) - lbeta(a, b));
}
/** I_x(a, b), the regularized incomplete beta (the beta CDF). */
export function betainc(a, b, x) {
  if (Number.isNaN(x) || Number.isNaN(a) || Number.isNaN(b)) return NaN;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const fr = betaFront(a, b, x);
  if (x < (a + 1) / (a + b + 2)) return (fr * betacf(a, b, x)) / a;
  return 1 - (fr * betacf(b, a, 1 - x)) / b;
}
/** 1 - I_x(a, b), computed without cancellation. */
function betaincc(a, b, x) {
  if (x <= 0) return 1;
  if (x >= 1) return 0;
  const fr = betaFront(a, b, x);
  if (x < (a + 1) / (a + b + 2)) return 1 - (fr * betacf(a, b, x)) / a;
  return (fr * betacf(b, a, 1 - x)) / b;
}
/** The beta density. */
export function betapdf(x, a, b) {
  if (x < 0 || x > 1) return 0;
  if (x === 0) return a < 1 ? Infinity : a === 1 ? Math.exp(-lbeta(a, b)) : 0;
  if (x === 1) return b < 1 ? Infinity : b === 1 ? Math.exp(-lbeta(a, b)) : 0;
  return betaFront(a, b, x) / (x * (1 - x));
}

/** The x with I_x(a, b) = p : bracketed Halley iteration on the CDF. */
export function betaincinv(a, b, p) {
  if (Number.isNaN(p) || !(a > 0) || !(b > 0) || p < 0 || p > 1) return NaN;
  if (p === 0) return 0;
  if (p === 1) return 1;
  // the residual on the smaller tail keeps its relative precision: I_x - p, or (1-p) - (1-I_x)
  const lower = p <= 0.5, q = 1 - p;
  const resid = (x) => (lower ? betainc(a, b, x) - p : q - betaincc(a, b, x));
  // initial guess (Numerical Recipes 6.4)
  let x;
  if (a >= 1 && b >= 1) {
    const pp = p < 0.5 ? p : 1 - p;
    const t = Math.sqrt(-2 * Math.log(pp));
    let z = (2.30753 + t * 0.27061) / (1 + t * (0.99229 + t * 0.04481)) - t;
    if (p < 0.5) z = -z;
    const al = (z * z - 3) / 6;
    const h = 2 / (1 / (2 * a - 1) + 1 / (2 * b - 1));
    const w = (z * Math.sqrt(al + h)) / h - (1 / (2 * b - 1) - 1 / (2 * a - 1)) * (al + 5 / 6 - 2 / (3 * h));
    x = a / (a + b * Math.exp(2 * w));
  } else {
    const lna = Math.log(a / (a + b)), lnb = Math.log(b / (a + b));
    const t = Math.exp(a * lna) / a, u = Math.exp(b * lnb) / b, w = t + u;
    x = p < t / w ? Math.pow(a * w * p, 1 / a) : 1 - Math.pow(b * w * (1 - p), 1 / b);
  }
  if (!(x > 0 && x < 1)) x = 0.5;
  let lo = 0, hi = 1;
  for (let it = 0; it < 300; it++) {
    const f = resid(x);   // increasing in x
    if (f === 0) return x;
    if (f < 0) lo = x; else hi = x;
    const pdf = betapdf(x, a, b);
    let xn = NaN;
    if (pdf > 0 && Number.isFinite(pdf)) {
      const u = f / pdf;
      const d2 = (a - 1) / x - (b - 1) / (1 - x);   // (log pdf)'
      const corr = 1 - 0.5 * Math.min(1, Math.max(-1, u * d2));
      xn = x - u / corr;
    }
    if (!(xn > lo && xn < hi)) xn = (lo + hi) / 2;
    if (xn === x || Math.abs(xn - x) <= 1e-17 * Math.min(x, 1 - x)) return xn;
    x = xn;
  }
  return x;
}

// ---------- regularized incomplete gamma ----------
/** x^a e^-x / Γ(a), arranged so large a does not cancel. */
function gammaFront(a, x) {
  if (a >= 10) {
    const e = (x - a) / a;
    return Math.sqrt(a / (2 * Math.PI)) * Math.exp(-a * rlog1(e) - lgammacor(a));
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a));
}
function gammaSeries(a, x) {   // P(a, x) by its power series, x < a + 1
  let ap = a, sum = 1 / a, del = sum;
  for (let n = 0; n < 100000; n++) {
    ap += 1; del *= x / ap; sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-17) break;
  }
  return sum * gammaFront(a, x);
}
function gammaCF(a, x) {       // Q(a, x) by Legendre's continued fraction, x >= a + 1
  const FPMIN = 1e-300;
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let i = 1; i < 100000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return gammaFront(a, x) * h;
}
/** P(a, x), the regularized lower incomplete gamma (the gamma CDF). */
export function gammainc(a, x) {
  if (Number.isNaN(a) || Number.isNaN(x)) return NaN;
  if (x <= 0) return 0;
  if (x === Infinity) return 1;
  return x < a + 1 ? gammaSeries(a, x) : 1 - gammaCF(a, x);
}
/** Q(a, x) = 1 - P(a, x). */
export function gammaincc(a, x) {
  if (x <= 0) return 1;
  if (x === Infinity) return 0;
  return x < a + 1 ? 1 - gammaSeries(a, x) : gammaCF(a, x);
}
/** The x with P(a, x) = p : bracketed Halley iteration. */
export function gammaincinv(a, p) {
  if (Number.isNaN(p) || !(a > 0) || p < 0 || p > 1) return NaN;
  if (p === 0) return 0;
  if (p === 1) return Infinity;
  const upper = p > 0.5, target = upper ? 1 - p : p;
  const resid = (x) => (upper ? gammaincc(a, x) - target : gammainc(a, x) - target) * (upper ? -1 : 1);
  // initial guess: Wilson–Hilferty, or the small-x series for small a
  let x;
  if (a > 1) {
    const z = ndtri(p);
    const t = 1 / (9 * a);
    x = a * Math.pow(1 - t + z * Math.sqrt(t), 3);
    if (!(x > 0)) x = a * Math.exp((Math.log(p) + lgamma(a + 1)) / a);
  } else {
    const t = 1 - a * (0.253 + a * 0.12);
    x = p < t ? Math.pow(p / t, 1 / a) : 1 - Math.log(1 - (p - t) / (1 - t));
  }
  if (!(x > 0) || !Number.isFinite(x)) x = a;
  let lo = 0, hi = Infinity;
  const lga = lgamma(a);
  for (let it = 0; it < 300; it++) {
    const f = resid(x);   // increasing in x
    if (f === 0) return x;
    if (f < 0) lo = x; else hi = x;
    const pdf = Math.exp((a - 1) * Math.log(x) - x - lga);
    let xn;
    if (pdf > 0 && Number.isFinite(pdf)) {
      const u = f / pdf;
      const d2 = (a - 1) / x - 1;
      const corr = 1 - 0.5 * Math.min(1, Math.max(-1, u * d2));
      xn = x - u / corr;
    } else xn = NaN;
    if (!(xn > lo && xn < hi)) xn = hi === Infinity ? (x > 0 ? 2 * x + 1 : 1) : (lo + hi) / 2;
    if (Math.abs(xn - x) <= 1e-16 * x || xn === x) return xn;
    x = xn;
  }
  return x;
}

// ---------- Box–Cox (the generalized Pareto's ppf / cdf) ----------
/** The Box–Cox transform of 1+x: ((1+x)^λ - 1)/λ. */
export function boxcox1p(x, lmbda) {
  const lgx = Math.log1p(x);
  if (Math.abs(lmbda) < 1e-19 || (Math.abs(lgx) < 1e-289 && Math.abs(lmbda) < 1e273)) return lgx;
  return Math.expm1(lmbda * lgx) / lmbda;
}
/** The inverse of boxcox1p in x. */
export function invBoxcox1p(y, lmbda) {
  if (lmbda === 0) return Math.expm1(y);
  if (Math.abs(lmbda * y) < 1e-154) return y;
  return Math.expm1(Math.log1p(lmbda * y) / lmbda);
}

// ---------- root finding ----------
const RTOL_DEFAULT = 4 * Number.EPSILON;
/** Brent's root finder on a bracket [xa, xb] where f changes sign (the classic brentq.c). */
export function brentq(f, xa, xb, { xtol = 2e-12, rtol = RTOL_DEFAULT, maxiter = 100 } = {}) {
  if (!(xtol > 0)) throw new Error(`xtol too small (${xtol} <= 0)`);
  if (rtol < RTOL_DEFAULT) throw new Error(`rtol too small (${rtol} < ${RTOL_DEFAULT})`);
  let xpre = xa, xcur = xb, xblk = 0, fblk = 0, spre = 0, scur = 0;
  let fpre = f(xpre), fcur = f(xcur);
  if (fpre === 0) return xpre;
  if (fcur === 0) return xcur;
  if (signbit(fpre) === signbit(fcur)) throw new Error("f(a) and f(b) must have different signs");
  for (let i = 0; i < maxiter; i++) {
    if (fpre !== 0 && fcur !== 0 && signbit(fpre) !== signbit(fcur)) {
      xblk = xpre; fblk = fpre; spre = scur = xcur - xpre;
    }
    if (Math.abs(fblk) < Math.abs(fcur)) {
      xpre = xcur; xcur = xblk; xblk = xpre;
      fpre = fcur; fcur = fblk; fblk = fpre;
    }
    const delta = (xtol + rtol * Math.abs(xcur)) / 2;
    const sbis = (xblk - xcur) / 2;
    if (fcur === 0 || Math.abs(sbis) < delta) return xcur;
    if (Math.abs(spre) > delta && Math.abs(fcur) < Math.abs(fpre)) {
      let stry;
      if (xpre === xblk) {
        stry = (-fcur * (xcur - xpre)) / (fcur - fpre);   // interpolate
      } else {
        const dpre = (fpre - fcur) / (xpre - xcur);      // extrapolate
        const dblk = (fblk - fcur) / (xblk - xcur);
        stry = (-fcur * (fblk * dblk - fpre * dpre)) / (dblk * dpre * (fblk - fpre));
      }
      if (2 * Math.abs(stry) < Math.min(Math.abs(spre), 3 * Math.abs(sbis) - delta)) {
        spre = scur; scur = stry;   // good short step
      } else {
        spre = sbis; scur = sbis;   // bisect
      }
    } else {
      spre = sbis; scur = sbis;
    }
    xpre = xcur; fpre = fcur;
    if (Math.abs(scur) > delta) xcur += scur;
    else xcur += sbis > 0 ? delta : -delta;
    fcur = f(xcur);
  }
  throw new Error(`Failed to converge after ${maxiter} iterations, value is ${xcur}`);
}
function signbit(x) { return x < 0 || Object.is(x, -0); }

/** Solve F(x) = 0 for x in R^2 (preview.mjs's two-quantile fits): damped Newton with
 *  a forward-difference Jacobian. Returns the last iterate if it does not converge. */
export function newton2(F, x0, { maxiter = 200, tol = 1e-15 } = {}) {
  let x = [...x0];
  let fx = F(x);
  const norm = (v) => Math.hypot(v[0], v[1]);
  for (let it = 0; it < maxiter; it++) {
    if (!(norm(fx) > 0)) break;
    const J = [[0, 0], [0, 0]];
    for (let j = 0; j < 2; j++) {
      const h = Math.sqrt(Number.EPSILON) * Math.max(Math.abs(x[j]), 1);
      const xp = [...x]; xp[j] += h;
      const fp = F(xp);
      J[0][j] = (fp[0] - fx[0]) / h; J[1][j] = (fp[1] - fx[1]) / h;
    }
    const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
    if (!det || !Number.isFinite(det)) break;
    const dx = [(fx[0] * J[1][1] - fx[1] * J[0][1]) / det, (J[0][0] * fx[1] - J[1][0] * fx[0]) / det];
    let t = 1, xn, fn;
    for (let k = 0; k < 30; k++) {   // backtrack until the residual shrinks (and stays finite)
      xn = [x[0] - t * dx[0], x[1] - t * dx[1]];
      fn = F(xn);
      if (Number.isFinite(norm(fn)) && norm(fn) < norm(fx)) break;
      t /= 2;
    }
    if (!(Number.isFinite(norm(fn)) && norm(fn) < norm(fx))) break;
    const step = Math.hypot(xn[0] - x[0], xn[1] - x[1]);
    x = xn; fx = fn;
    if (step <= tol * Math.max(1, Math.hypot(x[0], x[1]))) break;
  }
  return x;
}

// ---------- arrays ----------
/** `num` evenly spaced values from start to stop inclusive. */
export function linspace(start, stop, num) {
  const out = new Float64Array(num);
  if (num === 1) { out[0] = start; return out; }
  const div = num - 1, delta = stop - start, step = delta / div;
  for (let i = 0; i < num; i++) out[i] = step === 0 ? ((i / div) * delta) + start : i * step + start;
  out[num - 1] = stop;
  return out;
}

/** Linear interpolation of (xp, fp) at x, xp ascending; clamped to fp's ends outside [xp0, xpn]. */
export function interp(x, xp, fp) {
  const n = xp.length;
  if (Number.isNaN(x)) return x;
  if (x <= xp[0]) return fp[0];
  if (x >= xp[n - 1]) return fp[n - 1];
  let lo = 0, hi = n - 1;                    // invariant: xp[lo] <= x < xp[hi]
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xp[mid] <= x) lo = mid; else hi = mid; }
  if (xp[lo] === x) return fp[lo];
  return fp[lo] + ((fp[hi] - fp[lo]) / (xp[hi] - xp[lo])) * (x - xp[lo]);
}

/** The mean of a numeric array. */
export function mean(a) {
  let s = 0;
  for (const v of a) s += v;
  return s / a.length;
}

/** The least-squares solution of A·x = b for a full-rank A (m×n): Householder QR, the minimum-norm solution
 *  when m < n. */
export function lstsq(A, b) {
  const m = A.length, n = A[0].length;
  if (m === n) {
    // square (the exact-fit metalog): QR, then iterative refinement with residuals computed exactly
    // (error-free products/sums), which lands on the correctly rounded solution of a well-conditioned
    // system — e.g. an anchor at p = 0.5, whose basis row is [1, 0, 0], comes back bit-exact.
    let x = qrSolve(A.map((r) => [...r]), [...b], m, n);
    for (let it = 0; it < 3; it++) {
      const r = A.map((row, i) => residual(row, x, b[i]));
      const d = qrSolve(A.map((rr) => [...rr]), r, m, n);
      const nx = x.map((v, i) => v + d[i]);
      if (nx.every((v, i) => v === x[i])) break;
      x = nx;
    }
    return x;
  }
  if (m > n) return qrSolve(A.map((r) => [...r]), [...b], m, n);
  // underdetermined: A^T = QR, then x = Q (R^-T b)
  const At = Array.from({ length: n }, (_, i) => A.map((r) => r[i]));
  const { Q, R } = householderQR(At, n, m);
  const y = new Array(m).fill(0);
  for (let i = 0; i < m; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= R[k][i] * y[k];
    y[i] = s / R[i][i];
  }
  const x = new Array(n).fill(0);
  for (let i = 0; i < n; i++) for (let k = 0; k < m; k++) x[i] += Q[i][k] * y[k];
  return x;
}
/** b - row·x in double-double, rounded once. */
function residual(row, x, b) {
  let hi = b, lo = 0;
  for (let j = 0; j < row.length; j++) {
    const [p, pe] = twoProd(row[j], x[j]);
    const [s, se] = twoSum(hi, -p);
    hi = s; lo += se - pe;
  }
  return hi + lo;
}
function householderQR(M, m, n) {   // M is m×n, m >= n; returns thin Q (m×n) and R (n×n)
  const R = M.map((r) => [...r]);
  const vs = [];
  for (let k = 0; k < n; k++) {
    let norm = 0;
    for (let i = k; i < m; i++) norm = Math.hypot(norm, R[i][k]);
    const alpha = R[k][k] > 0 ? -norm : norm;
    const v = new Array(m).fill(0);
    for (let i = k; i < m; i++) v[i] = R[i][k];
    v[k] -= alpha;
    let vn = 0;
    for (let i = k; i < m; i++) vn += v[i] * v[i];
    vs.push(vn > 0 ? v.map((x) => x / Math.sqrt(vn)) : null);
    const u = vs[k];
    if (u) {
      for (let j = k; j < n; j++) {
        let s = 0;
        for (let i = k; i < m; i++) s += u[i] * R[i][j];
        for (let i = k; i < m; i++) R[i][j] -= 2 * u[i] * s;
      }
    }
  }
  // thin Q = H_0 ... H_{n-1} applied to the first n columns of I
  const Q = Array.from({ length: m }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let k = n - 1; k >= 0; k--) {
    const u = vs[k];
    if (!u) continue;
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let i = k; i < m; i++) s += u[i] * Q[i][j];
      for (let i = k; i < m; i++) Q[i][j] -= 2 * u[i] * s;
    }
  }
  return { Q, R: R.slice(0, n).map((r) => r.slice(0, n)) };
}
function qrSolve(A, b, m, n) {
  for (let k = 0; k < n; k++) {
    let norm = 0;
    for (let i = k; i < m; i++) norm = Math.hypot(norm, A[i][k]);
    if (norm === 0) continue;
    const alpha = A[k][k] > 0 ? -norm : norm;
    const v = new Array(m).fill(0);
    for (let i = k; i < m; i++) v[i] = A[i][k];
    v[k] -= alpha;
    let vn = 0;
    for (let i = k; i < m; i++) vn += v[i] * v[i];
    if (vn === 0) continue;
    for (let j = k; j < n; j++) {
      let s = 0;
      for (let i = k; i < m; i++) s += v[i] * A[i][j];
      const f = (2 * s) / vn;
      for (let i = k; i < m; i++) A[i][j] -= f * v[i];
    }
    let s = 0;
    for (let i = k; i < m; i++) s += v[i] * b[i];
    const f = (2 * s) / vn;
    for (let i = k; i < m; i++) b[i] -= f * v[i];
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j];
    x[i] = s / A[i][i];
  }
  return x;
}

/** The dot product of two vectors. */
export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
