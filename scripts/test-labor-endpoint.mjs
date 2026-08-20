// ?action=labor — the Labor page's Budget-vs-Actual feed.
//
// Driven through worker.fetch() with real Request objects. The thing most
// worth testing here is not the arithmetic, it is the WIRING: that the handler
// actually consults allowedStores(), that Holland stays out, and that a
// part-entered period refuses to report a labour %. Every scoping case below
// seeds data for a store the caller must NOT see, so a broken scope shows up
// as that store's code appearing in the body rather than as a silent pass.
//
// 🔑 Labour % is COMPUTED from hours x $15.00. daily_sales.labor_pct is
// deliberately ignored — it holds whatever rate the source sheet hardcoded
// ($14.40 on some tabs, $15.00 on others). One case seeds a nonsense 0.99 in
// that column and pins that it never reaches the wire.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req, storesIn } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const worker = await loadWorker(repo);

// Week ending Sat 2026-08-01 runs Sun 07-26 → Sat 08-01.
const SEED = [
  // store, date,       budget, total, budget_hours, hours, labor_pct
  ['BL1', '2026-07-30', 6000, 8000, 100, 120, 0.99],
  ['BL1', '2026-07-31', 14000, 15000, 110, 100, 0.99],
  ['BL1', '2026-08-01', 13000, 14000, 60, 50, 0.99],
];
function seed(db, rows = SEED) {
  const ins = db.prepare(`INSERT INTO daily_sales
    (store,date,budget,total,budget_labor_hours,labor_hours,labor_pct,snapshot_time)
    VALUES (?,?,?,?,?,?,?, '2026-08-14T03:55:00Z')`);
  for (const r of rows) ins.run(...r);
}
async function get(env, qs, user = 'u-su') {
  const res = await worker.fetch(req('/?action=labor&' + qs, { user }), env, ctx);
  return { status: res.status, body: await res.json(), text: JSON.stringify(await Promise.resolve(null)) };
}
async function raw(env, qs, user = 'u-su') {
  const res = await worker.fetch(req('/?action=labor&' + qs, { user }), env, ctx);
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text), text };
}

// ══ 1. Weekly rollup, and the rate is applied here not read from the row ═══
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales'); seed(db);
  const { status, body } = await raw(env, 'grain=w&from=2026-07-26&to=2026-08-01');

  eq(status, 200, 'a superuser gets 200');
  eq(body.rate, 15, 'the response states the rate it used');
  eq(body.periods.length, 1, 'the three days collapse into one week');

  const p = body.periods[0];
  eq(p.key, '2026-08-01', 'the week is keyed by the SATURDAY that ends it');
  eq(p.budgetSales, 33000, 'budget sales sum');
  eq(p.actualSales, 37000, 'actual sales sum');
  eq(p.budgetHours, 270, 'budget hours sum');
  eq(p.actualHours, 270, 'actual hours sum');
  // 270 x 15 / 33000 and / 37000. The seeded labor_pct is 0.99 on every row;
  // if the column were read instead this would come back as 99 or 0.99.
  eq(p.budgetLaborPct, 12.2727, 'budget labour % is computed at $15.00/hr');
  eq(p.actualLaborPct, 10.9459, 'actual labour % is computed at $15.00/hr, NOT read from labor_pct');
  eq(p.complete, true, 'a fully-entered week is complete');
  eq(p.hoursMissingDays, 0, 'with no missing days');
}

// ══ 2. A selling day with no hours withholds the % for the whole period ═══
// The live shape: hours entry stopped 2026-08-04 while sales kept arriving.
// 57 chain hours against $43k reads as 2%, which looks like a record week.
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales');
  seed(db, [...SEED, ['BL1', '2026-07-29', 5000, 9000, 90, null, null]]);
  const { body } = await raw(env, 'grain=w&from=2026-07-26&to=2026-08-01');
  const p = body.periods[0];

  eq(p.actualLaborPct, null, 'the labour % is WITHHELD, not computed on partial hours');
  eq(p.complete, false, 'and the period is flagged incomplete');
  eq(p.hoursMissingDays, 1, 'naming how many selling days lack hours');
  eq(p.actualSales, 46000, 'while the sales still total — the day happened');
  ok(p.budgetLaborPct !== null, 'the BUDGET % is unaffected — it needs no actuals');
}

// ══ 3. A day with no sales AND no hours is not "missing" ══════════════════
// Closed days, and future budget rows, must not poison a week.
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales');
  seed(db, [...SEED, ['BL1', '2026-07-28', 4000, 0, 80, null, null]]);
  const { body } = await raw(env, 'grain=w&from=2026-07-26&to=2026-08-01');
  const p = body.periods[0];
  eq(p.hoursMissingDays, 0, 'a zero-sales day does not count as missing hours');
  eq(p.complete, true, 'so the week stays complete');
}

// ══ 4. Store scoping — the wiring assertion ══════════════════════════════
// BL2 IS seeded. A manager scoped to BL1 asking for everything must not see it.
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales');
  seed(db, [...SEED, ['BL2', '2026-07-31', 9999, 8888, 77, 66, 0.5]]);

  const su = await raw(env, 'grain=w&from=2026-07-26&to=2026-08-01', 'u-su');
  ok(su.body.stores.includes('BL2'), 'precondition: a superuser DOES see BL2');
  ok(storesIn(su.text).includes('BL2'), 'and BL2 appears in the superuser body');

  const mgr = await raw(env, 'grain=w&from=2026-07-26&to=2026-08-01', 'u-mgr1');
  eq(mgr.status, 200, 'a BL1 manager asking for the chain gets 200, not 403');
  eq(JSON.stringify(mgr.body.stores), '["BL1"]', 'scoped to their own store');
  ok(!storesIn(mgr.text).includes('BL2'), 'and BL2 appears NOWHERE in their response');
  eq(mgr.body.periods[0].actualSales, 37000, "…while their own store's figures are intact");
}

// ══ 5. Holland is off this page entirely ═════════════════════════════════
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales');
  seed(db, [...SEED, ['BL8', '2026-07-31', 5000, 6000, 50, 40, 0.2]]);
  const { body, text } = await raw(env, 'grain=w&from=2026-07-26&to=2026-08-01', 'u-su');
  ok(!body.stores.includes('BL8'), 'BL8 is not in the store list, even for a superuser');
  ok(!storesIn(text).includes('BL8'), 'and its seeded row reaches no total');
  eq(body.periods[0].actualSales, 37000, 'the chain total excludes it');
}

// ══ 6. An explicit out-of-scope store is refused, not silently widened ════
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales'); seed(db);
  const r1 = await raw(env, 'grain=w&from=2026-07-26&to=2026-08-01&store=BL2', 'u-mgr1');
  eq(r1.status, 403, 'a BL1 manager naming BL2 gets 403');
  eq(r1.body.code, 'STORE_NOT_ALLOWED', 'with a specific code');

  const r2 = await raw(env, 'grain=w&from=2026-07-26&to=2026-08-01&store=BL8', 'u-su');
  eq(r2.status, 403, 'even a superuser cannot name Holland — it is off the page');

  const r3 = await raw(env, 'grain=w&from=2026-07-26&to=2026-08-01&store=BL1', 'u-mgr1');
  eq(r3.status, 200, 'naming their OWN store is fine');
  eq(JSON.stringify(r3.body.stores), '["BL1"]', 'and returns just it');
}

// ══ 7. Grains bucket differently ═════════════════════════════════════════
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales'); seed(db);

  const d = await raw(env, 'grain=d&from=2026-07-26&to=2026-08-01');
  eq(d.body.periods.length, 3, 'daily gives one period per seeded day');
  eq(d.body.periods[0].key, '2026-07-30', 'keyed by the date, oldest first');

  const m = await raw(env, 'grain=m&from=2026-07-01&to=2026-08-31');
  eq(m.body.periods.length, 2, 'monthly splits July from August');
  eq(m.body.periods[0].key, '2026-07', 'keyed YYYY-MM');
  eq(m.body.periods[1].actualSales, 14000, 'and August holds only the 08-01 row');
}

// ══ 8. Per-store breakdown rides along ═══════════════════════════════════
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales');
  seed(db, [...SEED, ['BL2', '2026-07-31', 10000, 12000, 100, 90, 0.5]]);
  const { body } = await raw(env, 'grain=w&from=2026-07-26&to=2026-08-01');
  const p = body.periods[0];
  eq(p.byStore.BL1.actualSales, 37000, 'BL1 keeps its own total');
  eq(p.byStore.BL2.actualSales, 12000, 'BL2 keeps its own');
  eq(p.actualSales, 49000, 'and the period total is their sum');
  eq(p.byStore.BL2.actualLaborPct, 11.25, 'each store carries its own labour % at $15');
}

// ══ 9. Impossible dates are rejected and COUNTED, never folded into a week ═
// 🛑 daily_sales really holds six rows dated 2026-04-31 carrying $45,685, and
// `new Date("2026-04-31")` rolls silently to May 1. Without the round-trip
// check in laborBucketKey those rows would inflate a legitimate week.
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales');
  seed(db, [
    ['BL1', '2026-04-30', 1000, 2000, 10, 10, null],
    ['BL1', '2026-04-31', 7777, 8888, 99, 99, null],
  ]);
  const { body } = await raw(env, 'grain=w&from=2026-04-25&to=2026-05-09');
  eq(body.invalidDateRows, 1, 'the impossible date is counted, not swallowed');
  const all = body.periods.reduce((a, p) => a + p.actualSales, 0);
  eq(all, 2000, 'and its $8,888 reaches no period');
  // Apr 30 2026 is a Thursday, so the VALID row legitimately lands in the week
  // ending Sat May 2 — which is exactly the week `new Date("2026-04-31")` would
  // have rolled into. Pinning that week's total is the precise statement of the
  // bug: it must hold the real row and only the real row.
  const may2 = body.periods.find(p => p.key === '2026-05-02');
  ok(may2 != null, 'the week ending May 2 exists — Apr 30 is a Thursday');
  eq(may2.actualSales, 2000, 'and holds ONLY the real Apr 30 row, not the rolled-forward one');
}

// ══ 10. Input validation ═════════════════════════════════════════════════
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales'); seed(db);
  eq((await raw(env, 'grain=x&from=2026-07-26&to=2026-08-01')).status, 400, 'a bad grain is 400');
  eq((await raw(env, 'grain=w&from=nope&to=2026-08-01')).status, 400, 'a bad from is 400');
  eq((await raw(env, 'grain=w&from=2026-07-26')).status, 400, 'a missing to is 400');

  // Reversed range is corrected rather than refused — the picker can send either.
  const r = await raw(env, 'grain=w&from=2026-08-01&to=2026-07-26');
  eq(r.status, 200, 'a reversed range is accepted');
  eq(r.body.from, '2026-07-26', 'and normalised');
}

// ══ 11. Default grain is weekly ══════════════════════════════════════════
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales'); seed(db);
  const { body } = await raw(env, 'from=2026-07-26&to=2026-08-01');
  eq(body.grain, 'w', 'omitting grain gives weekly — how the sheet is read today');
  eq(body.periods.length, 1, 'and it really did bucket weekly');
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
