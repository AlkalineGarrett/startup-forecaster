# -*- coding: utf-8 -*-
"""Second-pass OCR: images inside saved HTML pages (their `_files/` assets), standalone images,
and inline data:image blobs embedded in HTML. macOS Vision via ocrtool (built from ocr.swift) — RUN OUTSIDE THE
SANDBOX (dangerouslyDisableSandbox). Keeps only meaningful-text results.

Usage: python3 prep/ocr_images.py [root ...] [--force]     (default root: sources)

Output:
  - per owning page:  <page>.images.ocr.txt   (one section per image with text)
  - standalone image: <image>.ocr.txt
  - inline data-URI:  <page>.inline-<n>.ocr.txt
  - report:           ocr-images-<date>.md   (covers all roots given this run)
Idempotent: skips writing a sidecar that already exists unless --force.
"""
import os, re, subprocess, sys, base64, tempfile
from collections import defaultdict
import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
from paths import PROJECT, GROUNDING, ocrtool
import datetime
TODAY = datetime.date.today().isoformat()
OCR=ocrtool()
FORCE="--force" in sys.argv
ROOTS=[a for a in sys.argv[1:] if not a.startswith("--")] or ["."]
MIN_BYTES=3072
MIN_ALNUM=40
RASTER=(".png",".jpg",".jpeg",".webp",".gif",".tif",".tiff",".bmp")
HDR=(f"# Image-OCR sidecar (macOS Vision, generated {TODAY})\n"
     "# Text recognized from images embedded in this saved page. Durable, searchable copy.\n")

def ocr(path):
    try:
        out=subprocess.run([OCR,path],capture_output=True,text=True,timeout=120).stdout
    except Exception:
        return ""
    if out.startswith("FAILED-OCR") or "nilError" in out[:80]: return ""
    return out.strip()

def alnum(s): return sum(c.isalnum() for c in s)

def owning_page(SRC,rel):
    m=re.search(r"^(.*)_files/",rel)
    if m:
        for ext in (".html",".htm"):
            cand=m.group(1)+ext
            if os.path.exists(os.path.join(GROUNDING,cand)): return cand
        return m.group(1)+".html"
    return None

AGG={"scanned":0,"kept":0,"short":0,"failed":0,"inline":0,"inline_pages":0}
ALL_PAGES={}   # "root/page" -> list[(imgrel,text)]

def process(rootname):
    SRC=os.path.normpath(os.path.join(GROUNDING,rootname))
    images=[]
    for base,_,files in os.walk(SRC):
        for fn in files:
            if os.path.splitext(fn)[1].lower() not in RASTER: continue
            full=os.path.join(base,fn)
            try:
                if os.path.getsize(full)<MIN_BYTES: continue
            except OSError: continue
            images.append(os.path.relpath(full,SRC))
    images.sort()
    page_sections=defaultdict(list); standalone=[]
    for rel in images:
        AGG["scanned"]+=1
        txt=ocr(os.path.join(GROUNDING,rel))
        if not txt: AGG["failed"]+=1; continue
        if alnum(txt)<MIN_ALNUM: AGG["short"]+=1; continue
        AGG["kept"]+=1
        page=owning_page(SRC,rel)
        if page: page_sections[page].append((rel,txt))
        else: standalone.append((rel,txt))
    # write per-page aggregated OCR
    for page,secs in sorted(page_sections.items()):
        outp=os.path.join(GROUNDING,page+".images.ocr.txt")
        ALL_PAGES[f"{rootname}/{page}"]=secs
        if os.path.exists(outp) and not FORCE: continue
        body=[HDR,f"# Owning page: {page}",f"# {len(secs)} image(s) with recognized text.",""]
        for img,txt in secs:
            body.append(f"===== IMAGE {os.path.relpath(os.path.join(GROUNDING,img), os.path.dirname(outp))} =====")
            body.append(txt); body.append("")
        open(outp,"w",encoding="utf-8").write("\n".join(body))
    for img,txt in standalone:
        outp=os.path.join(GROUNDING,img+".ocr.txt")
        ALL_PAGES[f"{rootname}/{img} (standalone)"]=[(img,txt)]
        if os.path.exists(outp) and not FORCE: continue
        open(outp,"w",encoding="utf-8").write(HDR+f"# Source image: {img}\n\n"+txt+"\n")
    # inline data:image blobs
    DATA_RE=re.compile(r"data:image/(png|jpe?g|webp);base64,([A-Za-z0-9+/]{6000,}={0,2})")
    for base,_,files in os.walk(SRC):
        for fn in files:
            if not fn.lower().endswith((".html",".htm")): continue
            full=os.path.join(base,fn); rel=os.path.relpath(full,SRC)
            try: html=open(full,encoding="utf-8",errors="replace").read()
            except Exception: continue
            hit=False
            for i,(ext,b64) in enumerate(DATA_RE.findall(html)):
                try: raw=base64.b64decode(b64+"="*(-len(b64)%4))
                except Exception: continue
                if len(raw)<MIN_BYTES: continue
                with tempfile.NamedTemporaryFile(suffix="."+ext.replace("jpeg","jpg"),delete=False) as tf:
                    tf.write(raw); tmp=tf.name
                txt=ocr(tmp); os.unlink(tmp)
                if not txt or alnum(txt)<MIN_ALNUM: continue
                outp=os.path.join(GROUNDING,f"{rel}.inline-{i}.ocr.txt")
                AGG["inline"]+=1; hit=True
                if os.path.exists(outp) and not FORCE: continue
                open(outp,"w",encoding="utf-8").write(HDR+f"# Inline data:image #{i} in {rel}\n\n"+txt+"\n")
            if hit: AGG["inline_pages"]+=1

for r in ROOTS: process(r)

# ---------- report ----------
rep=[f"# Second-pass image OCR ({TODAY})","",
     f"Roots: {', '.join(ROOTS)}. macOS Vision on on-disk raster images >= {MIN_BYTES} bytes and "
     f"inline data:image blobs; kept results with >= {MIN_ALNUM} alphanumeric chars.","",
     f"- images scanned: **{AGG['scanned']}**",
     f"- kept (meaningful text): **{AGG['kept']}**",
     f"- skipped (text too short / decorative): {AGG['short']}",
     f"- OCR returned nothing / failed (textless photos, spacers): {AGG['failed']}",
     f"- pages/standalone images with an OCR sidecar: **{len(ALL_PAGES)}**",
     f"- inline data:image blobs OCR'd: {AGG['inline']} across {AGG['inline_pages']} page(s)","",
     "## Pages with the most recognized image text",""]
for page,secs in sorted(ALL_PAGES.items(), key=lambda kv:-sum(len(t) for _,t in kv[1]))[:60]:
    chars=sum(len(t) for _,t in secs)
    sample=re.sub(r"\s+"," ",secs[0][1])[:120]
    rep.append(f"- `{page}` — {len(secs)} img, {chars} chars — e.g. “{sample}…”")
open(f"{GROUNDING}/ocr-images-{TODAY}.md","w",encoding="utf-8").write("\n".join(rep)+"\n")
print(f"scanned={AGG['scanned']} kept={AGG['kept']} short={AGG['short']} failed={AGG['failed']} "
      f"sidecars={len(ALL_PAGES)} inline={AGG['inline']}")
print("wrote ocr-images-<date>.md")
