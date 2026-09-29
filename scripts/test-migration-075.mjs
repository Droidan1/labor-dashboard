// migration-075: the saved_signs table, as production will get it.
//
// What has to hold, and why:
//   - every column the worker names, with the NOT NULLs the worker relies on;
//   - the client's id is the PRIMARY KEY: that constraint IS the duplicate-save guard
//     ("Five copies in one store", tasks/lessons.md), not a read-then-write check;
//   - no FOREIGN KEY to users and no CHECK on the enum-like columns (migration-029 and
//     migration-062 say why), so a later rebuild of users can't cascade into saved signs;
//   - both partial indexes exist with the predicates the worker's literal WHERE clauses imply,
//     and the folder queries actually use them, with no sort step on the list;
//   - the file is additive and re-runnable: IF NOT EXISTS everywhere, and a second run adds
//     nothing.
process.removeAllListeners('warning');   // node:sqlite is experimental in this Node; keep the output clean
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const SQL = fs.readFileSync(path.join(repo, 'migration-075.sql'), 'utf8');
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');   // as D1 runs
db.exec(SQL);

// ── The table ────────────────────────────────────────────────────────────────
const cols = db.prepare("SELECT name, type, \"notnull\" AS nn, pk FROM pragma_table_info('saved_signs') ORDER BY cid").all()
  .map(c => [c.name, c.type, c.nn, c.pk]);
eq(cols, [
  ['id', 'TEXT', 0, 1], ['owner_id', 'TEXT', 1, 0], ['owner_email', 'TEXT', 1, 0], ['scope', 'TEXT', 1, 0],
  ['template', 'TEXT', 1, 0], ['saved_month', 'TEXT', 1, 0], ['sign_json', 'TEXT', 1, 0],
  ['design_version', 'INTEGER', 1, 0], ['saved_at', 'TEXT', 1, 0], ['deleted_at', 'TEXT', 0, 0], ['deleted_by', 'TEXT', 0, 0],
], 'saved_signs has the 11 columns the worker names, NOT NULL where it relies on a value');
eq(db.prepare("SELECT COUNT(*) AS n FROM pragma_foreign_key_list('saved_signs')").get().n, 0, 'no FOREIGN KEY to users (migration-029: a rebuilt users table would cascade)');
const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'saved_signs'").get().sql;
ok(!/\bCHECK\b/i.test(tableSql), 'no CHECK constraint on the enum-like columns (migration-062); the worker is the gate');

const row = (over = {}) => Object.assign({ id: '0b7f1e2a-5c3d-4e6f-8a9b-0c1d2e3f4a5b', owner_id: 'u-mgr1', owner_email: 'm@x', scope: 'own',
  template: 'price', saved_month: '2026-09', sign_json: '{}', design_version: 2, saved_at: '2026-09-29T15:00:00.000Z' }, over);
const insert = r => db.prepare(`INSERT INTO saved_signs (id, owner_id, owner_email, scope, template, saved_month, sign_json, design_version, saved_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(r.id, r.owner_id, r.owner_email, r.scope, r.template, r.saved_month, r.sign_json, r.design_version, r.saved_at);
const refused = (fn) => { try { fn(); return null; } catch (e) { return String(e.message); } };
ok(refused(() => insert(row())) === null, 'a well-formed row goes in');
ok(/UNIQUE|PRIMARY/i.test(refused(() => insert(row({ owner_id: 'u-mgr2' }))) || ''), '🛑 a second row with the same id is refused by the database itself: the idempotency key holds under any interleaving');
ok(/NOT NULL/i.test(refused(() => insert(row({ id: 'a1', owner_id: null }))) || ''), 'a row with no owner is refused');
ok(/NOT NULL/i.test(refused(() => insert(row({ id: 'a2', saved_month: null }))) || ''), 'a row with no month folder is refused');
eq(db.prepare("SELECT deleted_at, deleted_by FROM saved_signs WHERE id = ?").get(row().id), { deleted_at: null, deleted_by: null }, 'a new row is live: deleted_at and deleted_by default to NULL');

// ── The indexes ──────────────────────────────────────────────────────────────
const idx = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'saved_signs' AND sql IS NOT NULL ORDER BY name").all();
eq(idx.map(i => i.name), ['idx_saved_signs_all', 'idx_saved_signs_own'], 'the two folder indexes exist');
const pred = name => ((idx.find(i => i.name === name) || {}).sql || '').replace(/\s+/g, ' ');
ok(/\(owner_id, template, saved_month, saved_at\) WHERE scope = 'own' AND deleted_at IS NULL$/.test(pred('idx_saved_signs_own')), `own index: owner, type, month, time, over live own rows (${pred('idx_saved_signs_own')})`);
ok(/\(template, saved_month, saved_at\) WHERE scope = 'all' AND deleted_at IS NULL$/.test(pred('idx_saved_signs_all')), `all index: type, month, time, over live All stores rows (${pred('idx_saved_signs_all')})`);

// The shapes the worker runs (scripts/test-saved-signs.mjs EXPLAINs the worker's own strings).
const plan = (sql, ...b) => db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...b).map(r => r.detail).join(' | ');
const P = {
  ownCounts: plan(`SELECT template, saved_month AS month, COUNT(*) AS n FROM saved_signs WHERE scope = 'own' AND deleted_at IS NULL AND owner_id = ? GROUP BY template, saved_month`, 'u'),
  allCounts: plan(`SELECT template, saved_month AS month, COUNT(*) AS n FROM saved_signs WHERE scope = 'all' AND deleted_at IS NULL GROUP BY template, saved_month`),
  ownList: plan(`SELECT id FROM saved_signs WHERE scope = 'own' AND deleted_at IS NULL AND owner_id = ? AND template = ? AND saved_month = ? ORDER BY saved_at DESC, rowid DESC LIMIT ?`, 'u', 'price', '2026-09', 101),
  allList: plan(`SELECT id FROM saved_signs WHERE scope = 'all' AND deleted_at IS NULL AND template = ? AND saved_month = ? ORDER BY saved_at DESC, rowid DESC LIMIT ?`, 'price', '2026-09', 101),
};
ok(/USING (COVERING )?INDEX idx_saved_signs_own \(owner_id=\?\)/.test(P.ownCounts), `a manager's folder counts seek their own rows by owner (${P.ownCounts})`);
ok(/USING (COVERING )?INDEX idx_saved_signs_all/.test(P.allCounts), `All stores counts read the All stores index, not the table (${P.allCounts})`);
ok(/INDEX idx_saved_signs_own \(owner_id=\? AND template=\? AND saved_month=\?\)/.test(P.ownList) && !/TEMP B-TREE/.test(P.ownList), `one own folder is a seek, newest first with no sort step (${P.ownList})`);
ok(/INDEX idx_saved_signs_all \(template=\? AND saved_month=\?\)/.test(P.allList) && !/TEMP B-TREE/.test(P.allList), `one All stores folder is a seek, newest first with no sort step (${P.allList})`);

// ── Additive and re-runnable ─────────────────────────────────────────────────
const statements = SQL.replace(/--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean);
ok(statements.length === 3 && statements.every(s => /^CREATE (TABLE|INDEX) IF NOT EXISTS\b/i.test(s)),
   `the file is three CREATE … IF NOT EXISTS statements and nothing else (${statements.map(s => s.split('\n')[0]).join(' / ')})`);
const objects = () => db.prepare("SELECT type, name FROM sqlite_master ORDER BY type, name").all().map(o => `${o.type}:${o.name}`).join(',');
const before = objects();
ok(refused(() => db.exec(SQL)) === null, 'running it a second time does not fail');
eq(objects(), before, 'and changes nothing');
eq(db.prepare('SELECT COUNT(*) AS n FROM saved_signs').get().n, 1, 'and keeps the row that was already there');
// Against a database that already has the rest of the app, it adds exactly one table and two indexes.
const other = new DatabaseSync(':memory:');
other.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT); CREATE TABLE sticker_prints (id INTEGER PRIMARY KEY, printed_by TEXT);");
const had = other.prepare("SELECT name FROM sqlite_master").all().map(o => o.name).sort();
other.exec(SQL);
// (sqlite_autoindex_saved_signs_1 is the TEXT primary key's own index: SQLite makes one for any
// primary key that is not the rowid.)
eq(other.prepare("SELECT name FROM sqlite_master").all().map(o => o.name).filter(n => !had.includes(n)).sort(),
   ['idx_saved_signs_all', 'idx_saved_signs_own', 'saved_signs', 'sqlite_autoindex_saved_signs_1'],
   'on an existing database it adds the table, its primary key index and the two folder indexes, and touches nothing else');
eq(other.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'saved_signs' AND sql IS NOT NULL ORDER BY name").all().map(o => o.name),
   ['idx_saved_signs_all', 'idx_saved_signs_own'], "the header's confirm query lists exactly the two folder indexes");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
