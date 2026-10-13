// A JSON Schema (2020-12) validator for the keywords project-distributions.schema.json uses.
//
//   const v = validator(defs.node, defs);   for (const e of v(instance)) e.path, e.message
//
// Keywords: type · enum · const · minimum · maximum · pattern · minItems · required · properties ·
// additionalProperties · propertyNames · items · allOf · oneOf · if/then/else · $ref (#/$defs/...).
// Errors come out in the order the schema lists its keywords.

const show = (v) => JSON.stringify(v);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number";
const TYPES = {
  object: isObj,
  array: Array.isArray,
  string: (v) => typeof v === "string",
  number: isNum,
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === "boolean",
  null: (v) => v === null,
};
/** Structural equality of two JSON values. */
function equal(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => equal(x, b[i]));
  }
  if (isObj(a) || isObj(b)) {
    if (!isObj(a) || !isObj(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]));
  }
  return a === b;
}

function resolveRef(ref, defs) {
  const m = /^#\/\$defs\/(.+)$/.exec(ref);
  if (!m || !(m[1] in defs)) throw new Error(`unresolvable $ref ${ref}`);
  return defs[m[1]];
}
const isValid = (schema, inst, defs) => check(schema, inst, [], defs).next().done;

// one generator per keyword; check() runs them in the schema's own key order, as jsonschema does
const KEYWORDS = {
  *$ref(v, schema, inst, path, defs) { yield* check(resolveRef(v, defs), inst, path, defs); },
  *type(v, schema, inst, path) {
    const ts = [].concat(v);
    if (!ts.some((t) => TYPES[t](inst))) yield { path, message: `${show(inst)} is not of type ${ts.map((t) => show(t)).join(", ")}` };
  },
  *enum(v, schema, inst, path) {
    if (!v.some((e) => equal(e, inst))) yield { path, message: `${show(inst)} is not one of ${show(v)}` };
  },
  *const(v, schema, inst, path) {
    if (!equal(inst, v)) yield { path, message: `${show(v)} was expected` };
  },
  *minimum(v, schema, inst, path) {
    if (isNum(inst) && inst < v) yield { path, message: `${show(inst)} is less than the minimum of ${show(v)}` };
  },
  *maximum(v, schema, inst, path) {
    if (isNum(inst) && inst > v) yield { path, message: `${show(inst)} is greater than the maximum of ${show(v)}` };
  },
  *pattern(v, schema, inst, path) {
    if (typeof inst === "string" && !new RegExp(v, "u").test(inst)) yield { path, message: `${show(inst)} does not match ${show(v)}` };
  },
  *minItems(v, schema, inst, path) {
    if (Array.isArray(inst) && inst.length < v) yield { path, message: v === 1 ? `${show(inst)} should be non-empty` : `${show(inst)} is too short` };
  },
  *items(v, schema, inst, path, defs) {
    if (!Array.isArray(inst)) return;
    for (let i = 0; i < inst.length; i++) yield* check(v, inst[i], [...path, i], defs);
  },
  *required(v, schema, inst, path) {
    if (!isObj(inst)) return;
    for (const r of v) if (!Object.hasOwn(inst, r)) yield { path, message: `${show(r)} is a required property` };
  },
  *properties(v, schema, inst, path, defs) {
    if (!isObj(inst)) return;
    for (const [k, s] of Object.entries(v)) if (Object.hasOwn(inst, k)) yield* check(s, inst[k], [...path, k], defs);
  },
  *propertyNames(v, schema, inst, path, defs) {
    if (!isObj(inst)) return;
    for (const k of Object.keys(inst)) yield* check(v, k, path, defs);
  },
  *additionalProperties(v, schema, inst, path, defs) {
    if (!isObj(inst)) return;
    const props = schema.properties || {};
    const extras = Object.keys(inst).filter((k) => !Object.hasOwn(props, k));
    if (isObj(v) || v === true) {
      for (const k of extras) yield* check(v, inst[k], [...path, k], defs);
    } else if (v === false && extras.length) {
      yield { path, message: `additional properties are not allowed: ${extras.map(show).join(", ")}` };
    }
  },
  *allOf(v, schema, inst, path, defs) { for (const s of v) yield* check(s, inst, path, defs); },
  *oneOf(v, schema, inst, path, defs) {
    const first = v.findIndex((s) => isValid(s, inst, defs));
    if (first < 0) { yield { path, message: `${show(inst)} is not valid under any of the given schemas` }; return; }
    if (v.slice(first + 1).some((s) => isValid(s, inst, defs))) yield { path, message: `${show(inst)} is valid under more than one of the given schemas` };
  },
  *if(v, schema, inst, path, defs) {
    if (isValid(v, inst, defs)) { if (schema.then !== undefined) yield* check(schema.then, inst, path, defs); }
    else if (schema.else !== undefined) yield* check(schema.else, inst, path, defs);
  },
};

function* check(schema, inst, path, defs) {
  if (schema === true || schema == null) return;
  if (schema === false) { yield { path, message: `False schema does not allow ${show(inst)}` }; return; }
  for (const [k, v] of Object.entries(schema)) if (Object.hasOwn(KEYWORDS, k)) yield* KEYWORDS[k](v, schema, inst, path, defs);
}

/** A validator for `schema`, resolving $refs against `defs`: (instance) → [{ path, message }]. */
export function validator(schema, defs) {
  return (inst) => [...check(schema, inst, [], defs)];
}
