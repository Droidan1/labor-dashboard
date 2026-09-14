// ?action=category-hours — the per-HOUR category series.
//
// Hours are the one grain this system has never stored. D1 is store-day, KV is store-day
// or store-week, and the ingest holds `order.createdTime` in the same loop that resolves
// a line item's L2/L3 and drops it on the floor. So every hour number is either banked by
// the ingest (going forward) or recomputed live from Clover, whose retention is ~90 days
// and decays continuously.
//
// That makes two properties load-bearing, and both are asserted here:
//
//   1. A store-day that could not be FETCHED must never render as zeros. Clover degrades
//      by returning less, not by erroring (CLAUDE.md rule 4), so "no data" and "no fetch"
//      have to stay distinguishable all the way to the caller — hence `missing[]`.
//   2. A slot must sit inside the day it was asked for. Orders are fetched by createdTime
//      but slotted by the register's own clock, so a late-synced offline order carries a
//      slot from a neighbouring day. Unfiltered, that reports sales under a date nobody
//      asked about.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const head = (t) => console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 56 - t.length)));

const worker = await loadWorker(repo);
const { env } = makeEnv(repo);
blockNetwork();   // any Clover call from the BANKED path is a bug, not a slow test

console.log('category-hours');

// ── fixtures ────────────────────────────────────────────────────────────────
const l3 = (name, qty, netSales) => ({ l3: name, qty, netSales });
const cat = (name, rows) => ({
  category: name,
  qty: rows.reduce((s, r) => s + r.qty, 0),
  netSales: Math.round(rows.reduce((s, r) => s + r.netSales, 0) * 100) / 100,
  l3Rows: rows,
});
const hourRollup = (net, qty) => ({
  categories: [cat('Home', [l3('FG BL HOME - BATH', qty, net)])],
  totals: { netSales: net, qty },
  orderCount: qty,
});

const D = '2026-09-08';          // a plain Tuesday, no DST edge
const D8 = '2026-09-07';         // a second day, so section 8 cannot disturb the bank

// A bank is only honoured while its daySnapshotTime still matches the `items:` snapshot
// it was written beside, so the fixture has to seed BOTH, stamped alike — exactly as
// saveItemSalesSnapshot writes them.
const STAMP = '2026-09-09T03:55:00.000Z';
await env.SALES_SNAPSHOTS.put(`items:bl1:${D}`,
  JSON.stringify({ ...hourRollup(425.75, 16), snapshotTime: STAMP }));
await env.SALES_SNAPSHOTS.put(`item-hours:bl1:${D}`, JSON.stringify({
  store: 'BL1', date: D, daySnapshotTime: STAMP, snapshotTime: STAMP,
  slots: {
    [`${D}T09`]: hourRollup(100.00, 4),
    [`${D}T13`]: hourRollup(250.50, 9),
    [`${D}T18`]: hourRollup( 75.25, 3),
    // A slot from the NEXT day, as a late-synced offline order would produce.
    // It is banked here on purpose: the endpoint must refuse to report it.
    ['2026-09-09T02']: hourRollup(999.99, 99),
  },
}));

const get = async (qs, user = 'u-su') => {
  const res = await worker.fetch(req('/?action=category-hours&' + qs, { user }), env, ctx);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
};

head('1. The banked path answers without touching Clover');
{
  const { status, body } = await get(`from=${D}&to=${D}`);
  ok(status === 200, `200 from a banked store-day (got ${status} ${JSON.stringify(body).slice(0, 120)})`);
  const slots = (body.l2 || {}).BL1 || {};
  ok(body.source && body.source.banked >= 1, `the payload says the numbers were banked (${JSON.stringify(body.source)})`);
  ok(body.source && body.source.live === 0, 'and that nothing was fetched live');
  ok(Object.keys(slots).length === 3, `three in-day slots returned, not four (got ${Object.keys(slots).length})`);
  ok(!!slots[`${D}T09`] && !!slots[`${D}T13`] && !!slots[`${D}T18`], 'the three in-day slots are the banked ones');
  ok(slots[`${D}T13`].Home[0] === 250.5, `net survives as [net, qty] (got ${JSON.stringify(slots[`${D}T13`].Home)})`);
  ok(slots[`${D}T13`].Home[1] === 9, 'and qty is the second element');
}

head('2. A slot outside the requested day is refused, not reported');
{
  const { body } = await get(`from=${D}&to=${D}`);
  const slots = (body.l2 || {}).BL1 || {};
  ok(!slots['2026-09-09T02'], 'the neighbouring-day slot is absent from a single-day request');
  ok(!Object.keys(slots).some(k => k.slice(0, 10) !== D),
    `EVERY returned slot is inside the requested day (${Object.keys(slots).join(',')})`);
}

head('3. Slot keys are YYYY-MM-DDTHH and sort chronologically');
{
  const { body } = await get(`from=${D}&to=${D}`);
  const keys = Object.keys((body.l2 || {}).BL1 || {});
  ok(keys.every(k => /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(k)), `every key matches the slot format (${keys.join(',')})`);
  ok(keys.every(k => Number(k.slice(11)) >= 0 && Number(k.slice(11)) <= 23), 'every hour is 00-23');
  const sorted = [...keys].sort();
  ok(JSON.stringify(sorted) === JSON.stringify([`${D}T09`, `${D}T13`, `${D}T18`]),
    'lexical sort is chronological order — no zero-padding gap at 09/13');
}

head('4. A store-day that could not be fetched is MISSING, never zero');
{
  // BL2 has no banked hours and the harness env carries no Clover creds, so
  // fetchItemOrders returns its "could not fetch" null. That must not become a floor of 0.
  const { status, body } = await get(`from=${D}&to=${D}&store=BL2`);
  ok(status === 200, `the request still succeeds (got ${status})`);
  const slots = (body.l2 || {}).BL2 || {};
  ok(Object.keys(slots).length === 0, `no slots invented for an unfetchable day (got ${Object.keys(slots).length})`);
  ok(Array.isArray(body.missing) && body.missing.includes(`BL2/${D}`),
    `and it is NAMED in missing[] (${JSON.stringify(body.missing)})`);
  ok(body.source.live === 0 && body.source.banked === 0, 'neither source is credited for a failed read');
}

head('5. The range cap is refused with its arithmetic, not truncated');
{
  const { status, body } = await get('from=2026-09-01&to=2026-09-08');   // 8 days
  ok(status === 413, `8 days is refused with 413 (got ${status})`);
  ok(body.code === 'BUDGET_EXCEEDED', `code says why (${body.code})`);
  ok(body.days === 8 && body.limit === 7, `it reports the arithmetic (${body.days} days vs limit ${body.limit})`);
  ok(body.slots === 192, `and what that would have cost in slots (${body.slots})`);

  const okRange = await get('from=2026-09-02&to=2026-09-08');            // exactly 7
  ok(okRange.status === 200, `exactly ${7} days is allowed (got ${okRange.status})`);
}

head('6. Input validation and the auth gate');
{
  ok((await get('from=nonsense&to=2026-09-08')).body.code === 'BAD_RANGE', 'a malformed date is BAD_RANGE');
  ok((await get('to=2026-09-08')).body.code === 'BAD_RANGE', 'a missing from is BAD_RANGE');
  ok((await get('from=2026-09-09&to=2026-09-08')).body.code === 'BAD_RANGE', 'to before from is BAD_RANGE');
  const anon = await worker.fetch(req(`/?action=category-hours&from=${D}&to=${D}`), env, ctx);
  ok(anon.status === 401, `no session is 401, before any data is touched (got ${anon.status})`);
}

head('7. Store scoping matches category-series');
{
  const { body } = await get(`from=${D}&to=${D}`, 'u-mgr1');   // manager, ["BL1"]
  ok(JSON.stringify(body.stores) === '["BL1"]', `a single-store manager sees only their store (${JSON.stringify(body.stores)})`);
  ok(Object.keys(body.l2 || {}).join(',') === 'BL1', 'and the payload carries no other store');
}

head('8. The shared normaliser did not change category-series');
{
  // seriesRowsFromSnapshot was extracted OUT of category-series so both grains share it.
  // A pure extraction must leave the day endpoint byte-identical in behaviour.
  await env.SALES_SNAPSHOTS.put(`items:bl1:${D8}`, JSON.stringify(hourRollup(412.75, 17)));
  const res = await worker.fetch(req(`/?action=category-series&from=${D8}&to=${D8}&level=l3`, { user: 'u-su' }), env, ctx);
  const body = await res.json();
  ok(res.status === 200, `category-series still answers 200 (got ${res.status})`);
  ok(body.l2.BL1[D8].Home[0] === 412.75, `L2 net unchanged (${JSON.stringify(body.l2.BL1[D8].Home)})`);
  ok(body.l2.BL1[D8].Home[1] === 17, 'L2 qty unchanged');
  ok(!!body.l3 && !!body.l3.BL1[D8].Home, 'L3 still nests under its L2');
  ok(body.l3.BL1[D8].Home['FG BL HOME - BATH'][0] === 412.75, 'and the L3 key is still normalised the same way');
}

head('9. category-hours is registered in the fail-closed business gate');
{
  // An action missing from ACTION_BUSINESS is refused 403 UNCLASSIFIED_ACTION by design.
  // Reaching 200 above already proves registration, but assert the registry directly so
  // a future rename cannot silently drop it back into the unclassified bucket.
  const src = (await import('node:fs')).readFileSync(path.join(repo, 'worker.js'), 'utf8');
  ok(/\["category-hours",\s*"bl"\]/.test(src), 'the action is classified to the bl business');
}

head('10. The LIVE path buckets by the register clock, in ET');
{
  // A real Clover, minimally. The point of this section is the bucketing and the
  // timezone, so the catalog is pre-seeded in KV and only orders/refunds/credits
  // are served over the wire.
  env.BL4_MERCHANT_ID = 'm4';
  env.BL4_API_TOKEN = 't4';
  await env.SALES_SNAPSHOTS.put('item-cats:bl4', JSON.stringify({ 'itm-1': 'FG BL HOME - BATH' }));

  const order = (id, iso, cents) => ({
    id, state: 'locked', total: cents,
    createdTime: Date.parse(iso), clientCreatedTime: Date.parse(iso),
    payments: { elements: [{ taxAmount: 0 }] },
    lineItems: { elements: [{ id: id + '-li', name: 'Bath Mat', price: cents, item: { id: 'itm-1' } }] },
  });

  // EDT day (UTC-4): 13:30Z is 09:30 ET, 17:05Z is 13:05 ET.
  // 03:30Z is 23:30 ET on the PREVIOUS day — it is served deliberately, to prove the
  // day filter drops it rather than reporting yesterday's sale under today.
  const EDT_ORDERS = [
    order('o-a', '2026-09-08T13:30:00Z', 10000),
    order('o-b', '2026-09-08T17:05:00Z', 25000),
    order('o-prev', '2026-09-08T03:30:00Z', 90000),
  ];
  // EST day (UTC-5): 14:30Z is 09:30 ET. Under a hardcoded EDT offset it would
  // land at 10:30 and this assertion is what catches that.
  const EST_ORDERS = [order('o-w', '2026-01-20T14:30:00Z', 50000)];

  // A refund issued at 22:00Z = 18:00 ET, against the 09:30 order. It belongs to
  // the hour it was ISSUED, not the hour of the sale it reverses.
  const REFUNDS = [{ id: 'r-1', amount: 3000, createdTime: Date.parse('2026-09-08T22:00:00Z'),
                     orderRef: { id: 'o-a' }, payment: { order: { id: 'o-a' } } }];

  let calls = 0;
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (u) => {
    const url = String(u); calls++;
    const J = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/orders')) {
      const winter = url.includes(String(Date.parse('2026-01-20T05:00:00Z')));
      return J({ elements: winter ? EST_ORDERS : EDT_ORDERS });
    }
    if (url.includes('/refunds')) return J({ elements: url.includes('2026-01') ? [] : REFUNDS });
    if (url.includes('/credits')) return J({ elements: [] });
    return J({ elements: [] });
  };

  try {
    const summer = await get('from=2026-09-08&to=2026-09-08&store=BL4');
    const sl = (summer.body.l2 || {}).BL4 || {};
    ok(summer.status === 200, `live day answers 200 (got ${summer.status})`);
    ok(calls > 0, 'it really went to Clover');
    ok(summer.body.source.live === 1, `credited to the live source (${JSON.stringify(summer.body.source)})`);
    ok(!!sl['2026-09-08T09'], `the 09:30 ET order landed in T09 (slots: ${Object.keys(sl).join(',')})`);
    ok(!!sl['2026-09-08T13'], 'the 13:05 ET order landed in T13');
    ok(!sl['2026-09-07T23'], 'the 23:30-ET-yesterday order is NOT reported under this day');
    ok(!Object.keys(sl).some(k => k.slice(0, 10) !== '2026-09-08'), 'no slot escapes the requested day');
    ok(Math.abs(sl['2026-09-08T09'].Home[0] - 100) < 0.01,
      `T09 carries its own $100, undisturbed by the 18:00 refund (${JSON.stringify(sl['2026-09-08T09'].Home)})`);
    ok(!!sl['2026-09-08T18'], 'the refund created an 18:00 slot of its own');
    ok(sl['2026-09-08T18'].Home[0] < 0,
      `and it is NEGATIVE there, not against the sale's hour (${JSON.stringify(sl['2026-09-08T18'].Home)})`);

    const winter = await get('from=2026-01-20&to=2026-01-20&store=BL4');
    const wl = (winter.body.l2 || {}).BL4 || {};
    ok(!!wl['2026-01-20T09'],
      `14:30Z in JANUARY is 09:00 ET, not 10:00 — EST is honoured (slots: ${Object.keys(wl).join(',')})`);
    ok(!wl['2026-01-20T10'], 'the EDT offset is not hardcoded');
  } finally {
    globalThis.fetch = prevFetch;
  }
}

head('11. Banked beats live — a banked day costs no Clover call');
{
  let touched = 0;
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (u) => { touched++; throw new Error('should not fetch: ' + String(u).slice(0, 60)); };
  try {
    const { status, body } = await get(`from=${D}&to=${D}&store=BL1`);
    ok(status === 200 && touched === 0,
      `a banked store-day answered with ZERO outbound calls (status ${status}, calls ${touched})`);
    ok(body.source.banked === 1 && body.source.live === 0, 'and is credited to the banked source');
  } finally {
    globalThis.fetch = prevFetch;
  }
}

head('12. A bank that no longer matches its day snapshot is not trusted');
{
  // This is the whole reason the stamp exists. A repair rewrites `items:` and has no
  // idea hours are banked beside it; serving the old hours next to the new day total is
  // a silent disagreement between two views of the same Tuesday. The bank must lose.
  const before = await get(`from=${D}&to=${D}&store=BL1`);
  ok(before.body.source.banked === 1, 'precondition: the bank is honoured while the stamps agree');

  await env.SALES_SNAPSHOTS.put(`items:bl1:${D}`, JSON.stringify({
    ...hourRollup(999.00, 40), snapshotTime: '2026-09-10T12:00:00.000Z',   // a repair
  }));
  const after = await get(`from=${D}&to=${D}&store=BL1`);
  ok(after.body.source.banked === 0, `after the day snapshot moves, the bank is NOT used (${JSON.stringify(after.body.source)})`);
  ok(after.body.source.staleBanks === 1, 'and the payload says a stale bank was skipped rather than hiding it');
  ok(Object.keys((after.body.l2 || {}).BL1 || {}).length === 0,
    'it falls back to live rather than serving hours that disagree with the day');
  ok(after.body.missing.includes(`BL1/${D}`), 'and the unfetchable live retry is named in missing[], not zeroed');
}

head('13. The writer and the reader agree on the banked shape');
{
  // The fixture above hand-writes the bank. That is only safe while it matches what
  // saveItemSalesSnapshot actually emits — two hand-maintained copies of a wire shape
  // drift, and a drifted one reads as a data bug rather than a code bug. Pin the field
  // names on both sides so a rename cannot pass silently.
  const src = (await import('node:fs')).readFileSync(path.join(repo, 'worker.js'), 'utf8');
  ok(/item-hours:\$\{lc\}:\$\{dateStr\}/.test(src), 'the writer uses the item-hours:<store>:<date> key');
  ok(/slots: hourSlots,\s*\n\s*daySnapshotTime: snapshotTime, snapshotTime,/.test(src),
    'the writer stamps daySnapshotTime from the SAME value it writes into items:');
  ok(/b\.daySnapshotTime === day\.snapshotTime/.test(src), 'and the reader compares exactly that pair');
  ok(/hourSlots = buildItemHourBuckets\(bucket,/.test(src),
    'the clientCreatedTime sweep banks from its own day-filtered bucket');
  ok(/saveItemSalesSnapshot\(env, store, dateStr, itemData, hourSlots\)/.test(src),
    'and hands it to the one writer, so the two keys cannot be written apart');
  // A bank must never cost the day its snapshot.
  ok(/\[item-hours\] bank failed/.test(src), 'a failed bank is logged and swallowed, not thrown');
  const writerBody = src.slice(src.indexOf('async function saveItemSalesSnapshot'),
                               src.indexOf('async function saveItemSalesSnapshot') + 1400);
  ok(writerBody.indexOf('items:${lc}') < writerBody.indexOf('item-hours:${lc}'),
    'the day snapshot is written FIRST, so a bank failure cannot preempt it');
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
