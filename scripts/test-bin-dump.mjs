// Bin Dump — pallet tag scan, log, list, edit, delete.
//
// 🔑 THE POINT OF THIS SUITE is the field-shift case. The tag prints each value
// one line ABOVE its label, so a horizontal read pairs every label with the next
// one's value and produces a row that is wrong in a way nothing downstream can
// detect: item becomes the PO, units becomes a person's name. The prompt states
// the geometry; these tests pin that it still says so, and that a correct model
// answer survives the whole path unaltered.
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

// The seven fields as they actually read off Brian's tag (photo, 2026-09-08).
const TAG = {
  barcode: 'PRM-10490-30', item_no: '50201', pallet_name: 'PALLET AMAZON IND8',
  po: '5036', units: 1, created_by_tag: 'Ranon Price', truck_no: '10490',
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
  ok(/ONE LINE HIGHER/.test(p), 'prompt says the value sits one line higher than its label');
  ok(/DIAGONALLY/.test(p), 'prompt says the pairing is diagonal');
  ok(/PRM-10490-30/.test(p) && /Ranon Price/.test(p), 'prompt shows the real tag as a worked example');
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
  eq(j.read, 7, 'all seven fields read');
  for (const k of Object.keys(TAG)) eq(j.fields[k], TAG[k], `field ${k} passes through unaltered`);
  eq(sent.length, 1, 'exactly one model call');
  eq(sent[0].model, 'claude-sonnet-4-6', 'uses the house extraction model');
  eq(sent[0].thinking.type, 'disabled', 'thinking disabled, as on every extraction call');
  const parts = sent[0].messages[0].content;
  eq(parts[0].type, 'image', 'the image is sent first');
  eq(parts[0].source.media_type, 'image/jpeg', 'media type carried through');
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
  eq(j.read, 5, 'read count reflects the two missing fields');
}

// ── 5. Junk photo: an empty answer is still an editable form, not an error ──
{
  const { env } = env0();
  spy(textReply('I cannot make out any tag in this image.'));
  const r = await call('/?action=bin-dump-scan', { user: 'u-mgr1', method: 'POST', body: IMG, env });
  const j = await json(r);
  eq(r.status, 200, 'an unreadable photo is not an error — the tag can still be keyed by hand');
  eq(j.read, 0, 'nothing was read');
  eq(Object.keys(j.fields).length, 7, 'all seven keys are present so the form renders');
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

  // A row in a store the caller does not hold, addressed directly by id.
  const other = await json(await call('/?action=bin-dump-log', { user: 'u-mgr2', method: 'POST',
    body: { store: 'BL4', ...TAG }, env }));
  eq((await call('/?action=bin-dump-update', { user: 'u-mgr1', method: 'POST',
      body: { id: other.id, ...TAG }, env })).status, 403,
     "🛑 the ROW's store decides, so another store's row cannot be edited by id");
  eq((await call('/?action=bin-dump-update', { user: 'u-mgr1', method: 'POST',
      body: { id: 99999, ...TAG }, env })).status, 404, 'a missing row is a 404');
}

// ── 16. Deleting: a manager may, but only at a store they hold ─────────────
{
  const { env, db } = env0();
  const mk = async (user, store) => (await json(await call('/?action=bin-dump-log',
    { user, method: 'POST', body: { store, ...TAG, ...IMG }, env }))).id;
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

// Tally in the shape scripts/test.sh counts: "<n> passed, <m> failed".
console.log(`\n${assertions - failures} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
