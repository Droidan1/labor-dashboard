// Mark Out of Stock — the sticker decode, the cost, the learned code map, and the gate.
//
// 🔑 THE POINT OF THIS SUITE is that every number on the page is derived, not typed.
// A sticker code carries the retail price in its last segment; the category name comes
// from a map; the cost comes from a second map keyed on that name. Four hops from
// twelve characters to a dollar figure that lands in a monthly shrink total, and the
// wrong answer at any hop still LOOKS like a number. So each hop is pinned here against
// the real worker, with the real production shapes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, ctx, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let assertions = 0, failures = 0;
const ok = (c, m) => { assertions++; if (!c) { failures++; console.error('  FAIL ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// Pinned to a Wednesday EVENING in Eastern time — 2026-09-09T23:30Z is 7:30pm ET on the
// 9th. That is deliberately inside the window where the UTC date and the ET date differ
// on the last day of a month, which is the case the month grouping has to get right.
const PINNED = '2026-09-09T23:30:00Z';
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(PINNED); else super(...a); }
  static now() { return new RealDate(PINNED).getTime(); }
};

const worker = await loadWorker(repo);

// The two categories from Brian's own example sheet, with the costs production actually
// holds for them (read from category-costs:global on 2026-09-10).
const CONDIMENTS = 'FG BL CONSUMABLES - FOOD - CONDIMENTS';
const SEASONAL = 'FG BL SEASONAL - SPRING/SUMMER';

function env0({ seedMap = true, seedCosts = true } = {}) {
  const { db, env } = makeEnv(repo);
  db.exec(fs.readFileSync(path.join(repo, 'migration-062.sql'), 'utf8'));
  applyMigrationAlters(db, repo);   // 🔑 again, AFTER the migration created its tables
  if (seedCosts) {
    env.SALES_SNAPSHOTS.put('category-costs:global', JSON.stringify({
      costs: { [CONDIMENTS]: 0.25, [SEASONAL]: 0.35, 'FG BL PAPER - NON INVENTORY': null },
      importedAt: '2026-08-25T17:57:26Z', count: 3,
    }));
  }
  if (seedMap) {
    // Shaped exactly like the live KV value: { map: {name: code}, field, codes, at }.
    // 50038 is at BL1. 14279 is at NO store — its spring/summer stock has left Clover,
    // which is the case the learned table exists for.
    env.SALES_SNAPSHOTS.put('sticker:category-codes:BL1', JSON.stringify({
      map: { [CONDIMENTS]: '50038', 'FG BL HARDLINES - BABY': '14281' },
      field: 'code', codes: [], at: new RealDate(PINNED).toISOString(),
    }));
  }
  return { db, env };
}

const call = (url, opts = {}) => worker.fetch(req(url, opts), opts.env, ctx);
const json = async (r) => { try { return await r.json(); } catch { return {}; } };

// Grant a page to the staff fixture, the way associate-save would.
function grantPages(db, pages, userId = 'u-staff') {
  db.prepare('UPDATE users SET pages = ?, pin_hash = ? WHERE id = ?')
    .run(JSON.stringify(pages), 'deadbeef', userId);
}

console.log('\n── 1. The sticker code decodes, in every spelling it arrives in ──');
{
  // The pure core, lifted from worker.js rather than restated — a test that
  // reimplements the parser will happily agree with itself while production differs.
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const grab = (re, what) => { const m = src.match(re); if (!m) throw new Error('could not extract ' + what); return m[0]; };
  const { mosNormalizeCode, mosParseCode } = new Function(
    grab(/function mosNormalizeCode\(raw\) \{[\s\S]*?\n\}/, 'mosNormalizeCode') + '\n' +
    grab(/function mosParseCode\(code\) \{[\s\S]*?\n\}/, 'mosParseCode') +
    '; return { mosNormalizeCode, mosParseCode };')();

  // 🔑 The three spellings of one sticker must collapse to one string, or a month
  // cannot be totalled: the QR carries an underscore, a person types a dot, and
  // Brian's sheet has BL-, Bl- and bl- in the same column.
  for (const raw of ['BL-50038-1_5', 'BL-50038-1.5', 'bl-50038-1.5', 'Bl-50038-1_5', ' BL-50038-1_5 ']) {
    eq(mosNormalizeCode(raw), 'BL-50038-1_5', `${JSON.stringify(raw)} normalises to one code`);
  }
  // The price encoding, which is a SHAPE and not just a value — $10.00 has no separator.
  const cents = (c) => mosParseCode(mosNormalizeCode(c)).priceCents;
  eq(cents('BL-50038-1_5'), 150, '1_5 is $1.50');
  eq(cents('BL-50038-1'), 100, 'a bare 1 is $1.00');
  eq(cents('BL-50038-10'), 1000, '🔑 a bare 10 is $10.00, not $0.10 — no separator is a real shape');
  eq(cents('BL-50038-1_75'), 175, '1_75 is $1.75');
  eq(cents('BL-50038-3_25'), 325, '3_25 is $3.25');
  eq(cents('BL-14279-60'), 6000, '60 is $60.00');
  // 🛑 The float trap: 1.75 * 100 is 174.99999999999997 in IEEE 754, and truncating
  // is a penny short on every such line in a column that gets summed for a month.
  eq(mosParseCode('BL-50038-1_75').priceCents, 175, 'the cents conversion rounds rather than truncates');
  eq(mosParseCode('BL-50038-29_99').priceCents, 2999, '29_99 survives the same rounding');

  // 🔑 A STICKER MAY CARRY NO PRICE AT ALL (Brian, 2026-09-10). `BL-10380` is whole.
  // The item is still fully identified, and cost comes from the CATEGORY, so the
  // number this page exists for survives; only the retail figure is unknown.
  eq(mosNormalizeCode('BL-10380'), 'BL-10380', 'a priceless sticker is a sticker');
  eq(mosNormalizeCode('bl-10380'), 'BL-10380', 'and normalises for case');
  eq(mosNormalizeCode(' BL-10380 '), 'BL-10380', 'and for whitespace');
  eq(mosParseCode('BL-10380').itemNo, '10380', 'its item number reads');
  eq(mosParseCode('BL-10380').priceCents, null,
     '🛑 its price is NULL, not 0 — zero would be a free item, which is a different claim');
  eq(mosNormalizeCode('BL-10380-'), null, 'a trailing hyphen is not a sticker');
  eq(mosNormalizeCode('BL-'), null, 'nor a bare prefix');
  eq(mosNormalizeCode('BL-10380-x'), null, 'nor a non-numeric price');
  eq(mosParseCode('BL-50038-0'), null, 'a price segment that IS present must be real');

  eq(mosNormalizeCode('50038-1_5'), null, 'no BL- prefix is not a sticker');
  eq(mosNormalizeCode('BL-ABC-1'), null, 'a non-numeric item is not a sticker');
  eq(mosNormalizeCode(''), null, 'empty is not a sticker');
  eq(mosNormalizeCode(null), null, 'null is not a sticker');
  eq(mosParseCode('BL-50038-0'), null, '$0.00 is refused — a sticker is never free');
  eq(mosNormalizeCode('BL-50038-1_567'), null, 'three decimal places is not a price');
  eq(mosNormalizeCode('https://evil.example/BL-50038-1_5'), null, 'a URL containing a code is not a code');
}

console.log('\n── 2. Lookup resolves the name, the price and the cost ──');
{
  const { env } = env0();
  const r = await call('/?action=mos-lookup&store=BL1&code=BL-50038-1_5', { user: 'u-mgr1', env });
  const j = await json(r);
  eq(r.status, 200, 'a manager can look a sticker up');
  eq(j.item_no, '50038', 'the item number is the middle segment');
  eq(j.description, CONDIMENTS, 'the description comes from the category map');
  eq(j.unit_price_cents, 150, 'the retail price decodes from the code');
  eq(j.unit_cost_cents, 25, 'the cost comes from the per-category cost list');
  eq(j.needs_description, false, 'a known code needs no teaching');
}
{
  // 🛑 THE COST MUST COME FROM `categories`, NOT `items`. Those two maps are keyed by
  // different numbering schemes that overlap: 50038 is a valid key in both, and the
  // item map would answer with an unrelated product's cost that still looks plausible.
  const { env } = env0();
  env.SALES_SNAPSHOTS.put('item-costs:global', JSON.stringify({
    items: { '50038': { cost: 99.99, desc: 'a DIFFERENT thing with a colliding number' } },
    importedAt: 'x', count: 1,
  }));
  const j = await json(await call('/?action=mos-lookup&store=BL1&code=BL-50038-1_5', { user: 'u-mgr1', env }));
  eq(j.unit_cost_cents, 25, '🔑 the colliding IM# cost is NOT used — 25c, not 9999c');
}
{
  const { env } = env0({ seedCosts: false });
  const j = await json(await call('/?action=mos-lookup&store=BL1&code=BL-50038-1_5', { user: 'u-mgr1', env }));
  eq(j.unit_cost_cents, null, '🛑 no cost on file is NULL, never 0 — zero would read as free stock');
  eq(j.description, CONDIMENTS, 'and the rest still resolves');
}

console.log('\n── 3. Learning a code the live map cannot name ──');
{
  // The case from Brian's sheet: 14279 is spring/summer, its stock is gone from Clover
  // in September, and it resolves at no store. Six of his thirteen rows were this.
  const { db, env } = env0();
  const j = await json(await call('/?action=mos-lookup&store=BL1&code=BL-14279-3', { user: 'u-mgr1', env }));
  eq(j.description, null, '14279 resolves to nothing — its stock has left Clover');
  eq(j.needs_description, true, 'so the screen is told to ask');
  eq(j.unit_price_cents, 300, 'the price still decodes — that is in the code itself');
  eq(j.unit_cost_cents, null, 'and there is no cost without a name to look it up by');

  // Logging without a name is refused rather than storing a nameless row.
  const bad = await call('/?action=mos-log', { user: 'u-mgr1', method: 'POST', env,
    body: { store: 'BL1', code: 'BL-14279-3', qty: 5, reason: 'Damaged' } });
  eq(bad.status, 400, 'logging an unnamed code is refused');
  eq((await json(bad)).code, 'NEEDS_DESCRIPTION', 'and says exactly why');

  // Junk cannot become a category name: this write is permanent and chain-wide.
  for (const junk of ['-', '12', 'n/a', 'ab']) {
    const r = await call('/?action=mos-log', { user: 'u-mgr1', method: 'POST', env,
      body: { store: 'BL1', code: 'BL-14279-3', qty: 5, reason: 'Damaged', description: junk } });
    eq(r.status, 400, `${JSON.stringify(junk)} cannot become a category name`);
  }

  const good = await call('/?action=mos-log', { user: 'u-mgr1', method: 'POST', env,
    body: { store: 'BL1', code: 'BL-14279-3', qty: 5, reason: 'Damaged', description: SEASONAL } });
  eq(good.status, 200, 'a real name is accepted');
  eq((await json(good)).description_source, 'user', 'and recorded as taught by a person');

  const learned = db.prepare("SELECT description, source, taught_by FROM sticker_codes WHERE code = '14279'").all();
  eq(learned.length, 1, 'the name is written to the permanent map');
  eq(learned[0].description, SEASONAL, 'with the text that was typed');
  eq(learned[0].source, 'user', 'marked as taught, not swept');

  // The whole point: the NEXT person gets it for free, and the cost follows the name.
  const after = await json(await call('/?action=mos-lookup&store=BL1&code=BL-14279-60', { user: 'u-mgr1', env }));
  eq(after.description, SEASONAL, '🔑 a different price of the same item now resolves');
  eq(after.needs_description, false, 'nobody is asked twice');
  eq(after.unit_cost_cents, 35, 'and the cost resolves now that the name is known');
}
{
  // A name a person typed must survive a later sweep that happens to see the code.
  const { db, env } = env0();
  db.prepare(`INSERT INTO sticker_codes (code, description, source, taught_by, first_seen, updated_at)
              VALUES ('50038','WHAT THE PERSON TYPED','user','someone','x','x')`).run();
  const j = await json(await call('/?action=mos-lookup&store=BL1&code=BL-50038-1_5', { user: 'u-mgr1', env }));
  eq(j.description, 'WHAT THE PERSON TYPED',
     '🔑 the learned name outranks the live Clover map, which no longer holds the stock');
  eq(j.description_source, 'learned', 'and says where it came from');
}
{
  // A resolve from the live map writes through, so it keeps working once Clover forgets.
  const { db, env } = env0();
  await call('/?action=mos-lookup&store=BL1&code=BL-50038-1_5', { user: 'u-mgr1', env });
  const rows = db.prepare("SELECT description, source FROM sticker_codes WHERE code = '50038'").all();
  eq(rows.length, 1, 'a Clover hit is written through to the permanent map');
  eq(rows[0].source, 'clover', 'marked as swept, so a person can still correct it');
}

console.log('\n── 4. Logging, and what it refuses ──');
{
  const { db, env } = env0();
  const post = (body) => call('/?action=mos-log', { user: 'u-mgr1', method: 'POST', env, body });
  const base = { store: 'BL1', code: 'BL-50038-1_5', qty: 20, reason: 'Expired' };

  const r = await post(base);
  const j = await json(r);
  eq(r.status, 200, 'a manager can log');
  eq(j.unit_cost_cents, 25, 'the cost is snapshotted onto the row');
  eq(j.unit_price_cents, 150, 'so is the price');
  eq(j.month, '2026-09', 'the month is Eastern calendar');

  // 🔑 SNAPSHOTTED, NOT RESOLVED AT READ TIME. Re-importing costs must not silently
  // rewrite what last month's shrink came to.
  env.SALES_SNAPSHOTS.put('category-costs:global', JSON.stringify({ costs: { [CONDIMENTS]: 9.99 }, count: 1 }));
  const list = await json(await call('/?action=mos-list&store=BL1', { user: 'u-mgr1', env }));
  eq(list.rows[0].unit_cost_cents, 25, '🔑 a later cost import does NOT move a row already written');

  for (const [body, why] of [
    [{ ...base, qty: 0 }, 'zero units'],
    [{ ...base, qty: -3 }, 'a negative quantity'],
    [{ ...base, qty: 1.5 }, 'a fractional quantity'],
    [{ ...base, qty: '12abc' }, '🛑 "12abc" — parseInt would have taken the 12'],
    [{ ...base, qty: '1e3' }, '🛑 "1e3" — parseInt would have taken the 1'],
    [{ ...base, qty: 100001 }, 'an absurd quantity'],
    [{ ...base, reason: '' }, 'no reason'],
    [{ ...base, reason: 'Shrinkage' }, 'a reason that is not one of the four'],
    // `BL-50038` is NO LONGER refused — a sticker without a price is a real sticker
    // (Brian, 2026-09-10), covered in section 6b. What stays refused is a code that is
    // malformed rather than merely priceless.
    [{ ...base, code: 'BL-50038-' }, 'a trailing hyphen where a price should be'],
    [{ ...base, code: 'nonsense' }, 'a code that is not a code'],
  ]) {
    eq((await post(body)).status, 400, `refused: ${why}`);
  }
  eq(db.prepare('SELECT COUNT(*) n FROM mos_entries').get().n, 1, 'and none of those wrote a row');
}
{
  // Reason is REQUIRED (Brian, 2026-09-10) — and the client's list must not drift
  // from the worker's, or a button would offer a value the API refuses.
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const client = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const w = src.match(/const MOS_REASONS = \[([^\]]*)\]/)[1].match(/"[^"]+"/g).map(s => s.slice(1, -1));
  const c = client.match(/const MOS_REASON_LIST = \[([^\]]*)\]/)[1].match(/'[^']+'/g).map(s => s.slice(1, -1));
  eq(JSON.stringify(c), JSON.stringify(w), 'the client and worker offer exactly the same reasons');
  eq(w.length, 4, 'and there are four of them');
}

console.log('\n── 5. Store scoping ──');
{
  const { env } = env0();
  // u-mgr1 holds BL1 only.
  const r = await call('/?action=mos-log', { user: 'u-mgr1', method: 'POST', env,
    body: { store: 'BL4', code: 'BL-50038-1_5', qty: 1, reason: 'Expired' } });
  eq(r.status, 403, 'a BL1 manager cannot log against BL4');
  eq((await json(r)).code, 'NO_STORE_ACCESS', 'and is told which gate refused');
  eq((await call('/?action=mos-lookup&store=BL4&code=BL-50038-1_5', { user: 'u-mgr1', env })).status, 403,
     'nor even look one up there');
  // BL8 closed 2026-07-25.
  const closed = await call('/?action=mos-lookup&store=BL8&code=BL-50038-1_5', { user: 'u-admin', env });
  eq(closed.status, 409, 'a closed store cannot lose stock it does not hold');
  ok(!/bins to dump into/.test((await json(closed)).error || ''),
     '🔑 and says so in MOS wording, not Bin Dump\'s');
}

console.log('\n── 6. The month totals do not depend on the display limit ──');
{
  const { env } = env0();
  const post = (qty, reason) => call('/?action=mos-log', { user: 'u-mgr1', method: 'POST', env,
    body: { store: 'BL1', code: 'BL-50038-1_5', qty, reason } });
  await post(10, 'Expired');      // 10 x 25c = 250 cost, 10 x 150 = 1500 retail
  await post(4, 'Store Use');     //  4 x 25c = 100 cost
  await post(6, 'Stolen');        //  6 x 25c = 150 cost

  const j = await json(await call('/?action=mos-list&store=BL1&limit=1', { user: 'u-mgr1', env }));
  eq(j.rows.length, 1, 'the row list honours the limit');
  eq(j.truncated, true, 'and says it was cut');
  const m = j.months.find(x => x.month === '2026-09');
  eq(m.lines, 3, '🔑 the month counts EVERY line, not the one that fitted');
  eq(m.units, 20, 'and every unit');
  eq(m.cost_cents, 500, 'and the whole cost — 250 + 100 + 150');
  eq(m.retail_cents, 3000, 'and the whole retail value');
  // 🔑 Store Use is not shrink. Adding them together is the thing this split exists
  // to prevent — stock the store consumed on purpose is not stock it lost.
  eq(m.shrink_cents, 400, 'shrink is Expired + Stolen only');
  eq(m.store_use_cents, 100, 'store use is counted apart');
  eq(m.shrink_cents + m.store_use_cents, m.cost_cents, 'and the two halves make the whole');
}
{
  // A line with no cost is COUNTED but not silently valued at zero.
  const { env } = env0({ seedCosts: false });
  await call('/?action=mos-log', { user: 'u-mgr1', method: 'POST', env,
    body: { store: 'BL1', code: 'BL-50038-1_5', qty: 8, reason: 'Expired' } });
  const j = await json(await call('/?action=mos-list&store=BL1', { user: 'u-mgr1', env }));
  const m = j.months[0];
  eq(m.lines_without_cost, 1, 'a costless line is counted as such');
  eq(m.cost_cents, 0, 'and contributes nothing to the cost total');
  eq(m.retail_cents, 1200, 'while its retail value still counts — that comes from the code');
}

console.log('\n── 6b. A sticker with no price on it ──');
{
  const { db, env } = env0();
  // 10380 is Halloween Candy in the seeded map, and the category has a cost.
  db.prepare(`INSERT INTO sticker_codes (code, description, source, first_seen, updated_at)
              VALUES ('10380', ?, 'clover', 'x', 'x')`).run(CONDIMENTS);

  const look = await json(await call('/?action=mos-lookup&store=BL1&code=BL-10380', { user: 'u-mgr1', env }));
  eq(look.item_no, '10380', 'lookup accepts it');
  eq(look.unit_price_cents, null, 'with no retail price');
  eq(look.unit_cost_cents, 25, '🔑 but the COST still resolves — it comes from the category, not the price');
  eq(look.needs_description, false, 'and the description resolves as normal');

  const logged = await call('/?action=mos-log', { user: 'u-mgr1', method: 'POST', env,
    body: { store: 'BL1', code: 'BL-10380', qty: 10, reason: 'Damaged' } });
  eq(logged.status, 200, 'and it logs');
  const row = db.prepare('SELECT code, unit_price_cents, unit_cost_cents FROM mos_entries').get();
  eq(row.code, 'BL-10380', 'stored under the code as scanned');
  eq(row.unit_price_cents, null, 'price NULL in the row');
  eq(row.unit_cost_cents, 25, 'cost present in the row');

  // And one priced line alongside it, so the month has both kinds.
  await call('/?action=mos-log', { user: 'u-mgr1', method: 'POST', env,
    body: { store: 'BL1', code: 'BL-50038-1_5', qty: 4, reason: 'Expired' } });
  const m = (await json(await call('/?action=mos-list&store=BL1', { user: 'u-mgr1', env }))).months[0];
  eq(m.lines, 2, 'both lines count');
  eq(m.units, 14, 'and all their units');
  eq(m.cost_cents, 350, '🔑 the COST total includes the priceless line — 10x25c + 4x25c');
  eq(m.retail_cents, 600, 'the RETAIL total excludes it — 4 x $1.50 only');
  eq(m.lines_without_price, 1, '🛑 and the month SAYS its retail total is short by one line');
  eq(m.lines_without_cost, 0, 'while nothing is missing a cost');
  eq(m.shrink_cents, 350, 'both are shrink');
}

console.log('\n── 7. Editing and removing ──');
{
  const { db, env } = env0();
  const id = (await json(await call('/?action=mos-log', { user: 'u-mgr1', method: 'POST', env,
    body: { store: 'BL1', code: 'BL-50038-1_5', qty: 3, reason: 'Expired' } }))).id;

  const up = await call('/?action=mos-update', { user: 'u-mgr1', method: 'POST', env,
    body: { id, qty: 7, reason: 'Damaged' } });
  eq(up.status, 200, 'the two typed fields can be corrected');
  const row = db.prepare('SELECT qty, reason, code, unit_cost_cents, edited_by FROM mos_entries WHERE id = ?').get(id);
  eq(row.qty, 7, 'quantity changed');
  eq(row.reason, 'Damaged', 'reason changed');
  eq(row.code, 'BL-50038-1_5', '🔑 the sticker itself did not — that is a fact, not an opinion');
  eq(row.unit_cost_cents, 25, 'and neither did the snapshotted cost');
  ok(row.edited_by, 'the edit is attributed');

  eq((await call('/?action=mos-update', { user: 'u-mgr1', method: 'POST', env,
      body: { id, qty: 0, reason: 'Damaged' } })).status, 400, 'an edit is validated like a create');
  eq((await call('/?action=mos-update', { user: 'u-mgr1', method: 'POST', env,
      body: { id: 999999, qty: 1, reason: 'Damaged' } })).status, 404, 'editing a row that is not there is a 404');

  eq((await call('/?action=mos-delete', { user: 'u-mgr1', method: 'POST', env, body: { id } })).status, 200,
     'a manager can remove a line');
  eq(db.prepare('SELECT COUNT(*) n FROM mos_entries').get().n, 0, 'and it is gone');
}

console.log('\n── 8. Who may reach it ──');
{
  const { db, env } = env0();
  for (const [user, want, why] of [
    ['u-staff', 403, 'an associate with no pages cannot look anything up'],
    ['u-mgr1', 200, 'a manager can'],
    ['u-admin', 200, 'an admin can'],
    ['u-su', 200, 'a superuser can'],
  ]) {
    eq((await call('/?action=mos-lookup&store=BL1&code=BL-50038-1_5', { user, env })).status, want, why);
  }
  const anon = await worker.fetch(new Request('https://x/?action=mos-lookup&store=BL1&code=BL-50038-1_5'), env, ctx);
  eq(anon.status, 401, 'no session at all is a 401');
}
{
  // view: can read the log, cannot add to it.
  const { db, env } = env0();
  grantPages(db, { mos: 'view' });
  eq((await call('/?action=mos-list&store=BL1', { user: 'u-staff', env })).status, 200, 'view reaches the log');
  const denied = await call('/?action=mos-log', { user: 'u-staff', method: 'POST', env,
    body: { store: 'BL1', code: 'BL-50038-1_5', qty: 1, reason: 'Expired' } });
  eq(denied.status, 403, 'view cannot log');
  eq((await json(denied)).code, 'NEED_PAGE_EDIT', 'and is told it needs edit, not that it needs a manager');
  eq((await call('/?action=mos-lookup&store=BL1&code=BL-50038-1_5', { user: 'u-staff', env })).status, 403,
     'view cannot even resolve a sticker — that is part of entering one');
}
{
  // edit: can add, still cannot delete, and still cannot see money elsewhere.
  const { db, env } = env0();
  grantPages(db, { mos: 'edit' });
  const logged = await call('/?action=mos-log', { user: 'u-staff', method: 'POST', env,
    body: { store: 'BL1', code: 'BL-50038-1_5', qty: 2, reason: 'Expired' } });
  eq(logged.status, 200, 'edit can log');
  const id = (await json(logged)).id;
  eq((await call('/?action=mos-update', { user: 'u-staff', method: 'POST', env,
      body: { id, qty: 3, reason: 'Expired' } })).status, 200, 'edit can correct its own row');
  const del = await call('/?action=mos-delete', { user: 'u-staff', method: 'POST', env, body: { id } });
  eq(del.status, 403, '🛑 edit can NEVER delete — mos-delete is absent from ACTION_PAGE');
  // Refused by the FINANCIAL gate, not by the handler: an action outside ACTION_PAGE
  // never reaches a handler for a role outside FINANCIAL_ROLES, so the code is the
  // role-level one. That is the true reason, and mosErr maps it.
  eq((await json(del)).code, 'NO_FINANCIAL_ACCESS', 'refused at the role gate, before the handler');

  // The page grant is a key to ONE page, not to the app.
  for (const a of ['weekly-summary', 'list-users', 'bin-dump-list', 'item-costs']) {
    eq((await call('/?action=' + a, { user: 'u-staff', env })).status, 403,
       `an MOS grant does not open ${a}`);
  }
}
{
  // A grant for the OTHER page does not open this one.
  const { db, env } = env0();
  grantPages(db, { 'bin-dump': 'edit' });
  eq((await call('/?action=mos-list&store=BL1', { user: 'u-staff', env })).status, 403,
     'a Bin Dump grant does not open Mark Out of Stock');
}

console.log('\n── 9. The page is classified, both sides ──');
{
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const client = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const actionPage = src.slice(src.indexOf('const ACTION_PAGE'), src.indexOf('];', src.indexOf('const ACTION_PAGE')));
  for (const a of ['mos-list', 'mos-lookup', 'mos-log', 'mos-update']) {
    ok(actionPage.includes(`"${a}"`), `${a} is in ACTION_PAGE`);
  }
  ok(!actionPage.includes('"mos-delete"'), '🛑 mos-delete is NOT — no page grant may reach it');
  // Every page the client offers must be one the worker derives, or an admin ticks a
  // box that grants nothing.
  const clientPages = [...client.matchAll(/\{ id: '([\w-]+)', label: '[^']+', nav: '[\w-]+' \}/g)].map(m => m[1]);
  ok(clientPages.includes('mos'), 'the client registry offers the page');
  for (const p of clientPages) {
    ok(actionPage.includes(`["${p}", `) || actionPage.includes(`["${p}",`) || new RegExp(`\\["[\\w-]+",\\s*\\["${p}"`).test(actionPage),
       `the worker has actions behind the client's "${p}" page`);
  }
}

console.log('\n── 10. The decoder ships, and the build will carry it ──');
{
  // 🛑 build.sh is an ALLOWLIST: a file committed but not listed there is never
  // deployed and 404s silently — which for this file means the Scan button loads
  // nothing and fails only in someone's hand, at a pallet.
  const build = fs.readFileSync(path.join(repo, 'scripts/build.sh'), 'utf8');
  const sw = fs.readFileSync(path.join(repo, 'sw.js'), 'utf8');
  ok(fs.existsSync(path.join(repo, 'jsqr.min.js')), 'the decoder is committed');
  ok(/jsqr\.min\.js/.test(build), 'build.sh stages it, or it would never reach production');
  ok(/jsqr\.min\.js/.test(sw), 'sw.js precaches it, so the first scan works with no signal');
  const client = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  ok(!/<script[^>]+jsqr\.min\.js/.test(client),
     'it is NOT a script tag — 127KB must not be parsed by everyone at every app start');
  ok(/mosLoadDecoder/.test(client), 'it is injected on demand instead');
  // The shape guard: Reed-Solomon proves a QR was read correctly, not that it was OURS.
  ok(/mosLooksLikeSticker/.test(client), 'a decoded QR is shape-checked before it is trusted');
  // 🔑 That shape check is a SECOND parser, and a stricter one would silently drop a
  // valid scan on the floor — the camera would see the QR and ignore it.
  const re = client.match(/const MOS_CODE_RE = (\/[^\n]+\/i);/)[1];
  const clientRe = new Function('return ' + re)();
  for (const c of ['BL-10380', 'BL-50038-1_5', 'BL-50038-1.5', 'bl-10380', 'BL-50038-10']) {
    ok(clientRe.test(c), `the client shape check accepts ${c}`);
  }
  for (const c of ['BL-10380-', 'BL-', 'nonsense', 'https://x/BL-10380']) {
    ok(!clientRe.test(c), `and rejects ${JSON.stringify(c)}`);
  }
}

console.log('\n── 11. The store an entry goes into (oppbuys-mos-3) ──');
{
  // 🛑 "All stores" used to fall back to the account's FIRST store, so a loss recorded while
  // reading the whole log was filed under whichever store came first, and a round trip away
  // from the page did the same. The page now refuses, as the worker does, and claims the
  // store once, where an entry starts — Bin Dump's bin-dump-3 pattern.
  const client = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  // A function's own source, cut at its closing brace (braces counted).
  const fnSrc = (name) => {
    const at = client.search(new RegExp(`(?:async )?function ${name}\\(`));
    if (at < 0) return '';
    let i = client.indexOf('{', client.indexOf(')', at)), depth = 0;
    for (; i < client.length; i++) {
      if (client[i] === '{') depth++;
      else if (client[i] === '}' && --depth === 0) return client.slice(at, i + 1);
    }
    return '';
  };
  const src = (n) => { const s = fnSrc(n); ok(s, `${n} is found`); return s; };
  const at = (s, x) => s.indexOf(x);

  // The resolver and the claim, executed.
  const sel = { value: 'ALL', focused: 0, focus() { this.focused++; } };
  let status = null, held = ['BL1', 'BL4'];
  const st = { store: '' };
  const { mosEntryStore, mosClaimStore } = new Function('el', 'mosSetStatus', 'mosState', 'mosStores',
    `${src('mosEntryStore')}\n${src('mosClaimStore')}; return { mosEntryStore, mosClaimStore };`)(
    () => sel, (m, t) => { status = [m, t]; }, st, () => held);
  eq(mosEntryStore(), '', '🛑 "All stores" is no store — it no longer falls back to the first one');
  sel.value = ''; eq(mosEntryStore(), '', 'an empty picker is no store either');
  sel.value = 'BL4'; eq(mosEntryStore(), 'BL4', 'a real store is itself');
  sel.value = 'ALL';
  eq(mosClaimStore(), false, 'so an entry cannot start on "All stores"');
  ok(status && status[1] === 'err' && /Pick the store/.test(status[0]) && sel.focused === 1 && st.store === '',
     '...it says why, points at the picker, and claims nothing');
  sel.value = 'BL4';
  ok(mosClaimStore() === true && st.store === 'BL4', 'a real store is claimed');
  sel.value = 'BL1';
  eq(st.store, 'BL4', '🔑 ...and stays claimed if the picker changes afterwards');
  held = []; sel.value = ''; status = null;
  ok(mosClaimStore() === false && status && /No store is assigned/.test(status[0]),
     'an account holding no store is told so, not asked to pick one');
  // At 390px the strip landed under the floating nav: it is scrolled clear of it, and focus
  // goes first because focusing scrolls too and would undo that.
  const claimSrc = src('mosClaimStore');
  ok(at(claimSrc, "el('mos-store').focus()") > 0
     && at(claimSrc, "el('mos-store').focus()") < at(claimSrc, "el('mos-status').scrollIntoView({ block: 'nearest' })"),
     'the refusal focuses the picker, THEN brings the strip into view');
  ok(/\.mos-status\{[^}]*scroll-margin-bottom:calc\(96px \+ env\(safe-area-inset-bottom\)\)\}/.test(client),
     '...clear of the floating nav, not under it');

  // mosReset ends the entry; a store change keeps the typed code.
  const box = (v = '') => ({ value: v, hidden: false, textContent: '' });
  const E = { 'mos-resolved': box(), 'mos-teach': box(), 'mos-teach-input': box('x'),
              'mos-code': box('BL-50038-1_5'), 'mos-qty': box('3'), 'mos-save': box() };
  E['mos-save'].textContent = 'Mark out at Dupont';
  const rs = { resolved: {}, store: 'BL4', lookupGen: 7 };
  const mosReset = new Function('el', 'mosState', 'mosSetStatus', 'mosRecalc',
    `${src('mosReset')}; return mosReset;`)(id => E[id], rs, () => {}, () => {});
  mosReset(true);
  ok(rs.store === '' && rs.resolved === null && rs.lookupGen === 8,
     'a reset ends the entry: no sticker, no claimed store, and a lookup still out is now late');
  eq(E['mos-code'].value, 'BL-50038-1_5', '🔑 mosReset(true) keeps the typed code');
  eq(E['mos-save'].textContent, 'Mark out of stock', '...and the button stops naming a store');
  mosReset();
  eq(E['mos-code'].value, '', 'a full reset (after a save) clears it');
  ok(/function mosStoreChange\(\) \{ mosReset\(true\);/.test(client),
     'a store change is the reset that keeps it — "Pick the store…", pick one, and the code is still there');

  // mosLookup with the fetch held open: a late answer never fills the form.
  const pend = [], applied = [];
  const L = { store: '', lookupGen: 0, resolved: null };
  const code = box(), lsel = { value: 'BL4', focus() {} };
  const Ls = { 'mos-code': code, 'mos-store': lsel, 'mos-resolved': box(), 'mos-teach': box() };
  let lstatus = null;
  const lookSrc = src('mosLookup');
  const mosLookup = new Function('el', 'fetch', 'WORKER_BASE', 'mosErr', 'mosState', 'mosApply',
    'mosSetStatus', 'mosRecalc', 'mosStores',
    `${src('mosEntryStore')}\n${src('mosClaimStore')}\n${lookSrc}; return mosLookup;`)(
    id => Ls[id], (u) => new Promise((resolve, reject) => pend.push({ u, resolve, reject })), '/',
    () => 'refused', L, j => { applied.push(j.code); L.resolved = j; },
    (m, t) => { lstatus = m ? [m, t] : null; }, () => {}, () => ['BL1', 'BL4']);
  const answer = c => ({ ok: true, json: async () => ({ ok: true, code: c }) });
  const p1 = mosLookup('BL-11111-1');
  ok(/store=BL4/.test(pend[0].u), 'a lookup asks as the claimed store');
  L.lookupGen++; L.store = '';                        // what mosReset does — a store change
  pend[0].resolve(answer('BL-11111-1')); await p1;
  eq(applied.length, 0, '🛑 an answer landing after a reset fills nothing in');
  const p2 = mosLookup('BL-22222-2'), p3 = mosLookup('BL-33333-3');
  pend[2].resolve(answer('BL-33333-3')); await p3;
  pend[1].resolve(answer('BL-22222-2')); await p2;
  eq(applied.join(), 'BL-33333-3', '🛑 an older lookup answering last does not replace the newer sticker');
  const p4 = mosLookup('BL-44444-4'), p5 = mosLookup('BL-55555-5');
  pend[4].resolve(answer('BL-55555-5')); await p5;
  pend[3].reject(new Error('network')); await p4;
  ok(L.resolved && L.resolved.code === 'BL-55555-5' && lstatus === null, '...nor does its late failure hide it');
  lsel.value = 'ALL';
  const sent = pend.length;
  const p6 = mosLookup('BL-66666-6');                 // the fetch, if any, is issued synchronously
  const asked = pend.length > sent;
  if (asked) pend[sent].resolve(answer('BL-66666-6'));   // a regression must FAIL here, not hang
  await p6;
  ok(!asked && code.value === 'BL-66666-6' && lstatus && /Pick the store/.test(lstatus[0]),
     '🛑 on "All stores" nothing is asked, the refusal stays on screen, and the code stays in the box');

  // Where the claim sits in each path, and what the save sends.
  ok(at(lookSrc, "mosSetStatus('')") > 0 && at(lookSrc, "mosSetStatus('')") < at(lookSrc, 'mosClaimStore()')
     && at(lookSrc, 'mosClaimStore()') < at(lookSrc, 'fetch('),
     '🔑 mosLookup clears the status, THEN claims (so a refusal stays), then asks');
  ok(!/mosEntryStore\(/.test(lookSrc), '...and never reads the picker itself');
  const scan = src('mosScan');
  ok(at(scan, 'if (mosScanning)') >= 0 && at(scan, 'if (mosScanning)') < at(scan, 'mosClaimStore()')
     && at(scan, 'mosClaimStore()') < at(scan, 'mosLoadDecoder('),
     'Scan claims after its stop toggle (Stop always works) and before the decoder or camera');
  ok(/if \(mosClaimStore\(\)\) el\('mos-photo'\)\.click\(\);/.test(src('mosPhotoPick'))
     && /onclick="mosPhotoPick\(\)"/.test(client) && !/getElementById\('mos-photo'\)\.click\(\)/.test(client),
     'the Photo button claims before the camera opens, and nothing else opens it');
  const save = src('mosSave');
  ok(/const store = mosState\.store;/.test(save) && /const body = \{ store, code: r\.code/.test(save)
     && !/mosEntryStore\(|mosClaimStore\(|el\('mos-store'\)/.test(save),
     '🛑 mosSave posts the claimed store, never a fresh read of the picker');
  ok(at(save, 'const store = mosState.store;') < at(save, 'await fetch('),
     '...held before the await, so a reset mid-save cannot blank it');
  ok(/Marked out at \$\{MOS_LABELS\[where\] \|\| where\}/.test(save), 'the green line names the store it was filed under');
  ok(!/escapeHtml\(j\.description\)/.test(save), '...in plain text — mosSetStatus writes textContent, so escaping printed "&amp;"');
  ok(/el\('mos-save'\)\.textContent = `Mark out at \$\{MOS_LABELS\[mosState\.store\] \|\| mosState\.store\}`/.test(src('mosApply')),
     'the Save button names the store once a sticker is looked up');
  ok(/&& mosState\.store\);/.test(src('mosRecalc')), '...and cannot be pressed without one');
  const init = src('initMos');
  ok(at(init, 'const prev = sel.value') > 0 && at(init, 'const prev = sel.value') < at(init, 'sel.innerHTML ='),
     'initMos reads the last pick before rebuilding the picker');
  ok(/sel\.value = stores\.includes\(prev\) \? prev : stores\[0\]/.test(init),
     '...and keeps it when it is still a store held — never "All stores"');
  ok(!/\|\| mosEntryStore\(\)/.test(client), 'the log and export read the picker as it is ("All stores" is a real reading scope)');
  ok(/\.dark #page-mos\{[^}]*--mbad:#f87171;/.test(client), 'dark red text is #f87171, not #ef4444 (oppbuys-mos-11)');

  // The worker has always refused both — the page now agrees instead of substituting a store.
  const { env, db } = env0();
  for (const store of ['ALL', '']) {
    eq((await call(`/?action=mos-lookup&store=${store}&code=BL-50038-1_5`, { user: 'u-admin', env })).status, 400,
       `the worker refuses a lookup at ${JSON.stringify(store)}`);
    eq((await call('/?action=mos-log', { user: 'u-admin', method: 'POST', env,
      body: { store, code: 'BL-50038-1_5', qty: 1, reason: 'Expired' } })).status, 400,
       `...and a log at ${JSON.stringify(store)}`);
  }
  eq(db.prepare('SELECT COUNT(*) n FROM mos_entries').get().n, 0, 'and neither wrote a row');
}

console.log(failures ? `\n${failures} FAILED of ${assertions}` : `\n${assertions} passed`);
process.exit(failures ? 1 : 0);
