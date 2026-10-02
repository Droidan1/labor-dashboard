// migration-076: ob_buy_stores, as production will get it.
//
// What has to hold, and why:
//   - the five columns the worker names, NOT NULL where it relies on a value;
//   - (po, store) is the PRIMARY KEY: one number per store per buy, so an edit can never
//     leave two competing counts for a store;
//   - no FOREIGN KEY to ob_buys: on D1 a parent rebuild cascades whatever PRAGMA says;
//   - the file is additive and re-runnable: a second run changes nothing.
process.removeAllListeners('warning');   // node:sqlite is experimental in this Node; keep the output clean
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const SQL = fs.readFileSync(path.join(repo, 'migration-076.sql'), 'utf8');
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');   // as D1 runs
db.exec(SQL);

const cols = db.prepare("SELECT name, type, \"notnull\" AS nn, pk FROM pragma_table_info('ob_buy_stores') ORDER BY cid").all()
  .map(c => [c.name, c.type, c.nn, c.pk]);
eq(cols, [['po', 'TEXT', 1, 1], ['store', 'TEXT', 1, 2], ['units', 'INTEGER', 1, 0],
          ['updated_by', 'TEXT', 0, 0], ['updated_at', 'TEXT', 1, 0]],
   'ob_buy_stores has the 5 columns the worker names, keyed on (po, store)');
eq(db.prepare("SELECT COUNT(*) AS n FROM pragma_foreign_key_list('ob_buy_stores')").get().n, 0,
   'no FOREIGN KEY to ob_buys (a parent rebuild on D1 would cascade into it)');

const put = (po, store, units) => db.prepare(
  'INSERT INTO ob_buy_stores (po, store, units, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)')
  .run(po, store, units, 'a@x', '2026-10-02T15:00:00Z');
const refused = (fn) => { try { fn(); return null; } catch (e) { return String(e.message); } };
ok(refused(() => put('12345', 'BL1', 120)) === null, 'a well-formed row goes in');
ok(refused(() => put('12345', 'BL2', 90)) === null, '…and another store of the same buy');
ok(/UNIQUE|PRIMARY/i.test(refused(() => put('12345', 'BL1', 5)) || ''),
   '🛑 a second count for the same store of the same buy is refused by the database itself');
ok(/NOT NULL/i.test(refused(() => put('12345', 'BL4', null)) || ''), 'a row with no units is refused');

db.exec(SQL);   // a second run
eq(db.prepare('SELECT COUNT(*) AS n FROM ob_buy_stores').get().n, 2, 'running it again changes nothing and keeps the rows');
ok(!/\b(DROP|DELETE|UPDATE|ALTER)\b/i.test(SQL.replace(/^--.*$/gm, '')), 'additive only: no DROP, DELETE, UPDATE or ALTER outside comments');

console.log(fail ? `\n${fail} of ${pass + fail} FAILED` : `\n${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
