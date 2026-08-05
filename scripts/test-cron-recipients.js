// The daily summary and weekly digest build ONE chain-wide body and send it to
// everyone on the recipient list, so the list IS the access control.
//
// This runs the REAL chainWideRecipients() against real sqlite seeded with the
// REAL production user shape, and asserts that no store-scoped user is on it.
// Unlike the regex-style harnesses, this executes the actual function against a
// real database — the audit's central criticism was that nothing did.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const REPO = process.argv[2] || '.';
const src = fs.readFileSync(path.join(REPO, 'worker.js'), 'utf8');

const grab = (re, label) => {
  const m = src.match(re);
  if (!m) { console.error(`FATAL: ${label} not found in worker.js`); process.exit(1); }
  return m[0];
};
const mod = new Function(
  grab(/function grantFor\(user, businessId\) \{[\s\S]*?\n\}/, 'grantFor') + '\n' +
  grab(/function allowedStores\(user\) \{[\s\S]*?\n\}/, 'allowedStores') + '\n' +
  // ⚠️ Each of these is a TRANSITIVE dependency of chainWideRecipients that had
  // to be added by hand when the business check landed — the exact brittleness
  // this extraction style is known for. Prefer driving worker.scheduled.
  grab(/function grantedBusinessIds\(user\) \{[\s\S]*?\n\}/, 'grantedBusinessIds') + '\n' +
  grab(/function canAccessBusiness\(user, businessId\) \{[\s\S]*?\n\}/, 'canAccessBusiness') + '\n' +
  grab(/async function chainWideRecipients\(env\) \{[\s\S]*?\n\}/, 'chainWideRecipients') +
  '; return { chainWideRecipients, allowedStores };'
)();

const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL, stores TEXT, status TEXT NOT NULL, created_at TEXT);
CREATE TABLE user_grants (user_id TEXT NOT NULL, business_id TEXT NOT NULL,
  role TEXT NOT NULL, units TEXT, PRIMARY KEY (user_id, business_id));`);

// exact production shape, verified against prod 2026-08-04
const USERS = [
  ['usr_superuser_001','bhoward@bargainlane.com','superuser',null,'active'],
  ['u-adm1','bgeorges@retjg.com','admin',null,'active'],
  ['u-adm2','james@retjg.com','admin',null,'active'],
  ['u-adm3','kevin@retjg.com','admin',null,'active'],
  ['u-m1','aalbert@bargainlane.com','manager','["BL2"]','active'],
  ['u-m2','adara@bargainlane.com','manager','["BL14"]','active'],
  ['u-m3','alyson@bargainlane.com','manager','["BL1","BL4"]','active'],
  ['u-m4','csemancik@bargainlane.com','manager','["BL16"]','active'],
  ['u-m5','dupontleads@bargainlane.com','manager','["BL4"]','active'],
  ['u-m6','howardbrian260@gmail.com','manager','["BL1"]','active'],
  ['u-m7','jharvey@bargainlane.com','manager','["BL1","BL4"]','active'],
  ['u-m8','nmartinez@retjg.com','manager','["BL1","BL4"]','active'],
  // forward-looking roles that do not exist in prod yet
  ['u-exec','owner@retjg.com','executive',null,'active'],
  ['u-staff','lead@bargainlane.com','staff','["BL1"]','active'],
  // suspended admin must not be mailed at all
  ['u-susp','former@retjg.com','admin',null,'suspended'],
];
const ins = db.prepare('INSERT INTO users (id,email,role,stores,status,created_at) VALUES (?,?,?,?,?,?)');
USERS.forEach(u => ins.run(...u, '2026-01-01'));

// Grants, mirroring prod: every non-superuser holds bl; admins also hold ecom.
// u-adm3 is deliberately E-COMMERCE ONLY — the case the fix exists for.
const ig = db.prepare('INSERT INTO user_grants (user_id,business_id,role,units) VALUES (?,?,?,?)');
USERS.filter(u => u[2] !== 'superuser' && u[4] === 'active')
     .forEach(u => ig.run(u[0], 'bl', u[2], u[3]));
['u-adm1','u-adm2','u-adm3'].forEach(a => ig.run(a, 'ecom', 'admin', null));

const env = { DB: { prepare: sql => ({ all: async () => ({ results: db.prepare(sql).all() }) }) } };

let fail = 0;
const ok = (n, c, d = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!c) fail++; };

(async () => {
  const rcpt = await mod.chainWideRecipients(env);
  const emails = rcpt.map(r => r.email).sort();
  console.log('recipients of the chain-wide daily/weekly broadcast:');
  emails.forEach(e => console.log('   ', e));

  ok('superuser still included', emails.some(e => e.startsWith('bhoward@')),
     'checked by ROLE — canAccessBusiness reads allBusinessIds, which cron never sets');

  console.log('\nan admin holding NO Bargain Lane grant is excluded:');
  // Revoke kevin's bl grant, leaving him E-Commerce-only — the future shape this
  // fix exists for. allowedStores() still returns null for him (global-role
  // admin), so ONLY the business check can keep him off the list.
  db.prepare("DELETE FROM user_grants WHERE user_id='u-adm3' AND business_id='bl'").run();
  const after = (await mod.chainWideRecipients(env)).map(r => r.email);
  ok('kevin (ecom-only admin) excluded', !after.some(e => e.startsWith('kevin@')),
     'allowedStores() returns null for ANY global-role admin — needs canAccessBusiness');
  ok('the other two admins still included',
     after.some(e => e.startsWith('bgeorges@')) && after.some(e => e.startsWith('james@')));
  ok('recipients drop 4 -> 3', after.length === 3, `got ${after.length}`);

  console.log('\nnobody store-scoped receives chain-wide figures:');
  const scoped = ['aalbert','adara','alyson','csemancik','dupontleads','howardbrian260','jharvey','nmartinez'];
  for (const s of scoped) {
    ok(`${s} excluded`, !emails.some(e => e.startsWith(s + '@')));
  }
  ok('all 8 store-scoped managers excluded',
     emails.filter(e => scoped.some(s => e.startsWith(s + '@'))).length === 0);

  console.log('\nthe people who should get it, do:');
  ok('superuser included', emails.includes('bhoward@bargainlane.com'));
  for (const a of ['bgeorges@retjg.com', 'james@retjg.com', 'kevin@retjg.com']) {
    ok(`admin ${a} included`, emails.includes(a));
  }
  ok('exactly 4 recipients in the production shape', emails.length === 4, String(emails.length));

  console.log('\nfails closed for roles that do not exist yet:');
  ok('staff excluded (must never see money)', !emails.includes('lead@bargainlane.com'));
  ok('executive excluded rather than assumed chain-wide', !emails.includes('owner@retjg.com'));

  console.log('\nstatus is still honoured:');
  ok('suspended admin excluded', !emails.includes('former@retjg.com'));

  console.log('\nthe test would catch the regression it exists for:');
  const allActive = db.prepare("SELECT email FROM users WHERE status='active'").all().length;
  ok('the old unfiltered query would have returned far more', allActive > emails.length,
     `${allActive} active vs ${emails.length} eligible`);

  console.log(fail ? `\n${fail} FAILED` : '\nall assertions passed');
  process.exit(fail ? 1 : 0);
})();
