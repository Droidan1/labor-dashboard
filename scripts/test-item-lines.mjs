// item_day_lines: the app's own per-ITEM record, saved beside the items: snapshot.
//
// WHAT THIS PROTECTS. Brian (2026-10-16) wants item numbers from BEFORE the L2/L3 rollup,
// and to see how each item gets filed. aggregateItemSales already resolves every line to
// an L2/L3 and keeps only category totals; this keeps the items too. Three properties
// carry the weight:
//   1. Each item says how it was filed (override, its Clover category, the sku book, its
//      name, a heuristic, Custom Sales…) with the L2/L3 the app chose, so a mis-filed item
//      can be found.
//   2. The items add up to the day: Σ item net + what reached no item (service charges,
//      unattributable and manual refunds) == the snapshot's netSales. The item rows and the
//      category totals are accumulated separately, so this checks one against the other.
//   3. It can never cost the day its snapshot, never wipe a day with nothing, and never
//      leak into the items: snapshot or the live items answer.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadWorker, makeEnv, ctx, req, stubWorkersRuntime } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
db.exec(fs.readFileSync(path.join(repo, 'migration-078.sql'), 'utf8'));
env.BL1_MERCHANT_ID = 'M1';
env.BL1_API_TOKEN = 'clover-token-bl1';
const D = '2026-10-14';
const T = Date.parse(`${D}T15:00:00Z`);   // 11:00 ET

// ── Catalog, overrides, costs (KV, as production keeps them) ────────────────
await env.SALES_SNAPSHOTS.put('item-cats:bl1', JSON.stringify({
  'I-CAT': 'FG BL CONSUMABLES - FOOD - CANDY',   // a mapped Clover category
  'I-SKU': 'Sku Book Items',                      // the POS convenience page
  'I-UNM': 'SOME NEW CLOVER CATEGORY',            // a Clover category nobody mapped
}));
await env.SALES_SNAPSHOTS.put('item-overrides:global', JSON.stringify({ items: { 'id:I-OVR': { l2: 'Furniture' } } }));
await env.SALES_SNAPSHOTS.put('category-costs:global', JSON.stringify({ costs: { 'FG BL CONSUMABLES - FOOD - CANDY': 0.4 } }));

// ── One store-day of orders, every way an item gets filed ──────────────────
const li = (id, name, price, item, extra = {}) => ({ id, name, price, ...(item && { item }), ...extra });
const order = (id, lines, payment, extra = {}) => ({
  id, state: 'locked', total: payment, createdTime: T, clientCreatedTime: T,
  payments: { elements: [{ id: 'p-' + id, amount: payment, taxAmount: 0 }] },
  lineItems: { elements: lines }, ...extra,
});
const ORDERS = [
  // 10% off the whole order, spread over its lines by their share.
  order('O1', [
    li('l1', 'FG BL CONSUMABLES - FOOD - CANDY', 1000, { id: 'I-CAT', code: 'BL-50020-10' }),
    li('l2', '$10 Boots', 200, { id: 'I-SKU', code: 'SB-1' }),
    li('l3', 'FG BL CONSUMABLES - FOOD - SNACKS', 150, { id: 'I-NAME', code: 'BL-50038-1_5' }),
  ], 1215, { discounts: { elements: [{ percentage: '10' }] } }),
  // A $1 line discount, an override, a Custom Sales line, and a 75¢ service charge.
  order('O2', [
    li('l4', '$3 Bin', 300, { id: 'I-BIN' }, { discounts: { elements: [{ amount: -100 }] } }),
    li('l5', 'Big table', 250, { id: 'I-OVR' }),
    li('l6', 'Mystery thing', 400, null),
  ], 925),
  // The candy again, a refund line, and an unmapped Clover category.
  order('O3', [
    li('l7', 'FG BL CONSUMABLES - FOOD - CANDY', 2000, { id: 'I-CAT', code: 'BL-50020-10' }),
    li('l8', 'Refund', -500, null),
    li('l9', 'Thing', 300, { id: 'I-UNM' }),
  ], 1800),
];
// $3.30 back on O1 (split over its lines), $2 back on an order from another day, $1 manual.
const REFUNDS = [
  { id: 'R1', amount: 330, taxAmount: 0, createdTime: T + 3600e3, orderRef: { id: 'O1' } },
  { id: 'R2', amount: 200, taxAmount: 0, createdTime: T + 3600e3, orderRef: { id: 'O-OLD' } },
];
const CREDITS = [{ id: 'M1', amount: 100, taxAmount: 0, result: 'SUCCESS', createdTime: T + 7200e3 }];

let orders = ORDERS;
globalThis.fetch = async (u) => {
  const s = String(u);
  const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  if (!s.startsWith('https://api.clover.com/v3/merchants/M1/')) return J({ elements: [] });
  const url = new URL(s);
  const first = (url.searchParams.get('offset') || '0') === '0';
  // Honour the createdTime window, as Clover does, so a fetch for another day is empty.
  const filters = url.searchParams.getAll('filter');
  const since = Number((filters.find(f => f.startsWith('createdTime>=')) || '').split('>=')[1] || 0);
  const until = Number((filters.find(f => f.startsWith('createdTime<')) || '').split('<')[1] || Infinity);
  const inWindow = (x) => x.createdTime >= since && x.createdTime < until;
  if (/\/orders\/[^/?]+$/.test(url.pathname)) return J({ message: 'not found' }, 404);   // O-OLD: aged out
  if (url.pathname.endsWith('/orders')) return J({ elements: first ? orders.filter(inWindow) : [] });
  if (url.pathname.endsWith('/refunds')) return J({ elements: first ? REFUNDS.filter(inWindow) : [] });
  if (url.pathname.endsWith('/credits')) return J({ elements: first ? CREDITS.filter(inWindow) : [] });
  return J({ elements: [] });
};

const snapshotDay = () => worker.fetch(req(`/?action=items-snapshot&store=BL1&date=${D}`, { method: 'POST', secret: env.SNAPSHOT_SECRET }), env, ctx);
const lineRow = (date = D) => db.prepare('SELECT * FROM item_day_lines WHERE store = ? AND date = ?').get('BL1', date);
const r2 = (n) => Math.round(n * 100) / 100;

// ── 1. A snapshot writes the record beside items: ──────────────────────────
{
  const r = await snapshotDay();
  const body = await r.json();
  eq([r.status, body.results?.BL1?.ok], [200, true], 'items-snapshot runs');
  const snap = JSON.parse(await env.SALES_SNAPSHOTS.get(`items:bl1:${D}`));
  const row = lineRow();
  ok(!!row, 'and an item_day_lines row exists for the store-day');
  eq(row?.snapshot_time, snap.snapshotTime, 'stamped with the SAME snapshotTime as items:');
  const items = JSON.parse(row?.items_json || '[]'), other = JSON.parse(row?.other_json || '{}');
  eq([row?.item_count, items.length], [8, 8], 'eight items');
  const by = (pred) => items.find(pred);
  const pick = (x) => x && [x.source, x.l2, x.l3, x.cloverCategory];
  eq(pick(by(i => i.itemId === 'I-CAT')), ['clover-category', 'Consumable Food', 'FG BL CONSUMABLES - FOOD - CANDY', 'FG BL CONSUMABLES - FOOD - CANDY'], 'filed by its Clover category');
  eq(pick(by(i => i.itemId === 'I-SKU')), ['sku-book', 'Softline - Shoes', 'Sku Book Items', 'Sku Book Items'], 'a sku-book item, by its sku-book name');
  eq(pick(by(i => i.itemId === 'I-NAME')), ['name', 'Consumable Food', 'FG BL CONSUMABLES - FOOD - SNACKS', null], 'no Clover category: matched by its NAME');
  eq(pick(by(i => i.itemId === 'I-BIN')), ['heuristic', 'Bin Products', '[Heuristic] Bin Products', null], 'a name rule (bins)');
  eq(pick(by(i => i.itemId === 'I-OVR')), ['override', 'Furniture', '[Override] Furniture', null], 'an admin override');
  eq(pick(by(i => i.name === 'Mystery thing')), ['custom', 'Custom Sales', 'Mystery thing', null], 'nothing matched: Custom Sales');
  eq(pick(by(i => i.itemId === 'I-UNM')), ['unmapped-clover-category', 'Uncategorized', 'SOME NEW CLOVER CATEGORY', 'SOME NEW CLOVER CATEGORY'], 'a Clover category nobody mapped');
  eq(pick(by(i => i.name === 'Refund')), ['refund-line', 'Refund', 'Refund', null], 'a refund line on a ticket');
  const money = (x) => x && [x.qty, x.gross, x.lineDiscounts, x.orderDiscounts, x.refunds, x.net];
  eq(money(by(i => i.itemId === 'I-CAT')), [2, 30, 0, -1, -2.44, 26.56], 'candy: 2 sold, $1 of the order discount, $2.44 of the O1 refund');
  eq([by(i => i.itemId === 'I-CAT')?.cost, by(i => i.itemId === 'I-CAT')?.costSource, by(i => i.itemId === 'I-CAT')?.orders], [0.8, 'category', 2], 'its cost from the category cost, in 2 orders');
  eq(money(by(i => i.itemId === 'I-SKU')), [1, 2, 0, -0.2, -0.49, 1.31], 'boots: their share of the order discount and refund');
  eq(money(by(i => i.itemId === 'I-NAME')), [1, 1.5, 0, -0.15, -0.37, 0.98], 'snacks: the last line takes the refund\'s rounding');
  eq(money(by(i => i.itemId === 'I-BIN')), [1, 3, -1, 0, 0, 2], 'the bin: its own $1 line discount');
  eq(money(by(i => i.name === 'Refund')), [0, 0, 0, 0, -5, -5], 'the refund line: no units, -$5');
  eq(by(i => i.name === 'Mystery thing')?.itemId, null, 'a line with no Clover item keeps no id');
  eq(other, { nonItem: 0.75, crossDayRefunds: 0, unattributedRefunds: -2, manualRefunds: -1 }, 'what reached no item: the service charge, the refund on another day\'s order, the manual refund');
  const sumItems = r2(items.reduce((s, i) => s + i.net, 0));
  const sumOther = r2(Object.values(other).reduce((s, v) => s + v, 0));
  eq(r2(sumItems + sumOther), snap.totals.netSales, 'Σ items + what reached no item == the snapshot\'s netSales');
  eq(row?.net, snap.totals.netSales, 'and the row carries that net');
  eq(snap.totals.netSales, 33.1, 'control: the day really is $33.10');
  ok(!JSON.stringify(snap).includes('orderDiscounts') && !('itemLines' in snap), 'the items: snapshot itself is unchanged: no item rows in it');
}

// ── 2. Re-running replaces; the live answer carries no item rows ───────────
{
  const before = lineRow();
  await new Promise(r => setTimeout(r, 5));
  await snapshotDay();
  const after = lineRow();
  eq(db.prepare('SELECT COUNT(*) n FROM item_day_lines').get().n, 1, 're-snapshotting replaces the day, never adds a second row');
  ok(after.snapshot_time !== before.snapshot_time && after.snapshot_time === JSON.parse(await env.SALES_SNAPSHOTS.get(`items:bl1:${D}`)).snapshotTime, 'with the new snapshotTime');
  const live = await worker.fetch(req(`/?action=items&store=BL1&date=${D}`, { user: 'u-su' }), env, ctx);
  const text = await live.text();
  eq(live.status, 200, 'the items endpoint still answers');
  ok(!text.includes('orderDiscounts') && !text.includes('lineDiscounts'), 'and carries no item rows');
}

// ── 3. A failing record never costs the day its snapshot ───────────────────
{
  const realPrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => (/item_day_lines/.test(sql) ? { bind: () => ({ run: async () => { throw new Error('D1_ERROR: network'); } }) } : realPrepare(sql));
  const prevStamp = lineRow().snapshot_time;
  const warn = console.warn, logs = [];
  console.warn = (...a) => logs.push(a.join(' '));
  try {
    const r = await snapshotDay();
    eq((await r.json()).results?.BL1?.ok, true, 'with the record write failing, the snapshot still succeeds');
  } finally { env.DB.prepare = realPrepare; console.warn = warn; }
  ok(JSON.parse(await env.SALES_SNAPSHOTS.get(`items:bl1:${D}`)).snapshotTime !== prevStamp, 'items: was written');
  ok(logs.some(l => l.includes('[item-lines] bank failed')), 'the failure is logged');
}

// ── 4. The nightly sweep writes it too, and never wipes with nothing ───────
{
  db.exec('DELETE FROM item_day_lines');
  db.prepare(`INSERT INTO item_day_lines (store, date, snapshot_time, item_count, net, items_json, other_json) VALUES ('BL1','2026-10-13','old',1,9.99,'[{"name":"kept"}]','{}')`).run();
  const RealDate = Date;
  const NOW = RealDate.parse('2026-10-16T03:55:30Z');   // 23:55 ET on the 15th
  class FixedDate extends RealDate { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } }
  globalThis.Date = FixedDate;
  const errs = [], err = console.error, warn = console.warn;
  console.error = (...a) => errs.push(a.join(' ')); console.warn = () => {};
  try {
    const pending = [];
    await worker.scheduled({ cron: '55 3 * * *', scheduledTime: NOW }, env, { waitUntil: (p) => pending.push(p), passThroughOnException() {} });
    await Promise.allSettled(pending);
  } finally { globalThis.Date = RealDate; console.error = err; console.warn = warn; }
  const swept = lineRow(D);
  ok(!!swept, 'the nightly clientCreatedTime sweep wrote the 14th\'s record');
  eq(swept && JSON.parse(swept.items_json).length, 8, 'with its eight items');
  eq(swept?.snapshot_time, JSON.parse(await env.SALES_SNAPSHOTS.get(`items:bl1:${D}`)).snapshotTime, 'stamped like the sweep\'s items: snapshot');
  eq(lineRow('2026-10-13')?.items_json, '[{"name":"kept"}]', 'a swept day with no orders did NOT replace the 13th\'s record with nothing');
  ok(!lineRow('2026-10-15'), 'and wrote no empty record for the 15th');
}

// ── 5. ?action=item-lines sums the record over a range ─────────────────────
const UP = 'test-briefing-key';
env.MORNING_BRIEFING_KEY = UP;
const keyed = async (q) => { const r = await worker.fetch(new Request('https://api.retjghub.com/' + q, { headers: { 'X-API-Key': UP } }), env, ctx); return { status: r.status, body: await r.json().catch(() => null) }; };
{
  // A second recorded day, where the candy was filed somewhere else (re-filed since).
  const day12 = [
    { itemId: 'I-CAT', name: 'FG BL CONSUMABLES - FOOD - CANDY', code: 'BL-50020-10', cloverCategory: 'FG BL CONSUMABLES - FOOD - CANDY', l2: 'Consumable Food', l3: 'FG BL CONSUMABLES - FOOD - CANDY', source: 'clover-category', qty: 3, gross: 30, lineDiscounts: 0, orderDiscounts: 0, refunds: 0, net: 30, cost: 1.2, costSource: 'category', orders: 3 },
    { itemId: 'I-CAT', name: 'FG BL CONSUMABLES - FOOD - CANDY', code: 'BL-50020-10', cloverCategory: 'FG BL CONSUMABLES - FOOD - CANDY', l2: 'Hardlines', l3: '[Override] Hardlines', source: 'override', qty: 1, gross: 10, lineDiscounts: 0, orderDiscounts: 0, refunds: 0, net: 10, cost: 0, costSource: 'none', orders: 1 },
  ];
  db.prepare(`INSERT OR REPLACE INTO item_day_lines (store, date, snapshot_time, item_count, net, items_json, other_json) VALUES ('BL1','2026-10-12','t12',2,40,?,?)`)
    .run(JSON.stringify(day12), JSON.stringify({ nonItem: 0, crossDayRefunds: 0, unattributedRefunds: 0, manualRefunds: 0 }));
  db.exec("DELETE FROM item_day_lines WHERE date = '2026-10-13'");   // a recorded store-day that went missing
  const { status, body: b } = await keyed('?action=item-lines&store=BL1&from=2026-10-10&to=2026-10-14');
  eq(status, 200, 'the key reads item-lines');
  const candy = b?.items?.find(i => i.itemId === 'I-CAT' && i.source === 'clover-category');
  eq([candy?.qty, candy?.net, candy?.days, candy?.orders, candy?.firstDate, candy?.lastDate], [5, 56.56, 2, 5, '2026-10-12', '2026-10-14'], 'the candy as filed by its category: both days summed');
  eq(b?.items?.find(i => i.itemId === 'I-CAT' && i.source === 'override')?.l2, 'Hardlines', 'and the day it was filed elsewhere is its own row');
  eq([b?.net, b?.other?.nonItem, b?.other?.manualRefunds], [73.1, 0.75, -1], 'the days\' net and what reached no item, summed');
  eq(b?.coverage?.firstRecord?.BL1, '2026-10-12', 'coverage: when this store\'s record begins');
  eq(b?.coverage?.missing, [{ store: 'BL1', days: 1, dates: ['2026-10-13'] }], 'and the recorded store-day that is missing — not the days before the record began');
  eq((await keyed('?action=item-lines&store=BL1&from=2026-07-01&to=2026-10-14')).status, 400, 'one store, over 92 days → 400');
  const su = await worker.fetch(req('/?action=item-lines&store=BL1&from=2026-10-10&to=2026-10-14', { user: 'u-su' }), env, ctx);
  eq(await su.json(), b, 'the key answers exactly as a superuser does');
  const mgr = await worker.fetch(req('/?action=item-lines&from=2026-10-10&to=2026-10-14', { user: 'u-mgr1' }), env, ctx);
  eq((await mgr.json())?.stores, ['BL1'], 'a BL1 manager reads BL1 only');
  eq((await worker.fetch(req('/?action=item-lines&store=BL2&from=2026-10-10&to=2026-10-14', { user: 'u-mgr1' }), env, ctx)).status, 403, 'and cannot ask for BL2');
  eq((await worker.fetch(req('/?action=item-lines&store=BL1&from=2026-10-10&to=2026-10-14', { user: 'u-staff' }), env, ctx)).status, 403, 'staff are refused');
}

// ── 6. get_item_mapping, through the MCP worker ────────────────────────────
await stubWorkersRuntime();
const { default: mcp } = await import(pathToFileURL(path.join(repo, 'mcp', 'worker.mjs')).href);
const mcpEnv = { MCP_KEY: 'mk', REPORTING_API_KEY: UP, API: { fetch: (r) => worker.fetch(r, env, ctx) } };
let rid = 1;
const tool = async (name, args) => {
  const r = await mcp.fetch(new Request('https://mcp.retjghub.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mk' },
    body: JSON.stringify({ jsonrpc: '2.0', id: rid++, method: 'tools/call', params: { name, arguments: args } }) }), mcpEnv, ctx);
  const res = (await r.json()).result;
  return res.isError ? { isError: true, text: res.content[0].text } : JSON.parse(res.content[0].text);
};
{
  const day = await tool('get_item_mapping', { storeId: 'bl1', from: D, to: D });
  eq([day.totals?.items, day.totals?.net, day.net, day.reconciles], [8, 35.35, 33.1, true], 'one day: 8 items, $35.35 on items, $33.10 the day — and they reconcile');
  eq(day.totals?.bySource?.['clover-category'], { items: 1, net: 26.56 }, 'totals by how items were filed');
  eq(day.rows?.[0]?.name, 'FG BL CONSUMABLES - FOOD - CANDY', 'rows by net, highest first');
  const guessed = await tool('get_item_mapping', { storeId: 'BL1', from: D, to: D, mappingSource: 'guessed' });
  eq(guessed.rows?.map(r => r.source).sort(), ['custom', 'heuristic', 'name', 'unmapped-clover-category'], 'source guessed: the items a rule guessed, where mis-filing hides');
  ok(guessed.rows?.every(r => r.guessed === true), 'each marked guessed');
  eq((await tool('get_item_mapping', { storeId: 'BL1', from: D, to: D, l2: 'consumable food' })).matched, 2, 'l2 filter, any case');
  eq((await tool('get_item_mapping', { storeId: 'BL1', from: D, to: D, search: 'sku book' })).rows?.[0]?.itemId, 'I-SKU', 'search reaches the L3 and Clover category too');
  const filtered = await tool('get_item_mapping', { storeId: 'BL1', from: D, to: D, l2: 'Furniture' });
  eq([filtered.totals?.net, filtered.reconciles], [2.5, true], 'a filter narrows the totals, never the reconciliation');
  ok((await tool('get_item_mapping', { from: '2026-09-01', to: '2026-10-14' })).isError, 'a chain range over 31 days is refused');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
