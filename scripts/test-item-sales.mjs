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
import { loadWorker, makeEnv, ctx, blockNetwork, stubWorkersRuntime, applyMigrationAlters, req } from './lib/worker-harness.mjs';

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
// O1 paid: 3 snacks + 1 cleaner
pay.run('P1', 'BL1', '2026-10-01', 'payment', 'O1', 13.5);
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
// O6 paid at BL2
pay.run('P6', 'BL2', '2026-10-01', 'payment', 'O6', 6);
line.run('BL2', '2026-10-01', 'O6', 0, 'FG BL CONSUMABLES - FOOD - SNACKS', 4, 6.0, 0, SNACK);
day.run('BL1', '2026-10-01', 1, null);
day.run('BL1', '2026-10-02', 0, 'net off by 6%');
day.run('BL1', '2026-10-03', 1, null);
day.run('BL2', '2026-10-01', 1, null);

const keyed = async (q) => { const r = await main.fetch(new Request('https://api.retjghub.com/' + q, { headers: { 'X-API-Key': UP } }), mainEnv, ctx); return { status: r.status, body: await r.json().catch(() => null) }; };
const asUser = async (q, user) => { const r = await main.fetch(req('/' + q, { user }), mainEnv, ctx); return { status: r.status, body: await r.json().catch(() => null) }; };
const find = (b, store, code, name) => b?.items?.find(i => i.store === store && i.code === code && (name == null || i.name === name));

// ── The endpoint ───────────────────────────────────────────────────────────
{
  const { status, body: b } = await keyed('?action=item-sales&store=BL1&from=2026-10-01&to=2026-10-03');
  eq(status, 200, 'the key reads item-sales');
  const snack = find(b, 'BL1', SNACK);
  eq([snack?.units, snack?.sales, snack?.refundedUnits, snack?.refundedSales, snack?.orders, snack?.firstDate, snack?.lastDate],
    [5, 7.5, 1, 1.5, 2, '2026-10-01', '2026-10-02'], 'snacks: 5 sold for $7.50, 1 refunded for $1.50, over 2 paid orders');
  eq([find(b, 'BL1', CLEAN)?.units, find(b, 'BL1', CLEAN)?.sales], [1, 9], 'the cleaner: the PAID one only, not the 5 on a never-paid ticket');
  eq(find(b, 'BL1', '', 'Custom Item')?.sales, 12.34, 'a line with no code is kept, by its name');
  eq([b?.excluded?.lines, b?.excluded?.sales], [2, 35], 'the voided and never-paid tickets are excluded, and counted as such');
  ok(!b?.items?.some(i => i.store === 'BL2'), 'store=BL1: BL1 only');
  eq([b?.coverage?.daysBanked, b?.coverage?.incomplete?.map(d => d.date), b?.coverage?.linesWithoutCode], [3, ['2026-10-02'], 1],
    'coverage: 3 days banked, one incomplete, one line without a code');
  const all = (await keyed('?action=item-sales&from=2026-10-01&to=2026-10-03')).body;
  eq([find(all, 'BL2', SNACK)?.units, all?.stores?.length], [4, 6], 'no store: every store');
  eq(all?.coverage?.missing?.find(m => m.store === 'BL2')?.days, 2, 'and BL2 says 2 of its 3 days were never banked');
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
  // Ranges are bounded: one store up to 92 days, the chain up to 31.
  eq((await keyed('?action=item-sales&store=BL1&from=2026-07-01&to=2026-10-01')).status, 400, 'one store, 93 days → 400');
  eq((await keyed('?action=item-sales&store=BL1&from=2026-07-02&to=2026-10-01')).status, 200, 'one store, 92 days → 200');
  eq((await keyed('?action=item-sales&from=2026-09-01&to=2026-10-02')).status, 400, 'every store, 32 days → 400');
  eq((await keyed('?action=item-sales&store=BL1&from=2026-10-03&to=2026-10-01')).status, 400, 'to before from → 400');
  eq((await keyed('?action=item-sales&store=BL1&from=2026-10-01')).status, 400, 'no to → 400');
  eq((await keyed('?action=item-sales&store=BL1&from=2026-02-30&to=2026-03-01')).status, 400, 'an impossible date → 400');
  eq((await keyed('?action=item-sales&store=BL99&from=2026-10-01&to=2026-10-01')).status, 400, 'an unknown store → 400');
  eq((await keyed('?action=item-sales&store=bl1&from=2026-10-01&to=2026-10-01')).status, 200, 'a lowercase store is accepted');
}

// ── The tool, through the MCP worker ───────────────────────────────────────
await stubWorkersRuntime();
const { default: mcp, MAX_RESULT_CHARS } = await import(pathToFileURL(path.join(repo, 'mcp', 'worker.mjs')).href);
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
  eq([t.totals?.items, t.totals?.units, t.totals?.sales, t.totals?.refundedSales], [3, 7, 28.84, 1.5], 'totals over every item');
  eq(t.rows?.map(r => r.name), ['Custom Item', 'FG BL CLEANING', 'FG BL CONSUMABLES - FOOD - SNACKS'], 'rows by sales, highest first (not the database\'s code order)');
  eq(t.rows?.find(r => r.code === SNACK)?.avgPrice, 1.5, 'with the average price per unit');
  eq([t.excluded?.lines, t.coverage?.incomplete?.length], [2, 1], 'and the exclusions and coverage');
  const s = await tool('get_item_sales', { storeId: 'BL1', from: '2026-10-01', to: '2026-10-03', search: 'snack' });
  eq([s.matched, s.rows?.length, s.totals?.sales], [1, 1, 7.5], 'search narrows the rows and the totals to what matched');
  eq((await tool('get_item_sales', { storeId: 'BL1', from: '2026-10-01', to: '2026-10-03', search: '50040' })).rows?.[0]?.code, CLEAN, 'search matches the code too');
  eq((await tool('get_item_sales', { storeId: 'BL1', from: '2026-10-01', to: '2026-10-03', limit: 1 })).rows?.length, 1, 'limit');
  ok(lastText.length < MAX_RESULT_CHARS, 'fits one answer');
  const before = upstream.length;
  ok((await tool('get_item_sales', { from: '2026-09-01', to: '2026-10-02' })).isError && upstream.length === before, 'a chain range over 31 days is refused before any call');
  ok((await tool('get_item_sales', { storeId: 'BL1', from: '2026-10-01' })).isError, 'from and to are required');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
