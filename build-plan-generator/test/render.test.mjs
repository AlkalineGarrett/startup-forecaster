// node --test test/render.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderPage } from '../render.mjs';
import * as spec from '../example.mjs';

const css = readFileSync(new URL('../build-plan.css', import.meta.url), 'utf8');
const page = (opts) => renderPage({ META: spec.META, STEPS: spec.STEPS, SOURCES: spec.SOURCES }, css, opts);

test('renders a full HTML document by default', () => {
  const html = page();
  assert.match(html, /^<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">/);
  assert.match(html, /<title>Habit Tracker — Build Plan \(example\)<\/title>/);
  assert.match(html, /<\/head>\n<body>\n<header>/);
  assert.match(html, /<\/body>\n<\/html>\n$/);
});

test('--fragment output has no document wrapper', () => {
  const html = page({ fragment: true });
  assert.match(html, /^<title>/);
  assert.ok(!/<!doctype|<html|<head>|<body/i.test(html));
});

test('every class the example emits for variants, chips and the self badge has a CSS rule', () => {
  const html = page();
  for (const sel of ['.step.foundation', '.step.featured', '.step-tag', '.fchip.new', '.fchip.extend', '.ftg.extend', 'tr.extend', '.pb.self', '.compet.m'])
    assert.ok(css.includes(sel), `css has ${sel}`);
  for (const frag of ['class="step foundation"', 'class="step featured"', 'class="step-tag"', 'class="fchip extend"', 'class="ftg extend"', '<tr class="extend">', 'class="pb self"', 'class="compet m"'])
    assert.ok(html.includes(frag), `page has ${frag}`);
});
