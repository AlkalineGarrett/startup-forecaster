# -*- coding: utf-8 -*-
# OCR pass (macOS Vision, must run OUTSIDE sandbox): image-only PDFs + standalone images -> cores/
import csv, os, subprocess
import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
from paths import PROJECT, GROUNDING, ocrtool
SRC=GROUNDING; CORES=f"{GROUNDING}/cores"; TOOLS=_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
man={m["sha256"]:m for m in csv.DictReader(open(f"{GROUNDING}/MANIFEST.csv"))}
done=0
for line in open(f"{GROUNDING}/ocr-worklist.tsv"):
    kind,sha,stored=line.rstrip("\n").split("\t")
    path=os.path.join(GROUNDING,stored); out=os.path.join(CORES,f"doc_{sha[:12]}.txt")
    m=man.get(sha,{})
    hdr=f"# core (OCR): {m.get('title','')}\n# url: {m.get('url','')}\n# doc_{sha[:12]}  ({kind}, OCR of {stored})\n\n"
    try:
        if kind=="pdf":
            subprocess.run([f"{TOOLS}/ocr_pdf.sh",path],check=True,capture_output=True,timeout=600)
            txt=open(path+".ocr.txt",encoding="utf-8",errors="replace").read()
            # drop the sidecar's own header comment lines
            txt="\n".join(l for l in txt.split("\n") if not l.startswith("#"))
        else:
            txt=subprocess.run([ocrtool(),path],capture_output=True,timeout=300).stdout.decode("utf-8","replace")
        txt=txt.strip()
        if len(txt)<20: print("  weak OCR:",stored,f"({len(txt)}c)"); continue
        open(out,"w",encoding="utf-8").write(hdr+txt+"\n"); done+=1
        print("  ok  doc_%s  (%d chars)  %s"%(sha[:12],len(txt),os.path.basename(stored)))
    except Exception as e:
        print("  FAIL",stored,str(e)[:80])
print("OCR cores written:",done)
