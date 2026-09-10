// Bin Dump — pallet tag scan, log, list, edit, delete.
//
// 🔑 THE POINT OF THIS SUITE is the field-shift case. Labels run down the left and
// values sit right-aligned on the far side, and the two DO NOT line up: on one tag
// each value prints slightly above its label, on the next slightly below. Pair them
// by position and every field moves by one, producing a row that is wrong in a way
// nothing downstream can detect — item becomes the PO, units becomes a person's
// name. The prompt pairs them BY ORDER instead; these tests pin that it still says
// so, and that a correct model answer survives the whole path unaltered.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, ctx, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let assertions = 0, failures = 0;
const ok = (c, m) => { assertions++; if (!c) { failures++; console.error('  FAIL ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// Pinned to a Tuesday so the Saturday->Sunday week boundary case is unambiguous
// and the week keys cannot rot as the calendar moves.
const PINNED = '2026-09-08T18:00:00Z';
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(PINNED); else super(...a); }
  static now() { return new RealDate(PINNED).getTime(); }
};

const worker = await loadWorker(repo);

// TWO REAL TAG FORMATS, both photographed by Brian. They differ in more than
// content: tag A prints each value slightly ABOVE its label, tag B slightly BELOW,
// they disagree on PO: vs WO:, and only one of them carries a Sup. Ref or a truck.
// Anything asserted against only one of these proves less than it looks.
const TAG = {   // A — 2026-09-08 photo
  barcode: 'PRM-10490-30', item_no: '50201', pallet_name: 'PALLET AMAZON IND8',
  sup_ref: null, po: '5036', units: 1, created_by_tag: 'Ranon Price', truck_no: '10490',
};
const TAG_B = { // B — 2026-08-26 photo: WO not PO, a Sup. Ref, no truck, wrapped name
  barcode: 'P-082626-725979', item_no: '50007',
  pallet_name: 'FG BL CONSUMABLES - FOOD - SNACKS',
  sup_ref: 'mix', po: '14373', units: 362, created_by_tag: 'Oo Aung', truck_no: null,
};

function env0() {
  const { db, env } = makeEnv(repo);
  db.exec(fs.readFileSync(path.join(repo, 'migration-058.sql'), 'utf8'));
  // retailLog writes here; it swallows its own errors, so without the table the
  // metering assertions below would pass vacuously.
  db.exec(`CREATE TABLE IF NOT EXISTS lookup_log (id INTEGER PRIMARY KEY AUTOINCREMENT,
    manifest_id INTEGER, line_id INTEGER, provider TEXT, detail TEXT, credits INTEGER,
    ok INTEGER, status INTEGER, ms INTEGER, at TEXT)`);
  applyMigrationAlters(db, repo);   // 🔑 again, AFTER the migration created its table
  env.ANTHROPIC_API_KEY = 'test-key';
  return { db, env };
}

// Spy on Anthropic, keeping request bodies: WHAT the model was shown is the thing
// this feature gets wrong.
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

// ── 1. The prompt still states the geometry ────────────────────────────────
{
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const m = /const BIN_TAG_PROMPT = \[([\s\S]*?)\]\.join\("\\n"\);/.exec(src);
  ok(!!m, 'BIN_TAG_PROMPT is a top-level const');
  const p = m ? m[1] : '';
  // 🛑 The prompt used to name a DIRECTION ("one line higher"). Tag B proved that
  // wrong — its values sit below their labels — so a direction must never come back.
  ok(!/ONE LINE HIGHER/.test(p), '🛑 the prompt does NOT claim the value is above its label');
  ok(/PAIR THEM BY ORDER/.test(p), 'prompt pairs the Nth value with the Nth label');
  ok(/above or slightly below/.test(p), 'prompt warns the drift goes both ways');
  ok(/PRM-10490-30/.test(p) && /Ranon Price/.test(p), 'prompt shows tag A as a worked example');
  ok(/P-082626-725979/.test(p) && /Oo Aung/.test(p), 'prompt shows tag B too — both formats');
  ok(/'PO:' OR with 'WO:'/.test(p), 'prompt says PO and WO are the same field');
  // Pin the ACTIONABLE half too. Asserting only "WRAP ONTO" left the instruction
  // that says what to DO about it — join the lines — free to be deleted.
  ok(/WRAP ONTO/.test(p), 'prompt says the pallet name can wrap onto more than one line');
  ok(/join them with single spaces/.test(p), '...and says to join those lines into one string');
  ok(/FG BL CONSUMABLES - FOOD - SNACKS/.test(p), '...with the joined result shown');
  ok(/null/.test(p) && /Never invent/.test(p), 'prompt forbids guessing and asks for null');
  ok(/person's name/i.test(p) && /COUNT/.test(p), 'prompt gives the self-check that catches a shifted read');
}

// ── 2. A clean tag survives the whole path unaltered ───────────────────────
{
  const { env } = env0();
  const sent = spy(textReply(JSON.stringify(TAG)));
  const r = await call('/?action=bin-dump-scan', { user: 'u-mgr1', method: 'POST', body: IMG, env });
  const j = await json(r);
  eq(r.status, 200, 'scan returns 200');
  eq(j.read, 7, 'all seven fields tag A carries are read');
  for (const k of Object.keys(TAG)) eq(j.fields[k], TAG[k], `field ${k} passes through unaltered`);
  eq(sent.length, 1, 'exactly one model call');
  eq(sent[0].model, 'claude-sonnet-4-6', 'uses the house extraction model');
  eq(sent[0].thinking.type, 'disabled', 'thinking disabled, as on every extraction call');
  const parts = sent[0].messages[0].content;
  eq(parts[0].type, 'image', 'the image is sent first');
  eq(parts[0].source.media_type, 'image/jpeg', 'media type carried through');
}

// ── 2b. The SECOND tag format survives the same path ───────────────────────
{
  const { env, db } = env0();
  spy(textReply(JSON.stringify(TAG_B)));
  const j = await json(await call('/?action=bin-dump-scan', { user: 'u-mgr1', method: 'POST', body: IMG, env }));
  eq(j.fields.sup_ref, 'mix', 'Sup. Ref is read');
  eq(j.fields.po, '14373', 'a WO lands in the same field a PO does');
  eq(j.fields.units, 362, 'a real unit count, not the 1 of tag A');
  eq(j.fields.pallet_name, 'FG BL CONSUMABLES - FOOD - SNACKS', 'a wrapped name arrives as one string');
  eq(j.fields.truck_no, null, 'a tag with no Truck # line yields null, not a guess');
  eq(j.read, 7, 'seven of eight — this format has no truck number to read');
  eq(j.truck_hint, null, '🔑 a P-…-… barcode is not the PRM shape, so no truck hint is offered');

  const logged = await json(await call('/?action=bin-dump-log', { user: 'u-mgr1', method: 'POST',
    body: { store: 'BL1', ...TAG_B }, env }));
  const row = db.prepare('SELECT * FROM bin_dumps WHERE id = ?').get(logged.id);
  eq(row.sup_ref, 'mix', 'and Sup. Ref is stored');
  eq(row.po, '14373', 'with the WO in po');
  eq(row.truck_no, null, 'and no truck');

  const list = await json(await call('/?action=bin-dump-list&store=BL1', { user: 'u-mgr1', env }));
  eq(list.rows[0].sup_ref, 'mix', 'and comes back out of the log');

  await call('/?action=bin-dump-update', { user: 'u-mgr1', method: 'POST',
    body: { id: logged.id, ...TAG_B, sup_ref: 'assorted' }, env });
  eq(db.prepare('SELECT sup_ref FROM bin_dumps WHERE id = ?').get(logged.id).sup_ref, 'assorted',
     'and can be corrected');
}

// ── 3. THE FIELD-SHIFT CASE — a horizontally-read tag must not look healthy ─
// This is what a model does when it ignores the geometry: it pairs each label
// with the value on its own line, so everything moves up one field.
{
  const { env } = env0();
  spy(textReply(JSON.stringify({
    barcode: 'PRM-10490-30', item_no: '5036', pallet_name: 'PALLET AMAZON IND8',
    po: '1', units: 'Ranon Price', created_by_tag: '10490', truck_no: null,
  })));
  const j = await json(await call('/?action=bin-dump-scan', { user: 'u-mgr1', method: 'POST', body: IMG, env }));
  // units is where the shift becomes visible: a name is not a count, and
  // binDumpFields refuses to turn one into a number.
  eq(j.fields.units, null, 'a NAME in units is not coerced into a number');
  ok(j.read < 7, 'a shifted read does not report as fully read');
  ok(j.fields.item_no !== TAG.item_no, 'the shifted item number is not the real one');
}

// ── 4. Nulls are preserved as nulls, never "" ──────────────────────────────
{
  const { env } = env0();
  spy(textReply(JSON.stringify({ ...TAG, po: null, truck_no: '' })));
  const j = await json(await call('/?action=bin-dump-scan', { user: 'u-mgr1', method: 'POST', body: IMG, env }));
  eq(j.fields.po, null, 'an unread PO stays null');
  eq(j.fields.truck_no, null, 'an empty string is null, not ""');
  eq(j.read, 5, 'read count reflects the missing fields');
}

// ── 5. Junk photo: an empty answer is still an editable form, not an error ──
{
  const { env } = env0();
  spy(textReply('I cannot make out any tag in this image.'));
  const r = await call('/?action=bin-dump-scan', { user: 'u-mgr1', method: 'POST', body: IMG, env });
  const j = await json(r);
  eq(r.status, 200, 'an unreadable photo is not an error — the tag can still be keyed by hand');
  eq(j.read, 0, 'nothing was read');
  eq(Object.keys(j.fields).length, 8, 'every key is present so the form renders');
}

// ── 6. Prose around the JSON is still parsed ───────────────────────────────
{
  const { env } = env0();
  spy(textReply(`Here is the tag:\n\`\`\`json\n${JSON.stringify(TAG)}\n\`\`\`\nHope that helps.`));
  const j = await json(await call('/?action=bin-dump-scan', { user: 'u-mgr1', method: 'POST', body: IMG, env }));
  eq(j.fields.item_no, '50201', 'JSON is carved out of surrounding prose');
}

// ── 7. Units parsing ───────────────────────────────────────────────────────
{
  const { env } = env0();
  for (const [raw, want, why] of [
    ['1,240', 1240, 'a thousands comma is stripped'],
    ['240 units', 240, 'a trailing word is stripped'],
    ['', null, 'empty is null'],
    ['none', null, 'unparseable is null, not 0'],
    [0, 0, 'a real zero survives'],
  ]) {
    spy(textReply(JSON.stringify({ ...TAG, units: raw })));
    const j = await json(await call('/?action=bin-dump-scan', { user: 'u-mgr1', method: 'POST', body: IMG, env }));
    eq(j.fields.units, want, `units ${JSON.stringify(raw)}: ${why}`);
  }
}

// ── 8. The truck/barcode cross-check is a hint, and only when it applies ────
{
  const { env } = env0();
  spy(textReply(JSON.stringify({ ...TAG, truck_no: '10491' })));
  let j = await json(await call('/?action=bin-dump-scan', { user: 'u-mgr1', method: 'POST', body: IMG, env }));
  ok(/10490/.test(j.truck_hint || '') && /10491/.test(j.truck_hint || ''), 'a mismatch names both readings');

  spy(textReply(JSON.stringify(TAG)));
  j = await json(await call('/?action=bin-dump-scan', { user: 'u-mgr1', method: 'POST', body: IMG, env }));
  eq(j.truck_hint, null, 'agreement produces no hint');

  // 🔑 A tag whose barcode is shaped differently must produce NO hint at all,
  // rather than warning on every pallet from that vendor.
  spy(textReply(JSON.stringify({ ...TAG, barcode: '100234998812' })));
  j = await json(await call('/?action=bin-dump-scan', { user: 'u-mgr1', method: 'POST', body: IMG, env }));
  eq(j.truck_hint, null, 'a barcode not in PRM-truck-index shape produces no hint');
}

// ── 9. Degradation ─────────────────────────────────────────────────────────
{
  const { env, db } = env0();
  spy({ error: 'overloaded' }, { status: 529 });
  const r = await call('/?action=bin-dump-scan', { user: 'u-mgr1', method: 'POST', body: IMG, env });
  eq(r.status, 502, 'an API failure is a 502');
  ok(/type the tag in by hand/.test((await json(r)).error || ''), 'the error tells the manager what they can still do');
  const log = db.prepare("SELECT ok, status FROM lookup_log WHERE detail = 'bin dump tag'").get();
  eq(log?.ok, 0, 'the failed call is metered');
  eq(log?.status, 529, 'with the upstream status');
}
{
  const { env } = env0();
  env.ANTHROPIC_API_KEY = '';
  const r = await call('/?action=bin-dump-scan', { user: 'u-mgr1', method: 'POST', body: IMG, env });
  eq(r.status, 400, 'no API key is a clear 400, not a crash');
}
{
  const { env } = env0();
  spy(textReply(JSON.stringify(TAG)));
  const r = await call('/?action=bin-dump-scan', { user: 'u-mgr1', method: 'POST',
    body: { image_b64: 'x'.repeat(8_000_001), media_type: 'image/jpeg' }, env });
  eq(r.status, 400, 'an oversized photo is refused before the model call');
}

// ── 10. Who may reach it ───────────────────────────────────────────────────
{
  const { env } = env0();
  spy(textReply(JSON.stringify(TAG)));
  for (const [user, want, why] of [
    ['u-staff', 403, 'staff cannot reach Bin Dump'],
    ['u-mgr1',  200, 'a manager can'],
    ['u-admin', 200, 'an admin can'],
    ['u-su',    200, 'a superuser can'],
  ]) {
    const r = await call('/?action=bin-dump-scan', { user, method: 'POST', body: IMG, env });
    eq(r.status, want, why);
  }
  const r = await worker.fetch(new Request('https://x/?action=bin-dump-scan', { method: 'POST', body: '{}' }), env, ctx);
  eq(r.status, 401, 'no session at all is a 401');
}

// ── 11. Store scoping and closed stores ────────────────────────────────────
{
  const { env } = env0();
  const body = { store: 'BL4', ...TAG };
  eq((await call('/?action=bin-dump-log', { user: 'u-mgr1', method: 'POST', body, env })).status, 403,
     'a BL1 manager cannot log a pallet to BL4');
  eq((await call('/?action=bin-dump-log', { user: 'u-mgr2', method: 'POST', body, env })).status, 200,
     'a manager who holds BL4 can');
  eq((await call('/?action=bin-dump-log', { user: 'u-su', method: 'POST', body: { store: 'BL8', ...TAG }, env })).status, 409,
     'a closed store is refused — there are no bins to dump into');
  eq((await call('/?action=bin-dump-log', { user: 'u-su', method: 'POST', body: { store: 'BL99', ...TAG }, env })).status, 400,
     'an unknown store is refused');
  eq((await call('/?action=bin-dump-log', { user: 'u-su', method: 'POST', body: { store: 'BL1' }, env })).status, 400,
     'a pallet with no identifying field at all is refused');
}

// ── 12. Logging writes the row and the photo ───────────────────────────────
{
  const { env, db } = env0();
  const r = await call('/?action=bin-dump-log', { user: 'u-mgr1', method: 'POST',
    body: { store: 'BL1', ...TAG, ...IMG }, env });
  const j = await json(r);
  eq(r.status, 200, 'log returns 200');
  eq(j.week, '2026-09-06', 'the week is the Sunday starting it');
  const row = db.prepare('SELECT * FROM bin_dumps WHERE id = ?').get(j.id);
  eq(row.item_no, '50201', 'the item number is stored');
  eq(row.units, 1, 'units is stored as a number');
  eq(row.created_by_tag, 'Ranon Price', 'the name PRINTED ON THE TAG is stored');
  eq(row.logged_by, 'howardbrian260@gmail.com', 'and separately, who pressed Submit');
  ok(row.r2_key && row.r2_key.startsWith('bin-tags/BL1/'), 'the photo key is store-scoped');
  ok(env.MEDIA._store.has(row.r2_key), '🛑 the photo really is in the bucket');

  const p = await call(`/?action=bin-dump-photo&id=${j.id}`, { user: 'u-mgr1', env });
  eq(p.status, 200, 'the tag photo can be read back');
  eq((await call(`/?action=bin-dump-photo&id=${j.id}`, { user: 'u-mgr2', env })).status, 200,
     'a user holding BL1 may see it');
}

// ── 13. Fields are re-validated server-side, not trusted from the popup ────
{
  const { env, db } = env0();
  const j = await json(await call('/?action=bin-dump-log', { user: 'u-mgr1', method: 'POST',
    body: { store: 'BL1', ...TAG, units: '1,240', pallet_name: '  PALLET AMAZON IND8  ', po: '' }, env }));
  const row = db.prepare('SELECT * FROM bin_dumps WHERE id = ?').get(j.id);
  eq(row.units, 1240, 'a comma-formatted count is normalised on the way in');
  eq(row.pallet_name, 'PALLET AMAZON IND8', 'whitespace is trimmed');
  eq(row.po, null, 'an empty PO is stored as null, not ""');
}

// ── 14. The soft duplicate check ───────────────────────────────────────────
{
  const { env } = env0();
  await call('/?action=bin-dump-log', { user: 'u-mgr1', method: 'POST', body: { store: 'BL1', ...TAG }, env });
  let j = await json(await call('/?action=bin-dump-recent&store=BL1&po=5036', { user: 'u-mgr1', env }));
  eq(j.matches.length, 1, 'a PO logged minutes ago is found');
  j = await json(await call('/?action=bin-dump-recent&store=BL1&po=9999', { user: 'u-mgr1', env }));
  eq(j.matches.length, 0, 'a different PO is not');
  eq((await call('/?action=bin-dump-recent&store=BL4&po=5036', { user: 'u-mgr1', env })).status, 403,
     'the duplicate check is store-scoped too');
}

// ── 15. Editing ────────────────────────────────────────────────────────────
{
  const { env, db } = env0();
  const j = await json(await call('/?action=bin-dump-log', { user: 'u-mgr1', method: 'POST',
    body: { store: 'BL1', ...TAG }, env }));
  const before = db.prepare('SELECT logged_at FROM bin_dumps WHERE id = ?').get(j.id).logged_at;
  const r = await call('/?action=bin-dump-update', { user: 'u-mgr2', method: 'POST',
    body: { id: j.id, ...TAG, units: 240 }, env });
  eq(r.status, 200, 'a manager holding the store may correct a row');
  const row = db.prepare('SELECT * FROM bin_dumps WHERE id = ?').get(j.id);
  eq(row.units, 240, 'the correction lands');
  eq(row.logged_at, before, '🔑 logged_at does NOT move — a correction must not change the week');
  eq(row.edited_by, 'alyson@bargainlane.com', 'the editor is recorded');
  ok(!!row.edited_at, 'and when');
  eq(row.logged_by, 'howardbrian260@gmail.com', 'the original logger is untouched');

  // A row in a store the caller does not hold, addressed directly by id. Its own barcode,
  // because it is a different pallet — the same one twice is now a 409, and this section
  // is about who may edit what, not about duplicates.
  const other = await json(await call('/?action=bin-dump-log', { user: 'u-mgr2', method: 'POST',
    body: { store: 'BL4', ...TAG, barcode: 'PRM-10490-31' }, env }));
  eq((await call('/?action=bin-dump-update', { user: 'u-mgr1', method: 'POST',
      body: { id: other.id, ...TAG }, env })).status, 403,
     "🛑 the ROW's store decides, so another store's row cannot be edited by id");
  eq((await call('/?action=bin-dump-update', { user: 'u-mgr1', method: 'POST',
      body: { id: 99999, ...TAG }, env })).status, 404, 'a missing row is a 404');
}

// ── 16. Deleting: a manager may, but only at a store they hold ─────────────
{
  const { env, db } = env0();
  // Each row is a DIFFERENT pallet, so each gets its own barcode — `PRM-<truck>-<index>`
  // is exactly that, the pallet's index on the truck. Reusing one barcode here would now
  // trip the duplicate guard and this section would be testing that instead of deletion.
  let pallet = 0;
  const mk = async (user, store) => (await json(await call('/?action=bin-dump-log',
    { user, method: 'POST', body: { store, ...TAG, barcode: `PRM-10490-${++pallet}`, ...IMG }, env }))).id;
  const keyOf = id => db.prepare('SELECT r2_key FROM bin_dumps WHERE id = ?').get(id).r2_key;

  // A manager deletes their own store's pallet — the case this exists for.
  const own = await mk('u-mgr1', 'BL1');
  const ownKey = keyOf(own);
  eq((await call('/?action=bin-dump-delete', { user: 'u-mgr1', method: 'POST', body: { id: own }, env })).status, 200,
     'a manager may delete a pallet at a store they hold');
  eq(db.prepare('SELECT COUNT(*) c FROM bin_dumps WHERE id = ?').get(own).c, 0, 'the row is gone');
  ok(!env.MEDIA._store.has(ownKey), 'and its tag photo with it — no orphan left behind');

  // 🛑 THE ONE THAT MATTERS. Delete is addressed by id, so without the row's own
  // store deciding, any manager could destroy any store's pallet by guessing a
  // number. This assertion is the guard; it fails the moment the check is dropped.
  const other = await mk('u-mgr2', 'BL4');
  const otherKey = keyOf(other);
  const r = await call('/?action=bin-dump-delete', { user: 'u-mgr1', method: 'POST', body: { id: other }, env });
  eq(r.status, 403, "🛑 a manager cannot delete another store's pallet by id");
  eq((await json(r)).code, 'NO_STORE_ACCESS', 'and is told it is the store, not the role');
  eq(db.prepare('SELECT COUNT(*) c FROM bin_dumps WHERE id = ?').get(other).c, 1, 'the row survives the refusal');
  ok(env.MEDIA._store.has(otherKey), '🛑 and so does its photo — a refused delete destroys nothing');

  // 🛑 ...AND A SPOOFED STORE DOES NOT HELP. Without this, a guard written as
  // `body?.store || row.store` passes every other assertion here, because none of
  // them ever sends a store. The caller does not get to nominate the store.
  const spoof = await call('/?action=bin-dump-delete', { user: 'u-mgr1', method: 'POST',
    body: { id: other, store: 'BL1' }, env });
  eq(spoof.status, 403, "🛑 naming a store you DO hold does not delete another store's row");
  eq(db.prepare('SELECT COUNT(*) c FROM bin_dumps WHERE id = ?').get(other).c, 1, 'and the row still survives');

  // Staff are out on the ROLE, so the row has to be one they could otherwise reach —
  // refusing them a BL4 row would prove only that the store guard works. (The global
  // financial gate is the primary boundary here; the handler's own check backs it up.)
  const staffReach = await mk('u-mgr1', 'BL1');
  eq((await call('/?action=bin-dump-delete', { user: 'u-staff', method: 'POST', body: { id: staffReach }, env })).status, 403,
     'staff cannot delete even in their own store — it is the role, not the store');
  eq(db.prepare('SELECT COUNT(*) c FROM bin_dumps WHERE id = ?').get(staffReach).c, 1, 'that row survives too');

  // An admin still reaches every store.

  eq((await call('/?action=bin-dump-delete', { user: 'u-su', method: 'POST', body: { id: other }, env })).status, 200,
     'a superuser reaches any store');

  eq((await call('/?action=bin-dump-delete', { user: 'u-su', method: 'POST', body: { id: 99999 }, env })).status, 404,
     'a missing row is a 404');
  eq((await call('/?action=bin-dump-delete', { user: 'u-su', method: 'POST', body: { id: 'x' }, env })).status, 400,
     'a non-numeric id is refused at validation');
}

// ── 17. The log: scoping and week grouping ─────────────────────────────────
{
  const { env, db } = env0();
  // Saturday 2026-09-05 and Sunday 2026-09-06 are DIFFERENT weeks. This is the
  // boundary an off-by-one in the week helper gets wrong.
  const ins = db.prepare(`INSERT INTO bin_dumps (store, item_no, po, units, logged_by, logged_at)
                          VALUES (?,?,?,?,?,?)`);
  ins.run('BL1', 'A', '1', 5, 'x@y.z', '2026-09-05T20:00:00.000Z');  // Saturday
  ins.run('BL1', 'B', '2', 7, 'x@y.z', '2026-09-06T14:00:00.000Z');  // Sunday
  ins.run('BL4', 'C', '3', 9, 'x@y.z', '2026-09-07T14:00:00.000Z');

  // 🔑 The killer case: 01:00 UTC Sunday is still 9pm ET SATURDAY. A UTC-derived
  // week files this under the following week — a week the store had not begun.
  ins.run('BL1', 'SAT-PM', '4', 3, 'x@y.z', '2026-09-06T01:00:00.000Z');

  let j = await json(await call('/?action=bin-dump-list&store=BL1', { user: 'u-mgr1', env }));
  eq(j.rows.length, 3, 'only this store’s rows');
  const byItem = Object.fromEntries(j.rows.map(r => [r.item_no, r.week]));
  eq(byItem.A, '2026-08-30', 'Saturday belongs to the week that started 08-30');
  eq(byItem.B, '2026-09-06', 'Sunday starts the next week');
  eq(byItem['SAT-PM'], '2026-08-30',
     '🔑 9pm ET Saturday (01:00 UTC Sunday) stays in SATURDAY’s week, not the next one');
  eq(j.rows[0].item_no, 'B', 'newest first');
  ok(!('r2_key' in j.rows[0]) || j.rows[0].r2_key === undefined, 'the raw R2 key is not exposed to the client');

  // "All stores" means all the stores the CALLER holds.
  j = await json(await call('/?action=bin-dump-list&store=ALL', { user: 'u-mgr1', env }));
  eq(j.rows.length, 3, 'a BL1 manager asking for ALL gets only BL1');
  j = await json(await call('/?action=bin-dump-list&store=ALL', { user: 'u-mgr2', env }));
  eq(j.rows.length, 4, 'a manager holding BL1+BL4 gets both');
  j = await json(await call('/?action=bin-dump-list&store=ALL', { user: 'u-su', env }));
  eq(j.rows.length, 4, 'a superuser gets everything');
  eq((await call('/?action=bin-dump-list&store=BL4', { user: 'u-mgr1', env })).status, 403,
     'and cannot ask for a store they do not hold');

  // A store that closed after the fact must still show its history.
  db.prepare(`INSERT INTO bin_dumps (store, item_no, logged_by, logged_at)
              VALUES ('BL8','D','x@y.z','2026-09-07T14:00:00.000Z')`).run();
  eq((await call('/?action=bin-dump-list&store=BL8', { user: 'u-su', env })).status, 200,
     'a closed store can still be READ — closing it must not hide correct history');
}

// ── 19. The tag viewer: the zoom maths, and the wiring that reaches it ─────
// The viewer exists so somebody can tell a 3 from an 8. Everything that can make
// it useless — a picture that slides out from under a pinch, pan bounds that run
// away, a panel that will not hide — is decided by the two pure functions and the
// handful of structural facts asserted here.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');

  // Slice to REAL boundaries, never a character count: a comment added inside the
  // core would silently shift a fixed-length slice off the end of the function.
  const from = html.indexOf('const BD_LB_MIN');
  const to   = html.indexOf('// ── end pure core');
  ok(from > 0 && to > from, 'the viewer’s pure core is still delimited in index.html');
  const { bdLbClamp, bdLbZoomAt } =
    new Function(html.slice(from, to) + '; return { bdLbClamp, bdLbZoomAt };')();

  const near = (a, b, m, eps = 1e-9) => ok(Math.abs(a - b) < eps, `${m} (got ${a}, want ${b})`);
  // Fit exactly: a 400×300 picture in a 400×300 stage has nothing to spare at 1×.
  const G = { w: 400, h: 300, vw: 400, vh: 300 };
  // Deliberately roomy, so clamping cannot mask a wrong anchor calculation.
  const R = { w: 1000, h: 1000, vw: 200, vh: 200 };

  // -- scale bounds --
  eq(bdLbClamp({ s: 0.2, tx: 0, ty: 0 }, G).s, 1, 'cannot zoom out past fit');
  eq(bdLbClamp({ s: 99,  tx: 0, ty: 0 }, G).s, 8, 'and not past 8×');
  eq(bdLbZoomAt({ s: 1, tx: 0, ty: 0 }, G, 500, 0, 0).s, 8, 'zoomAt clamps too, not just clamp');

  // -- pan bounds are the OVERHANG, so a fitted picture cannot be dragged at all --
  let v = bdLbClamp({ s: 1, tx: 500, ty: -500 }, G);
  eq(v.tx, 0, 'nothing overhangs at fit, so the picture stays centred horizontally');
  eq(v.ty, 0, '…and vertically — it cannot be flung into a corner');

  v = bdLbClamp({ s: 2, tx: 1e4, ty: 1e4 }, G);
  eq(v.tx, 200, 'at 2× a 400-wide picture in a 400 stage overhangs 200 each side');
  eq(v.ty, 150, '…and 150 top and bottom');
  v = bdLbClamp({ s: 2, tx: -1e4, ty: -1e4 }, G);
  eq(v.tx, -200, 'bounded the other way too');
  eq(v.ty, -150, '…both axes');
  v = bdLbClamp({ s: 2, tx: 50, ty: -20 }, G);
  eq(v.tx, 50, 'a pan inside the bounds is left alone');
  eq(v.ty, -20, '…on both axes');

  // -- THE property: whatever is under the anchor stays under the anchor --
  // Image-space position of the point currently under anchor a: p = (a − t)/s.
  const under = (view, ax, ay) => ({ x: (ax - view.tx) / view.s, y: (ay - view.ty) / view.s });
  {
    const before = { s: 2, tx: 0, ty: 0 };
    const [ax, ay] = [50, -30];
    const p0 = under(before, ax, ay);
    const after = bdLbZoomAt(before, R, 3, ax, ay);
    const p1 = under(after, ax, ay);
    near(p1.x, p0.x, '🔑 the point under a pinch does not move horizontally as it scales');
    near(p1.y, p0.y, '🔑 …nor vertically. This is what stops the tag sliding away');
  }
  {
    // Off-centre start, anchored on the stage centre — the button-zoom case.
    const before = { s: 2, tx: 100, ty: -40 };
    const p0 = under(before, 0, 0);
    const after = bdLbZoomAt(before, R, 4, 0, 0);
    near(under(after, 0, 0).x, p0.x, 'the + button keeps the middle of the screen still');
    near(under(after, 0, 0).y, p0.y, '…on both axes, even from an off-centre pan');
  }
  {
    // In and back out about the same anchor must land exactly where it started,
    // or repeated pinching walks the picture across the screen.
    const start = { s: 2, tx: 0, ty: 0 };
    const [ax, ay] = [50, -30];
    const back = bdLbZoomAt(bdLbZoomAt(start, R, 4, ax, ay), R, 2, ax, ay);
    near(back.tx, 0, 'zoom in then out about one point round-trips exactly');
    near(back.ty, 0, '…on both axes');
  }

  // Returning to fit re-centres, whatever the pan was.
  v = bdLbZoomAt({ s: 4, tx: 300, ty: 200 }, G, 1, 0, 0);
  eq(v.s, 1, 'zooming back out reaches fit');
  eq(v.tx, 0, '…and re-centres, because at fit there is no overhang to keep');
  eq(v.ty, 0, '…on both axes');

  // A picture that has not decoded yet is 0×0. That must produce a centred view,
  // not NaN — NaN in a transform silently blanks the element.
  v = bdLbClamp({ s: 1, tx: 10, ty: 10 }, { w: 0, h: 0, vw: 300, vh: 300 });
  ok(Number.isFinite(v.tx) && Number.isFinite(v.ty) && Number.isFinite(v.s),
     'a not-yet-decoded (0×0) image still yields finite numbers, never NaN');
  eq(v.tx, 0, '…and is treated as centred');

  // -- the wiring, asserted structurally --
  ok(/#page-bin-dump \[hidden\]\{display:none !important\}/.test(html),
     '🔑 the [hidden] override still exists — .bd-lb sets display:flex and relies on it');
  ok(/\.bd-lb\{[^}]*display:flex/.test(html), '.bd-lb is a flex column when shown');
  ok(/<div id="bd-lb"[^>]*\shidden\b/.test(html),
     'the viewer hides via the ATTRIBUTE, so the override above actually applies');
  ok(!/<div id="bd-lb"[^>]*style="display:none/.test(html),
     '…and not via an inline style, which that override could not beat');

  const zi = html.match(/\.bd-lb\{[^}]*z-index:(\d+)/);
  ok(zi && Number(zi[1]) > 50, 'the viewer sits above #bd-modal (z-50)');
  ok(zi && Number(zi[1]) < 80, '…and below the uiConfirm overlays (z-80), so a delete confirm wins');

  ok(/id="bd-m-photo"[\s\S]{0,240}onclick="bdLbOpen\(\)"/.test(html),
     'the thumbnail opens the viewer');
  ok(/id="bd-m-photo"[\s\S]{0,240}role="button"/.test(html) &&
     /id="bd-m-photo"[\s\S]{0,240}tabindex="0"/.test(html),
     '…and is reachable and announced as a control, not a decorative image');
  ok(/id="bd-m-photo"[\s\S]{0,320}onkeydown="[^"]*bdLbOpen\(\)/.test(html),
     '…and opens from the keyboard, since a tabbable thing that only takes a mouse is a trap');

  ok(/function bdCloseModal\(\) \{ bdLbClose\(\);/.test(html),
     'closing the edit modal also closes the viewer — no orphaned overlay over a dead modal');

  const geo = html.slice(html.indexOf('function bdLbGeo'), html.indexOf('function bdLbApply'));
  ok(/offsetWidth/.test(geo) && !/getBoundingClientRect/.test(geo),
     '🛑 geometry is measured with offsetWidth; the rect of a scaled node is the SCALED box '
     + 'and would multiply the scale into the pan bounds on every gesture');

  ok(/const lb = el\('bd-lb'\);\s*\n\s*if \(!lb \|\| lb\.hidden\) return;/.test(html),
     'the Escape handler is guarded on the viewer being open, so it cannot swallow the key');
}

// ── 18. The duplicate-barcode guard ────────────────────────────────────────
// A barcode is ONE PHYSICAL PALLET, so a repeat means the same pallet logged twice and
// its units counted into the bins twice. Unlike the PO check above this is a block, and
// the block lives HERE — the popup only asks the question.
{
  const { env, db } = env0();
  const log = (user, body) => call('/?action=bin-dump-log',
    { user, method: 'POST', body, env });

  let r = await log('u-mgr1', { store: 'BL1', ...TAG, ...IMG });
  eq(r.status, 200, 'the first pallet carrying this barcode logs normally');
  eq(env.MEDIA._store.size, 1, 'and its photo is stored');

  r = await log('u-mgr1', { store: 'BL1', ...TAG, ...IMG });
  eq(r.status, 409, '🔑 the same barcode a second time is REFUSED');
  let j = await json(r);
  eq(j.code, 'DUPLICATE_BARCODE', '…with a code the client can branch on');
  eq(j.matches.length, 1, '…and the row it collides with');
  eq(j.matches[0].store, 'BL1', '…named, because this caller holds that store');
  eq(j.matches[0].redacted, false, '…and not redacted');

  // 🛑 The orphan check. If the refusal came after the R2 put, every blocked submit would
  // leave an object with no row pointing at it — the exact class bin-dump-scan avoids.
  eq(env.MEDIA._store.size, 1,
     '🛑 the refusal happens BEFORE the photo is stored — a blocked submit leaves no orphan');
  eq(db.prepare('SELECT COUNT(*) c FROM bin_dumps').get().c, 1, 'and writes no row');

  // The override is the whole point of "block, but not a dead end".
  r = await log('u-mgr1', { store: 'BL1', ...TAG, ...IMG, allow_duplicate: true });
  eq(r.status, 200, 'an explicit allow_duplicate gets through');
  eq(db.prepare('SELECT COUNT(*) c FROM bin_dumps').get().c, 2, '…and really writes the row');
  eq(env.MEDIA._store.size, 2, '…photo and all');

  // 🔑 Truthiness is not enough: only the literal true may pass. A client sending "false"
  // or 0 or "yes" from a stray form value must NOT be read as consent.
  for (const bad of ['false', 0, '', null]) {
    const rr = await log('u-mgr1', { store: 'BL1', ...TAG, allow_duplicate: bad });
    eq(rr.status, 409, `allow_duplicate: ${JSON.stringify(bad)} is not consent`);
  }
}

// Blank barcodes must not collide with each other, or a torn tag becomes unloggable.
{
  const { env } = env0();
  const blank = { store: 'BL1', ...TAG, barcode: null };
  eq((await call('/?action=bin-dump-log', { user: 'u-mgr1', method: 'POST', body: blank, env })).status, 200,
     'a pallet whose barcode could not be read still logs');
  eq((await call('/?action=bin-dump-log', { user: 'u-mgr1', method: 'POST', body: blank, env })).status, 200,
     '🔑 and so does a SECOND one — blanks are not duplicates of one another');
  // binDumpText folds these to null too, so they must behave the same way.
  for (const empty of ['', '   ', 'null', 'N/A']) {
    eq((await call('/?action=bin-dump-log', { user: 'u-mgr1', method: 'POST',
        body: { ...blank, barcode: empty }, env })).status, 200,
       `a barcode of ${JSON.stringify(empty)} is treated as absent, not as a value`);
  }

  // 🔑 ASSERTED AT THE SOURCE, because no behavioural test can reach it. Deleting the
  // early return is a mutation this suite survives: binDumpText already folds blanks to
  // null, and SQL's `barcode = NULL` matches nothing, so the query returns [] either way.
  // The guard is what keeps that true if binDumpText ever returns "" instead of null —
  // at which point `barcode = ''` WOULD match every other blank and a torn tag would
  // become unloggable. Cheap insurance; it must not be tidied away as redundant.
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function binDumpBarcodeMatches'));
  ok(/if \(!code[^)]*\) return \[\];/.test(fn.slice(0, 400)),
     'binDumpBarcodeMatches returns early on a blank barcode, before it ever queries');
}

// Crossing stores is the point: one pallet cannot be in two places.
{
  const { env } = env0();
  // u-mgr2 holds BL1 and BL4. Log at BL4 first.
  eq((await call('/?action=bin-dump-log', { user: 'u-mgr2', method: 'POST',
      body: { store: 'BL4', ...TAG }, env })).status, 200, 'logged at BL4');

  // u-mgr1 holds only BL1 and must still be stopped — but must not learn BL4's business.
  const r = await call('/?action=bin-dump-log', { user: 'u-mgr1', method: 'POST',
    body: { store: 'BL1', ...TAG }, env });
  eq(r.status, 409, '🔑 the same pallet at a DIFFERENT store is still caught');
  const m = (await json(r)).matches[0];
  eq(m.redacted, true, '…but redacted, because the caller cannot see that store');
  ok(!('store' in m), '…no store name');
  ok(!('logged_by' in m), '…no logged_by');
  ok(!('pallet_name' in m), '…no pallet name');
  ok(!!m.logged_at, '…yet still a date, which is what makes the warning worth reading');

  // A superuser sees the whole row, because they can see that store anyway.
  const r2 = await call('/?action=bin-dump-log', { user: 'u-su', method: 'POST',
    body: { store: 'BL1', ...TAG }, env });
  eq(r2.status, 409, 'a superuser is stopped too');
  const m2 = (await json(r2)).matches[0];
  eq(m2.redacted, false, '…and sees it unredacted');
  eq(m2.store, 'BL4', '…including which store it is at');
}

// The window is 90 days, not forever: truck numbers eventually cycle.
{
  const { env, db } = env0();
  db.prepare(`INSERT INTO bin_dumps (store, barcode, po, units, logged_by, logged_at)
              VALUES ('BL1', ?, '5036', 1, 'x@y.z', ?)`)
    .run(TAG.barcode, new Date(Date.parse(PINNED) - 100 * 24 * 3600 * 1000).toISOString());
  eq((await call('/?action=bin-dump-log', { user: 'u-mgr1', method: 'POST',
      body: { store: 'BL1', ...TAG }, env })).status, 200,
     'a barcode last seen 100 days ago no longer blocks');

  const { env: env2, db: db2 } = env0();
  db2.prepare(`INSERT INTO bin_dumps (store, barcode, po, units, logged_by, logged_at)
               VALUES ('BL1', ?, '5036', 1, 'x@y.z', ?)`)
    .run(TAG.barcode, new Date(Date.parse(PINNED) - 80 * 24 * 3600 * 1000).toISOString());
  eq((await call('/?action=bin-dump-log', { user: 'u-mgr1', method: 'POST',
      body: { store: 'BL1', ...TAG }, env: env2 })).status, 409,
     '…but 80 days ago still does');
}

// bin-dump-recent answers both questions in one trip, and keeps them apart.
{
  const { env } = env0();
  await call('/?action=bin-dump-log', { user: 'u-mgr1', method: 'POST',
    body: { store: 'BL1', ...TAG }, env });

  let j = await json(await call(
    `/?action=bin-dump-recent&store=BL1&po=5036&barcode=${encodeURIComponent(TAG.barcode)}`,
    { user: 'u-mgr1', env }));
  eq(j.matches.length, 1, 'the PO hint still works');
  eq(j.barcode_matches.length, 1, 'and the barcode block is reported alongside it');

  j = await json(await call('/?action=bin-dump-recent&store=BL1&barcode=PRM-9-9', { user: 'u-mgr1', env }));
  eq(j.matches.length, 0, 'no PO asked, no PO answered');
  eq(j.barcode_matches.length, 0, 'an unseen barcode matches nothing');

  // 🔑 A barcode-only question must not be swallowed by the "no PO" early return the
  // handler used to take.
  j = await json(await call(
    `/?action=bin-dump-recent&store=BL1&barcode=${encodeURIComponent(TAG.barcode)}`,
    { user: 'u-mgr1', env }));
  eq(j.barcode_matches.length, 1, '🔑 asking about a barcode ALONE still answers');
}

// Editing: the same rule, minus the row being edited.
{
  const { env } = env0();
  const a = await json(await call('/?action=bin-dump-log', { user: 'u-mgr1', method: 'POST',
    body: { store: 'BL1', ...TAG }, env }));
  await call('/?action=bin-dump-log', { user: 'u-mgr1', method: 'POST',
    body: { store: 'BL1', ...TAG_B }, env });

  eq((await call('/?action=bin-dump-update', { user: 'u-mgr1', method: 'POST',
      body: { id: a.id, ...TAG, units: 7 }, env })).status, 200,
     '🔑 a row is not a duplicate of ITSELF — saving its own barcode back is fine');

  const r = await call('/?action=bin-dump-update', { user: 'u-mgr1', method: 'POST',
    body: { id: a.id, ...TAG, barcode: TAG_B.barcode }, env });
  eq(r.status, 409, 'but editing a barcode INTO another row’s is refused');
  eq((await json(r)).code, 'DUPLICATE_BARCODE', '…with the same code as the log path');

  eq((await call('/?action=bin-dump-update', { user: 'u-mgr1', method: 'POST',
      body: { id: a.id, ...TAG, barcode: TAG_B.barcode, allow_duplicate: true }, env })).status, 200,
     '…and the same override');
}

// The index that makes the lookup affordable, and the shape of the migration.
{
  const sql = fs.readFileSync(path.join(repo, 'migration-060.sql'), 'utf8');
  ok(/CREATE INDEX IF NOT EXISTS\s+idx_bin_dumps_barcode\s+ON\s+bin_dumps\(barcode/i.test(sql),
     'migration-060 indexes bin_dumps(barcode)');
  ok(!/ON bin_dumps\(store,\s*barcode/i.test(sql),
     '🔑 NOT store-prefixed — the lookup deliberately crosses stores, so a store-first index would not serve it');
  ok(/IF NOT EXISTS/i.test(sql), 'and is re-runnable, unlike migration-059');

  const w = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const logH = w.slice(w.indexOf('action") === "bin-dump-log"'));
  const guardAt = logH.indexOf('DUPLICATE_BARCODE');
  const putAt = logH.indexOf('env.MEDIA.put');
  ok(guardAt > 0 && putAt > 0 && guardAt < putAt,
     '🛑 in the source, the duplicate refusal precedes the R2 put — the orphan test above pins the behaviour, this pins the ordering');

  const h = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  ok(/allow_duplicate: true/.test(h), 'the client can send the override');
  ok(/bdPostAllowingDuplicate/.test(h), 'and retries once when the worker refuses on a race it could not pre-flight');
  ok(/class="bd-dup"/.test(h), 'the log badges rows sharing a barcode');
  ok(/if \(!c\) continue;/.test(h), '…and skips blanks when deciding what is shared');
}

// ── 20. Export ranges: weeks=all, the limit, and saying when it truncates ──
// The point of the range picker is that a CSV never quietly claims to be more than it is.
{
  const { env, db } = env0();
  const ins = db.prepare(`INSERT INTO bin_dumps (store, barcode, po, units, logged_by, logged_at)
                          VALUES ('BL1', ?, '5036', 1, 'x@y.z', ?)`);
  const at = d => new Date(Date.parse(PINNED) - d * 86400000).toISOString();
  ins.run('B-today', at(0));
  ins.run('B-30d',   at(30));
  ins.run('B-120d',  at(120));    // outside 8 weeks, inside a year
  ins.run('B-800d',  at(800));    // outside even 52 weeks

  const list = async (qs) => json(await call(`/?action=bin-dump-list&store=BL1${qs}`, { user: 'u-mgr1', env }));

  let j = await list('');
  eq(j.rows.length, 2, 'the default 8-week window keeps today and 30 days ago');
  eq(j.weeks, 8, 'and says which window it used');
  eq(j.truncated, false, 'nothing was cut');

  j = await list('&weeks=52');
  eq(j.rows.length, 3, '52 weeks reaches 120 days back');
  ok(!j.rows.some(r => r.barcode === 'B-800d'), '…but not 800 days');

  j = await list('&weeks=all');
  eq(j.rows.length, 4, '🔑 weeks=all lifts the time bound entirely — 800 days included');
  eq(j.weeks, 'all', '…and reports itself as all, not a number');

  // 🛑 52 is NOT "everything". This is the assertion that stops someone quietly swapping
  // weeks=all for weeks=52 and reintroducing a ceiling that grows into a bug.
  ok((await list('&weeks=all')).rows.length > (await list('&weeks=52')).rows.length,
     '🛑 weeks=all returns strictly more than the 52-week maximum');

  // A garbage value falls back to the default rather than lifting the bound.
  eq((await list('&weeks=banana')).rows.length, 2, 'an unparseable weeks falls back to 8, never to all');
  eq((await list('&weeks=0')).rows.length, 2, 'and so does 0');
  eq((await list('&weeks=999')).rows.length, 3, 'an over-large weeks clamps to 52, not to all');
}

// The +1 fetch: "exactly the limit" and "more than the limit" must not look the same.
{
  const { env, db } = env0();
  const ins = db.prepare(`INSERT INTO bin_dumps (store, barcode, po, units, logged_by, logged_at)
                          VALUES ('BL1', ?, '1', 1, 'x@y.z', ?)`);
  for (let i = 0; i < 5; i++) ins.run(`B-${i}`, new Date(Date.parse(PINNED) - i * 3600000).toISOString());
  const list = async (qs) => json(await call(`/?action=bin-dump-list&store=BL1${qs}`, { user: 'u-mgr1', env }));

  let j = await list('&limit=3');
  eq(j.rows.length, 3, 'the limit is honoured');
  eq(j.truncated, true, '🔑 …and truncation is REPORTED, not silently applied');

  j = await list('&limit=5');
  eq(j.rows.length, 5, 'a limit exactly equal to the row count returns them all');
  eq(j.truncated, false,
     '🔑 …and is NOT flagged truncated. This is what asking for limit+1 buys: '
     + 'a length check alone cannot tell "exactly the limit" from "there is more"');

  j = await list('&limit=99999');
  eq(j.rows.length, 5, 'an over-large limit clamps without erroring');
  eq(j.truncated, false, '…and nothing is cut');

  eq((await list('&limit=0')).rows.length, 1, 'a zero limit clamps up to 1 rather than returning nothing');

  // Newest first, so a truncated export keeps the MOST RECENT rows — the ones somebody
  // exporting today is most likely to actually want.
  j = await list('&limit=2');
  eq(j.rows[0].barcode, 'B-0', 'a truncated export keeps the newest rows, not the oldest');
  eq(j.rows[1].barcode, 'B-1', '…in order');
}

// The client side of the same contract.
{
  const h = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const fn = h.slice(h.indexOf('async function bdExportCsv'), h.indexOf('window.bdExportCsv'));

  ok(/'\\ufeff' \+ csv/.test(fn) || /\\\\ufeff/.test(fn),
     'the CSV is written with a UTF-8 BOM so Excel does not mojibake an en-dash');
  ok(/action=bin-dump-list/.test(fn),
     '🔑 the export FETCHES its own rows — building it from bdState.rows would make '
     + '"Everything" quietly mean the 8 weeks already on screen');
  ok(/limit=\$\{BD_CSV_LIMIT\}/.test(fn), '…asking for the export limit, not the view default');
  ok(/thisWeekOnly/.test(fn) && /r\.week === w/.test(fn),
     '"This week" filters by WEEK KEY, not by a 7-day window, which differ on any day but Sunday');
  ok(/if \(truncated\)/.test(fn) && /uiAlert/.test(fn),
     '🛑 a truncated export raises a modal — a status line is too easy to miss when the '
     + 'consequence is handing someone a partial file');
  ok(/bdSetLogStatus/.test(fn) && !/bdSetStatus/.test(fn),
     '🛑 export messages go to the LOG pane. #bd-status lives in the scan pane and is '
     + 'hidden while the log is open, so bdSetStatus here would be invisible');
  ok(/range\.slug\(\)/.test(fn), 'the filename records which range it covers');

  // 🛑 THE RANGE TABLE ITSELF. Asserting only that the worker understands weeks=all leaves
  // the client free to stop sending it: swapping 'all' for 52 caps "Everything" at a year
  // and every other assertion here still passes. Pin what each option actually requests.
  const ranges = h.slice(h.indexOf('const BD_RANGES = ['), h.indexOf('async function bdExportCsv'));
  ok(/value: 'all',[^}]*weeks: 'all'/.test(ranges),
     "🛑 'Everything' requests weeks='all' — not 52, which stops being everything once the "
     + 'table is a year old');
  ok(/value: '8',[^}]*weeks: 8/.test(ranges), "'Last 8 weeks' requests 8");
  ok(/value: 'this',[^}]*weeks: 2,[^}]*thisWeekOnly: true/.test(ranges),
     "'This week' fetches TWO weeks and narrows by week key — one week of days is not the "
     + 'retail week on any day but Sunday');
  eq((ranges.match(/value: '/g) || []).length, 3, 'three ranges, no more and no fewer');

  // The shared dialog's chooser, and the cancel value that keeps it unambiguous.
  const dlg = h.slice(h.indexOf('function _uiDialog'), h.indexOf('function uiConfirm'));
  ok(/choices = null/.test(dlg), '_uiDialog grew a choices mode rather than a second dialog');
  ok(/const cancelValue = choices \? null : false;/.test(dlg),
     '🔑 cancelling a chooser resolves null, not false — false is a legitimate choice value');
  ok(/e\.key === 'Enter' && !choices/.test(dlg),
     'Enter picks nothing when there are choices; with three options there is no default');
}

// Tally in the shape scripts/test.sh counts: "<n> passed, <m> failed".
console.log(`\n${assertions - failures} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
