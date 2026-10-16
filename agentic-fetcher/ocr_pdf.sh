#!/bin/bash
# Produce a durable, text-searchable OCR sidecar for an image-only (scanned) PDF.
#
#   ocr_pdf.sh <path/to/file.pdf> [dpi]
#
# Writes <path/to/file.pdf>.ocr.txt (page-delimited). The built-in OCR backend: macOS Vision (offline,
# on-device) via ocr.swift. Requires macOS, swiftc and pdftoppm (poppler). Vision needs its on-device
# models; a process sandbox that blocks them makes it return no text. FORECASTER_OCR_LANGS picks the
# recognition languages (see lib/ocr.mjs). Any other OCR engine plugs in through FORECASTER_OCR instead.
set -euo pipefail
pdf="${1:?usage: ocr_pdf.sh <file.pdf> [dpi]}"
dpi="${2:-200}"
here="$(cd "$(dirname "$0")" && pwd)"
bin="$here/ocrtool"

die() { echo "ocr_pdf.sh: $*" >&2; exit 1; }
[ "$(uname -s)" = "Darwin" ] || die "the built-in OCR uses macOS Vision; on $(uname -s) set FORECASTER_OCR to an OCR command instead"
command -v pdftoppm >/dev/null || die "pdftoppm not found (install poppler: brew install poppler)"
[ -f "$pdf" ] || die "no such file: $pdf"

if [ ! -x "$bin" ] || [ "$here/ocr.swift" -nt "$bin" ]; then
  command -v swiftc >/dev/null || die "swiftc not found (install the Xcode command-line tools: xcode-select --install)"
  swiftc -O "$here/ocr.swift" -o "$bin"
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/ocr_pdf.XXXXXX")"
trap 'rm -rf "$work"' EXIT
pdftoppm -png -r "$dpi" "$pdf" "$work/pg" || die "pdftoppm failed on $pdf"
shopt -s nullglob
pages=("$work"/pg-*.png)
[ "${#pages[@]}" -gt 0 ] || die "pdftoppm produced no pages for $pdf"

sidecar="${pdf}.ocr.txt"
{
  echo "# OCR sidecar for $(basename "$pdf")"
  echo "# Source PDF: $pdf (image-only scan; no embedded text layer)"
  echo "# Generated with macOS Vision (VNRecognizeTextRequest, accurate) at ${dpi} DPI."
  echo "# Pages delimited by '===== PAGE n ====='. Durable text-searchable copy for audit re-scans."
  echo
} > "$sidecar"
n=0
for png in "${pages[@]}"; do
  n=$((n+1))
  echo "===== PAGE $n =====" >> "$sidecar"
  "$bin" "$png" | sed '/^\x0c$/d' >> "$sidecar"
  echo >> "$sidecar"
done
echo "wrote $sidecar ($n pages, $(wc -c < "$sidecar") bytes)"
