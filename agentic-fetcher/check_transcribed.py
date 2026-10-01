#!/usr/bin/env python3
"""Tighten transcribed sources — the check for observations grounded on a *typed* core, not raw bytes.

`capture: "transcribed"` means an agent typed the source content into a file instead of archiving the
page's bytes. The quote then only self-verifies against that transcription — it is NOT proof the live
source says it. This tool surfaces every transcribed doc, classifies how it can be made *tight*, and
emits a corroboration worklist. Tight means one of:

  UPGRADE     re-fetch the URL with curl/WebFetch and `install_source.py` the real bytes → the doc
              becomes capture:fetched and the quote verifies against the true page. (agent-fetchable)
  CORROBORATE the page needs a rendered browser (JS/app-store/levels-style) — no agent can fetch it;
              a human captures it, or it is re-fetched and the quote confirmed, and recorded.
  REGROUND    the core is an analyst COMPILATION ("substitute analysis", a `Sources:` line naming
              several domains) — it can never be a single primary. Re-ground each figure on its own
              single-source page, or reclassify the doc origin to `derivative` (reasoning). These are
              exactly the docs an audit marks `not_a_source`.

Classification is a heuristic to route the work; the human/agent makes the call. Two-root model:
transcription flag is on the observation (PROJECT); doc identity/core is under GROUNDING.

    python3 check_transcribed.py            # report + worklist
    python3 check_transcribed.py --json      # machine-readable
"""
import os, re, json, argparse
from urllib.parse import urlparse
from paths import PROJECT, GROUNDING

# hosts that render client-side / gate content — no agent (curl/WebFetch) can capture them faithfully
BROWSER_ONLY = ("play.google.com", "apps.apple.com", "levels.fyi")
DOMAIN_RE = re.compile(r'\b([a-z0-9][a-z0-9-]+\.(?:com|ai|us|io|app|org|net|pt|fyi|co))\b', re.I)


def _classify(core_text, own_url):
    """single-source transcription vs analyst compilation."""
    head = "\n".join(core_text.splitlines()[:6]).lower()
    if "substitute" in head or "substitute-analysis" in head:
        return "compilation"
    own = urlparse(own_url).netloc.replace("www.", "") if own_url else ""
    for line in core_text.splitlines():
        if line.lower().startswith(("sources:", "source:")):
            doms = {d.lower() for d in DOMAIN_RE.findall(line)}
            doms.discard(own)
            if len(doms) >= 2:
                return "compilation"
    return "single"


def build():
    docs = json.load(open(f"{GROUNDING}/documents.json"))
    obs = json.load(open(f"{PROJECT}/corpus/observations.json"))
    # transcribed docs = those any transcribed observation points at, or capture==transcribed
    by_doc = {}
    for oid, o in obs.items():
        if o.get("source_capture") == "transcribed" or docs.get(o.get("doc"), {}).get("capture") == "transcribed":
            by_doc.setdefault(o["doc"], []).append(oid)

    rows = []
    for docid, oids in sorted(by_doc.items()):
        d = docs.get(docid, {})
        url = d.get("url") or ""
        core = d.get("core")
        core_text = ""
        core_ok = bool(core) and os.path.exists(f"{GROUNDING}/{core}")
        if core_ok:
            core_text = open(f"{GROUNDING}/{core}", encoding="utf-8", errors="replace").read()
        host = urlparse(url).netloc.replace("www.", "")
        kind = _classify(core_text, url) if core_text else "single"
        if kind == "compilation":
            action = "REGROUND"
        elif any(host.endswith(b) for b in BROWSER_ONLY):
            action = "CORROBORATE"   # human capture — JS/app-store/levels
        else:
            action = "UPGRADE"       # agent-fetchable: re-fetch + install real bytes
        rows.append({"doc": docid, "url": url, "host": host, "kind": kind, "action": action,
                     "audit": d.get("audit"), "observations": oids, "n_obs": len(oids)})
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    rows = build()
    if a.json:
        print(json.dumps(rows, indent=2)); return
    from collections import Counter
    by_action = Counter(r["action"] for r in rows)
    print(f"{len(rows)} transcribed docs backing {sum(r['n_obs'] for r in rows)} observations. "
          f"Corroboration worklist:\n")
    for act, blurb in [("UPGRADE", "agent re-fetch + install_source (→ capture:fetched)"),
                       ("CORROBORATE", "human capture — JS/app-store/levels page no agent can fetch"),
                       ("REGROUND", "analyst compilation — reground per-source or reclassify derivative")]:
        group = [r for r in rows if r["action"] == act]
        if not group: continue
        print(f"── {act}  ({len(group)} docs) — {blurb}")
        for r in group:
            print(f"     {r['doc']}  {r['url']}")
            print(f"        obs: {', '.join(r['observations'])}")
    print(f"\nsummary: {dict(by_action)}")
    print("A transcribed doc is not tight until UPGRADE/CORROBORATE confirms the live page, or REGROUND "
          "replaces the compilation with real single-source grounding.")


if __name__ == "__main__":
    main()
