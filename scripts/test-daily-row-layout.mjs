// Layout invariant for the Daily Breakdown row — both copies of it.
//
// The row's middle column puts the day's sales figure and its "vs $budget" on
// one flex line. The budget span is `whitespace-nowrap` so it never shrinks;
// the sales div carries `min-w-0` so it does — below its own content width.
// With `flex-wrap: nowrap` the figure then overflows its box and paints on top
// of the budget. Measured on the real markup against the built stylesheet,
// Coliseum's week of 2026-08-16:
//
//     360px   7 of 7 rows overlap, worst 57px
//     390px   7 of 7 rows overlap, worst 27px
//     414px   2 of 7 rows overlap, worst  3px
//     900px   clean
//
// Letting the line wrap drops the budget onto its own line instead of squeezing
// the figure, so no number is ever truncated or painted over. Nothing wraps at
// desktop width, so the change is invisible there.
//
// This asserts the markup, not the layout — a browser is not in this repo's test
// deps. The cheap wrong version is a row that looks fine on a laptop and prints
// two overlapping numbers on every phone, which is how it shipped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const fnSrc = (name, next) => {
  const from = html.indexOf(`  function ${name}(`);
  const to = html.indexOf(`  function ${next}(`, from + 1);
  ok(from > 0 && to > from, `found ${name} in index.html`);
  return html.slice(from, to);
};

console.log('\n── Daily Breakdown row · sales / budget line ──');

// Both renderers of this row: the per-store Daily tab and the All Stores one.
const surfaces = [
  ['buildWeeklyTable', 'buildAllStoresWeeklyTable', 'store detail → Daily'],
  ['buildAllStoresWeeklyTable', 'buildAllStoresList', 'All Stores → Daily'],
];

for (const [name, next, label] of surfaces) {
  const src = fnSrc(name, next);

  // The line that holds the figure and its budget.
  const lines = [...src.matchAll(/<div class="flex[^"]*justify-between[^"]*">\s*\n\s*<div class="flex items-center min-w-0">/g)];
  eq(lines.length, 1, `${label}: exactly one sales/budget line`);
  const line = lines[0]?.[0] ?? '';

  ok(/\bflex-wrap\b/.test(line), `${label}: the line wraps rather than squeezing the figure`);
  ok(!/class="flex items-center justify-between gap-2"/.test(line),
    `${label}: the old nowrap line is gone`);

  // Horizontal spacing must be what desktop already had, or this "fix" is also
  // a silent restyle of every row at every width.
  ok(/\bgap-x-2\b/.test(line), `${label}: keeps the 8px horizontal gap desktop shipped with`);

  // The two halves that create the squeeze must both still be present — if
  // either changes, the reasoning above stops applying and this test is stale.
  ok(src.includes('<div class="flex items-center min-w-0">'),
    `${label}: the figure still sits in a min-w-0 box`);
  ok(/vs <b class="text-opl-ink dark:text-op-ink font-semibold">/.test(src),
    `${label}: the budget is still the nowrap half of the pair`);
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
