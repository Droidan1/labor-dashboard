// Retail Summary › Categories › Vs: picking SEVERAL categories at once, in a real browser.
//
// 🛑 NOT PART OF `scripts/test.sh`, deliberately: the runner globs `test-*` and this needs
// playwright-core and a Chromium, neither of which is a repo dependency. Run it by hand
// after a change to the Categories tab:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-categories-multi.mjs
//
// 🔑 WHAT IT PROVES. A Vs row used to chart ONE category: clicking a second replaced the
// first. Now each click toggles a category in or out and the card charts the picked ones
// COMBINED. The check reads the card's two totals (the range shown, the range compared
// with) after each click and compares them with sums it works out itself from the exact
// payload the fake worker served — so a card that kept only the last pick, or summed the
// wrong range, or forgot to subtract a dropped one, cannot pass.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error(
    '\nThis check needs playwright-core, which is not a dependency of this repo.\n\n' +
    '  npm install --no-save playwright-core\n' +
    '  bash scripts/build.sh\n' +
    '  node scripts/browser-categories-multi.mjs\n\n' +
    'A Chromium is also needed: /opt/pw-browsers/chromium, or PLAYWRIGHT_CHROMIUM.\n');
  process.exit(2);
}
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const root = path.join(repo, 'dist');
if (!fs.existsSync(path.join(root, 'index.html'))) { console.error('No dist/ — run bash scripts/build.sh first.'); process.exit(2); }
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.txt': 'text/plain' };
const PORT = Number(process.env.PORT || 8098);
const srv = http.createServer((q, s) => {
  const u = q.url.split('?')[0];
  const f = path.join(root, u === '/' ? 'index.html' : u);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('no'); }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(PORT, r));
const ORIGIN = `http://127.0.0.1:${PORT}`;

const results = [];
const check = (c, m) => { results.push([!!c, m]); };
const eq = (got, want, m) => { const same = JSON.stringify(got) === JSON.stringify(want);
  check(same, `${m}${same ? '' : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`); };

// ── the fake worker, run inside the page ─────────────────────────────────
// Three L2s with two L3s each. "Kitchen" is the short name under TWO parents on purpose:
// a caption naming several L3s across every L2 has to say which Kitchen.
// Values are a pure function of (store, date, category), so the check can recompute any
// sum from the request log alone. Every request that is not this server is refused below.
function pageMocks() {
  const TREE = {
    Hardlines: ['FG BL HARDLINES - KITCHEN', 'FG BL HARDLINES - TOOLS'],
    Home:      ['FG BL HOME - DECOR', 'FG BL HOME - BATH'],
    Seasonal:  ['FG BL SEASONAL - HALLOWEEN', 'FG BL SEASONAL - KITCHEN'],
  };
  const STORES = ['BL1', 'BL4'];
  const val = (st, d, l2i, l3i) => {
    const day = Number(d.slice(8, 10));
    return [(l2i + 1) * 100 + l3i * 40 + (st === 'BL4' ? 7 : 0) + day, l2i + l3i + 1];
  };
  const days = (from, to) => { const out = [];
    for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86400000)
      out.push(new Date(t).toISOString().slice(0, 10));
    return out; };
  window.__ctReqs = [];
  const J = (x, st = 200) => new Response(JSON.stringify(x), { status: st, headers: { 'content-type': 'application/json' } });
  const real = window.fetch;
  window.fetch = async (u, o = {}) => {
    const s = String(u && u.url ? u.url : u);
    if (!s.startsWith('https://')) return real(u, o);
    const q = new URL(s).searchParams, action = q.get('action');
    if (action === 'auth-me') {
      window.__authed = true;
      return J({ authenticated: true, email: 'sam@example.com', name: 'Sam U', role: 'superuser',
        stores: ['BL1', 'BL4'], pages: {}, businesses: ['bl'] });
    }
    if (action === 'category-series') {
      const from = q.get('from'), to = q.get('to'), level = q.get('level');
      const stores = q.get('store') ? [q.get('store')] : STORES;
      const out = { dates: days(from, to), stores, l2: {}, l3: level === 'l3' ? {} : undefined };
      for (const st of stores) {
        out.l2[st] = {}; if (out.l3) out.l3[st] = {};
        for (const d of out.dates) {
          out.l2[st][d] = {}; if (out.l3) out.l3[st][d] = {};
          Object.keys(TREE).forEach((l2, l2i) => {
            let n = 0, u2 = 0;
            TREE[l2].forEach((l3, l3i) => {
              const [net, units] = val(st, d, l2i, l3i); n += net; u2 += units;
              if (out.l3) (out.l3[st][d][l2] = out.l3[st][d][l2] || {})[l3] = [net, units];
            });
            out.l2[st][d][l2] = [n, u2];
          });
        }
      }
      window.__ctReqs.push({ from, to, level, stores, payload: out });
      return J(out);
    }
    return J({ ok: false, error: 'not in this harness' }, 404);
  };
}

const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ timezoneId: 'America/New_York', locale: 'en-US', serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.route(u => !u.href.startsWith(ORIGIN), r => r.abort());
await page.addInitScript(pageMocks);
// A Thursday, so "this week" is several days long and Auto cuts it by DAY (one day alone
// would switch the axis to hours, which is a different endpoint).
await page.clock.setFixedTime(new Date('2026-10-01T16:00:00Z'));
await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.navigateToPage === 'function' && window.__authed, null, { timeout: 10000 });
await page.waitForTimeout(500);
await page.evaluate(() => window.navigateToPage('weekly-summary'));
await page.waitForTimeout(300);
await page.evaluate(() => window.switchWrsTab('categories'));
await page.waitForFunction(() => document.querySelectorAll('#ct-rows .ct-row').length > 0, null, { timeout: 10000 });

// ── what the card SHOULD say, from the payload actually served ─────────────
// The last two requests are the pair for the current view: A (shown) first, then B.
async function expected(pick) {
  const reqs = await page.evaluate(() => window.__ctReqs.slice(-2));
  const sum = (req) => {
    let t = 0;
    for (const st of req.stores) for (const d of req.dates || req.payload.dates) {
      for (const k of pick) {
        if (k.includes(' :: ')) {
          const [l2, l3] = k.split(' :: ');
          t += ((((req.payload.l3 || {})[st] || {})[d] || {})[l2] || {})[l3]?.[0] || 0;
        } else t += (((req.payload.l2[st] || {})[d] || {})[k] || [0])[0];
      }
    }
    return t;
  };
  return [sum(reqs[0]), sum(reqs[1])].map(v => '$' + Math.round(v).toLocaleString('en-US'));
}
const card = () => page.evaluate(() => [...document.querySelectorAll('#ct-legend .ct-lpv')].map(e => e.textContent.trim()));
const pressed = () => page.evaluate(() => [...document.querySelectorAll('#ct-rows .ct-row[aria-pressed="true"] .ct-nm')]
  .map(e => e.textContent.trim()));
const caption = () => page.evaluate(() => document.querySelector('.ct-cap')?.textContent.replace(/\s+/g, ' ').trim());
const clickRow = name => page.locator('#ct-rows .ct-row', { has: page.locator('.ct-nm', { hasText: new RegExp('^' + name + '$') }) }).click();
const showAll = () => page.locator('#ct-showall');

// ── L2 ────────────────────────────────────────────────────────────────────
const ALL_L2 = ['Hardlines', 'Home', 'Seasonal'];
eq(await card(), await expected(ALL_L2), 'L2, nothing picked: the card charts every category');

// The y-axis as drawn. Gridlines are evenly stepped, so honest labels are too; rounding
// to whole thousands printed $1.5k as "$2k" beside the real $2k (and $2.5k as "$3k").
const yLabels = await page.evaluate(() => [...document.querySelectorAll('#ct-chart svg text')]
  .map(t => t.textContent).filter(t => t.startsWith('$')));
const yVals = yLabels.map(t => Number(t.replace(/[$k]/g, '')) * (t.endsWith('k') ? 1000 : 1));
const steps = yVals.slice(1).map((v, i) => v - yVals[i]);
check(yLabels.length >= 3 && new Set(yLabels).size === yLabels.length && steps.every(d => d > 0 && Math.abs(d - steps[0]) < 1e-9),
  `the y-axis labels are distinct and step evenly (${yLabels.join(', ')})`);
eq(await pressed(), [], 'and no row is pressed');
eq(await showAll().count(), 0, 'and there is no Show all to offer');

await clickRow('Home');
eq(await card(), await expected(['Home']), 'pick Home: the card charts Home alone');
eq(await pressed(), ['Home'], 'Home is pressed');
check((await caption()).startsWith('Home ·'), `the caption names Home (${await caption()})`);

await clickRow('Seasonal');
eq(await card(), await expected(['Home', 'Seasonal']), 'add Seasonal: the card charts Home + Seasonal COMBINED, not Seasonal alone');
eq((await pressed()).sort(), ['Home', 'Seasonal'], 'both rows stay pressed');
check((await caption()).startsWith('2 categories combined — Home + Seasonal'), `the caption says what is combined (${await caption()})`);
eq(await showAll().count(), 1, 'Show all is offered once anything is picked');

await clickRow('Hardlines');
eq(await card(), await expected(['Home', 'Seasonal', 'Hardlines']), 'a third pick adds a third category');

await clickRow('Home');
eq(await card(), await expected(['Seasonal', 'Hardlines']), 'clicking a picked row again drops it and only it');
eq((await pressed()).sort(), ['Hardlines', 'Seasonal'], 'Home is no longer pressed');

// The same picks survive a switch of view and back: they are state, not DOM.
await page.locator('#ct-view button', { hasText: 'Table' }).click();
await page.locator('#ct-view button', { hasText: 'Vs' }).click();
eq((await pressed()).sort(), ['Hardlines', 'Seasonal'], 'the picks survive Vs → Table → Vs');

// ── contrast of the one new control, BOTH themes, against the panel it sits on ──
const contrast = () => page.evaluate(() => {
  const rgb = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = c => { const [r, g, b2] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2; };
  const btn = document.getElementById('ct-showall');
  if (!btn) return 0;   // nothing to measure is a failure, not a crash
  // The button is transparent, so its ground is the nearest opaque ancestor.
  let n = btn, bg = 'rgba(0, 0, 0, 0)';
  while (n && /rgba\(.*, 0\)|transparent/.test(bg)) { bg = getComputedStyle(n).backgroundColor; n = n.parentElement; }
  const a = lum(rgb(getComputedStyle(btn).color)), c = lum(rgb(bg));
  return Math.round(((Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05)) * 100) / 100;
});
const light = await contrast();
check(light >= 4.5, `Show all reads at ≥ 4.5:1 in light (${light}:1)`);
await page.evaluate(() => document.documentElement.classList.add('dark'));
await page.evaluate(() => window.switchWrsTab('summary'));
await page.evaluate(() => window.switchWrsTab('categories'));
await page.waitForTimeout(400);   // .ct-pill button transitions its colour over .2s
const dark = await contrast();
check(dark >= 4.5, `Show all reads at ≥ 4.5:1 in dark (${dark}:1)`);
if (process.env.SHOTS) await page.locator('#ct-panel').screenshot({ path: path.join(process.env.SHOTS, 'categories-multi-dark.png') });
await page.evaluate(() => document.documentElement.classList.remove('dark'));
await page.waitForTimeout(400);
if (process.env.SHOTS) await page.locator('#ct-panel').screenshot({ path: path.join(process.env.SHOTS, 'categories-multi-light.png') });

if (await showAll().count()) await showAll().click();
eq(await card(), await expected(ALL_L2), 'Show all goes back to every category');
eq(await pressed(), [], 'and unpresses every row');

// ── L3 ────────────────────────────────────────────────────────────────────
await clickRow('Home');   // a pick at L2 must not leak into L3
await page.locator('#ct-level button', { hasText: 'L3' }).click();
await page.waitForFunction(() => document.querySelectorAll('#ct-rows .ct-row').length >= 6, null, { timeout: 10000 });
eq(await pressed(), [], 'switching level clears the picks');
const HK = 'Hardlines :: FG BL HARDLINES - KITCHEN', SK = 'Seasonal :: FG BL SEASONAL - KITCHEN', HB = 'Home :: FG BL HOME - BATH';
const l3Row = key => page.locator(`#ct-rows .ct-row[title^="${key.replace(' :: ', ' → ')}"]`);
await l3Row(HK).click();
await l3Row(SK).click();
eq(await card(), await expected([HK, SK]), 'L3: two Kitchens under two parents chart combined');
check((await caption()).startsWith('2 categories combined — Hardlines › Kitchen + Seasonal › Kitchen'),
  `the caption says WHICH Kitchen (${await caption()})`);
await l3Row(HB).click();
eq(await card(), await expected([HK, SK, HB]), 'L3: a third, from another parent, adds in');
await l3Row(HK).click();
eq(await card(), await expected([SK, HB]), 'L3: dropping one subtracts exactly it');

// Narrowed to one L2, the parent is already on screen, so the caption does not repeat it.
await page.selectOption('#ct-parent', 'Hardlines');
await page.waitForFunction(() => document.querySelectorAll('#ct-rows .ct-row').length === 2, null, { timeout: 10000 });
eq(await pressed(), [], 'changing the parent clears the picks');
await l3Row(HK).click();
await l3Row('Hardlines :: FG BL HARDLINES - TOOLS').click();
check((await caption()).startsWith('2 categories combined — Kitchen + Tools'), `within one L2, short names (${await caption()})`);
eq(await card(), await expected([HK, 'Hardlines :: FG BL HARDLINES - TOOLS']), 'within one L2: both L3s combined');

// On a phone the y-axis gutter is 46px. A label now keeps its decimals ("$2.25k"), so it is
// wider than the rounded one was: every label must still start inside the chart.
// (Re-rendered by script: at this width the sidebar overlay and a coach tip sit over the pills.)
await page.setViewportSize({ width: 375, height: 812 });
await page.evaluate(() => { window.switchWrsTab('summary'); window.switchWrsTab('categories'); });
await page.waitForTimeout(300);
const leftmost = await page.evaluate(() => Math.min(...[...document.querySelectorAll('#ct-chart svg text')]
  .filter(t => t.textContent.startsWith('$')).map(t => t.getBBox().x)));
check(leftmost >= 0, `at 375px every y-axis label starts inside the chart (leftmost x = ${leftmost.toFixed(1)})`);

eq(errs, [], 'no uncaught page errors');

await b.close(); srv.close();
let failed = 0;
for (const [okk, m] of results) { if (okk) console.log('  PASS  ' + m); else { failed++; console.log('  FAIL  ' + m); } }
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
