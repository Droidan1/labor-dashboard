// Prove the financial gate denies by default and leaves existing roles alone.
//
// Extracts the REAL FINANCIAL_ROLES / canSeeFinancials / NON_FINANCIAL_ACTIONS
// out of worker.js rather than restating them here — a harness that reimplements
// the thing it tests will happily agree with itself while production disagrees.
const fs = require('fs');
const path = require('path');

const REPO = process.argv[2] || '.';
const src = fs.readFileSync(path.join(REPO, 'worker.js'), 'utf8');

function grab(re, label) {
  const m = src.match(re);
  if (!m) { console.error(`FATAL: could not extract ${label} from worker.js`); process.exit(1); }
  return m[0];
}

const decls = [
  grab(/const FINANCIAL_ROLES = new Set\(\[[\s\S]*?\]\);/, 'FINANCIAL_ROLES'),
  grab(/function canSeeFinancials\(user\) \{[\s\S]*?\n\}/, 'canSeeFinancials'),
  grab(/const NON_FINANCIAL_ACTIONS = new Set\(\[[\s\S]*?\n\]\);/, 'NON_FINANCIAL_ACTIONS'),
].join('\n');

const { canSeeFinancials, NON_FINANCIAL_ACTIONS, FINANCIAL_ROLES } =
  new Function(`${decls}; return { canSeeFinancials, NON_FINANCIAL_ACTIONS, FINANCIAL_ROLES };`)();

// The gate as it sits in the request path, mirrored exactly.
const allowed = (user, action) =>
  canSeeFinancials(user) || NON_FINANCIAL_ACTIONS.has(action || '');

let fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) fail++;
};
const U = role => ({ id: 'u', email: 'u@x.com', role });

console.log('extracted from worker.js:');
console.log('  FINANCIAL_ROLES      :', [...FINANCIAL_ROLES].join(', '));
console.log('  allowlisted actions  :', NON_FINANCIAL_ACTIONS.size);

// ── existing production roles must be completely unaffected ────────────────
console.log('\nexisting roles keep full access (nothing in prod changes):');
const FINANCIAL_SAMPLE = ['weekly-summary', 'items', 'hourly', 'supply-budgets',
                          'item-costs', 'monthly-totals', 'store-scores', 'ly-sales'];
for (const role of ['superuser', 'admin', 'manager']) {
  const every = FINANCIAL_SAMPLE.every(a => allowed(U(role), a));
  ok(`${role} reaches every financial action`, every);
}
ok('executive reaches financials (read-only is enforced elsewhere)',
   FINANCIAL_SAMPLE.every(a => allowed(U('executive'), a)));

// ── staff is denied money ──────────────────────────────────────────────────
console.log('\nstaff cannot see money:');
for (const a of FINANCIAL_SAMPLE) ok(`staff denied ${a}`, !allowed(U('staff'), a));

// ── staff can still use the app ────────────────────────────────────────────
console.log('\nstaff can still sign in and do their job:');
for (const a of ['auth-me', 'auth-logout', 'push-subscribe', 'photo-upload',
                 'passkey-auth-begin', 'announcement', 'update-notif-prefs']) {
  ok(`staff allowed ${a}`, allowed(U('staff'), a));
}

// ── fail closed ────────────────────────────────────────────────────────────
console.log('\nfails closed:');
ok('unrecognised role denied', !allowed(U('regional_director'), 'weekly-summary'));
ok('null user denied',        !allowed(null, 'weekly-summary'));
ok('undefined role denied',   !allowed({ id: 'u' }, 'weekly-summary'));
ok('empty action denied for staff', !allowed(U('staff'), ''));
ok('unknown action denied for staff', !allowed(U('staff'), 'some-future-action'));

// ── the allowlist must not accidentally include anything financial ─────────
console.log('\nallowlist hygiene:');
const SUSPECT = /sale|budget|cost|item|revenue|summary|total|brief|weekly|monthly|hourly|supply|margin|score|diag|ingest|snapshot/i;
const leaky = [...NON_FINANCIAL_ACTIONS].filter(a => SUSPECT.test(a));
ok('no money-shaped action slipped into the allowlist', leaky.length === 0,
   leaky.length ? leaky.join(', ') : 'none');

// ── coverage: how much of the surface is actually denied to staff ──────────
const allActions = [...new Set(
  (src.match(/searchParams\.get\("action"\) === "[a-z0-9-]+"/g) || [])
    .map(s => s.match(/"([a-z0-9-]+)"$/)[1])
)];
const deniedToStaff = allActions.filter(a => !allowed(U('staff'), a));
console.log('\ncoverage:');
console.log(`  ${allActions.length} actions total · ${deniedToStaff.length} denied to staff · ` +
            `${allActions.length - deniedToStaff.length} reachable`);
ok('the large majority of the surface is closed to staff',
   deniedToStaff.length > allActions.length * 0.7,
   `${Math.round(deniedToStaff.length / allActions.length * 100)}% denied`);

console.log(fail ? `\n${fail} FAILED` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
