// The business gate is FAIL-CLOSED: an action in neither list is refused at
// runtime. That is only safe if the lists demonstrably cover every routed
// action — otherwise a gap is a production 403 instead of a red test. This
// suite is that guarantee, plus the access assertions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
const listOf = (name) => new Set(
  [...src.slice(src.indexOf(name)).slice(0, 4000).matchAll(/"([a-z0-9-]+)"/g)].map(m => m[1]));

// ── COMPLETENESS: every routed action is classified ────────────────────────
{
  const routed = [...new Set([...src.matchAll(/get\(\s*"action"\s*\)\s*===\s*"([a-z0-9-]+)"/g)]
    .map(m => m[1]))].sort();
  const agnostic = listOf('const BUSINESS_AGNOSTIC_ACTIONS');
  const mapped = new Set([...src.matchAll(/\["([a-z0-9-]+)",\s*"([a-z]+)"\]/g)].map(m => m[1]));
  const missing = routed.filter(a => !agnostic.has(a) && !mapped.has(a));
  ok(routed.length > 100, `found the routed actions (${routed.length})`);
  ok(missing.length === 0,
     `EVERY routed action is classified — unclassified would 403 in prod: [${missing.join(', ')}]`);
}

blockNetwork();
const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
db.exec(fs.readFileSync(path.join(repo, 'migration-031.sql'), 'utf8'));
const get = async (a, user) => (await worker.fetch(req(`/?action=${a}`, { user }), env, ctx)).status;

// ── a user WITH the bl grant reaches bl-scoped actions ─────────────────────
{
  ok(await get('weekly-summary', 'u-mgr1') !== 403, 'manager with a bl grant is not business-blocked');
  ok(await get('auth-me', 'u-mgr1') === 200, 'auth-me is never business-gated (it is how you learn your businesses)');
}

// ── a user WITHOUT a bl grant is refused bl-scoped actions ─────────────────
{
  db.prepare("DELETE FROM user_grants WHERE user_id='u-mgr1'").run();
  db.prepare("UPDATE users SET stores=NULL WHERE id='u-mgr1'").run();
  const s = await get('weekly-summary', 'u-mgr1');
  ok(s === 403, `a user holding NO bl grant is refused a bl action, got ${s}`);
  ok(await get('auth-me', 'u-mgr1') === 200, 'but auth-me still works, so they can be told why');
}

// ── the FAIL-CLOSED backstop actually fires ────────────────────────────────
// An action in neither list is refused. The completeness test above means this
// never happens in practice, so without exercising it directly the branch is
// untestable — and an untested fail-closed branch is just an assumption.
{
  const r = await worker.fetch(req('/?action=some-future-ecom-endpoint', { user: 'u-su' }), env, ctx);
  const b = JSON.parse(await r.text());
  ok(r.status === 403 && b.code === 'UNCLASSIFIED_ACTION',
     `an unclassified action is REFUSED even for a superuser, got ${r.status} ${b.code}`);
}

// ── superuser reaches everything via the flag, holding zero grants ─────────
{
  ok(await get('weekly-summary', 'u-su') !== 403, 'superuser passes the business gate on the flag alone');
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail || pass === 0) process.exit(1);
