// E-Commerce phase 1 (2026-11-18): syncSellercloud → ecom_orders (migration-090) and
// ?action=ecom-overview, driven through the real worker.scheduled and worker.fetch.
//
// WHAT THIS PROTECTS.
//   - The every-minute cron syncs only on :00/:15/:30/:45, yesterday + today, and 35 days at
//     4 AM Eastern; with no Sellercloud login it calls nothing.
//   - It reads companies 163-167 and 169 (Poshmark, counted as Shoes and Fashions), never 168.
//   - Rows are UPSERTed: a re-run duplicates nothing, a later refund or cancellation updates the
//     row, and a short fetch is reported `incomplete` without removing anything.
//   - No buyer data reaches the table.
//   - The read counts sales only (cancelled and $0 orders left out), includes shipping, splits eBay / Poshmark,
//     and uses ONE budget, $57,000 a month spread by day — including a week across two months.
//   - Who sees what: a Bargain-Lane-only manager and a non-financial role are refused, a manager
//     scoped to one company sees only that company, and the public snapshot secret gets nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, blockNetwork, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const worker = await loadWorker(repo);
blockNetwork();
const blocked = globalThis.fetch;
const MIGRATION = fs.readFileSync(path.join(repo, 'migration-090.sql'), 'utf8');

function setup({ migrate = true } = {}) {
  const { db, env } = makeEnv(repo);
  if (migrate) db.exec(MIGRATION);
  db.prepare("INSERT INTO businesses (id,name,unit_noun,source,active) VALUES ('ecom','E-Commerce','storefront','sellercloud',1)").run();
  const g = db.prepare('INSERT INTO user_grants (user_id,business_id,role,units) VALUES (?,?,?,?)');
  g.run('u-admin', 'ecom', 'admin', null);
  g.run('u-mgr2', 'ecom', 'manager', '["164"]');
  g.run('u-staff', 'ecom', 'staff', null);
  env.SELLERCLOUD_USERNAME = 'sync-user@example.com';
  env.SELLERCLOUD_PASSWORD = 'pw-not-real';
  return { db, env };
}

// ── The fake Sellercloud ────────────────────────────────────────────────────
const buyer = { FirstName: 'Secretfirst', CustomerEmail: 'buyer-secret@example.com', ShippingAddress: { Address1: '1 Secretstreet' } };
let ORDERS = [], nextId = 1;
const order = (company, day, hour, extra = {}) => ORDERS.push({ ID: nextId++, CompanyID: company,
  TimeOfOrder: `${day}T${String(hour).padStart(2, '0')}:10:00`, StatusCode: 3, OrderSource: 1,
  GrandTotal: 20, ShippingTotal: 2, TaxTotal: 0, Items: [{ Qty: 1, QtyReturned: 0, TotalRefunded: 0 }], ...buyer, ...extra });
function seed() {
  ORDERS = []; nextId = 1;
  for (let n = 0; n < 60; n++) order(163, '2026-11-18', 9 + (n % 6));                       // 60 sales today, 2 pages
  order(163, '2026-11-18', 11, { StatusCode: -1, GrandTotal: 999 });                       // cancelled
  order(163, '2026-11-17', 15, { GrandTotal: 30 }); order(163, '2026-11-17', 16, { GrandTotal: 30 });
  order(169, '2026-11-18', 10, { OrderSource: 6, GrandTotal: 15, ShippingTotal: 1 });       // Poshmark
  order(169, '2026-11-18', 12, { OrderSource: 6, GrandTotal: 15, ShippingTotal: 1 });
  order(164, '2026-11-18', 10, { StatusCode: 2, GrandTotal: 50, ShippingTotal: 5 });
  order(166, '2026-11-16', 13, { GrandTotal: 40 });                                         // only a deep run reaches it
  order(167, '2026-11-01', 9, { GrandTotal: 100 });                                         // only a deep run reaches it
  order(168, '2026-11-18', 9, { GrandTotal: 5000 });                                        // wholesale: never read
}
let calls = [], shortPage = null, ignoreCompany = false;
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (u, init = {}) => {
  const url = new URL(String(u));
  if (url.host !== 'jay.api.sellercloud.us') return blocked(u);
  calls.push(url);
  if (url.pathname === '/rest/api/token') return json({ access_token: 'tok', expires_in: 1800 });
  if (url.pathname === '/rest/api/Orders') {
    const ids = url.searchParams.getAll('companyID').map(Number);
    const from = url.searchParams.get('orderFromDate'), to = url.searchParams.get('orderToDate');
    const size = Number(url.searchParams.get('pageSize')), page = Number(url.searchParams.get('pageNumber'));
    const rows = ORDERS.filter(o => (ignoreCompany || ids.includes(o.CompanyID)) && o.TimeOfOrder.slice(0, 10) >= from && o.TimeOfOrder.slice(0, 10) < to);
    let items = rows.slice((page - 1) * size, page * size);
    let total = rows.length;
    if (shortPage && ids.includes(shortPage)) { total = rows.length + 10; }   // Sellercloud claims more than it serves
    return json({ Items: items, TotalResults: total });
  }
  return json({ Message: 'not found' }, 404);
};

const tick = async (env, iso) => {
  const jobs = [];
  await worker.scheduled({ cron: '* * * * *', scheduledTime: Date.parse(iso) }, env, { waitUntil: (p) => jobs.push(p), passThroughOnException() {} });
  await Promise.allSettled(jobs);
};
const ordersCalls = () => calls.filter(u => u.pathname === '/rest/api/Orders');
const read = async (env, qs, opts = { user: 'u-admin' }) => {
  const r = await worker.fetch(req('/?action=ecom-overview' + qs, opts), env, { waitUntil() {}, passThroughOnException() {} });
  const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch {}
  return { status: r.status, body, text };
};

seed();
const { db, env } = setup();
const count = (where = '1=1') => db.prepare(`SELECT COUNT(*) AS n FROM ecom_orders WHERE ${where}`).get().n;

// ── 1. ticks that do not sync ──────────────────────────────────────────────
{
  calls = [];
  await tick(env, '2026-11-18T19:46:00Z');
  eq(ordersCalls().length, 0, 'a :46 tick makes no Sellercloud call');
  const bare = setup();
  delete bare.env.SELLERCLOUD_USERNAME;
  await tick(bare.env, '2026-11-18T19:45:00Z');
  eq(calls.length, 0, 'with no Sellercloud login, a :45 tick calls nothing');
}

// ── 2. a 15-minute sync: yesterday + today ─────────────────────────────────
{
  calls = [];
  await tick(env, '2026-11-18T19:45:00Z');      // 2:45 PM EST
  const o = ordersCalls();
  eq([...new Set(o.map(u => u.searchParams.get('companyID')))].sort(), ['163', '164', '165', '166', '167', '169'], 'reads 163-167 and 169, never 168');
  eq([o[0].searchParams.get('orderFromDate'), o[0].searchParams.get('orderToDate')], ['2026-11-17', '2026-11-19'], 'window is yesterday to tomorrow (orderToDate is exclusive)');
  eq(o.filter(u => u.searchParams.get('companyID') === '163').map(u => u.searchParams.get('pageNumber')), ['1', '2'], '163 pages through 63 orders in two pages');
  eq(count(), 63 + 2 + 1, '66 rows: 163 (60 + cancelled + 2 yesterday), 169 (2), 164 (1)');
  eq(count('company_id = 169 AND unit = 163'), 2, 'Poshmark (169) is stored on the Shoes and Fashions card (unit 163)');
  eq(count('company_id = 168'), 0, 'wholesale (168) is never stored');
  eq(count("order_date = '2026-11-16'") + count("order_date = '2026-11-01'"), 0, 'nothing outside the window yet');
  const dump = JSON.stringify(db.prepare('SELECT * FROM ecom_orders').all());
  for (const s of ['Secretfirst', 'buyer-secret@example.com', 'Secretstreet']) ok(!dump.includes(s), `no buyer data in ecom_orders ("${s}")`);
  const state = JSON.parse(await env.SALES_SNAPSHOTS.get('ecom:sync'));
  eq([state.ok, state.from, state.to, state.deep, state.orders], [true, '2026-11-17', '2026-11-19', false, 66], 'sync state recorded in KV');
}

// ── 3. re-runs update, never duplicate ─────────────────────────────────────
{
  const target = ORDERS.find(o => o.CompanyID === 164);
  target.StatusCode = -1; target.Items = [{ Qty: 1, QtyReturned: 1, TotalRefunded: 50 }];
  await tick(env, '2026-11-18T20:00:00Z');
  eq(count(), 66, 'a second run adds no duplicates');
  eq(db.prepare('SELECT status_code, units_returned, refunded FROM ecom_orders WHERE order_id = ?').get(target.ID),
     { status_code: -1, units_returned: 1, refunded: 50 }, 'a later cancellation and refund update the row');
  target.StatusCode = 2; target.Items = [{ Qty: 1, QtyReturned: 0, TotalRefunded: 0 }];
  await tick(env, '2026-11-18T20:15:00Z');
}

// ── 4. the nightly deep run ────────────────────────────────────────────────
{
  calls = [];
  await tick(env, '2026-11-18T09:00:00Z');      // 4 AM EST
  eq(ordersCalls()[0].searchParams.get('orderFromDate'), '2026-10-14', '4 AM Eastern re-reads 35 days');
  eq(count(), 68, 'the deep run picks up 166 (Nov 16) and 167 (Nov 1)');
  calls = [];
  await tick(env, '2026-11-18T09:15:00Z');
  eq(ordersCalls()[0].searchParams.get('orderFromDate'), '2026-11-17', 'only the :00 tick at 4 AM is deep');
}

// ── 5. a short fetch is reported and removes nothing ───────────────────────
{
  shortPage = 163;
  await tick(env, '2026-11-18T20:30:00Z');
  const state = JSON.parse(await env.SALES_SNAPSHOTS.get('ecom:sync'));
  ok(state.ok === false && state.incomplete.some(x => x.company === 163), `Sellercloud serving fewer than TotalResults is flagged incomplete, got ${JSON.stringify(state.incomplete)}`);
  eq(count(), 68, 'and no row was removed');
  shortPage = null;
}

// ── 5b. a company filter Sellercloud ignored cannot file orders under the wrong company ──
{
  const before = db.prepare('SELECT company_id, unit, COUNT(*) AS n FROM ecom_orders GROUP BY company_id, unit ORDER BY company_id').all();
  ignoreCompany = true;
  await tick(env, '2026-11-18T20:45:00Z');
  ignoreCompany = false;
  eq(db.prepare('SELECT company_id, unit, COUNT(*) AS n FROM ecom_orders GROUP BY company_id, unit ORDER BY company_id').all(), before,
     'every company handed every order still stores each order under its own company, and 168 nowhere');
}

// ── 6. the read ────────────────────────────────────────────────────────────
{
  const r = await read(env, '&date=2026-11-18');
  const b = r.body;
  ok(r.status === 200 && b.ok, `admin reads the overview, got ${r.status} ${r.text.slice(0, 160)}`);
  eq([b.weekStart, b.monthStart], ['2026-11-15', '2026-11-01'], 'week starts Sunday, month on the 1st');
  eq(b.budget, { monthly: 57000, today: 1900, week: 13300, month: 57000, period: 1900 }, 'one budget: $57,000 a month, $1,900 a day in November (a one-day range = one day of it)');
  eq([b.today.orders, b.today.sales, b.today.shipping], [63, 1280, 127], 'today: 60×$20 + 2×$15 + $50, cancelled $999 left out, shipping included');
  eq([b.today.ebay, b.today.poshmark, b.today.other], [1250, 30, 0], 'today: eBay vs Poshmark (by company 169)');
  eq([b.week.sales, b.month.sales], [1380, 1480], 'week adds Nov 16-17; month adds Nov 1');
  eq(b.companies.map(c => c.id), [163, 164, 165, 166, 167], 'one card per company, in order');
  const sf = b.companies[0];
  eq([sf.companyIds, sf.today.orders, sf.today.sales], [[163, 169], 62, 1230], 'Shoes and Fashions includes Poshmark');
  eq(sf.hours.reduce((n, v) => n + v, 0), 1230, 'its hourly sales add up to its day');
  eq([sf.hours[8], sf.hours[9] > 0, sf.hours[15]], [0, true, 0], 'hours come from TimeOfOrder');
  eq(b.reporting, 2, 'two companies sold today (S&F, Harrison Avenue)');
  eq(b.sync && b.sync.from, '2026-11-17', 'last sync is reported');
  const dec = await read(env, '&date=2026-12-02');
  eq([dec.body.weekStart, dec.body.budget.week, dec.body.budget.today], ['2026-11-29', 12993.55, 1838.71], 'a week across Nov/Dec uses each month\'s daily share');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  eq((await read(env, '')).body.date, today, 'no date → today, Eastern');
  eq((await read(env, '&date=2026-02-30')).status, 400, 'an impossible date → 400');
}

// ── 6b. a date range (the page's picker) ──────────────────────────────────
{
  const r = await read(env, '&from=2026-11-01&to=2026-11-18');
  const b = r.body;
  eq([r.status, b.range], [200, { from: '2026-11-01', to: '2026-11-18', days: 18 }], 'from/to is echoed as the range');
  eq([b.period.orders, b.period.sales], [63 + 2 + 1 + 1, 1480], 'the period sums every sale in it (Nov 1, 16, 17, 18), cancelled left out');
  eq([b.period.ebay, b.period.poshmark], [1450, 30], 'period channels: eBay vs Poshmark');
  eq(b.budget.period, 34200, 'period budget = 18 × $1,900');
  eq([b.today.sales, b.week.sales, b.month.sales], [1280, 1380, 1480], 'today / week / month are unchanged by a range');
  eq(b.companies.map(c => [c.id, c.period.sales]), [[163, 1290], [164, 50], [165, 0], [166, 40], [167, 100]], 'each company carries its period');
  eq(b.reportingPeriod, 4, 'four companies sold in the period');
  const cross = await read(env, '&from=2026-10-30&to=2026-11-02');
  eq([cross.body.budget.period, cross.body.range.days], [7477.42, 4], 'a range across months uses each month\'s daily share (2 × 57000/31 + 2 × 1900)');
  eq((await read(env, '&from=2026-11-18&to=2026-11-01')).status, 400, 'from after to → 400');
  eq((await read(env, '&from=2025-01-01&to=2026-11-18')).status, 400, 'more than 400 days → 400');
  const legacy = await read(env, '&date=2026-11-18');
  eq([legacy.body.range, legacy.body.period.sales], [{ from: '2026-11-18', to: '2026-11-18', days: 1 }, 1280], '`date` alone is a one-day range');
}

// ── 6c. the history load ──────────────────────────────────────────────────
{
  const post = (body, opts = { user: 'u-su' }) => worker.fetch(req('/?action=ecom-backfill', { ...opts, method: 'POST', body }), env, { waitUntil() {}, passThroughOnException() {} });
  order(165, '2026-09-10', 11, { GrandTotal: 77 });             // older than any sync window
  const before = count(), kvBefore = await env.SALES_SNAPSHOTS.get('ecom:sync');
  calls = [];
  eq((await post({ from: '2026-09-01', to: '2026-09-30' }, { user: 'u-admin' })).status, 403, 'an admin cannot run the history load');
  eq((await post({ from: '2026-09-01', to: '2026-09-30' }, { secret: env.SNAPSHOT_SECRET })).status, 403, 'nor can the snapshot secret');
  eq((await worker.fetch(req('/?action=ecom-backfill', { user: 'u-su' }), env, { waitUntil() {}, passThroughOnException() {} })).status, 405, 'GET is refused');
  eq((await post({ from: '2026-07-01', to: '2026-09-30' })).status, 400, 'more than 62 days in one call → 400');
  eq((await post({ from: '2024-12-01', to: '2024-12-31' })).status, 400, 'before 2025-01-01 → 400');
  eq((await post({ from: '2026-11-18', to: '2099-01-01' })).status, 400, 'a future end → 400');
  eq(calls.length, 0, 'none of the refused calls reached Sellercloud');
  const r = await post({ from: '2026-09-01', to: '2026-09-30' });
  const j = await r.json();
  ok(r.status === 200 && j.ok && j.from === '2026-09-01' && j.to === '2026-10-01', `the load reads [Sep 1, Oct 1) by order date, got ${r.status} ${JSON.stringify(j).slice(0, 120)}`);
  eq(count() - before, 1, 'it adds the September order');
  eq(await env.SALES_SNAPSHOTS.get('ecom:sync'), kvBefore, 'and leaves the 15-minute sync\'s "last synced" alone');
}

// ── 6d. one company's View Details (2026-11-18) ───────────────────────────
{
  const company = async (qs, opts = { user: 'u-admin' }) => {
    const r = await worker.fetch(req('/?action=ecom-company' + qs, opts), env, { waitUntil() {}, passThroughOnException() {} });
    const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch {}
    return { status: r.status, body, text };
  };
  // A year-ago order, loaded the way the history load does.
  order(163, '2025-11-18', 14, { GrandTotal: 88, ShippingTotal: 8 });
  await worker.fetch(req('/?action=ecom-backfill', { user: 'u-su', method: 'POST', body: { from: '2025-11-01', to: '2025-11-30' } }), env, { waitUntil() {}, passThroughOnException() {} });

  const r = await company('&company=163&from=2026-11-17&to=2026-11-18');
  const b = r.body;
  ok(r.status === 200 && b.ok, `admin reads Shoes and Fashions, got ${r.status} ${r.text.slice(0, 160)}`);
  eq([b.company.name, b.company.companyIds], ['Shoes and Fashions', [163, 169]], 'the company, with Poshmark folded in');
  eq([b.totals.orders, b.totals.sales, b.totals.shipping], [64, 1290, 126], 'totals: 60×$20 + 2×$30 + 2×$15 (Poshmark), cancelled $999 left out, shipping included');
  eq([b.totals.ebay, b.totals.poshmark, b.totals.other], [1260, 30, 0], 'eBay vs Poshmark');
  eq(b.daily.map(x => [x.date, x.orders, x.sales]), [['2026-11-17', 2, 60], ['2026-11-18', 62, 1230]], 'one row per day');
  eq([b.previous.from, b.previous.to, b.previous.sales], ['2026-11-15', '2026-11-16', 0], 'previous = the same number of days just before');
  eq([b.lastYear.from, b.lastYear.to, b.lastYear.orders, b.lastYear.sales], ['2025-11-17', '2025-11-18', 1, 88], 'last year = the same dates a year earlier');
  eq(b.status.map(x => [x.name, x.orders]), [['Completed', 64], ['Canceled', 1]], 'status mix counts every status');
  eq([b.ordersInRange, b.orders.length, b.orders.some(o => o.statusName === 'Canceled' && o.total === 999)], [65, 65, true], 'orders list every status, cancellations included');
  ok(b.orders.every((o, i) => i === 0 || o.time <= b.orders[i - 1].time), 'orders are newest first');
  eq(b.hours, null, 'no hours for a range of days');
  for (const s of ['Secretfirst', 'buyer-secret@example.com', 'Secretstreet']) ok(!r.text.includes(s), `no buyer data ("${s}")`);
  const day = await company('&company=163&from=2026-11-18&to=2026-11-18');
  eq(day.body.hours.reduce((n, v) => n + v, 0), 1230, 'a one-day range has hourly sales that add up to the day');
  eq(day.body.previous.from, '2026-11-17', '…compared with the day before');
  const def = await company('&company=164');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  eq([def.status, def.body.range.from, def.body.range.to], [200, today, today], 'no range → today');
  eq((await company('&company=164', { user: 'u-mgr2' })).status, 200, 'a manager scoped to 164 reads 164');
  const other = await company('&company=163', { user: 'u-mgr2' });
  eq([other.status, other.body && other.body.code], [403, 'NO_UNIT_ACCESS'], '…and is refused 163, not given an empty page');
  eq((await company('&company=163', { user: 'u-mgr1' })).status, 403, 'a Bargain-Lane-only manager is refused');
  eq((await company('&company=163', { user: 'u-staff' })).status, 403, 'a non-financial role is refused');
  eq((await company('&company=163', { secret: env.SNAPSHOT_SECRET })).status, 401, 'the snapshot secret alone gets nothing');
  eq((await company('&company=168')).status, 400, 'wholesale (168) is not a company here');
  eq((await company('&company=163&from=2026-11-18&to=2026-11-01')).status, 400, 'from after to → 400');
}

// ── 7. who sees what ───────────────────────────────────────────────────────
{
  const one = await read(env, '&date=2026-11-18', { user: 'u-mgr2' });
  eq([one.status, one.body.companies.map(c => c.id), one.body.today.sales], [200, [164], 50], 'a manager scoped to 164 sees only Harrison Avenue');
  eq((await read(env, '&date=2026-11-18', { user: 'u-mgr1' })).status, 403, 'a Bargain-Lane-only manager is refused');
  eq((await read(env, '&date=2026-11-18', { user: 'u-staff' })).status, 403, 'a non-financial role is refused');
  eq((await read(env, '&date=2026-11-18', { secret: env.SNAPSHOT_SECRET })).status, 401, 'the snapshot secret alone gets nothing');
  eq((await read(env, '&date=2026-11-18', {})).status, 401, 'signed out is refused');
}

// ── 7b. a $0 order is not a sale (Brian, 2026-11-18) ───────────────────────
// Sellercloud carries Wholesale lots (source 21), Local store transfers and eBay replacements as
// $0 orders in sale statuses; one lot was 37,875 units. They must not add orders or units.
{
  const company = async (qs) => {
    const r = await worker.fetch(req('/?action=ecom-company' + qs, { user: 'u-admin' }), env, { waitUntil() {}, passThroughOnException() {} });
    return JSON.parse(await r.text());
  };
  const before = { o: (await read(env, '&date=2026-11-18')).body, c: await company('&company=163&from=2026-11-17&to=2026-11-18') };
  const ins = db.prepare(`INSERT INTO ecom_orders (order_id, company_id, unit, order_date, order_time, status_code, source, grand_total, shipping, units, synced_at)
    VALUES (?, ?, 163, '2026-11-18', '2026-11-18T09:30:00', ?, ?, 0, 0, ?, 'x')`);
  ins.run(990001, 163, 2, 21, 37875);   // a Wholesale lot, In process
  ins.run(990002, 163, 3, 0, 1738);     // a Local store transfer, Completed
  ins.run(990003, 169, 3, 6, 1);        // a $0 Poshmark replacement
  const after = { o: (await read(env, '&date=2026-11-18')).body, c: await company('&company=163&from=2026-11-17&to=2026-11-18') };
  eq([after.o.today, after.o.period], [before.o.today, before.o.period], 'Overview: $0 orders add no orders, units or sales');
  eq(after.o.companies.find(c => c.id === 163).today, before.o.companies.find(c => c.id === 163).today, 'Overview card: the same');
  eq([after.c.totals, after.c.daily], [before.c.totals, before.c.daily], 'View Details: totals and daily rows unchanged');
  eq(after.c.hours, before.c.hours, '…and the hourly chart');
  ok(after.c.orders.some(o => o.id === 990001) && after.c.ordersInRange === before.c.ordersInRange + 3, 'they still show in the orders list');
  eq(after.c.status.find(x => x.status === 2)?.orders, (before.c.status.find(x => x.status === 2)?.orders || 0) + 1, '…and in the status mix');
  db.prepare('DELETE FROM ecom_orders WHERE order_id >= 990001').run();
}

// ── 8. before migration-090 ────────────────────────────────────────────────
{
  const pre = setup({ migrate: false });
  calls = [];
  await tick(pre.env, '2026-11-18T19:45:00Z');
  const state = JSON.parse(await pre.env.SALES_SNAPSHOTS.get('ecom:sync'));
  ok(state.ok === false && /no such table/i.test(state.errors[0].message) && state.errors.length === 1, 'without the table the sync stops at the first write and says why');
  eq((await read(pre.env, '&date=2026-11-18')).status, 503, 'and the read answers 503 "not set up"');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
