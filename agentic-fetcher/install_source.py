#!/usr/bin/env python3
"""Install a new source into the archive end-to-end, so an agent can ground a node against it.

Give it a file an agent already fetched (or a URL to fetch with curl) and it:
  1. hashes the bytes (sha256) and DEDUPES — a byte-identical source already in the archive is
     reported, not duplicated;
  2. stores the raw file under sources/<tier>/ (the durable byte archive);
  3. extracts a lean, searchable CORE to cores/doc_<sha12>.txt — HTML stripped to text, a text PDF
     via pdftotext, an image-only (scanned) PDF via the macOS-Vision OCR sidecar (ocr_pdf.sh);
  4. appends a MANIFEST.csv row and registers a `doc_<sha12>` identity in the shared registry
     (GROUNDING/documents.json: title/url/publisher/core) ready for add_observation.py;
  5. if the source fulfils a queued human-fetch request (matching URL), marks it resolved.

    # an agent that already has the bytes (saved a WebFetch/download to a file):
    python3 install_source.py path/to/saved.html --url https://x.com/p --title "X pricing"

    # fetch the URL directly with curl (needs network; may require running outside the sandbox):
    python3 install_source.py --url https://x.com/p --title "X pricing"

    # verify/inspect only — hash, dedupe check, extracted core preview; no write:
    python3 install_source.py path/to/saved.html --url https://x.com/p --check

Cleaning is deliberately lean (the core is the text layer search.py + add_observation quote-match
against). Re-running on the same bytes is a no-op. Honors FORECASTER_DATA for isolated runs.
"""
import sys, os, re, csv, json, html, fcntl, hashlib, argparse, subprocess, tempfile
from urllib.parse import urlparse

from paths import PROJECT, GROUNDING   # PROJECT holds corpus/; GROUNDING holds the source cache
HERE = os.path.dirname(os.path.abspath(__file__))
MAN_COLS = ["id", "tier", "domain", "title", "url", "type", "bytes", "copies", "sha256", "stored", "origin", "status"]

def _slug(s, n=48):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", (s or "").lower())).strip("-")[:n] or "source"

def _ext_and_type(fname, ctype, data):
    ext = os.path.splitext(fname)[1].lower().lstrip(".")
    if ext in ("html", "htm"): return "html", "html"
    if ext == "pdf": return "pdf", "pdf"
    if ext in ("txt", "md", "csv"): return ext, "text"
    head = data[:512].lstrip()
    if head[:5].lower() == b"<html" or b"<!doctype html" in head.lower() or b"<body" in head.lower(): return "html", "html"
    if data[:5] == b"%PDF-": return "pdf", "pdf"
    return (ext or "bin"), "text"

# ---- core extraction (the lean, searchable text layer) ----
def _html_to_text(data):
    s = data.decode("utf-8", "replace")
    s = re.sub(r"(?is)<(script|style|noscript|svg|head)\b.*?</\1>", " ", s)
    s = re.sub(r"(?is)<!--.*?-->", " ", s)
    s = re.sub(r"(?is)<(br|/p|/div|/li|/tr|/h[1-6])\s*>", "\n", s)
    s = re.sub(r"(?s)<[^>]+>", " ", s)
    s = html.unescape(s)
    s = re.sub(r"[ \t ]+", " ", s)
    s = re.sub(r"\n\s*\n\s*\n+", "\n\n", s)
    return "\n".join(ln.strip() for ln in s.splitlines() if ln.strip())

def _pdf_to_text(path):
    """Text PDF → pdftotext. Image-only (scan) → macOS Vision OCR sidecar. Returns (text, how)."""
    txt = ""
    try:
        r = subprocess.run(["pdftotext", "-q", path, "-"], capture_output=True, text=True, timeout=120)
        txt = r.stdout or ""
    except Exception:
        pass
    if len(re.sub(r"\s", "", txt)) >= 200:
        return txt, "pdftotext"
    ocr = f"{HERE}/ocr_pdf.sh"                     # scanned PDF — OCR it (Vision, offline)
    if os.path.exists(ocr):
        try:
            subprocess.run([ocr, path], capture_output=True, text=True, timeout=600, check=True)
            side = f"{path}.ocr.txt"
            if os.path.exists(side):
                return open(side, encoding="utf-8", errors="replace").read(), "ocr"
        except Exception as e:
            return txt, f"ocr-failed:{e}"
    return txt, "pdftotext-thin"

def extract_core(stored_abs, kind):
    data = open(stored_abs, "rb").read()
    if kind == "html": return _html_to_text(data), "html-strip"
    if kind == "pdf":  return _pdf_to_text(stored_abs)
    return data.decode("utf-8", "replace"), "verbatim"

# ---- archive registration (MANIFEST + corpus doc), file-locked ----
def _load_manifest():
    p = f"{GROUNDING}/MANIFEST.csv"
    return list(csv.DictReader(open(p))) if os.path.exists(p) else []

def _find_existing(sha):
    for r in _load_manifest():
        if r.get("sha256") == sha: return r
    return None

def _write_manifest_row(row):
    p = f"{GROUNDING}/MANIFEST.csv"
    exists = os.path.exists(p)
    fh = open(p, "a+", encoding="utf-8", newline=""); fcntl.flock(fh, fcntl.LOCK_EX)
    try:
        w = csv.DictWriter(fh, fieldnames=MAN_COLS)
        if not exists or os.path.getsize(p) == 0: w.writeheader()
        w.writerow(row)
    finally:
        fcntl.flock(fh, fcntl.LOCK_UN); fh.close()

def _register_doc(doc_id, meta):
    p = f"{GROUNDING}/documents.json"          # the shared source-identity registry
    fh = open(p, "r+", encoding="utf-8") if os.path.exists(p) else open(p, "w+", encoding="utf-8")
    fcntl.flock(fh, fcntl.LOCK_EX)
    try:
        fh.seek(0); body = fh.read().strip(); docs = json.loads(body) if body else {}
        if doc_id not in docs:
            docs[doc_id] = meta
        fh.seek(0); fh.truncate(); json.dump(docs, fh, indent=1, ensure_ascii=False); fh.write("\n")
    finally:
        fcntl.flock(fh, fcntl.LOCK_UN); fh.close()

def install(data, url, title, tier="manual", origin="agent-install", src_name="source", check=False, capture=None):
    sha = hashlib.sha256(data).hexdigest(); sha12 = sha[:12]; doc_id = f"doc_{sha12}"
    kind_ext, typ = _ext_and_type(src_name, None, data)
    domain = urlparse(url or "").netloc.replace("www.", "") or "unknown"
    existing = _find_existing(sha)
    if existing and not check:
        print(f"already archived: {doc_id}  (sha match, stored {existing['stored']}) — not duplicated")
        _resolve_request(url)
        return doc_id, "exists"
    stored_rel = f"{tier}/{_slug(domain)}__{_slug(title or src_name)}.{kind_ext}"
    stored_abs = f"{GROUNDING}/{stored_rel}"
    if check:
        import io
        tmp = tempfile.NamedTemporaryFile(suffix=f".{kind_ext}", delete=False); tmp.write(data); tmp.close()
        core_text, how = extract_core(tmp.name, typ); os.unlink(tmp.name)
        print(f"[check] {doc_id}  type={typ}  bytes={len(data)}  domain={domain}")
        print(f"[check] {'DUPLICATE of '+existing['stored'] if existing else 'new source'}")
        print(f"[check] core via {how}: {len(core_text)} chars; preview:\n    " + core_text[:280].replace('\n', '\n    '))
        return doc_id, "check"
    os.makedirs(os.path.dirname(stored_abs), exist_ok=True)
    open(stored_abs, "wb").write(data)
    core_text, how = extract_core(stored_abs, typ)
    core_rel = f"cores/{doc_id}.txt"
    os.makedirs(f"{GROUNDING}/cores", exist_ok=True)
    open(f"{GROUNDING}/{core_rel}", "w", encoding="utf-8").write(core_text)
    # capture provenance: `fetched` = the core is the archived page's own bytes; `transcribed` = an
    # agent typed the figures into a text file (a JS-rendered page WebFetch could read but curl can't).
    # A transcribed core self-verifies against our OWN text, so a transcribed numeric fact is weaker
    # evidence — surfaced here and by add_observation so it can be gated on a second source / audit.
    looks_transcribed = (typ == "text" and how == "verbatim" and not (url or "").lower().endswith((".txt", ".md", ".csv")))
    cap = capture or ("transcribed" if looks_transcribed else "fetched")
    if looks_transcribed and not capture:
        print("  ⚠ this looks like a TRANSCRIPTION (a text file for a web URL) — recording capture:transcribed. "
              "Pass --capture fetched if it is really the page's own text.", file=sys.stderr)
    _write_manifest_row({"id": f"{_slug(domain)}__{sha12}", "tier": tier, "domain": domain,
                         "title": title or src_name, "url": url or "", "type": typ, "bytes": str(len(data)),
                         "copies": "1", "sha256": sha, "stored": stored_rel, "origin": origin, "status": "installed"})
    _register_doc(doc_id, {"sha256": sha, "title": title or src_name, "url": url or "",
                           "publisher": domain, "core": core_rel, "capture": cap})
    _resolve_request(url)
    print(f"installed {doc_id}  ({typ}, {len(data)} bytes)  core via {how}: {len(core_text)} chars")
    print(f"  raw:  {GROUNDING}/{stored_rel}")
    print(f"  core: {GROUNDING}/{core_rel}")
    print(f"  → ground it:  python3 add_observation.py {doc_id} obs_<id> --value <v> --unit <u> "
          f"--statement <s> --quote \"<verbatim from the core>\"")
    return doc_id, "installed"

def _resolve_request(url):
    """If a queued fetch request matches this URL, mark it resolved — and REPORT it (so a silent
    no-op on a canonical-vs-requested URL mismatch is visible, not swallowed)."""
    if not url: return
    try:
        import fetch_request as fr
        n = fr.resolve(url, note="installed")
        if n:
            print(f"  ✓ resolved {n} queued fetch request(s) for this URL")
            return
        dom = fr._domain(url)                          # exact URL matched nothing — flag a same-domain
        pend = [r for r in fr._read()                 # pending request (likely a canonical/redirect
                if r.get("status") != "resolved" and fr._domain(r.get("url")) == dom]  # URL mismatch)
        if pend:
            print(f"  ⚠ a queued fetch on {dom} is still PENDING and did not match this URL exactly: "
                  f"{pend[0]['url']}\n    if this install covers it, resolve it: "
                  f"python3 fetch_request.py resolve --url {pend[0]['url']}", file=sys.stderr)
    except Exception:
        pass

def main():
    ap = argparse.ArgumentParser(description="Install a new source into the archive (raw + core + manifest + corpus doc).")
    ap.add_argument("file", nargs="?", help="a local file the agent already fetched")
    ap.add_argument("--url", default=None, help="the source URL (provenance; or fetched with curl when no file is given)")
    ap.add_argument("--title", default=None)
    ap.add_argument("--tier", default="manual")
    ap.add_argument("--origin", default="agent-install")
    ap.add_argument("--capture", default=None, choices=["fetched", "transcribed"],
                    help="fetched = the core is the page's own bytes; transcribed = an agent typed the "
                         "figures (JS-rendered page). Auto-detected for text files on a web URL.")
    ap.add_argument("--check", action="store_true", help="hash + dedupe + core preview, no write")
    a = ap.parse_args()
    if a.file:
        data = open(a.file, "rb").read(); name = os.path.basename(a.file)
    elif a.url:
        try:
            r = subprocess.run(["curl", "-fsSL", "--max-time", "60", a.url], capture_output=True, timeout=90)
            if r.returncode != 0 or not r.stdout:
                sys.exit(f"curl fetch failed ({r.returncode}). Save the file yourself and pass it, or queue it: "
                         f"python3 fetch_request.py add --url {a.url} --why '...' --for <project::node>")
            data = r.stdout; name = os.path.basename(urlparse(a.url).path) or "source"
        except Exception as e:
            sys.exit(f"fetch error: {e}. Queue it for a human: fetch_request.py add --url {a.url} ...")
    else:
        ap.error("give a file, or --url to fetch")
    if not a.title and not a.url:
        print("note: no --title/--url given; provenance will be thin", file=sys.stderr)
    install(data, a.url, a.title, tier=a.tier, origin=a.origin, src_name=name, check=a.check, capture=a.capture)

if __name__ == "__main__":
    main()
