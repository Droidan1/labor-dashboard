// The live-data route at the end of the chain answers only requests with NO ?action=.
//
// WHAT THIS PROTECTS. The last route in worker.js (?store=BL1, today live from
// Clover) is a fall-through: it used to answer ANY request no branch matched,
// including a known action sent with the wrong method. The financial gate decides
// by action, so staff — and every PIN associate, role staff — could send a
// NON-financial action that matches nothing as a GET (push-subscribe is POST-only)
// and get their store's live sales, and the route would also rewrite that store's
// snapshot and daily_sales row (fresh-eyes review, 2026-10-13).
//
// Clover is stubbed so the live route genuinely runs: without merchant keys it
// stops at "Store keys not found", and the test would pass whatever the fix did.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
env.BL1_MERCHANT_ID = 'TESTMERCHANT';
env.BL1_API_TOKEN = 'test-token';

// Clover: one $123.45 order today, so a live answer is unmistakable.
const now = Date.now();
const order = { id: 'o1', state: 'locked', createdTime: now - 60000, total: 12345,
  payments: { elements: [{ id: 'p1', amount: 12345, taxAmount: 0, createdTime: now - 59000 }] },
  lineItems: { elements: [{ id: 'l1', name: 'Widget', price: 12345, unitQty: 1000, item: { id: 'i1' } }] } };
let cloverCalls = 0;
globalThis.fetch = async (url) => {
  const u = String(url);
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.includes('clover')) cloverCalls++;
  if (u.includes('/orders')) return json({ elements: (u.match(/[?&]offset=(\d+)/) || [])[1] > 0 ? [] : [order] });
  if (u.includes('/refunds') || u.includes('/credits') || u.includes('/items') || u.includes('/categories')) return json({ elements: [] });
  throw new Error('unexpected outbound fetch: ' + u.slice(0, 120));
};

async function ask(q, user) {
  db.exec('DELETE FROM daily_sales');
  const before = cloverCalls;
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(Promise.resolve(p)), passThroughOnException: () => {} };
  const r = await worker.fetch(req('/' + q, { user }), env, ctx);
  const text = await r.text();
  for (const p of pending) await p.catch(() => {});
  return { status: r.status, text, clover: cloverCalls - before, writes: pending.length,
    rows: db.prepare("SELECT COUNT(*) n FROM daily_sales WHERE store = 'BL1'").get().n };
}
const leaked = (a) => a.text.includes('123.45') || a.clover > 0 || a.writes > 0 || a.rows > 0;

// ── Control: the dashboard's own call (no action) still works ──────────────
{
  const a = await ask('?store=BL1&since=0', 'u-mgr1');
  eq(a.status, 200, "a BL1 manager's live call (no action) → 200");
  ok(a.text.includes('123.45') && a.clover > 0, 'and it really ran: Clover was asked and the order came back');
  const staff = await ask('?store=BL1', 'u-staff');
  eq(staff.status, 403, 'staff without an action are refused, as before (financial gate)');
}

// ── The hole: a NON-financial action that matches nothing, as staff ────────
for (const action of ['push-subscribe', 'push-unsubscribe', 'passkey-delete']) {
  const a = await ask(`?action=${action}&store=BL1`, 'u-staff');
  ok(!leaked(a), `staff GET ?action=${action}&store=BL1: no sales, no Clover call, no write (got ${a.status}, clover ${a.clover}, writes ${a.writes})`);
  ok(a.status === 404 || a.status === 405, `and an error, not data (${a.status})`);
}

// An EMPTY action is still an action: `if (get('action'))` would let this through.
{
  const a = await ask('?action=&store=BL1', 'u-mgr1');
  ok(!leaked(a), '?action=&store=BL1 (empty action) does not reach the live route');
  eq(a.status, 404, 'and is 404');
}

// ── A known action sent the wrong way, by someone who could read sales ─────
{
  const a = await ask('?action=delete-sale-schedule&store=BL1', 'u-mgr1');
  ok(!leaked(a), 'a manager GETting a POST-only action does not reach the live route');
  eq(a.status, 404, 'it is an unknown request, 404');
  ok(/Unknown action/.test(a.text), 'and says so');
}

// ── Unchanged: an action nobody has heard of is still refused at the business gate ─
{
  const a = await ask('?action=no-such-thing&store=BL1', 'u-su');
  eq(a.status, 403, 'an unclassified action → 403 at the business gate, as before');
  ok(!leaked(a), 'without touching Clover');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
