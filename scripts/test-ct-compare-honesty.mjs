// Two ways the Categories comparison could mislead without saying so.
//
// 1. THE CONTROL THAT PROMISED A SWAP. The pin toggle beside the comparison chip was
//    labelled ⇄ — the universal SWAP icon — on a button that pins. It invited exactly
//    the click it does not perform, and the state it leaves behind (a comparison range
//    that no longer follows the one you are showing) is invisible until the numbers
//    look wrong. It is text now, like the "Match length" button beside it.
//
// 2. A RANGE COMPARED AGAINST ITSELF. Pin B onto A's dates and every row reads 0.0%,
//    while the comparison series draws exactly under the current one so it cannot even
//    be seen. The panel was saying nothing and looking like it was saying something.
//    Every other way this status line can mislead is already called out in it — short
//    history, part-covered end buckets, unequal lengths, a rolling fallback. This was
//    the gap, and it is the one a person actually hit.
//
// Asserts the source, not the layout — a browser is not in this repo's test deps. The
// browser run that proved it: the button reads "Pinned" with the tooltip flipping on
// state, pinning B onto A's dates raises the warning in both themes, and unpinning
// clears it and moves B back off A.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');

console.log('\n── Categories · comparison honesty ──');

// 1. The pin control.
const bctl = html.slice(html.indexOf("const bctl = el('ct-bctl');"), html.indexOf("ctPillGroup(el('ct-rule')"));
ok(bctl.length > 200, 'found the comparison-chip controls');
ok(/pin\.textContent = 'Pinned';/.test(bctl), 'the pin toggle is labelled in words');
ok(!/pin\.textContent = '⇄'/.test(bctl), 'and no longer wears a swap arrow');
ok(/aria-pressed', String\(ctBPinned\)/.test(bctl), 'its pressed state still tracks ctBPinned');
ok(/stays where you put it/.test(bctl) && /Following the range you are showing/.test(bctl),
  'the tooltip describes BOTH states, so either one explains itself');
// The swap glyph must not come back anywhere in the control surface. Comments are
// stripped first: one of them NAMES the glyph to explain why it went, and matching that
// prose would make this assertion permanently red for the wrong reason.
const bar = html.slice(html.indexOf('function ctBuildControls'), html.indexOf('function ctDrawStatus'))
  .replace(/\/\/[^\n]*/g, '');
ok(!/⇄/.test(bar), 'no swap glyph in any rendered markup in the Categories control bar');

// 2. The identical-range warning.
const status = html.slice(html.indexOf('function ctDrawStatus'), html.indexOf("el('ct-status').innerHTML = t;"));
ok(/if \(a\.from === b\.from && a\.to === b\.to\)/.test(status),
  'the status compares the two ranges by DATE, not by whether B is pinned');
ok(/Both ranges are the same dates/.test(status), 'and says so plainly');
ok(/every change reads 0\.0%/.test(status), 'naming the symptom a person would actually notice');
ok(/draws hidden under the current one/.test(status),
  'and why the comparison line cannot be seen — otherwise it reads as a missing series');
ok(/unpin it beside the chip/.test(status), 'it says how to undo it');
ok(/ctBPinned\s*\n?\s*\?\s*` The comparison range is <b>pinned<\/b>/.test(status)
   || /ctBPinned[\s\S]{0,80}pinned<\/b>/.test(status),
  'and names the pin as the cause only when the pin IS the cause');

// It must sit with the other warnings, not replace one.
for (const other of ['The two ranges are different lengths', 'nothing to compare against', 'part-covered']) {
  ok(status.includes(other), `the existing warning "${other.slice(0, 32)}…" still fires`);
}
ok(status.indexOf('Both ranges are the same dates') < status.indexOf('The two ranges are different lengths'),
  'identical dates is reported FIRST — it subsumes every other reading of the chart');

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
