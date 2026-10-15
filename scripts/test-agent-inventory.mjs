// The Inventory queries agents get (cli/reporting.mjs), driven end to end: the real
// MCP worker → service binding → the real main worker's read-through endpoints over
// the harness's sqlite D1, with Clover stubbed at the HTTP boundary.
//
// WHAT THIS PROTECTS. Brian (2026-10-15): agents read the Viewer, Schedule Sale, Bin
// Dump, Receiver and Mark Out of Stock — names included, Opportunity Buys not. Each
// tool trims a page payload; a trim that drops the second page of the catalog, totals
// only the rows it lists, or shows cents as dollars is a confident wrong answer. Every
// expected figure here is computed from the seed, never from the shaping code.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadWorker, makeEnv, ctx, blockNetwork, stubWorkersRuntime, applyMigrationAlters } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const UP = 'test-briefing-key', MCP = 'test-mcp-key';
const main = await loadWorker(repo);
const { db, env: mainEnv } = makeEnv(repo);
mainEnv.MORNING_BRIEFING_KEY = UP;
for (const m of ['002', '058', '062', '065']) db.exec(fs.readFileSync(path.join(repo, `migration-${m}.sql`), 'utf8'));
applyMigrationAlters(db, repo);
blockNetwork();
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();

// ── Clover: BL2's catalog, 1,500 items, so the Viewer needs two pages ─────
// Every 10th is a lamp, every 7th has no cost, every 50th is hidden, and items
// 1001-1005 reuse the codes of items 1-5 (five duplicate codes).
const CATALOG = Array.from({ length: 1500 }, (_, i) => {
  const n = i + 1;
  return {
    id: 'I' + n, name: (n % 10 === 0 ? 'Brass Lamp ' : 'Item ') + String(n).padStart(4, '0'),
    code: 'BL-' + (n > 1000 && n <= 1005 ? n - 1000 : n), price: 1999, ...(n % 7 !== 0 && { cost: 600 }),
    hidden: n % 50 === 0, defaultTaxRates: true,
    categories: { elements: n === 3 ? [{ id: 'S', name: 'Sku Book Items' }, { id: 'C', name: 'FG BL HOME - DECOR' }] : [{ id: 'C', name: 'FG BL HOME - DECOR' }] },
  };
});
mainEnv.BL2_MERCHANT_ID = 'M2';
mainEnv.BL2_API_TOKEN = 'clover-token-bl2';
// BL4's catalog never ends (every page full), to prove the paging stops.
mainEnv.BL4_MERCHANT_ID = 'M4';
mainEnv.BL4_API_TOKEN = 'clover-token-bl4';
const clover = [];
const blocked = globalThis.fetch;
globalThis.fetch = async (u, init) => {
  const s = String(u);
  if (s.startsWith('https://api.clover.com/v3/merchants/M4/items?')) {
    clover.push(s);
    return new Response(JSON.stringify({ elements: CATALOG.slice(0, 1000) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (!s.startsWith('https://api.clover.com/v3/merchants/M2/')) return blocked(u, init);
  clover.push(s);
  const offset = Number(new URL(s).searchParams.get('offset') || 0);
  const elements = s.includes('/items?') ? CATALOG.slice(offset, offset + 1000) : [];
  return new Response(JSON.stringify({ elements }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const lamps = CATALOG.filter(i => i.name.startsWith('Brass Lamp')).length;
const noCost = CATALOG.filter(i => !i.cost).length;
const hidden = CATALOG.filter(i => i.hidden).length;

// ── D1: schedules, bin dumps, trucks, out of stock ─────────────────────────
const sched = db.prepare(`INSERT INTO sale_schedules (schedule_group, store, item_id, item_name, discount_kind, discount_value,
  original_price, sale_price, starts_at, ends_at, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
sched.run('g-pct', 'BL2', 'I10', 'Brass Lamp 0010', 'percent', 20, 1999, 1599, ago(24), ago(-24), 'active', ago(48));
sched.run('g-amt', 'BL2', 'I20', 'Brass Lamp 0020', 'amount', 150, null, null, ago(-24), ago(-48), 'pending', ago(2));
const dump = db.prepare(`INSERT INTO bin_dumps (store, barcode, item_no, pallet_name, po, units, r2_key, logged_by, logged_at) VALUES (?,?,?,?,?,?,?,?,?)`);
for (let i = 0; i < 150; i++) dump.run('BL2', 'PRM-' + i, String(10000 + i), 'Mixed', 'PO' + i, 10 + i, i === 0 ? 'bins/0.jpg' : null, 'Sam (associate)', ago(1 + i));
dump.run('BL1', 'PRM-X', '20000', 'Toys', 'POX', 77, null, 'lead@bargainlane.com', ago(2));
const bl2DumpUnits = Array.from({ length: 150 }, (_, i) => 10 + i).reduce((a, b) => a + b, 0);
const truck = db.prepare(`INSERT INTO trucks (store, bol_no, ship_from, pallet_count, opened_by, opened_at, closed_by, closed_at, dup_approved_by, dup_reason) VALUES (?,?,?,?,?,?,?,?,?,?)`);
const bl1Closed = truck.run('BL1', 'BOL-1', 'RM1', 2, 'lead@bargainlane.com', ago(80), 'lead@bargainlane.com', ago(78), null, null).lastInsertRowid;
const bl2Old = truck.run('BL2', 'BOL-2', 'RM1', 1, 'Sam (associate)', ago(60), 'Sam (associate)', ago(59), 'alyson@bargainlane.com', 'Re-sent BOL').lastInsertRowid;
const bl2Open = truck.run('BL2', 'BOL-3', 'RM2', 3, 'Sam (associate)', ago(3), null, null, null, null).lastInsertRowid;
const pallet = db.prepare(`INSERT INTO truck_pallets (truck_id, store, barcode, units, logged_by, logged_at, dup_approved_by) VALUES (?,?,?,?,?,?,?)`);
pallet.run(bl1Closed, 'BL1', 'P-1', 40, 'lead@bargainlane.com', ago(79), null);
pallet.run(bl1Closed, 'BL1', 'P-2', 45, 'lead@bargainlane.com', ago(79), null);
pallet.run(bl2Old, 'BL2', 'P-3', 30, 'Sam (associate)', ago(59), 'alyson@bargainlane.com');
for (const [b, u] of [['P-4', 20], ['P-5', 21], ['P-6', 22]]) pallet.run(bl2Open, 'BL2', b, u, 'Sam (associate)', ago(2), null);
const mos = db.prepare(`INSERT INTO mos_entries (store, code, item_no, description, qty, unit_cost_cents, unit_price_cents, reason, logged_by, logged_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
mos.run('BL2', 'BL-50038-1_5', '50038', 'Snacks', 3, 40, 150, 'Stolen', 'Sam (associate)', ago(6));
mos.run('BL2', 'BL-50039-2', '50039', 'Toys', 2, 75, 200, 'Damaged', 'Sam (associate)', ago(5));
mos.run('BL2', 'BL-50040-4', '50040', 'Cleaning', 1, 120, 400, 'Store Use', 'lead@bargainlane.com', ago(4));
mos.run('BL2', 'BL-59999-3', '59999', 'Unknown', 4, null, 300, 'Expired', 'Sam (associate)', ago(3));
mos.run('BL1', 'BL-50038-1_5', '50038', 'Snacks', 1, 40, 150, 'Stolen', 'lead@bargainlane.com', ago(2));

// ── The MCP worker, bound to the real main worker ──────────────────────────
await stubWorkersRuntime();
const { default: mcp, MAX_RESULT_CHARS } = await import(pathToFileURL(path.join(repo, 'mcp', 'worker.mjs')).href);
const upstream = [];
const env = { MCP_KEY: MCP, REPORTING_API_KEY: UP,
  API: { fetch: async (r) => { upstream.push({ url: r.url, method: r.method, key: r.headers.get('X-API-Key') }); return main.fetch(r, mainEnv, ctx); } } };
let id = 1;
let lastText = '';
async function tool(name, args = {}) {
  const r = await mcp.fetch(new Request('https://mcp.retjghub.com/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + MCP },
    body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } }),
  }), env, ctx);
  const res = (await r.json()).result;
  if (!res) return { error: 'no result' };
  lastText = res.content[0].text;
  if (res.isError) return { isError: true, text: lastText };
  return JSON.parse(lastText);
}
const since = (n) => upstream.slice(n).map(u => new URL(u.url).searchParams);

// ── get_inventory_items ────────────────────────────────────────────────────
{
  const n = upstream.length, c = clover.length;
  const r = await tool('get_inventory_items', { storeId: 'bl2' });
  const calls = since(n);
  eq(calls.map(p => [p.get('action'), p.get('store'), p.get('offset')]), [['inventory-items', 'BL2', '0'], ['inventory-items', 'BL2', '1000']],
    'reads the catalog in two pages (offset 0, then 1000), store upper-cased');
  ok(upstream.slice(n).every(u => u.method === 'GET' && u.key === UP), 'as GETs with the reporting key');
  eq(clover.length - c, 2, 'and Clover is asked exactly twice');
  eq([r.items, r.hidden, r.noCost, r.duplicateCodes], [1500, hidden, noCost, 5], 'counts cover the WHOLE catalog, both pages');
  eq([r.matched, r.listed, r.rows?.length], [1500, 100, 100], 'lists 100 by default');
  const names = (r.rows || []).map(x => x.name);
  ok(names.join() === [...names].sort((a, b) => a.localeCompare(b)).join(), 'A-Z by name');
  const lamp = (r.rows || []).find(x => x.name === 'Brass Lamp 0010');
  eq(lamp && [lamp.price, lamp.cost, lamp.gpPct, lamp.category, lamp.hidden, lamp.taxable], [19.99, 6, 70, 'FG BL HOME - DECOR', false, true],
    'money in dollars, GP % as the page computes it (price − cost) / price');
  const s = await tool('get_inventory_items', { storeId: 'BL2', search: 'lamp', limit: 500 });
  eq([s.matched, s.rows?.every(x => x.name.startsWith('Brass Lamp'))], [lamps, true], 'search matches the name, any case');
  eq((await tool('get_inventory_items', { storeId: 'BL2', search: 'home - decor', limit: 1 })).matched, 1500, 'and the category');
  const nc = await tool('get_inventory_items', { storeId: 'BL2', itemFilter: 'no-cost', limit: 500 });
  eq([nc.matched, nc.rows?.every(x => x.cost === null && x.gpPct === null)], [noCost, true], 'no-cost: cost null (not on file), never 0, and no GP %');
  const dup = await tool('get_inventory_items', { storeId: 'BL2', itemFilter: 'duplicates' });
  eq([dup.matched, dup.rows?.every(x => x.duplicateCode)], [10, true], 'duplicates: both items of each of the 5 shared codes');
  eq(dup.rows?.slice(0, 2).map(x => x.code), ['BL-1', 'BL-1'], 'with each pair side by side');
  eq((await tool('get_inventory_items', { storeId: 'BL2', itemFilter: 'hidden', limit: 500 })).matched, hidden, 'hidden: the hidden items');
  const three = (await tool('get_inventory_items', { storeId: 'BL2', search: 'Item 0003' })).rows?.[0];
  eq(three?.alsoIn, ['Sku Book Items'], 'an item in two categories says which other one');
  ok(lastText.length < MAX_RESULT_CHARS, 'a default answer fits in one tool result');
  ok((await tool('get_inventory_items', {})).isError, 'storeId is required');
  const c4 = clover.length;
  const endless = await tool('get_inventory_items', { storeId: 'BL4' });
  ok(endless.isError && /More than 20 pages/.test(endless.text), 'a catalog that never ends stops after 20 pages, as an error');
  eq(clover.length - c4, 20, 'having asked Clover exactly 20 times');
  const bad = await tool('get_inventory_items', { storeId: 'BL99' });
  ok(bad.isError && /Invalid store/.test(bad.text), 'an unknown store is a tool error naming the problem');
}

// ── get_sale_schedules ─────────────────────────────────────────────────────
{
  const r = await tool('get_sale_schedules', { storeId: 'BL2' });
  const pct = r.schedules?.find(g => g.scheduleGroup === 'g-pct'), amt = r.schedules?.find(g => g.scheduleGroup === 'g-amt');
  eq([pct?.status, pct?.discountPct, pct?.items?.[0]?.originalPrice, pct?.items?.[0]?.salePrice], ['active', 20, 19.99, 15.99], 'a % sale with its prices in dollars');
  eq([amt?.status, amt?.discountOff, amt?.items?.[0]?.salePrice], ['pending', 1.5, null], 'an amount-off sale: $1.50 off, no price until it starts');
  eq((await tool('get_sale_schedules', { storeId: 'BL2', scheduleFilter: 'upcoming' })).schedules?.map(g => g.scheduleGroup), ['g-amt'], 'filter upcoming: only the pending one');
  ok((await tool('get_sale_schedules', {})).isError, 'storeId is required');
}

// ── get_bin_dumps ──────────────────────────────────────────────────────────
{
  const n = upstream.length;
  const r = await tool('get_bin_dumps');
  const p = since(n)[0];
  eq([p.get('action'), p.get('store'), p.get('weeks'), p.get('limit')], ['bin-dump-list', 'ALL', '8', '5000'], 'reads every store, 8 weeks, to the server cap');
  eq([r.totals?.byStore?.BL2?.entries, r.totals?.byStore?.BL2?.units, r.totals?.byStore?.BL1?.units], [150, bl2DumpUnits, 77],
    'totals count every dump in the period, not just the listed ones');
  eq([r.listed, r.rows?.length, r.complete], [100, 100, true], 'lists the newest 100');
  const weekSum = Object.values(r.totals?.byWeek || {}).reduce((a, w) => a + w.units, 0);
  eq(weekSum, bl2DumpUnits + 77, 'the weekly totals add up to the same units');
  ok(r.rows?.every(x => x.logged_by), 'every row says who logged it (Brian: include names)');
  ok(r.rows?.every(x => !('photo_url' in x) && !('r2_key' in x)) && r.rows?.some(x => x.has_photo === true), 'photo links dropped (images need a session), has_photo kept');
  const one = await tool('get_bin_dumps', { storeId: 'BL1', dumpWeeks: 2, limit: 5 });
  eq([since(upstream.length - 1)[0].get('store'), since(upstream.length - 1)[0].get('weeks'), Object.keys(one.totals?.byStore || {})], ['BL1', '2', ['BL1']], 'one store, 2 weeks');
}

// ── get_trucks and get_truck ───────────────────────────────────────────────
{
  const r = await tool('get_trucks');
  eq(r.totals?.byStore?.BL2, { trucks: 2, onDock: 1, palletsReceived: 4, units: 93, duplicatesApproved: 1 }, 'BL2: two trucks, one on the dock, 4 pallets, 93 units, one approved duplicate');
  eq(r.totals?.byStore?.BL1, { trucks: 1, onDock: 0, palletsReceived: 2, units: 85, duplicatesApproved: 0 }, 'BL1: one truck received, 85 units');
  const old = r.rows?.find(x => x.bol_no === 'BOL-2');
  eq([old?.pallet_count, old?.received, old?.opened_by, old?.dup_approved_by, old?.dup_reason], [1, 1, 'Sam (associate)', 'alyson@bargainlane.com', 'Re-sent BOL'],
    'a row: pallets claimed vs received, and who opened and approved it');
  const t = await tool('get_truck', { truckId: Number(bl1Closed) });
  eq([t.truck?.bol_no, t.palletsReceived, t.units, t.pallets?.map(x => x.barcode).sort()], ['BOL-1', 2, 85, ['P-1', 'P-2']], 'truckId: that truck and its pallets');
  const dock = await tool('get_truck', { storeId: 'BL2' });
  eq([dock.truck?.bol_no, dock.palletsReceived, dock.units], ['BOL-3', 3, 63], 'storeId: the truck on that dock now');
  eq(await tool('get_truck', { storeId: 'BL1' }), { store: 'BL1', truck: null, note: 'No truck is open at this store.' }, 'no open truck says so');
  ok((await tool('get_truck', {})).isError && (await tool('get_truck', { truckId: 1, storeId: 'BL1' })).isError, 'exactly one of truckId and storeId');
}

// ── get_out_of_stock ───────────────────────────────────────────────────────
{
  const r = await tool('get_out_of_stock', { storeId: 'BL2' });
  const sum = (k) => (r.months || []).reduce((a, m) => a + m[k], 0);
  // Stolen 3×$0.40 + Damaged 2×$0.75 = $2.70 shrink; Store Use 1×$1.20; Expired has no cost.
  eq([sum('shrinkCost'), sum('storeUseCost'), sum('linesWithoutCost'), sum('lines')].map(v => Math.round(v * 100) / 100), [2.7, 1.2, 1, 4],
    'monthly totals in dollars: shrink excludes Store Use, a line with no cost is counted as short');
  eq(Math.round(sum('retail') * 100) / 100, 3 * 1.5 + 2 * 2 + 4 + 4 * 3, 'retail value of every line with a price');
  const stolen = r.rows?.find(x => x.reason === 'Stolen');
  eq([stolen?.unitCost, stolen?.unitPrice, stolen?.logged_by], [0.4, 1.5, 'Sam (associate)'], 'a row in dollars, with who logged it');
  eq(r.rows?.find(x => x.reason === 'Expired')?.unitCost, null, 'no cost on file stays null');
  const cut = await tool('get_out_of_stock', { storeId: 'BL2', limit: 1 });
  eq([cut.rows?.length, cut.moreRows, Math.round(cut.months.reduce((a, m) => a + m.shrinkCost, 0) * 100) / 100], [1, true, 2.7],
    'limit 1: one row listed, moreRows, and the totals are still the whole period');
  ok(Object.keys((await tool('get_out_of_stock')).rows.reduce((a, x) => ({ ...a, [x.store]: 1 }), {})).sort().join() === 'BL1,BL2', 'no storeId: every store');
}

// ── The catalog of tools ───────────────────────────────────────────────────
{
  const list = await (await mcp.fetch(new Request('https://mcp.retjghub.com/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + MCP },
    body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'tools/list' }),
  }), env, ctx)).json();
  const tools = list.result?.tools || [];
  const inv = ['get_inventory_items', 'get_sale_schedules', 'get_bin_dumps', 'get_trucks', 'get_truck', 'get_out_of_stock'];
  ok(inv.every(n => tools.some(t => t.name === n)), 'all six Inventory tools are listed');
  ok(tools.filter(t => inv.includes(t.name)).every(t => t.annotations?.readOnlyHint === true), 'all read-only');
  ok(!tools.some(t => /opportunit|buy/i.test(t.name)), 'and no Opportunity Buys tool (Brian: not this time)');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
