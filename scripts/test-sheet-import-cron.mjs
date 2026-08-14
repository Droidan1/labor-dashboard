// The nightly cron's trailing-window Google Sheet import.
//
// WHY THIS EXISTS. The sheet is hand-entered by HR, and ?action=backfill — a
// MANUAL admin POST — was the only thing that moved it into D1. That is the
// entire reason labour sat in the sheet from 2025-12-28 and never reached the
// API: the data existed, nothing pulled it. Wiring the same importer into the
// nightly cron makes the pipeline self-healing.
//
// So the assertion that matters is WIRING, not arithmetic: does
// `worker.scheduled` actually invoke the import? A test of importSheetToD1 in
// isolation would pass with the cron never calling it — which is precisely the
// failure being fixed, reproduced one level up. This drives worker.scheduled
// with the real cron expression and only the platform stubbed.
//
// The other three properties are the ones that keep it safe to run unattended:
//   • only the trailing window is imported (the subrequest budget)
//   • Clover-derived sales are never clobbered by the sheet
//   • a sheet failure cannot cost the snapshot pass that already succeeded
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const worker = await loadWorker(repo);
const todayET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const back = (n) => {
  const d = new Date(todayET + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
// Must match SHEET_IMPORT_TRAILING_DAYS in worker.js. Asserted, not assumed:
// the boundary cases below fail loudly if the constant moves.
const WINDOW = 21;

// A sheet row at N days back, with labour values keyed to N so each date is
// individually identifiable in D1 afterwards.
function sheetRow(n) {
  const [y, m, d] = back(n).split('-').map(Number);
  const cells = {
    2: '33', 3: `Date(${y},${m - 1},${d})`,
    8: 1000 + n, 9: 90 + n, 10: 0.1 + n / 1000,
    17: 400, 18: 100, 19: 0, 20: 500, 21: 100 + n, 22: 0.2 + n / 1000,
  };
  const c = [];
  for (let i = 0; i < 23; i++) c[i] = cells[i] === undefined ? null : { v: cells[i] };
  return { c };
}
// Inside the window, on both boundaries, and well outside it.
const OFFSETS = [0, 1, WINDOW - 1, WINDOW, WINDOW + 1, 60, 200];

let gvizCalls = 0, cloverCalls = 0;
function stubNetwork({ sheetFails = false } = {}) {
  gvizCalls = 0; cloverCalls = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('gviz')) {
      gvizCalls++;
      if (sheetFails) return new Response('<html>Not found</html>', { status: 404 });
      return new Response(`google.visualization.Query.setResponse(${JSON.stringify({
        status: 'ok', table: { cols: [], rows: OFFSETS.map(sheetRow) },
      })})`);
    }
    // Everything else (Clover, push, email) answers benignly — the snapshot
    // pass has no credentials in the harness, so it no-ops regardless.
    cloverCalls++;
    return new Response(JSON.stringify({ elements: [] }), { status: 200 });
  };
}

const rowsFor = (db, store = 'BL1') =>
  Object.fromEntries(db.prepare('SELECT * FROM daily_sales WHERE store = ?').all(store).map(r => [r.date, r]));

// ══ 1. The cron actually invokes the import, over the trailing window ══════
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales');
  stubNetwork();
  await worker.scheduled({ cron: '55 3 * * *' }, env, ctx);

  const r = rowsFor(db);
  ok(gvizCalls >= 6, `the nightly cron fetched the sheet for every store (${gvizCalls} calls) — this is the wiring assertion`);

  // Inside the window: written, with labour.
  for (const n of [0, 1, WINDOW - 1]) {
    ok(r[back(n)] != null, `day -${n} (inside the window) was imported`);
    eq(r[back(n)]?.budget_labor_hours, 90 + n, `day -${n} carries its budgeted hours`);
    // The fixture serves 100+n in col 21; actuals stopped importing 2026-08-14.
    eq(r[back(n)]?.labor_hours, null, `day -${n} does NOT carry actual hours from the sheet`);
  }
  // The window INCLUDES today, so today's budget is refreshed before the day
  // starts — that is what keeps todayBudget at most ~24h stale.
  eq(r[back(0)]?.budget, 1000, "today's budget is refreshed by the nightly run");

  // Outside: not written at all. This is the subrequest budget guard — the
  // full sheet is 418 rows per store and would blow the 1,000 cap.
  for (const n of [WINDOW, WINDOW + 1, 60, 200]) {
    ok(r[back(n)] == null, `day -${n} (outside the window) was NOT imported`);
  }
  eq(Object.keys(r).length, 3, 'exactly the three in-window days were written');
}

// ══ 2. The sheet cannot clobber Clover-derived sales ══════════════════════
// The importer resolves total/retail/bin/order_count existing-wins, and the
// cron runs it AFTER the snapshot pass. A row already holding Clover figures
// must come through untouched even though the sheet carries its own numbers.
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales');
  db.prepare(`INSERT INTO daily_sales (store,date,total,retail,bin,order_count,snapshot_time,is_manual_override)
              VALUES ('BL1',?,9999,7777,2222,404,'2026-08-11T03:55:00Z',0)`).run(back(1));
  stubNetwork();
  await worker.scheduled({ cron: '55 3 * * *' }, env, ctx);

  const row = rowsFor(db)[back(1)];
  eq(row.total, 9999, "the sheet did NOT overwrite Clover's total");
  eq(row.retail, 7777, 'nor retail');
  eq(row.bin, 2222, 'nor bin');
  eq(row.order_count, 404, 'nor the order count');
  // …while still filling the columns only the sheet can supply.
  eq(row.budget_labor_pct, 0.101, 'but the labour PLAN was filled in');
  eq(row.labor_hours, null, 'and actual hours stayed out — the sheet no longer supplies them');
}

// ══ 3. Manual-override rows stay immutable under the cron ═════════════════
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales');
  db.prepare(`INSERT INTO daily_sales (store,date,total,budget,labor_pct,is_manual_override)
              VALUES ('BL1',?,5555,4444,0.5,1)`).run(back(2));
  stubNetwork();
  await worker.scheduled({ cron: '55 3 * * *' }, env, ctx);

  const row = rowsFor(db)[back(2)];
  eq(row.total, 5555, 'a manual-override row keeps its total under the cron');
  eq(row.budget, 4444, 'and its budget, even though the sheet is authoritative for budget');
  eq(row.labor_pct, 0.5, 'and its labour %');
  eq(row.budget_labor_pct, null, 'and gains nothing from the sheet');
}

// ══ 4. A broken sheet is a no-op, not damage ══════════════════════════════
// An unreachable or renamed tab must not blank anything: the row loop simply
// does not execute.
//
// ⚠️ WHAT THIS DOES *NOT* PROVE. A mutation that made the cron's outer
// try/catch rethrow left this block green, because importSheetToD1 handles
// failures PER STORE — an unparseable response becomes summary[store].error and
// the function returns normally. So the resilience demonstrated here comes from
// the per-store handling, not from the outer catch, and the outer catch is
// currently unreachable defence-in-depth. Left in place for a future refactor
// that moves work outside the per-store try; not claimed as tested.
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales');
  db.prepare(`INSERT INTO daily_sales (store,date,total,budget,labor_pct)
              VALUES ('BL1',?,1234,999,0.33)`).run(back(1));
  stubNetwork({ sheetFails: true });
  await worker.scheduled({ cron: '55 3 * * *' }, env, ctx);
  ok(gvizCalls >= 6, 'the cron still attempted every store against the broken sheet');

  const row = rowsFor(db)[back(1)];
  eq(row.total, 1234, 'a failing sheet leaves existing sales alone');
  eq(row.budget, 999, 'and existing budget');
  eq(row.labor_pct, 0.33, 'and existing labour');
  eq(Object.keys(rowsFor(db)).length, 1, 'and writes no new rows');
}

// ══ 4b. Labour ACTUALS import for NO store; every plan still imports ══════
// Was: BL16-only exclusion, because its tab fills col 21 for dates that have
// not happened — 57.5 hours on a future day with no sales — so those are
// SCHEDULED hours and importing them labels a schedule as an actual.
//
// Now (2026-08-14): actual hours are entered in the dashboard, so the sheet
// must not supply them for ANY store — a nightly run would overwrite what
// somebody typed that afternoon. What used to be a store-scoped exclusion is
// deliberately a global switch-off. The PLAN columns still come from the
// sheet, which is the half of this that must NOT regress.
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales');
  stubNetwork();
  await worker.scheduled({ cron: '55 3 * * *' }, env, ctx);

  const bl16 = rowsFor(db, 'BL16')[back(1)];
  const bl1 = rowsFor(db, 'BL1')[back(1)];

  // The fixture serves cols 21/22 for every tab, so these are non-vacuous.
  eq(bl1.labor_hours, null, 'BL1 actual hours are NOT imported');
  eq(bl1.labor_pct, null, 'BL1 actual labour % is NOT imported');
  eq(bl16.labor_hours, null, 'BL16 actual hours are NOT imported');
  eq(bl16.labor_pct, null, 'BL16 actual labour % is NOT imported');

  // …while the plan still lands, for both.
  eq(bl1.budget_labor_hours, 90 + 1, 'BL1 budgeted hours ARE imported');
  eq(bl16.budget_labor_hours, 91, 'BL16 scheduled hours ARE imported — the plan is still wanted');
  eq(bl16.budget_labor_pct, 0.101, 'BL16 target % is still imported');
}

// ══ 4c. A stored hour survives the nightly run ════════════════════════════
// 🔑 THE property Phase 0 rests on. Turning the import off is only safe
// because the upsert COALESCEs a null onto the existing value; if that ever
// changed to a straight bind, every hand-entered hour would be wiped the next
// night and nothing else in this suite would notice. The sheet fixture serves
// a DIFFERENT number (101) for this date, so a regression shows up as the
// stored 47.25 turning into 101 or into null.
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales');
  db.prepare(`INSERT INTO daily_sales (store,date,labor_hours,snapshot_time,is_manual_override)
              VALUES ('BL1',?,47.25,'2026-08-14T03:55:00Z',0)`).run(back(1));
  stubNetwork();
  await worker.scheduled({ cron: '55 3 * * *' }, env, ctx);

  const row = rowsFor(db)[back(1)];
  eq(row.labor_hours, 47.25, 'a dashboard-entered hour survives the nightly sheet import');
  eq(row.budget_labor_hours, 91, 'and the plan still refreshed alongside it');
}

// ══ 5. Only the NIGHTLY cron runs it ══════════════════════════════════════
// The every-minute trigger firing a sheet import would be 1,440 imports a day.
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales');
  stubNetwork();
  await worker.scheduled({ cron: '* * * * *' }, env, ctx);
  eq(gvizCalls, 0, 'the every-minute cron does NOT import the sheet');
  eq(Object.keys(rowsFor(db)).length, 0, 'and writes nothing');

  stubNetwork();
  await worker.scheduled({ cron: '0 * * * *' }, env, ctx);
  eq(gvizCalls, 0, 'nor does the hourly interval-summary cron');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
