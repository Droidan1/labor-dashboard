// ?action=live-items: today's per-item sales, pulled live from Clover with the nightly
// run's own inputs (docs/plans/live-item-sales.md, Phase 1).
//
// WHAT THIS PROTECTS. This repo has lost saved history three times to re-pulled Clover data
// written over it, so the first property carries the most weight:
//   1. A live pull writes NOTHING but its own live-items: cache key: no items:, item-hours:,
//      item_day_lines, discount record, daily_sales or payment archive (every KV and R2 put
//      and delete, every D1 statement and every outbound method is recorded).
//   2. A failed Clover fetch is an incomplete store, never an empty day, and is never cached.
//   3. Items are filed exactly as the nightly run files them. Golden: the REAL 03:55 cron
//      (worker.scheduled) over the same Clover fixture: its own aggregateItemSales totals,
//      and the item rows its sweep saves to item_day_lines.
//   4. The cache: a hit makes no Clover call; fresh=1 re-pulls only a copy over 60 s old.
//   5. A closed store makes no Clover call; the stores are the caller's; the agent door.
// Everything drives worker.fetch / worker.scheduled, never a function cut out of the source.
import fs from 'node:fs';
import path from 'node:path';
import { loadWorker, makeEnv, ctx, req, kvNamespace } from './lib/worker-harness.mjs';

const repo = process.argv[2] || '.';
const say = console.log.bind(console);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; say('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const worker = await loadWorker(repo);

// ── The clock: Tue 2026-11-17, 12:00 EST ───────────────────────────────────
const RealDate = Date;
let NOW = RealDate.parse('2026-11-17T17:00:00Z');
class FixedDate extends RealDate { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } }
globalThis.Date = FixedDate;
const D = '2026-11-17';
const DAY0 = RealDate.parse('2026-11-17T05:00:00Z');   // midnight EST
const T = RealDate.parse('2026-11-17T15:00:00Z');      // 10:00 EST

// ── Clover, per merchant ───────────────────────────────────────────────────
const MERCHANT = { BL1: 'M1', BL2: 'M2', BL4: 'M4', BL8: 'M8', BL14: 'M14', BL16: 'M16' };
const li = (id, name, price, item, extra = {}) => ({ id, name, price, ...(item && { item }), ...extra });
const order = (id, lines, payment, t = T, extra = {}) => ({
  id, state: 'locked', total: payment, createdTime: t, clientCreatedTime: t,
  payments: { elements: [{ id: 'p-' + id, amount: payment, taxAmount: 0 }] },
  lineItems: { elements: lines }, ...extra,
});
// BL1: every way an item gets filed (as test-item-lines.mjs), plus yesterday's order, which
// the window must leave out.
const BL1 = {
  orders: [
    order('O1', [
      li('l1', 'FG BL CONSUMABLES - FOOD - CANDY', 1000, { id: 'I-CAT', code: 'BL-50020-10' }),
      li('l2', '$10 Boots', 200, { id: 'I-SKU', code: 'SB-1' }),
      li('l3', 'FG BL CONSUMABLES - FOOD - SNACKS', 150, { id: 'I-NAME', code: 'BL-50038-1_5' }),
    ], 1215, T, { discounts: { elements: [{ percentage: '10' }] } }),
    order('O2', [
      li('l4', '$3 Bin', 300, { id: 'I-BIN' }, { discounts: { elements: [{ amount: -100 }] } }),
      li('l5', 'Big table', 250, { id: 'I-OVR' }),
      li('l6', 'Mystery thing', 400, null),
      li('l10', 'Big table', 250, { id: 'I-OVR' }),
    ], 1175),
    order('O3', [
      li('l7', 'CANDY BL-50020', 2000, { id: 'I-CAT', code: 'BL-50020-10' }),
      li('l8', 'Refund', -500, null),
      li('l9', 'Thing', 300, { id: 'I-UNM' }),
      li('l13', 'Thing', 0, { id: 'I-UNM', code: 'BL-77777-0' }),
      li('l11', 'Not on the page', 100, { id: 'I-SKU2' }),
      li('l12', 'Loose candy', 999, { id: 'I-WGT' }, { unitQty: 333 }),
    ], 2233),
    order('O-Y', [li('ly', 'Yesterday thing', 700, { id: 'I-Y' })], 700, DAY0 - 3600e3),
  ],
  // $3.30 back on O1, $2 on another day's order (fetched to attribute it), 50¢ on an order
  // Clover no longer has, and $1 manual (a credit).
  refunds: [
    { id: 'R1', amount: 330, taxAmount: 0, createdTime: T + 3600e3, orderRef: { id: 'O1' } },
    { id: 'R2', amount: 200, taxAmount: 0, createdTime: T + 3600e3, orderRef: { id: 'O-OLD' } },
    { id: 'R3', amount: 50, taxAmount: 0, createdTime: T + 3600e3, orderRef: { id: 'O-GONE' } },
  ],
  credits: [{ id: 'C1', amount: 100, taxAmount: 0, result: 'SUCCESS', createdTime: T + 5400e3 }],
  byId: { 'O-OLD': order('O-OLD', [li('lo', 'FG BL CONSUMABLES - FOOD - CANDY', 1000, { id: 'I-CAT' })], 1000, T - 3 * 864e5) },
};
const simple = (s) => ({ orders: [order(`${s}-1`, [li(`${s}a`, '$6 Bin', 600, { id: `I-B-${s}` }), li(`${s}b`, 'Gummies', 350, { id: 'I-C' })], 950)] });
const DATA = { M1: BL1, M2: simple('M2'), M4: simple('M4'), M8: simple('M8'), M14: simple('M14'), M16: simple('M16') };
const CATALOG = [{ id: 'I-C', name: 'Gummies', categories: { elements: [{ id: 'K1', name: 'FG BL CONSUMABLES - FOOD - CANDY' }] } }];

let calls = [];                  // every outbound request: { url, method, merchant }
const broken = {};               // merchant -> 'page2' (1000 orders, then a 500) | 'throw'
const inflight = new Map();
let maxMerchants = 0;            // most merchants with a request open at one moment
globalThis.fetch = async (u, init) => {
  const s = String(u?.url || u);
  const method = init?.method || (u instanceof Request ? u.method : 'GET');
  const m = s.match(/^https:\/\/api\.clover\.com\/v3\/merchants\/([^/]+)\//);
  calls.push({ url: s, method, merchant: m?.[1] || null });
  const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  if (!m) return J({ elements: [] });   // anything else the cron reaches (the sheet import, …)
  const merchant = m[1];
  inflight.set(merchant, (inflight.get(merchant) || 0) + 1);
  maxMerchants = Math.max(maxMerchants, [...inflight.values()].filter(n => n > 0).length);
  try {
    await new Promise(r => setTimeout(r, 3));
    const url = new URL(s), data = DATA[merchant] || {};
    const offset = Number(url.searchParams.get('offset') || 0);
    const filters = url.searchParams.getAll('filter');
    const since = Number((filters.find(f => f.startsWith('createdTime>=')) || '').split('>=')[1] || 0);
    const until = Number((filters.find(f => f.startsWith('createdTime<')) || '').split('<')[1] || Infinity);
    const inWindow = (x) => x.createdTime >= since && x.createdTime < until;
    if (url.pathname.endsWith('/orders')) {
      if (broken[merchant] === 'throw') throw new TypeError('fetch failed');
      if (broken[merchant] === 'page2') {
        if (offset > 0) return J({ message: 'Internal Server Error' }, 500);
        return J({ elements: Array.from({ length: 1000 }, (_, i) => order(`${merchant}-${i}`, [li(`x${i}`, 'Gummies', 100, { id: 'I-C' })], 100)) });
      }
      return J({ elements: offset ? [] : (data.orders || []).filter(inWindow) });
    }
    const one = url.pathname.match(/\/orders\/([^/]+)$/);
    if (one) return data.byId?.[one[1]] ? J(data.byId[one[1]]) : J({ message: 'not found' }, 404);
    if (url.pathname.endsWith('/refunds')) return J({ elements: offset ? [] : (data.refunds || []).filter(inWindow) });
    if (url.pathname.endsWith('/credits')) return J({ elements: offset ? [] : (data.credits || []).filter(inWindow) });
    if (url.pathname.endsWith('/items')) return J({ elements: offset ? [] : CATALOG });
    return J({ elements: [] });
  } finally { inflight.set(merchant, inflight.get(merchant) - 1); }
};
const cloverCalls = (merchant) => calls.filter(c => c.merchant === merchant).length;
const anyClover = () => calls.filter(c => c.merchant).length;

// ── An environment: the harness's, with Clover keys, a TTL-honouring KV, and a recorder ─
const KEY = 'test-briefing-key';
async function setup({ catalogCached = true } = {}) {
  const { db, env } = makeEnv(repo);
  env.SALES_SNAPSHOTS = kvNamespace();
  env.MORNING_BRIEFING_KEY = KEY;
  for (const [s, m] of Object.entries(MERCHANT)) { env[`${s}_MERCHANT_ID`] = m; env[`${s}_API_TOKEN`] = `token-${s}`; }
  // The catalogue, overrides and costs, as production keeps them in KV.
  await env.SALES_SNAPSHOTS.put('item-cats:bl1', JSON.stringify({
    'I-CAT': 'FG BL CONSUMABLES - FOOD - CANDY', 'I-SKU': 'Sku Book Items', 'I-UNM': 'SOME NEW CLOVER CATEGORY',
    'I-SKU2': 'Sku Book Items', 'I-WGT': 'FG BL CONSUMABLES - FOOD - CANDY',
  }));
  if (catalogCached) for (const s of ['bl2', 'bl4', 'bl8', 'bl14', 'bl16']) await env.SALES_SNAPSHOTS.put(`item-cats:${s}`, JSON.stringify({ 'I-C': 'FG BL CONSUMABLES - FOOD - CANDY' }));
  await env.SALES_SNAPSHOTS.put('item-costs:global', JSON.stringify({ items: { '50020': { cost: 0.5 } } }));
  await env.SALES_SNAPSHOTS.put('item-overrides:global', JSON.stringify({ items: { 'id:I-OVR': { l2: 'Furniture' } },
    l3Rules: [{ type: 'id', value: 'I-OVR', l3: 'FG BL FURNITURE - RTA - TABLES/STANDS' }] }));
  await env.SALES_SNAPSHOTS.put('category-costs:global', JSON.stringify({ costs: { 'FG BL CONSUMABLES - FOOD - CANDY': 0.4 } }));
  // Sessions a week out, so getAuthUser's once-a-day expiry roll (a D1 UPDATE) stays quiet
  // and any write the recorder sees is the request's own.
  db.prepare('UPDATE sessions SET expires_at = ?').run(new RealDate(NOW + 7 * 864e5 - 3600e3).toISOString());
  const log = { kv: [], d1: [] };
  for (const name of ['SALES_SNAPSHOTS', 'MEDIA']) for (const m of ['put', 'delete']) {
    const real = env[name][m].bind(env[name]);
    env[name][m] = (k, v, o) => { log.kv.push({ op: `${name}.${m}`, key: String(k), opts: o }); return real(k, v, o); };
  }
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => { log.d1.push(sql); return prepare(sql); };
  const reset = () => { log.kv.length = 0; log.d1.length = 0; calls = []; maxMerchants = 0; };
  return { db, env, log, reset };
}
const parse = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const call = async (env, q, user = 'u-su') => { const r = await worker.fetch(req('/' + q, { user }), env, ctx); return { status: r.status, body: await parse(r) }; };
const keyed = async (env, q, { key = KEY, method = 'GET', where = 'header' } = {}) => {
  const r = await worker.fetch(new Request('https://api.retjghub.com/' + q + (where === 'query' ? `&key=${encodeURIComponent(key)}` : ''),
    { method, headers: where === 'header' ? { 'X-API-Key': key } : {} }), env, ctx);
  return { status: r.status, body: await parse(r) };
};
const entry = (res, store) => (Array.isArray(res?.body?.stores) ? res.body.stores.find(x => x.store === store) : undefined);
const nonSelect = (log) => log.d1.filter(sql => !/^\s*(SELECT|WITH)\b/i.test(sql));
const OPEN = ['BL1', 'BL2', 'BL4', 'BL14', 'BL16'];
const liveKey = (s) => `live-items:${s.toLowerCase()}:${D}`;

// ── 1. A chain-wide pull writes nothing but its own cache ──────────────────
{
  const { env, log, reset } = await setup();
  reset();
  const r = await call(env, '?action=live-items');
  eq([r.status, r.body?.ok, r.body?.date, (r.body?.stores || []).map(x => `${x.store}:${x.status}`)],
    [200, true, D, ['BL1:ok', 'BL2:ok', 'BL4:ok', 'BL8:closed', 'BL14:ok', 'BL16:ok']],
    'a superuser gets every store, in ALL_STORES order, for today (ET); BL8 closed');
  eq([r.status, log.kv.map(w => `${w.op} ${w.key} ttl=${w.opts?.expirationTtl}`).sort()],
    [200, OPEN.map(s => `SALES_SNAPSHOTS.put ${liveKey(s)} ttl=300`).sort()],
    'the ONLY storage writes are a put of each open store\'s live-items: key, kept 300 s (no items:, item-hours:, discount or R2 write)');
  ok(r.status === 200 && log.d1.length > 0 && nonSelect(log).length === 0,
    `and every D1 statement is a SELECT (no item_day_lines, discount_lines, daily_sales or payment archive write): ${JSON.stringify(nonSelect(log).map(q => q.trim().slice(0, 60)))}`);
  ok(r.status === 200 && calls.length > 0 && calls.every(c => c.method === 'GET'), 'and every outbound call is a GET (nothing written to Clover)');
  ok(r.status === 200 && cloverCalls('M8') === 0 && entry(r, 'BL8')?.closedFrom === '2026-07-25',
    'BL8 (closed 2026-07-25, keys still present) is answered closed with NO Clover call');
  eq(entry(r, 'BL8'), { store: 'BL8', status: 'closed', closedFrom: '2026-07-25' }, 'a closed store carries no items, so it never reads as an empty day');
  ok(r.status === 200 && maxMerchants >= 2 && maxMerchants <= 3, `stores are pulled in parallel, at most three at a time (most at once: ${maxMerchants})`);
  ok(OPEN.every(s => entry(r, s)?.cached === false && entry(r, s)?.asOf === new RealDate(NOW).toISOString() && entry(r, s)?.items?.length > 0),
    'each open store: pulled now (cached false, asOf = now), with items');
  ok(entry(r, 'BL1')?.items?.length > 0 && !entry(r, 'BL1').items.some(i => i.itemId === 'I-Y'), 'yesterday\'s order is outside the window (midnight ET →)');
  const bl1Orders = calls.filter(c => c.merchant === 'M1' && /\/orders\?/.test(c.url)).map(c => new URL(c.url).searchParams.getAll('filter'));
  eq(bl1Orders, [[`createdTime>=${DAY0}`, 'state=locked']], 'orders from midnight ET, open-ended for today, as the cron asks');
}

// ── 1b. With no catalogue cached, the one other write is fetchItemCategoryMap's own ─
{
  const { env, log, reset } = await setup({ catalogCached: false });
  reset();
  const r = await call(env, '?action=live-items&store=BL2');
  eq([r.status, entry(r, 'BL2')?.status, log.kv.map(w => `${w.op} ${w.key}`).sort()],
    [200, 'ok', ['SALES_SNAPSHOTS.put item-cats:bl2', `SALES_SNAPSHOTS.put ${liveKey('BL2')}`]],
    'no cached catalogue: the only other write is the 24 h item-cats: copy every caller of fetchItemCategoryMap keeps');
  eq(entry(r, 'BL2')?.items?.find(i => i.itemId === 'I-C')?.cloverCategory, 'FG BL CONSUMABLES - FOOD - CANDY', 'control: the item was filed from Clover\'s catalogue');
}

// ── 2. A failed Clover fetch is an incomplete store, never an empty day ────
{
  const { env, log, reset } = await setup();
  broken.M2 = 'page2'; broken.M4 = 'throw';
  reset();
  const warn = console.warn; console.warn = () => {};
  let r;
  try { r = await call(env, '?action=live-items'); } finally { console.warn = warn; delete broken.M2; delete broken.M4; }
  const page2 = calls.some(c => c.merchant === 'M2' && /\/orders\?/.test(c.url) && new URL(c.url).searchParams.get('offset') === '1000');
  ok(page2, 'control: BL2\'s first page came back full (1000 orders) and the second page was asked for, and failed');
  eq(entry(r, 'BL2') && [entry(r, 'BL2').status, entry(r, 'BL2').code, 'items' in entry(r, 'BL2'), 'totals' in entry(r, 'BL2')],
    ['incomplete', 'INCOMPLETE_FETCH', false, false], 'a failed second page: BL2 is INCOMPLETE_FETCH and carries NO items (not 1000 orders, not [])');
  eq(entry(r, 'BL4') && [entry(r, 'BL4').status, entry(r, 'BL4').code, 'items' in entry(r, 'BL4')],
    ['incomplete', 'INCOMPLETE_FETCH', false], 'a fetch that throws: BL4 is INCOMPLETE_FETCH too');
  eq([r?.status, log.kv.map(w => w.key).sort()], [200, [liveKey('BL1'), liveKey('BL14'), liveKey('BL16')].sort()],
    'neither incomplete store is cached; the stores that answered still are');
  ok(entry(r, 'BL1')?.status === 'ok' && !(await env.SALES_SNAPSHOTS.get(liveKey('BL2'))) && !(await env.SALES_SNAPSHOTS.get(liveKey('BL4'))),
    'one store failing costs only that store; nothing is in KV for BL2 or BL4');
  reset();
  const again = await call(env, '?action=live-items&store=BL2');
  ok(entry(again, 'BL2')?.status === 'ok' && entry(again, 'BL2')?.cached === false && cloverCalls('M2') > 0,
    'once Clover answers, the next call pulls BL2 afresh (no incomplete copy was kept)');
  // A store with no Clover keys is said so, not served as an empty day, and not cached.
  delete env.BL14_MERCHANT_ID; delete env.BL14_API_TOKEN;
  await env.SALES_SNAPSHOTS._map.delete(liveKey('BL14'));
  reset();
  const nokeys = await call(env, '?action=live-items&store=BL14');
  eq([nokeys.status, entry(nokeys, 'BL14')?.status, 'items' in (entry(nokeys, 'BL14') || { items: 1 }), log.kv.length, cloverCalls('M14')],
    [200, 'no_credentials', false, 0, 0], 'a store with no Clover keys: no_credentials, no items, nothing cached, no call');
}

// ── 3. Golden: filed exactly as the nightly run files it ───────────────────
// The real cron ("55 3 * * *", 22:55 EST on the 17th) over the same Clover fixture, in its own
// environment. Its first pass is the nightly aggregateItemSales call with the cron's inputs
// (its items: put carries that call's totals); its clientCreatedTime sweep then saves the
// day's item rows to item_day_lines. The live answer must equal both.
let golden = null;
{
  const { db, env } = await setup();
  for (const s of ['BL2', 'BL4', 'BL8', 'BL14', 'BL16']) { delete env[`${s}_MERCHANT_ID`]; delete env[`${s}_API_TOKEN`]; }
  db.exec(fs.readFileSync(path.join(repo, 'migration-078.sql'), 'utf8'));
  const itemPuts = [];
  const put = env.SALES_SNAPSHOTS.put;
  env.SALES_SNAPSHOTS.put = (k, v, o) => { if (k === `items:bl1:${D}`) itemPuts.push(JSON.parse(v)); return put(k, v, o); };
  const saved = NOW;
  NOW = RealDate.parse('2026-11-18T03:55:30Z');
  const quiet = ['log', 'warn', 'error'].map(k => [k, console[k]]);
  for (const [k] of quiet) console[k] = () => {};
  try {
    const pending = [];
    await worker.scheduled({ cron: '55 3 * * *', scheduledTime: NOW }, env, { waitUntil: (p) => pending.push(p), passThroughOnException() {} });
    await Promise.allSettled(pending);
  } finally { for (const [k, f] of quiet) console[k] = f; NOW = saved; }
  const row = db.prepare('SELECT items_json, other_json FROM item_day_lines WHERE store = ? AND date = ?').get('BL1', D);
  golden = { first: itemPuts[0] || null, items: row ? JSON.parse(row.items_json) : null, other: row ? JSON.parse(row.other_json) : null };
  ok(itemPuts.length >= 2, `control: the cron's first pass and its sweep both snapshotted BL1 for ${D} (${itemPuts.length} items: puts)`);
  eq([golden.first?.totals?.netSales, golden.items?.length], [39.43, 10], 'control: the nightly day is $39.43 over ten items (yesterday\'s order left out)');
  eq([golden.other?.manualRefunds, golden.other?.crossDayRefunds], [-1, -2], 'control: the nightly run used the manual refund and the cross-day order');
}
{
  const { env } = await setup();
  const r = await call(env, '?action=live-items&store=BL1');
  const bl1 = entry(r, 'BL1');
  eq(bl1?.totals, golden.first?.totals, 'live totals == the cron\'s own aggregateItemSales totals, field for field');
  eq(bl1?.items, golden.items, 'live item rows == the rows the nightly run saves to item_day_lines, row for row');
  eq(bl1?.other, golden.other, 'and what reached no item == the nightly record\'s');
  eq([bl1?.other?.manualRefunds, bl1?.other?.crossDayRefunds], [-1, -2],
    'the two inputs ?action=items skips are here: the manual refund (credits) and the cross-day order its refund points at');
  const r2 = (n) => Math.round(n * 100) / 100;
  ok(bl1 && r2(bl1.items.reduce((s, i) => s + i.net, 0) + Object.values(bl1.other).reduce((s, v) => s + v, 0)) === bl1.totals.netSales,
    'Σ items + what reached no item == netSales');
}

// ── 4. The cache ───────────────────────────────────────────────────────────
{
  const { env, log, reset } = await setup();
  const t0 = NOW;
  const at = (ms) => { NOW = t0 + ms; };
  try {
    reset();
    const first = await call(env, '?action=live-items&store=BL1');
    ok(entry(first, 'BL1')?.cached === false && cloverCalls('M1') > 0, 'first call: pulled from Clover');
    reset();
    const hit = await call(env, '?action=live-items&store=BL1');
    eq([entry(hit, 'BL1')?.cached, anyClover(), log.kv.length], [true, 0, 0], 'second call: a cache hit, NO Clover call, nothing written');
    ok(entry(hit, 'BL1')?.items?.length > 0 && JSON.stringify([entry(hit, 'BL1').asOf, entry(hit, 'BL1').items]) === JSON.stringify([entry(first, 'BL1')?.asOf, entry(first, 'BL1')?.items]),
      'and it is the first pull, asOf and all');
    at(30e3); reset();
    const fresh30 = await call(env, '?action=live-items&store=BL1&fresh=1');
    eq([entry(fresh30, 'BL1')?.cached, anyClover()], [true, 0], 'fresh=1 within 60 s of the cached asOf: still the cache, NO Clover call');
    at(60e3); reset();
    const fresh60 = await call(env, '?action=live-items&store=BL1&fresh=1');
    eq([entry(fresh60, 'BL1')?.cached, anyClover()], [true, 0], 'fresh=1 at exactly 60 s: still the cache');
    at(61e3); reset();
    const stale = await call(env, '?action=live-items&store=BL1');
    eq([entry(stale, 'BL1')?.cached, anyClover()], [true, 0], 'without fresh, a 61 s old copy is still served (kept 5 minutes)');
    reset();
    const fresh61 = await call(env, '?action=live-items&store=BL1&fresh=1');
    eq([entry(fresh61, 'BL1')?.cached, cloverCalls('M1') > 0, entry(fresh61, 'BL1')?.asOf, log.kv.map(w => w.key)],
      [false, true, new RealDate(t0 + 61e3).toISOString(), [liveKey('BL1')]], 'fresh=1 over 60 s: re-pulled, re-cached, with the new asOf');
    at(61e3 + 301e3); reset();
    const expired = await call(env, '?action=live-items&store=BL1');
    eq([entry(expired, 'BL1')?.cached, cloverCalls('M1') > 0], [false, true], 'after 5 minutes the copy has expired: pulled again');
  } finally { NOW = t0; }
}

// ── 4b. KV failing costs the cache, never the answer ──────────────────────
{
  const { env, reset } = await setup();
  const get = env.SALES_SNAPSHOTS.get, put = env.SALES_SNAPSHOTS.put;
  env.SALES_SNAPSHOTS.get = (k, o) => (String(k).startsWith('live-items:') ? Promise.reject(new Error('KV GET failed: 500')) : get(k, o));
  env.SALES_SNAPSHOTS.put = (k, v, o) => (String(k).startsWith('live-items:') ? Promise.reject(new Error('KV PUT failed: 429')) : put(k, v, o));
  const warn = console.warn, logs = [];
  console.warn = (...a) => logs.push(a.join(' '));
  reset();
  let r;
  try { r = await call(env, '?action=live-items&store=BL1'); } catch (e) { r = { status: `threw: ${e.message}` }; } finally { console.warn = warn; }
  eq([r.status, entry(r, 'BL1')?.status, entry(r, 'BL1')?.cached, entry(r, 'BL1')?.items?.length], [200, 'ok', false, 10],
    'the cache read and write both failing: still 200, the live pull served');
  ok(logs.some(l => l.includes('[live-items] cache read failed')) && logs.some(l => l.includes('[live-items] cache write failed')), 'and both failures are logged');
}

// ── 5. Whose stores ────────────────────────────────────────────────────────
{
  const { env } = await setup();
  const storesOf = (r) => (r.body?.stores || []).map(x => x.store);
  const mgr = await call(env, '?action=live-items', 'u-mgr1');
  const mgrBl2 = await call(env, '?action=live-items&store=BL2', 'u-mgr1');
  eq([mgr.status, storesOf(mgr), mgrBl2.status, mgrBl2.body?.error], [200, ['BL1'], 403, 'Forbidden'], 'a BL1 manager reads BL1 only, and is refused BL2 (403)');
  const mgr2 = await call(env, '?action=live-items', 'u-mgr2');
  eq([mgr2.status, storesOf(mgr2)], [200, ['BL1', 'BL4']], 'a BL1+BL4 manager reads exactly those two');
  const lower = await call(env, '?action=live-items&store=bl4');
  const unknown = await call(env, '?action=live-items&store=BL99');
  eq([lower.status, storesOf(lower), unknown.status, unknown.body?.error], [200, ['BL4'], 400, 'Invalid store'], 'store is case-blind; an unknown store is 400');
  const staff = await call(env, '?action=live-items', 'u-staff');
  eq([staff.status, staff.body?.code, mgr.status], [403, 'NO_FINANCIAL_ACCESS', 200], 'staff (no financial access) are refused while a manager is answered');
}

// ── 6. The agent door (retjg CLI / MCP) ────────────────────────────────────
{
  const { env, log, reset } = await setup();
  reset();
  const k = await keyed(env, '?action=live-items&fresh=1');
  eq([k.status, (k.body?.stores || []).map(x => `${x.store}:${x.status}`)], [200, ['BL1:ok', 'BL2:ok', 'BL4:ok', 'BL8:closed', 'BL14:ok', 'BL16:ok']],
    'the reporting key reads live-items, with fresh, chain-wide (every store, as a superuser)');
  eq([k.status, log.kv.map(w => w.key).sort(), nonSelect(log).length], [200, OPEN.map(liveKey).sort(), 0], 'through the key too, the only writes are the live-items: keys');
  const su = await call(env, '?action=live-items');
  ok(k.status === 200 && su.status === 200 && JSON.stringify(su.body.stores.map(({ cached, ...x }) => x)) === JSON.stringify(k.body.stores.map(({ cached, ...x }) => x)),
    'the key\'s answer equals a superuser session\'s, store for store');
  eq((await keyed(env, '?action=live-items&store=BL1', { where: 'query' })).status, 200, 'the key also works as ?key=');
  const wrong = await keyed(env, '?action=live-items', { key: 'not-the-key' });
  eq([k.status, wrong.status, wrong.body?.error, wrong.body?.code], [200, 401, 'Unauthorized', undefined], 'a wrong key → 401 at the KEY gate (not a session refusal)');
  const empty = await keyed(env, '?action=live-items', { key: '' });
  eq([empty.status, empty.body?.code], [401, undefined], 'an empty key → 401 at the key gate');
  const none = await worker.fetch(new Request('https://api.retjghub.com/?action=live-items'), env, ctx);
  eq([k.status, none.status, (await parse(none))?.code], [200, 401, 'NO_SESSION'], 'no key and no session → 401 NO_SESSION');
  eq((await keyed(env, '?action=live-items', { method: 'POST' })).status, 405, 'POST with the key → 405, GET only');
  const dated = await keyed(env, '?action=live-items&date=2026-11-16');
  eq([dated.status, dated.body?.params], [400, ['date']], 'today only: a date parameter is refused through the key');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
