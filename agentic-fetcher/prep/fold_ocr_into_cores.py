# -*- coding: utf-8 -*-
"""Fold each page's image-OCR into its lean core so `cores/doc_<sha>.txt` is a single, complete,
grep-able text layer (page text + recovered chart/screenshot figures). Exact match only: a
sources page sidecar -> that page's own core (via MANIFEST sha). Idempotent (skips if already
folded).
Run: python3 prep/fold_ocr_into_cores.py --write"""
import csv, os, re, glob, sys, datetime
import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
from paths import PROJECT, GROUNDING
man={m["stored"]:m["sha256"] for m in csv.DictReader(open(f"{GROUNDING}/MANIFEST.csv"))}
MARK=f"\n===== IMAGE OCR (folded from page assets, macOS Vision {datetime.date.today().isoformat()}) =====\n"
folded=[]; skipped=[]
for sc in sorted(glob.glob(f"{GROUNDING}/**/*.images.ocr.txt",recursive=True)):
    page=re.sub(r"\.images\.ocr\.txt$","",os.path.relpath(sc,GROUNDING))
    sha=man.get(page)
    core=f"{GROUNDING}/cores/doc_{sha[:12]}.txt" if sha else None
    if not (core and os.path.exists(core)): skipped.append(page); continue
    body=open(core,encoding="utf-8",errors="replace").read()
    if "IMAGE OCR (folded" in body: folded.append((page,"already")); continue
    ocr=open(sc,encoding="utf-8",errors="replace").read()
    # drop the sidecar's own header lines, keep the recognized text
    ocr="\n".join(l for l in ocr.splitlines() if not l.startswith("#"))
    if "--write" in sys.argv:
        open(core,"a",encoding="utf-8").write(MARK+ocr.strip()+"\n")
    folded.append((page,"folded"))
print(f"folded into cores: {sum(1 for _,s in folded if s=='folded')} | already: {sum(1 for _,s in folded if s=='already')} | no-core: {len(skipped)}")
for p,s in folded: print(f"  [{s}] {p}")
if skipped: print("  (no matching core, left as sidecar only):", skipped)
