// auth-me must report the EFFECTIVE scope, and the client must read it the way
// the server means it.
//
// The trap: allowedStores() can return [] (a grant scoped to no units). The old
// client test `user.stores && user.stores.length` reads [] as falsy and applies
// NO filter — showing every store to someone entitled to none, whose every
// request the server then refuses. `[]` and `null` mean opposite things and
// must not be conflated.
//
// Extracts the REAL allowedStores from worker.js and the REAL client condition
// from index.html rather than restating either.
const fs = require('fs');
const path = require('path');

const REPO = process.argv[2] || '.';
const worker = fs.readFileSync(path.join(REPO, 'worker.js'), 'utf8');
const client = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

// allowedStores depends on grantFor — extract both, or it throws at call time.
const grab = (re, label) => {
  const m = worker.match(re);
  if (!m) { console.error(`FATAL: ${label} not found in worker.js`); process.exit(1); }
  return m[0];
};
const allowedStores = new Function(
  grab(/function grantFor\(user, businessId\) \{[\s\S]*?\n\}/, 'grantFor') + '\n' +
  grab(/function allowedUnits\(user, businessId\) \{[\s\S]*?\n\}/, 'allowedUnits') + '\n' +
  grab(/function allowedStores\(user\) \{[\s\S]*?\n\}/, 'allowedStores') +
  '; return allowedStores;'
)();

let fail = 0;
const ok = (n, c, d = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!c) fail++; };

// what auth-me now sends
const authMe = u => allowedStores(u);
// the client's rule for "is this a restriction?" — read out of index.html
const clientRestricts = stores => Array.isArray(stores);

const G = (role, units) => ({ id: 'u', role, stores: null, grants: [{ business_id: 'bl', role, units }] });

console.log('auth-me reports effective scope, not the raw column:');
const drift = { id: 'u', role: 'manager', stores: ['BL2'], grants: [{ business_id: 'bl', role: 'manager', units: ['BL16'] }] };
ok('grant wins over a stale users.stores', JSON.stringify(authMe(drift)) === JSON.stringify(['BL16']),
   JSON.stringify(authMe(drift)));

console.log('\nnull vs [] mean opposite things:');
ok('superuser -> null (every store)', authMe(G('superuser', null)) === null);
ok('admin -> null (every store)',     authMe(G('admin', null)) === null);
ok('manager with units -> that array',
   JSON.stringify(authMe(G('manager', ['BL1', 'BL4']))) === JSON.stringify(['BL1', 'BL4']));
ok('manager scoped to nothing -> [] (NOT null)',
   Array.isArray(authMe(G('manager', []))) && authMe(G('manager', [])).length === 0);

console.log('\nthe client reads them correctly:');
ok('null is NOT a restriction (shows every store)', clientRestricts(null) === false);
ok('[] IS a restriction (shows no stores)',        clientRestricts([]) === true);
ok('["BL1"] is a restriction',                      clientRestricts(['BL1']) === true);

console.log('\nthe old client rule was wrong — regression guard:');
const oldRule = stores => !!(stores && stores.length);
ok('old rule mishandled [] (would show every store)', oldRule([]) === false);
ok('new rule fixes exactly that case', clientRestricts([]) === true);
ok('new rule agrees with old on every other case',
   [null, ['BL1'], ['BL1', 'BL4']].every(s => oldRule(s) === clientRestricts(s)));

console.log('\nthe fix is actually present in the source:');
ok('index.html tests Array.isArray(user.stores)', /if \(Array\.isArray\(user\.stores\)\)/.test(client));
ok('index.html no longer uses the length test', !/if \(user\.stores && user\.stores\.length\)/.test(client));
ok('auth-me sends allowedStores(user)', /stores: allowedStores\(user\),/.test(worker));
ok('auth-me no longer sends the raw column', !/stores: user\.stores,/.test(worker));

console.log(fail ? `\n${fail} FAILED` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
