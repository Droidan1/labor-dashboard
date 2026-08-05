// Drives the REAL worker.fetch for ?action=auth-me and asserts the `businesses`
// array that the landing picker routes from.
//
// Why this shape: the client decides whether to show the picker from the LENGTH
// of this array, so a bug here is a routing bug — the wrong person sees a picker
// or, worse, the superuser gets stranded. Asserting on a restated copy of
// businessesFor() would prove nothing about the wiring, which is exactly the
// failure this repo already paid for once.
//
// migration-031 is EXECUTED from its own file rather than restated, so the test
// fails if the migration stops seeding what the picker needs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('  FAIL: ' + msg); } };

blockNetwork();
const worker = await loadWorker(repo);

async function authMe(env, user) {
  const res = await worker.fetch(req('/?action=auth-me', { user }), env, ctx);
  return { status: res.status, body: JSON.parse(await res.text()) };
}

// ── 1 · Before migration-031: one business, so NOBODY sees a picker ─────────
{
  const { env } = makeEnv(repo);
  const su = await authMe(env, 'u-su');
  ok(Array.isArray(su.body.businesses), 'superuser: businesses is an array');
  ok(su.body.businesses.length === 1,
     `superuser sees 1 business pre-031, got ${su.body.businesses.length}`);
}

// ── 2 · After migration-031: the real seed ──────────────────────────────────
const { db, env } = makeEnv(repo);
db.exec(fs.readFileSync(path.join(repo, 'migration-031.sql'), 'utf8'));

{
  const r = await authMe(env, 'u-su');
  const biz = r.body.businesses;
  const ids = biz.map(b => b.id).sort();
  ok(r.status === 200, 'superuser auth-me is 200');
  ok(ids.join(',') === 'bl,ecom',
     `superuser (holds ZERO grants) still sees both businesses, got [${ids}]`);

  const bl = biz.find(b => b.id === 'bl');
  const ec = biz.find(b => b.id === 'ecom');
  ok(bl && bl.connected === true, 'Bargain Lane is connected');
  ok(bl && bl.unitCount === 6, `Bargain Lane has 6 units, got ${bl && bl.unitCount}`);
  ok(bl && bl.unitNoun === 'store', 'Bargain Lane unit noun is "store"');
  ok(ec && ec.connected === false, 'E-Commerce is NOT connected');
  ok(ec && ec.unitCount === 0, `E-Commerce has 0 units, got ${ec && ec.unitCount}`);
  ok(ec && ec.unitNoun === 'storefront', 'E-Commerce unit noun is "storefront"');
}

// ── 3 · admin ALSO sees every business (deliberate, Brian 2026-08-05) ───────
// 🛑 This is a widening: `admin` is a per-business role, so this hands an admin
// visibility of a business they hold no grant for. Harmless only while the
// second business is unconnected. If this assertion ever has to change back,
// the branch in businessesFor() is the thing to delete.
{
  const r = await authMe(env, 'u-admin');
  const ids = (r.body.businesses || []).map(b => b.id).sort();
  ok(ids.join(',') === 'bl,ecom',
     `admin sees every business (holds only a bl grant), got [${ids}]`);
}

// ── 4 · Everyone BELOW admin still routes straight past the picker ──────────
// The regression that matters: seeding a second business must NOT change what
// a scoped user sees, or they get an extra click for nothing.
for (const [user, role] of [['u-mgr1','manager'], ['u-mgr2','manager'],
                            ['u-exec','executive']]) {
  const r = await authMe(env, user);
  const ids = (r.body.businesses || []).map(b => b.id);
  ok(ids.length === 1 && ids[0] === 'bl',
     `${role} (${user}) sees ONLY bl -> no picker, got [${ids}]`);
}

// ── 5 · An unconnected business a user IS granted still reports honestly ────
// Guards the case where SellerCloud grants land before its units do.
{
  db.prepare("INSERT INTO user_grants (user_id,business_id,role,units) VALUES ('u-exec','ecom','executive',NULL)").run();
  const r = await authMe(env, 'u-exec');
  const biz = r.body.businesses;
  ok(biz.length === 2, `executive with 2 grants sees 2 businesses, got ${biz.length}`);
  const ec = biz.find(b => b.id === 'ecom');
  ok(ec && ec.connected === false,
     'a granted-but-unconnected business is still connected:false (card stays inert)');
}

// ── 6 · An inactive business disappears entirely ────────────────────────────
{
  db.prepare("UPDATE businesses SET active = 0 WHERE id = 'ecom'").run();
  const r = await authMe(env, 'u-su');
  const ids = (r.body.businesses || []).map(b => b.id);
  ok(ids.length === 1 && ids[0] === 'bl',
     `deactivating a business removes it for the superuser too, got [${ids}]`);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail || pass === 0) process.exit(1);
