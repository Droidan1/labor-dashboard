// Admin › People and the announcement audience (2026-11-19, phase 2), driven through the REAL
// worker.fetch against real sqlite.
//
//   1. list-users is no longer gated to Bargain Lane, and cuts its answer to the caller
//      (Brian: "their businesses"): the superuser sees everyone and every grant; an admin sees
//      people holding a grant in a business they may grant — with only those grants — plus
//      people with no grant yet, associates only with Bargain Lane, and never a superuser.
//      Bargain Lane-only fields (stores, pages) are blank for a caller without Bargain Lane.
//   3. invite-user and update-user are off the Bargain Lane gate too: an admin of any business
//      invites into, and suspends people wholly in, their own businesses; a role (which writes the
//      Bargain Lane grant) is the superuser's alone; resend-invite reaches only people they see;
//   2. announcement-set takes an audience — "all" (the whole hub) or a list of active businesses
//      — and refuses anything else rather than widening it; GET sends an announcement only to
//      people who can reach one of its businesses. A blob from before the field still goes to all.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, ctx, req, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : `  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`}`);

blockNetwork();
const worker = await loadWorker(repo);
const call = (url, opts = {}) => worker.fetch(req(url, opts), opts.env, ctx);
const json = async (r) => { try { return await r.json(); } catch { return {}; } };

function world() {
  const { db, env } = makeEnv(repo);
  db.exec(fs.readFileSync(path.join(repo, 'migration-058.sql'), 'utf8'));
  applyMigrationAlters(db, repo);
  db.prepare("INSERT INTO businesses (id,name,unit_noun,source,active) VALUES ('ecom','E-Commerce','storefront','sellercloud',1)").run();
  db.prepare("INSERT INTO businesses (id,name,unit_noun,source,active) VALUES ('live','Live Sales','store','whatnot+auction',1)").run();
  db.prepare("INSERT INTO businesses (id,name,unit_noun,source,active) VALUES ('old','Closed Co','store','x',0)").run();
  const user = db.prepare('INSERT INTO users (id,email,role,stores,status,created_at) VALUES (?,?,?,?,?,?)');
  const grant = db.prepare('INSERT INTO user_grants (user_id,business_id,role,units) VALUES (?,?,?,?)');
  const sess = db.prepare('INSERT INTO sessions (id,user_id,expires_at,created_at) VALUES (?,?,?,?)');
  const exp = new Date(Date.now() + 3600e3).toISOString();
  const add = (id, role, stores, grants) => {
    user.run(id, id + '@example.com', role, stores, 'active', '2026-11-01');
    for (const [b, r, u] of grants) grant.run(id, b, r, u);
    sess.run('sess-' + id, id, exp, exp);
  };
  add('u-ecomadmin', 'admin', null, [['ecom', 'admin', null]]);
  add('u-ecomstaff', 'staff', null, [['ecom', 'staff', '["SC163"]']]);
  add('u-both', 'manager', '["BL2"]', [['bl', 'manager', '["BL2"]'], ['live', 'manager', '["live-BL2"]']]);
  add('u-none', 'manager', null, []);
  add('u-oldonly', 'manager', null, [['old', 'manager', null]]);
  add('u-corrupt', 'manager', null, [['bl', 'manager', '{not json']]);
  // An associate, the way associate-save leaves one: a pin hash, pages, and a Bargain Lane staff grant.
  add('u-assoc', 'staff', '["BL1"]', [['bl', 'staff', '["BL1"]']]);
  db.prepare("UPDATE users SET name = 'Dee Ramirez', pin_hash = 'x', pages = ? WHERE id = 'u-assoc'").run('{"bin-dump":"edit"}');
  return { db, env };
}

// ── 1. list-users ──────────────────────────────────────────────────────────
console.log('list-users');
{
  const { env } = world();
  const list = async (who) => { const r = await call('/?action=list-users', { user: who, env }); return { status: r.status, users: (await json(r)).users || [] }; };
  const ids = (us) => us.map(u => u.id).sort();
  const grantsOf = (us, id) => (us.find(u => u.id === id) || {}).grants;

  const su = await list('u-su');
  eq(su.status, 200, 'the superuser can list users');
  eq(ids(su.users), ['u-admin', 'u-assoc', 'u-both', 'u-corrupt', 'u-ecomadmin', 'u-ecomstaff', 'u-exec', 'u-mgr1', 'u-mgr2', 'u-none', 'u-oldonly', 'u-staff', 'u-su'],
    '…and sees every account, superuser included');
  eq(grantsOf(su.users, 'u-both'), [{ business_id: 'bl', role: 'manager', units: ['BL2'] }, { business_id: 'live', role: 'manager', units: ['live-BL2'] }],
    '…with every grant, units parsed');
  eq(grantsOf(su.users, 'u-oldonly'), [], 'a grant in an inactive business is not shown');
  eq(grantsOf(su.users, 'u-corrupt'), [{ business_id: 'bl', role: 'manager', units: [] }], '🛑 unreadable units fail CLOSED to no stores, never to every store');
  eq(grantsOf(su.users, 'u-su'), [], 'the superuser holds no grant rows, by design');

  const bl = await list('u-admin');
  eq(bl.status, 200, 'a Bargain Lane admin can list users');
  eq(ids(bl.users), ['u-admin', 'u-assoc', 'u-both', 'u-corrupt', 'u-exec', 'u-mgr1', 'u-mgr2', 'u-none', 'u-oldonly', 'u-staff'],
    '…and sees Bargain Lane people, associates, and people with no live grant — not E-Commerce-only people or the superuser');
  eq(grantsOf(bl.users, 'u-both'), [{ business_id: 'bl', role: 'manager', units: ['BL2'] }], "…with only the Bargain Lane half of someone's access");
  eq((bl.users.find(u => u.id === 'u-assoc') || {}).pages, '{"bin-dump":"edit"}', "…and an associate's pages");

  const ec = await list('u-ecomadmin');
  eq(ec.status, 200, '🔑 an E-Commerce-only admin is no longer refused (the Bargain Lane gate is gone)');
  eq(ids(ec.users), ['u-ecomadmin', 'u-ecomstaff', 'u-none', 'u-oldonly'],
    '…and sees only E-Commerce people and people with no live grant: no associates, no Bargain Lane staff, no superuser');
  eq(grantsOf(ec.users, 'u-ecomstaff'), [{ business_id: 'ecom', role: 'staff', units: ['SC163'] }], '…with their E-Commerce grant');
  ok(ec.users.every(u => u.stores === null && u.pages === null), '🛑 Bargain Lane fields (stores, pages) are blank for a caller without Bargain Lane');
  const raw = await (await call('/?action=list-users', { user: 'u-ecomadmin', env })).text();
  ok(!/"BL\d+"|bin-dump|Dee Ramirez/.test(raw), '🛑 no Bargain Lane store, page or associate name anywhere in their answer');

  eq((await list('u-mgr1')).status, 403, 'a manager still cannot list users');
  eq((await list('u-exec')).status, 403, 'nor can an executive');
}

// ── 2. The announcement audience ───────────────────────────────────────────
console.log('\nannouncement audience');
{
  const { env } = world();
  const set = (body, who = 'u-su') => call('/?action=announcement-set', { user: who, method: 'POST', body, env });
  const seen = async (who) => (await json(await call('/?action=announcement', { user: who, env }))).announcement;
  const ITEMS = [{ t: 'Admin moved', d: 'It is on the Hub page now' }];

  let r = await set({ title: 'Hub-wide', items: ITEMS });
  eq(r.status, 200, 'a push with no audience (an older page) is accepted');
  eq((await json(r)).announcement.audience, 'all', '…and saved for the whole hub');
  ok((await seen('u-mgr1'))?.title === 'Hub-wide' && (await seen('u-ecomstaff'))?.title === 'Hub-wide', '…so a Bargain Lane manager and an E-Commerce staffer both get it');

  r = await set({ title: 'Whole hub', items: ITEMS, audience: 'all' });
  eq((await json(r)).announcement.audience, 'all', '"all" is the whole hub');

  r = await set({ title: 'E-Commerce only', items: ITEMS, audience: ['ecom'] });
  eq(r.status, 200, 'a push to one business is accepted');
  eq((await json(r)).announcement.audience, ['ecom'], '…and saved with that business');
  eq((await seen('u-ecomstaff'))?.title, 'E-Commerce only', 'someone in E-Commerce gets it');
  eq(await seen('u-mgr1'), null, '…a Bargain Lane-only manager does not');
  eq(await seen('u-none'), null, '…nor does someone with no access');
  eq((await seen('u-su'))?.title, 'E-Commerce only', '…and the superuser always sees it, to edit it');

  await set({ title: 'Stores + live', items: ITEMS, audience: ['bl', 'live', 'bl'] });
  eq((await seen('u-assoc'))?.title, 'Stores + live', 'an associate (a Bargain Lane staff grant) gets a Bargain Lane announcement');
  eq((await seen('u-both'))?.title, 'Stores + live', 'someone in either business gets it');
  eq(await seen('u-ecomstaff'), null, '…and E-Commerce does not');
  eq((await json(await call('/?action=announcement', { user: 'u-su', env }))).announcement.audience, ['bl', 'live'], 'a business picked twice is saved once');

  for (const [aud, why] of [[[], 'an empty list'], [['nope'], 'an unknown business'], [['old'], 'an inactive business'], ['bl', 'a bare string'], [{ bl: true }, 'an object']]) {
    r = await set({ title: 'Bad', items: ITEMS, audience: aud });
    eq(r.status, 400, `🛑 ${why} is refused, not widened to the whole hub`);
  }
  eq((await seen('u-assoc'))?.title, 'Stores + live', '…and a refused push leaves the current announcement alone');

  eq((await set({ title: 'Nope', items: ITEMS, audience: 'all' }, 'u-admin')).status, 403, 'only the superuser can push');

  // A blob written before the field existed.
  await env.SALES_SNAPSHOTS.put('announcement:current', JSON.stringify({ id: '1', title: 'Legacy', items: ITEMS }));
  ok((await seen('u-ecomstaff'))?.title === 'Legacy' && (await seen('u-mgr1'))?.title === 'Legacy', 'an announcement saved before audiences still goes to everyone');
}

// ── 3. Managing people from any business (2026-11-19) ──────────────────────
console.log('\ninvite, suspend, resend — from any business');
{
  const { db, env } = world();
  const post = (action, who, body) => call(`/?action=${action}`, { user: who, method: 'POST', body, env });
  const statusOf = (id) => db.prepare('SELECT status FROM users WHERE id = ?').get(id).status;
  const grantsOf = (email) => db.prepare('SELECT g.business_id b FROM user_grants g JOIN users u ON u.id = g.user_id WHERE u.email = ? ORDER BY b').all(email).map(r => r.b);

  // invite-user: off the Bargain Lane gate, still only into the caller's businesses.
  let r = await post('invite-user', 'u-ecomadmin', { email: 'New.Lister@example.com', role: 'manager', grants: [{ business_id: 'ecom', units: null }] });
  eq(r.status, 200, '🔑 an E-Commerce-only admin can invite into E-Commerce (the Bargain Lane gate is gone)');
  eq(grantsOf('new.lister@example.com'), ['ecom'], '…and the new person holds E-Commerce and nothing else');
  r = await post('invite-user', 'u-ecomadmin', { email: 'sneak@example.com', role: 'manager', grants: [{ business_id: 'bl', units: ['BL1'] }] });
  eq(r.status, 403, '🛑 …but cannot invite anyone into Bargain Lane');
  r = await post('invite-user', 'u-ecomadmin', { email: 'sneak2@example.com', role: 'manager', stores: ['BL1'] });
  eq(r.status, 403, '🛑 …not even through the old one-business body, which means Bargain Lane');
  r = await post('invite-user', 'u-ecomadmin', { email: 'boss@example.com', role: 'admin', grants: [{ business_id: 'ecom', units: null }] });
  eq(r.status, 400, '🛑 …nor make an admin');
  r = await post('invite-user', 'u-admin', { email: 'cross@example.com', role: 'manager', grants: [{ business_id: 'ecom', units: null }] });
  eq(r.status, 403, '🛑 a Bargain Lane admin cannot invite into E-Commerce');
  eq(db.prepare("SELECT COUNT(*) n FROM users WHERE email IN ('sneak@example.com','sneak2@example.com','boss@example.com','cross@example.com')").get().n, 0,
    '…and a refused invite writes no account');

  // update-user: status, on someone wholly in the caller's businesses.
  eq((await post('update-user', 'u-admin', { id: 'u-mgr1', status: 'suspended' })).status, 200, 'a Bargain Lane admin can suspend a Bargain Lane manager');
  eq(statusOf('u-mgr1'), 'suspended', '…and they are suspended');
  r = await post('update-user', 'u-admin', { id: 'u-both', status: 'suspended' });
  eq([r.status, (await json(r)).code], [403, 'NOT_ALL_YOURS'],
    '🛑 …but not someone who also works in Live Sales, which they do not run (Brian: "all access in their businesses")');
  eq(statusOf('u-both'), 'active', '…who stays active');
  eq((await post('update-user', 'u-admin', { id: 'u-both', status: 'active' })).status, 200,
    '🔑 …while an UNCHANGED status still saves (the page before this sent it with every grants edit)');
  eq((await post('update-user', 'u-ecomadmin', { id: 'u-mgr1', status: 'suspended' })).status, 403,
    '🛑 and someone the caller cannot even see is refused whatever the status');
  eq((await post('update-user', 'u-su', { id: 'u-both', status: 'suspended' })).status, 200, 'the superuser can');
  eq((await post('update-user', 'u-ecomadmin', { id: 'u-ecomstaff', status: 'suspended' })).status, 200, '🔑 an E-Commerce admin can suspend their own staffer');
  eq((await post('update-user', 'u-ecomadmin', { id: 'u-mgr2', status: 'suspended' })).status, 403, '🛑 …and not a Bargain Lane manager');
  eq(statusOf('u-mgr2'), 'active', '…who stays active');
  eq((await post('update-user', 'u-ecomadmin', { id: 'u-none', status: 'suspended' })).status, 200, 'anyone with no access yet can be suspended by any admin');
  eq((await post('update-user', 'u-admin', { id: 'u-su', status: 'suspended' })).status, 403, '🛑 nobody but the superuser touches the superuser');
  eq((await post('update-user', 'u-admin', { id: 'u-assoc', status: 'suspended' })).status, 400, 'an associate is managed from Associates');
  eq((await post('update-user', 'u-admin', { id: 'u-mgr1', status: 'deleted' })).status, 400, 'an unknown status is refused');
  eq((await post('update-user', 'u-admin', { id: 'nobody', status: 'active' })).status, 404, 'an unknown person is not found');

  // 🛑 The hole: a role sent here wrote a Bargain Lane grant, adding someone to Bargain Lane.
  r = await post('update-user', 'u-admin', { id: 'u-ecomstaff', role: 'manager' });
  eq([r.status, (await json(r)).code], [403, 'USE_GRANTS'], '🛑 an admin can no longer change a role here');
  eq(grantsOf('u-ecomstaff@example.com'), ['ecom'], '🛑 …so an E-Commerce staffer cannot be slipped into Bargain Lane');
  eq((await post('update-user', 'u-admin', { id: 'u-mgr2', stores: ['BL1', 'BL2'] })).status, 403, '🛑 …nor stores');

  // resend-invite: only to someone the caller can see.
  const links = (email) => db.prepare('SELECT COUNT(*) n FROM magic_links WHERE email = ?').get(email).n;
  r = await post('resend-invite', 'u-ecomadmin', { email: 'u-mgr2@example.com' });
  eq([r.status, links('u-mgr2@example.com')], [404, 0], '🛑 an E-Commerce admin cannot mail a Bargain Lane manager a sign-in link');
  db.prepare("UPDATE users SET status = 'active' WHERE id = 'u-ecomstaff'").run();
  r = await post('resend-invite', 'u-ecomadmin', { email: 'u-ecomstaff@example.com' });
  ok(r.status !== 403 && r.status !== 404 && links('u-ecomstaff@example.com') === 1, `…but can resend one to their own staffer (${r.status}: link written, the harness has no mailer)`);
  r = await post('resend-invite', 'u-admin', { email: 'u-ecomstaff@example.com' });
  eq(r.status, 404, '🛑 and a Bargain Lane admin cannot mail an E-Commerce staffer');

  // list-users says, yes/no, when someone has access the caller cannot see.
  const rows = async (who) => (await json(await call('/?action=list-users', { user: who, env }))).users;
  const bl = await rows('u-admin');
  eq(['u-both', 'u-mgr2', 'u-none'].map(id => bl.find(u => u.id === id).elsewhere), [true, false, false],
    'a Bargain Lane admin is told u-both has access elsewhere, and nobody else');
  ok(!JSON.stringify(bl.find(u => u.id === 'u-both')).includes('live'), '…without being told where');
  ok((await rows('u-su')).every(u => u.elsewhere === undefined), 'the superuser sees everything, so is never told');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
