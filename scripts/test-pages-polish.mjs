// The polish pass on every page (2026-11-05), pinned in the markup.
//
// Brian approved the Dashboard direction on 2026-11-04 (scripts/test-dashboard-polish.mjs) and asked
// for it on every page on 2026-11-05: sentence-case labels with no wide tracking, nothing under 11px,
// weights stop at 600, colour only where it means something, transitions that name what they animate.
// DESIGN.md §2.2, §2.4, §4.3 and §4.8 describe the rule.
//
// What prints is left alone, because paper is not the screen: the dashboard print report
// (buildPrintReport and its @media print block), Sign Studio's renderer (#sign-render), the
// price-sticker ZPL/SVG drawer and the jsPDF exports. Those blocks are cut out before checking.
// The Lilita One page titles keep their uppercase (DESIGN.md §3.3).
//
// Every assertion below fails on main before the pass. This reads the markup, not pixels.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');

// Cut the printed blocks out, each by its own markers.
const cut = (src, from, to, name) => {
  const a = src.indexOf(from), b = a < 0 ? -1 : src.indexOf(to, a + from.length);
  ok(a >= 0 && b > a, `found ${name}`);
  return a >= 0 && b > a ? src.slice(0, a) + src.slice(b + to.length) : src;
};
let screen = html;
screen = cut(screen, "/* Sign Studio's print (ssPrint)", '</style>', 'the print stylesheet');
screen = cut(screen, '<script id="sign-render">', '</script>', "Sign Studio's renderer");
screen = cut(screen, 'function buildPrintReport()', 'async function printDashboard(btn)', 'the dashboard print report');
screen = cut(screen, 'ZPL, because the printer draws the QR itself', 'const PS_CALIBRATE_ZPL', 'the price-sticker drawer');
screen = cut(screen, '// jsPDF + jspdf-autotable. Walks the on-screen tables', '// ── KPI tiles', 'the PDF export header');

// Comments describe history; only code counts.
const code = screen.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*|<!--)/.test(l)).join('\n');
const classStrings = [...code.matchAll(/class(?:Name)?\s*=\s*(["'`])([\s\S]*?)\1/g)].map(m => m[2]);
const notBrand = classStrings.filter(c => !/\bfont-(brand|display)\b/.test(c));
const hits = (re, list) => list.filter(c => re.test(c)).slice(0, 3).map(c => c.slice(0, 80));

console.log('\n── Every page · type ──');
let h;
h = hits(/(?<![\w:-])uppercase(?![\w-])/, notBrand);
ok(!h.length, `no uppercase labels outside the Lilita One titles ${JSON.stringify(h)}`);
// A code read digit by digit (the six-digit associate code, font-mono) keeps its spacing.
h = hits(/(?<![\w:-])tracking-(wide|wider|widest|\[0?\.\d+(em|px)\])/, notBrand.filter(c => !/\bfont-mono\b/.test(c)));
ok(!h.length, `no wide tracking outside the titles ${JSON.stringify(h)}`);
h = hits(/(?<![\w-])font-(bold|extrabold|black)(?![\w-])/, notBrand);
ok(!h.length, `weights stop at 600 ${JSON.stringify(h)}`);
h = hits(/(?<![\w-])text-\[(8|8\.5|9|9\.5|10|10\.5|11\.5)px\]/, classStrings);
ok(!h.length, `nothing under 11px and no half-pixel sizes ${JSON.stringify(h)}`);

// Page <style> blocks and inline styles say the same thing in CSS.
const cssLines = code.split('\n').filter(l => !/<text|<tspan|Luckiest Guy|Lilita One|font-brand/.test(l));
const cssHits = re => cssLines.filter(l => re.test(l)).slice(0, 3).map(l => l.trim().slice(0, 80));
ok(!(h = cssHits(/text-transform\s*:\s*uppercase/)).length, `no text-transform: uppercase in page CSS ${JSON.stringify(h)}`);
ok(!(h = cssHits(/font-weight\s*:\s*(700|800|900|bold)/)).length, `no CSS weight above 600 ${JSON.stringify(h)}`);
ok(!(h = cssHits(/font-size\s*:\s*(8|8\.5|9|9\.5|10|10\.5|11\.5)px/)).length, `no CSS size under 11px ${JSON.stringify(h)}`);
// The scan and key inputs (.ir-in.key, .mos-in) keep a little spacing: a typed code reads easier.
ok(!(h = cssHits(/letter-spacing\s*:\s*\.?0?\.\d+(em|px)/).filter(l => !/^\.(ir-in\.key|mos-in)\{/.test(l))).length, `no positive letter-spacing in page CSS ${JSON.stringify(h)}`);
ok(/<h1 class="[^"]*font-brand[^"]*uppercase/.test(html), 'the Lilita One page titles keep their uppercase (DESIGN.md §3.3)');

console.log('\n── Every page · colour ──');
ok(!/matrixTileWatermark/.test(html), 'no watermark icons in any Matrix tile');
ok(!/radial-gradient\(120% 80% at 100% 0%, rgb\(var\(--accent-green\)/.test(html), 'no hero card has the radial accent wash');
ok(!/class="[^"]*border-accent-green\/20 bg-accent-green\/10 px-2\.5 py-2\.5 text-center/.test(html),
  'Matrix-style tiles are neutral on every page (DESIGN.md §4.3)');
ok(!/\.lp-tile \{[^}]*rgba\(34,197,94/.test(html), "the landing page's business tiles are neutral too");
h = hits(/(?<![\w:-])text-(opl|op)-inkDimmer(?![\w-])/, classStrings);
ok(!h.length, `inkDimmer is never text (DESIGN.md §3.3) ${JSON.stringify(h)}`);

console.log('\n── Every page · motion ──');
h = hits(/(?<![\w:-])transition(?=[\s"'`]|$)/, classStrings);
ok(!h.length, `class transitions name what they animate ${JSON.stringify(h)}`);
ok(!cssHits(/transition\s*:\s*(all\b|\.?\d)/).length, 'CSS transitions name what they animate');
ok(/\.hs-pulse\.hs-still\{ animation:none; \}/.test(html) && /class="hs-pulse hs-still"><\/span> Live · tap to refresh/.test(html),
  "the hourly snapshot's live dot is static; it pulses only while refreshing");

console.log('\n── Every page · the hooks that read these classes ──');
ok((html.match(/card\.querySelector\('\.kpi-l, \.text-xs'\)/g) || []).length === 2 && !/querySelector\('\.uppercase/.test(html),
  "the Retail Summary's PDF and CSV find KPI labels by .kpi-l, not by .uppercase");
ok((html.match(/class="kpi-l /g) || []).length >= 3, 'the Retail Summary KPI labels carry .kpi-l');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
