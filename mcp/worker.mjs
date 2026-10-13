// retjg-mcp — a read-only MCP server over the RETJG HUB reporting API, for
// Claude's custom connectors (Desktop, claude.ai, phone). Phase 1 of 2: a fixed
// key. Phase 2 adds OAuth so ChatGPT, which accepts only OAuth or no auth, can
// connect too.
//
// Stateless Streamable HTTP: each POST to /mcp carries one JSON-RPC message and
// gets plain JSON back. No sessions and no SSE stream, which the spec allows, so
// there is no Durable Object and no dependency to bundle.
//
// 🔑 Two keys, never one. Claude sends MCP_KEY; this worker calls the main
// worker with REPORTING_API_KEY through a service binding. Claude's access can
// be revoked without touching the Chief of Staff app, and the upstream key never
// leaves Cloudflare.
import { READING_RULES } from './reading-rules.mjs';

// Newest first: an unknown requested version is answered with the newest.
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const SERVER_INFO = { name: 'retjg-hub', title: 'RETJG HUB sales', version: '1.0.0' };
const INSTRUCTIONS = 'Read-only sales data for the Bargain Lane stores in RETJG HUB. '
  + 'Call list_stores for store ids. Before drawing conclusions from the numbers:\n'
  + READING_RULES.map(r => '- ' + r).join('\n');

const STORE_ID = { type: 'string', description: 'Store id, e.g. BL1 (see list_stores). Omit for every store.' };
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const schema = (properties) => ({ type: 'object', properties, additionalProperties: false });

export const TOOLS = [
  {
    name: 'list_stores', title: 'List stores',
    description: 'Store ids and names.',
    inputSchema: schema({}), annotations: READ_ONLY,
  },
  {
    name: 'get_yesterday_sales', title: "Yesterday's sales",
    description: 'Yesterday (Eastern time) per store: net, till and live sales; budget; WTD and MTD '
      + "with budgets; last year's same day; labor; transactions; gross margin and categories.",
    inputSchema: schema({ storeId: STORE_ID }), annotations: READ_ONLY,
  },
  {
    name: 'get_today_sales', title: "Today's sales so far",
    description: "Today so far, live from the POS: sales, transactions and today's budget. Takes a few seconds.",
    inputSchema: schema({ storeId: STORE_ID }), annotations: READ_ONLY,
  },
  {
    name: 'get_sales_history', title: 'Daily sales history',
    description: 'One row per store per day, newest first, ending yesterday. No gaps: a day with no '
      + 'trustworthy figure appears as no_data with nulls.',
    inputSchema: schema({
      storeId: STORE_ID,
      days: { type: 'integer', minimum: 1, maximum: 400, description: 'Days back from yesterday. Default 30.' },
    }),
    annotations: READ_ONLY,
  },
];

const TOOL_IMPL = {
  list_stores: async (a, env) =>
    (await report(env, { action: 'morning-briefing' })).stores.map(s => ({ storeId: s.storeId, name: s.name })),
  get_yesterday_sales: async (a, env) => onlyStore(await report(env, { action: 'morning-briefing' }), a.storeId),
  get_today_sales: async (a, env) => onlyStore(await report(env, { action: 'afternoon-briefing' }), a.storeId),
  get_sales_history: (a, env) =>
    report(env, { action: 'store-history', days: a.days, storeId: a.storeId?.trim().toUpperCase() }),
};

class RpcError extends Error { constructor(code, message) { super(message); this.code = code; } }
// A tool that ran and failed. It goes back as a result with isError, so the
// model can read it and correct itself, rather than as a protocol error.
class ToolError extends Error {}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/mcp') return json({ error: 'Not found' }, 404);

    // Authenticate before anything else, so an unauthenticated caller learns
    // nothing about what this endpoint accepts. Fail closed when unconfigured.
    if (!env.MCP_KEY || !env.REPORTING_API_KEY) return json({ error: 'Not configured' }, 503);
    const m = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('Authorization') || '');
    if (!m || !(await sameKey(m[1], env.MCP_KEY))) {
      return json({ error: 'Unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' });
    }

    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
    const version = request.headers.get('MCP-Protocol-Version');
    if (version && !PROTOCOL_VERSIONS.includes(version)) {
      return json({ error: `Unsupported MCP-Protocol-Version: ${version}` }, 400);
    }

    let msg;
    try { msg = await request.json(); } catch {
      return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0') {
      return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }, 400);
    }
    // A notification (no id) or a response (no method) is acknowledged, not answered.
    if (!('method' in msg) || !('id' in msg)) return new Response(null, { status: 202 });

    try {
      return json({ jsonrpc: '2.0', id: msg.id, result: await handle(msg.method, msg.params || {}, env) });
    } catch (e) {
      const error = e instanceof RpcError ? { code: e.code, message: e.message } : { code: -32603, message: 'Internal error' };
      return json({ jsonrpc: '2.0', id: msg.id, error });
    }
  },
};

async function handle(method, params, env) {
  if (method === 'initialize') {
    const asked = params.protocolVersion;
    return {
      protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: INSTRUCTIONS,
    };
  }
  if (method === 'ping') return {};
  if (method === 'tools/list') return { tools: TOOLS };
  if (method === 'tools/call') {
    const tool = TOOLS.find(t => t.name === params.name);
    if (!tool) throw new RpcError(-32602, `Unknown tool: ${params.name}`);
    try {
      const out = await TOOL_IMPL[tool.name](checkArgs(tool, params.arguments ?? {}), env);
      return { content: [{ type: 'text', text: JSON.stringify(out) }] };
    } catch (e) {
      if (e instanceof ToolError) return { content: [{ type: 'text', text: e.message }], isError: true };
      throw e;
    }
  }
  throw new RpcError(-32601, `Method not found: ${method}`);
}

function checkArgs(tool, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ToolError('arguments must be an object');
  const props = tool.inputSchema.properties;
  for (const k of Object.keys(args)) {
    if (!(k in props)) throw new ToolError(`Unknown argument "${k}". This tool takes: ${Object.keys(props).join(', ') || 'nothing'}`);
  }
  if (args.storeId != null && typeof args.storeId !== 'string') throw new ToolError('storeId must be a string, e.g. "BL1"');
  if (args.days != null && !(Number.isInteger(args.days) && args.days >= 1 && args.days <= 400)) {
    throw new ToolError('days must be a whole number from 1 to 400');
  }
  return args;
}

async function report(env, params) {
  const url = new URL('https://api.retjghub.com/');
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  let res;
  try {
    res = await env.API.fetch(new Request(url, { headers: { 'X-API-Key': env.REPORTING_API_KEY } }));
  } catch (e) {
    throw new ToolError(`The reporting API could not be reached: ${e.message}`);
  }
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  if (!res.ok) throw new ToolError(`The reporting API answered ${res.status}: ${body?.error || 'no detail'}`);
  if (!body || !Array.isArray(body.stores)) throw new ToolError('The reporting API returned an unexpected response.');
  return body;
}

function onlyStore(body, store) {
  if (!store) return body;
  const id = store.trim().toUpperCase();
  const stores = body.stores.filter(s => s.storeId === id);
  if (!stores.length) throw new ToolError(`Unknown store "${store}". Valid ids: ${body.stores.map(s => s.storeId).join(', ')}`);
  return { ...body, stores };
}

// Constant-time comparison of two strings of any length: compare their digests.
async function sameKey(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
