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
// independently: the first minute whose Eastern calendar date is that day.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
