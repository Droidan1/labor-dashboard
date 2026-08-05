// Drives the REAL worker.fetch for ?action=ebay-handler-ingest.
//
// Integration with Handler is UNPROVEN — no live POST has ever landed, and Raj's
// client is tested only against a local endpoint. This suite is the closest
// thing we have to a contract test until the first real run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

blockNetwork();
const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
for (const f of ['migration-031.sql', 'migration-034.sql']) {
  db.exec(fs.readFileSync(path.join(repo, f), 'utf8'));
}
env.EBAY_HANDLER_TOKEN = 'test-handler-token';

const post = (body, token) => worker.fetch(new Request(
  'https://api.retjghub.com/?action=ebay-handler-ingest',
  { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Handler-Token': token } : {}) },
    body: JSON.stringify(body) }), env, ctx);

// Shaped from the live state file measured 2026-08-04.
const STATE = {
  version: '1.4.0',
  lastRunAt: '2026-08-04T12:30:00Z',
  lastSuccessfulRunAt: '2026-08-04T12:30:00Z',
  cases: {
    'shoes::RETURN::5001': {
      account: 'shoes', caseType: 'RETURN', caseId: '5001',
      ebayState: 'OPEN', isClosed: false, buyerCanEscalate: true,
      respondByDate: '2026-08-06T06:59:59Z', firstSeen: '2026-08-01T00:00:00Z',
      lastSeen: '2026-08-04T12:30:00Z', _decision: 'NEEDS_HUMAN',
      _decisionReason: 'high value', _tier: 'ESCALATE', _hoursLeft: 42,
      title: 'Nike Air Max', sku: 'NAM-10', amount: 94.98,
      buyerUsername: 'buyer_one', buyerComments: 'Wrong size &amp; late',
    },
    // The appeals case: eBay already owns it. Must be separable from actionable.
    'shoes::INR::5002': {
      account: 'shoes', caseType: 'INR', caseId: '5002',
      ebayState: 'ESCALATED', isClosed: false, buyerCanEscalate: false,
      respondByDate: '2026-07-20T07:00:00Z', _decision: 'NONE', amount: 41.58,
      buyerUsername: 'buyer_two', buyerComments: null,
    },
    'fashion::RETURN::5003': {
      account: 'fashion', caseType: 'RETURN', caseId: '5003',
      ebayState: 'CLOSED', isClosed: true, _decision: 'NONE',
      _tier: 'ESCALATE', amount: 38.5,
    },
  },
  accountStatus: {
    // Both live-but-forced-shadow: the exact production shape.
    shoes:   { mode: 'live', forcedShadow: true, effectiveMode: 'SHADOW', thresholds: { autoActAtHours: 6 } },
    fashion: { mode: 'live', forcedShadow: true, effectiveMode: 'SHADOW', thresholds: { autoActAtHours: 6 } },
  },
};
const AUDIT = [
  { ts: '2026-08-04T12:30:00Z', kind: 'run', event: 'start' },
  { ts: '2026-08-04T12:30:01Z', kind: 'decision', account: 'shoes', caseType: 'RETURN', caseId: '5001', action: 'NEEDS_HUMAN' },
  { ts: '2026-08-04T12:30:02Z', kind: 'action', account: 'shoes', caseType: 'RETURN', caseId: '5001', action: 'ISSUE_REFUND', dryRun: true, ok: true, amount: 94.98 },
  { ts: '2026-08-04T12:30:03Z', kind: 'run', event: 'finish' },
];

// ── the token is the whole gate ────────────────────────────────────────────
{
  ok((await post({ state: STATE }, null)).status === 401, 'no token is refused');
  ok((await post({ state: STATE }, 'wrong')).status === 401, 'wrong token is refused');
  const g = await worker.fetch(new Request(
    'https://api.retjghub.com/?action=ebay-handler-ingest',
    { headers: { 'X-Handler-Token': 'test-handler-token' } }), env, ctx);
  ok(g.status === 405, `GET is refused (POST-only), got ${g.status}`);

  // 🔑 An unset secret must not authenticate an absent header.
  const bare = { ...env }; delete bare.EBAY_HANDLER_TOKEN;
  const r = await worker.fetch(new Request(
    'https://api.retjghub.com/?action=ebay-handler-ingest',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), bare, ctx);
  ok(r.status === 401, `unset secret + absent header is refused, got ${r.status}`);
}

// ── a real-shaped payload lands ────────────────────────────────────────────
{
  const r = await post({ state: STATE, audit: AUDIT }, 'test-handler-token');
  const b = await r.json();
  ok(r.status === 200 && b.ok === true, `ingest accepted, got ${JSON.stringify(b)}`);
  ok(b.cases === 3, `3 cases upserted, got ${b.cases}`);
  ok(b.events === 4, `4 audit lines stored, got ${b.events}`);

  const c = db.prepare("SELECT * FROM ebay_cases WHERE case_key='shoes::RETURN::5001'").get();
  ok(c.business === 'ecom', 'business defaults to ecom');
  ok(c.account === 'shoes' && c.case_type === 'RETURN' && c.case_id === '5001', 'key split into columns');
  ok(c.decision === 'NEEDS_HUMAN', 'decision stored');
  ok(c.buyer_comments === 'Wrong size &amp; late', 'buyer comments stored RAW (escaped at render, not here)');
  ok(c.is_closed === 0 && c.buyer_can_escalate === 1, 'open + escalatable flags');

  // The triage split the UI depends on.
  const appeals = db.prepare(
    "SELECT COUNT(*) n FROM ebay_cases WHERE is_closed=0 AND ebay_state='ESCALATED' AND buyer_can_escalate=0").get().n;
  const actionable = db.prepare(
    "SELECT COUNT(*) n FROM ebay_cases WHERE is_closed=0 AND NOT (ebay_state='ESCALATED' AND buyer_can_escalate=0)").get().n;
  ok(appeals === 1 && actionable === 1, `appeals/actionable split is 1/1, got ${appeals}/${actionable}`);

  // effectiveMode, not mode — both accounts read live but are forced to shadow.
  const st = db.prepare("SELECT * FROM ebay_handler_state WHERE business='ecom'").get();
  ok(st.effective_mode === 'SHADOW', `mode is SHADOW not LIVE, got ${st.effective_mode}`);
  ok(st.last_successful_run_at === '2026-08-04T12:30:00Z', 'last_successful_run_at stored for staleness');
}

// ── dedupe: the whole point ────────────────────────────────────────────────
// A non-200 leaves Handler's cursor untouched, so it re-sends. It also re-sends
// the entire audit file if rotated. Duplicates are normal traffic.
{
  const before = db.prepare('SELECT COUNT(*) n FROM ebay_actions').get().n;
  const r = await post({ state: STATE, audit: AUDIT }, 'test-handler-token');
  const b = await r.json();
  const after = db.prepare('SELECT COUNT(*) n FROM ebay_actions').get().n;
  ok(after === before, `re-sending the same audit adds nothing (${before} -> ${after})`);
  ok(b.events === 0, `re-send reports 0 new events, got ${b.events}`);
  ok(db.prepare('SELECT COUNT(*) n FROM ebay_cases').get().n === 3, 'cases upsert, not duplicate');

  // 🔑 Two `run` lines differing ONLY by ts must both survive — a (ts,kind,caseId)
  // key would have collapsed them, since run lines carry no caseId at all.
  const runs = db.prepare("SELECT COUNT(*) n FROM ebay_actions WHERE kind='run'").get().n;
  ok(runs === 2, `both run lines survived dedupe, got ${runs}`);
}

// ── an updated case overwrites rather than duplicating ─────────────────────
{
  const s2 = JSON.parse(JSON.stringify(STATE));
  s2.cases['shoes::RETURN::5001'].isClosed = true;
  s2.cases['shoes::RETURN::5001']._decision = 'NONE';
  s2.lastSuccessfulRunAt = '2026-08-04T13:00:00Z';
  await post({ state: s2, audit: [] }, 'test-handler-token');
  const c = db.prepare("SELECT is_closed, decision FROM ebay_cases WHERE case_key='shoes::RETURN::5001'").get();
  ok(c.is_closed === 1 && c.decision === 'NONE', 'case updated in place');
  ok(db.prepare('SELECT COUNT(*) n FROM ebay_cases').get().n === 3, 'still 3 cases');
  const st = db.prepare("SELECT last_successful_run_at FROM ebay_handler_state").get();
  ok(st.last_successful_run_at === '2026-08-04T13:00:00Z', 'staleness clock advanced');
}

// ── malformed input is refused, not half-written ───────────────────────────
{
  ok((await post({ audit: AUDIT }, 'test-handler-token')).status === 400, 'missing state is 400');
  const n = db.prepare('SELECT COUNT(*) n FROM ebay_cases').get().n;
  ok(n === 3, `a rejected payload wrote nothing, still ${n} cases`);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail || pass === 0) process.exit(1);
