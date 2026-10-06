// Every element the page's code asks for by a literal id is one the page can render.
//
// 🛑 2026-10-06: the Opportunity Buys "Upload manifest" button did nothing for two weeks.
// obReplaceManifest began `if (!input || !note) return;` with `note = el('ob-m-note')`, and
// no markup anywhere ever rendered #ob-m-note — so every click returned before sending a
// byte, and said nothing. Brian reported it as "my CSV upload isn't uploading".
//
// A lookup by id that can never succeed is invisible to every behavioural test that does not
// click that exact control. This reads the source instead: each literal el('x') or
// getElementById('x') must have a literal id="x" (or `.id = 'x'`) somewhere in index.html.
// An id built by a helper — sel('sr-f-store', …), `ir-f-${f.k}` — cannot be matched by a
// regex, so those are listed below by name, each with where it is built.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

// Built by a helper, so never written as id="…" literally.
const BUILT = {
  'sr-f-store': 'srRenderAllFilters: sel(id, …) writes id="${id}"',
  'sr-f-status': 'srRenderAllFilters: sel(id, …)',
  'sr-f-pri': 'srRenderAllFilters: sel(id, …)',
  'ir-f-bol_no': 'the Inventory Receiver form: id="ir-f-${f.k}" over its field list',
};

console.log('Element ids');
const refs = new Set([...src.matchAll(/(?:\bel|getElementById)\(\s*['"]([A-Za-z0-9_-]+)['"]\s*\)/g)].map(m => m[1]));
const defined = new Set([
  ...[...src.matchAll(/\bid\s*=\s*\\?["']([A-Za-z0-9_-]+)\\?["']/g)].map(m => m[1]),
  ...[...src.matchAll(/\.id\s*=\s*['"]([A-Za-z0-9_-]+)['"]/g)].map(m => m[1]),
]);
ok(refs.size > 500, `the scan found the page's lookups (${refs.size})`);
ok(refs.has('ob-m-note') && defined.has('ob-m-note'), '🛑 #ob-m-note, the one that broke, is both asked for and rendered');
for (const id of refs) {
  if (BUILT[id]) { ok(src.includes(`'${id}'`), `${id} is still referenced (else drop it from BUILT)`); continue; }
  ok(defined.has(id), `el('${id}') is asked for, but nothing renders an element with that id`);
}
for (const id of Object.keys(BUILT)) ok(!defined.has(id), `${id} is now written literally — drop it from BUILT`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
