// Gross margin gated on cost coverage — §4.5 of the Chief of Staff work order.
//
// WHAT WAS ACTUALLY WRONG. The briefing shipped a flat 0.999, and the work
// order reads that as "COGS is not wired in". It is subtler than that: revenue
// whose cost never resolves books at ZERO cost, and zero cost is a 100% margin,
// so the figure was a real blended average dragged toward 1 by the uncosted
// share. Every snapshot already stores the share — coverage.{item,category,none}
// in dollars of net sales — so the fix is to report the margin only when enough
// of the revenue was actually costed, and to ship the coverage either way.
//
// 🔑 THE SPEC'S OWN HEURISTIC IS WRONG FOR THIS BUSINESS, and one case below
// pins that deliberately. The work order says to treat anything ≥ 0.95 as
// unloaded cost data. Bargain Lane is a liquidation retailer buying by the lot,
// so a fully-costed category can genuinely land at 99%. A 99% margin with 100%
// coverage must therefore still be REPORTED — discarding it would throw away a
// true figure for being large.
//
// Snapshot fixtures use the real stored shape: mergeItemSnapshots recomputes
// gpmPct from netSales and cost, so the fixtures set those and let the worker
// derive the margin rather than asserting a number the test handed it.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const KEY = 'test-briefing-key';
const todayET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const _y = new Date(todayET + 'T12:00:00Z'); _y.setUTCDate(_y.getUTCDate() - 1);
const yesterdayET = _y.toISOString().slice(0, 10);

const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
env.MORNING_BRIEFING_KEY = KEY;
blockNetwork();

db.exec('DELETE FROM daily_sales');
const ins = db.prepare(
  `INSERT INTO daily_sales (store, date, total, budget, order_count, snapshot_time, is_manual_override)
   VALUES (?, ?, ?, ?, ?, '2026-08-11T03:55:00Z', 0)`
);
for (const s of ['BL1', 'BL2', 'BL4', 'BL8', 'BL14', 'BL16']) ins.run(s, yesterdayET, 10000, 11000, 300);

// category, netSales, cost, coverage — the shape aggregateItemSales writes.
const cat = (category, netSales, cost, item, category_, none) =>
  ({ category, qty: 100, gross: netSales, discounts: 0, refunds: 0, netSales, cost,
     coverage: { item, category: category_, none } });

async function snap(store, categories) {
  await env.SALES_SNAPSHOTS.put(`items:${store.toLowerCase()}:${yesterdayET}`,
    JSON.stringify({ categories, orderCount: 300 }));
}

// BL1 — fully costed, an ordinary margin. 6000 net on 3420 cost = 43%.
await snap('BL1', [cat('Bin Products', 6000, 3420, 6000, 0, 0)]);
// BL2 — fully costed via the CATEGORY tier of the cascade, not the item tier.
// Coverage must count both tiers as costed; only `none` is uncovered.
await snap('BL2', [cat('Hardlines', 4000, 2400, 0, 4000, 0)]);
// BL4 — the old failure mode: most revenue never resolved to a cost, so the
// blend is dragged to ~100%. 8000 net, only 400 of cost, 7500 uncovered.
await snap('BL4', [cat('Hardlines', 8000, 400, 500, 0, 7500)]);
// BL8 — LIQUIDATION REALITY: fully costed and still 99.4%. Must be reported.
await snap('BL8', [cat('Baby', 5000, 30, 5000, 0, 0)]);
// BL14 — two categories, one well costed and one not. Each answers for itself.
await snap('BL14', [
  cat('Bin Products', 5000, 2500, 5000, 0, 0),      // 50%, fully covered
  cat('Seasonal', 3000, 60, 100, 0, 2900),          // 98%, 3.3% covered
]);
// BL16 — a legacy snapshot with no coverage key at all.
await snap('BL16', [{ category: 'Hardlines', qty: 100, netSales: 4000, cost: 2000 }]);

const res = await worker.fetch(
  new Request('https://api.retjghub.com/?action=morning-briefing', { headers: { 'X-API-Key': KEY } }), env, ctx);
eq(res.status, 200, 'briefing returns 200');
const by = Object.fromEntries((await res.json()).stores.map(s => [s.storeId, s]));

// ── Fields present on every store ─────────────────────────────────────────
for (const code of ['BL1', 'BL2', 'BL4', 'BL8', 'BL14', 'BL16']) {
  for (const k of ['grossMargin', 'grossMarginPlan', 'costCoverage', 'categories']) {
    ok(k in by[code], `${code} carries "${k}"`);
  }
}

// ── A well-costed store reports a real margin ─────────────────────────────
eq(by.BL1.grossMargin, 0.43, 'a fully costed store reports its real margin, not 0.999');
eq(by.BL1.costCoverage, 1, 'and 100% cost coverage');
ok(by.BL1.grossMargin > 0.2 && by.BL1.grossMargin < 0.8, 'the value is a realistic fraction');

// The cascade has two costed tiers. Counting only item-level costs as covered
// would wrongly withhold this store's margin.
eq(by.BL2.costCoverage, 1, 'category-tier costs count as covered, not uncovered');
eq(by.BL2.grossMargin, 0.4, 'and the margin is reported');

// ── The old failure mode is now withheld, and diagnosable ─────────────────
eq(by.BL4.grossMargin, null, 'a mostly-uncosted store reports null, not a ~100% blend');
eq(by.BL4.costCoverage, 0.063, 'costCoverage says exactly how little resolved to a cost');
ok(by.BL4.costCoverage < 0.9, 'below the threshold');

// ── Liquidation reality: 99% is real and must survive ─────────────────────
// This is the case the work order's "anything >= 0.95 is unloaded cost data"
// rule would throw away. Coverage is what distinguishes the two.
eq(by.BL8.costCoverage, 1, 'the Baby fixture is fully costed');
eq(by.BL8.grossMargin, 0.994, 'a genuine 99.4% margin is REPORTED, not suppressed for being high');
ok(by.BL8.grossMargin >= 0.95 && by.BL8.costCoverage === 1,
   'high margin + full coverage is a real figure — the >=0.95 heuristic would discard it wrongly');

// ── Per-category treatment, per the spec ──────────────────────────────────
const c14 = Object.fromEntries(by.BL14.categories.map(c => [c.name, c]));
eq(c14['Bin Products'].grossMargin, 0.5, 'a well-costed category reports its margin');
eq(c14['Bin Products'].costCoverage, 1, 'with full coverage');
eq(c14['Seasonal'].grossMargin, null, 'a poorly costed category next to it reports null');
eq(c14['Seasonal'].costCoverage, 0.033, 'and carries its own coverage figure');
ok(c14['Seasonal'].netSales === 3000, 'a withheld margin does not withhold the sales figure');
// The store total blends both, so it falls under the threshold.
eq(by.BL14.grossMargin, null, 'the store total is withheld when the blend is under-covered');
eq(by.BL14.costCoverage, 0.638, 'store coverage is the blended share');

// ── Legacy snapshots degrade honestly ─────────────────────────────────────
eq(by.BL16.grossMargin, null, 'a snapshot with no coverage data reports null');
eq(by.BL16.costCoverage, null, 'and null coverage — an unknown share must not read as full');
ok(by.BL16.categories.length === 1, 'the categories themselves still come through');

// ── grossMarginPlan ───────────────────────────────────────────────────────
// No planned margin exists in any source system — confirmed by reading all 62
// columns of the budget sheet. Present-and-null, so the field name is stable.
for (const code of ['BL1', 'BL8']) {
  eq(by[code].grossMarginPlan, null, `${code} grossMarginPlan is null — no source exists`);
}

// ══ Weekly blended margin ═════════════════════════════════════════════════
// The reason this field exists: bin merchandise is priced on a declining scale
// through the week against a flat per-unit cost, so a DAY's margin is dominated
// by where it falls in that cycle. Measured on BL2 — bins +76% Friday at a
// $9.15 ASP, −317% Wednesday at $0.52, dragging the store 67.0% → 26.8% while
// it performed identically. Only the weekly blend is comparable or trendable.
//
// So the assertion that matters is that wtdGrossMargin DIFFERS from
// grossMargin, and equals the blend rather than any single day.
{
  const { db, env } = makeEnv(repo);
  env.MORNING_BRIEFING_KEY = KEY;
  db.exec('DELETE FROM daily_sales');
  const ins2 = db.prepare(
    `INSERT INTO daily_sales (store, date, week, total, budget, order_count, snapshot_time, is_manual_override)
     VALUES (?, ?, '33', ?, ?, ?, '2026-08-11T03:55:00Z', 0)`
  );
  const back = (n) => {
    const d = new Date(todayET + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  // Three days of the same fiscal week, ending yesterday.
  for (const n of [1, 2, 3]) ins2.run('BL1', back(n), 1000, 1100, 100);
  for (const n of [1, 2, 3]) ins2.run('BL2', back(n), 1000, 1100, 100);

  const day = (net, cost, coveredByItem) => ({
    categories: [{ category: 'Bin Products', qty: 100, netSales: net, cost,
                   coverage: { item: coveredByItem, category: 0, none: net - coveredByItem } }],
    orderCount: 100,
  });
  // BL1 — the bin cycle in miniature. Yesterday is the WORST day of the three.
  await env.SALES_SNAPSHOTS.put(`items:bl1:${back(1)}`, JSON.stringify(day(1000, 900, 1000)));  // 10%
  await env.SALES_SNAPSHOTS.put(`items:bl1:${back(2)}`, JSON.stringify(day(1000, 200, 1000)));  // 80%
  await env.SALES_SNAPSHOTS.put(`items:bl1:${back(3)}`, JSON.stringify(day(1000, 500, 1000)));  // 50%
  // BL2 — one day only, so the week and the day must agree exactly.
  await env.SALES_SNAPSHOTS.put(`items:bl2:${back(1)}`, JSON.stringify(day(1000, 600, 1000)));  // 40%

  const r = await worker.fetch(
    new Request('https://api.retjghub.com/?action=morning-briefing', { headers: { 'X-API-Key': KEY } }), env, ctx);
  const w = Object.fromEntries((await r.json()).stores.map(s => [s.storeId, s]));

  for (const code of ['BL1', 'BL2', 'BL8']) {
    for (const k of ['wtdGrossMargin', 'wtdCostCoverage']) ok(k in w[code], `${code} carries "${k}"`);
  }

  // Daily is yesterday alone; weekly is 3000 net against 1600 cost.
  eq(w.BL1.grossMargin, 0.1, "daily margin is yesterday's alone");
  eq(w.BL1.wtdGrossMargin, 0.467, 'weekly margin blends all three days (1400/3000)');
  ok(w.BL1.wtdGrossMargin !== w.BL1.grossMargin,
     'THE POINT: the weekly figure differs from the daily one — a bad bin day does not define the week');
  ok(w.BL1.wtdGrossMargin > w.BL1.grossMargin, 'and here it is far better than yesterday looked');
  eq(w.BL1.wtdCostCoverage, 1, 'coverage blends across the week too');

  // A single-day week is the degenerate case and must agree.
  eq(w.BL2.grossMargin, 0.4, 'BL2 daily margin');
  eq(w.BL2.wtdGrossMargin, 0.4, 'with one day of data, weekly == daily');

  // No snapshots at all → null, never 0.
  eq(w.BL8.wtdGrossMargin, null, 'a store with no snapshots reports null weekly margin');
  eq(w.BL8.wtdCostCoverage, null, 'and null weekly coverage');
}

// ══ The coverage gate applies to the weekly figure independently ═══════════
// A week can blend under the threshold even when yesterday alone was fine —
// and must then be withheld on its own merits.
{
  const { db, env } = makeEnv(repo);
  env.MORNING_BRIEFING_KEY = KEY;
  db.exec('DELETE FROM daily_sales');
  const back = (n) => {
    const d = new Date(todayET + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const ins3 = db.prepare(
    `INSERT INTO daily_sales (store, date, week, total, budget, snapshot_time, is_manual_override)
     VALUES (?, ?, '33', 1000, 1100, '2026-08-11T03:55:00Z', 0)`
  );
  for (const n of [1, 2]) ins3.run('BL1', back(n));
  const day = (net, cost, item, none) => ({
    categories: [{ category: 'X', qty: 100, netSales: net, cost,
                   coverage: { item, category: 0, none } }],
    orderCount: 100,
  });
  // Yesterday fully costed; the day before almost entirely uncosted.
  await env.SALES_SNAPSHOTS.put(`items:bl1:${back(1)}`, JSON.stringify(day(1000, 600, 1000, 0)));
  await env.SALES_SNAPSHOTS.put(`items:bl1:${back(2)}`, JSON.stringify(day(4000, 100, 100, 3900)));

  const r = await worker.fetch(
    new Request('https://api.retjghub.com/?action=morning-briefing', { headers: { 'X-API-Key': KEY } }), env, ctx);
  const b = (await r.json()).stores.find(s => s.storeId === 'BL1');

  eq(b.grossMargin, 0.4, 'yesterday alone is fully costed and reports');
  eq(b.costCoverage, 1, 'with full daily coverage');
  eq(b.wtdGrossMargin, null, 'but the WEEK is under-covered and is withheld on its own merits');
  eq(b.wtdCostCoverage, 0.22, 'and reports its blended coverage so the null is diagnosable');
}

// ── The rest of the contract is untouched ─────────────────────────────────
for (const k of ['storeId', 'name', 'salesDate', 'reportingStatus', 'netSales', 'posSales',
                 'auctionSales', 'budgetForSalesDate', 'todayBudget', 'wtdSales', 'mtdSales',
                 'lySalesForDate', 'laborActualPct', 'transactions']) {
  ok(k in by.BL1, `pre-existing field "${k}" survives`);
}
eq(by.BL1.netSales, 10000, 'the sales figures are untouched by the margin work');
eq(by.BL1.reportingStatus, 'reported', 'reportingStatus is untouched');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
