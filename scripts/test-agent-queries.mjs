// The Retail Summary and Labor queries agents get (cli/reporting.mjs), driven
// end to end: the real MCP worker → service binding → the real main worker's
// read-through endpoints over the harness's sqlite D1 and KV.
//
// WHAT THIS PROTECTS. Each tool trims a large page payload to what an agent can
// read. A trim that drops a store, double-counts a day or re-buckets a week
// wrongly is a confident wrong answer, so the sums are checked against seeded
// figures and against the page endpoint's own answer, not against the trimming
// code. Defaults (the Labor weeks) are computed here independently of it.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadWorker, makeEnv, ctx, blockNetwork, stubWorkersRuntime, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const near = (a, b) => Math.abs(a - b) < 0.005;

const UP = 'test-briefing-key', MCP = 'test-mcp-key';
const main = await loadWorker(repo);
const { db, env: mainEnv } = makeEnv(repo);
mainEnv.MORNING_BRIEFING_KEY = UP;
blockNetwork();

// ── Seed: BL1 and BL2, Sun 2026-09-13 … Sat 2026-10-10 (four full weeks) ───
const l3 = (name, qty, net) => ({ l3: name, qty, netSales: net });
const cat = (name, rows) => ({ category: name, qty: rows.reduce((s, r) => s + r.qty, 0),
  netSales: Math.round(rows.reduce((s, r) => s + r.netSales, 0) * 100) / 100, l3Rows: rows });
const snap = (i) => ({ categories: [
  cat('Consumable Food', [l3('FG BL CONSUMABLES - FOOD - SNACKS', 10 + i, 20 + i), l3('FG BL CONSUMABLES - FOOD - CANDY', 5, 11.5)]),
  cat('Home', [l3('FG BL HOME - KITCHEN', 3, 33.33)]),
], orderCount: 25 });
const dates = [];
for (let d = new Date('2026-09-13T12:00:00Z'); d <= new Date('2026-10-10T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));
db.exec('DELETE FROM daily_sales');
const ins = db.prepare(`INSERT INTO daily_sales (store,date,total,retail,bin,auction,budget,order_count,budget_labor_hours,labor_hours,labor_pct,snapshot_time)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
for (const [k, s] of ['BL1', 'BL2'].entries()) {
  for (const [i, d] of dates.entries()) {
    ins.run(s, d, 1000 + 100 * k + i, 700, 300, 0, 1100, 50, 40, 38, 12, d + 'T07:55:00Z');
    await mainEnv.SALES_SNAPSHOTS.put(`items:${s.toLowerCase()}:${d}`, JSON.stringify(snap(i)));
  }
}
const idx = (d) => dates.indexOf(d);

// ── The MCP worker, bound to the real main worker ──────────────────────────
// mcp/worker.mjs imports the OAuth library, which needs the Workers runtime stubbed.
await stubWorkersRuntime();
const { default: mcp } = await import(pathToFileURL(path.join(repo, 'mcp', 'worker.mjs')).href);
const upstream = [];
const env = { MCP_KEY: MCP, REPORTING_API_KEY: UP,
  API: { fetch: async (r) => { upstream.push({ url: r.url, method: r.method, key: r.headers.get('X-API-Key') }); return main.fetch(r, mainEnv, ctx); } } };
let id = 1;
async function tool(name, args = {}) {
  const r = await mcp.fetch(new Request('https://mcp.retjghub.com/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + MCP },
    body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } }),
  }), env, ctx);
  const res = (await r.json()).result;
  if (!res) return { error: 'no result' };
  if (res.isError) return { isError: true, text: res.content[0].text };
  return JSON.parse(res.content[0].text);
}
const lastQuery = () => new URL(upstream.at(-1).url).searchParams;
const page = async (q) => JSON.parse(await (await main.fetch(req('/' + q, { user: 'u-su' }), mainEnv, ctx)).text());

// ── get_retail_summary ─────────────────────────────────────────────────────
{
  const s = await tool('get_retail_summary', { from: '2026-10-04', to: '2026-10-10' });
  const p = await page('?action=weekly-summary&from=2026-10-04&to=2026-10-10');
  eq(lastQuery().get('action'), 'weekly-summary', 'summary calls weekly-summary');
  eq(s.company, p.company.totals, "summary's company totals are the page's");
  eq(s.stores.BL2, p.stores.BL2.totals, "summary's BL2 totals are the page's");
  const bl2Week = dates.slice(idx('2026-10-04'), idx('2026-10-10') + 1).reduce((a, d) => a + 1100 + idx(d), 0);
  eq(s.stores.BL2.netSales, bl2Week, 'BL2 net for the week is the seeded sum');
  ok(Object.keys(s.stores).length >= 2 && !('daily' in s.stores.BL2) && !('itemSales' in s.stores.BL2), 'stores carry totals only, not the page\'s daily rows or item detail');
  eq(s.categoriesByStore, p.company.l2Matrix, 'the category × store matrix is the page\'s');
  const one = await tool('get_retail_summary', { from: '2026-10-04', to: '2026-10-10', storeId: 'bl2' });
  eq(Object.keys(one.stores), ['BL2'], 'storeId narrows the summary to one store');
  eq(one.company, undefined, 'a one-store summary has no company block');
  eq(one.categoriesByStore[0], { l2: p.company.l2Matrix[0].l2, netSales: p.company.l2Matrix[0].byStore.BL2 }, 'a one-store matrix row is that store\'s net');
  ok((await tool('get_retail_summary', { from: '2026-10-04', to: '2026-10-10', storeId: 'BL99' })).isError, 'an unknown store is a tool error');
  ok((await tool('get_retail_summary', { from: '2026-10-04' })).isError, 'to is required');
}

// ── get_store_categories ───────────────────────────────────────────────────
{
  const c = await tool('get_store_categories', { storeId: 'BL2', from: '2026-10-04', to: '2026-10-05' });
  const p = await page('?action=weekly-store-detail&store=BL2&from=2026-10-04&to=2026-10-05');
  eq(lastQuery().get('store'), 'BL2', 'categories passes the store');
  eq(c.totals, p.totals, 'store totals are the page\'s');
  const food = (c.categories || []).find(x => x.category === 'Consumable Food') || {};
  const pf = p.itemSales.categories.find(x => x.category === 'Consumable Food') || {};
  eq(food.netSales, pf.netSales, 'a category\'s net is the page\'s');
  ok(['qty', 'gross', 'discounts', 'refunds', 'netSales', 'asp', 'extCost', 'grossProfit', 'gpmPct', 'coverage'].every(k => k in food),
    'each category carries the page\'s full column set');
  eq(food.l3, undefined, 'level l2 has no subcategory rows');
  const c3 = await tool('get_store_categories', { storeId: 'BL2', from: '2026-10-04', to: '2026-10-05', level: 'l3' });
  eq((c3.categories || []).find(x => x.category === 'Consumable Food')?.l3?.map(r => r.l3),
    pf.l3Rows.map(r => r.l3), 'level l3 adds the page\'s subcategory rows');
  ok((await tool('get_store_categories', { from: '2026-10-04', to: '2026-10-05' })).isError, 'storeId is required');
  const n = upstream.length;
  ok((await tool('get_store_categories', { storeId: 'BL2', from: '2025-01-01', to: '2026-10-05' })).isError, 'over 366 days is refused');
  eq(upstream.length, n, 'a refused range never reaches the worker');
}

// ── get_trailing_weeks ─────────────────────────────────────────────────────
{
  const w = await tool('get_trailing_weeks', { end: '2026-10-10', weeks: 2 });
  const p = await page('?action=weekly-t13&end=2026-10-10&weeks=2');
  eq(lastQuery().get('weeks'), '2', 'weeks is passed');
  eq(w.weeks.length, p.dates.length, 'one row per week');
  eq(w.weeks.map(r => r.end), p.dates.map(d => d.end), 'weeks keep the page\'s order and end dates');
  const last = w.weeks.length - 1;
  eq(w.weeks[last].stores.BL2.netSales, p.stores.BL2.netSales[last], 'a store\'s week net is the page\'s, aligned by week');
  eq(w.weeks[last].total.netSales, p.total.netSales[last], 'the chain total row is the page\'s');
  eq(w.weeks[0].categories, undefined, 'categories are off by default');
  const wl2 = await tool('get_trailing_weeks', { end: '2026-10-10', weeks: 2, storeId: 'BL2', categories: 'l2' });
  eq(Object.keys(wl2.weeks[last].stores), ['BL2'], 'storeId narrows the weeks');
  eq(wl2.weeks[last].categories.net, p.perStoreL2Net[last].BL2, 'a store\'s weekly category net is the page\'s');
  ok((await tool('get_trailing_weeks', { weeks: 0 })).isError, 'weeks 0 is refused');
  const n3 = upstream.length;
  ok(/needs a storeId/.test((await tool('get_trailing_weeks', { categories: 'l3' })).text || ''), 'subcategories for every store at once are refused');
  eq(upstream.length, n3, 'before they reach the worker');
}

// ── get_category_sales ─────────────────────────────────────────────────────
{
  const from = '2026-10-04', to = '2026-10-10';
  const t = await tool('get_category_sales', { from, to });
  const span = dates.slice(idx(from), idx(to) + 1);
  const foodNet = span.reduce((a, d) => a + 20 + idx(d) + 11.5, 0);
  const foodQty = span.reduce((a, d) => a + 10 + idx(d) + 5, 0);
  ok(near(t.stores?.BL2?.periods?.total?.['Consumable Food']?.net, foodNet), `BL2 Consumable Food net over the week is the seeded sum ${foodNet}`);
  eq(t.stores?.BL2?.periods?.total?.['Consumable Food']?.qty, foodQty, 'and so are its units');
  ok(near(t.chain?.total?.['Consumable Food']?.net, 2 * foodNet), 'the chain sums both stores');
  eq(t.stores?.BL2?.daysWithData, 7, 'days with a snapshot are counted');
  const byDay = await tool('get_category_sales', { from, to, bucket: 'day', storeId: 'BL2' });
  eq(Object.keys(byDay.stores?.BL2?.periods || {}).sort(), span, 'bucket day keys each date');
  eq(byDay.chain, undefined, 'a one-store answer has no chain block');
  const byWeek = await tool('get_category_sales', { from: '2026-09-29', to: '2026-10-06', bucket: 'week' });
  eq(Object.keys(byWeek.stores?.BL1?.periods || {}).sort(), ['2026-10-03', '2026-10-10'], 'bucket week keys each Saturday a day ends in');
  const byMonth = await tool('get_category_sales', { from: '2026-09-29', to: '2026-10-02', bucket: 'month' });
  eq(Object.keys(byMonth.stores?.BL1?.periods || {}).sort(), ['2026-09', '2026-10'], 'bucket month keys YYYY-MM');
  const l3 = await tool('get_category_sales', { from, to, level: 'l3', storeId: 'BL2' });
  ok(near(l3.stores?.BL2?.periods?.total?.['Consumable Food']?.['FG BL CONSUMABLES - FOOD - CANDY']?.net, 11.5 * 7), 'level l3 sums each subcategory');
  eq(lastQuery().get('level'), 'l3', 'level is passed');
  ok((await tool('get_category_sales', { from, to, bucket: 'year' })).isError, 'an unknown bucket is refused');
}

// ── get_category_sales_by_hour ─────────────────────────────────────────────
{
  const h = await tool('get_category_sales_by_hour', { from: '2026-10-04', to: '2026-10-04', storeId: 'BL2' });
  eq(lastQuery().get('action'), 'category-hours', 'by-hour calls category-hours');
  eq(lastQuery().get('store'), 'BL2', 'and passes the store');
  ok(Array.isArray(h.missing) && h.missing.includes('BL2/2026-10-04'), 'a day it could not fetch is listed in missing, not shown as 0');
  const n = upstream.length;
  ok((await tool('get_category_sales_by_hour', { from: '2026-10-01', to: '2026-10-08' })).isError, 'more than 7 days is refused');
  eq(upstream.length, n, 'before it reaches the worker');
  // The hour buckets, on the endpoint's own shape (a banked day needs a live POS fixture).
  const { QUERIES } = await import(pathToFileURL(path.join(repo, 'cli', 'reporting.mjs')).href);
  const q = QUERIES.find(x => x.name === 'get_category_sales_by_hour');
  const body = { from: 'a', to: 'b', level: 'l2', days: 2, source: {}, missing: [],
    l2: { BL1: { '2026-10-04T10': { Home: [10, 1] }, '2026-10-05T10': { Home: [5.25, 2] }, '2026-10-05T11': { Home: [1, 1] } } } };
  const hr = q.shape(body, {});
  eq(hr.stores?.BL1?.periods?.['10']?.Home, { net: 15.25, qty: 3 }, 'hour buckets sum the same hour across days');
  eq(Object.keys(hr.stores?.BL1?.periods || {}).sort(), ['10', '11'], 'one bucket per hour of day');
  const slot = q.shape(body, { hourBucket: 'slot' });
  eq(Object.keys(slot.stores?.BL1?.periods || {}).length, 3, 'slot keeps each day and hour apart');
}

// ── get_labor ──────────────────────────────────────────────────────────────
// The page's weeks, computed here independently: the plan week is the Saturday
// after this one; Budget vs Actual ends the Saturday before it.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const shift = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let sat = today; while (new Date(sat + 'T12:00:00Z').getUTCDay() !== 6) sat = shift(sat, 1);
const planWeek = shift(sat, 7), actTo = sat;
{
  await tool('get_labor', {});
  const q = lastQuery();
  eq([q.get('grain'), q.get('from'), q.get('to')], ['w', shift(actTo, -55), actTo], 'labor defaults to the page\'s weekly window');
  await tool('get_labor', { grain: 'd' });
  eq([lastQuery().get('from'), lastQuery().get('to')], [shift(actTo, -13), actTo], 'daily defaults to the page\'s two weeks');
  await tool('get_labor', { grain: 'm' });
  eq(lastQuery().get('from'), actTo.slice(0, 4) + '-01-01', 'monthly defaults from January 1');
  const l = await tool('get_labor', { grain: 'w', from: '2026-09-13', to: '2026-10-10', storeId: 'bl2' });
  const p = await page('?action=labor&grain=w&from=2026-09-13&to=2026-10-10&store=BL2');
  eq(l, p, 'labor is the page\'s answer, unchanged');
  eq(l.periods.length, 4, 'four weeks');
  ok((await tool('get_labor', { from: '2026-09-13' })).isError, 'from without to is refused');
}

// ── get_labor_plan ─────────────────────────────────────────────────────────
{
  await tool('get_labor_plan', {});
  eq(lastQuery().get('week'), planWeek, 'the plan defaults to the week the Labor page plans');
  const lp = await tool('get_labor_plan', { week: '2026-10-17', storeId: 'BL2' });
  const p = await page('?action=labor-plan&week=2026-10-17&store=BL2');
  eq(lp, p, 'the plan is the page\'s answer, unchanged');
  ok(lp.byStore?.BL2?.recommendedHours > 0, 'and it recommends hours for BL2');
  const n = upstream.length;
  ok((await tool('get_labor_plan', { week: '2026-10-16' })).isError, 'a week that is not a Saturday is refused');
  eq(upstream.length, n, 'before it reaches the worker');
}

// ── An answer too large for one tool result is refused with how to narrow it ─
{
  const big = { stores: Array.from({ length: 3000 }, (_, i) => ({ storeId: 'S' + i, name: 'x'.repeat(40) })) };
  const bigEnv = { ...env, API: { fetch: async () => new Response(JSON.stringify(big)) } };
  const r = await mcp.fetch(new Request('https://mcp.retjghub.com/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + MCP },
    body: JSON.stringify({ jsonrpc: '2.0', id: 999, method: 'tools/call', params: { name: 'get_yesterday_sales', arguments: {} } }),
  }), bigEnv, ctx);
  const res = (await r.json()).result;
  ok(res?.isError && /too large for one tool result/.test(res.content[0].text) && /storeId/.test(res.content[0].text),
    'an oversized answer is a tool error that says how to narrow it');
}

// ── Every upstream call was a keyed GET ────────────────────────────────────
ok(upstream.length >= 15 && upstream.every(u => u.method === 'GET' && u.key === UP), `all ${upstream.length} upstream calls were GETs with the reporting key`);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
