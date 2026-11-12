// The discount record (migration-089) and the Discounts & Returns reads.
//
// WHAT THIS PROTECTS. Brian (2026-11-12) wants "why did October discounts jump" and "what were
// Coliseum's manual refunds" answered in the hub. The hub knew discount DOLLARS per store-day but
// not which discount, on what, or who rang it. Four properties carry the weight:
//   1. The record adds up to the Retail Summary: built in the same pass with the same rule, a
//      store-day's rows sum to its snapshot's discounts, per category as well as in total, and an
//      order-level discount split over its lines never gains or loses a cent.
//   2. It cannot be thinned: once a day is older than the nightly sweep's window, a smaller
//      answer from Clover (which thins old days out) is refused, by the nightly path and the
//      backfill alike. The backfill writes ONLY the discount tables and is a dry run by default.
//   3. The reads are scoped like every other money read (managers their stores, staff nothing),
//      and the classification is editable by admins only.
//   4. Returns flags are right at the edges: no item vs. a sale too old to check, $100, and three
//      manual refunds in one Sunday–Saturday week even when the range cuts the week.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req, applyMigrationAlters, recordStatements, nestedScans } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
for (const m of ['063', '064', '078', '089']) db.exec(fs.readFileSync(path.join(repo, `migration-${m}.sql`), 'utf8'));
applyMigrationAlters(db, repo);
env.BL1_MERCHANT_ID = 'M1';
env.BL1_API_TOKEN = 'clover-token-bl1';
const fetchW = (r) => worker.fetch(r, env, ctx);
const todayET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const D = '2026-10-14';                       // an old day: past the sweep's window
const T = Date.parse(`${D}T15:00:00Z`);       // 11:00 ET

await env.SALES_SNAPSHOTS.put('item-cats:bl1', JSON.stringify({
  'I-CANDY': 'FG BL CONSUMABLES - FOOD - CANDY',
  'I-APP': 'FG BL SOFTLINES - APPAREL',
}));

// ── One store-day: every way a discount lands ───────────────────────────────
const li = (id, name, price, item, extra = {}) => ({ id, name, price, ...(item && { item: { id: item } }), ...extra });
const order = (id, lines, payment, extra = {}) => ({
  id, state: 'locked', total: payment, createdTime: T, clientCreatedTime: T, employee: { id: 'E1' },
  payments: { elements: [{ id: 'p-' + id, amount: payment, taxAmount: 0, employee: { id: 'E1' } }] },
  lineItems: { elements: lines }, ...extra,
});
const BASE = [
  // 10% off the whole order (Halloween), approved by E2: $3.50 over $35, split by line.
  order('O1', [
    li('l1', 'Candy', 1000, 'I-CANDY'),
    li('l2', 'Shirt', 2000, 'I-APP'),
    li('l3', 'Socks', 500, 'I-APP'),
  ], 3150, { discounts: { elements: [{ id: 'D1', name: 'Halloween 10%', percentage: 10, discount: { id: 'B-HAL' }, approver: { id: 'E2' } }] } }),
  // Line discounts ($1 off a bin, 25% off a shirt), then $2 AND 5% off the order — two
  // order-level discounts sharing each line's portion. Rung by E2.
  order('O2', [
    li('l4', '$3 Bin', 300, 'I-BIN', { discounts: { elements: [{ id: 'D2', name: '$1 off', amount: -100, discount: { id: 'B-1' } }] } }),
    li('l5', 'Jacket', 1000, 'I-APP', { discounts: { elements: [{ id: 'D3', name: 'Apparel 25%', percentage: '25' }] } }),
  ], 702, { employee: { id: 'E2' }, discounts: { elements: [{ id: 'D4', name: '$2 off', amount: -200 }, { id: 'D5', name: 'Manager 5%', percentage: 5 }] } }),
  // A weighed line at 10% off, and a refund line carrying a discount that must not count.
  order('O3', [
    li('l6', 'Loose candy', 999, 'I-CANDY', { unitQty: 333, discounts: { elements: [{ id: 'D6', name: 'Candy 10%', percentage: 10 }] } }),
    li('l7', 'Refund', -500, null, { discounts: { elements: [{ id: 'D7', name: '$1 off', amount: -100 }] } }),
  ], 300),
  // An order that never locked: its discount is not a discount given.
  order('O4', [li('l8', 'Shirt', 2000, 'I-APP')], 1000, { state: 'open', discounts: { elements: [{ id: 'D8', name: '$10 off', amount: -1000 }] } }),
];
const EMPLOYEES = [{ id: 'E1', name: 'Pat Cashier' }, { id: 'E2', name: 'Morgan Manager' }];
let orders = BASE, credits = [];
globalThis.fetch = async (u) => {
  const s = String(u);
  const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  if (!s.startsWith('https://api.clover.com/v3/merchants/M1/')) return J({ elements: [] });
  const url = new URL(s);
  const first = (url.searchParams.get('offset') || '0') === '0';
  const filters = url.searchParams.getAll('filter');
  const since = Number((filters.find(f => f.startsWith('createdTime>=')) || '').split('>=')[1] || 0);
  const until = Number((filters.find(f => f.startsWith('createdTime<')) || '').split('<')[1] || Infinity);
  const inWindow = (x) => x.createdTime >= since && x.createdTime < until;
  if (url.pathname.endsWith('/orders')) return J({ elements: first ? orders.filter(inWindow) : [] });
  if (url.pathname.endsWith('/employees')) return J({ elements: first ? EMPLOYEES : [] });
  if (url.pathname.endsWith('/credits')) return J({ elements: first ? credits.filter(inWindow) : [] });
  return J({ elements: [] });
};
const snapshotDay = (date = D) => fetchW(req(`/?action=items-snapshot&store=BL1&date=${date}`, { method: 'POST', secret: env.SNAPSHOT_SECRET }));
const dayRow = (date = D) => db.prepare('SELECT * FROM discount_days WHERE store = ? AND date = ?').get('BL1', date);
const lines = (date = D) => db.prepare('SELECT * FROM discount_lines WHERE store = ? AND date = ? ORDER BY app_id, l2, l3').all('BL1', date);
const snapOf = async (date = D) => JSON.parse(await env.SALES_SNAPSHOTS.get(`items:bl1:${date}`));

// ── 1. A snapshot writes the record, and it adds up ─────────────────────────
{
  const r = await snapshotDay();
  eq([r.status, (await r.json()).results?.BL1?.ok], [200, true], 'items-snapshot runs');
  const snap = await snapOf(), day = dayRow(), rows = lines();
  // O1 350 + O2 (100 + 250 + 248) + O3 33 = 981; O3's refund line and O4 (open) add nothing.
  eq(snap.totals.discounts, -9.81, 'control: the Retail Summary books $9.81 of discounts for the day');
  eq([day?.total_cents, day?.expected_cents, day?.complete, day?.apps, day?.source], [981, 981, 1, 6, 'snapshot'],
    'the ledger: $9.81 across 6 discounts, matching the snapshot, complete');
  eq(rows.reduce((s, x) => s + x.value_cents, 0), 981, 'the rows sum to it');
  for (const c of snap.categories) {
    const cents = rows.filter(x => x.l2 === c.category).reduce((s, x) => s + x.value_cents, 0);
    eq(cents, Math.round(-c.discounts * 100), `and per category: ${c.category}`);
  }
  const by = (app) => rows.filter(x => x.app_id === app);
  eq(by('D1').map(x => [x.l2, x.l3, x.value_cents, x.lines, x.level]),
    [['Consumable Food', 'FG BL CONSUMABLES - FOOD - CANDY', 100, 1, 'order'], ['Softline - Apparel', 'FG BL SOFTLINES - APPAREL', 250, 2, 'order']],
    'an order discount: split by line, summed per L3 (the shirt and socks share a row)');
  eq([by('D1')[0].name, by('D1')[0].percentage, by('D1')[0].button_id, by('D1')[0].employee, by('D1')[0].approver],
    ['Halloween 10%', 10, 'B-HAL', 'Pat Cashier', 'Morgan Manager'], 'with its name, percent, button, who rang it and who approved it');
  eq(by('D3').map(x => [x.level, x.line_id, x.line_name, x.item_id, x.value_cents, x.percentage, x.employee]),
    [['item', 'l5', 'Jacket', 'I-APP', 250, 25, 'Morgan Manager']], 'a line discount: its line, item and the employee on the order');
  eq(by('D2').map(x => [x.l2, x.fixed_cents, x.value_cents]), [['Bin Products', 100, 100]], 'a flat $1 off, on a bin');
  eq([by('D4').reduce((s, x) => s + x.value_cents, 0), by('D5').reduce((s, x) => s + x.value_cents, 0)], [199, 49],
    'two order discounts share each line\'s portion by size, the last taking the remainder: $1.99 + $0.49 = the $2.48 booked');
  eq(by('D6').map(x => x.value_cents), [33], 'a weighed line: 10% of 0.333 lb at $9.99, rounded as the Retail Summary rounds it');
  eq([by('D7').length, by('D8').length], [0, 0], 'nothing from a refund line or an order that never locked');
  ok(rows.every(x => x.snapshot_time === snap.snapshotTime), 'stamped with the snapshot\'s own snapshotTime');
}

// ── 2. An old day cannot be thinned; it can grow ────────────────────────────
{
  orders = BASE.filter(o => o.id !== 'O2');
  await snapshotDay();
  eq([dayRow().apps, dayRow().total_cents, lines().length], [6, 981, 9], 'an old day re-read with one order fewer keeps its record');
  orders = [...BASE, order('O5', [li('l9', 'Shirt', 2000, 'I-APP', { discounts: { elements: [{ id: 'D9', name: '$5 off', amount: -500 }] } })], 1500)];
  await snapshotDay();
  eq([dayRow().apps, dayRow().total_cents, dayRow().complete], [7, 1481, 1], 'a fuller one replaces it');
  orders = BASE;
}

// ── 3. A young day follows Clover down (a void really takes its discount) ───
{
  const Y = todayET, TY = Date.now() - 60e3;
  const young = [order('Y1', [li('y1', 'Shirt', 2000, 'I-APP', { discounts: { elements: [{ id: 'DY1', name: '$5 off', amount: -500 }] } })], 1500, { createdTime: TY, clientCreatedTime: TY }),
                 order('Y2', [li('y2', 'Shirt', 2000, 'I-APP', { discounts: { elements: [{ id: 'DY2', name: '$5 off', amount: -500 }] } })], 1500, { createdTime: TY, clientCreatedTime: TY })];
  orders = young;
  await snapshotDay(Y);
  eq(dayRow(Y)?.apps, 2, 'today: two discounts');
  orders = young.slice(0, 1);
  await snapshotDay(Y);
  eq([dayRow(Y)?.apps, lines(Y).length], [1, 1], 'one voided: today\'s record shrinks with it');
  orders = BASE;
  db.exec(`DELETE FROM discount_lines WHERE date = '${Y}'; DELETE FROM discount_days WHERE date = '${Y}';`);
}

// ── 4. A failing record never costs the day its snapshot ────────────────────
{
  const realPrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => (/discount_days/.test(sql) ? { bind: () => ({ first: async () => { throw new Error('D1_ERROR: network'); } }) } : realPrepare(sql));
  const warn = console.warn, logs = [];
  console.warn = (...a) => logs.push(a.join(' '));
  try {
    const r = await snapshotDay();
    eq((await r.json()).results?.BL1?.ok, true, 'with the record failing, the snapshot still succeeds');
  } finally { env.DB.prepare = realPrepare; console.warn = warn; }
  ok(logs.some(l => l.includes('[discounts] bank failed')), 'and the failure is logged');
}

// ── 5. The backfill: dry by default, writes only its own tables, guarded ────
const bank = (q, user = 'u-su', method = 'POST') => fetchW(req(`/?action=bank-discounts&store=BL1&start=${D}&end=${D}${q}`, { user, method }));
{
  db.exec('DELETE FROM discount_lines; DELETE FROM discount_days;');
  const kvBefore = await env.SALES_SNAPSHOTS.get(`items:bl1:${D}`);
  const idlBefore = JSON.stringify(db.prepare('SELECT * FROM item_day_lines').all());
  const dsBefore = JSON.stringify(db.prepare('SELECT * FROM daily_sales').all());

  const dry = await (await bank('')).json();
  eq([dry.dry, dry.report[0]?.skipped, dry.report[0]?.totalCents, dry.report[0]?.complete, dry.report[0]?.apps], [true, 'DRY_RUN', 981, 1, 6],
    'with no dry=0 it is a dry run, and reports what it would write');
  eq(db.prepare('SELECT COUNT(*) n FROM discount_days').get().n, 0, 'and writes nothing');

  const wet = await (await bank('&dry=0')).json();
  eq([wet.wrote, dayRow()?.total_cents, dayRow()?.complete, dayRow()?.source, wet.needsAttention.length], [1, 981, 1, 'backfill', 0],
    'dry=0 writes the day, reconciled with the stored snapshot');
  eq(lines().find(x => x.app_id === 'D1')?.employee, 'Pat Cashier', 'names resolved at write time');
  eq([await env.SALES_SNAPSHOTS.get(`items:bl1:${D}`), JSON.stringify(db.prepare('SELECT * FROM item_day_lines').all()), JSON.stringify(db.prepare('SELECT * FROM daily_sales').all())],
    [kvBefore, idlBefore, dsBefore], 'the snapshot, item record and daily_sales are untouched');

  orders = BASE.filter(o => o.id !== 'O1');   // Clover thinning the day out
  const thin = await (await bank('&dry=0')).json();
  eq([thin.report[0]?.skipped, dayRow()?.apps], ['WOULD_LOSE_ROWS', 6], 'a thinner re-read is refused');
  eq(thin.needsAttention.map(x => x.skipped), ['WOULD_LOSE_ROWS'], 'and named');
  const forced = await (await bank('&dry=0&force=1')).json();
  eq([forced.report[0]?.wrote, dayRow()?.apps, dayRow()?.complete, /record 6\.31 vs snapshot 9\.81/.test(dayRow()?.note || '')], [true, 5, 0, true],
    'force=1 writes it, held incomplete with the gap stated');
  orders = BASE;
  await bank('&dry=0');
  eq([dayRow()?.apps, dayRow()?.complete], [6, 1], 'and the full day replaces it');

  eq((await bank('&dry=0', 'u-admin')).status, 403, 'an admin cannot run it: superuser only');
  const wide = await fetchW(req(`/?action=bank-discounts&store=ALL&start=2026-09-01&end=2026-10-31`, { user: 'u-su', method: 'POST' }));
  eq([wide.status, (await wide.json()).code], [413, 'BUDGET_EXCEEDED'], 'an over-wide run is refused, not truncated');
  const closed = await (await fetchW(req(`/?action=bank-discounts&store=BL8&start=${D}&end=${D}`, { user: 'u-su', method: 'POST' }))).json();
  eq(closed.report[0]?.skipped, 'CLOSED', 'a closed store is skipped');
}

// ── 6. The discounts read ───────────────────────────────────────────────────
const read = (q, user = 'u-su') => fetchW(req(`/?action=discounts&from=${D}&to=${D}${q}`, { user }));
{
  const save = await fetchW(req('/?action=discount-classes', { user: 'u-admin', method: 'POST', body: { classes: [
    { name: 'Halloween 10%', class: 'planned' }, { name: ' $1  OFF ', class: 'manual' }, { name: '$2 off', class: 'manual' },
  ] } }));
  eq([save.status, (await save.json()).saved], [200, 3], 'an admin sets classes, by name (spacing and case do not matter)');
  eq((await fetchW(req('/?action=discount-classes', { user: 'u-mgr1', method: 'POST', body: { name: '$5 off', class: 'manual' } }))).status, 403,
    'a manager cannot');

  const seen = recordStatements(env);
  const b = await (await read('')).json();
  eq(nestedScans(db, seen), [], 'the discounts query plans: no nested full scans');
  const snap = await snapOf();
  const grossRetail = snap.categories.filter(c => c.category !== 'Bin Products').reduce((s, c) => s + Math.round(c.gross * 100), 0);
  eq([b.totals.discounts, b.totals.applications, b.totals.discountedOrders, b.totals.itemLevel, b.totals.orderLevel],
    [9.81, 6, 3, 3.83, 5.98], 'totals: $9.81, 6 uses on 3 orders; $3.83 on lines, $5.98 on orders');
  eq([b.totals.planned, b.totals.manual, b.totals.unclassified], [3.5, 2.99, 3.32], 'planned $3.50, manual $1 + $1.99, the rest unclassified');
  eq([b.totals.onBins, b.totals.grossRetail, b.totals.pctOfGrossRetail], [1.52, grossRetail / 100, Math.round((981 - 152) / grossRetail * 10000) / 100],
    'share of gross retail leaves the bins out: their $1 line discount and their $0.52 of the order discounts');
  // A day before the record began has a snapshot (sales) but no discounts recorded: it must
  // not dilute the share.
  await env.SALES_SNAPSHOTS.put('items:bl1:2026-10-13', JSON.stringify({ categories: [{ category: 'Home', gross: 5000 }] }));
  const wider = await (await fetchW(req(`/?action=discounts&from=2026-10-13&to=${D}`, { user: 'u-su' }))).json();
  eq([wider.totals.grossRetail, wider.totals.pctOfGrossRetail], [b.totals.grossRetail, b.totals.pctOfGrossRetail],
    'a range reaching before the record: the share counts only days the record holds');
  eq(b.byButton.slice(0, 2).map(x => [x.name, x.class, x.discounts, x.applications]), [['Halloween 10%', 'planned', 3.5, 1], ['Apparel 25%', 'unclassified', 2.5, 1]],
    'buttons by dollars, with their class');
  eq(b.byButton.find(x => x.name === '$2 off')?.amount, 2, 'a flat button says its amount');
  eq(b.byEmployee.map(x => [x.employee, x.discounts]), [['Morgan Manager', 5.98], ['Pat Cashier', 3.83]], 'by the employee on the order');
  eq([b.byDay.length, b.byWeek[0]?.weekEnding, b.byMonth[0]?.month], [1, '2026-10-17', '2026-10'], 'by day, week (ending Saturday) and month');
  eq(b.largest.slice(0, 2).map(x => [x.name, x.discount]), [['Halloween 10%', 2.5], ['Apparel 25%', 2.5]], 'the largest rows first, ties in a fixed order');
  eq([b.coverage.storeDays, b.coverage.complete], [1, 1], 'coverage: one store-day, complete');

  const manual = await (await read('&class=manual')).json();
  eq([manual.totals.discounts, manual.byButton.map(x => x.name).sort()], [2.99, ['$1 off', '$2 off']], 'class=manual narrows every table');
  const cat = await (await read('&category=Softline%20-%20Apparel')).json();
  eq(cat.totals.discounts, 6.96, 'a category filter (apparel: $2.50 + $2.50 + the jacket\'s $1.96 of the O2 order discounts)');
  eq((await (await read('&employee=Pat%20Cashier')).json()).totals.discounts, 3.83, 'an employee filter');
  eq((await (await read('&search=hallo')).json()).totals.discounts, 3.5, 'a name search');
  eq((await (await read('&level=item')).json()).totals.discounts, 3.83, 'a level filter');
  eq((await read('&class=nope')).status, 400, 'a bad class is refused');

  eq((await read('&store=BL1', 'u-mgr1')).status, 200, 'a BL1 manager reads BL1');
  eq((await read('&store=BL4', 'u-mgr1')).status, 403, 'but not BL4');
  eq((await (await read('', 'u-mgr1')).json()).stores, ['BL1'], 'and with no store, only their own');
  eq((await read('', 'u-staff')).status, 403, 'staff see no money');

  const classes = await (await fetchW(req(`/?action=discount-classes&from=${D}&to=${D}`, { user: 'u-mgr1' }))).json();
  eq(classes.seen.map(x => [x.name, x.class]).slice(0, 3), [['Halloween 10%', 'planned'], ['Apparel 25%', 'unclassified'], ['$2 off', 'manual']],
    'discount-classes lists every name rung, by dollars, with its class');
  await fetchW(req('/?action=discount-classes', { user: 'u-admin', method: 'POST', body: { name: '$2 off', class: null } }));
  eq((await (await read('&class=manual')).json()).totals.discounts, 1, 'class null puts a name back to unclassified');
}

// ── 7. Returns ──────────────────────────────────────────────────────────────
{
  const R = (id, date, kind, amount, extra = {}) => db.prepare(`INSERT INTO payment_archive (id, store, date, kind, order_id, ts, amount, tax, employee, reason, refund_of, banked_at)
    VALUES (?, 'BL1', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'x')`).run(id, date, kind, extra.order ?? null, Date.parse(date + 'T16:00:00Z'), amount, extra.tax ?? 0,
      'employee' in extra ? extra.employee : 'Pat Cashier', extra.reason ?? null, extra.of ?? null);
  // A receipt line, banked when the nightly banks its day: 3 days after it (04:00 ET).
  const I = (date, order, seq, name, price, refunded, bankedAt) => db.prepare(`INSERT INTO payment_archive_items (store, date, order_id, seq, name, qty, price, refunded, banked_at)
    VALUES ('BL1', ?, ?, ?, ?, 1, ?, ?, ?)`).run(date, order, seq, name, price, refunded, bankedAt);
  const SALE_BANKED = '2026-10-23T08:00:00.000Z';
  R('P1', '2026-10-20', 'payment', 60, { order: 'S1' }); I('2026-10-20', 'S1', 0, 'Lamp', 40, 1, SALE_BANKED); I('2026-10-20', 'S1', 1, 'Mug', 20, 0, SALE_BANKED);
  R('P2', '2026-10-20', 'payment', 150, { order: 'S2' }); I('2026-10-20', 'S2', 0, 'Rug', 150, 0, SALE_BANKED);
  // Before the 10-20 receipts were banked: a refund of the lamp (its line is marked) and an
  // amount-only $150 refund (no line marked). After: the mug comes back on 10-24, which the
  // banked receipt can never show. And a refund of a sale older than the archive.
  R('RF1', '2026-10-22', 'refund', -40, { order: 'S1', of: 'P1', reason: 'Returned goods' });
  R('RF2', '2026-10-22', 'refund', -150, { order: 'S2', of: 'P2', reason: 'Damaged goods' });
  R('RF3', '2026-10-23', 'refund', -12, { order: 'S-OLD', of: 'P-OLD' });
  R('RF4', '2026-10-24', 'refund', -20, { order: 'S1', of: 'P1' });
  // Manual refunds by Sam: Mon 10-19 and Tue 10-20 (before the range), Fri 10-23 — three in the
  // week of Sun 10-18..Sat 10-24. Sam's third has a note typed on its ticket; Pat's two have
  // Clover's bare "Manual Transaction" line or nothing. Three with no employee at all, which
  // must not add up to a "3+" for nobody.
  R('M1', '2026-10-19', 'manual', -5, { order: 'C1', employee: 'Sam' });
  R('M2', '2026-10-20', 'manual', -6, { order: 'C2', employee: 'Sam' });
  R('M3', '2026-10-23', 'manual', -120, { order: 'C3', employee: 'Sam' }); I('2026-10-23', 'C3', 0, 'return fridge', -120, 0, 'x');
  R('M4', '2026-10-24', 'manual', -7, { order: 'C4' });
  R('M5', '2026-10-24', 'manual', -3, { order: 'C5' }); I('2026-10-24', 'C5', 0, 'Manual Transaction', -3, 0, 'x');
  R('M6', '2026-10-21', 'manual', -1, { order: 'C6', employee: null });
  R('M7', '2026-10-22', 'manual', -1, { order: 'C7', employee: null });
  R('M8', '2026-10-23', 'manual', -1, { order: 'C8', employee: null });
  const day = db.prepare(`INSERT INTO payment_archive_days (store, date, rows, payments, gross, net, expected_net, complete, note, banked_at) VALUES ('BL1', ?, 1, 1, 500, 450, 450, 1, NULL, 'x')`);
  for (const d of ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']) day.run(d);

  const ret = (q, user = 'u-su') => fetchW(req(`/?action=returns&from=2026-10-21&to=2026-10-24${q}`, { user }));
  const seen = recordStatements(env);
  const b = await (await ret('&store=BL1')).json();
  eq(nestedScans(db, seen), [], 'the returns query plan: no full scan in a correlated subquery');
  const row = (id) => b.rows.find(x => x.id === id);
  eq(b.rows.map(x => x.id), ['RF4', 'M5', 'M4', 'RF3', 'M8', 'M3', 'RF2', 'RF1', 'M7', 'M6'], 'the range\'s refunds, newest first, ties by id (M1, M2 are before it)');
  eq([row('RF1').kind, row('RF1').amount, row('RF1').items, row('RF1').itemsChecked, row('RF1').flags], ['payment refund', 40, 'Lamp $40.00', true, []],
    'a refund of a marked line: its item, no flags');
  eq(row('RF2').flags, ['no item recorded', 'over $100'], 'an amount-only $150 refund before the receipt was banked: no item, over $100');
  eq([row('RF4').itemsChecked, row('RF4').flags, row('RF4').saleReceipt], [false, [], 'Lamp $40.00; Mug $20.00'],
    'a return after the receipt was banked cannot be checked: not flagged, and the sale\'s receipt is listed instead');
  eq([row('RF3').saleInArchive, row('RF3').flags], [false, []], 'a sale older than the archive is not "no item"');
  eq([row('M3').items, row('M3').flags], ['return fridge $-120.00', ['over $100', '3+ manual refunds that week']],
    'Sam\'s note is the manual refund\'s item; his third of the week counts across the range edge');
  eq([row('M5').items, row('M5').flags, row('M4').flags], ['Manual Transaction $-3.00', ['no item recorded'], ['no item recorded']],
    'Clover\'s bare "Manual Transaction", or no line at all: no item recorded');
  eq([row('M8').flags], [['no item recorded']], 'three manual refunds with no employee are not anybody\'s 3+');
  eq(b.repeatEmployees, [{ store: 'BL1', employee: 'Sam', weekStart: '2026-10-18', weekEnding: '2026-10-24', manualRefunds: 3 }], 'repeat employees: Sam only');
  eq([b.totals.paymentRefunds, b.totals.manualRefunds, b.totals.total, b.totals.payments, b.totals.ratePct],
    [{ count: 4, amount: 222 }, { count: 6, amount: 133 }, 355, 2000, 17.75], 'totals and the rate against the till\'s payments');
  eq((await (await ret('&store=BL1&filter=flagged')).json()).rows.map(x => x.id), ['M5', 'M4', 'M8', 'M3', 'RF2', 'M7', 'M6'], 'filter=flagged');
  eq((await (await ret('&store=BL1&kind=manual')).json()).rows.map(x => x.id), ['M5', 'M4', 'M8', 'M3', 'M7', 'M6'], 'kind=manual');
  eq((await (await ret('&store=BL1&employee=Sam')).json()).byEmployee.map(x => [x.employee, x.manualRefunds]), [['Sam', 1]], 'an employee filter');
  eq((await (await ret('&store=BL1&employee=(unknown)')).json()).rows.map(x => x.id), ['M8', 'M7', 'M6'], 'and "(unknown)" finds the ones with none');
  eq((await ret('&store=BL4', 'u-mgr1')).status, 403, 'a BL1 manager cannot read BL4');
  eq((await ret('', 'u-staff')).status, 403, 'staff see no money');
}

// ── 8. A manual refund's reason is banked now ───────────────────────────────
{
  db.prepare("INSERT OR REPLACE INTO daily_sales (store, date, total, order_count) VALUES ('BL1', ?, 41.6, 3)").run(D);
  credits = [{ id: 'CR1', amount: 500, taxAmount: 0, result: 'SUCCESS', createdTime: T + 3600e3, reason: 'Damaged goods', orderRef: { id: 'C9' } }];
  const r = await fetchW(req(`/?action=bank-transactions&store=BL1&start=${D}&end=${D}&dry=0`, { user: 'u-su', method: 'POST' }));
  eq(r.status, 200, 'bank-transactions runs');
  eq(db.prepare("SELECT reason FROM payment_archive WHERE id = 'CR1'").get()?.reason, 'Damaged goods', 'the credit\'s reason is kept');
  credits = [];
}

// ── 9. A big day that fails partway is never left vouched for ──────────────
{
  const P = '2026-10-10', TP = Date.parse(`${P}T15:00:00Z`);
  const big = order('OB', Array.from({ length: 120 }, (_, i) => li('b' + i, 'Shirt', 1000, 'I-APP',
    { discounts: { elements: [{ id: 'DB' + i, name: '$1 off', amount: -100 }] } })), 0, { createdTime: TP, clientCreatedTime: TP });
  big.payments.elements[0].amount = 108000; big.total = 108000;
  orders = [big];
  await snapshotDay(P);
  eq([dayRow(P)?.apps, dayRow(P)?.complete], [120, 1], 'a 120-discount day: written whole across two batches');
  const realBatch = env.DB.batch.bind(env.DB), realPrepare = env.DB.prepare.bind(env.DB);
  let calls = 0;
  env.DB.batch = async (st) => { if (++calls === 2) throw new Error('D1_ERROR: network'); return realBatch(st); };
  // ...and the failure path's own ledger write fails too.
  env.DB.prepare = (sql) => {
    const st = realPrepare(sql);
    if (!/^\s*INSERT OR REPLACE INTO discount_days/.test(sql)) return st;
    return { ...st, bind: (...a) => { const b = st.bind(...a); const run = b.run; b.inBatch = () => run(); b.run = async () => { throw new Error('D1_ERROR: network'); }; return b; } };
  };
  const warn = console.warn; console.warn = () => {};
  try { await snapshotDay(P); } finally { env.DB.batch = realBatch; env.DB.prepare = realPrepare; console.warn = warn; }
  eq([dayRow(P)?.complete, dayRow(P)?.note], [0, 'being written'], 'the first batch marked it incomplete, so the old "complete" cannot stand over half a day');
  await snapshotDay(P);
  eq([dayRow(P)?.apps, dayRow(P)?.complete, lines(P).length], [120, 1, 120], 'and the next run writes it whole again');
  orders = BASE;
}

// ── 10. Edges: BL16 before its handover; a discount with no employee ────────
{
  const r = await (await fetchW(req('/?action=bank-discounts&store=BL16&start=2026-06-01&end=2026-06-01', { user: 'u-su', method: 'POST' }))).json();
  eq(r.report[0]?.skipped, 'BEFORE_STORE_CUTOVER', 'BL16 before 2026-06-14 is Wyoming\'s account: skipped');
  const U = '2026-10-05';
  db.prepare(`INSERT INTO discount_lines (store, date, app_id, l2, l3, level, order_id, ts, button_id, name, name_key, percentage, fixed_cents,
    value_cents, lines, line_id, line_name, item_id, employee_id, employee, approver_id, approver, snapshot_time)
    VALUES ('BL1', ?, 'DU', 'Home', 'FG BL HOME - DECOR', 'order', 'OU', NULL, NULL, '$3 off', '$3 off', NULL, 300, 300, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 't')`).run(U);
  db.prepare(`INSERT INTO discount_days (store, date, snapshot_time, apps, rows, total_cents, expected_cents, complete, note, source) VALUES ('BL1', ?, 't', 1, 1, 300, 300, 1, NULL, 'backfill')`).run(U);
  const u = await (await fetchW(req(`/?action=discounts&from=${U}&to=${U}`, { user: 'u-su' }))).json();
  eq(u.byEmployee.map(x => [x.employee, x.discounts]), [['(unknown)', 3]], 'a discount with no employee on its order reads as (unknown)');
  eq((await (await fetchW(req(`/?action=discounts&from=${U}&to=${U}&employee=(unknown)`, { user: 'u-su' }))).json()).totals.discounts, 3,
    'and filtering by (unknown) finds it');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
