// mcp/worker.mjs speaks MCP 2026-07-28 natively, and still speaks 2025 to older clients.
//
// WHAT THIS PROTECTS. 2026-07-28 removed `initialize`: a client says its version and
// capabilities on EVERY request, in `params._meta`, and repeats the method and tool
// name in `Mcp-Method` / `Mcp-Name` headers. Before this, the server refused that
// version with a plain 400 and dual-era clients fell back to the old handshake;
// a 2026-only client could not connect at all. Old clients (Claude's connector, ChatGPT,
// Codex today) must see exactly what they saw before: `initialize` never offers
// 2026-07-28, and their results carry none of the new fields.
//
// Rules from modelcontextprotocol.io/specification/2026-07-28 (basic, versioning,
// transports/streamable-http, server/discover, utilities/caching); the era is decided
// from the BODY the way the reference TypeScript SDK does it (inboundClassification).
// Same harness as test-retjg-mcp.mjs: env.API is the real main worker over sqlite D1.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadWorker, makeEnv, ctx, blockNetwork, stubWorkersRuntime } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const UPSTREAM_KEY = 'test-briefing-key';
const MCP_KEY = 'test-mcp-key-not-the-upstream-one';
const main = await loadWorker(repo);
const { env: mainEnv } = makeEnv(repo);
mainEnv.MORNING_BRIEFING_KEY = UPSTREAM_KEY;
blockNetwork();
await stubWorkersRuntime();
const { default: mcp, TOOLS } = await import(pathToFileURL(path.join(repo, 'mcp', 'worker.mjs')).href);
const { READING_RULES } = await import(pathToFileURL(path.join(repo, 'cli', 'reporting.mjs')).href);

const env = { MCP_KEY, REPORTING_API_KEY: UPSTREAM_KEY, API: { fetch: (req) => main.fetch(req, mainEnv, ctx) } };
const P = 'io.modelcontextprotocol/';
const V = '2026-07-28';
const META = { [P + 'protocolVersion']: V, [P + 'clientCapabilities']: {}, [P + 'clientInfo']: { name: 't', version: '1' } };

// A 2026-07-28 request as a conforming client sends it. Any part can be overridden.
let nextId = 1;
async function modern(method, params = {}, { meta = META, version = V, mcpMethod = method, name = params.name, headers = {} } = {}) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${MCP_KEY}` };
  if (version != null) h['MCP-Protocol-Version'] = version;
  if (mcpMethod != null) h['Mcp-Method'] = mcpMethod;
  if (name != null) h['Mcp-Name'] = name;
  const id = nextId++;
  const body = { jsonrpc: '2.0', id, method, params: meta === null ? params : { ...params, _meta: meta } };
  const res = await mcp.fetch(new Request('https://mcp.retjghub.com/mcp', { method: 'POST', headers: { ...h, ...headers }, body: JSON.stringify(body) }), env, ctx);
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, id };
}
// A 2025 request: no _meta, the old header or none.
async function legacy(method, params = {}, version) {
  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${MCP_KEY}`, ...(version && { 'MCP-Protocol-Version': version }) };
  const res = await mcp.fetch(new Request('https://mcp.retjghub.com/mcp', { method: 'POST', headers: h,
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }) }), env, ctx);
  return { status: res.status, json: await res.json() };
}
const NEW_FIELDS = ['resultType', 'ttlMs', 'cacheScope'];

// ── server/discover replaces initialize ────────────────────────────────────
{
  const r = await modern('server/discover');
  eq(r.status, 200, 'server/discover → 200');
  const d = r.json?.result || {};
  eq(r.json?.id, r.id, 'answers the request id');
  eq(d.resultType, 'complete', 'resultType: complete');
  eq(d.supportedVersions, [V], 'supportedVersions: the 2026 versions (what a client may put in _meta)');
  eq(d.capabilities, { tools: { listChanged: false } }, 'capabilities: tools');
  ok(READING_RULES.every(rule => d.instructions?.includes(rule)), 'instructions carry every reading rule');
  ok(Number.isInteger(d.ttlMs) && d.ttlMs >= 0, `ttlMs is a non-negative integer (${d.ttlMs})`);
  eq(d.cacheScope, 'private', 'cacheScope: private');
  eq(d._meta?.[P + 'serverInfo']?.name, 'retjg-hub', 'serverInfo travels in _meta');
  ok(!('serverInfo' in d) && !('protocolVersion' in d), 'no initialize-era fields');
}

// ── tools/list and tools/call ──────────────────────────────────────────────
{
  const r = await modern('tools/list');
  const l = r.json?.result || {};
  eq(r.status, 200, 'tools/list → 200');
  eq(l.resultType, 'complete', 'tools/list resultType');
  eq(l.tools?.length, TOOLS.length, `all ${TOOLS.length} tools`);
  eq(l.tools, TOOLS, 'the same tools, in the same order, as the 2025 list');
  ok(Number.isInteger(l.ttlMs) && l.ttlMs >= 0, 'tools/list ttlMs');
  eq(l.cacheScope, 'private', 'tools/list cacheScope');
  eq(l._meta?.[P + 'serverInfo']?.name, 'retjg-hub', 'tools/list serverInfo');
}
{
  const r = await modern('tools/call', { name: 'list_stores', arguments: {} });
  const c = r.json?.result || {};
  eq(r.status, 200, 'tools/call → 200');
  eq(c.resultType, 'complete', 'tools/call resultType');
  ok(!c.isError && /BL1/.test(c.content?.[0]?.text || ''), 'and the tool really ran (stores listed)');
  eq(c._meta?.[P + 'serverInfo']?.name, 'retjg-hub', 'tools/call serverInfo');
  // A tool name that is not plain ASCII is sent base64-encoded; it must be decoded.
  const b64 = await modern('tools/call', { name: 'list_stores', arguments: {} }, { name: '=?base64?' + btoa('list_stores') + '?=' });
  eq([b64.status, b64.json?.result?.resultType], [200, 'complete'], 'Mcp-Name in its =?base64?…?= form is decoded and accepted');
  const bad = await modern('tools/call', { name: 'list_stores', arguments: { storeId: 'nope', extra: 1 } });
  eq([bad.status, bad.json?.result?.isError, bad.json?.result?.resultType], [200, true, 'complete'],
    'a tool that fails is still a result with isError');
  const unknown = await modern('tools/call', { name: 'no_such_tool', arguments: {} });
  eq([unknown.status, unknown.json?.error?.code], [200, -32602], 'an unknown tool → -32602 in the body');
}

// ── Header checks: -32020, HTTP 400 ────────────────────────────────────────
const refused = (r, code, m) => eq([r.status, r.json?.error?.code, r.json?.id], [400, code, r.id], m);
refused(await modern('tools/list', {}, { mcpMethod: null }), -32020, 'no Mcp-Method → -32020');
refused(await modern('tools/list', {}, { mcpMethod: 'tools/call' }), -32020, 'Mcp-Method ≠ body method → -32020');
refused(await modern('tools/call', { name: 'list_stores', arguments: {} }, { name: null }), -32020, 'tools/call without Mcp-Name → -32020');
refused(await modern('tools/call', { name: 'list_stores', arguments: {} }, { name: 'get_labor' }), -32020, 'Mcp-Name ≠ params.name → -32020');
refused(await modern('tools/call', { name: 'list_stores', arguments: {} }, { name: '=?base64?%%%?=' }), -32020, 'a malformed base64 Mcp-Name → -32020');
// The markers are case-sensitive and the base64 padded; otherwise the value is a literal name.
refused(await modern('tools/call', { name: 'list_stores', arguments: {} }, { name: '=?BASE64?' + btoa('list_stores') + '?=' }), -32020, 'an uppercase =?BASE64? marker is a literal name → -32020');
refused(await modern('tools/call', { name: 'list_stores', arguments: {} }, { name: '=?base64?' + btoa('list_stores').replace(/=+$/, '') + '?=' }), -32020, 'unpadded base64 is a literal name → -32020');
{
  const nameless = await modern('tools/call', { arguments: {} }, { name: null });
  eq([nameless.status, nameless.json?.error?.code], [200, -32602], 'tools/call with no name at all → -32602 (invalid params), not a header error');
}
refused(await modern('tools/list', {}, { version: null }), -32020, 'no MCP-Protocol-Version header → -32020');
refused(await modern('tools/list', {}, { version: '2025-11-25' }), -32020, 'header version ≠ _meta version → -32020');

// ── Versions and the envelope ──────────────────────────────────────────────
{
  const r = await modern('tools/list', {}, { meta: { ...META, [P + 'protocolVersion']: '2027-01-01' }, version: '2027-01-01' });
  refused(r, -32022, 'a version this server does not speak → -32022');
  eq(r.json?.error?.data, { supported: [V, '2025-11-25', '2025-06-18', '2025-03-26'], requested: '2027-01-01' },
    'with { supported, requested }, 2025 versions included so a client can fall back to initialize');
  const probe = await modern('server/discover', {}, { meta: { ...META, [P + 'protocolVersion']: '2027-01-01' }, version: '2027-01-01' });
  refused(probe, -32022, 'a server/discover probe with a version this server does not speak → -32022');
  refused(await modern('tools/list', {}, { meta: { ...META, [P + 'protocolVersion']: '2027-01-01' }, version: null }), -32022,
    'an unsupported version with no header is -32022, not a header error');
  const old = await modern('tools/list', {}, { meta: { ...META, [P + 'protocolVersion']: '2025-11-25' }, version: '2025-11-25' });
  refused(old, -32022, 'a 2025 version inside _meta → -32022 (2025 is spoken through initialize, not _meta)');
  const noCaps = { ...META }; delete noCaps[P + 'clientCapabilities'];
  refused(await modern('tools/list', {}, { meta: noCaps }), -32602, '_meta without clientCapabilities → -32602');
  refused(await modern('tools/list', {}, { meta: { ...META, [P + 'clientCapabilities']: 'all' } }), -32602, 'clientCapabilities not an object → -32602');
  refused(await modern('tools/list', {}, { meta: { ...META, [P + 'protocolVersion']: 20260728 } }), -32602, 'a non-string version → -32602');
  refused(await modern('tools/list', {}, { meta: null }), -32602, 'a 2026 header with no _meta at all → -32602');
  const noClientInfo = { ...META }; delete noClientInfo[P + 'clientInfo'];
  eq((await modern('tools/list', {}, { meta: noClientInfo })).status, 200, 'clientInfo is optional');
}

// ── Methods 2026-07-28 removed: 404 + -32601 ───────────────────────────────
for (const m of ['initialize', 'ping', 'nope/nothing']) {
  const r = await modern(m);
  eq([r.status, r.json?.error?.code], [404, -32601], `${m} in the 2026 era → 404, -32601`);
}

// A 2026 notification is acknowledged like any other.
{
  const res = await mcp.fetch(new Request('https://mcp.retjghub.com/mcp', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MCP_KEY}`, 'MCP-Protocol-Version': V, 'Mcp-Method': 'notifications/cancelled' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1, _meta: META } }) }), env, ctx);
  eq(res.status, 202, 'a 2026 notification → 202');
}

// ── 2025 clients see exactly what they saw before ──────────────────────────
{
  const init = await legacy('initialize', { protocolVersion: V, capabilities: {}, clientInfo: { name: 't', version: '1' } });
  eq(init.json?.result?.protocolVersion, '2025-11-25', 'initialize asking for 2026-07-28 is answered with the newest 2025 version');
  for (const v of ['2025-11-25', '2025-06-18', '2025-03-26']) {
    eq((await legacy('initialize', { protocolVersion: v })).json?.result?.protocolVersion, v, `initialize still agrees ${v}`);
  }
  const list = await legacy('tools/list', {}, '2025-11-25');
  eq(list.status, 200, '2025 tools/list → 200');
  ok(NEW_FIELDS.every(f => !(f in (list.json?.result || {}))) && !('_meta' in list.json.result), '2025 results carry no 2026 fields');
  const call = await legacy('tools/call', { name: 'list_stores', arguments: {} }, '2025-06-18');
  ok(call.json?.result && !('resultType' in call.json.result), '2025 tools/call: no resultType');
  eq([(await legacy('ping', {})).json?.result], [{}], '2025 ping still answers {}');
  const unk = await legacy('nope/nothing', {});
  eq([unk.status, unk.json?.error?.code], [200, -32601], '2025 unknown method stays HTTP 200 (a 404 means "session expired" to 2025 clients)');
  eq((await legacy('ping', {}, '1999-01-01')).status, 400, 'an unknown header version with no _meta is still 400');
  eq((await legacy('server/discover', {}, '2025-11-25')).json?.error?.code, -32601, 'server/discover is not a 2025 method');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
