// ?action=bin-split: bins vs Christmas bins per store, day, group and price, stitched from final
// saved days and a live pull (docs/plans/live-item-sales.md, Phase 2).
//
// WHAT THIS PROTECTS. This repo has lost saved history three times to re-pulled Clover data, and
// the split mixes saved and live days, so the source rules carry the most weight:
//   1. Each store-day has exactly ONE source. Today is always live, even once tonight's run has
//      saved a row. A saved row is final only from its day's nightly run on (D+1 03:55 UTC, the
//      cron in wrangler.toml and scheduled(), read here, not restated). Yesterday without a final
//      row is live. An older day is NEVER pulled from Clover: it is saved, a real zero
//      (order_count 0), before the store's record, or missing.
//   2. Nothing is written but the live-items: cache, and every D1 statement is a SELECT.
//   3. The grouping on the plan's real names, the tier parsing, and the KV config with its
//      fallback when the copy is bad.
//   4. Who can call it: the agent key, sessions and their stores, the date rules.
// Everything drives worker.fetch, never a function cut out of the source.
import fs from 'node:fs';
import path from 'node:path';
import { loadWorker, makeEnv, ctx, req, kvNamespace, nestedScans } from './lib/worker-harness.mjs';

const repo = process.argv[2] || '.';
const say = console.log.bind(console);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; say('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const worker = await loadWorker(repo);

// ── The nightly run's time, from the crons themselves ─────────────────────
// scheduled() runs the rollup on exactly one cron string (everything else returns first), and
// wrangler.toml's production [triggers] must carry it. Cloudflare crons are UTC.
const toml = fs.readFileSync(path.join(repo, 'wrangler.toml'), 'utf8');
const prodCrons = JSON.parse(/crons\s*=\s*(\[[^\]]*\])/.exec(toml.slice(toml.indexOf('[triggers]')))[1]);
const rollupCron = /if \(event\.cron !== "([^"]+)"\)/.exec(fs.readFileSync(path.join(repo, 'worker.js'), 'utf8'))?.[1];
const cronParts = /^(\d+) (\d+) \* \* \*$/.exec(rollupCron || '');
ok(!!cronParts && prodCrons.includes(rollupCron), `the nightly rollup cron scheduled() runs (${rollupCron}) is a daily cron in wrangler.toml's production triggers (${JSON.stringify(prodCrons)})`);
const NIGHTLY = cronParts ? `${cronParts[2].padStart(2, '0')}:${cronParts[1].padStart(2, '0')}` : '??:??';
eq(NIGHTLY, '03:55', 'control: that cron is 03:55 UTC (22:55 EST / 23:55 EDT)');

// ── The clock: Tue 2026-11-17, 23:30 EST = 04:30 UTC on the 18th ─────────
// The hardest moment of the day: tonight's run has already saved a row for today, and the UTC
// date is already tomorrow's.
const RealDate = Date;
let NOW = RealDate.parse('2026-11-18T04:30:00Z');
class FixedDate extends RealDate { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } }
globalThis.Date = FixedDate;
const TODAY = '2026-11-17', YDAY = '2026-11-16';
const addDays = (d, n) => { const x = new RealDate(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const span = (a, b) => { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; };
// When day D's row becomes final, and the last instant before.
const finalAt = (d) => `${addDays(d, 1)}T${NIGHTLY}:00.000Z`;
const justBefore = (d) => new RealDate(RealDate.parse(finalAt(d)) - 1).toISOString();
const MIDNIGHT = { [TODAY]: RealDate.parse('2026-11-17T05:00:00Z'), [YDAY]: RealDate.parse('2026-11-16T05:00:00Z') };
const T_TODAY = RealDate.parse('2026-11-17T15:00:00Z'), T_YDAY = RealDate.parse('2026-11-16T15:00:00Z');

// ── Clover, per merchant: today's and yesterday's orders ──────────────────
const MERCHANT = { BL1: 'M1', BL2: 'M2', BL4: 'M4', BL8: 'M8', BL14: 'M14', BL16: 'M16' };
const li = (id, name, price, itemId, code) => ({ id, name, price, item: { id: itemId, ...(code && { code }) } });
const order = (id, lines, t) => {
  const total = lines.reduce((s, l) => s + l.price, 0);
  return { id, state: 'locked', total, createdTime: t, clientCreatedTime: t,
    payments: { elements: [{ id: 'p-' + id, amount: total, taxAmount: 0 }] }, lineItems: { elements: lines } };
};
const DATA = {
  // BL1 today: two $6 bins on one ticket, a $3 XMAS button, and candy (left out).
  M1: [order('A1', [li('a1', '$6 Bin', 600, 'I-B6'), li('a2', '$6 Bin', 600, 'I-B6'), li('a3', '$3 XMAS', 300, 'I-X3'), li('a4', 'Gummies', 350, 'I-C')], T_TODAY),
       order('Y1', [li('y1', '$3 Christmas Bin', 300, 'I-CB3', 'BL-3CBIN'), li('y2', '$12 Bin', 1200, 'I-B12', 'BL-BIN-12')], T_YDAY)],
  // BL2 yesterday has $9 bins in Clover, but its saved row is final: Clover must not be asked.
  M2: [order('B1', [li('b1', '$6 Bin', 600, 'I-B6')], T_TODAY), order('B2', [li('b2', '$9 Bin', 900, 'I-B9'), li('b3', '$9 Bin', 900, 'I-B9')], T_YDAY)],
  M4: [order('C1', [li('c1', '$2 Bin', 200, 'I-B2')], T_TODAY), order('C2', [li('c2', '$4 Bin', 400, 'I-B4')], T_YDAY)],
  M8: [order('H1', [li('h1', '$6 Bin', 600, 'I-B6')], T_TODAY)],
  M14: [order('E1', [li('e1', '$1 Bin', 100, 'I-B1')], T_TODAY), order('E2', [li('e2', '$1 Bin', 100, 'I-B1')], T_YDAY)],
  M16: [order('F1', [li('f1', '$10 Bin', 1000, 'I-B10')], T_TODAY), order('F2', [li('f2', '$10 Bin', 1000, 'I-B10')], T_YDAY)],
};
const CATS = { 'I-B6': 'Bin Products', 'I-B9': 'Bin Products', 'I-B12': 'Bin Products', 'I-B2': 'Bin Products', 'I-B4': 'Bin Products',
  'I-B1': 'Bin Products', 'I-B10': 'Bin Products', 'I-CB3': 'Bin Products', 'I-X3': 'FG BL SEASONAL - CHRISTMAS - GM', 'I-C': 'FG BL CONSUMABLES - FOOD - CANDY' };

let calls = [];          // every outbound request: { url, method, merchant }
const broken = {};       // merchant -> 'throw'
globalThis.fetch = async (u, init) => {
  const s = String(u?.url || u);
  const method = init?.method || (u instanceof Request ? u.method : 'GET');
  const m = s.match(/^https:\/\/api\.clover\.com\/v3\/merchants\/([^/]+)\//);
  calls.push({ url: s, method, merchant: m?.[1] || null });
  const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  if (!m) return J({ elements: [] });
  const url = new URL(s);
  const offset = Number(url.searchParams.get('offset') || 0);
  const filters = url.searchParams.getAll('filter');
  const since = Number((filters.find(f => f.startsWith('createdTime>=')) || '').split('>=')[1] || 0);
  const until = Number((filters.find(f => f.startsWith('createdTime<')) || '').split('<')[1] || Infinity);
  if (url.pathname.endsWith('/orders')) {
    if (broken[m[1]] === 'throw') throw new TypeError('fetch failed');
    return J({ elements: offset ? [] : (DATA[m[1]] || []).filter(o => o.createdTime >= since && o.createdTime < until) });
  }
  if (/\/orders\/[^/]+$/.test(url.pathname)) return J({ message: 'not found' }, 404);
  return J({ elements: [] });   // refunds, credits, items
};
const anyClover = () => calls.filter(c => c.merchant).length;
// The day each orders request asked for, by the window's start ("TODAY", "YDAY", or the raw ms).
const orderDays = (merchant) => calls.filter(c => c.merchant === merchant && /\/orders\?/.test(c.url)).map(c => {
  const since = Number((new URL(c.url).searchParams.getAll('filter').find(f => f.startsWith('createdTime>=')) || '').split('>=')[1]);
  return since === MIDNIGHT[TODAY] ? 'TODAY' : since === MIDNIGHT[YDAY] ? 'YDAY' : String(since);
});

// ── The saved record ───────────────────────────────────────────────────────
const item = (name, code, l2, qty, net, orders, cloverCategory = l2 === 'Bin Products' ? 'Bin Products' : null) => ({
  itemId: 'I-' + name, name, code, cloverCategory, l2, l3: cloverCategory, source: 'clover-category',
  qty, gross: net, lineDiscounts: 0, orderDiscounts: 0, refunds: 0, net, cost: 0, costSource: 'none', orders,
});
const BIN = 'Bin Products', SEASONAL = 'Seasonal', XMAS_CAT = 'FG BL SEASONAL - CHRISTMAS - GM';
// The plan's "Bin grouping on real names", one item per BL4 day from 2026-10-20, with what each
// must become ([group, subgroup, tier], or null: left out).
const NAMES = [
  [item('$3 Christmas Bin', 'BL-3CBIN', BIN, 4, 12, 3), ['christmas', 'bins', '$3']],
  [item('$1 Christmas Bin', 'BL-1CBIN', BIN, 5, 5, 4), ['christmas', 'bins', '$1']],
  [item('$12 Bin', 'BL-BIN-12', BIN, 2, 24, 2), ['regular', 'bins', '$12']],
  [item('$12 bin item', null, BIN, 1, 12, 1), ['regular', 'bins', '$12']],
  [item('$6 Bin', null, BIN, 3, 18, 3), ['regular', 'bins', '$6']],
  [item('Glass Case / Mystery Box', null, BIN, 1, 20, 1), ['regular', 'extras', 'no price']],
  [item('Fill A Bag', null, BIN, 2, 10, 2), ['regular', 'extras', 'no price']],
  [item('Ikea Bag', null, BIN, 1, 15, 1), ['regular', 'extras', 'no price']],
  [item('$3 Halloween bin item', null, BIN, 2, 6, 2), ['regular', 'bins', '$3']],
  [item('$3 XMAS', null, SEASONAL, 3, 9, 3, XMAS_CAT), ['christmas', 'xmas buttons', '$3']],
  [item('$8 XMAS', null, SEASONAL, 1, 8, 1, XMAS_CAT), ['christmas', 'xmas buttons', '$8']],
  [item('$1 XMAS', null, SEASONAL, 6, 6, 5, XMAS_CAT), ['christmas', 'xmas buttons', '$1']],
  // The same Clover category as the XMAS buttons, but not one of them.
  [item('Christmas Tree Ornaments', null, SEASONAL, 1, 4, 1, XMAS_CAT), null],
  [item('$0.50 Bin', null, BIN, 4, 2, 2), ['regular', 'bins', '$0.50']],
  [item('$5 XMAS Mug', null, SEASONAL, 1, 5, 1, XMAS_CAT), null],
  [item('$3 xmas', null, SEASONAL, 1, 3, 1, XMAS_CAT), ['christmas', 'xmas buttons', '$3']],
  [item(' fill a bag ', null, BIN, 1, 5, 1), ['regular', 'extras', 'no price']],
  [item('Holiday Bin', 'BL-12CBIN', BIN, 1, 12, 1), ['christmas', 'bins', 'no price']],
  [item('$2 CHRISTMAS BIN', null, BIN, 2, 4, 2), ['christmas', 'bins', '$2']],
  [item('$1.25 XMAS', null, SEASONAL, 2, 2.5, 2, XMAS_CAT), ['christmas', 'xmas buttons', '$1.25']],
  [item('$10.00 Bin', null, BIN, 1, 10, 1), ['regular', 'bins', '$10']],
  [item('Gummies', null, 'Consumables', 3, 9, 2, 'FG BL CONSUMABLES - FOOD - CANDY'), null],
];
const NAME_DAYS = NAMES.map((_, i) => addDays('2026-10-20', i));   // 10-20 … 11-10
// BL4 2026-11-11: what merges into one row (cents and thousandths rounded as item_day_lines does).
const MERGED = [item('$6 Bin', null, BIN, 3, 17.5, 3), item('$6 bin item', null, BIN, 2, 12, 2),
  item('$0.50 Bin', null, BIN, 1.1, 0.1, 1), item('$0.50 bin item', null, BIN, 2.2, 0.2, 1), item('Gummies', null, 'Consumables', 1, 3, 1)];

function seed(db) {
  db.exec(fs.readFileSync(path.join(repo, 'migration-078.sql'), 'utf8'));
  const put = db.prepare('INSERT OR REPLACE INTO item_day_lines (store, date, snapshot_time, item_count, net, items_json, other_json) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const row = (store, date, at, items) => put.run(store, date, at, items.length, items.reduce((s, i) => s + i.net, 0), JSON.stringify(items), '{}');
  const sales = db.prepare('INSERT OR REPLACE INTO daily_sales (store, date, order_count) VALUES (?, ?, ?)');
  const six = (qty) => [item('$6 Bin', null, BIN, qty, qty * 6, qty)];
  // BL1, record from 11-01.
  row('BL1', '2026-11-01', finalAt('2026-11-01'), six(1));
  row('BL1', '2026-11-12', finalAt('2026-11-12'), six(10));                 // final at the very instant
  row('BL1', '2026-11-13', justBefore('2026-11-13'), six(5));               // 1 ms early: not final
  sales.run('BL1', '2026-11-13', 30);
  sales.run('BL1', '2026-11-14', 0);                                        // no row, no sales: a zero day
  sales.run('BL1', '2026-11-15', 40);                                       // no row, sales: missing
  row('BL1', YDAY, justBefore(YDAY), six(99));                              // yesterday, 1 ms early: live
  row('BL1', TODAY, '2026-11-18T03:56:10.000Z', six(77));                   // tonight's run already wrote today
  // BL2, record from 11-10.
  row('BL2', '2026-11-10', finalAt('2026-11-10'), six(2));
  row('BL2', '2026-11-15', justBefore('2026-11-15'), six(3));
  sales.run('BL2', '2026-11-15', 12);
  row('BL2', YDAY, finalAt(YDAY), [item('$12 Bin', 'BL-BIN-12', BIN, 7, 84, 6)]);   // final: saved, not Clover's $9s
  // BL4: the names, one a day, then the merge day. Record from 10-20.
  NAMES.forEach(([it], i) => row('BL4', NAME_DAYS[i], finalAt(NAME_DAYS[i]), [it]));
  row('BL4', '2026-11-11', '2026-11-12T09:00:00.000Z', MERGED);
  // BL14: a months-late re-snapshot of 11-01 (written 11-15, so it does not start the record),
  // then the record from 11-12; yesterday has only a daytime repair.
  row('BL14', '2026-11-01', '2026-11-15T14:00:00.000Z', six(4));
  row('BL14', '2026-11-12', '2026-11-13T05:10:00.000Z', six(6));
  sales.run('BL14', '2026-11-05', 25);                                      // sold, but before the record
  sales.run('BL14', '2026-11-13', null);                                    // order_count unknown: not a zero day
  row('BL14', YDAY, '2026-11-16T20:00:00.000Z', six(8));                    // a daytime repair: live
  // BL8 is closed (2026-07-25); BL16 has no record at all.
}

const KEY = 'test-briefing-key';
async function setup() {
  const { db, env } = makeEnv(repo);
  env.SALES_SNAPSHOTS = kvNamespace();
  env.MORNING_BRIEFING_KEY = KEY;
  for (const [s, m] of Object.entries(MERCHANT)) { env[`${s}_MERCHANT_ID`] = m; env[`${s}_API_TOKEN`] = `token-${s}`; }
  for (const s of Object.keys(MERCHANT)) await env.SALES_SNAPSHOTS.put(`item-cats:${s.toLowerCase()}`, JSON.stringify(CATS));
  seed(db);
  // Sessions a week out, so getAuthUser's expiry roll (a D1 UPDATE) stays quiet.
  db.prepare('UPDATE sessions SET expires_at = ?').run(new RealDate(NOW + 7 * 864e5 - 3600e3).toISOString());
  const log = { kv: [], d1: [] };
  for (const name of ['SALES_SNAPSHOTS', 'MEDIA']) for (const m of ['put', 'delete']) {
    const real = env[name][m].bind(env[name]);
    env[name][m] = (k, v, o) => { log.kv.push({ op: `${name}.${m}`, key: String(k), opts: o }); return real(k, v, o); };
  }
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => { log.d1.push(sql); return prepare(sql); };
  const reset = () => { log.kv.length = 0; log.d1.length = 0; calls = []; };
  return { db, env, log, reset };
}
const parse = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
// A request that throws out of worker.fetch (a 500 in production) is a status here, so one
// broken case fails its own assertions instead of ending the suite.
const call = async (env, q, user = 'u-su') => {
  try { const r = await worker.fetch(req('/?action=bin-split' + q, { user }), env, ctx); return { status: r.status, body: await parse(r) }; }
  catch (e) { return { status: `threw: ${e.message}`, body: null }; }
};
const keyed = async (env, q, { key = KEY, method = 'GET' } = {}) => {
  const r = await worker.fetch(new Request('https://api.retjghub.com/?action=bin-split' + q, { method, headers: { 'X-API-Key': key } }), env, ctx);
  return { status: r.status, body: await parse(r) };
};
const nonSelect = (log) => log.d1.filter(sql => !/^\s*(SELECT|WITH)\b/i.test(sql));
// Where a store-day went: every list it appears in, and the sources of its rows.
const placeOf = (b, s, d) => {
  const f = b?.freshness || {}, at = (arr) => (arr || []).some(x => x.store === s && x.date === d);
  const p = [];
  if ((f.closedStores || []).some(x => x.store === s && d >= x.closedFrom)) p.push('closed');
  if (at(f.liveDays)) p.push('live');
  if (at(f.missingDays)) p.push('missing');
  if (at(f.beforeRecord)) p.push('beforeRecord');
  const inc = (f.incompleteDays || []).find(x => x.store === s && x.date === d);
  if (inc) p.push('incomplete:' + inc.status);
  for (const src of new Set((b?.rows || []).filter(r => r.store === s && r.date === d).map(r => r.source))) p.push('rows:' + src);
  return p.join(',') || 'none';
};
const rowsAt = (b, s, d) => (b?.rows || []).filter(r => r.store === s && r.date === d).map(({ store, date, ...r }) => r);
const WEEK = span('2026-11-12', TODAY);

// ── 1. Each store-day from exactly one source ─────────────────────────────
{
  const { db, env, log, reset } = await setup();
  reset();
  const r = await call(env, `&from=2026-11-12&to=${TODAY}`);
  eq([r.status, r.body?.ok, r.body?.from, r.body?.to, r.body?.stores], [200, true, '2026-11-12', TODAY, ['BL1', 'BL2', 'BL4', 'BL8', 'BL14', 'BL16']],
    'a superuser gets every store for the range; today is 11-17 in ET although UTC is on the 18th');
  eq(WEEK.map(d => placeOf(r.body, 'BL1', d)), ['rows:saved', 'missing', 'none', 'missing', 'live,rows:live', 'live,rows:live'],
    'BL1: final at 03:55:00.000 → saved; 1 ms before on an old day → missing; order_count 0 → a zero day; sold with no row → missing; yesterday 1 ms early → live; today → live');
  eq(WEEK.map(d => placeOf(r.body, 'BL2', d)), ['missing', 'missing', 'missing', 'missing', 'rows:saved', 'live,rows:live'],
    'BL2: no rows → missing; an old row 1 ms short of final → missing; yesterday final at 03:55:00.000 → saved; today live');
  eq(WEEK.map(d => placeOf(r.body, 'BL4', d)), ['missing', 'missing', 'missing', 'missing', 'live,rows:live', 'live,rows:live'],
    'BL4: after its record, no rows → missing; yesterday with no row at all → live');
  eq(WEEK.map(d => placeOf(r.body, 'BL14', d)), ['rows:saved', 'missing', 'missing', 'missing', 'live,rows:live', 'live,rows:live'],
    'BL14: an order_count of null is unknown, not 0 → missing; yesterday\'s daytime repair (20:00 UTC) is not final → live');
  eq(WEEK.map(d => placeOf(r.body, 'BL16', d)), ['beforeRecord', 'beforeRecord', 'beforeRecord', 'beforeRecord', 'live,rows:live', 'live,rows:live'],
    'BL16 (no record at all): old days are before its record, not missing; yesterday with no row → live');
  eq(WEEK.map(d => placeOf(r.body, 'BL8', d)), WEEK.map(() => 'closed'), 'BL8 (closed 2026-07-25): every day closed, nothing else');
  eq(r.body?.freshness?.closedStores, [{ store: 'BL8', closedFrom: '2026-07-25' }], 'closedStores names it and when');
  eq([r.status, orderDays('M8'), orderDays('M1').length > 0], [200, [], true], 'and Clover is never asked for BL8 (while it is for BL1)');
  // Today: Clover's, not the row tonight's run saved ($6 × 77).
  eq(rowsAt(r.body, 'BL1', TODAY), [
    { source: 'live', group: 'regular', subgroup: 'bins', tier: '$6', units: 2, net: 12, items: 1, tickets: 1 },
    { source: 'live', group: 'christmas', subgroup: 'xmas buttons', tier: '$3', units: 1, net: 3, items: 1, tickets: 1 },
  ], 'BL1 today = the live pull (two $6 bins on one ticket, the $3 XMAS button; candy left out), never the saved $6 × 77');
  eq(rowsAt(r.body, 'BL1', YDAY), [
    { source: 'live', group: 'christmas', subgroup: 'bins', tier: '$3', units: 1, net: 3, items: 1, tickets: 1 },
    { source: 'live', group: 'regular', subgroup: 'bins', tier: '$12', units: 1, net: 12, items: 1, tickets: 1 },
  ], 'BL1 yesterday = the live pull, never its not-final row ($6 × 99)');
  eq(rowsAt(r.body, 'BL2', YDAY), [{ source: 'saved', group: 'regular', subgroup: 'bins', tier: '$12', units: 7, net: 84, items: 1, tickets: 6 }],
    'BL2 yesterday = its final row only: no $9 row from Clover beside it');
  eq(rowsAt(r.body, 'BL1', '2026-11-12'), [{ source: 'saved', group: 'regular', subgroup: 'bins', tier: '$6', units: 10, net: 60, items: 1, tickets: 10 }], 'BL1 11-12 = its saved row');
  eq(Object.fromEntries(['M1', 'M2', 'M4', 'M8', 'M14', 'M16'].map(m => [m, orderDays(m).sort()])),
    { M1: ['TODAY', 'YDAY'], M2: ['TODAY'], M4: ['TODAY', 'YDAY'], M8: [], M14: ['TODAY', 'YDAY'], M16: ['TODAY', 'YDAY'] },
    'Clover is asked for today and for yesterday only where yesterday has no final row; never for BL2\'s saved yesterday, never for an older day');
  const f = r.body?.freshness || {};
  eq(f.savedThrough, { BL1: '2026-11-14', BL2: YDAY, BL4: null, BL8: null, BL14: '2026-11-12', BL16: null },
    'savedThrough: each store\'s last saved day (a zero day counts), null when none');
  eq(f.liveDays, [['BL1', YDAY], ['BL1', TODAY], ['BL2', TODAY], ['BL4', YDAY], ['BL4', TODAY], ['BL14', YDAY], ['BL14', TODAY], ['BL16', YDAY], ['BL16', TODAY]]
    .map(([store, date]) => ({ store, date })), 'liveDays lists each live store-day');
  eq(f.liveAsOf, { BL1: new RealDate(NOW).toISOString(), BL2: new RealDate(NOW).toISOString(), BL4: new RealDate(NOW).toISOString(),
    BL14: new RealDate(NOW).toISOString(), BL16: new RealDate(NOW).toISOString() }, 'liveAsOf: when each store was pulled');
  eq([f.incompleteDays, r.body?.config?.source], [[], 'default'], 'nothing incomplete; the built-in config');
  const sameDayTwice = new Map();
  for (const x of r.body?.rows || []) { const k = `${x.store}|${x.date}`; sameDayTwice.set(k, (sameDayTwice.get(k) || new Set()).add(x.source)); }
  ok(r.status === 200 && [...sameDayTwice.values()].every(s => s.size === 1), 'no store-day has rows from two sources');
  ok(r.status === 200 && (r.body.rows || []).every(x => x.date >= YDAY || x.source === 'saved'), 'every row before yesterday is saved');
  // The writes.
  const live = f.liveDays || [];
  eq([r.status, log.kv.map(w => `${w.op} ${w.key} ttl=${w.opts?.expirationTtl}`).sort()],
    [200, live.map(x => `SALES_SNAPSHOTS.put live-items:${x.store.toLowerCase()}:${x.date} ttl=300`).sort()],
    'the ONLY storage writes are the live-items: puts of the live store-days (no items:, item-hours:, R2 or config write)');
  ok(r.status === 200 && log.d1.length > 0 && nonSelect(log).length === 0, `every D1 statement is a SELECT: ${JSON.stringify(nonSelect(log).map(q => q.trim().slice(0, 60)))}`);
  eq([r.status, log.d1.some(q => /item_day_lines d LEFT JOIN json_each/.test(q)), nestedScans(db, log.d1)], [200, true, []],
    'and none scans a whole table inside a loop (see the harness: item-sales timed out on D1)');
  ok(r.status === 200 && calls.length > 0 && calls.every(c => c.method === 'GET'), 'every outbound call is a GET');
  // Again: served from the cache, still no write but nothing new.
  reset();
  const again = await call(env, `&from=2026-11-12&to=${TODAY}`);
  eq([again.status, anyClover(), log.kv.length, JSON.stringify(again.body?.rows) === JSON.stringify(r.body?.rows)], [200, 0, 0, true],
    'a second call inside 5 minutes: the live-items: cache, no Clover call, no write, the same rows');
}

// ── 2. An old range never reaches Clover ──────────────────────────────────
{
  const { env, log, reset } = await setup();
  reset();
  const r = await call(env, '&from=2026-11-10&to=2026-11-15');
  eq([r.status, anyClover(), log.kv.length, r.body?.freshness?.liveDays], [200, 0, 0, []], 'a range ending before yesterday: no Clover call, no write, no live day');
  eq(r.body?.freshness?.missingDays?.filter(x => x.store === 'BL1'), ['2026-11-10', '2026-11-11', '2026-11-13', '2026-11-15'].map(date => ({ store: 'BL1', date })),
    'its missing days (BL1: after its record began 11-01, no final row, not a zero day) are reported, not pulled');
  const fresh = await call(env, '&from=2026-11-15&to=2026-11-15&fresh=1');
  eq([fresh.status, anyClover()], [200, 0], 'not even with fresh=1');
}

// ── 3. Before the record, and a late re-snapshot ──────────────────────────
{
  const { env } = await setup();
  const r = await call(env, '&store=BL14&from=2026-10-30&to=2026-11-13');
  const days = span('2026-10-30', '2026-11-13');
  eq(days.map(d => placeOf(r.body, 'BL14', d)), days.map(d => (d === '2026-11-01' || d === '2026-11-12' ? 'rows:saved' : d === '2026-11-13' ? 'missing' : 'beforeRecord')),
    'BL14: its record begins 11-12, so earlier days (11-05 sold) are beforeRecord; the months-late re-snapshot of 11-01 is final, so saved, and does not pull the start back');
  eq(r.body?.freshness?.savedThrough, { BL14: '2026-11-12' }, 'one store asked: savedThrough has only it');
}

// ── 4. The real names, the tier, and the merge ────────────────────────────
{
  const { env } = await setup();
  const r = await call(env, '&store=BL4&from=2026-10-20&to=2026-11-11');
  ok(r.status === 200 && r.body.rows.every(x => x.store === 'BL4' && x.source === 'saved'), 'BL4 10-20 … 11-11: every row is BL4\'s, saved');
  NAMES.forEach(([it, want], i) => {
    const got = rowsAt(r.body, 'BL4', NAME_DAYS[i]);
    if (want === null) eq([r.status, got, placeOf(r.body, 'BL4', NAME_DAYS[i])], [200, [], 'none'],
      `"${it.name}" (${it.l2}${it.cloverCategory ? ', ' + it.cloverCategory : ''}) is left out: a saved day with no row`);
    else eq(got.map(x => [x.group, x.subgroup, x.tier, x.units, x.net, x.items, x.tickets]), [[...want, it.qty, it.net, 1, it.orders]],
      `"${it.name}"${it.code ? ' / ' + it.code : ''} (${it.l2}) → ${want.join(' / ')}`);
  });
  eq(rowsAt(r.body, 'BL4', '2026-11-11'), [
    { source: 'saved', group: 'regular', subgroup: 'bins', tier: '$6', units: 5, net: 29.5, items: 2, tickets: 5 },
    { source: 'saved', group: 'regular', subgroup: 'bins', tier: '$0.50', units: 3.3, net: 0.3, items: 2, tickets: 2 },
  ], 'one store-day: items of a tier merge (items = records merged, tickets = Σ orders), units to the thousandth and net to the cent (1.1 + 2.2, 0.1 + 0.2)');
}

// ── 5. The config: a valid KV copy is used, a bad one is not ──────────────
{
  const { env } = await setup();
  const q = `&store=BL1&from=${TODAY}&to=${TODAY}`;
  const base = await call(env, q);
  eq([base.status, base.body?.config?.source, base.body?.config?.rules],
    [200, 'default', { christmas: { codePattern: '^BL-\\d+CBIN$', nameContains: ['christmas bin'] }, extras: { names: ['Glass Case / Mystery Box', 'Fill A Bag', 'Ikea Bag'] },
      addToChristmas: { namePattern: '^\\$\\d+(\\.\\d{1,2})? XMAS$' } }], 'no KV copy: the built-in default, and it says so');
  const mine = { christmas: { codePattern: '^XX-\\d+$', nameContains: ['holiday'] }, extras: { names: ['$6 bin'] }, addToChristmas: { namePattern: 'ORNAMENT' } };
  await env.SALES_SNAPSHOTS.put('config:bin-groups', JSON.stringify(mine));
  const kv = await call(env, q);
  eq([kv.status, kv.body?.config, rowsAt(kv.body, 'BL1', TODAY).map(x => [x.group, x.subgroup, x.tier])],
    [200, { source: 'kv', rules: mine }, [['regular', 'extras', '$6']]], 'a valid KV copy is applied: $6 Bin is now an extra, and the $3 XMAS button is left out');
  const bad = [
    ['{ not json', 'not JSON'],
    ['[]', 'not an object'],
    [JSON.stringify({ ...mine, christmas: { codePattern: 5, nameContains: [] } }), 'christmas needs codePattern and nameContains'],
    [JSON.stringify({ ...mine, christmas: { codePattern: 'x', nameContains: [''] } }), 'christmas needs codePattern and nameContains'],
    [JSON.stringify({ ...mine, extras: { names: 'Fill A Bag' } }), 'extras needs names'],
    [JSON.stringify({ ...mine, addToChristmas: { namePattern: '' } }), 'addToChristmas needs namePattern'],
    [JSON.stringify({ christmas: mine.christmas, extras: mine.extras }), 'addToChristmas needs namePattern'],
  ];
  for (const [raw, why] of bad) {
    await env.SALES_SNAPSHOTS.put('config:bin-groups', raw);
    const r = await call(env, q);
    eq([r.status, r.body?.config?.source, JSON.stringify(r.body?.config?.rules) === JSON.stringify(base.body?.config?.rules), JSON.stringify(r.body?.rows) === JSON.stringify(base.body?.rows)],
      [200, `default (kv invalid: ${why})`, true, true], `KV ${raw.slice(0, 40)} → the default, with the reason`);
  }
  await env.SALES_SNAPSHOTS.put('config:bin-groups', JSON.stringify({ ...mine, addToChristmas: { namePattern: '^\\$(\\d+ XMAS$' } }));
  const nc = await call(env, q);
  ok(nc.status === 200 && /^default \(kv invalid: addToChristmas\.namePattern does not compile: /.test(nc.body?.config?.source || '')
    && JSON.stringify(nc.body?.rows) === JSON.stringify(base.body?.rows), `a pattern that will not compile → the default, with the reason (${nc.body?.config?.source})`);
  // The KV read itself failing.
  const get = env.SALES_SNAPSHOTS.get;
  env.SALES_SNAPSHOTS.get = (k, o) => (k === 'config:bin-groups' ? Promise.reject(new Error('KV GET failed: 500')) : get(k, o));
  const down = await call(env, q);
  eq([down.status, down.body?.config?.source, JSON.stringify(down.body?.rows) === JSON.stringify(base.body?.rows)], [200, 'default (kv read failed: KV GET failed: 500)', true],
    'the config read failing → the default, never a failed request');
  env.SALES_SNAPSHOTS.get = get;
}

// ── 6. A live pull that fails is incomplete, never an empty day ───────────
{
  const { env, log, reset } = await setup();
  broken.M14 = 'throw';
  delete env.BL16_MERCHANT_ID; delete env.BL16_API_TOKEN;
  reset();
  let r;
  try { r = await call(env, `&from=${YDAY}&to=${TODAY}`); } finally { delete broken.M14; }
  eq(r.body?.freshness?.incompleteDays, [{ store: 'BL14', date: YDAY, status: 'incomplete' }, { store: 'BL14', date: TODAY, status: 'incomplete' },
    { store: 'BL16', date: YDAY, status: 'no_credentials' }, { store: 'BL16', date: TODAY, status: 'no_credentials' }],
    'a fetch that throws → incomplete; no Clover keys → no_credentials; each store-day listed');
  eq([...['BL14', 'BL16'].flatMap(s => [YDAY, TODAY].map(d => placeOf(r.body, s, d)))], ['incomplete:incomplete', 'incomplete:incomplete', 'incomplete:no_credentials', 'incomplete:no_credentials'],
    'with no rows, no liveDays entry and no liveAsOf');
  ok(r?.status === 200 && 'BL1' in r.body.freshness.liveAsOf && !('BL14' in r.body.freshness.liveAsOf) && !('BL16' in r.body.freshness.liveAsOf),
    'and no liveAsOf for them (BL1, which answered, has one)');
  eq([r?.status, log.kv.length > 0, log.kv.map(w => w.key).filter(k => /bl14|bl16/.test(k))], [200, true, []], 'and nothing cached for them, while the others are');
}

// ── 7. Who may call it, and the dates ─────────────────────────────────────
{
  const { env, log, reset } = await setup();
  const q = `&from=2026-11-12&to=${TODAY}`;
  reset();
  const k = await keyed(env, q + '&fresh=1');
  eq([k.status, k.body?.stores], [200, ['BL1', 'BL2', 'BL4', 'BL8', 'BL14', 'BL16']], 'the reporting key reads bin-split, with fresh, chain-wide');
  eq([k.status, nonSelect(log).length, log.kv.length > 0 && log.kv.every(w => w.op === 'SALES_SNAPSHOTS.put' && w.key.startsWith('live-items:'))], [200, 0, true],
    'through the key too, only live-items: puts and SELECTs');
  const su = await call(env, q);
  ok(k.status === 200 && JSON.stringify(su.body) === JSON.stringify(k.body), 'the key\'s answer equals a superuser session\'s');
  const wrong = await keyed(env, q, { key: 'not-the-key' });
  const empty = await keyed(env, q, { key: '' });
  const none = await worker.fetch(new Request('https://api.retjghub.com/?action=bin-split' + q), env, ctx);
  eq([k.status, wrong.status, wrong.body?.error, wrong.body?.code, empty.status, empty.body?.code, none.status, (await parse(none))?.code],
    [200, 401, 'Unauthorized', undefined, 401, undefined, 401, 'NO_SESSION'],
    'a wrong or empty key → 401 at the KEY gate (no session code); no key and no session → 401 NO_SESSION');
  eq((await keyed(env, q, { method: 'POST' })).status, 405, 'POST with the key → 405, GET only');
  const tomorrow = await keyed(env, '&from=2026-11-17&to=2026-11-18');
  const tomorrowSu = await call(env, '&from=2026-11-18&to=2026-11-18');
  eq([tomorrow.status, tomorrow.body?.error, tomorrowSu.status], [400, 'to is after today (ET)', 400], 'to after today (ET) → 400, though the UTC date is already the 18th');
  const wide = await call(env, '&from=2026-10-17&to=2026-11-17');
  const oneStore = await call(env, '&store=BL4&from=2026-08-18&to=2026-11-17');
  eq([wide.status, oneStore.status, (await call(env, '&store=BL4&from=2026-08-17&to=2026-11-17')).status, (await call(env, '&to=2026-11-17')).status],
    [400, 200, 400, 400], 'itemRangeScope\'s caps: 31 days for every store, 92 for one; from and to required');
  const mgr = await call(env, q, 'u-mgr1');
  eq([mgr.status, mgr.body?.stores, [...new Set((mgr.body?.rows || []).map(x => x.store))]], [200, ['BL1'], ['BL1']], 'a BL1 manager gets BL1 only');
  const bl2 = await call(env, q + '&store=BL2', 'u-mgr1'), staff = await call(env, q, 'u-staff');
  eq([mgr.status, bl2.status, bl2.body?.error, bl2.body?.code, staff.status, staff.body?.code], [200, 403, 'Forbidden', undefined, 403, 'NO_FINANCIAL_ACCESS'],
    'and is refused BL2 by its store scope; staff are refused (no financial access)');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
