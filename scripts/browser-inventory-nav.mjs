// Inventory — the sidebar group and the three pages, driven in a REAL BROWSER.
//
// 🛑 NOT PART OF `scripts/test.sh`, deliberately: the runner globs `test-*` and this
// needs playwright-core and a Chromium, neither of which is a repo dependency. Run it
// by hand after a change to the Inventory nav or any of its three pages:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-inventory-nav.mjs
//
// 🔑 WHY IT EXISTS. test-nav-registry.mjs parses index.html as TEXT. It can prove every
// id exists and every data-page has a section; it cannot prove navigateToPage opens the
// page, that applyRoleUI leaves a manager a usable sidebar, or that a colour resolves.
// This change moved four already-granted pages INSIDE a group wrapper and re-pointed the
// marker the whole mobile bar layout keys off, and neither of those is visible to a text
// test. Two specific failures it pins:
//
//   1. An associate granted Bin Dump. applyAssociateNav hides every .nav-item and puts
//      back only granted ones — which now leaves the group wrapper hidden and the
//      sub-list closed around the child it just revealed. Blank sidebar.
//   2. `isAdminBar` was `vis('nav-inventory')`. nav-inventory is the group HEADER now,
//      which a manager sees, so it would report every manager as an admin and cost them
//      the centred Submit button on the phone bar.
//
// 🛑 THE APP'S THEME IS A `.dark` CLASS DRIVEN BY localStorage, NOT prefers-color-scheme.
// Setting Playwright's colorScheme renders LIGHT twice and reports dark verified when it
// was never loaded. The class is set through localStorage AND asserted before anything
// is measured.
//
// 🔑 CONTRAST IS COMPUTED from the colours the browser actually paints, against the
// composited background — CLAUDE.md requires ≥ 4.5:1 in BOTH themes, and a screenshot
// cannot tell you that. It walks every visible text node rather than a list of samples,
// so a colour added later is covered without editing this file.
//
// 🔑 playwright-core is deliberately NOT a devDependency: it pulls ~50 MB, and Cloudflare
// Pages runs `npm install` on every deploy. The cost lands on whoever runs this, once.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error(
    '\nThis check needs playwright-core, which is not a dependency of this repo.\n\n' +
    '  npm install --no-save playwright-core\n' +
    '  bash scripts/build.sh\n' +
    '  node scripts/browser-inventory-nav.mjs\n\n' +
    'A Chromium is also needed. This container ships one at /opt/pw-browsers/chromium\n' +
    '(PLAYWRIGHT_BROWSERS_PATH); elsewhere, `npx playwright install chromium`.\n');
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
await new Promise(r => srv.listen(8098, r));
const URL_ = 'http://127.0.0.1:8098/index.html';

// Two items share code 41284; two carry no cost; one is hidden; one sits in two
// Clover categories. Every one of those is a cell state the table has to show.
const ITEMS = [
  { id:'A1', name:'Downy Liquid Fabric Softener 26oz', code:'41284', sku:'41284', price:699, cost:240,
    hidden:false, defaultTaxRates:true, priceType:'FIXED', modifiedTime:Date.now()-2*864e5,
    category:'FG BL CONSUMABLES - OTHER - LAUNDRY', categoryId:'C1', categories:['FG BL CONSUMABLES - OTHER - LAUNDRY'] },
  { id:'A2', name:'Bounce Dryer Sheets 160ct', code:'41284', sku:'41284', price:799, cost:295,
    hidden:false, defaultTaxRates:true, priceType:'FIXED', modifiedTime:Date.now()-14*864e5,
    category:'FG BL CONSUMABLES - OTHER - LAUNDRY', categoryId:'C1', categories:['FG BL CONSUMABLES - OTHER - LAUNDRY'] },
  { id:'A3', name:'Dove Bar Soap 4pk', code:'38815', sku:'38815', price:599, cost:0,
    hidden:false, defaultTaxRates:true, priceType:'FIXED', modifiedTime:Date.now()-5*864e5,
    category:'FG BL CONSUMABLES - HBA - HYGIENE', categoryId:'C2', categories:['FG BL CONSUMABLES - HBA - HYGIENE'] },
  { id:'A4', name:'Bin Item $1.00', code:'BIN100', sku:'BIN100', price:100, cost:0,
    hidden:false, defaultTaxRates:true, priceType:'FIXED', modifiedTime:Date.now()-400*864e5,
    category:'Bin Products', categoryId:'C3', categories:['Bin Products','Sku Book Items'] },
  { id:'A5', name:'Christmas Light Set 300ct', code:'71002', sku:'71002', price:1299, cost:540,
    hidden:true, defaultTaxRates:true, priceType:'FIXED', modifiedTime:Date.now()-88*864e5,
    category:'FG BL SEASONAL - CHRISTMAS', categoryId:'C4', categories:['FG BL SEASONAL - CHRISTMAS'] },
];
const SCHED = { ok:true, groups:[
  { scheduleGroup:'sg_1', store:'BL1', discountKind:'percent', discountValue:30,
    startsAt:'2026-09-20T12:00:00Z', endsAt:'2026-09-22T00:00:00Z', status:'active', createdAt:'',
    items:[{ id:'A1', name:'Downy Liquid Fabric Softener 26oz', originalPrice:699, salePrice:489, status:'active' }] },
  // A revert that FAILED is the one row worth finding on that page: the register price
  // is wrong right now.
  { scheduleGroup:'sg_2', store:'BL1', discountKind:'amount', discountValue:200,
    startsAt:'2026-09-01T12:00:00Z', endsAt:'2026-09-02T00:00:00Z', status:'error', createdAt:'',
    items:[{ id:'A2', name:'Bounce Dryer Sheets 160ct', originalPrice:799, salePrice:599, status:'error',
             errorMsg:'Revert failed — item deleted in Clover' }] },
]};
// Four outcomes the endpoint really returns, including the one that refuses to create
// because the duplicate check could not answer.
const CREATE = { results:[
  { store:'BL1',  ok:true,  itemId:'NEW1', categoryCreated:false },
  { store:'BL2',  ok:true,  itemId:'NEW2', categoryCreated:true  },
  { store:'BL4',  ok:false, duplicate:true, existingId:'OLD4', error:'already exists' },
  { store:'BL8',  ok:false, stage:'duplicate-check', error:'Could not check whether 41284 is already in use — Clover returned 503. Nothing was created.' },
  { store:'BL14', ok:true,  itemId:'NEW5', categoryCreated:false },
  { store:'BL16', ok:true,  itemId:'NEW6', categoryCreated:false },
], costUpdated:true, l3Mapped:false, l3MapSkipped:null };

const results = [];
const allBlocked = new Set();
const check = (c, m) => { results.push([!!c, m]); };
const eq = (got, want, m) =>
  check(JSON.stringify(got) === JSON.stringify(want), `${m}${JSON.stringify(got) === JSON.stringify(want) ? '' : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);

const b = await chromium.launch({ executablePath: CHROME });

async function open({ role, pages = {}, dark = true, width = 1400 }) {
  const ctx = await b.newContext({ viewport: { width, height: 1000 } });
  const page = await ctx.newPage();
  // A page error is the app's fault. A resource that would not load is the network's:
  // this repo's frontend pulls Geist and Lilita One from fonts.googleapis.com, and in a
  // sandbox without egress that is a cert/tunnel failure on every single page. Counting
  // it as a JS error buried the real ones, so it is tracked separately and reported.
  const errs = [], blocked = new Set();
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource|net::ERR_/.test(m.text())) return;
    errs.push('console: ' + m.text());
  });
  page.on('requestfailed', r => {
    try { const h = new URL(r.url()).host; if (!h.startsWith('127.0.0.1')) blocked.add(h); } catch (e) {}
  });
  await page.addInitScript(d => { try { localStorage.setItem('darkMode', String(d)); } catch (e) {} }, dark);
  await page.addInitScript(({ role, pages, ITEMS, SCHED, CREATE }) => {
    window.fetch = async (u) => {
      const s = String(u);
      const J = x => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
      if (s.includes('auth-me')) return J({ authenticated: true, email: 'b@b.com', name: 'Brian',
        role, associate: role === 'associate', pages, businesses: [{ id: 'bl', name: 'Bargain Lane' }] });
      if (s.includes('inventory-items')) return J({ ok: true, elements: ITEMS, offset: 0, total: ITEMS.length, hasMore: false });
      if (s.includes('clover-categories')) return J({ ok: true, categories: [
        { id: 'C1', name: 'FG BL CONSUMABLES - OTHER - LAUNDRY' },
        { id: 'C2', name: 'FG BL CONSUMABLES - HBA - HYGIENE' }] });
      if (s.includes('list-sale-schedules')) return J(SCHED);
      if (s.includes('create-clover-item')) return J(CREATE);
      return J({ ok: true });
    };
  }, { role, pages, ITEMS, SCHED, CREATE });
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('app')?.classList.contains('hidden'), { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(350);
  // 🛑 Assert the theme actually loaded, rather than trusting the write.
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  check(isDark === dark, `theme loaded as ${dark ? 'dark' : 'light'} (html.dark=${isDark})`);
  return { ctx, page, errs, blocked };
}

// ── 1. The group, routing, and the three pages ──────────────────────────────
{
  const { ctx, page, errs, blocked } = await open({ role: 'superuser' });
  eq(await page.$$eval('#nav-inventory-sub .nav-subitem', n => n.map(x => x.querySelector('.nav-label').textContent)),
     ['Add Item','Inventory Viewer','Schedule Sale','Bin Dump','Inventory Receiver','Mark Out of Stock','Opportunity Buys'],
     'the group offers all seven children in order');
  check(await page.$eval('#nav-inventory-sub', e => e.classList.contains('hidden')), 'sub-list ships closed');
  await page.click('#nav-inventory');
  check(!(await page.$eval('#nav-inventory-sub', e => e.classList.contains('hidden'))), 'the header toggles it open');
  eq(await page.$eval('#nav-inventory-chev', e => e.style.transform), 'rotate(90deg)', 'the chevron rotates');
  await page.click('#nav-inventory');
  check(await page.$eval('#nav-inventory-sub', e => e.classList.contains('hidden')), 'and closed again');

  for (const [nav, id] of [['nav-inventory-add','page-inventory-add'],
                           ['nav-inventory-viewer','page-inventory-viewer'],
                           ['nav-inventory-sale','page-inventory-sale']]) {
    await page.$eval('#nav-inventory-sub', e => e.classList.remove('hidden'));
    await page.click('#' + nav);
    await page.waitForTimeout(200);
    eq(await page.$$eval('[id^="page-"]', ps => ps.filter(p => !p.classList.contains('hidden')).map(p => p.id)),
       [id], `${nav} shows only ${id}`);
    check(!(await page.$eval('#nav-inventory-sub', e => e.classList.contains('hidden'))),
          `${nav} leaves its group expanded`);
    eq(await page.$$eval('#nav-inventory-sub .nav-subitem.active', n => n.map(x => x.id)), [nav],
       `${nav} is the only active child`);
  }

  // Add Item: the numbers it now derives, and the L3 -> L2 binding.
  await page.click('#nav-inventory-add'); await page.waitForTimeout(150);
  await page.fill('#inv-price', '6.99'); await page.fill('#inv-cost', '2.40');
  eq(await page.$eval('#ia-gp', e => e.textContent), '65.7%', 'margin is computed while you type');
  await page.fill('#inv-cost', '');
  eq(await page.$eval('#ia-gp', e => e.textContent), '—', 'no cost reads as unknown, never 0%');
  await page.fill('#inv-code', 'ABC');
  check(await page.$eval('#ia-code-note', e => e.className.includes('warn')), 'a non-4/5-digit SKU warns BEFORE submit');
  await page.fill('#inv-l3', 'FG BL CONSUMABLES - HBA - HYGIENE');
  eq(await page.$eval('#inv-l2', e => e.value + '|' + e.disabled), 'Consumable HBA|true',
     'a built-in L3 fills and locks the reporting group');
  await page.fill('#inv-l3', 'FG BL HOME - BATH LINENS');
  check(!(await page.$eval('#inv-l2', e => e.disabled)), 'a new L3 leaves the reporting group free');
  eq(await page.$eval('#ia-l2-badge', e => e.textContent), 'new mapping', 'and says the pick becomes a mapping');

  // The six-store fan-out, and its three outcomes.
  await page.fill('#inv-name', 'T'); await page.fill('#inv-code', '41284'); await page.fill('#inv-price', '6.99');
  await page.fill('#inv-l3', 'FG BL CONSUMABLES - HBA - HYGIENE');
  await page.click('#inv-submit'); await page.waitForTimeout(500);
  eq(await page.$$eval('#inv-results-body .invres', n => n.map(x => x.className.replace('invres ',''))),
     ['ok','ok','dupe','bad','ok','ok'], 'one row per store, toned by outcome');

  // Viewer.
  await page.click('#nav-inventory-viewer'); await page.waitForTimeout(150);
  await page.evaluate(() => loadInventory(true)); await page.waitForTimeout(400);
  eq(await page.$$eval('#inv-view-tbody tr', r => r.length), 5, 'the catalog renders');
  eq(await page.$$eval('#inv-view-tbody tr', rs => rs.map(r => r.cells[6].textContent.trim())),
     ['66%','63%','—','—','58%'], 'GP% where cost exists, an em dash where it does not');
  eq(await page.$$eval('#inv-view-tbody tr.dup', r => r.length), 2,
     'duplicate codes are marked on LOAD, not only after clicking Find duplicates');
  eq(await page.$$eval('#inv-view-tbody .invbdg.b', n => n.map(x => x.textContent)), ['2 cats'],
     'an item in two Clover categories says so');
  check(!(await page.$eval('#inv-sel-toolbar', e => getComputedStyle(e).display !== 'none')),
        'the selection bar stays hidden until something is selected');
  await page.click('#inv-view-tbody tr:first-child input[type=checkbox]'); await page.waitForTimeout(120);
  check(await page.$eval('#inv-sel-toolbar', e => getComputedStyle(e).display === 'flex'),
        'and appears as a flex row when it is');

  // Schedule Sale, reached the way the Viewer offers it.
  await page.click('#inv-sel-toolbar button[onclick="openSaleModal()"]'); await page.waitForTimeout(300);
  eq(await page.$$eval('[id^="page-"]', ps => ps.filter(p => !p.classList.contains('hidden')).map(p => p.id)),
     ['page-inventory-sale'], 'scheduling from the Viewer routes to the page');
  eq(await page.$$eval('#inv-sale-items-list .invchip', n => n.length), 1, 'with the selection carried over');
  await page.fill('#inv-sale-discount-val', '25'); await page.waitForTimeout(200);
  eq((await page.$eval('#inv-sale-preview .invit:first-child .p', e => e.textContent.replace(/\s+/g,' ').trim())),
     '$6.99 → $5.24 (−25%)', 'the preview prices it the way the worker will');
  await page.click('input[name="inv-sale-kind"][value="amount"]');
  await page.fill('#inv-sale-discount-val', '99'); await page.waitForTimeout(200);
  check((await page.$eval('#inv-sale-preview .invit:first-child .p', e => e.textContent)).includes('$0.01'),
        'a discount past the price floors at one cent, as the worker does');
  await page.fill('#inv-sale-end', '2020-01-01T00:00'); await page.waitForTimeout(150);
  check(await page.$eval('#inv-sale-submit', e => e.disabled), 'a backwards window disables submit');
  eq(await page.$$eval('#inv-sched-list .invsched', n => n.length), 2, 'the schedule log renders');
  eq(await page.$$eval('#inv-sched-list .invit.errrow', n => n.length), 1, 'a failed revert is flagged in it');

  check(errs.length === 0, `no JS errors on the three pages${errs.length ? ': ' + errs.join(' | ') : ''}`);
  blocked.forEach(h => allBlocked.add(h));
  await ctx.close();
}

// ── 2. Roles. The two failures this restructure could have shipped. ─────────
for (const [role, pages, expect] of [
  ['associate', { 'bin-dump': 'edit' }, ['Bin Dump']],
  ['manager',   {},                     ['Bin Dump','Inventory Receiver','Mark Out of Stock','Opportunity Buys']],
  ['superuser', {},                     null],
]) {
  const { ctx, page, errs, blocked } = await open({ role, pages });
  const shown = await page.$$eval('#nav-inventory-sub .nav-subitem',
    n => n.filter(x => !x.classList.contains('hidden')).map(x => x.querySelector('.nav-label').textContent));
  if (expect) eq(shown, expect, `${role}: sees exactly ${expect.length} of the seven`);
  else eq(shown.length, 7, 'superuser: sees all seven');

  if (role === 'associate') {
    // 🛑 The blank-sidebar failure. The child is revealed, but the wrapper the
    // subtraction hid and the sub-list that ships closed both have to come back too.
    check(!(await page.$eval('#nav-inventory-group', e => e.classList.contains('hidden'))), 'associate: group wrapper is back');
    check(!(await page.$eval('#nav-inventory', e => e.classList.contains('hidden'))), 'associate: group header is back');
    check(!(await page.$eval('#nav-inventory-sub', e => e.classList.contains('hidden'))), 'associate: sub-list is open');
    check(await page.$$eval('#sidebar .nav-item', n => n.some(x => !x.classList.contains('hidden'))),
          'associate: the sidebar is not blank');
  }
  if (role === 'manager') {
    // 🛑 isAdminBar. nav-inventory is the group header now, which a manager sees.
    check(await page.$eval('#bn-submit-photos', e => !e.classList.contains('hidden')),
          'manager: still gets the manager bar with the centred Submit');
    await page.evaluate(() => navigateToPage('menu')); await page.waitForTimeout(100);
    check(!(await page.$('#menu-list .menu-row[data-page="inventory-add"]')),
          'manager: Add Item is not offered on the phone Menu');
    await page.evaluate(() => navigateToPage('inventory-add')); await page.waitForTimeout(150);
    check(await page.$eval('#page-inventory-add', e => e.classList.contains('hidden')),
          'manager: navigateToPage refuses Add Item');
  }
  if (role === 'superuser') {
    check(await page.$eval('#bn-submit-photos', e => e.classList.contains('hidden')), 'superuser: gets the admin bar, without Submit');
  }
  check(errs.length === 0, `${role}: no JS errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
  blocked.forEach(h => allBlocked.add(h));
  await ctx.close();
}

// ── 3. Business switching, WITHOUT re-running applyRoleUI. ──────────────────
// test-nav-registry.mjs's own header calls for this: re-running applyRoleUI resets the
// state being measured, and the bug it hides once left Bargain Lane's whole sidebar
// hidden until a hard reload. This change adds a group wrapper to NAV_BUSINESS.
{
  const { ctx, page, errs, blocked } = await open({ role: 'superuser' });
  const state = () => page.evaluate(() => ({
    group: !document.getElementById('nav-inventory-group').classList.contains('hidden'),
    header: !document.getElementById('nav-inventory').classList.contains('hidden'),
    children: [...document.querySelectorAll('#nav-inventory-sub .nav-subitem')].filter(n => !n.classList.contains('hidden')).length,
  }));
  const before = await state();
  await page.evaluate(() => applyBusinessNav('ecom'));
  check((await state()).group === false, 'entering E-Commerce hides the whole Inventory group');
  await page.evaluate(() => applyBusinessNav('bl'));
  eq(await state(), before, 'returning to Bargain Lane restores it exactly');
  await page.evaluate(() => { applyBusinessNav('ecom'); applyBusinessNav('bl'); });
  eq(await state(), before, 'and again after a second round trip');
  check(errs.length === 0, `business switch: no JS errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
  blocked.forEach(h => allBlocked.add(h));
  await ctx.close();
}

// ── 4. Phone width. ─────────────────────────────────────────────────────────
{
  const { ctx, page, errs, blocked } = await open({ role: 'superuser', width: 390 });
  for (const p of ['inventory-add', 'inventory-viewer', 'inventory-sale']) {
    await page.evaluate(x => navigateToPage(x), p);
    await page.waitForTimeout(200);
    if (p === 'inventory-viewer') { await page.evaluate(() => loadInventory(true)); await page.waitForTimeout(350); }
    const o = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth, bad = [];
      // A dense table scrolls inside its own container by design (§4.8); only things
      // OUTSIDE a horizontal scroller count as overflow.
      const inScroller = e => { for (let n = e.parentElement; n; n = n.parentElement) {
        const s = getComputedStyle(n); if (s.overflowX === 'auto' || s.overflowX === 'scroll') return true; } return false; };
      document.querySelectorAll('[id^="page-"]:not(.hidden) *').forEach(e => {
        const r = e.getBoundingClientRect();
        if (r.width && r.right > vw + 1 && !inScroller(e)) bad.push(e.id || e.className);
      });
      return { bad: bad.slice(0, 3), doc: document.documentElement.scrollWidth - vw };
    });
    eq(o.bad, [], `${p}: nothing overflows at 390px`);
    check(o.doc <= 0, `${p}: the page never scrolls sideways`);
  }
  check(errs.length === 0, `phone: no JS errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
  blocked.forEach(h => allBlocked.add(h));
  await ctx.close();
}

// ── 5. Contrast, computed from what the browser paints, in BOTH themes. ─────
for (const dark of [true, false]) {
  const { ctx, page, errs, blocked } = await open({ role: 'superuser', dark });
  const bad = await page.evaluate(async () => {
    const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v/12.92 : Math.pow((v+.055)/1.055, 2.4); };
      return .2126*f(c[0]) + .7152*f(c[1]) + .0722*f(c[2]); };
    const ratio = (a, b) => { const [h, l] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)]; return (h + .05) / (l + .05); };
    const parse = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null;
      const p = m[1].split(',').map(Number); return { rgb: p.slice(0,3), a: p.length > 3 ? p[3] : 1 }; };
    const over = (fg, a, bg) => fg.map((c, i) => c*a + bg[i]*(1-a));
    // Climb until an opaque background is found, compositing every translucent wash on
    // the way — a badge sits on a wash on a bar on a panel, and only the composite is
    // the colour a reader actually sees.
    const bgOf = node => {
      const stack = []; let e = node;
      while (e && e !== document.documentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
        e = e.parentElement;
      }
      const rootBg = parse(getComputedStyle(document.body).backgroundColor) || { rgb: [255,255,255], a: 1 };
      let base = stack.length && stack[stack.length-1].a === 1 ? stack.pop().rgb : rootBg.rgb;
      for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i].rgb, stack[i].a, base);
      return base;
    };
    const out = [], seen = new Set();
    for (const id of ['page-inventory-add','page-inventory-viewer','page-inventory-sale']) {
      document.querySelectorAll('[id^="page-"]').forEach(p => p.classList.toggle('hidden', p.id !== id));
      if (id === 'page-inventory-viewer') await loadInventory(true);
      if (id === 'page-inventory-sale') {
        invSelectedItems.set('A1', { id:'A1', name:'Downy', priceCents:699 });
        invLoadSaleComposer('BL1');
        document.getElementById('inv-sale-discount-val').value = '25';
        updateSalePreview(); await loadSaleSchedules();
      }
      if (id === 'page-inventory-add') {
        document.getElementById('inv-price').value = '6.99';
        document.getElementById('inv-cost').value = '2.40';
        document.getElementById('inv-l3').value = 'FG BL CONSUMABLES - HBA - HYGIENE';
        invAddRecalc();
        // Force the three result tones on screen; they are the strongest washes here.
        document.getElementById('inv-results').classList.remove('hidden');
        document.getElementById('inv-results-body').innerHTML =
          ['ok','dupe','bad'].map(t => `<div class="invres ${t}"><span class="s">BL1</span>` +
            `<span class="nm">Coliseum</span><span class="msg">Result <b>X</b></span></div>`).join('');
        document.getElementById('inv-results-tally').innerHTML =
          '<span class="invbdg g">1</span><span class="invbdg a">1</span><span class="invbdg r">1</span>';
      }
      const w = document.createTreeWalker(document.getElementById(id), NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        if (!n.textContent.trim()) continue;
        const e = n.parentElement, cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden' || !e.offsetParent) continue;
        const fg = parse(cs.color); if (!fg) continue;
        const bg = bgOf(e);
        const eff = fg.a < 1 ? over(fg.rgb, fg.a, bg) : fg.rgb;
        const px = parseFloat(cs.fontSize);
        const min = (px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight) >= 700)) ? 3 : 4.5;
        const key = cs.color + '|' + bg.join() + '|' + min;
        if (seen.has(key)) continue; seen.add(key);
        const r = ratio(eff, bg);
        if (r < min) out.push(`${r.toFixed(2)}:1 (min ${min}) "${n.textContent.trim().slice(0,30)}" ${cs.color} on rgb(${bg.map(Math.round).join(',')})`);
      }
    }
    return out;
  });
  check(bad.length === 0, `${dark ? 'dark' : 'light'}: every visible text node clears its AA minimum`
    + (bad.length ? '\n     ' + bad.join('\n     ') : ''));
  check(errs.length === 0, `${dark ? 'dark' : 'light'}: no JS errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
  blocked.forEach(h => allBlocked.add(h));
  await ctx.close();
}

await b.close();
srv.close();
if (allBlocked.size) {
  console.log(`\nOff-origin requests that did not load (not a page fault): ${[...allBlocked].join(', ')}`);
  console.log('The fonts are the only ones expected; anything else here is worth a look.');
}
const failed = results.filter(([ok]) => !ok);
for (const [ok, m] of results) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${m}`);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
