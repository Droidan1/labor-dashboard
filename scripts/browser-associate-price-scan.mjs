// Price Scan for an associate, driven in a REAL BROWSER.
//
// 🛑 NOT PART OF `scripts/test.sh` — it needs playwright-core and a Chromium, like every
// browser-*.mjs. Run it by hand after touching associate navigation or the Price Scan page:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-associate-price-scan.mjs
//   (on a Mac: PLAYWRIGHT_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
//
// 🔑 WHY IT EXISTS. test-associate drives the WORKER: who may scan, print, and what stays
// closed. It cannot see that an associate granted Price Scan lands on it, finds it in a
// sidebar built by subtraction, or is offered a control whose endpoint will refuse them —
// the last is the failure this page would otherwise ship with: Manual and Furniture were
// ungated buttons that open onto "Forbidden" for anyone without a financial role.
// Decisions pinned (Brian, 2026-09-30): same scan as a manager, cost included; printing is
// the EDIT level, and so is the Override (price, retail, category — "like managers"); new
// price points, manual and furniture pricing stay managers'.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error('\nThis check needs playwright-core: npm install --no-save playwright-core\n');
  process.exit(2);
}
const CHROME = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist');
if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error('\ndist/ is missing or empty. Run `bash scripts/build.sh` first.\n');
  process.exit(2);
}
const types = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };
const srv = http.createServer((q, s) => {
  const f = path.join(root, q.url === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('no'); }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${srv.address().port}`;

const results = [];
const check = (c, m) => { results.push([!!c, m]); };

// The item from the Windows PC photo: $4.00 set by hand, $6.99 retail, $0.81 cost, $2.43 ASP.
const SCAN = { ok: true, identifier: '078000035421', identifier_type: 'upc', title: 'Canada Dry Ginger Ale 12pk',
  brand: 'Canada Dry', size: '12pk', l2: 'Consumable Food', l3: 'FG BL CONSUMABLES - FOOD - BEVERAGES',
  retail: 6.99, retail_source: 'set by hand', retail_confidence: 'high', retail_overridden: true,
  asp: 2.43, cost: 0.81, price: 4.00, price_basis: 'set by hand', price_overridden: true,
  gp_pct: 79.8, below_gp_floor: false, gp_floor_pct: 30, flags: [],
  categories: [{ key: 'Consumable Food', label: 'Consumable Food', children: [
    { key: 'FG BL CONSUMABLES - FOOD - BEVERAGES', label: 'Beverages' },
    { key: 'FG BL CONSUMABLES - FOOD - SNACKS', label: 'Snacks' }] }],
  from_cache: true, looked_up: false, from_photo: false, manifest: null };

function mocks({ who, SCAN }) {
  try { localStorage.setItem('bioPromptDismissed', '1'); localStorage.setItem('coachTipsDisabled', '1'); } catch (e) {}
  window.__calls = []; window.__saved = []; window.__zebra = []; window.__bodies = [];
  // The open buys Price Scan's Buy sheet reads (ps-buy-list). A test closes one by
  // deleting it from here; prints into one add to its labels, as the worker's count would.
  window.__buys = window.__buys || [
    { po: '12345', label: 'Drinks', vendor: 'Returns lot', received_on: '2026-09-28', units: 600, labels: 214 },
    { po: '40211', label: 'Kitchen', vendor: 'Wayfair returns', received_on: '2026-09-26', units: 420, labels: 12 },
    { po: '99998', label: '', vendor: '', received_on: null, units: null, labels: 0 }];
  const J = (x, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
  window.fetch = async (u, o = {}) => {
    // Zebra Browser Print, stubbed: one printer, and every write recorded, never sent.
    if (String(u).startsWith('http://127.0.0.1:9100/available'))
      return J({ printer: window.__printers || [{ uid: 'zd410-test', name: 'ZD410 (test)', connection: 'usb' }] });
    if (String(u).startsWith('http://127.0.0.1:9100/write')) { try { window.__zebra.push(JSON.parse(o.body)); } catch (e) {} return new Response('', { status: 200 }); }
    const action = new URL(String(u), location.href).searchParams.get('action');
    window.__calls.push(action);
    if (action === 'merch-scan-save') { try { window.__saved.push(JSON.parse(o.body)); } catch (e) {} }
    if (o.body && typeof o.body === 'string') { try { window.__bodies.push({ action, body: JSON.parse(o.body) }); } catch (e) {} }
    if (action === 'sticker-printed') {
      try { const b = JSON.parse(o.body); const buy = window.__buys.find(x => x.po === b.po);
            if (buy) buy.labels += b.qty || 1; } catch (e) {}
    }
    switch (action) {
      case 'auth-me': return J(who);
      case 'merch-scan': return J(SCAN);
      case 'merch-scan-save': return J({ ok: true, identifier: SCAN.identifier });
      case 'sticker-template': return J({ ok: true, template: null, markImage: null });
      case 'sticker-history': return J({ ok: true, prints: [] });
      case 'ps-buy-list': return J({ ok: true, buys: window.__buys });
      case 'sticker-check': return J(window.__noCloverItem
        ? { ok: true, printable: false, reason: 'no clover item', detail: 'No Clover item carries BL-50044-4 yet.' }
        : { ok: true, printable: true, code: 'BL-50044-4', category_code: '50044' });
      // Anything else is what the worker would refuse an associate — so if the page calls
      // it, the check below that lists calls says so.
      default: return J({ error: 'Forbidden' }, 403);
    }
  };
}

const b = await chromium.launch({ executablePath: CHROME });
async function open(who, { width = 1280, height = 800, mobile = false } = {}) {
  const ctx = await b.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
  live.add(ctx);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.route(u => !u.href.startsWith(ORIGIN), r => r.abort());
  await page.addInitScript(mocks, { who, SCAN });
  await page.goto(ORIGIN + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__calls?.includes('auth-me'), null, { timeout: 10000 });
  await page.waitForTimeout(900);
  return { ctx, page, errs };
}
const shown = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!(e && e.offsetParent); }, sel);
async function scan(page) {
  await page.fill('#ps-input', '078000035421', { timeout: 3000 });
  await page.click('#ps-go', { timeout: 3000 });
  await page.waitForFunction(() => /\$4\.00/.test(document.getElementById('ps-result')?.textContent || ''), null, { timeout: 5000 });
  await page.waitForTimeout(400);
}
const ASSOC = (pages) => ({ authenticated: true, email: 'assoc_42@associate.invalid', name: 'Ed Print',
  role: 'staff', associate: true, pages, stores: ['BL1'], businesses: ['bl'] });
const MANAGER_ONLY = ['merch-categories', 'furniture-bands', 'sticker-create-price-point', 'ob-buy-list'];
// One scenario per section. A wait that times out is a FAILED check and the run goes on —
// a crash would hide every check after it.
const live = new Set();
async function section(name, fn) {
  try { await fn(); }
  catch (e) { check(false, `${name}: stopped — ${String((e && e.message) || e).split('\n')[0]}`); }
  finally { for (const c of live) { try { await c.close(); } catch (e) {} } live.clear(); }
}

// ── 1. An associate at EDIT ───────────────────────────────────────────────
await section('1. An associate at EDIT', async () => {
  const { ctx, page, errs } = await open(ASSOC({ 'merch-scan': 'edit' }));
  check(await shown(page, '#page-merch-scan'), '🔑 an associate whose only grant is Price Scan lands on it');
  check(await shown(page, '#nav-merch') && await shown(page, '#nav-merch-scan'),
        '🔑 the sidebar shows the Merchandising header with Price Scan open under it');
  const others = await page.$$eval('#nav-merch-sub .nav-subitem', n => n.filter(e => e.offsetParent).map(e => e.id));
  check(others.join() === 'nav-merch-scan', `…and nothing else in that group (${others.join()})`);
  check(!(await shown(page, '[data-page="dashboard"]')), '…and no dashboard anywhere');
  check(!(await shown(page, '#ps-manual')) && !(await shown(page, '#ps-furniture')),
        '🛑 Manual and Furniture are not offered — their endpoints refuse an associate');
  await scan(page);
  const card = await page.textContent('#ps-result');
  check(/\$0\.81/.test(card) && /79\.8% GP/.test(card), '🔑 the scan shows cost and GP, as it does for a manager');
  check(/Override price or retail/.test(card), '🔑 edit overrides like a manager: the Override button is there');
  check(await shown(page, '#ps-result .ps-link[onclick="psOverride()"]'), '…and the category\'s Change link');
  // Drive the editor: pick a category, set our price, save — the body is what the worker gets.
  await page.click('text=Override price or retail');
  await page.waitForSelector('#ps-e-l3', { timeout: 3000 });
  await page.selectOption('#ps-e-l3', 'FG BL CONSUMABLES - FOOD - SNACKS');
  await page.fill('#ps-e-price', '3.50');
  await page.click('#ps-edit >> text=Save');
  await page.waitForFunction(() => window.__saved.length === 1, null, { timeout: 4000 });
  const saved = (await page.evaluate(() => window.__saved))[0];
  check(saved.l3 === 'FG BL CONSUMABLES - FOOD - SNACKS' && saved.suggested_price === '3.50',
        `🔑 the override posts the category and price they chose (${JSON.stringify(saved)})`);
  check(!/Could not save/.test(await page.textContent('#page-merch-scan')), '…and saves without an error');
  check(await shown(page, '#ps-print'), '🔑 edit prints: the Print button is there');
  check(await shown(page, '#ps-tab-reprint'), '…and the Reprint tab');
  check(await shown(page, '#ps-ob'), '🔑 …and Buy: picking a buy is the print level, on Price Scan\'s own grant (2026-10-01)');
  const calls = await page.evaluate(() => window.__calls);
  check(calls.includes('sticker-check'), 'the sticker check ran for the Print button');
  const bad = calls.filter(a => MANAGER_ONLY.includes(a));
  check(bad.length === 0, `🛑 the page called nothing a manager-only endpoint serves (${bad.join() || 'none'})`);
  check(!/Forbidden/.test(await page.textContent('#page-merch-scan')), 'no "Forbidden" anywhere on the page');
  // Calibrate printer (2026-10-01): offered with Print, in Printer tools at the top right;
  // it asks first, then sends the calibration.
  check(await shown(page, '#ps-tools-btn'), '🔑 edit can print, so it is offered Printer tools');
  check(!(await shown(page, '#ps-calibrate')), '…closed until it is opened');
  await page.click('#ps-tools-btn');
  check(await shown(page, '#ps-calibrate') && await shown(page, '#ps-printer'), '…which opens on Calibrate printer and Choose printer');
  await page.click('#ps-calibrate');
  check(!(await shown(page, '#ps-tools-menu')), '…and closes as Calibrate printer runs');
  await page.click('button:text-is("Calibrate")', { timeout: 3000 });
  await page.waitForFunction(() => window.__zebra.length === 1, null, { timeout: 4000 });
  const cal = (await page.evaluate(() => window.__zebra))[0] || {};
  check(/~JC/.test(cal.data || '') && /gap\/notch/.test(cal.data || '') && /\^JUS/.test(cal.data || ''),
        `…and after confirming, sends the gap calibration to the printer (${JSON.stringify((cal.data || '').slice(0, 40))}…)`);
  check(/Calibrating ZD410/.test(await page.textContent('#ps-status')), '…saying so on the page');
  // A price with no Clover item behind it: a manager is offered to create one at every
  // store. An associate who can print is not — that endpoint is a manager's.
  await page.evaluate(() => { window.__noCloverItem = true; });
  await scan(page);
  await page.waitForFunction(() => /No Clover item/.test(document.getElementById('ps-print-note')?.textContent || ''), null, { timeout: 4000 });
  check(!/Add it to inventory/.test(await page.textContent('#ps-result')),
        '🛑 an associate is told there is no Clover item, but is not offered to create one');
  check(errs.length === 0, `no JS errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await ctx.close();
});

// ── 2. An associate at VIEW ───────────────────────────────────────────────
await section('2. An associate at VIEW', async () => {
  const { ctx, page, errs } = await open(ASSOC({ 'merch-scan': 'view' }));
  check(await shown(page, '#page-merch-scan'), 'an associate at view lands on Price Scan too');
  await scan(page);
  check(!(await shown(page, '#ps-print')), '🛑 view does not print: no Print button');
  check(!/Override price or retail/.test(await page.textContent('#ps-result')), '🛑 …and does not override');
  check(!(await shown(page, '#ps-result .ps-link[onclick="psOverride()"]')), '…nor get the category\'s Change link');
  check(!(await shown(page, '#ps-tab-reprint')), '…and no Reprint tab');
  check(!(await shown(page, '#ps-tools-btn')), '…and no Printer tools: it cannot print');
  check(!(await shown(page, '#ps-ob')), '…and no Buy: it cannot print into one');
  const calls = await page.evaluate(() => window.__calls);
  check(!calls.includes('sticker-check') && !calls.includes('sticker-history'),
        '…and the page never asks the print endpoints, which would refuse');
  check(errs.length === 0, `no JS errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await ctx.close();
});

// ── 3. An associate WITHOUT Price Scan ────────────────────────────────────
await section('3. An associate WITHOUT Price Scan', async () => {
  const { ctx, page } = await open(ASSOC({ 'bin-dump': 'edit' }));
  check(!(await shown(page, '#nav-merch-group')), 'an associate without it sees no Merchandising group');
  await page.evaluate(() => window.navigateToPage('merch-scan'));
  await page.waitForTimeout(300);
  check(!(await shown(page, '#page-merch-scan')), '🛑 …and the router refuses the page by address');
  await ctx.close();
});

// ── 4. On a phone, the Menu lists it ──────────────────────────────────────
await section('4. On a phone, the Menu lists it', async () => {
  const { ctx, page } = await open(ASSOC({ 'merch-scan': 'edit' }), { width: 390, height: 844, mobile: true });
  await page.evaluate(() => window.navigateToPage('menu'));
  await page.waitForTimeout(400);
  const menu = (await page.textContent('#page-menu').catch(() => '')) || '';
  check(/Merchandising/.test(menu) && /Price Scan/.test(menu), `🔑 the phone Menu offers Price Scan under Merchandising`);
  // …and the bar carries it as a tab of its own, lit while they are on it.
  await page.evaluate(() => window.navigateToPage('merch-scan'));
  await page.waitForTimeout(400);
  const tab = await page.evaluate(() => { const t = document.getElementById('bn-merch-scan');
    return { shown: !!(t && t.offsetParent), lit: !!(t && !t.classList.contains('text-opl-inkDim')) }; });
  check(tab.shown, '🔑 the phone bar has a Price Scan tab');
  check(tab.lit, '…lit while they are on the page');

  // Buy (Brian, 2026-10-01): a tab of its own for an associate who can print. Not a page —
  // it opens Price Scan's Buy sheet — so it lights while a buy is being priced into, and
  // Price Scan lights the rest of the time. One lit tab, never two.
  const lit = () => page.evaluate(() => Object.fromEntries(['bn-merch-scan', 'bn-merch-buy'].map(id => {
    const t = document.getElementById(id); return [id, !!(t && t.offsetParent && !t.classList.contains('text-opl-inkDim'))]; })));
  check(await shown(page, '#bn-merch-buy'), '🔑 the phone bar has a Buy tab');
  await page.evaluate(() => window.navigateToPage('menu'));
  await page.waitForTimeout(300);
  await page.click('#bn-merch-buy');
  await page.waitForSelector('#ps-ob-sheet [data-po]', { timeout: 4000 });
  check(await shown(page, '#page-merch-scan'), '🔑 …which goes to Price Scan from anywhere, with the Buy sheet open');
  check(JSON.stringify(await lit()) === '{"bn-merch-scan":true,"bn-merch-buy":false}',
        `…Price Scan still lit while nothing is picked (${JSON.stringify(await lit())})`);
  await page.click('#ps-ob-sheet [data-po="12345"]');
  check(JSON.stringify(await lit()) === '{"bn-merch-scan":false,"bn-merch-buy":true}',
        `🔑 a picked buy lights Buy instead (${JSON.stringify(await lit())})`);
  await page.click('#bn-merch-buy');
  await page.waitForSelector('#ps-ob-sheet [data-po]', { timeout: 4000 });
  check(/Stop pricing into PO 12345/.test(await page.textContent('#ps-ob-sheet')), '…tapped mid-buy, it is Change, with Stop inside');
  await page.click('#ps-obs-stop');
  check(JSON.stringify(await lit()) === '{"bn-merch-scan":true,"bn-merch-buy":false}',
        `…and Stop gives the light back to Price Scan (${JSON.stringify(await lit())})`);
  // Tapped while already on Price Scan, after a trip the router refused (an associate has no
  // Dashboard): it must not re-enter the page, which clears what is on screen, and the bar
  // must still light the right tab rather than the refused page's.
  await page.fill('#ps-input', '078000035421');
  await page.evaluate(() => window.navigateToPage('dashboard'));
  await page.waitForTimeout(300);
  const stillHere = await shown(page, '#page-merch-scan');
  await page.click('#bn-merch-buy');
  await page.waitForSelector('#ps-ob-sheet [data-po]', { timeout: 4000 });
  check(stillHere && (await page.inputValue('#ps-input')) === '078000035421', '…tapped on Price Scan, it keeps what was typed');
  check(JSON.stringify(await lit()) === '{"bn-merch-scan":true,"bn-merch-buy":false}',
        `…and lights Price Scan even after a refused trip (${JSON.stringify(await lit())})`);
  await page.keyboard.press('Escape');
  await ctx.close();

  // At VIEW they cannot print into a buy, so no tab — the same gate as the Buy link.
  const v = await open(ASSOC({ 'merch-scan': 'view' }), { width: 390, height: 844, mobile: true });
  check(await shown(v.page, '#bn-merch-scan') && !(await shown(v.page, '#bn-merch-buy')),
        '🛑 an associate at VIEW gets Price Scan on the bar but no Buy');
  await v.ctx.close();

  // Every tool at once: six tabs. Each label must still fit its tab on a small phone.
  for (const width of [390, 360]) {
    const all = await open(ASSOC({ 'bin-dump': 'edit', mos: 'edit', 'merch-scan': 'edit', 'merch-signs': 'edit' }),
      { width, height: 800, mobile: true });
    const tabs = await all.page.evaluate(() => [...document.querySelectorAll('#bottom-nav .bn-tab')]
      .filter(t => t.offsetParent).map(t => { const r = t.getBoundingClientRect(), l = t.querySelector('.bn-lb').getBoundingClientRect();
        return { id: t.id, w: Math.round(r.width), icon: Math.round(t.querySelector('svg').getBoundingClientRect().top), lines: Math.round(l.height / 10),
                 fits: l.width <= r.width + 0.5 && l.left >= r.left - 0.5 && l.right <= r.right + 0.5 }; }));
    check(tabs.length === 6 && tabs.some(t => t.id === 'bn-merch-buy'), `${width}px: all six tabs are on the bar (${tabs.map(t => t.id).join()})`);
    check(tabs.every(t => t.fits && t.w >= 44), `${width}px: every label fits its tab, and no tab is under 44 px (${tabs.map(t => t.w).join()})`);
    // 🛑 One line each, so every icon sits level: "Sign Studio" wrapped at six tabs and its
    // taller tab lifted its icon ~6px above the rest.
    check(tabs.every(t => t.lines === 1) && new Set(tabs.map(t => t.icon)).size === 1,
          `${width}px: every label on one line, every icon level (${tabs.map(t => t.lines + '@' + t.icon).join()})`);
    await all.ctx.close();
  }
});

// ── 5. A manager is untouched ─────────────────────────────────────────────
await section('5. A manager is untouched', async () => {
  const { ctx, page } = await open({ authenticated: true, email: 'm@x.com', name: 'Alex M', role: 'manager',
    stores: ['BL1', 'BL4'], pages: {}, businesses: ['bl'] });
  await page.evaluate(() => window.navigateToPage('merch-scan'));
  await page.waitForTimeout(400);
  check(await shown(page, '#ps-manual') && await shown(page, '#ps-furniture'), 'a manager still has Manual and Furniture');
  await scan(page);
  check(/Override price or retail/.test(await page.textContent('#ps-result')), '…and Override');
  check(await shown(page, '#ps-print') && await shown(page, '#ps-ob'), '…and Print and the Buy picker');
  check(await shown(page, '#ps-tools-btn'), '…and Printer tools');
  // The bar only exists on a phone, so this has to be asked at phone width — at desktop
  // width it could never fail (it did not, when the gate was broken to prove it).
  const phone = await open({ authenticated: true, email: 'm@x.com', name: 'Alex M', role: 'manager',
    stores: ['BL1', 'BL4'], pages: {}, businesses: ['bl'] }, { width: 390, height: 844, mobile: true });
  check(await shown(phone.page, '#bn-dashboard'), 'the manager\'s phone bar is on screen');
  check(!(await shown(phone.page, '#bn-merch-scan')), '🛑 …with no Price Scan tab — it left the manager bar on 2026-09-22');
  check(!(await shown(phone.page, '#bn-merch-buy')), '🛑 …and no Buy tab: the Buy link on the page is theirs');
  await ctx.close();
});

// ── 6. Two Zebras on one PC: stickers never go to the pallet-tag printer ────────
// The store's Windows PC: a GX420d (pallet tags) listed FIRST, and the ZD410 (stickers).
await section('6. two printers on one PC', async () => {
  const { page, errs } = await open({ authenticated: true, email: 'm@x.com', name: 'Alex M', role: 'manager',
    stores: ['BL1', 'BL4'], pages: {}, businesses: ['bl'] });
  await page.evaluate(() => { window.__printers = [
    { uid: 'ZDesigner GX420d', name: 'ZDesigner GX420d', connection: 'driver' },
    { uid: 'ZDesigner ZD410-203dpi ZPL', name: 'ZDesigner ZD410-203dpi ZPL', connection: 'driver' }]; });
  await page.evaluate(() => window.navigateToPage('merch-scan'));
  await page.waitForTimeout(400);
  check((await page.textContent('#ps-printer-now')).trim() === 'Not set on this PC', 'no sticker printer chosen yet on this PC');
  await scan(page);
  await page.click('#ps-print');
  await page.click('button:text-is("ZD410")', { timeout: 3000 });
  await page.waitForFunction(() => window.__zebra.length === 1, null, { timeout: 4000 });
  const first = (await page.evaluate(() => window.__zebra))[0] || {};
  check(first.device && /ZD410/.test(first.device.name), `🔑 asked once, and the label went to the ZD410 (${first.device && first.device.name})`);
  check((await page.textContent('#ps-printer-now')).trim() === 'Now: ZD410', '…which Printer tools now names');
  await page.click('#ps-print');
  await page.waitForFunction(() => window.__zebra.length === 2, null, { timeout: 4000 });
  check(/ZD410/.test(((await page.evaluate(() => window.__zebra))[1] || {}).device?.name || ''), '…and the next print goes there without asking');
  // Choose printer, in Printer tools, asks again — and prints nothing.
  await page.click('#ps-tools-btn');
  await page.click('#ps-printer');
  await page.click('button:text-is("ZD410")', { timeout: 3000 });
  const said = await page.waitForFunction(() => /print on the ZD410/.test(document.getElementById('ps-status')?.textContent || ''),
    null, { timeout: 4000 }).then(() => true, () => false);
  check(said && (await page.evaluate(() => window.__zebra.length)) === 2, '…Choose printer asks again and says where stickers go, printing nothing');
  // The ZD410 unplugged: only the GX420d is listed.
  await page.evaluate(() => { window.__printers = [{ uid: 'ZDesigner GX420d', name: 'ZDesigner GX420d', connection: 'driver' }]; });
  await page.click('#ps-print');
  await page.waitForFunction(() => /not connected/.test(document.getElementById('ps-print-note')?.textContent || ''), null, { timeout: 4000 });
  check((await page.evaluate(() => window.__zebra.length)) === 2, '🛑 with the ZD410 gone, NOTHING is sent — not to the GX420d');
  check(/GX420D/.test(await page.textContent('#ps-print-note')), '…and the note says what IS connected');
  check(errs.length === 0, `no JS errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
});

// ── 7. The Buy sheet: an associate picks a buy and prints into it (2026-10-01) ─────
// Brian: inside Buy nothing is looked up or scanned until a buy is picked; regular scanning
// never needs one. The sheet's only exits are a pick or Cancel.
await section('7. the Buy sheet', async () => {
  const { page, errs } = await open(ASSOC({ 'merch-scan': 'edit' }));
  // 🛑 NOT shown(): it asks offsetParent, which is null for every position:fixed element, so
  // it calls the sheet hidden while it covers the screen — and "closed" checks pass vacuously.
  const sheet = () => page.evaluate(() => { const e = document.getElementById('ps-ob-sheet');
    const r = e && e.getBoundingClientRect(); return !!(r && r.width > 0 && r.height > 0); });
  const banner = async () => ((await page.textContent('#ps-ob-bar').catch(() => '')) || '').replace(/\s+/g, ' ').trim();
  await page.click('#ps-ob');
  await page.waitForSelector('#ps-ob-sheet [data-po="40211"]', { timeout: 4000 });
  check(await sheet(), '🔑 Buy opens the sheet, listing the open buys');
  const covered = await page.evaluate(() => {
    const r = document.getElementById('ps-go').getBoundingClientRect();
    return !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('#ps-ob-sheet');
  });
  check(covered, '🛑 …and covers Look it up: nothing behind it can be scanned while it is up');
  const calls = await page.evaluate(() => window.__calls);
  check(calls.includes('ps-buy-list') && !calls.includes('ob-buy-list'),
        '…read from ps-buy-list, never the Opportunity Buys page\'s list');
  await page.click('#ps-ob-sheet .ps-obs-x');
  check(!(await sheet()) && (await banner()) === '', '🔑 Cancel closes it with no buy: back to regular pricing');
  check((await page.getAttribute('#ps-ob', 'aria-pressed')) === 'false', '…and Buy reads as off');

  await page.click('#ps-ob');
  await page.waitForSelector('#ps-obs-q', { state: 'visible', timeout: 4000 });
  await page.fill('#ps-obs-q', 'kitchen');
  const rows = await page.$$eval('#ps-ob-sheet [data-po]', r => r.map(x => x.dataset.po));
  check(rows.join() === '40211', `search narrows by name (${rows.join()})`);
  await page.click('#ps-ob-sheet [data-po="40211"]');
  check(!(await sheet()), 'picking closes the sheet');
  check(/PRICING INTO/i.test(await banner()) && /PO 40211 · Kitchen/.test(await banner()) && /12 of 420 labeled/.test(await banner()),
        `🔑 …and the banner names the buy and its count (${await banner()})`);
  check((await page.getAttribute('#ps-ob', 'aria-pressed')) === 'true', '…with Buy reading as on');

  await scan(page);
  const bodies = () => page.evaluate(() => window.__bodies);
  const lastOf = async (a) => (await bodies()).filter(x => x.action === a).pop()?.body || {};
  check((await lastOf('merch-scan')).po === '40211', '🔑 the scan carries the buy');
  await page.click('#ps-print');
  await page.waitForFunction(() => window.__zebra.length >= 1, null, { timeout: 4000 });
  await page.waitForFunction(() => window.__bodies.some(x => x.action === 'sticker-printed'), null, { timeout: 4000 });
  check((await lastOf('sticker-check')).po === '40211' && (await lastOf('sticker-printed')).po === '40211',
        '🔑 …and so do the label check and the print record');
  await page.waitForFunction(() => /13 of 420 labeled/.test(document.getElementById('ps-ob-bar').textContent), null, { timeout: 4000 })
    .then(() => check(true, '…and the banner\'s count moves with the print'),
          () => check(false, `…and the banner\'s count moves with the print (${'stuck'})`));

  // Recent: the buy just picked is first next time.
  await page.click('#ps-ob');
  await page.waitForSelector('#ps-ob-sheet [data-po]', { timeout: 4000 });
  const first = await page.$eval('#ps-ob-sheet [data-po]', r => r.dataset.po);
  check(first === '40211', `Recent puts the last buy picked first (${first})`);
  await page.keyboard.press('Escape');
  check(!(await sheet()) && /PO 40211/.test(await banner()), 'Escape cancels, and the buy stays picked');

  // A reload mid-pallet keeps the buy, for the rest of the day.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__calls?.includes('auth-me'), null, { timeout: 10000 });
  await page.waitForTimeout(900);
  await page.evaluate(() => window.navigateToPage('merch-scan'));
  await page.waitForTimeout(500);
  check(/PO 40211/.test(await banner()), '🔑 after a reload the buy is still picked, not silently dropped');
  // …but only for the day it was picked: tomorrow starts in regular pricing.
  await page.evaluate(() => { const v = JSON.parse(localStorage.getItem('ps-ob')); v.day = '2020-01-01';
                              localStorage.setItem('ps-ob', JSON.stringify(v)); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__calls?.includes('auth-me'), null, { timeout: 10000 });
  await page.waitForTimeout(900);
  await page.evaluate(() => window.navigateToPage('merch-scan'));
  await page.waitForTimeout(500);
  check((await banner()) === '' && (await page.evaluate(() => localStorage.getItem('ps-ob'))) === null,
        '🔑 a buy picked on an earlier day is not carried into today');
  await page.click('#ps-ob');
  await page.click('#ps-ob-sheet [data-po="40211"]', { timeout: 4000 });

  // Closed meanwhile: the next check drops it and asks again.
  await page.evaluate(() => { window.__buys = window.__buys.filter(b => b.po !== '40211'); });
  await scan(page);
  await page.click('#ps-print');
  await page.waitForSelector('#ps-ob-sheet', { timeout: 4000 });
  check(/PO 40211 was closed/.test(await page.textContent('#ps-ob-sheet')) && (await banner()) === '',
        '🛑 a buy closed meanwhile is dropped, and the sheet asks for another');
  await page.click('#ps-ob-sheet [data-po="12345"]');
  check(/PO 12345 · Drinks/.test(await banner()), '…which a tap answers');
  await page.click('#ps-ob-bar button:text-is("Stop")');
  check((await banner()) === '' && (await page.evaluate(() => localStorage.getItem('ps-ob'))) === null,
        '🔑 Stop goes back to regular pricing, and forgets the buy');
  check(errs.length === 0, `no JS errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
});

await b.close();
srv.close();
const failed = results.filter(([ok]) => !ok);
for (const [ok, m] of results) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${m}`);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
