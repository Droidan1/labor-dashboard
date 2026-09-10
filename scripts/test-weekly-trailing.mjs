/**
 * ?action=weekly-t13&weeks=N — the trailing window is a parameter now, not a
 * literal LIMIT 13. The Categories tab's month and quarter buckets are built
 * from whole weeks, so they need more than thirteen of them.
 *
 * What matters is not that N works but that N is BOUNDED: this reads one KV
 * key per store-week, and an unbounded window would walk off the subrequest
 * cliff at some range nobody tested.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

blockNetwork();
const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);

// 30 whole weeks of daily_sales so a wide window has something to return.
const STORES = ['BL1', 'BL4'];
db.prepare('DELETE FROM daily_sales').run();
const ins = db.prepare(
  'INSERT INTO daily_sales (store,date,week,total,retail,bin,auction,order_count,budget,labor_pct) VALUES (?,?,?,?,?,?,?,?,?,?)');
const DAY = 86400000;
let cursor = Date.UTC(2026, 0, 4);            // a Sunday
const WEEKS = [];
for (let w = 1; w <= 30; w++) {
  const dates = [];
  for (let i = 0; i < 7; i++) dates.push(new Date(cursor + i * DAY).toISOString().slice(0, 10));
  WEEKS.push({ week: String(w), dates });
  for (const s of STORES) for (const d of dates) ins.run(s, d, String(w), 500, 400, 100, 0, 25, 600, 12);
  cursor += 7 * DAY;
}
const LAST = WEEKS[WEEKS.length - 1].dates[6];

const call = async (qs, user = 'u-su') =>
  worker.fetch(req(`/?action=weekly-t13&${qs}`, { user }), env, ctx);
const body = async r => JSON.parse(await r.text());

/* ── The default is unchanged ──────────────────────────────────────── */
{
  const b = await body(await call(`end=${LAST}`));
  ok(b.weeks.length === 13, `no weeks param still returns 13, got ${b.weeks && b.weeks.length}`);
  ok(b.weeks[b.weeks.length - 1] === '30', `and it is the trailing 13, ending at the anchor (${b.weeks[b.weeks.length - 1]})`);
}

/* ── A wider window is honoured ────────────────────────────────────── */
{
  const b = await body(await call(`end=${LAST}&weeks=26`));
  ok(b.weeks.length === 26, `weeks=26 returns 26, got ${b.weeks.length}`);
  ok(b.weeks[0] === '5' && b.weeks[b.weeks.length - 1] === '30',
     `still anchored at the end and walking back (${b.weeks[0]}..${b.weeks[b.weeks.length - 1]})`);
  ok(b.weeks.length === new Set(b.weeks).size, 'no week is repeated');
}

/* ── And a narrower one ────────────────────────────────────────────── */
{
  const b = await body(await call(`end=${LAST}&weeks=4`));
  ok(b.weeks.length === 4, `weeks=4 returns 4, got ${b.weeks.length}`);
}

/* ── BOUNDED: the point of the exercise ────────────────────────────── */
{
  const b = await body(await call(`end=${LAST}&weeks=99999`));
  ok(b.weeks.length <= 110, `an absurd window is clamped, not honoured (${b.weeks.length})`);
  ok(b.weeks.length === 30, `and it returns every week that exists, no more (${b.weeks.length})`);

  for (const [qs, why] of [['weeks=0', 'zero'], ['weeks=-5', 'negative'], ['weeks=abc', 'not a number']]) {
    const r = await body(await call(`end=${LAST}&${qs}`));
    ok(Array.isArray(r.weeks) && r.weeks.length >= 1,
       `${why} falls back to a sane window rather than an empty answer (${r.weeks && r.weeks.length})`);
  }
}

/* ── It says which window it BUILT, not just what it returned ──────── */
{
  // The frontend cannot tell "you ignored my weeks param" from "there is only
  // that much history" by counting weeks: both are a short array. The echo is
  // what makes that distinguishable, so it has to be exact.
  const b = await body(await call(`end=${LAST}&weeks=26`));
  ok(b.weeksWindow === 26, `weeksWindow echoes the honoured window, got ${b.weeksWindow}`);

  const d = await body(await call(`end=${LAST}`));
  ok(d.weeksWindow === 13, `the default echoes 13, got ${d.weeksWindow}`);

  // 30 weeks exist, so weeks.length is 30 while the window asked for is 110.
  // The echo must report the WINDOW, not the rows — reporting the rows would
  // make a short history indistinguishable from an ignored param all over again.
  const c = await body(await call(`end=${LAST}&weeks=99999`));
  ok(c.weeksWindow === 110, `a clamped window echoes the clamp, got ${c.weeksWindow}`);
  ok(c.weeks.length === 30 && c.weeksWindow !== c.weeks.length,
     `and it is the window, not the row count (${c.weeksWindow} vs ${c.weeks.length})`);

  // A caller asking for less than exists still gets its own number back.
  const e = await body(await call(`end=${LAST}&weeks=4`));
  ok(e.weeksWindow === 4, `a narrow window echoes itself, got ${e.weeksWindow}`);
}

/* ── The payload shape is untouched at any width ───────────────────── */
{
  const b = await body(await call(`end=${LAST}&weeks=20`));
  for (const k of ['weeks', 'weeksWindow', 'dates', 'stores', 'total', 'perStoreL2Net',
                   'perStoreL2Units', 'perStoreL3Net', 'perStoreL3Units']) {
    ok(b[k] !== undefined, `weeks=20 still returns ${k}`);
  }
  ok(b.perStoreL2Net.length === b.weeks.length,
     `one per-store L2 map per week (${b.perStoreL2Net.length} vs ${b.weeks.length})`);
  ok(b.dates.length === b.weeks.length, 'and one date range per week');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
