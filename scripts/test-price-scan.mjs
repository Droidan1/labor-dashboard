// Price Scan — one item in a warehouse, priced, driven through the real endpoints.
//
// The warehouse counterpart of the Manifest Scorer. What matters here is not that it
// returns a number, but that:
//
//   1. A HUMAN'S CORRECTION IS PERMANENT. Retail coverage is ~40%; the tool only becomes
//      reliable if every gap an admin fills stays filled. The retail lookup overwrites
//      item_cache.retail_price on every run, so an override MUST live somewhere it cannot
//      reach — the same failure shape as the l3Map override and the stale vendor template.
//   2. THE CACHE ANSWERS FREE. Only a genuinely new item may cost an API call, or the
//      spend scales with how much gets scanned instead of falling as the library grows.
//   3. IT PRICES THE SAME AS THE SCORER. One ladder, or a buyer scores a load at one
//      number and the floor prices it at another.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, ctx, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, m) => ok(a !== null && Math.abs(a - b) < 0.05, `${m} (got ${JSON.stringify(a)}, want ~${b})`);

const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
for (const m of ['migration-041.sql', 'migration-042.sql', 'migration-043.sql'])
  db.exec(fs.readFileSync(path.join(repo, m), 'utf8'));
applyMigrationAlters(db, repo);

// Every outbound call is stubbed and COUNTED — "did this cost anything" is an assertion
// here, not a hope. The response shapes are the REAL ones: the price parser answers
// { prices }, the classifier answers { rows: [{ row, category }] }, and the name expander
// answers { items } — three different contracts behind one endpoint.
let searchCalls = 0, modelCalls = 0;
let searchResults = [];
let snippetPrices = [];
let classifyL3 = null;
globalThis.fetch = async (u, init) => {
  const url = String(u);
  if (url.startsWith('https://api.search.tinyfish.ai')) {
    searchCalls++;
    return new Response(JSON.stringify({ results: searchResults }), { status: 200 });
  }
  if (url.startsWith('https://api.fetch.tinyfish.ai')) {
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  }
  if (url.startsWith('https://api.firecrawl.dev')) {
    return new Response('{"error":"not in this test"}', { status: 402 });
  }
  if (url.includes('api.anthropic.com')) {
    modelCalls++;
    const body = JSON.parse(init.body);
    const sys = body.system || '';
    if (/expand abbreviated/i.test(sys)) {
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"items":[]}' }] }), { status: 200 });
    }
    if (/category/i.test(sys) && /rows/.test(sys)) {
      const rows = classifyL3 ? [{ row: 1, category: classifyL3, confidence: 'high' }] : [];
      return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ rows }) }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ prices: snippetPrices }) }] }), { status: 200 });
  }
  throw new Error('unexpected egress: ' + url.slice(0, 70));
};
env.ANTHROPIC_API_KEY = 'sk-test';
env.TINYFISH_API_KEY = 'tf-test';

const call = async (url, opts) => {
  const r = await worker.fetch(req(url, opts), env, ctx);
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = { _raw: t.slice(0, 200) }; }
  return { status: r.status, body };
};
const post = (action, body, user = 'u-su') => call(`/?action=${action}`, { user, method: 'POST', body });

const SNACKS = 'FG BL CONSUMABLES - FOOD - SNACKS';

// Criteria the scan prices against: half dollars, 50% cap, 30% floor.
await post('merch-criteria-draft', { cells: [
  { category: null, field: 'price_cap_pct_retail', value: '50' },
  { category: null, field: 'min_gross_margin_pct', value: '30' },
  { category: 'Consumable Food', field: 'rounding', value: '$0.50' },
]});
await post('merch-criteria-publish', { note: 'scan test criteria' });
env.SALES_SNAPSHOTS.put('category-costs:global', JSON.stringify({ costs: { [SNACKS]: 0.81 } }));

console.log('Price Scan');

// ── An unknown item is looked up once, then remembered ──────────────────────
{
  searchCalls = 0; modelCalls = 0;
  searchResults = [{ position: 1, url: 'https://www.walmart.com/ip/cheezit', title: 'Cheez-It Original 12.4 oz', snippet: '$4.28' }];
  snippetPrices = [{ url: 'https://www.walmart.com/ip/cheezit', price: 4.28, title: 'Cheez-It Original 12.4 oz', pack: 1, in_stock: true, sold_by: 'Walmart.com' }];
  classifyL3 = SNACKS;

  const r = await post('merch-scan', { identifier: '024100113163', description: 'Cheez-It Original 12.4 oz' });
  eq(r.status, 200, 'a scan answers');
  near(r.body.retail, 4.28, 'street retail is found');
  eq(r.body.l3, SNACKS, '…and a category is suggested');
  near(r.body.cost, 0.81, '…and our cost for that category is attached');
  // $4.28 x 50% = $2.14, rounded UP to the next half dollar.
  near(r.body.price, 2.50, '🔑 priced by the SAME ladder as the Scorer — $2.14 rounds up to $2.50');
  eq(r.body.price_basis, 'street retail', '…and says what the price came from');
  ok(r.body.gp_pct > 60, `…with the GP stated (got ${r.body.gp_pct}%)`);
  eq(r.body.below_gp_floor, false, '…clearing the 30% floor');
  eq(r.body.looked_up, true, 'the first scan of an unknown item does a lookup');
  ok(searchCalls > 0, '…which costs a search');
}

// ── 💰 The same item again costs NOTHING ────────────────────────────────────
{
  const before = { s: searchCalls, m: modelCalls };
  const r = await post('merch-scan', { identifier: '024100113163' });
  eq(r.status, 200, 'a repeat scan answers');
  eq(r.body.from_cache, true, '🔑 …from cache');
  eq(r.body.looked_up, false, '…without looking anything up');
  eq(searchCalls, before.s, '💰 zero further searches');
  eq(modelCalls, before.m, '💰 zero further model calls');
  near(r.body.price, 2.50, '…and prices identically');
  near(r.body.retail, 4.28, '…on the same retail');
  eq(r.body.l3, SNACKS, '…and the same category, with no re-classification');
}

// ── 🛑 A human's retail price SURVIVES a later lookup ───────────────────────
// The failure this whole design exists to prevent: item_cache.retail_price is overwritten
// unconditionally by every retail run, so an override stored there would vanish the next
// time any manifest containing that UPC was priced.
{
  const sv = await post('merch-scan-save', { identifier: '024100113163', retail_price: 6.00 });
  eq(sv.status, 200, 'an admin can correct the retail price');

  const r = await post('merch-scan', { identifier: '024100113163' });
  near(r.body.retail, 6.00, "the correction is what the next scan reads");
  eq(r.body.retail_overridden, true, '…and the screen knows it was set by hand');
  near(r.body.price, 3.00, '🔑 …and the PRICE moves with it — $6.00 x 50% = $3.00');

  // Now run the manifest retail lookup over the same UPC, which is what used to wipe it.
  const CSV = ['UPC,Item Description,Qty,Unit Cost', '024100113163,Cheez-It Original,10,0.50', ''].join('\n');
  const up = await post('manifest-upload', { vendor: 'ClobberCo', csv: CSV });
  await post('manifest-retail', { id: up.body.id });

  const after = await post('merch-scan', { identifier: '024100113163' });
  near(after.body.retail, 6.00, "🛑 the override SURVIVES a full retail run — this is the l3Map bug's shape");
  const row = db.prepare(`SELECT retail_price, retail_price_override, retail_override_by FROM item_cache WHERE identifier='024100113163'`).get();
  near(row.retail_price_override, 6.00, 'the override lives in its own column');
  ok(row.retail_override_by, '…attributed to whoever set it');
  ok(row.retail_price !== null, '…and what the machine found is still kept beside it, not erased');
}

// ── A price override wins over the ladder, and is still judged ──────────────
{
  await post('merch-scan-save', { identifier: '024100113163', suggested_price: 1.00 });
  const r = await post('merch-scan', { identifier: '024100113163' });
  near(r.body.price, 1.00, 'a hand-set price is used verbatim');
  eq(r.body.price_overridden, true, '…and says so');
  // $1.00 against 81c of cost is 19% GP — a person may set it, but it is still reported.
  eq(r.body.below_gp_floor, true, '🔑 …and is STILL measured against the floor, not exempted');
}

// ── Clearing an override hands the item back to the lookup ─────────────────
{
  await post('merch-scan-save', { identifier: '024100113163', retail_price: null, suggested_price: null });
  const r = await post('merch-scan', { identifier: '024100113163' });
  eq(r.body.retail_overridden, false, 'an emptied override is gone');
  eq(r.body.price_overridden, false, '…for the price too');
  near(r.body.retail, 4.28, '…and the looked-up figure is back, because it was never erased');
}

// ── A category set by hand is never re-guessed ──────────────────────────────
{
  const ORAL = 'FG BL CONSUMABLES - HBA - ORAL';
  await post('merch-scan-save', { identifier: '024100113163', l3: ORAL });
  classifyL3 = SNACKS;                       // the model would say something else
  const r = await post('merch-scan', { identifier: '024100113163' });
  eq(r.body.l3, ORAL, "🔑 the human's category stands");
  eq(r.body.l3_source, 'manual', '…and is marked as theirs');
}

// ── Bad input is refused, not stored ────────────────────────────────────────
{
  eq((await post('merch-scan', {})).status, 400, 'a scan with neither barcode nor description is refused');
  eq((await post('merch-scan-save', { retail_price: 5 })).status, 400, 'an override with no barcode is refused');
  eq((await post('merch-scan-save', { identifier: '024100113163', retail_price: -2 })).status, 400,
     'a negative price is refused');
  eq((await post('merch-scan-save', { identifier: '024100113163', l3: 'Not A Category' })).status, 400,
     'an unknown category is refused');
}

// ── Managers may use it; staff may not, yet ─────────────────────────────────
{
  eq((await post('merch-scan', { identifier: '111' }, 'u-mgr1')).status, 200, 'a manager may scan');
  eq((await post('merch-scan', { identifier: '111' }, 'u-staff')).status, 403, 'staff may not, yet');
  eq((await post('merch-scan-save', { identifier: '111', retail_price: 5 }, 'u-staff')).status, 403,
     '…and certainly may not override a price');
  // 🔑 Scanning and OVERRIDING are different rights. A manager prices items all day; only
  // an admin may permanently change what an item is worth for every store, forever.
  eq((await post('merch-scan-save', { identifier: '111', retail_price: 5 }, 'u-mgr1')).status, 403,
     '🔑 a manager may scan but may NOT set a permanent override');
  eq((await post('merch-scan-save', { identifier: '024100113163', retail_price: 5 }, 'u-admin')).status, 200,
     '…an admin may');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
