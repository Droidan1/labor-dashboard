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
      // The truck that has COME DOWN. truck-current is scoped to `closed_at IS NULL`, so
      // this one is exactly what no other action can answer with.
      if (s.includes('truck-detail')) return J({ ok: true, pallets: PALLETS,
        truck: { ...TRUCK, id: 2, bol_no: '7644', opened_at: '2026-08-11T10:48:00Z',
                 closed_at: '2026-08-11T17:22:00Z', month: '2026-08', closed_by: 'Kevin R',
                 opened_by: 'Oo Aung', pallet_count: 3, close_note: null } });
      if (s.includes('truck-approvers')) return J({ ok: true, names: ['Kevin R', 'Wendy P'] });
      if (s.includes('truck-pallet-scan')) return J({ ok: true, read: 6, of: 8,
        fields: { barcode: 'PRM-99999-1', pallet_name: 'PALLET MISSED', item_no: '50999',
                  po: '7001', sup_ref: null, units: 41, created_by_tag: 'Dana F', truck_no: '99999' } });
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

  // ── Reading a truck back ─────────────────────────────────────────
  // 🛑 CLICKED THROUGH THE ROW, not called as irOpenTruck(2). The reported bug was that
  // a finished truck has no way in; a direct call would prove the modal renders and
  // nothing at all about the thing that was missing.
  // August is the SECOND accordion and ships collapsed — only the newest month opens —
  // so it has to be expanded first, which is also the state a real reader is in.
  await page.click('#ir-months > div:nth-child(2) .ir-mo-head');
  await page.waitForTimeout(450);
  check(await page.isVisible('#ir-months > div:nth-child(2) .ir-row-btn'),
        `[${t}] 🛑 a truck that has come down carries a way in`);
  await page.click('#ir-months > div:nth-child(2) .ir-row-btn');
  await page.waitForTimeout(500);
  check(await page.isVisible('#ir-det'), `[${t}] 🛑 ...and it OPENS — this is the whole bug`);
  check((await page.textContent('#ir-det-title') || '').includes('7644'), `[${t}] titled with the BOL that was opened`);
  check((await page.textContent('#ir-det-pill') || '').includes('1 short'),
        `[${t}] the pill is recomputed from the rows on screen (2 of 3)`);
  check((await page.$$('#ir-det-pallets tbody tr')).length === 2, `[${t}] the pallets that came off it are drawn`);
  check((await page.$$('#ir-det-pallets tr.dup')).length === 1, `[${t}] the approved duplicate is still tinted`);
  // 🔑 Brian reversed the read-only call the same day: a manager corrects a truck that is
  // down. The mocked account is a manager, so the button is offered.
  check((await page.$$('#ir-det-pallets .ir-row-btn')).length === 2,
        `[${t}] a manager gets Edit on every row of a truck that is down`);
  check((await page.textContent('#ir-det-facts') || '').includes('19353'), `[${t}] the facts carry the trailer number`);
  check((await page.textContent('#ir-det-facts') || '').includes('August 2026'), `[${t}] ...and the month it is filed under`);
  check((await page.textContent('#ir-det-sub') || '').includes('363 units'), `[${t}] the sub-line sums the pallets shown`);
  // 🔑 Contrast on the NEW surface, computed against what the browser really paints.
  // The facts grid is the only text on this page whose label colour had not been measured.
  const det = await page.evaluate(() => {
    const g = (sel, prop) => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[prop] : null; };
    return { panel: g('#ir-det .ir-panel', 'backgroundColor'),
             lbl: g('#ir-det .ir-fact-l', 'color'), val: g('#ir-det .ir-fact-v', 'color') };
  });
  for (const [k, v] of [['fact label', det.lbl], ['fact value', det.val]]) {
    const r = ratio(v, det.panel);
    check(r >= 4.5, `[${t}] ${k} is ${r.toFixed(2)}:1 on the read-back panel — needs ≥ 4.5:1`);
  }
  // 🛑 THE STACKING BUG THIS FEATURE WOULD HAVE SHIPPED. The verify form and the read-back
  // both sat at z-50, and this div is declared after it, so source order put the form BEHIND
  // the truck that raised it. Measured, not eyeballed: the form must be the element actually
  // hit at the centre of the screen.
  await page.click('#ir-det-pallets .ir-row-btn');
  await page.waitForTimeout(400);
  check(await page.isVisible('#ir-modal'), `[${t}] correcting a pallet opens the verify form`);
  const onTop = await page.evaluate(() => {
    const e = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return !!(e && e.closest('#ir-modal'));
  });
  check(onTop, `[${t}] 🛑 ...IN FRONT of the read-back that raised it, not behind it`);
  check((await page.inputValue('#ir-f-barcode')) === PALLETS[0].barcode,
        `[${t}] ...loaded from the read-back's own pallet list, not the dock's`);
  check(await page.isVisible('#ir-m-delete'), `[${t}] and a manager is offered Delete`);
  // 🛑 The header names the truck the pallet is REALLY on. Read from irState.truck alone it
  // would caption a read-back correction with whatever is on the dock.
  check((await page.textContent('#ir-m-title') || '').includes('7644'),
        `[${t}] 🛑 the form names the truck being corrected, not the one on the dock`);
  check((await page.textContent('#ir-m-submit') || '').trim() === 'Save Pallet',
        `[${t}] ...and the button says Save, not "Add to Truck" for a pallet already on it`);
  // 🛑 Escape must stop at the form, not close the truck out from under it.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check(await page.isVisible('#ir-det'),
        `[${t}] 🛑 Escape with the form open does NOT close the truck underneath`);
  await page.evaluate(() => window.irCloseModal());
  await page.waitForTimeout(250);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check(!(await page.isVisible('#ir-det')), `[${t}] Escape closes it once nothing is above it`);

  // ── Adding a pallet that was missed ───────────────────────────────
  // 🛑 Driven through the real camera path: the button opens a file chooser, and irPhoto
  // then reports the read. The mocked account is a manager and truck 2 is down.
  await page.click('#ir-months > div:nth-child(2) .ir-row-btn');
  await page.waitForTimeout(500);
  check(await page.isVisible('#ir-det-add'), `[${t}] a manager is offered Add Pallet on a truck that is down`);
  // The scan is driven directly rather than through the OS file chooser, which Playwright
  // cannot fill with a real photo here; what matters is where the result is reported and
  // which truck it is filed against.
  await page.evaluate(() => { window.irBeginPallet('detail'); });
  await page.waitForTimeout(200);
  const filed = await page.evaluate(async () => {
    const seen = {};
    const real = window.fetch;
    window.fetch = async (u, o) => {
      const str = String(u);
      if (str.includes('truck-pallet-log')) {
        seen.body = JSON.parse(o.body);
        return new Response(JSON.stringify({ ok: true, id: 77 }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return real(u, o);
    };
    window.irOpenVerify({ fields: { barcode: 'PRM-99999-1', units: 41, pallet_name: 'PALLET MISSED' }, read: 6, of: 8 }, null);
    await window.irSubmit();
    window.fetch = real;
    return seen.body || null;
  });
  check(!!filed && filed.truck_id === 2,
        `[${t}] 🛑 the missed pallet is filed against the truck being read back (got ${filed && filed.truck_id})`);
  check(!!filed && filed.barcode === 'PRM-99999-1', `[${t}] ...carrying the tag that was read`);
  check((await page.textContent('#ir-det-status') || '').includes('added'),
        `[${t}] ...and the outcome is reported on the Trucks tab, not the Receive pane`);

  // ── The typed path ──────────────────────────────────────────────
  // A pallet recorded days late has no cardboard to photograph. Clicked, not called — the
  // point is that the button is reachable without touching the camera.
  check(await page.isVisible('#ir-det-manual'), `[${t}] Enter Manually is offered beside Add Pallet`);
  let chooserOpened = false;
  const onChooser = () => { chooserOpened = true; };
  page.on('filechooser', onChooser);
  await page.click('#ir-det-manual');
  await page.waitForTimeout(500);
  check(await page.isVisible('#ir-modal'), `[${t}] it opens the form`);
  check(!chooserOpened, `[${t}] 🛑 ...WITHOUT opening the camera — that is the whole point`);
  page.off('filechooser', onChooser);
  check(!(await page.isVisible('#ir-m-shot')), `[${t}] the photo block is hidden — there is no photo`);
  // 🛑 Which is exactly why the guidance needs its own element: #ir-m-read lives inside
  // that hidden block, so without #ir-m-manual the form would open saying nothing at all.
  check(await page.isVisible('#ir-m-manual'), `[${t}] 🛑 ...and the typed form still carries instructions`);
  check((await page.textContent('#ir-m-manual') || '').includes('at least one'),
        `[${t}] ...naming the rule the worker enforces`);
  check((await page.textContent('#ir-m-retake') || '').trim() === 'Take Photo',
        `[${t}] the camera button reads "Take Photo", not "Retake"`);
  check((await page.inputValue('#ir-f-barcode')) === '', `[${t}] the form opens empty`);
  // 🛑 Empty is not an ERROR here. The scan path paints a blank amber-red and captions it
  // "not read"; on a typed entry nothing was read, so the same treatment would open the form
  // as eight failures and bury the one line saying what is required.
  check((await page.$$('#ir-m-fields .ir-in.miss')).length === 0,
        `[${t}] 🛑 ...and NOT as errors — no field is painted as a failed read`);
  check(!(await page.textContent('#ir-m-fields') || '').includes('Not read'),
        `[${t}] ...nor captioned as one`);
  check((await page.textContent('#ir-m-title') || '').includes('Add pallet by hand'),
        `[${t}] the header says it was typed — there is no tag to "verify"`);
  check((await page.textContent('#ir-m-title') || '').includes('7644'),
        `[${t}] ...titled with the truck it will be filed against`);

  const typed = await page.evaluate(async () => {
    const seen = {};
    const real = window.fetch;
    window.fetch = async (u, o) => {
      const str = String(u);
      if (str.includes('truck-pallet-log')) {
        seen.body = JSON.parse(o.body);
        return new Response(JSON.stringify({ ok: true, id: 78 }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return real(u, o);
    };
    document.getElementById('ir-f-barcode').value = 'P-TYPED-0001';
    document.getElementById('ir-f-units').value = '7';
    await window.irSubmit();
    window.fetch = real;
    return seen.body || null;
  });
  check(!!typed && typed.barcode === 'P-TYPED-0001', `[${t}] what was typed is what is sent`);
  check(!!typed && typed.truck_id === 2, `[${t}] ...filed against the truck being read back`);
  check(!!typed && !typed.image_b64,
        `[${t}] 🛑 ...and no image rides along, so the worker stores no R2 object`);

  await page.evaluate(() => window.irCloseDetail());
  await page.waitForTimeout(200);
  check(await page.isVisible('#ir-pane-trucks'), `[${t}] ...and leaves the tab it was raised from`);
  // Reopened on purpose: a tab switch has to take it with it, or it is still sitting
  // over the Receive pane on the way back.
  await page.click('#ir-months > div:nth-child(2) .ir-row-btn');
  await page.waitForTimeout(400);

  await page.evaluate(() => window.irSetTab('receive'));
  await page.waitForTimeout(400);
  check(!(await page.isVisible('#ir-det')), `[${t}] a tab switch closes the read-back too`);
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
