// The live route counts today in Eastern time, whatever `since` says.
//
// `GET /?store=X&since=<ms>` is the dashboard's live figure. It asks Clover for the orders and
// refunds created from its window's start, and saves the result as the EASTERN day's snapshot:
// the daily_sales row and the KV `sales:<store>:<date>` key. It used to take the start from the
// caller's `since`. So a window from any other midnight was saved as today, for example:
//   - a Central-time phone's midnight, at 23:30 in Chicago;
//   - yesterday's Eastern midnight, from a page that built its request just before midnight;
//   - since=0, from any store manager. That one also paged Clover back through its retention.
// Measured on the old code: at 00:30 ET, the first of these saved both days' sales as today's row.
//
// The page still sends `since` (its 5-minute cache is keyed by URL), and the worker ignores it.
// This drives the real worker with the clock pinned and a Clover that honours the window it is
// asked for. For each `since`, it checks the window Clover was asked for, the response, the D1
// row and the KV snapshot.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const worker = await loadWorker(process.argv[2] || repo);

const RealDate = Date;
let NOW = 0;
class FixedDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
  static now() { return NOW; }
}
const at = (iso) => RealDate.parse(iso);
const iso = (t) => Number.isFinite(t) ? new RealDate(t).toISOString() : String(t);

// A locked order worth `cents`, created at `t`: one line item, paid in full.
const order = (id, t, cents, name) => ({
  id, state: 'locked', createdTime: t, total: cents,
  payments: { elements: [{ id: 'p-' + id, amount: cents, taxAmount: 0, createdTime: t + 500 }] },
  lineItems: { elements: [{ id: 'l-' + id, name, price: cents, unitQty: 1000, item: { id: 'i-' + id } }] },
});

// A Clover that answers the window it is asked for, and records every window it is asked for.
function clover(orders) {
  const asked = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('/orders') || u.includes('/refunds')) {
      const lo = Number((u.match(/createdTime>=([^&]*)/) || [])[1]);
      const hiRaw = (u.match(/createdTime<([^&]*)/) || [])[1];
      const hi = hiRaw === undefined ? Infinity : Number(hiRaw);
      const offset = Number((u.match(/[?&]offset=(\d+)/) || [])[1] || 0);
      asked.push({ kind: u.includes('/orders') ? 'orders' : 'refunds', lo, hi });
      const inWindow = u.includes('/orders') ? orders.filter(o => o.createdTime >= lo && o.createdTime < hi) : [];
      return json({ elements: offset === 0 ? inWindow : [] });
    }
    if (u.includes('/credits') || u.includes('/items')) return json({ elements: [] });
    throw new Error('unexpected outbound fetch: ' + u.slice(0, 120));
  };
  return asked;
}

// One live request at `now`, from `user`, with the query `q`. Every run gets a fresh database
// and KV. makeEnv seeds a row on today's UTC date, which is the row under test, so it is cleared.
async function live({ now, q, user, orders }) {
  NOW = at(now);
  globalThis.Date = FixedDate;          // before makeEnv: its sessions expire an hour after "now"
  const { db, env } = makeEnv(process.argv[2] || repo);
  env.BL1_MERCHANT_ID = 'TESTMERCHANT';
  env.BL1_API_TOKEN = 'test-token';
  db.exec('DELETE FROM daily_sales');
  const asked = clover(orders);
  const pending = [];
  const ctx = { waitUntil: (p) => { pending.push(Promise.resolve(p)); }, passThroughOnException: () => {} };
  const r = await worker.fetch(req(`/?store=BL1${q}`, { user }), env, ctx);
  const body = JSON.parse(await r.text());
  const saved = pending.length;
  for (const p of pending) await p.catch(e => ok(false, `a snapshot write threw: ${e && e.message}`));
  const rows = db.prepare('SELECT date, total, order_count FROM daily_sales WHERE store = ? ORDER BY date').all('BL1');
  const kv = {};
  for (const [k, v] of env.SALES_SNAPSHOTS._map) if (k.startsWith('sales:')) kv[k] = JSON.parse(v);
  return { status: r.status, body, asked, saved, rows, kv };
}

// ── The day under test: Tuesday 2026-09-29, at 00:30 Eastern ────────────────
// It is still 23:30 on Monday in Chicago. Monday had a $50 sale at 14:00 ET, and Tuesday has
// had one $12 sale, at 00:15 ET.
const TUE = '2026-09-29';
const TUE_MIDNIGHT_ET = at('2026-09-29T04:00:00Z');
const NOW_TUE = '2026-09-29T04:30:00Z';
const ORDERS = [
  order('mon', at('2026-09-28T18:00:00Z'), 5000, 'Sweater'),
  order('tue', at('2026-09-29T04:15:00Z'), 1200, 'Bin $5'),
];

async function expectToday(label, { q, user = 'u-su', now = NOW_TUE, orders = ORDERS, day = TUE, midnight = TUE_MIDNIGHT_ET, total = 12 }) {
  const r = await live({ now, q, user, orders });
  eq(r.status, 200, `${label}: the live route answers`);
  const los = [...new Set(r.asked.map(a => a.lo))];
  ok(r.asked.some(a => a.kind === 'orders') && r.asked.some(a => a.kind === 'refunds') && los.length === 1 && los[0] === midnight,
    `${label}: Clover is asked from midnight Eastern, ${iso(midnight)} (asked from ${los.map(iso).join(', ') || 'nothing'})`);
  const a = r.body.aggregate || {};
  ok(a.total === total && a.orderCount === 1,
    `${label}: the response counts today's one order, $${total} (got total ${a.total}, orderCount ${a.orderCount})`);
  eq((r.body.elements || []).length, 1, `${label}: and returns only today's order`);
  eq(r.saved, 1, `${label}: one snapshot is saved`);
  eq(JSON.stringify(r.rows.map(x => [x.date, x.total, x.order_count])), JSON.stringify([[day, total, 1]]),
    `${label}: daily_sales holds ${day} at $${total}, and no other day`);
  const k = `sales:bl1:${day}`;
  ok(Object.keys(r.kv).length === 1 && r.kv[k] && r.kv[k].total === total,
    `${label}: KV holds ${k} at $${total}, and no other day (${JSON.stringify(Object.fromEntries(Object.entries(r.kv).map(([key, v]) => [key, v.total])))})`);
}

console.log('\n── The live window is today in Eastern time ──');

await expectToday('(a) since = Central midnight, from a Chicago phone', { q: `&since=${at('2026-09-28T05:00:00Z')}`, user: 'u-mgr1' });
await expectToday('(b) since=0, from a BL1 manager', { q: '&since=0', user: 'u-mgr1' });
await expectToday("(c) since = Monday's Eastern midnight, a request built just before midnight", { q: `&since=${at('2026-09-28T04:00:00Z')}` });
await expectToday('(d) since after the only order today', { q: `&since=${at('2026-09-29T04:20:00Z')}` });
await expectToday('(e) since=abc', { q: '&since=abc' });

console.log('\n── What the page sends, unchanged ──');
await expectToday("(f) since = Tuesday's Eastern midnight, as the page sends it", { q: `&since=${TUE_MIDNIGHT_ET}` });
await expectToday('(f) no since at all', { q: '' });

console.log('\n── The clock-change Sundays ──');
// Midnight is 05:00Z on 2026-03-08 (still EST) and 04:00Z on 2026-11-01 (still EDT). An order 30
// minutes before it belongs to Saturday; one 30 minutes after, to Sunday.
for (const [day, midnightIso] of [['2026-03-08', '2026-03-08T05:00:00Z'], ['2026-11-01', '2026-11-01T04:00:00Z']]) {
  const m = at(midnightIso);
  await expectToday(`(g) since=0 on ${day}`, {
    q: '&since=0', now: `${day}T15:00:00Z`, day, midnight: m, total: 7,
    orders: [order('sat', m - 1800e3, 4000, 'Sweater'), order('sun', m + 1800e3, 700, 'Bin $5')],
  });
}

globalThis.Date = RealDate;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
