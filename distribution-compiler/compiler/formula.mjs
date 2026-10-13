// The closed I22 formula grammar (deterministic, node-local). A `computed_value.formula` is an
// expression over ids (`in_x.value`, `obs_y.value`) and the distribution's own structure
// (`segments[i]`, `splices[i]`), with arithmetic and the closed function set:
//     min, max, extrapolate_cagr, extrapolate_linear, slope_match   (+ log, exp, sqrt)
// No node references — formulae never reach other nodes.
//
// evaluate(expr, ctx) -> number.  ctx:
//   ids       : {"in_x": {"value":.., "series":[(period,value)..]}, "obs_y": {...}, ...}
//   segments  : [Dist, ...]     splices: [at_x, ...]
//
// Operators: + - * / ** and unary minus, with `**` binding tighter than a unary minus on its left
// (-2 ** 2 = -4). Division by zero, a log/sqrt outside its domain, an unknown id or function, a missing
// field and a syntax error all throw a FormulaError, which the compiler reports as a diagnostic.

export class FormulaError extends Error { constructor(m) { super(m); this.name = "FormulaError"; } }
const fail = (m) => { throw new FormulaError(m); };

const isHandle = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && v.constructor === Object;
const show = (v) => (v === undefined ? "undefined" : typeof v === "number" ? String(v) : Array.isArray(v) ? "a list" : isHandle(v) ? "an id" : v === null ? "null" : typeof v === "object" ? "a distribution" : JSON.stringify(v));
function number(v, what) {
  if (typeof v !== "number") fail(`${what} needs a number, got ${show(v)}`);
  return v;
}

function binop(op, a, b) {
  number(a, op); number(b, op);
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": if (b === 0) fail("division by zero"); return a / b;
    case "**": {
      if (a === 0 && b < 0) fail("0 raised to a negative power");
      const r = a ** b;
      if (Number.isNaN(r)) fail(`${a} ** ${b} is not a real number`);
      return r;
    }
  }
  return fail(`operator ${op} is not in the grammar`);
}

// ---------- the function set ----------
/** Series items as {period,value} objects (schema form) or [period,value] pairs, sorted by period. */
function pts(series) {
  if (!Array.isArray(series) || !series.length) fail(`a series is needed, got ${show(series)}`);
  return series
    .map((x) => (Array.isArray(x) ? [Number(x[0]), Number(x[1])] : [Number(x.period), Number(x.value)]))
    .sort((u, v) => u[0] - v[0] || u[1] - v[1]);
}
function cagr(series, target) {
  const p = pts(series);
  const [y0, v0] = p[0], [y1, v1] = p[p.length - 1];
  if (y1 === y0) fail("extrapolate_cagr needs two different periods");
  const r = (v1 / v0) ** (1 / (y1 - y0)) - 1;
  return v1 * (1 + r) ** (Math.trunc(number(target, "extrapolate_cagr")) - y1);
}
function linear(series, target) {
  const p = pts(series), n = p.length;
  let sx = 0, sy = 0;
  for (const [x, y] of p) { sx += x; sy += y; }
  const mx = sx / n, my = sy / n;
  let num = 0, den = 0;
  for (const [x, y] of p) { num += (x - mx) * (y - my); den += (x - mx) * (x - mx); }
  if (den === 0) fail("extrapolate_linear needs two different periods");
  const b = num / den;
  return my - b * mx + b * Math.trunc(number(target, "extrapolate_linear"));
}
/** GPD tail scale that makes the spliced density continuous at the splice x-value:
 *  sigma = (1 - F_body(x)) / f_body(x)  at x = at_x. */
function slopeMatch(segment, atX) {
  if (!segment || typeof segment.cdf !== "function") fail(`slope_match needs a segment, got ${show(segment)}`);
  const x = number(atX, "slope_match"), f = segment.pdf(x);
  if (f === 0) fail("slope_match: the body density is 0 at the splice");
  return (1 - segment.cdf(x)) / f;
}
function arity(name, fn, n) {
  return (...a) => (a.length === n ? fn(...a) : fail(`${name}() takes ${n} argument${n > 1 ? "s" : ""}, got ${a.length}`));
}
function minmax(name, args) {
  const items = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  if (!items.length) fail(`${name}() needs at least one value`);
  return (name === "min" ? Math.min : Math.max)(...items.map((v) => number(v, name)));
}

export const FUNCS = {
  min: (...a) => minmax("min", a),
  max: (...a) => minmax("max", a),
  extrapolate_cagr: arity("extrapolate_cagr", cagr, 2),
  extrapolate_linear: arity("extrapolate_linear", linear, 2),
  slope_match: arity("slope_match", slopeMatch, 2),
  log: (...a) => {
    if (a.length < 1 || a.length > 2) fail(`log() takes 1 or 2 arguments, got ${a.length}`);
    const x = number(a[0], "log");
    if (x <= 0) fail("log of a non-positive number");
    if (a.length === 1) return Math.log(x);
    const b = number(a[1], "log");
    if (b <= 0 || b === 1) fail("log base must be positive and not 1");
    return Math.log(x) / Math.log(b);
  },
  exp: arity("exp", (x) => Math.exp(number(x, "exp")), 1),
  sqrt: arity("sqrt", (x) => (number(x, "sqrt") < 0 ? fail("sqrt of a negative number") : Math.sqrt(x)), 1),
};

// ---------- parsing ----------
const TOKEN = /\s*(?:(\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d[\d_]*)?|\.\d[\d_]*(?:[eE][+-]?\d[\d_]*)?)|([A-Za-z_][A-Za-z0-9_]*)|(\*\*|\/\/|[-+*/%@()[\],.])|(\S))/y;
function tokenize(src) {
  const toks = [];
  TOKEN.lastIndex = 0;
  let m;
  while (TOKEN.lastIndex < src.length && (m = TOKEN.exec(src))) {
    if (m[0].trim() === "") break;
    if (m[1] !== undefined) toks.push({ t: "num", v: m[1] });
    else if (m[2] !== undefined) toks.push({ t: "name", v: m[2] });
    else if (m[3] !== undefined) toks.push({ t: "op", v: m[3] });
    else toks.push({ t: "bad", v: m[4] });
  }
  return toks;
}

function parse(src) {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v) => toks[i] && toks[i].t === "op" && toks[i].v === v;
  const syntax = () => fail(toks[i] ? `syntax error at '${toks[i].v}'` : "syntax error: unexpected end of formula");
  const expect = (v) => { if (!isOp(v)) syntax(); i++; };
  function expr() {
    let left = term();
    while (isOp("+") || isOp("-")) { const op = toks[i++].v; left = { k: "BinOp", op, left, right: term() }; }
    return left;
  }
  function term() {
    let left = factor();
    while (isOp("*") || isOp("/") || isOp("%") || isOp("//") || isOp("@")) { const op = toks[i++].v; left = { k: "BinOp", op, left, right: factor() }; }
    return left;
  }
  function factor() {
    if (isOp("-")) { i++; return { k: "Neg", operand: factor() }; }
    if (isOp("+")) { i++; return factor(); }
    return power();
  }
  function power() {
    const base = primary();
    if (isOp("**")) { i++; return { k: "BinOp", op: "**", left: base, right: factor() }; }
    return base;
  }
  function primary() {
    let node = atom();
    for (;;) {
      if (isOp(".")) {
        i++;
        const t = peek();
        if (!t || t.t !== "name") syntax();
        i++;
        node = { k: "Attribute", value: node, attr: t.v };
      } else if (isOp("[")) {
        i++;
        const idx = expr();
        expect("]");
        node = { k: "Subscript", value: node, index: idx };
      } else if (isOp("(")) {
        i++;
        const args = [];
        while (!isOp(")")) {
          if (!peek()) syntax();
          args.push(expr());
          if (isOp(",")) i++;
          else if (!isOp(")")) syntax();
        }
        i++;
        node = { k: "Call", func: node, args };
      } else return node;
    }
  }
  function atom() {
    const t = peek();
    if (!t) syntax();
    if (t.t === "num") { i++; return { k: "Constant", value: Number(t.v.replace(/_/g, "")) }; }
    if (t.t === "name") { i++; return { k: "Name", id: t.v }; }
    if (isOp("(")) {
      i++;
      const e = expr();
      expect(")");
      return e;
    }
    return syntax();
  }
  const tree = expr();
  if (i < toks.length) syntax();
  return tree;
}

/** Evaluate a formula against its context -> a finite or infinite number. Throws a FormulaError. */
export function evaluate(expr, ctx = {}) {
  const ids = ctx.ids || {}, segments = ctx.segments || [], splices = ctx.splices || [];
  const ev = (n) => {
    switch (n.k) {
      case "Constant": return n.value;
      case "BinOp": return binop(n.op, ev(n.left), ev(n.right));
      case "Neg": return -number(ev(n.operand), "unary -");
      case "Name":                      // bare id -> its handle, or a structural list
        if (n.id === "segments") return segments;
        if (n.id === "splices") return splices;
        if (Object.hasOwn(ids, n.id)) return ids[n.id];
        return fail(`unknown id in formula: ${n.id}`);
      case "Attribute": {               // in_x.value / obs_y.series
        const base = ev(n.value);
        if (!isHandle(base)) fail(`.${n.attr} on ${show(base)}`);
        if (!Object.hasOwn(base, n.attr)) fail(`no field .${n.attr}`);
        return base[n.attr];
      }
      case "Subscript": {               // segments[0] / splices[0]
        const base = ev(n.value), idx = Math.trunc(number(ev(n.index), "an index"));
        if (!Array.isArray(base)) fail(`cannot index ${show(base)}`);
        const j = idx < 0 ? base.length + idx : idx;
        if (j < 0 || j >= base.length) fail("index out of range");
        return base[j];
      }
      case "Call": {
        if (n.func.k !== "Name") fail("only the grammar's functions can be called");
        if (!Object.hasOwn(FUNCS, n.func.id)) fail(`function not in closed grammar: ${n.func.id}`);
        return FUNCS[n.func.id](...n.args.map(ev));
      }
    }
    return fail(`unsupported expression: ${n.k}`);
  };
  return number(ev(parse(expr)), "a formula");
}
