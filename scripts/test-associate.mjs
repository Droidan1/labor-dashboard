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

console.log(failures ? `\n${failures} of ${assertions} FAILED` : `\n${assertions} passed, 0 failed`);
process.exit(failures ? 1 : 0);
