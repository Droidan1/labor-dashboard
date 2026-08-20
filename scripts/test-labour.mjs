// Labour — §4.8 of the Chief of Staff work order.
//
// TWO HALVES, AND THE IMPORTER IS THE ONE THAT WAS BROKEN. The API had read
// labor_pct correctly all along; it returned null because the column held 0,
// and it held 0 because the sheet importer's COL map never read the labour
// columns. A suite that only exercised the response shape would pass with the
// importer still blind, which is the exact failure being fixed — so the first
// half drives ?action=backfill for real, with only the Google Sheets HTTP call
// stubbed.
//
// The sheet layout in the fixture is production's, read from the live GViz
// feed on 2026-08-11:
//   col 9   budgeted hours        populated every day, including forward dates
//   col 10  budgeted labour %     as a FRACTION (0.098 = 9.8%)
//   col 21  actual hours          populated through 2026-08-04, blank after
//   col 22  actual labour %       populated through 2026-08-04, 0 after
//
// 🔑 laborActualPct is against ACTUAL WORKED hours and is not payroll: the
// sheet computes worked hours x a flat blended rate / net sales. The rate is
// recoverable from the sheet — $14.40/hr through Feb 2026, $15.00/hr from March
// — and one case below pins that relationship so the meaning of the field
// cannot drift silently.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const KEY = 'test-briefing-key';
const worker = await loadWorker(repo);

// ── Sheet stub. One row, production's column layout. ──────────────────────
function gviz(cells) {
  const c = [];
  for (let i = 0; i < 23; i++) c[i] = cells[i] === undefined ? null : { v: cells[i] };
  return `google.visualization.Query.setResponse(${JSON.stringify({
    version: '0.6', status: 'ok', table: { cols: [], rows: [{ c }] },
  })})`;
}
function stubSheet(cells) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('gviz')) return new Response(gviz(cells), { status: 200 });
    throw new Error('unexpected outbound fetch: ' + u.slice(0, 120));
  };
}
// [2]=week [3]=date [8]=budgetTotal [9]=budgetHours [10]=budgetLabour%
// [17]=retail [18]=bins [19]=auction [20]=total [21]=actualHours [22]=actualLabour%
const row = (over = {}) => Object.assign({
  2: '33', 3: 'Date(2026,7,10)', 8: 8605, 9: 96, 10: 0.141,
  17: 4139.04, 18: 1705.74, 19: 156.5, 20: 5844.78, 21: 118.1833, 22: 0.21099,
}, over);

async function runBackfill(env, cells) {
  stubSheet(cells);
  const res = await worker.fetch(
    req('/?action=backfill&store=BL1', { user: 'u-su', method: 'POST' }), env, ctx);
  return res;
}
const bl1 = (db) => db.prepare('SELECT * FROM daily_sales WHERE store = ?').all('BL1')[0];

// ══ 1. The importer reads the labour columns at all ════════════════════════
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales');
  const res = await runBackfill(env, row());
  eq(res.status, 200, 'backfill returns 200 for a superuser');

  const r = bl1(db);
  ok(r != null, 'the sheet row reached daily_sales');
  // 🛑 ACTUALS ARE NO LONGER IMPORTED (2026-08-14). Hours are entered in the
  // dashboard, so the nightly run must not carry them or it overwrites
  // hand-entered figures. The fixture DOES hold real values in cols 21/22
  // (118.1833 and 0.21099) — that is what keeps these two non-vacuous: they
  // fail the moment somebody re-enables the read.
  eq(r.labor_pct, null, 'actual labour % is NOT imported, though col 22 holds 0.21099');
  eq(r.labor_hours, null, 'actual HOURS are NOT imported, though col 21 holds 118.1833');
  eq(r.budget_labor_pct, 0.141, 'budgeted labour % is imported (col 10) — the PLAN still comes from the sheet');
  eq(r.budget_labor_hours, 96, 'budgeted HOURS are imported (col 9) — the PLAN still comes from the sheet');
  // Guard against a mis-indexed COL map: this must not pick up a neighbour.
  ok(r.budget_labor_hours !== 8605, 'budgeted hours is not the budget TOTAL from col 8');
  eq(r.budget, 8605, 'the pre-existing budget import is unaffected');
}

// ══ 2. A sheet 0 means "nobody entered it" and must not reach the column ═══
// This is the live state: actual-hours entry stopped chain-wide on 2026-08-04,
// so col 21 is blank and col 22 reads 0 for every day since.
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales');
  await runBackfill(env, row({ 21: null, 22: 0 }));
  const r = bl1(db);
  eq(r.labor_pct, null, 'a 0 in the sheet stores NULL, not 0');
  eq(r.labor_hours, null, 'a blank hours cell stores NULL');
  eq(r.budget_labor_pct, 0.141, 'the PLAN still imports even when the actual is missing');
  eq(r.budget_labor_hours, 96, 'and so do budgeted hours — a dark store still has a plan');
}

// ══ 2b. A literal 0 in ANY labour cell stores NULL ════════════════════════
// Added after a mutation survived: case 2 only ever fed a 0 to col 22, whose
// coercion predates this change, so binding the three NEW columns straight
// through went undetected. Every labour column needs its own 0.
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales');
  await runBackfill(env, row({ 9: 0, 10: 0, 21: 0, 22: 0 }));
  const r = bl1(db);
  eq(r.labor_pct, null, 'a 0 actual labour % stores NULL');
  eq(r.labor_hours, null, 'a 0 actual hours stores NULL');
  eq(r.budget_labor_pct, null, 'a 0 budgeted labour % stores NULL — no store plans 0%');
  eq(r.budget_labor_hours, null, 'a 0 budgeted hours stores NULL — no store plans 0 hours');
  eq(r.budget, 8605, 'a real budget alongside the zeroes is unaffected');
}

// ══ 3. The COALESCE ordering — the trap that would pin every row at 0 ══════
// Every existing row already holds budget_labor_pct = 0 from runs made before
// the sheet was filled in. If the upsert were COALESCE(existing, excluded), a
// re-run would keep the 0 forever and the plan import would be inert.
//
// Retargeted 2026-08-14 from the ACTUAL columns to the PLAN columns: actuals
// no longer import at all, so they can no longer demonstrate this ordering.
// The trap is unchanged and still live on the half that does import.
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales');
  db.prepare(`INSERT INTO daily_sales (store, date, total, budget_labor_pct, budget_labor_hours, budget)
              VALUES (?,?,?,?,?,?)`).run('BL1', '2026-08-10', 5844.78, 0, 0, 8605);
  eq(bl1(db).budget_labor_pct, 0, 'precondition: the stored row holds a 0, as prod does');

  await runBackfill(env, row());
  const r = bl1(db);
  eq(r.budget_labor_pct, 0.141, 'a re-run OVERWRITES the stored 0 — fresh sheet value wins');
  eq(r.budget_labor_hours, 96, 'and fills planned hours that were never populated');
  // The other direction, now that actuals are dashboard-owned: a stored hour
  // must NOT be disturbed by the same run. Fixture col 21 holds 118.1833.
  db.prepare(`UPDATE daily_sales SET labor_hours = 47.25 WHERE store='BL1'`).run();
  await runBackfill(env, row());
  eq(bl1(db).labor_hours, 47.25, 'while a dashboard-entered hour is left alone');
}

// ══ 4. Manual-override rows stay immutable ════════════════════════════════
{
  const { db, env } = makeEnv(repo);
  db.exec('DELETE FROM daily_sales');
  db.prepare(`INSERT INTO daily_sales (store, date, total, labor_pct, labor_hours, budget_labor_pct, is_manual_override)
              VALUES (?,?,?,?,?,?,1)`).run('BL1', '2026-08-10', 9999, 0.5, 12, 0.5);
  await runBackfill(env, row());
  const r = bl1(db);
  eq(r.labor_pct, 0.5, 'a manual-override row keeps its labour %');
  eq(r.labor_hours, 12, 'and its hours');
  eq(r.budget_labor_pct, 0.5, 'and its plan — the override wrapper covers the new columns too');
  eq(r.total, 9999, 'and its total, as before');
}

// ══ 5. The API surface ═════════════════════════════════════════════════════
{
  const { db, env } = makeEnv(repo);
  env.MORNING_BRIEFING_KEY = KEY;
  globalThis.fetch = async (u) => { throw new Error('outbound blocked: ' + String(u).slice(0, 60)); };

  const todayET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const _y = new Date(todayET + 'T12:00:00Z'); _y.setUTCDate(_y.getUTCDate() - 1);
  const yET = _y.toISOString().slice(0, 10);

  db.exec('DELETE FROM daily_sales');
  const ins = db.prepare(
    `INSERT INTO daily_sales (store, date, total, budget, order_count, labor_pct, labor_hours,
      budget_labor_pct, budget_labor_hours, snapshot_time, is_manual_override)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
  );
  // BL1 — a complete labour picture, pre-2026-08-05 shape.
  ins.run('BL1', yET, 8402, 9000, 300, 0.21099, 118.1833, 0.141, 96, '2026-08-11T03:55:00Z');
  // BL2 — TODAY's shape: plan entered, nobody has entered the actuals.
  ins.run('BL2', yET, 5000, 6000, 200, 0, null, 0.092, 30, '2026-08-11T03:55:00Z');
  // BL2 already covers "plan entered, actuals not". A store that is dark in
  // BOTH systems must still report its plan — deliberately NOT BL8, which is
  // permanently closed and now classifies as `closed` rather than `no_data`.
  ins.run('BL14', yET, 0, 4174, null, 0, null, 0.141, 46, null);
  // BL8 — Holland, permanently closed 2026-07-25. Labour is independent of
  // reportingStatus, so its PLAN must still come through even though the store
  // no longer trades.
  ins.run('BL8', yET, 0, 4174, null, 0, null, 0.133, 40, null);
  // BL4 — a legacy row stored in PERCENT units rather than a fraction.
  ins.run('BL4', yET, 5000, 6000, 200, 11.5, 80, 12.5, 85, '2026-08-11T03:55:00Z');

  const res = await worker.fetch(
    new Request('https://api.retjghub.com/?action=morning-briefing', { headers: { 'X-API-Key': KEY } }), env, ctx);
  eq(res.status, 200, 'briefing returns 200');
  const by = Object.fromEntries((await res.json()).stores.map(s => [s.storeId, s]));

  for (const code of ['BL1', 'BL2', 'BL4', 'BL8', 'BL14', 'BL16']) {
    for (const k of ['laborActualPct', 'laborTargetPct', 'laborHoursActual', 'laborHoursScheduled']) {
      ok(k in by[code], `${code} carries "${k}"`);
    }
  }

  // Rounded at the API: 4dp for percentages, 2dp for hours. The stored values
  // are 0.21099 / 118.1833.
  eq(by.BL1.laborActualPct, 0.211, 'laborActualPct is a decimal fraction, rounded to 4dp');
  eq(by.BL1.laborTargetPct, 0.141, 'laborTargetPct now has a source');
  eq(by.BL1.laborHoursActual, 118.18, 'laborHoursActual reports, rounded to cents');
  eq(by.BL1.laborHoursScheduled, 96, 'laborHoursScheduled reports');
  ok(by.BL1.laborActualPct > by.BL1.laborTargetPct, 'over target is expressible — the whole point');

  // 🔑 The field's meaning, pinned: worked hours x rate / net sales.
  // 118.1833 h x $15.00 / 8402 = 0.21099.
  const implied = (by.BL1.laborActualPct * 8402) / by.BL1.laborHoursActual;
  ok(Math.abs(implied - 15) < 0.01,
     `laborActualPct is worked-hours-based at a flat rate (implied $${implied.toFixed(2)}/hr, expected $15.00)`);

  // Today's real shape: plan yes, actual no. Never 0.
  eq(by.BL2.laborActualPct, null, 'an unentered actual is null, NOT 0');
  eq(by.BL2.laborHoursActual, null, 'unentered hours are null, NOT 0');
  eq(by.BL2.laborTargetPct, 0.092, 'while the target still reports');
  eq(by.BL2.laborHoursScheduled, 30, 'and scheduled hours still report');

  // Labour is independent of reportingStatus — it comes from the sheet, and the
  // ratio uses the sheet's own sales figure, not netSales.
  eq(by.BL14.reportingStatus, 'no_data', 'precondition: BL14 is dark');
  eq(by.BL14.laborTargetPct, 0.141, 'a dark store still reports its labour PLAN');
  eq(by.BL14.laborHoursScheduled, 46, 'and its scheduled hours');
  eq(by.BL14.laborActualPct, null, 'with no actual');
  eq(by.BL14.netSales, null, 'sales are still nulled by reportingStatus');

  // Holland: closed, not dark. Sales are a real 0 rather than null, and the
  // labour plan is unaffected — labour comes from the sheet, not the till.
  eq(by.BL8.reportingStatus, 'closed', 'Holland is closed, not no_data');
  eq(by.BL8.netSales, 0, 'a closed store reports a true 0, not null');
  eq(by.BL8.laborTargetPct, 0.133, 'and still reports its labour plan');
  eq(by.BL8.laborHoursScheduled, 40, 'and its scheduled hours');
  eq(by.BL8.laborActualPct, null, 'with no actual');

  // Percent-unit legacy rows normalise, and both fields do it the same way.
  eq(by.BL4.laborActualPct, 0.115, 'a percent-unit actual normalises to a fraction');
  eq(by.BL4.laborTargetPct, 0.125, 'and so does the target — one shared normaliser');

  // Float noise from a sheet FORMULA never reaches the wire. Five tabs hold a
  // clean hand-entered 0.141; Indy East's cells are computed, and shipped as
  // 0.13342366402048655 / 36.18190333333333 — the real values from prod.
  db.exec('DELETE FROM daily_sales');
  ins.run('BL1', yET, 8402, 9000, 300, 0.21099, 118.1833,
          0.13342366402048655, 36.18190333333333, '2026-08-11T03:55:00Z');
  const r2 = await worker.fetch(
    new Request('https://api.retjghub.com/?action=morning-briefing', { headers: { 'X-API-Key': KEY } }), env, ctx);
  const b1 = (await r2.json()).stores.find(s => s.storeId === 'BL1');
  eq(b1.laborTargetPct, 0.1334, 'a formula-derived target is rounded to 4dp, not 17 significant figures');
  eq(b1.laborHoursScheduled, 36.18, 'and scheduled hours to cents');
  eq(b1.laborHoursActual, 118.18, 'actual hours are rounded the same way');
  ok(String(b1.laborTargetPct).length <= 7, 'no float noise reaches the wire');

  // Stores with no row at all.
  eq(by.BL16.laborActualPct, null, 'a store with no row reports null actual');
  eq(by.BL16.laborTargetPct, null, 'and null target');

  // The rest of the contract is untouched.
  for (const k of ['reportingStatus', 'netSales', 'wtdSales', 'lySalesForDate', 'grossMargin',
                   'costCoverage', 'grossMarginPlan', 'transactions']) {
    ok(k in by.BL1, `pre-existing field "${k}" survives`);
  }
  eq(by.BL1.netSales, 8402, 'the sales figures are untouched by the labour work');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
