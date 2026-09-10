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

  eq(mosNormalizeCode('50038-1_5'), null, 'no BL- prefix is not a sticker');
  eq(mosNormalizeCode('BL-50038'), null, 'no price segment is not a sticker');
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
    [{ ...base, code: 'BL-50038' }, 'a code with no price'],
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
}

console.log(failures ? `\n${failures} FAILED of ${assertions}` : `\n${assertions} passed`);
process.exit(failures ? 1 : 0);
