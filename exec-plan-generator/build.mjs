// Render an execution-plan page from a structured data module.
//   node build.mjs <data-file.mjs> [out.html] [--fragment] [--check]
//   [out.html]   default: execution-plan-<name>.html next to the data file (data-<name>.mjs)
//   --fragment   emit only <title> + <style> + page content, for a host that supplies its own
//                <html>/<head>/<body> (default: a full HTML document)
//   --check      render but write nothing
// A new plan = a copy of data-example.mjs with your own data.
import { writeFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { resolve, dirname, join, basename } from 'path';
import { render } from './render.mjs';

const args = process.argv.slice(2);
const check = args.includes('--check');
const fragment = args.includes('--fragment');
const [arg, outArg] = args.filter((a) => !a.startsWith('--'));
if (!arg) {
  console.error('usage: exec-plan <data-file.mjs> [out.html] [--fragment] [--check]');
  process.exit(1);
}
const specPath = resolve(process.cwd(), arg);
const { default: data } = await import(pathToFileURL(specPath).href);
const html = render(data, { fragment });
const out = outArg
  ? resolve(process.cwd(), outArg)
  : join(dirname(specPath), basename(specPath).replace(/^data-/, 'execution-plan-').replace(/\.mjs$/, '.html'));
if (check) {
  console.log(`OK — ${html.length} bytes, ${data.details.length} details (not written)`);
} else {
  writeFileSync(out, html);
  console.log(`wrote ${out} (${html.length} bytes)`);
}
