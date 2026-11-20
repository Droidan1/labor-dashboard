// delete-user must not wipe a person's supply requests (2026-11-20).
//
// supply_requests.user_id is `REFERENCES users(id) ON DELETE CASCADE` (migration-011), and
// supply_request_items / supply_request_history cascade from supply_requests. So a hard
// `DELETE FROM users` silently deleted every request that person ever submitted, with its lines
// and its fulfilment history: the store's record of what it ordered and what it cost. Found while
// mapping the schema for the infrastructure review; no incident yet.
//
// The fix refuses the delete while the person has requests on file and says to suspend instead
// (suspending removes access and keeps the history). A person with no requests still deletes.
// Driven through the REAL worker.fetch against real sqlite with foreign keys ON and the REAL
// migration-011 tables, because the harness's own supply_requests has no foreign key and would
// hide the cascade.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, ctx, req, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : `  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`}`);

blockNetwork();
const worker = await loadWorker(repo);
const call = (url, opts = {}) => worker.fetch(req(url, opts), opts.env, ctx);
const json = async (r) => { try { return await r.json(); } catch { return {}; } };

function world() {
  const { db, env } = makeEnv(repo);
  // Swap the harness's simplified supply_requests for the production tables, cascade included.
  db.exec('DROP TABLE supply_requests;');
  db.exec(fs.readFileSync(path.join(repo, 'migration-011.sql'), 'utf8'));
  applyMigrationAlters(db, repo);
  // u-mgr1 has a request on file, with one line and one history entry.
  db.prepare("INSERT INTO supply_requests (id,user_id,user_email,store,status,submitted_at,updated_at) VALUES ('req-1','u-mgr1','howardbrian260@gmail.com','BL1','fulfilled','2026-11-01','2026-11-02')").run();
  db.prepare("INSERT INTO supply_request_items (id,request_id,item_name,quantity) VALUES ('item-1','req-1','Receipt paper',4)").run();
  db.prepare("INSERT INTO supply_request_history (id,request_id,changed_by_id,changed_by_email,old_status,new_status,changed_at) VALUES ('hist-1','req-1','u-su','bhoward@bargainlane.com','pending','fulfilled','2026-11-02')").run();
  return { db, env };
}
const count = (db, sql, ...p) => db.prepare(sql).get(...p).n;

console.log('the real tables cascade (so the guard is what protects them)');
{
  const { db } = world();
  ok(db.prepare("PRAGMA foreign_key_list(supply_requests)").all().some(f => f.table === 'users' && f.on_delete === 'CASCADE'),
    'supply_requests.user_id → users is ON DELETE CASCADE, as in production');
}

console.log('delete-user on a person with supply requests');
{
  const { db, env } = world();
  const r = await call('/?action=delete-user', { user: 'u-su', method: 'POST', body: { id: 'u-mgr1' }, env });
  const body = await json(r);
  eq(r.status, 409, 'is refused with 409');
  ok(body.ok !== true && /suspend/i.test(body.error || ''), `…with an error that says to suspend instead (${JSON.stringify(body.error)})`);
  ok(/1 supply request\b/.test(body.error || ''), '…and says how many requests are on file');
  eq(count(db, "SELECT COUNT(*) n FROM users WHERE id = 'u-mgr1'"), 1, 'the account is still there');
  eq(count(db, "SELECT COUNT(*) n FROM supply_requests WHERE user_id = 'u-mgr1'"), 1, 'their supply request survives');
  eq(count(db, "SELECT COUNT(*) n FROM supply_request_items WHERE request_id = 'req-1'"), 1, '…with its line');
  eq(count(db, "SELECT COUNT(*) n FROM supply_request_history WHERE request_id = 'req-1'"), 1, '…and its history');
  eq(count(db, "SELECT COUNT(*) n FROM sessions WHERE user_id = 'u-mgr1'"), 1, 'nothing else about the account was touched');
}

console.log('delete-user on a person with no supply requests');
{
  const { db, env } = world();
  const r = await call('/?action=delete-user', { user: 'u-su', method: 'POST', body: { id: 'u-mgr2' }, env });
  eq(r.status, 200, 'still deletes');
  eq((await json(r)).ok, true, '…and answers ok');
  eq(count(db, "SELECT COUNT(*) n FROM users WHERE id = 'u-mgr2'"), 0, 'the account is gone');
  eq(count(db, "SELECT COUNT(*) n FROM sessions WHERE user_id = 'u-mgr2'"), 0, '…and its sessions cascade, as before');
  eq(count(db, "SELECT COUNT(*) n FROM supply_requests"), 1, "someone else's request is untouched");
}

console.log('the existing guards still hold');
{
  const { db, env } = world();
  const a = await call('/?action=delete-user', { user: 'u-admin', method: 'POST', body: { id: 'u-mgr2' }, env });
  eq(a.status, 403, 'an admin cannot delete');
  const s = await call('/?action=delete-user', { user: 'u-su', method: 'POST', body: { id: 'u-su' }, env });
  eq(s.status, 400, 'the superuser cannot delete their own account');
  eq(count(db, "SELECT COUNT(*) n FROM users WHERE id IN ('u-mgr2','u-su')"), 2, 'neither refused call removed anyone');
  const g = await call('/?action=delete-user', { user: 'u-su', method: 'POST', body: { id: 'u-nobody' }, env });
  eq(g.status, 200, 'deleting an id that does not exist still answers ok, as it did before');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
