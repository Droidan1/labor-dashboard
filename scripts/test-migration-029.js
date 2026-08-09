// Harness migration-029 against REAL sqlite with the REAL schemas and foreign
// keys ENFORCED. The failure this is built to catch is silent cascade deletion:
// four tables reference users(id) ON DELETE CASCADE, so a careless rebuild
// wipes sessions, push subscriptions, notification prefs and supply requests.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const REPO = process.argv[2] || '.';
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');

// Pull the real CREATE TABLE statements out of the real migration files.
// Strip comments to END OF LINE, not just whole-line comments — migration-004's
// `stores` column has an inline comment containing a semicolon, which splits a
// statement in half if you only drop full-comment lines.
function statements(sql) {
  return sql
    .split('\n').map(l => l.replace(/--.*$/, '')).join('\n')
    .split(';').map(s => s.trim()).filter(Boolean);
}

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');           // enforce, like D1 does

// Real schema for users + everything that references it.
for (const f of ['migration-004.sql', 'migration-008.sql', 'migration-011.sql']) {
  for (const s of statements(read(f))) {
    // Only tolerate failures for objects that depend on tables from OTHER
    // migrations we didn't load. A failure to create `users` must be loud.
    try { db.exec(s); }
    catch (e) {
      if (/\busers\b/i.test(s)) { console.error('FATAL seeding schema:', e.message, '\n', s.slice(0, 120)); process.exit(1); }
    }
  }
}

const fkOn = db.prepare('PRAGMA foreign_keys').get();
console.log('foreign_keys enforced :', JSON.stringify(fkOn));

// ── seed: one user per existing role, each with dependent rows ──────────────
const users = [
  ['u-super', 'brian@retjghub.com',   'superuser',        null,                   'active'],
  ['u-admin', 'ops@retjghub.com',     'admin',            null,                   'active'],
  ['u-dm',    'district@retjghub.com','district_manager', '["BL1","BL4","BL16"]', 'active'],
  ['u-mgr',   'coliseum@retjghub.com','manager',          '["BL1"]',              'active'],
  ['u-susp',  'holland@retjghub.com', 'manager',          '["BL8"]',              'suspended'],
];
const ins = db.prepare('INSERT INTO users (id,email,role,stores,status,created_at,last_login) VALUES (?,?,?,?,?,?,?)');
users.forEach(u => ins.run(...u, '2026-01-01T00:00:00Z', '2026-08-01T00:00:00Z'));

// dependent rows — the things that must survive
db.prepare('INSERT INTO sessions (id,user_id,created_at,expires_at) VALUES (?,?,?,?)')
  .run('s1', 'u-dm', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z');
db.prepare('INSERT INTO sessions (id,user_id,created_at,expires_at) VALUES (?,?,?,?)')
  .run('s2', 'u-mgr', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z');

let extras = { push: 0, prefs: 0, supply: 0 };
try {
  db.prepare("INSERT INTO push_subscriptions (id,user_id,endpoint,p256dh,auth,created_at) VALUES ('p1','u-dm','https://x','k','a','2026-08-01')").run();
  extras.push = 1;
} catch (e) { console.log('  (push_subscriptions seed skipped:', e.message.slice(0, 60), ')'); }
try {
  db.prepare("INSERT INTO notification_preferences (user_id) VALUES ('u-dm')").run();
  extras.prefs = 1;
} catch (e) { console.log('  (notification_preferences seed skipped:', e.message.slice(0, 60), ')'); }
try {
  // real columns, incl. the `cost` the Budget tab sums via SUM(cost) WHERE status='ordered'
  db.prepare("INSERT INTO supply_requests (id,user_id,user_email,store,status,cost) VALUES ('r1','u-dm','district@retjghub.com','BL1','ordered',249.99)").run();
  extras.supply = 1;
} catch (e) { console.log('  (supply_requests seed skipped:', e.message.slice(0, 70), ')'); }

const count = t => { try { return db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch { return 'n/a'; } };
const before = {
  users: count('users'), sessions: count('sessions'),
  push: count('push_subscriptions'), prefs: count('notification_preferences'),
  supply: count('supply_requests'),
};
console.log('before               :', JSON.stringify(before));

// ── run the migration exactly as written, inside a transaction like D1 ──────
// Execute the file verbatim, including its own PRAGMA/BEGIN/COMMIT, so the
// transaction boundaries under test are the ones actually shipped.
const migration = read('migration-029.sql');
for (const s of statements(migration)) db.exec(s);

const after = {
  users: count('users'), sessions: count('sessions'),
  push: count('push_subscriptions'), prefs: count('notification_preferences'),
  supply: count('supply_requests'),
};
console.log('after                :', JSON.stringify(after));

// ── assertions ─────────────────────────────────────────────────────────────
let fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) fail++;
};

console.log('\nassertions:');
// A skipped seed silently deletes the three cascade assertions below, and the
// suite still prints "all assertions passed". Proving the cascade did not fire
// IS this suite's purpose, so a missing seed is a failure, not a skip.
ok('all three cascade-target tables were seeded', extras.push && extras.prefs && extras.supply,
   JSON.stringify(extras));
ok('no row lost from users', after.users === before.users, `${before.users} → ${after.users}`);
ok('sessions survived (cascade did NOT fire)', after.sessions === before.sessions, `${before.sessions} → ${after.sessions}`);
if (extras.push)   ok('push_subscriptions survived', after.push === before.push, `${before.push} → ${after.push}`);
if (extras.prefs)  ok('notification_preferences survived', after.prefs === before.prefs, `${before.prefs} → ${after.prefs}`);
if (extras.supply) ok('supply_requests survived', after.supply === before.supply, `${before.supply} → ${after.supply}`);

const dm = db.prepare("SELECT role, title FROM users WHERE id='u-dm'").get();
ok('district_manager became manager', dm.role === 'manager', `role=${dm.role}`);
ok('old distinction kept as a title', dm.title === 'District Manager', `title=${dm.title}`);

const mgr = db.prepare("SELECT role, title, stores FROM users WHERE id='u-mgr'").get();
ok('a plain manager is untouched', mgr.role === 'manager' && mgr.title === null, `role=${mgr.role} title=${mgr.title}`);
ok('stores JSON preserved verbatim', mgr.stores === '["BL1"]', mgr.stores);

const susp = db.prepare("SELECT status FROM users WHERE id='u-susp'").get();
ok('status preserved', susp.status === 'suspended', susp.status);

ok('no district_manager rows remain',
   db.prepare("SELECT COUNT(*) c FROM users WHERE role='district_manager'").get().c === 0);

// new roles must be accepted
for (const r of ['executive', 'staff']) {
  let accepted = true;
  try {
    db.prepare('INSERT INTO users (id,email,role,status,created_at) VALUES (?,?,?,?,?)')
      .run('t-' + r, r + '@x.com', r, 'active', '2026-08-04');
  } catch (e) { accepted = false; }
  ok(`CHECK accepts '${r}'`, accepted);
}

// the retired role must now be rejected
let rejected = false;
try {
  db.prepare('INSERT INTO users (id,email,role,status,created_at) VALUES (?,?,?,?,?)')
    .run('t-dm', 'dm@x.com', 'district_manager', 'active', '2026-08-04');
} catch (e) { rejected = true; }
ok("CHECK now rejects 'district_manager'", rejected);

// email uniqueness must have survived the rebuild
let dupBlocked = false;
try {
  db.prepare('INSERT INTO users (id,email,role,status,created_at) VALUES (?,?,?,?,?)')
    .run('t-dup', 'ops@retjghub.com', 'admin', 'active', '2026-08-04');
} catch (e) { dupBlocked = true; }
ok('UNIQUE(email) survived the rebuild', dupBlocked);

// foreign keys must still point at a real users table afterwards
let fkStillEnforced = false;
try {
  db.prepare('INSERT INTO sessions (id,user_id,created_at,expires_at) VALUES (?,?,?,?)')
    .run('s-bad', 'nobody', '2026-08-04', '2026-09-04');
} catch (e) { fkStillEnforced = true; }
ok('FK into users still enforced after rename', fkStillEnforced);

const leftovers = db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE name LIKE '_m029_%' OR name='users_new'").get().c;
ok('no scratch tables left behind', leftovers === 0, `${leftovers} found`);

console.log(fail ? `\n${fail} FAILED` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
