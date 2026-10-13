// Lower-semi-bounded metalog (bound at 0), k=5 terms, fit by OLS to the paid-price
// quantile anchors (fictional example: field-crew route-planning add-on list prices) at plotting positions i/(n+1); the $0 free tier is a separate mass.
// Dumps the density curve + two-part percentiles for the figure (build_metalog_example.mjs).
import { writeFileSync } from "node:fs";
import { data, dumps, fx, N, round, sum } from "./_shared.mjs";

const PAID = [12, 18, 24.99, 32, 44.99, 72];
const anch = PAID.map((v, i) => [(i + 1) / (PAID.length + 1), v]);
const K = 5, MASS = 0.13;
function basis(y) {
  const z = Math.log(y / (1 - y)), c = y - 0.5;
  return [1.0, z, c * z, c, c * c].slice(0, K);
}
function solve(A, b) {   // Gauss–Jordan with partial pivoting
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const dv = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= dv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let j = col; j <= n; j++) M[r][j] -= f * M[col][j];
    }
  }
  return M.map((r) => r[n]);
}
const tp = anch.map(([p, x]) => [p, Math.log(x)]);           // lower-semi-bounded: log transform
const AtA = Array.from({ length: K }, () => new Array(K).fill(0.0)), Atx = new Array(K).fill(0.0);
for (const [p, t] of tp) {
  const g = basis(p);
  for (let i = 0; i < K; i++) {
    Atx[i] += g[i] * t;
    for (let j = 0; j < K; j++) AtA[i][j] += g[i] * g[j];
  }
}
const a = solve(AtA, Atx);
const Q = (y) => { const b = basis(y); return Math.exp(sum(a.map((ai, i) => ai * b[i]))); };
function dens(y) {                                        // paid density = 1/Q'(y)
  const h = 1e-4, yp = Math.min(0.9999, y + h), ym = Math.max(1e-4, y - h);
  const dq = (Q(yp) - Q(ym)) / (yp - ym); return dq > 0 ? 1.0 / dq : 0.0;
}
const oq = (p) => (p <= MASS ? 0.0 : Q((p - MASS) / (1 - MASS)));

for (let i = 0; i < 4996; i++) if (!(Q((i + 1) / 5000) < Q((i + 2) / 5000))) throw new Error("metalog non-monotonic — infeasible fit");
const NN = 40000;
let paid = 0;
for (let i = 1; i < NN; i++) paid += Q(i / NN);
const paidMean = paid / (NN - 1), overallMean = (1 - MASS) * paidMean;
const PS = [0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95];
const tbl = new Map(PS.map((p) => [p, oq(p)]));
const key = (p) => `p${String(Math.round(p * 100)).padStart(2, "0")}`;

// density curve (paid part, scaled by paid prob) up to ~$140 tail
const curve = [];
for (let i = 1; i < 990; i++) {
  const y = i / 1000.0, x = Q(y);
  if (x > 150) break;
  curve.push([(x), ((1 - MASS) * dens(y))]);
}
const anchorPts = PAID.map((v, i) => [v, ((1 - MASS) * dens((i + 1) / 7.0))]);
writeFileSync(data("metalog_curve.json"), dumps({
  curve, anchors: anchorPts,
  overall: Object.fromEntries([...tbl].map(([p, v]) => [key(p), (round(v, 2))])),
  mean: (round(overallMean, 1)),
}));
console.log("lower-semi-bounded k=5; anchor fit:", JSON.stringify(anch.map(([p]) => fx(Q(p), 1))));
console.log("OVERALL:", JSON.stringify(Object.fromEntries([...tbl].map(([p, v]) => [key(p), Math.round(v)]))), `mean=${fx(overallMean, 0)}`);
