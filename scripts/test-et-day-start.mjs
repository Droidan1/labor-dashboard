// Midnight Eastern: where every sales day starts.
//
// getStartOfDayET(date) is the lower bound of the Clover window for a day, and the next day's
// is its upper bound, so it decides which day every order belongs to. It used to read the UTC
// offset at noon on the day. But the clocks change at 2 am, so on the two Sundays a year they
// do, that Sunday's midnight still has Saturday's offset, and the noon reading put it an hour
// off:
//   - spring forward (2026-03-08): 04:00Z instead of 05:00Z, so Saturday 11 pm–midnight EST
//     was counted in Sunday;
//   - fall back (2026-11-01): 05:00Z instead of 04:00Z, so Sunday 12–1 am EDT was counted in
//     Saturday.
// getETToday().startOfDay read the offset at the current instant instead, which is the same
// hour wrong for the rest of those Sundays once the clocks have changed.
//
// This RUNS both functions, sliced out of worker.js, against a ground truth computed here
// independently: the first minute whose Eastern calendar date is that day. Then (§6) it
// drives the real worker and reads the window off every Clover URL it builds, because a
// right midnight is worth nothing to a caller that adds 24 hours to it.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx as workerCtx, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${a}, want ${b})`);

const src = fs.readFileSync(path.join(process.argv[2] || repo, 'worker.js'), 'utf8');
// A top-level worker function, from its declaration to the first closing brace at column 0.
// Asserted non-empty, so a rename cannot turn every check below into a check of nothing.
function fnSrc(name) {
  const i = src.indexOf(`\nfunction ${name}(`);
  const j = i < 0 ? -1 : src.indexOf('\n}\n', i);
  ok(i >= 0 && j > i, `found ${name} in worker.js`);
  return i >= 0 && j > i ? src.slice(i + 1, j + 2) : '';
}
const RealDate = Date;
let NOW = '2026-08-20T16:00:00.000Z';
class FixedDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
  static now() { return new RealDate(NOW).getTime(); }
}
// etHourSlot's formatter is a module constant, declared just above it.
const fmtSrc = (() => {
  const i = src.indexOf('\nconst ET_HOUR_SLOT_FMT = '), j = i < 0 ? -1 : src.indexOf('\n});\n', i);
  ok(i >= 0 && j > i, 'found ET_HOUR_SLOT_FMT in worker.js');
  return i >= 0 && j > i ? src.slice(i + 1, j + 5) : '';
})();
const ctx = vm.createContext({ Date: FixedDate, Intl });
vm.runInContext([fnSrc('getStartOfDayET'), fnSrc('getETToday'), fmtSrc, fnSrc('etHourSlot'), fnSrc('etHourWindow')].join('\n'), ctx);
const start = d => vm.runInContext(`getStartOfDayET(${JSON.stringify(d)})`, ctx);
const today = at => { NOW = at; return vm.runInContext('getETToday()', ctx); };

// Ground truth: the first minute whose Eastern date is `d`. Searched minute by minute over
// 03:00–06:00 UTC, which holds midnight whatever the offset, so it assumes neither 4 nor 5.
const ET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
function truth(d) {
  const t0 = RealDate.parse(d + 'T03:00:00Z');
  for (let k = 0; k <= 180; k++) if (ET.format(t0 + k * 60000) === d) return t0 + k * 60000;
  return NaN;
}
const iso = t => new RealDate(t).toISOString().slice(0, 16) + 'Z';
const dayAfter = d => new RealDate(RealDate.parse(d + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);

console.log('\n── Midnight Eastern: where a sales day starts ──');

// 1. The four clock-change Sundays of 2026–2027, and the days either side of them.
for (const [d, want, why] of [
  ['2026-03-07', '2026-03-07T05:00Z', 'Saturday before spring forward: EST'],
  ['2026-03-08', '2026-03-08T05:00Z', 'spring-forward Sunday: midnight is still EST'],
  ['2026-03-09', '2026-03-09T04:00Z', 'Monday after: EDT'],
  ['2026-10-31', '2026-10-31T04:00Z', 'Saturday before fall back: EDT'],
  ['2026-11-01', '2026-11-01T04:00Z', 'fall-back Sunday: midnight is still EDT'],
  ['2026-11-02', '2026-11-02T05:00Z', 'Monday after: EST'],
  ['2027-03-14', '2027-03-14T05:00Z', 'spring-forward Sunday 2027'],
  ['2027-11-07', '2027-11-07T04:00Z', 'fall-back Sunday 2027'],
]) eq(iso(start(d)), want, `${d} starts at ${want} (${why})`);

// 2. Every day of 2025–2028 against the ground truth.
const wrong = [];
for (let t = RealDate.parse('2025-01-01T12:00:00Z'); t < RealDate.parse('2029-01-01T12:00:00Z'); t += 864e5) {
  const d = new RealDate(t).toISOString().slice(0, 10);
  if (start(d) !== truth(d)) wrong.push(d);
}
eq(wrong.join(', ') || 'none', 'none', '🛑 every day of 2025–2028 starts at the first minute that is that date in New York');

// 3. The days tile: each ends where the next begins, so no order is in two days or in none.
//    A day is 24 hours, except the two clock-change Sundays: 23 in spring, 25 in fall.
{
  const len = d => (start(dayAfter(d)) - start(d)) / 3600000;
  eq(len('2026-03-07'), 24, 'the Saturday before spring forward is 24 hours (it lost its last hour to Sunday)');
  eq(len('2026-03-08'), 23, 'spring-forward Sunday is 23 hours');
  eq(len('2026-10-31'), 24, 'the Saturday before fall back is 24 hours (it took Sunday\'s first hour)');
  eq(len('2026-11-01'), 25, 'fall-back Sunday is 25 hours');
  const odd = [];
  for (let t = RealDate.parse('2026-01-01T12:00:00Z'); t < RealDate.parse('2028-01-01T12:00:00Z'); t += 864e5) {
    const d = new RealDate(t).toISOString().slice(0, 10), h = len(d);
    if (h !== 24) odd.push(`${d}:${h}h`);
  }
  eq(odd.join(' '), '2026-03-08:23h 2026-11-01:25h 2027-03-14:23h 2027-11-07:25h',
     'across 2026–2027 only the four clock-change Sundays are not 24 hours long');
}

// 4. getETToday(): the date, and the start of that date, whatever time of that day it is.
for (const [at, date, want, why] of [
  ['2026-03-08T15:00:00.000Z', '2026-03-08', '2026-03-08T05:00Z', 'spring-forward Sunday afternoon (the clocks changed at 2 am)'],
  ['2026-03-08T06:30:00.000Z', '2026-03-08', '2026-03-08T05:00Z', 'spring-forward Sunday 1:30 am, before the change'],
  ['2026-11-01T15:00:00.000Z', '2026-11-01', '2026-11-01T04:00Z', 'fall-back Sunday afternoon'],
  ['2026-11-01T03:30:00.000Z', '2026-10-31', '2026-10-31T04:00Z', 'fall-back Saturday 11:30 pm'],
  ['2026-08-20T16:00:00.000Z', '2026-08-20', '2026-08-20T04:00Z', 'an ordinary Thursday'],
]) {
  const t = today(at);
  eq(`${t.dateStr} ${iso(t.startOfDay)}`, `${date} ${want}`, `getETToday at ${why}`);
}

// 5. One Eastern hour (?action=items-hour): the instants etHourSlot labels as that hour.
//    Midnight + N hours on an ordinary day; on the clock-change Sundays, spring has no 2 am
//    and fall has two 1 ams, so "midnight + N hours" is an hour off from 2 am on.
{
  const win = (d, h) => {
    const [a, b] = vm.runInContext(`etHourWindow(${JSON.stringify(d)}, ${h})`, ctx);
    return `${iso(a).slice(11)}–${iso(b).slice(11)}`;
  };
  for (const [d, h, want, why] of [
    ['2026-08-20', 14, '18:00Z–19:00Z', 'an ordinary 2 pm EDT'],
    ['2026-03-08', 0, '05:00Z–06:00Z', 'spring forward: midnight EST'],
    ['2026-03-08', 2, '07:00Z–07:00Z', 'spring forward: there is no 2 am, so no orders'],
    ['2026-03-08', 3, '07:00Z–08:00Z', 'spring forward: 3 am EDT follows 1:59 am EST'],
    ['2026-03-08', 14, '18:00Z–19:00Z', 'spring forward: 2 pm EDT'],
    ['2026-11-01', 0, '04:00Z–05:00Z', 'fall back: midnight EDT'],
    ['2026-11-01', 1, '05:00Z–07:00Z', 'fall back: 1 am happens twice, EDT then EST'],
    ['2026-11-01', 2, '07:00Z–08:00Z', 'fall back: 2 am EST'],
    ['2026-11-01', 14, '19:00Z–20:00Z', 'fall back: 2 pm EST'],
  ]) eq(win(d, h), want, `hour ${h} of ${d} (${why})`);

  // Every day of 2026–2027: its 24 hours run from its midnight to the next, each hour
  // starting where the one before ends.
  const broken = [];
  for (let t = RealDate.parse('2026-01-01T12:00:00Z'); t < RealDate.parse('2028-01-01T12:00:00Z'); t += 864e5) {
    const d = new RealDate(t).toISOString().slice(0, 10);
    let at = start(d);
    for (let h = 0; h < 24; h++) {
      const [a, b] = vm.runInContext(`etHourWindow(${JSON.stringify(d)}, ${h})`, ctx);
      if (a !== at || b < a) { broken.push(`${d}T${h}`); break; }
      at = b;
    }
    if (!broken.length && at !== start(dayAfter(d))) broken.push(`${d} end`);
  }
  eq(broken.join(' ') || 'none', 'none', "🛑 every day of 2026–2027: the 24 hours tile the day, midnight to midnight, with no gap or overlap");
}

// 6. End to end: the window the REAL worker asks Clover for. worker.js runs unmodified
//    through worker.fetch() with the clock pinned and Clover stubbed; every createdTime
//    filter it sends is recorded. Expected windows come from truth(), not from the worker.
{
  const worker = await loadWorker(process.argv[2] || repo);
  const ETP = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' });
  const label = t => { const p = Object.fromEntries(ETP.formatToParts(t).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}`; };
  // [first minute labelled that Eastern hour, the minute after its last]; null if the hour
  // never happens (2 am on spring-forward Sunday).
  function hourTruth(d, h) {
    const want = `${d}T${String(h).padStart(2, '0')}`;
    let a = null, b = null;
    for (let t = truth(d); t < truth(dayAfter(d)); t += 60000) if (label(t) === want) { if (a === null) a = t; b = t + 60000; }
    return a === null ? null : [a, b];
  }
  const span = w => w ? `${iso(w[0])}–${iso(w[1])}` : 'empty';
  const dayWin = d => span([truth(d), truth(dayAfter(d))]);

  let seen = [];
  globalThis.fetch = async (u) => {
    const s = decodeURIComponent(String(u));
    if (!s.startsWith('https://api.clover.com/')) throw new Error('unexpected fetch ' + s.slice(0, 80));
    const a = s.match(/createdTime>=(\d+)/), b = s.match(/createdTime<(\d+)/);
    if (a) seen.push(b ? span([+a[1], +b[1]]) : `${iso(+a[1])}–`);
    return new Response(JSON.stringify({ elements: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  // One request at a pinned instant. Sessions are minted at that instant too, since the
  // worker checks their expiry against the same clock.
  async function ask(now, url, opts) {
    NOW = now; globalThis.Date = FixedDate;
    const { env } = makeEnv(repo);
    env.BL1_MERCHANT_ID = 'M'; env.BL1_API_TOKEN = 'T';
    seen = [];
    const r = await worker.fetch(req(url, typeof opts === 'function' ? opts(env) : opts), env, workerCtx);
    let body = {}; try { body = await r.json(); } catch {}
    return { status: r.status, body, windows: [...new Set(seen)] };
  }
  const THU = '2026-11-05T15:00:00.000Z';

  // sales-diag: [midnight, next midnight), both bounds sent. The same three lines compute
  // the window in snapshot, items-snapshot, backfill-category-orders and hourly.
  for (const d of ['2026-03-07', '2026-03-08', '2026-03-09', '2026-10-31', '2026-11-01', '2026-11-02']) {
    const r = await ask(THU, `/?action=sales-diag&store=BL1&date=${d}`, env => ({ secret: env.SNAPSHOT_SECRET }));
    eq(`${r.status} ${r.windows.join(' ')}`, `200 ${dayWin(d)}`, `sales-diag asks Clover for ${d} midnight to midnight`);
  }

  // items-hour: one Eastern hour, as etHourSlot labels it.
  for (const [d, h] of [['2026-03-08', 1], ['2026-03-08', 2], ['2026-03-08', 3], ['2026-03-08', 14],
                        ['2026-11-01', 0], ['2026-11-01', 1], ['2026-11-01', 2], ['2026-11-01', 14]]) {
    const r = await ask(THU, `/?action=items-hour&store=BL1&date=${d}&hour=${h}`, { user: 'u-su' });
    const want = hourTruth(d, h), got = r.windows.map(w => { const [a, b] = w.split('–'); return a === b ? 'empty' : w; });
    eq(`${r.status} ${got.join(' ')}`, `200 ${span(want)}`, `items-hour asks for hour ${h} of ${d} and nothing else`);
  }

  // 🛑 bank-transactions WRITES the archive, and a banked day is permanent once Clover has
  // forgotten it. It used to end each day 24 hours after it began: an hour of Monday banked
  // into spring-forward Sunday, and fall-back Sunday's last hour banked nowhere. Dry run.
  {
    const r = await ask(THU, '/?action=bank-transactions&store=BL1&start=2026-10-31&end=2026-11-02', { user: 'u-su', method: 'POST' });
    eq(`${r.status} ${r.body.dry} ${r.body.days}`, '200 true 3', 'bank-transactions over the fall-back weekend: a dry run of 3 days');
    eq(r.windows.join(' '), ['2026-10-31', '2026-11-01', '2026-11-02'].map(dayWin).join(' '),
       '🛑 bank-transactions banks each day midnight to midnight across the fall-back weekend');
    const s = await ask(THU, '/?action=bank-transactions&store=BL1&start=2026-03-07&end=2026-03-09', { user: 'u-su', method: 'POST' });
    eq(s.windows.join(' '), ['2026-03-07', '2026-03-08', '2026-03-09'].map(dayWin).join(' '),
       '🛑 bank-transactions banks each day midnight to midnight across the spring-forward weekend');
    // Its day list stepped 24 hours from the first midnight: across spring forward the steps
    // land at 1 am, past the last day's midnight, so that day was dropped.
    for (const [a, b, n] of [['2026-03-08', '2026-03-10', 3], ['2026-03-01', '2026-03-10', 10], ['2026-10-25', '2026-11-03', 10]]) {
      const q = await ask(THU, `/?action=bank-transactions&store=BL1&start=${a}&end=${b}`, { user: 'u-su', method: 'POST' });
      eq(q.body.days, n, `bank-transactions ${a}…${b} covers all ${n} days`);
    }
  }

  // transactions: the same day, read live while Clover still holds it.
  for (const [now, d] of [['2026-03-12T15:00:00.000Z', '2026-03-07'], ['2026-03-12T15:00:00.000Z', '2026-03-08'],
                          ['2026-03-12T15:00:00.000Z', '2026-03-09'], [THU, '2026-10-31'], [THU, '2026-11-01'], [THU, '2026-11-02']]) {
    const r = await ask(now, `/?action=transactions&store=BL1&date=${d}`, { user: 'u-su' });
    eq(`${r.status} ${r.windows.join(' ')}`, `200 ${dayWin(d)}`, `transactions reads ${d} midnight to midnight`);
  }

  // items for today: from getETToday().startOfDay, all day long on the clock-change Sundays.
  for (const now of ['2026-03-08T06:30:00.000Z', '2026-03-08T20:00:00.000Z', '2026-11-01T05:30:00.000Z', '2026-11-01T20:00:00.000Z']) {
    const r = await ask(now, '/?action=items&store=BL1', { user: 'u-su' });
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new RealDate(now));
    eq(`${r.status} ${r.windows.join(' ')}`, `200 ${iso(truth(d))}–`, `today's items at ${now} are counted from ${d} midnight`);
  }
  globalThis.Date = RealDate;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
