# -*- coding: utf-8 -*-
"""Fill the holes in the cores/ text layer so a cross-corpus grep is (near) complete.
Generates cores/doc_<sha12>.txt for non-asset/non-crawl artifacts that lack one:
  - xlsx  -> stdlib zip+XML dump of cell values (sharedStrings + each sheet)
  - gz    -> gunzip, keep if it decodes to text
  - txt   -> already text; extract into a core
  - html  -> re-run the boilerplate-stripper; keep if >800 chars (recovers pages the first
             aggressive pass dropped). Genuinely-empty pages (404/challenge/SPA) stay coreless.
Run: python3 prep/extract_remaining.py --write
"""
import csv, os, glob, re, sys, zipfile, gzip, html, json
from xml.etree import ElementTree as ET
import datetime
TODAY = datetime.date.today().isoformat()
import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
from paths import PROJECT, GROUNDING
man=list(csv.DictReader(open(f"{GROUNDING}/MANIFEST.csv")))
cores={os.path.basename(p)[4:16] for p in glob.glob(f"{GROUNDING}/cores/doc_*.txt")}
WRITE="--write" in sys.argv

def strip_html(t):
    t=re.sub(r"<(script|style)[^>]*>.*?</\1>"," ",t,flags=re.I|re.S)
    t=re.sub(r"<[^>]+>"," ",t); t=html.unescape(t)
    return re.sub(r"[ \t]+"," ",re.sub(r"\n\s*\n+","\n\n",t)).strip()

def xlsx_text(path):
    z=zipfile.ZipFile(path)
    ns="{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    shared=[]
    if "xl/sharedStrings.xml" in z.namelist():
        r=ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in r.findall(f"{ns}si"):
            shared.append("".join(t.text or "" for t in si.iter(f"{ns}t")))
    out=[]
    for name in sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$",n)):
        out.append(f"----- {name} -----")
        root=ET.fromstring(z.read(name))
        for row in root.iter(f"{ns}row"):
            cells=[]
            for c in row.findall(f"{ns}c"):
                v=c.find(f"{ns}v")
                if v is None or v.text is None: continue
                if c.get("t")=="s":
                    try: cells.append(shared[int(v.text)])
                    except (ValueError,IndexError): cells.append(v.text)
                else: cells.append(v.text)
            if cells: out.append("\t".join(cells))
    return "\n".join(out)

made={"xlsx":0,"gz":0,"txt":0,"html":0,"json":0}; empty=[]
for m in man:
    if m["status"]=="asset" or m["tier"]=="crawls": continue
    sha=m["sha256"]
    if sha[:12] in cores: continue
    src=os.path.join(GROUNDING,m["stored"]); typ=m["type"]
    if not os.path.exists(src): continue
    text=""
    try:
        if typ=="xlsx":
            try: text=xlsx_text(src)
            except zipfile.BadZipFile:                 # P6: mislabeled — actually HTML
                text=strip_html(open(src,encoding="utf-8",errors="replace").read())
        elif typ=="json":
            try: text=json.dumps(json.load(open(src,encoding="utf-8",errors="replace")),indent=1,ensure_ascii=False)
            except Exception: text=open(src,encoding="utf-8",errors="replace").read()
        elif typ=="gz":
            raw=gzip.open(src,"rb").read()
            try: text=raw.decode("utf-8")
            except UnicodeDecodeError: text=""
            if "<" in text[:200] and ">" in text[:2000]: text=strip_html(text)
        elif typ=="txt": text=open(src,encoding="utf-8",errors="replace").read().strip()
        elif typ=="html": text=strip_html(open(src,encoding="utf-8",errors="replace").read())
    except Exception as e:
        empty.append((typ,m["stored"],f"err:{e}")); continue
    minlen=40 if typ in ("xlsx","txt","json") else 800
    if len(text)<minlen: empty.append((typ,m["stored"],f"{len(text)}chars")); continue
    core=os.path.join(GROUNDING,"cores",f"doc_{sha[:12]}.txt")
    hdr=f"# core for {m['stored']}\n# title: {m['title']}\n# url: {m.get('url','')}\n# (generated {TODAY} by extract_remaining.py; type={typ})\n\n"
    if WRITE and not os.path.exists(core): open(core,"w",encoding="utf-8").write(hdr+text+"\n")
    made[typ]+=1

print("cores generated (or would generate) for previously-coreless artifacts:", made)
print(f"still coreless (genuinely empty/non-text): {len(empty)}")
from collections import Counter
print("  by type:", dict(Counter(t for t,_,_ in empty)))
for t,s,why in empty[:8]: print(f"    [{t}] {s}  ({why})")
