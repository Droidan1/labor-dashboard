// Every export that puts today's date in its file name, driven in a REAL BROWSER with the
// clock fixed at 11:30 pm Eastern on the last day of a month.
//
// 🛑 NOT PART OF `scripts/test.sh`, deliberately: the runner globs `test-*` and this needs
// playwright-core and a Chromium, neither of which is a repo dependency. Run it by hand
// after a change to an export:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-export-dates.mjs
//
// 🔑 WHY IT EXISTS. The stores keep Eastern time, and the app's "today" is etTodayStr(). Six
// exports named their file from new Date().toISOString(), which is UTC, so from 8 pm EDT
// (7 pm EST) the file was dated tomorrow, and on the last evening of a month the supply
// report was named for the next month (weekly-retail-19 found the WRS pair). At 03:30 UTC on
// 1 October it is 11:30 pm on 30 September in New York, so every file here must say
// 2026-09-30, or 2026-09 for the month. The check reads the name of the file each real export
// downloads; it does not read the source.
//
// The repair console's default health-check range is checked here too: the last 30 days by the
// stores' calendar. It stepped 29 × 24 hours back from the phone's clock, which starts a day out
// near midnight whenever a clock change falls inside the window.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error(
    '\nThis check needs playwright-core, which is not a dependency of this repo.\n\n' +
    '  npm install --no-save playwright-core\n' +
    '  bash scripts/build.sh\n' +
    '  node scripts/browser-export-dates.mjs\n\n' +
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
const PORT = Number(process.env.PORT || 8097);
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
// A superuser, so every export is open to it, and one answer for each list an export reads.
// Every request that is not this server is refused below, so nothing can reach production.
function pageMocks() {
  const J = (x, st = 200) => new Response(JSON.stringify(x), { status: st, headers: { 'content-type': 'application/json' } });
  const real = window.fetch;
  window.fetch = async (u, o = {}) => {
    const s = String(u && u.url ? u.url : u);
    if (!s.startsWith('https://')) return real(u, o);
    const action = new URL(s).searchParams.get('action');
    if (action === 'auth-me') {
      window.__authed = true;
      return J({ authenticated: true, email: 'sam@example.com', name: 'Sam U', role: 'superuser', stores: ['BL1', 'BL4'], pages: {}, businesses: ['bl'] });
    }
    if (action === 'supply-requests') return J({ requests: [{ id: 1, submitted_at: '2026-09-30T20:00:00Z', store: 'BL1',
      user_email: 'sam@example.com', item_count: 2, priority: 'normal', status: 'pending', invoice_number: null, cost: null }] });
    if (action === 'truck-list') return J({ rows: [], truncated: false });
    if (action === 'mos-list') return J({ rows: [{ store: 'BL1', code: 'BL-10380-5', item_no: '10380', description: 'Mug',
      qty: 1, unit_cost_cents: 100, unit_price_cents: 500, reason: 'Damaged', logged_at: '2026-09-30T20:00:00Z',
      logged_by: 'sam@example.com', month: '2026-09' }], months: [{ month: '2026-09' }], truncated: false });
    return J({ ok: false, error: 'not in this harness' }, 404);
  };
}

const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ timezoneId: 'America/New_York', locale: 'en-US', serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
// A failed load of a refused off-host file (Google Fonts, the CDNs) is this harness, not a fault.
page.on('console', m => { if (m.type() === 'error' && !(m.location().url && !m.location().url.startsWith(ORIGIN))) errs.push('console: ' + m.text()); });
await page.route(u => !u.href.startsWith(ORIGIN), r => r.abort());
await page.addInitScript(pageMocks);
await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.navigateToPage === 'function' && window.__authed, null, { timeout: 10000 });
await page.waitForTimeout(600);

// 03:30 UTC on 1 October is 11:30 pm on 30 September in New York. The two calendars disagree
// on the day AND the month here, so a name taken from UTC cannot pass. Asserted first: if they
// agreed, every check below would pass whichever calendar the code used.
await page.clock.setFixedTime(new Date('2026-10-01T03:30:00Z'));
eq(await page.evaluate(() => [new Date().toISOString().slice(0, 10), etTodayStr()]), ['2026-10-01', '2026-09-30'],
   'the clock reads 11:30 pm on 30 September in New York, which is already 1 October in UTC');

const dated = n => (String(n).match(/(\d{4}-\d{2}(?:-\d{2})?)\.(?:csv|pdf)$/) || [])[1] || null;
// One export, and the name of the file it downloads. One that first asks how much gets its
// answer clicked. A failure is a FAILED check, and the next export still runs.
async function exported(label, fn, choice) {
  try {
    const dl = page.waitForEvent('download', { timeout: 10000 });
    const done = page.evaluate(fn).catch(e => e);   // not awaited: a choice dialog holds it open
    if (choice) await page.locator('[role="dialog"]:visible').getByRole('button', { name: choice, exact: true }).click({ timeout: 5000 });
    const name = (await dl).suggestedFilename();
    await Promise.race([done, page.waitForTimeout(2000)]);
    const open = page.locator('[role="dialog"]:visible');
    if (await open.count()) {
      check(false, `${label}: left a dialog open ("${(await open.first().innerText()).replace(/\s+/g, ' ').slice(0, 80)}")`);
      await open.first().getByRole('button').first().click().catch(() => {});
    }
    return name;
  } catch (e) {
    check(false, `${label}: no file — ${String((e && e.message) || e).split('\n')[0]}`);
    return null;
  }
}
const DAY = '2026-09-30', MONTH = '2026-09';

// WRS: the visible pane, with one small table for the exports to read.
await page.evaluate(() => window.navigateToPage('weekly-summary'));
await page.waitForTimeout(400);
await page.evaluate(() => {
  const pane = document.getElementById('wrs-pane-summary'), t = document.createElement('table');
  t.createTHead().insertRow().insertCell().textContent = 'Store';
  t.createTBody().insertRow().insertCell().textContent = 'Coliseum';
  pane.appendChild(t);
});
let n = await exported('WRS PDF', () => window.downloadWrsAsPdf());
eq(dated(n), DAY, `WRS PDF is dated the Eastern day (${n})`);
n = await exported('WRS CSV', () => window.downloadWrsAsCsv());
eq(dated(n), DAY, `WRS CSV is dated the Eastern day (${n})`);

// Supply: the All Requests list, as its tab loads it; the Reports pane's table.
await page.evaluate(() => window.srSwitchTab('all'));
await page.waitForFunction(() => /sam@example\.com/.test(document.getElementById('sr-all-list')?.textContent || ''), null, { timeout: 8000 })
  .catch(() => check(false, 'the supply request list did not load in this harness'));
n = await exported('Supply requests CSV', () => window.srExportCSV());
eq(dated(n), DAY, `Supply requests CSV is dated the Eastern day (${n})`);
await page.evaluate(() => {
  const t = document.createElement('table');
  t.insertRow().insertCell().textContent = 'BL1';
  document.getElementById('sr-pane-reports').appendChild(t);
});
n = await exported('Supply report CSV', () => window.srExportReportsCSV());
eq(dated(n), MONTH, `Supply report CSV is named for the Eastern month (${n})`);

// Trucks and MOS each ask how much to export first. MOS names the store its picker holds, so
// its page is opened first, the way a manager gets there.
n = await exported('Trucks CSV', () => window.irExportCsv(), 'Everything');
eq(dated(n), DAY, `Trucks CSV is dated the Eastern day (${n})`);
await page.evaluate(() => window.navigateToPage('mos'));
await page.waitForTimeout(600);
n = await exported('MOS CSV', () => window.mosExport(), 'Everything');
eq(dated(n), DAY, `MOS CSV is dated the Eastern day (${n})`);

// The repair console's default range: opening Admin Settings fills an empty health-check range
// with the last 30 days. Emptied before each visit, as it only fills a blank one.
async function repairRange(p, at) {
  await p.clock.setFixedTime(new Date(at));
  return p.evaluate(() => {
    document.getElementById('rh-start').value = '';
    document.getElementById('rh-end').value = '';
    window.navigateToPage('admin-settings');
    return [document.getElementById('rh-start').value, document.getElementById('rh-end').value];
  });
}
for (const [at, start, end, why] of [
  ['2026-03-09T04:30:00Z', '2026-02-08', '2026-03-09', '12:30 am on the Monday after spring forward'],
  ['2026-11-16T04:30:00Z', '2026-10-17', '2026-11-15', '11:30 pm, two weeks after fall back'],
  ['2026-10-01T03:30:00Z', '2026-09-01', '2026-09-30', 'an ordinary evening'],
]) eq(await repairRange(page, at), [start, end], `the repair console's default range at ${at} (${why}) is the 30 days ending today`);

// A phone set to Los Angeles, at 10:30 pm there, when New York is already on tomorrow: the range
// follows the stores' calendar, as the rest of the app does.
{
  const laCtx = await b.newContext({ timezoneId: 'America/Los_Angeles', locale: 'en-US', serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const la = await laCtx.newPage();
  la.on('pageerror', e => errs.push('LA: ' + String(e)));
  await la.route(u => !u.href.startsWith(ORIGIN), r => r.abort());
  await la.addInitScript(pageMocks);
  await la.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await la.waitForFunction(() => typeof window.navigateToPage === 'function' && window.__authed, null, { timeout: 10000 });
  await la.clock.setFixedTime(new Date('2026-08-21T05:30:00Z'));
  eq(await la.evaluate(() => [new Date().toLocaleDateString('en-CA'), etTodayStr()]), ['2026-08-20', '2026-08-21'],
     'the Los Angeles phone reads 20 August while New York is on 21 August');
  eq(await repairRange(la, '2026-08-21T05:30:00Z'), ['2026-07-23', '2026-08-21'],
     "on that phone the repair console's default range is the stores' last 30 days");
  await laCtx.close();
}

check(!errs.length, `no page or console errors (${errs.slice(0, 2).join(' | ')})`);

await b.close();
srv.close();
const bad = results.filter(r => !r[0]);
if (process.env.VERBOSE) for (const [okk, m] of results) if (okk) console.log('  ok   ' + m);
for (const [okk, m] of results) if (!okk) console.log('  FAIL ' + m);
console.log(`\n${results.length - bad.length} passed, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
