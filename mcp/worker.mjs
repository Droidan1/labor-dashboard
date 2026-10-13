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
// The tools come from QUERIES in cli/reporting.mjs, the table the retjg CLI's
// commands come from too, so the two surfaces cannot drift.
import { QUERIES, READING_RULES, UsageError, QueryError, checkArgs, inputSchema } from '../cli/reporting.mjs';

// Newest first: an unknown requested version is answered with the newest.
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const SERVER_INFO = { name: 'retjg-hub', title: 'RETJG HUB sales and labor', version: '1.1.0' };
const INSTRUCTIONS = 'Read-only sales, Retail Summary and labor data for the Bargain Lane stores in RETJG HUB. '
  + 'Call list_stores for store ids. Dates are YYYY-MM-DD, Eastern time; yesterday is the latest complete day. '
  + 'Before drawing conclusions from the numbers:\n'
  + READING_RULES.map(r => '- ' + r).join('\n');

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export const TOOLS = QUERIES.map(q => ({
  name: q.name, title: q.title, description: q.description,
  inputSchema: inputSchema(q), annotations: READ_ONLY,
}));

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
    if (!(await sameKey(presentedKey(request), env.MCP_KEY))) {
      logRefusal(request, env);
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
    const query = QUERIES.find(q => q.name === params.name);
    if (!query) throw new RpcError(-32602, `Unknown tool: ${params.name}`);
    try {
      const args = checkArgs(query, params.arguments ?? {});
      const out = query.shape(await report(env, query.request(args)), args);
      return { content: [{ type: 'text', text: JSON.stringify(out) }] };
    } catch (e) {
      if (e instanceof ToolError || e instanceof UsageError || e instanceof QueryError) {
        return { content: [{ type: 'text', text: e.message }], isError: true };
      }
      throw e;
    }
  }
  throw new RpcError(-32601, `Method not found: ${method}`);
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
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ToolError('The reporting API returned an unexpected response.');
  return body;
}

// The key as the caller sent it. Claude's connector form takes a raw header, and
// the first live attempt (2026-10-13) was refused three times with a header
// present: the value is pasted with "Bearer ", without it, or with it twice when
// the form adds its own. All of those carry the same key, so accept them; the
// comparison itself stays exact. X-API-Key is accepted for forms that name it.
function presentedKey(request) {
  const auth = (request.headers.get('Authorization') || '').trim();
  const m = /^(?:bearer\s+)*(\S+)$/i.exec(auth);
  return m ? m[1] : (request.headers.get('X-API-Key') || '').trim();
}

// What a refused credential LOOKED like, so a failed connector setup can be
// diagnosed from `wrangler tail` (which redacts Authorization). Shape only:
// lengths, word count, and whether the real key appears in it. Never the value.
function logRefusal(request, env) {
  const auth = request.headers.get('Authorization');
  const xKey = request.headers.get('X-API-Key');
  const shape = (v) => v == null ? null : {
    length: v.length, words: v.trim() ? v.trim().split(/\s+/).length : 0,
    bearerPrefix: /^\s*bearer\s/i.test(v), containsKey: v.includes(env.MCP_KEY),
  };
  console.log(JSON.stringify({ event: 'mcp_auth_refused', authorization: shape(auth), xApiKey: shape(xKey) }));
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
