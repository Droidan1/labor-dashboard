// Hamilton Beach is a HOME brand (small kitchen appliances), not Hardlines.
//
// Brian corrected this on 2026-08-10 after spotting it in the Retail Summary
// store tab. The same domain fact was encoded in THREE places, all disagreeing
// with each other:
//
//   1. L3_TO_L2["FG BL HAMILTON BEACH"] = "Home"      ← correct
//   2. L3_TO_L2["Hamilton Beach"]       = "Hardlines" ← wrong
//   3. the "HAMILTON BEACH" token inside the Hardlines name heuristic, twice
//      (main line-item loop + the cross-day refund-attribution mirror)
//
// So the SAME product booked to a different L2 depending only on which Clover
// category string the store happened to attach — and an item with no category
// at all booked to a third answer. That is the "silent default" failure mode
// again: nothing errors, the money just lands in the wrong bucket.
//
// This drives worker.fetch on ?action=items-hour (a real route that returns
// aggregateItemSales' output verbatim) with Clover stubbed, so it tests the
// WIRING, not a regex-extracted copy of the table.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

const worker = await loadWorker(repo);
const { env } = makeEnv(repo);
env.BL1_MERCHANT_ID = 'TESTMERCHANT';
env.BL1_API_TOKEN = 'test-token';

const HOUR = 12;
const { dateStr } = (() => {
  const d = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  return { dateStr: d };
})();

// itemCatMap is Clover's item-id → category-name join, fetched from /items.
// Stubbing it here is what lets us aim a line item at a specific L3 string.
function stubClover({ lineItems, itemCategories = {} }) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('/orders')) {
      return json({ elements: [{
        id: 'o1', state: 'locked', total: lineItems.reduce((s, li) => s + li.price, 0),
        createdTime: Date.now(),
        payments: { elements: [{ id: 'p1', amount: lineItems.reduce((s, li) => s + li.price, 0), taxAmount: 0, createdTime: Date.now() }] },
        lineItems: { elements: lineItems },
      }] });
    }
    if (u.includes('/refunds')) return json({ elements: [] });
    if (u.includes('/credits')) return json({ elements: [] });
    if (u.includes('/items')) {
      return json({ elements: Object.entries(itemCategories).map(([id, cat]) => ({
        id, categories: { elements: [{ id: 'c-' + cat, name: cat }] },
      })) });
    }
    throw new Error('unexpected outbound fetch: ' + u.slice(0, 120));
  };
}

// Returns L2 -> [l3 row labels] for the stubbed hour.
async function l2For(lineItems, itemCategories) {
  stubClover({ lineItems, itemCategories });
  const r = await worker.fetch(
    req(`/?action=items-hour&store=BL1&date=${dateStr}&hour=${HOUR}`, { user: 'u-su' }), env, ctx);
  const body = JSON.parse(await r.text());
  if (r.status !== 200) throw new Error(`items-hour ${r.status}: ${JSON.stringify(body).slice(0, 200)}`);
  const out = {};
  for (const c of body.categories || []) out[c.category] = (c.l3Rows || []).map(x => x.l3);
  return out;
}

const li = (id, name, price = 5000) => ({ id: 'l-' + id, name, price, unitQty: 1000, item: { id } });

// ── 1 · both Clover category spellings must agree ────────────────────────
{
  const cats = await l2For(
    [li('i1', 'Toaster 2-Slice'), li('i2', 'Hand Mixer')],
    { i1: 'FG BL HAMILTON BEACH', i2: 'Hamilton Beach' },
  );
  ok(!!cats['Home'], 'a Hamilton Beach item books to Home');
  ok(!cats['Hardlines'], `nothing booked to Hardlines, got ${JSON.stringify(cats['Hardlines'] || null)}`);
  ok((cats['Home'] || []).includes('FG BL HAMILTON BEACH'), 'long-form category lands in Home');
  ok((cats['Home'] || []).includes('Hamilton Beach'),
     `short-form category lands in Home too, got ${JSON.stringify(cats['Home'])}`);
}

// ── 2 · the name heuristic must agree with the table ─────────────────────
// No Clover category at all -> falls through to the name regexes. This is the
// path that made an uncategorized Hamilton Beach item book to Hardlines while
// its categorized twin booked to Home.
{
  const cats = await l2For([li('i9', 'HAMILTON BEACH Blender')], {});
  ok(!!cats['Home'], `uncategorized Hamilton Beach falls to Home, got ${JSON.stringify(Object.keys(cats))}`);
  ok(!cats['Hardlines'], 'the heuristic no longer answers Hardlines');
  ok((cats['Home'] || []).includes('[Heuristic] Home'),
     `resolved by heuristic, got ${JSON.stringify(cats['Home'])}`);
}

// ── 3 · the Hardlines heuristic still works for real Hardlines ───────────
// Guards the over-correction: removing HAMILTON BEACH from that alternation
// must not have broken the tokens around it.
{
  const cats = await l2For([li('i3', 'Cordless Drill TOOL Set'), li('i4', 'Kids TOY Truck')], {});
  ok(!!cats['Hardlines'], `real Hardlines items still book to Hardlines, got ${JSON.stringify(Object.keys(cats))}`);
  ok(!cats['Home'], 'and they did not leak into Home');
}

console.log(`\ntest-category-mapping: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
