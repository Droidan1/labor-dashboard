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
  grab(/function allowedUnits\(user, businessId\) \{[\s\S]*?\n\}/, 'allowedUnits') + '\n' +
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
// 🔑 The region is the WHOLE HANDLER — from update-user's own dispatch line to
// the next action's — not a fixed 3000 characters. The magic number silently
// truncated the handler the moment a guard was added at the top of it, and the
// `A < B` assertions below then compared against indexOf's -1, which reads as a
// failure for the wrong reason (and, with the operands the other way round,
// would read as a PASS for the wrong reason).
const uuStart = worker.indexOf('action") === "update-user"');
const uuNext = worker.indexOf('url.searchParams.get("action") ===', uuStart + 50);
const uuRegion = worker.slice(uuStart, uuNext > -1 ? uuNext : worker.length);
ok('an assignable-role allowlist exists', /const assignable = /.test(uuRegion));
// Since 2026-11-19 a role (and stores) can be changed here by the SUPERUSER only: they write the
// Bargain Lane grant, so an admin sending them could add someone to Bargain Lane, which
// set-user-grants refuses anyone but the superuser. So: ONE allowlist, for the superuser, and a
// non-superuser refused any role before the write.
const aIdx = uuRegion.indexOf('const assignable');
const arrays = aIdx === -1 ? []
  : [...uuRegion.slice(aIdx, aIdx + 120).matchAll(/\[[^\]]*\]/g)].map(m => m[0]);
ok('found the allowlist array', arrays.length === 1, arrays.join(' | ') || 'none');
ok("'superuser' is not in it", arrays.length === 1 && !arrays[0].includes('superuser'), arrays.join(' | ') || 'no array found');
ok('a non-superuser may not send a role or stores at all',
   /if \(\(role !== undefined \|\| stores !== undefined\) && currentUser\.role !== 'superuser'\)/.test(uuRegion));
// Both halves must be FOUND before they are ordered. Comparing against a -1 is
// how the truncation above hid itself.
const uuNonSu  = uuRegion.indexOf('code: "USE_GRANTS"');
const uuReject = uuRegion.indexOf('You cannot assign that role');
const uuWrite  = uuRegion.indexOf('UPDATE users SET');
ok('the handler region contains both guards and the write',
   uuNonSu > -1 && uuReject > -1 && uuWrite > -1, `non-su@${uuNonSu} guard@${uuReject} write@${uuWrite}`);
ok('both role guards run before the UPDATE',
   uuNonSu > -1 && uuReject > -1 && uuWrite > -1 && uuNonSu < uuWrite && uuReject < uuWrite);
// Who may be edited at all is userReach's: nobody but the superuser reaches a superuser.
const reachFn = (worker.match(/async function userReach\([\s\S]*?\n\}/) || [''])[0];
ok('a non-superuser cannot edit a superuser target',
   /if \(target\.role === 'superuser'\) return \{ target, sees: false, manages: false \};/.test(reachFn) &&
   /const reach = await userReach\(env, currentUser, id\);/.test(uuRegion));
const uuTarget = uuRegion.indexOf('if (!reach.sees)');
ok('that target check also runs before the UPDATE',
   uuTarget > -1 && uuWrite > -1 && uuTarget < uuWrite);

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
