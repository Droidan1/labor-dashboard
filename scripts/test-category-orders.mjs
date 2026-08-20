// Per-category basket counts, driven through the REAL aggregateItemSales.
//
// These are the denominator for "penetration" on the T13 Avg Cart / Avg Items
// cards: when a basket contains Furniture, how much Furniture is in it. That
// question needs a count of baskets that TOUCHED each category, which is not
// derivable from the qty/net maps — a basket holding three categories has to
// increment three counters.
//
// THE INVARIANT THAT MAKES IT MEANINGFUL: those counters therefore sum to MORE
// than the day's orderCount. The overlap IS the metric. The app already learned
// this the hard way one level up: `channels.retail.orders + channels.bin.orders`
// exceeds orderCount, which is the entire reason `channels.mixed` exists.
// A test that only checked "counts look plausible" would pass on an
// implementation that counted each basket once and silently destroyed the
// semantic, so the overlap is asserted directly.
//
// Drives worker.fetch on ?action=items with only Clover's HTTP stubbed — the
// platform, not the code under test — copying scripts/test-channel-invariants.mjs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

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
env.BL1_MERCHANT_ID = 'TESTMERCHANT';
env.BL1_API_TOKEN = 'test-token';

const NOW = Date.now();
const li = (id, name, priceCents, qty = 1) => ({
  id, name, price: priceCents, unitQty: qty * 1000, item: { id: 'i-' + id },
});
const order = (id, lineItems) => {
  const gross = lineItems.reduce((s, l) => s + l.price * (l.unitQty / 1000), 0);
  return {
    id, state: 'locked', createdTime: NOW, total: gross,
    payments: { elements: [{ id: 'p-' + id, amount: gross, taxAmount: 0, createdTime: NOW + 100 }] },
    lineItems: { elements: lineItems },
  };
};

// Names chosen so the resolver's own heuristics bucket them predictably:
// "Sweater" → Softline - Apparel, "Bin $5" → Bin Products, "Recliner" →
// Furniture, "Snack Pack" → Consumable Food.
const ORDERS = [
  order('o1', [li('l1', 'Sweater', 2000)]),                                  // 1 category
  order('o2', [li('l2', 'Bin $5', 500, 3)]),                                 // 1 category
  order('o3', [li('l3', 'Sweater', 1000), li('l4', 'Bin $5', 500)]),         // 2 categories
  order('o4', [li('l5', 'Recliner', 8000), li('l6', 'Snack Pack', 300),
               li('l7', 'Bin $5', 500)]),                                    // 3 categories
];

const call = async () => {
  const r = await worker.fetch(req('/?action=items&store=BL1', { user: 'u-su' }), env, ctx);
  return { status: r.status, body: JSON.parse(await r.text()) };
};

stubClover({ orders: ORDERS });
const { status, body } = await call();

ok(status === 200, `?action=items returns 200, got ${status}`);
ok(seenUrls.some(u => u.includes('/orders')), 'the handler really fetched orders through the stub');
ok(!!body.l2Orders, 'l2Orders is present on the items payload');
ok(!!body.l3Orders, 'l3Orders is present on the items payload');

const l2o = body.l2Orders || {};
const l3o = body.l3Orders || {};
const cats = Object.keys(l2o);
ok(cats.length >= 3, `the fixture produced several categories (${cats.length}) — fewer would make the overlap check vacuous`);

// ── a basket is counted once per category it touched ──────────────────────
// o1 + o3 both hold a Sweater; o2 + o3 + o4 hold a bin item; o4 alone holds
// Furniture and Food. Assert against whichever L2 the resolver chose, so the
// test measures the COUNTING, not the categorisation.
{
  const total = Object.values(l2o).reduce((a, b) => a + b, 0);
  ok(body.orderCount === ORDERS.length, `orderCount is the real basket count (${body.orderCount})`);
  // 1 + 1 + 2 + 3 = 7 category-touches across 4 baskets
  ok(total === 7, `category touches sum to 7 across 4 baskets, got ${total}`);
  ok(total > body.orderCount,
     `THE INVARIANT: touches (${total}) exceed orderCount (${body.orderCount}) because baskets are mixed`);
}

// ── no category can be touched by more baskets than exist ─────────────────
{
  const over = Object.entries(l2o).filter(([, n]) => n > body.orderCount);
  ok(over.length === 0, `no category exceeds orderCount: ${JSON.stringify(over)}`);
  const anyTwo = Object.values(l2o).filter(n => n >= 2).length;
  ok(anyTwo >= 2, `at least two categories appear in multiple baskets (${anyTwo}) — proves counting accumulates`);
}

// ── L3 counts roll up to their L2 ─────────────────────────────────────────
// Each fixture line resolves to exactly one L3 inside its L2, so per category
// the L3 counts must sum to the L2 count. (With several L3s under one L2 in a
// single basket they would exceed it — hence >= is the general rule, and this
// fixture is built so equality holds.)
{
  let bad = [];
  for (const [c, n] of Object.entries(l2o)) {
    const kids = l3o[c] || {};
    const s = Object.values(kids).reduce((a, b) => a + b, 0);
    if (s < n) bad.push(`${c}: L3 sum ${s} < L2 ${n}`);
    if (!Object.keys(kids).length) bad.push(`${c}: no L3 rows at all`);
  }
  ok(bad.length === 0, `L3 counts cover their L2: ${bad.join(' | ')}`);
}

// ── the counts are NORMALIZED, matching l3Qty/l3Net keys ──────────────────
// If these keyed on the raw l3Key, penetration denominators would say
// "[Heuristic] Softline - Apparel" while the net numerators say "Apparel", and
// the two would never join.
{
  const bracketed = [];
  for (const [c, kids] of Object.entries(l3o)) {
    for (const k of Object.keys(kids)) if (k.startsWith('[')) bracketed.push(`${c}/${k}`);
  }
  ok(bracketed.length === 0, `no raw bracketed L3 key survives into l3Orders: ${bracketed.join(', ')}`);
}

// ── a basket is counted ONCE per category, however many lines it has ──────
// Two Sweater lines in one basket must not make it two Softline baskets. This
// is the assertion that fails if the Set is swapped for a counter.
{
  stubClover({ orders: [order('o8', [li('l10', 'Sweater', 2000), li('l11', 'Sweater', 1500)])] });
  const { body: b1 } = await call();
  const apparel = Object.entries(b1.l2Orders || {}).find(([c]) => /Apparel/.test(c));
  ok(!!apparel, `the two-line basket produced an apparel category: ${JSON.stringify(b1.l2Orders)}`);
  ok(apparel && apparel[1] === 1, `two lines of one category count the basket once, got ${apparel?.[1]}`);
  // Same rule one level down. Both lines share an L3, so that L3 is also 1 —
  // without this the L3 side could count per LINE and the roll-up check below,
  // which only requires L3 >= L2, would not notice.
  const kids = (b1.l3Orders || {})[apparel?.[0]] || {};
  const overs = Object.entries(kids).filter(([, n]) => n > 1);
  ok(overs.length === 0,
     `two lines sharing an L3 count that L3 once, got ${JSON.stringify(kids)}`);
}

// ── a refund line lands in Refund, and does not double-count its category ──
// A negative-priced line resolves to L2 "Refund" rather than to the category it
// reverses, so the original category is still touched exactly once. This pins
// the reasoning that makes the units gate unnecessary — if that ever changes,
// this fails rather than silently inflating a denominator.
{
  stubClover({ orders: [order('o7', [li('l12', 'Sweater', 2000), li('l13', 'Sweater', -500, 1)])] });
  const { body: b2 } = await call();
  const l2o = b2.l2Orders || {};
  const apparel = Object.entries(l2o).find(([c]) => /Apparel/.test(c));
  ok(apparel && apparel[1] === 1,
     `a partial refund leaves the category touched once, got ${apparel?.[1]}: ${JSON.stringify(l2o)}`);
  ok((l2o.Refund || 0) === 1, `the negative line is counted under Refund, got ${l2o.Refund}`);
}

// ── an empty day yields empty counts, not a crash ─────────────────────────
{
  stubClover({ orders: [] });
  const { status: s3, body: b3 } = await call();
  ok(s3 === 200, `an empty day still returns 200, got ${s3}`);
  ok(b3.l2Orders && Object.keys(b3.l2Orders).length === 0, 'an empty day yields an empty l2Orders map');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
