// ?action=channel-range — the Retail/BIN split summed over a date range.
//
// Drives worker.fetch with real Request objects (see lib/worker-harness.mjs for
// why nothing here regex-extracts the handler): the scoping and gate assertions
// below are only meaningful if the real routing runs them.
//
// The behaviour this endpoint exists to protect is that it returns RAW SUMS.
// The caller re-derives avgCart/avgItems/ASP from those sums. If this ever
// starts returning per-day averages, a range's numbers silently become an
// unweighted mean — a quiet Tuesday counted like a busy Saturday.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

blockNetwork();
const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);

// Two days with deliberately DIFFERENT order counts, so a correct
// order-weighted answer and a wrong average-of-averages answer diverge hard.
//   day 1: retail net 1000 / units 100 / orders 10   → cart 100.00, asp 10.00
//   day 2: retail net  100 / units  50 / orders 90   → cart   1.11, asp  2.00
// summed: net 1100 / units 150 / orders 100          → cart  11.00, asp  7.33
// unweighted mean of the two day-averages would be    cart  50.56  — wrong.
// `mixed` = orders holding both retail and bin items, counted once in EACH
// channel's order total. Combined orders must subtract it.
const snap = (r, b, mixed, orderCount) => ({
  channels: { retail: r, bin: b, ...(mixed === undefined ? {} : { mixed }) },
  ...(orderCount === undefined ? {} : { orderCount }),
});
await env.SALES_SNAPSHOTS.put('items:bl1:2026-08-01',
  snap({ net: 1000, units: 100, orders: 10 }, { net: 200, units: 40, orders: 8 }, 3));
await env.SALES_SNAPSHOTS.put('items:bl1:2026-08-02',
  snap({ net: 100, units: 50, orders: 90 }, { net: 300, units: 60, orders: 12 }, 5));
// 2026-08-03 deliberately absent — a closed day, not an error.
// A snapshot written BEFORE mixed was tracked: no `mixed` key at all.
await env.SALES_SNAPSHOTS.put('items:bl1:2026-07-20',
  snap({ net: 500, units: 25, orders: 5 }, { net: 0, units: 0, orders: 0 }));

// Pre-`mixed` snapshots that DO carry orderCount — the estimate path.
//  · 07-21: orderCount 90 sits inside [max 60, sum 100] -> use 90.
//  · 07-22: orderCount 101 EXCEEDS the sum (an order with no classifiable line
//    item counts there but in neither channel). Real shape, measured on BL2
//    2026-08-09: 302 vs 301. Must clamp DOWN to the sum, never above it.
//  · 07-23: orderCount absurdly small -> clamp UP to the larger channel count.
await env.SALES_SNAPSHOTS.put('items:bl1:2026-07-21',
  snap({ net: 600, units: 60, orders: 60 }, { net: 400, units: 40, orders: 40 }, undefined, 90));
await env.SALES_SNAPSHOTS.put('items:bl1:2026-07-22',
  snap({ net: 600, units: 60, orders: 50 }, { net: 400, units: 40, orders: 50 }, undefined, 101));
await env.SALES_SNAPSHOTS.put('items:bl1:2026-07-23',
  snap({ net: 600, units: 60, orders: 70 }, { net: 400, units: 40, orders: 30 }, undefined, 2));

const call = async (qs, user = 'u-su') =>
  worker.fetch(req(`/?action=channel-range&${qs}`, { user }), env, ctx);
const json = async (r) => JSON.parse(await r.text());

// ── the sums are order-weighted, across days, and skip missing ones ─────────
{
  const r = await call('store=BL1&from=2026-08-01&to=2026-08-03');
  const b = await json(r);
  ok(r.status === 200, `200 for an in-scope store, got ${r.status}`);
  ok(b.retail.net === 1100 && b.retail.units === 150 && b.retail.orders === 100,
     `retail sums across the range: ${JSON.stringify(b.retail)}`);
  ok(b.bin.net === 500 && b.bin.units === 100 && b.bin.orders === 20,
     `bin sums across the range: ${JSON.stringify(b.bin)}`);
  ok(b.daysRequested === 3 && b.daysWithData === 2,
     `the missing day is counted but contributes nothing: ${b.daysWithData}/${b.daysRequested}`);

  // The derivation the client performs, asserted here on the endpoint's own
  // output — this is the number a user reads off the tile.
  const cart = b.retail.net / b.retail.orders;
  ok(Math.abs(cart - 11) < 0.005, `derived avg cart is order-weighted (11.00), got ${cart.toFixed(2)}`);
  ok(Math.abs(cart - 50.56) > 1,
     'derived avg cart is NOT the unweighted mean of the per-day averages (50.56)');
  const asp = b.retail.net / b.retail.units;
  ok(Math.abs(asp - 7.3333) < 0.005, `derived ASP is unit-weighted (7.33), got ${asp.toFixed(4)}`);
  ok(b.mixed === 8, `mixed-basket orders sum across the range (3 + 5 = 8), got ${b.mixed}`);
}

// ── a snapshot predating `mixed` contributes 0, not NaN ────────────────────
{
  const b = await json(await call('store=BL1&from=2026-07-20&to=2026-07-20'));
  ok(b.mixed === 0, `a snapshot with no mixed key reads 0, got ${b.mixed}`);
  ok(b.retail.net === 500 && b.retail.orders === 5, 'the rest of that old snapshot still reads correctly');
}

// ── combinedOrders: exact where recorded, clamped estimate where not ───────
{
  const exact = await json(await call('store=BL1&from=2026-08-01&to=2026-08-02'));
  ok(exact.combinedOrders === 112,
     `with mixed recorded it is exact (10+8-3) + (90+12-5) = 112, got ${exact.combinedOrders}`);
  ok(exact.daysEstimated === 0, `neither day was estimated, got ${exact.daysEstimated}`);

  // orderCount inside the valid range -> used as-is.
  const inRange = await json(await call('store=BL1&from=2026-07-21&to=2026-07-21'));
  ok(inRange.combinedOrders === 90,
     `orderCount 90 lies in [60,100] so it is used, got ${inRange.combinedOrders}`);
  ok(inRange.daysEstimated === 1, 'that day is reported as estimated');

  // 🔑 orderCount ABOVE the two channel counts must clamp down. Without this
  // the estimate would inflate the divisor beyond what the channels can
  // possibly contain — the real BL2 shape.
  const over = await json(await call('store=BL1&from=2026-07-22&to=2026-07-22'));
  ok(over.combinedOrders === 100,
     `orderCount 101 clamps down to the sum 100, got ${over.combinedOrders}`);

  // orderCount below the larger channel count must clamp up — combined can
  // never be fewer orders than one channel alone touched.
  const under = await json(await call('store=BL1&from=2026-07-23&to=2026-07-23'));
  ok(under.combinedOrders === 70,
     `orderCount 2 clamps up to the larger channel count 70, got ${under.combinedOrders}`);

  // No orderCount at all -> the old behaviour, the naive sum.
  const none = await json(await call('store=BL1&from=2026-07-20&to=2026-07-20'));
  ok(none.combinedOrders === 5, `no orderCount falls back to the sum, got ${none.combinedOrders}`);

  // 🔑 A range spanning BOTH generations resolves each day on its own terms.
  // One blended subtraction at the end would undercount the pre-mixed days.
  const spanning = await json(await call('store=BL1&from=2026-07-20&to=2026-08-02'));
  ok(spanning.combinedOrders === 5 + 90 + 100 + 70 + 112,
     `mixed range sums per-day results (5+90+100+70+112 = 377), got ${spanning.combinedOrders}`);
  ok(spanning.daysEstimated === 4, `four of those days were estimated, got ${spanning.daysEstimated}`);
  ok(spanning.combinedOrders <= spanning.retail.orders + spanning.bin.orders,
     'combined never exceeds the two channel counts summed');
}

// 🛑 KNOWN GAP — the worker's `mixed` COUNTER is not covered here.
// Measured 2026-08-10: deleting `if (_ordCh.retail.units > 0 && _ordCh.bin.units
// > 0) _ch.mixed++` from worker.js leaves this whole file green, because every
// fixture below hands `mixed` in pre-computed and nothing here runs
// aggregateItemSales. Reaching it needs a Clover-shaped orders payload driven
// through worker.fetch; the harness blocks outbound fetch, and regex-extracting
// aggregateItemSales would drag in getCat/getL3/the category maps — the
// extraction tax this repo already paid for twice.
// Covered instead by a real-data check against production, recorded in
// tasks/channel-reconciliation.md: for a live store,
//   retail.orders + bin.orders - mixed == orders holding ≥1 classifiable item,
// computed independently from the same response's `elements`.
// If that check is ever removed, this counter has NO coverage.

// ── the COMBINED view: retail + bin as one population ──────────────────────
// Source-extracted (no DOM harness) — this pins the arithmetic that decides
// what the unfiltered Cart / Items / Orders / ASP tiles show.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const m = html.match(/const chCombined = \(t\) => \(\{[\s\S]*?\n  \}\);/);
  ok(!!m, 'chCombined exists in index.html');
  if (m) {
    const chCombined = new Function('return ' + m[0].replace(/^const chCombined = /, '').replace(/;$/, ''))();
    const c = chCombined({
      retail: { net: 1100, units: 150, orders: 100 },
      bin:    { net: 500,  units: 100, orders: 20 },
      mixed: 8, combinedOrders: 112,
    });
    ok(c.net === 1600, `combined net sums both channels, got ${c.net}`);
    ok(c.units === 250, `combined units sum both channels, got ${c.units}`);
    ok(c.orders === 112, `combined orders use the resolved count, got ${c.orders}`);
    ok(c.orders !== 120, 'combined orders is NOT the naive sum of the two channel counts');

    // The per-payload resolution rule, which decides what combinedOrders holds.
    const om = html.match(/const chOrdersOf = \(src\) => [\s\S]*?;\n/);
    ok(!!om, 'chOrdersOf exists in index.html');
    if (om) {
      const chOrdersOf = new Function('return ' + om[0].replace(/^const chOrdersOf = /, '').replace(/;\n$/, ''))();
      // channel-range already resolved it per day — trust it verbatim.
      ok(chOrdersOf({ combinedOrders: 377, retail: { orders: 1 }, bin: { orders: 1 } }) === 377,
         'a resolved combinedOrders is used as-is');
      ok(chOrdersOf({ combinedOrders: 0, retail: { orders: 9 }, bin: { orders: 9 } }) === 0,
         'a resolved ZERO is honoured, not treated as missing');
      // Live payload: single day, mixed is exact.
      ok(chOrdersOf({ retail: { orders: 100 }, bin: { orders: 20 }, mixed: 8 }) === 112,
         'a live payload subtracts its own mixed');
      // Every order mixed -> counted once.
      ok(chOrdersOf({ retail: { orders: 40 }, bin: { orders: 40 }, mixed: 40 }) === 40,
         'an all-mixed day counts each order once');
      // Never negative on nonsense input.
      ok(chOrdersOf({ retail: { orders: 1 }, bin: { orders: 1 }, mixed: 99 }) === 0,
         'a mixed count larger than the totals floors at 0');
      // Absent mixed must not produce NaN.
      ok(chOrdersOf({ retail: { orders: 3 }, bin: { orders: 2 } }) === 5,
         'absent mixed is treated as 0');
    }
  }
}

// ── a range with no snapshots at all is zeroes, never NaN ──────────────────
{
  const b = await json(await call('store=BL1&from=2020-01-01&to=2020-01-05'));
  ok(b.retail.net === 0 && b.retail.orders === 0 && b.bin.units === 0,
     `an empty range is zeroes: ${JSON.stringify(b.retail)}`);
  ok(Number.isFinite(b.retail.net) && Number.isFinite(b.bin.net),
     'an empty range is finite, not NaN');
  ok(b.daysWithData === 0, 'an empty range reports zero days with data');
}

// ── store scoping is enforced by the real routing ──────────────────────────
{
  // u-mgr1 holds BL1 only. BL1 must pass, BL2 must not.
  ok((await call('store=BL1&from=2026-08-01&to=2026-08-02', 'u-mgr1')).status === 200,
     'a BL1 manager reaches BL1');
  const s = (await call('store=BL2&from=2026-08-01&to=2026-08-02', 'u-mgr1')).status;
  ok(s === 403, `a BL1 manager is refused BL2, got ${s}`);
}

// ── the financial gate still covers it (it returns revenue) ────────────────
{
  const s = (await call('store=BL1&from=2026-08-01&to=2026-08-02', 'u-staff')).status;
  ok(s === 403, `staff (no financial visibility) is refused, got ${s}`);
}

// ── the business gate classifies it — unclassified would 403 in prod ───────
{
  const b = await json(await call('store=BL1&from=2026-08-01&to=2026-08-02', 'u-mgr1'));
  ok(b.code !== 'UNCLASSIFIED_ACTION',
     'channel-range is registered in ACTION_BUSINESS (fail-closed otherwise)');
}

// ── input validation ───────────────────────────────────────────────────────
{
  ok((await call('from=2026-08-01&to=2026-08-02')).status === 400, 'missing store is 400');
  ok((await call('store=BL1&to=2026-08-02')).status === 400, 'missing from is 400');
  ok((await call('store=BL1&from=08/01/2026&to=2026-08-02')).status === 400, 'non-ISO date is 400');
  ok((await call('store=BL1&from=2026-08-05&to=2026-08-01')).status === 400, 'from after to is 400');
  // The cap keeps one request from fanning out to unbounded KV reads.
  ok((await call('store=BL1&from=2024-01-01&to=2026-08-01')).status === 400,
     'a range over 366 days is refused');
  ok((await call('store=BL1&from=2025-08-11&to=2026-08-10')).status === 200,
     'exactly 365 days is allowed');
}

// ── the client derives from sums rather than shipping its own averages ─────
// Static source check. It cannot see wiring (see test-nav-registry.mjs for why
// that matters), and is here only for what source checks are good for: the
// endpoint returns no averages, so a client that reads `.avgCart` off the
// response would render undefined. This pins that it does not.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const fn = html.match(/const chDerive = \(x\) => \(\{[\s\S]*?\}\);/);
  ok(!!fn, 'chDerive exists in index.html');
  if (fn) {
    const chDerive = new Function('return ' + fn[0].replace(/^const chDerive = /, '').replace(/;$/, ''))();
    const d = chDerive({ net: 1100, units: 150, orders: 100 });
    ok(Math.abs(d.avgCart - 11) < 0.005, `chDerive avgCart = net/orders, got ${d.avgCart}`);
    ok(Math.abs(d.avgItems - 1.5) < 0.005, `chDerive avgItems = units/orders, got ${d.avgItems}`);
    ok(Math.abs(d.asp - 7.3333) < 0.005, `chDerive asp = net/units, got ${d.asp}`);
    const z = chDerive({ net: 0, units: 0, orders: 0 });
    ok(z.avgCart === 0 && z.avgItems === 0 && z.asp === 0, 'chDerive never divides by zero');
  }
  // The gate that made the store-card tiles inert off-today must be gone.
  ok(!/isTodayOnly/.test(html),
     'the isTodayOnly gate is gone — tiles are clickable on every range');
  ok(/data-ch="\$\{ch\}"[\s\S]{0,400}?setCardChannel/.test(html),
     'the channel tile still carries its click handler');
}

db.close?.();
console.log(`\nchannel-range: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
