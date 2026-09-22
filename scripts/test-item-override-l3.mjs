// A per-item override can now assign an L3, not just an L2.
//
// WHY IT EXISTS: `l3Key` is chosen from `l2Source` — HOW a line resolved — not
// from what it resolved to, and `normalizeL3Key` folds every bracketed label
// into "Other / unmapped". So an override / IM / heuristic / pattern hit could
// never reach a real L3 row however well the admin knew where it belonged.
// Measured on BL1 · Consumable HBA over the 13 weeks to 2026-09-02, that bucket
// held $1,029.03 / 590 u across five sources — a foot mask and a nail polish on
// the name regex, three IM-number one-offs, and an item literally named "PAIN"
// whose own override was what stranded it.
//
// Tier 0 runs before every other tier, so an L3 set here fixes a product no
// matter which tier would otherwise have claimed it — including the ones with
// no Clover catalog item at all, since `name:` keys need no itemId.
//
// Driven through worker.fetch on real routes with KV seeded, for the reason
// test-l3map-precedence.mjs gives: the enforcement IS the wiring, and a test
// that imported the helpers directly would pass even if no call site used them.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL: ' + m); } };

const worker = await loadWorker(repo);
const OV_KEY = 'item-overrides:global';
const HOUR = 12;
const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

const HBA = 'Consumable HBA';
const HBA_FACE = 'FG BL CONSUMABLES - HBA - FACE';
const HBA_PAIN = 'FG BL CONSUMABLES - HBA - PAIN';
const SEASONAL_L3 = 'FG BL SEASONAL - CHRISTMAS - GM';
const L3_OTHER = 'Other / unmapped';

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

async function freshEnv(overrides) {
  const { env } = makeEnv(repo);
  env.BL1_MERCHANT_ID = 'TESTMERCHANT';
  env.BL1_API_TOKEN = 'test-token';
  if (overrides) await env.SALES_SNAPSHOTS.put(OV_KEY, JSON.stringify(overrides));
  return env;
}

// The raw per-L2 l3Row labels for one stubbed hour, through the real route.
async function rowsFor(env, lineItems, itemCategories) {
  stubClover({ lineItems, itemCategories });
  const r = await worker.fetch(
    req(`/?action=items-hour&store=BL1&date=${dateStr}&hour=${HOUR}`, { user: 'u-su' }), env, ctx);
  const body = JSON.parse(await r.text());
  if (r.status !== 200) throw new Error(`items-hour ${r.status}: ${JSON.stringify(body).slice(0, 200)}`);
  const out = {};
  for (const c of body.categories || []) out[c.category] = (c.l3Rows || []).map(x => x.l3);
  return out;
}

// What the trend actually charts: raw labels put through normalizeL3Key, which
// is where a bracketed row becomes "Other / unmapped".
const normalized = (labels) => (labels || []).map(s =>
  (s.startsWith('[Name match] ') ? s.slice(13) : s).startsWith('[') ? L3_OTHER : s);

const li = (id, name, price = 5000) => ({ id: 'l-' + id, name, price, unitQty: 1000, item: { id } });
// A line item with NO catalog item — the shape of the three IM-number one-offs,
// which is why the name: key has to work without an itemId.
const liNoItem = (name, price = 5000) => ({ id: 'l-' + name, name, price, unitQty: 1000 });

// ── 1 · the regression: an L2-only override still brackets ───────────────
// This is the state the report was in. Keep it pinned so "an override with no
// L3" is a deliberate answer rather than an accident of the new code path.
{
  const env = await freshEnv({ items: { 'name:pain': HBA }, patterns: [], l3Map: {} });
  const b = await rowsFor(env, [liNoItem('PAIN')]);
  ok((b[HBA] || []).includes('[Override] ' + HBA), 'an L2-only override still renders the bracketed label');
  ok(normalized(b[HBA]).includes(L3_OTHER), 'and still folds into Other / unmapped');
}

// ── 2 · the fix: {l2, l3} reaches a real L3 row ──────────────────────────
{
  const env = await freshEnv({
    items: { 'name:pain': { l2: HBA, l3: HBA_PAIN } }, patterns: [], l3Map: {},
  });
  const b = await rowsFor(env, [liNoItem('PAIN')]);
  ok((b[HBA] || []).includes(HBA_PAIN), 'an override carrying an L3 books to that real L3 row');
  ok(!(b[HBA] || []).some(s => s.startsWith('[')), 'and emits no bracketed row at all');
  ok(!normalized(b[HBA]).includes(L3_OTHER), 'so nothing lands in Other / unmapped');
}

// ── 3 · it beats the tier that would otherwise have claimed the item ─────
// "Hemp Oil Foot Mask" matches the MASK|HEMP|OIL heuristic. Tier 0 runs first,
// so the override decides — that is the whole reason one mechanism can fix all
// five bracket sources.
{
  const noOv = await freshEnv({ items: {}, patterns: [], l3Map: {} });
  const before = await rowsFor(noOv, [li('i1', 'Hemp Oil Foot Mask')]);
  ok((before[HBA] || []).includes('[Heuristic] ' + HBA), 'the heuristic brackets it with no override');

  const env = await freshEnv({
    items: { 'id:i1': { l2: HBA, l3: HBA_FACE } }, patterns: [], l3Map: {},
  });
  const after = await rowsFor(env, [li('i1', 'Hemp Oil Foot Mask')]);
  ok((after[HBA] || []).includes(HBA_FACE), 'the override L3 wins over the heuristic');
  ok(!(after[HBA] || []).includes('[Heuristic] ' + HBA), 'and the bracketed row is gone');
}

// ── 4 · a legacy bare-string entry keeps working ─────────────────────────
// The stored map is mostly strings. readItemOverride has to accept both shapes
// or every existing override silently stops resolving — the failure mode would
// be items sliding back down the tier ladder, which looks like normal data.
{
  const env = await freshEnv({ items: { 'id:i9': 'Home' }, patterns: [], l3Map: {} });
  const b = await rowsFor(env, [li('i9', 'Random Thing')]);
  ok((b['Home'] || []).includes('[Override] Home'), 'a bare "<L2>" string still resolves');
}

// ── 5 · the id: key wins, and a bogus id: entry falls through to name: ───
{
  const env = await freshEnv({
    items: { 'id:i2': { l2: HBA, l3: HBA_FACE }, 'name:dual': { l2: 'Home', l3: null } },
    patterns: [], l3Map: {},
  });
  const b = await rowsFor(env, [li('i2', 'Dual')]);
  ok((b[HBA] || []).includes(HBA_FACE), 'the id: key wins over the name: key');
}
{
  const env = await freshEnv({
    items: { 'id:i3': { l2: 'Not A Real L2', l3: null }, 'name:dual': { l2: HBA, l3: HBA_FACE } },
    patterns: [], l3Map: {},
  });
  const b = await rowsFor(env, [li('i3', 'Dual')]);
  ok((b[HBA] || []).includes(HBA_FACE), 'an id: entry with a bogus L2 falls through to the name: key');
}

// ── 6 · POST refuses an L3 that does not exist ───────────────────────────
// A typo here would mint a phantom L3 row that sums into its L2 and matches no
// real category — the same silent-wrong-answer shape as the `|| "Hardlines"`
// default that mis-booked two items chain-wide for months.
{
  const env = await freshEnv({ items: {}, patterns: [], l3Map: {} });
  const r = await worker.fetch(req(`/?action=item-overrides`, {
    user: 'u-su', method: 'POST',
    body: { items: { 'name:x': { l2: HBA, l3: 'FG BL CONSUMABLES - HBA - FACEE' } } },
  }), env, ctx);
  const body = JSON.parse(await r.text());
  ok(r.status === 400, `an unknown L3 is refused, got ${r.status}`);
  ok(/Unknown L3/.test(body.error || ''), 'and the error says the category does not exist');
  const after = await env.SALES_SNAPSHOTS.get(OV_KEY);
  ok(!after || !JSON.parse(after).items?.['name:x'], 'nothing was persisted by the refused write');
}

// ── 7 · POST refuses a REAL L3 belonging to a different L2 ───────────────
// The one that validity checking cannot catch, and the same shape as the
// l3Map bug: "Softline - Accessories" was a perfectly valid L2, just the wrong
// one. If this got through, L3 rows would stop being a partition of their L2 —
// the single invariant the T13 card rests on.
{
  const env = await freshEnv({ items: {}, patterns: [], l3Map: {} });
  const r = await worker.fetch(req(`/?action=item-overrides`, {
    user: 'u-su', method: 'POST',
    body: { items: { 'name:x': { l2: HBA, l3: SEASONAL_L3 } } },
  }), env, ctx);
  const body = JSON.parse(await r.text());
  ok(r.status === 400, `a cross-L2 L3 is refused, got ${r.status}`);
  ok(/belongs to L2 "Seasonal"/.test(body.error || ''),
     'and the error names the L2 that actually owns it');
}

// ── 8 · a sound pair saves, and both shapes round-trip ───────────────────
{
  const env = await freshEnv({ items: {}, patterns: [], l3Map: {} });
  const r = await worker.fetch(req(`/?action=item-overrides`, {
    user: 'u-su', method: 'POST',
    body: { items: { 'name:pain': { l2: HBA, l3: HBA_PAIN }, 'id:legacy': 'Home' } },
  }), env, ctx);
  ok(r.status === 200, `a sound { l2, l3 } pair saves, got ${r.status}`);
  const after = JSON.parse(await env.SALES_SNAPSHOTS.get(OV_KEY));
  ok(after.items['name:pain']?.l3 === HBA_PAIN, 'the L3 persists');
  ok(after.items['id:legacy'] === 'Home', 'and a bare string alongside it stays a bare string');
}

// ── 9 · an L3 added by the SAME request is assignable ────────────────────
// The editor sends items and l3Map together, so validating items against the
// stored map alone would reject a category the same save is creating.
{
  const env = await freshEnv({ items: {}, patterns: [], l3Map: {} });
  const r = await worker.fetch(req(`/?action=item-overrides`, {
    user: 'u-su', method: 'POST',
    body: {
      l3Map: { 'Brand New HBA Thing': HBA },
      items: { 'name:novel': { l2: HBA, l3: 'Brand New HBA Thing' } },
    },
  }), env, ctx);
  ok(r.status === 200, `an L3 created by the same request is assignable, got ${r.status}`);
}

// ── 10 · GET publishes the assignable pairs ──────────────────────────────
{
  const env = await freshEnv({ items: {}, patterns: [], l3Map: { 'Novel HBA': HBA } });
  const r = await worker.fetch(req(`/?action=item-overrides`, { user: 'u-su' }), env, ctx);
  const body = JSON.parse(await r.text());
  const opts = body.l3Options || {};
  ok(r.status === 200 && body.l3Options && typeof body.l3Options === 'object',
     'GET returns an l3Options map');
  ok((opts[HBA] || []).includes(HBA_PAIN), 'built-in categories are listed under their L2');
  ok((opts[HBA] || []).includes('Novel HBA'), 'and so is an l3Map-only category');
  ok(!(opts[HBA] || []).includes(SEASONAL_L3),
     'a Seasonal category is NOT offered under Consumable HBA');
  ok(!(opts[HBA] || []).some((v, i, a) => a.indexOf(v) !== i),
     'and no category is listed twice');
}

// ── 11 · an l3Map that re-homes a built-in is listed where it BOOKS ──────
// The editor showing one L2 while the engine books another is precisely the
// drift that hid FG BL SOFTLINES - APPAREL for 53 days.
{
  const env = await freshEnv({
    items: {}, patterns: [], l3Map: { [HBA_FACE]: 'Home' },
  });
  const r = await worker.fetch(req(`/?action=item-overrides`, { user: 'u-su' }), env, ctx);
  const opts = JSON.parse(await r.text()).l3Options || {};
  ok((opts['Home'] || []).includes(HBA_FACE),
     'a re-homed category is offered under its OVERRIDE L2');
  ok(!(opts[HBA] || []).includes(HBA_FACE),
     'and no longer under the built-in one');
}

// ── 12 · the editor's list is the UNMAPPED subset, not every fallback ────
// `fallbackItems` records every non-Clover-category resolution, and a "name"
// hit is one of them — but it resolves to a real L3 and is NOT in the bucket.
// Listing it would invite an override onto a row that is not broken.
{
  const env = await freshEnv({ items: {}, patterns: [], l3Map: {} });
  const day = '2026-08-01';
  await env.SALES_SNAPSHOTS.put(`items:bl1:${day}`, JSON.stringify({
    store: 'BL1', date: day, categories: [], _debug: {
      noCategory: {}, fallbackItemsTotal: 4,
      fallbackItems: {
        'Hemp Oil Foot Mask':  { qty: 5, gross: 10, source: 'heuristic', l2: HBA, l3Key: '[Heuristic] ' + HBA },
        'FG BL CONSUMABLES - HBA - MEDS': { qty: 9, gross: 90, source: 'name', l2: HBA, l3Key: 'FG BL CONSUMABLES - HBA - MEDS' },
        'PAIN':                { qty: 2, gross: 20, source: 'override', l2: HBA, l3Key: HBA_PAIN },
        'legacy heuristic':    { qty: 1, gross: 30, source: 'heuristic', l2: HBA },
      },
    },
  }));
  const r = await worker.fetch(req(
    `/?action=noncategorized-items&store=BL1&start=${day}&end=${day}`, { user: 'u-su' }), env, ctx);
  const body = JSON.parse(await r.text());
  ok(r.status === 200, `noncategorized-items returns 200, got ${r.status}`);
  const names = (body.unmappedItems || []).map(i => i.name);
  ok(body.fallbackItems.length === 4, 'fallbackItems still reports every fallback resolution');
  ok(names.includes('Hemp Oil Foot Mask'), 'a bracketed heuristic hit IS listed for the editor');
  ok(!names.includes('FG BL CONSUMABLES - HBA - MEDS'),
     'a name hit resolving to a real L3 is NOT listed');
  ok(!names.includes('PAIN'), 'an override that already carries an L3 drops off the list');
  ok(names.includes('legacy heuristic'),
     'a pre-l3Key snapshot falls back to "every source but name was bracketed"');
  ok(body.unmappedGross === 40, `unmappedGross counts only the listed ones, got ${body.unmappedGross}`);
  ok((body.unmappedItems || []).every(i => i.l2 === HBA),
     'each carries the L2 the engine resolved, so the editor can pre-select it');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
