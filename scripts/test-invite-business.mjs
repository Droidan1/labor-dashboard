// Inviting a user INTO A CHOSEN BUSINESS, driven through the real endpoint.
//
// Before this, `invite-user` called upsertBargainLaneGrant() unconditionally.
// Every invited person came out holding Bargain Lane — its dashboard, inventory
// and sales — whatever they were actually hired to do. An E-Commerce-only person
// then needed a second, easily-forgotten trip to the grant editor to untick it.
// That failed OPEN, which is the wrong direction for a permissions default.
//
// 🛑 The rule that matters here is the same one set-user-grants enforces:
// NOBODY CAN GRANT WHAT THEY DON'T HOLD. An admin who holds only Bargain Lane
// must not be able to mint an E-Commerce user by posting business_id himself.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

blockNetwork();
// sendInviteEmail() calls Resend unconditionally — it does not guard on
// RESEND_API_KEY — so with the harness blocking egress the endpoint 500s AFTER
// writing the user, the grant and the magic link. Allow just that one call
// through as a no-op so these assertions test the invite logic rather than the
// mailer. (The partial-state behaviour on a real send failure is pre-existing
// and unrelated to business selection.)
const blocked = globalThis.fetch;
globalThis.fetch = async (u, init) => {
  if (String(u).includes('api.resend.com')) {
    return new Response(JSON.stringify({ id: 'stub' }), { status: 200 });
  }
  return blocked(u, init);
};
const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
for (const f of ['migration-031.sql', 'migration-033.sql']) {
  db.exec(fs.readFileSync(path.join(repo, f), 'utf8'));
}

const invite = async (user, body) => {
  const r = await worker.fetch(req('/?action=invite-user', { user, method: 'POST', body }), env, ctx);
  return { status: r.status, body: JSON.parse(await r.text()) };
};
const userRow = (email) => db.prepare("SELECT id, role, stores FROM users WHERE email = ?").get(email);
const grantsOf = (email) => {
  const u = userRow(email);
  if (!u) return [];
  return db.prepare("SELECT business_id, role, units FROM user_grants WHERE user_id = ? ORDER BY business_id")
    .all(u.id).map(g => `${g.business_id}:${g.role}:${g.units === null ? 'ALL' : g.units}`);
};

// ── Default is unchanged: no business_id behaves exactly as before ─────────
// Every existing caller (and the modal, when only one business is grantable)
// omits the field. That path must not move.
{
  const r = await invite('u-su', { email: 'bl-only@x.com', role: 'manager', stores: ['BL1'] });
  ok(r.status === 200, `invite without business_id succeeds, got ${r.status}`);
  ok(grantsOf('bl-only@x.com').join() === 'bl:manager:["BL1"]',
     `defaults to a Bargain Lane grant, got [${grantsOf('bl-only@x.com')}]`);
  ok(userRow('bl-only@x.com').stores === '["BL1"]', 'users.stores still carries the BL scope');
}

// ── 🔑 THE POINT: an E-Commerce invite grants ONLY E-Commerce ─────────────
{
  const r = await invite('u-su', { email: 'ecom-only@x.com', role: 'manager', business_id: 'ecom' });
  ok(r.status === 200, `ecom invite succeeds, got ${r.status} ${JSON.stringify(r.body)}`);
  const g = grantsOf('ecom-only@x.com');
  ok(g.join() === 'ecom:manager:ALL', `exactly one ecom grant, units ALL — got [${g}]`);
  ok(!g.some(x => x.startsWith('bl:')),
     `🔑 NO Bargain Lane grant is created — got [${g}]`);
  // users.stores is Bargain Lane's legacy column; allowedUnits only reads it for
  // 'bl', so leaving it NULL is what makes the BL fallback fail closed.
  ok(userRow('ecom-only@x.com').stores === null,
     `users.stores stays NULL for a non-bl invite, got ${userRow('ecom-only@x.com').stores}`);
}

// ── ...and that person is refused Bargain Lane end to end ────────────────
{
  const u = userRow('ecom-only@x.com');
  db.prepare("INSERT INTO sessions (id,user_id,expires_at,created_at) VALUES (?,?,?,?)")
    .run('sess-ecomonly', u.id, new Date(Date.now() + 3600e3).toISOString(), '2026-01-01');
  const r = await worker.fetch(new Request('https://api.retjghub.com/?action=inventory-items', {
    headers: { Cookie: 'session=sess-ecomonly' } }), env, ctx);
  ok(r.status === 403, `an ecom-only invitee is refused a Bargain Lane action, got ${r.status}`);
}

// ── 🛑 Nobody can grant what they don't hold ─────────────────────────────
// u-admin holds bl (harness) + ecom (migration-033). Strip the ecom grant and
// he must no longer be able to mint an ecom user, however he posts.
{
  db.prepare("DELETE FROM user_grants WHERE user_id='u-admin' AND business_id='ecom'").run();
  const r = await invite('u-admin', { email: 'sneaky@x.com', role: 'manager', business_id: 'ecom' });
  ok(r.status === 403,
     `🛑 an admin without ecom cannot invite into ecom, got ${r.status}`);
  ok(!userRow('sneaky@x.com'), 'and no user row is created at all');

  // Same caller, a business he DOES hold, still works — the guard is scoped, not blanket.
  const ok2 = await invite('u-admin', { email: 'fine@x.com', role: 'manager', stores: ['BL1'] });
  ok(ok2.status === 200, `the same admin can still invite into Bargain Lane, got ${ok2.status}`);
}

// ── An unknown business is refused ───────────────────────────────────────
{
  const r = await invite('u-su', { email: 'nope@x.com', role: 'manager', business_id: 'not-a-business' });
  ok(r.status === 403, `an unknown business_id is refused, got ${r.status}`);
  ok(!userRow('nope@x.com'), 'no user row is created');
}

// ── Stores sent alongside a non-bl business are ignored, not stored ──────
// A client that forgets to clear the picker must not write BL store codes into
// a grant for a business where they mean nothing.
{
  const r = await invite('u-su', { email: 'mixed@x.com', role: 'manager', business_id: 'ecom', stores: ['BL1', 'BL2'] });
  ok(r.status === 200, `invite succeeds, got ${r.status}`);
  ok(grantsOf('mixed@x.com').join() === 'ecom:manager:ALL',
     `BL store codes do not leak into the ecom grant, got [${grantsOf('mixed@x.com')}]`);
  ok(userRow('mixed@x.com').stores === null, 'and users.stores stays NULL');
}

// ── The role rules are unchanged ─────────────────────────────────────────
{
  const r = await invite('u-admin', { email: 'adm@x.com', role: 'admin', stores: ['BL1'] });
  ok(r.status === 400, `a non-superuser still cannot invite an admin, got ${r.status}`);
}

// ── grant-options is the list the modal draws from ───────────────────────
// The modal must never offer what this refuses; asserting they agree is what
// keeps the two from drifting.
{
  const su = await worker.fetch(req('/?action=grant-options', { user: 'u-su' }), env, ctx);
  const ids = (JSON.parse(await su.text()).businesses || []).map(b => b.id).sort();
  ok(ids.join() === 'bl,ecom', `superuser may grant both, got [${ids}]`);

  const ad = await worker.fetch(req('/?action=grant-options', { user: 'u-admin' }), env, ctx);
  const adIds = (JSON.parse(await ad.text()).businesses || []).map(b => b.id).sort();
  ok(adIds.join() === 'bl', `the ecom-stripped admin is offered only bl, got [${adIds}]`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
