// `l3Rules` name a bracketed row without touching which L2 it books to.
//
// WHY IT EXISTS: per-item overrides can carry an L3 (see test-item-override-l3.mjs),
// but that is one admin action per PRODUCT and the money does not sit in products.
// Measured across all six stores for the 13 weeks to 2026-09-02 — 546 snapshots,
// none missing, no per-day truncation — $68,779 net sat in "Other / unmapped",
// 2.63% of $2.62M. Of the $61,963 gross behind it, $31,712 is 199 items resolved
// at the IM tier, and 178 of those product names share just 27 IM numbers. IM
// 14160 alone is twelve names ("14160 mini dryer", "14160-690", "frigidaire gas
// range with quick boil. 14160", …).
//
// Adding an L3 to `patterns` would have fixed $30.00 of it: pattern rules are
// Tier 6.5, AFTER IM_TO_L2 (Tier 5) and after the heuristic ladder (Tier 6), and
// every one of those clusters is already in the built-in IM_TO_L2 — so the lines
// resolve as l2Source "im" and never reach the pattern matcher. Blocks 1 and 2
// below pin exactly that, so the reasoning cannot be lost.
//
// THE TWO SAFETY PROPERTIES, which is what most of this file tests:
//   1. A rule can only REPLACE a synthetic bracketed label — never a real Clover
//      L3, a name-matched L3, an override that already named one, or the raw item
//      name Custom Sales / Refund keep.
//   2. The L2 is already decided when a rule runs, and a rule whose L3 lives in
//      another L2 is skipped. No rule can move a dollar between buckets.
//
// Driven through worker.fetch on real routes with KV seeded: the enforcement IS
// the wiring, and a test importing matchL3Rule directly would pass even if no
// call site used it.
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

const HARD = 'Hardlines';
const HOME = 'Home';
const HBA  = 'Consumable HBA';
// Real categories, taken from the built-in L3_TO_L2.
const HARD_APPL = 'APPLIANCES - BL STORES';        // the real BL appliances category
const HOME_DECOR = 'FG BL HOME - HOME DECOR';
const HOME_BEDDING = 'FG BL HOME - BEDDING & PILLOWS';
const HBA_FACE = 'FG BL CONSUMABLES - HBA - FACE';
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

async function freshEnv(ov) {
  const { env } = makeEnv(repo);
  env.BL1_MERCHANT_ID = 'TESTMERCHANT';
  env.BL1_API_TOKEN = 'test-token';
  await env.SALES_SNAPSHOTS.put(OV_KEY, JSON.stringify(
    { items: {}, patterns: [], l3Map: {}, l3Rules: [], ...(ov || {}) }));
  return env;
}

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
const normalized = (labels) => (labels || []).map(s =>
  (s.startsWith('[Name match] ') ? s.slice(13) : s).startsWith('[') ? L3_OTHER : s);

const li = (id, name, price = 5000) => ({ id: 'l-' + id, name, price, unitQty: 1000, item: { id } });
const liNoItem = (name, price = 5000) => ({ id: 'l-' + name.slice(0, 12), name, price, unitQty: 1000 });

// The real BL1 appliance names, which is the point of the whole feature.
const APPLIANCES = [
  '14160 mini dryer', '14160-690', 'BL-14160-1000',
  'frigidaire gas range with quick boil. 14160', '14160 double stack washer/dryer',
];

// ── 1 · the premise: these lines resolve at the IM tier ──────────────────
{
  const env = await freshEnv();
  const b = await rowsFor(env, APPLIANCES.map(n => liNoItem(n)));
  ok((b[HARD] || []).includes('[IM 14160] ' + HARD),
     'all five appliance names collapse to one [IM 14160] row');
  ok(normalized(b[HARD]).filter(x => x === L3_OTHER).length >= 1,
     'and that row folds into Other / unmapped');
}

// ── 2 · a PATTERN rule cannot reach them — the correction this PR encodes ─
// Tier 6.5 is after IM_TO_L2, so an im-number pattern never even runs here.
{
  const env = await freshEnv({ patterns: [{ type: 'im-number', value: '14160', category: HARD }] });
  const b = await rowsFor(env, APPLIANCES.map(n => liNoItem(n)));
  ok((b[HARD] || []).includes('[IM 14160] ' + HARD),
     'an im-number PATTERN rule does not change the row — the IM tier already won');
  ok(!(b[HARD] || []).includes('[Pattern] ' + HARD),
     'the pattern tier is never reached for these lines');
}

// ── 3 · one L3 rule names all five ───────────────────────────────────────
{
  const env = await freshEnv({ l3Rules: [{ type: 'im-number', value: '14160', l3: HARD_APPL }] });
  const b = await rowsFor(env, APPLIANCES.map(n => liNoItem(n)));
  ok((b[HARD] || []).includes(HARD_APPL), 'one im-number L3 rule names the row');
  ok(!(b[HARD] || []).some(s => s.startsWith('[')), 'no bracketed row survives');
  ok(!normalized(b[HARD]).includes(L3_OTHER), 'nothing lands in Other / unmapped');
  ok((b[HARD] || []).length === 1, 'and all five names still share ONE row');
}

// ── 4 · it rescues a HEURISTIC hit too, not just the IM tier ─────────────
// $14,298 of the unmapped total is heuristic-resolved, so the pass must be
// tier-agnostic. "Bedding And Pillow" matches /BEDDING|PILLOW/ -> Home.
{
  const noRule = await freshEnv();
  const before = await rowsFor(noRule, [liNoItem('Bedding And Pillow')]);
  ok((before[HOME] || []).includes('[Heuristic] ' + HOME), 'the heuristic brackets it with no rule');

  const env = await freshEnv({ l3Rules: [{ type: 'contains', value: 'bedding', l3: HOME_BEDDING }] });
  const after = await rowsFor(env, [liNoItem('Bedding And Pillow')]);
  ok((after[HOME] || []).includes(HOME_BEDDING), 'a contains rule rescues a heuristic-resolved row');
}

// ── 5 · SAFETY: it cannot touch a real Clover L3 ─────────────────────────
// The rule matches the item by name, but the line already has a real category,
// so the pass must not run at all.
{
  const env = await freshEnv({ l3Rules: [{ type: 'contains', value: 'tee', l3: HOME_DECOR }] });
  const b = await rowsFor(env, [li('i1', 'Ladies Tee')], { i1: 'FG BL SOFTLINES - APPAREL' });
  ok((b['Softline - Apparel'] || []).includes('FG BL SOFTLINES - APPAREL'),
     'a real Clover L3 is left alone');
  ok(!(b[HOME] || []).includes(HOME_DECOR), 'and the rule did not fire');
}

// ── 6 · SAFETY: it cannot move a line between L2s ────────────────────────
// A Home category named on a line the ladder booked to Hardlines is refused —
// this is the guard that makes the whole thing unable to lose money, and it is
// the same failure shape as the l3Map incident (a valid L2, just the wrong one).
{
  const env = await freshEnv({ l3Rules: [{ type: 'im-number', value: '14160', l3: HOME_DECOR }] });
  const b = await rowsFor(env, [liNoItem('14160 mini dryer')]);
  ok((b[HARD] || []).includes('[IM 14160] ' + HARD),
     'a rule whose L3 belongs to another L2 is skipped, label unchanged');
  ok(!b[HOME], 'and not one cent moved into that other L2');
}

// ── 7 · SAFETY: Custom Sales keeps its raw item name ─────────────────────
// Those rows are not bracketed, so they are not the pass's business — the admin
// fixes them with an item override, which also sets the L2.
{
  const env = await freshEnv({ l3Rules: [{ type: 'contains', value: 'widget', l3: HOME_DECOR }] });
  const b = await rowsFor(env, [liNoItem('Mystery Widget Thing')]);
  ok((b['Custom Sales'] || []).includes('Mystery Widget Thing'),
     'a Custom Sales row keeps the raw item name');
  ok(!(b['Custom Sales'] || []).includes(HOME_DECOR), 'the rule did not overwrite it');
}

// ── 8 · an item override that already named an L3 wins ───────────────────
// The override is Tier 0 and sets a non-bracketed l3Key, so the pass skips it.
{
  const env = await freshEnv({
    items: { 'name:14160 mini dryer': { l2: HARD, l3: HARD_APPL } },
    l3Rules: [{ type: 'im-number', value: '14160', l3: 'FG BL HARDLINES - ELECTRONICS' }],
  });
  const b = await rowsFor(env, [liNoItem('14160 mini dryer')]);
  ok((b[HARD] || []).includes(HARD_APPL), 'a per-item override L3 beats a matching rule');
  ok(!(b[HARD] || []).includes('FG BL HARDLINES - ELECTRONICS'), 'the rule did not override it');
}

// ── 9 · first match wins, and the other rule types work ──────────────────
{
  const env = await freshEnv({ l3Rules: [
    { type: 'prefix', value: '14160-690', l3: 'FG BL HARDLINES - ELECTRONICS' },
    { type: 'im-number', value: '14160', l3: HARD_APPL },
  ] });
  const b = await rowsFor(env, [liNoItem('14160-690'), liNoItem('14160 mini dryer')]);
  ok((b[HARD] || []).includes('FG BL HARDLINES - ELECTRONICS'), 'the earlier, more specific rule wins');
  ok((b[HARD] || []).includes(HARD_APPL), 'and the later one still catches its sibling');
}
{
  const env = await freshEnv({ l3Rules: [{ type: 'id', value: 'i7', l3: HBA_FACE }] });
  const b = await rowsFor(env, [li('i7', 'Hemp Oil Foot Mask')]);
  ok((b[HBA] || []).includes(HBA_FACE), 'an id rule matches on the Clover item id');
}
{
  const env = await freshEnv({ l3Rules: [{ type: 'name', value: '  Hemp Oil FOOT mask ', l3: HBA_FACE }] });
  const b = await rowsFor(env, [liNoItem('Hemp Oil Foot Mask')]);
  ok((b[HBA] || []).includes(HBA_FACE), 'a name rule matches case- and space-insensitively');
}

// ── 10 · a rescued item drops off the admin's fix list ───────────────────
// The pass runs BEFORE the fallbackItems capture, so the recorded l3Key is the
// real one and `unmapped` comes out false without anyone re-deriving it.
{
  const env = await freshEnv({ l3Rules: [{ type: 'im-number', value: '14160', l3: HARD_APPL }] });
  stubClover({ lineItems: [liNoItem('14160 mini dryer')], itemCategories: {} });
  const r = await worker.fetch(
    req(`/?action=items-hour&store=BL1&date=${dateStr}&hour=${HOUR}`, { user: 'u-su' }), env, ctx);
  const body = JSON.parse(await r.text());
  const fb = body?._debug?.fallbackItems?.['14160 mini dryer'];
  ok(fb && fb.l3Key === HARD_APPL, 'the fallback record carries the rescued l3Key');
}

// ── 11 · POST validation ─────────────────────────────────────────────────
{
  const env = await freshEnv();
  const r = await worker.fetch(req(`/?action=item-overrides`, {
    user: 'u-su', method: 'POST',
    body: { l3Rules: [{ type: 'im-number', value: '14160', l3: 'APPLIANCES - BL STORESS' }] },
  }), env, ctx);
  const body = JSON.parse(await r.text());
  ok(r.status === 400, `an unknown L3 in a rule is refused, got ${r.status}`);
  ok(/Unknown L3/.test(body.error || ''), 'and the error says so');
}
{
  const env = await freshEnv();
  const r = await worker.fetch(req(`/?action=item-overrides`, {
    user: 'u-su', method: 'POST', body: { l3Rules: [{ type: 'regex', value: 'x', l3: HARD_APPL }] },
  }), env, ctx);
  ok(r.status === 400, `an unsupported rule type is refused, got ${r.status}`);
}
{
  const env = await freshEnv();
  const r = await worker.fetch(req(`/?action=item-overrides`, {
    user: 'u-su', method: 'POST', body: { l3Rules: [{ type: 'prefix', value: '   ', l3: HARD_APPL }] },
  }), env, ctx);
  ok(r.status === 400, `a blank value is refused, got ${r.status}`);
}
{
  const env = await freshEnv();
  const r = await worker.fetch(req(`/?action=item-overrides`, {
    user: 'u-su', method: 'POST',
    body: { l3Rules: [{ type: 'im-number', value: '14160', l3: HARD_APPL }] },
  }), env, ctx);
  ok(r.status === 200, `a sound rule saves, got ${r.status}`);
  const after = JSON.parse(await env.SALES_SNAPSHOTS.get(OV_KEY));
  ok(after.l3Rules?.[0]?.l3 === HARD_APPL, 'and persists');
  ok(after.items && after.patterns && after.l3Map, 'without disturbing the other three keys');
}

// ── 12 · a cross-L2 rule SAVES but GET says it can never fire ────────────
// Deliberate: the L2 test is a read-time condition, so refusing at write time
// would be wrong. Silence would be worse, so GET names the owning L2.
{
  const env = await freshEnv();
  const w = await worker.fetch(req(`/?action=item-overrides`, {
    user: 'u-su', method: 'POST',
    body: { l3Rules: [{ type: 'im-number', value: '14160', l3: HOME_DECOR }] },
  }), env, ctx);
  ok(w.status === 200, `a rule naming another L2's category still saves, got ${w.status}`);
  const g = await worker.fetch(req(`/?action=item-overrides`, { user: 'u-su' }), env, ctx);
  const owners = JSON.parse(await g.text()).l3RuleOwners || [];
  ok(owners[0]?.l2 === HOME, 'GET reports the L2 that rule can actually fire on');
}

// ── 13 · no rules configured changes nothing ─────────────────────────────
{
  const env = await freshEnv();
  const b = await rowsFor(env, [liNoItem('14160 mini dryer'), li('i1', 'Ladies Tee')],
                          { i1: 'FG BL SOFTLINES - APPAREL' });
  ok((b[HARD] || []).includes('[IM 14160] ' + HARD), 'with no rules the IM label is untouched');
  ok((b['Softline - Apparel'] || []).includes('FG BL SOFTLINES - APPAREL'),
     'and a real category is untouched');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
