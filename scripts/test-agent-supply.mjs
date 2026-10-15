// The Supply Request queries agents get (cli/reporting.mjs), driven end to end: the real
// MCP worker → service binding → the real main worker's read-through endpoints over the
// harness's sqlite D1.
//
// WHAT THIS PROTECTS. Brian (2026-10-15): agents read the Supply Request page, names and
// notes included. The page's own Reports tab totals only the first 200 requests it gets
// back (the worker's cap), so a tool that did the same would be confidently short. These
// tools read every page; every expected figure here is computed from the seed, and the
// spend in the requests tool must reconcile with the budget tool's, which the worker
// computes its own way.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadWorker, makeEnv, ctx, blockNetwork, stubWorkersRuntime } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const r2 = (n) => Math.round(n * 100) / 100;

const UP = 'test-briefing-key', MCP = 'test-mcp-key';
const main = await loadWorker(repo);
const { db, env: mainEnv } = makeEnv(repo);
mainEnv.MORNING_BRIEFING_KEY = UP;
db.exec(fs.readFileSync(path.join(repo, 'migration-011.sql'), 'utf8'));
blockNetwork();

// ── Seed: 450 requests (three pages of 200), three stores, four statuses ──
const STATUSES = ['pending', 'under_review', 'on_hold', 'ordered'];
const SEED = Array.from({ length: 450 }, (_, i) => ({
  id: i.toString(16).padStart(32, '0'),
  store: ['BL1', 'BL2', 'BL4'][i % 3],
  status: STATUSES[i % 4],
  priority: i % 10 === 0 ? 'urgent' : 'normal',
  cost: i % 4 === 3 ? 10 + (i % 7) + 0.25 : i % 4 === 1 ? 5 : null,
  email: `user${i % 5}@bargainlane.com`,
  notes: i === 7 ? 'Please '.repeat(100) : `note ${i}`,
  submitted_at: `2026-${i < 225 ? '09' : '10'}-${String(1 + (i % 28)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00Z`,
}));
const ins = db.prepare(`INSERT INTO supply_requests (id, user_id, user_email, store, status, priority, invoice_number, cost, notes, submitted_at, updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
db.exec('BEGIN');
for (const s of SEED) ins.run(s.id, 'u-mgr1', s.email, s.store, s.status, s.priority, s.cost == null ? null : 'INV-' + s.id.slice(-4), s.cost, s.notes, s.submitted_at, s.submitted_at);
db.exec('COMMIT');
const ONE = SEED[3]; // BL1, ordered
db.prepare(`INSERT INTO supply_request_items (id, request_id, category, item_name, quantity, unit) VALUES ('it1', ?, 'Cleaning', 'Mop head', 6, 'units'), ('it2', ?, 'Office', 'Tape', 2, 'packs')`).run(ONE.id, ONE.id);
db.prepare(`INSERT INTO supply_request_history (id, request_id, type, changed_by_id, changed_by_email, old_status, new_status, note, changed_at) VALUES
  ('h1', ?, 'status_change', 'u-su', 'bhoward@bargainlane.com', 'pending', 'ordered', 'Ordered', '2026-09-05T15:00:00Z'),
  ('h2', ?, 'comment', 'u-mgr1', 'howardbrian260@gmail.com', null, null, 'Thanks!', '2026-09-06T15:00:00Z')`).run(ONE.id, ONE.id);
db.prepare(`INSERT INTO supply_budgets (store, year, month, budget) VALUES ('BL1', 2026, 10, 500), ('BL2', 2026, 10, 600)`).run();

const count = (f) => SEED.filter(f).length;
const costOf = (f) => r2(SEED.filter(f).reduce((s, x) => s + (x.cost || 0), 0));
const spendOct = (store) => costOf(x => x.store === store && x.status === 'ordered' && x.submitted_at.startsWith('2026-10'));

// ── The MCP worker, bound to the real main worker ──────────────────────────
await stubWorkersRuntime();
const { default: mcp, MAX_RESULT_CHARS } = await import(pathToFileURL(path.join(repo, 'mcp', 'worker.mjs')).href);
const upstream = [];
const env = { MCP_KEY: MCP, REPORTING_API_KEY: UP,
  API: { fetch: async (r) => { upstream.push({ url: r.url, method: r.method, key: r.headers.get('X-API-Key') }); return main.fetch(r, mainEnv, ctx); } } };
let id = 1, lastText = '';
async function tool(name, args = {}) {
  const r = await mcp.fetch(new Request('https://mcp.retjghub.com/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + MCP },
    body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } }),
  }), env, ctx);
  const res = (await r.json()).result;
  if (!res) return { error: 'no result' };
  lastText = res.content[0].text;
  return res.isError ? { isError: true, text: lastText } : JSON.parse(lastText);
}
const since = (n) => upstream.slice(n).map(u => new URL(u.url).searchParams);
const keyed = async (q) => (await main.fetch(new Request('https://api.retjghub.com/' + q, { headers: { 'X-API-Key': UP } }), mainEnv, ctx)).json();

// ── get_supply_requests ────────────────────────────────────────────────────
{
  const n = upstream.length;
  const r = await tool('get_supply_requests');
  eq(since(n).map(p => [p.get('action'), p.get('offset'), p.get('limit'), p.get('store'), p.get('status')]),
    [['supply-requests', '0', '200', null, null], ['supply-requests', '200', '200', null, null], ['supply-requests', '400', '200', null, null]],
    'reads every page: offsets 0, 200, 400, no store or status filter');
  ok(upstream.slice(n).every(u => u.method === 'GET' && u.key === UP), 'as GETs with the reporting key');
  eq(r.requests, 450, 'all 450 requests, not the first 200 the Reports tab sees');
  for (const s of STATUSES) {
    eq([r.totals?.byStatus?.[s]?.requests, r.totals?.byStatus?.[s]?.cost], [count(x => x.status === s), costOf(x => x.status === s)], `${s}: count and cost over every request`);
  }
  eq([r.totals?.byStore?.BL2?.requests, r.totals?.byStore?.BL2?.urgent], [count(x => x.store === 'BL2'), count(x => x.store === 'BL2' && x.priority === 'urgent')], 'per store: requests and urgent');
  eq([r.orderedSpend?.BL1?.['2026-10'], r.orderedSpend?.BL1?.['2026-09']], [spendOct('BL1'), costOf(x => x.store === 'BL1' && x.status === 'ordered' && x.submitted_at.startsWith('2026-09'))],
    'ordered spend by store and submit month');
  eq([r.listed, r.rows?.length], [100, 100], 'lists 100 by default');
  const firstNormal = r.rows.findIndex(x => x.priority === 'normal');
  ok(r.rows.slice(0, firstNormal).every(x => x.priority === 'urgent') && r.rows.slice(firstNormal).every(x => x.priority === 'normal'), 'urgent first, as the page orders them');
  ok(r.rows.every(x => x.user_email && 'notes' in x && 'item_count' in x), 'each row says who asked, with notes and item count (Brian: names included)');
  ok(lastText.length < MAX_RESULT_CHARS, 'a default answer fits in one tool result');
}
{
  const n = upstream.length;
  const r = await tool('get_supply_requests', { storeId: 'bl2', supplyStatus: 'ordered', limit: 200 });
  eq([since(n)[0].get('store'), since(n)[0].get('status')], ['BL2', 'ordered'], 'store (upper-cased) and status go to the server');
  eq([r.requests, Object.keys(r.totals?.byStore || {})], [count(x => x.store === 'BL2' && x.status === 'ordered'), ['BL2']], 'and the totals are that set');
  const long = r.rows.find(x => x.id === SEED[7].id);
  eq([long?.notes?.length, long?.notes?.endsWith('…')], [301, true], 'a long note is cut to 300 characters in the list');
  const u = await tool('get_supply_requests', { priority: 'urgent' });
  eq([u.requests, u.rows.every(x => x.priority === 'urgent')], [count(x => x.priority === 'urgent'), true], 'priority urgent: only urgent ones, counted over every page');
  ok((await tool('get_supply_requests', { supplyStatus: 'done' })).isError, 'an unknown status is refused');
}

// ── get_supply_budgets: reconciles with the requests ─────────────────────
{
  const b = await tool('get_supply_budgets', { year: 2026, month: 10 });
  const req = await tool('get_supply_requests');
  for (const s of ['BL1', 'BL2', 'BL4']) {
    const row = b.budgets?.find(x => x.store === s);
    eq([row?.spent, r2(row?.remaining)], [spendOct(s), r2((s === 'BL1' ? 500 : s === 'BL2' ? 600 : 0) - spendOct(s))], `${s}: October spent and remaining`);
    eq(row?.spent, req.orderedSpend?.[s]?.['2026-10'] ?? 0, `${s}: the budget's spend equals the requests tool's (one rule)`);
  }
  eq(b.budgets?.find(x => x.store === 'BL4')?.budget, 0, 'a store with no budget set reads 0');
  eq([b.chain?.budget, b.chain?.spent], [1100, r2(spendOct('BL1') + spendOct('BL2') + spendOct('BL4'))], 'chain totals');
  const n = upstream.length;
  const now = await tool('get_supply_budgets');
  eq([since(n)[0].has('year'), since(n)[0].has('month')], [false, false], 'no year or month: the server picks this month');
  const et = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric' }).formatToParts(new Date());
  eq([now.year, now.month], [Number(et.find(p => p.type === 'year').value), Number(et.find(p => p.type === 'month').value)], 'which is the current Eastern month');
  ok((await tool('get_supply_budgets', { year: 2026 })).isError, 'year without month is refused');
}

// ── get_supply_request ─────────────────────────────────────────────────────
{
  const r = await tool('get_supply_request', { requestId: ONE.id });
  eq([r.store, r.status, r.cost, r.user_email], [ONE.store, 'ordered', ONE.cost, ONE.email], 'the request itself');
  eq(r.items?.map(i => [i.category, i.item_name, i.quantity, i.unit]), [['Cleaning', 'Mop head', 6, 'units'], ['Office', 'Tape', 2, 'packs']], 'every item');
  eq(r.history?.map(h => [h.type, h.changed_by_email, h.note]), [['status_change', 'bhoward@bargainlane.com', 'Ordered'], ['comment', 'howardbrian260@gmail.com', 'Thanks!']], 'its history: status change and comment, in order, with who');
  ok(!lastText.includes('"user_id"') && !lastText.includes('changed_by_id') && !lastText.includes('request_id'), 'internal ids dropped');
  const before = upstream.length;
  ok((await tool('get_supply_request', { requestId: 'nope' })).isError && upstream.length === before, 'a malformed id is refused before any call');
  const missing = await tool('get_supply_request', { requestId: 'f'.repeat(32) });
  ok(missing.isError && /Not found/.test(missing.text), 'an unknown id says not found');
}

// ── The worker's limit and offset are clamped (they were not) ─────────────
{
  eq((await keyed('?action=supply-requests&limit=-1')).requests?.length, 1, 'limit=-1 is 1 row, not SQLite\'s "no limit"');
  eq((await keyed('?action=supply-requests&limit=abc')).requests?.length, 100, 'limit=abc is the default 100');
  eq((await keyed('?action=supply-requests&limit=1000')).requests?.length, 200, 'limit=1000 is still capped at 200');
  eq((await keyed('?action=supply-requests&limit=5&offset=-5')).requests?.[0]?.id, (await keyed('?action=supply-requests&limit=5&offset=0')).requests?.[0]?.id, 'a negative offset is 0');
  const abc = await keyed('?action=supply-requests&limit=5&offset=abc');
  eq([abc.error, abc.requests?.[0]?.id], [undefined, (await keyed('?action=supply-requests&limit=5&offset=0')).requests?.[0]?.id], 'a non-numeric offset is 0, not an error');
}

// ── The catalog of tools ───────────────────────────────────────────────────
{
  const list = await (await mcp.fetch(new Request('https://mcp.retjghub.com/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + MCP },
    body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'tools/list' }),
  }), env, ctx)).json();
  const tools = list.result?.tools || [];
  const sup = ['get_supply_requests', 'get_supply_request', 'get_supply_budgets'];
  ok(sup.every(n => tools.some(t => t.name === n)) && tools.filter(t => sup.includes(t.name)).every(t => t.annotations?.readOnlyHint === true), 'the three Supply tools are listed, read-only');
  ok(!tools.some(t => /purge|budget_set|create/i.test(t.name)), 'and nothing that writes');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
