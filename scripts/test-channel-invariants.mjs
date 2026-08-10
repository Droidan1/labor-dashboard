// Channel invariants, driven through the REAL aggregateItemSales.
//
// Every defect found on 2026-08-10 was an invariant nobody had written down.
// Each pipeline's arithmetic was internally correct; it was the agreement
// BETWEEN them that failed, so unit tests on either side stayed green while a
// manager watched numbers that did not add up.
//
// This file drives `worker.fetch` on ?action=items with Clover's HTTP responses
// stubbed — the platform, not the code under test. That reaches
// aggregateItemSales for real, which is the one thing
// scripts/test-channel-range.mjs cannot do (its fixtures hand `mixed` in
// pre-computed, so deleting the counter that produces it left that suite green).
//
// The invariants, all measured against production first:
//   1. channels.retail.net + channels.bin.net + every other category's net
//      == totals.netSales                          (nothing falls out of the split)
//   2. retail.orders + bin.orders - mixed
//      == orders holding at least one classifiable line item
//   3. mixed <= min(retail.orders, bin.orders)     (it is an overlap, not a total)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

// ── Clover stub. Only the platform is faked; worker.js runs unmodified. ────
let seenUrls = [];
function stubClover({ orders = [], refunds = [], credits = [], items = [] }) {
  seenUrls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    seenUrls.push(u);
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('/orders')) return json({ elements: orders });
    if (u.includes('/refunds')) return json({ elements: refunds });
    if (u.includes('/credits')) return json({ elements: credits });
    if (u.includes('/items')) return json({ elements: items });
    throw new Error('unexpected outbound fetch: ' + u.slice(0, 120));
  };
}

const worker = await loadWorker(repo);
const { env } = makeEnv(repo);
// ⚠️ These names must match what the handler reads. A wrong name fails the
// fetch identically to a broken stub, and the suite would still "pass" on the
// error branch — the trap that made an earlier differential test vacuous.
env.BL1_MERCHANT_ID = 'TESTMERCHANT';
env.BL1_API_TOKEN = 'test-token';

const NOW = Date.now();
const li = (id, name, priceCents, qty = 1) => ({
  id, name, price: priceCents, unitQty: qty * 1000, item: { id: 'i-' + id },
});
const order = (id, lineItems, { tax = 0, extraCents = 0 } = {}) => {
  const gross = lineItems.reduce((s, l) => s + l.price * (l.unitQty / 1000), 0);
  const netBeforeTax = gross + extraCents;      // extraCents => "Other / Non-Item" residual
  return {
    id, state: 'locked', createdTime: NOW,
    total: netBeforeTax + tax,
    payments: { elements: [{ id: 'p-' + id, amount: netBeforeTax + tax, taxAmount: tax, createdTime: NOW + 100 }] },
    lineItems: { elements: lineItems },
  };
};

// A day with every shape that has ever broken this: retail-only, bin-only,
// TWO mixed baskets, a service-charge residual with no line item, and a refund.
const ORDERS = [
  order('o1', [li('l1', 'Sweater', 2000)]),                              // retail only
  order('o2', [li('l2', 'Bin $5', 500, 3)]),                             // bin only
  order('o3', [li('l3', 'Sweater', 1000), li('l4', 'Bin $5', 500)]),     // MIXED
  order('o4', [li('l5', 'Fill A Bag', 1500), li('l6', 'Recliner', 8000)]), // MIXED
  order('o5', [li('l7', 'Sweater', 3000)], { extraCents: 250 }),          // residual $2.50
];
const REFUNDS = [{ id: 'r1', amount: 500, taxAmount: 0, orderRef: { id: 'o1' } }];

const call = async () => {
  const r = await worker.fetch(req('/?action=items&store=BL1', { user: 'u-su' }), env, ctx);
  return { status: r.status, body: JSON.parse(await r.text()) };
};

// ── the stub is actually being exercised ──────────────────────────────────
{
  stubClover({ orders: ORDERS, refunds: REFUNDS });
  const { status, body } = await call();
  ok(status === 200, `?action=items returns 200, got ${status} ${JSON.stringify(body).slice(0, 120)}`);
  ok(seenUrls.some(u => u.includes('/orders')), 'the handler really fetched orders through the stub');
  ok(!body.error, `no error in the body: ${body.error || 'none'}`);
  ok(Array.isArray(body.categories) && body.categories.length > 0,
     `categories were produced (${body.categories?.length ?? 0}) — an empty run would pass every identity below vacuously`);
  ok(!!body.channels, 'channels present in the items payload');
}

// ── INVARIANT 1: nothing falls out of the channel split ───────────────────
{
  stubClover({ orders: ORDERS, refunds: REFUNDS });
  const { body } = await call();
  const ch = body.channels;
  const binNames = new Set(['Bin Products']);
  const otherNet = body.categories
    .filter(c => !binNames.has(c.category))
    .reduce((s, c) => s + c.netSales, 0);
  // retail-side categories are "everything not Bin Products", which is exactly
  // how the live endpoint derives retailNet.
  const identity = ch.bin.net + otherNet;
  ok(Math.abs(identity - body.totals.netSales) < 0.005,
     `bin + all non-bin categories == netSales: ${identity.toFixed(2)} vs ${body.totals.netSales.toFixed(2)}`);

  // 🔑 ABSOLUTE anchor. The identity below is a CONSISTENCY check — both sides
  // derive from the same accumulation, so a change that drops revenue from
  // categories AND from netSales together keeps it satisfied. Measured: routing
  // the residual nowhere leaves the identity green. This pins the real number
  // the fixture constructs, so revenue cannot quietly leave through both doors.
  //   o1 20.00 + o2 15.00 + o3 15.00 + o4 95.00 + o5 32.50 = 177.50, less the
  //   5.00 refund on o1 = 172.50.
  ok(Math.abs(body.totals.netSales - 172.50) < 0.005,
     `netSales equals the constructed total (172.50), got ${body.totals.netSales}`);

  // The known, measured gap: the channel accumulator sees line items only, so
  // the residual and refunds sit outside it. Pinned as an EQUALITY so that if
  // anyone routes them into _ch, this test tightens rather than silently
  // tolerating a new discrepancy.
  const residualNet = body.categories
    .filter(c => c.category === 'Other / Non-Item')
    .reduce((s, c) => s + c.netSales, 0);
  const refundNet = body.totals.refunds || 0;
  const decomposed = ch.retail.net + ch.bin.net + residualNet + refundNet;
  ok(Math.abs(decomposed - body.totals.netSales) < 0.005,
     `channels + residual + refunds == netSales: ${decomposed.toFixed(2)} vs ${body.totals.netSales.toFixed(2)}`);
  ok(Math.abs(residualNet - 2.50) < 0.005,
     `the $2.50 service charge landed in Other / Non-Item, got ${residualNet.toFixed(2)}`);
}

// ── INVARIANT 2: mixed is the real overlap (covers the counter directly) ──
{
  stubClover({ orders: ORDERS, refunds: REFUNDS });
  const { body } = await call();
  const ch = body.channels;
  // o3 and o4 hold both a retail and a bin line item.
  ok(ch.mixed === 2, `mixed counts the two mixed baskets, got ${ch.mixed}`);
  ok(ch.retail.orders === 4, `retail touched o1,o3,o4,o5, got ${ch.retail.orders}`);
  ok(ch.bin.orders === 3, `bin touched o2,o3,o4, got ${ch.bin.orders}`);
  ok(ch.retail.orders + ch.bin.orders - ch.mixed === 5,
     `combined orders == the 5 real orders, got ${ch.retail.orders + ch.bin.orders - ch.mixed}`);
  ok(ch.retail.orders + ch.bin.orders === 7,
     'the naive sum really would have been wrong (7), so the subtraction is load-bearing');
  ok(ch.mixed <= Math.min(ch.retail.orders, ch.bin.orders),
     'mixed is an overlap, never larger than either channel');
}

// ── a day with no mixed baskets must report zero, not a constant ──────────
{
  stubClover({ orders: [ORDERS[0], ORDERS[1]], refunds: [] });
  const { body } = await call();
  ok(body.channels.mixed === 0, `no mixed baskets -> mixed 0, got ${body.channels.mixed}`);
  ok(body.channels.retail.orders === 1 && body.channels.bin.orders === 1,
     'one retail-only and one bin-only order');
}

// ── an all-mixed day: every order counts once ─────────────────────────────
{
  stubClover({ orders: [ORDERS[2], ORDERS[3]], refunds: [] });
  const { body } = await call();
  const ch = body.channels;
  ok(ch.mixed === 2 && ch.retail.orders === 2 && ch.bin.orders === 2,
     `all-mixed day: mixed ${ch.mixed}, retail ${ch.retail.orders}, bin ${ch.bin.orders}`);
  ok(ch.retail.orders + ch.bin.orders - ch.mixed === 2,
     'an all-mixed day still counts 2 real transactions, not 4');
}

console.log(`\nchannel-invariants: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
