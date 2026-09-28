// The Content Tracker photo library's weeks: which folder is "this week", and which
// folder each photo is filed under.
//
// Both are the STORES' retail week (Sunday to Saturday, Eastern), the week the worker
// files the automatic bin-photo post under (autoWeekOf, scripts/test-bin-photo-autodraft.mjs
// §19). Taken from the UTC date, the week turned over at 8 pm on Saturday (7 pm in winter):
// the library opened on next week's empty folder, and a closing shift's photos were filed
// under it.
//
// This RUNS the page's own functions — etTodayStr, etDayOf, ctPhotoWeekOf, ctCurrentWeekNo,
// ctShortDate and ctPhotoGroups, sliced out of index.html — under a fixed clock, and reads
// the folders ctPhotoGroups() returns. A regex over the source could not tell which
// calendar they use.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
// A top-level function of the main script: its line if it is a one-liner, else through
// the first closing brace back at its own two-space indent. Asserted non-empty, so a
// rename cannot turn every check below into a check of nothing.
function fnSrc(name) {
  const i = html.indexOf(`\n  function ${name}(`);
  if (i < 0) { ok(false, `found ${name} in index.html`); return ''; }
  const lineEnd = html.indexOf('\n', i + 1);
  const first = html.slice(i + 1, lineEnd);
  const j = first.trimEnd().endsWith('}') ? lineEnd : html.indexOf('\n  }\n', i) + 4;
  const src = html.slice(i + 1, j);
  ok(src.startsWith(`  function ${name}(`) && src.trimEnd().endsWith('}'), `found ${name} in index.html`);
  return src;
}

// The clock: `new Date()` with no argument is NOW.
const RealDate = Date;
let NOW = '2026-08-20T16:00:00.000Z';
class FixedDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
  static now() { return new RealDate(NOW).getTime(); }
}
const ctx = vm.createContext({ Date: FixedDate, Intl, ctFlowWeeks: null, ctPhotos: [] });
vm.runInContext(['etTodayStr', 'etDayOf', 'ctPhotoWeekOf', 'ctCurrentWeekNo', 'ctShortDate', 'ctPhotoGroups']
  .map(fnSrc).join('\n'), ctx);

ctx.ctFlowWeeks = [
  { retail_week: 10, week_start: '2026-03-01', week_end: '2026-03-07' },
  { retail_week: 11, week_start: '2026-03-08', week_end: '2026-03-14' },   // clocks go forward Sun 8 Mar
  { retail_week: 34, week_start: '2026-08-16', week_end: '2026-08-22' },
  { retail_week: 35, week_start: '2026-08-23', week_end: '2026-08-29' },
  { retail_week: 44, week_start: '2026-10-25', week_end: '2026-10-31' },
  { retail_week: 45, week_start: '2026-11-01', week_end: '2026-11-07' },   // clocks go back Sun 1 Nov
];
// The library at a moment: which folder is current, and which photos each folder holds.
function library(now, photos) {
  NOW = now;
  ctx.ctPhotos = photos;
  const { arr, cur } = vm.runInContext('ctPhotoGroups()', ctx);
  return { cur, folders: Object.fromEntries(arr.map(g => [g.key, g.photos.map(p => p.id)])) };
}

console.log('\n── Content Tracker · photo library weeks ──');

// Saturday 22 August, 9 pm in New York: 01:00 on Sunday in UTC.
{
  const at = library('2026-08-23T01:00:00.000Z', [
    { id: 1, created_at: '2026-08-20T16:00:00.000Z' },   // Thu noon
    { id: 2, created_at: '2026-08-23T00:30:00.000Z' },   // Sat 8:30 pm EDT, just uploaded
  ]);
  eq(at.cur, 34, 'Saturday 9 pm EDT: the library opens on the week that is ending, not the next one');
  eq(at.folders, { w34: [1, 2] }, '🛑 and the photo just uploaded is IN that folder, with the rest of the week');
}
// Sunday 23 August, 12:30 am: the new week has begun.
{
  const at = library('2026-08-23T04:30:00.000Z', [
    { id: 2, created_at: '2026-08-23T00:30:00.000Z' },   // Sat 8:30 pm EDT
    { id: 3, created_at: '2026-08-23T04:10:00.000Z' },   // Sun 12:10 am EDT
  ]);
  eq(at.cur, 35, 'Sunday 12:30 am EDT: the library opens on the new week');
  eq(at.folders, { w35: [3], w34: [2] }, "Saturday night's photo stays with its week; Sunday's starts the new one");
}
// The two clock-change weekends: the clocks change at 2 am on Sunday, after midnight.
{
  const back = library('2026-11-01T04:30:00.000Z', [
    { id: 4, created_at: '2026-11-01T03:30:00.000Z' },   // Sat 31 Oct 11:30 pm EDT
    { id: 5, created_at: '2026-11-01T04:15:00.000Z' },   // Sun 1 Nov 12:15 am EDT
  ]);
  eq(back.cur, 45, 'clocks going back: Sunday 12:30 am EDT is the new week');
  eq(back.folders, { w45: [5], w44: [4] }, 'clocks going back: 11:30 pm Saturday stays in the old week');
  const fwd = library('2026-03-08T04:30:00.000Z', [
    { id: 6, created_at: '2026-03-08T04:20:00.000Z' },   // Sat 7 Mar 11:20 pm EST
  ]);
  eq(fwd.cur, 10, 'clocks going forward: Saturday 11:30 pm EST is still the old week');
  eq(fwd.folders, { w10: [6] }, 'clocks going forward: a photo at 11:20 pm Saturday is filed in it');
}
// A weekday is untouched, and a photo with no usable time is Undated, as before.
{
  const at = library('2026-08-20T16:00:00.000Z', [
    { id: 7, created_at: '2026-08-18T14:00:00.000Z' },
    { id: 8, created_at: null },
    { id: 9, created_at: 'not a time' },
  ]);
  eq(at.cur, 34, 'a Thursday afternoon is the week it has always been');
  eq(at.folders, { w34: [7], undated: [8, 9] }, 'a photo with no usable time goes to Undated, not to a guessed week');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
