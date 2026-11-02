// Supply Request for an associate, driven in a REAL BROWSER.
//
// 🛑 NOT PART OF `scripts/test.sh` — it needs playwright-core and a Chromium, like every
// browser-*.mjs. Run it by hand after touching associate navigation or the Supply Request page:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-associate-supply.mjs
//   (on a Mac: PLAYWRIGHT_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
//
// 🔑 WHY IT EXISTS. test-associate drives the WORKER: who may read, submit and comment, and
// that cost, invoice # and the budget never leave it for an associate. It cannot see that an
// associate granted Supply Request can open the page at all — it sat on the shell's
// FINANCIAL_PAGES list — or that the page stops asking for the budget and stops offering a
// form or a comment box the worker would refuse at view.
// Decisions pinned (Brian, 2026-11-02): no money at either level; they see their stores'
// requests, as a manager does; edit submits and comments.
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
const SHOTS = process.env.SHOTS_DIR || null;

const results = [];
const check = (c, m) => { results.push([!!c, m]); };

// What the worker answers. An associate's rows come back WITHOUT cost and invoice_number
// (supplyWithoutMoney); a manager's carry both.
const REQ = { id: 'r1', user_email: 'Ed Supply', store: 'BL1', status: 'under_review', priority: 'normal',
  notes: 'back room', submitted_at: '2026-11-01T14:00:00Z', updated_at: '2026-11-01T14:00:00Z', item_count: 1 };
const MONEY = { invoice_number: 'INV-77', cost: 123.45 };

function mocks({ who, REQ, MONEY, dark, empty }) {
  try {
    localStorage.setItem('bioPromptDismissed', '1'); localStorage.setItem('coachTipsDisabled', '1');
    localStorage.setItem('darkMode', dark ? 'true' : 'false');
  } catch (e) {}
  window.__calls = [];
  const J = (x, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
  const row = who.associate ? REQ : { ...REQ, ...MONEY };
  window.fetch = async (u, o = {}) => {
    const action = new URL(String(u), location.href).searchParams.get('action');
    window.__calls.push(action);
    switch (action) {
      case 'auth-me': return J(who);
      case 'supply-requests': return J({ ok: true, requests: empty ? [] : [row], total: empty ? 0 : 1 });
      case 'supply-request': return J({ ok: true, request: { ...row,
        items: [{ id: 'i1', category: 'Cleaning', item_name: 'Trash bags', quantity: 4, unit: 'boxes', notes: '' }],
        history: [{ type: 'status_change', changed_by_email: 'Ed Supply', new_status: 'pending', note: 'Request submitted',
                    changed_at: '2026-11-01T14:00:00Z' }] } });
      case 'supply-budgets': return who.associate ? J({ error: 'Forbidden' }, 403)
        : J({ ok: true, year: 2026, month: 11, budgets: [{ store: 'BL1', label: 'Elkhart', budget: 500, spent: 123.45, remaining: 376.55 }] });
      // Anything else is what the worker would refuse an associate — so if the page calls
      // it, the check below that lists calls says so.
      default: return J({ error: 'Forbidden' }, 403);
    }
  };
}

const b = await chromium.launch({ executablePath: CHROME });
const live = new Set();
async function open(who, { width = 1280, height = 800, mobile = false, dark = false, empty = false } = {}) {
  const ctx = await b.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
  live.add(ctx);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.route(u => !u.href.startsWith(ORIGIN), r => r.abort());
  await page.addInitScript(mocks, { who, REQ, MONEY, dark, empty });
  await page.goto(ORIGIN + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__calls?.includes('auth-me'), null, { timeout: 10000 });
  await page.waitForTimeout(900);
  return { ctx, page, errs };
}
const shown = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!(e && e.offsetParent); }, sel);
const calls = (page) => page.evaluate(() => window.__calls.slice());
async function myRequests(page) {
  await page.click('#sr-tab-btn-history', { timeout: 3000 });
  await page.waitForSelector('#sr-requests-list [onclick^="srToggleDetail"]', { timeout: 5000 });
}
async function openDetail(page) {
  await page.click('#sr-requests-list [onclick^="srToggleDetail"]', { timeout: 3000 });
  await page.waitForFunction(() => /Trash bags/.test(document.getElementById('sr-detail-r1')?.textContent || ''), null, { timeout: 5000 });
}
const ASSOC = (pages) => ({ authenticated: true, email: 'assoc_42@associate.invalid', name: 'Ed Supply',
  role: 'staff', associate: true, pages, stores: ['BL1'], businesses: ['bl'] });
// One scenario per section. A wait that times out is a FAILED check and the run goes on —
// a crash would hide every check after it.
async function section(name, fn) {
  try { await fn(); }
  catch (e) { check(false, `${name}: stopped — ${String((e && e.message) || e).split('\n')[0]}`); }
  finally { for (const c of live) { try { await c.close(); } catch (e) {} } live.clear(); }
}

// ── 1. An associate at EDIT ───────────────────────────────────────────────
await section('1. An associate at EDIT', async () => {
  const { page, errs } = await open(ASSOC({ 'supply-request': 'edit' }));
  check(await shown(page, '#page-supply-request'), '🔑 an associate whose only grant is Supply Request lands on it');
  check(await shown(page, '#nav-supply-request'), '…finds it in the sidebar');
  check(!(await shown(page, '[data-page="dashboard"]')), '…and no dashboard anywhere');
  const tabs = await page.$$eval('#sr-tab-bar button', n => n.map(e => e.id));
  check(tabs.join() === 'sr-tab-btn-new,sr-tab-btn-history', `edit gets New Request and My Requests (${tabs.join()})`);
  check(await shown(page, '#sr-submit-btn'), '…and the form');
  check((await page.$eval('#sr-budget-section', e => e.innerHTML.trim())) === '', '🛑 no budget widget');
  await myRequests(page);
  const listText = await page.$eval('#sr-requests-list', e => e.textContent);
  check(/Under Review/.test(listText) && !/\$|Inv #/.test(listText), `🛑 the list shows no money (${listText.replace(/\s+/g, ' ').trim()})`);
  await openDetail(page);
  check(await shown(page, '#sr-cmt-r1'), 'edit can comment');
  const detail = await page.$eval('#sr-detail-r1', e => e.textContent);
  check(!/Cost:|Invoice:/.test(detail), '🛑 the detail shows no cost or invoice');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'assoc-supply-edit-light.png'), fullPage: false });
  const c = await calls(page);
  check(!c.includes('supply-budgets'), `🛑 the page never asks for the budget (${[...new Set(c)].join(', ')})`);
  check(errs.length === 0, `no JS errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
});

// ── 2. An associate at VIEW ───────────────────────────────────────────────
await section('2. An associate at VIEW', async () => {
  const { page, errs } = await open(ASSOC({ 'supply-request': 'view' }), { dark: true });
  check(await page.evaluate(() => document.documentElement.classList.contains('dark')), '(dark theme)');
  check(await shown(page, '#page-supply-request'), 'view lands on Supply Request too');
  const tabs = await page.$$eval('#sr-tab-bar button', n => n.map(e => e.id));
  check(tabs.join() === 'sr-tab-btn-history', `🔑 view gets My Requests only (${tabs.join()})`);
  check(!(await page.$('#sr-submit-btn')), '🛑 no form is rendered at all');
  await page.waitForSelector('#sr-requests-list [onclick^="srToggleDetail"]', { timeout: 5000 });
  check(await shown(page, '#sr-pane-history'), '…and it opens straight onto the list');
  await openDetail(page);
  check(!(await page.$('#sr-cmt-r1')), '🛑 no comment box — the worker would refuse it at view');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'assoc-supply-view-dark.png'), fullPage: false });
  check(!(await calls(page)).includes('supply-budgets'), '🛑 no budget request');
  check(errs.length === 0, `no JS errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
});

await section('2b. VIEW with nothing yet', async () => {
  const { page } = await open(ASSOC({ 'supply-request': 'view' }), { empty: true });
  await page.waitForFunction(() => /No requests found/.test(document.getElementById('sr-requests-list')?.textContent || ''), null, { timeout: 5000 });
  check(!/Submit your first request/.test(await page.$eval('#sr-requests-list', e => e.textContent)),
        '🛑 the empty list does not offer a form they cannot use');
});

// ── 3. On the phone ───────────────────────────────────────────────────────
await section('3. On the phone', async () => {
  const { page } = await open(ASSOC({ 'supply-request': 'edit', 'bin-dump': 'edit' }), { width: 390, height: 844, mobile: true });
  check(await shown(page, '#bn-supply'), '🔑 Supply earns a tab in the associate\'s bar');
  check(await shown(page, '#page-bin-dump'), '…and an earlier grant keeps the front door (Bin Dump)');
  await page.click('#bn-supply');
  await page.waitForTimeout(400);
  check(await shown(page, '#page-supply-request'), 'the tab opens Supply Request');
});

// ── 4. Without the grant ──────────────────────────────────────────────────
await section('4. Without the grant', async () => {
  const { page } = await open(ASSOC({ 'bin-dump': 'edit' }));
  check(!(await shown(page, '#nav-supply-request')), '🛑 no sidebar item');
  await page.evaluate(() => navigateToPage('supply-request'));
  await page.waitForTimeout(300);
  check(!(await shown(page, '#page-supply-request')), '🛑 and navigating there by hand does nothing');
  check(!(await calls(page)).includes('supply-requests'), '…and asks the worker for nothing');
});

// ── 5. A manager is unchanged ─────────────────────────────────────────────
await section('5. A manager is unchanged', async () => {
  const { page, errs } = await open({ authenticated: true, email: 'howardbrian260@gmail.com', role: 'manager',
    stores: ['BL1'], businesses: ['bl'] });
  await page.evaluate(() => navigateToPage('supply-request'));
  await page.waitForFunction(() => /Supply Budget/.test(document.getElementById('sr-budget-section')?.textContent || ''), null, { timeout: 5000 });
  check(true, 'a manager still gets the budget widget');
  const tabs = await page.$$eval('#sr-tab-bar button', n => n.map(e => e.id));
  check(tabs.join() === 'sr-tab-btn-new,sr-tab-btn-history', `…and both tabs (${tabs.join()})`);
  await myRequests(page);
  check(/\$123\.45/.test(await page.$eval('#sr-requests-list', e => e.textContent)), '…and the cost on the list');
  check(errs.length === 0, `no JS errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
});

// ── 6. The admin's checklist ──────────────────────────────────────────────
await section('6. The admin\'s checklist', async () => {
  const { page } = await open({ authenticated: true, email: 'bgeorges@retjg.com', role: 'admin', stores: null, businesses: ['bl'] });
  const rows = await page.evaluate(() => assocPageRows({ 'supply-request': 'view' }));
  check(/Supply Request/.test(rows), 'the Add associate modal offers Supply Request');
  check(/name="assoc-page-supply-request" value="view"[^>]*checked/.test(rows.replace(/\s+/g, ' ')), '…and shows a saved grant');
});

await b.close();
srv.close();
const failed = results.filter(([ok]) => !ok);
for (const [ok, m] of results) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${m}`);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
