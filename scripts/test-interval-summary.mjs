// The interval summary pushes sales and budget figures. A cron send never
// passes through the financial gate — that lives in the request path — so the
// function must do its own role and scope checks.
//
// It previously carried a THIRD hand-rolled copy of allowedStores() that read
// raw users.stores, ignored grants entirely, and had no financial-role check.
//
// This drives the REAL scheduled entry point — worker.scheduled({cron:'0 * * * *'})
// — and captures what would actually be pushed, per recipient. Extracting the
// function with regexes was tried first and needed a new regex for every
// transitive dependency; going through the real entry point needs none.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const REPO = process.argv[2] || '.';
const src = fs.readFileSync(path.join(REPO, 'worker.js'), 'utf8');

// The function returns early outside 10:00-20:00 ET. Pin the clock so this test
// is deterministic rather than passing vacuously outside business hours — an
// empty run looks exactly like "everyone was correctly excluded".
const PINNED = '2026-08-04T18:00:00Z'; // 14:00 ET
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(PINNED); else super(...a); }
  static now() { return new RealDate(PINNED).getTime(); }
};

// Block the network. The real sendWebPush signs with VAPID and would fail on a
// fake key before ever reaching fetch, so capturing there is unreliable — the
// dispatch's own {sent, skipped} counts are the honest signal, and they are what
// these assertions use. A differential (run with and without a user) then shows
// exactly WHO was skipped, without needing valid crypto.
globalThis.fetch = async () => new Response('', { status: 201 });

const tmp = path.join(os.tmpdir(), `worker-cron-${src.length}.mjs`);
fs.writeFileSync(tmp, src);
const worker = (await import(pathToFileURL(tmp).href + `?v=${src.length}`)).default;

const STORES = ['BL1', 'BL2', 'BL4', 'BL8', 'BL14', 'BL16'];
const todayET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

// grant units deliberately DIFFER from users.stores, so the outcome reveals
// which source the code actually read.
//  id        role         users.stores   grant units
const SU    = ['u-su',    'superuser', null,      null];
const ADMIN = ['u-admin', 'admin',     null,      null];
const MGR   = ['u-mgr',   'manager',   '["BL2"]', '["BL1","BL4"]'];
const STAFF = ['u-staff', 'staff',     '["BL1"]', '["BL1"]'];
const EXEC  = ['u-exec',  'executive', null,      '["BL8"]'];
// stores says BL2 (a real store) but the grant says NOTHING. If the code reads
// the grant this user is skipped; if it reads users.stores they are sent.
const GHOST = ['u-ghost', 'manager',   '["BL2"]', '[]'];

async function run(people) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, role TEXT, stores TEXT, status TEXT);
    CREATE TABLE notification_preferences (user_id TEXT PRIMARY KEY, push_enabled INTEGER, interval_summary TEXT);
    CREATE TABLE user_grants (user_id TEXT, business_id TEXT, role TEXT, units TEXT, PRIMARY KEY(user_id,business_id));
    CREATE TABLE daily_sales (id INTEGER PRIMARY KEY AUTOINCREMENT, store TEXT, date TEXT, total REAL, order_count INTEGER, budget REAL);
    CREATE TABLE push_subscriptions (id TEXT PRIMARY KEY, user_id TEXT, endpoint TEXT, p256dh TEXT, auth TEXT);
  `);
  STORES.forEach((s, i) => db.prepare('INSERT INTO daily_sales (store,date,total,order_count,budget) VALUES (?,?,?,?,?)')
    .run(s, todayET, 1000 + i, 40 + i, 1500 + i));
  for (const [id, role, stores, units] of people) {
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(id, id + '@x.com', role, stores, 'active');
    db.prepare('INSERT INTO notification_preferences VALUES (?,?,?)').run(id, 1, '1h');
    if (role !== 'superuser') db.prepare('INSERT INTO user_grants VALUES (?,?,?,?)').run(id, 'bl', role, units);
    db.prepare('INSERT INTO push_subscriptions VALUES (?,?,?,?,?)').run('s-' + id, id, 'https://push.example/' + id, 'k', 'a');
  }
  const env = {
    DB: { prepare(sql) { const mk = p => ({ bind: (...a) => mk(a), all: async () => ({ results: db.prepare(sql).all(...p) }), run: async () => db.prepare(sql).run(...p), first: async () => db.prepare(sql).all(...p)[0] || null }); return mk([]); } },
    VAPID_PUBLIC_KEY: 'k', VAPID_PRIVATE_KEY: 'k', VAPID_SUBJECT: 'mailto:t@e.st',
  };
  const waits = [];
  const ctx = { waitUntil: p => waits.push(Promise.resolve(p).catch(() => {})), passThroughOnException: () => {} };
  let captured = null;
  const realLog = console.log;
  console.log = (...a) => { const t = a.join(' '); if (t.startsWith('Interval summary dispatch:')) { try { captured = JSON.parse(t.split(': ').slice(1).join(': ')); } catch (_) {} } };
  await worker.scheduled({ cron: '0 * * * *', scheduledTime: Date.now() }, env, ctx);
  await Promise.all(waits);
  console.log = realLog;
  return captured || {};
}

let fail = 0;
const ok = (n, c, d = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!c) fail++; };

const all      = await run([SU, ADMIN, MGR, STAFF, EXEC]);
const noStaff  = await run([SU, ADMIN, MGR, EXEC]);
const onlyStaff= await run([STAFF]);
const ghost    = await run([GHOST]);
const onlyMgr  = await run([MGR]);

console.log('dispatch results:');
console.log('  all five        :', JSON.stringify(all));
console.log('  without staff   :', JSON.stringify(noStaff));
console.log('  staff alone     :', JSON.stringify(onlyStaff));
console.log('  empty-grant mgr :', JSON.stringify(ghost));
console.log('  manager alone   :', JSON.stringify(onlyMgr));

if (!all.sent) { console.error('\nFATAL: nothing was sent at all — the run was vacuous'); process.exit(1); }

console.log('\nstaff must never be pushed money (cron bypasses the financial gate):');
ok('staff alone -> nothing sent', onlyStaff.sent === 0, JSON.stringify(onlyStaff));
ok('staff alone -> skipped', onlyStaff.skipped === 1, JSON.stringify(onlyStaff));
ok('removing staff removes exactly the one skip', all.sent === noStaff.sent && noStaff.skipped === 0,
   `all=${all.sent}/${all.skipped} noStaff=${noStaff.sent}/${noStaff.skipped}`);

console.log('\nscope comes from the GRANT, not users.stores:');
ok('a manager whose GRANT is empty is skipped, though users.stores names BL2',
   ghost.sent === 0 && ghost.skipped === 1, JSON.stringify(ghost));
ok('a manager with a real grant IS sent', onlyMgr.sent === 1, JSON.stringify(onlyMgr));

console.log('\nfull-scope and scoped roles are both served:');
ok('four recipients when staff is excluded', noStaff.sent === 4, JSON.stringify(noStaff));

console.log(fail ? `\n${fail} FAILED` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
