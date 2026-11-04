// The Whatnot daily PDF on the Executive Summary (BL-Live-<date>.pdf), built from the Whatnot API's data
// (Brian, 2026-11-04: the recap email that used to carry a PDF is retired). Two halves, through the real
// entry points:
//   1. GET ?action=live-daily-pdf: who may read it, and what the PDF says — the day's shows, totals and
//      month to date, from the same figures the email's live sales use (Whatnot's gross: analytics
//      `sales`, else orders not cancelled or failed) — and that it is a well-formed PDF;
//   2. the 5 AM cron: the PDF goes on every chain-wide copy and on a scoped copy only when that scope
//      holds EVERY Whatnot store (it shows Fort Wayne's and Battle Creek's shows side by side), only on
//      a day with a show, and a PDF that cannot be built never holds the email back.
// The figures are made up: this repo is public.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req, applyMigrationAlters } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const sends = [];
globalThis.fetch = async (url, opts = {}) => {
  if (String(url) === 'https://api.resend.com/emails') {
    sends.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ id: 'msg_test' }), { status: 200 });
  }
  throw new Error(`unexpected network call: ${url}`);
};
const worker = await loadWorker(repo);
const migration = (m) => fs.readFileSync(path.join(repo, `migration-${m}.sql`), 'utf8');

// The shows a day is drawn from. Nov 2 (a Monday): two Fort Wayne shows and one Battle Creek show; one
// Fort Wayne show is still being counted (its orders so far: 40 + 2.50, the failed $9 left out).
function seed(db, { day = '2026-11-02' } = {}) {
  const sh = db.prepare("INSERT INTO whatnot_shows (id,title,status,scheduled_start_at,started_at,show_date,store,synced_at) VALUES (?,?,?,?,?,?,?,'t')");
  const an = db.prepare("INSERT INTO whatnot_show_analytics (show_id,calculation_status,sales,orders_count,first_time_buyers,fetched_at) VALUES (?,?,?,?,?,'t')");
  const or = db.prepare("INSERT INTO whatnot_orders (id,show_id,status,created_at,subtotal,items_synced,synced_at) VALUES (?,?,?,?,?,1,'t')");
  const it = db.prepare("INSERT INTO whatnot_order_items (id,order_id,show_id,quantity,unit_price,synced_at,shipment_id) VALUES (?,?,?,1,1,'t',?)");
  sh.run('p1', '$1 Starts : Womens Fashion Finds', 'ended', `${day}T13:30:00Z`, `${day}T13:30:00Z`, day, 'BL1');
  an.run('p1', 'GENERATED', 698, 157, 3);
  or.run('q1', 'p1', 'completed', `${day}T14:00:00Z`, 10); it.run('i1', 'q1', 'p1', 'S1');
  or.run('q2', 'p1', 'completed', `${day}T14:01:00Z`, 20); it.run('i2', 'q2', 'p1', 'S2');
  sh.run('p2', '$5 Starts : Bag Deals', 'ended', `${day}T16:00:00Z`, `${day}T16:00:00Z`, day, 'BL1');
  an.run('p2', 'PENDING', null, null, null);
  or.run('q3', 'p2', 'completed', `${day}T16:10:00Z`, 40); it.run('i3', 'q3', 'p2', 'S2');
  or.run('q4', 'p2', 'completed', `${day}T16:11:00Z`, 2.5); it.run('i4', 'q4', 'p2', 'S4');
  or.run('q5', 'p2', 'failed', `${day}T16:12:00Z`, 9); it.run('i5', 'q5', 'p2', 'S5');
  sh.run('p3', '$1 Starts : Kids Apparel Finds', 'ended', `${day}T22:00:00Z`, `${day}T22:00:00Z`, day, 'BL14');
  an.run('p3', 'GENERATED', 1032, 212, 21);
  sh.run('px', 'Called off', 'cancelled', `${day}T19:00:00Z`, null, day, 'BL1');
  // The month's daily rows, as syncWhatnotDaily leaves them, and last Monday's for the comparison.
  const cs = db.prepare("INSERT INTO channel_sales (channel,store,date,total,count,meta,source_file,ingested_at) VALUES ('whatnot',?,?,?,?,?,'Whatnot API','t')");
  const meta = (items, nb) => JSON.stringify({ items, shipments: 0, new_buyers: nb, source: 'whatnot-api' });
  cs.run('BL1', '2026-11-01', 0, 0, meta(0, 0)); cs.run('BL14', '2026-11-01', 789, 1, meta(165, 5));
  cs.run('BL1', day, 740.5, 2, meta(159, 3)); cs.run('BL14', day, 1032, 1, meta(212, 21));
  cs.run('BL1', '2026-10-26', 1000, 1, meta(100, 1)); cs.run('BL14', '2026-10-26', 500, 1, meta(50, 1));
}

// Every string a content stream draws, in order (the PDF is uncompressed by design).
const pdfText = (bytes) => [...Buffer.from(bytes).toString('latin1').matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)]
  .map(m => m[1].replace(/\\([()\\])/g, '$1'));
// Every xref entry must point at its own "n 0 obj": a bad offset opens in lenient readers only.
function xrefOk(bytes) {
  const s = Buffer.from(bytes).toString('latin1');
  const at = Number(/startxref\s+(\d+)/.exec(s)?.[1]);
  const xr = /xref\s+0 (\d+)\s+([\s\S]*?)trailer/.exec(s.slice(at));
  if (!xr) return false;
  const rows = xr[2].trim().split(/\s*\n\s*/).slice(1);
  return rows.length === Number(xr[1]) - 1 && rows.every((r, i) => s.startsWith(`${i + 1} 0 obj`, Number(r.slice(0, 10))));
}

// ── 1. GET ?action=live-daily-pdf ────────────────────────────────────────────
console.log('the PDF: GET ?action=live-daily-pdf');
{
  const h = makeEnv(repo);
  for (const m of ['015', '084']) h.db.exec(migration(m));
  applyMigrationAlters(h.db, repo);
  seed(h.db);
  const get = (qs, user = 'u-su') => worker.fetch(req('/?action=live-daily-pdf' + qs, { user }), h.env, ctx);
  eq((await get('&date=2026-11-02', 'u-mgr1')).status, 403, 'a store manager is refused');
  eq((await get('&date=2026-11-02', 'u-admin')).status, 403, 'an admin without the business is refused');
  eq((await get('&date=2026-11-31')).status, 400, 'a date that does not exist is refused');
  eq((await get('&date=2026-11-03')).status, 404, 'no show that day: 404, nothing to attach');
  const r = await get('&date=2026-11-02');
  eq([r.status, r.headers.get('content-type')], [200, 'application/pdf'], 'a show day: a PDF');
  const bytes = new Uint8Array(await r.arrayBuffer());
  ok(Buffer.from(bytes).subarray(0, 8).toString() === '%PDF-1.4' && Buffer.from(bytes).toString('latin1').trimEnd().endsWith('%%EOF'), 'it is a whole PDF');
  ok(xrefOk(bytes), 'every xref offset points at its object');
  const t = pdfText(bytes), joined = t.join(' | ');
  ok(t.includes('Monday, November 2, 2026'), 'the day is the title');
  // Sales = 698 + 42.50 (still counting, failed left out) + 1,032 = 1,772.50; last Monday 1,500.
  ok(t.includes('$1,773') && t.includes('+$273 vs last Mon'), `Sales tile and the change on last Monday (${joined.slice(0, 300)})`);
  ok(t.includes('$698.00') && t.includes('$42.50') && t.includes('$1,032.00') && t.includes('$1,772.50'), 'each show\'s sales and the day total');
  ok(!t.includes('Called off'), 'a cancelled show is not listed');
  // Items 157 + 2 + 212 = 371; shipments distinct on the day's kept orders: S1, S2 (two shows), S4 = 3.
  ok(t.includes('371') && t.includes('ITEMS SOLD') && t.includes('SHIPMENTS'), 'items and the shipments tile');
  ok(t.includes('Fort Wayne (BL1)') && t.includes('Battle Creek (BL14)') && t.includes('$740.50') && t.includes('$1,821.00'), 'month to date by location (Battle Creek 789 + 1,032)');
  ok(t.includes('November to date') && t.includes('Shows'), 'both tables are there');
  ok(t.some(x => x.includes('from the Whatnot API')) && !t.some(x => /recap email/i.test(x)), 'it says where the figures come from, and not the recap email');
}

// ── 2. The 5 AM cron attaches it ────────────────────────────────────────────
const PINNED = '2026-11-03T10:00:00Z';   // 05:00 EST, the send time; the email covers Nov 2
const COVERS = '2026-11-02';
const RealDate = Date;
const pin = () => { globalThis.Date = class extends RealDate { constructor(...a) { if (a.length === 0) super(PINNED); else super(...a); } static now() { return new RealDate(PINNED).getTime(); } }; };
const unpin = () => { globalThis.Date = RealDate; };
const SALES = { BL1: 10000, BL2: 5000, BL4: 2500, BL8: 1250, BL14: 600, BL16: 300 };
const WEEK_DATES = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'];
//        id          role         users.stores      bl grant units
const SU    = ['u-su',    'superuser', null,             undefined];
const ADM   = ['u-adm',   'admin',     null,             null];
const M1    = ['u-m1',    'manager',   '["BL1"]',        '["BL1"]'];
const M14   = ['u-m14',   'manager',   '["BL14"]',       '["BL14"]'];
const M1_14 = ['u-m1-14', 'manager',   '["BL1","BL14"]', '["BL1","BL14"]'];
const CAST = [SU, ADM, M1, M14, M1_14];

async function run({ shows = true, whatnot = true, breakIt = false } = {}) {
  sends.length = 0;
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, role TEXT, stores TEXT, status TEXT);
    CREATE TABLE user_grants (user_id TEXT, business_id TEXT, role TEXT, units TEXT, PRIMARY KEY(user_id,business_id));
    CREATE TABLE notification_preferences (user_id TEXT PRIMARY KEY, push_enabled INTEGER, daily_summary INTEGER, weekly_digest INTEGER);
    CREATE TABLE push_subscriptions (id TEXT PRIMARY KEY, user_id TEXT, endpoint TEXT, p256dh TEXT, auth TEXT);
    CREATE TABLE notification_log (id TEXT PRIMARY KEY, user_id TEXT, type TEXT, event_type TEXT, status TEXT, error TEXT, provider_message_id TEXT, created_at TEXT);
    CREATE TABLE daily_sales (id INTEGER PRIMARY KEY AUTOINCREMENT, store TEXT, date TEXT, week TEXT,
                              total REAL, retail REAL, bin REAL, auction REAL, budget REAL, snapshot_time TEXT);
    CREATE TABLE channel_sales (id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT, store TEXT, date TEXT, total REAL, count INTEGER,
                                meta TEXT, source_file TEXT, ingested_at TEXT, UNIQUE(channel, store, date));
  `);
  for (const s of Object.keys(SALES)) for (const d of WEEK_DATES) {
    db.prepare('INSERT INTO daily_sales (store,date,week,total,retail,bin,auction,budget,snapshot_time) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(s, d, '45', SALES[s], SALES[s] * 0.8, SALES[s] * 0.2, 0, SALES[s], d <= COVERS ? d + 'T23:55:00Z' : null);
  }
  for (const [id, role, stores, units] of CAST) {
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(id, id + '@x.com', role, stores, 'active');
    db.prepare('INSERT INTO notification_preferences VALUES (?,?,?,?)').run(id, 0, 1, 1);
    if (units !== undefined) db.prepare('INSERT INTO user_grants VALUES (?,?,?,?)').run(id, 'bl', role, units);
  }
  if (whatnot) {
    db.exec(migration('084'));
    db.exec(migration('088'));
    if (shows) seed(db, { day: COVERS });
    if (breakIt) db.exec('DROP TABLE whatnot_show_analytics');
  }
  const stmt = (sql, p = []) => ({ bind: (...a) => stmt(sql, a), all: async () => ({ results: db.prepare(sql).all(...p) }),
    run: async () => db.prepare(sql).run(...p), first: async () => db.prepare(sql).all(...p)[0] || null });
  const env = { DB: { prepare: (sql) => stmt(sql), batch: async (list) => Promise.all(list.map(s => s.all())) }, RESEND_API_KEY: 'test-key' };
  const waits = [];
  const c = { waitUntil: p => waits.push(Promise.resolve(p).catch(e => console.error('waitUntil rejected:', e.message))), passThroughOnException: () => {} };
  const realLog = console.log, realErr = console.error; console.log = () => {}; console.error = () => {};
  pin();
  try {
    await worker.scheduled({ cron: '0 * * * *', scheduledTime: Date.now() }, env, c);
    await Promise.all(waits);
  } finally { unpin(); console.log = realLog; console.error = realErr; }
  const byTo = {};
  for (const s of sends) byTo[s.to.replace('@x.com', '')] = s;
  return { byTo, count: sends.length };
}
const names = (s) => (s && s.attachments ? s.attachments.map(a => a.filename) : []);

console.log('\ncron: the PDF for the covered day is on the email');
{
  const r = await run();
  ok(r.count === CAST.length, `every recipient got an email (${r.count})`);
  const want = [`BL-Live-${COVERS}.pdf`];
  eq(names(r.byTo['u-su']), want, 'superuser copy carries the PDF');
  eq(names(r.byTo['u-adm']), want, 'admin copy carries the PDF');
  const a = (r.byTo['u-su']?.attachments || [])[0] || {};
  ok(Buffer.from(a.content || '', 'base64').subarray(0, 5).toString() === '%PDF-' && a.content_type === 'application/pdf', 'the attachment is a PDF');
  ok(pdfText(Buffer.from(a.content || '', 'base64')).includes('$1,772.50'), 'built from the Whatnot data for the covered day');
  eq(names(r.byTo['u-m1-14']), want, 'a manager scoped to BOTH Whatnot stores (BL1 + BL14) gets it');
  eq(names(r.byTo['u-m1']), [], 'a BL1-only manager does NOT get it (it shows Battle Creek too)');
  eq(names(r.byTo['u-m14']), [], 'a BL14-only manager does NOT get it (it shows Fort Wayne too)');
  ok(!('attachments' in (r.byTo['u-m1'] || {})), 'an unattached send carries no attachments key at all');
}

console.log('\ncron: no PDF never holds the email back');
{
  const r = await run({ shows: false });
  ok(r.count === CAST.length && Object.values(r.byTo).every(s => !('attachments' in s)), 'no show that day: every email, none attached');
}
{
  const r = await run({ breakIt: true });
  ok(r.count === CAST.length && Object.values(r.byTo).every(s => !('attachments' in s)), 'a PDF that cannot be built: every email still sent, unattached');
}
{
  const r = await run({ whatnot: false });
  ok(r.count === CAST.length, 'no Whatnot tables (staging, tests): every email still sent');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
