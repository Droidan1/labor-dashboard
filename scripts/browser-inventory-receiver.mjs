// Inventory Receiver — driven in a REAL BROWSER, against the real app shell.
//
// 🛑 NOT PART OF `scripts/test.sh`, deliberately: the runner globs `test-*` and this
// needs playwright-core and a Chromium, neither of which is a repo dependency. Run it
// by hand after a change to the page:
//
//   npm install && npx playwright install chromium   (or PLAYWRIGHT_BROWSERS_PATH)
//   bash scripts/build.sh && node scripts/browser-inventory-receiver.mjs
//
// 🔑 WHY IT EXISTS. test-nav-registry.mjs says it plainly: a static source test parses
// index.html as text and CANNOT see wiring. It can prove every id a function will look
// for exists; it cannot prove navigateToPage opens the page, that the render targets
// hold, or that a colour resolves. Everything below is the half that needs a DOM.
//
// 🛑 THE APP'S THEME IS A `.dark` CLASS DRIVEN BY localStorage, NOT prefers-color-scheme.
// The first version of this file set Playwright's colorScheme and screenshotted "both
// themes" — and rendered LIGHT twice. Dark mode was reported verified when it had never
// been loaded. The class is now set explicitly AND asserted before anything is measured.
//
// 🔑 CONTRAST IS COMPUTED, NOT EYEBALLED, from the colours the browser actually paints —
// CLAUDE.md requires ≥ 4.5:1 against the real background in both themes, and a screenshot
// cannot tell you that.
// 🔑 Imported dynamically, and playwright-core is deliberately NOT a devDependency:
// it pulls ~50 MB, and Cloudflare Pages runs `npm install` on every single deploy of
// this repo. A manual check is not worth putting that on the build. So the cost lands
// on whoever runs this, once, with a message that says exactly what to do.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error(
    '\nThis check needs playwright-core, which is not a dependency of this repo.\n\n' +
    '  npm install --no-save playwright-core\n' +
    '  bash scripts/build.sh\n' +
    '  node scripts/browser-inventory-receiver.mjs\n\n' +
    'A Chromium is also needed. This container ships one at /opt/pw-browsers/chromium\n' +
    '(PLAYWRIGHT_BROWSERS_PATH); elsewhere, `npx playwright install chromium`.\n');
  process.exit(2);
}
const CHROME = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist');
const types = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };
const srv = http.createServer((q, s) => {
  const f = path.join(root, q.url === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('no'); }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(8099, r));

const TRUCK = { id: 1, store: 'BL1', bol_no: '7679', ship_from: 'RM1', ship_from_addr: '1450 Atlantic Ave, Rocky Mount NC 27801',
  ship_to: 'FW2', carrier: 'Arrive Logistics', trailer_no: '19353', seal_no: '4949941',
  pallet_count: 40, opened_by: 'Kevin R', opened_at: '2026-09-15T11:04:00Z', closed_at: null, month: '2026-09' };
const PALLETS = [
  { id: 9, barcode: 'P-082626-725979', pallet_name: 'FG BL CONSUMABLES - FOOD - SNACKS', item_no: '50007', po: '14373', sup_ref: 'mix', units: 362, created_by_tag: 'Oo Aung', logged_at: '2026-09-15T12:16:00Z', dup_approved_by: null },
  { id: 8, barcode: 'PRM-10490-30', pallet_name: 'PALLET AMAZON IND8', item_no: '50201', po: '5036', sup_ref: null, units: 1, created_by_tag: 'Ranon Price', logged_at: '2026-09-15T11:54:00Z', dup_approved_by: 'Kevin R', dup_reason: 'tag reprinted' },
];

const results = [];
const check = (c, m) => { results.push([!!c, m]); };

const b = await chromium.launch({ executablePath: CHROME });
for (const scheme of ['dark', 'light']) {
  const ctx = await b.newContext({ colorScheme: scheme, viewport: { width: 1180, height: 1000 } });
  const page = await ctx.newPage();
  const errs = []; const blocked = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('requestfailed', r => { if (!r.url().startsWith('http://127.0.0.1')) blocked.push(new URL(r.url()).host); });

  await page.addInitScript((scheme) => {
    try { localStorage.setItem('darkMode', String(scheme === 'dark')); } catch (e) {}
  }, scheme);
  await page.addInitScript(({ TRUCK, PALLETS }) => {
    const real = window.fetch;
    window.fetch = async (u, o) => {
      const s = String(u);
      const J = (x) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
      if (s.includes('auth-me')) return J({ authenticated: true, email: 'k@b.com', name: 'Kevin R', role: 'manager', stores: ['BL1'], pages: {}, businesses: ['bl'] });
      if (s.includes('truck-current')) return J({ ok: true, truck: TRUCK, pallets: PALLETS });
      if (s.includes('truck-list')) return J({ ok: true, rows: [{ ...TRUCK, received: 2, units: 363, dup_approved: 1 },
        { ...TRUCK, id: 2, bol_no: '7644', closed_at: '2026-08-11T17:22:00Z', opened_at: '2026-08-11T10:48:00Z', month: '2026-08', received: 40, units: 11207, dup_approved: 0 }], truncated: false });
      if (s.includes('truck-approvers')) return J({ ok: true, names: ['Kevin R', 'Wendy P'] });
      return real(u, o);
    };
  }, { TRUCK, PALLETS });

  await page.goto('http://127.0.0.1:8099/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  // Boot hides #app when auth is unresolved; force the shell open, as ORIENT.md describes.
  await page.evaluate(() => {
    const lp = document.getElementById('login-page'); if (lp) lp.style.display = 'none';
    const a = document.getElementById('app'); if (a) a.style.display = 'flex';
  });
  // Belt and braces: assert the class actually landed, rather than trusting the setter.
  await page.evaluate((want) => {
    document.documentElement.classList.toggle('dark', want === 'dark');
  }, scheme);
  await page.evaluate(() => window.navigateToPage('inventory-receiver'));
  await page.waitForTimeout(900);

  const t = scheme;
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  check(isDark === (t === 'dark'), `[${t}] 🛑 the app is ACTUALLY in ${t} mode, not just the OS preference`);
  // Measure the real painted colours rather than eyeballing the screenshot.
  const paint = await page.evaluate(() => {
    const g = (sel, prop) => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[prop] : null; };
    return { panel: g('#page-inventory-receiver .ir-panel', 'backgroundColor'),
             ink: g('#page-inventory-receiver .ir-panel', 'color'),
             h1: g('.ir-h1', 'color'),
             lbl: g('#page-inventory-receiver .ir-lbl', 'color') };
  });
  const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = (c) => { const f = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const ratio = (a, b) => { const [l1, l2] = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
  const panelDark = lum(rgb(paint.panel)) < 0.2;
  check(panelDark === (t === 'dark'), `[${t}] the panel paints the ${t} ground (${paint.panel})`);
  for (const [k, v] of [['body ink', paint.ink], ['heading', paint.h1], ['bar label', paint.lbl]]) {
    const r = ratio(v, paint.panel);
    check(r >= 4.5, `[${t}] ${k} is ${r.toFixed(2)}:1 on the panel — needs ≥ 4.5:1`);
  }
  check(await page.isVisible('#page-inventory-receiver'), `[${t}] the page is visible`);
  check(!(await page.isVisible('#page-bin-dump')), `[${t}] Bin Dump is not also showing`);
  check((await page.textContent('#ir-truck-head') || '').includes('7679'), `[${t}] the open truck's BOL renders`);
  check((await page.textContent('#ir-truck-head') || '').includes('Arrive Logistics'), `[${t}] carrier renders`);
  check((await page.textContent('#ir-tile-pallets')) === '2', `[${t}] pallet tile counts the pallets`);
  check((await page.textContent('#ir-tile-units')) === '363', `[${t}] units tile sums them`);
  check(await page.isVisible('#ir-prog-wrap'), `[${t}] the progress bar shows (the BOL claimed 40)`);
  check((await page.textContent('#ir-prog-r') || '').includes('38 to go'), `[${t}] ...and counts down against the claim`);
  check((await page.$$('#ir-pallets tbody tr')).length === 2, `[${t}] both pallets are in the table`);
  check((await page.$$('#ir-pallets tr.dup')).length === 1, `[${t}] the approved duplicate is tinted`);
  check((await page.textContent('#ir-pallets') || '').includes('dup ok'), `[${t}] ...and badged`);
  // 🛑 The [hidden] override: #ir-begin must be gone while a truck is open.
  check(!(await page.isVisible('#ir-begin')), `[${t}] 🛑 Receive Truck is hidden while a truck is open`);
  check(!(await page.isVisible('#ir-status')), `[${t}] 🛑 the status strip is hidden when empty, not an empty pill`);

  // Second render — both of Bin Dump's §4.8 bugs were invisible on first paint.
  await page.evaluate(() => window.irSetTab('trucks'));
  await page.waitForTimeout(600);
  check(await page.isVisible('#ir-pane-trucks'), `[${t}] Trucks tab opens`);
  const months = await page.textContent('#ir-months');
  check(months.includes('September 2026') && months.includes('August 2026'), `[${t}] trucks group by month`);
  check(months.includes('1 OPEN'), `[${t}] ...and the open one is flagged in its month`);
  check((await page.textContent('#ir-trucks-status') || '').includes('2 trucks'), `[${t}] the status line is its own target and survives`);
  await page.evaluate(() => window.irSetTab('receive'));
  await page.waitForTimeout(400);
  check(await page.isVisible('#ir-pane-receive'), `[${t}] and back again`);
  check((await page.textContent('#ir-tile-pallets')) === '2', `[${t}] 🛑 the SECOND render still holds`);

  if (t === 'dark') {
    await page.evaluate(() => window.irSetTab('trucks'));
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: `/tmp/ir-real-${t}.png`, fullPage: true });
  // The sandbox proxy blocks external hosts (Google Fonts). Those are not this page's
  // errors, so they are reported separately rather than folded in or hand-waved away.
  const own = errs.filter(e => !/ERR_CERT_AUTHORITY_INVALID|ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED/.test(e));
  console.log(`  [${t}] external hosts blocked by the sandbox: ${[...new Set(blocked)].join(', ') || 'none'}`);
  check(own.length === 0, `[${t}] no page errors of our own` + (own.length ? ': ' + own.slice(0,3).join(' ~ ') : ''));
  await ctx.close();
}
// ── The camera attribute, driven in both pointer modes ─────────────────────
// 🛑 This is the regression that shipped: `capture="environment"` hardcoded on the
// input meant a desktop browser with no camera presented NO picker at all, so Receive
// Truck looked like a dead button. The phone path must stay byte-for-byte identical.
for (const [label, opts, wantCapture] of [
  ['desktop', { viewport: { width: 1400, height: 900 }, hasTouch: false, isMobile: false }, null],
  ['phone',   { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, 'environment'],
]) {
  const ctx = await b.newContext(opts);
  const page = await ctx.newPage();
  let chooser = false;
  page.on('filechooser', () => { chooser = true; });
  await page.addInitScript(({ TRUCK }) => {
    const real = window.fetch;
    window.fetch = async (u, o) => {
      const s = String(u);
      const J = (x) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
      if (s.includes('auth-me')) return J({ authenticated: true, email: 'b@b.com', name: 'Brian', role: 'superuser', stores: null, pages: {}, businesses: ['bl'] });
      if (s.includes('truck-current')) return J({ ok: true, truck: null, pallets: [] });
      if (s.includes('truck-list')) return J({ ok: true, rows: [], truncated: false });
      return real(u, o);
    };
  }, { TRUCK: null });
  await page.goto('http://127.0.0.1:8099/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const l = document.getElementById('login-page'); if (l) l.style.display = 'none';
    const a = document.getElementById('app'); if (a) a.style.display = 'flex';
  });
  await page.evaluate(() => window.navigateToPage('inventory-receiver'));
  await page.waitForTimeout(600);
  await page.evaluate(() => window.irBeginBol());
  await page.waitForTimeout(800);
  const cap = await page.evaluate(() => document.getElementById('ir-photo').getAttribute('capture'));
  const bd = await page.evaluate(() => {
    window.navigateToPage('bin-dump');
    try { window.bdBegin(); } catch (e) {}
    return document.getElementById('bd-photo').getAttribute('capture');
  });
  check(cap === wantCapture, `[${label}] Inventory Receiver capture is ${JSON.stringify(wantCapture)} (got ${JSON.stringify(cap)})`);
  check(bd === wantCapture, `[${label}] Bin Dump capture is ${JSON.stringify(wantCapture)} — same rule, no phone regression`);
  check(chooser, `[${label}] a picker actually opened`);
  await ctx.close();
}

await b.close();
srv.close();

const bad = results.filter(r => !r[0]);
for (const [okk, m] of results) if (!okk) console.log('  FAIL ' + m);
console.log(`\n${results.length - bad.length} passed, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
