// HTML for core extraction: entity decoding (the full HTML5 table) and a small tag tokenizer.
//
// The tokenizer is deliberately simple. It yields start tags (lowercased name, attributes, whether
// self-closing), end tags, and text with entities decoded; script/style bodies come through raw.
// Comments, doctypes and processing instructions are skipped. A "<" that does not open a tag is text.
// Unterminated constructs at the end of the input (an open comment, a tag with no ">") end the text.
import { HTML5, INVALID_CHARREFS, INVALID_CODEPOINTS } from "./html5entities.mjs";

const CHARREF = /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[^\t\n\f <&#;]{1,32};?)/gu;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function replaceCharref(_m, s) {
  if (s[0] === "#") {
    const num = /^#[xX]/.test(s) ? parseInt(s.slice(2), 16) : parseInt(s.slice(1), 10);
    if (has(INVALID_CHARREFS, String(num))) return INVALID_CHARREFS[String(num)];
    if ((num >= 0xd800 && num <= 0xdfff) || num > 0x10ffff) return "�";
    if (INVALID_CODEPOINTS.has(num)) return "";
    return String.fromCodePoint(num);
  }
  if (has(HTML5, s)) return HTML5[s];
  for (let x = s.length - 1; x > 1; x--) {                 // the longest name that prefixes it ("&ampx")
    if (has(HTML5, s.slice(0, x))) return HTML5[s.slice(0, x)] + s.slice(x);
  }
  return "&" + s;
}

/** Decode named and numeric character references, by the HTML5 rules. */
export function unescape(s) {
  return s.includes("&") ? s.replace(CHARREF, replaceCharref) : s;
}

// a quoted attribute value (right after "=") may contain ">"; any other quote is a plain character
const START = /<([a-zA-Z][^\s/>\0]*)((?:=\s*"[^"]*"|=\s*'[^']*'|[^>])*?)>/y;
const END = /<\/([a-zA-Z][^\s/>\0]*)[^>]*>/y;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?/g;
const RAW = new Set(["script", "style"]);

function attrs(text) {
  const out = [];
  for (const m of text.matchAll(ATTR)) {
    let v = m[2] ?? null;
    if (v !== null && /^(["']).*\1$/s.test(v)) v = v.slice(1, -1);
    out.push([m[1].toLowerCase(), v === null ? null : unescape(v)]);
  }
  return out;
}

/** The tokens of an HTML text: { type: "start", tag, attrs, selfClosing } | { type: "end", tag } |
 * { type: "data", text }. */
export function* tokens(html) {
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) { yield { type: "data", text: unescape(html.slice(i)) }; return; }
    if (lt > i) yield { type: "data", text: unescape(html.slice(i, lt)) };
    i = lt;
    if (html.startsWith("<!--", i)) {
      const e = html.indexOf("-->", i + 4);
      if (e < 0) return;
      i = e + 3;
      continue;
    }
    if (html.startsWith("<!", i) || html.startsWith("<?", i)) {
      const e = html.indexOf(">", i);
      if (e < 0) return;
      i = e + 1;
      continue;
    }
    END.lastIndex = i;
    let m = END.exec(html);
    if (m) { yield { type: "end", tag: m[1].toLowerCase() }; i = END.lastIndex; continue; }
    START.lastIndex = i;
    m = START.exec(html);
    if (m) {
      const tag = m[1].toLowerCase();
      const selfClosing = /\/\s*$/.test(m[2]);
      yield { type: "start", tag, attrs: attrs(m[2].replace(/\/\s*$/, "")), selfClosing };
      i = START.lastIndex;
      if (RAW.has(tag) && !selfClosing) {                  // script/style: raw text up to the close tag
        const close = new RegExp(`</${tag}\\s*>`, "ig");
        close.lastIndex = i;
        const c = close.exec(html);
        const end = c ? c.index : html.length;
        if (end > i) yield { type: "data", text: html.slice(i, end) };
        if (!c) return;
        yield { type: "end", tag };
        i = close.lastIndex;
      }
      continue;
    }
    if (/^<\/?[a-zA-Z]/.test(html.slice(i, i + 3))) return;   // a tag with no ">": the rest is unparsed
    yield { type: "data", text: "<" };
    i++;
  }
}
