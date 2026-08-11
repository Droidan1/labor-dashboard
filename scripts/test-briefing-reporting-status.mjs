// reportingStatus on the Morning Briefing API — §4.1 of the Chief of Staff work
// order (tasks/chief-of-staff-api-plan.md).
//
// WHAT THIS PROTECTS. A store that stops syncing and a store that sold nothing
// both arrived as `netSales: 0`, so a Clover outage was reported to management
// every morning as a store emergency. Measured against prod 2026-08-11:
// BL8/Holland's last successful snapshot was 2026-07-24 and it had carried
// total=0 with snapshot_time NULL every day since — 18 days of a real outage
// served as a real zero.
//
// WHY IT DRIVES worker.fetch. A test that regex-extracts classifyReportingStatus
// would prove the classifier's arithmetic and nothing about whether
// buildMorningBriefingData actually calls it, or whether the endpoint still
// leaks the stored 0 through some other field. Wiring is the thing that broke;
// wiring is what gets tested. Only the platform is stubbed (D1 over real
// sqlite, KV, outbound network).
//
// The row shapes below are not invented — each is a population counted in prod:
//   snapshot_time set ........ every healthy store-day
//   total=0, no snapshot ..... 187 rows, incl. all 20 of BL8's dark days
//   total>0, no snapshot ..... 137 rows of Sheet-sourced actuals (Jan 2026)
//   auction>0, no snapshot ... 22 rows from the Drive auction feed
//   is_manual_override=1 ..... 272 rows, all with snapshot_time set
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const KEY = 'test-briefing-key';

// Yesterday in ET, derived exactly as buildMorningBriefingData does.
const todayET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const _y = new Date(todayET + 'T12:00:00Z');
_y.setUTCDate(_y.getUTCDate() - 1);
const yesterdayET = _y.toISOString().slice(0, 10);

const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
env.MORNING_BRIEFING_KEY = KEY;
blockNetwork();

// Own the table outright so the assertion set is exactly the row shapes below —
// makeEnv seeds a today-dated row per store, and a UTC/ET boundary could land
// that on the very date under test.
db.exec('DELETE FROM daily_sales');
const ins = db.prepare(
  `INSERT INTO daily_sales (store, date, total, auction, budget, order_count, snapshot_time, is_manual_override)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);

// BL1  healthy: Clover wrote the row.
ins.run('BL1', yesterdayET, 5844.78, 156.5, 8605, 322, '2026-08-11T03:55:00Z', 0);
// BL2  the BL8 outage shape: the Sheet's literal 0, no Clover snapshot.
ins.run('BL2', yesterdayET, 0, null, 4556, null, null, 0);
// BL4  Sheet-sourced actuals from before the Clover cron covered the day.
ins.run('BL4', yesterdayET, 3314.19, null, 3291, null, null, 0);
// BL8  Holland — PERMANENTLY CLOSED 2026-07-25. It can no longer stand in for
//      any other state, which is why the auction-only clause moved to its own
//      block at the end of this file.
ins.run('BL8', yesterdayET, 0, null, 4174, null, null, 0);
// BL14 admin typed the numbers in because Clover lost them. The pos/auction
// pair is BL14's real 2026-08-10 figures, kept because 4981.8 + 130.64 is the
// exact sum that floated to 5112.4400000000005 and shipped that way live.
ins.run('BL14', yesterdayET, 4981.8, 130.64, 3939, 279, null, 1);
// BL16 no row at all for the date — deliberately not inserted.

const res = await worker.fetch(
  new Request('https://api.retjghub.com/?action=morning-briefing', { headers: { 'X-API-Key': KEY } }),
  env, ctx
);
eq(res.status, 200, 'endpoint returns 200 with a valid key');
const body = await res.json();
const by = Object.fromEntries((body.stores || []).map(s => [s.storeId, s]));

// ── The spec's hard requirement: present on EVERY store, always ────────────
const VALID = new Set(['reported', 'no_data', 'closed']);
eq(body.stores.length, 6, 'every store appears, including the one with no row');
for (const code of ['BL1', 'BL2', 'BL4', 'BL8', 'BL14', 'BL16']) {
  const s = by[code];
  ok(s != null, `${code} present in the response`);
  ok(s && VALID.has(s.reportingStatus), `${code} reportingStatus is one of the three values (got ${JSON.stringify(s?.reportingStatus)})`);
}

// ── reported: something in the row vouches for the figure ─────────────────
eq(by.BL1.reportingStatus, 'reported', 'snapshot_time set → reported');
eq(by.BL1.netSales, 6001.28, 'reported store keeps its real net (pos + auction)');
eq(by.BL1.transactions, 322, 'reported store keeps its transaction count');

eq(by.BL4.reportingStatus, 'reported', 'Sheet-sourced total > 0 with no snapshot → reported, not no_data');
eq(by.BL4.netSales, 3314.19, 'Sheet-sourced actuals survive classification');

// Holland: closed, so a real 0 — NOT the null a dark store gets.
eq(by.BL8.reportingStatus, 'closed', 'a permanently closed store reads closed');
eq(by.BL8.netSales, 0, 'a closed day reports a true 0, per the spec');
eq(by.BL8.transactions, 0, 'and zero transactions, not null');
eq(by.BL8.budgetForSalesDate, 4174, 'while still carrying its budget — the miss is deliberate');

eq(by.BL14.reportingStatus, 'reported', 'is_manual_override → reported');
eq(by.BL14.netSales, 5112.44, 'netSales is rounded to cents, not 5112.4400000000005');
ok(String(by.BL14.netSales).length <= 7, 'no float noise reaches the wire');

// ── no_data: the regression that started all of this ──────────────────────
// This is the exact BL8/Holland shape. If any of these four come back as 0 or
// as "reported", the outage is being served as a real zero again.
eq(by.BL2.reportingStatus, 'no_data', 'stored 0 with no snapshot → no_data');
eq(by.BL2.netSales, null, 'no_data netSales is null, NOT 0');
eq(by.BL2.posSales, null, 'no_data posSales is null, NOT 0');
eq(by.BL2.transactions, null, 'no_data transactions is null, NOT 0');
ok(by.BL2.budgetForSalesDate === 4556, 'no_data still carries its budget — the plan is known even when the actual is not');

eq(by.BL16.reportingStatus, 'no_data', 'missing row → no_data');
eq(by.BL16.netSales, null, 'missing row netSales is null');
ok(by.BL16.storeId === 'BL16', 'missing-row store is still returned, not omitted');

// Only stores in the closure map may read closed — a trading store wrongly
// marked closed would have its zero read as correct.
ok(body.stores.filter(s => s.storeId !== 'BL8').every(s => s.reportingStatus !== 'closed'),
   'no TRADING store is classified closed');

// ── Baseline: the existing contract is unchanged ──────────────────────────
// §2 of the work order — existing consumers must not need a code change.
for (const k of ['generatedAt', 'salesDate', 'todayDate', 'currency', 'stores']) {
  ok(k in body, `envelope keeps top-level "${k}"`);
}
eq(body.salesDate, yesterdayET, 'salesDate is still yesterday ET');
eq(body.currency, 'USD', 'currency unchanged');
for (const k of ['storeId', 'name', 'salesDate', 'netSales', 'posSales', 'auctionSales',
                 'budgetForSalesDate', 'todayBudget', 'laborActualPct', 'transactions',
                 'grossMargin', 'categories']) {
  ok(k in by.BL1, `store object keeps "${k}"`);
}
eq(by.BL1.name, 'Coliseum', 'store label unchanged');
eq(by.BL1.laborActualPct, null, 'laborActualPct stays null — no labour source exists');

// ── Auth is still the gate ────────────────────────────────────────────────
const noKey = await worker.fetch(new Request('https://api.retjghub.com/?action=morning-briefing'), env, ctx);
eq(noKey.status, 401, 'missing key → 401');
eq((await noKey.json()).error, 'Unauthorized', 'missing key → {"error":"Unauthorized"}');
const badKey = await worker.fetch(
  new Request('https://api.retjghub.com/?action=morning-briefing', { headers: { 'X-API-Key': 'wrong-key-same-len' } }),
  env, ctx
);
eq(badKey.status, 401, 'wrong key → 401');

// ══ The auction-only clause, in its own fixture ═══════════════════════════
// `auction > 0` with no POS snapshot is real money from the Drive feed — 22
// such rows in prod — and must classify as `reported`. This used to ride on
// BL8, which is now permanently closed and short-circuits before any evidence
// is examined, so it needs a store that is not in the closure map.
{
  const { db: db2, env: env2 } = makeEnv(repo);
  env2.MORNING_BRIEFING_KEY = KEY;
  db2.exec('DELETE FROM daily_sales');
  db2.prepare(`INSERT INTO daily_sales (store, date, total, auction, budget, order_count, snapshot_time, is_manual_override)
               VALUES ('BL2', ?, 0, 430.25, 4174, null, null, 0)`).run(yesterdayET);
  const r2 = await worker.fetch(
    new Request('https://api.retjghub.com/?action=morning-briefing', { headers: { 'X-API-Key': KEY } }), env2, ctx);
  const b2 = (await r2.json()).stores.find(s => s.storeId === 'BL2');
  eq(b2.reportingStatus, 'reported', 'auction revenue with no POS snapshot → reported');
  eq(b2.netSales, 430.25, 'auction-only day reports its auction revenue');
  eq(b2.posSales, 0, 'with a 0 POS component');
}

// NOTE for Slice B: the `closed` branch cannot be exercised through this
// endpoint — it iterates ALL_STORES, which excludes closed BL12. store-history
// takes an arbitrary storeId, so the closed-day assertion belongs in that
// suite. Do not delete STORE_CLOSED_FROM in the meantime.

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
