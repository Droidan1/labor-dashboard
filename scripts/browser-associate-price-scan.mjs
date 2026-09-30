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
  window.__calls = []; window.__saved = [];
  const J = (x, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
  window.fetch = async (u, o = {}) => {
    const action = new URL(String(u), location.href).searchParams.get('action');
    window.__calls.push(action);
    if (action === 'merch-scan-save') { try { window.__saved.push(JSON.parse(o.body)); } catch (e) {} }
    switch (action) {
      case 'auth-me': return J(who);
      case 'merch-scan': return J(SCAN);
      case 'merch-scan-save': return J({ ok: true, identifier: SCAN.identifier });
      case 'sticker-template': return J({ ok: true, template: null, markImage: null });
      case 'sticker-history': return J({ ok: true, prints: [] });
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
  check(!(await shown(page, '#ps-ob')), '…but no Buy picker without Opportunity Buys');
  const calls = await page.evaluate(() => window.__calls);
  check(calls.includes('sticker-check'), 'the sticker check ran for the Print button');
  const bad = calls.filter(a => MANAGER_ONLY.includes(a));
  check(bad.length === 0, `🛑 the page called nothing a manager-only endpoint serves (${bad.join() || 'none'})`);
  check(!/Forbidden/.test(await page.textContent('#page-merch-scan')), 'no "Forbidden" anywhere on the page');
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
  await ctx.close();
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
  await ctx.close();
});

await b.close();
srv.close();
const failed = results.filter(([ok]) => !ok);
for (const [ok, m] of results) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${m}`);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
