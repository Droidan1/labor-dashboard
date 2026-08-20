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
db.exec(fs.readFileSync(path.join(repo, 'migration-041.sql'), 'utf8'));
applyMigrationAlters(db, repo);   // harness rule: re-run after a migration creates tables

const call = async (url, opts) => {
  const r = await worker.fetch(req(url, opts), env, ctx);
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = { _raw: text.slice(0, 120) }; }
  return { status: r.status, body };
};
const get   = (action, user, qs = '') => call(`/?action=${action}${qs}`, { user });
const post  = (action, user, body) => call(`/?action=${action}`, { user, method: 'POST', body });

const SNACKS = 'FG BL CONSUMABLES - FOOD - SNACKS';
const ORAL   = 'FG BL CONSUMABLES - HBA - ORAL';

console.log('Merchandising — buy criteria + shelf counts');

// ── 🛑 A virgin install still renders a table you can author v1 in ───────────
// Shipped broken: the no-versions branch returned `categories: []`, so the very first
// visit showed a lone "Chain default" row with nothing to tick core on. v1 could not be
// authored through the page that exists to author it.
{
  const { body } = await get('merch-criteria', 'u-su');
  eq(body.version, null, 'no version yet');
  ok((body.categories || []).length > 40, `the full category list is offered anyway (got ${(body.categories || []).length})`);
  ok(body.categories.every(c => c.core === false), 'nothing is core until someone says so');
  ok(body.categories.some(c => c.l3 === SNACKS), 'a core candidate is present to tick');
  ok(body.defaults && 'max_cost_pct_retail' in body.defaults, 'the chain-default row is present to fill in');
}

// ── The category list is L3, grouped by L2 ───────────────────────────────────
// If this ever collapses to the 15 coarse L2 buckets, the core flag becomes one
// boolean over all food and the whole module stops answering its own question.
{
  await post('merch-criteria-draft', 'u-su', { cells: [{ l3: SNACKS, field: 'core', value: '1' }] });
  const { body } = await get('merch-criteria', 'u-su');
  const cats = body.categories || [];
  ok(cats.length > 40, `criteria rows are L3-level, not L2 (got ${cats.length} rows)`);
  ok(cats.some(c => c.l3 === SNACKS && c.l2 === 'Consumable Food'),
     'snacks is a row of its own, grouped under Consumable Food');
  ok(!cats.some(c => c.l3 === 'Sku Book Items'), 'Sku Book Items is excluded — a POS page, not a category');
  ok(!cats.some(c => ['Refund', 'Gift Cards'].includes(c.l2)), 'ledger artifacts are excluded');
}

// ── Inheritance: a blank cell resolves to the chain default, and says so ──────
{
  const { body } = await get('merch-criteria', 'u-su');
  const oral = body.categories.find(c => c.l3 === ORAL);
  eq(oral.fields.max_cost_pct_retail.value, '30', 'oral care inherits the 30% chain default');
  eq(oral.fields.max_cost_pct_retail.inherited, true, '...and is marked inherited so the UI can grey it');
  const snacks = body.categories.find(c => c.l3 === SNACKS);
  eq(snacks.fields.core.inherited, false, 'an overridden cell is marked as an override');
  eq(snacks.core, true, 'core resolves to a boolean for the caller');
  eq(body.categories.find(c => c.l3 === ORAL).core, false, 'un-flagged categories are not core');
}

// ── A chain default cannot be cleared — it is what everything else inherits ───
{
  const r = await post('merch-criteria-draft', 'u-su', { cells: [{ l3: null, field: 'max_cost_pct_retail', value: null }] });
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
  eq(before.body.categories.find(c => c.l3 === SNACKS).core, true, 'v1 has snacks core');

  // Editing after a publish opens a NEW draft rather than touching v1.
  await post('merch-criteria-draft', 'u-su', { cells: [{ l3: SNACKS, field: 'core', value: '0' }] });
  const after = await get('merch-criteria', 'u-su', `&version=${v1}`);
  eq(after.body.categories.find(c => c.l3 === SNACKS).core, true,
     '🛑 v1 still reads exactly as published after a later edit');

  const now = await get('merch-criteria', 'u-su');
  eq(now.body.live, v1, 'live is still v1 — an unpublished draft does not become live');
  ok(now.body.draft === v1 + 1, `a new draft opened as v${v1 + 1}, got ${now.body.draft}`);
  eq(now.body.version, v1, 'the default read is the LIVE version, not the draft');

  // The draft copied v1 forward, so untouched cells survive.
  const draft = await get('merch-criteria', 'u-su', `&version=${now.body.draft}`);
  eq(draft.body.categories.find(c => c.l3 === SNACKS).core, false, 'the draft carries the edit');
  eq(draft.body.defaults.max_cost_pct_retail.value, '30', 'the draft copied the chain defaults forward');
}

// ── Discard throws the draft away and leaves the published version alone ─────
{
  const before = await get('merch-criteria', 'u-su');
  const d = await post('merch-criteria-discard', 'u-su', {});
  eq(d.status, 200, 'discard succeeds');
  const after = await get('merch-criteria', 'u-su');
  eq(after.body.draft, null, 'no draft remains');
  eq(after.body.live, before.body.live, 'the live version is untouched');
  eq(after.body.categories.find(c => c.l3 === SNACKS).core, true, 'the discarded edit is gone');
  const again = await post('merch-criteria-discard', 'u-su', {});
  eq(again.status, 409, 'discarding nothing is a 409, not a silent success');
}

// ── The change log is a diff between published versions ──────────────────────
{
  await post('merch-criteria-draft', 'u-su', { cells: [{ l3: ORAL, field: 'min_margin_per_unit', value: '0.75' }] });
  await post('merch-criteria-publish', 'u-su', { note: 'oral care margin floor, per Brandon' });
  const { body } = await get('merch-criteria-log', 'u-su');
  const entry = (body.entries || []).find(e => e.l3 === ORAL && e.field === 'min_margin_per_unit');
  ok(entry, 'the change appears in the log');
  eq(entry.from, null, 'old value recorded');
  eq(entry.to, '0.75', 'new value recorded');
  eq(entry.note, 'oral care margin floor, per Brandon', 'the publish note travels with the change');
}

// ── Who may touch criteria — BY ROLE, not by person ──────────────────────────
// superuser and admin both read and both write. Everything below admin is refused in
// both directions. Pinned per role rather than per named user so that changing who
// holds which account cannot quietly change who can move a threshold.
{
  for (const [user, role] of [['u-su', 'superuser'], ['u-admin', 'admin']]) {
    const read = await get('merch-criteria', user);
    eq(read.status, 200, `a ${role} may READ criteria`);
    const write = await post('merch-criteria-draft', user, { cells: [{ l3: SNACKS, field: 'cash_back_days', value: '35' }] });
    eq(write.status, 200, `a ${role} may WRITE criteria`);
  }
  for (const [user, role] of [['u-mgr1', 'manager'], ['u-exec', 'executive'], ['u-staff', 'staff']]) {
    const read = await get('merch-criteria', user);
    ok(read.status === 403, `🛑 a ${role} may NOT read criteria (got ${read.status})`);
    const write = await post('merch-criteria-draft', user, { cells: [{ l3: SNACKS, field: 'cash_back_days', value: '99' }] });
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
  const f = await post('merch-criteria-draft', 'u-su', { cells: [{ l3: SNACKS, field: 'nonsense', value: '1' }] });
  eq(f.status, 400, 'an unknown field is refused');
  const c = await post('merch-criteria-draft', 'u-su', { cells: [{ l3: 'NOT A CATEGORY', field: 'core', value: '1' }] });
  eq(c.status, 400, 'an unknown category is refused');
  const s = await post('merch-criteria-draft', 'u-su', { cells: [{ l3: 'Sku Book Items', field: 'core', value: '1' }] });
  eq(s.status, 400, 'Sku Book Items is refused as a criteria row');
}

// ═══ Shelf counts ═══════════════════════════════════════════════════════════
const SUN = '2026-08-23';   // a Sunday

// ── 🛑 A manager may only count their own stores ─────────────────────────────
{
  const mine = await post('shelf-count-save', 'u-mgr1', { store: 'BL1', week_ending: SUN, counts: [{ l3: SNACKS, bays: 4 }] });
  eq(mine.status, 200, 'a BL1 manager may count BL1');
  const theirs = await post('shelf-count-save', 'u-mgr1', { store: 'BL4', week_ending: SUN, counts: [{ l3: SNACKS, bays: 4 }] });
  eq(theirs.status, 403, '🛑 a BL1 manager may NOT count BL4');
  const read = await get('shelf-counts', 'u-mgr1', '&store=BL4');
  eq(read.status, 403, '...and may not read BL4 either');
  const su = await post('shelf-count-save', 'u-su', { store: 'BL4', week_ending: SUN, counts: [{ l3: SNACKS, bays: 9 }] });
  eq(su.status, 200, 'a superuser may count any store');
}

// ── week_ending must be the Sunday, and the error says which ─────────────────
{
  const r = await post('shelf-count-save', 'u-mgr1', { store: 'BL1', week_ending: '2026-08-19', counts: [{ l3: SNACKS, bays: 1 }] });
  eq(r.status, 400, 'a mid-week date is refused');
  ok(/2026-08-23/.test(r.body.error || ''), 'the error names the Sunday it should have been');
}

// ── Bays are validated; the other-food bucket is a legal category ────────────
{
  const neg = await post('shelf-count-save', 'u-mgr1', { store: 'BL1', week_ending: SUN, counts: [{ l3: SNACKS, bays: -1 }] });
  eq(neg.status, 400, 'negative bays refused');
  const nan = await post('shelf-count-save', 'u-mgr1', { store: 'BL1', week_ending: SUN, counts: [{ l3: SNACKS, bays: 'lots' }] });
  eq(nan.status, 400, 'non-numeric bays refused');
  const other = await post('shelf-count-save', 'u-mgr1', { store: 'BL1', week_ending: SUN, counts: [{ l3: '__other_food__', bays: 12 }] });
  eq(other.status, 200, 'the other-food bucket is accepted — it is the floor-share denominator');
  const bogus = await post('shelf-count-save', 'u-mgr1', { store: 'BL1', week_ending: SUN, counts: [{ l3: 'MADE UP', bays: 1 }] });
  eq(bogus.status, 400, 'an unknown category is refused');
}

// ── Append-only: a correction adds a row, and the newest wins ────────────────
{
  await post('shelf-count-save', 'u-mgr1', { store: 'BL1', week_ending: SUN, counts: [{ l3: SNACKS, bays: 7 }] });
  const rows = db.prepare(`SELECT bays FROM shelf_counts WHERE store='BL1' AND week_ending=? AND l3=? ORDER BY id`)
                 .all(SUN, SNACKS).map(r => r.bays);
  ok(rows.length >= 2, `the original count survives the correction (${rows.length} rows)`);
  const { body } = await get('shelf-counts', 'u-mgr1', `&store=BL1&week_ending=${SUN}`);
  eq(body.counts[SNACKS].bays, 7, 'the newest count is the one read back');
  eq(body.entered, true, 'the week is marked as entered');
}

// ── The form prefills from last week ─────────────────────────────────────────
{
  const { body } = await get('shelf-counts', 'u-mgr1', '&store=BL1&week_ending=2026-08-30');
  eq(body.week_ending, '2026-08-30', 'asked-for week echoed');
  eq(body.previous_week_ending, SUN, 'the previous week is identified');
  eq(body.previous[SNACKS].bays, 7, "last week's value comes back to prefill the form");
  eq(body.entered, false, 'the new week is not yet entered');
  eq(Object.keys(body.counts).length, 0, 'and has no counts of its own');
}

// ── The form carries its own question list, from the LIVE criteria ───────────
// A store manager cannot read the criteria endpoint, so the core list has to arrive
// with the form's data or the page cannot be drawn at all.
{
  const { body } = await get('shelf-counts', 'u-mgr1', '&store=BL1');
  const cats = body.categories || [];
  ok(cats.some(c => c.l3 === SNACKS), 'the published core category is on the form');
  ok(cats.some(c => c.l3 === '__other_food__'), 'the other-food bucket is on the form');
  ok(!cats.some(c => c.l3 === ORAL), 'a non-core category is not');
  eq(cats.find(c => c.l3 === SNACKS).label, 'Snacks', 'the warehouse string is labelled for a human');
  // Reads the LIVE version, never a draft — nobody counts against an unpublished definition.
  await post('merch-criteria-draft', 'u-su', { cells: [{ l3: ORAL, field: 'core', value: '1' }] });
  const after = await get('shelf-counts', 'u-mgr1', '&store=BL1');
  ok(!after.body.categories.some(c => c.l3 === ORAL),
     '🛑 a DRAFT core flag does not change what managers are asked to count');
  await post('merch-criteria-discard', 'u-su', {});
}

// ── An unauthenticated request gets nothing ──────────────────────────────────
{
  const r = await call('/?action=shelf-counts&store=BL1', {});
  eq(r.status, 401, 'no session → 401');
  const w = await call('/?action=shelf-count-save', { method: 'POST', body: { store: 'BL1', week_ending: SUN, counts: [{ l3: SNACKS, bays: 1 }] } });
  eq(w.status, 401, 'no session → 401 on write too');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
