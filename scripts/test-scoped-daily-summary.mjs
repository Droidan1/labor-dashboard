// The 2026-08-04 fix that stopped emailing store-scoped managers the whole
// chain's revenue removed them from the only daily email there was, and nothing
// replaced it: notification_log went 12-13 recipients/day -> 4 overnight and
// stayed there for a week while the Settings toggle still said "on".
//
// This pins the replacement. It drives the REAL cron entry point —
// worker.scheduled({cron:'0 12 * * *'}) — and captures the actual Resend
// payloads, so it sees the wiring and the rendered body, not just a helper's
// return value. Regex-extracting the dispatcher would prove nothing about
// whether the cron calls it.
//
// The central assertion is NEGATIVE and must stay that way: a scoped recipient
// must receive their own stores AND NOT anyone else's. A body containing every
// store would satisfy "the manager got an email" while re-opening the leak.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const REPO = process.argv[2] || '.';
const src = fs.readFileSync(path.join(REPO, 'worker.js'), 'utf8');

// Pin the clock so "yesterday in ET" — the date the handler derives and queries
// — is deterministic. Without this the seeded daily_sales rows would miss the
// queried date and every assertion would pass vacuously against zero emails.
const PINNED = '2026-08-13T12:00:00Z';       // 08:00 ET, the real send time
const COVERS = '2026-08-12';                 // the date the handler will report on
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(PINNED); else super(...a); }
  static now() { return new RealDate(PINNED).getTime(); }
};

// Capture Resend sends. Everything else on the network is refused loudly rather
// than stubbed to 200 — a silent success would hide a call we did not expect.
// `responder` is swappable so the retry tests at the bottom can fail on demand;
// it counts ATTEMPTS, while `sends` records one entry per HTTP call (so a
// retried message appears more than once, which is what the retry test needs).
const sends = [];
let responder = () => new Response(JSON.stringify({ id: 'msg_test' }), { status: 200 });
globalThis.fetch = async (url, opts = {}) => {
  if (String(url) === 'https://api.resend.com/emails') {
    const body = JSON.parse(opts.body);
    body.__key = (opts.headers || {})['Idempotency-Key'];
    sends.push(body);
    return responder(body, sends.length);
  }
  throw new Error(`unexpected network call: ${url}`);
};

const tmp = path.join(os.tmpdir(), `worker-scoped-${src.length}.mjs`);
fs.writeFileSync(tmp, src);
const worker = (await import(pathToFileURL(tmp).href + `?v=${src.length}`)).default;

const LABEL = { BL1: 'Coliseum', BL2: 'South Bend', BL4: 'Dupont', BL8: 'Holland', BL14: 'Battle Creek', BL16: 'Indy East' };
// Distinct magnitudes so a total can be traced back to its stores. All above
// renderCategoryTableHtml's CATEGORY_MIN_NET (250), or the per-store category
// rows below would fold into "Other" and the category assertions would pass
// vacuously against a row that never rendered.
const SALES = { BL1: 10000, BL2: 5000, BL4: 2500, BL8: 1250, BL14: 600, BL16: 300 };
// The retail week containing COVERS. Seeding the whole week (and a week label)
// is what makes the Daily Breakdown table render at all — with week NULL,
// buildWeeklyByDayData returns null and its header goes unasserted. That is
// exactly how the "Daily Breakdown · All Stores" mislabel reached a rendered
// scoped email unnoticed.
const WEEK_NO = '33';
const WEEK_DATES = ['2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15'];
// One uniquely-named L2 per store, so the category table can be checked for
// cross-store bleed independently of the by-store table. Deliberately contains
// no store LABEL substring, so it cannot disturb the store assertions.
const CATNAME = s => `Cat-${s}-Only`;

//        id         role        users.stores    bl grant units   daily_summary
const SU     = ['u-su',    'superuser', null,            undefined,        1];
const ADM    = ['u-adm',   'admin',     null,            null,             1];
const ECOM   = ['u-ecom',  'admin',     null,            'ECOM_ONLY',      1];
const M1     = ['u-m1',    'manager',   '["BL1"]',       '["BL1"]',        1];
const M14    = ['u-m14',   'manager',   '["BL14"]',      '["BL14"]',       1];
const M14B   = ['u-m14b',  'manager',   '["BL1","BL4"]', '["BL1","BL4"]',  1];
const M14C   = ['u-m14c',  'manager',   '["BL1","BL4"]', '["BL1","BL4"]',  1];
const STAFF  = ['u-staff', 'staff',     '["BL1"]',       '["BL1"]',        1];
const OPTOUT = ['u-opt',   'manager',   '["BL2"]',       '["BL2"]',        0];
const NOGRNT = ['u-ng',    'manager',   '["BL14"]',      'NO_GRANT',       1];

async function run(people, opts = {}) {
  sends.length = 0;
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, role TEXT, stores TEXT, status TEXT);
    CREATE TABLE user_grants (user_id TEXT, business_id TEXT, role TEXT, units TEXT, PRIMARY KEY(user_id,business_id));
    CREATE TABLE notification_preferences (user_id TEXT PRIMARY KEY, push_enabled INTEGER, daily_summary INTEGER, weekly_digest INTEGER);
    CREATE TABLE push_subscriptions (id TEXT PRIMARY KEY, user_id TEXT, endpoint TEXT, p256dh TEXT, auth TEXT);
    CREATE TABLE notification_log (id TEXT PRIMARY KEY, user_id TEXT, type TEXT, event_type TEXT, status TEXT, error TEXT, created_at TEXT);
    CREATE TABLE daily_sales (id INTEGER PRIMARY KEY AUTOINCREMENT, store TEXT, date TEXT, week TEXT,
                              total REAL, retail REAL, bin REAL, auction REAL, budget REAL);
  `);
  // The whole week, labelled, so all three tables render and every scope label
  // is exercised — not just the by-store one.
  for (const s of Object.keys(SALES)) {
    for (const d of WEEK_DATES) {
      db.prepare('INSERT INTO daily_sales (store,date,week,total,retail,bin,auction,budget) VALUES (?,?,?,?,?,?,?,?)')
        .run(s, d, WEEK_NO, SALES[s], SALES[s] * 0.8, SALES[s] * 0.2, 0, SALES[s]);
    }
  }
  for (const [id, role, stores, units, daily] of people) {
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(id, id + '@x.com', role, stores, 'active');
    db.prepare('INSERT INTO notification_preferences VALUES (?,?,?,?)').run(id, 0, daily, 1);
    if (units === 'ECOM_ONLY')      db.prepare('INSERT INTO user_grants VALUES (?,?,?,?)').run(id, 'ecom', role, null);
    else if (units === 'NO_GRANT')  { /* deliberately none */ }
    else if (units !== undefined)   db.prepare('INSERT INTO user_grants VALUES (?,?,?,?)').run(id, 'bl', role, units);
  }
  const env = {
    DB: { prepare(sql) { const mk = p => ({ bind: (...a) => mk(a), all: async () => ({ results: db.prepare(sql).all(...p) }), run: async () => db.prepare(sql).run(...p), first: async () => db.prepare(sql).all(...p)[0] || null }); return mk([]); } },
    ...(opts.noKey ? {} : { RESEND_API_KEY: 'test-key' }),
    // KV item snapshots drive the category table. Each store gets its own
    // uniquely-named L2 so a scoped email can be checked for cross-store bleed
    // through the KV path, which is separate code from the D1 by-store query.
    SALES_SNAPSHOTS: {
      get: async (key) => {
        const m = /^items:(\w+):(.+)$/.exec(key);
        if (!m || m[2] !== COVERS) return null;
        const store = m[1].toUpperCase();
        if (!SALES[store]) return null;
        return { orderCount: 10, categories: [{ category: CATNAME(store), qty: 5, gross: SALES[store], discounts: 0, refunds: 0, netSales: SALES[store], cost: 0 }] };
      },
    },
    // No VAPID: push is out of scope here and would only add failure modes
    // unrelated to the fix.
  };
  const waits = [];
  const ctx = { waitUntil: p => waits.push(Promise.resolve(p).catch(e => console.error('waitUntil rejected:', e.message))), passThroughOnException: () => {} };
  const realLog = console.log;
  const logs = [];
  console.log = (...a) => logs.push(a.join(' '));
  await worker.scheduled({ cron: '0 12 * * *', scheduledTime: Date.now() }, env, ctx);
  await Promise.all(waits);
  console.log = realLog;
  const byTo = {};
  for (const s of sends) byTo[s.to] = s;
  return { sends: sends.slice(), byTo, logs, db };
}

let fail = 0;
const ok = (n, c, d = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!c) fail++; };
const bodyOf = (r, id) => (r.byTo[id + '@x.com'] || {}).html || '';
const has = (html, store) => html.includes(LABEL[store]);

const CAST = [SU, ADM, ECOM, M1, M14, M14B, M14C, STAFF, OPTOUT, NOGRNT];
const r = await run(CAST);

console.log(`emails sent: ${r.sends.length}`);
for (const s of r.sends) console.log(`   ${s.to.padEnd(16)} ${s.subject}`);

// A run that sent nothing would satisfy every negative assertion below.
if (!r.sends.length) { console.error('\nFATAL: no email was sent at all — the run was vacuous'); process.exit(1); }

console.log('\nthe regression this fixes: store-scoped managers get a daily email again');
ok('BL1 manager receives one', !!r.byTo['u-m1@x.com']);
ok('BL14 manager receives one', !!r.byTo['u-m14@x.com']);
ok('BL1+BL4 managers both receive one', !!r.byTo['u-m14b@x.com'] && !!r.byTo['u-m14c@x.com']);

console.log('\nand it is THEIR stores only — the leak must not reopen:');
const m1 = bodyOf(r, 'u-m1');
ok('BL1 manager sees Coliseum', has(m1, 'BL1'));
for (const s of ['BL2', 'BL4', 'BL8', 'BL14', 'BL16']) {
  ok(`BL1 manager does NOT see ${LABEL[s]}`, !has(m1, s));
}
const m14 = bodyOf(r, 'u-m14');
ok('BL14 manager sees Battle Creek', has(m14, 'BL14'));
ok('BL14 manager does NOT see Coliseum (substring trap: "[\\"BL14\\"]".includes("BL1"))', !has(m14, 'BL1'));
const m2s = bodyOf(r, 'u-m14b');
ok('BL1+BL4 manager sees both its stores', has(m2s, 'BL1') && has(m2s, 'BL4'));
ok('BL1+BL4 manager sees no third store',
   !has(m2s, 'BL2') && !has(m2s, 'BL8') && !has(m2s, 'BL14') && !has(m2s, 'BL16'));

console.log('\nchain-wide recipients are unchanged:');
const su = bodyOf(r, 'u-su');
ok('superuser still receives one', !!r.byTo['u-su@x.com']);
ok('superuser body spans every reporting store',
   ['BL1', 'BL2', 'BL4', 'BL8', 'BL14', 'BL16'].every(s => has(su, s)));
ok('granted admin still receives one', !!r.byTo['u-adm@x.com']);
ok('chain-wide body is footed "All Stores"', su.includes('>All Stores</td>'));

console.log('\nscoped bodies do not mislabel their footer as the chain:');
ok('single-store footer says "Total", not the store name twice',
   m1.includes('>Total</td>') && !m1.includes('>All Stores</td>'));
ok('multi-store footer says "My Stores"', m2s.includes('>My Stores</td>') && !m2s.includes('>All Stores</td>'));
ok('scoped subject carries the scope', ((r.byTo['u-m1@x.com'] || {}).subject || '').includes('(Coliseum)'));

// The by-store table was scoped from the first commit; these two headers were
// NOT, and shipped reading "· All Stores" above one store's figures. Rendering
// the email is what surfaced it, so the headers are pinned here explicitly.
console.log('\n...nor their section headers — all three tables must agree on scope:');
ok('chain Daily Breakdown reads "All Stores"', su.includes('Daily Breakdown · All Stores'));
ok('chain Category Sales reads "All Stores"', su.includes('Category Sales · All Stores'));
ok('all three tables actually rendered for the chain',
   su.includes('Daily Breakdown') && su.includes('Category Sales') && su.includes('vs Budget'));
ok('single-store Daily Breakdown names the store', m1.includes('Daily Breakdown · Coliseum'));
ok('single-store Category Sales names the store', m1.includes('Category Sales · Coliseum'));
ok('single-store body never says "All Stores" anywhere', !m1.includes('All Stores'));
ok('multi-store headers say "My Stores"',
   m2s.includes('Daily Breakdown · My Stores') && m2s.includes('Category Sales · My Stores'));
ok('multi-store body never says "All Stores" anywhere', !m2s.includes('All Stores'));

console.log('\nthe category table is scoped too (a separate KV read path):');
ok('BL1 body carries only its own category', m1.includes(CATNAME('BL1')));
for (const s of ['BL2', 'BL4', 'BL8', 'BL14', 'BL16']) {
  ok(`BL1 body has no ${CATNAME(s)}`, !m1.includes(CATNAME(s)));
}
ok('BL14 body carries its own category, not BL1\'s',
   m14.includes(CATNAME('BL14')) && !m14.includes(CATNAME('BL1')));

console.log('\nthe totals actually differ — proof the body was rebuilt, not reused:');
const dollars = h => (h.match(/\$[\d,]+/g) || []);
ok('scoped body and chain body are different documents', m1 !== su);
ok('scoped total is smaller than the chain total',
   Math.max(...dollars(m1).map(d => +d.slice(1).replace(/,/g, ''))) <
   Math.max(...dollars(su).map(d => +d.slice(1).replace(/,/g, ''))));

console.log('\nnobody gains access they do not have:');
ok('staff receives nothing (cron bypasses the financial gate)', !r.byTo['u-staff@x.com']);
ok('E-Commerce-only admin receives nothing', !r.byTo['u-ecom@x.com']);
ok('opted-out manager receives nothing', !r.byTo['u-opt@x.com']);
ok('manager with no bl grant receives nothing (fails closed)', !r.byTo['u-ng@x.com']);
ok('...and that drop is logged, not silent',
   r.logs.some(l => l.includes('scoped_summary_dropped') && l.includes('u-ng')));

console.log('\nbodies are built once per store set, not once per recipient:');
ok('the two BL1+BL4 managers got byte-identical bodies', bodyOf(r, 'u-m14b') === bodyOf(r, 'u-m14c'));
const distinct = new Set(r.sends.map(s => s.html)).size;
ok('4 distinct bodies for 5 recipients (chain, BL1, BL14, BL1+BL4)', distinct === 4, `got ${distinct}`);

console.log('\nthe send is recorded honestly:');
const rows = r.db.prepare("SELECT event_type, status, COUNT(*) n FROM notification_log GROUP BY event_type, status").all();
console.log('   notification_log:', JSON.stringify(rows));
ok('scoped sends are logged', rows.some(x => x.event_type === 'daily-summary-scoped' && x.status === 'sent' && x.n === 4),
   JSON.stringify(rows));

console.log('\na failing Resend is recorded as failed, not as sent:');
responder = () => new Response('rate limited', { status: 429 });
const bad = await run([SU, M1]);
const badRows = bad.db.prepare("SELECT status, COUNT(*) n FROM notification_log WHERE event_type='daily-summary-scoped' GROUP BY status").all();
console.log('   notification_log:', JSON.stringify(badRows));
ok('a 429 is logged as failed', badRows.some(x => x.status === 'failed' && x.n === 1), JSON.stringify(badRows));
ok('nothing is logged as sent', !badRows.some(x => x.status === 'sent'), JSON.stringify(badRows));

// Kevin's invite got two sends across three days and no retry on either. This
// cron now emits 12 messages where it emitted 4, sequentially, against a mailer
// that rate-limits around 2/sec — so "does a 429 actually get retried" is a
// question about whether eight managers get their email, not a nicety.
console.log('\na transient failure is retried rather than lost:');
let n = 0;
responder = () => (++n <= 2)
  ? new Response('upstream hiccup', { status: 503 })   // fail the first two calls
  : new Response(JSON.stringify({ id: 'msg_ok' }), { status: 200 });
const flaky = await run([M1]);
const flakyRows = flaky.db.prepare("SELECT status, COUNT(*) n FROM notification_log WHERE event_type='daily-summary-scoped' GROUP BY status").all();
console.log(`   http calls=${flaky.sends.length}  notification_log=${JSON.stringify(flakyRows)}`);
ok('two 503s then success -> 3 HTTP attempts', flaky.sends.length === 3, `${flaky.sends.length}`);
ok('...and the message is ultimately SENT, not dropped',
   flakyRows.some(x => x.status === 'sent' && x.n === 1), JSON.stringify(flakyRows));
ok('...all three attempts carried the SAME Idempotency-Key (no duplicate delivery)',
   new Set(flaky.sends.map(s => s.__key)).size === 1 && !!flaky.sends[0].__key,
   JSON.stringify(flaky.sends.map(s => s.__key)));

console.log('\nbut a permanent rejection is NOT retried:');
responder = () => new Response('{"message":"Invalid `to` field"}', { status: 422 });
const perm = await run([M1]);
console.log(`   http calls=${perm.sends.length}`);
ok('a 422 is attempted exactly once', perm.sends.length === 1, `${perm.sends.length}`);
ok('...and recorded as failed', perm.db
   .prepare("SELECT COUNT(*) n FROM notification_log WHERE event_type='daily-summary-scoped' AND status='failed'")
   .get().n === 1);

console.log('\nand an unconfigured mailer is "skipped", not "sent":');
// Any send here would be a bug, so the network refuses outright rather than
// returning a success the assertions could mistake for correct behaviour.
responder = () => { throw new Error('must not send with no API key'); };
const noKey = await run([SU, M1], { noKey: true });
const nkRows = noKey.db.prepare("SELECT status, COUNT(*) n FROM notification_log WHERE event_type='daily-summary-scoped' GROUP BY status").all();
console.log('   notification_log:', JSON.stringify(nkRows));
ok('no key -> nothing was sent', noKey.sends.length === 0, `${noKey.sends.length} sent`);
ok('no key -> logged as skipped', nkRows.some(x => x.status === 'skipped' && x.n === 1), JSON.stringify(nkRows));
ok('no key -> nothing claims to have been sent', !nkRows.some(x => x.status === 'sent'), JSON.stringify(nkRows));

console.log(fail ? `\n${fail} FAILED` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
