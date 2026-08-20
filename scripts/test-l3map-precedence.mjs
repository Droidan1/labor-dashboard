// The admin l3Map override BEATS the built-in L3_TO_L2 — and one wrong entry
// there re-buckets an entire category at every store at once, silently.
//
// That is not hypothetical. `l3Map["FG BL SOFTLINES - APPAREL"]` held
// "Softline - Accessories" from before 2026-06-19 until 2026-08-11 and moved
// $14,959.51 / 1,453 units across all six stores into the wrong L2. Nothing
// caught it because:
//
//   1. Both write paths validated only that the L2 was a MEMBER of VALID_L2.
//      "Softline - Accessories" passes that — it is a real L2, just the wrong
//      one. Validity was never the property that mattered; AGREEMENT was.
//   2. ?action=create-item wrote l3Map as a silent side effect of creating ONE
//      item, so a single wrong pick in that form re-mapped a whole category.
//   3. The precedence rule was written out three times and TWO different ways:
//      the aggregator and its refund mirror let the override win, the category-
//      cost editor let the built-in win. The editor therefore displayed the
//      category under the right L2 while the engine booked it to the wrong one.
//   4. The existing category tests compare source literals to source literals,
//      so none of them can see a KV value at all.
//
// This suite drives worker.fetch on real routes with KV seeded, because the
// enforcement IS the wiring — a test that imported resolveL3ToL2 directly would
// pass even if no call site used it.
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

// L2 -> [l3 labels] for one stubbed hour, through the real route.
async function bucketsFor(env, lineItems, itemCategories) {
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
const APPAREL = 'FG BL SOFTLINES - APPAREL';

// ── 1 · the regression itself ────────────────────────────────────────────
// With no override, the built-in map must be honoured.
{
  const env = await freshEnv({ items: {}, patterns: [], l3Map: {} });
  const b = await bucketsFor(env, [li('i1', 'Ladies Tee')], { i1: APPAREL });
  ok((b['Softline - Apparel'] || []).includes(APPAREL), 'apparel books to Softline - Apparel');
  ok(!b['Softline - Accessories'], 'nothing leaks into Softline - Accessories');
}

// ── 2 · a novel override still works ─────────────────────────────────────
// The override mechanism exists to map categories the built-in map does NOT
// know (`Indy Products` -> Bin Products stranded $16,592 when it could not).
// Guard against "fixing" the bug by disabling overrides wholesale.
{
  const env = await freshEnv({ items: {}, patterns: [], l3Map: { 'Totally New Category': 'Hardlines' } });
  const b = await bucketsFor(env, [li('i2', 'Mystery Gadget')], { i2: 'Totally New Category' });
  ok((b['Hardlines'] || []).includes('Totally New Category'), 'a novel l3Map entry still maps');
  ok(!b['Uncategorized'], 'and does not fall through to Uncategorized');
}

// ── 3 · a forced conflicting override still wins at read time ────────────
// Precedence is deliberate. The guard is on WRITING one, not on honouring one
// that exists — otherwise a genuinely wrong built-in could never be corrected.
{
  const env = await freshEnv({ items: {}, patterns: [], l3Map: { [APPAREL]: 'Softline - Accessories' } });
  const b = await bucketsFor(env, [li('i3', 'Ladies Tee')], { i3: APPAREL });
  ok((b['Softline - Accessories'] || []).includes(APPAREL),
     'an existing override still beats the built-in (precedence preserved)');
}

// ── 4 · POST refuses to CREATE a conflicting mapping ─────────────────────
{
  const env = await freshEnv({ items: {}, patterns: [], l3Map: {} });
  const r = await worker.fetch(req(`/?action=item-overrides`, {
    user: 'u-su', method: 'POST', body: { l3Map: { [APPAREL]: 'Softline - Accessories' } },
  }), env, ctx);
  const body = JSON.parse(await r.text());
  ok(r.status === 409, `conflicting l3Map write is refused, got ${r.status}`);
  ok(Array.isArray(body.conflicts) && body.conflicts[0]?.l3 === APPAREL,
     'the error names the offending L3');
  ok(body.conflicts?.[0]?.builtIn === 'Softline - Apparel' && body.conflicts?.[0]?.attempted === 'Softline - Accessories',
     'and reports BOTH answers so the admin can tell which is wrong');
  const after = JSON.parse(await env.SALES_SNAPSHOTS.get(OV_KEY) || '{"l3Map":{}}');
  ok(!(APPAREL in (after.l3Map || {})), 'nothing was persisted by the refused write');
}

// ── 5 · force:true is the deliberate escape hatch ────────────────────────
{
  const env = await freshEnv({ items: {}, patterns: [], l3Map: {} });
  const r = await worker.fetch(req(`/?action=item-overrides`, {
    user: 'u-su', method: 'POST', body: { l3Map: { [APPAREL]: 'Softline - Accessories' }, force: true },
  }), env, ctx);
  ok(r.status === 200, `force:true is accepted, got ${r.status}`);
  const after = JSON.parse(await env.SALES_SNAPSHOTS.get(OV_KEY));
  ok(after.l3Map[APPAREL] === 'Softline - Accessories', 'and it persists');
}

// ── 6 · a non-conflicting write is unaffected ────────────────────────────
{
  const env = await freshEnv({ items: {}, patterns: [], l3Map: {} });
  const r = await worker.fetch(req(`/?action=item-overrides`, {
    user: 'u-su', method: 'POST', body: { l3Map: { 'Brand New L3': 'Home' } },
  }), env, ctx);
  ok(r.status === 200, `a novel mapping saves without force, got ${r.status}`);
  const after = JSON.parse(await env.SALES_SNAPSHOTS.get(OV_KEY));
  ok(after.l3Map['Brand New L3'] === 'Home', 'and persists');
}

// ── 7 · re-sending an EXISTING conflict must not brick the editor ────────
// The editor merges and re-sends the whole map on every save. If pre-existing
// conflicts were rejected, an unrelated item assignment could never be saved.
{
  const env = await freshEnv({ items: {}, patterns: [], l3Map: { [APPAREL]: 'Softline - Accessories' } });
  const r = await worker.fetch(req(`/?action=item-overrides`, {
    user: 'u-su', method: 'POST',
    body: { l3Map: { [APPAREL]: 'Softline - Accessories', 'Another New L3': 'Home' } },
  }), env, ctx);
  ok(r.status === 200, `re-sending an unchanged pre-existing conflict is allowed, got ${r.status}`);
  const after = JSON.parse(await env.SALES_SNAPSHOTS.get(OV_KEY));
  ok(after.l3Map['Another New L3'] === 'Home', 'and the unrelated new entry saves');
}

// ── 8 · GET reports conflicts instead of hiding them ─────────────────────
{
  const env = await freshEnv({ items: {}, patterns: [], l3Map: { [APPAREL]: 'Softline - Accessories' } });
  const r = await worker.fetch(req(`/?action=item-overrides`, { user: 'u-su' }), env, ctx);
  const body = JSON.parse(await r.text());
  ok(r.status === 200 && Array.isArray(body.conflicts), 'GET returns a conflicts array');
  ok(body.conflicts.length === 1 && body.conflicts[0].l3 === APPAREL, 'and it names the conflict');
}
{
  const env = await freshEnv({ items: {}, patterns: [], l3Map: { 'Novel Thing': 'Home' } });
  const r = await worker.fetch(req(`/?action=item-overrides`, { user: 'u-su' }), env, ctx);
  const body = JSON.parse(await r.text());
  ok(body.conflicts.length === 0, 'a healthy map reports zero conflicts (not every entry)');
}

// ── 9 · create-clover-item must never shadow a built-in category ─────────
// The silent global write that most likely caused the original incident: this
// endpoint wrote an all-store l3Map entry as a side effect of creating ONE item.
{
  const env = await freshEnv({ items: {}, patterns: [], l3Map: {} });
  globalThis.fetch = async (url) => {
    const u = String(url);
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('/items?filter=')) return json({ elements: [] });      // no duplicate
    if (u.includes('/categories')) return json({ elements: [{ id: 'cat1', name: APPAREL }] });
    if (u.includes('/category_items')) return json({});
    if (u.includes('/items')) return json({ id: 'newitem1' });
    throw new Error('unexpected outbound fetch: ' + u.slice(0, 120));
  };
  const r = await worker.fetch(req(`/?action=create-clover-item`, {
    user: 'u-su', method: 'POST',
    body: { store: 'BL1', name: 'Test Tee', code: 'TT1', priceCents: 500, l2: 'Softline - Accessories', l3: APPAREL },
  }), env, ctx);
  const body = JSON.parse(await r.text());
  ok(r.status === 200, `create-clover-item still succeeds, got ${r.status}`);
  ok(body.l3Mapped === false, 'it did NOT write a global l3Map entry for a built-in category');
  ok(typeof body.l3MapSkipped === 'string' && body.l3MapSkipped.includes('Softline - Apparel'),
     'and it says so, naming where sales will actually book');
  const after = JSON.parse(await env.SALES_SNAPSHOTS.get(OV_KEY) || '{"l3Map":{}}');
  ok(!(APPAREL in (after.l3Map || {})), 'KV is untouched by the create');
}

// ── 10 · the cost editor must AGREE with the aggregator ──────────────────
// The contradiction that made the original bug invisible to an admin: for a
// forced conflict, the editor's catalog must report the L2 the engine books to.
{
  const env = await freshEnv({ items: {}, patterns: [], l3Map: { [APPAREL]: 'Softline - Accessories' } });
  const r = await worker.fetch(req(`/?action=category-costs`, { user: 'u-su' }), env, ctx);
  const body = JSON.parse(await r.text());
  const entry = (body.categories || []).find(c => c.l3 === APPAREL);
  ok(!!entry, 'the cost editor lists the category');
  ok(entry?.l2 === 'Softline - Accessories',
     `editor shows the L2 the ENGINE books to, got ${JSON.stringify(entry?.l2)}`);

  const buckets = await bucketsFor(env, [li('i9', 'Ladies Tee')], { i9: APPAREL });
  const engineL2 = Object.keys(buckets).find(k => (buckets[k] || []).includes(APPAREL));
  ok(entry?.l2 === engineL2,
     `editor and engine agree (editor ${JSON.stringify(entry?.l2)}, engine ${JSON.stringify(engineL2)})`);
}

// Summary deliberately avoids the "<n> passed" wording: scripts/test.sh counts
// per-assertion "PASS" lines AND a "<n> passed" tally, and adds them together —
// a suite emitting both reporters gets counted twice.
console.log(`\ntest-l3map-precedence: ${pass}/${pass + fail} assertions OK, ${fail} failed`);
process.exit(fail ? 1 : 0);
