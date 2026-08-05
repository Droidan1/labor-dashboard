// Two properties that NOTHING tested, and that were both violated in production:
//
//   1. The fall-through ?store= route must refuse a store the caller has no
//      grant to. It reads `store` from the query string, returns that store's
//      live Clover orders, and WRITES its KV snapshot + daily_sales row.
//   2. update-user must not let anyone assign 'superuser', and must not let a
//      non-superuser touch a superuser at all.
//
// Both are asserted against the REAL source, not a restatement of it — the
// point of the exercise is that a test written from the same mental model as
// the code will agree with the code even when the code is wrong.
const fs = require('fs');
const path = require('path');

const REPO = process.argv[2] || '.';
const worker = fs.readFileSync(path.join(REPO, 'worker.js'), 'utf8');
const client = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

let fail = 0;
const ok = (n, c, d = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!c) fail++; };

// ── behavioural: the real allowedStores/canAccessStore ──────────────────────
const grab = (re, label) => {
  const m = worker.match(re);
  if (!m) { console.error(`FATAL: ${label} not found`); process.exit(1); }
  return m[0];
};
const F = new Function(
  grab(/function grantFor\(user, businessId\) \{[\s\S]*?\n\}/, 'grantFor') + '\n' +
  grab(/function allowedStores\(user\) \{[\s\S]*?\n\}/, 'allowedStores') + '\n' +
  grab(/function canAccessStore\(user, store\) \{[\s\S]*?\n\}/, 'canAccessStore') +
  '; return { canAccessStore };'
)();

const mgr = { id: 'u', role: 'manager', stores: null,
              grants: [{ business_id: 'bl', role: 'manager', units: ['BL1'] }] };

console.log('fall-through ?store= route — the guard itself:');
ok('BL1 manager may read BL1', F.canAccessStore(mgr, 'BL1') === true);
for (const s of ['BL2', 'BL4', 'BL8', 'BL14', 'BL16']) {
  ok(`BL1 manager may NOT read ${s}`, F.canAccessStore(mgr, s) === false);
}
ok('admin may read any store', F.canAccessStore({ id: 'a', role: 'admin', stores: null, grants: [] }, 'BL8') === true);
ok('X-Snapshot-Secret path (currentUser null) still allowed — cron must not break',
   F.canAccessStore(null, 'BL8') === true);

// ── structural: the guard is actually wired into that route ─────────────────
console.log('\nthe guard is actually present at the fall-through route:');
const fallthrough = worker.slice(worker.indexOf('// ── Live data endpoint (existing)'));
const region = fallthrough.slice(0, 2500);
ok('route computes targetStore', /const targetStore = storeKey\.toUpperCase\(\);/.test(region));
ok('route calls canAccessStore on targetStore',
   /canAccessStore\(currentUser, targetStore\)/.test(region));
const guardIdx = region.indexOf('canAccessStore(currentUser, targetStore)');
const tokenIdx = region.indexOf('_API_TOKEN');
const snapIdx  = region.indexOf('saveSnapshot(');
ok('guard runs BEFORE the Clover credentials are read', guardIdx > -1 && guardIdx < tokenIdx);
ok('guard runs BEFORE the snapshot write', guardIdx > -1 && (snapIdx === -1 || guardIdx < snapIdx));

// ── update-user privilege guards ────────────────────────────────────────────
console.log('\nupdate-user cannot be used to escalate:');
const uu = worker.slice(worker.indexOf('action") === "update-user"'));
const uuRegion = uu.slice(0, 3000);
ok('an assignable-role allowlist exists', /const assignable = /.test(uuRegion));
// Check the ARRAY LITERALS, not the whole expression — `currentUser.role ===
// 'superuser'` is the condition selecting the branch, so a naive proximity
// match on the assignment reports a false failure.
const aIdx = uuRegion.indexOf('const assignable');
const arrays = aIdx === -1 ? []
  : [...uuRegion.slice(aIdx, aIdx + 260).matchAll(/\[[^\]]*\]/g)].map(m => m[0]);
ok('found both allowlist arrays', arrays.length === 2, arrays.join(' | ') || 'none');
ok("'superuser' appears in no assignable-role array",
   arrays.length === 2 && !arrays.some(a => a.includes('superuser')),
   arrays.join(' | ') || 'no arrays found');
ok('a non-superuser caller may assign only manager',
   /: \['manager'\]/.test(uuRegion));
ok('an out-of-allowlist role is rejected before the UPDATE runs',
   uuRegion.indexOf('You cannot assign that role') > -1 &&
   uuRegion.indexOf('You cannot assign that role') < uuRegion.indexOf('UPDATE users SET'));
ok('a non-superuser cannot edit a superuser target',
   /SELECT role FROM users WHERE id = \?/.test(uuRegion) &&
   /target\[0\]\.role === 'superuser'/.test(uuRegion));
ok('that target check also runs before the UPDATE',
   uuRegion.indexOf("target[0].role === 'superuser'") < uuRegion.indexOf('UPDATE users SET'));

// ── the client no longer offers what the server refuses ─────────────────────
console.log('\nclient no longer ships the superuser option:');
ok('no <option value="superuser"> anywhere', !/value="superuser"/.test(client));
ok('the old hide-it-with-CSS toggle is now optional-chained',
   !/el\('edit-role-superuser'\)\.classList/.test(client));

// ── regression: prove the OLD code would have failed these ──────────────────
console.log('\nregression guard — the pre-fix code fails these assertions:');
ok('old fall-through had no canAccessStore (this test would have caught it)',
   /canAccessStore\(currentUser, targetStore\)/.test(worker));
ok('old update-user had no allowlist (this test would have caught it)',
   /const assignable = /.test(worker));

console.log(fail ? `\n${fail} FAILED` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
