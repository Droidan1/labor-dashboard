// ?action=backfill-category-orders — adds per-category basket counts to an
// EXISTING item snapshot, and must change nothing else.
//
// This endpoint re-reads Clover for a past day, which is the operation this
// repo has lost production data to three times. It is safe only because it does
// a read-modify-write of two keys and never calls saveItemSalesSnapshot. The
// central assertion below is therefore not "the counts look right" but
// "everything else is byte-identical" — if that ever stops holding, the
// endpoint has become a re-snapshot and must not be run.
//
// Drives worker.fetch with only Clover's HTTP stubbed (the platform, not the
// code under test), mirroring scripts/test-channel-invariants.mjs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

function stubClover({ orders = [] }) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('/orders')) return json({ elements: orders });
    if (u.includes('/refunds') || u.includes('/credits') || u.includes('/items')) return json({ elements: [] });
    throw new Error('unexpected outbound fetch: ' + u.slice(0, 120));
  };
}

const worker = await loadWorker(repo);
const { env } = makeEnv(repo);
env.BL1_MERCHANT_ID = 'TESTMERCHANT';
env.BL1_API_TOKEN = 'test-token';

const DATE = '2026-05-20';
const KEY = `items:bl1:${DATE}`;
const NOW = new Date(DATE + 'T15:00:00Z').getTime();
const li = (id, name, priceCents, qty = 1) => ({
  id, name, price: priceCents, unitQty: qty * 1000, item: { id: 'i-' + id },
});
const order = (id, lineItems) => {
  const gross = lineItems.reduce((s, l) => s + l.price * (l.unitQty / 1000), 0);
  return {
    id, state: 'locked', createdTime: NOW, total: gross,
    payments: { elements: [{ id: 'p-' + id, amount: gross, taxAmount: 0, createdTime: NOW + 100 }] },
    lineItems: { elements: lineItems },
  };
};
const ORDERS = [
  order('o1', [li('l1', 'Sweater', 2000)]),
  order('o2', [li('l2', 'Bin $5', 500, 3)]),
  order('o3', [li('l3', 'Sweater', 1000), li('l4', 'Bin $5', 500)]),
];

// A realistic pre-existing snapshot: real numbers, plus fields the endpoint has
// no business touching. `orderCount` matches the fixture so coverage is 1.0.
const SNAPSHOT = {
  store: 'BL1', date: DATE,
  categories: [
    { category: 'Softline - Apparel', qty: 2, gross: 30, netSales: 28.5, cost: 9, l3Rows: [
        { l3: 'Apparel', qty: 2, netSales: 28.5, cost: 9 }] },
    { category: 'Bin Products', qty: 4, gross: 20, netSales: 20, cost: 44, l3Rows: [
        { l3: 'Bin Products', qty: 4, netSales: 20, cost: 44 }] },
  ],
  totals: { qty: 6, gross: 50, netSales: 48.5, cost: 53, grossProfit: -4.5, gpmPct: -9.3 },
  orderCount: 3,
  channels: { retail: { net: 28.5, units: 2, orders: 2 }, bin: { net: 20, units: 4, orders: 2 }, mixed: 1 },
  _debug: { unmappedL3: {}, noCategory: {} },
  snapshotTime: '2026-05-21T03:56:00.000Z',
};

const call = (qs, user = 'u-su') =>
  worker.fetch(req(`/?action=backfill-category-orders&${qs}`, { user, method: 'POST' }), env, ctx);
const body = async (r) => JSON.parse(await r.text());

// ── THE assertion: only the two count keys change ─────────────────────────
{
  await env.SALES_SNAPSHOTS.put(KEY, JSON.stringify(SNAPSHOT));
  const before = JSON.parse(await env.SALES_SNAPSHOTS.get(KEY));
  stubClover({ orders: ORDERS });
  const r = await call(`store=BL1&date=${DATE}`);
  const b = await body(r);
  ok(r.status === 200 && b.ok, `200 and ok, got ${r.status} ${JSON.stringify(b).slice(0, 140)}`);
  ok(b.wrote === true, `it actually wrote, got ${JSON.stringify(b)}`);

  const after = JSON.parse(await env.SALES_SNAPSHOTS.get(KEY));
  const added = ['l2Orders', 'l3Orders', 'categoryOrdersBackfilledAt'];
  const changed = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (added.includes(k)) continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed.push(k);
  }
  ok(changed.length === 0, `NOTHING but the count keys changed, but these did: ${changed.join(', ')}`);
  // Spot-check the load-bearing ones explicitly, so a future refactor that
  // renames a key cannot make the loop above vacuously pass.
  ok(JSON.stringify(after.categories) === JSON.stringify(SNAPSHOT.categories), 'categories are untouched');
  ok(JSON.stringify(after.totals) === JSON.stringify(SNAPSHOT.totals), 'totals are untouched');
  ok(JSON.stringify(after.channels) === JSON.stringify(SNAPSHOT.channels), 'channels are untouched');
  ok(after.orderCount === SNAPSHOT.orderCount, 'orderCount is untouched');
  ok(after.snapshotTime === SNAPSHOT.snapshotTime, 'snapshotTime is untouched — this was not a re-snapshot');
  ok(after.l2Orders && Object.keys(after.l2Orders).length > 0, `l2Orders was added: ${JSON.stringify(after.l2Orders)}`);
  ok(after.l3Orders && Object.keys(after.l3Orders).length > 0, 'l3Orders was added');
  const touches = Object.values(after.l2Orders).reduce((a, b) => a + b, 0);
  ok(touches > after.orderCount,
     `counts carry the overlap: ${touches} touches over ${after.orderCount} baskets`);
}

// ── the magnitude guard refuses a short fetch ─────────────────────────────
// An old day whose orders have partly aged out must not overwrite a good
// denominator with an understated one.
{
  await env.SALES_SNAPSHOTS.put(KEY, JSON.stringify({ ...SNAPSHOT, orderCount: 100 }));
  stubClover({ orders: ORDERS });                      // only 3 of the 100
  const b = await body(await call(`store=BL1&date=${DATE}`));
  ok(b.skipped === 'coverage below floor', `short fetch is skipped, got ${JSON.stringify(b)}`);
  ok(b.coverage === 0.03, `coverage is reported, got ${b.coverage}`);
  const after = JSON.parse(await env.SALES_SNAPSHOTS.get(KEY));
  ok(after.l2Orders === undefined, 'a skipped day is left with no counts at all');
}

// ── a missing snapshot is skipped, never created ──────────────────────────
{
  await env.SALES_SNAPSHOTS.delete(KEY);
  stubClover({ orders: ORDERS });
  const b = await body(await call(`store=BL1&date=${DATE}`));
  ok(b.skipped === 'no existing snapshot', `missing snapshot is skipped, got ${JSON.stringify(b)}`);
  ok((await env.SALES_SNAPSHOTS.get(KEY)) === null, 'no snapshot was manufactured');
}

// ── input validation, and it is superuser-only ────────────────────────────
{
  stubClover({ orders: ORDERS });
  ok((await call('store=NOPE&date=2026-05-20')).status === 400, 'unknown store is rejected');
  ok((await call('store=BL1&date=not-a-date')).status === 400, 'malformed date is rejected');
  ok((await call('store=BL1')).status === 400, 'missing date is rejected');
  // A manager must not be able to drive a Clover re-read.
  const mgr = await call(`store=BL1&date=${DATE}`, 'u-mgr1');
  ok(mgr.status === 403, `a manager is refused, got ${mgr.status}`);
  const admin = await call(`store=BL1&date=${DATE}`, 'u-admin');
  ok(admin.status === 403, `a non-superuser admin is refused on this POST, got ${admin.status}`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
