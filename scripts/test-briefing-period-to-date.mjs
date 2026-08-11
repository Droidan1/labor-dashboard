// WTD / MTD / prior-year on morning-briefing — §4.3 of the Chief of Staff work
// order. Driven through worker.fetch; only the platform is stubbed.
//
// THE CLOCK IS FROZEN, and that is the point. Every interesting case here is a
// calendar position: does the fiscal week start on Sunday, is salesDate
// included, does a week that straddles the month boundary still sum correctly.
// A suite that ran against the real clock would exercise the straddle on about
// one run in four and pass the rest of the time knowing nothing — which is how
// a date bug reaches production on the first of the month. Freezing the clock
// is stubbing the platform, exactly like stubbing D1 or fetch.
//
// The two positions under test:
//   2026-08-12 → salesDate Tue 2026-08-11. Week 33 (Aug 9-15), no straddle.
//   2026-08-02 → salesDate Sat 2026-08-01. Week 31 ran Jul 26 - Aug 1, so WTD
//                must reach back into JULY while MTD starts on Aug 1. If the
//                query window began at the first of the month, WTD would be one
//                day instead of seven.
// Both week numbers and both boundaries are prod's own, read from daily_sales.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const KEY = 'test-briefing-key';
const worker = await loadWorker(repo);
blockNetwork();

// Freeze the clock. new Date(arg) still behaves normally, so the worker's own
// date arithmetic is untouched — only "what time is it now" is pinned.
async function atNoonOn(iso, fn) {
  const Real = globalThis.Date;
  const fixed = new Real(`${iso}T16:00:00Z`); // noon ET, safely inside the ET day
  class Frozen extends Real {
    constructor(...a) { return a.length === 0 ? new Real(fixed) : new Real(...a); }
    static now() { return fixed.getTime(); }
  }
  globalThis.Date = Frozen;
  try { return await fn(); } finally { globalThis.Date = Real; }
}

// store, date, week, total, auction, budget, orderCount, snapshot?
function seed(db, rows) {
  db.exec('DELETE FROM daily_sales');
  db.exec('DELETE FROM last_year_sales');
  const ins = db.prepare(
    `INSERT INTO daily_sales (store, date, week, total, auction, budget, order_count, snapshot_time, is_manual_override)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
  );
  for (const [store, date, week, total, auction, budget, oc, snap] of rows) {
    ins.run(store, date, week, total, auction, budget, oc, snap ? '2026-08-11T03:55:00Z' : null);
  }
}

async function briefing(env) {
  const res = await worker.fetch(
    new Request('https://api.retjghub.com/?action=morning-briefing', { headers: { 'X-API-Key': KEY } }), env, ctx);
  eq(res.status, 200, 'briefing returns 200');
  const body = await res.json();
  return Object.fromEntries(body.stores.map(s => [s.storeId, s]));
}

// ══ Case 1 — mid-week, mid-month. salesDate = Tue 2026-08-11, week 33 ═══════
{
  const { db, env } = makeEnv(repo);
  env.MORNING_BRIEFING_KEY = KEY;
  seed(db, [
    // Prior MONTH — must not reach MTD.
    ['BL1', '2026-07-31', '31', 8888, null, 8888, 400, true],
    // In month, prior weeks — MTD only.
    ['BL1', '2026-08-01', '31',  500, null,   600,  50, true],
    ['BL1', '2026-08-05', '32',    0, null,   700, null, false],  // no_data: neither side
    ['BL1', '2026-08-08', '32', 9999, null,  9999, 300, true],
    // Week 33, up to and including salesDate.
    ['BL1', '2026-08-09', '33', 1000, null,  1200, 100, true],
    ['BL1', '2026-08-10', '33', 2000, null,  2200, 200, true],
    ['BL1', '2026-08-11', '33', 3000,  100,  3300, 300, true],
    // AFTER salesDate — the Sheet fills these with a budget and a literal 0.
    ['BL1', '2026-08-12', '33',    0, null,  4444, null, false],
    ['BL1', '2026-08-15', '33',    0, null,  5555, null, false],
    // Holland: dark all month.
    ...['2026-08-01','2026-08-08','2026-08-09','2026-08-10','2026-08-11']
       .map(d => ['BL8', d, d < '2026-08-02' ? '31' : d < '2026-08-09' ? '32' : '33', 0, null, 4174, null, false]),
  ]);
  db.prepare('INSERT INTO last_year_sales (store,date,retail,bin) VALUES (?,?,?,?)').run('BL1', '2025-08-12', 1500, 700);

  const by = await atNoonOn('2026-08-12', () => briefing(env));

  // Fields exist on every store, always.
  for (const code of ['BL1', 'BL2', 'BL8']) {
    for (const k of ['wtdSales', 'wtdBudget', 'wtdDaysReported', 'mtdSales', 'mtdBudget', 'mtdDaysReported', 'lySalesForDate']) {
      ok(k in by[code], `${code} carries "${k}"`);
    }
  }
  eq(by.BL1.salesDate, '2026-08-11', 'salesDate is yesterday under the frozen clock');

  // WTD = Sun 08-09 through salesDate 08-11. Inclusive of salesDate, and the
  // Saturday of the prior week (08-08, week 32) is excluded despite being only
  // one day earlier.
  eq(by.BL1.wtdDaysReported, 3, 'WTD covers Sunday through salesDate');
  eq(by.BL1.wtdSales, 6100, 'WTD sums 1000 + 2000 + (3000+100 auction)');
  eq(by.BL1.wtdBudget, 6700, 'WTD budget sums the same three days');
  ok(by.BL1.wtdSales < 9999, 'the prior week\'s Saturday is NOT in WTD');

  // MTD = 08-01 through 08-11, minus the no_data day. 07-31 is a different
  // month and must not appear even though it is in the same fiscal week as 08-01.
  eq(by.BL1.mtdDaysReported, 5, 'MTD counts only days it can vouch for');
  eq(by.BL1.mtdSales, 16599, 'MTD sums 500 + 9999 + 1000 + 2000 + 3100');
  eq(by.BL1.mtdBudget, 17299, 'MTD budget sums exactly the same five days');
  ok(by.BL1.mtdSales < 8888 + 16599, 'the prior month is NOT in MTD');

  // Like-for-like: the no_data day contributed to NEITHER side. Had its budget
  // been counted while its sales were not, MTD budget would read 17999.
  ok(by.BL1.mtdBudget !== 17999, 'a no_data day contributes no budget either — the ratio stays like-for-like');

  // Days after salesDate never contribute. This is the phantom-zero trap: those
  // rows carry a real budget and a Sheet-written 0.
  ok(by.BL1.wtdBudget !== 6700 + 4444 + 5555, 'days after salesDate are excluded from WTD');
  // 08-12 is TODAY under the frozen clock, so 4444 legitimately appears as
  // todayBudget — that is the forward target, not a period figure. 08-15 is
  // genuinely in the future and must appear nowhere at all.
  eq(by.BL1.todayBudget, 4444, "todayBudget still reads today's forward target");
  ok(!JSON.stringify(by.BL1).includes('5555'), 'a future budget never leaks anywhere');

  // Prior year: same weekday, 364 days back.
  eq(by.BL1.lySalesForDate, 2200, 'lySalesForDate is retail + bin at salesDate - 364 (2025-08-12)');
  eq(by.BL2.lySalesForDate, null, 'no prior-year row → null, never 0');

  // Holland: no usable day in either period.
  eq(by.BL8.wtdDaysReported, 0, 'a dark store reports zero usable days');
  eq(by.BL8.wtdSales, null, 'a dark store reports null WTD sales, NOT 0');
  eq(by.BL8.wtdBudget, null, 'and null WTD budget — a full budget against no sales is a fake 100% miss');
  eq(by.BL8.mtdSales, null, 'same for MTD sales');
  eq(by.BL8.mtdBudget, null, 'same for MTD budget');

  // A store with no rows at all still answers.
  eq(by.BL2.wtdDaysReported, 0, 'a store with no rows reports zero days');
  eq(by.BL2.mtdSales, null, 'a store with no rows reports null, not 0');
}

// ══ Case 2 — the straddle. salesDate = Sat 2026-08-01, week 31 = Jul 26–Aug 1 ══
{
  const { db, env } = makeEnv(repo);
  env.MORNING_BRIEFING_KEY = KEY;
  seed(db, [
    ['BL1', '2026-07-25', '30', 7777, null, 7777, 400, true],   // prior week AND prior month
    ['BL1', '2026-07-26', '31',  100, null,  110,  10, true],   // Sunday — week starts here
    ['BL1', '2026-07-27', '31',  200, null,  220,  20, true],
    ['BL1', '2026-08-01', '31',  300, null,  330,  30, true],   // salesDate, new month
  ]);

  const by = await atNoonOn('2026-08-02', () => briefing(env));
  eq(by.BL1.salesDate, '2026-08-01', 'salesDate is Sat 2026-08-01');

  // THE assertion this whole case exists for. Week 31 began in July, so a
  // window anchored at the first of the month would see one day, not three.
  eq(by.BL1.wtdDaysReported, 3, 'WTD reaches back into the previous month');
  eq(by.BL1.wtdSales, 600, 'WTD sums 100 + 200 + 300 across the month boundary');
  eq(by.BL1.wtdBudget, 660, 'WTD budget likewise');
  ok(by.BL1.wtdSales !== 300, 'WTD is NOT truncated at the first of the month');
  ok(by.BL1.wtdSales !== 8377, 'the prior fiscal week is still excluded');

  // MTD is the calendar month, so on the 1st it is one day.
  eq(by.BL1.mtdDaysReported, 1, 'MTD on the first of the month is one day');
  eq(by.BL1.mtdSales, 300, 'MTD is the calendar month, not the fiscal week');
}

// ══ The stored week label is authoritative, not the Sunday arithmetic ═══════
// If the business moves to a 4-5-4 retail calendar the label must win. Here a
// day inside salesDate's Sunday week carries a DIFFERENT label and must be
// excluded — which plain Sunday arithmetic would have included.
{
  const { db, env } = makeEnv(repo);
  env.MORNING_BRIEFING_KEY = KEY;
  seed(db, [
    ['BL1', '2026-08-09', '99', 5000, null, 5000, 500, true],  // Sunday, but labelled elsewhere
    ['BL1', '2026-08-10', '33', 2000, null, 2200, 200, true],
    ['BL1', '2026-08-11', '33', 3000, null, 3300, 300, true],
  ]);
  const by = await atNoonOn('2026-08-12', () => briefing(env));
  eq(by.BL1.wtdDaysReported, 2, 'a day labelled into another fiscal week is excluded from WTD');
  eq(by.BL1.wtdSales, 5000, 'WTD follows the stored week label, not the calendar Sunday');
  ok(by.BL1.wtdSales !== 10000, 'the mislabelled Sunday is not silently included');
}

// ══ Fallback: no week label on salesDate → Sunday arithmetic ═══════════════
// 192 historical rows have a NULL week. The current week always has one, but
// the fallback must still produce a sane answer rather than an empty period.
{
  const { db, env } = makeEnv(repo);
  env.MORNING_BRIEFING_KEY = KEY;
  seed(db, [
    ['BL1', '2026-08-08', null, 9999, null, 9999, 900, true],  // Sat, prior week
    ['BL1', '2026-08-09', null, 1000, null, 1200, 100, true],  // Sunday
    ['BL1', '2026-08-10', null, 2000, null, 2200, 200, true],
    ['BL1', '2026-08-11', null, 3000, null, 3300, 300, true],
  ]);
  const by = await atNoonOn('2026-08-12', () => briefing(env));
  eq(by.BL1.wtdDaysReported, 3, 'with no week label, WTD falls back to Sunday-start');
  eq(by.BL1.wtdSales, 6000, 'and sums Sunday through salesDate');
  ok(by.BL1.wtdSales !== 15999, 'the fallback still excludes the prior Saturday');
}

// ══ Rounding ══════════════════════════════════════════════════════════════
{
  const { db, env } = makeEnv(repo);
  env.MORNING_BRIEFING_KEY = KEY;
  seed(db, [
    ['BL1', '2026-08-09', '33', 4981.8, 130.64, 1000.1, 100, true],
    ['BL1', '2026-08-10', '33', 4981.8, 130.64, 1000.1, 100, true],
    ['BL1', '2026-08-11', '33', 4981.8, 130.64, 1000.1, 100, true],
  ]);
  const by = await atNoonOn('2026-08-12', () => briefing(env));
  eq(by.BL1.wtdSales, 15337.32, 'period sums are rounded to cents');
  eq(by.BL1.wtdBudget, 3000.3, 'budget sums are rounded to cents');
  ok(String(by.BL1.wtdSales).length <= 9, 'no float noise reaches the wire');
}

// ══ The baseline still holds ══════════════════════════════════════════════
{
  const { db, env } = makeEnv(repo);
  env.MORNING_BRIEFING_KEY = KEY;
  seed(db, [['BL1', '2026-08-11', '33', 3000, 100, 3300, 300, true]]);
  const by = await atNoonOn('2026-08-12', () => briefing(env));
  for (const k of ['storeId', 'name', 'salesDate', 'reportingStatus', 'netSales', 'posSales',
                   'auctionSales', 'budgetForSalesDate', 'todayBudget', 'laborActualPct',
                   'transactions', 'grossMargin', 'categories']) {
    ok(k in by.BL1, `pre-existing field "${k}" survives the additions`);
  }
  eq(by.BL1.netSales, 3100, 'the single-day figures are untouched by the period work');
  eq(by.BL1.reportingStatus, 'reported', 'reportingStatus is untouched');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
