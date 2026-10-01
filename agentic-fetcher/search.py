#!/usr/bin/env python3
"""General source search — for a fresh agent searching across ALL sources.

Searches the source text layer (cores/ + image-OCR sidecars) and returns, for every matching
source, ONE merged record with all of that source's data unified: title, url, publisher, the raw
archived file, the lean core, and every OCR sidecar — each with matching snippets. Backed by
corpus/documents.json. No project/node mapping — sources are about sources; for node→evidence use
the projects/ layer.

    python3 search.py "net revenue retention"      # literal phrase; falls back to any-of-words if 0
    python3 search.py "\\b3[0-9]% churn"            # a real regex (has metachars) — used as-is
    python3 search.py "seat price" --sources 40 --context 2
"""
import csv, os, glob, re, json, sys
from paths import PROJECT, GROUNDING   # cores + MANIFEST + documents.json (identity registry) under GROUNDING
def G(p): return os.path.join(GROUNDING,p)
def P(p): return os.path.join(PROJECT,p)

args=[a for a in sys.argv[1:] if not a.startswith("-")]
if not args: sys.exit('usage: search.py "<query or regex>" [--sources N] [--context N]')
def opt(name,d): return int(sys.argv[sys.argv.index(name)+1]) if name in sys.argv else d
MAXS=opt("--sources",30); CTX=opt("--context",1)
raw=args[0]

docs=json.load(open(G("documents.json"))) if os.path.exists(G("documents.json")) else {}
by_sha={d["sha256"][:12]:d for d in docs.values()}
man={m["stored"]:m for m in csv.DictReader(open(G("MANIFEST.csv")))}
sha2stored={m["sha256"][:12]:s for s,m in man.items()}

def source_key(path):
    b=os.path.basename(path)
    m=re.match(r"doc_([0-9a-f]{12})\.txt$",b)
    if m: return m.group(1)
    rel=os.path.relpath(path,GROUNDING) if path.startswith(GROUNDING) else None
    if rel:
        stored=re.sub(r"\.inline-\d+$","",re.sub(r"(\.images)?\.ocr\.txt$","",rel))
        if stored in man: return man[stored]["sha256"][:12]
    return None

FILES=sorted(glob.glob(G("cores/*.txt")))+sorted(glob.glob(G("**/*.ocr.txt"),recursive=True))

def run(pat):
    merged={}
    for f in FILES:
        try: lines=open(f,encoding="utf-8",errors="replace").read().splitlines()
        except Exception: continue
        sn=[]
        for i,l in enumerate(lines):
            if pat.search(l):
                sn.append((i,[lines[j].strip()[:160] for j in range(max(0,i-CTX),min(len(lines),i+CTX+1))]))
        if not sn: continue
        key=source_key(f) or f
        rec=merged.setdefault(key,{"files":[]})
        rec["files"].append(("core" if os.path.basename(f).startswith("doc_") else "ocr-sidecar", os.path.relpath(f,GROUNDING), sn))
    return merged

HAS_META=bool(re.search(r"[\\|()\[\]{}^$+?*]", raw))
note=""
if HAS_META:
    merged=run(re.compile(raw, re.I))                       # a real regex — use verbatim
else:
    merged=run(re.compile(re.escape(raw), re.I))            # literal phrase first
    if not merged and len(raw.split())>1:                   # nothing? fall back to any-of-words
        toks=[re.escape(t) for t in raw.split() if len(t)>2]
        merged=run(re.compile(r"\b(?:%s)\b"%"|".join(toks), re.I))
        note=f'(no exact-phrase match — showing any-of-words: {" | ".join(raw.split())}, ranked by density)'

if note: print(note)
print(f'== "{raw}" — {len(merged)} source(s) match ==\n')
ranked=sorted(merged.items(), key=lambda kv: -sum(len(sn) for _,_,sn in kv[1]["files"]))
for i,(key,rec) in enumerate(ranked):
    if i>=MAXS: print(f"… +{len(merged)-MAXS} more sources (raise --sources, or use a precise regex)"); break
    d=by_sha.get(key,{}) if isinstance(key,str) and len(key)==12 else {}
    stored=sha2stored.get(key)
    title=(d.get("title") if d else None) or (man.get(stored,{}).get("title") if stored else None) or str(key)
    print(f"● {(title or '(untitled)')[:80]}")
    if d: print(f"  doc_{key}  |  {d.get('publisher','')}  |  {d.get('url') or ''}")
    if stored: print(f"  raw: {stored}")
    for kind,rel,sn in rec["files"]:
        print(f"  {kind}: {rel}")
        for _,ctx in sn[:3]:
            for c in ctx: print(f"      {c}")
            print()
        if len(sn)>3: print(f"      … +{len(sn)-3} more matching lines\n")
