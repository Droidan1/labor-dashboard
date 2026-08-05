// Drives the REAL worker.fetch for the grant editor's endpoints.
//
// This is the surface that decides who can hand out access to what, so every
// case here is an authorisation case, not a formatting one. Asserting against a
// restated copy of grantOptionsFor() would prove nothing about the wiring —
// which is the failure this repo has already paid for once.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

blockNetwork();
const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
db.exec(fs.readFileSync(path.join(repo, 'migration-031.sql'), 'utf8'));

const call = async (url, user, body) => {
  const r = await worker.fetch(
    req(url, { user, method: body ? 'POST' : 'GET', body }), env, ctx);
  return { status: r.status, body: JSON.parse(await r.text()) };
};
const grantsOf = (id) =>
  db.prepare('SELECT business_id, role, units FROM user_grants WHERE user_id = ? ORDER BY business_id')
    .all(id).map(r => ({ ...r, units: r.units ? JSON.parse(r.units) : null }));

// ── grant-options reflects the CALLER's own entitlements ────────────────────
{
  const su = await call('/?action=grant-options', 'u-su');
  ok(su.status === 200, 'superuser gets options');
  ok(su.body.businesses.map(b => b.id).sort().join(',') === 'bl,ecom',
     `superuser may grant both businesses, got [${su.body.businesses.map(b => b.id)}]`);
  ok(su.body.roles.join(',') === 'admin,executive,manager,staff',
     `superuser may assign all four roles, got [${su.body.roles}]`);
  const bl = su.body.businesses.find(b => b.id === 'bl');
  ok(bl.units.length === 6, `bl exposes its 6 units, got ${bl.units.length}`);
  ok(su.body.businesses.find(b => b.id === 'ecom').units.length === 0,
     'ecom exposes no units yet');

  // 🔑 "Nobody can grant what they don't hold." The admin holds only bl.
  const ad = await call('/?action=grant-options', 'u-admin');
  ok(ad.body.businesses.map(b => b.id).join(',') === 'bl',
     `admin may grant ONLY bl, got [${ad.body.businesses.map(b => b.id)}]`);
  ok(ad.body.roles.join(',') === 'manager',
     `admin may assign only manager, got [${ad.body.roles}]`);

  const mg = await call('/?action=grant-options', 'u-mgr1');
  ok(mg.status === 403, `manager is refused grant-options, got ${mg.status}`);
}

// ── a superuser may write a multi-business grant ────────────────────────────
{
  const r = await call('/?action=set-user-grants', 'u-su', {
    id: 'u-exec',
    grants: [
      { business_id: 'bl',   role: 'manager',   units: ['BL1', 'BL4'] },
      { business_id: 'ecom', role: 'executive', units: null },
    ],
  });
  ok(r.body.ok === true, `superuser writes 2 grants, got ${JSON.stringify(r.body)}`);
  const g = grantsOf('u-exec');
  ok(g.length === 2, `u-exec now holds 2 grants, got ${g.length}`);
  ok(JSON.stringify(g.find(x => x.business_id === 'bl').units) === '["BL1","BL4"]',
     'bl units stored as picked');
  ok(g.find(x => x.business_id === 'ecom').units === null,
     'ecom units null = every unit');
  ok(g.find(x => x.business_id === 'ecom').role === 'executive',
     'per-business role stored independently');

  // The bl grant mirrors back into the legacy users columns, which
  // allowedStores() still falls back to and the Users list still renders.
  const u = db.prepare('SELECT role, stores FROM users WHERE id = ?').get('u-exec');
  ok(u.role === 'manager', `users.role mirrors the bl grant, got ${u.role}`);
  ok(u.stores === '["BL1","BL4"]', `users.stores mirrors bl units, got ${u.stores}`);
}

// ── omitting a business REVOKES it ──────────────────────────────────────────
{
  await call('/?action=set-user-grants', 'u-su', {
    id: 'u-exec', grants: [{ business_id: 'bl', role: 'manager', units: ['BL1'] }],
  });
  const ids = grantsOf('u-exec').map(g => g.business_id);
  ok(ids.join(',') === 'bl', `omitting ecom revokes it, got [${ids}]`);
}

// ── an admin cannot grant a business they do not hold ───────────────────────
{
  const r = await call('/?action=set-user-grants', 'u-admin', {
    id: 'u-mgr1',
    grants: [{ business_id: 'ecom', role: 'manager', units: null }],
  });
  ok(r.status === 403, `admin granting ecom is refused, got ${r.status}`);
  ok(!grantsOf('u-mgr1').some(g => g.business_id === 'ecom'),
     'and no ecom grant was written');
}

// ── privilege escalation through the grant role ─────────────────────────────
{
  const r = await call('/?action=set-user-grants', 'u-admin', {
    id: 'u-mgr1', grants: [{ business_id: 'bl', role: 'admin', units: null }],
  });
  ok(r.status === 403, `admin cannot assign the admin role, got ${r.status}`);

  for (const who of ['u-su', 'u-admin']) {
    const s = await call('/?action=set-user-grants', who, {
      id: 'u-mgr1', grants: [{ business_id: 'bl', role: 'superuser', units: null }],
    });
    ok(s.status === 403, `${who} cannot assign superuser via a grant, got ${s.status}`);
  }
}

// ── a superuser is not editable through this endpoint ───────────────────────
{
  const a = await call('/?action=set-user-grants', 'u-admin',
    { id: 'u-su', grants: [{ business_id: 'bl', role: 'manager', units: null }] });
  ok(a.status === 403, `admin cannot edit the superuser, got ${a.status}`);
  const s = await call('/?action=set-user-grants', 'u-su',
    { id: 'u-su', grants: [{ business_id: 'bl', role: 'manager', units: null }] });
  ok(s.status === 400, `even a superuser cannot grant-scope a superuser, got ${s.status}`);
  ok(grantsOf('u-su').length === 0, 'the superuser still holds zero grants');
}

// ── units must belong to THAT business ──────────────────────────────────────
{
  const bad = await call('/?action=set-user-grants', 'u-su', {
    id: 'u-mgr2', grants: [{ business_id: 'bl', role: 'manager', units: ['BL1', 'NOPE'] }],
  });
  ok(bad.status === 400, `an unknown unit code is refused, got ${bad.status}`);

  // 🔑 A bl code smuggled into the ecom grant must not widen ecom's scope.
  const cross = await call('/?action=set-user-grants', 'u-su', {
    id: 'u-mgr2', grants: [{ business_id: 'ecom', role: 'manager', units: ['BL1'] }],
  });
  ok(cross.status === 400, `a cross-business unit code is refused, got ${cross.status}`);
}

// ── an admin's write must not wipe a grant they cannot see ──────────────────
// The delete is scoped to businesses the caller may manage. Without that, an
// admin saving a user would silently drop that user's E-Commerce access.
{
  await call('/?action=set-user-grants', 'u-su', {
    id: 'u-mgr2',
    grants: [{ business_id: 'bl', role: 'manager', units: ['BL2'] },
             { business_id: 'ecom', role: 'manager', units: null }],
  });
  ok(grantsOf('u-mgr2').length === 2, 'u-mgr2 holds bl + ecom');

  const r = await call('/?action=set-user-grants', 'u-admin', {
    id: 'u-mgr2', grants: [{ business_id: 'bl', role: 'manager', units: ['BL1'] }],
  });
  ok(r.body.ok === true, `admin may still edit the bl grant, got ${JSON.stringify(r.body)}`);
  const ids = grantsOf('u-mgr2').map(g => g.business_id).sort();
  ok(ids.join(',') === 'bl,ecom',
     `admin's save PRESERVES the ecom grant they cannot see, got [${ids}]`);
}

// ── conferring a BUSINESS is superuser-only ────────────────────────────────
// An admin may change role/units inside a business the person already holds —
// that is an admin's job — but may not add them to a business or remove them
// from one. Without this, the admins who hold an `ecom` grant could pass
// E-Commerce on to anyone.
{
  // u-mgr1 currently holds bl only.
  const before = grantsOf('u-mgr1').map(g => g.business_id).sort();
  ok(before.join(',') === 'bl', `precondition: u-mgr1 holds bl only, got [${before}]`);

  // Admin may still edit WITHIN bl.
  const within = await call('/?action=set-user-grants', 'u-admin', {
    id: 'u-mgr1', grants: [{ business_id: 'bl', role: 'manager', units: ['BL8'] }],
  });
  ok(within.body.ok === true, `admin may re-scope units inside bl, got ${JSON.stringify(within.body)}`);
  ok(JSON.stringify(grantsOf('u-mgr1')[0].units) === '["BL8"]', 'and the units actually changed');

  // Admin may NOT remove them from bl.
  const remove = await call('/?action=set-user-grants', 'u-admin', { id: 'u-mgr1', grants: [] });
  ok(remove.status === 403, `admin cannot remove a business, got ${remove.status}`);
  ok(grantsOf('u-mgr1').length === 1, 'and the bl grant survives');

  // Superuser adds ecom.
  await call('/?action=set-user-grants', 'u-su', {
    id: 'u-mgr1',
    grants: [{ business_id: 'bl', role: 'manager', units: ['BL8'] },
             { business_id: 'ecom', role: 'manager', units: null }],
  });
  ok(grantsOf('u-mgr1').length === 2, 'superuser CAN add a business');

  // CASE A — the admin CANNOT see ecom (they hold no ecom grant). Omitting it
  // is legitimate, so the write is allowed and the SCOPED DELETE is what keeps
  // ecom alive. Treating the omission as a removal would lock this admin out of
  // editing the user at all.
  const blind = await call('/?action=set-user-grants', 'u-admin', {
    id: 'u-mgr1', grants: [{ business_id: 'bl', role: 'manager', units: ['BL8'] }],
  });
  ok(blind.body.ok === true, `admin blind to ecom may still save, got ${JSON.stringify(blind.body)}`);
  ok(grantsOf('u-mgr1').map(g => g.business_id).sort().join(',') === 'bl,ecom',
     'and the invisible ecom grant survives via the scoped delete');

  // CASE B — PRODUCTION's shape: the admin DOES hold ecom, so it is visible and
  // dropping it is a real removal attempt. This is the case Brian asked to close.
  db.prepare("INSERT INTO user_grants (user_id,business_id,role,units) VALUES ('u-admin','ecom','admin',NULL)").run();
  const strip = await call('/?action=set-user-grants', 'u-admin', {
    id: 'u-mgr1', grants: [{ business_id: 'bl', role: 'manager', units: ['BL8'] }],
  });
  ok(strip.status === 403, `admin holding ecom cannot strip it from someone, got ${strip.status}`);

  // u-staff holds bl only and has not been touched, so this is a real addition.
  ok(grantsOf('u-staff').map(g => g.business_id).join(',') === 'bl',
     'precondition: u-staff holds bl only');
  const add = await call('/?action=set-user-grants', 'u-admin', {
    id: 'u-staff', grants: [{ business_id: 'bl', role: 'manager', units: ['BL1'] },
                            { business_id: 'ecom', role: 'manager', units: null }],
  });
  ok(add.status === 403, `admin cannot ADD ecom to someone, got ${add.status}`);
  ok(grantsOf('u-staff').map(g => g.business_id).join(',') === 'bl',
     'and u-staff still holds bl only');
  ok(grantsOf('u-mgr1').map(g => g.business_id).sort().join(',') === 'bl,ecom',
     'both grants still intact after the refused attempts');
}

// ── reading one user's grants ───────────────────────────────────────────────
{
  const r = await call('/?action=user-grants&id=u-mgr2', 'u-su');
  ok(r.status === 200 && Array.isArray(r.body.grants), 'user-grants returns an array');
  const m = await call('/?action=user-grants&id=u-mgr2', 'u-mgr1');
  ok(m.status === 403, `a manager cannot read another user's grants, got ${m.status}`);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail || pass === 0) process.exit(1);
