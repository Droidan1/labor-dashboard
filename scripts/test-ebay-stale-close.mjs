// Closing cases that vanish from Handler's snapshot — and, more importantly,
// REFUSING to when the snapshot is partial.
//
// Handler sends a full snapshot of what eBay currently returns. A case that ages
// out simply stops appearing; it never arrives marked closed. Upsert alone left
// it open forever, so the page's open count drifted upward. Measured on the first
// real push: Handler said open=33, D1 held 36.
//
// 🛑 The risk in fixing that is closing cases because the payload was PARTIAL
// rather than because they are resolved — the same shape as this repo's Clover
// lesson (degradation returns LESS, it does not error). Most of this file is
// about that direction, not the happy path.
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
for (const f of ['migration-008.sql', 'migration-031.sql', 'migration-033.sql', 'migration-034.sql']) {
  db.exec(fs.readFileSync(path.join(repo, f), 'utf8'));
}
// See test-ebay-alerts.mjs: the harness applies ADD COLUMNs before these CREATEs
// and swallows failures, so ebay_cases' column must be replayed from the file.
const m035 = fs.readFileSync(path.join(repo, 'migration-035.sql'), 'utf8')
  .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
for (const stmt of (m035.match(/ALTER TABLE[^;]+;/gi) || [])) {
  try { db.exec(stmt); } catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
}
env.EBAY_HANDLER_TOKEN = 'tok';

const hoursFromNow = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const mkCase = (acct, id, extra = {}) => ({
  account: acct, caseType: 'RETURN', caseId: id, ebayState: 'OPEN', isClosed: false,
  buyerCanEscalate: true, respondByDate: hoursFromNow(72), _decision: 'NONE', amount: 10, ...extra,
});
const ingest = async (state) => {
  const r = await worker.fetch(new Request('https://api.retjghub.com/?action=ebay-handler-ingest', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Handler-Token': 'tok' },
    body: JSON.stringify({ state, audit: [] }),
  }), env, ctx);
  return JSON.parse(await r.text());
};
const openIds = (acct) => db.prepare(
  "SELECT case_id FROM ebay_cases WHERE account = ? AND is_closed = 0 ORDER BY case_id"
).all(acct).map(r => r.case_id).join(',');
const CLEAN = (accts) => Object.fromEntries(
  accts.map(a => [a, { ok: true, queueErrors: 0, fetched: 1, thresholds: { autoActAtHours: 6 } }]));

// ── Seed: three cases on one account, two on another ──────────────────────
{
  const b = await ingest({
    lastSuccessfulRunAt: hoursFromNow(-1),
    accountStatus: CLEAN(['shoes', 'fashion']),
    cases: {
      'shoes::RETURN::1': mkCase('shoes', '1'),
      'shoes::RETURN::2': mkCase('shoes', '2'),
      'shoes::RETURN::3': mkCase('shoes', '3'),
      'fashion::RETURN::9': mkCase('fashion', '9'),
      'fashion::RETURN::8': mkCase('fashion', '8'),
    },
  });
  ok(b.ok === true && b.cases === 5, `seeded 5 cases, got ${b.cases}`);
  ok(b.closedStale === 0, `nothing to close on a first run, got ${b.closedStale}`);
  ok(openIds('shoes') === '1,2,3', `shoes open = 1,2,3, got ${openIds('shoes')}`);
}

// ── THE BUG: a case drops out of the snapshot and must be closed ───────────
{
  const b = await ingest({
    lastSuccessfulRunAt: hoursFromNow(-1),
    accountStatus: CLEAN(['shoes', 'fashion']),
    cases: {
      'shoes::RETURN::1': mkCase('shoes', '1'),
      'shoes::RETURN::3': mkCase('shoes', '3'),          // 2 has vanished
      'fashion::RETURN::9': mkCase('fashion', '9'),
      'fashion::RETURN::8': mkCase('fashion', '8'),
    },
  });
  ok(b.closedStale === 1, `the vanished case is closed, got ${b.closedStale}`);
  ok(openIds('shoes') === '1,3', `shoes open drops to 1,3, got ${openIds('shoes')}`);
  ok(openIds('fashion') === '8,9', `the other account is untouched, got ${openIds('fashion')}`);
  // The row survives — closed, not deleted. History is the point of this table.
  ok(db.prepare("SELECT COUNT(*) n FROM ebay_cases WHERE case_id='2'").get().n === 1,
     'the vanished case is CLOSED, not deleted');
}

// ── ...and it is idempotent: the same snapshot again closes nothing more ──
{
  const b = await ingest({
    lastSuccessfulRunAt: hoursFromNow(-1),
    accountStatus: CLEAN(['shoes', 'fashion']),
    cases: {
      'shoes::RETURN::1': mkCase('shoes', '1'),
      'shoes::RETURN::3': mkCase('shoes', '3'),
      'fashion::RETURN::9': mkCase('fashion', '9'),
      'fashion::RETURN::8': mkCase('fashion', '8'),
    },
  });
  ok(b.closedStale === 0, `a repeat snapshot closes nothing further, got ${b.closedStale}`);
}

// ── A case that REAPPEARS is re-opened by the upsert ──────────────────────
// Closing must not be a one-way door: eBay can put a case back.
{
  const b = await ingest({
    lastSuccessfulRunAt: hoursFromNow(-1),
    accountStatus: CLEAN(['shoes', 'fashion']),
    cases: {
      'shoes::RETURN::1': mkCase('shoes', '1'),
      'shoes::RETURN::2': mkCase('shoes', '2'),          // back again
      'shoes::RETURN::3': mkCase('shoes', '3'),
      'fashion::RETURN::9': mkCase('fashion', '9'),
      'fashion::RETURN::8': mkCase('fashion', '8'),
    },
  });
  ok(b.closedStale === 0, 'nothing closed on the run that restores it');
  ok(openIds('shoes') === '1,2,3', `the case is open again, got ${openIds('shoes')}`);
}

// ── 🛑 A FAILED account keeps every case ─────────────────────────────────
// This is the whole point. `fashion` errored, so its cases are absent for a
// reason that is NOT "resolved". Closing them would silently erase real work.
{
  const b = await ingest({
    lastSuccessfulRunAt: hoursFromNow(-1),
    accountStatus: {
      shoes:   { ok: true,  queueErrors: 0 },
      fashion: { ok: false, queueErrors: 0, error: 'auth failed' },
    },
    cases: { 'shoes::RETURN::1': mkCase('shoes', '1'),
             'shoes::RETURN::2': mkCase('shoes', '2'),
             'shoes::RETURN::3': mkCase('shoes', '3') },   // no fashion cases at all
  });
  ok(b.closedStale === 0, `a failed account closes NOTHING, got ${b.closedStale}`);
  ok(openIds('fashion') === '8,9',
     `🛑 the failed account keeps every case, got [${openIds('fashion')}]`);
}

// ── 🛑 queueErrors > 0 is a PARTIAL fetch, and counts as failure ──────────
// Handler can return ok:true while one of the three queues errored. That is a
// short payload, not a resolved one.
{
  const b = await ingest({
    lastSuccessfulRunAt: hoursFromNow(-1),
    accountStatus: {
      shoes:   { ok: true, queueErrors: 0 },
      fashion: { ok: true, queueErrors: 2 },
    },
    cases: { 'shoes::RETURN::1': mkCase('shoes', '1'),
             'shoes::RETURN::2': mkCase('shoes', '2'),
             'shoes::RETURN::3': mkCase('shoes', '3') },
  });
  ok(b.closedStale === 0, `queueErrors>0 closes nothing, got ${b.closedStale}`);
  ok(openIds('fashion') === '8,9', `partial fetch keeps its cases, got [${openIds('fashion')}]`);
}

// ── 🛑 An EMPTY payload closes nothing ───────────────────────────────────
// The most dangerous input: a run that fetched nothing would otherwise close
// every open case on both accounts.
{
  const b = await ingest({
    lastSuccessfulRunAt: hoursFromNow(-1),
    accountStatus: CLEAN(['shoes', 'fashion']),
    cases: {},
  });
  ok(b.closedStale === 0, `an empty payload closes nothing, got ${b.closedStale}`);
  ok(openIds('shoes') === '1,2,3' && openIds('fashion') === '8,9',
     'every case survives an empty payload');
}

// ── 🛑 A MISSING accountStatus closes nothing ────────────────────────────
// An older Handler that does not report per-account health gives us no basis to
// judge completeness, so we must not delete on it. Fail closed.
{
  const b = await ingest({
    lastSuccessfulRunAt: hoursFromNow(-1),
    cases: { 'shoes::RETURN::1': mkCase('shoes', '1') },   // no accountStatus at all
  });
  ok(b.closedStale === 0, `no accountStatus means no sweep, got ${b.closedStale}`);
  ok(openIds('shoes') === '1,2,3', `cases survive, got [${openIds('shoes')}]`);
}

// ── An account reporting ok:true with genuinely zero cases DOES sweep ─────
// The legitimate empty case: the fetch worked and there is simply nothing open.
{
  const b = await ingest({
    lastSuccessfulRunAt: hoursFromNow(-1),
    accountStatus: CLEAN(['shoes', 'fashion']),
    cases: { 'shoes::RETURN::1': mkCase('shoes', '1'),
             'shoes::RETURN::2': mkCase('shoes', '2'),
             'shoes::RETURN::3': mkCase('shoes', '3') },   // fashion cleanly has none
  });
  ok(b.closedStale === 2, `a clean fetch with no cases closes that account's 2, got ${b.closedStale}`);
  ok(openIds('fashion') === '', `fashion is now empty, got [${openIds('fashion')}]`);
  ok(openIds('shoes') === '1,2,3', 'shoes is unaffected');
}

// ── 🛑 One account's sweep must not reach another's cases ────────────────
// The scenario the earlier failed-account test does NOT reach: a healthy account
// with something to close, running alongside a failed one. Only here does the
// UPDATE actually execute, so only here can a missing `account = ?` on it show
// up. Without that scoping, shoes' sweep closes fashion's cases too.
{
  // Re-open fashion, both accounts clean.
  await ingest({
    lastSuccessfulRunAt: hoursFromNow(-1),
    accountStatus: CLEAN(['shoes', 'fashion']),
    cases: { 'shoes::RETURN::1': mkCase('shoes', '1'),
             'shoes::RETURN::2': mkCase('shoes', '2'),
             'shoes::RETURN::3': mkCase('shoes', '3'),
             'fashion::RETURN::8': mkCase('fashion', '8'),
             'fashion::RETURN::9': mkCase('fashion', '9') },
  });
  ok(openIds('fashion') === '8,9', 'fashion re-opened for this scenario');

  // shoes is healthy and case 3 has vanished; fashion FAILED this run.
  const b = await ingest({
    lastSuccessfulRunAt: hoursFromNow(-1),
    accountStatus: {
      shoes:   { ok: true,  queueErrors: 0 },
      fashion: { ok: false, queueErrors: 0, error: 'auth failed' },
    },
    cases: { 'shoes::RETURN::1': mkCase('shoes', '1'),
             'shoes::RETURN::2': mkCase('shoes', '2') },
  });
  ok(b.closedStale === 1, `only shoes' vanished case closes, got ${b.closedStale}`);
  ok(openIds('shoes') === '1,2', `shoes drops to 1,2, got ${openIds('shoes')}`);
  ok(openIds('fashion') === '8,9',
     `🛑 the failed account's cases survive a healthy account's sweep, got [${openIds('fashion')}]`);
}

// ── Closed cases never reach the page ────────────────────────────────────
{
  const r = await worker.fetch(req('/?action=ebay-cases', { user: 'u-su' }), env, ctx);
  const b = JSON.parse(await r.text());
  const ids = [...b.actionable, ...b.appeals].map(c => c.case_id).sort().join(',');
  // shoes 1,2 survive; fashion 8,9 survive because that account's fetch FAILED
  // on the last run and its cases were correctly left alone.
  ok(ids === '1,2,8,9', `the read endpoint shows exactly what is still open, got [${ids}]`);
  ok(b.counts.open === 4, `counts.open agrees with the sweep, got ${b.counts.open}`);
  ok(!ids.includes('3'), 'the swept case does not reach the page');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
