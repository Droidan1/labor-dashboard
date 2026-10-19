// POST ?action=send-test-summary: ONE copy of the chain-wide Executive Summary,
// recap PDF included, to the signed-in superuser and nobody else (2026-10-19).
//
// Why it exists: send-daily-summary re-runs the whole 8 AM job (every recipient,
// plus their phone pushes), and Resend refuses a same-day re-send whose body
// changed, because each copy reuses its per-day idempotency key. So there was no
// way to look at a change to the email before the next morning.
//
// The central assertion is that exactly one email leaves, to the caller. Driven
// through worker.fetch with real sessions, so the role gates are the real ones.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, applyMigrationAlters } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// 10 AM ET Monday 10/19, so "yesterday in ET" is Sunday 10/18.
const PINNED = '2026-10-19T14:00:00Z';
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(PINNED); else super(...a); }
  static now() { return new RealDate(PINNED).getTime(); }
};

// Every outbound call is recorded. Only Resend is expected; anything else (a push
// service, say) shows up as an unexpected call and fails the "nothing else" check.
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), body: opts.body, key: (opts.headers || {})['Idempotency-Key'] });
  if (String(url) === 'https://api.resend.com/emails') return new Response(JSON.stringify({ id: 'msg_' + calls.length }), { status: 200 });
  return new Response('unexpected', { status: 500 });
};
const resend = () => calls.filter(c => c.url === 'https://api.resend.com/emails').map(c => ({ ...JSON.parse(c.body), __key: c.key }));

const worker = await loadWorker(repo);
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');

function setup({ pdf = true } = {}) {
  const h = makeEnv(repo);
  h.db.exec(fs.readFileSync(path.join(repo, 'migration-015.sql'), 'utf8'));
  applyMigrationAlters(h.db, repo);
  h.db.exec(`CREATE TABLE IF NOT EXISTS notification_log (id TEXT PRIMARY KEY, user_id TEXT, type TEXT, event_type TEXT, status TEXT, error TEXT, provider_message_id TEXT, created_at TEXT)`);
  h.db.exec('DELETE FROM daily_sales');
  const ins = h.db.prepare('INSERT INTO daily_sales (store, date, total, budget, snapshot_time) VALUES (?, ?, ?, ?, ?)');
  for (const d of ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']) {
    for (const s of ['BL1', 'BL2', 'BL4', 'BL14', 'BL16']) ins.run(s, d, 100, 100, d + 'T23:55:00Z');
  }
  // A phone subscription for the superuser: the real send would push to it.
  h.db.prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?,?)')
    .run('ps1', 'u-su', 'https://push.example.com/x', 'p', 'a', '2026-10-01');
  h.env.RESEND_API_KEY = 'test-key';
  h.env.VAPID_PUBLIC_KEY = 'BOGUS'; h.env.VAPID_PRIVATE_KEY = 'BOGUS'; h.env.VAPID_SUBJECT = 'mailto:x@example.com';
  if (pdf) h.env.MEDIA.put('live-recap/2026-10-18.pdf', PDF, { httpMetadata: { contentType: 'application/pdf' } });
  return h;
}
const send = (h, { user, qs = '', method = 'POST', secret } = {}) => {
  const headers = {};
  if (user) headers.Cookie = `session=sess-${user}`;
  if (secret) headers['X-Snapshot-Secret'] = h.env.SNAPSHOT_SECRET;
  return worker.fetch(new Request('https://api.retjghub.com/?action=send-test-summary' + qs, { method, headers }), h.env, ctx);
};

// ── 1. A superuser gets exactly one copy, with the PDF ──────────────────────
console.log('superuser: one copy, to them, with the recap PDF');
{
  const h = setup();
  calls.length = 0;
  const r = await send(h, { user: 'u-su' });
  const j = await r.json().catch(() => ({}));
  eq([r.status, j.ok, j.to, j.date, j.attached], [200, true, 'bhoward@bargainlane.com', '2026-10-18', 'BL-Live-Recap-2026-10-18.pdf'],
     'defaults to yesterday in ET and reports what it sent');
  const sent = resend();
  eq(sent.map(s => s.to), ['bhoward@bargainlane.com'], 'exactly one email, to the signed-in superuser');
  eq(calls.length, 1, 'nothing else left the worker (no push, no other recipient)');
  const m = sent[0] || {};
  ok((m.subject || '').startsWith('[Test] Executive Summary — '), `subject marks it as a test (${m.subject})`);
  ok((m.html || '').includes('>All Stores</td>'), 'the body is the chain-wide Executive Summary');
  eq((m.attachments || []).map(a => [a.filename, a.content, a.content_type]),
     [['BL-Live-Recap-2026-10-18.pdf', Buffer.from(PDF).toString('base64'), 'application/pdf']], 'the recap PDF is attached');
  const log = h.db.prepare("SELECT user_id, event_type, status, provider_message_id FROM notification_log").all();
  eq(log.map(l => [l.user_id, l.event_type, l.status, l.provider_message_id]), [['u-su', 'daily-summary-test', 'sent', 'msg_1']],
     'logged as a test send, apart from the daily-summary rows');

  const r2 = await send(h, { user: 'u-su' });
  eq(r2.status, 200, 'a second test send works');
  const keys = resend().map(s => s.__key);
  ok(keys.length === 2 && keys[0] && keys[0] !== keys[1], 'each test send has its own idempotency key, so Resend never refuses a re-test');
  ok(keys.every(k => !k.startsWith('daily-chain-')), 'and never the real send\'s key');
}

// ── 2. Nobody else can send one ─────────────────────────────────────────────
console.log('\nevery other caller is refused, and nothing is sent');
for (const [who, opts, want] of [
  ['admin', { user: 'u-admin' }, 403],
  ['manager', { user: 'u-mgr1' }, 403],
  ['executive', { user: 'u-exec' }, 403],
  ['admin secret, no session (no "me" to send to)', { secret: true }, 403],
  ['no session', {}, 401],
]) {
  const h = setup();
  calls.length = 0;
  const r = await send(h, opts);
  eq([r.status, calls.length], [want, 0], `${who}: ${want}, no email`);
}
{
  const h = setup();
  calls.length = 0;
  const r = await send(h, { user: 'u-su', method: 'GET' });
  ok(r.status !== 200 && calls.length === 0, `GET sends nothing (${r.status})`);
}

// ── 3. Dates and a missing PDF ──────────────────────────────────────────────
console.log('\ndates and a missing PDF');
{
  const h = setup({ pdf: false });
  calls.length = 0;
  const r = await send(h, { user: 'u-su', qs: '&date=2026-10-18' });
  const j = await r.json().catch(() => ({}));
  eq([r.status, j.attached], [200, null], 'no PDF stored: still sends, and says nothing was attached');
  ok(resend().length === 1 && !('attachments' in resend()[0]), 'the email carries no attachments key');
}
for (const bad of ['2026-10-1', '2026-13-01', 'yesterday', '2026-02-30']) {
  const h = setup();
  calls.length = 0;
  const r = await send(h, { user: 'u-su', qs: '&date=' + bad });
  eq([r.status, calls.length], [400, 0], `bad date ${JSON.stringify(bad)}: 400, no email`);
}
{
  const h = setup();
  h.env.MEDIA.put('live-recap/2026-10-17.pdf', PDF, { httpMetadata: { contentType: 'application/pdf' } });
  calls.length = 0;
  const r = await send(h, { user: 'u-su', qs: '&date=2026-10-17' });
  const j = await r.json().catch(() => ({}));
  eq([r.status, j.date, j.attached], [200, '2026-10-17', 'BL-Live-Recap-2026-10-17.pdf'], 'an explicit date sends that day, with that day\'s PDF');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
