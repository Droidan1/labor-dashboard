// Whatnot's financial report → Live Sales "Money back" (migration-086 + syncWhatnotLedger).
//
// WHAT THIS PROTECTS. Brian (2026-11-02): fill Money back with refunds, carrier adjustments and
// tips, which only Whatnot's seller_financial_report carries (an async report: request, poll,
// download a CSV). So:
//   - one report run at a time: requested, polled on later runs, ingested once, never re-requested
//     while one is outstanding; the backfill walks forward from the first order, then a caught-up
//     sync asks again only every 6 hours, re-reading the last 7 days;
//   - only refund, carrier-adjustment and tip rows are kept, and nothing about a buyer;
//   - the token goes to Whatnot only, never to the host the report file sits on;
//   - a token without write:reports (403), a failed report or a changed file never stops the rest
//     of the sync, never advances the cursor, and says why;
//   - the read attributes a row to the store of its show (else its order's show), keeps the
//     Eastern day, and shows a row with no store only to someone who sees every live store.
// A stubbed Whatnot API stands in for api.whatnot.com. The figures are made up: this repo is public.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, blockNetwork, applyMigrationAlters, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const worker = await loadWorker(repo);
blockNetwork();
const blocked = globalThis.fetch;
const sql = (m) => fs.readFileSync(path.join(repo, `migration-${m}.sql`), 'utf8');

// ── The report files ───────────────────────────────────────────────────────
// Every column of FinancialReportRow, in order (the CSV header is the row type's own fields).
const COLS = ['transaction_completed_at_utc', 'order_placed_at_utc', 'seller_id', 'transaction_type', 'transaction_message',
  'order_id', 'listing_title', 'listing_description', 'product_category', 'buy_format', 'sale_type', 'quantity_sold', 'sku',
  'cost_of_goods', 'livestream_id', 'livestream_title', 'buyer_name', 'buyer_state', 'buyer_country', 'shipment_id',
  'transaction_currency', 'transaction_amount', 'buyer_paid', 'original_item_price', 'coupon_cost', 'post_coupon_price',
  'seller_shipping_charge', 'commission_fee', 'commission_tax', 'processing_fee', 'processing_fee_tax', 'ledger_transaction_id'];
const cell = (v) => v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
const csv = (rows, cols = COLS) => [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n') + '\r\n';
const row = (id, type, at, amount, extra = {}) => ({ ledger_transaction_id: id, transaction_type: type, transaction_completed_at_utc: at,
  transaction_amount: amount, transaction_currency: 'USD', seller_id: 'seller-1', transaction_message: 'Refund for secret_buyer_note', ...extra });

const REPORT_1 = csv([
  // A sale: not kept. Its description has a comma, a quote and a newline, and it names a buyer.
  row('lt-sale', 'ORDER_EARNINGS', '2026-09-20T13:00:00Z', '25.00', { order_id: 'o-1', livestream_id: 'sh-1', buyer_name: 'secret_buyer_9',
    buyer_state: 'IN', listing_title: 'Coat', listing_description: 'Warm, "wool"\nsize M', quantity_sold: 1 }),
  row('lt-r1', 'ORDER_REFUND', '2026-09-20T14:00:00Z', '-12.50', { order_id: 'o-1', livestream_id: 'sh-1' }),
  row('lt-r1s', 'ORDER_REFUND_SHIPPING_COSTS', '2026-09-20T14:00:00Z', '-7.99', { order_id: 'o-1', livestream_id: 'sh-1' }),
  row('lt-tip1', 'TIP', '2026-09-20T18:00:00Z', '5.00', { livestream_id: 'sh-1', buyer_name: 'secret_tipper' }),
  row('lt-ca', 'CARRIER_ADJUSTMENT', '2026-09-25T12:00:00Z', '-4.25', { shipment_id: 'shp-1' }),
  row('lt-car', 'CARRIER_ADJUSTMENT_REFUND', '2026-09-25T12:00:00Z', '1.10', { shipment_id: 'shp-1' }),
  // No show on the row: the store comes from the order's show (sh-2 → BL14). UTC without a zone
  // marker, 03:30 UTC = 11:30 PM Eastern the day before.
  row('lt-r2', 'ORDER_REFUND', '2026-10-02 03:30:00', '-20.00', { order_id: 'o-2' }),
  row('lt-ship', 'SHIPPING_CHARGE', '2026-09-26T12:00:00Z', '-3.00', { shipment_id: 'shp-2' }),
]);
const REPORT_2 = csv([   // overlaps report 1 by a week: lt-r2 again, plus one new row
  row('lt-r2', 'ORDER_REFUND', '2026-10-02 03:30:00', '-20.00', { order_id: 'o-2' }),
  row('lt-ap', 'APPEALED_ORDER_REFUND', '2026-10-20T15:00:00Z', '-3.00', { order_id: 'o-2', livestream_id: 'sh-2' }),
]);
const REPORT_3 = csv([row('lt-tip2', 'TIP', '2026-10-30T22:00:00Z', '2.00', { livestream_id: 'sh-2', buyer_name: 'secret_tipper' })]);

// ── The stub ───────────────────────────────────────────────────────────────
let calls = [], posts = [], fileAuth = [], noScope = false, runs = {}, nextId = 1;
const res = (status, body, headers = {}) => new Response(typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body),
  { status, headers: { 'Content-Type': 'application/json', ...headers } });
// The test decides what each run becomes: runs[id] = { status, url }.
const whatnot = async (u, init = {}) => {
  const s = String(u);
  if (s.startsWith('https://files.example-cdn.test/')) {
    fileAuth.push(init.headers && (init.headers.Authorization || init.headers.authorization) || null);
    const file = new URL(s).pathname;
    return res(200, file.endsWith('/r1.csv') ? REPORT_1 : file.endsWith('/bad.csv') ? csv([{ a: 1 }], ['a']) : '', { 'Content-Type': 'text/csv' });
  }
  if (!s.startsWith('https://api.whatnot.com/')) return blocked(u, init);
  const url = new URL(s), p = url.pathname.replace('/seller-api/rest/v2', ''), auth = init.headers && init.headers.Authorization;
  calls.push((init.method || 'GET') + ' ' + p);
  if (auth !== 'Bearer wn_pat_tk_test') return res(401, { type: 'unauthorized' });
  if (p.startsWith('/files/')) {   // a report file served by Whatnot itself: the token is expected here
    fileAuth.push(auth);
    return res(200, zlib.gzipSync(p.endsWith('r2.csv.gz') ? REPORT_2 : REPORT_3), { 'Content-Type': 'application/gzip' });
  }
  if (p === '/reports' && init.method === 'POST') {
    if (noScope) return res(403, { type: 'insufficient_scope', detail: 'write:reports required' });
    const body = JSON.parse(init.body);
    posts.push(body);
    const id = `00000000-0000-4000-8000-00000000000${nextId++}`;
    runs[id] = { status: 'pending', url: null };
    return res(201, { id, report_type: body.report_parameters.report_type, status: 'pending', report_parameters: body.report_parameters, report_url: null });
  }
  let m;
  if ((m = p.match(/^\/reports\/([^/]+)$/))) {
    const r = runs[m[1]];
    return r ? res(200, { id: m[1], report_type: 'seller_financial_report', status: r.status, report_url: r.url }) : res(404, {});
  }
  if (p === '/shows' || p === '/orders') return res(200, { data: [], next_cursor: null });
  return res(404, {});
};
globalThis.fetch = whatnot;

function freshEnv({ ledger = true } = {}) {
  const { db, env } = makeEnv(repo);
  for (const m of ['015', '031', '033', '084', '085']) db.exec(sql(m));
  applyMigrationAlters(db, repo);
  if (ledger) db.exec(sql('086'));
  env.WHATNOT_API_TOKEN = 'wn_pat_tk_test';
  const sh = db.prepare('INSERT INTO whatnot_shows (id,title,status,scheduled_start_at,started_at,show_date,store,synced_at) VALUES (?,?,?,?,?,?,?,?)');
  sh.run('sh-1', 'Morning apparel', 'ended', '2026-09-20T12:00:00Z', '2026-09-20T12:00:00Z', '2026-09-20', 'BL1', 'x');
  sh.run('sh-2', 'Night bags', 'ended', '2026-09-30T23:00:00Z', '2026-09-30T23:00:00Z', '2026-09-30', 'BL14', 'x');
  // Analytics already final, so the sync's other steps make no calls of their own.
  const an = db.prepare('INSERT INTO whatnot_show_analytics (show_id,calculation_status,sales,fetched_at) VALUES (?,?,?,?)');
  an.run('sh-1', 'GENERATED', 100, '2026-10-01T00:00:00Z');
  an.run('sh-2', 'GENERATED', 100, '2026-10-02T00:00:00Z');
  const or = db.prepare('INSERT INTO whatnot_orders (id,show_id,status,created_at,subtotal,items_synced,synced_at) VALUES (?,?,?,?,?,?,?)');
  or.run('o-1', 'sh-1', 'completed', '2026-09-02T15:00:00Z', 25, 1, 'x');   // the first order: the backfill starts its day
  or.run('o-2', 'sh-2', 'completed', '2026-09-30T23:10:00Z', 20, 1, 'x');
  return { db, env };
}

let NOW = new Date('2026-11-02T15:20:00Z');
const RealDate = Date;
const runAt = async (env) => {
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [NOW.getTime()])); } static now() { return NOW.getTime(); } };
  const waits = [], logs = [], real = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    await worker.scheduled({ cron: '0 * * * *', scheduledTime: NOW.getTime() }, env, { waitUntil: (p) => waits.push(p), passThroughOnException() {} });
    await Promise.allSettled(waits);
  } finally { console.log = real; globalThis.Date = RealDate; }
  const line = logs.find(l => l.startsWith('whatnot-sync:'));
  return line ? JSON.parse(line.slice('whatnot-sync:'.length)) : null;
};
const hours = (h) => { NOW = new RealDate(NOW.getTime() + h * 3600e3); };
const state = (db) => JSON.parse(db.prepare("SELECT value FROM whatnot_sync WHERE key = 'ledger'").get()?.value || 'null');
const ledger = (db) => db.prepare('SELECT * FROM whatnot_ledger ORDER BY id').all();
const read = async (env, qs, user = 'u-su') => {
  const r = await worker.fetch(req('/?action=live-sales&from=2026-09-01&to=2026-10-31' + qs, { user }), env, ctx);
  return { status: r.status, body: await r.json().catch(() => null) };
};

// ── 0. Before migration-086: the rest of the sync runs, no report is asked for ──
{
  const { env } = freshEnv({ ledger: false });
  calls = []; posts = [];
  const out = await runAt(env);
  ok(out && out.complete && !out.error, 'without 086 the sync itself still completes: ' + JSON.stringify(out));
  eq(out.ledger, { status: 'skipped', reason: 'migration-086 not applied' }, 'and says the ledger is waiting on migration-086');
  eq(calls.filter(c => c.includes('/reports')).length, 0, 'no report call');
  const r = await read(env, '');
  eq([r.status, r.body.ledger, r.body.ledgerSync && r.body.ledgerSync.ready], [200, [], false], 'the read answers, with no ledger and ready:false');
}

// ── 1. A token without write:reports ───────────────────────────────────────
{
  const { db, env } = freshEnv();
  noScope = true; calls = [];
  const out = await runAt(env);
  ok(out.complete && !out.error, 'a 403 on the report never fails the rest of the sync');
  eq([out.ledger.status, out.ledger.error], ['error', 'needs write:reports'], 'and says the token needs write:reports');
  const st = state(db);
  eq([st.error, st.cursor ?? null, st.run ?? null], ['needs write:reports', null, null], 'no cursor, no run, the reason kept');
  const r = await read(env, '');
  eq(r.body.ledgerSync.error, 'needs write:reports', 'the read passes the reason to the page');
  hours(1);
  calls = [];
  await runAt(env);
  eq(calls.filter(c => c === 'POST /reports').length, 1, 'a missing scope is asked again the next hour (no backoff: nothing was generated)');
  noScope = false;
  NOW = new Date('2026-11-02T15:20:00Z');
}

// ── 2. The backfill: request → wait → ingest → next window at once ─────────
const { db, env } = freshEnv();
calls = []; posts = []; fileAuth = []; runs = {};
let out = await runAt(env);
eq(out.ledger.status, 'requested', 'run 1 asks for a report');
eq(posts, [{ report_parameters: { report_type: 'seller_financial_report', start_date: '2026-09-02T00:00:00.000Z', end_date: '2026-10-03T00:00:00.000Z' } }],
  'the first window starts the day of the first order and is 31 days long, in the format Whatnot requires');
const id1 = Object.keys(runs)[0];
eq(state(db).run && state(db).run.id, id1, 'the run is remembered');

hours(1); runs[id1].status = 'in_progress'; calls = [];
out = await runAt(env);
eq(out.ledger.status, 'waiting', 'run 2: still being generated → waits');
eq(calls.filter(c => c.includes('/reports')), [`GET /reports/${id1}`], 'and polls it once, asking for no other report');

hours(1); runs[id1] = { status: 'completed', url: 'https://files.example-cdn.test/r1.csv?sig=abc' }; calls = []; posts = [];
out = await runAt(env);
eq([out.ledger.status, out.ledger.rows], ['ingested', 6], 'run 3: completed → 6 rows kept (refunds, carrier adjustments, a tip)');
eq(fileAuth, [null], 'the file host was NOT sent the Whatnot token');
eq(ledger(db).map(r => [r.id, r.type, r.completed_date, r.amount, r.show_id, r.order_id]), [
  ['lt-ca', 'CARRIER_ADJUSTMENT', '2026-09-25', -4.25, null, null],
  ['lt-car', 'CARRIER_ADJUSTMENT_REFUND', '2026-09-25', 1.1, null, null],
  ['lt-r1', 'ORDER_REFUND', '2026-09-20', -12.5, 'sh-1', 'o-1'],
  ['lt-r1s', 'ORDER_REFUND_SHIPPING_COSTS', '2026-09-20', -7.99, 'sh-1', 'o-1'],
  ['lt-r2', 'ORDER_REFUND', '2026-10-01', -20, null, 'o-2'],
  ['lt-tip1', 'TIP', '2026-09-20', 5, 'sh-1', null],
], 'the rows, dated by the Eastern day (lt-r2: 03:30 UTC = the evening before), sales and shipping charges left out');
eq(ledger(db).find(r => r.id === 'lt-r2').completed_at, '2026-10-02T03:30:00.000Z', 'a time with no zone marker is read as UTC');
ok(!JSON.stringify(ledger(db)).includes('secret_'), 'nothing about a buyer is stored (no name, no message)');
eq(posts.map(p => [p.report_parameters.start_date, p.report_parameters.end_date]), [['2026-09-26T00:00:00.000Z', '2026-10-27T00:00:00.000Z']],
  'the next window is requested in the same run, starting a week back');
eq(state(db).cursor, '2026-10-03T00:00:00.000Z', 'the cursor moves to the end of the ingested window');

hours(1); const id2 = Object.keys(runs)[1];
runs[id2] = { status: 'completed', url: 'https://api.whatnot.com/seller-api/rest/v2/files/r2.csv.gz' }; posts = []; fileAuth = [];
out = await runAt(env);
eq([out.ledger.status, out.ledger.rows], ['ingested', 2], 'run 4: a gzipped file from Whatnot itself is read');
eq(fileAuth, ['Bearer wn_pat_tk_test'], 'Whatnot\'s own host does get the token');
eq(ledger(db).length, 7, 'the overlapping row is not duplicated (6 + 1 new)');
eq(posts.map(p => [p.report_parameters.start_date, p.report_parameters.end_date]), [['2026-10-20T00:00:00.000Z', '2026-11-02T18:00:00.000Z']],
  'the last window ends at the top of the current hour');

hours(1); const id3 = Object.keys(runs)[2];
runs[id3] = { status: 'completed', url: 'https://api.whatnot.com/seller-api/rest/v2/files/r3.csv.gz' }; posts = [];
out = await runAt(env);
eq([out.ledger.status, posts.length], ['ingested', 0], 'run 5: caught up — nothing more is requested');
eq(state(db).cursor, '2026-11-02T18:00:00.000Z', 'cursor = the end of the newest window');

hours(1); calls = [];
out = await runAt(env);
eq([out.ledger.status, calls.filter(c => c.includes('/reports')).length], ['fresh', 0], 'an hour later: fresh, no report call');
hours(4); posts = [];
out = await runAt(env);
eq(posts.map(p => [p.report_parameters.start_date, p.report_parameters.end_date]), [['2026-10-26T18:00:00.000Z', '2026-11-03T00:00:00.000Z']],
  'six hours after the cursor: one report re-reading the last 7 days');

// ── 3. The read ────────────────────────────────────────────────────────────
{
  const all = await read(env, '');
  eq(all.status, 200, 'superuser reads');
  eq(all.body.ledger, [
    { date: '2026-09-20', store: 'BL1', type: 'ORDER_REFUND', amount: -12.5, n: 1 },
    { date: '2026-09-20', store: 'BL1', type: 'ORDER_REFUND_SHIPPING_COSTS', amount: -7.99, n: 1 },
    { date: '2026-09-20', store: 'BL1', type: 'TIP', amount: 5, n: 1 },
    { date: '2026-09-25', store: null, type: 'CARRIER_ADJUSTMENT', amount: -4.25, n: 1 },
    { date: '2026-09-25', store: null, type: 'CARRIER_ADJUSTMENT_REFUND', amount: 1.1, n: 1 },
    { date: '2026-10-01', store: 'BL14', type: 'ORDER_REFUND', amount: -20, n: 1 },
    { date: '2026-10-20', store: 'BL14', type: 'APPEALED_ORDER_REFUND', amount: -3, n: 1 },
    { date: '2026-10-30', store: 'BL14', type: 'TIP', amount: 2, n: 1 },
  ], 'rows by Eastern day × store × type; the store from the show, else the order\'s show, else none');
  eq([all.body.ledgerSync.ready, all.body.ledgerSync.through, all.body.ledgerSync.error], [true, '2026-11-02T18:00:00.000Z', null], 'ledgerSync: ready, through the cursor');
  const one = await read(env, '&store=BL1');
  eq(one.body.ledger.map(r => [r.store, r.type]), [['BL1', 'ORDER_REFUND'], ['BL1', 'ORDER_REFUND_SHIPPING_COSTS'], ['BL1', 'TIP']],
    '&store=BL1: that store only, no unattributed rows');
  db.prepare("INSERT INTO user_grants (user_id,business_id,role,units) VALUES ('u-mgr1','live','manager','[\"BL14\"]')").run();
  const mgr = await read(env, '', 'u-mgr1');
  eq(mgr.body.ledger.map(r => r.store), ['BL14', 'BL14', 'BL14'], 'a BL14-only grant sees BL14 rows and none without a store');
  const before = JSON.stringify(ledger(db));
  await read(env, '');
  eq(JSON.stringify(ledger(db)), before, 'the read writes nothing');
}

// ── 4. A failed report, and a file whose columns changed ───────────────────
{
  const { db, env } = freshEnv();
  NOW = new Date('2026-11-02T15:20:00Z'); runs = {}; posts = [];
  await runAt(env);
  const id = Object.keys(runs)[0];
  hours(1); runs[id].status = 'failed'; posts = [];
  out = await runAt(env);
  eq([out.ledger.status, out.ledger.error, posts.length], ['error', 'Whatnot report failed', 0], 'a failed run is dropped and not re-requested in the same run');
  eq([state(db).run ?? null, state(db).cursor ?? null], [null, null], 'no run, cursor unmoved');
  hours(1); posts = [];
  await runAt(env);
  eq(posts.length, 0, 'an hour later: still backing off');
  hours(5); posts = [];
  await runAt(env);
  eq(posts.map(p => p.report_parameters.start_date), ['2026-09-02T00:00:00.000Z'], 'six hours on: the same window is asked for again');
  const id2 = Object.keys(runs)[1];
  hours(1); runs[id2] = { status: 'completed', url: 'https://files.example-cdn.test/bad.csv' };
  out = await runAt(env);
  eq([out.ledger.status, /missing column/.test(out.ledger.error || '')], ['error', true], 'a file without the expected columns is an error: ' + (out.ledger.error || ''));
  eq([state(db).cursor ?? null, ledger(db).length], [null, 0], 'nothing written, cursor unmoved');
}

globalThis.fetch = blocked;
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
