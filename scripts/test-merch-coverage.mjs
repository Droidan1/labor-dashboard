// The Coverage scorecard, driven through the real endpoint.
//
// This page's job is to say "is core covered?" and turn the gap between shelf and sales
// into buy/cut signals. The properties worth pinning are the ones that decide whether a
// number on it can be trusted:
//
//   1. EVERY UNIT LANDS SOMEWHERE. Shares are only meaningful if the buckets partition
//      the sales — a unit dropped on the floor silently inflates every other share.
//   2. A MISSING SHELF COUNT IS NEVER ZERO. Zero bays is a real reading that means
//      "cut this"; a store that has not counted must not be told to cut anything.
//   3. TODAY IS NOT IN THE WINDOW. The nightly cron has not written it yet, and counting
//      a partial day as a real one is the phantom-recoverable bug all over again.
//   4. THE CHAIN IS SUMMED, NOT AVERAGED. A mean of six store percentages weights the
//      smallest store equally with the biggest.
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

const FOOD = 'Consumable Food', HBA = 'Consumable HBA';
const COFFEE = 'FG BL CONSUMABLES - FOOD - COFFEE & TEA';
const SNACKS = 'FG BL CONSUMABLES - FOOD - SNACKS';
const NONCORE = '__non_core__';
const OTHER_FOOD = '__other__:' + FOOD;

// ET date strings the endpoint will look for: yesterday backwards.
const etDay = (back) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
  .format(new Date(Date.now() - (back + 1) * 86400e3));

// One day's item snapshot for a store, in the shape mergeItemSnapshots expects.
function snap(store, day, l2rows) {
  env.SALES_SNAPSHOTS.put(`items:${store.toLowerCase()}:${day}`, JSON.stringify({
    orderCount: 10,
    categories: Object.entries(l2rows).map(([category, l3s]) => ({
      category, qty: Object.values(l3s).reduce((a, b) => a + b, 0), netSales: 0,
      l3Rows: Object.entries(l3s).map(([l3, qty]) => ({ l3, qty, netSales: 0 })),
    })),
  }));
}

console.log('Merchandising — Coverage scorecard');

// ── Before any criteria exist, the page says so rather than inventing a zero ──
{
  const { body } = await get('merch-coverage');
  eq(body.categories.length, 0, 'nothing to measure before core is defined');
  ok(/no criteria published/i.test(body.note || ''), '...and it says why');
}

// Publish: Consumable Food core (whole), Consumable HBA core, Coffee & Tea counted alone.
await post('merch-criteria-draft', { cells: [
  { category: FOOD, field: 'core', value: '1' },
  { category: HBA,  field: 'core', value: '1' },
  { category: COFFEE, field: 'core', value: '1' },
]});
await post('merch-criteria-publish', { note: 'v1 — core defined' });

// ── The universe partitions the floor, and carries a non-core denominator ────
{
  const { body } = await get('merch-coverage');
  const keys = body.categories.map(c => c.key);
  ok(keys.includes(COFFEE), 'the separately-counted L3 is a row');
  ok(keys.includes(OTHER_FOOD), 'the remainder of its core parent is a row');
  ok(keys.includes(HBA), 'a core L2 with no named children is a row');
  ok(keys.includes(NONCORE), '🔑 a non-core bucket exists — the floor needs a denominator');
  eq(body.floorPct, 60, 'the floor is 60%');
}

// ── 🔑 Every unit lands in exactly one bucket ────────────────────────────────
{
  const d = etDay(0);
  snap('BL1', d, {
    [FOOD]: { [COFFEE]: 10, [SNACKS]: 30, 'FG BL CONSUMABLES - FOOD - CANDY': 20 },
    [HBA]:  { 'FG BL CONSUMABLES - HBA - ORAL': 15 },
    'Seasonal': { 'FG BL CONSUMABLES - SEASONAL - X': 25 },   // outside the core definition
    'Hardlines': { 'Some Fallback Item Name': 5 },            // an L3 with no taxonomy row
  });
  const { body } = await get('merch-coverage&window=7');
  const bl1 = body.stores.find(s => s.store === 'BL1');
  const c = bl1.cells;
  eq(c[COFFEE].units, 10, 'the named L3 takes its own units');
  eq(c[OTHER_FOOD].units, 50, 'the rest of food goes to the remainder (30 snacks + 20 candy)');
  eq(c[HBA].units, 15, 'a whole-L2 row takes all of its L3s');
  eq(c[NONCORE].units, 30, 'everything outside core lands in the non-core bucket (25 + 5)');
  const total = Object.values(c).reduce((t, x) => t + x.units, 0);
  eq(total, 105, '🔑 the buckets partition the sales — nothing dropped, nothing double-counted');
  near(c[COFFEE].salesPct, 100 * 10 / 105, 'shares are of the whole measured floor');
  near(bl1.coreSalesPct, 100 * 75 / 105, 'core share excludes the non-core bucket');
}

// ── 🛑 Today is excluded; the window ends yesterday ──────────────────────────
{
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  snap('BL2', today, { [FOOD]: { [COFFEE]: 9999 } });
  const { body } = await get('merch-coverage&window=7');
  const bl2 = body.stores.find(s => s.store === 'BL2');
  eq(bl2.cells[COFFEE].units, 0, "🛑 today's partial snapshot is not counted");
  eq(bl2.daysWithData, 0, '...and the store reads as not reporting');
  ok(body.end !== today, 'the window ends before today');
}

// ── 🛑 A store with no shelf count is not told to cut anything ───────────────
{
  const { body } = await get('merch-coverage&window=7');
  const bl1 = body.stores.find(s => s.store === 'BL1');
  eq(bl1.hasShelf, false, 'BL1 has entered no count');
  eq(bl1.cells[COFFEE].bays, null, '🛑 bays is null, NEVER zero');
  eq(bl1.cells[COFFEE].shelfPct, null, 'no shelf share without a count');
  eq(bl1.cells[COFFEE].ratio, null, 'and no ratio to act on');
  eq(bl1.cells[COFFEE].state, 'unknown', 'the cell reads unknown, not dead');
  eq(bl1.underFloor, false, 'an uncounted store is never flagged under the floor');
  ok(!(body.actions || []).some(a => a.kind === 'CUT'), '🛑 nothing is proposed for cutting on no data');
}

// ── With a count, ratios and the this-week list come alive ───────────────────
{
  const SUN = (() => { const d = new Date(); d.setUTCHours(12,0,0,0);
    d.setUTCDate(d.getUTCDate() + (7 - d.getUTCDay()) % 7); return d.toISOString().slice(0,10); })();
  // Coffee sells 10 of 105 units (9.5%) on 2 of 100 bays (2%) → starved, buy.
  // Everything-else takes 60 bays for 30 units → dead.
  const r = await post('shelf-count-save', { store: 'BL1', week_ending: SUN, counts: [
    { category: COFFEE, bays: 2 }, { category: OTHER_FOOD, bays: 30 },
    { category: HBA, bays: 8 }, { category: NONCORE, bays: 60 },
  ]});
  eq(r.status, 200, 'the count saves');

  const { body } = await get('merch-coverage&window=7');
  const bl1 = body.stores.find(s => s.store === 'BL1');
  eq(bl1.hasShelf, true, 'the store now has a count');
  near(bl1.cells[COFFEE].shelfPct, 2, 'coffee holds 2% of the floor');
  ok(bl1.cells[COFFEE].ratio > 4, `sells far above its shelf share (ratio ${bl1.cells[COFFEE].ratio})`);
  eq(bl1.cells[COFFEE].state, 'starved', '...so it reads starved');
  eq(bl1.cells[NONCORE].state, 'dead', 'the non-core block reads dead');
  near(bl1.coreShelfPct, 40, 'core holds 40% of this floor');
  eq(bl1.underFloor, true, '🔑 40% is under the 60% mark, so the store is flagged');

  const kinds = (body.actions || []).map(a => a.kind);
  ok(kinds.includes('BUY'), 'a BUY appears for the starved category');
  ok(kinds.includes('FLOOR'), 'a FLOOR appears for the under-floor store');
  eq(kinds.indexOf('BUY') < kinds.indexOf('FLOOR'), true, 'BUY sorts before FLOOR');
  ok((body.actions || []).length <= 6, 'at most six items — a longer list is no list');
  ok((body.actions || []).every(a => a.why), 'every action says why in plain numbers');
  // 🛑 the non-core bucket is a denominator, not something to act on
  ok(!(body.actions || []).some(a => a.category === NONCORE), '🛑 no action is raised on "everything else"');
}

// ── The chain is summed from units, not averaged from percentages ────────────
{
  const d = etDay(1);
  snap('BL4', d, { [FOOD]: { [COFFEE]: 1 }, 'Seasonal': { 'X': 99 } });   // tiny store, 1% coffee
  const { body } = await get('merch-coverage&window=7');
  const chain = body.chain;
  // BL1: 10/105 coffee. BL4: 1/100. A MEAN of the two store shares would be ~5.3%;
  // the correct sum-weighted figure is 11/205 = 5.37%… so use a lopsided check:
  // chain coffee units must be the SUM, which a percentage average could never produce.
  eq(chain.cells[COFFEE].units, 11, 'chain units are summed across stores');
  // FIVE, not six: Holland (BL8) closed 2026-07-25 and Merchandising plans for trading
  // stores only. Its budget still lands on the chain's financial rollups — that call was
  // made deliberately on 2026-08-11 — but it has no shelves to cover.
  eq(chain.storesTotal, 5, 'the five TRADING stores are listed; the closed one is not');
  eq(chain.storesReporting, 2, 'only the stores with snapshots count as reporting');
  eq(chain.storesCounted, 1, 'and only one has entered a shelf count');
}

// ── Access ───────────────────────────────────────────────────────────────────
{
  eq((await get('merch-coverage', 'u-admin')).status, 200, 'an admin may read the scorecard');
  eq((await get('merch-coverage', 'u-mgr1')).status, 403, '🛑 a manager may not');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
