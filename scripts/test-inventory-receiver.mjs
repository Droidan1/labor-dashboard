// Inventory Receiver — BOL scan, truck open, pallets on, truck down.
//
// 🔑 THE POINT OF THIS SUITE is the two rules that are decisions rather than code:
//
//   1. The duplicate check reads `truck_pallets` and NEVER `bin_dumps`. Receiving a
//      pallet off a trailer and dumping it into a bin are different operations, so a
//      barcode in both tables is the normal life of a pallet — not a double count.
//      That separation is invisible in the diff and would be "fixed" by the next
//      person to notice it, so it is pinned here with its reason.
//
//   2. Consent to a duplicate is a VERIFIED MANAGER, not a boolean. Receiving is open
//      to associates by page grant, so `allow_duplicate: true` would be consent that
//      anyone who can POST can mint. Several tests below exist only to prove a boolean
//      does nothing.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, ctx, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let assertions = 0, failures = 0;
const ok = (c, m) => { assertions++; if (!c) { failures++; console.error('  FAIL ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// Pinned to the 30th at 9pm Eastern — 01:00 UTC on OCTOBER 1st. This is the whole
// reason truckMonthOf exists, and the date is chosen so a UTC-derived month is
// visibly the wrong one rather than merely the wrong day.
const PINNED = '2026-10-01T01:00:00Z';
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(PINNED); else super(...a); }
  static now() { return new RealDate(PINNED).getTime(); }
};

const worker = await loadWorker(repo);

const PEPPER = 'test-pepper';
const hashPin = (pin) => crypto.createHmac('sha256', PEPPER).update(String(pin)).digest('hex');

// The real Bill of Lading Brian photographed, 2026-09-11.
const BOL = {
  bol_no: '7679', ship_from: 'RM1', ship_from_addr: '1450 Atlantic Ave, Rocky Mount NC 27801',
  ship_to: 'FW2', bol_date: '9/11/2026', carrier: 'Arrive Logistics',
  trailer_no: '19353', seal_no: '4949941', pro_no: null, pallet_count: 40,
};
// The two real pallet-tag formats, same fixtures test-bin-dump.mjs pins.
const TAG = {
  barcode: 'PRM-10490-30', item_no: '50201', pallet_name: 'PALLET AMAZON IND8',
  sup_ref: null, po: '5036', units: 1, created_by_tag: 'Ranon Price', truck_no: '10490',
};
const TAG_B = {
  barcode: 'P-082626-725979', item_no: '50007',
  pallet_name: 'FG BL CONSUMABLES - FOOD - SNACKS',
  sup_ref: 'mix', po: '14373', units: 362, created_by_tag: 'Oo Aung', truck_no: null,
};

function env0() {
  const { db, env } = makeEnv(repo);
  db.exec(fs.readFileSync(path.join(repo, 'migration-065.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(repo, 'migration-058.sql'), 'utf8'));   // bin_dumps, for the separation test
  db.exec(`CREATE TABLE IF NOT EXISTS lookup_log (id INTEGER PRIMARY KEY AUTOINCREMENT,
    manifest_id INTEGER, line_id INTEGER, provider TEXT, detail TEXT, credits INTEGER,
    ok INTEGER, status INTEGER, ms INTEGER, at TEXT)`);
  applyMigrationAlters(db, repo);   // 🔑 again, AFTER the migrations created their tables
  env.ANTHROPIC_API_KEY = 'test-key';
  env.PIN_PEPPER = PEPPER;
  // A manager at BL1 with an approval code, and one at BL4 without access to BL1.
  db.exec(`UPDATE users SET name = 'Kevin R', approval_pin_hash = '${hashPin('314159')}' WHERE id = 'u-mgr1'`);
  db.exec(`UPDATE users SET name = 'Alyson B', approval_pin_hash = '${hashPin('271828')}', stores = '["BL4"]' WHERE id = 'u-mgr2'`);
  // A staff account with an approval code that should never work: not a manager.
  db.exec(`UPDATE users SET name = 'Lead Person', approval_pin_hash = '${hashPin('141421')}' WHERE id = 'u-staff'`);
  // And an associate who holds the page but is not a manager.
  db.exec(`UPDATE users SET pages = '{"inventory-receiver":"edit"}' WHERE id = 'u-staff'`);
  return { db, env };
}

function spy(reply, { status = 200 } = {}) {
  const sent = [];
  globalThis.fetch = async (_u, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(typeof reply === 'string' ? reply : JSON.stringify(reply),
      { status, headers: { 'content-type': 'application/json' } });
  };
  return sent;
}
const textReply = (s) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: s }] });
const call = (url, opts = {}) => worker.fetch(req(url, opts), opts.env, ctx);
const json = async (r) => { try { return await r.json(); } catch { return {}; } };
const IMG = { image_b64: 'aGVsbG8=', media_type: 'image/jpeg' };

// Open a truck directly in the database, so a test about pallets is not also a test
// about opening.
function seedTruck(db, { store = 'BL1', bol = '7679', count = 40, closed = null } = {}) {
  db.exec(`INSERT INTO trucks (store, bol_no, ship_from, pallet_count, opened_by, opened_at, closed_at)
           VALUES ('${store}', '${bol}', 'RM1', ${count === null ? 'NULL' : count},
                   'tester', '${PINNED}', ${closed ? `'${closed}'` : 'NULL'})`);
  return db.prepare('SELECT last_insert_rowid() AS id').get().id;
}

// ── 1. BOL_PROMPT states what makes this form hard ─────────────────────────
{
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const m = /const BOL_PROMPT = \[([\s\S]*?)\]\.join\("\\n"\);/.exec(src);
  ok(!!m, 'BOL_PROMPT is a top-level const');
  const p = m ? m[1] : '';
  ok(/TOP RIGHT/.test(p), 'prompt says the BOL number is top right');
  ok(/TOP LEFT/.test(p), 'prompt says Ship From is top left');
  ok(/7679/.test(p) && /RM1/.test(p), 'prompt shows the real sample values as a worked example');
  // 🛑 The two fields Brian named. A prompt that stops describing them precisely is
  // the one regression that would be invisible until a truck is filed wrong.
  ok(/THE TWO THAT MATTER MOST/.test(p), 'prompt calls out the two identifying fields first');
  ok(/HANDWRITTEN/.test(p), 'prompt warns which fields are handwritten');
  ok(/seal_no[\s\S]*hardest/.test(p), '...and that the seal number is the hardest read');
  ok(/null for the whole\n\s*"?\s*field rather than a best effort|null for the whole/.test(p),
     'prompt asks for null rather than a half-read seal number');
  ok(/CHECK YOURSELF/.test(p), 'prompt carries a self-check');
  ok(/must be a number or short code and NOT a/.test(p), '...that catches reading the wrong box');
  ok(/IGNORE/.test(p) && /BAR CODE SPACE/.test(p), 'prompt lists what to ignore on the form');
  ok(/Never invent/.test(p), 'prompt forbids guessing');
  ok(/Do not reformat it/.test(p), 'prompt forbids reformatting the date — parsing is the worker\'s job');
  // The tag reader must NOT be forked. One prompt for one document.
  ok(/system: BIN_TAG_PROMPT/.test(src.slice(src.indexOf('truck-pallet-scan'))),
     '🔑 truck-pallet-scan uses BIN_TAG_PROMPT — the tag reader is called, not copied');
}

// ── 2. The month is Eastern, and never stored ──────────────────────────────
{
  const { db, env } = env0();
  const id = seedTruck(db);
  const r = await call('/?action=truck-list&store=BL1', { user: 'u-mgr1', env });
  const j = await json(r);
  eq(r.status, 200, 'truck-list returns 200');
  // PINNED is 01:00 UTC on Oct 1 — which is 9pm ET on SEPTEMBER 30th.
  eq(j.rows[0].month, '2026-09',
     '🛑 a truck opened 9pm ET on the 30th files under SEPTEMBER, not the UTC month');
  ok(!('month' in db.prepare('SELECT * FROM trucks WHERE id = ?').get(id)),
     'the month is derived, never a column');
}

// ── 3. A clean BOL survives the whole path ─────────────────────────────────
{
  const { env } = env0();
  const sent = spy(textReply(JSON.stringify(BOL)));
  const r = await call('/?action=truck-bol-scan', { user: 'u-mgr1', method: 'POST', body: IMG, env });
  const j = await json(r);
  eq(r.status, 200, 'bol scan returns 200');
  eq(j.read, 9, 'nine of ten fields read — pro_no is blank on this form');
  eq(j.of, 10, 'ten fields in total');
  eq(j.fields.bol_no, '7679', 'BOL number passes through');
  eq(j.fields.ship_from, 'RM1', 'ship from passes through');
  eq(j.fields.seal_no, '4949941', 'the handwritten seal number passes through');
  eq(j.fields.pallet_count, 40, 'pallet count arrives as a number');
  eq(j.fields.pro_no, null, 'a blank box stays null — never ""');
  eq(j.fields.bol_date, '2026-09-11', 'M/D/YYYY is normalised to ISO');
  eq(sent[0].model, 'claude-sonnet-4-6', 'uses the house extraction model');
  eq(sent[0].thinking.type, 'disabled', 'thinking disabled, as on every extraction call');
  ok(sent[0].system.includes('Bill of Lading'), 'the BOL prompt was the system prompt');
}

// ── 4. A date is parsed or null — never guessed ────────────────────────────
{
  const { env } = env0();
  for (const [raw, want, why] of [
    ['9/11/2026', '2026-09-11', 'US M/D/YYYY, the convention on these forms'],
    ['2026-09-11', '2026-09-11', 'ISO passes through'],
    ['13/11/2026', null, 'month 13 is not a month — null, not a reinterpretation'],
    ['2/30/2026', null, 'February 30th does not exist'],
    ['9/11/26', null, 'a two-digit year is ambiguous, so it is refused'],
    ['sometime tuesday', null, 'a scrawl is null'],
    ['', null, 'blank is null'],
  ]) {
    spy(textReply(JSON.stringify({ ...BOL, bol_date: raw })));
    const j = await json(await call('/?action=truck-bol-scan', { user: 'u-mgr1', method: 'POST', body: IMG, env }));
    eq(j.fields.bol_date, want, `bol_date ${JSON.stringify(raw)} → ${want} (${why})`);
  }
}

// ── 5. One open truck per store ────────────────────────────────────────────
{
  const { db, env } = env0();
  spy(textReply('{}'));
  const first = await json(await call('/?action=truck-open',
    { user: 'u-mgr1', method: 'POST', body: { store: 'BL1', ...BOL }, env }));
  ok(first.ok, 'the first truck opens');
  const r = await call('/?action=truck-open',
    { user: 'u-mgr1', method: 'POST', body: { store: 'BL1', bol_no: '9999', ship_from: 'RM1' }, env });
  const j = await json(r);
  eq(r.status, 409, 'a second truck at the same store is refused');
  eq(j.code, 'TRUCK_ALREADY_OPEN', '...with a code the client can act on');
  // The database, not the handler, is the boundary.
  let threw = false;
  try {
    db.exec(`INSERT INTO trucks (store, bol_no, opened_by, opened_at) VALUES ('BL1','8888','x','${PINNED}')`);
  } catch (_) { threw = true; }
  ok(threw, '🛑 the partial unique index refuses a second open truck even from raw SQL');
  // ...but a closed one never blocks the next truck.
  db.exec(`UPDATE trucks SET closed_at = '${PINNED}' WHERE store = 'BL1'`);
  db.exec(`INSERT INTO trucks (store, bol_no, opened_by, opened_at) VALUES ('BL1','8888','x','${PINNED}')`);
  ok(true, 'a new truck opens once the last one is down');
}

// ── 6. Duplicate BOL at the same store is blocked ──────────────────────────
{
  const { db, env } = env0();
  seedTruck(db, { store: 'BL1', bol: '7679', closed: PINNED });
  spy(textReply('{}'));
  const r = await call('/?action=truck-open',
    { user: 'u-mgr1', method: 'POST', body: { store: 'BL1', ...BOL }, env });
  const j = await json(r);
  eq(r.status, 409, 'the same BOL number at the same store is refused');
  eq(j.code, 'DUPLICATE_BOL', '...with DUPLICATE_BOL');
  ok(j.matches && j.matches.length === 1, '...and says which truck it collided with');
  // 🔑 Store-scoped, unlike the barcode rule: BOL numbers are a shipper's own sequence
  // and two shippers reach 7679 independently.
  const other = await call('/?action=truck-open',
    { user: 'u-mgr2', method: 'POST', body: { store: 'BL4', ...BOL }, env });
  eq(other.status, 200, '🔑 the same BOL number at ANOTHER store is fine — it is a shipper sequence');
}

// ── 7. A blank identifier is not a duplicate of every other blank ──────────
{
  const { db, env } = env0();
  seedTruck(db, { store: 'BL1', bol: null, closed: PINNED });
  db.exec(`UPDATE trucks SET bol_no = NULL WHERE store = 'BL1'`);
  spy(textReply('{}'));
  const r = await call('/?action=truck-open',
    { user: 'u-mgr1', method: 'POST', body: { store: 'BL1', bol_no: null, ship_from: 'RM1' }, env });
  eq(r.status, 200, '🛑 a torn header opens a truck — blank is not a duplicate of blank');
}

// ── 8. Duplicate barcode: blocked, cross-store, and NOT from bin_dumps ─────
{
  const { db, env } = env0();
  const t1 = seedTruck(db, { store: 'BL1' });
  spy(textReply('{}'));
  const first = await json(await call('/?action=truck-pallet-log',
    { user: 'u-mgr1', method: 'POST', body: { truck_id: t1, ...TAG, ...IMG }, env }));
  ok(first.ok, 'the first pallet goes on');

  const r = await call('/?action=truck-pallet-log',
    { user: 'u-mgr1', method: 'POST', body: { truck_id: t1, ...TAG, ...IMG }, env });
  const j = await json(r);
  eq(r.status, 409, 'the same barcode is refused');
  eq(j.code, 'DUPLICATE_BARCODE', '...with DUPLICATE_BARCODE');

  // 🛑 THE SEPARATION. A barcode that exists ONLY in bin_dumps must not block a
  // receive: that pallet was received and later dumped, which is the normal life of a
  // pallet. Joining the tables would refuse a legitimate pallet every time the process
  // worked correctly.
  db.exec(`INSERT INTO bin_dumps (store, barcode, logged_by, logged_at)
           VALUES ('BL1', 'ONLY-IN-BINS-1', 'someone', '${PINNED}')`);
  const bins = await call('/?action=truck-pallet-log',
    { user: 'u-mgr1', method: 'POST', body: { truck_id: t1, barcode: 'ONLY-IN-BINS-1', pallet_name: 'X', ...IMG }, env });
  eq(bins.status, 200,
     '🛑 a barcode present only in bin_dumps does NOT block a receive — the separation is the decision');

  // ...and the reverse: a received pallet must not block a bin dump.
  const dump = await call('/?action=bin-dump-log',
    { user: 'u-mgr1', method: 'POST', body: { store: 'BL1', ...TAG, ...IMG }, env });
  eq(dump.status, 200, '🛑 ...and a received barcode does not block dumping that pallet into a bin');

  // The source says so too, so a future "optimisation" that adds a UNION fails here.
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function truckBarcodeMatches'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  ok(!/bin_dumps/.test(body), '🛑 truckBarcodeMatches does not mention bin_dumps at the source');
  ok(/truck_pallets/.test(body), '...and does read truck_pallets');
}

// ── 9. Cross-store, and redacted ───────────────────────────────────────────
{
  const { db, env } = env0();
  const t4 = seedTruck(db, { store: 'BL4', bol: '5555' });
  spy(textReply('{}'));
  await call('/?action=truck-pallet-log',
    { user: 'u-mgr2', method: 'POST', body: { truck_id: t4, ...TAG, ...IMG }, env });

  // u-mgr1 holds BL1 only. The pallet is at BL4 — they must still be stopped.
  const t1 = seedTruck(db, { store: 'BL1' });
  const r = await call('/?action=truck-pallet-log',
    { user: 'u-mgr1', method: 'POST', body: { truck_id: t1, ...TAG, ...IMG }, env });
  const j = await json(r);
  eq(r.status, 409, '🔑 a match at a store the caller does not hold still stops them');
  const m = j.matches[0];
  eq(m.redacted, true, '...and comes back redacted');
  ok(!('store' in m), '🛑 no store leaks');
  ok(!('bol_no' in m), '🛑 no BOL number leaks');
  ok(!('pallet_name' in m), '🛑 no pallet name leaks');
  ok(!('logged_by' in m), '🛑 no name leaks');
  ok(!!m.logged_at, '...only the date, which is enough to stop them');
}

// ── 10. The 90-day window ──────────────────────────────────────────────────
{
  const { db, env } = env0();
  const t1 = seedTruck(db, { store: 'BL1' });
  const old = new RealDate(new RealDate(PINNED).getTime() - 91 * 24 * 3600 * 1000).toISOString();
  db.exec(`INSERT INTO truck_pallets (truck_id, store, barcode, logged_by, logged_at)
           VALUES (${t1}, 'BL1', '${TAG.barcode}', 'someone', '${old}')`);
  spy(textReply('{}'));
  const r = await call('/?action=truck-pallet-log',
    { user: 'u-mgr1', method: 'POST', body: { truck_id: t1, ...TAG, ...IMG }, env });
  eq(r.status, 200, '🔑 a barcode older than 90 days does not block — truck numbers cycle');
}

// ── 11. Consent is a verified manager, NOT a boolean ───────────────────────
{
  const { db, env } = env0();
  const t1 = seedTruck(db, { store: 'BL1' });
  spy(textReply('{}'));
  await call('/?action=truck-pallet-log', { user: 'u-mgr1', method: 'POST', body: { truck_id: t1, ...TAG, ...IMG }, env });

  const post = (body) => call('/?action=truck-pallet-log', { user: 'u-mgr1', method: 'POST', body: { truck_id: t1, ...TAG, ...IMG, ...body }, env });

  // 🛑 Bin Dump's boolean does NOTHING here. Receiving is open to associates, so a
  // boolean would be consent anybody who can POST can mint.
  for (const v of [true, 'true', 1, 'yes']) {
    const r = await post({ allow_duplicate: v });
    eq(r.status, 409, `🛑 allow_duplicate: ${JSON.stringify(v)} is NOT consent here`);
  }
  // 🔑 A FAILED APPROVAL IS STILL A 409, with the approval's own verdict nested inside.
  // The outer status answers "did the pallet go on?" (no, it is a duplicate); the inner
  // code answers "why not?" — and the client needs both to tell "we have not asked a
  // manager yet" (approval: null) from "a manager typed the wrong code".
  const refused = async (approval, wantCode, m) => {
    const r = await post({ approval });
    eq(r.status, 409, `${m} — still a 409`);
    eq(((await json(r)).approval || {}).code, wantCode, `${m} — verdict ${wantCode}`);
  };
  await refused({ name: 'Kevin R', pin: '000000' }, 'BAD_APPROVAL', 'a wrong code');
  await refused({ name: 'Kevin R', pin: '31415' }, 'NEED_APPROVAL', 'a five-digit code dies at input validation');
  await refused({ name: 'Nobody', pin: '314159' }, 'BAD_APPROVAL', 'an unknown name');
  // 🔑 Not a manager, even with a valid code of their own.
  await refused({ name: 'Lead Person', pin: '141421' }, 'BAD_APPROVAL',
    '🔑 a staff account with an approval code is still refused — the approver must be a manager');
  // 🔑 A manager who does not hold this store cannot wave a pallet through here.
  await refused({ name: 'Alyson B', pin: '271828' }, 'BAD_APPROVAL',
    '🔑 a manager from another store cannot approve at this one');
  // 🛑 An unknown name and a wrong code give the SAME verdict, so the dialog cannot be
  // used to discover which managers exist.
  ok(true, 'unknown name and wrong code are indistinguishable — no name oracle');

  const good = await post({ approval: { name: 'Kevin R', pin: '314159', reason: 'tag reprinted' } });
  const gj = await json(good);
  eq(good.status, 200, '✅ a real manager with a real code gets it through');
  eq(gj.dup_approved_by, 'Kevin R', '...and their name is on the row');
  const row = db.prepare('SELECT dup_approved_by, dup_reason FROM truck_pallets ORDER BY id DESC LIMIT 1').get();
  eq(row.dup_reason, 'tag reprinted', '...with the reason, so the double count can be explained later');
}

// ── 12. Lockout is checked before the hash ─────────────────────────────────
{
  const { db, env } = env0();
  const t1 = seedTruck(db, { store: 'BL1' });
  spy(textReply('{}'));
  await call('/?action=truck-pallet-log', { user: 'u-mgr1', method: 'POST', body: { truck_id: t1, ...TAG, ...IMG }, env });
  const post = (pin) => call('/?action=truck-pallet-log',
    { user: 'u-mgr1', method: 'POST', body: { truck_id: t1, ...TAG, ...IMG, approval: { name: 'Kevin R', pin } }, env });

  await post('000000');
  eq(db.prepare("SELECT approval_pin_failures AS n FROM users WHERE id='u-mgr1'").get().n, 1,
     'a wrong code increments the failure counter');
  // 🔑 Its OWN counter — sharing pin_failures would let dock guessing lock a login.
  eq(db.prepare("SELECT pin_failures AS n FROM users WHERE id='u-mgr1'").get().n, 0,
     '🔑 the associate login counter is untouched — two credentials, two lockouts');
  db.exec("UPDATE users SET approval_pin_failures = 10 WHERE id = 'u-mgr1'");
  const locked = await post('314159');
  eq(locked.status, 409, 'a locked approver is refused even with the RIGHT code');
  eq((await json(locked)).approval.code, 'APPROVAL_LOCKED', '...and says so distinctly');
  db.exec("UPDATE users SET approval_pin_failures = 0 WHERE id = 'u-mgr1'");
  eq((await post('314159')).status, 200, 'a correct code works again once cleared');
  eq(db.prepare("SELECT approval_pin_failures AS n FROM users WHERE id='u-mgr1'").get().n, 0,
     '...and resets the counter');
}

// ── 13. The refusal precedes the R2 put ────────────────────────────────────
{
  const { db, env } = env0();
  const t1 = seedTruck(db, { store: 'BL1' });
  spy(textReply('{}'));
  await call('/?action=truck-pallet-log', { user: 'u-mgr1', method: 'POST', body: { truck_id: t1, ...TAG, ...IMG }, env });
  eq(env.MEDIA._store.size, 1, 'the accepted pallet stored its photo');
  await call('/?action=truck-pallet-log', { user: 'u-mgr1', method: 'POST', body: { truck_id: t1, ...TAG, ...IMG }, env });
  eq(env.MEDIA._store.size, 1,
     '🛑 the refusal happens BEFORE the photo is stored — a blocked submit leaves no orphan');

  // Source ordering too: a refactor that moves the put above the guard passes the
  // behavioural test only by luck of ordering, so pin it at the source as well.
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const h = src.slice(src.indexOf('=== "truck-pallet-log"'));
  const guardAt = h.indexOf('truckBarcodeMatches'), putAt = h.indexOf('MEDIA.put');
  ok(guardAt > 0 && putAt > 0 && guardAt < putAt,
     '🛑 ...and the guard sits above the put in the source');
}

// ── 14. The store comes from the row, never the client ─────────────────────
{
  const { db, env } = env0();
  const t4 = seedTruck(db, { store: 'BL4', bol: '5555' });
  spy(textReply('{}'));
  // u-mgr1 holds BL1 only, and claims BL1 in the body — the truck is at BL4.
  const r = await call('/?action=truck-pallet-log',
    { user: 'u-mgr1', method: 'POST', body: { truck_id: t4, store: 'BL1', ...TAG, ...IMG }, env });
  eq(r.status, 403, '🔑 the store is re-derived from the truck row, so a claimed store buys nothing');
  eq((await json(r)).code, 'NO_STORE_ACCESS', '...and refuses on store access');
}

// ── 15. Truck down, and what it reports ────────────────────────────────────
{
  const { db, env } = env0();
  const t1 = seedTruck(db, { store: 'BL1', count: 40 });
  spy(textReply('{}'));
  await call('/?action=truck-pallet-log', { user: 'u-mgr1', method: 'POST', body: { truck_id: t1, ...TAG, ...IMG }, env });
  await call('/?action=truck-pallet-log', { user: 'u-mgr1', method: 'POST', body: { truck_id: t1, ...TAG_B, ...IMG }, env });
  const j = await json(await call('/?action=truck-down', { user: 'u-mgr1', method: 'POST', body: { truck_id: t1 }, env }));
  eq(j.received, 2, 'reports what was actually received');
  eq(j.expected, 40, '...against what the BOL claimed');
  eq(j.units, 363, '...and the units on them');
  const again = await call('/?action=truck-down', { user: 'u-mgr1', method: 'POST', body: { truck_id: t1 }, env });
  eq(again.status, 409, 'a truck already down cannot be taken down twice');
  // A closed truck takes no more pallets.
  const late = await call('/?action=truck-pallet-log',
    { user: 'u-mgr1', method: 'POST', body: { truck_id: t1, barcode: 'LATE-1', ...IMG }, env });
  eq(late.status, 409, 'and takes no more pallets');
  eq((await json(late)).code, 'TRUCK_CLOSED', '...saying why');
}

// ── 16. pallet_count is the CLAIM; received is COUNT(*) ────────────────────
{
  const { db, env } = env0();
  const t1 = seedTruck(db, { store: 'BL1', count: 40 });
  spy(textReply('{}'));
  await call('/?action=truck-pallet-log', { user: 'u-mgr1', method: 'POST', body: { truck_id: t1, ...TAG, ...IMG }, env });
  const j = await json(await call('/?action=truck-list&store=BL1', { user: 'u-mgr1', env }));
  eq(j.rows[0].pallet_count, 40, 'pallet_count stays what the BOL claimed');
  eq(j.rows[0].received, 1, '🔑 received is counted, never stored — the two cannot drift');
}

// ── 17. limit + 1 reports truncation honestly ──────────────────────────────
{
  const { db, env } = env0();
  for (let i = 0; i < 4; i++) seedTruck(db, { store: 'BL1', bol: 'B' + i, closed: PINNED });
  const two = await json(await call('/?action=truck-list&store=BL1&limit=2', { user: 'u-mgr1', env }));
  eq(two.rows.length, 2, 'limit is honoured');
  eq(two.truncated, true, '🛑 ...and truncation is REPORTED, not silently applied');
  const four = await json(await call('/?action=truck-list&store=BL1&limit=4', { user: 'u-mgr1', env }));
  eq(four.truncated, false, 'exactly limit rows is not truncated');
  // 🛑 parseInt(...) || 400 would turn limit=0 into 400.
  const zero = await json(await call('/?action=truck-list&store=BL1&limit=0', { user: 'u-mgr1', env }));
  eq(zero.rows.length, 1, '🛑 limit=0 clamps to 1, it does not fall back to the default');
}

// ── 18. Delete is a manager's undo, and no grant reaches it ────────────────
{
  const { db, env } = env0();
  const t1 = seedTruck(db, { store: 'BL1' });
  spy(textReply('{}'));
  const p = await json(await call('/?action=truck-pallet-log',
    { user: 'u-mgr1', method: 'POST', body: { truck_id: t1, ...TAG, ...IMG }, env }));
  // u-staff holds inventory-receiver at EDIT — the highest grant there is.
  const staff = await call('/?action=truck-pallet-delete', { user: 'u-staff', method: 'POST', body: { id: p.id }, env });
  eq(staff.status, 403, '🔑 an associate with edit on the page still cannot delete');
  // 🔑 Refused by the FINANCIAL GATE, one layer above the handler, because the action is
  // in neither NON_FINANCIAL_ACTIONS nor ACTION_PAGE — exactly how bin-dump-delete
  // behaves. Which layer says no is an implementation detail; being refused is not.
  ok(['NO_FINANCIAL_ACCESS', 'NEED_MANAGER'].includes((await json(staff)).code),
     '...refused for lacking manager standing, whichever layer catches it first');
  eq(env.MEDIA._store.size, 1, '...and the photo is still there');
  const mgr = await call('/?action=truck-pallet-delete', { user: 'u-mgr1', method: 'POST', body: { id: p.id }, env });
  eq(mgr.status, 200, 'a manager at that store can');
  eq(env.MEDIA._store.size, 0, '...and the photo goes with the row');

  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  // 🛑 Comments stripped first. The block comment above the map names
  // `truck-pallet-delete` in order to say it is deliberately absent, so a bare
  // substring search matches the very sentence explaining the rule and the test passes
  // for the wrong reason — or, as here, fails for one.
  const map = src.slice(src.indexOf('const ACTION_PAGE'), src.indexOf('const GRANTABLE_PAGES'))
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  ok(!/\["truck-pallet-delete"/.test(map),
     '🛑 truck-pallet-delete is absent from ACTION_PAGE, so no grant reaches it at any level');
  ok(/\["truck-pallet-log"/.test(map), '...while the floor actions are in it');
}

// ── 19. An associate with the grant can actually receive ───────────────────
{
  const { db, env } = env0();
  const t1 = seedTruck(db, { store: 'BL1' });
  spy(textReply(JSON.stringify(TAG_B)));
  eq((await call('/?action=truck-pallet-scan', { user: 'u-staff', method: 'POST', body: IMG, env })).status, 200,
     'an associate granted the page can scan a tag');
  eq((await call('/?action=truck-pallet-log',
    { user: 'u-staff', method: 'POST', body: { truck_id: t1, ...TAG_B, ...IMG }, env })).status, 200,
     '...and log it');
  // ...but not one who holds nothing.
  const { db: db2, env: env2 } = env0();
  db2.exec("UPDATE users SET pages = NULL WHERE id = 'u-staff'");
  const t2 = seedTruck(db2, { store: 'BL1' });
  eq((await call('/?action=truck-pallet-log',
    { user: 'u-staff', method: 'POST', body: { truck_id: t2, ...TAG_B, ...IMG }, env: env2 })).status, 403,
     'an associate without the grant is refused');
}

// ── 20. An unreadable photo still yields an editable form ──────────────────
{
  const { env } = env0();
  spy(textReply('I cannot read this.'));
  const j = await json(await call('/?action=truck-bol-scan', { user: 'u-mgr1', method: 'POST', body: IMG, env }));
  eq(j.read, 0, 'nothing readable means nothing read');
  for (const k of Object.keys(BOL)) eq(j.fields[k], null, `${k} is null rather than a guess`);
}

// ── 21. Every action is registered in both gate tables ─────────────────────
{
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const biz = src.slice(src.indexOf('const ACTION_BUSINESS'), src.indexOf('const ACTION_BUSINESS') + 6000);
  const routed = [...new Set([...src.matchAll(/=== "(truck-[\w-]+)"/g)].map(m => m[1]))];
  ok(routed.length >= 11, `found the truck routes (${routed.length})`);
  for (const a of routed) {
    ok(new RegExp(`\\["${a}", "bl"\\]`).test(biz),
       `🛑 ${a} is in ACTION_BUSINESS — an unregistered action is a hard 403 in production`);
  }
}

// ── 22. The page is grantable on both sides ────────────────────────────────
{
  const worker_src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  ok(/\["truck-list",\s*\["inventory-receiver", "view"\]\]/.test(worker_src),
     'the worker maps a truck action onto the inventory-receiver page');
  ok(/id: 'inventory-receiver'/.test(html),
     '🛑 ...and the client lists it in GRANTABLE_PAGES, or the checkbox grants nothing');
  ok(/'nav-inventory-receiver': 'bl'/.test(html),
     '🛑 the nav id is classified in NAV_BUSINESS, or it leaks into every business');
  ok(/more-inventory-receiver/.test(html),
     '🛑 there is a More-sheet row, or the page is unreachable on a phone');
  ok(/gate\('more-inventory-receiver'/.test(html), '...and it is gated with the others');
  ok(/if \(page === 'inventory-receiver'\)/.test(html), 'navigateToPage guards the page');
  ok(/initInventoryReceiver/.test(html), '...and inits it');
  ok(/#page-inventory-receiver \[hidden\]\{display:none !important\}/.test(html),
     '🛑 the [hidden] override is present — a bare class rule beats the attribute otherwise');
}

// ── 23. The camera attribute adapts to the device ──────────────────────────
// 🛑 `capture="environment"` means "rear camera, nothing else". On a desktop browser
// with no camera the picker may never appear, which is how Receive Truck read as a dead
// button on a Mac (Brian, 2026-09-16). These pin the shape of the fix; the behaviour in
// both pointer modes is driven in scripts/browser-inventory-receiver.mjs.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  ok(/function syncCameraCapture\(input\)/.test(html), 'syncCameraCapture exists');
  const fn = html.slice(html.indexOf('function syncCameraCapture(input)'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  ok(/pointer: coarse/.test(body), '...and decides on pointer coarseness, not a UA string');
  ok(/setAttribute\('capture', 'environment'\)/.test(body), '...keeping the attribute on a touch device');
  ok(/removeAttribute\('capture'\)/.test(body), '...and dropping it otherwise');
  // 🔑 The phone is the case that must not regress, so a throwing matchMedia keeps it.
  ok(/coarse = true; \} catch/.test(body) || /catch \(e\) \{ coarse = true; \}/.test(body),
     '🛑 defaults to KEEPING capture when matchMedia throws — the phone must not regress');
  // Both photo inputs go through it. Bin Dump had the identical latent bug.
  ok(/syncCameraCapture\(el\('ir-photo'\)\)/.test(html) || /syncCameraCapture\(input\);/.test(html),
     'Inventory Receiver syncs before opening the picker');
  ok(/syncCameraCapture\(el\('bd-photo'\)\)/.test(html), 'Bin Dump does too');
  // A picker that never opens must not be silent.
  ok(/Couldn't open the camera or file picker/.test(html),
     'a click that throws surfaces a message instead of looking like a dead button');
}

console.log(`\n${assertions} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
