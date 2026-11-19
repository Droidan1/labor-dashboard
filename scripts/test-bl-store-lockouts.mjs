// scripts/sql/bl-store-lockouts.sql — READ-ONLY. Who holds a Bargain Lane grant
// but reaches NO Bargain Lane store.
//
// Until 2026-11-19 the Edit modal's "Every store" saved a Bargain Lane grant with
// units NULL, and allowedUnits() reads NULL (or an empty list) as NO stores for
// anyone below admin. This query finds the people that already happened to.
//
// 🔑 The query is checked against the ENFORCEMENT, not against a restatement of
// it: for every seeded user it must list exactly those whose real auth-me answer
// (worker.fetch → getAuthUser → allowedUnits) is an empty store list while they
// hold a Bargain Lane grant. A query that drifted from allowedUnits would pass a
// hand-written expectation and still miss people.
//
// The SQL file deliberately has NO leading `--` comment: run through
// `wrangler d1 execute --command=...`, a leading `--` is parsed as a flag.
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
db.exec(fs.readFileSync(path.join(repo, 'migration-031.sql'), 'utf8'));
if (!db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name='pin_hash'").get()) {
  db.exec('ALTER TABLE users ADD COLUMN pin_hash TEXT');
}
const sql = fs.readFileSync(path.join(repo, 'scripts/sql/bl-store-lockouts.sql'), 'utf8');
ok(!sql.trimStart().startsWith('--'), 'the SQL has no leading -- comment (wrangler would read it as a flag)');
ok(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE)\b/i.test(sql), 'the SQL only reads');

// Every shape a Bargain Lane grant can be in, beyond the harness's six users.
const seed = [
  // id,          role,        status,      bl grant role, bl units,        associate
  ['x-null',      'manager',   'active',    'manager',     null,             false], // the bug
  ['x-empty',     'manager',   'active',    'manager',     '[]',             false],
  ['x-junk',      'manager',   'active',    'manager',     '"BL1"',          false], // JSON, not an array
  ['x-bad',       'manager',   'active',    'manager',     'BL1',            false], // not JSON at all
  ['x-susp',      'manager',   'suspended', 'manager',     null,             false],
  ['x-assoc',     'staff',     'active',    'staff',       null,             true],
  ['x-ok',        'manager',   'active',    'manager',     '["BL2","BL4"]',  false],
  ['x-admin',     'admin',     'active',    'admin',       null,             false], // all stores by role
  ['x-ecomonly',  'manager',   'active',    null,          null,             false], // no bl grant at all
];
const insU = db.prepare('INSERT INTO users (id,email,role,stores,status,created_at,pin_hash) VALUES (?,?,?,?,?,?,?)');
const insG = db.prepare('INSERT INTO user_grants (user_id,business_id,role,units) VALUES (?,?,?,?)');
const insS = db.prepare('INSERT INTO sessions (id,user_id,expires_at,created_at) VALUES (?,?,?,?)');
const exp = new Date(Date.now() + 3600e3).toISOString();
for (const [id, role, status, blRole, units, assoc] of seed) {
  insU.run(id, `${id}@x.com`, role, null, status, '2026-01-01', assoc ? 'hash' : null);
  if (blRole) insG.run(id, 'bl', blRole, units);
  else insG.run(id, 'ecom', role, null);
  insS.run('sess-' + id, id, exp, exp);
}

const listed = db.prepare(sql).all();
const listedIds = listed.map(r => r.id).sort();

// What the worker actually enforces, per user, through the real auth-me.
const everyone = db.prepare("SELECT u.id FROM users u WHERE u.role <> 'superuser'").all().map(r => r.id);
const lockedOut = [];
for (const id of everyone) {
  // Suspended users cannot sign in, so auth-me cannot speak for them: judge them
  // by what their grant WOULD give, by reactivating them for this one read.
  const susp = db.prepare("SELECT status FROM users WHERE id = ?").get(id).status === 'suspended';
  if (susp) db.prepare("UPDATE users SET status='active' WHERE id = ?").run(id);
  const r = await worker.fetch(req('/?action=auth-me', { user: id }), env, ctx);
  const me = JSON.parse(await r.text());
  if (susp) db.prepare("UPDATE users SET status='suspended' WHERE id = ?").run(id);
  const holdsBl = !!db.prepare("SELECT 1 FROM user_grants WHERE user_id = ? AND business_id = 'bl'").get(id);
  if (holdsBl && Array.isArray(me.stores) && me.stores.length === 0) lockedOut.push(id);
}
lockedOut.sort();

ok(listedIds.join() === lockedOut.join(),
   `🔑 the query lists exactly who the worker locks out — query [${listedIds}] vs enforced [${lockedOut}]`);
for (const id of ['x-null', 'x-empty', 'x-junk', 'x-bad', 'x-susp', 'x-assoc', 'u-exec']) {
  ok(listedIds.includes(id), `${id} is listed`);
}
for (const id of ['x-ok', 'x-admin', 'x-ecomonly', 'u-admin', 'u-mgr1', 'u-su']) {
  ok(!listedIds.includes(id), `${id} is NOT listed`);
}
const row = listed.find(r => r.id === 'x-assoc');
ok(row && row.associate === 1, 'an associate is flagged as one (they are fixed from the Associates panel)');
ok(listed.find(r => r.id === 'x-susp').status === 'suspended', 'status is shown, so suspended rows can be told apart');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
