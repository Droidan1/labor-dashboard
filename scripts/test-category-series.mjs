/**
 * ?action=category-series — the per-DATE category breakdown behind the
 * Retail Summary → Categories card.
 *
 * weekly-t13 is per WEEK, so it cannot feed a chart whose x-axis runs inside
 * the period. This endpoint returns the same L2/L3 numbers per day. What is
 * worth pinning is not "does it return numbers" but the four ways a per-date
 * endpoint quietly lies: an absent day rendered as a zero, the shared
 * BL12/BL16 account counted twice, a store the caller may not see leaking
 * through, and a range so wide it half-answers.
 */
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

// WRS_CUTOVER is 2026-06-14. Straddle it so the BL12/BL16 gate is exercised.
const PRE  = ['2026-06-08', '2026-06-09', '2026-06-10'];
const POST = ['2026-06-15', '2026-06-16', '2026-06-17'];
const ALL_DATES = [...PRE, ...POST];
const STORES = ['BL1', 'BL4', 'BL12', 'BL16'];

const l3 = (name, qty, net) => ({ l3: name, qty, netSales: net });
const cat = (name, rows) => ({
  category: name,
  qty: rows.reduce((s, r) => s + r.qty, 0),
  netSales: Math.round(rows.reduce((s, r) => s + r.netSales, 0) * 100) / 100,
  l3Rows: rows,
});
// Distinct per-day values, so a day collapsing into another is visible.
const snapFor = (dayIdx) => ({
  categories: [
    cat('Consumable Food', [
      l3('FG BL CONSUMABLES - FOOD - SNACKS', 10 + dayIdx, 20 + dayIdx),
      l3('FG BL CONSUMABLES - FOOD - CANDY', 5, 11.50),
    ]),
    cat('Home', [l3('FG BL HOME - KITCHEN', 3, 33.33)]),
  ],
  orderCount: 25,
});

db.prepare('DELETE FROM daily_sales').run();
const ins = db.prepare(
  'INSERT INTO daily_sales (store,date,week,total,retail,bin,auction,order_count,budget,labor_pct) VALUES (?,?,?,?,?,?,?,?,?,?)');
for (const s of STORES) for (const d of ALL_DATES) ins.run(s, d, '24', 500, 400, 100, 0, 25, 600, 12);

for (const s of STORES) {
  for (let i = 0; i < ALL_DATES.length; i++) {
    // 2026-06-09 is deliberately MISSING for BL1 — an absent snapshot must
    // stay absent rather than becoming a zero-sales day.
    if (s === 'BL1' && ALL_DATES[i] === '2026-06-09') continue;
    await env.SALES_SNAPSHOTS.put(`items:${s.toLowerCase()}:${ALL_DATES[i]}`, JSON.stringify(snapFor(i)));
  }
}

const call = async (qs, user = 'u-su') =>
  worker.fetch(req(`/?action=category-series&${qs}`, { user }), env, ctx);
const body = async (r) => JSON.parse(await r.text());

/* ── 1. It answers, and it answers per DAY ─────────────────────────── */
{
  const r = await call('from=2026-06-08&to=2026-06-10');
  const b = await body(r);
  ok(r.status === 200, `200 from category-series, got ${r.status} ${JSON.stringify(b).slice(0, 140)}`);
  ok(Array.isArray(b.dates) && b.dates.length === 3, `three dates enumerated, got ${b.dates && b.dates.length}`);

  const bl4 = b.l2 && b.l2.BL4;
  ok(!!bl4, 'BL4 has an l2 map');
  ok(Object.keys(bl4 || {}).length === 3, `BL4 has one entry per DAY, got ${Object.keys(bl4 || {}).length}`);
  // Day 0 snacks 20.00 + candy 11.50 = 31.50; day 1 = 21 + 11.50 = 32.50.
  ok(near((bl4['2026-06-08'] || {})['Consumable Food'][0], 31.50),
     `day 0 Consumable Food net is its own day's value, got ${(bl4['2026-06-08'] || {})['Consumable Food']}`);
  ok(near((bl4['2026-06-09'] || {})['Consumable Food'][0], 32.50),
     `day 1 differs from day 0 — days are not collapsed, got ${(bl4['2026-06-09'] || {})['Consumable Food']}`);
  ok((bl4['2026-06-08'] || {})['Consumable Food'][1] === 15,
     `qty rides alongside net, got ${(bl4['2026-06-08'] || {})['Consumable Food'][1]}`);
}

/* ── 2. A missing snapshot is ABSENT, never a zero ─────────────────── */
{
  const b = await body(await call('from=2026-06-08&to=2026-06-10'));
  const bl1 = b.l2.BL1 || {};
  ok(!('2026-06-09' in bl1),
     'a date with no snapshot is omitted, not returned as zero sales');
  ok('2026-06-08' in bl1 && '2026-06-10' in bl1,
     'and its neighbours are still present');
}

/* ── 3. L3 only when asked, nested under its parent ────────────────── */
{
  const b2 = await body(await call('from=2026-06-08&to=2026-06-10'));
  ok(b2.l3 === undefined, 'l3 is omitted unless level=l3, so the default payload stays small');

  const b3 = await body(await call('from=2026-06-08&to=2026-06-10&level=l3'));
  const day = ((b3.l3 || {}).BL4 || {})['2026-06-08'] || {};
  ok(!!day['Consumable Food'], 'L3 is nested under its L2 parent, never flat');
  const kids = day['Consumable Food'] || {};
  // normalizeL3Key leaves a real Clover name alone.
  ok(near((kids['FG BL CONSUMABLES - FOOD - SNACKS'] || [0])[0], 20),
     `L3 net survives, got ${JSON.stringify(kids).slice(0, 120)}`);
  // The invariant the whole feature rests on (worker.js:2734).
  const l2net = b3.l2.BL4['2026-06-08']['Consumable Food'][0];
  const l3sum = Object.values(kids).reduce((s, v) => s + v[0], 0);
  ok(near(l2net, l3sum), `L3 sums to its L2 to the cent: ${l3sum} vs ${l2net}`);
}

/* ── 4. BL12/BL16 share a Clover account — gate or double-count ────── */
{
  const b = await body(await call('from=2026-06-08&to=2026-06-17'));
  const bl12 = Object.keys(b.l2.BL12 || {});
  const bl16 = Object.keys(b.l2.BL16 || {});
  ok(bl12.length > 0 && bl12.every(d => d < '2026-06-14'),
     `BL12 keeps only pre-cutover dates, got [${bl12.join(', ')}]`);
  ok(bl16.length > 0 && bl16.every(d => d >= '2026-06-14'),
     `BL16 keeps only post-cutover dates, got [${bl16.join(', ')}]`);
  const overlap = bl12.filter(d => bl16.includes(d));
  ok(overlap.length === 0, `no date is claimed by both halves of the shared account [${overlap.join(', ')}]`);
}

/* ── 5. Store scoping — a manager sees only their own ──────────────── */
{
  const b = await body(await call('from=2026-06-08&to=2026-06-10', 'u-mgr1'));   // BL1 only
  ok(Array.isArray(b.stores) && b.stores.length === 1 && b.stores[0] === 'BL1',
     `a BL1-only manager gets BL1 alone, got [${(b.stores || []).join(', ')}]`);
  ok(!b.l2.BL4, 'and no store they cannot see leaks into the payload');

  const r = await call('from=2026-06-08&to=2026-06-10&store=BL4', 'u-mgr1');
  const nb = await body(r);
  ok(r.status === 403 && nb.code === 'NO_STORES',
     `asking for a store outside the grant is refused, got ${r.status} ${nb.code}`);
}

/* ── 6. Too wide is REFUSED, not silently half-answered ────────────── */
{
  const r = await call('from=2024-01-01&to=2026-06-10');
  const b = await body(r);
  ok(r.status === 413 && b.code === 'BUDGET_EXCEEDED',
     `a range past the subrequest budget is refused, got ${r.status} ${b.code}`);
  ok(typeof b.storeDays === 'number' && typeof b.limit === 'number' && b.storeDays > b.limit,
     `and it says by how much: ${b.storeDays} store-days against a limit of ${b.limit}`);
  ok(/store=/.test(b.hint || ''), 'and how to get an answer anyway');

  // One store must succeed over a window that all-stores would refuse.
  const wide = await call('from=2026-01-01&to=2026-06-10&store=BL4');
  ok(wide.status === 200, `the same window scoped to one store is affordable, got ${wide.status}`);
}

/* ── 7. Bad input dies at validation ───────────────────────────────── */
{
  for (const [qs, why] of [
    ['from=2026-06-08', 'missing to'],
    ['to=2026-06-08', 'missing from'],
    ['from=nonsense&to=2026-06-10', 'unparseable from'],
    ['from=2026-06-10&to=2026-06-08', 'to before from'],
  ]) {
    const r = await call(qs);
    ok(r.status === 400, `${why} is a 400, got ${r.status}`);
  }
}

/* ── 8. The gates above it still apply ─────────────────────────────── */
{
  const r = await call('from=2026-06-08&to=2026-06-10', 'u-staff');
  ok(r.status === 403, `a non-financial role is refused, got ${r.status}`);

  const anon = await worker.fetch(
    new Request('https://api.retjghub.com/?action=category-series&from=2026-06-08&to=2026-06-10'), env, ctx);
  ok(anon.status === 401, `no session is a 401, got ${anon.status}`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
