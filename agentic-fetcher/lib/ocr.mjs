// OCR: turn a scanned PDF or an image into text, through one pluggable backend.
//
//   FORECASTER_OCR       a command that takes one file path (a PDF or an image) and prints its text on
//                        stdout; a non-zero exit is a failure. It runs through `sh -c`, so it may carry its
//                        own arguments, e.g. FORECASTER_OCR="my-ocr --lang eng" runs `my-ocr --lang eng <file>`.
//                        Set it to use any OCR engine (a wrapper around ocrmypdf or tesseract, a cloud API).
//   (unset, macOS)       the built-in backend: macOS Vision, offline. A PDF is rasterised with `pdftoppm`
//                        (poppler) by ocr_pdf.sh; each image goes through `ocrtool`, compiled from ocr.swift
//                        with `swiftc` on first use. Vision needs its on-device models; a process sandbox that
//                        blocks them makes it return nothing.
//   (unset, elsewhere)   no backend: anything that needs OCR stops with a message saying so.
//
//   FORECASTER_OCR_LANGS  the built-in backend's recognition languages, comma-separated BCP-47 codes
//                        (e.g. "en-US,pt-PT"). Unset: Vision detects the language itself.
import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Exit, decode, readText, which } from "./util.mjs";

const TOOL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SWIFT = join(TOOL_DIR, "ocr.swift");
export const OCR_PDF = join(TOOL_DIR, "ocr_pdf.sh");

const NEED_BACKEND = "Set FORECASTER_OCR to a command that takes a PDF or image path and prints its text " +
  "(for example a small script around ocrmypdf or tesseract). The built-in OCR uses macOS Vision and only runs on macOS.";

const executable = (p) => {
  try { accessSync(p, constants.X_OK); return true; } catch { return false; }
};

/** The Vision binary beside this tool, compiled from ocr.swift when it is missing or older than the source. */
export function ocrtool() {
  const binary = join(TOOL_DIR, "ocrtool");
  const fresh = executable(binary) && (!existsSync(SWIFT) || statSync(binary).mtimeMs >= statSync(SWIFT).mtimeMs);
  if (fresh) return binary;
  if (!which("swiftc")) {
    throw new Exit("the built-in OCR needs `swiftc` to build its Vision helper (install the Xcode command-line " +
      `tools: xcode-select --install). ${NEED_BACKEND}`);
  }
  const r = spawnSync("swiftc", ["-O", SWIFT, "-o", binary], { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) throw new Exit(`swiftc failed to build ${binary} (${r.status ?? r.error?.message})`);
  return binary;
}

function runCapture(cmd, args, timeout) {
  const r = spawnSync(cmd, args, { maxBuffer: 2 ** 31 - 1, timeout: timeout * 1000 });
  if (r.error) throw new Error(r.error.code === "ETIMEDOUT" ? `timed out after ${timeout}s` : r.error.message);
  const err = decode(r.stderr || Buffer.alloc(0), "replace").trim();
  if (r.status !== 0) throw new Error(`exited ${r.status ?? r.signal}${err ? `: ${err.slice(0, 300)}` : ""}`);
  return { out: decode(r.stdout, "replace").replace(/\r\n?/g, "\n"), err };
}

/**
 * The OCR backend for `kind` ("pdf" or "image"): { name, ocr(path, timeoutSeconds) → text }. `ocr` throws
 * an Error when the engine fails on a file. Throws Exit (naming what is missing) when no backend can run here.
 */
export function ocrBackend(kind = "pdf") {
  const custom = (process.env.FORECASTER_OCR || "").trim();
  if (custom) {
    return {
      name: `FORECASTER_OCR (${custom})`,
      ocr: (path, timeout = 600) => runCapture("sh", ["-c", `${custom} "$1"`, "sh", path], timeout).out,
    };
  }
  if (process.platform !== "darwin") throw new Exit(`no OCR backend on ${process.platform}. ${NEED_BACKEND}`);
  if (kind === "pdf") {
    if (!which("pdftoppm")) {
      throw new Exit("the built-in OCR needs `pdftoppm` to rasterise a PDF (poppler: brew install poppler). " + NEED_BACKEND);
    }
    ocrtool();                                                   // build it now, so a missing swiftc is reported here
    return {
      name: "macOS Vision",
      ocr: (path, timeout = 600) => {
        runCapture(OCR_PDF, [path], timeout);                    // writes <path>.ocr.txt (page-delimited)
        return readText(`${path}.ocr.txt`, "replace");
      },
    };
  }
  const bin = ocrtool();
  return {
    name: "macOS Vision",
    ocr: (path, timeout = 300) => {
      const { out, err } = runCapture(bin, [path], timeout);
      if (/^FAILED-/m.test(err)) throw new Error(err.split("\n")[0]);
      return out.replace(/\f/g, "").trim();
    },
  };
}
