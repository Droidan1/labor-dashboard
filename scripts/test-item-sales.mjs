// ?action=item-sales and the get_item_sales tool: units and sales per ITEM from the
// receipt archive (payment_archive_items), before anything is rolled into L2/L3.
//
// WHAT THIS PROTECTS. Brian (2026-10-16): "pull inventory numbers before it goes to L2
// and L3 categories". The archive is the only per-line record with history (banked since
// 2026-06-18), but it banks EVERY order Clover returns: a voided ticket and a ticket that
// was never paid keep their lines. Summed naively, they are sales that did not happen.
// Only orders with a real payment count, refunds are kept apart (never netted silently,
// as Opportunity Buys counts them), and the answer says which days are missing or short.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadWorker, makeEnv, ctx, blockNetwork, stubWorkersRuntime, applyMigrationAlters, req, recordStatements, nestedScans } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const UP = 'test-briefing-key', MCP = 'test-mcp-key';
const main = await loadWorker(repo);
const { db, env: mainEnv } = makeEnv(repo);
mainEnv.MORNING_BRIEFING_KEY = UP;
for (const m of ['063', '064']) db.exec(fs.readFileSync(path.join(repo, `migration-${m}.sql`), 'utf8'));
applyMigrationAlters(db, repo); // payment_archive_items.code (migration-072)
blockNetwork();

// ── Seed: three days at BL1, one at BL2 ────────────────────────────────────
const SNACK = 'BL-50038-1_5', CLEAN = 'BL-50040-4';
const pay = db.prepare(`INSERT INTO payment_archive (id, store, date, kind, order_id, amount, banked_at) VALUES (?,?,?,?,?,?,'2026-10-06T08:00:00Z')`);
const line = db.prepare(`INSERT INTO payment_archive_items (store, date, order_id, seq, name, qty, price, refunded, code, banked_at) VALUES (?,?,?,?,?,?,?,?,?,'2026-10-06T08:00:00Z')`);
const day = db.prepare(`INSERT INTO payment_archive_days (store, date, rows, payments, gross, net, expected_net, complete, note, banked_at) VALUES (?,?,1,1,0,0,0,?,?,'2026-10-06T08:00:00Z')`);
// O1 paid in TWO payments (split tender), 3 snacks + 1 cleaner: its lines count once
pay.run('P1', 'BL1', '2026-10-01', 'payment', 'O1', 10);
pay.run('P1b', 'BL1', '2026-10-01', 'payment', 'O1', 3.5);
line.run('BL1', '2026-10-01', 'O1', 0, 'FG BL CONSUMABLES - FOOD - SNACKS', 3, 4.5, 0, SNACK);
line.run('BL1', '2026-10-01', 'O1', 1, 'FG BL CLEANING', 1, 9.0, 0, CLEAN);   // sells for more than the snacks, so sorting by sales is visible
// O2 paid: 2 snacks sold, 1 snack refunded (its line flagged)
pay.run('P2', 'BL1', '2026-10-02', 'payment', 'O2', 4.5);
pay.run('R2', 'BL1', '2026-10-02', 'refund', 'O2', -1.5);
line.run('BL1', '2026-10-02', 'O2', 0, 'FG BL CONSUMABLES - FOOD - SNACKS', 2, 3.0, 0, SNACK);
line.run('BL1', '2026-10-02', 'O2', 1, 'FG BL CONSUMABLES - FOOD - SNACKS', 1, 1.5, 1, SNACK);
// O3 VOIDED: its lines were banked, it never sold
pay.run('V3', 'BL1', '2026-10-02', 'void', 'O3', 15);
line.run('BL1', '2026-10-02', 'O3', 0, 'FG BL CONSUMABLES - FOOD - SNACKS', 10, 15, 0, SNACK);
// O4 NEVER PAID: lines, no payment row at all
line.run('BL1', '2026-10-03', 'O4', 0, 'FG BL CLEANING', 5, 20, 0, CLEAN);
// O5 paid, a custom line from before codes were captured
pay.run('P5', 'BL1', '2026-10-03', 'payment', 'O5', 12.34);
line.run('BL1', '2026-10-03', 'O5', 0, 'Custom Item', 1, 12.34, 0, null);
// …and a snack RETURNED on the same ticket, rung as a negative line: a refund, not a sale
line.run('BL1', '2026-10-03', 'O5', 1, 'FG BL CONSUMABLES - FOOD - SNACKS', 1, -1.5, 0, SNACK);
// O6 paid at BL2
pay.run('P6', 'BL2', '2026-10-01', 'payment', 'O6', 6);
line.run('BL2', '2026-10-01', 'O6', 0, 'FG BL CONSUMABLES - FOOD - SNACKS', 4, 6.0, 0, SNACK);
// Weighed goods: fractions that only add up after rounding to the cent
for (const o of ['O7a', 'O7b', 'O7c']) { pay.run('P' + o, 'BL2', '2026-10-01', 'payment', o, 1.111); line.run('BL2', '2026-10-01', o, 0, 'Bulk nuts', 0.333, 1.111, 0, 'BL-FRAC'); }
// Either side of the week of 10-01..10-03 (Thu-Sat), for the period buckets: a Wednesday the
// month before and the Sunday that starts the next week
pay.run('P9', 'BL1', '2026-09-30', 'payment', 'O9', 1.5);
line.run('BL1', '2026-09-30', 'O9', 0, 'FG BL CONSUMABLES - FOOD - SNACKS', 1, 1.5, 0, SNACK);
pay.run('P8', 'BL1', '2026-10-04', 'payment', 'O8', 4);
line.run('BL1', '2026-10-04', 'O8', 0, 'FG BL CONSUMABLES - FOOD - SNACKS', 2, 4.0, 0, SNACK);   // marked up to $2
day.run('BL1', '2026-10-01', 1, null);
day.run('BL1', '2026-10-02', 0, 'net off by 6%');
day.run('BL1', '2026-10-03', 1, null);
day.run('BL2', '2026-10-01', 1, null);
day.run('BL2', '2026-10-03', 1, null);   // banked with a payment but NO lines (the item write failed)

const keyed = async (q) => { const r = await main.fetch(new Request('https://api.retjghub.com/' + q, { headers: { 'X-API-Key': UP } }), mainEnv, ctx); return { status: r.status, body: await r.json().catch(() => null) }; };
const asUser = async (q, user) => { const r = await main.fetch(req('/' + q, { user }), mainEnv, ctx); return { status: r.status, body: await r.json().catch(() => null) }; };
const find = (b, store, code, name) => b?.items?.find(i => i.store === store && i.code === code && (name == null || i.name === name));

// ── The endpoint ───────────────────────────────────────────────────────────
{
  const { status, body: b } = await keyed('?action=item-sales&store=BL1&from=2026-10-01&to=2026-10-03');
  eq(status, 200, 'the key reads item-sales');
  const snack = find(b, 'BL1', SNACK);
  eq([snack?.units, snack?.sales, snack?.refundedUnits, snack?.refundedSales, snack?.orders, snack?.firstDate, snack?.lastDate],
    [5, 7.5, 2, 3, 3, '2026-10-01', '2026-10-03'], 'snacks: 5 sold for $7.50 (split tender counted once); 2 back for $3 — the flagged line AND the negative return line');
  eq([find(b, 'BL1', CLEAN)?.units, find(b, 'BL1', CLEAN)?.sales], [1, 9], 'the cleaner: the PAID one only, not the 5 on a never-paid ticket');
  eq(find(b, 'BL1', '', 'Custom Item')?.sales, 12.34, 'a line with no code is kept, by its name');
  eq([b?.excluded?.lines, b?.excluded?.sales], [2, 35], 'the voided and never-paid tickets are excluded, and counted as such');
  ok(!b?.items?.some(i => i.store === 'BL2'), 'store=BL1: BL1 only');
  eq([b?.coverage?.daysBanked, b?.coverage?.incomplete?.map(d => d.date), b?.coverage?.linesWithoutCode], [3, ['2026-10-02'], 1],
    'coverage: 3 days banked, one incomplete, one line without a code');
  const all = (await keyed('?action=item-sales&from=2026-10-01&to=2026-10-03')).body;
  eq([find(all, 'BL2', SNACK)?.units, all?.stores?.length], [4, 6], 'no store: every store');
  eq(all?.coverage?.missing?.find(m => m.store === 'BL2')?.dates, ['2026-10-02'], 'BL2 names the one day never banked');
  eq(all?.coverage?.daysWithoutLines, [{ store: 'BL2', date: '2026-10-03' }], 'and the day banked with payments but no lines');
  ok(!all?.coverage?.missing?.some(m => m.store === 'BL8'), 'BL8 (closed 2026-07-25) is not reported as missing days');
  eq([find(all, 'BL2', 'BL-FRAC')?.units, find(all, 'BL2', 'BL-FRAC')?.sales], [1, 3.33], 'weighed goods add up to the cent (0.999 units, $3.33)');
  eq([b?.refundPayments?.refunds, b?.refundPayments?.manual], [{ amount: -1.5, count: 1 }, { amount: 0, count: 0 }], 'refunds as payments, to compare with the line refunds');
  const etToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const back = (n) => { const x = new Date(etToday + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };
  const recent = (await keyed(`?action=item-sales&store=BL1&from=${back(6)}&to=${etToday}`)).body;
  eq([recent?.coverage?.missing?.[0]?.days, recent?.coverage?.notYetBanked?.[0]?.days], [3, 4],
    'the last days are not banked YET (the nightly runs behind): not reported as missing');
}
{
  // The page rules for sessions: a manager reads their stores only; staff nothing.
  const mine = (await asUser('?action=item-sales&from=2026-10-01&to=2026-10-03', 'u-mgr1')).body;
  eq([...new Set(mine?.items?.map(i => i.store))], ['BL1'], 'a BL1 manager with no store gets BL1 only');
  eq((await asUser('?action=item-sales&store=BL2&from=2026-10-01&to=2026-10-03', 'u-mgr1')).status, 403, 'and cannot ask for BL2');
  eq((await asUser('?action=item-sales&store=BL1&from=2026-10-01&to=2026-10-03', 'u-staff')).status, 403, 'staff are refused');
  eq((await keyed('?action=item-sales&store=BL1&from=2026-10-01&to=2026-10-03')).body, (await asUser('?action=item-sales&store=BL1&from=2026-10-01&to=2026-10-03', 'u-su')).body,
    'the key answers exactly as a superuser does');
}
{
  // 🛑 The plan, not the clock: on D1 the old anti-join timed out (1101) at BL1 × 31 days.
  const seen = recordStatements(mainEnv);
  for (const g of ['', '&grain=d', '&grain=w', '&grain=m']) await keyed('?action=item-sales&from=2026-10-01&to=2026-10-03' + g);
  ok(seen.length >= 6, 'statements were recorded');
  // …and the guard itself: the query that timed out must be flagged.
  const timedOut = `WITH paid AS (SELECT DISTINCT store, date, order_id FROM payment_archive WHERE store IN (?) AND date BETWEEN ? AND ? AND kind = 'payment')
    SELECT COUNT(*) AS lines FROM payment_archive_items i LEFT JOIN paid p ON p.store = i.store AND p.date = i.date AND p.order_id = i.order_id
     WHERE i.store IN (?) AND i.date BETWEEN ? AND ? AND p.order_id IS NULL`;
  eq(nestedScans(db, [timedOut]).map(b => b.split(' in: ')[0]), ['SCAN p LEFT-JOIN'], 'the guard flags the anti-join that timed out on D1');
  eq(nestedScans(db, seen), [], 'no item-sales statement scans a whole table or CTE inside a loop');
}
{
  // grain: the same sums, split by day, by week ending Saturday, or by month.
  const q = '?action=item-sales&store=BL1&from=2026-09-30&to=2026-10-04';
  const rows = (b, code) => (b?.items || []).filter(i => i.code === code).map(i => [i.period, i.units, i.sales, i.refundedUnits, i.refundedSales, i.orders]);
  const w = (await keyed(q + '&grain=w')).body;
  eq(w?.grain, 'w', 'the answer says its grain');
  eq(rows(w, SNACK), [['2026-10-03', 6, 9, 2, 3, 4], ['2026-10-10', 2, 4, 0, 0, 1]],
    'by week: Wed 09-30 to Sat 10-03 is one week (ending 10-03); Sun 10-04 starts the next');
  const d = (await keyed(q + '&grain=d')).body;
  eq(rows(d, SNACK).map(r => r.slice(0, 4)), [['2026-09-30', 1, 1.5, 0], ['2026-10-01', 3, 4.5, 0], ['2026-10-02', 2, 3, 1], ['2026-10-03', 0, 0, 1], ['2026-10-04', 2, 4, 0]],
    'by day: one row per day sold or returned');
  const m = (await keyed(q + '&grain=m')).body;
  eq(rows(m, SNACK).map(r => r.slice(0, 3)), [['2026-09', 1, 1.5], ['2026-10', 7, 11.5]], 'by month');
  const t = (await keyed(q)).body;
  const total = find(t, 'BL1', SNACK);
  ok(total && !('period' in total) && t.grain == null, 'no grain: one row per item, no period');
  for (const [name, b] of [['day', d], ['week', w], ['month', m]]) {
    const sum = (k) => Math.round(b.items.filter(i => i.code === SNACK).reduce((s, i) => s + i[k], 0) * 100) / 100;
    eq([sum('units'), sum('sales'), sum('refundedUnits'), sum('refundedSales'), sum('orders')],
      [total.units, total.sales, total.refundedUnits, total.refundedSales, total.orders], `the ${name} rows add up to the total`);
    eq(b.excluded, t.excluded, `excluded is the same by ${name}`);
  }
  eq([w?.excluded?.lines, w?.excluded?.sales], [2, 35], 'excluded: the voided and never-paid tickets, whatever the grain');
  eq((await keyed(q + '&grain=x')).status, 400, 'an unknown grain → 400');
  eq((await keyed(q + '&grain=w')).body, (await asUser(q + '&grain=w', 'u-su')).body, 'by week, the key answers as a superuser does');
}
{
  // Ranges are bounded: one store up to 92 days, the chain up to 31.
  eq((await keyed('?action=item-sales&store=BL1&from=2026-07-01&to=2026-10-01')).status, 400, 'one store, 93 days → 400');
  eq((await keyed('?action=item-sales&store=BL1&from=2026-07-02&to=2026-10-01')).status, 200, 'one store, 92 days → 200');
  eq((await keyed('?action=item-sales&from=2026-09-01&to=2026-10-02')).status, 400, 'every store, 32 days → 400');
  eq((await keyed('?action=item-sales&from=2026-09-02&to=2026-10-02')).status, 200, 'every store, 31 days → 200');
  eq((await keyed('?action=item-sales&store=BL1&from=2026-10-03&to=2026-10-01')).status, 400, 'to before from → 400');
  eq((await keyed('?action=item-sales&store=BL1&from=2026-10-01')).status, 400, 'no to → 400');
  eq((await keyed('?action=item-sales&store=BL1&from=2026-02-30&to=2026-03-01')).status, 400, 'an impossible date → 400');
  eq((await keyed('?action=item-sales&store=BL99&from=2026-10-01&to=2026-10-01')).status, 400, 'an unknown store → 400');
  eq((await keyed('?action=item-sales&store=bl1&from=2026-10-01&to=2026-10-01')).status, 200, 'a lowercase store is accepted');
}

// ── The tool, through the MCP worker ───────────────────────────────────────
await stubWorkersRuntime();
const { default: mcp } = await import(pathToFileURL(path.join(repo, 'mcp', 'worker.mjs')).href);
const upstream = [];
const env = { MCP_KEY: MCP, REPORTING_API_KEY: UP,
  API: { fetch: async (r) => { upstream.push(new URL(r.url).searchParams); return main.fetch(r, mainEnv, ctx); } } };
let id = 1, lastText = '';
async function tool(name, args = {}) {
  const r = await mcp.fetch(new Request('https://mcp.retjghub.com/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + MCP },
    body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } }),
  }), env, ctx);
  const res = (await r.json()).result;
  lastText = res.content[0].text;
  return res.isError ? { isError: true, text: lastText } : JSON.parse(lastText);
}
{
  const n = upstream.length;
  const t = await tool('get_item_sales', { storeId: 'bl1', from: '2026-10-01', to: '2026-10-03' });
  eq([upstream[n].get('action'), upstream[n].get('store'), upstream[n].get('from'), upstream[n].get('to')], ['item-sales', 'BL1', '2026-10-01', '2026-10-03'], 'calls item-sales, store upper-cased');
  eq([t.totals?.items, t.totals?.units, t.totals?.sales, t.totals?.refundedSales], [3, 7, 28.84, 3], 'totals over every item');
  eq(t.rows?.map(r => r.name), ['Custom Item', 'FG BL CLEANING', 'FG BL CONSUMABLES - FOOD - SNACKS'], 'rows by sales, highest first (not the database\'s code order)');
  eq(t.rows?.find(r => r.code === SNACK)?.avgPrice, 1.5, 'with the average price per unit');
  eq([t.excluded?.lines, t.coverage?.incomplete?.length, t.refundPayments?.refunds?.amount], [2, 1, -1.5], 'and the exclusions, coverage and refund payments');
  const s = await tool('get_item_sales', { storeId: 'BL1', from: '2026-10-01', to: '2026-10-03', search: 'snack' });
  eq([s.matched, s.rows?.length, s.totals?.sales], [1, 1, 7.5], 'search narrows the rows and the totals to what matched');
  eq((await tool('get_item_sales', { storeId: 'BL1', from: '2026-10-01', to: '2026-10-03', search: '50040' })).rows?.[0]?.code, CLEAN, 'search matches the code too');
  eq((await tool('get_item_sales', { storeId: 'BL1', from: '2026-10-01', to: '2026-10-03', limit: 1 })).rows?.length, 1, 'limit');
  // bucket: one row per item, its periods inside, and totals per period.
  const m = upstream.length;
  const wk = await tool('get_item_sales', { storeId: 'BL1', from: '2026-09-30', to: '2026-10-04', bucket: 'week', search: 'snack' });
  eq(upstream[m].get('grain'), 'w', 'bucket week asks for grain=w');
  eq([wk.bucket, wk.matched, wk.rows?.length], ['week', 1, 1], 'one row for the item, not one per week');
  eq(wk.rows?.[0]?.periods?.map(p => [p.period, p.units, p.sales, p.orders, p.avgPrice]), [['2026-10-03', 6, 9, 4, 1.5], ['2026-10-10', 2, 4, 1, 2]], 'its weeks, oldest first, each with its average price');
  eq([wk.rows?.[0]?.units, wk.rows?.[0]?.sales, wk.rows?.[0]?.orders, wk.rows?.[0]?.firstDate, wk.rows?.[0]?.lastDate, wk.rows?.[0]?.avgPrice], [8, 13, 5, '2026-09-30', '2026-10-04', 1.63], 'and its totals over the range');
  eq(wk.totals?.byPeriod, { '2026-10-03': { units: 6, sales: 9 }, '2026-10-10': { units: 2, sales: 4 } }, 'totals per week over what matched');
  const chain = await tool('get_item_sales', { from: '2026-10-01', to: '2026-10-03', bucket: 'day', search: 'snack' });
  eq(chain.rows?.map(r => r.store).sort(), ['BL1', 'BL2'], 'every store: one row per store');
  eq(chain.totals?.byPeriod?.['2026-10-01'], { units: 7, sales: 10.5 }, 'and the day totals add the stores');
  const days = await tool('get_item_sales', { storeId: 'BL1', from: '2026-10-01', to: '2026-10-04', bucket: 'day' });
  eq(Object.keys(days.totals?.byPeriod || {}), ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'], 'totals by period run oldest first, though the first item listed sold only on 10-03');
  const n2 = upstream.length;
  const plain = await tool('get_item_sales', { storeId: 'BL1', from: '2026-10-01', to: '2026-10-03', bucket: 'total' });
  ok(!upstream[n2].has('grain') && !plain.rows?.[0]?.periods && plain.totals?.byPeriod == null, 'bucket total = no grain, no periods');
  const before = upstream.length;
  ok((await tool('get_item_sales', { from: '2026-09-01', to: '2026-10-02' })).isError && upstream.length === before, 'a chain range over 31 days is refused before any call');
  ok((await tool('get_item_sales', { storeId: 'BL1', from: '2026-10-01' })).isError, 'from and to are required');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
