// The two supply-request emails were the least observable sends in the system:
//
//   await fetch('https://api.resend.com/emails', {...})
//     .catch(e => console.error('Supply email error:', e.message));
//
// No `res.ok` check at all, so a 429, a 422 or a 500 was not merely unretried —
// it was completely invisible. The .catch() only ever fired on a network error.
//
// This drives the REAL endpoints through worker.fetch (supply-request-create and
// supply-request-status) and asserts on what actually reached the transport.
// Source-text greps cannot see wiring, and wiring is the thing that was missing.
import { DatabaseSync } from 'node:sqlite';
import { loadWorker, makeEnv, req, applyMigrationAlters } from './lib/worker-harness.mjs';

const REPO = process.argv[2] || '.';

// Capture Resend traffic. `responder` is swappable so the retry cases can fail
// on demand. Anything else on the network is refused loudly — a silent real
// call would be worse than a failure.
let sends = [];
let responder = () => new Response(JSON.stringify({ id: 'msg_supply' }), { status: 200 });
globalThis.fetch = async (url, opts = {}) => {
  if (String(url) === 'https://api.resend.com/emails') {
    const body = JSON.parse(opts.body);
    body.__key = (opts.headers || {})['Idempotency-Key'];
    sends.push(body);
    return responder(sends.length);
  }
  throw new Error(`unexpected network call: ${url}`);
};

const worker = await loadWorker(REPO);

function rig() {
  sends = [];
  const { db, env } = makeEnv(REPO);
  // notification_log is born in migration-008, which the harness SCHEMA does not
  // include. 🔑 Creating it here means makeEnv's earlier applyMigrationAlters run
  // could not have added migration-038's provider_message_id — that ALTER hit a
  // missing table and was swallowed. Re-applying is mandatory, and the harness
  // says so: skipping it surfaces much later as a confusing "no such column".
  db.exec(`CREATE TABLE notification_log (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, event_type TEXT NOT NULL,
    status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  // The endpoint also writes items and an audit row; without these it 500s
  // before ever reaching the mailer, and every assertion about the mail would
  // fail for the wrong reason. Kept local rather than widened into the shared
  // harness SCHEMA, which other suites depend on.
  db.exec(`CREATE TABLE supply_request_items (
    id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES supply_requests(id) ON DELETE CASCADE,
    category TEXT NOT NULL DEFAULT 'Other', item_name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1, unit TEXT NOT NULL DEFAULT 'units', notes TEXT);
  CREATE TABLE supply_request_history (
    id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES supply_requests(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'status_change', changed_by_id TEXT NOT NULL, changed_by_email TEXT NOT NULL,
    old_status TEXT, new_status TEXT, note TEXT, changed_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  applyMigrationAlters(db, REPO);
  env.RESEND_API_KEY = 'test-key';
  const waits = [];
  const ctx = { waitUntil: p => waits.push(Promise.resolve(p).catch(e => console.error('waitUntil rejected:', e.message))), passThroughOnException: () => {} };
  return { db, env, ctx, waits };
}

const logRows = db => db.prepare(
  "SELECT event_type, status, error, provider_message_id AS mid FROM notification_log WHERE type='email' ORDER BY event_type"
).all();

let fail = 0;
const ok = (n, c, d = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!c) fail++; };

// ── create ────────────────────────────────────────────────────────────────
async function createRequest(r) {
  const res = await worker.fetch(req('/?action=supply-request-create', {
    user: 'u-mgr1', method: 'POST',
    body: { store: 'BL1', priority: 'urgent', notes: 'test', items: [{ item_name: 'Mop', quantity: 2, category: 'Cleaning' }] },
  }), r.env, r.ctx);
  await Promise.all(r.waits);
  return res;
}

console.log('a new supply request emails the superuser through resendSend:');
{
  const r = rig();
  const res = await createRequest(r);
  ok('endpoint succeeded', res.status === 200, String(res.status));
  // Guard against a vacuous pass: if nothing was sent, every assertion below
  // about "what was sent" would trivially hold.
  ok('an email actually reached the transport', sends.length >= 1, `${sends.length} sends`);
  ok('addressed to the superuser', sends.some(s => s.to === 'bhoward@bargainlane.com'), JSON.stringify(sends.map(s => s.to)));
  // `.every()` on an empty array is true, so the length check is load-bearing —
  // without it this passes when nothing was sent at all.
  ok('carries an Idempotency-Key (a double-POST cannot double-send)',
     sends.length > 0 && sends.every(s => typeof s.__key === 'string' && s.__key.startsWith('supply-new-')),
     JSON.stringify(sends.map(s => s.__key)));
  const rows = logRows(r.db);
  ok('the send is recorded', rows.some(x => x.event_type === 'supply-request-new' && x.status === 'sent'), JSON.stringify(rows));
  ok("...with Resend's message id", rows.some(x => x.mid === 'msg_supply'), JSON.stringify(rows));
}

console.log('\na transient 503 is retried, not dropped:');
{
  const r = rig();
  let n = 0;
  responder = () => (++n <= 2)
    ? new Response('upstream hiccup', { status: 503 })
    : new Response(JSON.stringify({ id: 'msg_supply' }), { status: 200 });
  await createRequest(r);
  ok('three HTTP attempts for one message', sends.length === 3, `${sends.length}`);
  ok('the same key on every attempt', new Set(sends.map(s => s.__key)).size === 1, JSON.stringify(sends.map(s => s.__key)));
  const rows = logRows(r.db);
  ok('ultimately recorded as sent', rows.some(x => x.status === 'sent'), JSON.stringify(rows));
}

console.log('\na permanent 422 is NOT retried, and is recorded as failed:');
{
  const r = rig();
  responder = () => new Response('{"message":"Invalid `to` field"}', { status: 422 });
  const res = await createRequest(r);
  ok('attempted exactly once', sends.length === 1, `${sends.length}`);
  // 🔑 The request itself must still succeed. The email is a side effect; a
  // refused notification must not fail the supply request the user submitted.
  ok('the supply request still succeeded', res.status === 200, String(res.status));
  const rows = logRows(r.db);
  ok('recorded as failed', rows.some(x => x.status === 'failed'), JSON.stringify(rows));
  ok('...carrying the error text', (rows.find(x => x.status === 'failed')?.error || '').includes('422'), JSON.stringify(rows));
  ok('...and no message id (there is no message to look up)',
     rows.filter(x => x.status === 'failed').every(x => x.mid === null), JSON.stringify(rows));
}

console.log('\nan absent API key is "skipped", not silently nothing:');
{
  const r = rig();
  r.env.RESEND_API_KEY = '';
  responder = () => { throw new Error('must not send with no key'); };
  await createRequest(r);
  ok('nothing was sent', sends.length === 0, `${sends.length}`);
  const rows = logRows(r.db);
  ok('recorded as skipped', rows.some(x => x.status === 'skipped'), JSON.stringify(rows));
}

// ── status change ─────────────────────────────────────────────────────────
console.log('\na status change emails the requester through resendSend:');
{
  const r = rig();
  responder = () => new Response(JSON.stringify({ id: 'msg_status' }), { status: 200 });
  const created = await createRequest(r);
  const id = JSON.parse(await created.text()).id
    || r.db.prepare('SELECT id FROM supply_requests LIMIT 1').all()[0]?.id;
  ok('a request exists to update', !!id, String(id));

  sends = [];
  const r2 = { env: r.env, ctx: { waitUntil: p => r2.waits.push(Promise.resolve(p).catch(() => {})), passThroughOnException: () => {} }, waits: [] };
  const res = await worker.fetch(req(`/?action=supply-request-status&id=${id}`, {
    user: 'u-su', method: 'PATCH', body: { id, status: 'ordered', note: 'on the truck' },
  }), r2.env, r2.ctx);
  await Promise.all(r2.waits);

  ok('endpoint succeeded', res.status === 200, String(res.status));
  ok('an email reached the transport', sends.length >= 1, `${sends.length}`);
  ok('addressed to the requester', sends.some(s => s.to === 'howardbrian260@gmail.com'), JSON.stringify(sends.map(s => s.to)));
  // 🔑 A PER-CALL key here, deliberately not requestId+status. A stable key would
  // also swallow a genuine second notification — the same status set again with a
  // different note is a real message that Resend would silently drop.
  ok('carries a per-call Idempotency-Key',
     sends.length > 0 && sends.every(s => typeof s.__key === 'string' && s.__key.startsWith('supply-status-')),
     JSON.stringify(sends.map(s => s.__key)));
  const rows = logRows(r.db).filter(x => x.event_type === 'supply-status-change');
  ok('the send is recorded', rows.some(x => x.status === 'sent'), JSON.stringify(rows));
}

// 🔑 THE CASE A STABLE KEY WOULD BREAK. The endpoint refuses a no-op update
// (worker.js: `if (existing.status === status) return { unchanged: true }`), so
// the same status cannot be set twice in a row — which makes a
// requestId+newStatus key look safe. But status CYCLES, and
// pending → under_review → on_hold → under_review is an ordinary week. The
// second under_review is a real notification; a stable key would have Resend
// drop it silently inside the idempotency window.
console.log('\na status that cycles back still notifies (a stable key would swallow it):');
{
  const r = rig();
  responder = () => new Response(JSON.stringify({ id: 'msg_status' }), { status: 200 });
  await createRequest(r);
  const id = r.db.prepare('SELECT id FROM supply_requests LIMIT 1').all()[0].id;
  const seen = [];
  for (const [status, note] of [['under_review', 'first look'], ['on_hold', 'waiting on quote'], ['under_review', 'back to it']]) {
    sends = [];
    const waits = [];
    const res = await worker.fetch(req(`/?action=supply-request-status&id=${id}`, {
      user: 'u-su', method: 'PATCH', body: { id, status, note },
    }), r.env, { waitUntil: p => waits.push(Promise.resolve(p).catch(() => {})), passThroughOnException: () => {} });
    await Promise.all(waits);
    seen.push({ status, ok: res.status === 200, keys: sends.map(s => s.__key) });
  }
  const underReview = seen.filter(s => s.status === 'under_review');
  ok('all three transitions succeeded', seen.every(s => s.ok), JSON.stringify(seen.map(s => s.ok)));
  ok('each transition sent exactly one notification',
     seen.every(s => s.keys.length === 1), JSON.stringify(seen.map(s => s.keys.length)));
  ok('under_review notified BOTH times it was entered', underReview.length === 2 && underReview.every(s => s.keys.length === 1),
     JSON.stringify(underReview));
  ok('...with different keys, so Resend cannot suppress the second',
     underReview[0].keys[0] !== underReview[1].keys[0],
     JSON.stringify(underReview.map(s => s.keys[0])));
}

console.log(fail ? `\n${fail} FAILED` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
