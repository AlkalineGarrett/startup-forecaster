// MANIFEST.csv: the archive's byte ledger, one row per archived file. Its columns and vocabulary are
// documented in README.md ("The source archive"); every tool reads and writes them through this module.
//
//   id       <domain-slug>__<sha12>, unique per row
//   tier     the top-level folder the file is stored under. install-source writes `manual` (its default,
//            any file an agent or a person saved), `firecrawl` writes `fetched`; any other folder name is
//            allowed. `crawls` holds crawl summaries (no content hash) and `asset` page support files.
//   domain   the source host, without www.
//   title    the source's title
//   url      where it came from ("" when unknown)
//   type     what extractor reads it: see TYPES (older rows may say txt/htm/png/…; kind() maps them)
//   bytes    file size
//   copies   how many byte-identical copies the archive held when it was collapsed to this row
//   sha256   content hash (identity); "-" on a crawl summary row
//   stored   the file's path, relative to the archive root
//   origin   free text: how it was obtained (agent-install, firecrawl, a person's note, …)
//   status   installed (written by install-source) | asset (never evidence; the extractors skip it).
//            Older rows may say cited/uncited; both mean the same as installed.

export const MAN_COLS = ["id", "tier", "domain", "title", "url", "type", "bytes", "copies", "sha256", "stored", "origin", "status"];

/** The `type` values install-source writes. */
export const TYPES = ["html", "pdf", "text", "json", "xlsx", "gz", "image"];

/** File extensions read as plain text, and as images (through OCR). */
export const TEXT_EXT = ["txt", "md", "csv", "tsv"];
export const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "gif", "tif", "tiff", "bmp"];

const ALIASES = {
  htm: "html",
  ...Object.fromEntries(TEXT_EXT.map((e) => [e, "text"])),
  ...Object.fromEntries(IMAGE_EXT.map((e) => [e, "image"])),
};

/** A row's `type` normalised to one of TYPES (or itself when it is something else, e.g. `crawl`). */
export function kind(type) {
  const t = String(type ?? "").trim().toLowerCase();
  return ALIASES[t] ?? t;
}

/** A row that is never evidence: a page's support asset. */
export const isAsset = (row) => String(row.status ?? "").trim() === "asset";
