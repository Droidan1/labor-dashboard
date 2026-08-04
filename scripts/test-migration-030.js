// Harness migration-030 against real sqlite with the real users schema and
// foreign keys ENFORCED, seeded to mirror production (1 superuser, 3 admins
// with NULL stores, 8 managers with store lists).
//
// The failure this is built to catch is a backfill that silently drops or
// mangles someone: a user with no grant is a user locked out of the app the
// moment the worker starts reading grants instead of users.role.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const REPO = process.argv[2] || '.';
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const statements = sql => sql
  .split('\n').map(l => l.replace(/--.*$/, '')).join('\n')
  .split(';').map(s => s.trim()).filter(Boolean);

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');

// real users table, post migration-029
for (const s of statements(read('migration-004.sql'))) {
  try { db.exec(s); } catch (e) {
    if (/\busers\b/i.test(s)) { console.error('FATAL:', e.message); process.exit(1); }
  }
}
db.exec(`DROP TABLE users;
  CREATE TABLE users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK(role IN ('superuser','admin','executive','manager','staff')),
    stores TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
    title TEXT, created_at TEXT NOT NULL, last_login TEXT);`);

// production shape, verified against prod 2026-08-04
const USERS = [
  ['usr_superuser_001',   'bhoward@bargainlane.com',    'superuser', null],
  ['usr_1fcb828b05afeb6c','bgeorges@retjg.com',         'admin',     null],
  ['usr_5a248ee0f8876b68','james@retjg.com',            'admin',     null],
  ['usr_66783ce6c2bdfd3c','kevin@retjg.com',            'admin',     null],
  ['usr_282bf5da5e2124b1','aalbert@bargainlane.com',    'manager',   '["BL2"]'],
  ['usr_645a686fc68052a6','adara@bargainlane.com',      'manager',   '["BL14"]'],
  ['usr_b5c183fde4590c6a','alyson@bargainlane.com',     'manager',   '["BL1","BL4"]'],
  ['usr_f10763f06ba05d9a','csemancik@bargainlane.com',  'manager',   '["BL16"]'],
  ['usr_e0af8cb9df53d2bb','dupontleads@bargainlane.com','manager',   '["BL4"]'],
  ['usr_f8605a7e73050b34','howardbrian260@gmail.com',   'manager',   '["BL1"]'],
  ['usr_947d73c490bf0364','jharvey@bargainlane.com',    'manager',   '["BL1","BL4"]'],
  ['usr_7a0bf6292aa9339a','nmartinez@retjg.com',        'manager',   '["BL1","BL4"]'],
];
const ins = db.prepare('INSERT INTO users (id,email,role,stores,status,created_at) VALUES (?,?,?,?,?,?)');
USERS.forEach(u => ins.run(...u, 'active', '2026-01-01'));

for (const s of statements(read('migration-030.sql'))) db.exec(s);

let fail = 0;
const ok = (n, c, d = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!c) fail++; };
const one = q => db.prepare(q).get();
const all = q => db.prepare(q).all();

console.log('tables + seed:');
ok('businesses seeded with Bargain Lane only',
   one("SELECT COUNT(*) c FROM businesses").c === 1, JSON.stringify(all('SELECT id,name,unit_noun FROM businesses')));
ok('E-Commerce deliberately NOT seeded',
   one("SELECT COUNT(*) c FROM businesses WHERE id='ecom'").c === 0);
ok('6 Bargain Lane units', one("SELECT COUNT(*) c FROM business_units WHERE business_id='bl'").c === 6);
ok('retired BL12 absent', one("SELECT COUNT(*) c FROM business_units WHERE id='BL12'").c === 0);

console.log('\nbackfill — nobody may be left without access:');
const nonSuper = one("SELECT COUNT(*) c FROM users WHERE role <> 'superuser'").c;
const grants   = one("SELECT COUNT(*) c FROM user_grants").c;
ok('one grant per non-superuser user', grants === nonSuper, `${grants} grants / ${nonSuper} users`);
ok('superuser holds NO grant (it is a flag, not a row)',
   one("SELECT COUNT(*) c FROM user_grants WHERE user_id='usr_superuser_001'").c === 0);

const orphaned = all(`SELECT u.email FROM users u
  LEFT JOIN user_grants g ON g.user_id = u.id
  WHERE u.role <> 'superuser' AND g.user_id IS NULL`);
ok('no non-superuser left without a grant', orphaned.length === 0,
   orphaned.map(r => r.email).join(', ') || 'none');

console.log('\nscope carried over exactly:');
const chk = (email, units) => {
  const r = one(`SELECT g.units FROM user_grants g JOIN users u ON u.id=g.user_id WHERE u.email='${email}'`);
  ok(`${email} → ${units === null ? 'all units' : units}`, r.units === units, String(r.units));
};
chk('alyson@bargainlane.com', '["BL1","BL4"]');
chk('aalbert@bargainlane.com', '["BL2"]');
chk('csemancik@bargainlane.com', '["BL16"]');
chk('bgeorges@retjg.com', null);   // admin: NULL still means every unit

const roleMismatch = all(`SELECT u.email FROM users u JOIN user_grants g ON g.user_id=u.id
                          WHERE u.role <> g.role`);
ok('grant role matches the user role for everyone', roleMismatch.length === 0,
   roleMismatch.map(r => r.email).join(', ') || 'none');

console.log('\nreferential integrity:');
const badUnits = all(`SELECT g.user_id, j.value FROM user_grants g, json_each(g.units) j
                      WHERE g.units IS NOT NULL AND j.value NOT IN (SELECT id FROM business_units)`);
ok('every granted unit exists in business_units', badUnits.length === 0,
   badUnits.map(r => r.value).join(', ') || 'none');

let fkBiz = false;
try { db.prepare("INSERT INTO user_grants (user_id,business_id,role) VALUES ('usr_superuser_001','nope','manager')").run(); }
catch (e) { fkBiz = true; }
ok('cannot grant a business that does not exist', fkBiz);

let badRole = false;
try { db.prepare("INSERT INTO user_grants (user_id,business_id,role) VALUES ('usr_superuser_001','bl','superuser')").run(); }
catch (e) { badRole = true; }
ok("CHECK rejects 'superuser' as a grant role", badRole);

let dupe = false;
try { db.prepare("INSERT INTO user_grants (user_id,business_id,role) VALUES ('usr_282bf5da5e2124b1','bl','manager')").run(); }
catch (e) { dupe = true; }
ok('one grant per user per business (PK holds)', dupe);

console.log('\ndeleting a user takes their grants with them:');
const before = one("SELECT COUNT(*) c FROM user_grants").c;
db.prepare("DELETE FROM users WHERE email='aalbert@bargainlane.com'").run();
const after = one("SELECT COUNT(*) c FROM user_grants").c;
ok('grant cascades on user delete', after === before - 1, `${before} → ${after}`);

console.log('\nre-running the migration is safe:');
for (const s of statements(read('migration-030.sql'))) db.exec(s);
ok('idempotent — no duplicate businesses', one("SELECT COUNT(*) c FROM businesses").c === 1);
ok('idempotent — no duplicate units', one("SELECT COUNT(*) c FROM business_units").c === 6);
ok('idempotent — deleted user is NOT resurrected as a grant',
   one("SELECT COUNT(*) c FROM user_grants").c === after, `${after} still`);

console.log(fail ? `\n${fail} FAILED` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
