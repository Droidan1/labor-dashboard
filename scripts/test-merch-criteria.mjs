// Merchandising: buy criteria, driven through the REAL endpoints via worker.fetch.
//
// The properties worth pinning here are the ones that make the criteria table
// trustworthy as a record rather than just a settings screen:
//
//   1. A PUBLISHED VERSION NEVER MOVES. A manifest scored under v7 must still read
//      v7's numbers a year later, or "scored under v7" is a lie. Editing goes into a
//      draft that copies the live version; publishing stamps it and closes it.
//   2. YOU CANNOT PUBLISH WITHOUT SAYING WHY (PRD G5 — no silent drift).
//   3. INHERITANCE IS REAL. A blank category cell resolves to the chain default, and
//      the response says which it was, so the UI can grey it.
//   4. SHELF COUNT, COVERAGE AND VELOCITY ARE GONE (Brian, 2026-11-24). Their endpoints
//      no longer answer, and nothing can write a shelf count.
//
// ⚠️ `l3` here is the PRD's "L2" — see migration-041.sql for why.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, ctx, req, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

blockNetwork();
const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
for (const m of ['migration-041.sql', 'migration-042.sql']) db.exec(fs.readFileSync(path.join(repo, m), 'utf8'));
applyMigrationAlters(db, repo);   // harness rule: re-run after a migration creates tables

const call = async (url, opts) => {
  const r = await worker.fetch(req(url, opts), env, ctx);
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = { _raw: text.slice(0, 120) }; }
  return { status: r.status, body };
};
const get   = (action, user, qs = '') => call(`/?action=${action}${qs}`, { user });
// The table is L2 rows with L3 children hanging off them.
const l2Of    = (body, key) => (body.categories || []).find(c => c.key === key);
const childOf = (body, l2, l3) => (l2Of(body, l2)?.children || []).find(c => c.key === l3);
const post  = (action, user, body) => call(`/?action=${action}`, { user, method: 'POST', body });

const FOOD   = 'Consumable Food';          // an L2
const HBA    = 'Consumable HBA';           // an L2
const SNACKS = 'FG BL CONSUMABLES - FOOD - SNACKS';   // an L3 under FOOD
const COFFEE = 'FG BL CONSUMABLES - FOOD - COFFEE & TEA';
const ORAL   = 'FG BL CONSUMABLES - HBA - ORAL';

console.log('Merchandising — buy criteria + shelf counts');

// ── 🛑 A virgin install still renders a table you can author v1 in ───────────
// Shipped broken: the no-versions branch returned `categories: []`, so the very first
// visit showed a lone "Chain default" row with nothing to tick core on. v1 could not be
// authored through the page that exists to author it.
{
  const { body } = await get('merch-criteria', 'u-su');
  eq(body.version, null, 'no version yet');
  eq((body.categories || []).length, 10, 'all ten L2 rows are offered');
  ok(body.categories.every(c => c.core === false), 'nothing is core until someone says so');
  ok(body.categories.every(c => c.children.length === 0), 'and no L3 rows exist until one is added');
  ok((body.tree?.[FOOD] || []).some(c => c.key === SNACKS), 'the picker offers Snacks under Consumable Food');
  ok(body.defaults && 'max_cost_pct_retail' in body.defaults, 'the chain-default row is present to fill in');
}

// ── The table is TEN L2 rows; an L3 appears only when it is given one ────────
{
  await post('merch-criteria-draft', 'u-su', { cells: [{ category: FOOD, field: 'core', value: '1' }] });
  const { body } = await get('merch-criteria', 'u-su');
  const cats = body.categories || [];
  eq(cats.length, 10, 'ten L2 rows, not eighty-two L3 rows');
  ok(cats.every(c => c.level === 'l2'), 'every top-level row is an L2');
  ok(!cats.some(c => ['Sku Book Items', 'Refund', 'Gift Cards', 'Bin Products', 'Custom Sales'].includes(c.key)),
     'POS pages and ledger artifacts are excluded');
  eq(l2Of(body, FOOD).core, true, 'the L2 core flag took');
  eq(l2Of(body, FOOD).children.length, 0, 'no L3 row exists just because its parent has one');

  // Adding an L3 row is what makes it appear, under its own parent.
  await post('merch-criteria-draft', 'u-su', { cells: [{ category: COFFEE, field: 'price_cap_pct_retail', value: '40' }] });
  const after = (await get('merch-criteria', 'u-su')).body;
  eq(l2Of(after, FOOD).children.length, 1, 'the L3 row appears once it has a value');
  eq(childOf(after, FOOD, COFFEE).label, 'Coffee & Tea', 'labelled for a human, not the warehouse string');
  eq(l2Of(after, HBA).children.length, 0, 'and only under its OWN parent');
  ok(after.tree[FOOD].find(c => c.key === COFFEE).added, 'the picker marks it as already added');
}

// ── 🔑 Inheritance walks THREE levels: L3 → L2 → chain ───────────────────────
{
  await post('merch-criteria-draft', 'u-su', { cells: [{ category: FOOD, field: 'cash_back_days', value: '25' }] });
  const { body } = await get('merch-criteria', 'u-su');
  const coffee = childOf(body, FOOD, COFFEE);
  eq(coffee.fields.price_cap_pct_retail.value, '40', 'its own value wins');
  eq(coffee.fields.price_cap_pct_retail.inherited, false, '...and is marked as its own');
  eq(coffee.fields.cash_back_days.value, '25', 'falls back to its L2 before the chain');
  eq(coffee.fields.cash_back_days.from, FOOD, '...and says which L2 it came from');
  eq(coffee.fields.max_cost_pct_retail.value, '30', 'falls all the way back to the chain default');
  eq(coffee.fields.max_cost_pct_retail.from, 'chain', '...and says so');
  eq(coffee.core, true, 'core inherits from the L2 as well');
}

// ── An untouched L2 inherits the chain default, and says so ──────────────────
{
  const { body } = await get('merch-criteria', 'u-su');
  const hba = l2Of(body, HBA);
  eq(hba.fields.max_cost_pct_retail.value, '30', 'HBA inherits the 30% chain default');
  eq(hba.fields.max_cost_pct_retail.inherited, true, '...and is marked inherited so the UI can grey it');
  eq(hba.core, false, 'un-flagged L2s are not core');
  eq(l2Of(body, FOOD).fields.core.inherited, false, 'an overridden cell is marked as an override');
}

// ── A chain default cannot be cleared — it is what everything else inherits ───
{
  const r = await post('merch-criteria-draft', 'u-su', { cells: [{ category: null, field: 'max_cost_pct_retail', value: null }] });
  eq(r.status, 400, 'clearing a chain default is refused');
}

// ── Publishing requires a note (PRD G5: no silent drift) ─────────────────────
{
  const r = await post('merch-criteria-publish', 'u-su', {});
  eq(r.status, 400, 'publish with no note is blocked');
  const r2 = await post('merch-criteria-publish', 'u-su', { note: '   ' });
  eq(r2.status, 400, 'whitespace is not a note');
}

// ── 🛑 A published version is IMMUTABLE ──────────────────────────────────────
{
  const p = await post('merch-criteria-publish', 'u-su', { note: 'v1 — core defined with Ryan' });
  eq(p.status, 200, 'publish succeeds with a note');
  const v1 = p.body.version;

  const before = await get('merch-criteria', 'u-su', `&version=${v1}`);
  eq(l2Of(before.body, FOOD).core, true, 'v1 has Consumable Food core');

  // Editing after a publish opens a NEW draft rather than touching v1.
  await post('merch-criteria-draft', 'u-su', { cells: [{ category: FOOD, field: 'core', value: '0' }] });
  const after = await get('merch-criteria', 'u-su', `&version=${v1}`);
  eq(l2Of(after.body, FOOD).core, true,
     '🛑 v1 still reads exactly as published after a later edit');

  const now = await get('merch-criteria', 'u-su');
  eq(now.body.live, v1, 'live is still v1 — an unpublished draft does not become live');
  ok(now.body.draft === v1 + 1, `a new draft opened as v${v1 + 1}, got ${now.body.draft}`);
  eq(now.body.version, v1, 'the default read is the LIVE version, not the draft');

  // The draft copied v1 forward, so untouched cells survive.
  const draft = await get('merch-criteria', 'u-su', `&version=${now.body.draft}`);
  eq(l2Of(draft.body, FOOD).core, false, 'the draft carries the edit');
  eq(draft.body.defaults.max_cost_pct_retail.value, '30', 'the draft copied the chain defaults forward');
  eq(childOf(draft.body, FOOD, COFFEE)?.fields.price_cap_pct_retail.value, '40', '...and the L3 rows with it');
}

// ── Discard throws the draft away and leaves the published version alone ─────
{
  const before = await get('merch-criteria', 'u-su');
  const d = await post('merch-criteria-discard', 'u-su', {});
  eq(d.status, 200, 'discard succeeds');
  const after = await get('merch-criteria', 'u-su');
  eq(after.body.draft, null, 'no draft remains');
  eq(after.body.live, before.body.live, 'the live version is untouched');
  eq(l2Of(after.body, FOOD).core, true, 'the discarded edit is gone');
  const again = await post('merch-criteria-discard', 'u-su', {});
  eq(again.status, 409, 'discarding nothing is a 409, not a silent success');
}

// ── The change log is a diff between published versions ──────────────────────
{
  await post('merch-criteria-draft', 'u-su', { cells: [{ category: ORAL, field: 'min_margin_per_unit', value: '0.75' }] });
  await post('merch-criteria-publish', 'u-su', { note: 'oral care margin floor, per Brandon' });
  const { body } = await get('merch-criteria-log', 'u-su');
  const entry = (body.entries || []).find(e => e.category === ORAL && e.field === 'min_margin_per_unit');
  ok(entry, 'the change appears in the log');
  eq(entry.from, null, 'old value recorded');
  eq(entry.to, '0.75', 'new value recorded');
  eq(entry.note, 'oral care margin floor, per Brandon', 'the publish note travels with the change');
  eq(entry.level, 'l3', 'the log says which level moved');
  eq(entry.label, 'Oral', '...and labels it for a human');
}

// ── Who may touch criteria — BY ROLE, not by person ──────────────────────────
// superuser and admin both read and both write. Everything below admin is refused in
// both directions. Pinned per role rather than per named user so that changing who
// holds which account cannot quietly change who can move a threshold.
{
  for (const [user, role] of [['u-su', 'superuser'], ['u-admin', 'admin']]) {
    const read = await get('merch-criteria', user);
    eq(read.status, 200, `a ${role} may READ criteria`);
    const write = await post('merch-criteria-draft', user, { cells: [{ category: SNACKS, field: 'cash_back_days', value: '35' }] });
    eq(write.status, 200, `a ${role} may WRITE criteria`);
  }
  for (const [user, role] of [['u-mgr1', 'manager'], ['u-exec', 'executive'], ['u-staff', 'staff']]) {
    const read = await get('merch-criteria', user);
    ok(read.status === 403, `🛑 a ${role} may NOT read criteria (got ${read.status})`);
    const write = await post('merch-criteria-draft', user, { cells: [{ category: SNACKS, field: 'cash_back_days', value: '99' }] });
    ok(write.status === 403, `🛑 a ${role} may NOT write criteria (got ${write.status})`);
  }
  // The publish path is the one that actually moves the live numbers — check it by
  // role too, not just the draft endpoint.
  const mgrPublish = await post('merch-criteria-publish', 'u-mgr1', { note: 'nope' });
  eq(mgrPublish.status, 403, '🛑 a manager may not publish');
  const adminPublish = await post('merch-criteria-publish', 'u-admin', { note: 'admin publish is allowed' });
  eq(adminPublish.status, 200, 'an admin may publish');
}

// ── Unknown fields and categories are refused, not silently stored ───────────
// (the role block above published its draft, so this opens a fresh one)
{
  const f = await post('merch-criteria-draft', 'u-su', { cells: [{ category: SNACKS, field: 'nonsense', value: '1' }] });
  eq(f.status, 400, 'an unknown field is refused');
  const c = await post('merch-criteria-draft', 'u-su', { cells: [{ category: 'NOT A CATEGORY', field: 'core', value: '1' }] });
  eq(c.status, 400, 'an unknown category is refused');
  const s = await post('merch-criteria-draft', 'u-su', { cells: [{ category: 'Sku Book Items', field: 'core', value: '1' }] });
  eq(s.status, 400, 'Sku Book Items is refused as a criteria row');
}

// ═══ Removed: Shelf Count, Coverage, Velocity (2026-11-24) ═══════════════
// The pages went in #410 and their endpoints after them. The shelf_counts table and its
// rows stay (nothing is dropped); what must not survive is any door that writes to it or
// reads it out, for anyone. The business gate refuses an action it does not know: 403.
{
  const SUN = '2026-08-23';   // a Sunday
  await post('merch-criteria-draft', 'u-su', { cells: [{ category: FOOD, field: 'core', value: '1' }] });
  await post('merch-criteria-publish', 'u-su', { note: 'core = food, so a count would have been accepted' });
  const before = db.prepare('SELECT COUNT(*) AS n FROM shelf_counts').get().n;
  for (const user of ['u-su', 'u-mgr1']) {
    const w = await post('shelf-count-save', user, { store: 'BL1', week_ending: SUN, counts: [{ category: FOOD, bays: 4 }] });
    eq(w.status, 403, `🛑 shelf-count-save is gone for ${user}`);
    for (const action of ['shelf-counts', 'merch-coverage', 'merch-velocity']) {
      eq((await get(action, user, '&store=BL1')).status, 403, `🛑 ${action} is gone for ${user}`);
    }
  }
  eq(db.prepare('SELECT COUNT(*) AS n FROM shelf_counts').get().n, before, '🛑 no shelf count was written');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
