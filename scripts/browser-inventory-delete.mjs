// Inventory Viewer — deleting one item, or every selected item, driven in a REAL BROWSER.
//
// 🛑 NOT PART OF `scripts/test.sh`, deliberately: the runner globs `test-*` and this
// needs playwright-core and a Chromium, neither of which is a repo dependency. Run it
// by hand after any change to the Viewer's rows, its selection bar or the delete modal:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-inventory-delete.mjs
//
// 🔑 WHAT IT PINS. A delete is the one Viewer action that cannot be taken back, and
// every fault it had was a false "Deleted":
//
//   1. The store dropdown re-pointed the store before anything loaded, so a BL1 row
//      was deleted "from BL2", which does not hold that id. Nothing was deleted — and
//      the worker counts not-found as done, so the row could vanish anyway.
//   2. Any answer that was not a FAILED result read as success. A 403, an empty
//      results[] and an HTML 500 all removed the row and said "Deleted".
//   3. "Also delete from every other location" sent this store's id to the other
//      five and skipped this one. It deleted nothing, anywhere, and said it had.
//
// So every fault shape below is asserted to leave the row in place and say why, and
// each one's sentence is asserted to be distinct from the others.
//
// §7 and §7b also plant hostile text wherever an Inventory page puts it on screen —
// item names, a typed code, the worker's error bodies — on the Viewer, Schedule Sale,
// Add Item and Edit (code review inventory-1). They live here because the delete work
// is what exposed them.
//
// 🛑 THE APP'S THEME IS A `.dark` CLASS DRIVEN BY localStorage, NOT prefers-color-scheme.
// It is set through localStorage AND asserted before anything is measured — see
// browser-inventory-nav.mjs, whose contrast walk this reuses.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error(
    '\nThis check needs playwright-core, which is not a dependency of this repo.\n\n' +
    '  npm install --no-save playwright-core\n' +
    '  bash scripts/build.sh\n' +
    '  node scripts/browser-inventory-delete.mjs\n\n' +
    'A Chromium is also needed. This container ships one at /opt/pw-browsers/chromium\n' +
    '(PLAYWRIGHT_BROWSERS_PATH); elsewhere, `npx playwright install chromium`.\n');
  process.exit(2);
}
const CHROME = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.DIST || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist');
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
const PORT = Number(process.env.PORT || 8096);
await new Promise(r => srv.listen(PORT, r));
const URL_ = `http://127.0.0.1:${PORT}/index.html`;

// BL1: two items share code 41284 (so deleting one must un-mark the other), one name
// carries an apostrophe and one an inch mark — both are everyday retail names and both
// broke an attribute this row used to be built with. BL2 is a different merchant with
// its own ids, which is the whole point of the store tests.
const it = (id, name, code, price, cost, extra = {}) => ({ id, name, code, sku: code, price, cost,
  hidden: false, defaultTaxRates: true, priceType: 'FIXED', modifiedTime: Date.now() - 3 * 864e5,
  category: 'FG BL CONSUMABLES - OTHER - LAUNDRY', categoryId: 'C1',
  categories: ['FG BL CONSUMABLES - OTHER - LAUNDRY'], ...extra });
const CATALOG = {
  BL1: [
    it('A1', 'Downy Liquid Fabric Softener 26oz', '41284', 699, 240),
    it('A2', 'Bounce Dryer Sheets 160ct', '41284', 799, 295),
    it('A3', "Men's Relaxed Jeans 32x30", '38815', 1999, 700),
    it('A4', 'TV Stand 32" Oak', '71002', 4999, 2100),
    it('A5', 'Christmas Light Set 300ct', '71003', 1299, 540, { hidden: true }),
    it('A6', 'Dove Bar Soap 4pk', '38816', 599, 0),
  ],
  BL2: [
    it('B1', 'Tide Pods 42ct', '41290', 1299, 610),
    it('B2', 'Charmin Ultra Soft 12 Mega', '41291', 1599, 800),
  ],
};

const results = [];
const allBlocked = new Set();
const check = (c, m) => { results.push([!!c, m]); };
const eq = (got, want, m) =>
  check(JSON.stringify(got) === JSON.stringify(want), `${m}${JSON.stringify(got) === JSON.stringify(want) ? '' : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
// A section that throws (a button that is not there, a modal that never opens) is a
// failure of that section, recorded by name — not a crash that hides every later one.
async function section(name, fn) {
  try { await fn(); } catch (e) { check(false, `${name}: threw — ${String(e.message || e).split('\n')[0]}`); }
}

const b = await chromium.launch({ executablePath: CHROME });

async function open({ dark = true, width = 1400, height = 1000 } = {}) {
  const ctx = await b.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
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
  await page.addInitScript(({ CATALOG }) => {
    // The catalog is live: a delete that the stub answers ok REMOVES the item, so a
    // reload shows what Clover would. __plan picks a fault per item id; __delay makes
    // each delete slow enough to Stop; __del and __loads record what was asked.
    window.__catalog = JSON.parse(JSON.stringify(CATALOG));
    window.__plan = {}; window.__delay = 0;
    window.__del = []; window.__loads = [];
    window.__inflight = 0; window.__maxInflight = 0;
    window.fetch = async (u, o = {}) => {
      const s = String(u);
      const J = (x, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
      if (s.includes('auth-me')) return J({ authenticated: true, email: 'b@b.com', name: 'Brian',
        role: 'superuser', associate: false, pages: {}, businesses: [{ id: 'bl', name: 'Bargain Lane' }] });
      if (s.includes('inventory-items')) {
        const st = new URL(s).searchParams.get('store');
        window.__loads.push(st);
        if (window.__failLoad === st) return J({ ok: false, error: window.__failLoadText || 'Clover returned 503' }, 502);
        const el = window.__catalog[st] || [];
        return J({ ok: true, elements: el, offset: 0, total: el.length, hasMore: false });
      }
      if (s.includes('clover-categories')) return J({ ok: true, elements: [{ id: 'C1', name: 'FG BL CONSUMABLES - OTHER - LAUNDRY' }] });
      if (s.includes('list-sale-schedules')) return J({ ok: true, groups: window.__sched || [] });
      if (s.includes('create-clover-item')) return J(window.__create || { results: [] });
      // The real handler's failure: Clover's body passed through as `error`, with its status.
      if (s.includes('update-clover-item')) return window.__editFail
        ? J({ ok: false, error: window.__editFail, stage: 'patch' }, 502) : J({ ok: true });
      if (s.includes('delete-clover-item')) {
        const body = JSON.parse(o.body || '{}');
        window.__del.push(body);
        window.__inflight++; window.__maxInflight = Math.max(window.__maxInflight, window.__inflight);
        try {
          if (window.__delay) await new Promise(r => setTimeout(r, window.__delay));
          const mode = window.__plan[body.itemId] || 'ok';
          if (mode === 'throw') throw new TypeError('Failed to fetch');
          if (mode === 'forbidden') return J({ error: 'Forbidden' }, 403);
          if (mode === 'unclassified') return J({ error: 'Forbidden', code: 'UNCLASSIFIED_ACTION' }, 403);
          if (mode === 'session') return J({ error: 'Not authenticated' }, 401);
          if (mode === 'empty') return J({ results: [] });
          if (mode === 'html500') return new Response('<html><body>Error 1101: Worker threw exception</body></html>',
            { status: 500, headers: { 'content-type': 'text/html' } });
          if (mode === 'clover') return J({ results: [{ store: body.store, ok: false,
            error: '{"message":"Clover is temporarily unavailable"}' }] });
          // The real handler: a 404 is "already gone" and counts as done, which is
          // exactly why sending the wrong store looks like success.
          const stores = body.stores || [body.store];
          for (const st of stores) {
            const list = window.__catalog[st] || [];
            const i = list.findIndex(x => x.id === body.itemId);
            if (i >= 0) list.splice(i, 1);
          }
          return J({ results: stores.map(st => ({ store: st, ok: true })) });
        } finally { window.__inflight--; }
      }
      return J({ ok: true });
    };
  }, { CATALOG });
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('app')?.classList.contains('hidden'), { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  check(isDark === dark, `theme loaded as ${dark ? 'dark' : 'light'} (html.dark=${isDark})`);
  return { ctx, page, errs, blocked };
}

// Open the Viewer on a store and load it the way a person does: pick, press Load.
async function loadStore(page, store) {
  await page.evaluate(() => navigateToPage('inventory-viewer'));
  await page.waitForTimeout(120);
  await page.selectOption('#inv-view-store', store);
  await page.click('#page-inventory-viewer button:text-is("Load")', { timeout: 2000 });
  await page.waitForFunction(() => !document.getElementById('inv-view-table-wrap').classList.contains('hidden'), { timeout: 3000 });
  await page.waitForTimeout(120);
}
const rowNames = page => page.$$eval('#inv-view-tbody tr', rs => rs.map(r => r.querySelector('.invname')?.textContent || ''));
const row = (page, name) => page.locator('#inv-view-tbody tr', { has: page.locator('.invname', { hasText: name }) });
const modalOpen = page => page.$eval('#inv-delete-modal', e => !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none');
const viewStatus = page => page.$eval('#inv-view-status', e => e.classList.contains('hidden') ? '' : e.textContent.replace(/\s+/g, ' ').trim());
const modalStatus = page => page.$eval('#inv-del-status', e => e.classList.contains('hidden') ? '' : e.textContent.replace(/\s+/g, ' ').trim());
const selected = page => page.evaluate(() => [...invSelectedItems.keys()]);
// "In the DOM" is not "on the screen": a control a person must press is asserted by
// geometry and by what is actually under its centre.
const reachable = (handle) => handle.evaluate(e => {
  e.scrollIntoView({ block: 'center', inline: 'center' });
  const r = e.getBoundingClientRect();
  if (!r.width || !r.height) return 'zero size';
  if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight)
    return `off-screen [${[r.left, r.top, r.right, r.bottom].map(Math.round)}] in ${innerWidth}x${innerHeight}`;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return hit && (hit === e || e.contains(hit)) ? 'ok' : `covered by ${hit ? (hit.id || hit.className || hit.tagName) : 'nothing'}`;
});
async function tick(page, name) {
  await row(page, name).locator('input[type=checkbox]').check({ timeout: 2000 });
}
// Waits for the run to settle: the confirm button leaves its "Deleting…" state.
async function settle(page) {
  await page.waitForFunction(() => {
    const g = document.getElementById('inv-del-go');
    const m = document.getElementById('inv-delete-modal');
    return !g || m.classList.contains('hidden') || !/Deleting/.test(g.textContent);
  }, { timeout: 8000 });
  await page.waitForTimeout(80);
}

// ── 1. One row: the button, the modal, the one request. ─────────────────────
{
  const { ctx, page, errs, blocked } = await open();
  await section('single', async () => {
    await loadStore(page, 'BL1');
    eq((await rowNames(page)).length, 6, 'the BL1 catalog renders');
    const dels = await page.$$('#inv-view-tbody tr button:text-is("Delete")');
    eq(dels.length, 6, 'every row offers Delete');
    eq(await reachable(dels[2]), 'ok', 'a row\'s Delete is on screen and nothing covers it');

    // Edit shares the cell. An apostrophe in the name used to end the onclick attribute.
    await row(page, "Men's Relaxed Jeans").locator('button:text-is("Edit")').click({ timeout: 2000 });
    await page.waitForTimeout(150);
    check(await page.$eval('#inv-edit-modal', e => !e.classList.contains('hidden')), 'Edit opens for a name with an apostrophe');
    eq(await page.$eval('#inv-edit-name', e => e.value), "Men's Relaxed Jeans 32x30", '…and carries the whole name');
    await page.evaluate(() => closeInvModal('inv-edit-modal'));

    // Cancel sends nothing.
    await row(page, 'Downy').locator('button:text-is("Delete")').click({ timeout: 2000 });
    check(await modalOpen(page), 'Delete opens the confirmation');
    eq(await page.$eval('#inv-del-title', e => e.textContent.trim()), 'Delete item', 'titled for one item');
    check((await page.$eval('#inv-del-scope', e => e.textContent)).includes('BL1'), 'the modal names the store it deletes from');
    eq(await page.$$eval('#inv-del-list .invit .n', n => n.map(x => x.textContent)), ['Downy Liquid Fabric Softener 26oz'], 'and lists exactly the item');
    check(!(await page.$('#inv-del-all-stores')), 'the "every other location" checkbox is gone — it never deleted anything');
    check(await page.$eval('#inv-del-typed', e => e.closest('.invf').offsetParent === null), 'one item needs no typed count');
    eq(await page.evaluate(() => document.activeElement?.id), 'inv-del-cancel', 'focus starts on Cancel, not on Delete');
    await page.click('#inv-del-cancel');
    check(!(await modalOpen(page)), 'Cancel closes it');
    eq((await page.evaluate(() => window.__del)).length, 0, '…having sent nothing');

    // The delete. One POST, this store, this id, never a stores[] list.
    await row(page, 'Downy').locator('button:text-is("Delete")').click({ timeout: 2000 });
    await page.click('#inv-del-go', { timeout: 2000 });
    await settle(page);
    eq(await page.evaluate(() => window.__del), [{ store: 'BL1', itemId: 'A1' }], 'one POST: {store BL1, itemId A1}');
    check(!(await rowNames(page)).some(n => n.startsWith('Downy')), 'the row is gone');
    check(!(await modalOpen(page)), 'a clean delete closes the modal');
    const st = await viewStatus(page);
    check(/Deleted/.test(st) && st.includes('Downy') && st.includes('BL1'), `the status names the item and the store ("${st}")`);
    // Its twin shared code 41284; with one left, it is no longer a duplicate.
    check(!(await row(page, 'Bounce').evaluate(r => r.classList.contains('dup'))), 'the surviving twin is no longer marked a duplicate');
    eq(await row(page, 'Bounce').locator('.invbdg.a').count(), 0, '…and loses its dup badge');

    // A name with an inch mark. Its row's attributes used to end at the `"`, and the
    // selection (and the sale it schedules) took the name from one of them.
    await tick(page, 'TV Stand');
    eq(await page.evaluate(() => invSelectedItems.get('A4')?.name), 'TV Stand 32" Oak', 'an inch mark survives into the selection');
    eq(await row(page, 'TV Stand').locator('button:text-is("Delete")').getAttribute('aria-label'), 'Delete TV Stand 32" Oak',
       '…and into its Delete button\'s label');
    await row(page, 'TV Stand').locator('button:text-is("Delete")').click({ timeout: 2000 });
    eq(await page.$eval('#inv-del-list .invit .n', e => e.textContent), 'TV Stand 32" Oak', '…and into the modal');
    await page.click('#inv-del-go'); await settle(page);
    check((await viewStatus(page)).includes('TV Stand 32" Oak'), '…and into the status');
    eq(await selected(page), [], 'a row deleted by its own button leaves the selection too');
  });
  check(errs.length === 0, `single: no JS errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
  blocked.forEach(h => allBlocked.add(h));
  await ctx.close();
}

// ── 2. The store a delete goes to is the store the rows came from. ──────────
{
  const { ctx, page, errs, blocked } = await open();
  await section('store binding', async () => {
    await loadStore(page, 'BL1');
    // Pick BL2 but do NOT press Load: the table still holds BL1's rows.
    await page.selectOption('#inv-view-store', 'BL2');
    await row(page, 'Dove').locator('button:text-is("Delete")').click({ timeout: 2000 });
    check((await page.$eval('#inv-del-scope', e => e.textContent)).includes('BL1'),
          'with the dropdown moved but not loaded, the modal still says BL1');
    await page.click('#inv-del-go'); await settle(page);
    eq(await page.evaluate(() => window.__del), [{ store: 'BL1', itemId: 'A6' }],
       '🛑 the POST goes to BL1, where the row lives — not to the dropdown');
    eq(await page.evaluate(() => window.__catalog.BL1.some(x => x.id === 'A6')), false, '…and the item is really gone from BL1');

    // Scheduling a sale from rows ticked while the dropdown says BL2: their ids are BL1's.
    await tick(page, 'Bounce');
    await page.click('#inv-sel-toolbar button:has-text("Schedule sale")');
    await page.waitForTimeout(250);
    eq(await page.$$eval('.inv-sale-store-cb:checked', n => n.map(x => x.value)), ['BL1'],
       'Schedule sale preselects BL1, where the ticked rows came from — not the dropdown');
    await page.evaluate(() => navigateToPage('inventory-viewer')); await page.waitForTimeout(150);

    // A selection names rows on screen. Loading another store takes them off it.
    await page.selectOption('#inv-view-store', 'BL1');
    await tick(page, 'Bounce');
    eq(await selected(page), ['A2'], 'a ticked row is selected');
    await loadStore(page, 'BL2');
    eq(await rowNames(page), ['Tide Pods 42ct', 'Charmin Ultra Soft 12 Mega'], 'BL2 loads');
    eq(await selected(page), [], 'loading another store drops the selection');
    check(await page.$eval('#inv-sel-toolbar', e => getComputedStyle(e).display === 'none'), '…and hides its bar');

    // Find duplicates must not mark one store's catalog under another store's name.
    await page.selectOption('#inv-view-store', 'BL1');
    const before = (await page.evaluate(() => window.__loads)).length;
    await page.click('#inv-btn-dup'); await page.waitForTimeout(300);
    eq((await page.evaluate(() => window.__loads)).slice(before), ['BL1'],
       'Find duplicates loads the store the dropdown names when it differs from the loaded one');

    // A load that fails must not leave the store before it on screen under the new name:
    // a search re-renders from what the last load left behind.
    await loadStore(page, 'BL1');
    await page.evaluate(() => { window.__failLoad = 'BL2'; });
    await page.selectOption('#inv-view-store', 'BL2');
    await page.click('#page-inventory-viewer button:text-is("Load")');
    await page.waitForTimeout(300);
    check((await viewStatus(page)).includes('503'), `the failed load says so ("${await viewStatus(page)}")`);
    await page.fill('#inv-view-search', 'o'); await page.waitForTimeout(150);
    eq((await rowNames(page)).filter(Boolean), [], 'after a failed BL2 load, a search shows none of BL1\'s rows');
  });
  check(errs.length === 0, `store binding: no JS errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
  blocked.forEach(h => allBlocked.add(h));
  await ctx.close();
}

// ── 3. Only a result that says ok is a delete. Every other answer is a fault. ─
{
  const { ctx, page, errs, blocked } = await open();
  await section('faults', async () => {
    await loadStore(page, 'BL1');
    const modes = {
      forbidden: /admin/i, unclassified: /deploy/i, session: /session/i, empty: /no result/i,
      html500: /500/, clover: /temporarily unavailable/, throw: /reach/i,
    };
    const sentences = [];
    for (const [mode, want] of Object.entries(modes)) {
      await page.evaluate(m => { window.__plan = { A3: m }; window.__del = []; }, mode);
      await row(page, "Men's Relaxed Jeans").locator('button:text-is("Delete")').click({ timeout: 2000 });
      await page.click('#inv-del-go', { timeout: 2000 });
      await settle(page);
      check((await rowNames(page)).includes("Men's Relaxed Jeans 32x30"), `${mode}: the row stays`);
      check(await modalOpen(page), `${mode}: the modal stays open to say why`);
      const why = await modalStatus(page);
      check(want.test(why), `${mode}: the reason says what happened ("${why}")`);
      check(await page.$eval('#inv-del-status', e => e.classList.contains('err')), `${mode}: shown as a failure, not a success`);
      check(!/Deleted/.test(await viewStatus(page)), `${mode}: nothing claims it was deleted`);
      eq(await page.$eval('#inv-del-cancel', e => e.textContent.trim()), 'Close', `${mode}: the way out says Close`);
      sentences.push(why);
      await page.click('#inv-del-cancel');
    }
    eq(new Set(sentences).size, sentences.length, 'every fault reads differently');
    // And the same row deletes cleanly once the fault clears.
    await page.evaluate(() => { window.__plan = {}; window.__del = []; });
    await row(page, "Men's Relaxed Jeans").locator('button:text-is("Delete")').click({ timeout: 2000 });
    await page.click('#inv-del-go'); await settle(page);
    check(!(await rowNames(page)).includes("Men's Relaxed Jeans 32x30"), 'a retry after the fault clears deletes it');
  });
  check(errs.length === 0, `faults: no JS errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
  blocked.forEach(h => allBlocked.add(h));
  await ctx.close();
}

// ── 4. Bulk: the selection bar, the typed count, one request at a time. ─────
{
  const { ctx, page, errs, blocked } = await open();
  await section('bulk', async () => {
    await loadStore(page, 'BL1');
    for (const n of ['Downy', 'Bounce', 'Dove']) await tick(page, n);
    const bar = await page.$('#inv-sel-toolbar button:has-text("Delete")');
    check(!!bar, 'the selection bar offers Delete');
    eq(await reachable(bar), 'ok', '…on screen and uncovered');
    // On a desktop the buttons share the sentence's row; only a phone drops them below.
    const rowsShared = await page.evaluate(() => {
      const t = document.querySelector('#inv-sel-toolbar > span:nth-of-type(2)').getBoundingClientRect();
      return [...document.querySelectorAll('#inv-sel-toolbar button')].every(b => {
        const r = b.getBoundingClientRect(); return r.top < t.bottom && r.bottom > t.top; });
    });
    check(rowsShared, 'at 1400px the bar\'s buttons sit on the sentence\'s row, not wrapped under it');
    await bar.click();
    check(await modalOpen(page), 'it opens the confirmation');
    eq(await page.$eval('#inv-del-title', e => e.textContent.trim()), 'Delete 3 items', 'titled with the count');
    eq(await page.$$eval('#inv-del-list .invit .n', n => n.map(x => x.textContent)),
       ['Downy Liquid Fabric Softener 26oz', 'Bounce Dryer Sheets 160ct', 'Dove Bar Soap 4pk'], 'listing every item that will go');
    check(await page.$eval('#inv-del-go', e => e.disabled), 'Delete waits for the typed count');
    eq(await page.evaluate(() => document.activeElement?.id), 'inv-del-typed', 'focus starts in the count box');
    await page.fill('#inv-del-typed', '2');
    check(await page.$eval('#inv-del-go', e => e.disabled), 'the wrong count keeps it shut');
    await page.evaluate(() => confirmDelete()); await page.waitForTimeout(150);
    eq((await page.evaluate(() => window.__del)).length, 0,
       'confirmDelete itself refuses the wrong count — a backstop behind the disabled button');
    await page.fill('#inv-del-typed', '3');
    check(!(await page.$eval('#inv-del-go', e => e.disabled)), 'the right count opens it');
    eq(await page.$eval('#inv-del-go', e => e.textContent.trim()), 'Delete 3 items', 'the button says how many');
    await page.click('#inv-del-go'); await settle(page);
    eq(await page.evaluate(() => window.__del), [
      { store: 'BL1', itemId: 'A1' }, { store: 'BL1', itemId: 'A2' }, { store: 'BL1', itemId: 'A6' }],
      'one POST per item, each for BL1 only');
    eq(await page.evaluate(() => window.__maxInflight), 1, 'one at a time, never in parallel');
    eq(await rowNames(page), ["Men's Relaxed Jeans 32x30", 'TV Stand 32" Oak', 'Christmas Light Set 300ct'], 'the three rows are gone');
    eq(await selected(page), [], 'the selection is empty');
    check(await page.$eval('#inv-sel-toolbar', e => getComputedStyle(e).display === 'none'), '…so its bar is hidden');
    check(!(await modalOpen(page)), 'a clean run closes the modal');
    check(/Deleted 3 items/.test(await viewStatus(page)) && (await viewStatus(page)).includes('BL1'),
          `the status gives the count and the store ("${await viewStatus(page)}")`);

    // Second render (§4.8 trap 8): search, sort and a further delete still work.
    await page.fill('#inv-view-search', 'stand'); await page.waitForTimeout(120);
    eq(await rowNames(page), ['TV Stand 32" Oak'], 'search still filters after a delete');
    await page.fill('#inv-view-search', ''); await page.waitForTimeout(80);
    await page.click('th:has-text("Price")'); await page.waitForTimeout(80);
    eq((await rowNames(page))[0], 'Christmas Light Set 300ct', 'sort still sorts after a delete');
    await row(page, 'Christmas').locator('button:text-is("Delete")').click({ timeout: 2000 });
    await page.click('#inv-del-go'); await settle(page);
    eq(await rowNames(page), ["Men's Relaxed Jeans 32x30", 'TV Stand 32" Oak'], 'and a further delete still deletes, in price order');

    // Select-all over a search, then delete what it ticked: the header box must not
    // stay ticked over rows that are gone.
    await page.fill('#inv-view-search', 'stand'); await page.waitForTimeout(120);
    await page.check('#inv-sel-all');
    eq(await selected(page), ['A4'], 'select-all ticks the one row the search shows');
    await page.click('#inv-sel-delete');
    await page.click('#inv-del-go'); await settle(page);
    check(!(await page.$eval('#inv-sel-all', e => e.checked)), 'with its rows deleted, select-all is not left ticked');
  });
  check(errs.length === 0, `bulk: no JS errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
  blocked.forEach(h => allBlocked.add(h));
  await ctx.close();
}

// ── 5. A run that half-fails, and a run that is stopped. ────────────────────
{
  const { ctx, page, errs, blocked } = await open();
  await section('partial and stop', async () => {
    await loadStore(page, 'BL1');
    await page.evaluate(() => { window.__plan = { A2: 'clover' }; });
    for (const n of ['Downy', 'Bounce', 'Dove', 'Christmas']) await tick(page, n);
    await page.click('#inv-sel-toolbar button:has-text("Delete")');
    await page.fill('#inv-del-typed', '4');
    await page.click('#inv-del-go'); await settle(page);
    eq((await page.evaluate(() => window.__del)).length, 4, 'a failure does not stop the others');
    eq(await rowNames(page), ['Bounce Dryer Sheets 160ct', "Men's Relaxed Jeans 32x30", 'TV Stand 32" Oak'],
       'the three that went are gone; the one Clover refused stays');
    eq(await selected(page), ['A2'], 'only the failed item is still selected, ready to retry');
    check(await modalOpen(page), 'the modal stays open when anything failed');
    const why = await modalStatus(page);
    check(/3 of 4/.test(why), `the summary counts ("${why}")`);
    eq(await page.$$eval('#inv-del-list .invit', n => n.map(x => x.querySelector('.invbdg')?.textContent.trim())),
       ['deleted', 'failed', 'deleted', 'deleted'], 'each item says what happened to it');
    check((await page.$eval('#inv-del-list .invit.errrow', e => e.textContent)).includes('temporarily unavailable'),
          'the failed item carries Clover\'s reason');
    check(await page.$eval('#inv-del-go', e => e.offsetParent === null || e.disabled), 'there is no second Delete to press by accident');
    eq(await page.evaluate(() => document.activeElement?.id), 'inv-del-cancel', 'focus moves to Close, not onto nothing');
    await page.click('#inv-del-cancel');
    check(!(await modalOpen(page)), 'Close closes it');
    const after = await viewStatus(page);
    check(after.includes('3 of 4'), `and the Viewer's status keeps the count ("${after}")`);
    check(after.includes('temporarily unavailable') && !/under (it|each)/.test(after),
          '…and carries the reason itself, not a pointer to the list that just closed');

    // Retry from the bar: the failed item alone, one click (a selection of one).
    await page.evaluate(() => { window.__plan = {}; window.__del = []; });
    await page.click('#inv-sel-toolbar button:has-text("Delete")');
    eq(await page.$eval('#inv-del-title', e => e.textContent.trim()), 'Delete item', 'the retry holds only the failed item');
    await page.click('#inv-del-go'); await settle(page);
    eq(await page.evaluate(() => window.__del), [{ store: 'BL1', itemId: 'A2' }], 'and deletes it');

    // Stop: the request in flight finishes, nothing after it starts.
    await loadStore(page, 'BL2');
    await page.evaluate(() => { window.__catalog.BL2.push(
      { id: 'B3', name: 'Bic Lighters 5pk', code: '41292', sku: '41292', price: 499, cost: 200, hidden: false, defaultTaxRates: true, modifiedTime: 0, category: 'X', categoryId: 'C1', categories: ['X'] }); });
    await loadStore(page, 'BL2');
    await page.evaluate(() => { window.__del = []; window.__delay = 500; });
    for (const n of ['Tide', 'Charmin', 'Bic']) await tick(page, n);
    await page.click('#inv-sel-toolbar button:has-text("Delete")');
    await page.fill('#inv-del-typed', '3');
    await page.click('#inv-del-go');
    await page.waitForTimeout(150);
    eq(await page.$eval('#inv-del-cancel', e => e.textContent.trim()), 'Stop', 'while it runs, the way out is Stop');
    await page.click('#inv-del-cancel');
    await settle(page);
    eq(await page.evaluate(() => window.__del), [{ store: 'BL2', itemId: 'B1' }], 'Stop lets the one in flight finish and starts no other');
    eq(await rowNames(page), ['Charmin Ultra Soft 12 Mega', 'Bic Lighters 5pk'], 'only that one is gone');
    eq(await selected(page), ['B2', 'B3'], 'the two never tried are still selected');
    eq(await page.$$eval('#inv-del-list .invit', n => n.map(x => x.querySelector('.invbdg')?.textContent.trim())),
       ['deleted', 'not tried', 'not tried'], 'and say so');
    check(/stopped/i.test(await modalStatus(page)), `the summary says it was stopped ("${await modalStatus(page)}")`);
  });
  check(errs.length === 0, `partial and stop: no JS errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
  blocked.forEach(h => allBlocked.add(h));
  await ctx.close();
}

// ── 6. A phone. ─────────────────────────────────────────────────────────────
{
  const { ctx, page, errs, blocked } = await open({ width: 390, height: 780 });
  await section('phone', async () => {
    await loadStore(page, 'BL1');
    for (const n of ['Downy', 'Bounce', 'Dove']) await tick(page, n);
    const o = await page.evaluate(() => {
      const bar = document.getElementById('inv-sel-toolbar');
      const vw = document.documentElement.clientWidth;
      return { right: Math.round(bar.getBoundingClientRect().right), vw,
        kids: [...bar.querySelectorAll('button')].map(b => Math.round(b.getBoundingClientRect().right)),
        doc: document.documentElement.scrollWidth - vw };
    });
    check(o.kids.every(r => r <= o.vw) && o.right <= o.vw, `the selection bar and its buttons fit (${JSON.stringify(o)})`);
    check(o.doc <= 0, 'the page never scrolls sideways');
    for (const t of ['Clear', 'Delete', 'Schedule sale']) {
      eq(await reachable(await page.$(`#inv-sel-toolbar button:has-text("${t}")`)), 'ok', `"${t}" is reachable at 390px`);
    }
    await page.click('#inv-sel-toolbar button:has-text("Delete")');
    for (const id of ['inv-del-typed', 'inv-del-cancel', 'inv-del-go']) {
      eq(await reachable(await page.$('#' + id)), 'ok', `#${id} is reachable at 390px`);
    }
    const box = await page.$eval('#inv-delete-modal .invp', e => { const r = e.getBoundingClientRect(); return [r.left, r.right, innerWidth]; });
    check(box[0] >= 0 && box[1] <= box[2], `the modal fits the width (${box.map(Math.round)})`);
  });
  check(errs.length === 0, `phone: no JS errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
  blocked.forEach(h => allBlocked.add(h));
  await ctx.close();
}

// ── 7. A name built to break out of an attribute (code review inventory-1). ──
// Anyone who can rename an item in Clover sets its name. The row used to put it in
// attributes unescaped, and a hover ran it in an admin's session. Fixing the row made the
// WHOLE name travel on — into the selection, the Sale page and the stored schedule log —
// so every place it lands is checked, not just the row. One name per quote style.
{
  const { ctx, page, errs, blocked } = await open();
  await section('hostile name', async () => {
    const EVIL2 = 'Evil 2" onmouseover="window.__pwned=(window.__pwned||0)+1" x="';
    const EVIL1 = "Evil 1' onmouseover='window.__pwned=(window.__pwned||0)+1' x='";
    await page.evaluate(({ a, b }) => {
      const mk = (id, name, code) => ({ id, name, code, sku: code, price: 499, cost: 100, hidden: false,
        defaultTaxRates: true, modifiedTime: 0, category: 'X', categoryId: 'C1', categories: ['X'] });
      window.__catalog.BL1.push(mk('H2', a, '90002'), mk('H1', b, '90001'));
      window.__sched = [{ scheduleGroup: 'sg_h', store: 'BL1', discountKind: 'percent', discountValue: 10,
        startsAt: '2026-10-01T12:00:00Z', endsAt: '2026-10-03T12:00:00Z', status: 'error', createdAt: '',
        items: [{ id: 'H2', name: a, originalPrice: 499, salePrice: 449, status: 'error', errorMsg: 'revert failed' },
                { id: 'H1', name: b, originalPrice: 499, salePrice: 449, status: 'active' }] }];
    }, { a: EVIL2, b: EVIL1 });
    await loadStore(page, 'BL1');
    const injected = sel => page.$$eval(sel, n => n.filter(e => e.hasAttribute('onmouseover')).length);
    const hoverAll = async sel => { for (const h of await page.$$(sel)) { try { await h.hover({ timeout: 500 }); } catch (e) {} } };
    eq(await injected('#inv-view-tbody *'), 0, 'the Viewer rows carry no injected handler');
    await hoverAll('#inv-view-tbody tr:nth-last-child(-n+2) *');
    await tick(page, 'Evil 2'); await tick(page, 'Evil 1');
    eq(await page.evaluate(() => [invSelectedItems.get('H2')?.name, invSelectedItems.get('H1')?.name]), [EVIL2, EVIL1],
       'both names reach the selection whole');
    await page.click('#inv-sel-delete');
    eq(await injected('#inv-delete-modal *'), 0, 'the delete modal carries none');
    eq(await page.$$eval('#inv-del-list .invit .n', n => n.map(x => x.textContent)), [EVIL2, EVIL1], '…and shows both names as text');
    await hoverAll('#inv-del-list *');
    await page.click('#inv-del-cancel');
    await page.click('#inv-sel-toolbar button:has-text("Schedule sale")'); await page.waitForTimeout(300);
    await page.fill('#inv-sale-discount-val', '10'); await page.waitForTimeout(200);
    eq(await page.$$eval('#inv-sched-list .invit .n', n => n.length), 2, 'the schedule log is showing the stored names');
    eq(await injected('#page-inventory-sale *'), 0, 'Schedule Sale — chips, preview and log — carries none');
    eq(await page.$$eval('#inv-sale-items-list .invchip .invname', n => n.map(x => x.textContent)), [EVIL2, EVIL1],
       '…and shows both names whole');
    await hoverAll('#inv-sale-items-list *'); await hoverAll('#inv-sale-preview *'); await hoverAll('#inv-sched-list *');
    // The chip's × carries its id as JSON now; it must still remove that one item.
    await page.click('#inv-sale-items-list .invchip:first-child .x');
    eq(await page.evaluate(() => [...invSelectedItems.keys()]), ['H1'], "a chip's × still removes its own item");
    eq(await page.evaluate(() => window.__pwned || 0), 0, '🛑 no hover anywhere ran the name');
  });
  check(errs.length === 0, `hostile name: no JS errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
  blocked.forEach(h => allBlocked.add(h));
  await ctx.close();
}

// ── 7b. Hostile TEXT on Add Item and Edit (the rest of inventory-1). ──────────
// Add Item's "Open in Viewer" carried the TYPED code inside a single-quoted JS string in a
// double-quoted onclick. The Viewer's load error and Edit's save error put the worker's
// text into innerHTML — and that text is Clover's raw body, or a category name typed into
// Edit and echoed back ("Could not resolve category …"). Three sections, so each sink
// fails on its own against a build that lacks its fix.
{
  const { ctx, page, errs, blocked } = await open();
  const CODE = `9'1"2`;
  const BAIT = '<img src=x onerror="window.__pwned=(window.__pwned||0)+1">';
  await section('Add Item: a typed code with both quotes', async () => {
    await page.evaluate(bait => {
      window.__create = { results: [
        { store: 'BL4', ok: false, duplicate: true, existingId: 'OLD4', error: 'already exists' },
        { store: 'BL8', ok: false, stage: 'item', error: bait + 'Clover said no' },
      ], costUpdated: false, l3Mapped: false, l3MapSkipped: bait + 'a built-in' };
    }, BAIT);
    await page.evaluate(() => navigateToPage('inventory-add')); await page.waitForTimeout(150);
    await page.fill('#inv-name', 'Hostile code test');
    await page.fill('#inv-code', CODE);
    await page.fill('#inv-price', '4.99');
    await page.fill('#inv-l3', 'FG BL CONSUMABLES - HBA - HYGIENE');   // a built-in: L2 fills itself
    await page.click('#inv-submit'); await page.waitForTimeout(400);
    eq(await page.$$eval('#inv-results-body .invres', n => n.map(x => x.className.replace('invres ', ''))), ['dupe', 'bad'],
       'the results render, one row per store');
    // The create path's own error texts were already escaped; pinned so they stay that way.
    eq(await page.$$eval('#page-inventory-add *', n => n.filter(e => e.tagName === 'IMG' || e.hasAttribute('onerror')).length), 0,
       'Add Item holds no img and no injected handler');
    await page.click('#inv-results-body .invres.dupe button:has-text("Open in Viewer")', { timeout: 2000 });
    await page.waitForTimeout(400);
    eq(await page.$$eval('[id^="page-"]', ps => ps.filter(p => !p.classList.contains('hidden')).map(p => p.id)),
       ['page-inventory-viewer'], '"Open in Viewer" opens the Viewer for a code holding both quotes');
    eq(await page.$eval('#inv-view-search', e => e.value), CODE, '…with that exact code in the search');
    eq(await page.$eval('#inv-view-store', e => e.value), 'BL4', '…on the store the result named');
  });
  await section('Viewer: a load error carrying markup', async () => {
    await page.evaluate(bait => { window.__failLoad = 'BL2'; window.__failLoadText = bait + 'Clover returned 503'; }, BAIT);
    await page.evaluate(() => navigateToPage('inventory-viewer')); await page.waitForTimeout(150);
    await page.selectOption('#inv-view-store', 'BL2');
    await page.click('#page-inventory-viewer button:text-is("Load")'); await page.waitForTimeout(400);
    eq(await page.$$eval('#inv-view-status img', n => n.length), 0, 'a failed load shows its error as text: no img');
    check((await page.$eval('#inv-view-status', e => e.textContent)).includes('<img src=x'),
          '…the markup shows as characters, so the reader still sees what came back');
  });
  await section('Edit: a save error carrying markup', async () => {
    await page.evaluate(() => { window.__failLoad = null; });
    // "Open in Viewer" left the typed code in the search; it would filter BL1 to nothing.
    await page.fill('#inv-view-search', '');
    await loadStore(page, 'BL1');
    await page.evaluate(bait => { window.__editFail = bait + 'Clover rejected the patch'; }, BAIT);
    await row(page, 'Downy').locator('button:text-is("Edit")').click({ timeout: 2000 });
    await page.click('#inv-edit-modal button:has-text("Save changes")'); await page.waitForTimeout(400);
    eq(await page.$$eval('#inv-edit-status img', n => n.length), 0, 'a failed Edit save shows its error as text: no img');
    check((await page.$eval('#inv-edit-status', e => e.textContent)).includes('Clover rejected the patch'),
          '…and still says what the worker said');
  });
  await page.waitForTimeout(200);
  eq(await page.evaluate(() => window.__pwned || 0), 0, '🛑 nothing Add Item, the Viewer or Edit showed was run');
  check(errs.length === 0, `hostile text: no JS errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
  blocked.forEach(h => allBlocked.add(h));
  await ctx.close();
}

// ── 8. Contrast, computed from what the browser paints, in BOTH themes. ─────
// Every visible text node under a root, measured against its COMPOSITED background — a
// badge sits on a wash on a row on a panel, and only the composite is what a reader
// sees. Same walk as browser-inventory-nav.mjs. Returns the failures and the lowest
// ratio, so a comment that quotes a ratio can be checked against what was painted.
const SWEEP = (root) => {
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v/12.92 : Math.pow((v+.055)/1.055, 2.4); };
    return .2126*f(c[0]) + .7152*f(c[1]) + .0722*f(c[2]); };
  const ratio = (a, b) => { const [h, l] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)]; return (h + .05) / (l + .05); };
  const parse = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const p = m[1].split(',').map(Number); return { rgb: p.slice(0,3), a: p.length > 3 ? p[3] : 1 }; };
  const over = (fg, a, bg) => fg.map((c, i) => c*a + bg[i]*(1-a));
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
  let count = 0, lowest = Infinity;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    if (!n.textContent.trim()) continue;
    const e = n.parentElement, cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || !e.getClientRects().length) continue;
    // A disabled control is exempt from AA (WCAG 1.4.3), and its .45 opacity is not in `color`.
    if (e.closest('button:disabled')) continue;
    count++;
    const fg = parse(cs.color); if (!fg) continue;
    const bg = bgOf(e);
    const eff = fg.a < 1 ? over(fg.rgb, fg.a, bg) : fg.rgb;
    const px = parseFloat(cs.fontSize);
    const min = (px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight) >= 700)) ? 3 : 4.5;
    const r = ratio(eff, bg);
    lowest = Math.min(lowest, r);
    const key = cs.color + '|' + bg.join() + '|' + min;
    if (seen.has(key)) continue; seen.add(key);
    if (r < min) out.push(`${r.toFixed(2)}:1 (min ${min}) "${n.textContent.trim().slice(0,30)}" ${cs.color} on rgb(${bg.map(Math.round).join(',')})`);
  }
  return { out, count, lowest };
};
for (const dark of [true, false]) {
  const theme = dark ? 'dark' : 'light';
  const { ctx, page, errs, blocked } = await open({ dark });
  await section(`contrast ${theme}`, async () => {
    await loadStore(page, 'BL1');
    // Downy and Bounce share a code, so their rows are amber (dup) as well as selected;
    // Men's is selected only, so its row is green.
    for (const n of ['Downy', 'Bounce', "Men's Relaxed"]) await tick(page, n);
    const sweep = (sel) => page.$eval(sel, (root, src) => (0, eval)(src)(root), `(${SWEEP})`);
    // .invbtn carries a .15s colour transition: measure the settled frame, not t=0.
    await page.waitForTimeout(250);
    const found = [];
    const a = await sweep('#page-inventory-viewer');
    found.push(...a.out);
    const bar = await sweep('#inv-sel-delete');
    check(bar.count === 1, `${theme}: the bar's Delete was measured (${bar.lowest.toFixed(2)}:1 on the blue wash)`);
    found.push(...bar.out);
    // Hovering a row's Delete lays the button's own red wash over the row's wash.
    for (const [name, what] of [['Downy', 'a selected duplicate row (amber)'], ["Men's Relaxed", 'a selected row (green)']]) {
      await row(page, name).locator('button:text-is("Delete")').hover();
      await page.waitForTimeout(250);
      const h = await page.evaluate(({ nm, src }) => {
        const r = [...document.querySelectorAll('#inv-view-tbody tr')].find(t => t.textContent.includes(nm));
        return (0, eval)(src)(r.querySelector('button.invbtn-danger'));
      }, { nm: name, src: `(${SWEEP})` });
      check(h.count === 1, `${theme}: hovered Delete on ${what} measured ${h.lowest.toFixed(2)}:1`);
      found.push(...h.out.map(x => `hovered on ${what}: ${x}`));
    }
    await page.mouse.move(0, 0);
    await page.click('#inv-sel-delete');
    await page.fill('#inv-del-typed', '3'); await page.waitForTimeout(250);
    const asking = await sweep('#inv-delete-modal');
    found.push(...asking.out);
    await page.evaluate(() => { window.__plan = { A2: 'clover' }; });
    await page.click('#inv-del-go'); await settle(page); await page.waitForTimeout(250);
    const after = await sweep('#inv-delete-modal');
    found.push(...after.out);
    eq(await page.$$eval('#inv-del-list .invit .invbdg', n => n.map(x => x.textContent)), ['deleted', 'failed', 'deleted'],
       `${theme}: the half-failed modal is the state being measured`);
    check(a.count > 20 && asking.count > 5 && after.count > 5,
          `${theme}: the sweeps measured something (${a.count}/${asking.count}/${after.count} text nodes)`);
    check(found.length === 0, `${theme}: every visible text node clears its AA minimum`
      + (found.length ? '\n     ' + found.join('\n     ') : ''));
  });
  check(errs.length === 0, `${theme}: no JS errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
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
