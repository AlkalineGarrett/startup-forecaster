// What an evidence reference looks like, and what the corpus holds: one definition, shared by the compiler,
// the engine and the agentic-fetcher. Observation ids carry many prefixes (obs_, ret_, rate_, aud_, …), so a
// token is a reference only when it is an id the corpus actually holds; ID_RE finds the candidate tokens.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ID_RE = /\b[A-Za-z][A-Za-z0-9_]*\b/g;

/** The corpus ids among the identifier tokens of `text` (a Set, in first-seen order). */
export function idsIn(text, isId) {
  const out = new Set();
  for (const tok of text.match(ID_RE) || []) if (isId(tok)) out.add(tok);
  return out;
}

/** The corpus files of a distribution-data project (under its corpus/), with the kind of entry each holds. */
export const CORPUS_FILES = [["obs", "observations.json"], ["gk", "general-knowledge.json"], ["spec", "speculations.json"]];

/** The three corpus maps of a corpus/ folder: { obs, gk, spec } (id → entry). A file the project doesn't have
 *  yet is empty. `parse` reads the text (JSON.parse; agentic-fetcher passes its key-order-keeping loads). */
export function readCorpus(corpusDir, parse = JSON.parse) {
  const out = {};
  for (const [kind, file] of CORPUS_FILES) {
    const p = join(corpusDir, file);
    out[kind] = existsSync(p) ? parse(readFileSync(p, "utf8")) : {};
  }
  return out;
}

/** A placeholder: the labelled, unresearched prior a startup-forecaster preset seeds (`spec_<venture>_<node>_placeholder`,
 *  forecaster/lib/portfolio.mjs placeholderSpec). The corpus has no explicit field for it, so the naming rule
 *  decides — here only. */
const isPlaceholder = (id) => id.endsWith("_placeholder");

/** The corpus as one index: id → { kind: "obs" | "gk" | "spec", entry, placeholder }. `from` is a
 *  distribution-data project (its corpus/ is read) or the maps readCorpus returns. An id held by more than one
 *  file keeps its first (observations, then general knowledge, then speculations). */
export function corpusIndex(from) {
  const maps = typeof from === "string" ? readCorpus(join(from, "corpus")) : from;
  const index = new Map();
  for (const [kind] of CORPUS_FILES) {
    for (const [id, entry] of Object.entries(maps[kind] || {})) {
      if (!index.has(id)) index.set(id, { kind, entry, placeholder: isPlaceholder(id) });
    }
  }
  return index;
}
