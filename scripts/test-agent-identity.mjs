// ?action=agent-identity — who an email is, for retjg-mcp's OAuth sign-in.
//
// WHAT THIS PROTECTS. retjg-mcp lets owners and admins connect ChatGPT/Claude by
// signing in with RETJG HUB, and re-checks them at every hourly token refresh with
// this lookup. If it says "admin, every store" for someone who is not, an agent gets
// chain-wide financials it should not; if it leaks anything beyond the six facts the
// check needs, a key holder learns more about accounts than they should.
//
// It sits behind the reporting key gate (MORNING_BRIEFING_KEY), like the other
// reporting actions, and answers from the same allowedStores()/canAccessBusiness()
// the session path uses, so it cannot disagree with what the app would let them see.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const KEY = 'test-briefing-key';
const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
env.MORNING_BRIEFING_KEY = KEY;
blockNetwork();

const ask = (email, { key = KEY, method = 'GET' } = {}) => worker.fetch(new Request(
  'https://api.retjghub.com/?action=agent-identity' + (email == null ? '' : '&email=' + encodeURIComponent(email)),
  { method, headers: key ? { 'X-API-Key': key } : {} }), env, ctx);
const body = async (r) => JSON.parse(await r.text());

// ── The gate ───────────────────────────────────────────────────────────────
eq((await ask('bhoward@bargainlane.com', { key: null })).status, 401, 'no key → 401');
eq((await ask('bhoward@bargainlane.com', { key: 'wrong' })).status, 401, 'wrong key → 401');
eq((await ask('bhoward@bargainlane.com', { method: 'POST' })).status, 405, 'POST → 405');
eq((await ask(null)).status, 400, 'no email → 400');
eq((await ask('not-an-email')).status, 400, 'an email without @ → 400');

// ── Who each account is ────────────────────────────────────────────────────
const KEYS = ['email', 'found', 'id', 'role', 'active', 'associate', 'stores', 'bargainLane'];
{
  const r = await ask('  BHoward@BargainLane.com ');
  const b = await body(r);
  eq(r.status, 200, 'superuser → 200');
  eq(Object.keys(b), KEYS, 'exactly the facts the check needs, nothing else');
  eq([b.found, b.id, b.role, b.active, b.associate, b.stores, b.bargainLane], [true, 'u-su', 'superuser', true, false, null, true],
    'superuser: every store, Bargain Lane (email matched case- and space-insensitively)');
  eq(r.headers.get('Cache-Control'), 'no-store', 'never cached: a demotion must show at the next refresh');
}
{
  const b = await body(await ask('bgeorges@retjg.com'));
  eq([b.role, b.stores, b.bargainLane], ['admin', null, true], 'admin with a Bargain Lane grant: every store');
}
{
  const b = await body(await ask('howardbrian260@gmail.com'));
  eq([b.role, b.stores, b.bargainLane], ['manager', ['BL1'], true], 'a BL1 manager: BL1 only');
}
{
  const b = await body(await ask('owner@retjg.com'));
  eq([b.role, b.stores], ['executive', []], 'an executive with an unscoped grant: no stores (the app\'s legacy reading)');
}
{
  // An admin WITHOUT a Bargain Lane grant: the role alone is not enough.
  db.prepare("DELETE FROM user_grants WHERE user_id = 'u-admin'").run();
  const b = await body(await ask('bgeorges@retjg.com'));
  eq([b.role, b.stores, b.bargainLane], ['admin', null, false], 'an admin with no Bargain Lane grant says so');
  db.prepare("INSERT INTO user_grants (user_id,business_id,role,units) VALUES ('u-admin','bl','admin',NULL)").run();
}
{
  db.prepare("UPDATE users SET status = 'suspended' WHERE id = 'u-mgr2'").run();
  const b = await body(await ask('alyson@bargainlane.com'));
  eq([b.found, b.active], [true, false], 'a suspended account: found, not active');
}
{
  db.prepare("UPDATE users SET pin_hash = 'x' WHERE id = 'u-staff'").run();
  const b = await body(await ask('lead@bargainlane.com'));
  eq(b.associate, true, 'an associate (PIN sign-in) says so');
}
{
  const r = await ask('nobody@example.com');
  const b = await body(r);
  eq(r.status, 200, 'an unknown email → 200');
  eq(b, { email: 'nobody@example.com', found: false }, 'and only found:false');
}
{
  const text = await (await ask('bhoward@bargainlane.com')).text();
  ok(!/pin_hash|session|grants|pages/.test(text), 'no pin hash, session, raw grants or page list in the answer');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
