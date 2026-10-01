#!/usr/bin/env python3
"""The fetch queue — a handoff channel for sources an agent needs but cannot retrieve itself.

Subagents can `WebSearch` (so they can FIND a source) but their `WebFetch` cannot resolve DNS in the
sandbox (so they cannot RETRIEVE the bytes). When an agent needs a source, it appends a request here
and STOPS grounding that node — it does not guess. Each request carries a `lane`:

  • agent_fetchable  — a normal public page the MAIN interactive session can fetch. Between fan-out
                       phases the main session runs `drain`, fetches + installs each (which
                       auto-resolves the entry), and a follow-up pass grounds the now-real observation.
  • human_only       — no agent can reach it (gated, paywalled, JS-rendered, login/VPN-walled, a PDF
                       behind a portal). It falls through to the human worklist (`export`).

An agent queues optimistically as `agent_fetchable`; if the main session's own fetch then fails, it
`defer`s the request to `human_only`. Many parallel agents pool into one file-locked queue.

    # an agent queues a source it found (via WebSearch) but cannot retrieve; dedupes/merges by URL:
    python3 fetch_request.py add --url https://example.com/pricing \
        --why "holds the competitor's monthly plan price" --for habit-app::competitor_price --priority med
    #   ...or, if the page is clearly gated and no agent can reach it:
    python3 fetch_request.py add --url https://portal.example.com/report --lane human_only --why "..." --for ...

    # the MAIN session, between fan-out phases — fetch everything the agents couldn't:
    python3 fetch_request.py drain                # the agent_fetchable worklist to fetch + install
    python3 install_source.py <saved-file> --url <url> --title "..."   # auto-resolves the entry
    #   if the main session's own fetch fails too, hand it to the human:
    python3 fetch_request.py defer --url <url> --note "main WebFetch failed: <err>"

    # the human, at end of run — only the sources no agent could reach:
    python3 fetch_request.py list                 # pending (add --all for resolved too)
    python3 fetch_request.py export --md           # a markdown worklist to work through
    python3 fetch_request.py export --csv > todo.csv

    # mark done by hand if you fetched without install_source (install_source resolves automatically):
    python3 fetch_request.py resolve --url <url>

Always run `check` first — a source is often already archived under a redirected/canonical URL.
The queue is sources/fetch-queue.jsonl (one JSON object per line). Honors FORECASTER_DATA.
"""
import sys, os, json, csv, fcntl, argparse
from urllib.parse import urlparse

from paths import PROJECT, GROUNDING   # PROJECT holds corpus/; GROUNDING holds the source cache + queue
QUEUE = f"{GROUNDING}/fetch-queue.jsonl"
PRIORITIES = ("top", "high", "med", "low")
LANES = ("agent_fetchable", "human_only")

def _domain(u): return urlparse(u or "").netloc.replace("www.", "").lower()

def _lane(r):
    """A request's lane. Rows without one default to human_only — never silently assume an
    unlabeled row is agent-fetchable (that would drop it from the human worklist without a fetch)."""
    lane = r.get("lane")
    return lane if lane in LANES else "human_only"

def _archive_index():
    """(man_domains -> [stored], doc_domains -> [title], aliases_text) for domain-level dedupe."""
    man_domains, doc_domains, aliases = {}, {}, ""
    mp = f"{GROUNDING}/MANIFEST.csv"
    if os.path.exists(mp):
        for m in csv.DictReader(open(mp)):
            d = _domain(m.get("url"))
            if d: man_domains.setdefault(d, []).append(m["stored"])
    ap = f"{GROUNDING}/url-aliases.csv"
    if os.path.exists(ap): aliases = open(ap).read().lower()
    dp = f"{GROUNDING}/documents.json"
    if os.path.exists(dp):
        for dv in json.load(open(dp)).values():
            d = _domain(dv.get("url"))
            if d: doc_domains.setdefault(d, []).append((dv.get("title") or "")[:44])
    return man_domains, doc_domains, aliases

def _archive_hits(url, idx=None):
    """Domain-level archive matches for a URL: (stored_files, corpus_titles, in_aliases)."""
    man_domains, doc_domains, aliases = idx or _archive_index()
    dom = _domain(url)
    return man_domains.get(dom, []), doc_domains.get(dom, []), bool(dom and dom in aliases)

def _archived_urls():
    """Set of NORMALIZED URLs already in the archive — MANIFEST + corpus + url-aliases rows. An EXACT
    URL match is a definite 'already archived' (stronger than the domain-level hint), and it catches a
    canonical/redirected URL recorded in url-aliases that a domain check on a different host would miss."""
    urls = set()
    mp = f"{GROUNDING}/MANIFEST.csv"
    if os.path.exists(mp):
        for m in csv.DictReader(open(mp)):
            if m.get("url"): urls.add(_norm_url(m["url"]))
    dp = f"{GROUNDING}/documents.json"
    if os.path.exists(dp):
        for dv in json.load(open(dp)).values():
            if dv.get("url"): urls.add(_norm_url(dv["url"]))
    ap = f"{GROUNDING}/url-aliases.csv"
    if os.path.exists(ap):
        for row in csv.reader(open(ap)):
            for cell in row:
                if cell.strip().startswith("http"): urls.add(_norm_url(cell.strip()))
    return urls

def archive_check():
    """For every PENDING request, flag whether its source may ALREADY be in the archive — by domain
    against MANIFEST.csv, url-aliases.csv, and corpus/documents.json. A hit means: verify the specific
    content is in that archived core before fetching it (a source is often archived under a
    redirected/canonical URL). Run it before fetching anything."""
    idx = _archive_index()
    pend = [r for r in _read() if r.get("status") != "resolved"]
    hits = 0
    print(f"== archive check: {len(pend)} pending request(s) ==\n")
    for r in _rank(pend):
        mh, dh, al = _archive_hits(r["url"], idx)
        if mh or dh or al:
            hits += 1
            print(f"  ‼ POSSIBLE MATCH  [{r.get('priority')}/{_lane(r)}] {r['url']}")
            if mh: print(f"      archived files: {mh[:4]}")
            if dh: print(f"      corpus docs:    {dh[:4]}")
            if al: print("      appears in url-aliases.csv")
            print("      → verify the needed figure is in that core; if so, resolve() it — do not re-fetch.")
        else:
            print(f"  · not in archive   [{r.get('priority')}/{_lane(r)}] {r['url']}")
    print(f"\n{hits} of {len(pend)} pending request(s) may already be archived — verify content before fetching.")

def _read():
    if not os.path.exists(QUEUE): return []
    out = []
    for ln in open(QUEUE, encoding="utf-8"):
        ln = ln.strip()
        if ln:
            try: out.append(json.loads(ln))
            except Exception: pass
    return out

def _write_all(rows):
    os.makedirs(os.path.dirname(QUEUE), exist_ok=True)
    tmp = QUEUE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        for r in rows: fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    os.replace(tmp, QUEUE)

def _norm_url(u): return (u or "").strip().rstrip("/")

def add(url, why, for_nodes, priority="med", requested_by="agent", suggested_filename=None, lane="agent_fetchable"):
    """Append or merge a request. Returns the stored record. File-locked read-modify-write."""
    url = _norm_url(url)
    if priority not in PRIORITIES: priority = "med"
    if lane not in LANES: lane = "agent_fetchable"
    os.makedirs(os.path.dirname(QUEUE), exist_ok=True)
    fh = open(QUEUE, "a+", encoding="utf-8"); fcntl.flock(fh, fcntl.LOCK_EX)
    try:
        fh.seek(0)
        rows = [json.loads(l) for l in fh.read().splitlines() if l.strip()]
        cur = next((r for r in rows if _norm_url(r.get("url")) == url), None)
        if cur:                                                   # merge into the existing request
            for n in (for_nodes or []):
                if n not in cur.setdefault("for", []): cur["for"].append(n)
            if why and why not in (cur.get("why") or ""):
                cur["why"] = ((cur.get("why") or "") + " | " + why).strip(" |")
            if PRIORITIES.index(priority) < PRIORITIES.index(cur.get("priority", "med")):
                cur["priority"] = priority                        # keep the most urgent
            cur.setdefault("lane", lane)                          # optimistic: agent_fetchable wins at
            if lane == "agent_fetchable": cur["lane"] = "agent_fetchable"   # add time (drain defers on fail)
            rec = cur
        else:
            rec = {"url": url, "why": why or "", "for": list(for_nodes or []), "priority": priority,
                   "lane": lane, "requested_by": requested_by,
                   "suggested_filename": suggested_filename, "status": "pending"}
            rows.append(rec)
        fh.seek(0); fh.truncate()
        for r in rows: fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    finally:
        fcntl.flock(fh, fcntl.LOCK_UN); fh.close()
    return rec

def _mutate(url, fn):
    """File-locked: apply fn(row) to every pending row matching url. Returns count mutated."""
    url = _norm_url(url)
    if not os.path.exists(QUEUE): return 0
    fh = open(QUEUE, "r+", encoding="utf-8"); fcntl.flock(fh, fcntl.LOCK_EX)
    try:
        fh.seek(0)
        rows = [json.loads(l) for l in fh.read().splitlines() if l.strip()]
        n = 0
        for r in rows:
            if _norm_url(r.get("url")) == url and r.get("status") != "resolved":
                fn(r); n += 1
        fh.seek(0); fh.truncate()
        for r in rows: fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    finally:
        fcntl.flock(fh, fcntl.LOCK_UN); fh.close()
    return n

def resolve(url, note=None):
    """Mark every pending request matching this URL resolved. Returns how many. File-locked."""
    def _r(r):
        r["status"] = "resolved"
        if note: r["resolution"] = note
    return _mutate(url, _r)

def defer(url, note=None):
    """Flip every pending request matching this URL to the human_only lane — the main session tried
    and could not fetch it, so it must fall through to the human worklist. Returns how many."""
    def _d(r):
        r["lane"] = "human_only"
        if note: r["defer_note"] = note
    return _mutate(url, _d)

def _rank(rows):
    return sorted(rows, key=lambda r: (PRIORITIES.index(r.get("priority", "med")), -len(r.get("for", []))))

def drain():
    """The agent_fetchable worklist for the MAIN session to fetch + install NOW. Flags any whose
    domain is already archived (verify before fetching — principle 1)."""
    idx = _archive_index()
    pend = [r for r in _read() if r.get("status") != "resolved" and _lane(r) == "agent_fetchable"]
    print(f"== drain: {len(pend)} agent-fetchable request(s) for the main session to fetch ==\n")
    for r in _rank(pend):
        mh, dh, al = _archive_hits(r["url"], idx)
        flag = "   ‼ may already be archived — verify first" if (mh or dh or al) else ""
        print(f"  • [{r.get('priority','med')}] {r['url']}{flag}")
        if r.get("why"): print(f"      why: {r['why']}")
        if r.get("for"): print(f"      unblocks: {', '.join(r['for'])}")
        if mh: print(f"      archived files: {mh[:4]}")
        if dh: print(f"      corpus docs:    {dh[:4]}")
        print(f"      fetch → python3 install_source.py <saved> --url {r['url']} --title \"...\"   (auto-resolves)")
    if not pend:
        print("  (nothing to fetch — no agent_fetchable requests pending)")
        return
    print("\n  If the main session's own WebFetch fails on one, hand it to the human:")
    print("    python3 fetch_request.py defer --url <url> --note \"main WebFetch failed: <err>\"")

def main():
    ap = argparse.ArgumentParser(description="Fetch queue: a handoff channel for sources an agent cannot retrieve itself.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("add"); a.add_argument("--url", required=True); a.add_argument("--why", default="")
    a.add_argument("--for", dest="for_nodes", action="append", default=[], help="project::node this unblocks (repeatable)")
    a.add_argument("--priority", default="med", choices=PRIORITIES); a.add_argument("--by", default="agent")
    a.add_argument("--lane", default="agent_fetchable", choices=LANES,
                   help="agent_fetchable (main session can fetch) or human_only (no agent can reach it)")
    a.add_argument("--filename", default=None, help="suggested save filename")
    a.add_argument("--force", action="store_true", help="queue even if the domain is already archived")
    lp = sub.add_parser("list"); lp.add_argument("--all", action="store_true", help="include resolved")
    rp = sub.add_parser("resolve"); rp.add_argument("--url", required=True); rp.add_argument("--note", default=None)
    dp = sub.add_parser("defer", help="flip a request to human_only after the main session's fetch failed")
    dp.add_argument("--url", required=True); dp.add_argument("--note", default=None)
    ep = sub.add_parser("export"); ep.add_argument("--md", action="store_true"); ep.add_argument("--csv", action="store_true")
    sub.add_parser("drain", help="the agent_fetchable worklist for the main session to fetch + install")
    sub.add_parser("check", help="flag pending requests whose source may already be in the archive")
    args = ap.parse_args()

    if args.cmd == "check":
        archive_check(); return
    if args.cmd == "drain":
        drain(); return

    if args.cmd == "add":
        if _norm_url(args.url) in _archived_urls() and not args.force:  # EXACT URL already archived — definite
            print(f"⚠ NOT queued — this EXACT URL is already archived (MANIFEST/corpus/alias). "
                  f"Ground from its core; --force only to re-capture.")
            return
        mh, dh, al = _archive_hits(args.url)                 # else domain-level hint (weaker; verify content)
        if (mh or dh or al) and not args.force:
            print(f"⚠ NOT queued — {_domain(args.url)} is already in the archive; don't re-fetch it.")
            if mh: print(f"    archived files: {mh[:4]}")
            if dh: print(f"    corpus docs:    {dh[:4]}")
            print("    → find the needed figure in that core and ground from it. If you truly need a fresh")
            print("      capture, re-queue with --force.")
            return
        rec = add(args.url, args.why, args.for_nodes, args.priority, args.by, args.filename, args.lane)
        print(f"queued [{rec['priority']}/{rec.get('lane')}] {rec['url']}  (unblocks {len(rec['for'])} node(s))")
    elif args.cmd == "list":
        rows = _read()
        show = rows if args.all else [r for r in rows if r.get("status") != "resolved"]
        pend = [r for r in rows if r.get("status") != "resolved"]
        af = sum(1 for r in pend if _lane(r) == "agent_fetchable"); ho = len(pend) - af
        print(f"== fetch-queue: {len(pend)} pending ({af} agent-fetchable, {ho} human-only) / {len(rows)} total ==")
        for r in _rank(show):
            mark = "✓" if r.get("status") == "resolved" else "•"
            print(f"  {mark} [{r.get('priority','med')}/{_lane(r)}] {r['url']}")
            if r.get("why"): print(f"      why: {r['why']}")
            if r.get("for"): print(f"      unblocks: {', '.join(r['for'])}")
    elif args.cmd == "resolve":
        print(f"resolved {resolve(args.url, args.note)} request(s) for {args.url}")
    elif args.cmd == "defer":
        print(f"deferred {defer(args.url, args.note)} request(s) to human_only for {args.url}")
    elif args.cmd == "export":
        pend = _rank([r for r in _read() if r.get("status") != "resolved" and _lane(r) == "human_only"])
        if args.csv:
            w = csv.writer(sys.stdout); w.writerow(["priority", "url", "why", "unblocks", "suggested_filename"])
            for r in pend: w.writerow([r.get("priority"), r["url"], r.get("why"), ";".join(r.get("for", [])), r.get("suggested_filename") or ""])
        else:
            print(f"# Human fetch worklist — {len(pend)} source(s) no agent could reach\n")
            for r in pend:
                print(f"## [{r.get('priority','med')}] {r['url']}")
                if r.get("why"): print(f"- why: {r['why']}")
                if r.get("for"): print(f"- unblocks: {', '.join(r['for'])}")
                print(f"- after saving: `python3 install_source.py <saved-file> --url {r['url']} --title \"...\"`\n")

if __name__ == "__main__":
    main()
