// Distribution construction + percentile derivation. Parametric families are checked against reference
// quantiles (recorded below), structural kinds by their defining properties.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../compiler/distributions.mjs";
import * as N from "../compiler/numerics.mjs";

const approx = (a, b, rel = 1e-12, abs = 0) => Math.abs(a - b) <= Math.max(rel * Math.abs(b), abs);
const PS = [0.05, 0.10, 0.50, 0.90, 0.95];

// reference quantiles at PS (computed with scipy.stats)
const PARAMETRIC = [
  ["lognormal", { median: 20, sigma: 0.5 }, [8.787282098549849, 10.53767036592073, 20.0, 37.95905414669421, 45.52033217028633]],
  ["beta", { alpha: 4.5, beta: 2.4 }, [0.34833692160141927, 0.4166771079313016, 0.6676027691671553, 0.8648307141569012, 0.9028695161892628]],
  ["normal", { mean: 110, sd: 41 }, [42.56100129498961, 57.456385812671385, 110.0, 162.54361418732861, 177.43899870501036]],
  ["gamma", { shape: 1.3, rate: 2.1 }, [0.05631923432795362, 0.09978866130662761, 0.469523356878457, 1.3360227384191332, 1.6925854618367742]],
  ["uniform", { low: 0.003, high: 0.012 }, [0.00345, 0.0039, 0.0075, 0.011099999999999999, 0.011549999999999998]],
  ["generalized_pareto", { location: 400, scale: 530, shape: 0.4 }, [427.4662493986074, 457.0344680015883, 823.3479817740848, 2403.249521750194, 3466.6515729754806]],
];

for (const [kind, params, want] of PARAMETRIC) {
  test(`parametric ${kind} matches the reference quantiles`, () => {
    const d = D.construct(kind, params);
    PS.forEach((p, i) => assert.ok(approx(d.ppf(p), want[i]), `${kind} p=${p}: ${d.ppf(p)} vs ${want[i]}`));
  });
  test(`percentiles of ${kind} are monotonic and finite`, () => {
    const v = Object.values(D.construct(kind, params).percentiles());
    assert.ok(v.every((x, i) => i === v.length - 1 || x <= v[i + 1] + 1e-9));
    assert.ok(v.every(Number.isFinite));
  });
}

test("point_mass is a step cdf", () => {
  const d = D.construct("point_mass", { _atoms: [[10, 0.6], [50, 0.4]] });
  assert.equal(d.ppf(0.5), 10); assert.equal(d.ppf(0.9), 50);
  assert.ok(approx(d.cdf(10), 0.6)); assert.ok(approx(d.cdf(50), 1.0));
});

test("hurdle mixture does not crash and clamps", () => {
  // a point_mass at 0 mixed with a continuous beta — the schema's two-part/hurdle model.
  const pm = D.construct("point_mass", { _atoms: [[0.0, 1.0]] });
  const be = D.construct("beta", { alpha: 2, beta: 3 });
  const pct = D.construct("weighted_combination", { _components: [[pm, 0.30], [be, 0.70]] }).percentiles();
  assert.equal(pct.p05, 0); assert.equal(pct.p10, 0);   // below the 30% boundary mass
  const v = Object.values(pct);
  assert.ok(v.every((x, i) => i === v.length - 1 || x <= v[i + 1] + 1e-9));
});

test("splice p50 is the body median", () => {
  const sigma = (Math.log(400) - Math.log(20)) / 1.2816;   // lognormal p50=20, p90=400
  const body = D.construct("lognormal", { median: 20, sigma });
  const tail = D.construct("generalized_pareto", { location: 400, scale: 532.755006, shape: 0.927 });   // slope_match at x=400
  const sp = D.construct("splice", { _segments: [body, tail], _at: 400 });
  assert.ok(approx(sp.ppf(0.50), 20, 1e-3));    // p50 < splice → body
  assert.ok(approx(sp.ppf(0.90), 400, 1e-2));   // p90 at the splice
  assert.ok(sp.ppf(0.95) > 400);                // tail
});

test("metalog: lower bound and zero mass", () => {
  const anchors = [15, 17.5, 19.99, 29, 39.99, 69].map((v, i) => [(i + 1) / 7.0, v]);
  const pct = D.construct("metalog", { _anchors: anchors, k: 5, lower_bound: 0.0, zero_mass: 0.13 }).percentiles();
  assert.equal(pct.p05, 0); assert.equal(pct.p10, 0);   // below the 13% mass → the lower bound
  assert.ok(pct.p50 > 0);
  const v = Object.values(pct);
  assert.ok(v.every((x, i) => i === v.length - 1 || x <= v[i + 1] + 1e-9));
});

test("metalog: doubly bounded", () => {
  // a fraction/rate ladder (e.g. annual retention) on [0,1]: the log-odds transform must honor
  // every anchor AND keep the whole distribution inside the bounds (no tail crossing the ceiling).
  const d = D.construct("metalog", { _anchors: [[0.25, 0.445], [0.5, 0.60], [0.9, 0.83]], k: 3, lower_bound: 0.0, upper_bound: 1.0 });
  const q = d.ppf([0.25, 0.50, 0.90]);
  assert.ok(Math.abs(q[0] - 0.445) < 1e-6 && Math.abs(q[1] - 0.60) < 1e-6 && Math.abs(q[2] - 0.83) < 1e-6);
  const grid = d.ppf(N.linspace(1e-4, 1 - 1e-4, 500));
  assert.ok(Math.min(...grid) >= 0.0 && Math.max(...grid) <= 1.0);   // no mass outside [0, 1]
  assert.deepEqual(d.support, [0.0, 1.0]);
});

test("metalog: upper bounded", () => {
  // upper-semi-bounded: x = bu - e^-z, a right-limited quantity with no lower bound
  const d = D.construct("metalog", { _anchors: [[0.1, 0.60], [0.5, 0.85], [0.9, 0.95]], k: 3, upper_bound: 1.0 });
  assert.ok(Math.abs(d.ppf([0.1, 0.5, 0.9])[1] - 0.85) < 1e-6);
  assert.ok(d.ppf([0.999])[0] <= 1.0);
});

test("metalog: an infeasible fit raises", () => {
  // anchors whose values are non-monotonic in probability cannot fit a monotone quantile curve
  assert.throws(() => D.construct("metalog", { _anchors: [[0.1, 100], [0.5, 1], [0.9, 50]], k: 5, lower_bound: null, zero_mass: 0.0 }), D.DistError);
});

test("an unknown kind raises", () => {
  assert.throws(() => D.construct("nonesuch", {}), D.DistError);
});

// ---- fuzz regressions ----
test("hurdle mixture with an infinite-support component keeps its tail", () => {
  // point_mass@0 + lognormal (infinite support) once returned ALL ZEROS because the mixture
  // support collapsed to the point-mass bound. The tail must survive.
  const pm = D.construct("point_mass", { _atoms: [[0.0, 1.0]] });
  const ln = D.construct("lognormal", { median: 30, sigma: 0.7 });
  const pct = D.construct("weighted_combination", { _components: [[pm, 0.4], [ln, 0.6]] }).percentiles();
  assert.equal(pct.p05, 0); assert.equal(pct.p10, 0);   // below the 40% mass at 0
  assert.ok(pct.p50 > 0 && pct.p90 > 20);               // the lognormal tail is preserved
});

test("point_mass with zero total weight raises", () => {
  assert.throws(() => D.construct("point_mass", { _atoms: [[0.0, 0.0], [5.0, 0.0]] }), D.DistError);
});

test("truncate clips", () => {
  const pct = D.truncate(D.construct("normal", { mean: 10, sd: 50 }), 0, null).percentiles();
  assert.ok(pct.p05 >= 0 && pct.p50 > 10);   // nothing below the lower bound; median shifts up
});
