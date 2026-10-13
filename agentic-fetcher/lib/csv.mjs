// CSV for MANIFEST.csv, url-aliases.csv and `fetch_request export --csv`.
//
// Reading is RFC 4180 (quoted fields may hold commas, quotes as "" and newlines). Writing keeps the
// format MANIFEST.csv has always had: a field is quoted only when it contains a comma, a quote, a CR
// or an LF, and every row ends in \r\n — so appended rows match the existing ones.
import { readText } from "./util.mjs";

/** The rows of a CSV text, each an array of strings. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", i = 0, quoted = false;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false;
      } else field += c;
      i++;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      row.push(field); field = "";
      rows.push(row); row = [];
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else field += c;
    i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));   // blank lines are not rows
}

/** Records keyed by the header row; a short row's missing fields are null. */
export function parseCsvRecords(text) {
  const [names, ...rows] = parseCsv(text);
  if (!names) return [];
  return rows.map((r) => Object.fromEntries(names.map((n, i) => [n, r[i] ?? null])));
}

/** The records of a CSV file. */
export const readCsvFile = (path) => parseCsvRecords(readText(path));

/** One CSV row (ending \r\n): fields quoted only when they need it; null/undefined → empty. */
export function writerow(fields) {
  const out = fields.map((f) => {
    const s = f === null || f === undefined ? "" : String(f);
    return /[,"\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  });
  const rec = out.join(",");
  return (out.length && rec === "" ? '""' : rec) + "\r\n";   // a lone empty field is written quoted
}

/** A row of `obj`'s values in `fieldnames` order (missing → empty). Unknown keys are an error. */
export function writeRecord(fieldnames, obj) {
  const wrong = Object.keys(obj).filter((k) => !fieldnames.includes(k));
  if (wrong.length) throw new Error(`record has fields not in the header: ${wrong.join(", ")}`);
  return writerow(fieldnames.map((k) => obj[k] ?? ""));
}
