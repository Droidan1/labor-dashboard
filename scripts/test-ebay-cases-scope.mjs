// Unit-level scoping for ?action=ebay-cases, driven through the REAL endpoints.
//
// The business gate decides WHETHER you reach E-Commerce. This is the separate
// question of WHICH storefronts inside it — and until now the answer was "all of
// them", because the handler filtered on `business = 'ecom'` plus a
// CALLER-SUPPLIED `&account=`. A caller who simply omitted that parameter
// received every account's rows, including buyer_username and buyer_comments.
//
// 🔑 THE TRAP THIS FILE EXISTS TO AVOID: allowedUnits() short-circuits to null
// ("every unit") for BOTH superuser AND admin. A scoping test written with an
// admin passes with full visibility and proves nothing. Every scoped case below
// uses a `manager`, and there is an explicit assertion that the admin
// short-circuit is still what it looks like.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req, blockNetwork, applyMigrationAlters } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

blockNetwork();
const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
for (const f of ['migration-031.sql', 'migration-033.sql', 'migration-034.sql']) {
  db.exec(fs.readFileSync(path.join(repo, f), 'utf8'));
}
// 🔑 Re-run the harness's ADD COLUMN pass now that the migration-created tables
// exist. makeEnv() already ran it once, before ebay_cases existed, and it
// swallows failures — so without this every future ALTER against ebay_cases is
// silently skipped and surfaces as "no such column" inside an endpoint.
applyMigrationAlters(db, repo);
env.EBAY_HANDLER_TOKEN = 'tok';

// The two eBay accounts, as Handler keys them. Seeded here rather than by a
// migration — there is deliberately no ecom unit migration yet (see
// tasks/todo.md); this test is what proves the enforcement is in place BEFORE
// any such rows exist.
db.prepare("INSERT INTO business_units (id,business_id,code,name) VALUES (?,?,?,?)")
  .run('shoes', 'ecom', 'shoes', 'shoes');
db.prepare("INSERT INTO business_units (id,business_id,code,name) VALUES (?,?,?,?)")
  .run('fashion', 'ecom', 'fashion', 'fashion');

const grant = (userId, units) =>
  db.prepare(`INSERT INTO user_grants (user_id,business_id,role,units) VALUES (?,?,?,?)
              ON CONFLICT(user_id,business_id) DO UPDATE SET role=excluded.role, units=excluded.units`)
    .run(userId, 'ecom', 'manager', units === null ? null : JSON.stringify(units));

const hoursFromNow = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const mkCase = (acct, id, extra = {}) => ({
  account: acct, caseType: 'RETURN', caseId: id, ebayState: 'OPEN', isClosed: false,
  buyerCanEscalate: true, respondByDate: hoursFromNow(5), _decision: 'NEEDS_HUMAN',
  amount: 50, buyerUsername: `${acct}_buyer`, buyerComments: `${acct} secret comment`, ...extra,
});

await worker.fetch(new Request('https://api.retjghub.com/?action=ebay-handler-ingest', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Handler-Token': 'tok' },
  body: JSON.stringify({
    state: {
      lastSuccessfulRunAt: hoursFromNow(-1),
      cases: {
        'shoes::RETURN::1':   mkCase('shoes', '1'),
        'shoes::INR::2':      mkCase('shoes', '2', { caseType: 'INR', ebayState: 'ESCALATED', buyerCanEscalate: false }),
        'fashion::RETURN::3': mkCase('fashion', '3'),
        'fashion::INR::4':    mkCase('fashion', '4', { caseType: 'INR', ebayState: 'ESCALATED', buyerCanEscalate: false }),
      },
      // 🔑 POPULATED on purpose. This started as `{}`, which made the blanket
      // "the string 'fashion' appears nowhere" assertion below VACUOUS — it
      // passed while the endpoint was in fact returning fashion's poll health
      // to a shoes-scoped manager, because the field that leaks was empty.
      // A probe with the real shape found it. Never leave a fixture empty for a
      // field an absence-assertion is supposed to be watching.
      accountStatus: {
        shoes:   { checkedAt: hoursFromNow(-1), fetched: 2, ok: true,  queueErrors: 0 },
        fashion: { checkedAt: hoursFromNow(-1), fetched: 9, ok: false, queueErrors: 7 },
      },
    },
    audit: [
      { ts: hoursFromNow(-3), kind: 'action', account: 'shoes',   caseType: 'RETURN', caseId: '1', actionType: 'APPROVE_RETURN', dryRun: true, ok: true, amount: 50 },
      { ts: hoursFromNow(-2), kind: 'action', account: 'fashion', caseType: 'RETURN', caseId: '3', actionType: 'ISSUE_REFUND', dryRun: false, ok: false, httpStatus: 500, amount: 50, error: 'fashion refund blew up' },
    ],
  }),
}), env, ctx);

const read = async (user, qs = '') => {
  const r = await worker.fetch(req('/?action=ebay-cases' + qs, { user }), env, ctx);
  const text = await r.text();
  return { status: r.status, body: JSON.parse(text), text };
};
const accountsIn = (b) => [...new Set([...b.actionable, ...b.appeals].map(c => c.account))].sort();

// ── Baseline: unscoped callers still see everything ────────────────────────
{
  const su = await read('u-su');
  ok(su.status === 200, `superuser 200, got ${su.status}`);
  ok(accountsIn(su.body).join(',') === 'fashion,shoes',
     `superuser sees both accounts, got [${accountsIn(su.body)}]`);
  ok(su.body.counts.open === 4, `superuser sees all 4 open cases, got ${su.body.counts.open}`);

  // 🔑 The short-circuit that would make a careless test vacuous. Asserted
  // explicitly so that if admin ever STOPS being unscoped, this file says so
  // rather than silently becoming a different test.
  const ad = await read('u-admin');
  ok(accountsIn(ad.body).join(',') === 'fashion,shoes',
     `admin is unscoped by role (allowedUnits short-circuits) — got [${accountsIn(ad.body)}]`);
}

// ── The real case: a MANAGER scoped to one storefront ──────────────────────
{
  grant('u-mgr1', ['shoes']);
  const m = await read('u-mgr1');
  ok(m.status === 200, `scoped manager is served, got ${m.status}`);
  ok(accountsIn(m.body).join(',') === 'shoes',
     `manager scoped to shoes sees ONLY shoes, got [${accountsIn(m.body)}]`);
  ok(m.body.counts.open === 2, `sees 2 of 4 open cases, got ${m.body.counts.open}`);
  ok(m.body.actionable.length === 1 && m.body.appeals.length === 1,
     'the triage split still works inside the scope');

  // 🔑 The chips are derived from the rows, so a leak here would advertise an
  // account whose cases are hidden.
  ok(m.body.accounts.join(',') === 'shoes',
     `account chips are scoped too, got [${m.body.accounts}]`);

  // recentActions live in a different TABLE — a refund you may not see is not
  // made safe by that.
  ok(m.body.recentActions.every(a => a.account === 'shoes'),
     `recentActions are scoped, got [${m.body.recentActions.map(a => a.account)}]`);

  // 🛑 handler.account_status is keyed BY ACCOUNT and is NOT a row query — it
  // was missed by the first version of this fix and hidden by an empty fixture.
  // Asserted on its own rather than relying on the blanket check below.
  const as = JSON.parse(m.body.handler.account_status);
  ok(Object.keys(as).join(',') === 'shoes',
     `account_status is scoped to granted storefronts, got [${Object.keys(as)}]`);
  ok(as.shoes && as.shoes.queueErrors === 0, 'the caller still gets their OWN storefront health');
  // Business-level fields are not per-account and must survive scoping.
  ok(!!m.body.handler.last_successful_run_at, 'business-level handler state still reaches a scoped caller');

  // 🛑 The whole point: no fashion PII anywhere in the serialised body.
  ok(!m.text.includes('fashion'), 'the string "fashion" appears NOWHERE in the response');
  ok(!m.text.includes('fashion_buyer'), 'no fashion buyer_username leaks');
  ok(!m.text.includes('fashion secret comment'), 'no fashion buyer_comments leak');
  ok(!m.text.includes('fashion refund blew up'), 'no fashion action error text leaks');
}

// ── 🛑 The bypass the old code had: omit &account=, or ask for another ─────
{
  const other = await read('u-mgr1', '&account=fashion');
  ok(other.status === 200, 'asking for another account is not an error');
  ok(other.body.counts.open === 0,
     `a scoped manager asking for &account=fashion gets NOTHING, got ${other.body.counts.open}`);
  ok(!other.text.includes('fashion_buyer'),
     'the caller-supplied filter cannot widen the scope');

  const own = await read('u-mgr1', '&account=shoes');
  ok(own.body.counts.open === 2, 'the display filter still works within scope');
}

// ── Both storefronts granted explicitly ────────────────────────────────────
{
  grant('u-mgr2', ['shoes', 'fashion']);
  const m = await read('u-mgr2');
  ok(accountsIn(m.body).join(',') === 'fashion,shoes',
     `a manager granted both sees both, got [${accountsIn(m.body)}]`);
  ok(m.body.counts.open === 4, `sees all 4, got ${m.body.counts.open}`);
}

// ── NULL units = every storefront (what set-user-grants writes) ────────────
// ⚠️ Bargain Lane reads NULL as NO units; that legacy stays put and is pinned
// by test-cron-recipients.js. This asserts the OTHER reading for a non-bl
// business, which is what the schema and the grant writer both declare.
{
  grant('u-mgr2', null);
  const m = await read('u-mgr2');
  ok(m.body.counts.open === 4,
     `NULL units on a non-bl grant means EVERY storefront, got ${m.body.counts.open}`);
}

// ── An empty grant means nothing, not everything ──────────────────────────
{
  grant('u-mgr2', []);
  const m = await read('u-mgr2');
  ok(m.status === 200, `empty-unit grant is 200 not 500 (no "IN ()" syntax error), got ${m.status}`);
  ok(m.body.counts.open === 0, `empty units sees NOTHING, got ${m.body.counts.open}`);
  ok(m.body.recentActions.length === 0, 'and no actions');
  ok(m.body.accounts.length === 0, 'and no account chips');
  ok(!m.text.includes('secret comment'), 'and no buyer comments at all');
  ok(Array.isArray(m.body.actionable) && Array.isArray(m.body.appeals),
     'the response shape is unchanged — empty arrays, not nulls');
  ok(m.body.actionableAmount === 0, 'actionableAmount is 0, not NaN');
}

// ── Corrupt units JSON must fail CLOSED ───────────────────────────────────
// `null` is a MEANINGFUL value here ("every unit"), so parsing garbage into
// null would widen access on precisely the input we understand least.
{
  db.prepare("UPDATE user_grants SET units = ? WHERE user_id = ? AND business_id = 'ecom'")
    .run('{not valid json', 'u-mgr2');
  const m = await read('u-mgr2');
  ok(m.body.counts.open === 0,
     `unparseable units grants NOTHING, not everything — got ${m.body.counts.open}`);
  ok(!m.text.includes('secret comment'), 'and leaks no buyer comments');
}

// ── The WRITE side: a grant for 'shoes' must store 'shoes' ────────────────
// 🔑 Read-side scoping compares grant units verbatim against
// ebay_cases.account, which Handler writes lowercase. set-user-grants used to
// uppercase every submitted code — a Bargain-Lane-shaped assumption, invisible
// while every code was already 'BL1'…'BL16'. It would have turned a grant for
// 'shoes' into one for 'SHOES': rejected by validation, and if it had ever got
// through, matching no case that exists. Everything above is unreachable
// without this, so it is asserted here rather than in the grant-editor suite.
{
  const post = async (user, body) => {
    const r = await worker.fetch(req('/?action=set-user-grants',
      { user, method: 'POST', body }), env, ctx);
    return { status: r.status, body: JSON.parse(await r.text()) };
  };
  const unitsOf = (uid) => db.prepare(
    "SELECT units FROM user_grants WHERE user_id=? AND business_id='ecom'").get(uid)?.units;

  const w = await post('u-su', { id: 'u-mgr1', grants: [{ business_id: 'ecom', role: 'manager', units: ['shoes'] }] });
  ok(w.status === 200, `granting a lowercase unit code succeeds, got ${w.status} ${JSON.stringify(w.body)}`);
  ok(unitsOf('u-mgr1') === '["shoes"]',
     `stored verbatim as ["shoes"], got ${unitsOf('u-mgr1')}`);

  // ...and it must actually take effect end to end, not merely be stored.
  const m = await read('u-mgr1');
  ok(accountsIn(m.body).join(',') === 'shoes',
     `a grant written through the real endpoint scopes the real read, got [${accountsIn(m.body)}]`);

  // Validation is still the real check — membership, not case-folding.
  const bad = await post('u-su', { id: 'u-mgr1', grants: [{ business_id: 'ecom', role: 'manager', units: ['SHOES'] }] });
  ok(bad.status === 400, `a code that is not a real unit is still refused, got ${bad.status}`);
  const cross = await post('u-su', { id: 'u-mgr1', grants: [{ business_id: 'ecom', role: 'manager', units: ['BL1'] }] });
  ok(cross.status === 400, `another business's unit is still refused, got ${cross.status}`);
}

// ── Bargain Lane's NULL reading is untouched ──────────────────────────────
// Changing it is a decision about who receives chain-wide revenue by email, not
// something to do as a side effect of scoping another business.
{
  db.prepare("UPDATE user_grants SET units = NULL WHERE user_id='u-mgr1' AND business_id='bl'").run();
  const r = await worker.fetch(req('/?action=weekly-summary&week=1&year=2026', { user: 'u-mgr1' }), env, ctx);
  const body = await r.text();
  ok(!body.includes('"BL4"'),
     'a bl grant with NULL units still grants NO stores (legacy reading preserved)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
