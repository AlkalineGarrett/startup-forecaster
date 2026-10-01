#!/usr/bin/env python3
"""Mark documents / observations `"audit": "verified"` — ONLY the ones an audit passed (AUDIT.md).

    python3 mark_audited.py --pass-list build/audit/verdicts_*.json   # verdict files
    python3 mark_audited.py --obs doc_x/obs_y --obs doc_z/obs_w        # explicit obs
    python3 mark_audited.py --doc doc_x --doc doc_y                     # explicit docs

A verdict file is a JSON array; an element with verdict `legit` (observation) or `ok` (document) is
marked verified. Any other verdict is left as-is (fix it first, then re-run). Stamps `audit_date`.
File-locked. Two-root model: observations are the flat map under PROJECT (corpus/observations.json);
document identity is the shared registry under GROUNDING (documents.json)."""
import sys, os, json, glob, fcntl, argparse, datetime

from paths import PROJECT, GROUNDING
TODAY = datetime.date.today().isoformat()

def _mark(path, keys, get):
    """Set audit=verified+date on each key present in the JSON dict at path. Returns count. File-locked."""
    if not keys or not os.path.exists(path): return 0
    n = 0
    fh = open(path, "r+", encoding="utf-8"); fcntl.flock(fh, fcntl.LOCK_EX)
    try:
        fh.seek(0); data = json.load(fh)
        for k in keys:
            e = get(data, k)
            if e is not None:
                e["audit"] = "verified"; e["audit_date"] = TODAY; n += 1
        fh.seek(0); fh.truncate(); json.dump(data, fh, indent=1, ensure_ascii=False); fh.write("\n")
    finally:
        fcntl.flock(fh, fcntl.LOCK_UN); fh.close()
    return n

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pass-list", dest="pass_list", nargs="*", default=[], help="verdict json files/globs")
    ap.add_argument("--obs", action="append", default=[], help="doc_<sha>/obs_<id> to verify")
    ap.add_argument("--doc", action="append", default=[], help="doc_<sha> to verify")
    a = ap.parse_args()

    obs_ok, doc_ok = set(a.obs), set(a.doc)
    for pat in a.pass_list:
        for f in glob.glob(pat):
            for v in json.load(open(f)):
                if v.get("verdict") == "legit" and v.get("obs"):
                    obs_ok.add(f"{v['doc']}/{v['obs']}")
                elif v.get("verdict") == "ok" and v.get("doc") and not v.get("obs"):
                    doc_ok.add(v["doc"])

    # observations → the flat map under PROJECT (key is the bare obs id)
    obs_keys = {ref.split("/", 1)[1] if "/" in ref else ref for ref in obs_ok}
    no = _mark(f"{PROJECT}/corpus/observations.json", obs_keys, lambda d, k: d.get(k))
    # documents → the identity registry under GROUNDING
    nd = _mark(f"{GROUNDING}/documents.json", doc_ok, lambda d, k: d.get(k))
    print(f"marked verified: {no} observation(s), {nd} document(s)  (date {TODAY})")

if __name__ == "__main__":
    main()
