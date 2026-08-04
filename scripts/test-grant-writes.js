// Prove the grant stays in step with users.role / users.stores across invite
// and edit, using the REAL upsert extracted from worker.js against real sqlite.
//
// The trap being guarded: update-user takes `role` and `stores` as INDEPENDENT
// optional fields. An edit that changes only the role must not blank the units,
// and vice versa. Trusting the request body would do exactly that.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const REPO = process.argv[2] || '.';
const src = fs.readFileSync(path.join(REPO, 'worker.js'), 'utf8');
const statements = sql => sql
  .split('\n').map(l => l.replace(/--.*$/, '')).join('\n')
  .split(';').map(s => s.trim()).filter(Boolean);

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
db.exec(`CREATE TABLE users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('superuser','admin','executive','manager','staff')),
  stores TEXT, status TEXT NOT NULL DEFAULT 'active', title TEXT,
  created_at TEXT NOT NULL, last_login TEXT);`);
for (const s of statements(fs.readFileSync(path.join(REPO, 'migration-030.sql'), 'utf8'))) {
  try { db.exec(s); } catch (e) { if (!/no such table: users/.test(e.message)) throw e; }
}

// The real upsert, with env.DB shimmed onto sqlite.
const m = src.match(/async function upsertBargainLaneGrant\(env, userId, role, storesJson\) \{[\s\S]*?\n\}/);
if (!m) { console.error('FATAL: could not extract upsertBargainLaneGrant'); process.exit(1); }
const upsert = new Function(`${m[0]}; return upsertBargainLaneGrant;`)();
const env = { DB: { prepare: sql => ({ bind: (...a) => ({ run: async () => db.prepare(sql).run(...a) }) }) } };

let fail = 0;
const ok = (n, c, d = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!c) fail++; };
const grant = id => db.prepare('SELECT role, units FROM user_grants WHERE user_id=? AND business_id=?').get(id, 'bl');

const mkUser = (id, role, stores) =>
  db.prepare('INSERT INTO users (id,email,role,stores,status,created_at) VALUES (?,?,?,?,?,?)')
    .run(id, id + '@x.com', role, stores, 'active', '2026-08-04');

(async () => {
  console.log('invite writes a grant:');
  mkUser('u-new', 'manager', '["BL8"]');
  await upsert(env, 'u-new', 'manager', '["BL8"]');
  let g = grant('u-new');
  ok('new user holds a Bargain Lane grant', !!g);
  ok('role mirrored', g.role === 'manager', g.role);
  ok('units mirrored verbatim', g.units === '["BL8"]', g.units);

  console.log('\nan admin invite gets NULL units (= all stores):');
  mkUser('u-admin', 'admin', null);
  await upsert(env, 'u-admin', 'admin', null);
  g = grant('u-admin');
  ok('admin grant has NULL units', g.units === null, String(g.units));

  console.log('\nediting only the ROLE must not blank the units:');
  db.prepare("UPDATE users SET role='executive' WHERE id='u-new'").run();
  const after1 = db.prepare("SELECT role, stores FROM users WHERE id='u-new'").get();
  await upsert(env, 'u-new', after1.role, after1.stores);   // re-read, as the worker does
  g = grant('u-new');
  ok('role updated', g.role === 'executive', g.role);
  ok('units SURVIVED the role-only edit', g.units === '["BL8"]', String(g.units));

  console.log('\nediting only the STORES must not change the role:');
  db.prepare(`UPDATE users SET stores='["BL1","BL4"]' WHERE id='u-new'`).run();
  const after2 = db.prepare("SELECT role, stores FROM users WHERE id='u-new'").get();
  await upsert(env, 'u-new', after2.role, after2.stores);
  g = grant('u-new');
  ok('units updated', g.units === '["BL1","BL4"]', String(g.units));
  ok('role SURVIVED the stores-only edit', g.role === 'executive', g.role);

  console.log('\nupsert is idempotent and does not duplicate:');
  await upsert(env, 'u-new', after2.role, after2.stores);
  ok('still exactly one grant for this user',
     db.prepare("SELECT COUNT(*) c FROM user_grants WHERE user_id='u-new'").get().c === 1);

  console.log('\nsuperuser is never granted:');
  mkUser('u-su', 'superuser', null);
  await upsert(env, 'u-su', 'superuser', null);
  ok('no grant row written for a superuser',
     db.prepare("SELECT COUNT(*) c FROM user_grants WHERE user_id='u-su'").get().c === 0);

  console.log('\na failing upsert must not throw (invite is already committed):');
  const badEnv = { DB: { prepare: () => ({ bind: () => ({ run: async () => { throw new Error('D1 down'); } }) }) } };
  let threw = false;
  try { await upsert(badEnv, 'u-new', 'manager', null); } catch (_) { threw = true; }
  ok('swallows the error rather than failing the request', !threw);

  console.log(fail ? `\n${fail} FAILED` : '\nall assertions passed');
  process.exit(fail ? 1 : 0);
})();
