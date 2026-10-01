#!/bin/bash
# Produce a durable, text-searchable OCR sidecar for an image-only (scanned) PDF.
#
#   ocr_pdf.sh <path/to/file.pdf> [dpi]
#
# Writes <path/to/file.pdf>.ocr.txt (page-delimited). Uses the macOS Vision
# framework (offline, on-device) via ocr.swift — no external OCR install.
# Requires: swiftc, pdftoppm (poppler). Run OUTSIDE a restrictive sandbox (Vision
# needs on-device model access).
set -euo pipefail
pdf="${1:?usage: ocr_pdf.sh <file.pdf> [dpi]}"
dpi="${2:-200}"
here="$(cd "$(dirname "$0")" && pwd)"
bin="$here/ocrtool"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

[ -x "$bin" ] || swiftc -O "$here/ocr.swift" -o "$bin"

pdftoppm -png -r "$dpi" "$pdf" "$work/pg" >/dev/null 2>&1
sidecar="${pdf}.ocr.txt"
{
  echo "# OCR sidecar for $(basename "$pdf")"
  echo "# Source PDF: $pdf (image-only scan; no embedded text layer)"
  echo "# Generated with macOS Vision (VNRecognizeTextRequest, accurate) at ${dpi} DPI."
  echo "# Pages delimited by '===== PAGE n ====='. Durable text-searchable copy for audit re-scans."
  echo
} > "$sidecar"
n=0
for png in "$work"/pg-*.png; do
  n=$((n+1))
  echo "===== PAGE $n =====" >> "$sidecar"
  "$bin" "$png" 2>/dev/null | sed '/^\x0c$/d' >> "$sidecar"
  echo >> "$sidecar"
done
echo "wrote $sidecar ($n pages, $(wc -c < "$sidecar") bytes)"
