// Render an execution-plan artifact from a structured data module.
//   node build.mjs [data-file.mjs] [out.html]
// Defaults to the fictional example. A new plan = a copy of data-example.mjs with your own data.
import { writeFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { resolve, dirname, join, basename } from 'path';
import { render } from './render.mjs';

const arg = process.argv[2] || './data-example.mjs';
const check = process.argv.includes('--check');
const specPath = resolve(process.cwd(), arg);
const { default: data } = await import(pathToFileURL(specPath).href);
const html = render(data);
const out = process.argv[3] && !process.argv[3].startsWith('--')
  ? resolve(process.cwd(), process.argv[3])
  : join(dirname(specPath), basename(specPath).replace(/^data-/, 'execution-plan-').replace(/\.mjs$/, '.html'));
if (check) {
  console.log(`OK — ${html.length} bytes, ${data.details.length} details (not written)`);
} else {
  writeFileSync(out, html);
  console.log(`wrote ${out} (${html.length} bytes)`);
}
