# -*- coding: utf-8 -*-
# Task 2: extract clean `core` text from each archived document -> cores/doc_<sha12>.txt
# HTML -> boilerplate-stripped text (stdlib, tag-stack + class/id heuristics + main/article
# preference). PDF -> pdftotext; image-only PDFs + standalone images routed to an OCR worklist.
import csv, os, re, subprocess
from html.parser import HTMLParser
import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
from paths import PROJECT, GROUNDING
SRC=GROUNDING; CORES=f"{GROUNDING}/cores"
os.makedirs(CORES,exist_ok=True)

SKIP={"script","style","head","noscript","svg","form","button","iframe","template","select","option"}
VOID={"br","img","hr","input","meta","link","source","area","base","col","embed","param","track","wbr"}
BLOCK={"p","div","li","tr","section","article","header","td","th","blockquote","pre",
       "h1","h2","h3","h4","h5","h6","ul","ol","table","main","figure","figcaption","dt","dd"}
BOILER=("cookie","consent","gdpr","onetrust","cc-window","cmp-","nav","navbar","navigation",
        "menu","footer","sidebar","subscribe","newsletter","signup","popup","modal","overlay",
        "lightbox","social","share-","sharing","advert","adslot","-ads","promo","breadcrumb",
        "pagination","banner","masthead","skip-to","skip-link","sr-only","visually-hidden",
        "screen-reader","offcanvas","toolbar","topbar","related","recommend","site-header",
        "global-header")

class Extract(HTMLParser):
    def __init__(self, content_only):
        super().__init__(convert_charrefs=True)
        self.content_only=content_only; self.stack=[]; self.out=[]; self.title=None; self._intitle=False
    def _boiler(self,attrs):
        s=" ".join((v or "") for k,v in attrs if k in ("class","id","role")).lower()
        if "content" in s or "article" in s or "main" in s: return False   # protect content-ish
        return any(kw in s for kw in BOILER)
    def _skipping(self): return any(s[1] for s in self.stack)
    def _in_content(self): return any(s[0] in ("main","article") for s in self.stack)
    def handle_starttag(self,t,attrs):
        if t=="title": self._intitle=True
        if t in VOID:
            if t=="br" and not self._skipping(): self.out.append("\n")
            return
        self.stack.append([t, (t in SKIP or self._boiler(attrs) or self._skipping())])
        if t in BLOCK and not self._skipping(): self.out.append("\n")
    def handle_startendtag(self,t,attrs):
        if t=="br" and not self._skipping(): self.out.append("\n")
    def handle_endtag(self,t):
        if t=="title": self._intitle=False
        if t in VOID: return
        for i in range(len(self.stack)-1,-1,-1):
            if self.stack[i][0]==t:
                skipping_before=self._skipping(); del self.stack[i:]
                if t in BLOCK and not self._skipping() and not skipping_before is None: self.out.append("\n")
                return
    def handle_data(self,d):
        if self._intitle and self.title is None: self.title=d.strip()
        if self._skipping(): return
        if self.content_only and not self._in_content(): return
        self.out.append(d)

def clean_ws(s):
    s=s.replace("\xa0"," ")
    s=re.sub(r"[ \t]+"," ",s)
    s=re.sub(r" *\n *","\n",s)
    s=re.sub(r"\n{3,}","\n\n",s)
    # drop lines that are pure boilerplate noise
    keep=[]
    for ln in s.split("\n"):
        l=ln.strip()
        if not l: keep.append(""); continue
        if l.lower() in ("always active","accept all","reject all","customize","cookie","duration","description"): continue
        keep.append(l)
    return re.sub(r"\n{3,}","\n\n","\n".join(keep)).strip()

def _run(raw, content_only):
    p=Extract(content_only)
    try: p.feed(raw)
    except Exception: pass
    return (p.title or ""), clean_ws("".join(p.out))

def html_to_text(path):
    raw=open(path,encoding="utf-8",errors="replace").read()
    content_only=bool(re.search(r"<(main|article)[\s>]",raw,re.I))
    title,txt=_run(raw, content_only)
    if content_only and len(txt)<200:          # main/article mis-detected — retry whole body
        title,txt=_run(raw, False)
    return title, txt

def pdf_to_text(path):
    try: return subprocess.run(["pdftotext","-layout",path,"-"],capture_output=True,timeout=120).stdout.decode("utf-8","replace")
    except Exception: return ""

def main():
    man=list(csv.DictReader(open(f"{GROUNDING}/MANIFEST.csv")))
    done=skipped=0; ocr_pdfs=[]; ocr_imgs=[]; errors=[]
    for m in man:
        typ=m.get("type","").strip(); status=m.get("status","").strip()
        sha=m.get("sha256","").strip(); stored=m.get("stored","").strip()
        if status=="asset" or not sha or not stored: skipped+=1; continue
        path=os.path.join(GROUNDING,stored)
        if not os.path.exists(path): errors.append(("missing",stored)); continue
        out=os.path.join(CORES,f"doc_{sha[:12]}.txt")
        try:
            if typ in ("html","htm"):
                title,txt=html_to_text(path)
                if len(txt)<40: errors.append(("empty_html",stored)); continue
                open(out,"w",encoding="utf-8").write(f"# core: {m.get('title','') or title}\n# url: {m.get('url','')}\n# doc_{sha[:12]}  ({typ}, from {stored})\n\n"+txt+"\n"); done+=1
            elif typ=="pdf":
                txt=pdf_to_text(path)
                if len(txt.strip())<200: ocr_pdfs.append((sha,stored)); continue
                open(out,"w",encoding="utf-8").write(f"# core: {m.get('title','')}\n# url: {m.get('url','')}\n# doc_{sha[:12]}  (pdf, from {stored})\n\n"+txt.strip()+"\n"); done+=1
            elif typ=="txt":
                txt=open(path,encoding="utf-8",errors="replace").read().strip()
                if len(txt)<40: skipped+=1; continue
                open(out,"w",encoding="utf-8").write(f"# core: {m.get('title','')}\n# doc_{sha[:12]} (txt)\n\n"+txt+"\n"); done+=1
            elif typ in ("png","jpg","jpeg","webp","gif"): ocr_imgs.append((sha,stored))
            else: skipped+=1
        except Exception as e: errors.append((str(e)[:40],stored))
    with open(f"{GROUNDING}/ocr-worklist.tsv","w") as f:
        for sha,stored in ocr_pdfs: f.write(f"pdf\t{sha}\t{stored}\n")
        for sha,stored in ocr_imgs: f.write(f"img\t{sha}\t{stored}\n")
    print("cores written:",done,"| skipped:",skipped,"| OCR: %d pdf + %d img"%(len(ocr_pdfs),len(ocr_imgs)),"| errors:",len(errors))

if __name__=="__main__": main()
