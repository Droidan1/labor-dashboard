// The BL-Live-Recap PDF on the Executive Summary (2026-10-19).
//
// The recap email reaches only the Apps Script feeder, which uploads its PDF to
// POST ?action=live-recap-pdf; the 8 AM cron attaches it. Two halves, both driven
// through the real entry points:
//   1. the upload endpoint, through worker.fetch: secret only, a real PDF, a
//      valid date, a bounded size, stored under a key no public route serves;
//   2. the cron, through worker.scheduled: the PDF for the day the email covers
//      goes on every chain-wide copy and on a scoped copy only when that scope
//      holds EVERY store the PDF shows. The PDF lists Fort Wayne's and Battle
//      Creek's shows side by side, so a BL1-only manager must not receive it:
//      the recipient list is the access control on this path.
// A missing PDF must never hold the email back.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// Pinned so "yesterday in ET" is the day the seeded rows cover (see test-scoped-daily-summary.mjs).
const PINNED = '2026-08-13T09:00:00Z';   // 05:00 ET, the send time
const COVERS = '2026-08-12';
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(PINNED); else super(...a); }
  static now() { return new RealDate(PINNED).getTime(); }
};

const sends = [];
globalThis.fetch = async (url, opts = {}) => {
  if (String(url) === 'https://api.resend.com/emails') {
    sends.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ id: 'msg_test' }), { status: 200 });
  }
  throw new Error(`unexpected network call: ${url}`);
};

const worker = await loadWorker(repo);
const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

// ── 1. Upload endpoint ──────────────────────────────────────────────────────
console.log('upload: POST ?action=live-recap-pdf');
{
  const h = makeEnv(repo);
  const secret = h.env.SNAPSHOT_SECRET;
  const up = (qs, { body = PDF, withSecret = true, cookie } = {}) => {
    const headers = { 'Content-Type': 'application/pdf' };
    if (withSecret) headers['X-Snapshot-Secret'] = secret;
    if (cookie) headers.Cookie = cookie;
    return worker.fetch(new Request('https://api.retjghub.com/?action=live-recap-pdf' + qs, { method: 'POST', headers, body }), h.env, ctx);
  };
  const keys = () => [...h.env.MEDIA._store.keys()];

  let r = await up('&date=2026-10-18', { withSecret: false });
  eq(r.status, 401, 'no secret, no session: refused');
  r = await up('&date=2026-10-18', { withSecret: false, cookie: 'session=sess-u-su' });
  eq(r.status, 401, 'a signed-in superuser without the secret is refused (the feeder is the only writer)');
  for (const bad of ['', '&date=2026-10-1', '&date=2026-13-01', '&date=../2026-10-18', '&date=2026-10-18.pdf']) {
    r = await up(bad);
    eq(r.status, 400, `bad date refused: ${JSON.stringify(bad)}`);
  }
  r = await up('&date=2026-10-18', { body: new TextEncoder().encode('<html>not a pdf</html>') });
  eq(r.status, 400, 'a body that is not a PDF is refused');
  r = await up('&date=2026-10-18', { body: new Uint8Array(0) });
  eq(r.status, 400, 'an empty body is refused');
  const big = new Uint8Array(10 * 1024 * 1024 + 1); big.set(PDF);
  r = await up('&date=2026-10-18', { body: big });
  eq(r.status, 413, 'a PDF over 10 MB is refused');
  eq(keys(), [], 'nothing was stored by any refused upload');

  r = await up('&date=2026-10-18');
  const j = await r.json().catch(() => ({}));
  eq([r.status, j.ok, j.bytes], [200, true, PDF.length], 'a PDF with the secret and a valid date is accepted');
  eq(keys(), ['live-recap/2026-10-18.pdf'], 'stored under the private live-recap/ key for that date');
  const stored = await h.env.MEDIA.get('live-recap/2026-10-18.pdf');
  ok(stored && Buffer.from(await stored.arrayBuffer()).equals(Buffer.from(PDF)), 'stored bytes are exactly the uploaded bytes');
  eq(stored && stored.httpMetadata.contentType, 'application/pdf', 'stored as application/pdf');

  r = await worker.fetch(new Request('https://api.retjghub.com/p/live-recap/2026-10-18.pdf'), h.env, ctx);
  eq(r.status, 404, 'guard: the public photo route does not serve it');
}

// ── 2. The cron attaches it ─────────────────────────────────────────────────
const SALES = { BL1: 10000, BL2: 5000, BL4: 2500, BL8: 1250, BL14: 600, BL16: 300 };
const WEEK_DATES = ['2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15'];
//        id          role         users.stores      bl grant units
const SU    = ['u-su',    'superuser', null,             undefined];
const ADM   = ['u-adm',   'admin',     null,             null];
const M1    = ['u-m1',    'manager',   '["BL1"]',        '["BL1"]'];
const M14   = ['u-m14',   'manager',   '["BL14"]',       '["BL14"]'];
const M1_14 = ['u-m1-14', 'manager',   '["BL1","BL14"]', '["BL1","BL14"]'];
const CAST = [SU, ADM, M1, M14, M1_14];

async function run({ objects = {}, media = true, mediaThrows = false } = {}) {
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
  `);
  for (const s of Object.keys(SALES)) for (const d of WEEK_DATES) {
    db.prepare('INSERT INTO daily_sales (store,date,week,total,retail,bin,auction,budget,snapshot_time) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(s, d, '33', SALES[s], SALES[s] * 0.8, SALES[s] * 0.2, 0, SALES[s], d <= COVERS ? d + 'T23:55:00Z' : null);
  }
  for (const [id, role, stores, units] of CAST) {
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(id, id + '@x.com', role, stores, 'active');
    db.prepare('INSERT INTO notification_preferences VALUES (?,?,?,?)').run(id, 0, 1, 1);
    if (units !== undefined) db.prepare('INSERT INTO user_grants VALUES (?,?,?,?)').run(id, 'bl', role, units);
  }
  const reads = [];
  const MEDIA = {
    get: async (k) => {
      reads.push(k);
      if (mediaThrows) throw new Error('R2 is down');
      const bytes = objects[k];
      return bytes ? { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } : null;
    },
  };
  const env = {
    DB: { prepare(sql) { const mk = p => ({ bind: (...a) => mk(a), all: async () => ({ results: db.prepare(sql).all(...p) }), run: async () => db.prepare(sql).run(...p), first: async () => db.prepare(sql).all(...p)[0] || null }); return mk([]); } },
    RESEND_API_KEY: 'test-key',
    ...(media ? { MEDIA } : {}),
  };
  const waits = [];
  const c = { waitUntil: p => waits.push(Promise.resolve(p).catch(e => console.error('waitUntil rejected:', e.message))), passThroughOnException: () => {} };
  const realLog = console.log; console.log = () => {};
  await worker.scheduled({ cron: '0 * * * *', scheduledTime: Date.now() }, env, c);
  await Promise.all(waits);
  console.log = realLog;
  const byTo = {};
  for (const s of sends) byTo[s.to.replace('@x.com', '')] = s;
  return { byTo, count: sends.length, reads };
}
const names = (s) => (s && s.attachments ? s.attachments.map(a => a.filename) : []);

console.log('\ncron: the PDF for the covered day is on the email');
{
  const r = await run({ objects: { [`live-recap/${COVERS}.pdf`]: PDF } });
  ok(r.count === CAST.length, `every recipient still got an email (${r.count})`);
  const want = [`BL-Live-Recap-${COVERS}.pdf`];
  eq(names(r.byTo['u-su']), want, 'superuser copy carries the PDF');
  eq(names(r.byTo['u-adm']), want, 'admin copy carries the PDF');
  const a = (r.byTo['u-su'].attachments || [])[0] || {};
  eq([a.content, a.content_type], [b64(PDF), 'application/pdf'], 'attachment is the stored bytes, base64, as a PDF');
  eq(names(r.byTo['u-m1-14']), want, 'a manager scoped to BOTH live stores (BL1 + BL14) gets it');
  eq(names(r.byTo['u-m1']), [], 'a BL1-only manager does NOT get it (it shows Battle Creek too)');
  eq(names(r.byTo['u-m14']), [], 'a BL14-only manager does NOT get it (it shows Fort Wayne too)');
  ok(!('attachments' in (r.byTo['u-m1'] || {})), 'an unattached send carries no attachments key at all');
  eq([...new Set(r.reads)], [`live-recap/${COVERS}.pdf`], 'R2 is asked for the covered day only');
  eq(r.reads.length, 1, 'the PDF is read once per send, not once per body or recipient');
}

console.log('\ncron: no PDF never holds the email back');
{
  const r = await run({ objects: { 'live-recap/2026-08-11.pdf': PDF } });
  ok(r.count === CAST.length, 'every recipient got an email');
  ok(Object.values(r.byTo).every(s => !('attachments' in s)), 'the day-before PDF is not attached to this day\'s email');
}
{
  const r = await run({ mediaThrows: true });
  ok(r.count === CAST.length, 'an R2 error still sends every email, unattached');
}
{
  const r = await run({ media: false });
  ok(r.count === CAST.length, 'no MEDIA binding (staging, tests) still sends every email');
}

// ── 3. The worker's store list mirrors the feeder's ─────────────────────────
// The feeder maps recap locations to stores; the worker decides who may see the
// PDF from the same list. Two encodings of one fact, so pin them together.
{
  const gs = fs.readFileSync(path.join(repo, 'scripts/whatnot-recap-ingest.gs'), 'utf8');
  const sb = { PropertiesService: {}, GmailApp: {}, UrlFetchApp: {}, MailApp: {}, Session: {}, Logger: {}, ScriptApp: {} };
  vm.createContext(sb); vm.runInContext(gs + '\nthis.__stores = [...new Set(Object.values(CONFIG.LOCATION_TO_STORE))];', sb);
  const m = /const LIVE_RECAP_STORES = (\[[^\]]*\])/.exec(src);
  ok(!!m, 'worker.js defines LIVE_RECAP_STORES');
  eq(m ? JSON.parse(m[1]).sort() : null, [...sb.__stores].sort(), 'LIVE_RECAP_STORES equals the feeder\'s LOCATION_TO_STORE stores');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
