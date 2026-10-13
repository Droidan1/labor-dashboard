// The nightly Sheet import refreshes FUTURE days' plan columns, through the end
// of next month, driven through the real cron entry point
// (worker.scheduled({ cron: '55 3 * * *' })).
//
// What this is defending (2026-10-13): the import only ever read today and the
// 20 days before it, so a budget edited in the Sheet for a later day reached the
// app only when that day arrived, and the Executive Summary's monthly plan and
// full-week pace read the stale figure until then. Oct 25's cleared Retail cell
// would have dropped Coliseum's October plan by $7,987 overnight, two weeks after
// the edit. Future days must take the Sheet's plan the next night, and nothing
// else: no actuals, no Clover snapshot read, manual overrides untouched.
process.env.TZ = 'UTC';
const PINNED = '2026-10-14T03:55:00Z';      // the cron's own time: 11:55 PM ET on Oct 13
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(PINNED); else super(...a); }
  static now() { return new RealDate(PINNED).getTime(); }
};

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const worker = await loadWorker(repo);
const h = makeEnv(repo);
const row = (date) => h.db.prepare("SELECT * FROM daily_sales WHERE store = 'BL1' AND date = ?").get(date);

// Prod's shape: future rows already exist with total 0 and no snapshot.
const seed = h.db.prepare('INSERT INTO daily_sales (store, date, week, total, budget, budget_labor_pct, budget_labor_hours, is_manual_override) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
seed.run('BL1', '2026-10-10', '41', 9000, 100, 0.1, 40, 0);    // inside the trailing window
seed.run('BL1', '2026-10-20', '43', 0, 100, 0.1, 40, 0);       // later this month
seed.run('BL1', '2026-10-25', '44', 0, 100, 0.1, 40, 1);       // a manual override
seed.run('BL1', '2026-11-30', '48', 0, 100, 0.1, 40, 0);       // last day of next month
seed.run('BL1', '2026-12-01', '48', 0, 100, 0.1, 40, 0);       // beyond the plan window

// The Sheet: Coliseum's tab carries a new plan for each of those days. The
// future ones also carry "actual" cells, which must NOT be imported.
const cell = (v) => ({ v });
const sheetRow = (y, m, d, week, budget, hours, laborPct, actualRetail) => {
  const c = [];
  c[2] = cell(week); c[3] = cell(`Date(${y},${m - 1},${d})`); c[8] = cell(budget); c[9] = cell(hours); c[10] = cell(laborPct);
  c[17] = cell(actualRetail); c[18] = cell(0); c[19] = cell(0); c[20] = cell(actualRetail);
  return { c };
};
const COLISEUM = { status: 'ok', table: { rows: [
  sheetRow(2026, 10, 10, 41, 111, 41, 0.11, 6000),
  sheetRow(2026, 10, 20, 43, 222, 52, 0.09, 777),
  sheetRow(2026, 10, 25, 44, 555, 55, 0.09, 0),
  sheetRow(2026, 11, 30, 48, 333, 53, 0.08, 0),
  sheetRow(2026, 12, 1, 48, 444, 54, 0.08, 0),
] } };
globalThis.fetch = async (u) => {
  const s = String(u);
  if (s.includes('docs.google.com')) {
    const tab = decodeURIComponent((s.match(/sheet=([^&]+)/) || [])[1] || '');
    const body = tab === 'BL1/BL6 Coliseum' ? COLISEUM : { status: 'ok', table: { rows: [] } };
    return new Response('google.visualization.Query.setResponse(' + JSON.stringify(body) + ');');
  }
  throw new Error('outbound fetch blocked in test: ' + s.slice(0, 60));
};

// Watch what the import reads and how it writes.
const kvKeys = [];
const realGet = h.env.SALES_SNAPSHOTS.get;
h.env.SALES_SNAPSHOTS.get = (k, o) => { kvKeys.push(k); return realGet(k, o); };
let batches = 0;
const realBatch = h.env.DB.batch;
h.env.DB.batch = (stmts) => { batches++; return realBatch(stmts); };

const logs = [];
const L = console.log, E = console.error, W = console.warn;
console.log = (...a) => logs.push(a.join(' ')); console.error = console.log; console.warn = console.log;
const waits = [];
await worker.scheduled({ cron: '55 3 * * *', scheduledTime: Date.now() },
  h.env, { waitUntil: p => waits.push(Promise.resolve(p).catch(() => {})), passThroughOnException() {} });
await Promise.all(waits);
console.log = L; console.error = E; console.warn = W;

const imp = logs.find(l => l.startsWith('Sheet import (trailing window):')) || '';
ok(!!imp, 'the nightly cron ran the Sheet import');

// ── The trailing window is unchanged ────────────────────────────────────────
eq(row('2026-10-10').budget, 111, 'a past day in the trailing window still takes the Sheet budget');

// ── Future days take the Sheet's plan, and only the plan ────────────────────
const f = row('2026-10-20');
eq(f.budget, 222, 'a future day this month takes the Sheet budget the same night');
eq(f.budget_labor_hours, 52, '...and its labour-plan hours');
eq(f.budget_labor_pct, 0.09, '...and its labour-plan %');
eq(f.week, '43', '...and its week');
eq(f.total, 0, 'its POS total is untouched (no actuals for a day that has not happened)');
eq(f.retail, null, 'its retail stays empty although the Sheet row has an actual-retail cell');
eq(row('2026-11-30').budget, 333, 'the last day of NEXT month is refreshed (the window end)');
eq(row('2026-12-01').budget, 100, 'the month after next is left alone');
eq(row('2026-10-25').budget, 100, 'a manual-override day is never overwritten');

// ── Cost: no Clover snapshot reads for future days, one batch per tab ───────
const futureReads = kvKeys.filter(k => { const d = (k.match(/(\d{4}-\d{2}-\d{2})$/) || [])[1]; return d && d > '2026-10-13'; });
eq(futureReads.length, 0, `no KV snapshot read for a future day (${futureReads.join(', ')})`);
ok(kvKeys.includes('sales:bl1:2026-10-10'), 'the trailing day still reads its snapshot (the guard above is not vacuous)');
ok(batches >= 1 && batches <= 6, `future rows are written in one batch per store tab (${batches} batch calls)`);
ok(/"BL1":\{"imported":1,"planned":3/.test(imp), `the summary counts them as "planned" (${imp.slice(0, 120)})`);

// ── The window end on awkward months (the cron above covers the wiring; this is
// the date arithmetic alone, read from worker.js so it is the shipped code) ──
{
  const fs = await import('node:fs');
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const i = src.indexOf('function sheetPlanThrough(');
  const planThrough = new Function(src.slice(i, src.indexOf('\n}', i) + 2) + '; return sheetPlanThrough;')();
  for (const [today, want] of [['2026-10-13', '2026-11-30'], ['2026-12-05', '2027-01-31'], ['2026-12-31', '2027-01-31'],
                               ['2027-01-31', '2027-02-28'], ['2028-01-15', '2028-02-29'], ['2026-11-30', '2026-12-31']]) {
    eq(planThrough(today), want, `plan window from ${today} ends ${want}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
