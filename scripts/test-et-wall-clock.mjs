// A scheduled post goes out at the Eastern time that was picked.
//
// The Content Tracker's "Schedule post" box sends a wall-clock time ("2026-11-01T02:30",
// Eastern) to ?action=draft-schedule, and etWallClockToUtc turns it into the instant the
// cron publishes at. It used to read New York's offset once, at the wall time taken as
// UTC: 4–5 hours before the real instant. On the two Sundays a year the clocks change,
// that reading lands before the change, so a post set for 3:00–6:59 am in spring went
// out an hour late, and 2:00–5:59 am in fall an hour early.
//
// This RUNS the function, sliced out of worker.js, against a ground truth computed here
// by search (§1–§2), then drives the real endpoint and reads back what it stored (§3).
//
// §4 does the same for the page's own conversion, etLocalToDate, which turns a sale's start
// and end in the inventory sale scheduler into instants. It must read a time exactly as the
// worker does, to the millisecond.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, ctx as workerCtx, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tree = process.argv[2] || repo;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${a}, want ${b})`);

const src = fs.readFileSync(path.join(tree, 'worker.js'), 'utf8');
// A top-level worker function, from its declaration to the first closing brace at column 0.
// Asserted non-empty, so a rename cannot turn every check below into a check of nothing.
const i = src.indexOf('\nfunction etWallClockToUtc('), j = i < 0 ? -1 : src.indexOf('\n}\n', i);
ok(i >= 0 && j > i, 'found etWallClockToUtc in worker.js');
const vmCtx = vm.createContext({ Date, Intl });
vm.runInContext(i >= 0 && j > i ? src.slice(i + 1, j + 2) : '', vmCtx);
const convert = w => { const d = vmCtx.etWallClockToUtc?.(w, 'America/New_York'); return d ? d.getTime() : null; };

// What New York's clock shows at instant t, as "YYYY-MM-DDTHH:MM".
const NY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const shows = t => { const p = Object.fromEntries(NY.formatToParts(t).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };
const iso = t => t == null ? 'null' : new Date(t).toISOString().slice(0, 16) + 'Z';
// Ground truth, worked the other way round: read New York's clock at every quarter-hour instant
// of the period, and index the instants by what it shows. New York's offsets are whole hours,
// so every wall time on the hour it ever shows is shown at one of these instants. This assumes
// neither offset, and shares no code with the function under test.
const byReading = new Map();
for (let t = Date.parse('2024-12-31T00:00:00Z'); t < Date.parse('2029-01-02T00:00:00Z'); t += 900000) {
  const w = shows(t);
  if (!byReading.has(w)) byReading.set(w, []);
  byReading.get(w).push(t);
}
const instantsShowing = w => byReading.get(w) || [];
const hourLater = w => new Date(Date.parse(w + ':00Z') + 3600000).toISOString().slice(0, 16);

console.log('\n── Scheduled posts: an Eastern wall-clock time to an instant ──');

// 1. The two clock-change Sundays of 2026, hour by hour through the hours that change.
for (const [w, want, why] of [
  ['2026-03-08T01:30', '2026-03-08T06:30Z', 'spring forward: 1:30 am is still EST'],
  ['2026-03-08T02:30', '2026-03-08T07:30Z', 'spring forward: 2:30 am never happens, so it is 3:30 EDT (as JavaScript\'s Date reads it)'],
  ['2026-03-08T03:00', '2026-03-08T07:00Z', 'spring forward: 3 am EDT'],
  ['2026-03-08T06:59', '2026-03-08T10:59Z', 'spring forward: 6:59 am EDT'],
  ['2026-03-08T07:00', '2026-03-08T11:00Z', 'spring forward: 7 am EDT'],
  ['2026-11-01T00:30', '2026-11-01T04:30Z', 'fall back: 12:30 am EDT'],
  ['2026-11-01T01:30', '2026-11-01T05:30Z', 'fall back: 1:30 am happens twice; the first, EDT'],
  ['2026-11-01T02:00', '2026-11-01T07:00Z', 'fall back: 2 am EST'],
  ['2026-11-01T05:59', '2026-11-01T10:59Z', 'fall back: 5:59 am EST'],
  ['2026-11-01T06:00', '2026-11-01T11:00Z', 'fall back: 6 am EST'],
  ['2026-08-20T09:00', '2026-08-20T13:00Z', 'an ordinary summer morning'],
  ['2026-01-20T09:00', '2026-01-20T14:00Z', 'an ordinary winter morning'],
]) eq(iso(convert(w)), want, `${w} ET is ${want} (${why})`);
eq(convert('nope'), null, 'a malformed time is refused, not guessed');

// 2. Every hour of 2025–2028 (the clocks only ever change on the hour). A wall time New York
//    shows once is that instant; one it shows twice is the first; one it never shows (spring's
//    2 am) is the hour after it.
{
  const wrong = [], missing = new Set(), repeated = new Set();
  for (let t = Date.parse('2025-01-01T00:00:00Z'); t < Date.parse('2029-01-01T00:00:00Z'); t += 3600000) {
    const w = new Date(t).toISOString().slice(0, 16), at = instantsShowing(w), got = convert(w);
    if (at.length === 0) missing.add(w.slice(0, 10));
    if (at.length > 1) repeated.add(w.slice(0, 10));
    const good = at.length ? got === at[0] : shows(got) === hourLater(w);
    if (!good) wrong.push(`${w}→${iso(got)}`);
  }
  eq(wrong.slice(0, 6).join(' ') || 'none', 'none', '🛑 every hour of 2025–2028 converts to the instant New York shows as that time');
  // The search itself: the hour that never happens is on the spring-forward Sundays, and the
  // one that happens twice on the fall-back Sundays, and nowhere else.
  eq([...missing].join(' '), '2025-03-09 2026-03-08 2027-03-14 2028-03-12', 'the ground truth finds 2 am missing on exactly the spring-forward Sundays');
  eq([...repeated].join(' '), '2025-11-02 2026-11-01 2027-11-07 2028-11-05', 'and 1 am repeated on exactly the fall-back Sundays');
}

// 3. End to end: POST ?action=draft-schedule on the REAL worker (Clover and Facebook are not
//    touched), then read the scheduled_at it stored. The clock is pinned before both
//    Sundays so every time is in the future.
{
  const worker = await loadWorker(tree);
  const RealDate = Date, NOW = '2026-02-01T15:00:00.000Z';
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
    static now() { return new RealDate(NOW).getTime(); }
  };
  try {
    const { db, env } = makeEnv(repo);
    db.exec(fs.readFileSync(path.join(repo, 'migration-021.sql'), 'utf8'));
    applyMigrationAlters(db, repo);   // migration-024 adds scheduled_at and the retry columns
    db.prepare(`INSERT INTO marketing_drafts (id, store, thumbnail_id, photo_ids, status, created_at, updated_at)
                VALUES (1, 'BL1', 7, '[]', 'draft', ?, ?)`).run(NOW, NOW);
    for (const [w, want] of [['2026-03-08T02:30', '2026-03-08T07:30Z'], ['2026-03-08T04:00', '2026-03-08T08:00Z'],
                             ['2026-11-01T01:30', '2026-11-01T05:30Z'], ['2026-11-01T03:00', '2026-11-01T08:00Z'],
                             ['2026-08-20T09:00', '2026-08-20T13:00Z']]) {
      const r = await worker.fetch(req('/?action=draft-schedule', { user: 'u-su', method: 'POST',
        body: { id: 1, et_wall_clock: w, tz: 'America/New_York', publish_live: false } }), env, workerCtx);
      const body = await r.json().catch(() => ({}));
      const row = db.prepare('SELECT status, scheduled_at FROM marketing_drafts WHERE id = 1').get();
      eq(`${r.status} ${iso(Date.parse(body.scheduled_at))} ${row.status} ${iso(Date.parse(row.scheduled_at))}`,
         `200 ${want} scheduled ${want}`, `a post scheduled for ${w} ET is stored to publish at ${want}`);
    }
  } finally { globalThis.Date = RealDate; }
}

// 4. The inventory sale scheduler: etLocalToDate, sliced out of index.html. It used to bisect
//    towards the minute and return the first instant it hit inside it, so 9:00 became
//    9:00:08; and near New Year, where it weighed every month as 31 days, December 31 sorted
//    after January 1 and the search ran the wrong way, up to two hours.
{
  const html = fs.readFileSync(path.join(tree, 'index.html'), 'utf8');
  const a = html.indexOf('\n  function etLocalToDate('), b = a < 0 ? -1 : html.indexOf('\n  }\n', a);
  ok(a >= 0 && b > a, 'found etLocalToDate in index.html');
  const pageCtx = vm.createContext({ Date, Intl });
  vm.runInContext(a >= 0 && b > a ? html.slice(a + 1, b + 4) : '', pageCtx);
  const page = w => { const d = pageCtx.etLocalToDate?.(w); return d ? d.getTime() : null; };
  const exact = t => t == null ? 'null' : new Date(t).toISOString();   // to the millisecond
  for (const [w, want, why] of [
    ['2026-08-20T09:00', '2026-08-20T13:00:00.000Z', 'an ordinary summer morning, to the second'],
    ['2026-01-20T09:00', '2026-01-20T14:00:00.000Z', 'an ordinary winter morning'],
    ['2026-03-08T02:30', '2026-03-08T07:30:00.000Z', 'spring forward: the missing 2:30 is 3:30 EDT, as the worker reads it'],
    ['2026-03-08T03:00', '2026-03-08T07:00:00.000Z', 'spring forward: 3 am EDT'],
    ['2026-11-01T01:30', '2026-11-01T05:30:00.000Z', 'fall back: the repeated 1:30 is the first, EDT, as the worker reads it'],
    ['2026-11-01T02:00', '2026-11-01T07:00:00.000Z', 'fall back: 2 am EST'],
    ['2026-12-31T23:45', '2027-01-01T04:45:00.000Z', "11:45 pm on New Year's Eve"],
    ['2027-01-01T00:00', '2027-01-01T05:00:00.000Z', "midnight on New Year's Day"],
  ]) {
    eq(exact(page(w)), want, `the sale scheduler reads ${w} ET as ${want} (${why})`);
    eq(exact(page(w)), exact(convert(w)), `...the same instant the worker (etWallClockToUtc) reads ${w} as`);
  }
  eq(page(''), null, 'an empty time is refused, not guessed');

  // Against the same ground truth the worker is held to in §2, so the two agree on every hour.
  const wrong = [];
  for (let t = Date.parse('2026-01-01T00:00:00Z'); t < Date.parse('2028-01-01T00:00:00Z'); t += 3600000) {
    const w = new Date(t).toISOString().slice(0, 16), at = instantsShowing(w), got = page(w);
    if (at.length ? got !== at[0] : shows(got) !== hourLater(w)) wrong.push(`${w}→${exact(got)}`);
  }
  eq(wrong.slice(0, 4).join(' ') || 'none', 'none', '🛑 every hour of 2026–2027: the sale scheduler reads the exact instant New York shows as that time, as the worker does');
  const newYear = [];
  for (let t = Date.parse('2026-12-31T20:00:00Z'); t < Date.parse('2027-01-01T04:00:00Z'); t += 60000) {
    const w = new Date(t).toISOString().slice(0, 16), got = page(w);
    if (shows(got) !== w || got % 60000) newYear.push(w);
  }
  eq(newYear.length ? `${newYear.length} from ${newYear[0]}` : 'none', 'none',
     "every minute from 8 pm on New Year's Eve to 4 am on New Year's Day is read as itself, on the minute");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
