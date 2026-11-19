// E-Commerce product photos (2026-11-18): syncSellercloud looks up each new SKU's catalog photo
// into ecom_products (migration-092), ?action=ecom-items returns it, and ?action=ecom-photos
// catches up the SKUs already sold. Driven through the real worker.scheduled and worker.fetch.
//
// WHAT THIS PROTECTS.
//   - Every SKU sold is looked up once, newest first, 50 to a catalog call, at most 200 a sync.
//   - Only an https photo on Sellercloud's own host is kept: not its "no image" placeholder, not
//     another host. A SKU the catalog does not have is recorded, so it is not asked again.
//   - A refused catalog, or a worker ahead of migration-092, never fails the orders sync, and the
//     read still answers (without photos) instead of 503.
//   - The read keeps its order after joining photos.
//   - The catch-up is superuser-only, POST-only, and validates its limit before any call.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, blockNetwork, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const worker = await loadWorker(repo);
blockNetwork();
const blocked = globalThis.fetch;
const MIG = (n) => fs.readFileSync(path.join(repo, `migration-${n}.sql`), 'utf8');

function setup({ photos = true } = {}) {
  const { db, env } = makeEnv(repo);
  db.exec(MIG('090')); db.exec(MIG('091'));
  if (photos) db.exec(MIG('092'));
  db.prepare("INSERT INTO businesses (id,name,unit_noun,source,active) VALUES ('ecom','E-Commerce','storefront','sellercloud',1)").run();
  db.prepare("INSERT INTO user_grants (user_id,business_id,role,units) VALUES ('u-admin','ecom','admin',NULL)").run();
  env.SELLERCLOUD_USERNAME = 'sync-user@example.com';
  env.SELLERCLOUD_PASSWORD = 'pw-not-real';
  return { db, env };
}

// ── The fake Sellercloud ────────────────────────────────────────────────────
// Orders on 2026-11-18, one line each. SKU-1..SKU-3 get set photos; SKU-4 has the "no image"
// placeholder; SKU-5's photo sits on another host; SKU-6 has left the catalog; BIG-n are bulk.
let ORDERS = [], nextId = 1, catalogRefused = false, catalogCalls = [];
const order = (sku, total = 20, hour = 10, day = '2026-11-18') => ORDERS.push({ ID: nextId++, CompanyID: 163, TimeOfOrder: `${day}T${String(hour).padStart(2, '0')}:00:00`,
  StatusCode: 3, OrderSource: 1, GrandTotal: total + 5, ShippingTotal: 5, TaxTotal: 0,
  Items: [{ ID: 7000 + nextId, ProductID: sku, DisplayName: 'Item ' + sku, Qty: 1, QtyReturned: 0, LineTotal: total, TotalRefunded: 0 }] });
const PHOTO = (sku) => `https://jay.cwa.sellercloud.us/images/products/${sku}.jpg`;
const CATALOG = {
  'SKU-1': PHOTO('SKU-1'), 'SKU-2': PHOTO('SKU-2'), 'SKU-3': PHOTO('SKU-3'),
  'SKU-4': 'https://jay.cwa.sellercloud.us/images/NoImageAvailable.gif',
  'SKU-5': 'https://evil.example/tracker.jpg',
};
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (u) => {
  const url = new URL(String(u));
  if (url.host !== 'jay.api.sellercloud.us') return blocked(u);
  if (url.pathname === '/rest/api/token') return json({ access_token: 'tok', expires_in: 1800 });
  if (url.pathname === '/rest/api/Orders') {
    const ids = url.searchParams.getAll('companyID').map(Number);
    const from = url.searchParams.get('orderFromDate'), to = url.searchParams.get('orderToDate');
    const size = Number(url.searchParams.get('pageSize')), page = Number(url.searchParams.get('pageNumber'));
    const rows = ORDERS.filter(o => ids.includes(o.CompanyID) && o.TimeOfOrder.slice(0, 10) >= from && o.TimeOfOrder.slice(0, 10) < to);
    return json({ Items: structuredClone(rows.slice((page - 1) * size, page * size)), TotalResults: rows.length });
  }
  if (url.pathname === '/rest/api/Catalog') {
    const want = (url.searchParams.get('sKU') || '').split(',');
    catalogCalls.push(want);
    if (catalogRefused) return json({ Message: 'Authorization has been denied for this request.' }, 403);
    const items = want.filter(k => k in CATALOG || k.startsWith('BIG-')).map(k => ({ ID: k.toUpperCase(), ProductName: 'Item ' + k, ImageUrl: CATALOG[k] || PHOTO(k) }));
    return json({ Items: items, TotalResults: items.length });
  }
  return json({ Message: 'not found' }, 404);
};
const tick = async (env, iso = '2026-11-18T19:45:00Z') => {
  const jobs = [];
  await worker.scheduled({ cron: '* * * * *', scheduledTime: Date.parse(iso) }, env, { waitUntil: (p) => jobs.push(p), passThroughOnException() {} });
  await Promise.allSettled(jobs);
  return JSON.parse(await env.SALES_SNAPSHOTS.get('ecom:sync'));
};
const call = async (env, qs, opts = { user: 'u-admin' }) => {
  const r = await worker.fetch(req('/?action=' + qs, opts), env, { waitUntil() {}, passThroughOnException() {} });
  const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch {}
  return { status: r.status, body, text };
};

for (let n = 1; n <= 6; n++) order('SKU-' + n, 10 * n, 8 + n, n === 6 ? '2026-11-17' : '2026-11-18');   // SKU-6 sold yesterday
const { db, env } = setup();
const row = (sku) => db.prepare('SELECT image_url, in_catalog FROM ecom_products WHERE sku = ?').get(sku);

// ── 1. a sync looks up each new SKU's photo ────────────────────────────────
{
  catalogCalls = [];
  const state = await tick(env);
  ok(state.ok && state.photos && state.photos.checked === 6, `the sync is clean and checks 6 SKUs, got ${JSON.stringify(state.photos)}`);
  eq([state.photos.found, state.photos.withPhoto, state.photos.calls], [5, 3, 1], '5 in the catalog, 3 with a real photo, one catalog call');
  eq(catalogCalls.length, 1, 'all six in a single list');
  eq(catalogCalls[0], ['SKU-1', 'SKU-2', 'SKU-3', 'SKU-4', 'SKU-5', 'SKU-6'], '…newest sale first (SKU-6 sold yesterday, so it goes last)');
  eq(row('SKU-1'), { image_url: PHOTO('SKU-1'), in_catalog: 1 }, 'a real photo is kept');
  eq(row('SKU-4'), { image_url: null, in_catalog: 1 }, 'the "no image available" placeholder is not a photo');
  eq(row('SKU-5'), { image_url: null, in_catalog: 1 }, 'a photo on another host is not kept');
  eq(row('SKU-6'), { image_url: null, in_catalog: 0 }, 'a SKU that has left the catalog is recorded as such');
  catalogCalls = [];
  await tick(env, '2026-11-18T20:00:00Z');
  eq(catalogCalls.length, 0, 'the next sync asks nothing: every SKU has been looked up');
}

// ── 2. the read carries the photo, in the same order ───────────────────────
{
  const r = await call(env, 'ecom-items&company=163&from=2026-11-17&to=2026-11-18');
  eq(r.body.items.map(x => [x.sku, x.image]), [['SKU-6', null], ['SKU-5', null], ['SKU-4', null], ['SKU-3', PHOTO('SKU-3')], ['SKU-2', PHOTO('SKU-2')], ['SKU-1', PHOTO('SKU-1')]],
    'each product has its photo or null, still best seller first');
  const u = await call(env, 'ecom-items&company=163&from=2026-11-17&to=2026-11-18&sort=units');
  eq(u.body.items.map(x => x.sku), ['SKU-6', 'SKU-5', 'SKU-4', 'SKU-3', 'SKU-2', 'SKU-1'], 'By units keeps its order too (ties broken by sales)');
}

// ── 3. batching and the per-sync cap ──────────────────────────────────────
{
  for (let n = 1; n <= 260; n++) order('BIG-' + n, 1, 12);
  catalogCalls = [];
  const s1 = await tick(env, '2026-11-18T20:15:00Z');
  eq([s1.photos.checked, s1.photos.calls], [200, 4], 'a sync checks at most 200 SKUs, in 4 calls');
  ok(catalogCalls.every(c => c.length <= 50), `no call asks for more than 50 SKUs (${catalogCalls.map(c => c.length).join(', ')})`);
  const s2 = await tick(env, '2026-11-18T20:30:00Z');
  eq([s2.photos.checked, s2.photos.calls], [60, 2], 'the next sync takes the remaining 60');
  eq(db.prepare("SELECT COUNT(*) AS n FROM ecom_products WHERE sku LIKE 'BIG-%' AND image_url IS NOT NULL").get().n, 260, 'every bulk SKU ends with its photo');
}

// ── 4. a SKU with a comma cannot ride in the list ─────────────────────────
{
  order('A,B', 3, 13);
  catalogCalls = [];
  await tick(env, '2026-11-18T20:45:00Z');
  ok(!catalogCalls.flat().includes('A') && row('A,B') && row('A,B').in_catalog === 0, 'it is recorded as not found without a call');
}

// ── 5. a refused catalog never fails the orders ───────────────────────────
{
  const t = setup();
  catalogRefused = true;
  const s = await tick(t.env);
  ok(s && s.ok === true && s.photos && s.photos.error && s.photos.status === 403, `orders sync, photos report the refusal, got ${JSON.stringify(s && s.photos)}`);
  eq(t.db.prepare("SELECT COUNT(*) AS n FROM ecom_products WHERE sku <> 'A,B'").get().n, 0, 'and nothing is written for photos (only the comma SKU, which needs no call)');
  ok(t.db.prepare('SELECT COUNT(*) AS n FROM ecom_orders').get().n > 0, 'while the orders are');
  catalogRefused = false;
}

// ── 6. worker ahead of migration-092 ──────────────────────────────────────
{
  const pre = setup({ photos: false });
  const s = await tick(pre.env);
  ok(s && s.ok === true && s.photos && s.photos.skipped === 'not set up', `orders sync, photos skipped, got ${JSON.stringify(s && s.photos)}`);
  const r = await call(pre.env, 'ecom-items&company=163&from=2026-11-18&to=2026-11-18');
  ok(r.status === 200 && r.body.items.length > 0 && r.body.items.every(x => x.image === null), `the read still answers, with no photos, got ${r.status}`);
  eq((await call(pre.env, 'ecom-photos', { user: 'u-su', method: 'POST', body: {} })).status, 503, 'the catch-up says "not set up"');
}

// ── 7. the catch-up ────────────────────────────────────────────────────────
{
  const t = setup();
  await tick(t.env);                                         // writes lines, and looks up 200 of them
  t.db.prepare('DELETE FROM ecom_products').run();           // as if the SKUs had been sold before photos existed
  catalogCalls = [];
  const r = await call(t.env, 'ecom-photos', { user: 'u-su', method: 'POST', body: { limit: 100 } });
  ok(r.status === 200 && r.body.ok && r.body.checked === 100 && r.body.calls === 2, `limit 100 → 100 SKUs in 2 calls, got ${r.status} ${r.text.slice(0, 140)}`);
  const all = t.db.prepare('SELECT COUNT(DISTINCT sku) AS n FROM ecom_order_items').get().n;
  eq(r.body.remaining, all - 100, 'and says how many are left');
  const r2 = await call(t.env, 'ecom-photos', { user: 'u-su', method: 'POST', body: {} });
  eq([r2.body.checked, r2.body.remaining], [all - 100, 0], 'the default limit takes the rest');
  catalogCalls = [];
  for (const [body, why] of [[{ limit: 0 }, '0'], [{ limit: 5001 }, '5001'], [{ limit: 1.5 }, '1.5'], [{ limit: 'x' }, '"x"']]) {
    eq((await call(t.env, 'ecom-photos', { user: 'u-su', method: 'POST', body })).status, 400, `limit ${why} → 400`);
  }
  eq((await call(t.env, 'ecom-photos', { user: 'u-su' })).status, 405, 'GET → 405');
  eq((await call(t.env, 'ecom-photos', { user: 'u-admin', method: 'POST', body: {} })).status, 403, 'an E-Commerce admin who is not a superuser is refused');
  eq((await call(t.env, 'ecom-photos', { secret: t.env.SNAPSHOT_SECRET, method: 'POST', body: {} })).status, 403, 'the snapshot secret alone gets nothing');
  eq(catalogCalls.length, 0, '…and none of those reached Sellercloud');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
