// Orders Clover keeps with a payment and nothing else count as sales, as they do in Clover.
//
// WHAT HAPPENED. From Monday 2026-11-02, BL1 Coliseum took card payments on one device as a keyed
// amount, with no items rung. Clover stores each one as a locked, PAID order with no line items
// and NO `total` field, only its payment. Clover's own Net Sales counts it. The app skipped every
// order whose total was missing, so BL1 read short of Clover: $355 on Nov 2, $1,172 (17%) on
// Nov 3, about $530 by 3 PM on Nov 4. Every other store matched Clover to the cent, because no
// other store has orders shaped like this.
//
// This drives the real worker through each reader of a day's orders: the live figure
// (`?store=`), the stored day (`?action=snapshot`: daily_sales and the items: snapshot) and the
// hourly chart (`?action=hourly`), with a Clover that returns the exact order shape BL1's device
// produces. A paid order with no total is $7.00 + $20.00 of the day; an order with no total and
// no successful payment (abandoned, declined) still counts for nothing.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const worker = await loadWorker(process.argv[2] || repo);

const D = '2026-11-03';                          // a Tuesday, Eastern standard time
const at = (hhmmEt) => Date.parse(`${D}T${hhmmEt}:00-05:00`);

// One rung order: a $6 sweater and a $4 bin item, $0.70 tax.
const ITEM_ORDER = {
  id: 'O-ITEM', state: 'locked', paymentState: 'PAID', total: 1070, createdTime: at('10:05'),
  payments: { elements: [{ id: 'p1', amount: 1070, taxAmount: 70, result: 'SUCCESS', createdTime: at('10:06') }] },
  lineItems: { elements: [
    { id: 'l1', name: 'Sweater', price: 600, unitQty: 1000 },
    { id: 'l2', name: '$4 Bin', price: 400, unitQty: 1000 },
  ] },
};
// Exactly what Clover returned for BL1's device on 2026-11-04: no total, no lineItems, no
// device or employee on the order, only the payment.
const paidOnly = (id, hhmm, amount, taxAmount, result = 'SUCCESS') => ({
  id, currency: 'USD', paymentState: 'PAID', state: 'locked', manualTransaction: false,
  groupLineItems: true, testMode: false, createdTime: at(hhmm), clientCreatedTime: at(hhmm), modifiedTime: at(hhmm) + 2000,
  payments: { elements: [{ id: 'p-' + id, order: { id }, amount, tipAmount: 0, taxAmount, cashbackAmount: 0,
    result, offline: false, createdTime: at(hhmm) + 1000 }] },
});
const ORDERS = [
  ITEM_ORDER,
  paidOnly('O-PAY1', '10:40', 749, 49),          // $7.00 before tax
  paidOnly('O-PAY2', '13:15', 2140, 140),        // $20.00 before tax
  paidOnly('O-DECLINED', '14:00', 500, 0, 'FAIL'),
  { id: 'O-EMPTY', state: 'locked', createdTime: at('14:30') },   // no total, no payment
];

globalThis.fetch = async (u) => {
  const url = new URL(String(u));
  const J = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (!url.hostname.endsWith('clover.com')) throw new Error('unexpected outbound fetch: ' + url.href.slice(0, 120));
  const first = (url.searchParams.get('offset') || '0') === '0';
  const filters = url.searchParams.getAll('filter');
  const lo = Number((filters.find(f => f.startsWith('createdTime>=')) || '>=0').split('>=')[1]);
  const hi = Number((filters.find(f => f.startsWith('createdTime<')) || '<Infinity').split('<')[1]);
  if (url.pathname.endsWith('/orders')) return J({ elements: first ? ORDERS.filter(o => o.createdTime >= lo && o.createdTime < hi) : [] });
  return J({ elements: [] });   // refunds, manual refunds, credits, the category map
};

const r2 = (n) => Math.round(n * 100) / 100;
const fresh = () => {
  const { db, env } = makeEnv(process.argv[2] || repo);
  env.BL1_MERCHANT_ID = 'M1';
  env.BL1_API_TOKEN = 'clover-token-bl1';
  db.exec('DELETE FROM daily_sales');
  return { db, env };
};
const run = async (env, r) => {
  const pending = [];
  const res = await worker.fetch(r, env, { waitUntil: (p) => pending.push(Promise.resolve(p)), passThroughOnException() {} });
  const body = await res.json();
  await Promise.allSettled(pending);
  return { status: res.status, body };
};

// ── 1. The live figure ───────────────────────────────────────────────────────
{
  const RealDate = Date;
  const NOW = Date.parse(`${D}T15:30:00-05:00`);
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } };
  try {
    const { db, env } = fresh();
    const { status, body } = await run(env, req(`/?store=BL1&since=${at('00:00')}`, { user: 'u-su' }));
    eq(status, 200, 'live: the route answers');
    const a = body.aggregate || {};
    eq([a.total, a.bin, a.retail], [37, 4, 33], 'live: $10 rung + $27 paid with no items = $37 net (bin $4, the rest retail)');
    eq(a.orderCount, 3, 'live: three paid orders (not the declined one, not the empty one)');
    eq(r2(body.binNet + body.retailNet), 37, 'live: the item split sums to the same $37');
    const row = db.prepare('SELECT total, order_count FROM daily_sales WHERE store = ? AND date = ?').get('BL1', D);
    eq([row?.total, row?.order_count], [37, 3], 'live: and today\'s daily_sales row is saved at $37 / 3 orders');
  } finally { globalThis.Date = RealDate; }
}

// ── 2. The stored day (the nightly snapshot path) ───────────────────────────
{
  const { db, env } = fresh();
  const { status, body } = await run(env, req(`/?action=snapshot&store=BL1&date=${D}`, { method: 'POST', secret: env.SNAPSHOT_SECRET }));
  eq(status, 200, 'snapshot: runs');
  const row = db.prepare('SELECT total, retail, bin, order_count FROM daily_sales WHERE store = ? AND date = ?').get('BL1', D);
  eq([row?.total, row?.retail, row?.bin, row?.order_count], [37, 33, 4, 3], 'snapshot: daily_sales holds $37 (retail $33, bin $4) over 3 orders');
  const snap = JSON.parse(await env.SALES_SNAPSHOTS.get(`items:bl1:${D}`) || 'null');
  eq(snap?.totals?.netSales, 37, 'snapshot: the items: snapshot (Retail Summary, categories) nets $37 too');
  const other = snap?.categories?.find(c => c.category === 'Other / Non-Item');
  eq(other?.netSales, 27, 'snapshot: the $27 with no items is filed as Other / Non-Item');
  ok(body && JSON.stringify(body).length > 0, 'snapshot: returns a body');
}

// ── 3. The hourly chart adds up to the day ──────────────────────────────────
{
  const { env } = fresh();
  const { status, body } = await run(env, req(`/?action=hourly&store=BL1&date=${D}`, { user: 'u-su' }));
  eq(status, 200, 'hourly: answers');
  const hours = body.hours || body.hourly || body;
  eq([r2(hours[10]), r2(hours[13]), r2(hours[14])], [17, 20, 0], 'hourly: 10 AM $17 (rung $10 + $7 keyed), 1 PM $20, 2 PM nothing (declined + empty)');
  eq(r2(hours.reduce((s, v) => s + v, 0)), 37, 'hourly: the hours sum to the day\'s $37');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
