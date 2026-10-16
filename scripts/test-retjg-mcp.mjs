// mcp/worker.mjs — the read-only MCP server Claude's custom connectors call.
//
// WHY THE REAL MAIN WORKER. Everything this server can get wrong is wiring: the
// header the reporting gate reads, the params each handler reads, which of the
// TWO keys goes where. So the binding env.API is the real main worker's fetch()
// over the harness's sqlite D1, not a stub that encodes my belief about it.
//
// 🛑 The property that matters most: Claude's key (MCP_KEY) authenticates
// Claude to this server and must never travel upstream, and the upstream key
// must never appear in anything sent back to Claude.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadWorker, makeEnv, ctx, blockNetwork, stubWorkersRuntime } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const UPSTREAM_KEY = 'test-briefing-key';
const MCP_KEY = 'test-mcp-key-not-the-upstream-one';
const todayET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const _y = new Date(todayET + 'T12:00:00Z');
_y.setUTCDate(_y.getUTCDate() - 1);
const yesterdayET = _y.toISOString().slice(0, 10);

const main = await loadWorker(repo);
const { db, env: mainEnv } = makeEnv(repo);
mainEnv.MORNING_BRIEFING_KEY = UPSTREAM_KEY;
blockNetwork();
db.exec('DELETE FROM daily_sales');
db.prepare(`INSERT INTO daily_sales (store, date, total, auction, budget, order_count, snapshot_time)
            VALUES (?, ?, ?, ?, ?, ?, ?)`)
  .run('BL2', yesterdayET, 4364.39, null, 4556, 238, yesterdayET + 'T07:55:00Z');

// mcp/worker.mjs imports the OAuth library, which needs the Workers runtime stubbed.
await stubWorkersRuntime();
const { default: mcp } = await import(pathToFileURL(path.join(repo, 'mcp', 'worker.mjs')).href);
const { READING_RULES, QUERIES } = await import(pathToFileURL(path.join(repo, 'cli', 'reporting.mjs')).href);

// Every upstream request, so the tests can assert on what this server SENT.
const upstream = [];
const env = {
  MCP_KEY,
  REPORTING_API_KEY: UPSTREAM_KEY,
  API: {
    fetch: async (req) => {
      upstream.push({ url: req.url, headers: Object.fromEntries(req.headers) });
      return main.fetch(req, mainEnv, ctx);
    },
  },
};

const URL_MCP = 'https://mcp.retjghub.com/mcp';
function post(body, { key = MCP_KEY, headers = {}, url = URL_MCP, method = 'POST', e = env } = {}) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers };
  if (key != null) h.Authorization = `Bearer ${key}`;
  return mcp.fetch(new Request(url, {
    method, headers: h,
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  }), e, ctx);
}
let nextId = 1;
const rpc = async (method, params, opts) => (await post({ jsonrpc: '2.0', id: nextId++, method, params }, opts)).json();
const call = async (name, args) => (await rpc('tools/call', { name, arguments: args })).result;
// A tool error here is a FAILED assertion with its message, not a JSON.parse crash.
const data = (r) => {
  ok(r && !r.isError, `tool call succeeded — got ${r?.content?.[0]?.text?.slice(0, 80) ?? JSON.stringify(r)}`);
  try { return JSON.parse(r.content[0].text); } catch { return {}; }
};

// ── Auth: nothing gets past the gate without Claude's key ──────────────────
{
  const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } };
  eq((await post(init, { key: null })).status, 401, 'no key → 401');
  eq((await post(init, { key: 'wrong' })).status, 401, 'wrong key → 401');
  eq((await post(init, { key: UPSTREAM_KEY })).status, 401, 'the UPSTREAM key does not open this server');
  eq((await post(init, { key: null, url: URL_MCP + '?key=' + MCP_KEY })).status, 401, 'a key in the URL is not accepted');
  eq((await post(init, { key: MCP_KEY + 'x' })).status, 401, 'a longer key that starts with the real one → 401');
  ok((await post(init, { key: null })).headers.get('WWW-Authenticate')?.startsWith('Bearer'), '401 carries a Bearer challenge');
  eq((await post(init, { e: { ...env, MCP_KEY: '' } })).status, 503, 'no MCP_KEY configured → 503, never open');
  eq((await post(init, { e: { ...env, REPORTING_API_KEY: '' } })).status, 503, 'no upstream key configured → 503');
  eq(upstream.length, 0, 'no rejected request reached the main worker');

  // The forms Claude's connector header box produced on 2026-10-13, all one key.
  const raw = (v, name = 'Authorization') => post(init, { key: null, headers: { [name]: v } });
  eq((await raw(MCP_KEY)).status, 200, 'the bare key in Authorization is accepted');
  eq((await raw('Bearer Bearer ' + MCP_KEY)).status, 200, '"Bearer" twice (the form adds its own) is accepted');
  eq((await raw('bearer ' + MCP_KEY + '  ')).status, 200, 'lower-case bearer and trailing spaces are accepted');
  eq((await raw(MCP_KEY, 'X-API-Key')).status, 200, 'the key in X-API-Key is accepted');
  eq((await raw('Bearer')).status, 401, '"Bearer" with no key → 401');
  eq((await raw('Basic ' + MCP_KEY)).status, 401, 'another scheme → 401');
  eq((await raw('Bearer ' + MCP_KEY + ' extra')).status, 401, 'the key plus another word → 401');

  // A refusal is logged by SHAPE, so a broken connector can be diagnosed from
  // `wrangler tail`, which redacts the header itself.
  const logged = [];
  const realLog = console.log;
  console.log = (...a) => logged.push(a.join(' '));
  try {
    await raw('Basic ' + MCP_KEY);
    await raw('wrong-key', 'X-API-Key');
  } finally { console.log = realLog; }
  const ev = logged.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(e => e?.event === 'mcp_auth_refused');
  eq(ev.length, 2, 'each refusal is logged once');
  eq(ev[0]?.authorization?.containsKey, true, 'the log says the real key was inside the refused header');
  eq(ev[0]?.authorization?.bearerPrefix, false, 'the log says whether it started with Bearer');
  eq(ev[1]?.xApiKey?.length, 9, 'the log gives the length of a refused value');
  ok(logged.every(l => !l.includes(MCP_KEY) && !l.includes('wrong-key')), 'no refused or real key value is ever logged');
  eq(upstream.length, 0, 'still nothing reached the main worker');
}

// ── Transport ──────────────────────────────────────────────────────────────
{
  eq((await post(null, { method: 'GET' })).status, 405, 'GET /mcp → 405 (no SSE stream)');
  eq((await post({}, { url: 'https://mcp.retjghub.com/' })).status, 404, 'another path → 404');
  eq((await post({}, { url: 'https://mcp.retjghub.com/.well-known/oauth-protected-resource' })).status, 404,
    'no OAuth metadata is advertised in phase 1');
  const parse = await post('{not json');
  eq(parse.status, 400, 'malformed JSON → 400');
  eq((await parse.json()).error?.code, -32700, 'malformed JSON → -32700');
  eq((await (await post([{ jsonrpc: '2.0', id: 1, method: 'ping' }])).json()).error?.code, -32600, 'a batch array is refused');
  const note = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  eq(note.status, 202, 'a notification → 202');
  eq(await note.text(), '', 'a notification gets no body');
  eq((await post({ jsonrpc: '2.0', id: 9, method: 'ping' }, { headers: { 'MCP-Protocol-Version': '1999-01-01' } })).status, 400,
    'an unsupported MCP-Protocol-Version header → 400');
  eq((await rpc('nope/nothing')).error?.code, -32601, 'an unknown method → -32601');
  ok(JSON.stringify((await rpc('ping')).result) === '{}', 'ping → {}');
}

// ── initialize ─────────────────────────────────────────────────────────────
{
  const r = (await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })).result;
  eq(r?.protocolVersion, '2025-06-18', 'a supported version is echoed');
  ok(r?.capabilities?.tools, 'tools capability is declared');
  eq(r?.serverInfo?.name, 'retjg-hub', 'serverInfo names the server');
  ok(READING_RULES.every(rule => r?.instructions?.includes(rule)), 'instructions carry every reading rule');
  eq((await rpc('initialize', { protocolVersion: '1999-01-01' })).result?.protocolVersion, '2025-11-25',
    'an unknown version is answered with the newest');
}

// ── tools/list ─────────────────────────────────────────────────────────────
{
  const tools = (await rpc('tools/list')).result?.tools;
  eq(tools?.map(t => t.name).join(), ['list_stores', 'get_yesterday_sales', 'get_today_sales', 'get_sales_history',
    'get_retail_summary', 'get_store_categories', 'get_trailing_weeks', 'get_category_sales', 'get_category_sales_by_hour',
    'get_labor', 'get_labor_plan', 'get_inventory_items', 'get_sale_schedules', 'get_bin_dumps', 'get_trucks', 'get_truck',
    'get_out_of_stock', 'get_supply_requests', 'get_supply_request', 'get_supply_budgets', 'get_item_sales', 'get_item_mapping'].join(), 'twenty-two tools, in a fixed order');
  eq(tools?.map(t => t.name).join(), QUERIES.map(q => q.name).join(), 'the tools ARE the shared query table');
  ok(tools?.every(t => t.inputSchema?.type === 'object' && t.description), 'every tool has a description and an object schema');
  ok(tools?.every(t => t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint === false), 'every tool is marked read-only');
}

// ── Tools, end to end through the real main worker ─────────────────────────
{
  upstream.length = 0;
  const stores = data(await call('list_stores', {}));
  eq(stores?.length, 6, 'list_stores lists every store');
  ok(stores?.some?.(s => s.storeId === 'BL2' && s.name === 'South Bend'), 'list_stores pairs ids with names');

  const y = await call('get_yesterday_sales', { storeId: ' bl2 ' });
  eq(y.isError, undefined, 'get_yesterday_sales succeeds');
  const yb = data(y);
  eq(yb.salesDate, yesterdayET, 'get_yesterday_sales covers yesterday ET');
  eq(yb.stores?.length, 1, 'storeId narrows to one store (case/space-insensitive)');
  eq(yb.stores?.[0]?.netSales, 4364.39, 'the stored figure comes through');
  eq(data(await call('get_yesterday_sales', {})).stores?.length, 6, 'no storeId → every store');

  const bad = await call('get_yesterday_sales', { storeId: 'BL99' });
  eq(bad.isError, true, 'an unknown store is a tool error the model can read');
  ok(/BL2/.test(bad.content[0].text), 'the error lists the valid ids');

  const before = upstream.length;
  const h = data(await call('get_sales_history', { days: 5, storeId: 'bl2' }));
  const q = new URL(upstream[before]?.url ?? 'https://x/').searchParams;
  eq(q.get('action'), 'store-history', 'history calls store-history');
  eq(q.get('days'), '5', 'history passes days');
  eq(q.get('storeId'), 'BL2', 'history passes storeId upper-cased');
  eq(h.stores?.[0]?.days?.length, 5, 'history returns days rows');
  eq(h.stores?.[0]?.days?.[0]?.date, yesterdayET, 'history ends yesterday');
  const hb = await call('get_sales_history', { storeId: 'BL99' });
  ok(hb?.isError && /404/.test(hb.content[0].text), "history's unknown store comes back as a tool error");

  const t = data(await call('get_today_sales', { storeId: 'BL1' }));
  eq(t.salesDate, todayET, 'get_today_sales covers today ET');
  eq(t.stores?.[0]?.salesSoFarToday, null, 'an unverified live figure stays null, never a fake 0');
  eq(new URL(upstream.at(-1).url).searchParams.get('action'), 'afternoon-briefing', 'today calls afternoon-briefing');
}

// ── Argument checking ──────────────────────────────────────────────────────
{
  const n = upstream.length;
  for (const [args, why] of [
    [{ days: 0 }, 'days 0'], [{ days: 401 }, 'days 401'], [{ days: 2.5 }, 'fractional days'],
    [{ days: '5' }, 'days as a string'], [{ storeId: 2 }, 'a numeric storeId'], [{ store: 'BL1' }, 'an unknown argument'],
  ]) {
    eq((await call('get_sales_history', args))?.isError, true, `${why} is refused as a tool error`);
  }
  eq(upstream.length, n, 'refused arguments never reach the main worker');
  eq((await rpc('tools/call', { name: 'delete_everything', arguments: {} })).error?.code, -32602, 'an unknown tool → -32602');
}

// ── The two keys stay apart ────────────────────────────────────────────────
ok(upstream.length > 0 && upstream.every(u => u.headers['x-api-key'] === UPSTREAM_KEY), 'every upstream call carries the upstream key');
ok(upstream.every(u => !u.headers.authorization && !JSON.stringify(u).includes(MCP_KEY)), "Claude's key never goes upstream");
ok(upstream.every(u => !new URL(u.url).searchParams.has('key')), 'the upstream key is never put in a URL');
{
  const r = await call('get_yesterday_sales', {});
  ok(!r.content[0].text.includes(UPSTREAM_KEY), 'the upstream key never appears in a tool result');
  const broken = (await rpc('tools/call', { name: 'list_stores', arguments: {} }, { e: { ...env, REPORTING_API_KEY: 'stale' } })).result;
  ok(broken.isError && /401/.test(broken.content[0].text), 'a refused upstream key comes back as a tool error');
  ok(!broken.content[0].text.includes('stale'), 'the error does not echo the upstream key');
  const down = (await rpc('tools/call', { name: 'list_stores', arguments: {} },
    { e: { ...env, API: { fetch: async () => { throw new Error('binding missing'); } } } })).result;
  ok(down.isError && /could not be reached/.test(down.content[0].text), 'an unreachable main worker is a tool error');
}

// ── The reading rules are one fact in two places, pinned together ──────────
{
  const help = execFileSync(process.execPath, [path.join(repo, 'cli', 'retjg.mjs'), '--help'], { encoding: 'utf8' })
    .replace(/\s+/g, ' ');
  for (const rule of READING_RULES) ok(help.includes(rule), `the CLI's --help carries the rule: ${rule.slice(0, 50)}…`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
