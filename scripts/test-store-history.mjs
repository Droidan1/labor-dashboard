// ?action=store-history — §4.2 of the Chief of Staff work order.
//
// Driven through worker.fetch with only the platform stubbed, for the reason
// the whole harness exists: the interesting failures here are wiring, not
// arithmetic. A gap-filler that is never called, a clamp that the handler skips,
// and a key gate that a new endpoint forgot all look identical to correct code
// when you test the builder in isolation.
//
// The three failure modes this is built around, all measured against prod:
//   • D1 holds budget rows through 2026-12-26 with a literal `total = 0` in
//     every one. An unclamped range serves months of phantom zeros as sales.
//   • BL8/Holland has carried total=0 with snapshot_time NULL since 2026-07-24.
//     Every one of those days must come back no_data with a NULL net.
//   • Per-day gross margin lives in KV. At the 400-day cap that is 2,400 KV
//     reads — past Cloudflare's 1,000-subrequest ceiling. The endpoint must
//     touch KV zero times, so it cannot 500 exactly when the most history is
//     asked for.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const KEY = 'test-briefing-key';

const todayET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const back = (n) => {
  const d = new Date(todayET + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const yesterdayET = back(1);

const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
env.MORNING_BRIEFING_KEY = KEY;
blockNetwork();

// Count KV reads so the "no per-day margin" design decision is enforced, not
// merely commented. This is the assertion that fails if someone later wires
// grossMargin straight in.
let kvReads = 0;
const realGet = env.SALES_SNAPSHOTS.get;
env.SALES_SNAPSHOTS.get = async (...a) => { kvReads++; return realGet(...a); };

db.exec('DELETE FROM daily_sales');
const ins = db.prepare(
  `INSERT INTO daily_sales (store, date, total, auction, budget, order_count, snapshot_time, is_manual_override)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
// BL1: four healthy days — but deliberately NO row at back(3), so the gap-fill
// has something to fill.
ins.run('BL1', back(1), 5844.78, 156.5, 8605, 322, '2026-08-11T03:55:44Z', 0);
// back(2) carries BL14's real 2026-08-10 pos/auction pair: 4981.8 + 130.64 is
// the exact sum that floated to 5112.4400000000005 in the live response.
ins.run('BL1', back(2), 4981.8, 130.64, 8100, 300, '2026-08-10T03:55:44Z', 0);
ins.run('BL1', back(4), 5100.00, null, 8200, 310, '2026-08-08T03:55:44Z', 0);
ins.run('BL1', back(5), 4700.00, null, 8000, 295, '2026-08-07T03:55:44Z', 0);
// BL2: the outage shape on every day of the window. Deliberately NOT BL8 —
// Holland is permanently closed as of 2026-07-25, so it now classifies as
// `closed` and can no longer stand in for a non-reporting store.
for (let n = 1; n <= 5; n++) ins.run('BL2', back(n), 0, null, 4174, null, null, 0);
// TODAY and a FUTURE date, both with the Sheet's literal 0 and a real budget.
// Neither may appear in any response — this is the phantom-zero trap.
for (const s of ['BL1', 'BL2']) {
  ins.run(s, todayET, 0, null, 9999, null, null, 0);
  ins.run(s, back(-30), 0, null, 8888, null, null, 0);
}
// BL12: closed, and addressable only by explicit storeId.
ins.run('BL12', back(1), 0, null, 3905, null, null, 0);

const call = (qs, headers = { 'X-API-Key': KEY }) =>
  worker.fetch(new Request('https://api.retjghub.com/?action=store-history' + qs, { headers }), env, ctx);

// ── Envelope and defaults ─────────────────────────────────────────────────
const t0 = Date.now();
let res = await call('');
const elapsed = Date.now() - t0;
eq(res.status, 200, 'default request returns 200');
const body = await res.json();
ok(!Array.isArray(body), 'response is an envelope, never a bare array');
for (const k of ['generatedAt', 'currency', 'from', 'to', 'days', 'stores']) {
  ok(k in body, `envelope carries "${k}"`);
}
eq(body.currency, 'USD', 'currency is USD');
eq(body.days, 30, 'days defaults to 30');
eq(body.to, yesterdayET, 'range ENDS yesterday ET');
eq(body.from, back(30), 'range starts 30 days back');
eq(body.stores.length, 6, 'all six trading stores by default');
ok(!body.stores.some(s => s.storeId === 'BL12'), 'closed BL12 is not in the default set');
ok(elapsed < 3000, `default request inside the 3 s budget (took ${elapsed} ms; in-memory sqlite, not a prod latency proof)`);

// ── Newest first, no gaps ─────────────────────────────────────────────────
const bl1 = body.stores.find(s => s.storeId === 'BL1');
eq(bl1.name, 'Coliseum', 'store label present');
eq(bl1.days.length, 30, 'every day in the range is emitted, not just the days with rows');
eq(bl1.days[0].date, yesterdayET, 'newest date first');
ok(bl1.days[0].date > bl1.days[1].date, 'dates descend');
const seen = bl1.days.map(d => d.date);
eq(new Set(seen).size, 30, 'no duplicate dates');
let contiguous = true;
for (let i = 0; i < 30; i++) if (seen[i] !== back(i + 1)) contiguous = false;
ok(contiguous, 'the series is contiguous — no calendar day is skipped');

// ── Today and the future never appear ─────────────────────────────────────
ok(!seen.includes(todayET), 'today is excluded — still being collected');
ok(!seen.some(d => d > yesterdayET), 'no future date appears');
ok(!JSON.stringify(body).includes('9999'), "today's budget never leaks into the series");
ok(!JSON.stringify(body).includes('8888'), 'a future budget row never leaks into the series');

// ── Day shape ─────────────────────────────────────────────────────────────
for (const k of ['date', 'netSales', 'budget', 'grossMargin', 'transactions', 'reportingStatus']) {
  ok(k in bl1.days[0], `day object carries "${k}"`);
}
const VALID = new Set(['reported', 'no_data', 'closed']);
ok(bl1.days.every(d => VALID.has(d.reportingStatus)), 'reportingStatus set on EVERY day, never null');

// ── Values ────────────────────────────────────────────────────────────────
const d1 = Object.fromEntries(bl1.days.map(d => [d.date, d]));
eq(d1[back(1)].reportingStatus, 'reported', 'day with a snapshot is reported');
eq(d1[back(1)].netSales, 6001.28, 'netSales is pos + auction, matching morning-briefing');
eq(d1[back(1)].budget, 8605, 'budget passed through');
eq(d1[back(1)].transactions, 322, 'transactions passed through');
eq(d1[back(2)].netSales, 5112.44, 'netSales is rounded to cents, not 5112.4400000000005');
eq(d1[back(3)].reportingStatus, 'no_data', 'the missing row is filled as no_data');
eq(d1[back(3)].netSales, null, 'filled gap has a null net, NOT 0');
eq(d1[back(3)].budget, null, 'filled gap has no budget to report');
eq(d1[back(10)].reportingStatus, 'no_data', 'a date entirely outside the seeded data is still emitted');

const dark = body.stores.find(s => s.storeId === 'BL2');
ok(dark.days.slice(0, 5).every(d => d.reportingStatus === 'no_data'), 'a non-reporting store reads no_data on every day');
ok(dark.days.slice(0, 5).every(d => d.netSales === null), 'and never reports a 0 net');
ok(dark.days.slice(0, 5).every(d => d.budget === 4174), 'a no_data day still carries its budget');

// Holland: permanently closed on 2026-07-25. The default 30-day window spans
// that date, so this is a BOUNDARY test — days on or after it are `closed` with
// a real 0, days before it have no row and are `no_data` with a null. Getting
// the comparison off by one would show up here as a whole day on the wrong side.
const hol = body.stores.find(s => s.storeId === 'BL8');
const CLOSED_FROM = '2026-07-25';
const after = hol.days.filter(d => d.date >= CLOSED_FROM);
const before = hol.days.filter(d => d.date < CLOSED_FROM);
ok(after.length > 0, 'the window includes days after the closure date');
ok(after.every(d => d.reportingStatus === 'closed'), 'every day on/after the closure date reads closed');
ok(after.every(d => d.netSales === 0), 'a closed day reports a true 0, never null');
ok(after.every(d => d.transactions === 0), 'and zero transactions, not null');
if (before.length) {
  ok(before.every(d => d.reportingStatus === 'no_data'),
     'days BEFORE the closure date are not retroactively closed');
  ok(before.every(d => d.netSales === null), 'and still report null rather than 0');
}
// The whole point of the three-way enum: these must not collapse into each other.
ok(dark.days[0].netSales === null && after[0].netSales === 0,
   'closed (0) and no_data (null) are distinguishable in the same response');

// ── The `closed` branch — unreachable from morning-briefing, tested here ──
res = await call('&storeId=BL12&days=3');
eq(res.status, 200, 'a closed store is addressable by explicit storeId');
const closed = (await res.json()).stores[0];
eq(closed.storeId, 'BL12', 'the requested store is the one returned');
ok(closed.days.every(d => d.reportingStatus === 'closed'), 'every day past the closure date is closed');
eq(closed.days[0].netSales, 0, 'a closed day reports a true 0, not null');

// ── storeId filter, and 404 ───────────────────────────────────────────────
res = await call('&storeId=BL1&days=7');
const one = await res.json();
eq(one.stores.length, 1, 'storeId filter returns exactly one store');
eq(one.stores[0].storeId, 'BL1', 'and it is the requested one');
eq(one.stores[0].days.length, 7, 'days honoured alongside the filter');
res = await call('&storeId=bl1&days=7');
eq((await res.json()).stores[0].storeId, 'BL1', 'storeId is case-insensitive');

res = await call('&storeId=BL99');
eq(res.status, 404, 'unknown storeId → 404');
eq((await res.json()).error, 'Unknown storeId', '404 carries a machine-readable reason');

// ── days clamping ─────────────────────────────────────────────────────────
res = await call('&days=9999&storeId=BL1');
eq(res.status, 200, 'days above the cap returns the cap, NOT an error');
const capped = await res.json();
eq(capped.days, 400, 'clamped to the 400-day cap');
eq(capped.stores[0].days.length, 400, 'and emits exactly that many days');
for (const [qs, want, why] of [['&days=0', 1, 'zero clamps up to 1'],
                               ['&days=-5', 1, 'negative clamps up to 1'],
                               ['&days=abc', 30, 'unparseable falls back to the default'],
                               ['', 30, 'absent falls back to the default']]) {
  res = await call(qs + '&storeId=BL1');
  eq((await res.json()).days, want, why);
}

// ── The subrequest ceiling: KV is never touched ───────────────────────────
kvReads = 0;
res = await call('&days=400');
eq(res.status, 200, '400 days across all stores still returns 200');
eq(kvReads, 0, 'the endpoint reads KV zero times — 400 days x 6 stores would be 2,400 subrequests');

// ── Auth and method, the same gate morning-briefing uses ──────────────────
res = await call('', {});
eq(res.status, 401, 'missing key → 401');
eq((await res.json()).error, 'Unauthorized', 'missing key → {"error":"Unauthorized"}');
res = await call('', { 'X-API-Key': 'wrong-key-same-len!!' });
eq(res.status, 401, 'wrong key → 401');
res = await worker.fetch(
  new Request('https://api.retjghub.com/?action=store-history', { method: 'POST', headers: { 'X-API-Key': KEY } }), env, ctx);
eq(res.status, 405, 'POST → 405; these endpoints are read-only');

// The shared gate is shared — prove the refactor did not loosen the neighbour.
res = await worker.fetch(new Request('https://api.retjghub.com/?action=morning-briefing'), env, ctx);
eq(res.status, 401, 'morning-briefing still 401s without a key after the gate was extracted');

// ── The business gate must know about the new action ──────────────────────
// Not decorative: ACTION_BUSINESS is fail-closed, and an unlisted action is
// refused. Asserted through a real request rather than by reading the map.
res = await call('&storeId=BL1&days=1');
eq(res.status, 200, 'store-history is routable — registered in ACTION_BUSINESS');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
