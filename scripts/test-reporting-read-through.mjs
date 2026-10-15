// The reporting key reads the Retail Summary, Labor and Inventory pages' own endpoints.
//
// WHAT THIS PROTECTS. Agents (the retjg CLI and the retjg-mcp connector) need
// what those two pages show. The pages' endpoints sit behind a session, the
// financial gate, the business gate and allowedStores(). The key now opens
// exactly fourteen of them, read-only, chain-wide, and nothing else: seven
// Retail Summary / Labor reads (2026-10-13) and seven Inventory reads (2026-10-15:
// Viewer, Schedule Sale, Bin Dump, Receiver, Mark Out of Stock — not Opportunity Buys).
//
// 🔑 The strongest check is a DIFFERENTIAL: for every action, the key's answer
// must equal a superuser session's answer byte for byte. That proves the key
// reaches the page's real handler with all stores and no other behaviour,
// without this test re-deriving what any handler returns.
//
// 🛑 And the dangerous direction: the key must not open anything else. Every
// write and every other action still demands a session, and a POST with the
// key never reaches a handler.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, blockNetwork, req, applyMigrationAlters } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
// Bound once: a section below swaps console.log to capture the worker's logs,
// and a FAIL printed through the swapped one would vanish into the capture.
const say = console.log.bind(console);
const ok = (c, m) => { if (c) pass++; else { fail++; say('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const KEY = 'test-briefing-key';
const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
env.MORNING_BRIEFING_KEY = KEY;
blockNetwork();

// A real fortnight so the answers are not empty — an equality between two empty
// payloads proves nothing. Sun 2026-09-27 … Sat 2026-10-10.
const ins = db.prepare(`INSERT OR REPLACE INTO daily_sales
  (store, date, week, total, retail, bin, budget, order_count, budget_labor_hours, labor_hours, snapshot_time)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const days = [];
for (let d = new Date('2026-09-27T12:00:00Z'); d <= new Date('2026-10-10T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
  days.push(d.toISOString().slice(0, 10));
}
const STORES = ['BL1', 'BL2', 'BL4', 'BL14', 'BL16'];
STORES.forEach((s, i) => days.forEach((date, j) => {
  const total = 1000 + 100 * i + j;
  // week = the fiscal week label the import writes; weekly-t13 groups and keys by it.
  ins.run(s, date, j < 7 ? '40' : '41', total, total - 300, 300, 1100 + 100 * i, 50 + j, 40 + i, 38 + i + (j % 3), date + 'T07:55:00Z');
}));
const bl2Week = days.slice(0, 7).reduce((a, _, j) => a + 1100 + j, 0); // BL2, 09-27 … 10-03
// Item snapshots too, so the category and trailing-week equalities compare real
// payloads (the review found them comparing near-empty ones).
for (const s of STORES) for (const [j, date] of days.entries()) {
  await env.SALES_SNAPSHOTS.put(`items:${s.toLowerCase()}:${date}`, JSON.stringify({ orderCount: 20, categories: [
    { category: 'Home', qty: 3 + j, netSales: 30 + j, l3Rows: [{ l3: 'FG BL HOME - KITCHEN', qty: 3 + j, netSales: 30 + j }] },
  ] }));
}

// The Inventory pages' tables, a few real rows each, and Clover's item list for BL2.
for (const m of ['002', '058', '062', '065']) db.exec(fs.readFileSync(path.join(repo, `migration-${m}.sql`), 'utf8'));
applyMigrationAlters(db, repo);
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
db.prepare(`INSERT INTO sale_schedules (schedule_group, store, item_id, item_name, discount_kind, discount_value,
  original_price, sale_price, starts_at, ends_at, status, created_at) VALUES ('g1','BL2','I1','Brass lamp','percent',20,1999,1599,?,?,'active',?)`)
  .run(ago(24), new Date(Date.now() + 86400e3).toISOString(), ago(48));
const dump = db.prepare(`INSERT INTO bin_dumps (store, barcode, item_no, pallet_name, po, units, logged_by, logged_at) VALUES (?,?,?,?,?,?,?,?)`);
dump.run('BL1', 'PRM-10490-30', '10490', 'Mixed home', 'PO77', 412, 'lead@bargainlane.com', ago(30));
dump.run('BL2', 'PRM-10491-31', '10491', 'Toys', 'PO78', 388, 'Sam (associate)', ago(5));
const truck = db.prepare(`INSERT INTO trucks (store, bol_no, ship_from, opened_by, opened_at, closed_by, closed_at) VALUES (?,?,?,?,?,?,?)`);
const closedTruck = truck.run('BL1', 'BOL-1001', 'RM1', 'lead@bargainlane.com', ago(72), 'lead@bargainlane.com', ago(70)).lastInsertRowid;
const openTruck = truck.run('BL2', 'BOL-2002', 'RM1', 'Sam (associate)', ago(3), null, null).lastInsertRowid;
const pallet = db.prepare(`INSERT INTO truck_pallets (truck_id, store, barcode, units, logged_by, logged_at) VALUES (?,?,?,?,?,?)`);
pallet.run(closedTruck, 'BL1', 'P-1', 40, 'lead@bargainlane.com', ago(71));
pallet.run(openTruck, 'BL2', 'P-2', 25, 'Sam (associate)', ago(2));
pallet.run(openTruck, 'BL2', 'P-3', 35, 'Sam (associate)', ago(1));
const mos = db.prepare(`INSERT INTO mos_entries (store, code, item_no, description, qty, unit_cost_cents, unit_price_cents, reason, logged_by, logged_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
mos.run('BL2', 'BL-50038-1_5', '50038', 'Snacks', 3, 40, 150, 'Stolen', 'Sam (associate)', ago(6));
mos.run('BL2', 'BL-50040-4', '50040', 'Cleaning', 1, 120, 400, 'Store Use', 'lead@bargainlane.com', ago(4));
env.BL2_MERCHANT_ID = 'M2';
env.BL2_API_TOKEN = 'clover-token-bl2';
const blockedFetch = globalThis.fetch;
const CLOVER_ITEMS = [
  { id: 'I1', name: 'Brass lamp', code: 'BL-50100-19_99', price: 1999, cost: 600, categories: { elements: [{ id: 'C1', name: 'FG BL HOME - DECOR' }] } },
  { id: 'I2', name: 'Bin item', code: 'BIN-1', price: 500, categories: { elements: [{ id: 'C2', name: 'Bin Products' }] } },
];
// BL2's whole Clover account, not just its item list: with keys, category-hours reads
// BL2 live too, and an unanswered /orders would make it (and this test) a 500.
globalThis.fetch = async (u, init) => {
  const s = String(u);
  if (!s.startsWith('https://api.clover.com/v3/merchants/M2/')) return blockedFetch(u, init);
  const firstItems = s.includes('/items?') && /[?&]offset=0(&|$)/.test(s);
  return new Response(JSON.stringify({ elements: firstItems ? CLOVER_ITEMS : [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const ACTIONS = {
  'weekly-summary':      '?action=weekly-summary&from=2026-09-27&to=2026-10-03',
  'weekly-store-detail': '?action=weekly-store-detail&store=BL2&from=2026-09-27&to=2026-10-03',
  'weekly-t13':          '?action=weekly-t13&end=2026-10-03',
  'category-series':     '?action=category-series&from=2026-09-27&to=2026-10-03&level=l2',
  'category-hours':      '?action=category-hours&from=2026-10-02&to=2026-10-02&level=l2',
  'labor':               '?action=labor&grain=w&from=2026-09-27&to=2026-10-10',
  'labor-plan':          '?action=labor-plan&week=2026-10-10',
  // Inventory (2026-10-15), with the parameters each page sends.
  'inventory-items':     '?action=inventory-items&store=BL2&offset=0',
  'list-sale-schedules': '?action=list-sale-schedules&store=BL2&filter=all',
  'bin-dump-list':       '?action=bin-dump-list&store=ALL&weeks=8&limit=500',
  'truck-current':       '?action=truck-current&store=BL2',
  'truck-detail':        `?action=truck-detail&id=${closedTruck}`,
  'truck-list':          '?action=truck-list&store=ALL&months=6&limit=400',
  'mos-list':            '?action=mos-list&store=ALL&months=3&limit=500',
};

const fetchW = (r) => worker.fetch(r, env, ctx);
const withKey = (q, { key = KEY, method = 'GET', where = 'header' } = {}) => new Request(
  'https://api.retjghub.com/' + q + (where === 'query' ? `&key=${encodeURIComponent(key)}` : ''),
  { method, headers: where === 'header' ? { 'X-API-Key': key } : {} });
const bodyOf = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
// Fields stamped at request time, which two calls cannot share.
const stable = (o) => JSON.stringify(o, (k, v) => (['generatedAt', 'asOf', 'fetchedAt'].includes(k) ? undefined : v));

// Every write a request could make: D1 rows, KV and R2 puts and deletes, and any
// outbound call that is not a GET (a Clover price change, a paid API call).
const writes = [];
for (const name of ['SALES_SNAPSHOTS', 'MEDIA']) for (const m of ['put', 'delete']) {
  const real = env[name][m].bind(env[name]);
  env[name][m] = (key, ...a) => {
    // The one write a read may make: Clover's item→category map, cached 24 h
    // (fetchItemCategoryMap; category-hours fills it, as a session call does). A cache,
    // not stored history. Anything else is a write.
    if (!(name === 'SALES_SNAPSHOTS' && m === 'put' && String(key).startsWith('item-cats:'))) writes.push(`${name}.${m} ${key}`);
    return real(key, ...a);
  };
}
const readFetch = globalThis.fetch;
globalThis.fetch = (u, init) => {
  const method = (init && init.method) || (u instanceof Request ? u.method : 'GET');
  if (method !== 'GET') writes.push(`fetch ${method} ${String(u.url || u).slice(0, 60)}`);
  return readFetch(u, init);
};
const d1Changes = () => db.prepare('SELECT total_changes() n').get().n;

// ── 1. The key reads each page endpoint exactly as a superuser does ────────
for (const [action, q] of Object.entries(ACTIONS)) {
  const before = d1Changes();
  writes.length = 0;
  const k = await fetchW(withKey(q));
  eq(JSON.stringify([d1Changes() - before, writes]), '[0,[]]', `${action}: a keyed read writes nothing (D1, KV, R2, outbound)`);
  const su = await fetchW(req('/' + q, { user: 'u-su' }));
  const kb = await bodyOf(k), sb = await bodyOf(su);
  eq(k.status, 200, `${action}: the key is answered 200`);
  eq(su.status, 200, `${action}: control — a superuser session is answered 200`);
  ok(stable(kb) === stable(sb), `${action}: the key's answer equals the superuser's, field for field`);
  eq((await fetchW(withKey(q, { where: 'query' }))).status, 200, `${action}: the key also works as ?key=, like the other reporting actions`);
}

// Not vacuous: the payloads carry the seeded figures, for every store.
{
  const ws = await bodyOf(await fetchW(withKey(ACTIONS['weekly-summary'])));
  eq(ws?.stores?.BL2?.totals?.netSales, bl2Week, 'weekly-summary carries BL2\'s seeded week through the key');
  ok(STORES.every(s => ws?.stores?.[s]), 'weekly-summary through the key covers every store, not a scoped subset');
  const lb = await bodyOf(await fetchW(withKey(ACTIONS.labor)));
  ok(lb?.periods?.length >= 2 && STORES.every(s => lb.stores?.includes(s)), 'labor through the key covers every labor store');
  const lp = await bodyOf(await fetchW(withKey(ACTIONS['labor-plan'])));
  ok(lp?.byStore && STORES.every(s => lp.byStore[s]), 'labor-plan through the key covers every store');
  const cs = await bodyOf(await fetchW(withKey(ACTIONS['category-series'])));
  eq(cs?.l2?.BL2?.['2026-09-27']?.Home?.[0], 30, 'category-series through the key carries the seeded category net');
  const t13 = await bodyOf(await fetchW(withKey(ACTIONS['weekly-t13'])));
  ok((t13?.total?.netSales || []).some(n => n > 0), 'weekly-t13 through the key carries real weekly sales');
  // Inventory: each answer carries the seeded rows, for every store asked.
  const items = await bodyOf(await fetchW(withKey(ACTIONS['inventory-items'])));
  eq(JSON.stringify(items?.elements?.map(e => [e.name, e.cost])), '[["Brass lamp",600],["Bin item",0]]', 'inventory-items through the key reads Clover\'s items, cost included');
  eq((await bodyOf(await fetchW(withKey(ACTIONS['list-sale-schedules']))))?.groups?.[0]?.items?.[0]?.salePrice, 1599, 'list-sale-schedules through the key carries the seeded sale');
  const dumps = await bodyOf(await fetchW(withKey(ACTIONS['bin-dump-list'])));
  eq(dumps?.rows?.map(r => r.store).sort().join(), 'BL1,BL2', 'bin-dump-list ALL through the key covers every store');
  ok(dumps?.rows?.some(r => r.logged_by === 'Sam (associate)'), 'and carries who logged it (Brian: include names)');
  eq((await bodyOf(await fetchW(withKey(ACTIONS['truck-current']))))?.pallets?.length, 2, 'truck-current through the key: BL2\'s open truck and its pallets');
  eq((await bodyOf(await fetchW(withKey(ACTIONS['truck-detail']))))?.truck?.bol_no, 'BOL-1001', 'truck-detail through the key: the received BL1 truck');
  const tl = await bodyOf(await fetchW(withKey(ACTIONS['truck-list'])));
  eq(tl?.rows?.map(r => `${r.store}:${r.units}`).sort().join(), 'BL1:40,BL2:60', 'truck-list ALL through the key: both trucks with their units');
  const ml = await bodyOf(await fetchW(withKey(ACTIONS['mos-list'])));
  const sum = (k) => (ml?.months || []).reduce((s, m) => s + (m[k] || 0), 0);
  eq(JSON.stringify([ml?.rows?.length, sum('shrink_cents'), sum('store_use_cents')]), '[2,120,120]',
    'mos-list ALL through the key: both entries, shrink and store use totalled by the server');
}

// ── 1b. Only the seven handlers' own parameters ────────────────────────────
// 🛑 A read-through request falls through the route chain, so a route above the
// seven chosen by another parameter would answer instead. The review reached
// ?history_d1=true and ?history=true that way.
{
  const logged = [];
  const realLog = console.log;
  console.log = (...a) => logged.push(a.join(' '));
  try {
    for (const [action, q] of Object.entries(ACTIONS)) {
      for (const extra of ['&history_d1=true&store=BL1&from=2026-10-01&to=2026-10-01', '&history=true&store=BL1&from=2026-10-01&to=2026-10-01']) {
        const r = await fetchW(withKey(q + extra));
        const b = await bodyOf(r);
        eq(r.status, 400, `${action}${extra.split('&')[1]}: refused, not answered by the history route`);
        ok(Array.isArray(b?.params) && b.params.some(p => p.startsWith('history')), `${action}: the refusal names the parameter`);
      }
    }
    const odd = await bodyOf(await fetchW(withKey(ACTIONS.labor + '&foo=1')));
    eq(JSON.stringify(odd?.params), '["foo"]', 'any parameter the handler does not read is refused');
    eq((await fetchW(withKey(ACTIONS.labor, { method: 'HEAD' }))).status, 405, 'HEAD with the key → 405');
    await fetchW(withKey(ACTIONS['labor-plan']));
  } finally { console.log = realLog; }
  ok(logged.some(l => l === JSON.stringify({ reporting_read_through: 'labor-plan' })), 'a keyed read is logged by action, for wrangler tail');
  ok(logged.every(l => !l.includes(KEY)), 'the key itself is never logged');
}

// ── 1c. The history routes answer only requests without an action ──────────
// The review's second finding, already on main: the financial gate decides by
// action, so a NON-financial action carried with history_d1 let staff (and
// every PIN associate, role staff) read their store's sales past it.
{
  const hist = '&history_d1=true&store=BL1&from=2026-10-01&to=2026-10-01';
  const control = await fetchW(req('/?' + hist.slice(1), { user: 'u-su' }));
  const ctext = await control.text();
  eq(control.status, 200, 'control: the dashboard\'s own history_d1 call (no action) still answers a superuser');
  ok(ctext.includes('1004'), 'control: and returns BL1\'s seeded 2026-10-01 total');
  const staffNoAction = await fetchW(req('/?' + hist.slice(1), { user: 'u-staff' }));
  eq(staffNoAction.status, 403, 'staff without an action is refused, as before');
  const sneak = await fetchW(req('/?action=vapid-public-key' + hist, { user: 'u-staff' }));
  ok(!(await sneak.text()).includes('1004'), 'staff carrying a non-financial action no longer get BL1\'s sales from history_d1');
  // The KV history route reads sales:<store>:<date>; seed one with a value no
  // other payload carries, or the check below compares two empty answers.
  await env.SALES_SNAPSHOTS.put('sales:bl1:2026-10-01', JSON.stringify({ total: 777777.77 }));
  const kvHist = 'history=true&store=BL1&from=2026-10-01&to=2026-10-01';
  ok((await (await fetchW(req('/?' + kvHist, { user: 'u-su' }))).text()).includes('777777.77'), 'control: history (KV, no action) still answers a superuser');
  const sneak2 = await fetchW(req('/?action=vapid-public-key&' + kvHist, { user: 'u-staff' }));
  ok(!(await sneak2.text()).includes('777777.77'), 'nor do they get it from history');
}

// ── 2. A wrong, empty or unconfigured key is refused before any handler ────
for (const [action, q] of Object.entries(ACTIONS)) {
  const wrong = await fetchW(withKey(q, { key: 'not-the-key' }));
  eq(wrong.status, 401, `${action}: a wrong key → 401`);
  eq((await bodyOf(wrong))?.code, undefined, `${action}: refused by the KEY gate, not the session gate`);
  eq((await fetchW(withKey(q, { key: '' }))).status, 401, `${action}: an empty X-API-Key → 401, not a fall-through`);
  eq((await fetchW(withKey(q, { key: 'nope', where: 'query' }))).status, 401, `${action}: a wrong ?key= → 401`);
  eq((await fetchW(withKey(q, { method: 'POST' }))).status, 405, `${action}: POST with the key → 405, never a handler`);
}
{
  const saved = env.MORNING_BRIEFING_KEY;
  env.MORNING_BRIEFING_KEY = '';
  eq((await fetchW(withKey(ACTIONS.labor))).status, 503, 'no key configured on the server → 503, never open');
  env.MORNING_BRIEFING_KEY = saved;
}

// ── 3. The key opens NOTHING else ──────────────────────────────────────────
{
  const rowsBefore = db.prepare('SELECT COUNT(*) n, SUM(labor_hours) h FROM daily_sales').get();
  const write = new Request('https://api.retjghub.com/?action=manual-override', {
    method: 'POST', headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ markOverride: false, entries: [{ store: 'BL1', date: '2026-10-01', labor_hours: 999 }] }),
  });
  const w = await fetchW(write);
  eq(w.status, 401, 'manual-override with the key → 401 (needs a session)');
  eq((await bodyOf(w))?.code, 'NO_SESSION', 'manual-override is refused by the SESSION gate: the key does not reach it');
  const rowsAfter = db.prepare('SELECT COUNT(*) n, SUM(labor_hours) h FROM daily_sales').get();
  ok(rowsBefore.n === rowsAfter.n && rowsBefore.h === rowsAfter.h, 'and nothing in daily_sales changed');

  for (const action of ['manual-override', 'rebuild-week-summaries', 'item-costs', 'users', 'snapshot', 'hourly', 'channel-range']) {
    const r = await fetchW(withKey(`?action=${action}`));
    eq((await bodyOf(r))?.code, 'NO_SESSION', `GET ${action} with the key still needs a session`);
  }
  // The Inventory reads left out on purpose (2026-10-15): Opportunity Buys (Brian: not this
  // time), photos, edit-time pre-checks, Add Item's category list, and every write.
  for (const q of ['ob-buy-list', 'ob-report', 'ob-buy-detail&po=PO1', 'bin-dump-photo&id=1', 'truck-photo&id=1',
    'bin-dump-recent&store=BL1', 'truck-pallet-recent&store=BL1', 'truck-approvers&store=BL1', 'clover-categories&store=BL2',
    'update-clover-item', 'delete-clover-item', 'schedule-sale', 'cancel-sale-schedule', 'bin-dump-log', 'truck-open', 'mos-log']) {
    const r = await fetchW(withKey(`?action=${q}`));
    eq((await bodyOf(r))?.code, 'NO_SESSION', `GET ${q.split('&')[0]} with the key still needs a session`);
  }
  // 🛑 mos-lookup is a GET that WRITES (it learns sticker codes), so it must never be a read-through.
  const codesBefore = db.prepare('SELECT COUNT(*) n FROM sticker_codes').get().n;
  const lk = await fetchW(withKey('?action=mos-lookup&store=BL2&code=BL-50999-2'));
  eq((await bodyOf(lk))?.code, 'NO_SESSION', 'mos-lookup with the key still needs a session');
  eq(db.prepare('SELECT COUNT(*) n FROM sticker_codes').get().n, codesBefore, 'and it learned no sticker code');
}

// ── 3b. For every other action, the key changes nothing ───────────────────
// 🛑 Not a hand-picked list: every action the business gate knows. Outside the
// read-throughs and the reporting actions, a keyed GET must get exactly the answer
// the same GET gets with no key at all, and write nothing.
{
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const at = src.indexOf('const ACTION_BUSINESS = new Map([');
  const known = [...src.slice(at, src.indexOf(']);', at)).matchAll(/\["([a-z0-9-]+)",/g)].map(m => m[1]);
  ok(known.length > 100, `ACTION_BUSINESS was read (${known.length} actions)`);
  const opened = new Set([...Object.keys(ACTIONS), 'morning-briefing', 'store-history', 'afternoon-briefing', 'agent-identity']);
  let same = 0;
  for (const action of known.filter(a => !opened.has(a))) {
    const before = d1Changes();
    writes.length = 0;
    const k = await fetchW(withKey(`?action=${action}`));
    const kText = stable(await bodyOf(k));
    const n = await fetchW(new Request(`https://api.retjghub.com/?action=${action}`));
    const nText = stable(await bodyOf(n));
    if (k.status === n.status && kText === nText && d1Changes() === before && !writes.length) same++;
    else ok(false, `${action}: the key changed the answer or wrote (keyed ${k.status} ${kText.slice(0, 60)} vs ${n.status} ${nText.slice(0, 60)}; writes ${writes.join()})`);
  }
  eq(same, known.filter(a => !opened.has(a)).length, `the key changes nothing for the other ${same} actions`);
}

// ── 4. Without the key, the pages behave exactly as before ─────────────────
for (const [action, q] of Object.entries(ACTIONS)) {
  const anon = await fetchW(new Request('https://api.retjghub.com/' + q));
  eq((await bodyOf(anon))?.code, 'NO_SESSION', `${action}: no key and no session → NO_SESSION, as before`);
}
{
  // A manager scoped to BL1 still sees only BL1 — the key's chain-wide read did
  // not widen the session path.
  const mgr = await bodyOf(await fetchW(req('/' + ACTIONS['weekly-summary'], { user: 'u-mgr1' })));
  eq(Object.keys(mgr?.stores || {}).join(), 'BL1', 'a BL1 manager\'s session still sees only BL1');
  const mlab = await bodyOf(await fetchW(req('/' + ACTIONS.labor, { user: 'u-mgr1' })));
  eq((mlab?.stores || []).join(), 'BL1', 'a BL1 manager\'s labor is still BL1 only');
  const staff = await fetchW(req('/' + ACTIONS.labor, { user: 'u-staff' }));
  eq(staff.status, 403, 'staff (no financial access) is still refused');
  // Inventory's own rules for sessions are untouched: the catalog stays admin-only, and
  // "all stores" on a floor page still means the stores THIS user holds.
  eq((await fetchW(req('/' + ACTIONS['inventory-items'], { user: 'u-mgr1' }))).status, 403, 'a manager still cannot read the catalog (admins only)');
  eq((await fetchW(req('/' + ACTIONS['list-sale-schedules'], { user: 'u-mgr1' }))).status, 403, 'nor the sale schedules');
  eq((await fetchW(req('/' + ACTIONS['inventory-items'], { user: 'u-admin' }))).status, 200, 'an admin still can');
  const mdumps = await bodyOf(await fetchW(req('/' + ACTIONS['bin-dump-list'], { user: 'u-mgr1' })));
  eq((mdumps?.rows || []).map(r => r.store).join(), 'BL1', 'a BL1 manager\'s bin dumps (ALL) are still BL1 only');
  const mtrucks = await bodyOf(await fetchW(req('/' + ACTIONS['truck-list'], { user: 'u-mgr1' })));
  eq((mtrucks?.rows || []).map(r => r.store).join(), 'BL1', 'and their trucks');
  const mmos = await bodyOf(await fetchW(req('/' + ACTIONS['mos-list'], { user: 'u-mgr1' })));
  eq((mmos?.rows || []).length, 0, 'and their out-of-stock log (no BL1 entries seeded)');
  eq((await fetchW(req('/' + ACTIONS['truck-current'], { user: 'u-mgr1' }))).status, 403, 'a BL1 manager still cannot read BL2\'s open truck');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
