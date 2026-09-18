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
  // 🛑 A manager at BL14 — the store whose CODE CONTAINS 'BL1'. Alyson at BL4 cannot
  // expose the substring fault, because '["BL4"]'.includes('BL1') is false. That is
  // precisely why the cross-store assertion in section 11 passed for months while a
  // BL14 manager could approve at BL1: the fixture had picked the one store that
  // happens not to be a prefix. BL1 is the only store code that prefixes another
  // (BL14, BL16), so this account is the whole exposure.
  db.exec(`INSERT INTO users (id, email, role, stores, status, created_at, name, approval_pin_hash)
           VALUES ('u-mgr14', 'mgr14@bl.com', 'manager', '["BL14"]', 'active', '2026-01-01',
                   'Dana Fourteen', '${hashPin('173205')}')`);
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
  // 🛑 THE SUBSTRING CASE, and the reason the line above was not enough. `users.stores`
  // arrives from D1 as the STRING '["BL14"]'; until this was fixed it reached
  // `allowed.includes('BL1')` as String.prototype.includes, which is true — so a BL14
  // manager approved at BL1. BL4 above could never catch it.
  await refused({ name: 'Dana Fourteen', pin: '173205' }, 'BAD_APPROVAL',
    '🛑 a BL14 manager cannot approve at BL1 — the store code is a PREFIX, not a match');
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

// ── 24. set-approval-pin — the admin door for the override ─────────────────
{
  const { db, env } = env0();
  // Start from nobody having a code, which is production's real state.
  db.exec("UPDATE users SET approval_pin_hash = NULL, approval_pin_failures = 0");
  const set = (user, body) => call('/?action=set-approval-pin', { user, method: 'POST', body, env });

  // Who may set one: admin and superuser, and nobody else.
  eq((await set('u-mgr1', { id: 'u-mgr2', pin: '314159' })).status, 403, 'a manager cannot set an approval code');
  eq((await set('u-exec', { id: 'u-mgr2', pin: '314159' })).status, 403, 'nor can an executive');
  eq((await set('u-staff', { id: 'u-mgr2', pin: '314159' })).status, 403, 'nor staff');
  eq((await set('u-admin', { id: 'u-mgr1', pin: '314159' })).status, 200, '✅ an admin can');
  eq((await set('u-su', { id: 'u-mgr2', pin: '271828' })).status, 200, '✅ and a superuser can');

  // 🛑 Six digits, and not an obvious run — a code chosen to be memorable at a dock is
  // the code somebody standing at that dock will try first.
  for (const [bad, why] of [
    ['12345', 'five digits'], ['1234567', 'seven digits'], ['abcdef', 'letters'],
    ['123456', 'a run'], ['111111', 'all one digit'], ['654321', 'a reverse run'],
  ]) {
    const r = await set('u-admin', { id: 'u-mgr1', pin: bad });
    eq(r.status, 400, `refuses ${JSON.stringify(bad)} — ${why}`);
    eq((await json(r)).code, 'WEAK_PIN', `...as WEAK_PIN (${why})`);
  }

  // 🔑 Refused for a role that could never approve with it: a code that reads as
  // configured but never works is worse than no code.
  const staff = await set('u-admin', { id: 'u-staff', pin: '314159' });
  eq(staff.status, 400, 'refuses a code for a staff account');
  eq((await json(staff)).code, 'NOT_AN_APPROVER', '...saying why');
  eq(db.prepare("SELECT approval_pin_hash AS h FROM users WHERE id='u-staff'").get().h, null,
     '...and writes nothing');

  // 🛑 It writes approval_pin_hash and NEVER pin_hash. Getting this wrong would
  // reclassify the manager as an associate — the whole reason for the second column.
  const row = db.prepare("SELECT pin_hash AS p, approval_pin_hash AS a FROM users WHERE id='u-mgr1'").get();
  ok(!!row.a, 'the approval hash is written');
  eq(row.p, null, '🛑 pin_hash is untouched — the manager is NOT turned into an associate');
  ok(row.a !== '314159', '🛑 the code is hashed, never stored in the clear');

  // 🛑 It does NOT sign the target out. associate-save must, because there the code IS
  // the login; here it authorises one action and a mid-shift logout would be a bug.
  db.exec("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('sess-keep','u-mgr1','2099-01-01T00:00:00Z','2026-01-01T00:00:00Z')");
  await set('u-admin', { id: 'u-mgr1', pin: '867530' });
  eq(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE id='sess-keep'").get().n, 1,
     "🛑 setting a code does NOT end the manager's session");

  // Revoke, and the difference between "revoke" and "malformed".
  eq((await set('u-admin', { id: 'u-mgr1', pin: null })).status, 200, 'null revokes');
  eq(db.prepare("SELECT approval_pin_hash AS a FROM users WHERE id='u-mgr1'").get().a, null, '...clearing the hash');
  await set('u-admin', { id: 'u-mgr1', pin: '867530' });
  eq((await set('u-admin', { id: 'u-mgr1' })).status, 400, '🛑 an ABSENT pin is a bad request, not a silent wipe');
  ok(!!db.prepare("SELECT approval_pin_hash AS a FROM users WHERE id='u-mgr1'").get().a,
     '...and the existing code survives it');

  // Setting a code clears the lockout — it is the only way out of one.
  db.exec("UPDATE users SET approval_pin_failures = 10 WHERE id = 'u-mgr1'");
  await set('u-admin', { id: 'u-mgr1', pin: '424242' });
  eq(db.prepare("SELECT approval_pin_failures AS n FROM users WHERE id='u-mgr1'").get().n, 0,
     'a new code clears the failure counter');

  // The hash never leaves D1.
  const listed = await json(await call('/?action=list-users', { user: 'u-admin', env }));
  const m1 = listed.users.find(u => u.id === 'u-mgr1');
  eq(m1.has_approval_pin, 1, 'list-users reports THAT a code exists');
  ok(!('approval_pin_hash' in m1), '🛑 ...and never what it is');
}

// ── 25. A code set through that door actually works at the dock ────────────
// 🔑 The two halves were built at different times against the same column, and a
// mismatch — a different pepper, a trimmed string, a stray case change — would leave
// both sides passing their own tests while no manager on earth could approve anything.
{
  const { db, env } = env0();
  db.exec("UPDATE users SET approval_pin_hash = NULL WHERE id = 'u-mgr1'");
  db.exec("UPDATE users SET name = 'Kevin R' WHERE id = 'u-mgr1'");
  eq((await call('/?action=set-approval-pin',
    { user: 'u-admin', method: 'POST', body: { id: 'u-mgr1', pin: '505017' }, env })).status, 200,
    'an admin sets the code');

  const t1 = seedTruck(db, { store: 'BL1' });
  spy(textReply('{}'));
  await call('/?action=truck-pallet-log', { user: 'u-mgr1', method: 'POST', body: { truck_id: t1, ...TAG, ...IMG }, env });
  const dup = () => call('/?action=truck-pallet-log',
    { user: 'u-mgr1', method: 'POST', body: { truck_id: t1, ...TAG, ...IMG,
      approval: { name: 'Kevin R', pin: '505017', reason: 'set by admin' } }, env });
  const r = await dup();
  eq(r.status, 200, '✅ and that exact code clears a duplicate at the dock');
  eq((await json(r)).dup_approved_by, 'Kevin R', '...with their name on the row');

  // Revoked means revoked, end to end.
  await call('/?action=set-approval-pin', { user: 'u-admin', method: 'POST', body: { id: 'u-mgr1', pin: null }, env });
  eq((await dup()).status, 409, '✅ once revoked, the same code no longer approves');
}

// ── 25. Store scope is a MATCH, never a prefix ─────────────────────────────
// Both halves matter. The refusal in section 11 proves the fault is closed; this
// proves the fix did not simply deny everybody. A guard that also refuses the
// legitimate approver is not a fix, it is a different outage.
{
  const { db, env } = env0();

  // Dana holds BL14, so she approves AT BL14.
  const t14 = seedTruck(db, { store: 'BL14' });
  spy(textReply('{}'));
  await call('/?action=truck-pallet-log',
    { user: 'u-su', method: 'POST', body: { truck_id: t14, ...TAG, ...IMG }, env });
  const dup = await call('/?action=truck-pallet-log', { user: 'u-su', method: 'POST',
    body: { truck_id: t14, ...TAG, ...IMG,
            approval: { name: 'Dana Fourteen', pin: '173205', reason: 'tag reprinted' } }, env });
  eq(dup.status, 200,
     '✅ the BL14 manager CAN still approve at BL14 — a prefix is refused, the store itself is not');

  // 🔑 The picker and the verifier must agree. They are what made the fault REACHABLE
  // rather than merely present: truck-approvers OFFERED her name at BL1, so the dialog
  // invited exactly the approval the verifier then accepted.
  const namesAt = async (store, user) =>
    ((await json(await call(`/?action=truck-approvers&store=${store}`, { user, env }))).names) || [];
  const atBL1 = await namesAt('BL1', 'u-mgr1');
  ok(!atBL1.includes('Dana Fourteen'), '🛑 the BL1 approver list does NOT offer the BL14 manager');
  ok(atBL1.includes('Kevin R'), '...while still offering the manager who does hold BL1');
  const atBL14 = await namesAt('BL14', 'u-su');
  ok(atBL14.includes('Dana Fourteen'), '✅ and the BL14 list does offer her');
  ok(!atBL14.includes('Kevin R'), '...and not the BL1 manager');

  // 🛑 A SOURCE CHECK, AND IT SAYS SO — because the thing it guards is deliberately
  // UNREACHABLE. allowedUnits now normalises, so `allowed` is always an array or null
  // and canAccessStore's Array.isArray refusal can never fire through any endpoint:
  // deleting it leaves this whole suite green (verified by mutation). It exists for the
  // caller who has not been written yet, so the only honest way to keep it from being
  // quietly removed as dead code is to pin the text and explain why.
  // 🛑 Sliced to the function's OWN closing brace, never a fixed character count.
  // test-privilege-guards sliced update-user as a flat 3,000 characters and a guard
  // added at the top silently pushed the region past what it was asserting on; a long
  // comment inside allowedUnits does the same thing to a 900-char window.
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const body = (name) => {
    const at = src.indexOf(`function ${name}(`);
    ok(at > 0, `${name} is still called that`);
    const end = src.indexOf('\n}', at);
    return src.slice(at, end);
  };
  ok(/if \(!Array\.isArray\(allowed\)\) return false;/.test(body('canAccessStore')),
     '🛑 canAccessStore refuses a non-array outright — the backstop against a future raw-row caller');
  ok(/return unitList\(user\.stores\);/.test(body('allowedUnits')),
     '🔑 and allowedUnits normalises the legacy users.stores column rather than returning it raw');
}

// ── 26. An admin may not touch a superuser's approval code ─────────────────
{
  const { db, env } = env0();
  db.exec("UPDATE users SET approval_pin_hash = NULL, approval_pin_failures = 0");
  const set = (user, body) => call('/?action=set-approval-pin', { user, method: 'POST', body, env });

  // 🛑 A superuser passes canSeeFinancials, so nothing else in this handler stopped an
  // admin minting a credential that approves at EVERY store under the superuser's name —
  // and notifyTruckDown mails that attribution to every manager as fact.
  eq((await set('u-admin', { id: 'u-su', pin: '314159' })).status, 403,
     '🛑 an admin cannot set a superuser approval code');
  eq(db.prepare("SELECT approval_pin_hash AS h FROM users WHERE id='u-su'").get().h, null,
     '...and writes nothing');

  // The refusal is about the TARGET, not the door.
  eq((await set('u-su', { id: 'u-su', pin: '314159' })).status, 200, '✅ a superuser can');
  const before = db.prepare("SELECT approval_pin_hash AS h FROM users WHERE id='u-su'").get().h;
  ok(!!before, '...and it is written');

  // 🛑 The silent REPLACE is the worse half: it stops the superuser's own code working,
  // indistinguishably from them having forgotten it.
  eq((await set('u-admin', { id: 'u-su', pin: '867530' })).status, 403, '🛑 nor replace an existing one');
  eq(db.prepare("SELECT approval_pin_hash AS h FROM users WHERE id='u-su'").get().h, before,
     "...and the superuser's own code still works");

  // The admin's ordinary power is untouched.
  eq((await set('u-admin', { id: 'u-mgr1', pin: '314159' })).status, 200,
     '✅ an admin can still set a manager code — only the superuser target is refused');
}

// ── 27. A truck can be read back after it has come down ──────────────────
// 🔑 THE GAP THIS CLOSES, and why the assertions come in pairs. `truck-current` is the
// only action that has ever returned a pallet list, and its WHERE clause is
// `closed_at IS NULL` — so the one truck it can never answer with is a truck that has
// come down, which is every truck in the Trucks tab. Asserting that truck-detail returns
// pallets proves nothing on its own; asserting it returns them on the same database where
// truck-current has just gone empty is the actual claim.
{
  const { db, env } = env0();
  const t1 = seedTruck(db, { store: 'BL1', count: 3 });
  spy(textReply('{}'));
  await call('/?action=truck-pallet-log', { user: 'u-mgr1', method: 'POST', body: { truck_id: t1, ...TAG, ...IMG }, env });
  await call('/?action=truck-pallet-log', { user: 'u-mgr1', method: 'POST', body: { truck_id: t1, ...TAG_B, ...IMG }, env });

  // On the dock, the two agree.
  const openCur = await json(await call('/?action=truck-current&store=BL1', { user: 'u-mgr1', env }));
  const openDet = await json(await call(`/?action=truck-detail&id=${t1}`, { user: 'u-mgr1', env }));
  eq(openCur.pallets.length, 2, 'truck-current sees the truck on the dock');
  eq(openDet.pallets.length, 2, '...and truck-detail sees the same one by id');
  eq(JSON.stringify(Object.keys(openDet.pallets[0]).sort()),
     JSON.stringify(Object.keys(openCur.pallets[0]).sort()),
     '🔑 the two pallet shapes are column-for-column identical — ONE client function draws both');
  eq(openDet.truck.month, '2026-09', 'the month is derived here too, never left to the client');

  await call('/?action=truck-down', { user: 'u-mgr1', method: 'POST', body: { truck_id: t1 }, env });

  const downCur = await json(await call('/?action=truck-current&store=BL1', { user: 'u-mgr1', env }));
  eq(downCur.truck, null, '🛑 once it is down truck-current cannot return it — this is the bug');
  eq(downCur.pallets.length, 0, '...and what came off the trailer goes with it');

  const r = await call(`/?action=truck-detail&id=${t1}`, { user: 'u-mgr1', env });
  const downDet = await json(r);
  eq(r.status, 200, '✅ truck-detail still answers for a truck that has come down');
  eq(downDet.truck.id, t1, '...with the truck that was asked for');
  eq(downDet.pallets.length, 2, '🔑 ...AND the pallets that came off it');
  ok(!!downDet.truck.closed_at, '...saying it is closed rather than hiding it');
  eq(downDet.truck.pallet_count, 3, 'the BOL claim rides along, so "1 short" can be drawn from it');
  ok(downDet.pallets.every(p => !('r2_key' in p) || p.r2_key === undefined),
     'the R2 key is stripped, like every other read on this page');
}

// ── 28. The store comes from the ROW, and an id is checked, not coerced ─────
// 🔑 WHY THIS NEEDS ITS OWN TEST rather than leaning on section 25. Every other read on
// this page names a store on the wire, so a missing guard shows up as a store code in a
// body that should not carry it. A by-id read has no store parameter at all — nothing
// about the request looks wrong, and the only thing standing between a caller and a truck
// at somebody else's dock is that the handler looks the store up on the ROW and hands it
// to storeActionGuard. What is asserted here is that it does, in both directions; the
// primitive that guard calls is pinned at its source in section 25.
{
  const { db, env } = env0();
  const mine = seedTruck(db, { store: 'BL1', bol: '7679', closed: PINNED });
  const theirs = seedTruck(db, { store: 'BL14', bol: '7688', closed: PINNED });

  const cross = await call(`/?action=truck-detail&id=${theirs}`, { user: 'u-mgr1', env });
  eq(cross.status, 403, '🛑 a BL1 manager cannot read a BL14 truck, and never named a store to be caught on');
  eq((await json(cross)).code, 'NO_STORE_ACCESS', '...and says which refusal it is');
  ok(!/7688|BL14/.test(await (await call(`/?action=truck-detail&id=${theirs}`, { user: 'u-mgr1', env })).text()),
     '🛑 ...and the refusal carries nothing off the row it refused');
  // The positive half. A guard that refused everybody would pass all three lines above.
  eq((await call(`/?action=truck-detail&id=${mine}`, { user: 'u-mgr1', env })).status, 200,
     '✅ ...while his own store\'s truck still reads back');

  eq((await call('/?action=truck-detail&id=99999', { user: 'u-mgr1', env })).status, 404,
     'an id that is not a truck is 404');
  // 🛑 Number.isInteger, not `parseInt(…) || 1`, which would answer a caller who named
  // no truck at all with truck 1.
  eq((await call('/?action=truck-detail', { user: 'u-mgr1', env })).status, 400,
     '🛑 no id at all is 400, never a default truck');
  eq((await call('/?action=truck-detail&id=abc', { user: 'u-mgr1', env })).status, 400,
     '...and so is an id that is not a number');
}

// ── 29. Reading a truck back is a VIEW grant, registered on both sides ─────
{
  const { db, env } = env0();
  const t1 = seedTruck(db, { store: 'BL1', closed: PINNED });
  // Narrowed from edit to view: reading a truck back is the same tier as the list that
  // produced its id, not the tier that writes pallets onto a trailer.
  db.exec(`UPDATE users SET pages = '{"inventory-receiver":"view"}' WHERE id = 'u-staff'`);
  eq((await call(`/?action=truck-detail&id=${t1}`, { user: 'u-staff', env })).status, 200,
     '✅ a view grant reaches it, exactly like truck-list');

  const { db: db2, env: env2 } = env0();
  const t2 = seedTruck(db2, { store: 'BL1', closed: PINNED });
  db2.exec("UPDATE users SET pages = NULL WHERE id = 'u-staff'");
  eq((await call(`/?action=truck-detail&id=${t2}`, { user: 'u-staff', env: env2 })).status, 403,
     '...and nothing reaches it without one');

  // Comments stripped first, for the reason section 18 spells out.
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const map = src.slice(src.indexOf('const ACTION_PAGE'), src.indexOf('const GRANTABLE_PAGES'))
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  ok(/\["truck-detail",\s*\["inventory-receiver", "view"\]\]/.test(map),
     '🛑 truck-detail is in ACTION_PAGE at view — absent, no page grant would reach it');
}

// ── 30. The Trucks tab has a way in, and reuses the pallet table ────────
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  ok(/onclick="irOpenTruck\(\$\{t\.id\}\)"/.test(html),
     '🛑 every truck row carries a View button — a row nothing opens IS the bug');
  ok(/id="ir-det"/.test(html) && /id="ir-det-pallets"/.test(html),
     'the read-back modal and its own pallet target exist');
  ok(/irGet\('truck-detail'/.test(html), '...and it asks the worker for one truck by id');
  ok(/id="ir-det-sub"/.test(html),
     '🛑 the status line is its own target, not inside the div the pallet render overwrites');
  // 🔑 One table, two screens. A second copy of "what a pallet row looks like" is the
  // thing that drifts — the same reason the tag helpers were renamed rather than forked.
  ok(/function irPalletTableHtml\(/.test(html), 'the pallet table is a function, defined once');
  ok(/irPalletTableHtml\(irState\.pallets, \{ edit: true \}\)/.test(html),
     '...the dock draws it WITH Edit');
  // 🔑 The read-back shipped read-only in #254 and Brian reversed that the same day: a
  // manager corrects a truck that is down. Section 34 pins the new rule; what stays true
  // here is that the two screens still share ONE table rather than growing a second copy.
  ok(/irPalletTableHtml\(pallets, \{ withDate: true, edit: mayEdit, from: 'detail' \}\)/.test(html),
     '...and the read-back draws the same table, with its own Edit rule');
}

// ── 31. Correcting a truck that is DOWN is a manager's ───────────────────
// Brian, 2026-09-18, reversing the read-only call shipped three hours earlier. The rule is
// about the TRUCK'S STATE, not the page grant: on the dock a correction stays an associate's
// job — fixing a tag you just mis-scanned is what the grant is for — and after Truck Down it
// becomes a manager's, because the review email naming what that truck came up short of has
// already gone out.
//
// 🛑 BOTH HALVES, on the same account. A gate that refused the associate everywhere would
// pass the refusal below and quietly break the dock, which is the page's whole job.
{
  const { db, env } = env0();
  const open = seedTruck(db, { store: 'BL1', bol: '7679', count: 5 });
  spy(textReply('{}'));
  const onDock = await json(await call('/?action=truck-pallet-log',
    { user: 'u-staff', method: 'POST', body: { truck_id: open, ...TAG, ...IMG }, env }));

  // u-staff is an associate holding inventory-receiver at EDIT — the highest page grant.
  eq((await call('/?action=truck-pallet-update',
    { user: 'u-staff', method: 'POST', body: { id: onDock.id, ...TAG, units: 2 }, env })).status, 200,
     '✅ an associate corrects a pallet on the truck at the dock — unchanged, and the point of the grant');

  await call('/?action=truck-down', { user: 'u-mgr1', method: 'POST', body: { truck_id: open }, env });

  // The SAME pallet, the SAME account, one Truck Down later.
  const after = await call('/?action=truck-pallet-update',
    { user: 'u-staff', method: 'POST', body: { id: onDock.id, ...TAG, units: 3 }, env });
  eq(after.status, 403, '🛑 ...and is refused on the very same pallet once the truck is down');
  eq((await json(after)).code, 'NEED_MANAGER', '...naming the standing it wants');
  eq(db.prepare('SELECT units AS u FROM truck_pallets WHERE id = ?').get(onDock.id).u, 2,
     '🛑 ...and the refusal WROTE NOTHING — a 403 that still updated would be the worst of both');

  // A manager at that store can.
  eq((await call('/?action=truck-pallet-update',
    { user: 'u-mgr1', method: 'POST', body: { id: onDock.id, ...TAG, units: 4 }, env })).status, 200,
     '✅ a manager corrects it after the truck is down — the whole ask');
  eq(db.prepare('SELECT units AS u FROM truck_pallets WHERE id = ?').get(onDock.id).u, 4,
     '...and the correction lands');

  // 🔑 The state is read from the TRUCK's row, so a client claiming otherwise changes nothing.
  const lying = await call('/?action=truck-pallet-update',
    { user: 'u-staff', method: 'POST', body: { id: onDock.id, ...TAG, units: 9, closed_at: null }, env });
  eq(lying.status, 403, '🛑 a client sending closed_at: null does not reopen the truck');
  eq(db.prepare('SELECT units AS u FROM truck_pallets WHERE id = ?').get(onDock.id).u, 4, '...and writes nothing');
}

// ── 32. Delete was already a manager's, at BOTH states ─────────────────
// Section 18 pins it on an open truck. The read-back now offers the same button on a closed
// one, so the closed case is pinned here rather than assumed to follow.
{
  const { db, env } = env0();
  const t = seedTruck(db, { store: 'BL1', count: 2 });
  spy(textReply('{}'));
  const p = await json(await call('/?action=truck-pallet-log',
    { user: 'u-mgr1', method: 'POST', body: { truck_id: t, ...TAG, ...IMG }, env }));
  await call('/?action=truck-down', { user: 'u-mgr1', method: 'POST', body: { truck_id: t }, env });

  const staff = await call('/?action=truck-pallet-delete', { user: 'u-staff', method: 'POST', body: { id: p.id }, env });
  eq(staff.status, 403, 'an associate cannot delete off a closed truck either');
  eq(db.prepare('SELECT COUNT(*) AS n FROM truck_pallets WHERE id = ?').get(p.id).n, 1, '...and the row survives');
  eq(env.MEDIA._store.size, 1, '...and so does its photo');

  eq((await call('/?action=truck-pallet-delete', { user: 'u-mgr1', method: 'POST', body: { id: p.id }, env })).status, 200,
     '✅ a manager can, on a truck that is down');
  eq(db.prepare('SELECT COUNT(*) AS n FROM truck_pallets WHERE id = ?').get(p.id).n, 0, '...the row goes');
  eq(env.MEDIA._store.size, 0, '...and the photo goes with it');

  // 🔑 What the deletion is FOR: the truck's counts move, because received has always been
  // COUNT(*) rather than a stored number. If it were stored this would silently disagree.
  const j = await json(await call('/?action=truck-detail&id=' + t, { user: 'u-mgr1', env }));
  eq(j.pallets.length, 0, 'the read-back shows it gone');
  const list = await json(await call('/?action=truck-list&store=BL1', { user: 'u-mgr1', env }));
  eq(list.rows[0].received, 0, '🔑 ...and the truck now reads 0 received, recounted not restated');
  eq(list.rows[0].pallet_count, 2, '...against a BOL claim that does NOT move');
}

// ── 33. The two gates are the same four roles, on both sides ────────────
// The client hides Edit on a closed truck with irCanDelete(); the worker refuses it with
// canSeeFinancials(). If those lists drift, a manager sees a button that 403s or an associate
// sees one that works. Neither is caught by any behavioural test, so they are pinned together.
{
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const roles = (/const FINANCIAL_ROLES = new Set\(\[([^\]]*)\]\)/.exec(src) || [])[1] || '';
  const client = (/function irCanDelete\(\)[\s\S]*?\[([^\]]*)\]/.exec(html) || [])[1] || '';
  const norm = (x) => x.split(',').map(t => t.trim().replace(/['"]/g, '')).filter(Boolean).sort().join(',');
  ok(!!roles && !!client, 'both role lists are still findable');
  eq(norm(client), norm(roles),
     '🛑 irCanDelete and FINANCIAL_ROLES name the same roles — drift shows up as a button that 403s');

  // The worker checks the TRUCK, not the pallet, and reads it in the same statement.
  const h = src.slice(src.indexOf('=== "truck-pallet-update"'));
  const body = h.slice(0, h.indexOf('=== "truck-pallet-delete"'));
  ok(/JOIN trucks t ON t\.id = p\.truck_id/.test(body),
     'the update reads the truck state in the lookup it already does');
  ok(/row\.closed_at && !isAdminSecret && !canSeeFinancials\(currentUser\)/.test(body),
     '🛑 ...and gates on the ROW\'s closed_at, never on anything the client sent');
}

// ── 34. The read-back's Edit reports back to the read-back ───────────
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  ok(/irEditPallet\(\$\{p\.id\}, '\$\{from\}'\)/.test(html),
     'the pallet table tells Edit which screen raised it');
  ok(/irPalletTableHtml\(pallets, \{ withDate: true, edit: mayEdit, from: 'detail' \}\)/.test(html),
     'the read-back draws it as a detail-sourced table');
  ok(/const mayEdit = t\.closed_at \? irCanDelete\(\) : true;/.test(html),
     '🔑 ...offered on a closed truck only to a manager, and on an open one exactly as the dock does');
  ok(/id="ir-det-status"/.test(html) && /function irSetDetStatus/.test(html),
     '🛑 the read-back has its OWN status line — #ir-status is on a pane that is not on screen');
  ok(/await irOpenTruck\(irState\.detailId\)/.test(html),
     '🛑 a correction refreshes the READ-BACK, not the dock behind it');
  // 🛑 The stacking that made this work at all.
  ok(/id="ir-det" class="fixed inset-0 z-40/.test(html),
     '🛑 the read-back is z-40, BELOW the verify form that now opens on top of it');
  ok(/irShowing\('ir-appr'\) \|\| irShowing\('ir-modal'\)\) return;/.test(html),
     '🛑 ...and Escape stops at the top layer instead of closing the truck underneath it');
}

console.log(`\n${assertions} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
