// ?action=backfill-item-hours — banking the hours that predate the nightly bank.
//
// Hours exist only in Clover's raw orders, and Clover keeps ~90 days and decays.
// Banking runs nightly from now on; everything before that is a window closing a
// day at a time. This endpoint walks it.
//
// 🛑 IT MUST NOT BE resnapshot-clienttime. That endpoint re-writes daily_sales and
// the items: snapshot, and pointing it at ~90 healthy days is exactly the re-pull
// this repo has lost data to — Clover returns LESS as it ages, so refunds that have
// aged out would vanish from days that were correct. This writes item-hours: and
// nothing else.
//
// 🔑 AND IT MUST RECONCILE FIRST. The same decay makes a naive backfill wrong in a
// quieter way: an old day can come back short, and banking it leaves the hourly view
// disagreeing with the daily view everyone else reads — silently, because both look
// fine alone. So a day whose hour buckets do not sum to its existing day snapshot is
// SKIPPED, not banked. That is the property this file exists to pin.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const head = (t) => console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 54 - t.length)));

const worker = await loadWorker(repo);
const { env } = makeEnv(repo);
console.log('backfill-item-hours');

// ── fixtures ────────────────────────────────────────────────────────────────
const L3 = 'FG BL HOME - BATH';
const daySnap = (net, qty, stamp) => ({
  categories: [{ category: 'Home', qty, netSales: net, l3Rows: [{ l3: L3, qty, netSales: net }] }],
  totals: { netSales: net, qty }, orderCount: qty, snapshotTime: stamp,
});
const order = (id, iso, cents) => ({
  id, state: 'locked', total: cents,
  createdTime: Date.parse(iso), clientCreatedTime: Date.parse(iso),
  payments: { elements: [{ taxAmount: 0 }] },
  lineItems: { elements: [{ id: id + '-li', name: 'Bath Mat', price: cents, item: { id: 'itm-1' } }] },
});

env.BL4_MERCHANT_ID = 'm4'; env.BL4_API_TOKEN = 't4';
await env.SALES_SNAPSHOTS.put('item-cats:bl4', JSON.stringify({ 'itm-1': L3 }));

const D = '2026-08-10';                              // EDT, plain Monday
const STAMP = '2026-08-11T03:55:00.000Z';
// The day snapshot says $350. Clover will be made to return exactly that, then less.
await env.SALES_SNAPSHOTS.put(`items:bl4:${D}`, JSON.stringify(daySnap(350, 3, STAMP)));

let cloverOrders = [
  order('o-a', '2026-08-10T13:30:00Z', 10000),      // 09:30 ET
  order('o-b', '2026-08-10T17:05:00Z', 25000),      // 13:05 ET
];
let calls = 0;
globalThis.fetch = async (u) => {
  const url = String(u); calls++;
  const J = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (url.includes('/orders')) return J({ elements: cloverOrders });
  return J({ elements: [] });
};

// The harness deliberately does NOT hold the real admin secret (so a request cannot
// accidentally take the isAdminSecret bypass and skip the checks under test), so
// this drives the endpoint through a real session instead.
const runAs = async (qs, user = 'u-su') => {
  const res = await worker.fetch(req('/?action=backfill-item-hours&' + qs, { method: 'POST', user }), env, ctx);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

head('1. A day that reconciles is banked');
{
  const { status, body } = await runAs(`store=BL4&start=${D}&end=${D}`);
  ok(status === 200, `200 (got ${status} ${JSON.stringify(body).slice(0, 140)})`);
  ok(body.summary && body.summary.banked === 1, `one store-day banked (${JSON.stringify(body.summary)})`);
  const bank = await env.SALES_SNAPSHOTS.get(`item-hours:bl4:${D}`, 'json');
  ok(!!bank && !!bank.slots, 'the item-hours key exists');
  ok(Object.keys(bank.slots || {}).sort().join(',') === `${D}T09,${D}T13`,
    `slots are the two trading hours (${Object.keys(bank.slots || {}).join(',')})`);
  ok(bank.daySnapshotTime === STAMP,
    'it is stamped with the snapshot it reconciled against, so the reader trusts it');
  ok(bank.backfilled === true, 'and marked backfilled, so its provenance is visible');
}

head('2. The day snapshot is NEVER touched');
{
  const day = await env.SALES_SNAPSHOTS.get(`items:bl4:${D}`, 'json');
  ok(day.snapshotTime === STAMP, 'items: still carries its original snapshotTime');
  ok((day.totals || {}).netSales === 350, 'and its original total — this is not a re-pull');
}

head('3. Re-running skips what is already banked, and costs no Clover call');
{
  const before = calls;
  const { body } = await runAs(`store=BL4&start=${D}&end=${D}`);
  ok(body.summary.banked === 0 && body.summary.skipped === 1, `skipped, not re-banked (${JSON.stringify(body.summary)})`);
  ok(body.skipped[0].why === 'already banked', `and says why (${body.skipped[0].why})`);
  ok(calls === before, `zero outbound calls for an already-banked day (${calls - before})`);
}

head('4. 🔑 A day Clover can no longer reproduce is REFUSED, not banked');
{
  const D2 = '2026-08-11';
  await env.SALES_SNAPSHOTS.put(`items:bl4:${D2}`, JSON.stringify(daySnap(350, 3, STAMP)));
  // Clover has decayed: one of the two orders has aged out.
  cloverOrders = [order('o-a', '2026-08-11T13:30:00Z', 10000)];
  const { body } = await runAs(`store=BL4&start=${D2}&end=${D2}`);
  ok(body.summary.banked === 0, `nothing banked (${JSON.stringify(body.summary)})`);
  const sk = body.skipped[0];
  ok(sk && sk.why === 'does not reconcile', `skipped for the right reason (${sk && sk.why})`);
  ok(sk.expect === 350 && sk.got === 100, `and reports both sides (expect ${sk.expect}, got ${sk.got})`);
  ok(sk.delta === -250, `with the shortfall named (${sk.delta})`);
  const bank = await env.SALES_SNAPSHOTS.get(`item-hours:bl4:${D2}`, 'json');
  ok(bank === null, 'NO key was written for the day that did not reconcile');
}

head('5. A day with no snapshot to reconcile against is skipped');
{
  const D3 = '2026-08-12';
  cloverOrders = [order('o-c', '2026-08-12T15:00:00Z', 5000)];
  const { body } = await runAs(`store=BL4&start=${D3}&end=${D3}`);
  ok(body.summary.banked === 0, 'nothing banked');
  ok(body.skipped[0].why === 'no day snapshot', `and says why (${body.skipped[0].why})`);
  ok(await env.SALES_SNAPSHOTS.get(`item-hours:bl4:${D3}`, 'json') === null, 'no key written');
}

head('6. dry=1 reports without writing');
{
  const D4 = '2026-08-13';
  await env.SALES_SNAPSHOTS.put(`items:bl4:${D4}`, JSON.stringify(daySnap(50, 1, STAMP)));
  cloverOrders = [order('o-d', '2026-08-13T15:00:00Z', 5000)];
  const { body } = await runAs(`store=BL4&start=${D4}&end=${D4}&dry=1`);
  ok(body.dry === true, 'the response says it was a dry run');
  ok(body.summary.banked === 1, 'it reports what it WOULD bank');
  ok(await env.SALES_SNAPSHOTS.get(`item-hours:bl4:${D4}`, 'json') === null,
    '🔑 but wrote nothing — a preview that writes is not a preview');
}

head('7. Guards');
{
  const big = await runAs('store=all&start=2026-01-01&end=2026-12-31');
  ok(big.status === 413 && big.body.code === 'BUDGET_EXCEEDED',
    `a window past the per-invocation ceiling is refused (${big.status} ${big.body.code})`);
  ok(big.body.limit === 120 && big.body.storeDays > 120, `with the arithmetic (${big.body.storeDays} vs ${big.body.limit})`);
  ok((await runAs('store=BL4&start=nope&end=nope')).status === 400, 'a malformed date is 400');
  ok((await runAs(`store=BL4&start=${D}&end=2026-08-01`)).status === 400, 'end before start is 400');
  ok((await runAs(`store=NOPE&start=${D}&end=${D}`)).status === 400, 'an unknown store is 400');
  const anon = await worker.fetch(req(`/?action=backfill-item-hours&store=BL4&start=${D}&end=${D}`, { method: 'POST' }), env, ctx);
  ok(anon.status === 401 || anon.status === 403, `it is admin-gated (${anon.status})`);
  const mgr = await runAs(`store=BL4&start=${D}&end=${D}`, 'u-mgr1');
  ok(mgr.status === 403, `a store manager cannot run it (${mgr.status})`);
}

head('8. It writes the hour key and nothing else');
{
  const keys = [...env.SALES_SNAPSHOTS._map.keys()];
  const hours = keys.filter(k => k.startsWith('item-hours:'));
  ok(hours.length >= 1, `item-hours keys written (${hours.length})`);
  ok(!keys.some(k => k.startsWith('sales:')), 'no sales: key was created — daily_sales is untouched');
  const src = (await import('node:fs')).readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const h = src.slice(src.indexOf('action") === "backfill-item-hours"'),
                    src.indexOf('Channel split (Retail vs BIN)'));
  ok(!/saveItemSalesSnapshot|fetchAggregateAndSnapshot|snapshotDayByClientTime/.test(h),
    '🔑 the handler never calls a day-snapshot writer — it cannot re-pull a healthy date');
  ok(!/DB\.prepare/.test(h), 'and never touches D1');
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
