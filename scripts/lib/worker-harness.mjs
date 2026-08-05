// Test rig that loads the REAL worker module and drives it with REAL Request
// objects through worker.fetch().
//
// Everything else in scripts/ tests pure functions pulled out with a regex, or
// greps source text. That leaves the WIRING untested — whether a handler
// actually calls the scope check it is supposed to — which is precisely how two
// endpoints shipped serving every store's data to a single-store manager while
// the whole suite stayed green.
//
// Nothing here stubs the code under test. Only the platform is stubbed: D1
// (backed by real sqlite), KV, R2 and outbound fetch.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

// worker.js is `export default {...}` but package.json says commonjs, so Node
// will not import it directly. Copy to .mjs and import that — the bytes are
// identical, which matters: the harness must test the shipped file.
export async function loadWorker(repo) {
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const tmp = path.join(os.tmpdir(), `worker-under-test-${src.length}.mjs`);
  fs.writeFileSync(tmp, src);
  const mod = await import(pathToFileURL(tmp).href + `?v=${src.length}`);
  return mod.default;
}

// Faithful-enough D1 shim over real sqlite: prepare().bind().all()/first()/run().
function d1(db) {
  return {
    prepare(sql) {
      const mk = (params) => ({
        bind: (...p) => mk(p),
        all: async () => {
          try { return { results: db.prepare(sql).all(...params), success: true }; }
          catch (e) { if (/^\s*(INSERT|UPDATE|DELETE|CREATE|DROP)/i.test(sql)) { db.prepare(sql).run(...params); return { results: [], success: true }; } throw e; }
        },
        first: async () => { const r = db.prepare(sql).all(...params); return r.length ? r[0] : null; },
        run: async () => { db.prepare(sql).run(...params); return { success: true, meta: {} }; },
      });
      return mk([]);
    },
    batch: async (stmts) => Promise.all(stmts.map(s => s.run())),
  };
}

function kv() {
  const m = new Map();
  return {
    get: async (k, opt) => { const v = m.get(k); if (v === undefined) return null; return opt === 'json' || opt?.type === 'json' ? JSON.parse(v) : v; },
    put: async (k, v) => { m.set(k, typeof v === 'string' ? v : JSON.stringify(v)); },
    delete: async (k) => { m.delete(k); },
    list: async () => ({ keys: [...m.keys()].map(name => ({ name })), list_complete: true }),
    _map: m,
  };
}

export const SCHEMA = `
CREATE TABLE users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('superuser','admin','executive','manager','staff')),
  stores TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  title TEXT, created_at TEXT NOT NULL, last_login TEXT);
CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE businesses (id TEXT PRIMARY KEY, name TEXT NOT NULL, unit_noun TEXT NOT NULL, source TEXT, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE business_units (id TEXT PRIMARY KEY, business_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE user_grants (user_id TEXT NOT NULL, business_id TEXT NOT NULL, role TEXT NOT NULL, units TEXT, PRIMARY KEY (user_id, business_id));
CREATE TABLE daily_sales (id INTEGER PRIMARY KEY AUTOINCREMENT, store TEXT NOT NULL, date TEXT NOT NULL,
  total REAL, retail REAL, bin REAL, order_count INTEGER, avg_cart REAL, avg_items REAL, avg_txn_sec INTEGER,
  snapshot_time TEXT, UNIQUE(store, date));
CREATE TABLE last_year_sales (store TEXT NOT NULL, date TEXT NOT NULL, retail REAL NOT NULL DEFAULT 0, bin REAL NOT NULL DEFAULT 0, PRIMARY KEY (store,date));
CREATE TABLE notification_preferences (user_id TEXT PRIMARY KEY, push_enabled INTEGER DEFAULT 1, daily_summary INTEGER DEFAULT 1, weekly_digest INTEGER DEFAULT 1, interval_summary TEXT DEFAULT 'off', upload_alerts INTEGER DEFAULT 1);
CREATE TABLE push_subscriptions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, endpoint TEXT, p256dh TEXT, auth TEXT, created_at TEXT);
CREATE TABLE supply_requests (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, user_email TEXT NOT NULL, store TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', priority TEXT NOT NULL DEFAULT 'normal', invoice_number TEXT, cost REAL, notes TEXT,
  submitted_at TEXT, updated_at TEXT);
CREATE TABLE magic_links (token TEXT PRIMARY KEY, email TEXT, expires_at TEXT);
`;

export const STORES = ['BL1', 'BL2', 'BL4', 'BL8', 'BL14', 'BL16'];

// The real production user shape, verified against prod 2026-08-04, plus the
// two roles that exist but are not yet granted.
export const USERS = [
  ['u-su',    'bhoward@bargainlane.com',  'superuser', null],
  ['u-admin', 'bgeorges@retjg.com',       'admin',     null],
  ['u-mgr1',  'howardbrian260@gmail.com', 'manager',   '["BL1"]'],
  ['u-mgr2',  'alyson@bargainlane.com',   'manager',   '["BL1","BL4"]'],
  ['u-exec',  'owner@retjg.com',          'executive', null],
  ['u-staff', 'lead@bargainlane.com',     'staff',     '["BL1"]'],
];

// Columns that daily_sales and friends gained through migrations. Read from the
// repo's own .sql rather than restated here, so a column added by a future
// migration cannot silently desync the harness from production — that desync
// would show up as a confusing 500 rather than as a real failure.
function applyMigrationAlters(db, repo) {
  const files = fs.readdirSync(repo).filter(f => /^migration-\d+\.sql$/.test(f)).sort();
  const seen = new Set();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(repo, f), 'utf8');
    for (const m of sql.matchAll(/ALTER TABLE\s+\w+\s+ADD COLUMN\s+[^;]+;/gi)) {
      if (seen.has(m[0])) continue;
      seen.add(m[0]);
      // Tolerated: the column may already exist, or belong to a table this
      // harness does not create. A genuinely broken statement surfaces as a
      // failing assertion downstream, not here.
      try { db.exec(m[0]); } catch (_) {}
    }
  }
}

export function makeEnv(repo = '.') {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  applyMigrationAlters(db, repo);

  const ins = db.prepare('INSERT INTO users (id,email,role,stores,status,created_at) VALUES (?,?,?,?,?,?)');
  USERS.forEach(u => ins.run(...u, 'active', '2026-01-01'));

  db.prepare("INSERT INTO businesses (id,name,unit_noun,source,active) VALUES ('bl','Bargain Lane','store','clover',1)").run();
  const iu = db.prepare('INSERT INTO business_units (id,business_id,code,name) VALUES (?,?,?,?)');
  STORES.forEach(s => iu.run(s, 'bl', s, s));
  const ig = db.prepare('INSERT INTO user_grants (user_id,business_id,role,units) VALUES (?,?,?,?)');
  USERS.filter(u => u[2] !== 'superuser').forEach(u => ig.run(u[0], 'bl', u[2], u[3]));

  // sessions, one per user, id = 'sess-<userid>'
  const exp = new Date(Date.now() + 3600e3).toISOString();
  const isx = db.prepare('INSERT INTO sessions (id,user_id,expires_at,created_at) VALUES (?,?,?,?)');
  USERS.forEach(u => isx.run('sess-' + u[0], u[0], exp, exp));

  // sales data for every store, so a scoping bug shows up as extra stores in a body
  const today = new Date().toISOString().slice(0, 10);
  const ids = db.prepare('INSERT INTO daily_sales (store,date,total,retail,bin,order_count,budget) VALUES (?,?,?,?,?,?,?)');
  const ily = db.prepare('INSERT INTO last_year_sales (store,date,retail,bin) VALUES (?,?,?,?)');
  STORES.forEach((s, i) => {
    ids.run(s, today, 1000 + i, 700 + i, 300, 50 + i, 1200 + i);
    ily.run(s, '2025-07-01', 400 + i, 100 + i);
  });

  return {
    db,
    env: {
      DB: d1(db),
      SALES_SNAPSHOTS: kv(),
      MEDIA: { get: async () => null, put: async () => ({}), delete: async () => {} },
      // Deliberately NOT the real secret — a request must not accidentally take
      // the isAdminSecret bypass and skip every check we are trying to observe.
      SNAPSHOT_SECRET: 'harness-secret-not-used',
      VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '',
      RESEND_API_KEY: '', ANTHROPIC_API_KEY: '',
    },
  };
}

export const ctx = { waitUntil: (p) => { if (p && typeof p.catch === 'function') p.catch(() => {}); }, passThroughOnException: () => {} };

// Block all outbound network. Anything reaching Clover/Meta/Resend in a test is
// a bug in the test, and a silent real call would be worse.
export function blockNetwork() {
  globalThis.fetch = async (u) => { throw new Error('outbound fetch blocked in harness: ' + String(u).slice(0, 80)); };
}

export function req(url, { user, method = 'GET', body, secret } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (user) h.Cookie = `session=sess-${user}`;
  if (secret) h['X-Snapshot-Secret'] = secret;
  return new Request('https://api.retjghub.com' + url, {
    method, headers: h, body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Which store codes appear anywhere in the response body.
export function storesIn(text) {
  return [...new Set((text.match(/BL\d+/g) || []))].sort();
}
