// node --test test/render.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../render.mjs';
import example from '../data-example.mjs';

test('renders a full HTML document by default', () => {
  const html = render(example);
  assert.match(html, /^<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">/);
  assert.match(html, /<\/head>\n<body>\n<div class="wrap">/);
  assert.match(html, /<\/body>\n<\/html>\n$/);
});

test('--fragment output has no document wrapper', () => {
  const html = render(example, { fragment: true });
  assert.match(html, /^<title>/);
  assert.ok(!/<!doctype|<html|<head>|<body/i.test(html));
});

test('a gate spans exactly the plan\'s columns', () => {
  for (const n of [2, 3]) {
    const data = { ...example, columns: example.columns.concat({ key: 'extra', head: 'Extra', sub: '' }).slice(0, n) };
    const spans = [...render(data).matchAll(/<tr class="gaterow"><td><\/td><td colspan="(\d+)">/g)].map((m) => Number(m[1]));
    assert.ok(spans.length > 0);
    assert.deepEqual([...new Set(spans)], [n]);
  }
});

test('free-form column keys map to palette slots by position', () => {
  const html = render(example);
  assert.ok(html.includes('<th class="h-b">Build') && html.includes('<th class="h-o">Distribution'));
  assert.ok(html.includes('<td class="c-b">') && html.includes('<td class="c-o">'));
  assert.ok(html.includes('class="det edge-b" id="d-b1"') && html.includes('class="det edge-o" id="d-o1"'));
  assert.ok(html.includes('class="det gate edge-d" id="d-g1"'));
  assert.throws(() => render({ ...example, columns: [...example.columns, ...example.columns] }), /at most 3 columns/);
});
