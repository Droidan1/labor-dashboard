// eBay case alerts, driven through the REAL ingest endpoint.
//
// Two things here are load-bearing rather than defensive, and both get the most
// scrutiny because both fail SILENTLY in the wrong direction:
//
//   1. DEDUPE. Handler POSTs the FULL state every ~30 minutes. "Alert on what we
//      see" would be ~48 runs x 20 NEEDS_HUMAN cases = ~960 pushes a day. The
//      test that matters is not "an alert fires" — it is "the SECOND identical
//      run fires nothing".
//   2. RECIPIENTS. This path runs at ingest, which bypasses every request gate,
//      so the recipient list IS the access control. A Bargain Lane admin holding
//      no ecom grant must never receive an E-Commerce case alert.
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
// migration-008 brings notification_log, which the harness schema does not
// create. Needed here because the recipient assertions below OBSERVE that table
// rather than restating the recipient SQL. Both its CREATEs are IF NOT EXISTS,
// so it is a no-op against what the harness already made.
for (const f of ['migration-008.sql', 'migration-031.sql', 'migration-033.sql', 'migration-034.sql']) {
  db.exec(fs.readFileSync(path.join(repo, f), 'utf8'));
}

// 🔑 Re-run the harness's ADD COLUMN pass now that the migration-created tables
// exist. makeEnv() already ran it once, before ebay_cases existed, and it
// swallows failures — so without this every ALTER against ebay_cases is silently
// skipped and surfaces as "no such column" inside an endpoint. This replaced a
// hand-rolled replay of migration-035 that then missed migration-036.
applyMigrationAlters(db, repo);
{
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
  ok(cols('ebay_cases').includes('notified_tier'), 'migration-035 gave ebay_cases.notified_tier');
  ok(cols('notification_preferences').includes('ebay_alerts'), 'migration-035 gave notification_preferences.ebay_alerts');
  ok(cols('ebay_cases').includes('buyer_reason'), 'migration-036 columns are present too');
}

env.EBAY_HANDLER_TOKEN = 'tok';
env.VAPID_PUBLIC_KEY = 'test-pub';
env.VAPID_PRIVATE_KEY = 'test-priv';
env.VAPID_SUBJECT = 'mailto:test@retjghub.com';

// Everyone needs a subscription + preferences row to be reachable at all.
const sub = (userId) => {
  db.prepare(`INSERT OR IGNORE INTO notification_preferences (user_id, push_enabled) VALUES (?, 1)`).run(userId);
  db.prepare(`UPDATE notification_preferences SET ebay_alerts = 1 WHERE user_id = ?`).run(userId);
  db.prepare(`INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
              VALUES (?,?,?,?,?,?)`)
    .run(`sub-${userId}`, userId, `https://push.example/${userId}`, 'BPk'.padEnd(88, 'x'), 'YXV0aA', '2026-01-01');
};
// u-su superuser (sees every business), u-admin holds ecom via migration-033,
// u-mgr1 is a Bargain Lane manager with NO ecom grant — the leak check.
['u-su', 'u-admin', 'u-mgr1'].forEach(sub);

const hoursFromNow = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const mkCase = (acct, id, extra = {}) => ({
  account: acct, caseType: 'RETURN', caseId: id, ebayState: 'OPEN', isClosed: false,
  buyerCanEscalate: true, respondByDate: hoursFromNow(72), _decision: 'NONE',
  amount: 25, buyerUsername: `${acct}_buyer`, ...extra,
});

const ingest = async (state, audit = []) => {
  const r = await worker.fetch(new Request('https://api.retjghub.com/?action=ebay-handler-ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Handler-Token': 'tok' },
    body: JSON.stringify({ state, audit }),
  }), env, ctx);
  return JSON.parse(await r.text());
};
const ACCT = { shoesandfashions: { thresholds: { autoActAtHours: 6 } } };

// ── A NEEDS_HUMAN case alerts once ────────────────────────────────────────
{
  const b = await ingest({
    lastSuccessfulRunAt: hoursFromNow(-1), accountStatus: ACCT,
    cases: { 'shoesandfashions::RETURN::1': mkCase('shoesandfashions', '1', { _decision: 'NEEDS_HUMAN' }) },
  });
  ok(b.ok === true, 'ingest still returns ok');
  ok(b.alerts && b.alerts.needsHuman === 1, `1 needs-human alert, got ${b.alerts && b.alerts.needsHuman}`);
  ok(b.alerts.pushes === 1, `exactly 1 push batch, got ${b.alerts.pushes}`);
  const t = db.prepare("SELECT notified_tier, last_notified_at FROM ebay_cases WHERE case_id='1'").get();
  ok(t.notified_tier === 'needs-human', `ledger records the tier, got ${t.notified_tier}`);
  ok(!!t.last_notified_at, 'last_notified_at is stamped');
}

// ── 🔑 THE ONE THAT MATTERS: the identical run again alerts NOTHING ────────
{
  const b = await ingest({
    lastSuccessfulRunAt: hoursFromNow(-1), accountStatus: ACCT,
    cases: { 'shoesandfashions::RETURN::1': mkCase('shoesandfashions', '1', { _decision: 'NEEDS_HUMAN' }) },
  });
  ok(b.alerts.needsHuman === 0, `a repeat run alerts nobody, got ${b.alerts.needsHuman}`);
  ok(b.alerts.pushes === 0, `and sends no push at all, got ${b.alerts.pushes}`);
}

// ── ...but the SAME case escalating DOES alert again ──────────────────────
// needs-human -> auto-act outranks, so it must re-alert. A dedupe that only
// remembered "already notified" would swallow the more urgent event.
{
  const b = await ingest({
    lastSuccessfulRunAt: hoursFromNow(-1), accountStatus: ACCT,
    cases: {
      'shoesandfashions::RETURN::1': mkCase('shoesandfashions', '1',
        { _decision: 'NEEDS_HUMAN', respondByDate: hoursFromNow(3) }),  // now inside the 6h window
    },
  });
  ok(b.alerts.autoAct === 1, `escalation re-alerts at the higher tier, got ${b.alerts.autoAct}`);
  ok(b.alerts.needsHuman === 0, 'and not also as needs-human');
  const t = db.prepare("SELECT notified_tier FROM ebay_cases WHERE case_id='1'").get();
  ok(t.notified_tier === 'auto-act', `ledger advances to the higher tier, got ${t.notified_tier}`);

  // ...and does not then alert a third time at that tier.
  const b2 = await ingest({
    lastSuccessfulRunAt: hoursFromNow(-1), accountStatus: ACCT,
    cases: {
      'shoesandfashions::RETURN::1': mkCase('shoesandfashions', '1',
        { _decision: 'NEEDS_HUMAN', respondByDate: hoursFromNow(3) }),
    },
  });
  ok(b2.alerts.pushes === 0, `no repeat at the escalated tier either, got ${b2.alerts.pushes}`);
}

// ── A failed auto-act alerts once, and a RESENT audit file does not repeat ─
{
  const auditLines = [{
    ts: hoursFromNow(-1), kind: 'action', account: 'shoesandfashions', caseType: 'RETURN',
    caseId: '9', actionType: 'ISSUE_REFUND', dryRun: false, ok: false, httpStatus: 400,
    amount: 19.99, error: 'eBay refused',
  }];
  const state = { lastSuccessfulRunAt: hoursFromNow(-1), accountStatus: ACCT, cases: {} };
  const b = await ingest(state, auditLines);
  ok(b.alerts.failed === 1, `the failed auto-act alerts, got ${b.alerts.failed}`);

  // 🔑 Handler re-sends the WHOLE audit file after any non-200 or a log rotation.
  // INSERT OR IGNORE on line_hash means no new id, so this must alert nothing.
  const b2 = await ingest(state, auditLines);
  ok(b2.alerts.failed === 0, `a full audit RESEND does not re-alert, got ${b2.alerts.failed}`);
}

// ── Appeals never alert ───────────────────────────────────────────────────
// eBay already owns the outcome, so buzzing a phone asks someone to act on a
// case that cannot be acted on. Same reasoning as the page's two lists.
{
  const b = await ingest({
    lastSuccessfulRunAt: hoursFromNow(-1), accountStatus: ACCT,
    cases: {
      'shoesandfashions::INR::7': mkCase('shoesandfashions', '7', {
        caseType: 'INR', ebayState: 'ESCALATED', buyerCanEscalate: false,
        _decision: 'NEEDS_HUMAN', respondByDate: hoursFromNow(2),
      }),
    },
  });
  ok(b.alerts.pushes === 0, `an appeal inside the auto-act window still alerts nobody, got ${b.alerts.pushes}`);
}

// ── Closed cases never alert ──────────────────────────────────────────────
{
  const b = await ingest({
    lastSuccessfulRunAt: hoursFromNow(-1), accountStatus: ACCT,
    cases: {
      'shoesandfashions::RETURN::8': mkCase('shoesandfashions', '8',
        { isClosed: true, _decision: 'NEEDS_HUMAN', respondByDate: hoursFromNow(1) }),
    },
  });
  ok(b.alerts.pushes === 0, `a closed case does not alert, got ${b.alerts.pushes}`);
}

// ── 🛑 RECIPIENTS: the recipient list IS the access control ───────────────
// Asserted by observing notification_log after a REAL alert — not by re-running
// the recipient SQL here. A restated query proves the SQL parses, not that the
// notifier uses it, which is exactly the failure this repo has already paid for.
// (Pushes fail on the harness's fake VAPID keys, so every attempt lands as a
// 'failed' row — which is still one row per user actually selected.)
{
  db.prepare("DELETE FROM notification_log").run();
  await ingest({
    lastSuccessfulRunAt: hoursFromNow(-1), accountStatus: ACCT,
    cases: { 'shoesandfashions::RETURN::20': mkCase('shoesandfashions', '20', { _decision: 'NEEDS_HUMAN' }) },
  });
  const got = db.prepare("SELECT DISTINCT user_id FROM notification_log").all().map(r => r.user_id).sort();
  ok(got.length > 0, `the notifier actually reached someone, got [${got}]`);
  ok(got.includes('u-su'), 'superuser is notified (sees every business)');
  ok(got.includes('u-admin'), 'an ecom grant holder is notified');
  ok(!got.includes('u-mgr1'),
     `🛑 a Bargain-Lane-only manager is NOT notified — got [${got}]`);
  ok(!got.includes('u-staff'), 'staff is not notified');
  ok(db.prepare("SELECT COUNT(*) n FROM notification_log WHERE event_type='ebay-needs-human'").get().n > 0,
     'the log records which trigger fired');

  // The alert list and the read endpoint must agree — the excluded user is the
  // same one ?action=ebay-cases refuses.
  const r = await worker.fetch(req('/?action=ebay-cases', { user: 'u-mgr1' }), env, ctx);
  ok(r.status === 403,
     `the user excluded from alerts is the one the read endpoint refuses (${r.status})`);
}

// ── Opting out actually opts out ──────────────────────────────────────────
{
  db.prepare("UPDATE notification_preferences SET ebay_alerts = 0 WHERE user_id = 'u-su'").run();
  const { results: reach } = { results: db.prepare(
    `SELECT ps.user_id FROM push_subscriptions ps
       JOIN notification_preferences np ON np.user_id = ps.user_id
      WHERE np.push_enabled = 1 AND np.ebay_alerts != 0`).all() };
  ok(!reach.map(r => r.user_id).includes('u-su'), 'ebay_alerts=0 removes that user from the send list');
  db.prepare("UPDATE notification_preferences SET ebay_alerts = 1 WHERE user_id = 'u-su'").run();
}

// ── An alert failure must never fail the ingest ───────────────────────────
// Handler treats a non-200 as "resend the whole audit file", so a notification
// problem must not loop the entire log forever.
{
  const orig = env.DB.prepare;
  let broke = false;
  env.DB.prepare = function (sql) {
    if (!broke && /FROM ebay_cases WHERE business = 'ecom' AND is_closed = 0/.test(sql)) {
      broke = true;
      throw new Error('simulated alert-path failure');
    }
    return orig.call(this, sql);
  };
  const b = await ingest({
    lastSuccessfulRunAt: hoursFromNow(-1), accountStatus: ACCT,
    cases: { 'shoesandfashions::RETURN::11': mkCase('shoesandfashions', '11', { _decision: 'NEEDS_HUMAN' }) },
  });
  env.DB.prepare = orig;
  ok(b.ok === true, 'the ingest still returns ok:true when the alert path throws');
  ok(broke, 'the failure was actually triggered (not a vacuous pass)');
  const stored = db.prepare("SELECT COUNT(*) n FROM ebay_cases WHERE case_id='11'").get();
  ok(stored.n === 1, 'and the case was still stored — data is never lost to a push problem');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
