// The live store card must satisfy:  total === retail + bin
//
// On 2026-08-09 at 21:55 a manager's card read BL1 retail $6,002.35 + bin
// $4,448.00 = $10,450.35 against a Net of $10,442.34, and BL4 $4,664.60 against
// $4,642.13. The stored day reconciled perfectly the next morning, so the
// defect was invisible to anyone checking after the fact.
//
// Cause: the browser re-aggregated the raw orders off `order.total`, but Clover
// REDUCES order.total for a same-day refund while leaving payment.amount
// intact. The worker reads payment.amount; the client never got that fix, so it
// deducted the refund twice — while retail/bin came from the worker untouched.
//
// 🔑 That duplicate aggregator is now DELETED. The worker returns a finished
// `aggregate` and the client renders it, so this file tests two things:
//   1. the worker's aggregate reconciles at source (driven through worker.fetch
//      with Clover stubbed — where the arithmetic actually lives now), and
//   2. the client is a faithful pass-through that invents nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

// ── 1 · the worker's aggregate reconciles at source ───────────────────────
const worker = await loadWorker(repo);
const { env } = makeEnv(repo);
env.BL1_MERCHANT_ID = 'TESTMERCHANT';
env.BL1_API_TOKEN = 'test-token';

const NOW = Date.now();
// $100 pre-tax, $10 refunded the SAME day. Clover has already knocked the
// refund off order.total (90.00) while payments still carry the original
// 100.00 — the exact shape that broke the card.
const sameDayRefundOrder = {
  id: 'o1', state: 'locked', createdTime: NOW, total: 9000,
  payments: { elements: [{ id: 'p1', amount: 10000, taxAmount: 0, createdTime: NOW + 500 }] },
  lineItems: { elements: [
    { id: 'l1', name: 'Sweater', price: 6000, unitQty: 1000, item: { id: 'i1' } },
    { id: 'l2', name: 'Bin $5',  price: 4000, unitQty: 1000, item: { id: 'i2' } },
  ] },
};

function stubClover({ orders, refunds = [] }) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('/orders')) return json({ elements: orders });
    if (u.includes('/refunds')) return json({ elements: refunds });
    if (u.includes('/credits')) return json({ elements: [] });
    if (u.includes('/items')) return json({ elements: [] });
    throw new Error('unexpected outbound fetch: ' + u.slice(0, 120));
  };
}

const live = async () => {
  const since = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();
  const r = await worker.fetch(req(`/?store=BL1&since=${since}`, { user: 'u-su' }), env, ctx);
  return { status: r.status, body: JSON.parse(await r.text()) };
};

{
  stubClover({ orders: [sameDayRefundOrder], refunds: [{ id: 'r1', amount: 1000, taxAmount: 0, orderRef: { id: 'o1' } }] });
  const { status, body } = await live();
  ok(status === 200, `live endpoint 200, got ${status}`);
  ok(!!body.aggregate, 'the worker returns a finished aggregate');
  const a = body.aggregate || {};
  ok(a.orderCount === 1, `the fixture reached the aggregator (orderCount ${a.orderCount}, must be 1)`);
  ok(Math.abs(a.total - (a.retail + a.bin)) < 0.005,
     `worker aggregate reconciles: total ${a.total} vs retail ${a.retail} + bin ${a.bin}`);
  ok(Math.abs(a.total - 90.00) < 0.005,
     `Net is the refund-adjusted 90.00 — the refund counted ONCE, got ${a.total}`);
  ok(Math.abs((body.binNet + body.retailNet) - a.total) < 0.005,
     'the aggregate total equals the item pipeline split it is derived from');
}

// ── no refunds: must still reconcile (guards an over-correction) ──────────
{
  stubClover({ orders: [{ ...sameDayRefundOrder, total: 10000 }], refunds: [] });
  const { body } = await live();
  const a = body.aggregate;
  ok(Math.abs(a.total - (a.retail + a.bin)) < 0.005, `no-refund day reconciles: ${a.total}`);
  ok(Math.abs(a.total - 100.00) < 0.005, `no-refund Net is 100.00, got ${a.total}`);
}

// ── an empty day is zeroes, not a crash ──────────────────────────────────
{
  stubClover({ orders: [], refunds: [] });
  const { status, body } = await live();
  ok(status === 200, `empty day still 200, got ${status}`);
  ok('aggregate' in body, 'the aggregate key is present even with no orders');
  ok(body.aggregate === null, 'no orders -> aggregate null (the client turns that into zeroes)');
}

// ── 2 · the client is a pass-through that invents nothing ────────────────
// Source-extracted: no DOM harness exists here. It cannot see that renderCards
// calls this, but it does run the real function body against a real response.
{
  const src = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const start = src.indexOf('  async function fetchLiveCloverSales(storeKey) {');
  const end = src.indexOf('\n  }\n', src.indexOf('console.warn(`Clover API error', start)) + 4;
  const fnSrc = src.slice(start, end);
  ok(start >= 0 && end > start, 'extracted fetchLiveCloverSales');

  // 🔑 The duplicate aggregator must stay gone. If any of these reappear,
  // someone has re-implemented the worker's arithmetic in the browser and the
  // 2026-08-09 defect is back.
  ok(!/for \(const order of/.test(fnSrc), 'the client no longer loops over raw orders');
  ok(!/isBinItem/.test(fnSrc), 'the client no longer classifies bin items');
  ok(!/refundCents/.test(fnSrc), 'the client no longer applies refunds itself');
  ok(!/data\.elements/.test(fnSrc), 'the client no longer reads raw elements');
  // Match CODE, not the word — a comment explaining why the classifier was
  // removed is worth keeping, and should not fail its own assertion.
  const srcNoComments = src.replace(/^\s*\/\/.*$/gm, '');
  ok(!/function\s+isBinItem|isBinItem\s*\(/.test(srcNoComments),
     'no callable isBinItem left in index.html — one bin classifier, in the worker');
  ok(!/BIN_PATTERNS\s*=/.test(srcNoComments), 'the client no longer defines its own bin patterns');

  const build = (response) => new Function(
    'cachedFetch', 'WORKER_BASE',
    `${fnSrc}\n return fetchLiveCloverSales;`
  )(async () => response, 'https://api.example/');

  const agg = { total: 90, retail: 50, bin: 40, avgCart: 45, avgItems: 2, orderCount: 2, avgTxnSec: 30, avgASP: 22.5 };
  const r = await build({ aggregate: agg, channels: { retail: {}, bin: {}, mixed: 1 } })('BL1');
  ok(r.total === 90 && r.retail === 50 && r.bin === 40, 'passes the money figures through unchanged');
  ok(r.orderCount === 2 && r.avgCart === 45 && r.avgASP === 22.5, 'passes the metrics through unchanged');
  ok(r.channels?.mixed === 1, 'passes channels through for the matrix tiles');
  ok(Math.abs(r.total - (r.retail + r.bin)) < 0.005, 'what the client returns still reconciles');

  // A worker with no orders today.
  const zero = await build({ aggregate: null, channels: null })('BL1');
  ok(zero && zero.total === 0 && zero.orderCount === 0, 'aggregate null -> zeroes, not a crash');

  // 🔑 An OLDER worker has no `aggregate` key. The client must say "no data"
  // rather than render a confident $0 during a rollout.
  const old = await build({ elements: [], refundCents: 0, binNet: 5, retailNet: 5 })('BL1');
  ok(old === null, 'a response with no aggregate key returns null, not a fabricated zero');
}

console.log(`\nlive-sales-reconcile: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
