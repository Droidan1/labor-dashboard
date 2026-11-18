// The Retail Summary and Labor queries agents get (cli/reporting.mjs), driven
// end to end: the real MCP worker → service binding → the real main worker's
// read-through endpoints over the harness's sqlite D1 and KV.
//
// WHAT THIS PROTECTS. Each tool trims a large page payload to what an agent can
// read. A trim that drops a store, double-counts a day or re-buckets a week
// wrongly is a confident wrong answer, so the sums are checked against seeded
// figures and against the page endpoint's own answer, not against the trimming
// code. Defaults (the Labor weeks) are computed here independently of it.
import fs from 'node:fs';
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

// ── get_bin_split and get_live_item_sales (2026-11-17) ─────────────────────
// docs/plans/live-item-sales.md, Phase 3. The periods are Brian's (wtd = Sunday → Saturday;
// cycle = Friday → Wednesday, so a Thursday gets the cycle that just ended) and are written out
// here date by date, not derived. The shapes run on fixtures in the worker's answer shapes,
// through the exported QUERIES, checkArgs and runQuery the CLI and the MCP server use; then
// both tools once end to end, through the MCP worker and the real main worker.
const RQ = await import(pathToFileURL(path.join(repo, 'cli', 'reporting.mjs')).href);
const BIN = RQ.QUERIES.find(q => q.name === 'get_bin_split');
const LIVE = RQ.QUERIES.find(q => q.name === 'get_live_item_sales');
ok(BIN?.cli === 'bin-split' && LIVE?.cli === 'live-items', 'get_bin_split (bin-split) and get_live_item_sales (live-items) are in QUERIES');
// One call as the CLI and MCP make it: checkArgs, then runQuery against a fake API that
// records what was asked. → { sent, out } or { sent, error }; never throws, so a missing
// query fails its own assertions instead of ending the suite.
async function runFake(q, args, body) {
  const sent = [];
  try {
    if (!q) throw new Error('query not in QUERIES');
    RQ.checkArgs(q, args);
    return { sent, out: await RQ.runQuery(q, args, async (p) => { sent.push(p); return body; }) };
  } catch (error) { return { sent, error }; }
}
// The clock, fixed at an instant. Only the pure calls below run under it.
const RealDate = Date;
async function at(iso, fn) {
  const now = RealDate.parse(iso);
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } };
  try { return await fn(); } finally { globalThis.Date = RealDate; }
}
const noonET = (d) => d + 'T17:00:00Z';   // 12:00 EST / 13:00 EDT, inside that ET day either way
const sentRange = (r) => r.sent[0] && [r.sent[0].action, r.sent[0].from, r.sent[0].to];
const round = (n) => Math.round(n * 100) / 100;

// ── get_bin_split: the period each day of the week asks for ──
{
  // Fri 2026-11-13 → Sat 11-21: one Sunday-start week and the cycles either side of it.
  const WEEK = [
    // today,       weekday, wtd [from, to],              cycle [from, to]
    ['2026-11-13', 'Fri', ['2026-11-08', '2026-11-13'], ['2026-11-13', '2026-11-13']],
    ['2026-11-14', 'Sat', ['2026-11-08', '2026-11-14'], ['2026-11-13', '2026-11-14']],
    ['2026-11-15', 'Sun', ['2026-11-15', '2026-11-15'], ['2026-11-13', '2026-11-15']],
    ['2026-11-16', 'Mon', ['2026-11-15', '2026-11-16'], ['2026-11-13', '2026-11-16']],
    ['2026-11-17', 'Tue', ['2026-11-15', '2026-11-17'], ['2026-11-13', '2026-11-17']],
    ['2026-11-18', 'Wed', ['2026-11-15', '2026-11-18'], ['2026-11-13', '2026-11-18']],
    ['2026-11-19', 'Thu', ['2026-11-15', '2026-11-19'], ['2026-11-13', '2026-11-18']],
    ['2026-11-20', 'Fri', ['2026-11-15', '2026-11-20'], ['2026-11-20', '2026-11-20']],
    ['2026-11-21', 'Sat', ['2026-11-15', '2026-11-21'], ['2026-11-20', '2026-11-21']],
  ];
  const empty = { ok: true, rows: [], stores: [], freshness: {}, config: { source: 'default' } };
  for (const [day, dow, wtd, cycle] of WEEK) {
    await at(noonET(day), async () => {
      eq(sentRange(await runFake(BIN, {}, empty)), ['bin-split', day, day], `${dow} ${day}: no period is today`);
      eq(sentRange(await runFake(BIN, { period: 'today' }, empty)), ['bin-split', day, day], `${dow} ${day}: today`);
      eq(sentRange(await runFake(BIN, { period: 'wtd' }, empty)), ['bin-split', ...wtd], `${dow} ${day}: wtd = ${wtd.join('..')}`);
      eq(sentRange(await runFake(BIN, { period: 'cycle' }, empty)), ['bin-split', ...cycle], `${dow} ${day}: cycle = ${cycle.join('..')}`);
    });
  }
  // Across a month end, and mtd on the 1st and on the 17th.
  for (const [day, period, range] of [
    ['2026-10-31', 'wtd', ['2026-10-25', '2026-10-31']], ['2026-11-01', 'cycle', ['2026-10-30', '2026-11-01']],
    ['2026-12-03', 'cycle', ['2026-11-27', '2026-12-02']], ['2026-12-01', 'mtd', ['2026-12-01', '2026-12-01']],
    ['2026-11-17', 'mtd', ['2026-11-01', '2026-11-17']], ['2026-03-01', 'mtd', ['2026-03-01', '2026-03-01']],
  ]) {
    await at(noonET(day), async () => eq(sentRange(await runFake(BIN, { period }, empty)), ['bin-split', ...range], `${period} on ${day} = ${range.join('..')}`));
  }
  // Today is the Eastern day: 23:30 EST on Tue 11-17 is already the 18th in UTC.
  await at('2026-11-18T04:30:00Z', async () => {
    eq(sentRange(await runFake(BIN, { period: 'today' }, empty)), ['bin-split', '2026-11-17', '2026-11-17'], '23:30 EST is still today in Eastern time');
    eq(sentRange(await runFake(BIN, { period: 'cycle' }, empty)), ['bin-split', '2026-11-13', '2026-11-17'], 'and the cycle runs to it');
  });
  // custom, and what is refused before anything is sent.
  await at(noonET('2026-11-17'), async () => {
    const c = await runFake(BIN, { period: 'custom', from: '2026-10-17', to: '2026-11-16', storeId: 'bl14', groupBy: 'price' }, empty);
    eq(c.sent, [{ action: 'bin-split', from: '2026-10-17', to: '2026-11-16', store: 'BL14' }], 'custom sends from, to and the store, upper-cased');
    eq((await runFake(BIN, { period: 'custom', from: '2026-11-17', to: '2026-11-17' }, empty)).sent.length, 1, 'custom may end today');
    for (const [args, why] of [
      [{ period: 'custom', from: '2026-11-10' }, 'custom without to'],
      [{ period: 'custom' }, 'custom without from and to'],
      [{ from: '2026-11-10', to: '2026-11-12' }, 'from and to without period custom'],
      [{ period: 'wtd', to: '2026-11-12' }, 'to with period wtd'],
      [{ period: 'custom', from: '2026-11-12', to: '2026-11-10' }, 'to before from'],
      [{ period: 'custom', from: '2026-10-16', to: '2026-11-16' }, '32 days for every store'],
      [{ period: 'custom', from: '2026-08-16', to: '2026-11-16', storeId: 'BL1' }, '93 days for one store'],
      [{ period: 'custom', from: '2026-11-17', to: '2026-11-18' }, 'to after today'],
      [{ period: 'week' }, 'an unknown period'],
      [{ groupBy: 'category' }, 'an unknown groupBy'],
    ]) {
      const r = await runFake(BIN, args, empty);
      ok(r.error instanceof RQ.UsageError && r.sent.length === 0, `${why} is a usage error that sends nothing (${r.error?.message})`);
    }
    eq((await runFake(BIN, { period: 'custom', from: '2026-08-17', to: '2026-11-16', storeId: 'BL1' }, empty)).sent.length, 1, '92 days for one store is allowed');
  });
}

// ── get_bin_split: grouping, on a bin-split answer ──
// Built to the production back-check (2026-10-17 → 11-16, every store): regular 141,173 units
// / $396,660.65; Christmas 399 / $968.50 = bins 197 / $433.27 + XMAS buttons 202 / $535.23.
{
  const FROM = '2026-10-17', TO = '2026-11-16';
  const DAYS = [];
  for (let d = FROM; d <= TO; d = shift(d, 1)) DAYS.push(d);
  const row = (store, date, group, subgroup, tier, units, net, tickets) =>
    ({ store, date, source: date === TO ? 'live' : 'saved', group, subgroup, tier, units, net, items: 2, tickets });
  const ROWS = [
    row('BL1', '2026-11-15', 'regular', 'bins', '$12', 20000, 240000, 17000),
    row('BL2', '2026-11-15', 'regular', 'bins', '$0.50', 100000, 50000, 30000),
    row('BL2', '2026-11-16', 'regular', 'bins', '$6', 20000, 100000, 9000),
    row('BL14', '2026-11-16', 'regular', 'extras', 'no price', 1173, 6660.65, 900),
    row('BL14', '2026-11-16', 'christmas', 'bins', '$3', 100, 300, 80),
    row('BL4', '2026-11-15', 'christmas', 'bins', '$2', 97, 133.27, 70),
    row('BL14', '2026-11-16', 'christmas', 'xmas buttons', '$3', 150, 430, 120),
    row('BL1', '2026-11-10', 'christmas', 'xmas buttons', '$8', 2, 16, 2),
    row('BL1', '2026-11-10', 'christmas', 'xmas buttons', '$1', 50, 89.23, 40),
  ];
  const STORES6 = ['BL1', 'BL2', 'BL4', 'BL8', 'BL14', 'BL16'];
  const FRESH = {
    savedThrough: { BL1: '2026-11-16', BL2: '2026-11-16', BL4: '2026-11-15', BL8: null, BL14: '2026-11-15', BL16: null },
    liveAsOf: { BL14: '2026-11-17T01:00:00.000Z' }, liveDays: [{ store: 'BL14', date: TO }],
    missingDays: [{ store: 'BL2', date: '2026-11-01' }],
    incompleteDays: [{ store: 'BL4', date: TO, status: 'incomplete' }],
    beforeRecord: DAYS.map(date => ({ store: 'BL16', date })),
    closedStores: [{ store: 'BL8', closedFrom: '2026-07-25' }],
  };
  const ANSWER = { ok: true, from: FROM, to: TO, stores: STORES6, rows: ROWS, freshness: FRESH, config: { source: 'default', rules: { christmas: {} } } };
  const custom = { period: 'custom', from: FROM, to: TO };
  const get = (groupBy) => at(noonET('2026-11-17'), () => runFake(BIN, { ...custom, ...(groupBy && { groupBy }) }, ANSWER)).then(r => r.out || {});

  const s = await get();
  eq(s.groupBy, 'store', 'groupBy defaults to store');
  eq(s.period, { name: 'custom', from: FROM, to: TO }, 'the answer names its period and dates');
  eq(s.totals?.regular, { units: 141173, net: 396660.65, bins: { units: 140000, net: 390000 }, extras: { units: 1173, net: 6660.65 } },
    'regular: 141,173 units / $396,660.65, bins and extras apart');
  eq(s.totals?.christmas, { units: 399, net: 968.5, bins: { units: 197, net: 433.27 }, 'xmas buttons': { units: 202, net: 535.23 } },
    'christmas: 399 / $968.50 = bins 197 / $433.27 + XMAS buttons 202 / $535.23');
  eq(s.totals?.christmasSharePct, 0.24, "Christmas's share of bin net is 968.50 / 397,629.15 = 0.24%");
  ok(s.totals && !JSON.stringify(s).includes('tickets'), 'no ticket count appears anywhere, totalled or not');
  eq(s.complete, false, 'a missing, an incomplete and a before-record store-day make it incomplete');
  const st = Object.fromEntries((s.byStore || []).map(x => [x.store, x]));
  eq((s.byStore || []).map(x => [x.store, x.status]), [['BL1', 'ok'], ['BL2', 'partial'], ['BL4', 'partial'], ['BL8', 'closed'], ['BL14', 'ok'], ['BL16', 'no_data']],
    'one entry per store, in the answer\'s order, each with its status');
  eq(st.BL8, { store: 'BL8', status: 'closed', closedFrom: '2026-07-25' }, 'a closed store is closed, with no figures, not 0');
  ok(st.BL16 && !('regular' in st.BL16) && !('christmas' in st.BL16), 'a store with no day counted has no figures, not 0');
  eq(st.BL16?.notCounted?.length, DAYS.length, 'and lists every day it could not count');
  eq(st.BL16?.notCounted?.[0], { date: FROM, reason: 'before record' }, 'with the reason');
  eq(st.BL2?.notCounted, [{ date: '2026-11-01', reason: 'missing' }], 'a partial store lists the day it is missing');
  eq(st.BL4?.notCounted, [{ date: TO, reason: 'incomplete' }], 'and a live day that could not be read');
  eq(st.BL4?.christmas?.bins, { units: 97, net: 133.27 }, 'while its counted days still count');
  eq([st.BL1?.regular?.net, st.BL1?.christmas?.['xmas buttons']], [240000, { units: 52, net: 105.23 }], "BL1's own figures");
  eq(st.BL14?.christmasSharePct, round(730 / (730 + 6660.65) * 100), "each store's Christmas share is its own");
  ok(near(['BL1', 'BL2', 'BL4', 'BL14'].reduce((a, k) => a + (st[k]?.regular?.net || 0), 0), s.totals?.regular?.net), 'the stores add up to the total');
  eq(s.freshness, FRESH, 'freshness is passed through as the worker sent it');
  eq(s.config, { source: 'default' }, 'and config.source, without the rules');
  ok(s.byStore && s.byPrice === undefined && s.byDay === undefined, 'groupBy store has no price or day breakdown');

  const p = await get('price');
  eq((p.byPrice?.regular || []).map(t => t.tier), ['$12', '$6', '$0.50', 'no price'], 'regular tiers by price, highest first, no price last ($0.50 below $6, $12 above it)');
  eq((p.byPrice?.christmas || []).map(t => t.tier), ['$8', '$3', '$2', '$1'], 'christmas tiers by price');
  eq((p.byPrice?.christmas || []).find(t => t.tier === '$3'), { tier: '$3', units: 250, net: 730, bins: { units: 100, net: 300 }, 'xmas buttons': { units: 150, net: 430 } },
    'a tier adds every store and day, its subgroups apart ($3 Christmas bins and $3 XMAS buttons)');
  eq((p.byPrice?.regular || []).find(t => t.tier === 'no price'), { tier: 'no price', units: 1173, net: 6660.65, bins: { units: 0, net: 0 }, extras: { units: 1173, net: 6660.65 } }, 'the extras sit under no price');
  ok(p.totals && JSON.stringify(p.totals) === JSON.stringify(s.totals), 'the totals do not depend on groupBy');
  ok(p.byPrice && p.byStore === undefined && p.byDay === undefined, 'groupBy price has no store or day breakdown');
  ok(p.byPrice && !JSON.stringify(p).includes('tickets'), 'and no tickets');

  const d = await get('day');
  eq((d.byDay || []).map(x => x.date), DAYS, 'groupBy day lists every day from..to, oldest first');
  const dy = Object.fromEntries((d.byDay || []).map(x => [x.date, x]));
  eq(dy[TO]?.status, 'partial', 'a day with a store not counted is partial');
  eq(dy[TO]?.notCounted, [{ store: 'BL4', reason: 'incomplete' }, { store: 'BL16', reason: 'before record' }], 'and says which stores and why');
  eq(dy[TO]?.regular, { units: 21173, net: 106660.65, bins: { units: 20000, net: 100000 }, extras: { units: 1173, net: 6660.65 } }, "the day's regular figures");
  eq(dy['2026-11-10']?.christmas?.['xmas buttons'], { units: 52, net: 105.23 }, "and another day's XMAS buttons");
  eq(dy['2026-11-01']?.notCounted, [{ store: 'BL2', reason: 'missing' }, { store: 'BL16', reason: 'before record' }], 'a missing day is named on its date');
  eq(dy['2026-11-02']?.regular?.units, 0, 'a counted day with no bin sales is a real 0');
  ok(d.byDay && !JSON.stringify(d).includes('tickets'), 'and no tickets');

  // Nothing could be counted: today, BL1's live pull failed and BL8 is closed.
  const NONE = { ok: true, from: '2026-11-17', to: '2026-11-17', stores: ['BL1', 'BL8'], rows: [], config: { source: 'default' },
    freshness: { savedThrough: { BL1: null, BL8: null }, liveAsOf: {}, liveDays: [], missingDays: [],
      incompleteDays: [{ store: 'BL1', date: '2026-11-17', status: 'incomplete' }], beforeRecord: [], closedStores: [{ store: 'BL8', closedFrom: '2026-07-25' }] } };
  const n = await at(noonET('2026-11-17'), () => runFake(BIN, {}, NONE)).then(r => r.out || {});
  eq([n.totals, n.complete], [null, false], 'with no store-day counted, the totals are null, never 0');
  eq(n.byStore, [{ store: 'BL1', status: 'no_data', notCounted: [{ date: '2026-11-17', reason: 'incomplete' }] }, { store: 'BL8', status: 'closed', closedFrom: '2026-07-25' }],
    'an unread store is no_data and a closed one closed, neither with figures');
  const nd = await at(noonET('2026-11-17'), () => runFake(BIN, { groupBy: 'day' }, NONE)).then(r => r.out || {});
  eq(nd.byDay, [{ date: '2026-11-17', status: 'no_data', notCounted: [{ store: 'BL1', reason: 'incomplete' }] }], 'by day too');
  // A real zero: the live pull worked and nothing was sold yet.
  const ZERO = { ...NONE, stores: ['BL1'], freshness: { ...NONE.freshness, incompleteDays: [], closedStores: [], liveDays: [{ store: 'BL1', date: '2026-11-17' }] } };
  const z = await at(noonET('2026-11-17'), () => runFake(BIN, {}, ZERO)).then(r => r.out || {});
  eq([z.complete, z.totals?.regular?.net, z.totals?.christmasSharePct, z.byStore?.[0]?.status], [true, 0, null, 'ok'],
    'a store read with no sales yet is a real 0 (and no share of nothing)');
}

// ── get_live_item_sales, on a live-items answer ──
{
  const it = (name, code, cloverCategory, l2, qty, net, orders) => ({ itemId: 'I-' + name, name, code, cloverCategory, l2, l3: cloverCategory,
    source: 'clover-category', qty, gross: net, lineDiscounts: 0, orderDiscounts: 0, refunds: 0, net, cost: 0, costSource: 'none', orders });
  const ASOF = '2026-11-17T18:00:00.000Z';
  const LIVE_ANSWER = { ok: true, date: '2026-11-17', stores: [
    { store: 'BL1', status: 'ok', asOf: ASOF, cached: true, other: { nonItem: 0, rounding: 0 }, totals: { qty: 15, netSales: 135 },
      items: [it('$12 Bin', 'BL-BIN-12', 'Bin Products', 'Bin Products', 10, 120, 8), it('Gummies', null, 'FG BL CONSUMABLES - FOOD - CANDY', 'Consumable Food', 3, 9, 2),
        it('$3 XMAS', null, 'FG BL SEASONAL - CHRISTMAS - GM', 'Seasonal', 2, 6, 2)] },
    { store: 'BL2', status: 'ok', asOf: ASOF, cached: false, other: {}, totals: { qty: 5, netSales: 198 },
      items: [it('$12 Bin', 'BL-BIN-12', 'Bin Products', 'Bin Products', 4, 48, 4), it('Brass Lamp', 'BL-50038-1_5', 'FG BL HOME - LIGHTING', 'Home', 1, 150, 1)] },
    { store: 'BL4', status: 'incomplete', code: 'INCOMPLETE_FETCH', error: 'Clover did not return a complete order list' },
    { store: 'BL8', status: 'closed', closedFrom: '2026-07-25' },
    { store: 'BL14', status: 'no_credentials', error: 'No Clover credentials for this store' },
    { store: 'BL16', status: 'ok', asOf: ASOF, cached: false, other: {}, totals: { qty: 0, netSales: 0 }, items: [] },
  ] };
  const live = (args) => runFake(LIVE, args, LIVE_ANSWER);
  const all = await live({});
  eq(all.sent, [{ action: 'live-items', store: undefined }], 'live-items with no store asks for every store');
  eq((await live({ storeId: 'bl2' })).sent, [{ action: 'live-items', store: 'BL2' }], 'storeId is passed upper-cased');
  const o = all.out || {};
  eq(o.date, '2026-11-17', 'the answer says which day');
  eq((o.stores || []).map(x => x.store + ':' + x.status), ['BL1:ok', 'BL2:ok', 'BL4:incomplete', 'BL8:closed', 'BL14:no_credentials', 'BL16:ok'], 'every store keeps its status');
  const ls = Object.fromEntries((o.stores || []).map(x => [x.store, x]));
  eq(ls.BL1, { store: 'BL1', status: 'ok', asOf: ASOF, cached: true, other: { nonItem: 0, rounding: 0 }, totals: { qty: 15, netSales: 135 } }, 'an ok store has asOf, cached and its totals, without its item list');
  eq([ls.BL4, ls.BL8, ls.BL14], [LIVE_ANSWER.stores[2], LIVE_ANSWER.stores[3], LIVE_ANSWER.stores[4]], 'incomplete, closed and credential-less stores come through as they were sent');
  ok(['BL4', 'BL8', 'BL14'].every(k => ls[k] && !('totals' in ls[k])), 'none of them has totals, so none reads as 0');
  eq(ls.BL16?.totals?.netSales, 0, 'an open store read with no sales yet keeps its real 0');
  eq(o.complete, false, 'complete is false while an open store could not be read');
  eq([o.matched, o.listed], [5, 5], 'matched and listed count items across stores');
  eq((o.items || []).map(i => [i.store, i.name, i.net]), [['BL2', 'Brass Lamp', 150], ['BL1', '$12 Bin', 120], ['BL2', '$12 Bin', 48], ['BL1', 'Gummies', 9], ['BL1', '$3 XMAS', 6]],
    'items from every store, each with its store, highest net first');
  eq(o.items?.[1], { store: 'BL1', ...LIVE_ANSWER.stores[0].items[0] }, 'an item keeps every field the worker sent');
  eq(o.matchedTotals, { qty: 20, net: 333 }, 'matchedTotals add every matched item');
  const lim = (await live({ limit: 2 })).out || {};
  eq([lim.matched, lim.listed, (lim.items || []).map(i => i.name)], [5, 2, ['Brass Lamp', '$12 Bin']], 'limit lists the top items; matched still counts them all');
  eq(lim.matchedTotals, { qty: 20, net: 333 }, 'and the totals still cover every matched item');
  const bin = (await live({ search: ' BIN ' })).out || {};
  eq([bin.matched, (bin.items || []).map(i => i.store)], [2, ['BL1', 'BL2']], 'search matches the name, trimmed, any case');
  eq(bin.matchedTotals, { qty: 14, net: 168 }, 'and the totals are the matched items\'');
  eq(((await live({ search: 'christmas' })).out?.items || []).map(i => i.name), ['$3 XMAS'], 'search matches the Clover category');
  eq(((await live({ search: 'bl-50038' })).out?.items || []).map(i => i.name), ['Brass Lamp'], 'and the code');
  eq(((await live({ search: 'consumable' })).out?.items || []).map(i => i.name), ['Gummies'], 'and the L2');
  eq((await live({ search: 'nothing like it' })).out?.matched, 0, 'no match is 0 matched');
  for (const [args, why] of [[{ limit: 201 }, 'limit 201'], [{ limit: 0 }, 'limit 0'], [{ from: '2026-11-17' }, 'a date (today only)']]) {
    const r = await live(args);
    ok(r.error instanceof RQ.UsageError && r.sent.length === 0, `${why} is a usage error that sends nothing`);
  }
}

// ── Both tools end to end: MCP worker → the real main worker ──
// The harness has no Clover credentials, so every open store's live pull is refused before
// Clover is asked: today must come back unread, never as a zero day.
{
  db.exec(fs.readFileSync(path.join(repo, 'migration-078.sql'), 'utf8'));   // item_day_lines
  await tool('get_live_item_sales', {});
  const q = lastQuery();
  eq([q.get('action'), q.get('store')], ['live-items', null], 'get_live_item_sales calls live-items');
  const lv = await tool('get_live_item_sales', { storeId: 'bl2' });
  eq([lastQuery().get('action'), lastQuery().get('store')], ['live-items', 'BL2'], 'and passes the store');
  eq((lv.stores || []).map(s => [s.store, s.status]), [['BL2', 'no_credentials']], 'a store that cannot be read is listed as such');
  const lvAll = await tool('get_live_item_sales', {});
  eq((lvAll.stores || []).find(s => s.store === 'BL8')?.status, 'closed', 'BL8 is closed');
  ok((lvAll.stores || []).every(s => !('totals' in s)) && lvAll.matched === 0 && lvAll.complete === false, 'and no store reads as a 0');

  const td = await tool('get_bin_split', { period: 'today' });
  eq([lastQuery().get('action'), lastQuery().get('from'), lastQuery().get('to')], ['bin-split', today, today], "period today asks bin-split for today's date, Eastern");
  eq([td.totals, td.complete], [null, false], 'with no store read, no totals');
  eq((td.byStore || []).map(s => [s.store, s.status, s.notCounted?.[0]?.reason ?? null]),
    [['BL1', 'no_data', 'no_credentials'], ['BL2', 'no_data', 'no_credentials'], ['BL4', 'no_data', 'no_credentials'], ['BL8', 'closed', null],
      ['BL14', 'no_data', 'no_credentials'], ['BL16', 'no_data', 'no_credentials']], 'every open store is no_data, saying why, and BL8 closed');

  // Saved, final days: BL2 on 10-20 and 10-21 (stamped after each night's 03:55 UTC run).
  const line = (name, l2, qty, net, orders) => ({ itemId: 'I-' + name, name, code: null, cloverCategory: l2, l2, l3: l2, source: 'clover-category',
    qty, gross: net, lineDiscounts: 0, orderDiscounts: 0, refunds: 0, net, cost: 0, costSource: 'none', orders });
  const put = db.prepare('INSERT INTO item_day_lines (store, date, snapshot_time, item_count, net, items_json, other_json) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const [date, items] of [
    ['2026-10-20', [line('$12 Bin', 'Bin Products', 3, 36, 3), line('$3 XMAS', 'Seasonal', 2, 6, 2), line('Gummies', 'Consumable Food', 1, 3, 1)]],
    ['2026-10-21', [line('$6 Bin', 'Bin Products', 5, 30, 4), line('$2 Christmas Bin', 'Bin Products', 4, 8, 3), line('Fill A Bag', 'Bin Products', 1, 10, 1)]],
  ]) put.run('BL2', date, shift(date, 1) + 'T04:00:00.000Z', items.length, items.reduce((a, i) => a + i.net, 0), JSON.stringify(items), '{}');
  const sv = await tool('get_bin_split', { period: 'custom', from: '2026-10-20', to: '2026-10-21', storeId: 'BL2', groupBy: 'price' });
  eq([lastQuery().get('action'), lastQuery().get('from'), lastQuery().get('to'), lastQuery().get('store')], ['bin-split', '2026-10-20', '2026-10-21', 'BL2'], 'custom passes from, to and the store');
  eq(sv.totals, { regular: { units: 9, net: 76, bins: { units: 8, net: 66 }, extras: { units: 1, net: 10 } },
    christmas: { units: 6, net: 14, bins: { units: 4, net: 8 }, 'xmas buttons': { units: 2, net: 6 } }, christmasSharePct: round(14 / 90 * 100) },
  "the saved days' bins, extras, Christmas bins and XMAS buttons, Gummies left out");
  eq((sv.byPrice?.regular || []).map(t => [t.tier, t.net]), [['$12', 36], ['$6', 30], ['no price', 10]], 'by price, through the real worker');
  eq([sv.complete, sv.freshness?.savedThrough?.BL2, sv.config?.source], [true, '2026-10-21', 'default'], 'both days saved and counted');
  ok(sv.totals && !JSON.stringify(sv).includes('tickets'), 'no tickets');
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
