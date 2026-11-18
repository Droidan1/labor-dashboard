// E-Commerce Items tab (2026-11-18): syncSellercloud keeps each order's lines in
// ecom_order_items (migration-091), and ?action=ecom-items reads them, driven through the real
// worker.scheduled and worker.fetch.
//
// WHAT THIS PROTECTS.
//   - Lines are written with their order: re-syncing duplicates nothing, a changed order's lines
//     are replaced, and an order sent with NO lines keeps the ones already stored.
//   - A cost of 0 is stored as NULL (0 would read as a 100% margin); a real cost is kept.
//   - Worker ahead of migration-091: orders still sync, lines are reported skipped.
//   - No buyer data reaches the table or the read.
//   - The read groups by SKU (by name when there is none), counts sales only (no $0 orders), keeps
//     Poshmark on Shoes and Fashions, sorts by sales or units, searches name and SKU with % and _
//     taken literally, caps the rows but not the totals, and says how many orders have lines.
//   - Who sees what is ecom-company's door: scoped managers, non-financial roles, the snapshot
//     secret and signed-out requests.
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
const M090 = fs.readFileSync(path.join(repo, 'migration-090.sql'), 'utf8');
const M091 = fs.readFileSync(path.join(repo, 'migration-091.sql'), 'utf8');

function setup({ lines = true } = {}) {
  const { db, env } = makeEnv(repo);
  db.exec(M090);
  if (lines) db.exec(M091);
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
let ORDERS = [], nextId = 1, nextLine = 9000;
const line = (sku, name, qty, total, extra = {}) => ({ ID: nextLine++, ProductID: sku, DisplayName: name, Qty: qty, QtyReturned: 0,
  LineTotal: total, TotalRefunded: 0, SiteCost: 0, AverageCost: 0, LastCost: 0, ...extra });
const order = (company, day, items, extra = {}) => {
  const o = { ID: nextId++, CompanyID: company, TimeOfOrder: `${day}T10:15:00`, StatusCode: 3, OrderSource: 1,
    GrandTotal: items.reduce((n, it) => n + it.LineTotal, 0) + 5, ShippingTotal: 5, TaxTotal: 0, Items: items, ...buyer, ...extra };
  ORDERS.push(o); return o;
};
function seed() {
  ORDERS = []; nextId = 1; nextLine = 9000;
  order(163, '2026-11-18', [line('RW-1', 'Red Wing 2217 Boots', 1, 175)]);
  order(163, '2026-11-18', [line('RW-1', 'Red Wing 2217 Boots', 1, 165, { QtyReturned: 1, TotalRefunded: 165 }), line('JO-2', 'johnnie-O Polo 50% off', 2, 80)]);
  order(163, '2026-11-17', [line('JO-2', 'johnnie-O Polo 50% off', 1, 40)]);
  order(163, '2026-11-18', [line('XX-9', 'Cancelled thing', 1, 999)], { StatusCode: -1 });          // cancelled: left out
  order(169, '2026-11-18', [line('PM-1', 'Poshmark Dress', 1, 30)], { OrderSource: 6 });             // Poshmark → 163
  order(163, '2026-11-18', [line(null, 'No-SKU scarf', 1, 12), line('', 'No-SKU scarf', 1, 12)]);     // groups by name
  order(164, '2026-11-18', [line('HA-1', 'Harrison lamp', 1, 50, { SiteCost: 20 })]);                 // a real cost
  for (let n = 0; n < 60; n++) order(165, '2026-11-18', [line('BR-' + n, 'Bass item ' + n, 1, 10 + n)]); // 60 orders, two pages
}
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (u) => {
  const url = new URL(String(u));
  if (url.host !== 'jay.api.sellercloud.us') return blocked(u);
  if (url.pathname === '/rest/api/token') return json({ access_token: 'tok', expires_in: 1800 });
  if (url.pathname === '/rest/api/Orders') {
    const ids = url.searchParams.getAll('companyID').map(Number);
    const from = url.searchParams.get('orderFromDate'), to = url.searchParams.get('orderToDate');
    const size = Number(url.searchParams.get('pageSize')), page = Number(url.searchParams.get('pageNumber'));
    const rows = ORDERS.filter(o => ids.includes(o.CompanyID) && o.TimeOfOrder.slice(0, 10) >= from && o.TimeOfOrder.slice(0, 10) < to);
    return json({ Items: structuredClone(rows.slice((page - 1) * size, page * size)), TotalResults: rows.length });
  }
  return json({ Message: 'not found' }, 404);
};
const tick = async (env, iso = '2026-11-18T19:45:00Z') => {
  const jobs = [];
  await worker.scheduled({ cron: '* * * * *', scheduledTime: Date.parse(iso) }, env, { waitUntil: (p) => jobs.push(p), passThroughOnException() {} });
  await Promise.allSettled(jobs);
};
const items = async (env, qs, opts = { user: 'u-admin' }) => {
  const r = await worker.fetch(req('/?action=ecom-items' + qs, opts), env, { waitUntil() {}, passThroughOnException() {} });
  const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch {}
  return { status: r.status, body, text };
};

seed();
const { db, env } = setup();
const lines = (where = '1=1') => db.prepare(`SELECT * FROM ecom_order_items WHERE ${where} ORDER BY order_id, line_no`).all();

// ── 1. the sync keeps each order's lines ─────────────────────────────────
{
  await tick(env);
  const state = JSON.parse(await env.SALES_SNAPSHOTS.get('ecom:sync'));
  ok(state.ok && state.linesSkipped === false, `the sync is clean, got ${JSON.stringify(state).slice(0, 200)}`);
  eq(state.lines, 69, '69 lines: 9 on the small orders + 60 Bass River');
  eq(lines().length, 69, 'one row per line');
  eq(lines('order_id = 2').map(r => [r.line_no, r.line_id, r.sku, r.qty, r.qty_returned, r.line_total, r.refunded]),
    [[1, 9001, 'RW-1', 1, 1, 165, 165], [2, 9002, 'JO-2', 2, 0, 80, 0]], 'lines keep position, Sellercloud id, SKU, qty, returns, total, refund');
  eq(lines("company_id = 169").map(r => [r.unit, r.order_date]), [[163, '2026-11-18']], 'Poshmark lines count on Shoes and Fashions (163)');
  eq(lines("sku = 'HA-1'").map(r => [r.site_cost, r.average_cost, r.last_cost]), [[20, null, null]], 'a real cost is kept; 0 is stored as NULL');
  eq(lines("sku = 'RW-1'").map(r => r.site_cost), [null, null], 'Sellercloud\'s 0 cost is NULL, not 0');
  eq(lines("unit = 165").length, 60, 'two pages of Bass River orders all keep their lines');
  eq(lines("order_id = 6").map(r => r.sku), [null, null], 'a missing or blank SKU is stored as NULL');
  const dump = JSON.stringify(lines());
  for (const s of ['Secretfirst', 'buyer-secret@example.com', 'Secretstreet']) ok(!dump.includes(s), `no buyer data in the lines ("${s}")`);

  await tick(env, '2026-11-18T20:00:00Z');
  eq(lines().length, 69, 'a second sync duplicates nothing');

  const o2 = ORDERS.find(o => o.ID === 2);
  o2.Items = [o2.Items[1]];                       // Sellercloud now has one line on order 2
  await tick(env, '2026-11-18T20:15:00Z');
  eq(lines('order_id = 2').map(r => [r.line_no, r.sku]), [[1, 'JO-2']], 'a changed order\'s lines are replaced');

  o2.Items = [];                                  // …and then sends the order with no lines at all
  await tick(env, '2026-11-18T20:30:00Z');
  eq(lines('order_id = 2').map(r => r.sku), ['JO-2'], 'an order sent with NO lines keeps the lines already stored');
  o2.Items = [line('RW-1', 'Red Wing 2217 Boots', 1, 165, { ID: 9001, QtyReturned: 1, TotalRefunded: 165 }), line('JO-2', 'johnnie-O Polo 50% off', 2, 80, { ID: 9002 })];
  await tick(env, '2026-11-18T20:45:00Z');
  eq(lines('order_id = 2').length, 2, 'and takes them back when Sellercloud sends them again');
}

// ── 2. worker ahead of migration-091 ─────────────────────────────────────
{
  const pre = setup({ lines: false });
  await tick(pre.env);
  const state = JSON.parse(await pre.env.SALES_SNAPSHOTS.get('ecom:sync'));
  ok(state.ok === true && state.linesSkipped === true && state.lines === 0, `orders sync, lines reported skipped, got ${JSON.stringify(state).slice(0, 200)}`);
  eq(pre.db.prepare('SELECT COUNT(*) AS n FROM ecom_orders').get().n, ORDERS.filter(o => o.TimeOfOrder >= '2026-11-17').length, 'every order is still written');
  eq((await items(pre.env, '&company=163&from=2026-11-17&to=2026-11-18')).status, 503, 'and the read answers 503 "not set up"');
}

// ── 3. the read ───────────────────────────────────────────────────────────
{
  const r = await items(env, '&company=163&from=2026-11-17&to=2026-11-18');
  const b = r.body;
  ok(r.status === 200 && b.ok, `admin reads Shoes and Fashions' products, got ${r.status} ${r.text.slice(0, 160)}`);
  eq(b.items.map(x => [x.sku, x.name, x.units, x.sales, x.orders, x.returned, x.refunded, x.lastSold]), [
    ['RW-1', 'Red Wing 2217 Boots', 2, 340, 2, 1, 165, '2026-11-18'],
    ['JO-2', 'johnnie-O Polo 50% off', 3, 120, 2, 0, 0, '2026-11-18'],
    ['PM-1', 'Poshmark Dress', 1, 30, 1, 0, 0, '2026-11-18'],
    [null, 'No-SKU scarf', 2, 24, 1, 0, 0, '2026-11-18'],
  ], 'one row per SKU (by name with none), by sales; the cancelled order is left out; Poshmark is in');
  eq([b.totals.products, b.totals.lines, b.totals.units, b.totals.sales, b.totals.returned, b.totals.refunded], [4, 7, 8, 514, 1, 165], 'totals over the range');
  eq([b.totals.costedSales, b.totals.coverage], [0, 0], 'no cost anywhere → coverage 0');
  eq([b.orders.sold, b.orders.withLines], [5, 5], 'every sold order has its lines');
  eq([b.sort, b.q, b.matched, b.truncated, b.limit], ['sales', '', null, false, 500], 'defaults');
  for (const s of ['Secretfirst', 'buyer-secret@example.com', 'Secretstreet']) ok(!r.text.includes(s), `no buyer data ("${s}")`);

  const byUnits = await items(env, '&company=163&from=2026-11-17&to=2026-11-18&sort=units');
  eq(byUnits.body.items.map(x => x.sku), ['JO-2', 'RW-1', null, 'PM-1'], 'sort=units: units first, then sales');

  const day = await items(env, '&company=163&from=2026-11-17&to=2026-11-17');
  eq(day.body.items.map(x => [x.sku, x.units, x.sales]), [['JO-2', 1, 40]], 'a one-day range reads that day only');

  const red = await items(env, '&company=163&from=2026-11-17&to=2026-11-18&q=red%20wing');
  eq(red.body.items.map(x => x.sku), ['RW-1'], 'search matches the name, any case');
  eq([red.body.matched.products, red.body.matched.sales, red.body.totals.sales], [1, 340, 514], 'matched covers the hits; totals stay the whole range (Share divides by it)');
  eq((await items(env, '&company=163&from=2026-11-17&to=2026-11-18&q=jo-2')).body.items.map(x => x.sku), ['JO-2'], 'search matches the SKU');
  eq((await items(env, '&company=163&from=2026-11-17&to=2026-11-18&q=50%25')).body.items.map(x => x.sku), ['JO-2'], '% is taken literally, not as "anything"');
  eq((await items(env, '&company=163&from=2026-11-17&to=2026-11-18&q=_')).body.items.length, 0, '_ is taken literally');

  const cost = await items(env, '&company=164&from=2026-11-18&to=2026-11-18');
  eq([cost.body.items[0].cost, cost.body.items[0].costedSales, cost.body.totals.coverage, cost.body.totals.cost], [20, 50, 1, 20], 'a costed line carries cost, and coverage is 1');

  // A $0 order is not a sale (Brian, 2026-11-18): a Wholesale lot's 37,875 units must not top By units.
  db.prepare(`INSERT INTO ecom_orders (order_id, company_id, unit, order_date, status_code, source, grand_total, units, synced_at) VALUES (990001, 163, 163, '2026-11-18', 2, 21, 0, 37875, 'x')`).run();
  db.prepare(`INSERT INTO ecom_order_items (order_id, line_no, company_id, unit, order_date, sku, name, qty, line_total, synced_at) VALUES (990001, 1, 163, 163, '2026-11-18', '50196', 'FG TJX - APPAREL', 37875, 0, 'x')`).run();
  const zero = await items(env, '&company=163&from=2026-11-17&to=2026-11-18&sort=units');
  eq([zero.body.items.map(x => x.sku), zero.body.totals.units, zero.body.orders.sold], [['JO-2', 'RW-1', null, 'PM-1'], 8, 5], 'a $0 order\'s lines are not products sold, and it is not an order sold');
  db.prepare('DELETE FROM ecom_order_items WHERE order_id = 990001').run();
  db.prepare('DELETE FROM ecom_orders WHERE order_id = 990001').run();

  const bass = await items(env, '&company=165&from=2026-11-18&to=2026-11-18');
  eq([bass.body.items.length, bass.body.totals.products, bass.body.items[0].sku], [60, 60, 'BR-59'], '60 products, best seller first');
}

// ── 4. the 500-row cap ────────────────────────────────────────────────────
{
  const big = setup();
  const ins = big.db.prepare(`INSERT INTO ecom_order_items (order_id, line_no, company_id, unit, order_date, sku, name, qty, line_total, synced_at) VALUES (?, 1, 166, 166, '2026-11-10', ?, ?, 1, ?, 'x')`);
  const ord = big.db.prepare(`INSERT INTO ecom_orders (order_id, company_id, unit, order_date, status_code, grand_total, synced_at) VALUES (?, 166, 166, '2026-11-10', 3, ?, 'x')`);
  for (let n = 1; n <= 520; n++) { ord.run(n, n); ins.run(n, 'DP-' + n, 'Detail item ' + n, n); }
  const b = (await items(big.env, '&company=166&from=2026-11-10&to=2026-11-10')).body;
  eq([b.items.length, b.totals.products, b.truncated, b.items[0].sku, b.items[499].sku], [500, 520, true, 'DP-520', 'DP-21'], 'rows stop at 500, totals do not, and it says so');
  const s = (await items(big.env, '&company=166&from=2026-11-10&to=2026-11-10&q=DP-51')).body;
  eq([s.items.length, s.matched.products, s.truncated], [11, 11, false], 'a search below the cap is complete');
  big.db.prepare('DELETE FROM ecom_order_items WHERE order_id > 510').run();
  const part = (await items(big.env, '&company=166&from=2026-11-10&to=2026-11-10')).body;
  eq([part.orders.sold, part.orders.withLines], [520, 510], 'orders without stored lines are counted, so the page can say so');
}

// ── 5. who sees what ──────────────────────────────────────────────────────
{
  eq((await items(env, '&company=164', { user: 'u-mgr2' })).status, 200, 'a manager scoped to 164 reads 164');
  const other = await items(env, '&company=163', { user: 'u-mgr2' });
  eq([other.status, other.body && other.body.code], [403, 'NO_UNIT_ACCESS'], '…and is refused 163');
  eq((await items(env, '&company=163', { user: 'u-mgr1' })).status, 403, 'a Bargain-Lane-only manager is refused');
  eq((await items(env, '&company=163', { user: 'u-staff' })).status, 403, 'a non-financial role is refused');
  eq((await items(env, '&company=163', { secret: env.SNAPSHOT_SECRET })).status, 401, 'the snapshot secret alone gets nothing');
  eq((await items(env, '&company=163', {})).status, 401, 'signed out is refused');
  eq((await items(env, '&company=168')).status, 400, 'wholesale (168) is not a company here');
  eq((await items(env, '&company=163&from=2026-11-18&to=2026-11-01')).status, 400, 'from after to → 400');
  eq((await items(env, '&company=163&from=2024-01-01&to=2026-11-01')).status, 400, 'more than 400 days → 400');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
