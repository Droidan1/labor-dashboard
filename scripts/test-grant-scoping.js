// Prove that reading scope from grants gives byte-identical results to reading
// it from users.stores, for every real production user.
//
// This is the load-bearing claim of step 2: the switch must change WHERE scope
// comes from without changing WHAT anyone can see. Anything else is a silent
// permissions change on live managers.
//
// Extracts the REAL allowedStores / canAccessStore / grantFor out of worker.js
// rather than restating them.
const fs = require('fs');
const path = require('path');

const REPO = process.argv[2] || '.';
const src = fs.readFileSync(path.join(REPO, 'worker.js'), 'utf8');

function grab(re, label) {
  const m = src.match(re);
  if (!m) { console.error(`FATAL: could not extract ${label}`); process.exit(1); }
  return m[0];
}
const decls = [
  grab(/function grantFor\(user, businessId\) \{[\s\S]*?\n\}/, 'grantFor'),
  grab(/function allowedStores\(user\) \{[\s\S]*?\n\}/, 'allowedStores'),
  grab(/function canAccessStore\(user, store\) \{[\s\S]*?\n\}/, 'canAccessStore'),
  grab(/function canAccessBusiness\(user, businessId\) \{[\s\S]*?\n\}/, 'canAccessBusiness'),
  grab(/function grantedBusinessIds\(user\) \{[\s\S]*?\n\}/, 'grantedBusinessIds'),
].join('\n');
const F = new Function(`${decls}; return { grantFor, allowedStores, canAccessStore, canAccessBusiness, grantedBusinessIds };`)();

// Real production users, verified against prod 2026-08-04.
const PROD = [
  ['bhoward@bargainlane.com',    'superuser', null],
  ['bgeorges@retjg.com',         'admin',     null],
  ['james@retjg.com',            'admin',     null],
  ['kevin@retjg.com',            'admin',     null],
  ['aalbert@bargainlane.com',    'manager',   ['BL2']],
  ['adara@bargainlane.com',      'manager',   ['BL14']],
  ['alyson@bargainlane.com',     'manager',   ['BL1','BL4']],
  ['csemancik@bargainlane.com',  'manager',   ['BL16']],
  ['dupontleads@bargainlane.com','manager',   ['BL4']],
  ['howardbrian260@gmail.com',   'manager',   ['BL1']],
  ['jharvey@bargainlane.com',    'manager',   ['BL1','BL4']],
  ['nmartinez@retjg.com',        'manager',   ['BL1','BL4']],
];
const ALL_STORES = ['BL1','BL2','BL4','BL8','BL14','BL16'];

let fail = 0;
const ok = (n, c, d = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!c) fail++; };

// OLD world: user carries `stores`, no grants.
const oldUser = (email, role, stores) => ({ id: email, email, role, stores });
// NEW world: same person, scope carried by a backfilled grant, stores gone.
const newUser = (email, role, stores) => ({
  id: email, email, role, stores: null,
  grants: role === 'superuser' ? [] : [{ business_id: 'bl', role, units: stores }],
  allBusinessIds: role === 'superuser' ? ['bl'] : undefined,
});

console.log('scope is identical before and after, for every real user:');
for (const [email, role, stores] of PROD) {
  const before = F.allowedStores(oldUser(email, role, stores));
  const after  = F.allowedStores(newUser(email, role, stores));
  ok(`${email} (${role})`, JSON.stringify(before) === JSON.stringify(after),
     `${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
}

console.log('\nper-store access is identical too (12 users × 6 stores):');
let diffs = 0, checks = 0;
for (const [email, role, stores] of PROD) {
  for (const st of ALL_STORES) {
    checks++;
    if (F.canAccessStore(oldUser(email, role, stores), st) !==
        F.canAccessStore(newUser(email, role, stores), st)) { diffs++; }
  }
}
ok('no per-store decision changed', diffs === 0, `${checks} checks, ${diffs} differences`);

console.log('\nthe transitional fallback:');
// grant missing entirely (migration not applied yet) — must keep working
const noGrants = { id: 'u', email: 'x@y.com', role: 'manager', stores: ['BL8'], grants: [] };
ok('missing grants falls back to users.stores (no lockout)',
   JSON.stringify(F.allowedStores(noGrants)) === JSON.stringify(['BL8']));
ok('fallback cannot escalate — yields exactly today\'s scope',
   F.canAccessStore(noGrants, 'BL8') === true && F.canAccessStore(noGrants, 'BL1') === false);
// grant present but empty units = deliberately scoped to nothing, NOT a fallback
const emptyGrant = { id: 'u', email: 'x@y.com', role: 'manager', stores: ['BL1'],
                     grants: [{ business_id: 'bl', role: 'manager', units: [] }] };
ok('an empty grant means NO stores, and does not fall back',
   JSON.stringify(F.allowedStores(emptyGrant)) === JSON.stringify([]),
   JSON.stringify(F.allowedStores(emptyGrant)));

console.log('\nbusiness access:');
const su  = newUser('bhoward@bargainlane.com', 'superuser', null);
const mgr = newUser('alyson@bargainlane.com', 'manager', ['BL1','BL4']);
ok('superuser reaches every active business without holding a grant',
   F.canAccessBusiness(su, 'bl') === true && F.grantedBusinessIds(su).join() === 'bl');
ok('manager reaches only the business they hold', F.canAccessBusiness(mgr, 'bl') === true);
ok('nobody reaches a business they hold no grant to', F.canAccessBusiness(mgr, 'ecom') === false);
ok('superuser reaches a business that does not exist yet (flag, not rows)',
   F.canAccessBusiness(su, 'ecom') === true);
ok('null user reaches nothing', F.canAccessBusiness(null, 'bl') === false);

console.log(fail ? `\n${fail} FAILED` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
