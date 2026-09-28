// "Yesterday" is the calendar day before today, in Eastern time.
//
// Seven places in the worker took yesterday as the Eastern date of "now minus 24 hours",
// and five then stepped further back in 24-hour jumps. A clock-change Sunday is 23 or 25
// hours long, so 24 hours back from a time near midnight lands on the wrong date: yesterday
// was wrong for an hour after each change, and a 7- to 364-day window skipped or repeated a
// date for an hour on every day it reached back across one. The worker now counts by the
// calendar: getETYesterday(), and addDaysYmd() back from it.
//
// §1 runs the two helpers, sliced out of worker.js, under a pinned clock against a calendar
// built here. §2 drives the real worker at the edge hours and reads which dates each place
// actually used: the item snapshots it read, and the dates it bound into its sales query.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, req, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tree = process.argv[2] || repo;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${a}, want ${b})`);

const src = fs.readFileSync(path.join(tree, 'worker.js'), 'utf8');
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
const vmCtx = vm.createContext({ Date: FixedDate, Intl });
vm.runInContext(['getStartOfDayET', 'getETToday', 'addDaysYmd', 'getETYesterday'].map(fnSrc).join('\n'), vmCtx);
const yesterdayAt = at => { NOW = at; return vmCtx.getETYesterday?.(); };

// The calendar, built here by counting days, and the Eastern date at an instant.
const DAYS = [];
for (let t = RealDate.UTC(2024, 0, 1); t <= RealDate.UTC(2029, 11, 31); t += 86400000) DAYS.push(new RealDate(t).toISOString().slice(0, 10));
const AT = new Map(DAYS.map((d, i) => [d, i]));
const calendar = (d, n) => DAYS[AT.get(d) + n];
const window_ = (end, n) => DAYS.slice(AT.get(end) - n + 1, AT.get(end) + 1).join(' ');   // n days ending `end`
const ET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });

console.log('\n── Yesterday, by the Eastern calendar ──');

// 1. The helpers.
for (const [at, want, why] of [
  ['2026-03-09T04:30:00.000Z', '2026-03-08', 'Monday 12:30 am EDT after spring forward: Sunday (24 hours back is Saturday 11:30 pm)'],
  ['2026-11-02T04:30:00.000Z', '2026-10-31', 'fall-back Sunday 11:30 pm EST: Saturday (24 hours back is still Sunday, 12:30 am)'],
  ['2026-03-08T16:00:00.000Z', '2026-03-07', 'spring-forward Sunday at noon'],
  ['2026-11-01T16:00:00.000Z', '2026-10-31', 'fall-back Sunday at noon'],
  ['2026-08-20T16:00:00.000Z', '2026-08-19', 'an ordinary Thursday'],
  ['2027-01-01T05:30:00.000Z', '2026-12-31', 'New Year\'s Day, 12:30 am'],
  ['2028-03-01T05:30:00.000Z', '2028-02-29', 'the day after a leap day'],
]) eq(yesterdayAt(at), want, `yesterday at ${at} is ${want} (${why})`);
{
  const wrong = [];
  for (let t = RealDate.parse('2026-01-01T00:30:00Z'); t < RealDate.parse('2027-01-01T00:00:00Z'); t += 3600000) {
    const at = new RealDate(t).toISOString();
    if (yesterdayAt(at) !== calendar(ET.format(t), -1)) wrong.push(at);
  }
  eq(wrong.slice(0, 4).join(' ') || 'none', 'none', '🛑 every hour of 2026, both clock changes included: yesterday is the calendar day before the Eastern date');
  const off = [];
  for (const d of DAYS.slice(AT.get('2025-01-01'), AT.get('2029-01-01')))
    for (const n of [-364, -28, -7, -6, -1, 0, 1, 7]) if (vmCtx.addDaysYmd?.(d, n) !== calendar(d, n)) off.push(`${d}${n}`);
  eq(off.slice(0, 4).join(' ') || 'none', 'none', 'addDaysYmd counts calendar days across 2025–2028, leap days and year ends included');
}

// 2. End to end. The worker runs unmodified through worker.fetch() and worker.scheduled(),
//    with the clock pinned and the network blocked. Recorded: every item snapshot read, and
//    what every query bound. Expected dates come from the calendar above.
{
  const worker = await loadWorker(tree);
  blockNetwork();
  function envAt(now) {
    NOW = now; globalThis.Date = FixedDate;              // sessions are minted on the same clock
    const { db, env } = makeEnv(repo);
    for (const m of ['migration-041.sql', 'migration-042.sql', 'migration-043.sql', 'migration-044.sql',
                     'migration-045.sql', 'migration-046.sql', 'migration-047.sql', 'migration-052.sql', 'migration-053.sql'])
      { try { db.exec(fs.readFileSync(path.join(repo, m), 'utf8')); } catch (_) {} }
    applyMigrationAlters(db, repo);
    const reads = [], bound = [];
    const kvGet = env.SALES_SNAPSHOTS.get;
    env.SALES_SNAPSHOTS.get = (k, o) => { reads.push(k); return kvGet(k, o); };
    const prepare = env.DB.prepare;
    env.DB.prepare = sql => {
      const s = prepare.call(env.DB, sql), bind = s.bind;
      s.bind = (...a) => { bound.push({ sql, a }); return bind(...a); };
      return s;
    };
    return { env, reads, bound };
  }
  const call = async (env, url, opts) => {
    const r = await worker.fetch(req(url, opts), env, { waitUntil: () => {}, passThroughOnException: () => {} });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  // The distinct days whose item snapshots were read, oldest first.
  const snapshotDays = reads => [...new Set(reads.map(k => /^items:[a-z0-9]+:(\d{4}-\d{2}-\d{2})$/.exec(k)?.[1]).filter(Boolean))].sort().join(' ');
  const firstBind = (bound, fragment) => (bound.find(b => b.sql.includes(fragment)) || { a: [] }).a.join(' ');
  const today = at => ET.format(new RealDate(at));

  try {
    // merch-velocity: a 7- to 364-day window of item snapshots, ending yesterday.
    for (const [at, win] of [['2026-03-09T04:30:00.000Z', 7], ['2026-03-14T04:30:00.000Z', 7],
                             ['2026-11-16T04:30:00.000Z', 28], ['2026-09-28T04:30:00.000Z', 364]]) {
      const { env, reads } = envAt(at);
      const r = await call(env, `/?action=merch-velocity&window=${win}`, { user: 'u-su' });
      const end = calendar(today(at), -1);
      eq(`${r.status} ${r.body.start}…${r.body.end}`, `200 ${calendar(end, 1 - win)}…${end}`, `merch-velocity (${win} days) at ${at} ends yesterday`);
      eq(snapshotDays(reads), window_(end, win), `🛑 merch-velocity (${win} days) at ${at} reads each of its ${win} days once, and no others`);
    }

    // merch-coverage: the same, once core categories exist to measure.
    for (const [at, win] of [['2026-03-09T04:30:00.000Z', 7], ['2026-11-16T04:30:00.000Z', 28]]) {
      const { env, reads } = envAt(at);
      await call(env, '/?action=merch-criteria-draft', { user: 'u-su', method: 'POST',
        body: { cells: [{ category: 'Consumable Food', field: 'core', value: '1' }] } });
      await call(env, '/?action=merch-criteria-publish', { user: 'u-su', method: 'POST', body: { note: 'core' } });
      reads.length = 0;
      const r = await call(env, `/?action=merch-coverage&window=${win}`, { user: 'u-su' });
      const end = calendar(today(at), -1);
      eq(`${r.status} ${r.body.start}…${r.body.end}`, `200 ${calendar(end, 1 - win)}…${end}`, `merch-coverage (${win} days) at ${at} ends yesterday`);
      eq(snapshotDays(reads), window_(end, win), `🛑 merch-coverage (${win} days) at ${at} reads each of its ${win} days once, and no others`);
    }

    // The 28-day ASP-velocity table (read here by furniture-bands): its cache key and its days.
    for (const at of ['2026-03-09T04:30:00.000Z', '2026-11-16T04:30:00.000Z']) {
      const { env, reads } = envAt(at);
      const r = await call(env, '/?action=furniture-bands', { user: 'u-su' });
      const end = calendar(today(at), -1);
      eq(`${r.status} ${reads.find(k => k.startsWith('asp-velocity:'))}`, `200 asp-velocity:28:${end}`, `the ASP table at ${at} is cached under yesterday`);
      eq(snapshotDays(reads), window_(end, 28), `🛑 the ASP table at ${at} is built from the 28 days ending yesterday`);
    }

    // send-weekly-digest, by hand, with no dates given: the seven days ending yesterday.
    const DIGEST = 'FROM daily_sales WHERE date >= ? AND date <= ?';
    for (const at of ['2026-03-09T04:30:00.000Z', '2026-03-14T04:30:00.000Z']) {
      const { env, bound } = envAt(at);
      await call(env, '/?action=send-weekly-digest', { user: 'u-su', method: 'POST' });
      const end = calendar(today(at), -1);
      eq(firstBind(bound, DIGEST), `${calendar(end, -6)} ${end}`, `send-weekly-digest at ${at} covers the seven days ending yesterday`);
    }

    // The crons: at their own fire times, and when run by hand just after midnight.
    const cron = async (at, name) => {
      const { env, bound } = envAt(at);
      const waits = [];
      await worker.scheduled({ cron: name, scheduledTime: RealDate.parse(at) }, env,
        { waitUntil: p => waits.push(Promise.resolve(p).catch(() => {})), passThroughOnException: () => {} });
      await Promise.all(waits);
      return bound;
    };
    for (const at of ['2026-03-09T12:00:00.000Z', '2026-11-02T12:00:00.000Z', '2026-03-09T04:30:00.000Z']) {
      const bound = await cron(at, '0 12 * * *');
      eq(firstBind(bound, 'FROM daily_sales WHERE date = ? AND (total IS NOT NULL'), calendar(today(at), -1),
         `the daily summary run at ${at} reports on yesterday`);
    }
    for (const at of ['2026-03-15T11:00:00.000Z', '2026-11-08T11:00:00.000Z', '2026-03-15T04:30:00.000Z']) {
      const bound = await cron(at, '0 11 * * 1');
      const end = calendar(today(at), -1);
      eq(firstBind(bound, DIGEST), `${calendar(end, -6)} ${end}`, `the weekly digest run at ${at} covers the Sunday–Saturday just ended`);
    }
  } finally { globalThis.Date = RealDate; }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
