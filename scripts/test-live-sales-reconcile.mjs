// The live store card must satisfy:  total === retail + bin
//
// It did not. On 2026-08-09 at 21:55 a manager's card read BL1 retail $6,002.35
// + bin $4,448.00 = $10,450.35 against a Net of $10,442.34, and BL4 $4,664.60
// against $4,642.13. The stored day reconciled perfectly the next morning,
// because the nightly job takes total AND the split from one pipeline — so the
// defect was invisible to anyone checking after the fact.
//
// Cause: `fetchLiveCloverSales` re-aggregates the raw orders in the browser off
// `order.total`, but Clover REDUCES order.total for a same-day refund while
// leaving payment.amount intact. The worker reads payment.amount; the client
// never got that fix, so it deducted the refund a second time — while the
// retail/bin figures came from the worker untouched.
//
// ── What this test is, and is not ──────────────────────────────────────────
// There is no DOM harness in this repo (no node_modules, no jsdom), so this
// extracts `fetchLiveCloverSales` from index.html and runs THE REAL FUNCTION
// BODY. Only the network is stubbed. That is weaker than driving the page —
// it cannot see whether renderCards actually calls this — but it is not a
// restatement of the logic either: the arithmetic under test is the shipped
// arithmetic, byte for byte. The wiring is covered by the browser check
// recorded in tasks/channel-reconciliation.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

// ── extract the real function ──────────────────────────────────────────────
const src = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const start = src.indexOf('  async function fetchLiveCloverSales(storeKey) {');
const end = src.indexOf('\n  }\n', src.indexOf('console.warn(`Clover API error', start));
if (start < 0 || end < 0) { console.log('  FAIL: could not extract fetchLiveCloverSales'); process.exit(1); }
const fnSrc = src.slice(start, end + 4);
// Guard against a vacuous extraction: if the slice ever stops containing the
// branch under test, every assertion below would pass against nothing.
ok(/data\?\.binNet/.test(fnSrc) && /refundCents/.test(fnSrc),
   'extracted body still contains the binNet branch and the refund handling');
ok(fnSrc.length > 4000, `extracted a whole function, not a fragment (${fnSrc.length} chars)`);

const BIN_PATTERNS = [/\bbin\b/i, /\bfill a bag\b/i, /\bglass case\b/i, /\bikea bag\b/i];
const isBinItem = (n) => BIN_PATTERNS.some(p => p.test(n));

function build(response) {
  const cachedFetch = async () => response;
  return new Function(
    'cachedFetch', 'WORKER_BASE', 'isBinItem', 'MAX_TXN_DURATION_MS',
    `${fnSrc}\n return fetchLiveCloverSales;`
  )(cachedFetch, 'https://api.example/', isBinItem, 30 * 60 * 1000);
}

// One order for $100 pre-tax, later refunded $10 the SAME day. Clover has
// already knocked the refund off order.total (90.00) but payments still carry
// the original 100.00 — the exact shape that broke the card.
//
// ⚠️ createdTime MUST fall inside today: the function drops orders older than
// local midnight. A fixture timestamped in 1970 is skipped by the loop, so the
// aggregation never runs and the assertions pass against zeroes. That is how
// the first draft of this file "passed".
const NOW = Date.now();
const sameDayRefundOrder = {
  total: 9000, state: 'locked', createdTime: NOW,
  payments: { elements: [{ amount: 10000, taxAmount: 0, createdTime: NOW + 500 }] },
  lineItems: { elements: [
    { name: 'Sweater', price: 6000, unitQty: 1000 },
    { name: 'Bin Item', price: 4000, unitQty: 1000 },
  ] },
};

// ── the defect, reproduced ─────────────────────────────────────────────────
{
  const f = build({
    elements: [sameDayRefundOrder],
    refundCents: 1000,
    binNet: 40.00,      // worker's category split, refund-attributed
    retailNet: 50.00,
  });
  const r = await f('BL1');
  ok(r.orderCount === 1, `the fixture actually reached the loop (orderCount ${r.orderCount}, must be 1)`);
  ok(Math.abs(r.total - (r.retail + r.bin)) < 0.005,
     `live card reconciles: total ${r.total} vs retail ${r.retail} + bin ${r.bin} = ${(r.retail + r.bin).toFixed(2)}`);
  ok(Math.abs(r.total - 90.00) < 0.005,
     `Net equals the figure the nightly job stores (90.00), got ${r.total}`);
}

// ── the fixture really does reproduce the divergence ───────────────────────
// Same orders, but with the worker's split withheld so the client's own
// re-aggregation decides the total. If that number equals retail+bin from the
// branch above, the fixture is not exercising the bug and the test above is
// worthless.
{
  const loopOnly = await build({ elements: [sameDayRefundOrder], refundCents: 1000 })('BL1');
  ok(Math.abs(loopOnly.total - 90.00) > 0.005,
     `client re-aggregation disagrees with the worker split — got ${loopOnly.total} vs 90.00, ` +
     `the $10 same-day refund double-counted. This is the bug being fixed.`);
}

// ── no refunds: must still reconcile (guards an over-correction) ───────────
{
  const f = build({
    elements: [{ ...sameDayRefundOrder, total: 10000 }],
    refundCents: 0, binNet: 40.00, retailNet: 60.00,
  });
  const r = await f('BL1');
  ok(Math.abs(r.total - (r.retail + r.bin)) < 0.005,
     `no-refund day reconciles: ${r.total} vs ${(r.retail + r.bin).toFixed(2)}`);
  ok(Math.abs(r.total - 100.00) < 0.005, `no-refund Net is 100.00, got ${r.total}`);
}

// ── fallback branch (worker omits the split) must reconcile too ────────────
// This branch always did — its proportional subtraction is what the preferred
// branch was missing. Pinned so a future edit can't quietly break it instead.
{
  const f = build({ elements: [sameDayRefundOrder], refundCents: 1000 });
  const r = await f('BL1');
  ok(Math.abs(r.total - (r.retail + r.bin)) < 0.02,
     `fallback reconciles: total ${r.total} vs retail ${r.retail} + bin ${r.bin}`);
}

// ── a zero/absent split must NOT be trusted as a total ─────────────────────
{
  const f = build({ elements: [sameDayRefundOrder], refundCents: 0, binNet: 0, retailNet: 0 });
  const r = await f('BL1');
  ok(r.total > 0, `an empty worker split falls back rather than reporting $0 Net, got ${r.total}`);
}

// ── no data at all ─────────────────────────────────────────────────────────
{
  const f = build({ elements: [], refundCents: 0 });
  const r = await f('BL1');
  ok(r.total === 0 && r.retail === 0 && r.bin === 0, 'an empty day is all zeroes, not NaN');
  ok(Number.isFinite(r.total), 'empty-day total is finite');
}

console.log(`\nlive-sales-reconcile: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
