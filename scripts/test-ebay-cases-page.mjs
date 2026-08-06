// Contract test for the payload the eBay Cases page draws from.
//
// Drives BOTH real entry points end to end: a Handler-shaped payload goes in
// through the real `?action=ebay-handler-ingest`, and comes back out through the
// real `?action=ebay-cases`. Nothing is written to D1 by hand. Asserting against
// hand-inserted rows would prove the SELECTs parse, not that the page receives
// what Handler actually sends — which is the failure this repo has paid for.
//
// The page (#page-ebay-cases in index.html) is a pure function of this payload,
// so every invariant it relies on is asserted here. Each one has a cheaper wrong
// version that would render a plausible, confidently wrong screen.
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
for (const f of ['migration-031.sql', 'migration-033.sql', 'migration-034.sql']) {
  db.exec(fs.readFileSync(path.join(repo, f), 'utf8'));
}
env.EBAY_HANDLER_TOKEN = 'test-handler-token';

const ingest = (body) => worker.fetch(new Request(
  'https://api.retjghub.com/?action=ebay-handler-ingest',
  { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Handler-Token': 'test-handler-token' },
    body: JSON.stringify(body) }), env, ctx);

const read = async (user, qs = '') => {
  const r = await worker.fetch(req('/?action=ebay-cases' + qs, { user }), env, ctx);
  return { status: r.status, body: JSON.parse(await r.text()) };
};

const hoursFromNow = (h) => new Date(Date.now() + h * 3600e3).toISOString();

// ── Fixture, shaped from the live state file measured 2026-08-04 ───────────
// 🔑 accountStatus carries NO mode field. That is the real production shape —
// mode lives only in handler.ini — and it is why effectiveMode must resolve to
// null rather than to LIVE.
const STATE = {
  version: '1.4.0',
  // 🔑 Deliberately different values. lastRunAt advances even on a run where
  // every account failed to authenticate, so a page reading it would look
  // healthy at the exact moment it is not.
  lastRunAt: new Date().toISOString(),
  lastSuccessfulRunAt: hoursFromNow(-9),
  cases: {
    // Actionable, overdue. title null on every real case — Enrich had not run.
    'shoes::RETURN::5001': {
      account: 'shoes', caseType: 'RETURN', caseId: '5001',
      ebayState: 'OPEN', isClosed: false, buyerCanEscalate: true,
      respondByDate: hoursFromNow(-30), _decision: 'NEEDS_HUMAN',
      _decisionReason: 'high value', _tier: 'ESCALATE', _hoursLeft: 999,
      title: null, sku: 'NAM-10', amount: 94.98,
      buyerUsername: 'buyer_one', buyerComments: 'Wrong size &amp; late',
    },
    // Actionable, due soon.
    'fashion::RETURN::5004': {
      account: 'fashion', caseType: 'RETURN', caseId: '5004',
      ebayState: 'OPEN', isClosed: false, buyerCanEscalate: true,
      respondByDate: hoursFromNow(4), _decision: 'NOTIFY_OWNER',
      title: 'Wool coat', amount: 55.00, buyerUsername: 'buyer_four',
      // Buyer-supplied and hostile. Must survive storage intact so the page's
      // decode-then-escape is what neutralises it, not an accident upstream.
      buyerComments: '<img src=x onerror=alert(1)>',
    },
    // Appeals: ESCALATED + cannot escalate further. eBay owns the outcome.
    'shoes::INR::5002': {
      account: 'shoes', caseType: 'INR', caseId: '5002',
      ebayState: 'ESCALATED', isClosed: false, buyerCanEscalate: false,
      respondByDate: hoursFromNow(-500), _decision: 'NONE', amount: 41.58,
      buyerUsername: 'buyer_two', buyerComments: null,
    },
    // Closed. Note it still carries tier ESCALATE — five real cases do, which is
    // why the endpoint filters on is_closed and not on tier.
    'fashion::RETURN::5003': {
      account: 'fashion', caseType: 'RETURN', caseId: '5003',
      ebayState: 'CLOSED', isClosed: true, _decision: 'NONE',
      _tier: 'ESCALATE', amount: 38.50,
    },
  },
  accountStatus: {
    shoes:   { checkedAt: hoursFromNow(-9), fetched: 2, ok: true, queueErrors: 0 },
    fashion: { checkedAt: hoursFromNow(-9), fetched: 2, ok: true, queueErrors: 0 },
  },
};

const AUDIT = [
  { ts: hoursFromNow(-9), kind: 'run', event: 'start' },
  { ts: hoursFromNow(-8), kind: 'decision', account: 'shoes', caseType: 'RETURN',
    caseId: '5001', decision: 'NEEDS_HUMAN', reason: 'high value' },
  // A dry-run action: written in shadow, never reached eBay.
  { ts: hoursFromNow(-7), kind: 'action', account: 'shoes', caseType: 'RETURN',
    caseId: '5001', actionType: 'APPROVE_RETURN', dryRun: true, ok: true, amount: 94.98 },
  // 🔑 A FAILED auto-act. The last safety net fired and missed; the page has to
  // shout about it. Every sample line Raj has sent is ok:true, so this branch
  // exists only because the test constructs it.
  { ts: hoursFromNow(-6), kind: 'action', account: 'fashion', caseType: 'RETURN',
    caseId: '5004', actionType: 'ISSUE_REFUND', dryRun: false, ok: false,
    httpStatus: 500, amount: 55.00, error: 'eBay refused: INVALID_STATE' },
];

{
  const r = await ingest({ state: STATE, audit: AUDIT });
  const b = JSON.parse(await r.text());
  ok(r.status === 200, `ingest is 200, got ${r.status}`);
  ok(b.cases === 4, `ingest stored 4 cases, got ${b.cases}`);
  ok(b.events === 4, `ingest stored 4 audit lines, got ${b.events}`);
}

// ── Access: the business gate is the real boundary ─────────────────────────
{
  const mgr = await read('u-mgr1');
  ok(mgr.status === 403, `a Bargain-Lane-only manager is refused, got ${mgr.status}`);
  const ad = await read('u-admin');   // holds ecom via migration-033
  ok(ad.status === 200, `an ecom grant holder is served, got ${ad.status}`);
  const su = await read('u-su');
  ok(su.status === 200, `superuser is served, got ${su.status}`);
}

const { body: d } = await read('u-admin');

// ── The triage split ───────────────────────────────────────────────────────
// 🔑 Two lists, decided server-side. Mixing them into one urgency-sorted list is
// what Raj's dashboard did, and it sends whoever works these at cases eBay has
// already decided.
{
  ok(d.actionable.length === 2, `2 actionable, got ${d.actionable.length}`);
  ok(d.appeals.length === 1, `1 appeal, got ${d.appeals.length}`);

  const ids = xs => xs.map(c => c.case_id).sort().join(',');
  ok(ids(d.appeals) === '5002', `the appeal is 5002, got [${ids(d.appeals)}]`);
  ok(ids(d.actionable) === '5001,5004', `actionable is 5001+5004, got [${ids(d.actionable)}]`);

  // Disjoint and complete: no case can be dropped by, or duplicated across, the split.
  const all = [...d.actionable, ...d.appeals].map(c => c.case_key);
  ok(new Set(all).size === all.length, 'no case appears in both lists');
  ok(d.counts.open === d.actionable.length + d.appeals.length,
     `counts.open (${d.counts.open}) equals the two lists summed`);

  // Closed cases never reach the page — even the one still carrying tier ESCALATE.
  ok(!all.some(k => k.endsWith('5003')), 'the closed case is absent despite tier ESCALATE');
}

// ── 🔑 actionableAmount excludes appeals ───────────────────────────────────
// The single most load-bearing number on the page. Blending the two would
// report $191.56 recoverable when only $149.98 is.
{
  ok(Math.abs(d.actionableAmount - 149.98) < 0.005,
     `actionableAmount is 94.98+55.00=149.98, got ${d.actionableAmount}`);
  const appealsAmount = d.appeals.reduce((n, c) => n + (c.amount || 0), 0);
  ok(Math.abs(appealsAmount - 41.58) < 0.005,
     `the appeals total is separable, got ${appealsAmount}`);
  ok(Math.abs(d.actionableAmount - (149.98 + 41.58)) > 1,
     'actionableAmount is NOT the blended total');
}

// ── Ordering: the page renders in the order it receives ────────────────────
{
  const by = d.actionable.map(c => c.respond_by);
  ok(by.join(',') === [...by].sort().join(','),
     'actionable arrives sorted by respond_by ascending');
}

// ── 🔑 effectiveMode is null when Handler does not report it ───────────────
// Wrong in the most dangerous direction if guessed: both accounts read
// mode:"live" while forcedShadow holds them in shadow.
{
  ok(d.effectiveMode === null,
     `effectiveMode is null when accountStatus carries no mode, got ${JSON.stringify(d.effectiveMode)}`);
}

// ── 🔑 Staleness reads lastSuccessfulRunAt, not lastRunAt ──────────────────
{
  ok(d.lastSuccessfulRunAt === STATE.lastSuccessfulRunAt,
     'lastSuccessfulRunAt is surfaced verbatim');
  ok(d.handler && d.handler.last_run_at === STATE.lastRunAt,
     'last_run_at is also carried, so the two can be told apart');
  ok(d.lastSuccessfulRunAt !== d.handler.last_run_at,
     'the two timestamps are genuinely different in this fixture');
}

// ── Hours-left must be recomputed, so the drifted copy must NOT ship ───────
{
  const c = d.actionable.find(x => x.case_id === '5001');
  ok(!('_hoursLeft' in c) && !('hours_left' in c),
     'Handler’s per-run _hoursLeft is not in the payload — the page recomputes from respond_by');
  ok(typeof c.respond_by === 'string' && c.respond_by.length > 0,
     'respond_by is present to recompute from');
}

// ── Account chips ──────────────────────────────────────────────────────────
{
  ok(d.accounts.join(',') === 'fashion,shoes',
     `accounts lists both, sorted, got [${d.accounts}]`);

  // The &account= filter narrows `accounts` too — which is exactly why the page
  // fetches UNFILTERED and applies the chip client-side. Filtering server-side
  // would delete the chip needed to get back to All.
  const one = await read('u-admin', '&account=shoes');
  ok(one.body.accounts.join(',') === 'shoes',
     `filtering collapses the account list to [${one.body.accounts}] — page must not rely on it`);
  ok(one.body.actionable.length === 1, 'the filter itself works server-side');
}

// ── Fields the page falls back on ──────────────────────────────────────────
{
  const c5001 = d.actionable.find(x => x.case_id === '5001');
  ok(c5001.title === null, 'title is null (true of all 193 real cases) — page falls back to sku');
  ok(c5001.sku === 'NAM-10', 'sku survives as the fallback');

  // Buyer text is stored verbatim, entities and markup intact. The page is the
  // thing that must neutralise it; nothing upstream is doing so.
  ok(c5001.buyer_comments === 'Wrong size &amp; late',
     `raw HTML entities round-trip unchanged, got ${JSON.stringify(c5001.buyer_comments)}`);
  const c5004 = d.actionable.find(x => x.case_id === '5004');
  ok(c5004.buyer_comments === '<img src=x onerror=alert(1)>',
     'hostile buyer markup reaches the client verbatim — escaping is the page’s job');

  ok(c5001.owner === null && c5001.last_notified_at === null,
     'owner/last_notified_at are null — nobody is being notified about these today');
}

// ── Recent actions: only kind='action', and the failure is visible ─────────
{
  ok(d.recentActions.length === 2,
     `only the 2 action lines are returned, not the run/decision lines, got ${d.recentActions.length}`);
  ok(d.recentActions.every(a => a.action),
     'every action line has its actionType stored in `action` (not NULL — the bug real files caught)');

  const failed = d.recentActions.filter(a => a.ok === 0 || a.ok === false);
  ok(failed.length === 1, `the failed auto-act is present, got ${failed.length}`);
  ok(failed[0].error === 'eBay refused: INVALID_STATE',
     'the failure carries its error text — this is what makes the banner say anything useful');
  ok(failed[0].http_status === 500, 'and its HTTP status');

  // 🔑 dry_run splits shadow from real. The case record alone cannot tell you.
  const dry = d.recentActions.filter(a => a.dry_run === 1 || a.dry_run === true);
  ok(dry.length === 1, `exactly one dry-run line, got ${dry.length}`);
  ok(dry[0].action === 'APPROVE_RETURN', 'the dry-run line is the approval');
}

// ── Empty state: a fresh business must not 500 the page ────────────────────
{
  const { db: db2, env: env2 } = makeEnv(repo);
  for (const f of ['migration-031.sql', 'migration-033.sql', 'migration-034.sql']) {
    db2.exec(fs.readFileSync(path.join(repo, f), 'utf8'));
  }
  const r = await worker.fetch(req('/?action=ebay-cases', { user: 'u-admin' }), env2, ctx);
  const b = JSON.parse(await r.text());
  ok(r.status === 200, `an empty table still returns 200, got ${r.status}`);
  ok(b.actionable.length === 0 && b.appeals.length === 0, 'both lists are empty arrays, not null');
  ok(b.handler === null, 'handler state is null before the first run');
  ok(b.effectiveMode === null && b.lastSuccessfulRunAt === null,
     'mode and staleness are null — the page shows "unknown" and "never reported"');
  ok(b.actionableAmount === 0, 'actionableAmount is 0, not NaN');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
