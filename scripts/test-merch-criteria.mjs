// Merchandising: buy criteria + weekly shelf counts, driven through the REAL
// endpoints via worker.fetch.
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
//   4. A MANAGER CANNOT COUNT SOMEONE ELSE'S SHELVES. Same scope rule as
//      supply-request-create.
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

// ═══ Shelf counts ═══════════════════════════════════════════════════════════
const SUN = '2026-08-23';   // a Sunday

// Publish a core definition first — a count is meaningless before one exists, and the
// save endpoint refuses categories the live criteria has not called core.
await post('merch-criteria-draft', 'u-su', { cells: [{ category: FOOD, field: 'core', value: '1' }] });
await post('merch-criteria-publish', 'u-su', { note: 'core = food, for the shelf-count tests' });

// ── 🛑 A manager may only count their own stores ─────────────────────────────
{
  const mine = await post('shelf-count-save', 'u-mgr1', { store: 'BL1', week_ending: SUN, counts: [{ category: FOOD, bays: 4 }] });
  eq(mine.status, 200, 'a BL1 manager may count BL1');
  const theirs = await post('shelf-count-save', 'u-mgr1', { store: 'BL4', week_ending: SUN, counts: [{ category: FOOD, bays: 4 }] });
  eq(theirs.status, 403, '🛑 a BL1 manager may NOT count BL4');
  const read = await get('shelf-counts', 'u-mgr1', '&store=BL4');
  eq(read.status, 403, '...and may not read BL4 either');
  const su = await post('shelf-count-save', 'u-su', { store: 'BL4', week_ending: SUN, counts: [{ category: FOOD, bays: 9 }] });
  eq(su.status, 200, 'a superuser may count any store');
}

// ── week_ending must be the Sunday, and the error says which ─────────────────
{
  const r = await post('shelf-count-save', 'u-mgr1', { store: 'BL1', week_ending: '2026-08-19', counts: [{ category: FOOD, bays: 1 }] });
  eq(r.status, 400, 'a mid-week date is refused');
  ok(/2026-08-23/.test(r.body.error || ''), 'the error names the Sunday it should have been');
}

// ── Bays are validated; the other-food bucket is a legal category ────────────
{
  const neg = await post('shelf-count-save', 'u-mgr1', { store: 'BL1', week_ending: SUN, counts: [{ category: FOOD, bays: -1 }] });
  eq(neg.status, 400, 'negative bays refused');
  const nan = await post('shelf-count-save', 'u-mgr1', { store: 'BL1', week_ending: SUN, counts: [{ category: FOOD, bays: 'lots' }] });
  eq(nan.status, 400, 'non-numeric bays refused');
  const other = await post('shelf-count-save', 'u-mgr1', { store: 'BL1', week_ending: SUN, counts: [{ category: '__other__:' + FOOD, bays: 12 }] });
  eq(other.status, 400, 'a remainder bucket with no core children to remain FROM is refused');
  const bogus = await post('shelf-count-save', 'u-mgr1', { store: 'BL1', week_ending: SUN, counts: [{ category: 'MADE UP', bays: 1 }] });
  eq(bogus.status, 400, 'an unknown category is refused');
}

// ── Append-only: a correction adds a row, and the newest wins ────────────────
{
  await post('shelf-count-save', 'u-mgr1', { store: 'BL1', week_ending: SUN, counts: [{ category: FOOD, bays: 7 }] });
  const rows = db.prepare(`SELECT bays FROM shelf_counts WHERE store='BL1' AND week_ending=? AND category=? ORDER BY id`)
                 .all(SUN, FOOD).map(r => r.bays);
  ok(rows.length >= 2, `the original count survives the correction (${rows.length} rows)`);
  const { body } = await get('shelf-counts', 'u-mgr1', `&store=BL1&week_ending=${SUN}`);
  eq(body.counts[FOOD].bays, 7, 'the newest count is the one read back');
  eq(body.entered, true, 'the week is marked as entered');
}

// ── The form prefills from last week ─────────────────────────────────────────
{
  const { body } = await get('shelf-counts', 'u-mgr1', '&store=BL1&week_ending=2026-08-30');
  eq(body.week_ending, '2026-08-30', 'asked-for week echoed');
  eq(body.previous_week_ending, SUN, 'the previous week is identified');
  eq(body.previous[FOOD].bays, 7, "last week's value comes back to prefill the form");
  eq(body.entered, false, 'the new week is not yet entered');
  eq(Object.keys(body.counts).length, 0, 'and has no counts of its own');
}

// ── 🔑 The form's question list FOLLOWS the level core was set at ────────────
// A store manager cannot read the criteria endpoint, so the list arrives with the
// form's own data — and which rows it contains is the whole point of the three-level
// table.
{
  // Only the L2 is core → the manager counts ONE number for food.
  await post('merch-criteria-draft', 'u-su', { cells: [{ category: FOOD, field: 'core', value: '1' }] });
  await post('merch-criteria-publish', 'u-su', { note: 'core = food' });
  let cats = (await get('shelf-counts', 'u-mgr1', '&store=BL1')).body.categories || [];
  eq(cats.length, 1, 'one row for a core L2 with no core children');
  eq(cats[0].key, FOOD, '...and it is the L2 itself');
  eq(cats[0].level, 'l2', '...counted at L2 level');

  // Flag an L3 under it → that L3 is counted separately, and the remainder gets a row
  // so the L2's share still adds up instead of being double-counted.
  await post('merch-criteria-draft', 'u-su', { cells: [{ category: COFFEE, field: 'core', value: '1' }] });
  await post('merch-criteria-publish', 'u-su', { note: 'coffee counted on its own' });
  cats = (await get('shelf-counts', 'u-mgr1', '&store=BL1')).body.categories || [];
  eq(cats.length, 2, 'the core L3 plus an "other" remainder');
  ok(cats.some(c => c.key === COFFEE && c.level === 'l3'), 'the core L3 is counted on its own');
  const other = cats.find(c => c.level === 'other');
  ok(other, 'the remainder of the L2 still gets a row');
  eq(other.label, 'Other food', '...labelled plainly');
  ok(!cats.some(c => c.key === FOOD), '...and the parent is NOT also counted whole');

  // A DRAFT flag changes nothing — nobody counts against an unpublished definition.
  await post('merch-criteria-draft', 'u-su', { cells: [{ category: HBA, field: 'core', value: '1' }] });
  const after = (await get('shelf-counts', 'u-mgr1', '&store=BL1')).body.categories || [];
  ok(!after.some(c => c.key === HBA), '🛑 a DRAFT core flag does not change what managers are asked to count');
  await post('merch-criteria-discard', 'u-su', {});
}

// ── A count is refused unless the live criteria actually asked for it ────────
{
  const good = await post('shelf-count-save', 'u-mgr1', { store: 'BL1', week_ending: SUN, counts: [{ category: COFFEE, bays: 3 }] });
  eq(good.status, 200, 'a category the form asked for is accepted');
  const stale = await post('shelf-count-save', 'u-mgr1', { store: 'BL1', week_ending: SUN, counts: [{ category: ORAL, bays: 3 }] });
  eq(stale.status, 400, '🛑 a category the live criteria does not call core is refused');
  const other = await post('shelf-count-save', 'u-mgr1', { store: 'BL1', week_ending: SUN, counts: [{ category: '__other__:' + FOOD, bays: 9 }] });
  eq(other.status, 200, 'the remainder bucket is accepted');
}

// ── An unauthenticated request gets nothing ──────────────────────────────────
{
  const r = await call('/?action=shelf-counts&store=BL1', {});
  eq(r.status, 401, 'no session → 401');
  const w = await call('/?action=shelf-count-save', { method: 'POST', body: { store: 'BL1', week_ending: SUN, counts: [{ category: FOOD, bays: 1 }] } });
  eq(w.status, 401, 'no session → 401 on write too');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
