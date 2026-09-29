// "Today" is the stores' Eastern day, whatever zone the device is set to.
//
// The dashboard's rows are Eastern days. loadStoreFromD1 builds each one as local noon on its
// Eastern date, and nulls the stored figures on the Eastern-today row so the live Clover figure
// can take its place. So every place that then asks "which row is today", "which week is
// current" or "since when does the live figure count" has to answer in Eastern time as well.
// Seven asked the device instead (tasks/todo.md, 2026-09-29). On a device set to another zone,
// the Daily tabs put the live figure on the wrong row, the hero measured today against another
// day's budget, and the live window opened at the device's midnight. And even on an Eastern
// device, from midnight to noon each Sunday, the current week was still last week.
//
// This runs the real code, sliced out of index.html into a vm context: the loader, the week
// pick, the live fetch, getTodayRow, both Daily tables and the All Stores totals, fed through
// the loader the way the page feeds them. The clock is pinned, and the device's zone is
// process.env.TZ, set per case (Node re-reads it on assignment). The instants are ones where
// the device's date and the Eastern date differ, plus Sunday mornings, and every expected
// figure is computed here from the fixture rather than read back from the page.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const html = fs.readFileSync(path.join(process.argv[2] || repo, 'index.html'), 'utf8');
const workerSrc = fs.readFileSync(path.join(process.argv[2] || repo, 'worker.js'), 'utf8');

// ── Slices, each bounded on both sides ───────────────────────────────────────
// A function written on one line, e.g. `  function etTodayStr() { ... }`.
function lineFn(name) {
  const m = html.match(new RegExp(`^  function ${name}\\([^)]*\\) *\\{.*\\}.*$`, 'm'));
  ok(!!m, `found the one-line ${name} in index.html`);
  return m ? m[0] : '';
}
// From a first line to the first line that is exactly "  }": found once, not empty, not long,
// and with no other top-level declaration inside, so it cannot have run past its own end.
function blockFn(first, maxLen = 20000) {
  const i = html.indexOf(first);
  const again = i < 0 ? -1 : html.indexOf(first, i + 1);
  const j = i < 0 ? -1 : html.indexOf('\n  }\n', i);
  const s = i >= 0 && j > i ? html.slice(i, j + 4) : '';
  const inner = s.slice(first.length);
  ok(s.length > 0 && again < 0 && s.length <= maxLen && !/\n  (async )?function |\n  window\./.test(inner),
    `sliced ${JSON.stringify(first.trim())} (${s.length} chars, once, nothing past its end)`);
  return s;
}
function between(from, to, maxLen) {
  const i = html.indexOf(from);
  const j = i < 0 ? -1 : html.indexOf(to, i + from.length);
  const s = i >= 0 && j > i ? html.slice(i, j) : '';
  ok(s.length > 0 && s.length <= maxLen && html.indexOf(from, i + 1) < 0 && !/\n  (async )?function /.test(s),
    `sliced ${JSON.stringify(from.trim())} up to ${JSON.stringify(to.trim())} (${s.length} chars)`);
  return s;
}

const rosterSrc = ['STORES', 'BUDGET_ONLY_STORES'].map((n) => {
  const m = html.match(new RegExp(`^  const ${n} = \\[[^\\]]*\\];$`, 'm'));
  ok(!!m, `found the ${n} roster`);
  return m ? m[0] : '';
}).join('\n');
const pageSrc = [
  rosterSrc,
  lineFn('etTodayStr'), lineFn('etDayOf'), lineFn('etStartOfDay'), lineFn('rowDayKey'),
  blockFn('  function budgetOnlyRows(keep) {'), blockFn('  function budgetOnlyTotal(keep) {'),
  blockFn('  function rowAuction(r) {'),
  blockFn('  async function loadStoreFromD1(storeName) {'),
  blockFn('  async function fetchLiveCloverSales(storeKey) {'),
  blockFn('  function getTodayRow(storeName) {'),
  blockFn('  function weekForRangeEnd() {'),
  blockFn('  function buildWeeklyTable(storeName) {'),
  blockFn('  function buildAllStoresWeeklyTable() {'),
  blockFn('  function _asWeekTotals() {'),
].join('\n');
// loadAll's week pick is statements inside loadAll, not a function, so it is wrapped in one.
const weekPickSrc = between('    // Generate week list\n', '    allWeeks = [...weekSet]', 2500);
ok(/\bcurrentWeek = /.test(weekPickSrc) && /weekSet\.add\(/.test(weekPickSrc), 'the loadAll slice is the week pick');

// The worker's midnight, for the frontend's to agree with.
const workerStart = (() => {
  const i = workerSrc.indexOf('\nfunction getStartOfDayET(');
  const j = i < 0 ? -1 : workerSrc.indexOf('\n}\n', i);
  ok(i >= 0 && j > i && j - i < 800, 'found getStartOfDayET in worker.js');
  return i >= 0 && j > i ? workerSrc.slice(i + 1, j + 2) : '';
})();

// ── The clock and the zone ───────────────────────────────────────────────────
const RealDate = Date;
let NOW = 0;
class FixedDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
  static now() { return NOW; }
}
const ORIGINAL_TZ = process.env.TZ;
const ET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
const etYmd = (t) => ET.format(new RealDate(t));

// Ground truth for midnight Eastern: the first minute whose Eastern date is `d`, found by
// bisection over 03:00-06:00 UTC, which holds midnight at either offset. It assumes neither.
function truth(d) {
  let lo = RealDate.parse(d + 'T03:00:00Z'), hi = RealDate.parse(d + 'T06:00:00Z');
  while (hi - lo > 60000) {
    const mid = lo + Math.floor((hi - lo) / 120000) * 60000;
    if (etYmd(mid) === d) hi = mid; else lo = mid;
  }
  return hi;
}

// ── The fixture: six stores, five weeks, every figure distinct ──────────────
// A budget names its store and its day: store weight x $1,000, plus the day's index. So a
// wrong row cannot pass by carrying the same figure, and a day's chain budget is unique too.
const WEIGHT = { BL1: 1, BL2: 2, BL4: 4, BL14: 8, BL16: 16, BL8: 32 };
const FIRST = '2026-09-13';                     // a Sunday; weeks roll every Sunday from here
const DAYS = Array.from({ length: 35 }, (_, i) => new RealDate(RealDate.parse(FIRST + 'T12:00:00Z') + i * 86400000).toISOString().slice(0, 10));
const idx = (d) => DAYS.indexOf(d);
const weekOf = (d) => 33 + Math.floor(idx(d) / 7);
const code = (store) => store.split('/')[0];
const budget = (store, d) => WEIGHT[code(store)] * 1000 + idx(d);
const stored = (store, d) => code(store) === 'BL8' ? 0 : WEIGHT[code(store)] * 100 + idx(d);
const live = (store) => WEIGHT[code(store)] * 10 + 3;

// What the worker's ?history_d1 hands the loader. The Eastern-today row carries a stale
// snapshot (5), which the loader must drop; later days have a budget and nothing else.
function d1(store, today) {
  const out = {};
  for (const d of DAYS) {
    const past = d < today, isToday = d === today;
    const total = past ? stored(store, d) : isToday ? 5 : null;
    out[d] = { week: weekOf(d), budget: budget(store, d), total, retail: total, bin: total == null ? null : 0,
               laborPct: total == null ? null : 10, orderCount: total == null ? null : 5, avgCart: total == null ? null : 20 };
  }
  return out;
}

const money = (v) => `[[${Number(v).toFixed(2)}]]`;
const moneyRe = /\[\[(-?\d+\.\d\d)\]\]/g;

// One page load at one instant, on a device in one zone.
async function load(zone, iso) {
  process.env.TZ = zone;
  NOW = RealDate.parse(iso);
  const today = etYmd(NOW);
  const liveUrls = [];
  const c = vm.createContext({
    Date: FixedDate, Intl, console, URL,
    WORKER_BASE: 'https://worker.test/',
    cachedFetch: async (url) => {
      const q = new URL(url).searchParams;
      const s = [...STORE_NAMES].find(n => code(n) === (q.get('store') || '').toUpperCase());
      if (q.get('history_d1')) return s ? d1(s, today) : {};
      liveUrls.push(url);
      return { aggregate: { total: live(s), retail: live(s), bin: 0, avgCart: 20, avgItems: 2, orderCount: 5, avgTxnSec: 60, avgASP: 10 } };
    },
    allStoreData: {}, liveCloverData: {}, selectedWeek: null, currentWeek: null, sdWeekFilter: null,
    dateRange: { from: today, to: today, presetId: 'today' },
    escapeHtml: (s) => String(s), fmtDollar: money, fmtPct: (v) => `${Number(v).toFixed(1)}%`,
    normalizeLaborPct: (v) => v, LABOR_TARGET: 14.1,
    _buildSdSelectors: () => '', _buildSdMonthSummary: () => '',
  });
  vm.runInContext(pageSrc + `\nfunction __weekPick() {\n${weekPickSrc}\n}`, c);
  await vm.runInContext(`(async () => {
    for (const s of STORES.concat(BUDGET_ONLY_STORES)) allStoreData[s] = (await loadStoreFromD1(s)).rows;
    __weekPick();
    selectedWeek = weekForRangeEnd();
    for (const s of STORES) liveCloverData[s] = await fetchLiveCloverSales(s.split('/')[0].toLowerCase());
  })()`, c);
  return { c, today, liveUrls, run: (js) => vm.runInContext(js, c) };
}

const STORE_NAMES = new Set();
{
  const probe = vm.createContext({});
  vm.runInContext(rosterSrc + '\nthis.__all = STORES.concat(BUDGET_ONLY_STORES); this.__trading = STORES.slice();', probe);
  for (const s of probe.__all) STORE_NAMES.add(s);
  ok(probe.__trading.length === 5 && STORE_NAMES.size === 6 && [...STORE_NAMES].every(s => code(s) in WEIGHT),
    `the rosters are the five trading stores and Holland (${[...STORE_NAMES].map(code).join(',')})`);
}
const TRADING = [...STORE_NAMES].filter(s => code(s) !== 'BL8');

// Day rows of a Daily table, keyed by the budget they print (unique per day).
const rowsOf = (out) => out.split('<div class="grid items-center').slice(1);
const salesOf = (row) => { const m = row.split('vs <b')[0].match(/\[\[(-?\d+\.\d\d)\]\]/); return m ? Number(m[1]) : null; };
const budgetOf = (row) => { const m = row.split('vs <b')[1]?.match(/\[\[(-?\d+\.\d\d)\]\]/); return m ? Number(m[1]) : null; };
const isTodayChip = (row) => row.includes('bg-accent-green border-accent-green');
const hasLiveTag = (row) => row.includes('>Live</span>');

const ZONES = ['America/New_York', 'America/Chicago', 'America/Los_Angeles', 'UTC', 'Asia/Tokyo'];
const INSTANTS = [
  { iso: '2026-09-29T01:30:00Z', why: 'Mon 21:30 ET: UTC and Tokyo are already on Tuesday' },
  { iso: '2026-09-29T04:30:00Z', why: 'Tue 00:30 ET: Chicago and Los Angeles are still on Monday' },
  { iso: '2026-09-27T13:00:00Z', why: 'Sun 09:00 ET: the first morning of week 35, before noon in New York, Chicago and Los Angeles' },
  { iso: '2026-10-04T03:30:00Z', why: 'Sat 23:30 ET: the last hour of week 35, past noon on Sunday in Tokyo' },
];

// ── 0. The harness can tell the zones apart, so no case passes by the dates agreeing ─────
console.log('\n── The pinned clock, per zone ──');
{
  const devDate = (zone, iso) => { process.env.TZ = zone; NOW = RealDate.parse(iso); return new FixedDate().toDateString(); };
  eq(devDate('UTC', INSTANTS[0].iso), 'Tue Sep 29 2026', 'at Mon 21:30 ET a UTC device reads Tuesday');
  eq(devDate('Asia/Tokyo', INSTANTS[0].iso), 'Tue Sep 29 2026', 'and so does a Tokyo one');
  eq(devDate('America/Los_Angeles', INSTANTS[1].iso), 'Mon Sep 28 2026', 'at Tue 00:30 ET a Los Angeles device reads Monday');
  eq(devDate('America/Chicago', INSTANTS[1].iso), 'Mon Sep 28 2026', 'and so does a Chicago one');
  const { run } = await load('Asia/Tokyo', INSTANTS[0].iso);
  eq(run('new Date().toISOString()'), '2026-09-29T01:30:00.000Z', 'the pinned clock is the one the sliced page reads');
  eq(run('new Date("2026-09-28T12:00:00").getHours()'), 12, 'and a local time string parses in the device zone');
}

// ── 1. etStartOfDay: midnight Eastern, the same as the worker's, on every day of 2025-2028 ─
console.log('\n── etStartOfDay ──');
{
  process.env.TZ = 'UTC';
  const c = vm.createContext({ Date: FixedDate, Intl });
  vm.runInContext([lineFn('etDayOf'), lineFn('etStartOfDay'), workerStart].join('\n'), c);
  const days = [];
  for (let t = RealDate.parse('2025-01-01T12:00:00Z'); t <= RealDate.parse('2028-12-31T12:00:00Z'); t += 86400000) days.push(new RealDate(t).toISOString().slice(0, 10));
  const wrongTruth = [], wrongWorker = [];
  for (const d of days) {
    const got = vm.runInContext(`typeof etStartOfDay === 'function' ? etStartOfDay(${JSON.stringify(d)}) : null`, c);
    if (got !== truth(d)) wrongTruth.push(d);
    if (got !== vm.runInContext(`getStartOfDayET(${JSON.stringify(d)})`, c)) wrongWorker.push(d);
  }
  ok(days.length === 1461 && wrongTruth.length === 0, `etStartOfDay is the first Eastern minute of every day of 2025-2028 (${wrongTruth.length} wrong, e.g. ${wrongTruth.slice(0, 3).join(', ')})`);
  ok(wrongWorker.length === 0, `and agrees with the worker's getStartOfDayET on every one (${wrongWorker.length} differ)`);
  // An Eastern device used to send its own midnight. Nothing about its request may change.
  process.env.TZ = 'America/New_York';
  const changed = days.filter(d => {
    const [y, m, dd] = d.split('-').map(Number);
    return vm.runInContext(`typeof etStartOfDay === 'function' ? etStartOfDay(${JSON.stringify(d)}) : null`, c) !== new RealDate(y, m - 1, dd).getTime();
  });
  ok(changed.length === 0, `on an Eastern device it is the device's own midnight, every day (${changed.length} differ)`);
}

// ── 2-7. One page load per zone per instant ─────────────────────────────────
for (const { iso, why } of INSTANTS) {
  console.log(`\n── ${why} ──`);
  for (const zone of ZONES) {
    const at = `${zone} @ ${iso}`;
    const { today, liveUrls, run } = await load(zone, iso);
    const wk = weekOf(today);
    const weekDays = DAYS.filter(d => weekOf(d) === wk);
    const pastDays = weekDays.filter(d => d < today);

    // 2. The live window opens at midnight Eastern, and the payload says which day it is.
    const since = liveUrls.map(u => Number(new URL(u).searchParams.get('since')));
    ok(liveUrls.length === 5 && since.every(v => v === truth(today)),
      `${at}: every live request asks from midnight Eastern, ${new RealDate(truth(today)).toISOString()} (got ${[...new Set(since)].map(v => new RealDate(v).toISOString()).join(', ')})`);
    eq(run('STORES.map(s => liveCloverData[s] && liveCloverData[s].day).join()'), Array(5).fill(today).join(), `${at}: each payload is stamped with the Eastern date`);

    // 3. The current week is the week of the Eastern today.
    eq(run('currentWeek'), wk, `${at}: currentWeek is the week of ${today}`);
    eq(run('selectedWeek'), wk, `${at}: and Today selects that same week`);

    // 4. getTodayRow picks the Eastern-today row, for every store.
    const tb = JSON.parse(run('JSON.stringify(STORES.concat(BUDGET_ONLY_STORES).map(s => (getTodayRow(s) || {}).bTotal ?? null))'));
    const wantTb = [...STORE_NAMES].map(s => budget(s, today));
    eq(JSON.stringify(tb), JSON.stringify(wantTb), `${at}: getTodayRow returns ${today}'s row for all six stores`);

    // 5. The Store Detail Daily tab: the live figure, the chip and the Live tag sit on the
    //    Eastern-today row and nowhere else, and the day count includes it.
    {
      const s = TRADING[0];
      const out = run(`buildWeeklyTable(${JSON.stringify(s)})`);
      const rows = rowsOf(out), days = rows.slice(0, -1), total = rows.at(-1) || '';
      const byDay = Object.fromEntries(weekDays.map(d => [d, days.find(r => budgetOf(r) === budget(s, d))]));
      ok(days.length === 7 && weekDays.every(d => byDay[d]), `${at}: Daily tab draws the seven days of week ${wk}`);
      const t = byDay[today] || '';
      eq(salesOf(t), live(s), `${at}: Daily tab shows the live figure on ${today}`);
      ok(isTodayChip(t) && hasLiveTag(t), `${at}: Daily tab marks ${today} as today, with the Live tag`);
      const others = weekDays.filter(d => d !== today);
      ok(others.every(d => !isTodayChip(byDay[d] || '') && !hasLiveTag(byDay[d] || '')),
        `${at}: Daily tab marks no other day as today (${others.filter(d => isTodayChip(byDay[d] || '') || hasLiveTag(byDay[d] || '')).join(', ')})`);
      ok(pastDays.every(d => salesOf(byDay[d] || '') === stored(s, d)), `${at}: Daily tab keeps each earlier day's stored figure`);
      ok(total.includes(`${pastDays.length + 1} of 7 days reported`), `${at}: Daily tab counts ${pastDays.length + 1} days reported (${(total.match(/\d+ of \d+ days reported/) || ['none'])[0]})`);
      const wkSales = pastDays.reduce((n, d) => n + stored(s, d), 0) + live(s);
      eq(Number((total.match(moneyRe) || [''])[0].slice(2, -2)), wkSales, `${at}: Daily tab's week total is the stored days plus live`);
    }

    // 6. The All Stores Daily table, summed over the trading stores.
    {
      const out = run('buildAllStoresWeeklyTable()');
      const days = rowsOf(out).slice(0, -1);
      const chainBudget = (d) => [...STORE_NAMES].reduce((n, s) => n + budget(s, d), 0);
      const byDay = Object.fromEntries(weekDays.map(d => [d, days.find(r => budgetOf(r) === chainBudget(d))]));
      ok(weekDays.every(d => byDay[d]), `${at}: All Stores Daily draws the seven days of week ${wk}`);
      const t = byDay[today] || '';
      eq(salesOf(t), TRADING.reduce((n, s) => n + live(s), 0), `${at}: All Stores Daily shows the five live figures on ${today}`);
      ok(isTodayChip(t) && hasLiveTag(t), `${at}: All Stores Daily marks ${today} as today, with the Live tag`);
      const others = weekDays.filter(d => d !== today);
      ok(others.every(d => !isTodayChip(byDay[d] || '') && !hasLiveTag(byDay[d] || '')),
        `${at}: All Stores Daily marks no other day as today (${others.filter(d => isTodayChip(byDay[d] || '') || hasLiveTag(byDay[d] || '')).join(', ')})`);
      ok(pastDays.every(d => salesOf(byDay[d] || '') === TRADING.reduce((n, s) => n + stored(s, d), 0)),
        `${at}: All Stores Daily keeps each earlier day's stored figures`);
    }

    // 7. The All Stores hero's week totals.
    {
      const t = JSON.parse(run('JSON.stringify(_asWeekTotals())'));
      const want = TRADING.reduce((n, s) => n + pastDays.reduce((m, d) => m + stored(s, d), 0) + live(s), 0);
      eq(t.totalSales, want, `${at}: the All Stores week total is the stored days plus live`);
      ok(t.anyLive === true && t.isCurrentWeek === true, `${at}: and it says it is live, for the current week`);
      eq(t.daysReported, pastDays.length + 1, `${at}: and counts ${pastDays.length + 1} days reported`);
    }
  }
}

// ── 8. The two days a year the clocks change: the live window still opens at midnight ────
console.log('\n── The live window on the clock-change Sundays ──');
for (const iso of ['2026-03-08T15:00:00Z', '2026-11-01T15:00:00Z']) {
  for (const zone of ZONES) {
    const { today, liveUrls } = await load(zone, iso);
    const since = liveUrls.map(u => Number(new URL(u).searchParams.get('since')));
    ok(since.length === 5 && since.every(v => v === truth(today)),
      `${zone} on ${today}: the live window opens at ${new RealDate(truth(today)).toISOString()} (got ${[...new Set(since)].map(v => new RealDate(v).toISOString()).join(', ')})`);
  }
}

if (ORIGINAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = ORIGINAL_TZ;
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
