// ?action=weekly-t13 — the L3 breakdown that hangs under each L2 on the T13 tab.
//
// Drives worker.fetch with real Request objects (see lib/worker-harness.mjs for
// why nothing here regex-extracts the handler): store scoping, the BL12/BL16
// cutover gate and the KV read path only run if the real routing runs them.
//
// THE INVARIANT THIS PROTECTS: for every (store, week, L2), the L3 rows sum to
// their L2 exactly. The T13 card renders L3 as children of an expandable L2 row,
// so the moment that stops holding the table shows a parent that disagrees with
// its own children and every number below it is suspect.
//
// THE BUG THIS PROTECTS AGAINST: `l3Key` resolution emits bracketed buckets
// recording HOW a line resolved, not what it is — and "[Name match] X" is the
// same category as X, matched by item name. Measured on 13 weeks of production
// 2026-08-13: 35 of 65 real categories were split across a real row AND a
// name-match twin, often inverted (Seasonal SPRING/SUMMER: $2,611 on the real
// row, $43,135 on the twin). normalizeL3Key folds them back. Remove it and the
// "[Name match] merges" assertions below must fail — that is the whole point of
// them; without a real twin in the fixture the normalization is unobservable.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const near = (a, b, eps = 0.005) => Math.abs((a || 0) - (b || 0)) < eps;

blockNetwork();
const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);

// ── fixture ────────────────────────────────────────────────────────────────
// Two weeks straddling the BL12→BL16 cutover (WRS_CUTOVER = 2026-06-14), so the
// gate is exercised in both directions by one request.
const WK_PRE = { week: '24', dates: ['2026-06-07', '2026-06-08'] };  // BL12 live, BL16 dark
const WK_POST = { week: '25', dates: ['2026-06-14', '2026-06-15'] }; // BL16 live, BL12 dark
const ALL_DATES = [...WK_PRE.dates, ...WK_POST.dates];
const FIXTURE_STORES = ['BL1', 'BL2', 'BL4', 'BL8', 'BL12', 'BL14', 'BL16'];

db.prepare('DELETE FROM daily_sales').run();
const ins = db.prepare(
  'INSERT INTO daily_sales (store,date,week,total,retail,bin,auction,order_count,budget,labor_pct) VALUES (?,?,?,?,?,?,?,?,?,?)');
for (const s of FIXTURE_STORES) {
  for (const w of [WK_PRE, WK_POST]) {
    for (const d of w.dates) ins.run(s, d, w.week, 500, 400, 100, 0, 25, 600, 12);
  }
}

// One category with a deliberately nasty L3 mix. Values are per DAY; each store
// gets two days per week, so the weekly figure is double these.
//   · SNACKS appears BOTH as itself and as its "[Name match]" twin -> must merge
//   · three different bracketed buckets -> must collapse to exactly one row
//   · "Sku Book Items" is a POS convenience page that really does appear under
//     several L2 parents, so it must NOT merge across them
const l3 = (name, qty, net) => ({ l3: name, qty, netSales: net });
const FOOD_L3 = [
  l3('FG BL CONSUMABLES - FOOD - SNACKS', 10, 20.00),
  l3('[Name match] FG BL CONSUMABLES - FOOD - SNACKS', 4, 8.50),
  l3('[Override] Consumable Food', 3, 6.25),
  l3('[IM 10385] Consumable Food', 2, 4.10),
  l3('[Heuristic] Consumable Food', 1, 1.15),
  l3('Sku Book Items', 5, 9.00),
];
const HOME_L3 = [
  l3('FG BL HOME - KITCHEN', 7, 30.00),
  l3('Sku Book Items', 2, 12.00),
];
const cat = (name, rows) => ({
  category: name,
  qty: rows.reduce((s, r) => s + r.qty, 0),
  netSales: Math.round(rows.reduce((s, r) => s + r.netSales, 0) * 100) / 100,
  l3Rows: rows,
});
const snapshot = { categories: [cat('Consumable Food', FOOD_L3), cat('Home', HOME_L3)], orderCount: 25 };

for (const s of FIXTURE_STORES) {
  for (const d of ALL_DATES) {
    await env.SALES_SNAPSHOTS.put(`items:${s.toLowerCase()}:${d}`, JSON.stringify(snapshot));
  }
}
// No `week-summary:` keys are seeded on purpose: this exercises the live-build
// fallback, which is the path a freshly deployed worker takes before the
// operator re-roll has run.

const call = async (qs, user = 'u-su') =>
  worker.fetch(req(`/?action=weekly-t13&${qs}`, { user }), env, ctx);

const res = await call('end=2026-06-15');
const body = JSON.parse(await res.text());
ok(res.status === 200, `200 from weekly-t13, got ${res.status} ${JSON.stringify(body).slice(0, 120)}`);

// ── the new arrays exist and are shaped { store: { L2: { L3: value } } } ────
const u = body.perStoreL3Units, n = body.perStoreL3Net;
ok(Array.isArray(u) && u.length === body.weeks.length,
   `perStoreL3Units is one entry per week (${u && u.length} vs ${body.weeks.length})`);
ok(Array.isArray(n) && n.length === body.weeks.length,
   `perStoreL3Net is one entry per week (${n && n.length} vs ${body.weeks.length})`);
ok(body.weeks.length === 2, `both fixture weeks enumerated, got ${JSON.stringify(body.weeks)}`);

const iPre = body.weeks.indexOf(WK_PRE.week), iPost = body.weeks.indexOf(WK_POST.week);
ok(iPre >= 0 && iPost >= 0, 'both fixture weeks present in the response');

const foodU = u[iPost].BL1['Consumable Food'] || {};
const foodN = n[iPost].BL1['Consumable Food'] || {};

// ── [Name match] folds into the real category ──────────────────────────────
// 2 days × (10 + 4) units and 2 × (20.00 + 8.50). If normalizeL3Key is removed
// these become 20 and 8, and the twin reappears as its own row.
ok(foodU['FG BL CONSUMABLES - FOOD - SNACKS'] === 28,
   `SNACKS units merge the [Name match] twin: expected 28, got ${foodU['FG BL CONSUMABLES - FOOD - SNACKS']}`);
ok(near(foodN['FG BL CONSUMABLES - FOOD - SNACKS'], 57.00),
   `SNACKS net merges the [Name match] twin: expected 57.00, got ${foodN['FG BL CONSUMABLES - FOOD - SNACKS']}`);
ok(!Object.keys(foodU).some(k => k.startsWith('[')),
   `no bracketed key survives: ${JSON.stringify(Object.keys(foodU))}`);
ok(!Object.keys(foodU).some(k => k.includes('Name match')),
   'no [Name match] row is emitted');

// ── the remaining brackets collapse to exactly one bucket ──────────────────
// [Override] 3 + [IM 10385] 2 + [Heuristic] 1 = 6/day -> 12 over two days.
const other = Object.keys(foodU).filter(k => k === 'Other / unmapped');
ok(other.length === 1, `exactly one Other / unmapped row, got ${other.length}`);
ok(foodU['Other / unmapped'] === 12,
   `Other / unmapped sums all three buckets: expected 12, got ${foodU['Other / unmapped']}`);
ok(near(foodN['Other / unmapped'], 23.00),
   `Other / unmapped net sums all three buckets: expected 23.00, got ${foodN['Other / unmapped']}`);

// ── the same L3 name under two L2 parents stays separate ───────────────────
const homeU = u[iPost].BL1.Home || {};
ok(foodU['Sku Book Items'] === 10 && homeU['Sku Book Items'] === 4,
   `Sku Book Items does not merge across L2 parents: food=${foodU['Sku Book Items']} home=${homeU['Sku Book Items']}`);

// ── THE INVARIANT: L3 sums to its L2, for every store/week/category ─────────
{
  let checked = 0, worst = 0, where = '';
  for (let i = 0; i < body.weeks.length; i++) {
    for (const [store, cats] of Object.entries(body.perStoreL2Units[i] || {})) {
      for (const [l2, l2qty] of Object.entries(cats)) {
        const kids = (u[i][store] || {})[l2];
        if (!kids) continue;               // pre-L3 summary: absent, not wrong
        const sum = Object.values(kids).reduce((a, b) => a + b, 0);
        checked++;
        if (Math.abs(sum - l2qty) > worst) { worst = Math.abs(sum - l2qty); where = `${store}/wk${body.weeks[i]}/${l2}`; }
      }
    }
  }
  ok(checked > 0, 'the L3-sums-to-L2 units check is non-vacuous');
  ok(worst === 0, `L3 units sum to L2 everywhere (worst ${worst} at ${where}, ${checked} checked)`);
}
{
  let checked = 0, worst = 0, where = '';
  for (let i = 0; i < body.weeks.length; i++) {
    for (const [store, cats] of Object.entries(body.perStoreL2Net[i] || {})) {
      for (const [l2, l2net] of Object.entries(cats)) {
        const kids = (n[i][store] || {})[l2];
        if (!kids) continue;
        const sum = Object.values(kids).reduce((a, b) => a + b, 0);
        checked++;
        if (Math.abs(sum - l2net) > worst) { worst = Math.abs(sum - l2net); where = `${store}/wk${body.weeks[i]}/${l2}`; }
      }
    }
  }
  ok(checked > 0, 'the L3-sums-to-L2 net check is non-vacuous');
  ok(worst < 0.005, `L3 net sums to L2 everywhere (worst ${worst.toFixed(4)} at ${where}, ${checked} checked)`);
}

// ── the BL12/BL16 cutover gate zeroes L3 too ───────────────────────────────
// Both stores share one Clover account, so a week counted for both would double
// the combined card. The L2 maps were already zeroed here; L3 must match or the
// expanded rows outlive the parent that was zeroed.
//
// Assert the key is PRESENT and empty, not merely falsy: `Object.keys(x || {})`
// cannot tell a deliberate `{}` from a key that was never written, so the
// weaker form survived deleting the zeroing lines outright (measured). Present-
// and-empty is also the shape perStoreL2 already ships for a gated store.
const gated = (arr, i, s) =>
  Object.prototype.hasOwnProperty.call(arr[i], s) && Object.keys(arr[i][s]).length === 0;
ok(gated(u, iPost, 'BL12'), `BL12 L3 is present-and-empty after the cutover, got ${JSON.stringify(u[iPost].BL12)}`);
ok(gated(n, iPost, 'BL12'), 'BL12 L3 net is present-and-empty after the cutover');
ok(gated(u, iPre, 'BL16'), `BL16 L3 is present-and-empty before the cutover, got ${JSON.stringify(u[iPre].BL16)}`);
ok(gated(n, iPre, 'BL16'), 'BL16 L3 net is present-and-empty before the cutover');
ok(Object.keys(u[iPre].BL12 || {}).length > 0, 'BL12 L3 is populated before the cutover');
ok(Object.keys(u[iPost].BL16 || {}).length > 0, 'BL16 L3 is populated after the cutover');

// ── store scoping reaches the L3 arrays ────────────────────────────────────
// u-mgr1 is granted BL1 only. A scoping bug that stops at the L2 maps would
// leak every store's category detail through the new arrays instead.
{
  const r = await call('end=2026-06-15', 'u-mgr1');
  const b = JSON.parse(await r.text());
  const seen = new Set();
  for (const wk of b.perStoreL3Units || []) for (const s of Object.keys(wk)) seen.add(s);
  ok(r.status === 200, `manager gets 200, got ${r.status}`);
  ok(seen.size > 0, 'the scoping check is non-vacuous — the manager sees at least one store');
  ok([...seen].every(s => s === 'BL1'), `BL1-only manager sees only BL1 L3, got ${[...seen].sort().join(',')}`);
}

// ── the operator rebuild writes L3, not just the cron path ─────────────────
// Two call sites write `week-summary:` values. They were separate object
// literals and drifted; adding l3 to only one would leave the very rebuild T13
// depends on writing L3-less entries. Both now go through weekSummaryPayload.
{
  const r = await worker.fetch(
    req('/?action=rebuild-week-summaries&year=2026&weeks=2', { user: 'u-su', method: 'POST' }), env, ctx);
  const b = JSON.parse(await r.text());
  ok(r.status === 200 && b.ok, `rebuild-week-summaries succeeds, got ${r.status} ${JSON.stringify(b).slice(0, 140)}`);
  ok(b.written > 0, `rebuild wrote something, got ${b.written}`);

  const stored = await env.SALES_SNAPSHOTS.get('week-summary:bl1:25-2026', 'json');
  ok(!!stored, 'rebuild wrote week-summary:bl1:25-2026');
  ok(stored && stored.l3Qty && Object.keys(stored.l3Qty).length > 0,
     `the rebuilt summary carries l3Qty, got ${JSON.stringify(stored && stored.l3Qty)}`);
  ok(stored && stored.l3Net && Object.keys(stored.l3Net).length > 0, 'the rebuilt summary carries l3Net');
  ok(stored && stored.l3Qty['Consumable Food'] &&
     stored.l3Qty['Consumable Food']['FG BL CONSUMABLES - FOOD - SNACKS'] === 28,
     'the rebuilt summary is normalized the same way the live build is');

  // A re-inlined payload literal would drift again. buildStoreWeekly's return
  // and weekSummaryPayload are the only two places allowed to name these keys.
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const producers = (src.match(/^\s*l2Qty:/gm) || []).length;
  ok(producers === 2,
     `exactly 2 sites name l2Qty (buildStoreWeekly + weekSummaryPayload), found ${producers} — a third means a payload literal was re-inlined`);

  // 🔑 The rebuild must cover WRS_STORES, not ALL_STORES. Closed Wyoming (BL12)
  // is the LIVE store for every week before the cutover, and T13 charts it. If
  // the rebuild skips it, BL12 keeps an L3-less summary while its L2 numbers are
  // still charted — so the combined card's L3 rows stop summing to their parent
  // for those weeks, which is exactly the invariant this suite exists to hold.
  const bl12 = await env.SALES_SNAPSHOTS.get('week-summary:bl12:24-2026', 'json');
  ok(!!bl12, 'the rebuild writes BL12 (closed Wyoming) — it is live pre-cutover and T13 charts it');
  ok(bl12 && bl12.l3Qty && Object.keys(bl12.l3Qty).length > 0,
     `BL12's rebuilt summary carries l3Qty, got ${JSON.stringify(bl12 && bl12.l3Qty)}`);
  ok(b.written === b.weeks * 7 || b.written % 7 === 0,
     `every store is written each week (7 per week), got ${b.written} over ${b.weeks} weeks`);
}

// ── a pre-cutover week keeps L3 == L2 once BL12 has a stored summary ────────
// The live-build fallback masked the gap above: with no stored summary, BL12
// built fresh and had L3. This re-reads AFTER the rebuild, which is the state
// production is actually in.
{
  const r = await call('end=2026-06-15');
  const b = JSON.parse(await r.text());
  const i = b.weeks.indexOf(WK_PRE.week);
  const l2 = (b.perStoreL2Units[i] || {}).BL12 || {};
  const l3 = (b.perStoreL3Units[i] || {}).BL12 || {};
  ok(Object.keys(l2).length > 0, 'BL12 has L2 numbers in a pre-cutover week (the check is non-vacuous)');
  let worst = 0;
  for (const [cat, v] of Object.entries(l2)) {
    const kids = l3[cat];
    if (!kids) { worst = Math.max(worst, v); continue; }
    worst = Math.max(worst, Math.abs(Object.values(kids).reduce((a, c) => a + c, 0) - v));
  }
  ok(worst === 0, `BL12 L3 still sums to L2 after the rebuild (worst ${worst})`);
}

// ── a summary stored before L3 shipped degrades to empty, not to a 500 ──────
{
  await env.SALES_SNAPSHOTS.put('week-summary:bl2:25-2026', JSON.stringify({
    store: 'BL2', week: '25', year: 2026, dates: WK_POST.dates,
    totals: { netSales: 100, qty: 10, transactions: 5, asp: 10, laborPct: 0, budget: 120 },
    l2Qty: { 'Consumable Food': 10 }, l2Net: { 'Consumable Food': 100 },
  }));
  const r = await call('end=2026-06-15');
  const b = JSON.parse(await r.text());
  ok(r.status === 200, `a legacy L3-less summary still returns 200, got ${r.status}`);
  const i = b.weeks.indexOf(WK_POST.week);
  ok(Object.keys((b.perStoreL3Units[i] || {}).BL2 || {}).length === 0,
     'a legacy summary yields an empty L3 map rather than throwing');
  ok((b.perStoreL2Units[i] || {}).BL2['Consumable Food'] === 10,
     'the legacy summary still contributes its L2 numbers');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
