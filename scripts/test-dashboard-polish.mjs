// The Dashboard's polish pass (unslop, 2026-11-04), pinned in the markup.
//
// Brian approved one direction for the Dashboard: colour only where it means something
// (pace green / amber / red, the channel bar, the main actions), every other tile neutral,
// sentence-case labels with no wide tracking, nothing under 11px, figures at weight 600 at
// most, and no motion that loops or nudges for no reason. DESIGN.md §2.2, §2.3, §2.4, §4.1, §4.3
// and §4.6 describe the result.
//
// Each of these was the state on main before the pass, so every assertion below fails there:
//   - a radial accent wash behind the hero card
//   - an `animate-ping` halo on the "last updated" dot, looping whether or not data is fresh
//   - Cart / Items / Orders / ASP tiles in accent-green fill, green label, 7% watermark icon,
//     on the hero AND on every store card, so the one green that matters (pace) did not lead
//   - uppercase tracked labels, 10 / 10.5 / 11.5px text, font-bold and font-extrabold figures
//   - View Details sliding right whenever the card is hovered
//
// This asserts the markup, not the pixels: a browser is not in this repo's test deps.
// scripts/browser-live-sales-label.mjs renders the cards in both themes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const slice = (from, to, name) => {
  const a = html.indexOf(from), b = a < 0 ? -1 : html.indexOf(to, a + 1);
  ok(a > 0 && b > a, `found ${name} in index.html`);
  return a > 0 && b > a ? html.slice(a, b) : '';
};

const page = slice('<div id="page-dashboard">', '<!-- end #page-dashboard -->', 'the dashboard page');
const card = slice('const tile = (l, v, lySlot) =>', 'container.appendChild(div);', 'the store-card template');
const both = [['the dashboard page', page], ['the store-card template', card]];

console.log('\n── Dashboard · colour only where it means something ──');
ok(!/radial-gradient/.test(page), 'the hero card has no radial accent wash');
for (const [n, s] of both) {
  ok(!/accent-green\/(10|20)/.test(s), `${n}: no accent-green tinted tile`);
  ok(!/matrixTileWatermark/.test(s), `${n}: no watermark icon in the Cart / Items / Orders / ASP tiles`);
}
ok(/<div id="mx-cart" class="mt-1 text-sm font-semibold tabular-nums text-opl-ink dark:text-op-ink">/.test(page),
  "the hero's Cart tile keeps its id and reads in the ink colour");
ok((card.match(/data-mx="\$\{key\}"/g) || []).length === 1 && (card.match(/mtile\('/g) || []).length === 4,
  'the card tiles keep their data-mx hooks (the channel filter repaints them by it)');
ok(!/text-opl-inkDimmer|text-op-inkDimmer/.test(page), 'no inkDimmer text on the page (it is a border colour)');

console.log('\n── Dashboard · type ──');
for (const [n, s] of both) {
  ok(!/font-(extra)?bold/.test(s), `${n}: weights stop at 600`);
  ok(!/tracking-\[/.test(s), `${n}: no wide-tracked labels`);
  ok(!/text-\[(10|10\.5|11\.5|9\.5)px\]/.test(s), `${n}: nothing under 11px, no half-pixel sizes`);
}
ok((page.match(/\buppercase\b/g) || []).length === 1 && /<h1 class="[^"]*font-brand[^"]*uppercase/.test(page),
  'the only uppercase on the page is the Lilita One title (DESIGN.md §3.3)');
ok(!/\buppercase\b/.test(card), 'store cards: no uppercase labels');
ok(/"Today's net"/.test(html) && /`\$\{periodLabel\} net`/.test(html), "the card's net label is sentence case");
ok(/txt\.textContent = on \? "Live" : "Offline"/.test(html) && /\$\{v1Live \? 'Live' : 'Offline'\}/.test(card),
  'the hero and card status pills read Live / Offline');
ok(/const paceBase = 'mt-1 font-geist font-semibold /.test(html), 'the hero pace figure is set at 600 when it repaints');

console.log('\n── Dashboard · motion and rhythm ──');
ok(!/animate-(ping|pulse)/.test(page), 'the freshness dot is static');
ok(!/translate-x/.test(card), 'View Details does not slide on hover');
ok(!/\btransition hover/.test(card) && !/class="(text-\w+ )?transition rounded/.test(page),
  'transitions name what they animate');
ok(!/(w|h)-\[38px\]|rounded-\[(11|15)px\]/.test(page), 'header controls sit on the 4px grid (40px, radius 10 / 16)');
ok(!/stroke-width="(2\.2|2\.5|2\.6)"/.test(page), 'one icon stroke in the header and hero');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
