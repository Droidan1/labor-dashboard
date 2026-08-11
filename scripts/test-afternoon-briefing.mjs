// ?action=afternoon-briefing — §4.7 of the Chief of Staff work order.
//
// The only endpoint in the reporting family that cannot be answered from D1:
// today's rows are not written until the 03:55 cron, so it goes live to Clover.
// That makes the failure modes the interesting part, and they are three
// genuinely different things that all used to look like "0":
//
//   Clover answered, no orders yet   → 0, reported     (the store opens at 10)
//   Clover call FAILED               → null, no_data   (an expired token)
//   no credentials configured        → null, no_data
//
// Getting those confused is the same defect §4.1 exists to fix, one endpoint
// further on. Only the platform is stubbed — Clover's HTTP responses, per
// merchant, so each store can fail differently in the same request.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const KEY = 'test-briefing-key';
const todayET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
env.MORNING_BRIEFING_KEY = KEY;

// Merchant ids per store, so the stub can tell whose request it is answering.
// ⚠️ These names must match what fetchCloverOrders reads (`${STORE}_MERCHANT_ID`
// / `_API_TOKEN`). A wrong name fails the fetch identically to a broken stub and
// the suite would still "pass" on the no_data branch — the trap that made an
// earlier differential test vacuous.
const MERCH = { BL1: 'M-BL1', BL2: 'M-BL2', BL4: 'M-BL4', BL8: 'M-BL8', BL14: 'M-BL14', BL16: 'M-BL16' };
for (const [s, m] of Object.entries(MERCH)) {
  env[`${s}_MERCHANT_ID`] = m;
  env[`${s}_API_TOKEN`] = 'tok-' + s;
}
// BL16 gets NO credentials — fetchCloverOrders returns null for it.
delete env.BL16_MERCHANT_ID;
delete env.BL16_API_TOKEN;

const order = (cents, taxCents = 0) => ({
  id: 'o' + cents, state: 'locked', total: cents, createdTime: Date.now(),
  payments: { elements: [{ amount: cents, taxAmount: taxCents }] },
  lineItems: { elements: [{ id: 'li', name: 'Widget', price: cents, unitQty: 1000 }] },
});

// Per-merchant Clover behaviour.
const PLAN = {
  'M-BL1':  { orders: [order(10000), order(5000), order(2500)], refunds: [] },   // $175.00
  'M-BL2':  { orders: [], refunds: [] },                                          // open, no sales yet
  'M-BL4':  { orders: [order(20000)], refunds: [{ amount: 5000, taxAmount: 0 }] },// $200 - $50 = $150
  'M-BL8':  { fail: true },                                                       // expired token
  'M-BL14': { orders: [order(30000, 2000)], refunds: [] },                        // $300 gross - $20 tax
};

// Clover is made deliberately SLOW. §4.7 requires asOf to be the data cut-off
// rather than the request time, and with instant stubs those two are the same
// millisecond — the assertion would pass against a wrong implementation.
//
// ⚠️ The delay must exceed ONE SECOND of accumulated fetch time, not merely be
// non-zero. asOf is serialised to second precision, so a correct stamp can
// round backwards by up to 999 ms; at 120 ms this assertion passed or failed on
// the luck of the millisecond, which a mutation run caught. Each store makes
// ~3 sequential calls, so 500 ms puts the cut-off ~1.5 s past t0 and the two
// candidate stamps can no longer overlap.
const CLOVER_DELAY_MS = 500;
let cloverCalls = 0;
globalThis.fetch = async (url) => {
  const u = String(url);
  cloverCalls++;
  await new Promise(r => setTimeout(r, CLOVER_DELAY_MS));
  const m = u.match(/merchants\/([^/]+)\//);
  const plan = PLAN[m && m[1]];
  if (!plan) throw new Error('unexpected merchant in fetch: ' + u.slice(0, 100));
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (plan.fail) return new Response('Unauthorized', { status: 401 });
  if (u.includes('/orders')) return json({ elements: plan.orders });
  if (u.includes('/refunds')) return json({ elements: plan.refunds });
  if (u.includes('/credits')) return json({ elements: [] });
  return json({ elements: [] });
};

db.exec('DELETE FROM daily_sales');
const ins = db.prepare('INSERT INTO daily_sales (store, date, budget) VALUES (?, ?, ?)');
for (const [s, b] of Object.entries({ BL1: 9332, BL2: 4841, BL4: 3534, BL8: 4421, BL14: 4188, BL16: 4162 })) {
  ins.run(s, todayET, b);
}

const t0 = Date.now();   // request start — the baseline asOf must beat
const res = await worker.fetch(
  new Request('https://api.retjghub.com/?action=afternoon-briefing', { headers: { 'X-API-Key': KEY } }), env, ctx);

eq(res.status, 200, 'returns 200 with a valid key');
eq(res.headers.get('Cache-Control'), 'public, max-age=60', 'cached for 60s — this figure moves all day');
const body = await res.json();
const by = Object.fromEntries(body.stores.map(s => [s.storeId, s]));

// ── Envelope ──────────────────────────────────────────────────────────────
ok(!Array.isArray(body), 'response is an envelope, never a bare array');
for (const k of ['generatedAt', 'salesDate', 'asOf', 'currency', 'stores']) {
  ok(k in body, `envelope carries "${k}"`);
}
// THE defining difference from morning-briefing.
eq(body.salesDate, todayET, 'salesDate is TODAY, not yesterday');
eq(body.currency, 'USD', 'currency is USD');
eq(body.stores.length, 6, 'every store appears');

// ── asOf carries a real offset ────────────────────────────────────────────
ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-0[45]:00$/.test(body.asOf),
   `asOf is ISO-8601 with a real ET offset, not "Z" (got ${body.asOf})`);
ok(!body.asOf.endsWith('Z'), 'asOf never claims UTC');
// The offset must actually correspond to the instant, not be pasted on: asOf
// re-read as a real date has to land within a minute of generatedAt.
ok(Math.abs(new Date(body.asOf).getTime() - new Date(body.generatedAt).getTime()) < 60000,
   'asOf and generatedAt describe the same instant — the offset is real, not decorative');
// The spec's actual requirement: asOf is the DATA CUT-OFF, not the moment the
// request arrived. Clover is stubbed slow above, so a request-time stamp lands
// measurably before the fetches finish and this fails.
ok(new Date(body.asOf).getTime() >= t0 + 400,
   `asOf is stamped after the Clover fetches, not at request time (asOf lands ${new Date(body.asOf).getTime() - t0} ms after t0; a request-time stamp cannot exceed 0)`);

// ── Day shape ─────────────────────────────────────────────────────────────
for (const k of ['storeId', 'name', 'salesSoFarToday', 'todayBudget', 'transactions', 'reportingStatus']) {
  ok(k in by.BL1, `store object carries "${k}"`);
}
const VALID = new Set(['reported', 'no_data', 'closed']);
ok(body.stores.every(s => VALID.has(s.reportingStatus)), 'reportingStatus set on every store, never null');
// Not emitted, and deliberately so: there is no intraday curve in this system,
// and a flat pro-rata is the thing §4.7 says overstates morning misses.
ok(!('expectedByNow' in by.BL1), 'expectedByNow is omitted rather than faked from a flat line');

// ── A trading store ───────────────────────────────────────────────────────
eq(by.BL1.reportingStatus, 'reported', 'a store with sales is reported');
eq(by.BL1.salesSoFarToday, 175, 'sales so far = 100 + 50 + 25');
eq(by.BL1.transactions, 3, 'transaction count comes through');
eq(by.BL1.todayBudget, 9332, "today's budget comes from D1");
eq(by.BL1.name, 'Coliseum', 'store label present');

// ── Refunds are subtracted ────────────────────────────────────────────────
// aggregateOrders reads payment.amount (pre-refund), so without the deduction
// this would read 200 and drift above the daily netSales it gets compared to.
eq(by.BL4.salesSoFarToday, 150, 'refunds are subtracted: 200 - 50');
ok(by.BL4.salesSoFarToday !== 200, 'the pre-refund figure is not what ships');

// Tax is excluded, matching every other net figure in the API.
eq(by.BL14.salesSoFarToday, 280, 'tax is excluded: 300 gross - 20 tax');

// ── THE distinction: a true zero vs a failure ─────────────────────────────
eq(by.BL2.reportingStatus, 'reported', 'a store that has not opened yet is REPORTED');
eq(by.BL2.salesSoFarToday, 0, 'and reports a true 0 — Clover answered, the answer was none');
eq(by.BL2.transactions, 0, 'with zero transactions');

eq(by.BL8.reportingStatus, 'no_data', 'a store whose Clover call FAILED is no_data');
eq(by.BL8.salesSoFarToday, null, 'and reports null, NOT 0 — this is the whole point');
eq(by.BL8.transactions, null, 'and null transactions');
eq(by.BL8.todayBudget, 4421, 'while still carrying its budget');

eq(by.BL16.reportingStatus, 'no_data', 'a store with no credentials is no_data');
eq(by.BL16.salesSoFarToday, null, 'and null, not 0');

// One store's failure must not take the briefing down with it.
ok(by.BL1.salesSoFarToday === 175 && by.BL14.salesSoFarToday === 280,
   'a failing store does not poison the healthy ones — allSettled, not all');

// ── Cost: the item-categorisation half of the live path must stay out ─────
// The dashboard's ?store= handler also fetches the item category map and runs
// aggregateItemSales. §4.7 needs none of it, and it is what would push six
// stores past the 3 s budget.
// Subrequest COUNT is the guard, not wall-clock. The clock here is measuring
// this file's own 500 ms stub delay, so asserting on it would prove nothing
// about production — whereas the call count is exactly what drives real
// latency, and is what an added fetchItemCategoryMap would blow.
ok(cloverCalls <= 24, `stayed within ~3 subrequests per store (made ${cloverCalls} calls for 6 stores)`);
ok(cloverCalls >= 6, `the stub was actually reached (${cloverCalls} calls) — a zero here would make every assertion above vacuous`);

// ── Auth and method, the shared gate ──────────────────────────────────────
let r2 = await worker.fetch(new Request('https://api.retjghub.com/?action=afternoon-briefing'), env, ctx);
eq(r2.status, 401, 'missing key → 401');
eq((await r2.json()).error, 'Unauthorized', 'missing key → {"error":"Unauthorized"}');
r2 = await worker.fetch(new Request('https://api.retjghub.com/?action=afternoon-briefing',
  { headers: { 'X-API-Key': 'wrong-key-same-len!!' } }), env, ctx);
eq(r2.status, 401, 'wrong key → 401');
r2 = await worker.fetch(new Request('https://api.retjghub.com/?action=afternoon-briefing',
  { method: 'POST', headers: { 'X-API-Key': KEY } }), env, ctx);
eq(r2.status, 405, 'POST → 405; read-only');

// Registered in ACTION_BUSINESS — the gate is fail-closed, so an unlisted
// action is refused. Asserted through a real request, not by reading the map.
r2 = await worker.fetch(new Request('https://api.retjghub.com/?action=afternoon-briefing',
  { headers: { 'X-API-Key': KEY } }), env, ctx);
eq(r2.status, 200, 'afternoon-briefing is routable');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
