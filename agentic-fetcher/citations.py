#!/usr/bin/env python3
"""Derive, on demand, which nodes cite each observation — replacing the stored `cited_by` field.

`cited_by` was a hand-maintained cache of "which project::node uses this observation." It drifts:
nodes get renamed/removed and the list is not updated, leaving phantom citations (a `cited_by`
naming a node that no longer exists) and missing ones. The true map is always recoverable by scanning
`projects/*.json` for each observation id — that is what this tool does, so the correlation/usage
record is never stale.

An observation is *referenced* if its id appears in a `reference`/`references`/`records-from`/formula
in any project node, OR (indirectly) if it feeds a derivative document that a project references.

    python3 citations.py                      # obs_id -> [project::node, ...] (+ orphan report)
    python3 citations.py --json               # machine-readable index
    python3 citations.py --orphans            # only observations no node uses (direct or indirect)

Two-root: observations under PROJECT/corpus, projects under PROJECT/projects, derivative identity
under GROUNDING/documents.json."""
import os, re, json, glob, argparse
from paths import PROJECT, GROUNDING, compiler_import_path

compiler_import_path()
from refs import OBS_RE   # the compiler's definition of an observation reference (single source)
# node keys are "project::node" or "project::variant::node"; project/variant ids may contain hyphens
# (my-app, field-crew, habit-app, …) — the hyphen MUST be in the class or attribution breaks.
NODE_RE = re.compile(r'"([A-Za-z0-9_-]+(?:::[A-Za-z0-9_-]+)+)"\s*:\s*\{')


def _project_text():
    files = sorted(glob.glob(f"{PROJECT}/projects/*.json"))
    return {os.path.basename(f)[:-5]: open(f, encoding="utf-8").read() for f in files}


def _node_refs(text):
    """Map each obs id mentioned in the file to the set of node keys whose block contains it.
    Node blocks are delimited by top-level "project::node": { keys; good enough for attribution."""
    spans = [(m.start(), m.group(1)) for m in NODE_RE.finditer(text)]
    out = {}
    for i, (pos, node) in enumerate(spans):
        end = spans[i + 1][0] if i + 1 < len(spans) else len(text)
        for oid in set(OBS_RE.findall(text[pos:end])):
            out.setdefault(oid, set()).add(node)
    return out


def build_index():
    obs = json.load(open(f"{PROJECT}/corpus/observations.json"))
    docs = json.load(open(f"{GROUNDING}/documents.json")) if os.path.exists(f"{GROUNDING}/documents.json") else {}
    ptext = _project_text()

    # direct: obs id -> nodes (best-effort attribution)
    index = {oid: set() for oid in obs}
    allrefs = {}
    for proj, text in ptext.items():
        for oid, nodes in _node_refs(text).items():
            allrefs.setdefault(oid, set()).update(nodes)
    for oid in obs:
        index[oid] |= allrefs.get(oid, set())

    # authoritative "referenced at all" test: the id appears literally in some project file. This is
    # robust to any attribution miss; if it matches but block-attribution didn't, record it unlocated.
    joined = "\n".join(ptext.values())
    for oid in obs:
        if not index[oid] and oid in joined:
            index[oid].add("(referenced; node unlocated)")

    # indirect: an obs feeds a derivative (derived_from) that a project references
    referenced_docs = set()
    for text in ptext.values():
        referenced_docs |= set(re.findall(r'doc_[0-9a-f]{12}', text))
    obs_by_id = obs
    for docid, d in docs.items():
        if d.get("origin") != "derivative" or docid not in referenced_docs:
            continue
        for src in (d.get("derivation") or {}).get("derived_from", []):
            if "/" in src:
                soid = src.split("/", 1)[1]
                if soid in index and not index[soid]:
                    index[soid].add(f"(via derivative {docid})")
    return {k: sorted(v) for k, v in index.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--orphans", action="store_true")
    a = ap.parse_args()
    idx = build_index()
    orphans = sorted(k for k, v in idx.items() if not v)
    if a.json:
        print(json.dumps(idx, indent=2)); return
    if a.orphans:
        print(f"{len(orphans)} orphan observations (no node uses them, directly or via a derivative):")
        for o in orphans: print(f"  {o}")
        return
    used = {k: v for k, v in idx.items() if v}
    print(f"{len(used)}/{len(idx)} observations are referenced by at least one node; {len(orphans)} orphaned.")
    for oid in sorted(used):
        print(f"  {oid}: {', '.join(idx[oid])}")
    if orphans:
        print(f"\nORPHANS ({len(orphans)}):")
        for o in orphans: print(f"  {o}")


if __name__ == "__main__":
    main()
