// retjg-mcp — a read-only MCP server over the RETJG HUB reporting API.
//
// Two ways in (phase 2a, 2026-10-13):
//   - Claude's custom connector sends a fixed `Authorization: Bearer <MCP_KEY>` (phase 1).
//   - ChatGPT (which accepts only OAuth) and optionally Claude sign in with OAuth 2.1:
//     an owner or admin signs in with RETJG HUB at /authorize (mcp/authorize.mjs) and the
//     assistant gets a token. @cloudflare/workers-oauth-provider runs discovery, codes,
//     tokens, refresh and revocation, storing everything hashed in OAUTH_KV.
// Either way the data path is the same: this worker calls the main worker through the API
// service binding with REPORTING_API_KEY (every store), which is why only owners and admins
// are admitted (mcp/authorize.mjs AGENT_ROLES).
//
// Stateless Streamable HTTP: each POST to /mcp carries one JSON-RPC message and gets
// plain JSON back. No sessions and no SSE stream, which the spec allows.
//
// 🔑 Keys stay apart. Claude's MCP_KEY and the OAuth tokens open this worker; only
// REPORTING_API_KEY goes upstream, and it never leaves Cloudflare.
import { OAuthProvider, OAuthError, GrantType, insufficientScope } from '@cloudflare/workers-oauth-provider';
import { authorize, agentIdentity, admitted, AGENT_ROLES, SCOPES, ALLOWED_CLIENTS } from './authorize.mjs';
// The tools come from QUERIES in cli/reporting.mjs, the table the retjg CLI's
// commands come from too, so the two surfaces cannot drift.
import { QUERIES, READING_RULES, UsageError, QueryError, checkArgs, inputSchema } from '../cli/reporting.mjs';

// Two eras of MCP. 2025 clients open with `initialize` and agree one of these
// (newest first: an unknown requested version is answered with the newest)…
const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
// …and 2026 clients skip it, stating their version and capabilities on EVERY request
// in params._meta. A 2026 version is never offered to `initialize`, and a 2025 one is
// never accepted in _meta. Only the -32022 error lists both, so a client can fall back
// to `initialize` (the spec's example does; the Python SDK falls back only then).
const MODERN_VERSIONS = ['2026-07-28'];
const P = 'io.modelcontextprotocol/';
const SERVER_INFO = { name: 'retjg-hub', title: 'RETJG HUB sales and labor', version: '1.2.0' };
const CAPABILITIES = { tools: { listChanged: false } };
// How long a 2026 client may reuse server/discover and tools/list. Short, because a
// deploy that changes QUERIES should reach clients within minutes. 'private': this caller
// only, never a shared cache.
const CACHE = { ttlMs: 300_000, cacheScope: 'private' };
const INSTRUCTIONS = 'Read-only sales, Retail Summary and labor data for the Bargain Lane stores in RETJG HUB. '
  + 'Call list_stores for store ids. Dates are YYYY-MM-DD, Eastern time; yesterday is the latest complete day. '
  + 'Before drawing conclusions from the numbers:\n'
  + READING_RULES.map(r => '- ' + r).join('\n');

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
// Larger than this and most agents truncate or refuse a tool result (~28k tokens).
// Measured live 2026-10-13: the biggest narrowed answers are ~90k characters.
export const MAX_RESULT_CHARS = 100_000;

export const TOOLS = QUERIES.map(q => ({
  name: q.name, title: q.title, description: q.description,
  inputSchema: inputSchema(q), annotations: READ_ONLY,
}));

class RpcError extends Error { constructor(code, message) { super(message); this.code = code; } }
// A tool that ran and failed. It goes back as a result with isError, so the
// model can read it and correct itself, rather than as a protocol error.
class ToolError extends Error {}

// The token endpoint is /oauth/token; there is no registration endpoint, so the only
// clients are the two Client ID Metadata Documents /authorize allowlists.
// Exported for the tests, which mint a grant through the same options.
export const PROVIDER_OPTIONS = {
  apiRoute: '/mcp',
  apiHandler: { fetch: (request, env, ctx) => oauthMcp(request, env, ctx) },
  defaultHandler: { fetch: (request, env, ctx) => authorize(request, env, ctx) },
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/oauth/token',
  scopesSupported: SCOPES,
  resourceMetadata: {
    resource: 'https://mcp.retjghub.com/mcp',
    authorization_servers: ['https://mcp.retjghub.com'],
    resource_name: 'RETJG HUB',
  },
  clientIdMetadataDocumentEnabled: true,
  tokenExchangeCallback: recheckOnRefresh,
  // Defaults: access tokens 1 hour, grants 30 days (then sign in again).
};
const provider = new OAuthProvider(PROVIDER_OPTIONS);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Fail closed when unconfigured.
    if (!env.REPORTING_API_KEY || (!env.MCP_KEY && !env.OAUTH_KV)) return json({ error: 'Not configured' }, 503);

    // Claude's fixed key, compared before anything else. 🛑 `env.MCP_KEY &&` is
    // load-bearing: sameKey('', '') is true, so an unset key would open this to anyone.
    if (url.pathname === '/mcp' && env.MCP_KEY && await sameKey(presentedKey(request), env.MCP_KEY)) {
      return serveMcp(request, env);
    }

    // Without the OAuth store this is exactly phase 1.
    if (!env.OAUTH_KV) {
      if (url.pathname !== '/mcp') return json({ error: 'Not found' }, 404);
      logRefusal(request, env);
      return json({ error: 'Unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' });
    }
    // The allowlist holds at the token endpoint too: otherwise any https client_id
    // makes the library fetch that URL, and logs it raw (a forged log line).
    if (url.pathname === '/oauth/token' && request.method === 'POST' && !ALLOWED_CLIENTS.has(await tokenClient(request.clone()))) {
      return json({ error: 'invalid_client', error_description: 'Unknown client' }, 401);
    }
    const res = await provider.fetch(request, env, ctx);
    if (url.pathname === '/mcp' && res.status === 401 && hasCredential(request)) logRefusal(request, env);
    return res;
  },
};

// A request that came in with an OAuth token the library accepted. ctx.props is what
// /authorize stored; checked again here so a grant can never outrank phase 2a's rule.
async function oauthMcp(request, env, ctx) {
  const p = ctx && ctx.props;
  if (!p || !AGENT_ROLES.has(p.role) || typeof p.userId !== 'string' || !p.userId) {
    return json({ error: 'Forbidden' }, 403);
  }
  if (!(ctx.auth && Array.isArray(ctx.auth.scope) && ctx.auth.scope.includes('mcp:read'))) {
    return insufficientScope(ctx.auth, ['mcp:read']);
  }
  console.log(JSON.stringify({ event: 'mcp_oauth_call', user: p.userId, client: ctx.auth && ctx.auth.clientId }));
  return serveMcp(request, env);
}

// Every refresh re-asks the main worker who this is (≤ 1 hour after a demotion or a
// suspension, the assistant is out). 🛑 The two errors mean different things:
// invalid_grant REVOKES the grant and its tokens, so it is only for a definite "no";
// an outage or a bad upstream key answers temporarily_unavailable and keeps the grant.
async function recheckOnRefresh({ grantType, props, env }) {
  if (grantType !== GrantType.REFRESH_TOKEN) return;
  let who;
  // By user id: no email in a URL every hour.
  try { who = await agentIdentity(env, { id: props && props.userId }); }
  catch {
    throw new OAuthError('temporarily_unavailable', { statusCode: 503, description: 'RETJG HUB is not answering; try again.' });
  }
  if (!admitted(who) || who.id !== (props && props.userId)) {
    throw new OAuthError('invalid_grant', { description: 'This account can no longer connect to RETJG HUB.' });
  }
  const next = { userId: who.id, email: who.email, role: who.role };
  return { newProps: next, accessTokenProps: next };
}

// The MCP protocol itself, after whichever authentication let the request in.
async function serveMcp(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });

  let msg;
  try { msg = await request.json(); } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0') {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }, 400);
  }
  // The era is read from the BODY, as the reference SDK does: a 2026 request names
  // its version in _meta. A 2026 header with no _meta is a malformed 2026 request.
  const params = msg.params && typeof msg.params === 'object' && !Array.isArray(msg.params) ? msg.params : {};
  const header = request.headers.get('MCP-Protocol-Version');
  const modern = (params._meta && typeof params._meta === 'object' && Object.hasOwn(params._meta, P + 'protocolVersion'))
    || (/^\d{4}-\d{2}-\d{2}$/.test(header || '') && header >= MODERN_VERSIONS[MODERN_VERSIONS.length - 1]);
  if (!modern && header && !LEGACY_VERSIONS.includes(header)) {
    return json({ error: `Unsupported MCP-Protocol-Version: ${header}` }, 400);
  }
  // A notification (no id) or a response (no method) is acknowledged, not answered.
  if (!('method' in msg) || !('id' in msg)) return new Response(null, { status: 202 });

  if (!modern) return answer(msg, () => handle(msg.method, msg.params || {}, env));
  return serveModern(request, msg, params, env);
}

// MCP 2026-07-28 (modelcontextprotocol.io/specification/2026-07-28): no initialize,
// the version and capabilities in every request's _meta, the method and tool name
// repeated in headers, and every result marked resultType "complete".
async function serveModern(request, msg, params, env) {
  const refuse = (code, message, data, status = 400) =>
    json({ jsonrpc: '2.0', id: msg.id, error: { code, message, ...(data && { data }) } }, status);
  const meta = params._meta || {};
  const version = meta[P + 'protocolVersion'];
  const caps = meta[P + 'clientCapabilities'];
  if (typeof version !== 'string' || !caps || typeof caps !== 'object' || Array.isArray(caps)) {
    return refuse(-32602, `Every request needs _meta "${P}protocolVersion" (a string) and "${P}clientCapabilities" (an object).`);
  }
  const header = request.headers.get('MCP-Protocol-Version');
  const method = request.headers.get('Mcp-Method');
  if ((header && header !== version) || (method && method !== msg.method)) {
    return refuse(-32020, 'The MCP-Protocol-Version and Mcp-Method headers must match the request body.');
  }
  if (!MODERN_VERSIONS.includes(version)) {
    return refuse(-32022, `Unsupported protocol version: ${version}`, { supported: [...MODERN_VERSIONS, ...LEGACY_VERSIONS], requested: version });
  }
  if (!header || !method) return refuse(-32020, 'The MCP-Protocol-Version and Mcp-Method headers are required.');
  // (No params.name at all is not a header problem: tools/call answers -32602 below.)
  if (msg.method === 'tools/call' && typeof params.name === 'string' && mcpName(request) !== params.name) {
    return refuse(-32020, 'The Mcp-Name header must match params.name.');
  }

  const serverInfo = { _meta: { [P + 'serverInfo']: SERVER_INFO } };
  if (msg.method === 'server/discover') {
    return answer(msg, () => ({ resultType: 'complete', supportedVersions: MODERN_VERSIONS, capabilities: CAPABILITIES,
      instructions: INSTRUCTIONS, ...CACHE, ...serverInfo }));
  }
  // initialize and ping are gone in this era; here (only) an unknown method is a 404.
  if (msg.method !== 'tools/list' && msg.method !== 'tools/call') {
    return refuse(-32601, `Method not found: ${msg.method}`, null, 404);
  }
  return answer(msg, async () => ({ resultType: 'complete', ...await handle(msg.method, params, env),
    ...(msg.method === 'tools/list' && CACHE), ...serverInfo }));
}

// Mcp-Name as sent, or decoded from its =?base64?…?= form (for names that are not
// plain ASCII). The markers are lowercase and case-sensitive, and the base64 padded;
// anything else is a literal name. null when the base64 is not valid UTF-8.
function mcpName(request) {
  const raw = request.headers.get('Mcp-Name');
  const m = raw && /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/.exec(raw);
  if (!m || m[1].length % 4) return raw;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(m[1]), c => c.charCodeAt(0))); }
  catch { return null; }
}

// One JSON-RPC answer: the result, or the error a handler threw (HTTP 200 either way).
async function answer(msg, run) {
  try {
    return json({ jsonrpc: '2.0', id: msg.id, result: await run() });
  } catch (e) {
    const error = e instanceof RpcError ? { code: e.code, message: e.message } : { code: -32603, message: 'Internal error' };
    return json({ jsonrpc: '2.0', id: msg.id, error });
  }
}

// Which client a token request names: client_id, or a client assertion's iss
// (ChatGPT may omit client_id when it signs one). Unverified: only for the allowlist.
async function tokenClient(request) {
  try {
    const form = await request.formData();
    const id = form.get('client_id');
    if (id) return String(id);
    const jwt = String(form.get('client_assertion') || '').split('.')[1];
    return jwt ? String(JSON.parse(atob(jwt.replace(/-/g, '+').replace(/_/g, '/'))).iss || '') : '';
  } catch { return ''; }
}

const hasCredential = (request) => !!(request.headers.get('Authorization') || request.headers.get('X-API-Key'));

async function handle(method, params, env) {
  if (method === 'initialize') {
    const asked = params.protocolVersion;
    return {
      protocolVersion: LEGACY_VERSIONS.includes(asked) ? asked : LEGACY_VERSIONS[0],
      capabilities: CAPABILITIES,
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
      const text = JSON.stringify(out);
      if (text.length > MAX_RESULT_CHARS) {
        throw new ToolError(`This answer is ${Math.round(text.length / 1000)}k characters, too large for one tool result. `
          + 'Narrow it: give a storeId, a shorter date range or fewer weeks, level l2 instead of l3, or bucket total.');
      }
      return { content: [{ type: 'text', text }] };
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
    bearerPrefix: /^\s*bearer\s/i.test(v), containsKey: !!env.MCP_KEY && v.includes(env.MCP_KEY),
    // An OAuth token is userId:grantId:secret; says which kind failed, never the value.
    oauthShaped: /^(?:bearer\s+)?[^:\s]+:[^:\s]+:[^:\s]+$/i.test(v.trim()),
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
