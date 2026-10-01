#!/usr/bin/env python3
"""Slice the not-yet-verified corpus into balanced batch files for audit agents (see AUDIT.md).

    python3 audit_prepare.py obs [N]     # observation-legitimacy batches (default N=6)
    python3 audit_prepare.py docs [N]     # document-metadata batches

Writes build/audit/batch_<tag>.json (gitignored). Each batch keeps a document's observations together
and balances by observation (or document) count. Only entries not already `"audit": "verified"` are
included, so re-running after a partial pass slices just the remainder.

Two-root model: observations are the flat map under PROJECT (corpus/observations.json), each carrying
a `doc` backref; document identity (title/url/core) is the shared registry under GROUNDING."""
import sys, os, json

from paths import PROJECT, GROUNDING   # observations under PROJECT; doc identity under GROUNDING

def _verified(e): return isinstance(e, dict) and e.get("audit") == "verified"

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "obs"
    N = int(sys.argv[2]) if len(sys.argv) > 2 else 6
    reg = json.load(open(f"{GROUNDING}/documents.json")) if os.path.exists(f"{GROUNDING}/documents.json") else {}
    obs_path = f"{PROJECT}/corpus/observations.json"
    allobs = json.load(open(obs_path)) if os.path.exists(obs_path) else {}
    out_dir = f"{PROJECT}/build/audit"; os.makedirs(out_dir, exist_ok=True)

    # group unverified observations by their source doc (backref)
    by_doc = {}
    for oid, ov in allobs.items():
        if _verified(ov): continue
        by_doc.setdefault(ov.get("doc"), {})[oid] = ov

    # unit of work = a document; weight = its unverified-observation count (obs mode) or 1 (docs mode)
    items = []
    for dk, obs in by_doc.items():
        dv = reg.get(dk, {})
        if mode == "obs":
            weight = len(obs)
        else:
            # audit only in-use documents (those backing at least one observation) not yet verified
            if _verified(dv): continue
            weight = 1
        items.append((dk, dv, obs, weight))
    items.sort(key=lambda t: -t[3])                          # largest first for balanced greedy fill

    batches = [[] for _ in range(N)]; loads = [0] * N
    for dk, dv, obs, w in items:
        i = loads.index(min(loads)); batches[i].append((dk, dv, obs)); loads[i] += w

    tags = [chr(ord("A") + i) for i in range(N)]
    total = 0
    for tag, batch in zip(tags, batches):
        if not batch: continue
        out = {}
        for dk, dv, obs in batch:
            rec = {"title": dv.get("title"), "url": dv.get("url"), "publisher": dv.get("publisher"),
                   "origin": dv.get("origin", "primary"), "core": dv.get("core")}
            if mode == "obs": rec["observations"] = obs
            out[dk] = rec; total += len(obs) if mode == "obs" else 1
        json.dump(out, open(f"{out_dir}/batch_{tag}.json", "w"), indent=1, ensure_ascii=False)
        print(f"build/audit/batch_{tag}.json: {len(batch)} docs, "
              f"{sum(len(o) for _,_,o in batch) if mode=='obs' else len(batch)} {'obs' if mode=='obs' else 'docs'}")
    print(f"total {mode}: {total} across {sum(1 for b in batches if b)} batches (only unverified entries)")

if __name__ == "__main__":
    main()
