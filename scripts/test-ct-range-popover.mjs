// Placement invariant for the Categories tab's range popover (#ct-pop).
//
// 🛑 THIS SHIPPED BROKEN: the Apply button was not reachable at any laptop
// height. Placement guessed the popover's height once, at open time:
//
//     top = Math.min(box.bottom + 6, Math.max(8, innerHeight - 430))
//
// The 430 assumed a 430px box. The real one is ~861px of content — a preset
// list plus TWO stacked month grids plus the footer — clamped by a CSS
// `max-height: 86vh`. Measured on the real page, chip A open:
//
//     viewport     box top   box bottom   Apply at    on screen?
//     1440x900       226        1000      1045-1075       no
//     1512x820       226         931       887- 917       no   ← and NO
//     1280x1000      268        1128      1087-1117       no      scroll
//     1400x1400      226        1090      1045-1075      yes      position
//                                                                 reveals it
//
// Two faults compound. The box itself hangs off the bottom of the screen, so
// 86vh measured from a top of 226px is not a viewport clamp at all; and the
// footer is the LAST thing in a scrolling column, so its position depends on
// scrollTop — which ctRenderPop() resets to 0 on every single date click,
// because it replaces innerHTML. At 1512x820 the footer sat at 878-925 with
// the viewport ending at 820 even when scrolled fully to the end.
//
// The fix is to measure instead of guess: ctPlacePop() runs after every render
// (height changes with the month grids and with every pick), sizes the box from
// the room that actually exists below — or above — the chip, and clamps it to
// the viewport in both directions. The footer is sticky so Apply survives any
// scroll position, and the scroll position now survives the re-render.
//
// This asserts the source, not the layout — a browser is not in this repo's
// test deps. The browser run that proved it: Apply inside the viewport and
// hit-testable at 1440x900, 1512x820, 1280x1000, 1440x700, 390x844 and
// 1400x1400, for both the "showing" and the "compared with" chip.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const fnSrc = (name, next) => {
  const from = html.indexOf(`  function ${name}(`);
  const to = html.indexOf(`  function ${next}(`, from + 1);
  ok(from > 0 && to > from, `found ${name} in index.html`);
  return html.slice(from, to);
};

console.log('\n── Categories range popover · placement ──');

const open  = fnSrc('ctOpenRange', 'ctPlacePop');
const place = fnSrc('ctPlacePop', 'ctRenderPop');
const rend  = fnSrc('ctRenderPop', 'ctCalNav');

// 1. The height is measured, never assumed.
ok(!/innerHeight\s*-\s*\d/.test(open + rend),
  'no hard-coded height guess subtracted from innerHeight (that was the 430)');
ok(!/innerWidth\s*-\s*\d{2,}/.test(open),
  'no hard-coded width guess either (that was the 320)');
ok(/pop\.scrollHeight/.test(place),
  'ctPlacePop reads the rendered height rather than assuming one');
ok(/pop\.offsetWidth/.test(place),
  'and the rendered width, for the left clamp');

// 2. It runs after EVERY render, not once at open — the grids change height.
ok(/ctPlacePop\(\);/.test(rend),
  'ctRenderPop places the popover after writing its innerHTML');
ok(!/style\.top\s*=/.test(open),
  'ctOpenRange no longer positions the popover itself');
ok(/ctPopBox\s*=\s*ev\.currentTarget\.getBoundingClientRect\(\)/.test(open),
  'ctOpenRange records the chip rect for ctPlacePop to anchor against');

// 3. The box is clamped to the viewport in BOTH directions. A one-sided clamp
//    is what let it hang off the bottom in the first place.
ok(/Math\.max\(M,\s*Math\.min\(/.test(place),
  'the top is clamped against both screen edges, not just one');
ok(/window\.innerHeight - M - h/.test(place),
  'and the bottom clamp uses the real height, so the box cannot overhang');
ok(/down\s*=\s*below\s*>=\s*above/.test(place),
  'it flips above the chip when there is more room there');

// 4. Apply must not depend on scroll position.
const css = html.slice(html.indexOf('#ct-pop{'), html.indexOf('.ct-ctl[hidden]'));
ok(/\.ct-popfoot\{[^}]*position:sticky/.test(css),
  'the footer carrying Apply is sticky');
ok(/\.ct-popfoot\{[^}]*bottom:0/.test(css),
  'pinned to the bottom of the scrollport');
ok(/\.ct-popfoot\{[^}]*background:#ffffff/.test(css),
  'opaque in light theme — it overlays scrolled content');
ok(/\.dark \.ct-popfoot\{[^}]*background:rgb\(var\(--op-panel\)\)/.test(css),
  'and opaque in dark theme');

// 5. No CSS max-height: 86vh measured from a top of 226px is not a clamp.
ok(!/#ct-pop\{[^}]*max-height/.test(css),
  '#ct-pop has no CSS max-height — ctPlacePop sets the real one inline');
ok(/#ct-pop\{[^}]*overflow-y:auto/.test(css),
  'but it still scrolls when the content exceeds the room');

// 6. Picking a date must not yank the popover back to the top.
ok(/const keepScroll = pop\.scrollTop/.test(rend),
  'ctRenderPop captures scrollTop before replacing innerHTML');
ok(rend.indexOf('pop.scrollTop = keepScroll') > rend.indexOf('ctPlacePop();'),
  'and restores it AFTER ctPlacePop sizes the scrollport (before, it clamps to 0)');

// 7. The footer says the pick registered, like both sibling pickers do.
ok(/now pick end/.test(rend),
  'the footer confirms a start-only pick, matching the two other range pickers');

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
