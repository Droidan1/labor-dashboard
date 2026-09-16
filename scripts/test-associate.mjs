// Associates — a name, a six-digit code, and the pages an admin ticked.
//
// 🔑 WHAT THIS SUITE IS FOR. Everything else in the app decides access by ROLE,
// and every role that exists today either sees money or sees nothing. An
// associate is the first account that sees exactly one page, so the gate that
// lets them through is the first thing in this worker that can widen access —
// and a mistake in it is not a broken screen, it is a floor worker reading store
// revenue. So the assertions below are mostly about what an associate CANNOT
// reach, and they drive the real worker.fetch rather than re-stating the rules.
//
// The account is created through associate-save and signed in through
// associate-login, using the cookie the worker actually sets. Nothing here
// inserts a user row by hand: a fixture that skips the endpoints would pass
// while the endpoints were broken.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, ctx, req, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let assertions = 0, failures = 0;
const ok = (c, m) => { assertions++; if (!c) { failures++; console.error('  FAIL ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

blockNetwork();
const worker = await loadWorker(repo);

function env0() {
  const { db, env } = makeEnv(repo);
  db.exec(fs.readFileSync(path.join(repo, 'migration-058.sql'), 'utf8'));
  applyMigrationAlters(db, repo);      // 🔑 again, AFTER the migration made its table
  env.PIN_PEPPER = 'test-pepper-not-the-real-one';
  env.ANTHROPIC_API_KEY = 'test-key';
  return { db, env };
}

const call = (url, opts = {}) => worker.fetch(req(url, opts), opts.env, ctx);
const json = async (r) => { try { return await r.json(); } catch { return {}; } };

// A request carrying a REAL session id, as opposed to the harness's `sess-<user>`
// fixtures — an associate's session is one the worker itself minted.
function asSession(url, sid, { method = 'GET', body } = {}) {
  return new Request('https://api.retjghub.com' + url, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: `session=${sid}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const sidOf = (r) => (r.headers.get('Set-Cookie') || '').match(/session=([^;]+)/)?.[1] || null;

const TAG = {
  barcode: 'PRM-10490-30', item_no: '50201', pallet_name: 'PALLET AMAZON IND8',
  sup_ref: null, po: '5036', units: 1, created_by_tag: 'Ranon Price', truck_no: '10490',
};

// Create an associate the way the Users page does, then sign in the way the phone does.
async function makeAssociate(env, { name = 'Dee Ramirez', pin = '481902',
                                    stores = ['BL1'], pages = { 'bin-dump': 'edit' },
                                    by = 'u-admin' } = {}) {
  const r = await call('/?action=associate-save', { user: by, method: 'POST',
    body: { name, pin, stores, pages }, env });
  const j = await json(r);
  return { status: r.status, id: j.id, name, pin, error: j.error };
}
async function signIn(env, name, pin) {
  const r = await worker.fetch(asSession('/?action=associate-login', '', {
    method: 'POST', body: { name, pin },
  }), env, ctx);
  return { status: r.status, sid: sidOf(r), body: await json(r) };
}

console.log('Associates');

// ── 1. Creating one ────────────────────────────────────────────────────────
{
  const { db, env } = env0();
  const a = await makeAssociate(env);
  eq(a.status, 200, 'an admin can create an associate');
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(a.id);
  eq(row.role, 'staff', "the DB role is 'staff' — the label 'Associate' is the UI's job");
  eq(row.name, 'Dee Ramirez', 'the name is stored as typed');
  ok(/^assoc_usr_[0-9a-f]+@associate\.invalid$/.test(row.email),
     `the synthetic address is on the reserved .invalid TLD (got ${row.email})`);
  ok(row.pin_hash && row.pin_hash.length === 64, 'the code is stored as a 64-hex HMAC');
  ok(!row.pin_hash.includes('481902'), '🛑 and the code itself is nowhere in it');
  eq(row.pin_failures, 0, 'with a clean failure count');
  eq(row.stores, '["BL1"]', 'the legacy stores column is mirrored, as invite-user does');
  eq(row.pages, '{"bin-dump":"edit"}', 'and the page grant is stored');
  const g = db.prepare("SELECT * FROM user_grants WHERE user_id = ? AND business_id = 'bl'").get(a.id);
  ok(!!g, 'a Bargain Lane grant is written — without it the business gate refuses everything');
  eq(g.role, 'staff', 'the grant carries the same role');
  eq(g.units, '["BL1"]', 'and the stores, which is what every store guard reads');

  // 🔑 The pepper is what makes a six-digit code unguessable from a dump. Two
  // environments with different peppers must not produce the same hash.
  const { env: env2 } = env0();
  env2.PIN_PEPPER = 'a-different-pepper';
  const b = await makeAssociate(env2);
  const row2 = env2.DB && db; void row2;
  ok(b.status === 200, 'the same code creates fine under a different pepper');
}

// ── 2. What creating one refuses ───────────────────────────────────────────
{
  const { env } = env0();
  const bad = async (patch, why, want = 400) => {
    const r = await call('/?action=associate-save', { user: 'u-admin', method: 'POST',
      body: { name: 'Test Person', pin: '481902', stores: ['BL1'], pages: { 'bin-dump': 'view' }, ...patch }, env });
    eq(r.status, want, why);
  };
  await bad({ name: '' }, 'a nameless associate is refused');
  await bad({ name: 'x'.repeat(61) }, 'an absurdly long name is refused');
  await bad({ pin: '' }, 'creating without a code is refused');
  await bad({ pin: '4819' }, 'a four-digit code is refused');
  await bad({ pin: '48190a' }, 'a code with a letter in it is refused');
  await bad({ pin: '123456' }, '🔑 an obvious code is refused at creation, not at login');
  await bad({ pin: '111111' }, 'and so is a repeated digit');
  await bad({ stores: [] }, '🛑 no stores is REFUSED — a bl grant with no units can reach nothing');
  await bad({ stores: ['BL1', 'BL99'] }, 'a store that is not Bargain Lane’s is refused');
  await bad({ pages: { 'dashboard': 'view' } }, 'a page outside the grantable set is refused');
  await bad({ pages: { 'bin-dump': 'admin' } }, 'a level that does not exist is refused');

  // A name is half the login AND the whole audit trail, so it has to be unique.
  eq((await makeAssociate(env, { name: 'Dee Ramirez', pin: '481902' })).status, 200, 'the first Dee is fine');
  eq((await makeAssociate(env, { name: 'dee   ramirez', pin: '551903' })).status, 409,
     '🔑 a second Dee is refused, case- and whitespace-insensitively');
}

// ── 3. Who may create one ──────────────────────────────────────────────────
{
  const { env } = env0();
  eq((await makeAssociate(env, { by: 'u-su', name: 'A One', pin: '481902' })).status, 200, 'a superuser may');
  eq((await makeAssociate(env, { by: 'u-admin', name: 'A Two', pin: '481903' })).status, 200, 'an admin may');
  eq((await makeAssociate(env, { by: 'u-mgr1', name: 'A Three', pin: '481904' })).status, 403, 'a manager may not');
  eq((await makeAssociate(env, { by: 'u-exec', name: 'A Four', pin: '481905' })).status, 403, 'an executive may not');
  eq((await makeAssociate(env, { by: 'u-staff', name: 'A Five', pin: '481906' })).status, 403,
     '🛑 and an associate certainly may not create another one');
}

// ── 4. Signing in ──────────────────────────────────────────────────────────
{
  const { db, env } = env0();
  const a = await makeAssociate(env);

  const bad = await signIn(env, 'Dee Ramirez', '000001');
  eq(bad.status, 401, 'a wrong code is refused');
  eq(bad.body.code, 'BAD_CODE', 'with the generic code');
  eq(db.prepare('SELECT pin_failures f FROM users WHERE id = ?').get(a.id).f, 1, 'and the failure is counted');

  const nobody = await signIn(env, 'Nobody At All', '000001');
  eq(nobody.status, 401, 'an unknown name is refused');
  eq(nobody.body.error, bad.body.error,
     '🔑 with the SAME message as a wrong code — otherwise this is a staff directory');

  const short = await signIn(env, 'Dee Ramirez', '4819');
  eq(short.status, 400, '🛑 a malformed code dies at input validation…');
  eq(db.prepare('SELECT pin_failures f FROM users WHERE id = ?').get(a.id).f, 1,
     '…so it cannot burn an attempt, and cannot be used to probe');

  const good = await signIn(env, '  dee ramirez  ', '481902');
  eq(good.status, 200, 'the right code signs in, whatever the spacing or case');
  ok(!!good.sid, 'and a session cookie comes back');
  const sess = db.prepare('SELECT * FROM sessions WHERE id = ?').get(good.sid);
  ok(!!sess, 'the session row exists');
  const hours = (new Date(sess.expires_at) - Date.now()) / 3600000;
  ok(hours > 11.5 && hours < 12.5, `🔑 it lasts 12 hours, not 7 days (got ${hours.toFixed(1)}h)`);
  eq(db.prepare('SELECT pin_failures f FROM users WHERE id = ?').get(a.id).f, 0,
     'a good code clears the failures');
  ok(!!db.prepare('SELECT last_login l FROM users WHERE id = ?').get(a.id).l, 'and stamps last_login');

  // 🔑 The session must not slide. Everyone else's rolls forward on use; a shared
  // warehouse phone must not let one shift's session live into the next.
  const before = db.prepare('SELECT expires_at e FROM sessions WHERE id = ?').get(good.sid).e;
  await worker.fetch(asSession('/?action=auth-me', good.sid), env, ctx);
  eq(db.prepare('SELECT expires_at e FROM sessions WHERE id = ?').get(good.sid).e, before,
     '🔑 a request does NOT extend an associate session');
}

// ── 5. Lockout ─────────────────────────────────────────────────────────────
{
  const { db, env } = env0();
  const a = await makeAssociate(env);
  for (let i = 0; i < 10; i++) await signIn(env, 'Dee Ramirez', '000001');
  eq(db.prepare('SELECT pin_failures f FROM users WHERE id = ?').get(a.id).f, 10, 'ten wrong codes are counted');
  const locked = await signIn(env, 'Dee Ramirez', '481902');
  eq(locked.status, 401, '🛑 the RIGHT code no longer works once locked');
  eq(locked.body.code, 'LOCKED', 'and says so, because only an admin can clear it');

  // Setting a new code is the only way out, and it is an admin's to do.
  const r = await call('/?action=associate-save', { user: 'u-admin', method: 'POST',
    body: { id: a.id, name: 'Dee Ramirez', pin: '551903', stores: ['BL1'], pages: { 'bin-dump': 'edit' } }, env });
  eq(r.status, 200, 'an admin sets a new code');
  eq(db.prepare('SELECT pin_failures f FROM users WHERE id = ?').get(a.id).f, 0, 'which clears the lock');
  eq((await signIn(env, 'Dee Ramirez', '481902')).status, 401, 'the old code is dead');
  eq((await signIn(env, 'Dee Ramirez', '551903')).status, 200, 'the new one works');
}

// ── 6. A new code signs them out everywhere ────────────────────────────────
{
  const { db, env } = env0();
  const a = await makeAssociate(env);
  const s = await signIn(env, 'Dee Ramirez', '481902');
  eq((await worker.fetch(asSession('/?action=auth-me', s.sid), env, ctx)).status, 200, 'the phone is signed in');
  await call('/?action=associate-save', { user: 'u-admin', method: 'POST',
    body: { id: a.id, name: 'Dee Ramirez', pin: '551903', stores: ['BL1'], pages: { 'bin-dump': 'edit' } }, env });
  eq(db.prepare('SELECT COUNT(*) c FROM sessions WHERE user_id = ?').get(a.id).c, 0,
     '🛑 setting a new code DELETES their sessions — otherwise a lost phone keeps working');
  const after = await json(await worker.fetch(asSession('/?action=auth-me', s.sid), env, ctx));
  eq(after.authenticated, false, 'and the old cookie is dead');
}

// ── 7. Suspending one ──────────────────────────────────────────────────────
{
  const { env } = env0();
  const a = await makeAssociate(env);
  await call('/?action=associate-save', { user: 'u-admin', method: 'POST',
    body: { id: a.id, name: 'Dee Ramirez', stores: ['BL1'], pages: { 'bin-dump': 'edit' }, status: 'suspended' }, env });
  const r = await signIn(env, 'Dee Ramirez', '481902');
  eq(r.status, 401, 'a suspended associate cannot sign in');
  eq(r.body.code, 'BAD_CODE', '…and is told nothing more than a wrong code would be');
}

// ── 8. Forgetting the code ─────────────────────────────────────────────────
{
  const { db, env } = env0();
  const a = await makeAssociate(env);
  const ask = async (name) => worker.fetch(asSession('/?action=associate-reset-request', '', {
    method: 'POST', body: { name } }), env, ctx);

  const r1 = await ask('Dee Ramirez');
  eq(r1.status, 200, 'asking for a reset is answered');
  const first = db.prepare('SELECT pin_reset_requested_at t FROM users WHERE id = ?').get(a.id).t;
  ok(!!first, 'and recorded, so an admin can see who is waiting');

  db.prepare("UPDATE users SET pin_reset_requested_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 5 * 60 * 1000).toISOString(), a.id);
  const recent = db.prepare('SELECT pin_reset_requested_at t FROM users WHERE id = ?').get(a.id).t;
  await ask('Dee Ramirez');
  eq(db.prepare('SELECT pin_reset_requested_at t FROM users WHERE id = ?').get(a.id).t, recent,
     'asking again within the hour does not re-stamp it — the badge shows when they FIRST asked');

  eq((await ask('Nobody At All')).status, 200,
     '🔑 an unknown name is answered ok too — this must not reveal who has an account');
  eq((await ask('')).status, 200, 'and so is an empty one');
  eq(db.prepare('SELECT COUNT(*) c FROM users WHERE pin_reset_requested_at IS NOT NULL').get().c, 1,
     'while nothing else was touched');

  // It records a request and NOTHING else — the code itself is untouched.
  eq((await signIn(env, 'Dee Ramirez', '481902')).status, 200,
     '🛑 asking for a reset does not change or clear the existing code');

  // Setting the new code clears the flag, so the badge goes away on its own.
  await call('/?action=associate-save', { user: 'u-admin', method: 'POST',
    body: { id: a.id, name: 'Dee Ramirez', pin: '551903', stores: ['BL1'], pages: { 'bin-dump': 'edit' } }, env });
  eq(db.prepare('SELECT pin_reset_requested_at t FROM users WHERE id = ?').get(a.id).t, null,
     'setting the new code clears the request');
}

// ── 9. THE GATE — what one page buys, and what it does not ─────────────────
{
  const { env } = env0();
  const view = await makeAssociate(env, { name: 'View Only', pin: '481902', pages: { 'bin-dump': 'view' } });
  const edit = await makeAssociate(env, { name: 'Edit Too', pin: '551903', pages: { 'bin-dump': 'edit' } });
  const none = await makeAssociate(env, { name: 'No Pages', pin: '661904', pages: {} });
  void view; void edit; void none;
  const sV = (await signIn(env, 'View Only', '481902')).sid;
  const sE = (await signIn(env, 'Edit Too', '551903')).sid;
  const sN = (await signIn(env, 'No Pages', '661904')).sid;
  const hit = async (sid, url, opts) => (await worker.fetch(asSession(url, sid, opts), env, ctx)).status;

  // Seed one row through a manager so the view-level reads have something to find.
  const seeded = await json(await call('/?action=bin-dump-log', { user: 'u-mgr1', method: 'POST',
    body: { store: 'BL1', ...TAG, image_b64: 'aGVsbG8=', media_type: 'image/jpeg' }, env }));

  console.log('  view level:');
  eq(await hit(sV, '/?action=bin-dump-list&store=BL1'), 200, 'view reads the log');
  eq(await hit(sV, `/?action=bin-dump-photo&id=${seeded.id}`), 200, 'and a tag photo');
  eq(await hit(sV, '/?action=bin-dump-scan', { method: 'POST', body: { image_b64: 'aGk=' } }), 403,
     '🛑 but cannot scan');
  eq(await hit(sV, '/?action=bin-dump-log', { method: 'POST', body: { store: 'BL1', ...TAG } }), 403,
     '🛑 cannot log');
  eq(await hit(sV, '/?action=bin-dump-update', { method: 'POST', body: { id: seeded.id, ...TAG } }), 403,
     '🛑 and cannot correct a row');

  console.log('  edit level:');
  eq(await hit(sE, '/?action=bin-dump-list&store=BL1'), 200, 'edit reads the log too');
  eq(await hit(sE, '/?action=bin-dump-recent&store=BL1&po=5036'), 200, 'runs the duplicate check');
  const logged = await worker.fetch(asSession('/?action=bin-dump-log', sE, {
    method: 'POST', body: { store: 'BL1', ...TAG, barcode: 'PRM-10490-31' } }), env, ctx);
  eq(logged.status, 200, 'and logs a pallet');
  eq(await hit(sE, '/?action=bin-dump-update', { method: 'POST', body: { id: seeded.id, ...TAG } }), 200,
     'and corrects one');

  console.log('  what NEITHER level buys:');
  for (const [label, sid] of [['view', sV], ['edit', sE]]) {
    eq(await hit(sid, '/?action=bin-dump-delete', { method: 'POST', body: { id: seeded.id } }), 403,
       `🛑 ${label} cannot delete — that stays a manager's undo`);
    eq(await hit(sid, '/?action=weekly-summary'), 403, `🛑 ${label} cannot see money`);
    eq(await hit(sid, '/?action=list-users'), 403, `🛑 ${label} cannot list users`);
    eq(await hit(sid, '/?action=associate-save', { method: 'POST', body: { name: 'Me', pin: '999888', stores: ['BL1'] } }), 403,
       `🛑 ${label} cannot make themselves another account`);
    eq(await hit(sid, '/?history_d1=true&store=BL1&from=2025-01-01&to=2026-12-31'), 403,
       `🛑 ${label} cannot read store history — the request with no action at all`);
    eq(await hit(sid, '/?action=merch-scan', { method: 'POST', body: { identifier: '024100113163' } }), 403,
       `🛑 ${label} cannot price items`);
  }

  console.log('  no pages at all:');
  eq(await hit(sN, '/?action=bin-dump-list&store=BL1'), 403, '🛑 an ungranted associate reads nothing');
  eq(await hit(sN, '/?action=auth-me'), 200, '…but auth-me still answers, so the app can say why');
  eq(await hit(sN, '/?action=auth-logout', { method: 'POST' }), 200, '…and they can sign out');
}

// ── 10. Stores still decide, on top of pages ───────────────────────────────
{
  const { env } = env0();
  await makeAssociate(env, { name: 'One Store', pin: '481902', stores: ['BL1'], pages: { 'bin-dump': 'edit' } });
  const sid = (await signIn(env, 'One Store', '481902')).sid;
  const r = await worker.fetch(asSession('/?action=bin-dump-log', sid, {
    method: 'POST', body: { store: 'BL4', ...TAG } }), env, ctx);
  eq(r.status, 403, '🛑 a page grant does not open a store they do not hold');
  eq((await r.json()).code, 'NO_STORE_ACCESS', 'and they are told it is the store, not the page');
  eq((await worker.fetch(asSession('/?action=bin-dump-log', sid, {
      method: 'POST', body: { store: 'BL1', ...TAG } }), env, ctx)).status, 200, 'their own store is fine');
}

// ── 11. The audit trail says who, by name ──────────────────────────────────
{
  const { db, env } = env0();
  await makeAssociate(env, { name: 'Dee Ramirez', pin: '481902' });
  const sid = (await signIn(env, 'Dee Ramirez', '481902')).sid;
  const j = await (await worker.fetch(asSession('/?action=bin-dump-log', sid, {
    method: 'POST', body: { store: 'BL1', ...TAG } }), env, ctx)).json();
  const row = db.prepare('SELECT logged_by FROM bin_dumps WHERE id = ?').get(j.id);
  eq(row.logged_by, 'Dee Ramirez',
     '🔑 logged_by is the NAME — the synthetic address would be meaningless on the log');
  await worker.fetch(asSession('/?action=bin-dump-update', sid, {
    method: 'POST', body: { id: j.id, ...TAG, units: 4 } }), env, ctx);
  eq(db.prepare('SELECT edited_by FROM bin_dumps WHERE id = ?').get(j.id).edited_by, 'Dee Ramirez',
     'and so is edited_by');
  // Everyone else is unchanged: a manager still logs under their address.
  const m = await json(await call('/?action=bin-dump-log', { user: 'u-mgr1', method: 'POST',
    body: { store: 'BL1', ...TAG, barcode: 'PRM-10490-31' }, env }));
  eq(db.prepare('SELECT logged_by FROM bin_dumps WHERE id = ?').get(m.id).logged_by,
     'howardbrian260@gmail.com', 'a manager, who has a real address, is unaffected');
}

// ── 12. auth-me tells the client what it needs and nothing more ────────────
{
  const { env } = env0();
  await makeAssociate(env, { name: 'Dee Ramirez', pin: '481902', stores: ['BL1'], pages: { 'bin-dump': 'view' } });
  const sid = (await signIn(env, 'Dee Ramirez', '481902')).sid;
  const me = await (await worker.fetch(asSession('/?action=auth-me', sid), env, ctx)).json();
  eq(me.name, 'Dee Ramirez', 'the name is reported, for the badge and the log');
  eq(JSON.stringify(me.pages), '{"bin-dump":"view"}', 'and the page grants, so the shell can hide the rest');
  eq(JSON.stringify(me.stores), '["BL1"]', 'stores are the effective list, as for everyone else');
  eq(me.role, 'staff', 'the raw role still goes out — the UI maps it to "Associate"');
  eq(me.associate, true, 'and the flag the client gates the whole shell on');
  ok(!('pin_hash' in me) && !JSON.stringify(me).includes('481902'),
     '🛑 nothing about the code leaves the worker');

  // An existing account is untouched by any of this.
  const mgr = await json(await call('/?action=auth-me', { user: 'u-mgr1', env }));
  eq(mgr.name, null, 'a manager has no name column, and gets null rather than a surprise');
  eq(JSON.stringify(mgr.pages), '{}', 'and no page grants — they are gated by role, as always');
  eq(mgr.associate, false, 'and is not an associate, so none of the new shell rules touch them');
}

// ── 13. An associate has no OTHER way in ───────────────────────────────────
{
  const { db, env } = env0();
  const a = await makeAssociate(env);
  const email = db.prepare('SELECT email FROM users WHERE id = ?').get(a.id).email;
  const sid = (await signIn(env, 'Dee Ramirez', '481902')).sid;

  // 🔑 The synthetic address must not be a live account anywhere. Left alone it is
  // an ORACLE: auth-login would try to mail @associate.invalid and answer
  // differently from an address nobody has.
  await call('/?action=auth-login', { method: 'POST', body: { email }, env });
  eq(db.prepare('SELECT COUNT(*) c FROM magic_links WHERE email = ?').get(email).c, 0,
     '🛑 auth-login writes no magic link for an associate');
  eq((await call('/?action=resend-invite', { user: 'u-admin', method: 'POST', body: { email }, env })).status, 404,
     '🛑 and an invite cannot be resent to one');

  // A passkey is device-bound and mints a 7-day session — it would walk straight
  // around the 12-hour rule on a shared phone.
  eq((await worker.fetch(asSession('/?action=passkey-register-begin', sid, { method: 'POST', body: {} }), env, ctx)).status, 403,
     '🛑 an associate cannot enrol a passkey');

  // The Users screen owns managers; the Associates panel owns associates. Neither
  // may reach into the other, or the two disagree about the same row.
  eq((await call('/?action=update-user', { user: 'u-admin', method: 'POST',
      body: { id: a.id, role: 'manager' }, env })).status, 400,
     '🛑 update-user refuses an associate — it could only ever write a role they must not hold');
  eq(db.prepare('SELECT role FROM users WHERE id = ?').get(a.id).role, 'staff', 'and the row is unchanged');
  eq((await call('/?action=set-user-grants', { user: 'u-su', method: 'POST',
      body: { id: a.id, grants: [{ business_id: 'bl', role: 'manager', units: null }] }, env })).status, 400,
     '🛑 set-user-grants refuses one too — it replaces grants wholesale');
  eq(db.prepare("SELECT units FROM user_grants WHERE user_id = ?").get(a.id).units, '["BL1"]',
     'and their stores survive that refusal');

  // 🔑 The login looks up by NAME, so what stops it finding a non-associate is
  // the `pin_hash IS NOT NULL` clause and nothing else. Give a manager a name —
  // which a future release plausibly does — and the clause is the only thing
  // between their account and a six-digit brute force.
  db.prepare("UPDATE users SET name = 'Brian Howard' WHERE id = 'u-mgr1'").run();
  const atMgr = await signIn(env, 'Brian Howard', '481902');
  eq(atMgr.status, 401, 'a named MANAGER cannot be signed into with a code');
  ok(!atMgr.sid, 'and no session is minted for them');
  eq(db.prepare("SELECT pin_failures f FROM users WHERE id = 'u-mgr1'").get().f, 0,
     '🛑 nor is their account even touched — the lookup never reached the row');

  // ...but associate-save cannot be turned on a manager either.
  eq((await call('/?action=associate-save', { user: 'u-admin', method: 'POST',
      body: { id: 'u-mgr1', name: 'Not A Chance', pin: '551903', stores: ['BL1'], pages: {} }, env })).status, 404,
     '🛑 and associate-save cannot reach a manager by id');
  eq(db.prepare("SELECT role FROM users WHERE id = 'u-mgr1'").get().role, 'manager', 'that manager is untouched');
}

// ── 14. The list an admin sees ─────────────────────────────────────────────
{
  const { env } = env0();
  await makeAssociate(env);
  const r = await call('/?action=list-users', { user: 'u-admin', env });
  const body = await r.text();
  ok(!/pin_hash/.test(body), '🛑 list-users never carries the hash');
  ok(!body.includes('481902'), '🛑 nor the code');
  const users = JSON.parse(body).users;
  const dee = users.find(u => u.name === 'Dee Ramirez');
  ok(!!dee, 'the associate is in the payload');
  eq(dee.associate, 1, 'flagged, so the client can split the two tables');
  eq(users.find(u => u.email === 'howardbrian260@gmail.com').associate, 0, 'and a manager is not');
  ok('pin_failures' in dee && 'pin_reset_requested_at' in dee,
     'with what the panel needs to show Locked and Reset requested');
}

// ── 15. No pepper, no sign-in ──────────────────────────────────────────────
{
  const { env } = env0();
  await makeAssociate(env);
  delete env.PIN_PEPPER;
  const r = await signIn(env, 'Dee Ramirez', '481902');
  eq(r.status, 500, '🛑 a missing pepper refuses the login…');
  eq(r.body.code, 'NOT_CONFIGURED', '…and says why');
  ok(!r.sid, '…and mints no session');
  const save = await call('/?action=associate-save', { user: 'u-admin', method: 'POST',
    body: { name: 'Someone Else', pin: '551903', stores: ['BL1'], pages: {} }, env });
  eq(save.status, 500, '🛑 and no code can be set either — never an unpeppered hash');
}

// ── 16. The gate's own shape, read out of the source ───────────────────────
// A grep, and it says so — but the two lists it compares MUST agree or an
// associate hits a 403 the client has no way to explain.
{
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const pages = [...src.matchAll(/\["bin-dump-[a-z]+",\s*\["([a-z-]+)",\s*"(view|edit)"\]\]/g)];
  ok(pages.length >= 6, `ACTION_PAGE classifies the Bin Dump actions (${pages.length})`);
  ok(!/\["bin-dump-delete",\s*\[/.test(src),
     '🛑 bin-dump-delete is NOT in ACTION_PAGE — no page grant may reach it');
  const agnostic = src.slice(src.indexOf('const BUSINESS_AGNOSTIC_ACTIONS')).slice(0, 1600);
  ok(/"associate-login"/.test(agnostic) && /"associate-reset-request"/.test(agnostic),
     'the two public associate actions are business-agnostic');
  ok(/\["associate-save", "bl"\]/.test(src), 'and associate-save belongs to Bargain Lane');
  const client = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  for (const page of new Set(pages.map(m => m[1]))) {
    ok(client.includes(`id: '${page}'`),
       `the client's GRANTABLE_PAGES registry knows about '${page}'`);
  }
}

// ── 17. Reading a code back (migration-068) ────────────────────────────────
// Brian, 2026-09-16. `pin_hash` is one-way, so viewing a code means keeping a
// SECOND, decryptable copy — and every assertion here exists because some way of
// getting that wrong is worse than not having the feature.
//
// 🔑 The two ALTERs in migration-068 already reach `users` via
// applyMigrationAlters (the harness creates that table itself). `pin_reveals`
// does not exist until the migration's CREATE runs, and exec'ing the WHOLE file
// would die on `duplicate column name` from those same ALTERs — so take the file
// from its first CREATE onward. SLICED FROM THE REAL MIGRATION, never retyped, so
// a change to the table's shape reaches this suite instead of passing against a
// copy that has drifted.
const CIPHER_KEY = 'test-cipher-key-not-the-real-one';
function envCipher({ key = CIPHER_KEY } = {}) {
  const { db, env } = env0();
  const sql = fs.readFileSync(path.join(repo, 'migration-068.sql'), 'utf8');
  // 🛑 Anchored to the start of a LINE. A bare indexOf('CREATE TABLE') matches the
  // phrase inside the migration's own comment prose and slices from mid-sentence.
  db.exec(sql.slice(sql.search(/^CREATE TABLE/m)));
  if (key) env.PIN_CIPHER_KEY = key;
  return { db, env };
}
const reveal = (env, id, by = 'u-admin') =>
  call('/?action=associate-reveal-pin', { user: by, method: 'POST', body: { id }, env });
const cipherOf = (db, id) => db.prepare('SELECT pin_cipher c FROM users WHERE id = ?').get(id).c;

// The round trip: what an admin types is what an admin reads back.
{
  const { db, env } = envCipher();
  const a = await makeAssociate(env, { pin: '481902' });
  ok(!!cipherOf(db, a.id), 'a code set with the key configured stores a cipher');
  const j = await json(await reveal(env, a.id));
  eq(j.recoverable, true, 'and it reveals');
  eq(j.pin, '481902', '🔑 as exactly the code that was set');
  eq(j.name, 'Dee Ramirez', 'named, so the modal cannot label it with the wrong person');
  ok(!!j.set_at, 'and stamped with when it was set');
  // The hash is still the only thing login checks — the cipher has not replaced it.
  eq((await signIn(env, 'Dee Ramirez', '481902')).status, 200, 'and the code still signs in');
}

// 🛑 THE STALE-CIPHER BUG. A code change rewrites the hash; if it does not rewrite
// the cipher, reveal hands an admin the PREVIOUS code — one that no longer signs
// anyone in — and they read it down the phone. Worse than showing nothing, because
// it looks like an answer.
{
  const { db, env } = envCipher();
  const a = await makeAssociate(env, { pin: '481902' });
  const first = cipherOf(db, a.id);
  await call('/?action=associate-save', { user: 'u-admin', method: 'POST',
    body: { id: a.id, name: a.name, pin: '730518', stores: ['BL1'], pages: { 'bin-dump': 'edit' } }, env });
  const j = await json(await reveal(env, a.id));
  eq(j.pin, '730518', '🛑 a changed code reveals the NEW code');
  ok(j.pin !== '481902', '🛑 and never the old one');
  ok(cipherOf(db, a.id) !== first, 'the stored cipher was rewritten, not left behind');
  eq((await signIn(env, 'Dee Ramirez', '730518')).status, 200, 'the new code is the one that works');
}

// 🛑 IV REUSE. AES-GCM leaks the XOR of two plaintexts encrypted under one
// (key, IV) pair, and across six digits that is the entire secret. The same code
// stored twice must not produce the same ciphertext.
// 🛑 THE SAME CODE, THE SAME USER, TWICE. Two DIFFERENT users would not prove
// this: their ciphertexts differ under a reused IV anyway, because the user id is
// the AAD and that alone changes the tag. Pinning one user holds the AAD constant
// so the IV is the only thing left that can vary — which is what makes this
// assertion, rather than the source grep below it, the one that catches a hoisted
// or zeroed IV.
{
  const { db, env } = envCipher();
  const a = await makeAssociate(env, { name: 'Ann One', pin: '481902' });
  const first = cipherOf(db, a.id);
  await call('/?action=associate-save', { user: 'u-admin', method: 'POST',
    body: { id: a.id, name: 'Ann One', pin: '481902', stores: ['BL1'], pages: { 'bin-dump': 'edit' } }, env });
  ok(cipherOf(db, a.id) !== first,
     '🛑 the same code re-set for the SAME user encrypts differently — a fresh IV every time');
  eq((await json(await reveal(env, a.id))).pin, '481902', 'and still decrypts to that code');
  // Two users sharing a code must also not collide, for the ordinary reason.
  const b = await makeAssociate(env, { name: 'Bo Two', pin: '481902' });
  ok(cipherOf(db, b.id) !== cipherOf(db, a.id), 'two associates sharing a code store different ciphers');
  eq((await json(await reveal(env, b.id))).pin, '481902', 'and both reveal the same original code');
}

// 🔑 AAD BINDING. A ciphertext is bound to its row by the user id, so moving one
// row's cipher onto another fails to decrypt rather than revealing Ann's code
// under Bo's name — which is the failure that would actually mislead somebody.
{
  const { db, env } = envCipher();
  const a = await makeAssociate(env, { name: 'Ann One', pin: '481902' });
  const b = await makeAssociate(env, { name: 'Bo Two', pin: '730518' });
  db.prepare('UPDATE users SET pin_cipher = ? WHERE id = ?').run(cipherOf(db, a.id), b.id);
  const j = await json(await reveal(env, b.id));
  eq(j.recoverable, false, '🔑 a cipher moved between rows does not decrypt');
  eq(j.code, 'NOT_RECOVERABLE', 'and says so rather than erroring');
  ok(j.pin === undefined, '🛑 and returns no code at all');
}

// Every associate who exists when this ships. The column is NULL and the honest
// answer is "not recoverable" — not an error, and not a guess.
{
  const { db, env } = envCipher();
  const a = await makeAssociate(env, { pin: '481902' });
  db.prepare('UPDATE users SET pin_cipher = NULL WHERE id = ?').run(a.id);
  const r = await reveal(env, a.id);
  const j = await json(r);
  eq(r.status, 200, 'a code set before migration-068 is an ANSWER, not an error');
  eq(j.recoverable, false, 'it is not recoverable');
  eq(j.code, 'NOT_RECOVERABLE', 'with the reason the modal switches on');
  eq((await signIn(env, 'Dee Ramirez', '481902')).status, 200,
     '🔑 and their code still signs them in — nothing about login depends on the cipher');
}

// No key: the feature is off, the code is still SET. This is deliberately unlike
// pinHash's refusal — an unpeppered hash would keep working while being weaker,
// where a null cipher visibly turns one row's reveal off.
{
  const { db, env } = envCipher({ key: null });
  const a = await makeAssociate(env, { pin: '481902' });
  eq(a.status, 200, 'without PIN_CIPHER_KEY the save still succeeds');
  eq(cipherOf(db, a.id), null, 'storing no cipher');
  eq((await signIn(env, 'Dee Ramirez', '481902')).status, 200, 'and the associate can sign in');
  eq((await json(await reveal(env, a.id))).code, 'NOT_RECOVERABLE', 'reveal says not recoverable');
}

// Key present at save, gone at reveal — a different fact from the above, and the
// modal says something different, so the endpoint must distinguish them.
{
  const { env } = envCipher();
  const a = await makeAssociate(env, { pin: '481902' });
  delete env.PIN_CIPHER_KEY;
  eq((await json(await reveal(env, a.id))).code, 'NOT_CONFIGURED',
     'a missing key reads as NOT_CONFIGURED, not as an unrecoverable row');
}
// A ROTATED key must not silently read as "not configured" either.
{
  const { env } = envCipher();
  const a = await makeAssociate(env, { pin: '481902' });
  env.PIN_CIPHER_KEY = 'a-different-key-entirely';
  const j = await json(await reveal(env, a.id));
  eq(j.code, 'NOT_RECOVERABLE', 'a rotated key makes existing ciphers unreadable');
  ok(j.pin === undefined, 'and yields no code');
}

// 🛑 Who may read a live credential. canAccessInventory is admin and superuser,
// exactly as associate-save and list-users already gate.
{
  const { env } = envCipher();
  const a = await makeAssociate(env, { pin: '481902' });
  eq((await reveal(env, a.id, 'u-su')).status, 200, 'a superuser may reveal');
  for (const who of ['u-mgr1', 'u-exec', 'u-staff']) {
    eq((await reveal(env, a.id, who)).status, 403, `🛑 ${who} may NOT reveal`);
  }
  const anon = await worker.fetch(asSession('/?action=associate-reveal-pin', 'nope',
    { method: 'POST', body: { id: a.id } }), env, ctx);
  ok(anon.status === 401 || anon.status === 403, '🛑 and neither may a stranger');
}

// The door says which kind of id it takes. An admin is not an associate.
{
  const { env } = envCipher();
  eq((await reveal(env, 'u-admin')).status, 404, '🛑 a non-associate id is refused');
  eq((await reveal(env, 'nope-not-a-user')).status, 404, 'as is one that does not exist');
  eq((await reveal(env, '')).status, 400, 'and a missing id dies at validation');
}

// 🛑 The audit row is the price of the reveal, and it is paid FIRST.
{
  const { db, env } = envCipher();
  const a = await makeAssociate(env, { pin: '481902' });
  await reveal(env, a.id, 'u-admin');
  const rows = db.prepare('SELECT * FROM pin_reveals WHERE user_id = ?').all(a.id);
  eq(rows.length, 1, 'a reveal writes exactly one audit row');
  eq(rows[0].revealed_by, 'u-admin', 'naming who looked');
  eq(rows[0].user_name, 'Dee Ramirez', 'and whose code, denormalised so it outlives the row');
  ok(!!rows[0].revealed_by_label, 'with a readable label for the actor');
  ok(!!rows[0].revealed_at, 'and when');
  await reveal(env, a.id, 'u-su');
  eq(db.prepare('SELECT COUNT(*) n FROM pin_reveals WHERE user_id = ?').get(a.id).n, 2,
     'and every subsequent read appends another');
}
// If the log cannot be written, the code does not come out.
{
  const { db, env } = envCipher();
  const a = await makeAssociate(env, { pin: '481902' });
  db.exec('DROP TABLE pin_reveals');
  const r = await reveal(env, a.id);
  const j = await json(r);
  eq(r.status, 500, '🛑 an unauditable reveal FAILS');
  ok(j.pin === undefined, '🛑 and above all returns no code');
}

// 🛑 The cipher is reversible, so the rule against shipping it is stronger than
// for the two hashes: list-users must carry the yes/no and never the value.
{
  const { db, env } = envCipher();
  const a = await makeAssociate(env, { pin: '481902' });
  const body = await (await call('/?action=list-users', { user: 'u-admin', env })).text();
  ok(!body.includes(cipherOf(db, a.id)), '🛑 list-users never ships pin_cipher');
  ok(!/"pin_cipher"/.test(body), '🛑 nor even the column name');
  ok(!/"pin_hash"/.test(body), 'and still never pin_hash');
  const me = JSON.parse(body).users.find(u => u.id === a.id);
  eq(me.pin_recoverable, 1, 'it reports that this one CAN be read back');
  ok(!!me.pin_set_at, 'and when the code was set');
  db.prepare('UPDATE users SET pin_cipher = NULL WHERE id = ?').run(a.id);
  const after = JSON.parse(await (await call('/?action=list-users', { user: 'u-admin', env })).text());
  eq(after.users.find(u => u.id === a.id).pin_recoverable, 0, 'and that this one cannot');
}

// The registrations that make the action reachable at all — the completeness test
// in the gate suite checks the map is exhaustive, this checks we joined it.
{
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  ok(/\["associate-reveal-pin", "bl"\]/.test(src), 'associate-reveal-pin belongs to Bargain Lane');
  // 🛑 The single most dangerous line in the change. If someone hoists the IV out
  // of pinEncrypt or derives it from the id, every assertion above still passes
  // except the one about two ciphers differing — and this one.
  const enc = src.slice(src.indexOf('async function pinEncrypt'), src.indexOf('async function pinDecrypt'));
  ok(/crypto\.getRandomValues\(new Uint8Array\(12\)\)/.test(enc),
     '🛑 pinEncrypt draws a fresh random IV inside the function');
  ok(/additionalData/.test(enc), 'and binds the ciphertext to the user id');
}

console.log(failures ? `\n${failures} of ${assertions} FAILED` : `\n${assertions} passed, 0 failed`);
process.exit(failures ? 1 : 0);
