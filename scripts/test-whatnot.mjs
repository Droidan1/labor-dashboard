// The Whatnot Seller API mirror (2026-10-30): syncWhatnot, the three reads, and the MCP tools.
//
// WHAT THIS PROTECTS. Brian (2026-10-30): pull Whatnot into the Hub, read-only, with the
// Bargain Lane Live recap email kept as the source of live-sales dollars and the API
// cross-checking it. So:
//   - the sync pages Whatnot correctly (newest-first head, oldest-first backfill, watermark),
//     survives a 429, stops at its call budget without half-marking an order, and re-runs
//     without duplicating anything;
//   - a show is filed exactly as the recap files it (start before 3:30 PM Eastern = BL1,
//     else BL14), from the REAL start once analytics knows it;
//   - nothing about a buyer is stored, and channel_sales / daily_sales are never written;
//   - the cross-check says match / gap / pending, and pushes a gap once, not every hour;
//   - the reads honour store scoping and the financial gate like every other money read.
// A stubbed Whatnot API stands in for api.whatnot.com; everything else is the real worker.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadWorker, makeEnv, ctx, blockNetwork, stubWorkersRuntime, applyMigrationAlters, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const worker = await loadWorker(repo);
blockNetwork();
const blocked = globalThis.fetch;

// ── The fake Whatnot account ───────────────────────────────────────────────
// 2026-10-28 and -29 are EDT (UTC-4). 3:30 PM Eastern = 19:30Z.
const SHOWS = [
  { id: 'sh-c', title: 'Rehearsal', status: 'ended', scheduled_start_at: '2026-10-28T16:00:00Z', updated_at: 'u1' },
  { id: 'sh-a', title: 'Morning apparel', status: 'ended', scheduled_start_at: '2026-10-28T17:00:00Z', updated_at: 'u1' },
  { id: 'sh-b', title: 'Battle Creek night', status: 'ended', scheduled_start_at: '2026-10-28T23:00:00Z', updated_at: 'u1' },
  // Scheduled 3:20 PM (BL1) but went live 3:40 PM (BL14): the real start decides, as in the recap.
  { id: 'sh-d', title: 'Late start', status: 'ended', scheduled_start_at: '2026-10-29T19:20:00Z', updated_at: 'u1' },
  { id: 'sh-next', title: 'Next week', status: 'scheduled', scheduled_start_at: '2026-11-04T17:00:00Z', updated_at: 'u1' },
];
let shDCalculated = false;
const analyticsFor = (id) => ({
  'sh-a': { calculation_status: 'CALCULATED', start_time: '2026-10-28T17:03:00Z', sales: { amount: '100.00', currency: 'USD' }, estimated_earnings: { amount: '88.00', currency: 'USD' }, orders_count: 40, buyers_count: 12, first_time_buyers_count: 3, returning_buyers_count: 9, max_concurrent_viewers: 41, stream_minutes: 95 },
  'sh-b': { calculation_status: 'CALCULATED', start_time: '2026-10-28T23:01:00Z', sales: { amount: '50.00', currency: 'USD' }, orders_count: 15, buyers_count: 6 },
  'sh-c': { calculation_status: 'WILL_NOT_BE_CALCULATED', start_time: '2026-10-28T16:00:00Z', sales: null },
  'sh-d': shDCalculated
    ? { calculation_status: 'CALCULATED', start_time: '2026-10-29T19:40:00Z', sales: { amount: '30.00', currency: 'USD' }, orders_count: 4 }
    : { calculation_status: 'PENDING', start_time: '2026-10-29T19:40:00Z', sales: null },
}[id]);

const PRODUCTS = {
  'p-1': { id: 'p-1', title: 'Womens top', category: { id: 'c-wt', name: "Women's Tops" } },
  'p-2': { id: 'p-2', title: 'Mens jacket', category: { id: 'c-mo', name: "Men's Outerwear" } },
  'p-3': { id: 'p-3', title: 'Mystery lot', category: null },
  // p-gone: a deleted listing (404)
};
const PIDS = ['p-1', 'p-2', 'p-3', 'p-gone'];
const minutes = (iso, m) => new Date(Date.parse(iso) + m * 60e3).toISOString().replace('.000Z', 'Z');
// 60 orders, o-1 oldest … o-60 newest: 40 in sh-a, 15 in sh-b, 4 in sh-d (o-57 cancelled),
// and o-60 from the profile shop (no show). Every one carries a buyer the Hub must not keep.
const ORDERS = [];
for (let n = 1; n <= 60; n++) {
  const show = n <= 40 ? 'sh-a' : n <= 55 ? 'sh-b' : n <= 59 ? 'sh-d' : null;
  const created = n <= 40 ? minutes('2026-10-28T17:05:00Z', 3 * (n - 1)) : n <= 55 ? minutes('2026-10-28T23:05:00Z', 3 * (n - 41)) : minutes('2026-10-29T19:45:00Z', 3 * (n - 56));
  ORDERS.push({
    id: String(1000 + n), show_id: show, status: n === 57 ? 'cancelled' : 'completed',
    transaction_type: show ? 'auction' : 'buy_it_now', created_at: created, updated_at: created,
    buyer: { id: 'b' + n, username: 'secret_buyer_' + n, display_name: 'Secret Buyer' },
    amounts: { subtotal: { amount: '2.50', currency: 'USD' }, shipping: { amount: '7.99', currency: 'USD' }, tax: { amount: '0.18', currency: 'USD' }, total: { amount: '10.67', currency: 'USD' } },
  });
}
const itemsFor = (orderId) => {
  const n = Number(orderId) - 1000;
  const base = [{ id: 'i-' + n, order_id: orderId, quantity: 1, product_id: PIDS[n % 4], variant_id: 'v-' + n,
    unit_price: { amount: '2.50', currency: 'USD' }, price_includes_tax: false, purchased_item: { title: 'Item ' + PIDS[n % 4], sku: 'SKU-' + PIDS[n % 4] } }];
  if (n === 10) base.push({ id: 'i-10b', order_id: orderId, quantity: 2, product_id: 'p-2', unit_price: { amount: '4.00', currency: 'USD' }, purchased_item: { title: 'Item p-2', sku: 'SKU-p-2' } });
  return base;
};

// One page of `list` from `cursor` (an offset), Whatnot-style.
const page = (list, params) => {
  const limit = Number(params.get('limit') || 10), from = Number(params.get('cursor') || 0);
  const data = list.slice(from, from + limit);
  return { data, next_cursor: from + limit < list.length ? String(from + limit) : null };
};
let calls = [], throttleNextOrders = false, badToken = false;
const whatnot = async (u, init) => {
  const s = String(u);
  if (!s.startsWith('https://api.whatnot.com/seller-api/rest/v2/')) return blocked(u, init);
  const url = new URL(s), p = url.pathname.replace('/seller-api/rest/v2', ''), q = url.searchParams;
  calls.push(p + (q.toString() ? '?' + q : ''));
  const auth = init && init.headers && init.headers.Authorization;
  const res = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  if (badToken || auth !== 'Bearer wn_pat_tk_test') return res(401, { type: 'unauthorized' });
  if (p === '/shows') {
    const list = SHOWS.filter(x => x.status === (q.get('status') || 'scheduled'));
    return res(200, page(q.get('reverse') === 'false' ? list : [...list].reverse(), q));
  }
  let m;
  if ((m = p.match(/^\/analytics\/shows\/([^/]+)$/))) { const a = analyticsFor(m[1]); return a ? res(200, { show_id: m[1], ...a }) : res(404, {}); }
  if (p === '/orders') {
    if (throttleNextOrders) { throttleNextOrders = false; return res(429, { type: 'rate-limited', status: 429 }, { 'Retry-After': '0' }); }
    if (q.get('cursor') === 'stale') return res(422, { type: 'validation' });
    return res(200, page(q.get('reverse') === 'false' ? ORDERS : [...ORDERS].reverse(), q));
  }
  if ((m = p.match(/^\/orders\/(\d+)\/items$/))) return res(200, page(itemsFor(m[1]), q));
  if ((m = p.match(/^\/products\/([^/]+)\/variants$/))) {
    return PRODUCTS[m[1]] ? res(200, { data: [{ id: 'v-' + m[1], sku: 'SKU-' + m[1], selected_options: [{ name: 'Size', value: 'M' }],
      pricing: { buy_it_now: { price: { amount: '12.00', currency: 'USD' } }, auction: { start_price: { amount: '1.00', currency: 'USD' } } },
      inventory: { available_quantity: 4 } }], next_cursor: null }) : res(404, {});
  }
  if ((m = p.match(/^\/products\/([^/]+)$/))) return PRODUCTS[m[1]] ? res(200, PRODUCTS[m[1]]) : res(404, {});
  if (p === '/products') return res(200, page(Object.values(PRODUCTS), q));
  return res(404, {});
};
globalThis.fetch = whatnot;

function freshEnv() {
  const { db, env } = makeEnv(repo);
  for (const m of ['015', '084']) db.exec(fs.readFileSync(path.join(repo, `migration-${m}.sql`), 'utf8'));
  applyMigrationAlters(db, repo);
  env.WHATNOT_API_TOKEN = 'wn_pat_tk_test';
  return { db, env };
}
const NOW = new Date('2026-10-30T16:00:00Z');   // noon Eastern, Fri 2026-10-30

// ── 0. Not configured: nothing is called ───────────────────────────────────
{
  const { db, env } = makeEnv(repo);
  calls = [];
  db.exec(fs.readFileSync(path.join(repo, 'migration-084.sql'), 'utf8'));
  const r = await worker.fetch(req('/?action=whatnot-sync', { user: 'u-su', method: 'POST' }), env, ctx);
  eq([(await r.json()).skipped, calls.length], ['no DB or WHATNOT_API_TOKEN', 0], 'no token: the sync is skipped and Whatnot is never called');
  const { env: env2 } = makeEnv(repo);
  env2.WHATNOT_API_TOKEN = 'wn_pat_tk_test';
  const r2 = await worker.fetch(req('/?action=whatnot-sync', { user: 'u-su', method: 'POST' }), env2, ctx);
  eq([(await r2.json()).skipped, calls.length], ['migration-084 not applied', 0], 'no tables: skipped, nothing called');
  const r3 = await worker.fetch(req('/?action=whatnot-shows&from=2026-10-28&to=2026-10-29', { user: 'u-su' }), env2, ctx);
  eq(r3.status, 503, 'and the reads say not set up, rather than 500');
}

// ── 1. First sync ──────────────────────────────────────────────────────────
const { db, env } = freshEnv();
// The recap's rows (scripts/whatnot-recap-ingest.gs posts $0 for a store with no shows).
const recap = db.prepare(`INSERT INTO channel_sales (channel, store, date, total, count, source_file, ingested_at) VALUES ('whatnot', ?, ?, ?, ?, 'Bargain Lane Live recap', 't')`);
recap.run('BL1', '2026-10-28', 100, 2);   // sh-a 100 + rehearsal 0 → match
recap.run('BL14', '2026-10-28', 45, 1);   // API says 50 → gap +5
recap.run('BL1', '2026-10-29', 0, 0);     // sh-d moved to BL14 by its real start → match at 0
recap.run('BL14', '2026-10-29', 30, 1);   // sh-d's analytics still PENDING on run 1
const liveBefore = JSON.stringify([db.prepare('SELECT * FROM channel_sales ORDER BY id').all(), db.prepare('SELECT store, date, total, auction FROM daily_sales ORDER BY store, date').all()]);

// Every scheduled run below happens at NOW, through the worker's own hourly cron handler, so
// the cron wiring is exercised and the cross-check's "last 7 days" is fixed.
const RealDate = Date;
const atNow = async (fn) => {
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [NOW.getTime()])); } static now() { return NOW.getTime(); } };
  try { return await fn(); } finally { globalThis.Date = RealDate; }
};
const runAt = () => atNow(async () => {
  const waits = [], logs = [], real = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    await worker.scheduled({ cron: '0 * * * *', scheduledTime: NOW.getTime() }, env, { waitUntil: (p) => waits.push(p), passThroughOnException() {} });
    await Promise.allSettled(waits);
  } finally { console.log = real; }
  const line = logs.find(l => l.startsWith('whatnot-sync:'));
  return line ? JSON.parse(line.slice('whatnot-sync:'.length)) : null;
});
calls = [];
throttleNextOrders = true;
const r1 = await runAt();
ok(r1 && !r1.error, 'run 1 (the hourly cron) has no error: ' + JSON.stringify(r1 && (r1.error || r1.skipped)));
eq([r1?.crossCheck?.gaps, r1?.crossCheck?.pushed], [1, 1], 'run 1: one gap (BL14 10-28), pushed');
eq([r1.complete, r1.shows, r1.orders, r1.backfill], [true, 4, 60, 'done'], 'run 1: 4 ended shows (not the scheduled one), all 60 orders (head 50 + backfill 10), backfill done');
ok(calls.every(c => !c.startsWith('/shows') || c.includes('status=ended')), 'shows are asked for ended only');
eq(calls.filter(c => c.startsWith('/orders?')).slice(0, 2).map(c => c.includes('reverse=true')), [true, true], 'a 429 on the first /orders call is retried (same request)');
eq(calls.filter(c => c.startsWith('/orders?') && c.includes('reverse=false')).length, 1, 'the backfill read oldest-first and stopped where the head began');
eq(db.prepare('SELECT COUNT(*) n FROM whatnot_orders').get().n, 60, 'every order stored once');
eq(db.prepare('SELECT COUNT(*) n FROM whatnot_orders WHERE items_synced = 0').get().n, 10, 'the 10 backfilled orders wait for next run\'s items');
eq(db.prepare("SELECT store, show_date FROM whatnot_shows WHERE id = 'sh-d'").get(), { store: 'BL14', show_date: '2026-10-29' }, 'sh-d: scheduled 3:20 PM but started 3:40 PM, filed BL14 as the recap files it');
eq(db.prepare("SELECT id, store FROM whatnot_shows WHERE id IN ('sh-a','sh-b','sh-c') ORDER BY id").all().map(r => r.store), ['BL1', 'BL14', 'BL1'], 'before 3:30 PM Eastern = BL1, after = BL14');
eq(db.prepare("SELECT category_name, found FROM whatnot_products ORDER BY id").all().map(r => [r.category_name, r.found]),
  [["Women's Tops", 1], ["Men's Outerwear", 1], [null, 1], [null, 0]], 'products read once each for their category; a 404 is remembered as found = 0');

// 🔒 No buyer, anywhere.
const dump = JSON.stringify(['whatnot_shows', 'whatnot_show_analytics', 'whatnot_orders', 'whatnot_order_items', 'whatnot_products', 'whatnot_sync'].map(t => db.prepare(`SELECT * FROM ${t}`).all()));
ok(!/secret_buyer|Secret Buyer|"b\d+"/.test(dump), 'no buyer id, username or name is stored in any whatnot_ table');
eq(JSON.stringify([db.prepare('SELECT * FROM channel_sales ORDER BY id').all(), db.prepare('SELECT store, date, total, auction FROM daily_sales ORDER BY store, date').all()]), liveBefore, 'channel_sales and daily_sales are untouched (the recap stays the source of live sales)');

// ── 2. The cross-check, the reads, and later runs ──────────────────────────
const showsRead = async (user, q = 'from=2026-10-28&to=2026-10-29') => {
  const r = await worker.fetch(req(`/?action=whatnot-shows&${q}`, { user }), env, ctx);
  return { status: r.status, body: await r.json() };
};
{
  const { body } = await showsRead('u-su');
  eq(body.days.map(d => [d.store, d.date, d.status, d.diff]), [
    ['BL1', '2026-10-28', 'match', 0], ['BL14', '2026-10-28', 'gap', 5], ['BL1', '2026-10-29', 'match', 0], ['BL14', '2026-10-29', 'pending', null],
  ], 'per store-day: rehearsal counts $0, the gap is +$5, a PENDING show holds its day (no diff until final)');
  eq(body.shows.map(s => s.showId), ['sh-c', 'sh-a', 'sh-b', 'sh-d'], 'every ended show in the range, by start');
  const a = body.shows.find(s => s.showId === 'sh-a');
  eq([a.analytics.sales, a.analytics.estimatedEarnings, a.analytics.buyers, a.orders.count, a.orders.itemsPending, a.items.units, a.items.sales],
    [100, 88, 12, 40, 10, 30, 75], 'sh-a after run 1: analytics and 40 orders; the 10 backfilled ones not itemised yet');
  eq(body.shows.find(s => s.showId === 'sh-d').orders, { count: 3, subtotal: 7.5, itemsPending: 0 }, 'sh-d: the cancelled order counts nowhere');
  eq([body.sync.connected, body.sync.lastRun.complete], [true, true], 'and the sync status rides along');
}
{
  calls = [];
  const r2 = await runAt();
  ok(r2 && !r2.error, 'run 2 ran: ' + JSON.stringify(r2 && (r2.error || r2.skipped)));
  eq([r2?.crossCheck?.gaps, r2?.crossCheck?.pushed], [1, 0], 'run 2: the same gap is not pushed again');
  eq([r2?.items, r2?.shows, r2?.orders], [11, 0, 60], 'run 2: 11 item lines for the 10 backfilled orders (one is a 2-pack); unchanged shows; 3 days of orders re-read');
  eq(calls.filter(c => c.startsWith('/shows')).length, 1, 'one shows call when nothing changed');
  ok(!calls.some(c => /^\/orders\/\d+\/items/.test(c) && Number(c.split('/')[2]) > 1010), 'orders already itemised are not asked for again');
  shDCalculated = true;
  const r3 = await runAt();
  eq([r3?.crossCheck?.gaps, r3?.crossCheck?.pushed, r3?.analytics], [1, 0, 1], 'run 3: still one gap, not pushed; sh-d\'s analytics re-read once calculated');
  eq(db.prepare("SELECT value FROM whatnot_sync WHERE key = 'xcheck:BL14:2026-10-28'").get()?.value, '5', 'the pushed gap is remembered with its amount');
}
{
  const { body } = await showsRead('u-su');
  const a = body.shows.find(s => s.showId === 'sh-a');
  eq([a.orders.itemsPending, a.items.units, a.items.sales], [0, 42, 108], 'sh-a once caught up: 42 units (one order added a 2-unit line) worth $108');
  eq(body.days.find(d => d.store === 'BL14' && d.date === '2026-10-29').status, 'match', 'once sh-d is calculated its day matches the recap');
  eq([db.prepare('SELECT COUNT(*) n FROM whatnot_order_items').get().n, db.prepare('SELECT COUNT(*) n FROM whatnot_orders').get().n], [61, 60], 'three runs, still 60 orders and 61 item lines: nothing duplicated');
  eq(db.prepare('SELECT COUNT(*) n FROM whatnot_orders WHERE items_synced = 0').get().n, 0, 'every order itemised');
}

// ── 3. whatnot-items ───────────────────────────────────────────────────────
{
  const r = await worker.fetch(req('/?action=whatnot-items&from=2026-10-28&to=2026-10-29', { user: 'u-su' }), env, ctx);
  const b = await r.json();
  eq(b.unattributedIncluded, true, 'every store, asked by a superuser: the profile-shop order is included');
  eq(b.categories.map(c => [c.category, c.units, c.sales]), [
    ['Uncategorized', 30, 75], ["Men's Outerwear", 16, 43], ["Women's Tops", 15, 37.5],
  ], 'by Whatnot category; no category and a deleted listing are Uncategorized; the cancelled order is left out');
  eq([b.totals.lines, b.totals.units, b.totals.sales], [60, 61, 155.5], 'totals over every line');
  eq(b.items.find(i => i.sku === 'SKU-p-1' && i.stores.includes('unattributed'))?.stores, ['BL1', 'BL14', 'unattributed'], 'the profile-shop order is listed as unattributed');
  eq(b.coverage, { ordersNotItemised: 0, categoryNotLookedUp: 0 }, 'coverage: fully caught up');
  const p2 = b.items.find(i => i.sku === 'SKU-p-2');
  eq([p2.units, p2.avgPrice, p2.stores, p2.firstDate, p2.lastDate], [16, 2.69, ['BL1', 'BL14'], '2026-10-28', '2026-10-28'], 'per item: units, average price, where and when it sold');
  const m = await (await worker.fetch(req('/?action=whatnot-items&from=2026-10-28&to=2026-10-29', { user: 'u-mgr1' }), env, ctx)).json();
  eq([m.stores, m.unattributedIncluded, m.totals.lines], [['BL1'], false, 41], 'a BL1 manager: BL1\'s shows only, no profile-shop orders');
}

// ── 4. Scoping and gates ───────────────────────────────────────────────────
{
  const m = await showsRead('u-mgr1');
  eq([m.status, [...new Set(m.body.shows.map(s => s.storeId))], [...new Set(m.body.days.map(d => d.store))]], [200, ['BL1'], ['BL1']], 'a BL1 manager sees BL1\'s shows and days only');
  eq((await showsRead('u-mgr1', 'from=2026-10-28&to=2026-10-29&store=BL14')).status, 403, 'and is refused BL14');
  eq((await showsRead('u-staff')).status, 403, 'staff (no financial access) is refused');
  eq((await showsRead('u-su', 'from=2026-10-29&to=2026-10-28')).status, 400, 'to before from is refused');
  const s = await (await worker.fetch(req('/?action=whatnot-sync', { user: 'u-admin', method: 'POST' }), env, ctx)).json();
  eq(s.code, 'NEED_SUPERUSER', 'an admin cannot run the sync');
  const g = await worker.fetch(new Request('https://api.retjghub.com/?action=whatnot-sync', { method: 'POST', headers: { 'X-API-Key': 'whatever' } }), env, ctx);
  eq(g.status, 401, 'the reporting key cannot run the sync');
}

// ── 5. Budget, and an expired backfill cursor ──────────────────────────────
{
  // Cut a run short mid-items (Whatnot starts failing after 5 item reads): no order may be
  // marked itemised without its items.
  const cut = freshEnv();
  let n = 0;
  globalThis.fetch = async (u, init) => {
    if (String(u).includes('/items')) { n++; if (n > 5) return new Response('{}', { status: 500 }); }
    return whatnot(u, init);
  };
  const rc = await (await worker.fetch(req('/?action=whatnot-sync', { user: 'u-su', method: 'POST' }), cut.env, ctx)).json();
  globalThis.fetch = whatnot;
  eq([rc.complete, /→ 500/.test(rc.error || '')], [false, true], 'a Whatnot error stops the run and is reported, not thrown');
  eq(cut.db.prepare(`SELECT COUNT(*) n FROM whatnot_orders o WHERE items_synced = 1 AND NOT EXISTS (SELECT 1 FROM whatnot_order_items i WHERE i.order_id = o.id)`).get().n, 0, 'no order is marked itemised without its items');
  eq(cut.db.prepare('SELECT COUNT(*) n FROM whatnot_orders WHERE items_synced = 1').get().n, 5, 'the 5 that were read are kept');
  const lr = JSON.parse(cut.db.prepare("SELECT value FROM whatnot_sync WHERE key = 'last_run'").get().value);
  eq(lr.complete, false, 'last_run records the incomplete run');
  // An expired backfill cursor restarts the backfill instead of failing every hour.
  cut.db.prepare("UPDATE whatnot_sync SET value = ? WHERE key = 'orders_backfill'").run(JSON.stringify({ cursor: 'stale', until: '2026-10-28T23:00:00.000Z' }));
  const rs = await (await worker.fetch(req('/?action=whatnot-sync', { user: 'u-su', method: 'POST' }), cut.env, ctx)).json();
  eq(rs.backfill, 'restarted', 'a 422 on the backfill cursor restarts the backfill');
  eq(JSON.parse(cut.db.prepare("SELECT value FROM whatnot_sync WHERE key = 'orders_backfill'").get().value).cursor, null, 'from the oldest order');
  badToken = true;
  const rb = await (await worker.fetch(req('/?action=whatnot-sync', { user: 'u-su', method: 'POST' }), cut.env, ctx)).json();
  badToken = false;
  ok(/→ 401/.test(rb.error || ''), 'an expired or revoked token is reported as a 401 in last_run');
}

// ── 6. whatnot-products (live) ─────────────────────────────────────────────
{
  calls = [];
  const r = await worker.fetch(req('/?action=whatnot-products&limit=2', { user: 'u-su' }), env, ctx);
  const b = await r.json();
  eq(b.products.map(p => [p.title, p.category, p.available, p.variants[0].buyItNowPrice, p.variants[0].auctionStartPrice, p.variants[0].options]),
    [['Womens top', "Women's Tops", 4, 12, 1, 'Size: M'], ['Mens jacket', "Men's Outerwear", 4, 12, 1, 'Size: M']], 'a page of products with variant prices and quantity');
  eq([b.nextCursor, calls.length], ['2', 3], 'with the next cursor; one list call plus one variants call per product');
  eq((await worker.fetch(req('/?action=whatnot-products&limit=99', { user: 'u-su' }), env, ctx)).status, 400, 'limit above 50 is refused');
  eq((await worker.fetch(req('/?action=whatnot-products', { user: 'u-staff' }), env, ctx)).status, 403, 'staff is refused');
}

// ── 7. The MCP tools ───────────────────────────────────────────────────────
await stubWorkersRuntime();
const { default: mcp } = await import(pathToFileURL(path.join(repo, 'mcp', 'worker.mjs')).href);
env.MORNING_BRIEFING_KEY = 'test-briefing-key';
const upstream = [];
const mcpEnv = { MCP_KEY: 'test-mcp-key', REPORTING_API_KEY: 'test-briefing-key',
  API: { fetch: async (r) => { upstream.push(new URL(r.url).searchParams); return worker.fetch(r, env, ctx); } } };
let id = 1;
async function tool(name, args = {}) {
  const r = await mcp.fetch(new Request('https://mcp.retjghub.com/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-mcp-key' },
    body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } }),
  }), mcpEnv, ctx);
  const res = (await r.json()).result;
  return res.isError ? { isError: true, text: res.content[0].text } : JSON.parse(res.content[0].text);
}
{
  const t = await tool('get_whatnot_shows', { from: '2026-10-28', to: '2026-10-29' });
  ok(!t.isError, 'get_whatnot_shows answers: ' + (t.text || 'ok'));
  eq([t.shows?.[0]?.showId, t.listed, t.days?.length, t.totals?.sales], ['sh-d', 4, 4, 180], 'newest show first, every day, analytics sales summed');
  eq(t.shows?.find(s => s.showId === 'sh-c')?.analytics, { calculationStatus: 'WILL_NOT_BE_CALCULATED' }, 'nulls are dropped from a show\'s analytics');
  const i = await tool('get_whatnot_items', { from: '2026-10-28', to: '2026-10-29', storeId: 'bl14', search: 'outerwear' });
  eq([upstream.at(-1).get('store'), i.matched, i.items?.[0]?.category, i.categories?.length], ['BL14', 1, "Men's Outerwear", 3], 'get_whatnot_items: store upper-cased, search filters items, categories stay whole');
  const p = await tool('get_whatnot_products', { productLimit: 1 });
  eq([upstream.at(-1).get('action'), upstream.at(-1).get('limit'), p.products?.length, p.nextCursor], ['whatnot-products', '1', 1, '1'], 'get_whatnot_products: one page, live');
  const p2 = await tool('get_whatnot_products', { productLimit: 1, cursor: p.nextCursor });
  eq(p2.products?.[0]?.title, 'Mens jacket', 'and the cursor reads the next page');
  ok((await tool('get_whatnot_items', { from: '2026-09-01', to: '2026-10-29' })).isError, 'a two-store range over 31 days is refused before any call');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
