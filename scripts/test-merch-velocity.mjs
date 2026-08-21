// Velocity and basket penetration by store and category, driven through the real endpoint.
//
// The page exists to separate two questions that raw unit counts CANNOT separate:
// "we are carrying the wrong product here" versus "our customer does not want this
// category". Store size confounds the raw number — a store doing 400 transactions a week
// and one doing 2,000 look different no matter how well either merchandises.
//
// The properties worth pinning are the ones that decide whether the diagnostic is honest:
//
//   1. UNITS AND BASKETS MUST JOIN. `l3Rows` carries the RAW Clover L3 while `l3Orders`
//      is normalised. Join them unnormalised and you get units with no baskets and
//      baskets with no units — every ratio wrong, nothing thrown.
//   2. AN L2'S BASKETS ARE NOT THE SUM OF ITS L3s'. One basket touching three L3s in the
//      same L2 is ONE basket for the L2. Summing reports penetration above 100%.
//   3. RATES ARE PER TRANSACTION, so two stores of different size are comparable at all.
//   4. THE CHAIN IS SUMMED, NOT AVERAGED, or the smallest store weighs as much as the
//      biggest.
//   5. A MISSING SHELF COUNT IS NOT ZERO BAYS — it is unknown, and every per-section
//      rate for that store must say so rather than divide by zero.
//   6. TODAY IS NOT IN THE WINDOW: the nightly cron has not written it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, ctx, req, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, m) => ok(a !== null && Math.abs(a - b) < 0.05, `${m} (got ${JSON.stringify(a)}, want ~${b})`);

blockNetwork();
const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
for (const m of ['migration-041.sql', 'migration-042.sql']) db.exec(fs.readFileSync(path.join(repo, m), 'utf8'));
applyMigrationAlters(db, repo);

const call = async (url, opts) => {
  const r = await worker.fetch(req(url, opts), env, ctx);
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = { _raw: t.slice(0, 140) }; }
  return { status: r.status, body };
};
const get  = (qs, user = 'u-su') => call(`/?action=${qs}`, { user });
const post = (action, body, user = 'u-su') => call(`/?action=${action}`, { user, method: 'POST', body });

const FOOD = 'Consumable Food';
const SNACKS = 'FG BL CONSUMABLES - FOOD - SNACKS';
const CANDY  = 'FG BL CONSUMABLES - FOOD - CANDY';

const etDay = (back) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
  .format(new Date(Date.now() - (back + 1) * 86400e3));

// One store-day, in the shape mergeItemSnapshots expects — including the basket-touch
// counters, which the velocity view is built on and which coverage never reads.
function snap(store, day, { orderCount, l3s, l2Baskets, l3Baskets }) {
  env.SALES_SNAPSHOTS.put(`items:${store.toLowerCase()}:${day}`, JSON.stringify({
    orderCount,
    categories: [{ category: FOOD, qty: Object.values(l3s).reduce((a, b) => a + b, 0), netSales: 0,
                   l3Rows: Object.entries(l3s).map(([l3, qty]) => ({ l3, qty, netSales: 0 })) }],
    l2Orders: { [FOOD]: l2Baskets },
    l3Orders: { [FOOD]: l3Baskets },
  }));
}

console.log('Merchandising — velocity & penetration');

// ── An empty window says so rather than rendering a floor of zeroes ──────────
{
  const { body } = await get('merch-velocity');
  eq(body.ok, true, 'the endpoint answers with no data at all');
  eq(body.chain.orderCount, 0, 'no transactions in the window');
  ok(/nothing can be measured/i.test(body.note || ''), '...and says why rather than showing zeroes');
}

// BL1: small store, 100 orders. BL2: big store, 500 orders, same ASSORTMENT quality.
// Snacks sells 10 units per 100 orders in BOTH; raw units say BL2 is five times better.
{
  const d = etDay(0);
  snap('BL1', d, { orderCount: 100, l3s: { [SNACKS]: 10, [CANDY]: 5 },
                   l2Baskets: 12, l3Baskets: { [SNACKS]: 8, [CANDY]: 4 } });
  snap('BL2', d, { orderCount: 500, l3s: { [SNACKS]: 50, [CANDY]: 5 },
                   l2Baskets: 60, l3Baskets: { [SNACKS]: 40, [CANDY]: 4 } });
}

// ── 🔑 Rates are per transaction, so store size stops confounding the read ───
{
  const { body } = await get('merch-velocity&window=7');
  const bl1 = body.stores.find(s => s.store === 'BL1');
  const bl2 = body.stores.find(s => s.store === 'BL2');
  eq(bl1.cells[SNACKS].units, 10, 'BL1 sold 10 snack units');
  eq(bl2.cells[SNACKS].units, 50, 'BL2 sold 50 — five times as many');
  near(bl1.cells[SNACKS].per1000, 100, '…but 100 per 1,000 transactions');
  near(bl2.cells[SNACKS].per1000, 100, '🔑 …and so does BL2 — the stores are equally good');
  near(bl1.cells[SNACKS].penetration, 8, 'BL1 snacks reach 8% of baskets');
  near(bl2.cells[SNACKS].penetration, 8, '…and BL2 the same, which raw units hid entirely');
}

// ── 🔑 Units and baskets actually joined — the two key spaces line up ────────
{
  const { body } = await get('merch-velocity&window=7');
  const bl1 = body.stores.find(s => s.store === 'BL1');
  ok(bl1.cells[SNACKS].units > 0 && bl1.cells[SNACKS].baskets > 0,
     '🔑 a category has BOTH units and baskets — the normalised join held');
  eq(bl1.cells[SNACKS].baskets, 8, 'basket count survives the join intact');
}

// ── 🔑 An L2's baskets are its own, never the sum of its children's ──────────
{
  const { body } = await get('merch-velocity&window=7');
  const bl1 = body.stores.find(s => s.store === 'BL1');
  eq(bl1.cells[FOOD].baskets, 12, '🔑 the L2 carries its OWN basket count, not 8+4=12 by accident');
  eq(bl1.cells[FOOD].units, 15, 'the L2 units ARE the sum of its children');
  ok(bl1.cells[FOOD].penetration <= 100, 'penetration can never exceed 100% of baskets');
}

// ── 🔑 The chain is summed, not averaged ─────────────────────────────────────
{
  const { body } = await get('merch-velocity&window=7');
  eq(body.chain.orderCount, 600, 'chain transactions are the sum across stores');
  eq(body.chain.cells[SNACKS].units, 60, '…and so are units');
  near(body.chain.cells[SNACKS].penetration, 8, 'chain penetration is 48/600, not the mean of two 8s');
}

// ── A store genuinely behind the chain reads as behind ───────────────────────
{
  const d = etDay(1);
  // BL4 does the same volume as BL1 but sells a third of the snacks: an ASSORTMENT
  // problem at that store, which is exactly what the chain comparison should expose.
  snap('BL4', d, { orderCount: 100, l3s: { [SNACKS]: 3 }, l2Baskets: 3, l3Baskets: { [SNACKS]: 3 } });
  const { body } = await get('merch-velocity&window=7');
  const bl4 = body.stores.find(s => s.store === 'BL4');
  near(bl4.cells[SNACKS].penetration, 3, 'BL4 snacks reach only 3% of its baskets');
  ok(bl4.cells[SNACKS].penetration < body.chain.cells[SNACKS].penetration,
     '🔑 …measurably below the chain, which is the assortment signal');
}

// ── 🔑 A missing shelf count is unknown, never zero bays ─────────────────────
{
  const { body } = await get('merch-velocity&window=7');
  const bl1 = body.stores.find(s => s.store === 'BL1');
  eq(bl1.cells[SNACKS].unitsPerBayWeek, null,
     '🔑 with no count entered, per-section velocity is unknown — not zero, not Infinity');
  eq(bl1.shelfWeek, null, '…and the store says it has no count week');
}

// ── With a count entered, per-section velocity appears ───────────────────────
{
  const wk = '2026-08-16';
  // Shelf counts are only accepted for categories the LIVE criteria call core, so the
  // definition has to exist before a count can. Worth knowing: this also means a NON-core
  // category can never have a per-section rate, because it can never have a count.
  await post('merch-criteria-draft', { cells: [{ category: SNACKS, field: 'core', value: '1' }] });
  await post('merch-criteria-publish', { note: 'snacks core' });
  const sv = await post('shelf-count-save', { store: 'BL1', week_ending: wk, counts: [{ category: SNACKS, bays: 2 }] });
  eq(sv.status, 200, 'the shelf count saves');
  const { body } = await get('merch-velocity&window=7');
  const bl1 = body.stores.find(s => s.store === 'BL1');
  eq(bl1.shelfWeek, wk, 'the entered week is reported');
  // 10 units over 2 bays across a 1-week window.
  near(bl1.cells[SNACKS].unitsPerBayWeek, 5, '10 units / 2 sections / 1 week = 5 a section a week');
}

// ── 🔑 Today is not in the window ────────────────────────────────────────────
{
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  snap('BL8', today, { orderCount: 9999, l3s: { [SNACKS]: 9999 },
                       l2Baskets: 9999, l3Baskets: { [SNACKS]: 9999 } });
  const { body } = await get('merch-velocity&window=7');
  const bl8 = body.stores.find(s => s.store === 'BL8');
  eq(bl8.orderCount, 0, "🔑 today's partial snapshot is excluded from the window");
}

// ── The window is validated, not trusted ─────────────────────────────────────
{
  eq((await get('merch-velocity&window=9')).body.window, 28, 'an unsupported window falls back to 28 days');
  eq((await get('merch-velocity&window=91')).body.window, 91, 'a supported one is honoured');
  eq((await get('merch-velocity&window=7')).body.weeks, 1, 'weeks is derived from the window');
}

// ── Non-merchandise L2s never appear ─────────────────────────────────────────
{
  const { body } = await get('merch-velocity&window=7');
  const keys = body.categories.map(c => c.key);
  ok(!keys.includes('Refund'), 'Refund is not a merchandise category');
  ok(!keys.includes('Bin Products'), 'Bin Products is not one either');
  ok(keys.includes(FOOD), '…but Consumable Food is');
}

// ── Staff cannot read it ─────────────────────────────────────────────────────
{
  eq((await get('merch-velocity', 'u-staff')).status, 403, 'staff are refused');
  eq((await get('merch-velocity', 'u-admin')).status, 200, 'admin may read');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
