# -*- coding: utf-8 -*-
"""Bootstrap corpus/documents.json from the reusable source archive (sources/MANIFEST.csv).

For the new run we reuse the archived source *files*; this seeds the grounded-schema document
corpus (schema/SCHEMA.md §2) with one skeleton per source so the run authors observations onto a
known set rather than re-cataloging. Judgement fields (origin, trust_score, capture) are left for
the run to assess. Also writes empty general-knowledge.json and speculations.json scaffolds.

Run: python3 prep/bootstrap_documents.py --write
"""
import csv, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from paths import PROJECT, GROUNDING   # MANIFEST/cores + documents.json (identity registry) under GROUNDING; corpus scaffolds under PROJECT
man=list(csv.DictReader(open(f"{GROUNDING}/MANIFEST.csv")))

docs={}
skipped_asset=skipped_nohash=0
for m in man:
    if m.get("status")=="asset":                 # never evidence
        skipped_asset+=1; continue
    sha=(m.get("sha256") or "").strip()
    if not sha or sha=="-":                       # crawl summary rows carry no content hash
        skipped_nohash+=1; continue
    key=f"doc_{sha[:12]}"
    core=f"cores/doc_{sha[:12]}.txt"
    rec={
        "sha256": sha,
        "title": (m.get("title") or "") or None,
        "url": (m.get("url") or "") or None,
        "publisher": m.get("domain") or "",
    }
    if os.path.exists(f"{GROUNDING}/{core}"):
        rec["core"]=core
    docs[key]=rec

print(f"documents: {len(docs)}  (skipped {skipped_asset} assets, {skipped_nohash} no-hash crawl rows)")
with_core=sum(1 for d in docs.values() if "core" in d)
print(f"  with a lean core: {with_core} | metadata-only: {len(docs)-with_core}")

if "--write" in sys.argv:
    # the doc-identity registry is shared → GROUNDING; the project corpus scaffolds → PROJECT
    with open(f"{GROUNDING}/documents.json","w",encoding="utf-8") as f:
        json.dump(docs, f, indent=1, ensure_ascii=False); f.write("\n")
    os.makedirs(f"{PROJECT}/corpus", exist_ok=True)
    for name in ("observations.json","general-knowledge.json","speculations.json"):
        p=f"{PROJECT}/corpus/{name}"
        if not os.path.exists(p):
            open(p,"w",encoding="utf-8").write("{}\n")
    print("wrote GROUNDING/documents.json (identity) + PROJECT/corpus/{observations,general-knowledge,speculations}.json scaffolds")
