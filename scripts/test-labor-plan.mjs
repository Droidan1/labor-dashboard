// ?action=labor-plan — the recommendation engine.
//
// Driven through worker.fetch(). Seeded with PRODUCTION figures read from the
// Weekly Labor and Sales sheet on 2026-08-14, so the expectations below are
// the numbers Brian signed off in tasks/labor-page.md, derived independently
// of this implementation (recommended = budget hours x projected/budget).
//
// One row per week, dated on the Saturday that ends it — the handler folds
// daily rows into weeks, and a week of one day sums the same as a week of
// seven. Keeps the fixture readable and the arithmetic identical.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req, storesIn } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const worker = await loadWorker(repo);
const WEEK = '2026-08-22';           // the Saturday being planned
const TRAIL = ['2026-07-11', '2026-07-18', '2026-07-25', '2026-08-01'];

// store: [ [budgetSales, actualSales, actualHours] x4 ], budgetWeek [sales, colJ hours]
const PROD = {
  BL1:  { t: [[70259, 64699, 644], [70292, 73860, 727], [70638, 71911, 729], [71939, 73255, 689.5331]], b: [72747, 679] },
  BL2:  { t: [[36924, 33168, 366], [36994, 36627, 365], [37155, 35798, 373], [37843, 34055, 375]],      b: [38057, 355] },
  BL4:  { t: [[29457, 24149, 292], [29484, 25793, 272], [29615, 28300, 233], [27405, 27411, 209]],      b: [27662, 258] },
  BL14: { t: [[33722, 32897, 408], [33775, 43345, 463], [33927, 38837, 452], [32663, 39051, 377]],      b: [32905, 307] },
  // Indy East opened 2026-07-26. Its first three trailing weeks logged hours
  // against no sales at all — 1,268 of them — which is why it must not trend.
  BL16: { t: [[30037, 0, 397], [30100, 0, 404], [30219, 0, 467], [32581, 29926, 305]],                  b: [32704, 305.237] },
};

function seed(db, spec = PROD) {
  const ins = db.prepare(`INSERT INTO daily_sales
    (store,date,budget,total,budget_labor_hours,labor_hours,snapshot_time)
    VALUES (?,?,?,?,?,?, '2026-08-14T03:55:00Z')`);
  for (const [store, s] of Object.entries(spec)) {
    s.t.forEach(([bs, as, ah], i) => ins.run(store, TRAIL[i], bs, as, 0, ah || null));
    ins.run(store, WEEK, s.b[0], 0, s.b[1], null);
  }
}
async function plan(env, qs = `week=${WEEK}`, user = 'u-su') {
  const res = await worker.fetch(req('/?action=labor-plan&' + qs, { user }), env, ctx);
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text), text };
}

// ══ 1. The four trended stores, pinned to the plan ═══════════════════════
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales'); seed(db);
  const { status, body } = await plan(env);
  eq(status, 200, 'a superuser gets 200');
  eq(body.asmHours, 40, 'the response states the ASM allocation it applied');
  eq(JSON.stringify(body.weights), '[10,20,30,40]', 'and the weights');

  const expect = {
    BL1:  { bh: 719, bp: 14.83, wv: 1.50,  rec: 730, tr: 721, d: 9 },
    BL2:  { bh: 395, bp: 15.57, wv: -6.32, rec: 370, tr: 379, d: -9 },
    BL4:  { bh: 298, bp: 16.16, wv: -5.63, rec: 281, tr: 231, d: 50 },
    BL14: { bh: 347, bp: 15.82, wv: 17.59, rec: 408, tr: 415, d: -7 },
  };
  for (const [s, e] of Object.entries(expect)) {
    const p = body.byStore[s];
    eq(p.basis, 'trend', `${s} trends`);
    eq(p.budgetHours, e.bh, `${s} budget hours are col J + 40 ASM`);
    eq(p.budgetLaborPct, e.bp, `${s} budget labour %`);
    eq(p.weightedVariancePct, e.wv, `${s} weighted sales variance`);
    eq(p.recommendedHours, e.rec, `${s} RECOMMENDED hours`);
    eq(p.trendingHours, e.tr, `${s} TRENDING hours`);
    eq(p.deltaHours, e.d, `${s} delta`);
    eq(p.weeksUsed.length, 4, `${s} names the four weeks it used`);
    eq(p.weeksUsed[3].weekEnd, '2026-08-01', `${s} newest week last`);
    eq(p.weeksUsed[3].weight, 40, '…carrying the 40% weight');
  }
  eq(body.byStore.BL1.projectedSales > 73835 && body.byStore.BL1.projectedSales < 73836,
     true, 'Coliseum projected sales land on $73,835.xx');
}

// ══ 2. 🛑 The ASM is really applied ══════════════════════════════════════
// Without it every store's budget labour % collapses to a flat 14.00% — the
// sheet's chain target — and the chain recommendation drops to 1,626. A test
// that pins 14.00% here is testing the allocation having gone MISSING.
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales'); seed(db);
  const { body } = await plan(env);
  for (const s of ['BL1', 'BL2', 'BL4', 'BL14']) {
    ok(body.byStore[s].budgetLaborPct > 14.5,
       `${s} budget labour % is above 14.00% — the ASM is in`);
  }
  eq(body.chain.recommendedHours, 1789, 'chain recommended is 1,789, not the 1,626 an ASM-less run gives');
}

// ══ 3. Chain covers only the stores that could be trended ════════════════
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales'); seed(db);
  const { body } = await plan(env);
  eq(body.chain.storesTrended, 4, 'four of the five stores trended');
  eq(body.chain.recommendedHours, 1789, 'chain recommended');
  eq(body.chain.trendingHours, 1746, 'chain trending');
  eq(body.chain.deltaHours, 43, 'chain delta');
  // Indy East's 345 must NOT be folded in — a budget quote is not a pace.
  ok(body.chain.recommendedHours < 1789 + 345, 'Indy East is not added to the chain line');
}

// ══ 4. Indy East falls back to budget-only, and says why ═════════════════
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales'); seed(db);
  const p = (await plan(env)).body.byStore.BL16;
  eq(p.basis, 'budget-only', 'Indy East does not trend');
  eq(p.recommendedHours, 345, 'it quotes col J + ASM, rounded');
  eq(p.trendingHours, null, 'with no trending figure');
  eq(p.deltaHours, null, 'and no delta');
  eq(p.projectedSales, null, 'and no projection');
  ok(/1 of 4/.test(p.reason), `the reason names the shortfall — got "${p.reason}"`);
  eq(p.weeksUsed.length, 1, 'only its one usable week is listed');
}

// ══ 5. A zero-sales week mid-window is skipped, not trended on ═══════════
// Holland's shape: sales stop, hours keep being logged. Trending across it
// produces a 66-hour recommendation. Four good weeks sit behind the gap.
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales');
  const ins = db.prepare(`INSERT INTO daily_sales
    (store,date,budget,total,budget_labor_hours,labor_hours,snapshot_time)
    VALUES (?,?,?,?,?,?, '2026-08-14T03:55:00Z')`);
  // Four healthy weeks, then two dark ones nearer the forecast.
  [['2026-06-13', 70000, 70000, 650], ['2026-06-20', 70000, 70000, 650],
   ['2026-06-27', 70000, 70000, 650], ['2026-07-04', 70000, 70000, 650],
   ['2026-07-11', 70000, 0, 300], ['2026-07-18', 70000, 0, 300],
  ].forEach(([d, bs, as, ah]) => ins.run('BL1', d, bs, as, 0, ah));
  ins.run('BL1', WEEK, 70000, 0, 650, null);

  const p = (await plan(env)).body.byStore.BL1;
  eq(p.basis, 'trend', 'it still trends — four good weeks exist behind the gap');
  eq(p.weeksUsed.length, 4, 'on four weeks');
  ok(!p.weeksUsed.some(w => w.weekEnd === '2026-07-11' || w.weekEnd === '2026-07-18'),
     'and the dark weeks are NOT among them');
  eq(p.weeksUsed[3].weekEnd, '2026-07-04', 'the newest usable week is the last good one');
  ok(p.recommendedHours > 600, `a sane recommendation, not 66 — got ${p.recommendedHours}`);
}

// ══ 6. A part-entered week is not usable ════════════════════════════════
// Some days with hours, some without, sums to a partial figure that looks
// entirely plausible and drags the trend down.
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales');
  const ins = db.prepare(`INSERT INTO daily_sales
    (store,date,budget,total,budget_labor_hours,labor_hours,snapshot_time)
    VALUES (?,?,?,?,?,?, '2026-08-14T03:55:00Z')`);
  ['2026-06-13', '2026-06-20', '2026-06-27', '2026-07-04'].forEach(d =>
    ins.run('BL1', d, 70000, 70000, 0, 650));
  // Week ending 07-11: Monday entered, Tuesday sold with no hours.
  ins.run('BL1', '2026-07-06', 10000, 10000, 0, 90);
  ins.run('BL1', '2026-07-07', 10000, 10000, 0, null);
  ins.run('BL1', WEEK, 70000, 0, 650, null);

  const p = (await plan(env)).body.byStore.BL1;
  ok(!p.weeksUsed.some(w => w.weekEnd === '2026-07-11'),
     'the half-entered week is excluded from the trend');
  eq(p.weeksUsed.length, 4, 'and the four complete ones are used instead');
}

// ══ 7. Scoping — BL2 is seeded, a BL1 manager must never see it ══════════
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales'); seed(db);
  const su = await plan(env, `week=${WEEK}`, 'u-su');
  ok(storesIn(su.text).includes('BL2'), 'precondition: a superuser sees BL2');

  const mgr = await plan(env, `week=${WEEK}`, 'u-mgr1');
  eq(mgr.status, 200, 'a BL1 manager gets 200, not 403');
  eq(JSON.stringify(mgr.body.stores), '["BL1"]', 'scoped to their store');
  ok(!storesIn(mgr.text).includes('BL2'), 'BL2 appears nowhere in their response');
  eq(mgr.body.byStore.BL1.recommendedHours, 730, 'their own figure is intact');
  eq(mgr.body.chain.storesTrended, 1, 'and the chain line covers just them');

  const denied = await plan(env, `week=${WEEK}&store=BL4`, 'u-mgr1');
  eq(denied.status, 403, 'naming another store is refused');
}

// ══ 8. Holland is off this page ═════════════════════════════════════════
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales');
  seed(db, { ...PROD, BL8: PROD.BL1 });
  const { body, text } = await plan(env);
  ok(!body.stores.includes('BL8'), 'BL8 is not in the store list');
  ok(!storesIn(text).includes('BL8'), 'and reaches no total');
}

// ══ 9. `week` must be a Saturday ════════════════════════════════════════
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales'); seed(db);
  eq((await plan(env, 'week=2026-08-20')).status, 400, 'a Thursday is refused');
  eq((await plan(env, 'week=nope')).status, 400, 'garbage is refused');
  eq((await plan(env, '')).status, 400, 'a missing week is refused');
  eq((await plan(env, 'week=2026-04-31')).status, 400, 'and an impossible date is refused');
}

// ══ 10. manual-override honours markOverride:false ══════════════════════
// 🔑 The Labor hours grid writes with markOverride:false. is_manual_override
// freezes the ENTIRE row against the sheet import — not just the column being
// written — so stamping it on an hours save would silently freeze that
// store-day's BUDGET too, and nobody would notice for weeks.
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales');
  const post = (body) => worker.fetch(req('/?action=manual-override', { user:'u-su', method:'POST', body }), env, ctx);
  const row = () => db.prepare('SELECT * FROM daily_sales WHERE store=? AND date=?').all('BL1','2026-08-05')[0];

  // Default behaviour is unchanged for every existing caller.
  await post({ entries: [{ store:'BL1', date:'2026-08-05', labor_hours: 41 }] });
  eq(row().labor_hours, 41, 'a default write lands');
  eq(row().is_manual_override, 1, 'and still claims the row, as every other caller expects');

  db.exec('DELETE FROM daily_sales');
  await post({ markOverride: false, entries: [{ store:'BL1', date:'2026-08-05', labor_hours: 41 }] });
  eq(row().labor_hours, 41, 'a grid write lands too');
  eq(row().is_manual_override, 0, 'but does NOT claim the row — the sheet keeps feeding budget and sales');

  // …and never CLEARS a flag somebody set deliberately.
  db.exec('DELETE FROM daily_sales');
  db.prepare(`INSERT INTO daily_sales (store,date,total,is_manual_override) VALUES ('BL1','2026-08-05',5000,1)`).run();
  await post({ markOverride: false, entries: [{ store:'BL1', date:'2026-08-05', labor_hours: 47.25 }] });
  eq(row().is_manual_override, 1, 'an existing override survives a grid write');
  eq(row().labor_hours, 47.25, 'while the hours still update');
  eq(row().total, 5000, 'and the protected sales figure is untouched');
}

// ══ 11. Who may actually WRITE hours ════════════════════════════════════
// 🛑 requireAdminAccess treats any non-GET as mutating and demands SUPERUSER,
// not admin. The Hours tab must therefore be superuser-only on the client too,
// or an admin sees a grid they can fill in and cannot save. Pinned here so the
// client gate and the server gate cannot drift apart silently.
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales');
  const post = (user) => worker.fetch(req('/?action=manual-override', {
    user, method: 'POST',
    body: { markOverride: false, entries: [{ store: 'BL1', date: '2026-08-05', labor_hours: 41 }] },
  }), env, ctx);

  eq((await post('u-su')).status, 200, 'a superuser may write hours');
  const admin = await post('u-admin');
  eq(admin.status, 403, 'an ADMIN may not — this is the real boundary');
  eq((await admin.json()).code, 'NEED_SUPERUSER', 'and says so');
  eq((await post('u-mgr1')).status, 403, 'nor a manager');
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
