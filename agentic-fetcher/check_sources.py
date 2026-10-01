#!/usr/bin/env python3
"""Source-archive integrity — the node-free invariants over MANIFEST.csv + the sources/ tree.
Needs no project/node data.

  S1  every manifest row's stored file exists on disk
  S2  sha256 is unique per artifact (identical bytes collapse to one row; crawl summary rows exempt)
  S5  every evidence document on disk is in the manifest — by path, or by content-hash for a
      byte-identical copy. The reverse of S1: a PASS proves nothing is missing.

Run from repo root or sources/:  python3 check_sources.py
"""
import csv, os, sys, hashlib
from collections import Counter
from paths import PROJECT, GROUNDING   # the archive to check is GROUNDING; the corpus (S6/S7) is under PROJECT
SRC=GROUNDING
MAN=list(csv.DictReader(open(os.path.join(SRC,"MANIFEST.csv"))))
NO_HASH="-"
fail=[]
def check(inv,bad,note):
    for b in bad: fail.append((inv,b,note))

# S1
check("S1",[r["stored"] for r in MAN if not os.path.exists(os.path.join(SRC,r["stored"]))],
      "manifest row has no file on disk")
# S2
check("S2",[s for s,n in Counter(r["sha256"] for r in MAN).items() if n>1 and s!=NO_HASH],
      "sha256 shared by more than one artifact")

# S5 — reverse: every evidence doc on disk is manifested (by path or by content hash)
DOC_EXT={".html",".htm",".pdf",".txt",".xlsx",".xls",".doc",".docx",".json",".gz"}
def excluded(rel,fn):
    ext=os.path.splitext(fn)[1].lower()
    if "_files/" in rel: return True                       # browser-save support
    if any(seg.startswith("_") for seg in rel.split("/")): return True  # _-prefixed = staging/derived (browser-save _files, _clean extractions, _extract.py helpers, _clean_reviews.txt)
    if rel.startswith(".git/"): return True                # repo metadata (the cache is a git backup)
    if rel.startswith("cores/"): return True               # derived text layer, not manifest evidence
    if rel.startswith("assets/"): return True              # never evidence
    if rel.startswith(("fetch-lists/",)): return True      # source-acquisition worklists
    if fn in ("manual-manifest.csv","documents.json") or fn.endswith(".ocr.txt"): return True  # index/side records
    if "/" not in rel and (ext in (".csv",".md",".py") or fn==".DS_Store"): return True  # repo metadata/tools
    if fn==".DS_Store": return True
    return False
stored_set={r["stored"] for r in MAN}
sha_set={r["sha256"] for r in MAN if r["sha256"]!=NO_HASH}
s5=[]
for base,_,files in os.walk(SRC):
    for fn in files:
        rel=os.path.relpath(os.path.join(base,fn),SRC)
        if rel in stored_set or excluded(rel,fn): continue
        if os.path.splitext(fn)[1].lower() not in DOC_EXT: continue
        h=hashlib.sha256(open(os.path.join(base,fn),"rb").read()).hexdigest()
        if h not in sha_set: s5.append(rel)
check("S5",s5,"evidence file on disk is absent from the manifest (by path and by content)")

# S6/S7 — corpus↔archive: the doc registry nodes ground against must stay consistent with the byte
# archive. S6: every registered doc's `core` pointer resolves to a non-empty file (a node quote-
# matches against that core). S7: every registered source's bytes are in the manifest (computed
# derivatives are exempt — they have no archived source). Skipped if there is no corpus (isolated runs).
corpus_path=os.path.join(GROUNDING,"documents.json")          # the doc-identity registry lives with the cache now
checks="S1 S2 S5"
if os.path.exists(corpus_path):
    import json
    docs=json.load(open(corpus_path))
    missing_core=[]; unmanifested=[]
    for did,dv in docs.items():
        core=dv.get("core")
        if core and (not os.path.exists(os.path.join(GROUNDING,core)) or os.path.getsize(os.path.join(GROUNDING,core))==0):
            missing_core.append(f"{did} -> {core}")
        sha=dv.get("sha256"); is_derived=bool(dv.get("derivation_kind")) or dv.get("origin")=="derivative"
        if sha and not is_derived and sha not in sha_set:
            unmanifested.append(f"{did} (sha {sha[:12]})")
    check("S6",missing_core,"corpus doc's core file is missing or empty")
    check("S7",unmanifested,"corpus doc's sha256 is not in the manifest (byte archive)")
    checks="S1 S2 S5 S6 S7"

    # S8 — audit coverage. `verification` (quote-in-core) is stamped at write time, but the
    # legitimacy AUDIT (AUDIT.md) is a separate pass that must actually run; freshly-added
    # observations are `audit: unaudited` (or the field is absent) until it does. A whole batch once
    # slipped through un-reviewed, so this is now an enforced gate: an observation is un-reviewed
    # unless its `audit` is `verified` or `flagged` (a deliberate "known defect, do not use" state).
    obs_path=os.path.join(PROJECT,"corpus","observations.json")
    if os.path.exists(obs_path):
        allobs=json.load(open(obs_path))
        unreviewed=[oid for oid,ov in allobs.items() if ov.get("audit") not in ("verified","flagged")]
        check("S8",unreviewed,"observation not yet audited (run audit_prepare.py → audit → mark_audited.py)")
        checks="S1 S2 S5 S6 S7 S8"

if fail:
    print(f"FAIL — {len(fail)} violation(s)")
    for inv,item,note in fail[:40]: print(f"  {inv}  {item}  ({note})")
    sys.exit(1)
print(f"PASS — {len(MAN)} artifacts")
print(f"  checked: {checks}")
print("  S5 PASS ⇒ every evidence document on disk is in the manifest — nothing is missing.")
if "S6" in checks:
    print("  S6/S7 PASS ⇒ every corpus doc's core exists and its bytes are archived — grounding is intact.")
