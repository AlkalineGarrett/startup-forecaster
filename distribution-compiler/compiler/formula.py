# -*- coding: utf-8 -*-
"""The closed I22 formula grammar (deterministic, node-local). A `computed_value.formula` is an
expression over ids (`in_x.value`, `obs_y.value`) and the distribution's own structure
(`segments[i]`, `splices[i]`), with arithmetic and the closed function set:
    min, max, extrapolate_cagr, extrapolate_linear, slope_match
No node references — formulae never reach other nodes.

evaluate(expr, ctx) -> float.  ctx:
  ids       : {"in_x": {"value":.., "series":[(period,value)..]}, "obs_y": {...}, ...}
  segments  : [Dist, ...]     splices: [at_prob, ...]
"""
import ast, math

def _pts(series):
    """Accept series items as {period,value} dicts (schema form) or [period,value] pairs."""
    out = []
    for x in series:
        if isinstance(x, dict): out.append((int(x["period"]), float(x["value"])))
        else: out.append((int(x[0]), float(x[1])))
    return sorted(out)

def _cagr(series, target):
    pts = _pts(series)
    (y0, v0), (y1, v1) = pts[0], pts[-1]
    r = (v1/v0) ** (1.0/(y1-y0)) - 1.0
    return v1 * (1+r) ** (int(target)-y1)

def _linear(series, target):
    pts = _pts(series)
    xs = [p for p, _ in pts]; ys = [v for _, v in pts]; n = len(xs)
    mx = sum(xs)/n; my = sum(ys)/n
    b = sum((x-mx)*(y-my) for x, y in pts) / sum((x-mx)**2 for x in xs)
    a = my - b*mx
    return a + b*int(target)

def _slope_match(segment, at_x):
    """GPD tail scale that makes the spliced density continuous at the splice x-value:
    sigma = (1 - F_body(x)) / f_body(x)  at x = at_x  (ported from gpd_fit.py, x-value form)."""
    pstar = segment.cdf(at_x)
    return (1.0 - pstar) / segment.pdf(at_x)

FUNCS = {
    "min": min, "max": max,
    "extrapolate_cagr": _cagr, "extrapolate_linear": _linear, "slope_match": _slope_match,
    "log": math.log, "exp": math.exp, "sqrt": math.sqrt,
}

def evaluate(expr, ctx):
    ids = ctx.get("ids", {}); segments = ctx.get("segments", []); splices = ctx.get("splices", [])
    def ev(n):
        if isinstance(n, ast.Expression): return ev(n.body)
        if isinstance(n, ast.Constant):   return n.value
        if isinstance(n, ast.Num):        return n.n            # <3.8
        if isinstance(n, ast.BinOp):
            a, b = ev(n.left), ev(n.right)
            return {ast.Add: lambda: a+b, ast.Sub: lambda: a-b, ast.Mult: lambda: a*b,
                    ast.Div: lambda: a/b, ast.Pow: lambda: a**b}[type(n.op)]()
        if isinstance(n, ast.UnaryOp) and isinstance(n.op, ast.USub): return -ev(n.operand)
        if isinstance(n, ast.Name):       # bare id -> its handle (dict) or a structural list
            if n.id == "segments": return segments
            if n.id == "splices":  return splices
            if n.id in ids:        return ids[n.id]
            raise NameError(f"unknown id in formula: {n.id}")
        if isinstance(n, ast.Attribute):  # in_x.value / obs_y.series
            base = ev(n.value)
            if isinstance(base, dict): return base[n.attr]
            raise TypeError(f".{n.attr} on non-id")
        if isinstance(n, ast.Subscript):  # segments[0] / splices[0]
            base = ev(n.value); idx = ev(n.slice.value if isinstance(n.slice, ast.Index) else n.slice)
            return base[int(idx)]
        if isinstance(n, ast.Call):
            fn = n.func.id
            if fn not in FUNCS: raise NameError(f"function not in closed grammar: {fn}")
            return FUNCS[fn](*[ev(a) for a in n.args])
        raise ValueError(f"unsupported expression node: {ast.dump(n)}")
    return float(ev(ast.parse(expr, mode="eval")))
