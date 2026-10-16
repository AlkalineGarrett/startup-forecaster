// The "Grounding" tab: browse the grounded distribution + evidence data structured as
// project → node → (its distribution construction + the corpus items behind it). Pure nested
// <details> so drill-down needs no client JS; wireEvidenceFilter() adds a text filter.
import { DISTRIBUTIONS, type NodeDist } from "../../../montecarlo-engine/src/portfolio-context.ts";
import { CORPUS, NODE_REFS, PROJECTS, type EvItem } from "../../../montecarlo-engine/src/portfolio-context.ts";
import { esc, fmtShort } from "../../../montecarlo-engine/src/format.ts";
import { SUPPORT_HIGH, SUPPORT_MID } from "../../../montecarlo-engine/src/apply-distributions.ts";

const KIND_LABEL: Record<string, string> = { obs: "observation", gk: "general knowledge", spec: "speculation" };
/** A venture's display name (its id when it is not a modelled project). */
const projectName = (id: string): string => PROJECTS.find((p) => p.id === id)?.name ?? id;
/** "Variant · Node label" for a distribution key `project::[variant::]node`, falling back to the ids. */
function nodeName(key: string): string {
  const seg = key.split("::");
  const p = PROJECTS.find((x) => x.id === seg[0]);
  const v = seg.length > 2 ? p?.variants?.find((x) => x.id === seg[1]) : undefined;
  const nid = seg[seg.length - 1];
  const node = (v?.nodes || []).concat(p?.nodes || []).find((n) => n.id === nid);
  const unit = seg.length > 2 ? (v?.name ?? seg[1]) + " · " : "";
  return unit + (node?.label ?? nid);
}
const supportBand = (s?: number) => (s == null ? "na" : s >= SUPPORT_HIGH ? "hi" : s >= SUPPORT_MID ? "mid" : "lo");

function measureStr(m?: EvItem["measure"]): string {
  if (!m) return "";
  const u = m.unit ? " " + esc(m.unit) : "";
  if (m.value != null) return `${fmtShort(m.value)}${u}`;
  if (m.interval) return `${fmtShort(m.interval.low)}–${fmtShort(m.interval.high)}${u}`;
  if (m.quantiles) return Object.entries(m.quantiles).map(([k, v]) => `${k} ${fmtShort(v)}`).join(" · ") + u;
  return "";
}

function evItemHTML(id: string): string {
  const e = CORPUS[id];
  if (!e) return `<div class="ev-item ev-missing"><code>${esc(id)}</code> (not in corpus)</div>`;
  const src = e.url ? `<a class="ev-src" href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title || e.url)}</a>` : "";
  const ver = e.verification ? `<span class="ev-ver">${esc(e.verification)}</span>` : "";
  const meas = measureStr(e.measure);
  return (
    `<div class="ev-item ev-${esc(e.kind)}">` +
    `<div class="ev-item-h"><span class="ev-tag">${esc(KIND_LABEL[e.kind] || e.kind)}</span>` +
    `<code class="ev-cid">${esc(id)}</code>${ver}${src}</div>` +
    `<div class="ev-stmt">${esc(e.statement)}</div>` +
    (e.quote ? `<blockquote class="ev-quote">${esc(e.quote)}</blockquote>` : "") +
    (e.reasoning ? `<div class="ev-why">${esc(e.reasoning)}</div>` : "") +
    (meas ? `<div class="ev-measure">measure: ${meas}</div>` : "") +
    `</div>`
  );
}

function pctRow(p: NodeDist["pctiles"]): string {
  const cells = (["p05", "p10", "p50", "p90", "p95"] as const)
    .map((k) => `<td><span class="ev-pk">${k}</span>${p[k] == null ? "—" : fmtShort(p[k] as number)}</td>`)
    .join("");
  return `<table class="ev-pct"><tr>${cells}</tr></table>`;
}

function nodeHTML(key: string, nd: NodeDist): string {
  const label = nodeName(key);
  const refs = NODE_REFS[key] || [];
  const band = supportBand(nd.support);
  // searchable text for the filter
  const searchable = [key, label, nd.def, nd.basis, ...(refs.map((r) => CORPUS[r] && (CORPUS[r].statement + " " + (CORPUS[r].quote || ""))))]
    .filter(Boolean).join(" ").toLowerCase();
  const body =
    (nd.def ? `<div class="ev-def">${esc(nd.def)}</div>` : "") +
    `<div class="ev-meta">${nd.unit ? `unit: <b>${esc(nd.unit)}</b> · ` : ""}${nd.klabel ? `dist: <b>${esc(nd.klabel)}</b>` : ""}</div>` +
    pctRow(nd.pctiles) +
    (nd.basis ? `<div class="ev-reason">${esc(nd.basis)}</div>` : "") +
    (nd.proc && nd.proc.length ? `<ul class="ev-proc">${nd.proc.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "") +
    (nd.checks && nd.checks.length ? `<ul class="ev-checks">${nd.checks.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "") +
    (nd.recon ? `<div class="ev-recon">reconciliation: ${esc(nd.recon)}</div>` : "") +
    (refs.length
      ? `<div class="ev-evhead">Evidence · ${refs.length}</div>${refs.map(evItemHTML).join("")}`
      : `<div class="ev-noev">No corpus references (prior/derived node).</div>`);
  return (
    `<details class="ev-node" data-txt="${esc(searchable)}">` +
    `<summary><span class="ev-id">${esc(label)}</span>` +
    `<span class="ev-supp s-${band}" title="grounding support ${nd.support ?? "?"}/100">${nd.support ?? "—"}</span>` +
    (nd.d?.kind ? `<span class="ev-badge">${esc(nd.d.kind)}</span>` : "") +
    (nd.pctiles.p50 != null ? `<span class="ev-p50">p50 ${fmtShort(nd.pctiles.p50)}</span>` : "") +
    (refs.length ? `<span class="ev-nref">${refs.length} src</span>` : "") +
    `</summary><div class="ev-body">${body}</div></details>`
  );
}

export function renderEvidence(): string {
  // group node keys by project (first "::" segment), preserving DISTRIBUTIONS order
  const groups = new Map<string, string[]>();
  for (const key of Object.keys(DISTRIBUTIONS)) {
    const proj = key.split("::")[0];
    if (!groups.has(proj)) groups.set(proj, []);
    groups.get(proj)!.push(key);
  }
  const nCorpus = Object.keys(CORPUS).length;
  const nSourced = Object.values(CORPUS).filter((e) => e.kind === "obs").length;
  let html =
    `<div class="ev-wrap"><div class="ev-intro">` +
    `<h2>Grounding &amp; evidence</h2>` +
    `<p>Every model node, its distribution construction, and the corpus behind it — ${Object.keys(DISTRIBUTIONS).length} nodes across ${groups.size} projects, ${nCorpus} corpus items (${nSourced} sourced observations with verbatim quotes, the rest general-knowledge priors and flagged speculations). The <span class="ev-supp s-hi">support</span> badge is grounding strength 0–100.</p>` +
    `<input id="ev-filter" class="ev-filter" type="search" placeholder="Filter nodes by id, definition, or evidence text…" autocomplete="off">` +
    `</div>`;
  for (const [proj, keys] of groups) {
    const avg = keys.map((k) => DISTRIBUTIONS[k].support ?? 0).reduce((a, b) => a + b, 0) / keys.length;
    html +=
      `<details class="ev-proj" data-proj="${esc(proj)}">` +
      `<summary><span class="ev-proj-name">${esc(projectName(proj))}</span>` +
      `<span class="ev-proj-n">${keys.length} nodes · avg support ${Math.round(avg)}</span></summary>` +
      keys.map((k) => nodeHTML(k, DISTRIBUTIONS[k])).join("") +
      `</details>`;
  }
  return html + `</div>`;
}

/** Client-side wiring: a text filter that shows only matching nodes and opens them + their project. */
export function wireEvidenceFilter(): void {
  const input = document.getElementById("ev-filter") as HTMLInputElement | null;
  if (!input || (input as any)._wired) return;
  (input as any)._wired = true;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    const nodes = document.querySelectorAll<HTMLElement>(".ev-node");
    nodes.forEach((n) => {
      const hit = !q || (n.dataset.txt || "").includes(q);
      n.style.display = hit ? "" : "none";
      if (q && hit) n.open = true;
      else if (!q) n.open = false;
    });
    document.querySelectorAll<HTMLElement>(".ev-proj").forEach((p) => {
      const any = [...p.querySelectorAll<HTMLElement>(".ev-node")].some((n) => n.style.display !== "none");
      p.style.display = any ? "" : "none";
      if (q) p.open = any;
    });
  });
}
