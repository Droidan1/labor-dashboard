// retjg-mcp's OAuth (phase 2a): ChatGPT and Claude sign in with RETJG HUB.
//
// WHAT THIS PROTECTS. A token from this server reads every store's sales, cost and
// labor plans. So: only an active owner/admin holding Bargain Lane may grant one; only
// ChatGPT and Claude can receive one; a demotion takes it away at the next refresh but
// an outage never does; the Claude key connector keeps working; and nothing a browser,
// a log line or KV ever sees carries a session, a key, a code or an email.
//
// Driven end to end: the real MCP worker (with @cloudflare/workers-oauth-provider) →
// the API binding → the real main worker over the harness's sqlite D1. Only the network
// is stubbed: the two LIVE client metadata documents (scripts/fixtures/cimd-*.json),
// a JWKS standing in for ChatGPT's (its document uses private_key_jwt), and Resend.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadWorker, makeEnv, ctx as baseCtx, blockNetwork, stubWorkersRuntime, kvNamespace } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const say = console.log.bind(console);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; say('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const ORIGIN = 'https://mcp.retjghub.com', RESOURCE = ORIGIN + '/mcp';
const CHATGPT = 'https://chatgpt.com/oauth/client.json', CLAUDE = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
const CHATGPT_CB = 'https://chatgpt.com/connector_platform_oauth_redirect', CLAUDE_CB = 'https://claude.ai/api/mcp/auth_callback';
const UP = 'test-reporting-key', MCP_KEY = 'test-mcp-static-key';

await stubWorkersRuntime();
const main = await loadWorker(repo);
const { db, env: mainEnv } = makeEnv(repo);
mainEnv.MORNING_BRIEFING_KEY = UP;
mainEnv.RESEND_API_KEY = 'test-resend';
db.exec('ALTER TABLE magic_links ADD COLUMN used_at TEXT'); // production has it (migration-004)

// ── The network: client documents, ChatGPT's JWKS, Resend; everything else blocked ─
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pub = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'test-kid', alg: 'RS256', use: 'sig' };
const docs = {
  [CHATGPT]: JSON.parse(fs.readFileSync(path.join(repo, 'scripts/fixtures/cimd-chatgpt.json'), 'utf8')),
  [CLAUDE]: JSON.parse(fs.readFileSync(path.join(repo, 'scripts/fixtures/cimd-claude.json'), 'utf8')),
};
blockNetwork();
const blocked = globalThis.fetch;
const fetched = [], mails = [];
let resendDelay = 0;      // ms; a real mail API is not instant, and the timing check needs that
globalThis.fetch = async (u, init) => {
  const s = typeof u === 'string' ? u : u instanceof URL ? u.href : u.url;
  fetched.push(s);
  const js = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (docs[s]) return js(docs[s]);
  if (s === 'https://chatgpt.com/oauth/jwks.json') return js({ keys: [pub] });
  if (s.startsWith('https://api.resend.com/')) { if (resendDelay) await new Promise(r => setTimeout(r, resendDelay)); mails.push(s); return js({ id: 'm' }); }
  return blocked(u, init);
};

// ── retjg-mcp, bound to the real main worker ───────────────────────────────
const { default: mcp, PROVIDER_OPTIONS } = await import(pathToFileURL(path.join(repo, 'mcp', 'worker.mjs')).href);
const { getOAuthApi } = await import('@cloudflare/workers-oauth-provider');
const upstream = [];
const minted = [];        // every session id the main worker handed back, to prove none leaks
let apiDown = false;
const env = {
  MCP_KEY, REPORTING_API_KEY: UP, OAUTH_KV: kvNamespace(),
  API: { fetch: async (r) => {
    if (apiDown) throw new Error('binding down');
    upstream.push({ url: r.url, key: r.headers.get('X-API-Key'), auth: r.headers.get('Authorization'), agentEmail: r.headers.get('X-Agent-Email') });
    const res = await main.fetch(r, mainEnv, { ...baseCtx });
    const sid = (res.headers.get('Set-Cookie') || '').match(/session=([^;]+)/)?.[1];
    if (sid) minted.push(sid);
    return res;
  } },
};
const seen = [];          // every response body and header, for the leak checks
const logs = [];
const realLog = console.log, realErr = console.error, realWarn = console.warn;
// Captured, not printed: the leak check reads every line the worker or the library writes.
console.log = console.error = console.warn = (...a) => { logs.push(a.map(String).join(' ')); };
const pending = [];        // ctx.waitUntil work (send-code mails in the background)
const settle = async () => { while (pending.length) await pending.shift(); };
async function call(req) {
  // A fresh ctx per request: the library writes ctx.props.
  const r = await mcp.fetch(req, env, { waitUntil: (p) => pending.push(p), passThroughOnException() {} });
  const text = await r.clone().text();
  seen.push(text, JSON.stringify([...r.headers]));
  return r;
}
const grants = async () => (await env.OAUTH_KV.list({ prefix: 'grant:' })).keys.length;

// ── A browser: a cookie jar, and the forms /authorize renders ──────────────
function browser(cookies = {}) {
  const jar = { ...cookies };
  return {
    jar,
    async go(url, init = {}) {
      const h = new Headers(init.headers);
      const c = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      if (c) h.set('Cookie', c);
      const r = await call(new Request(url, { ...init, headers: h, redirect: 'manual' }));
      for (const sc of r.headers.getSetCookie()) {
        const [nv] = sc.split(';');
        const i = nv.indexOf('=');
        const name = nv.slice(0, i).trim(), value = nv.slice(i + 1);
        if (/max-age=0/i.test(sc) || value === '') delete jar[name]; else jar[name] = value;
      }
      return r;
    },
    post(fields, headers = { Origin: ORIGIN }) {
      return this.go(ORIGIN + '/authorize', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(fields) });
    },
  };
}
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const hiddenOf = (html) => ({ handle: unesc(html.match(/name="handle" value="([^"]*)"/)?.[1] || ''), q: unesc(html.match(/name="q" value="([^"]*)"/)?.[1] || '') });
const b64u = (buf) => Buffer.from(buf).toString('base64url');
async function pkce() {
  const verifier = b64u(crypto.getRandomValues(new Uint8Array(32)));
  return { verifier, challenge: b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))) };
}
function authorizeUrl(client, challenge, { redirect = client === CHATGPT ? CHATGPT_CB : CLAUDE_CB, state = 'st-' + Math.random().toString(36).slice(2), resource = RESOURCE, scope = 'mcp:read offline_access' } = {}) {
  const p = new URLSearchParams({ response_type: 'code', client_id: client, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state, resource, scope });
  return { url: `${ORIGIN}/authorize?${p}`, state };
}
async function assertion(client) {
  const enc = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', typ: 'JWT', kid: 'test-kid' });
  const body = enc({ iss: client, sub: client, aud: ORIGIN + '/oauth/token', jti: crypto.randomUUID(), iat: now, exp: now + 300 });
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(sig)}`;
}
async function token(client, fields) {
  const body = new URLSearchParams({ client_id: client, resource: RESOURCE, ...fields });
  if (client === CHATGPT) {
    body.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
    body.set('client_assertion', await assertion(CHATGPT));
  }
  const r = await call(new Request(ORIGIN + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }));
  return { status: r.status, body: await r.json().catch(() => null) };
}
const rpc = async (bearer, method, params) => {
  const r = await call(new Request(RESOURCE, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(bearer && { Authorization: 'Bearer ' + bearer }) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }));
  return { status: r.status, body: await r.json().catch(() => null), r };
};
const codeFor = (email) => db.prepare('SELECT otp_code FROM magic_links WHERE email = ? ORDER BY rowid DESC LIMIT 1').get(email)?.otp_code;
const sessions = () => db.prepare('SELECT COUNT(*) n FROM sessions').get().n;

// ════ 1. Discovery ═════════════════════════════════════════════════════════
{
  const as = await (await call(new Request(ORIGIN + '/.well-known/oauth-authorization-server'))).json();
  eq(as.issuer, ORIGIN, 'issuer is exactly the origin');
  eq(as.code_challenge_methods_supported, ['S256'], 'PKCE S256 only');
  ok(as.scopes_supported?.includes('offline_access') && as.scopes_supported?.includes('mcp:read'), 'offline_access and mcp:read advertised (ChatGPT keeps access only with offline_access)');
  eq(as.authorization_response_iss_parameter_supported, true, 'RFC 9207 iss advertised (ChatGPT then uses its stable redirect)');
  eq(as.client_id_metadata_document_supported, true, 'client metadata documents supported');
  eq(as.registration_endpoint, undefined, 'no dynamic registration: the two allowlisted documents are the only clients');
  const prm = await (await call(new Request(ORIGIN + '/.well-known/oauth-protected-resource/mcp'))).json();
  eq([prm.resource, prm.authorization_servers?.[0]], [RESOURCE, ORIGIN], 'protected resource: exact URL incl. path, our issuer first');
  const n = upstream.length;
  const anon = await call(new Request(RESOURCE, { method: 'POST', body: '{}' }));
  eq(anon.status, 401, 'unauthenticated /mcp → 401 (Claude needs a 401 to start OAuth)');
  ok((anon.headers.get('WWW-Authenticate') || '').includes(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`), 'and points at the resource metadata');
  eq(upstream.length, n, 'nothing reached the main worker');
  eq((await call(new Request(ORIGIN + '/register', { method: 'POST', body: '{}' }))).status, 404, '/register does not exist');
}

// ════ 2. ChatGPT, from a browser already signed in to RETJG HUB ════════════
let chat;
{
  const sessionsBefore = sessions();
  const b = browser({ session: 'sess-u-admin' });
  const { verifier, challenge } = await pkce();
  const { url, state } = authorizeUrl(CHATGPT, challenge);
  const page = await b.go(url);
  const html = await page.text();
  eq(page.status, 200, 'consent page → 200');
  ok(html.includes('Connect ChatGPT to RETJG HUB') && html.includes('chatgpt.com'), 'names the client and where it sends you back');
  ok(html.includes('Signed in as <strong>bgeorges@retjg.com</strong>'), 'recognises the signed-in admin');
  ok((page.headers.get('Content-Security-Policy') || '').includes("frame-ancestors 'none'") && page.headers.get('X-Frame-Options') === 'DENY', 'cannot be framed');
  eq(page.headers.get('Cache-Control'), 'no-store', 'never cached');
  // 🛑 Not no-referrer: with it a browser posts this page's forms with Origin: null,
  // and the Origin check refuses every real Allow (fresh-eyes review, 2026-10-13).
  eq(page.headers.get('Referrer-Policy'), 'same-origin', 'Referrer-Policy same-origin, so the forms post their real Origin');
  ok(Object.keys(b.jar).some(k => k.startsWith('__Host-')), 'the consent handle is bound to this browser by a __Host- cookie');
  const allow = await b.post({ step: 'allow', ...hiddenOf(html) });
  eq(allow.status, 302, 'Allow → 302');
  const loc = new URL(allow.headers.get('Location') || 'about:blank');
  eq(loc.origin + loc.pathname, CHATGPT_CB, "back to ChatGPT's registered redirect");
  eq([loc.searchParams.get('state'), loc.searchParams.get('iss')], [state, ORIGIN], 'with its state and our iss');
  ok(!allow.headers.getSetCookie().some(c => /^session=/.test(c)), 'no app session cookie is set');
  eq(sessions(), sessionsBefore, "the browser's own session is untouched");
  const t = await token(CHATGPT, { grant_type: 'authorization_code', code: loc.searchParams.get('code'), redirect_uri: CHATGPT_CB, code_verifier: verifier });
  eq(t.status, 200, 'code + PKCE verifier + signed client assertion → tokens');
  ok(t.body?.access_token && t.body?.refresh_token, 'an access token and a refresh token');
  chat = t.body;
  const tl = await rpc(chat.access_token, 'tools/list');
  eq(tl.body?.result?.tools?.length, 11, 'the token reads the 11 tools');
  ok(tl.body?.result?.tools?.every(x => x.annotations?.readOnlyHint === true), 'all read-only (ChatGPT asks to confirm anything else)');
  const before = upstream.length;
  const ls = await rpc(chat.access_token, 'tools/call', { name: 'list_stores', arguments: {} });
  eq(JSON.parse(ls.body?.result?.content?.[0]?.text || '[]').length, 6, 'and a tool answers');
  const ups = upstream.slice(before);
  ok(ups.length > 0 && ups.every(u => u.key === UP && !u.auth), 'upstream carries the reporting key, never the token');
  ok(logs.some(l => l.includes('"mcp_oauth_call"') && l.includes('u-admin')), 'the call is logged by user id');
  const again = await b.post({ step: 'allow', ...hiddenOf(html) });
  eq(again.status, 400, 'the same consent handle cannot be used twice');
}

// ════ 3. Claude, by email and code ═════════════════════════════════════════
let claude;
{
  const b = browser();
  const { verifier, challenge } = await pkce();
  const { url } = authorizeUrl(CLAUDE, challenge);
  const page = await b.go(url);
  const html = await page.text();
  ok(html.includes('Email me a code') && !html.includes('Signed in as'), 'not signed in: asks for an email');
  const h = hiddenOf(html);
  resendDelay = 300;
  const t0 = Date.now();
  const sent = await b.post({ step: 'send-code', email: 'BGeorges@retjg.com', ...h });
  const took = Date.now() - t0;
  const sentHtml = await sent.text();
  ok(sentHtml.includes("we've emailed a 6-digit code"), 'says a code was sent');
  eq(mails.length, 0, 'the page answered before the email went: response time cannot say an account exists');
  ok(took < 250, `send-code answered in ${took} ms with a 300 ms mail provider`);
  await settle();
  resendDelay = 0;
  eq(mails.length, 1, 'one email went out, in the background');
  await b.post({ step: 'send-code', email: 'bgeorges@retjg.com', ...h });
  await settle();
  eq(mails.length, 1, 'a second send inside a minute is throttled');
  const unknown = await (await b.post({ step: 'send-code', email: 'nobody@example.com', ...h })).text();
  await settle();
  ok(unknown.includes("we've emailed a 6-digit code"), 'an unknown email gets the same page (no account oracle)');
  eq(mails.length, 1, 'and no email');
  const code = codeFor('bgeorges@retjg.com');
  const wrong = await b.post({ step: 'verify', email: 'bgeorges@retjg.com', code: code === '123456' ? '654321' : '123456', ...h });
  ok(wrong.status === 200 && unesc(await wrong.text()).includes("didn't work") && !wrong.headers.get('Location'), 'a wrong code: one generic message, no redirect');
  const sBefore = sessions();
  const right = await b.post({ step: 'verify', email: 'bgeorges@retjg.com', code, ...h });
  eq(right.status, 302, 'the right code → 302');
  const loc = new URL(right.headers.get('Location') || 'about:blank');
  eq(loc.origin + loc.pathname, CLAUDE_CB, "back to Claude's callback");
  eq(loc.searchParams.get('iss'), ORIGIN, 'with our iss');
  eq(sessions(), sBefore, 'the session the code minted was logged out at once');
  ok(!right.headers.getSetCookie().some(c => /^session=/.test(c)) && !b.jar.session, 'and never handed to the browser');
  const t = await token(CLAUDE, { grant_type: 'authorization_code', code: loc.searchParams.get('code'), redirect_uri: CLAUDE_CB, code_verifier: verifier });
  eq(t.status, 200, 'public client + PKCE → tokens');
  claude = t.body;
  eq((await rpc(claude.access_token, 'tools/list')).body?.result?.tools?.length, 11, 'and they work');
}

// Both grants exist now; once section 6 revokes them, their records are gone, so the
// check that no email sits in KV in the clear has to run HERE, not at the end.
{
  ok((await grants()) >= 2, 'the two grants are stored');
  const kvText = [...env.OAUTH_KV._map.values()].map(e => e.value).join('\n');
  ok(!kvText.includes('bgeorges@retjg.com'), "no grant stores the user's email in the clear (props are encrypted; metadata is not)");
}

// ════ 4. Who and what is refused — none of it writes a grant ═══════════════
{
  const g0 = await grants();
  for (const [sess, who] of [['sess-u-mgr1', 'a manager'], ['sess-u-exec', 'an executive'], ['sess-u-staff', 'staff']]) {
    const b = browser({ session: sess });
    const { challenge } = await pkce();
    const html = await (await b.go(authorizeUrl(CHATGPT, challenge).url)).text();
    ok(html.includes("can't connect AI assistants yet"), `${who}'s session: told owner/admin only`);
    const r = await b.post({ step: 'allow', ...hiddenOf(html) });
    ok(r.status === 200 && !r.headers.get('Location'), `${who} pressing Allow anyway: no redirect`);
  }
  {
    const b = browser();
    const { challenge } = await pkce();
    const h = hiddenOf(await (await b.go(authorizeUrl(CLAUDE, challenge).url)).text());
    await env.OAUTH_KV.delete((await env.OAUTH_KV.list({ prefix: 'retjg:code-sent:' })).keys[0]?.name || 'x');
    await b.post({ step: 'send-code', email: 'howardbrian260@gmail.com', ...h });
    await settle();
    const r = await b.post({ step: 'verify', email: 'howardbrian260@gmail.com', code: codeFor('howardbrian260@gmail.com'), ...h });
    ok(r.status === 200 && (await r.text()).includes("can't connect AI assistants yet"), 'a manager by code: refused');
  }
  {
    db.prepare("UPDATE users SET status = 'suspended' WHERE id = 'u-su'").run();
    const b = browser({ session: 'sess-u-su' });
    const { challenge } = await pkce();
    const html = await (await b.go(authorizeUrl(CHATGPT, challenge).url)).text();
    ok(!html.includes('Signed in as'), "a suspended account's session is not recognised");
    const r = await b.post({ step: 'allow', ...hiddenOf(html) });
    ok(!r.headers.get('Location'), 'and cannot allow');
    db.prepare("UPDATE users SET status = 'active' WHERE id = 'u-su'").run();
  }
  {
    const n = fetched.length;
    const r = await browser({ session: 'sess-u-admin' }).go(`${ORIGIN}/authorize?response_type=code&client_id=${encodeURIComponent('https://evil.example/client.json')}&redirect_uri=${encodeURIComponent('https://evil.example/cb')}&code_challenge=x&code_challenge_method=S256&state=s`);
    eq(r.status, 400, 'a client that is not ChatGPT or Claude → 400');
    ok(!fetched.slice(n).some(u => u.includes('evil.example')), 'and its document is never fetched');
    ok(!r.headers.get('Location'), 'and nothing redirects');
  }
  {
    const { challenge } = await pkce();
    const r = await browser({ session: 'sess-u-admin' }).go(authorizeUrl(CHATGPT, challenge, { redirect: 'https://evil.example/cb' }).url);
    ok(r.status === 400 && !r.headers.get('Location'), "a redirect_uri not in ChatGPT's document → 400, no redirect");
    const r2 = await browser({ session: 'sess-u-admin' }).go(authorizeUrl(CHATGPT, challenge, { resource: ORIGIN + '/other' }).url);
    eq(r2.status, 400, 'a resource other than ours → 400');
  }
  {
    const b = browser({ session: 'sess-u-admin' });
    const { challenge } = await pkce();
    const html = await (await b.go(authorizeUrl(CHATGPT, challenge).url)).text();
    eq((await b.post({ step: 'allow', ...hiddenOf(html) }, { Origin: 'https://evil.example' })).status, 403, 'a post from another origin → 403');
    const other = browser({ session: 'sess-u-admin' });
    const r = await other.post({ step: 'allow', ...hiddenOf(html) });
    ok(r.status === 400 && !r.headers.get('Location'), "another browser cannot use this browser's consent handle");
    const deny = await b.post({ step: 'deny', ...hiddenOf(html) });
    eq(deny.status, 302, 'Deny → 302');
    const dl = new URL(deny.headers.get('Location') || 'about:blank');
    eq([dl.origin + dl.pathname, dl.searchParams.get('error'), dl.searchParams.get('iss')], [CHATGPT_CB, 'access_denied', ORIGIN], 'back to ChatGPT with access_denied and iss');
  }
  {
    // An admin is a per-business role: without a Bargain Lane grant, no.
    db.prepare("DELETE FROM user_grants WHERE user_id = 'u-admin'").run();
    const b = browser({ session: 'sess-u-admin' });
    const { challenge } = await pkce();
    const html = await (await b.go(authorizeUrl(CHATGPT, challenge).url)).text();
    ok(html.includes("can't connect AI assistants yet"), 'an admin without a Bargain Lane grant: refused');
    ok(!(await b.post({ step: 'allow', ...hiddenOf(html) })).headers.get('Location'), 'and Allow does nothing');
    db.prepare("INSERT INTO user_grants (user_id,business_id,role,units) VALUES ('u-admin','bl','admin',NULL)").run();
  }
  eq(await grants(), g0, 'not one of those wrote a grant');
}

// ════ 5. Codes and PKCE ════════════════════════════════════════════════════
{
  const b = browser({ session: 'sess-u-admin' });
  const { verifier, challenge } = await pkce();
  const html = await (await b.go(authorizeUrl(CLAUDE, challenge).url)).text();
  const loc = new URL((await b.post({ step: 'allow', ...hiddenOf(html) })).headers.get('Location'));
  const code = loc.searchParams.get('code');
  const bad = await token(CLAUDE, { grant_type: 'authorization_code', code, redirect_uri: CLAUDE_CB, code_verifier: verifier.slice(1) + 'x' });
  eq(bad.body?.error, 'invalid_grant', 'a wrong PKCE verifier → invalid_grant');
  const { verifier: v2, challenge: c2 } = await pkce();
  const html2 = await (await b.go(authorizeUrl(CLAUDE, c2).url)).text();
  const code2 = new URL((await b.post({ step: 'allow', ...hiddenOf(html2) })).headers.get('Location')).searchParams.get('code');
  eq((await token(CLAUDE, { grant_type: 'authorization_code', code: code2, redirect_uri: CLAUDE_CB, code_verifier: v2 })).status, 200, 'a fresh code works once');
  eq((await token(CLAUDE, { grant_type: 'authorization_code', code: code2, redirect_uri: CLAUDE_CB, code_verifier: v2 })).body?.error, 'invalid_grant', 'and not twice');
}

// ════ 6. Refresh: re-checked every time, revoked only on a definite "no" ═══
{
  const n = upstream.length;
  const r1 = await token(CHATGPT, { grant_type: 'refresh_token', refresh_token: chat.refresh_token });
  eq(r1.status, 200, 'a refresh works');
  const look = upstream.slice(n).filter(u => u.url.includes('action=agent-identity'));
  ok(look.length === 1 && look[0].url.includes('id=u-admin') && look[0].key === UP, 'and asked the main worker who this is, by user id');
  ok(look.every(u => !u.url.includes('%40') && !u.url.includes('@') && !u.agentEmail), 'with no email in the URL or a header');
  chat = r1.body;
  eq((await rpc(chat.access_token, 'tools/list')).status, 200, 'the new access token works');

  apiDown = true;
  const down = await token(CHATGPT, { grant_type: 'refresh_token', refresh_token: chat.refresh_token });
  apiDown = false;
  eq([down.status, down.body?.error], [503, 'temporarily_unavailable'], 'main worker unreachable → 503, temporarily_unavailable');
  const after = await token(CHATGPT, { grant_type: 'refresh_token', refresh_token: chat.refresh_token });
  eq(after.status, 200, 'and the grant survived: the next refresh works');
  chat = after.body;

  // A database error reading grants is an outage, not "no Bargain Lane": keep the grant.
  const realPrepare = mainEnv.DB.prepare.bind(mainEnv.DB);
  mainEnv.DB.prepare = (sql) => (/user_grants/.test(sql) ? { bind: () => ({ all: async () => { throw new Error('D1_ERROR'); } }) } : realPrepare(sql));
  const dberr = await token(CHATGPT, { grant_type: 'refresh_token', refresh_token: chat.refresh_token });
  mainEnv.DB.prepare = realPrepare;
  eq([dberr.status, dberr.body?.error], [503, 'temporarily_unavailable'], 'a D1 error reading grants → 503, not a revocation');
  const healed = await token(CHATGPT, { grant_type: 'refresh_token', refresh_token: chat.refresh_token });
  eq(healed.status, 200, 'and the grant survived it');
  chat = healed.body;

  // A second, independent grant (Claude) for the same admin, to show revocation is per grant.
  const b = browser({ session: 'sess-u-admin' });
  const { verifier, challenge } = await pkce();
  const html = await (await b.go(authorizeUrl(CLAUDE, challenge).url)).text();
  const cl = await token(CLAUDE, { grant_type: 'authorization_code', redirect_uri: CLAUDE_CB, code_verifier: verifier,
    code: new URL((await b.post({ step: 'allow', ...hiddenOf(html) })).headers.get('Location')).searchParams.get('code') });
  const grantOf = (t) => t.split(':')[1];
  db.prepare("UPDATE users SET role = 'manager' WHERE id = 'u-admin'").run();
  const demoted = await token(CHATGPT, { grant_type: 'refresh_token', refresh_token: chat.refresh_token });
  eq(demoted.body?.error, 'invalid_grant', 'demoted to manager → the refresh is refused (invalid_grant)');
  eq(await env.OAUTH_KV.get(`grant:u-admin:${grantOf(chat.access_token)}`), null, 'and that grant is gone');
  eq((await rpc(chat.access_token, 'tools/list')).status, 401, 'and its access token stops working');
  eq((await token(CLAUDE, { grant_type: 'refresh_token', refresh_token: cl.body.refresh_token })).body?.error, 'invalid_grant',
    "the same admin's other grant is refused at its own next refresh (each grant is cut off within the hour)");
  db.prepare("UPDATE users SET role = 'admin' WHERE id = 'u-admin'").run();
}

// ════ 7. A grant that outranks phase 2a is refused at /mcp ═════════════════
{
  const api = getOAuthApi(PROVIDER_OPTIONS, env);
  const { verifier, challenge } = await pkce();
  const authReq = await api.parseAuthRequest(new Request(authorizeUrl(CLAUDE, challenge).url));
  const { redirectTo } = await api.completeAuthorization({ request: authReq, userId: 'u-mgr1', scope: ['mcp:read'],
    props: { userId: 'u-mgr1', email: 'howardbrian260@gmail.com', role: 'manager' }, metadata: {} });
  const t = await token(CLAUDE, { grant_type: 'authorization_code', code: new URL(redirectTo).searchParams.get('code'), redirect_uri: CLAUDE_CB, code_verifier: verifier });
  eq((await rpc(t.body?.access_token, 'tools/list')).status, 403, 'a manager-props token → 403 at /mcp, even if a grant ever existed');

  const { verifier: v2, challenge: c2 } = await pkce();
  const req2 = await api.parseAuthRequest(new Request(authorizeUrl(CLAUDE, c2).url));
  const { redirectTo: r2 } = await api.completeAuthorization({ request: req2, userId: 'u-admin', scope: ['offline_access'],
    props: { userId: 'u-admin', email: 'bgeorges@retjg.com', role: 'admin' }, metadata: {} });
  const t2 = await token(CLAUDE, { grant_type: 'authorization_code', code: new URL(r2).searchParams.get('code'), redirect_uri: CLAUDE_CB, code_verifier: v2 });
  eq((await rpc(t2.body?.access_token, 'tools/list')).status, 403, 'a token without mcp:read → 403 insufficient_scope');

  // ChatGPT's own document offers `none` beside private_key_jwt, so it may redeem with
  // PKCE alone; pinned so a future tightening does not silently break ChatGPT.
  const b = browser({ session: 'sess-u-admin' });
  const { verifier: v3, challenge: c3 } = await pkce();
  const html = await (await b.go(authorizeUrl(CHATGPT, c3).url)).text();
  const code3 = new URL((await b.post({ step: 'allow', ...hiddenOf(html) })).headers.get('Location')).searchParams.get('code');
  const body = new URLSearchParams({ client_id: CHATGPT, resource: RESOURCE, grant_type: 'authorization_code', code: code3, redirect_uri: CHATGPT_CB, code_verifier: v3 });
  const none = await call(new Request(ORIGIN + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }));
  eq(none.status, 200, "ChatGPT's code with PKCE and no assertion (its document's `none`) also redeems");
}

// ════ 7b. The token endpoint serves only the two clients ═══════════════════
{
  const n = fetched.length;
  const r = await call(new Request(ORIGIN + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'x:y:z', client_id: 'https://evil.example/client.json' }) }));
  eq([r.status, (await r.json()).error], [401, 'invalid_client'], 'an unknown client at the token endpoint → invalid_client');
  ok(!fetched.slice(n).some(u => u.includes('evil.example')), 'and its document is never fetched');
  const forged = 'https://evil.example/c\n{"event":"mcp_oauth_granted","user":"u-su"}';
  const l = logs.length;
  await call(new Request(ORIGIN + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'x:y:z', client_id: forged }) }));
  ok(!logs.slice(l).some(x => x.includes('mcp_oauth_granted')), 'a client_id cannot write a forged line into the logs');
  const hdr = await call(new Request(ORIGIN + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'x:y:z' }) }));
  eq(hdr.status, 401, 'a token request naming no client → invalid_client');
}

// ════ 7c. Paths and methods ════════════════════════════════════════════════
{
  eq((await call(new Request(ORIGIN + '/mcp', { method: 'HEAD', headers: { Authorization: 'Bearer ' + MCP_KEY } }))).status, 405, 'HEAD with the static key → 405, not the tools');
  for (const p of ['//mcp', '/MCP', '/mcp%2F']) {
    ok((await call(new Request(ORIGIN + p, { method: 'POST', headers: { Authorization: 'Bearer ' + MCP_KEY }, body: '{}' }))).status !== 200, `${p} with the static key is not the MCP endpoint`);
  }
  ok(/^compatibility_flags = \["global_fetch_strictly_public"\]$/m.test(fs.readFileSync(path.join(repo, 'mcp/wrangler.toml'), 'utf8')),
    'mcp/wrangler.toml really sets global_fetch_strictly_public (the test stubs force it on)');
}

// ════ 8. Claude's static key still works, and an unset key never opens ═════
{
  eq((await rpc(MCP_KEY, 'tools/list')).body?.result?.tools?.length, 11, 'Bearer MCP_KEY still reads the tools');
  eq((await rpc('Bearer ' + MCP_KEY, 'tools/list')).status, 200, '"Bearer Bearer key" still works');
  const saved = env.MCP_KEY;
  env.MCP_KEY = '';
  ok((await rpc(null, 'tools/list')).status !== 200, 'no MCP_KEY and no credential → never 200');
  ok((await rpc('', 'tools/list')).status !== 200, 'no MCP_KEY and an empty Bearer → never 200');
  env.MCP_KEY = saved;
}

// ════ 8b. The admission rule, clause by clause ═════════════════════════════
// Some clauses cannot be reached end to end today (an admin's stores are always null
// in the app), but the rule must hold if that ever changes.
{
  const { admitted } = await import(pathToFileURL(path.join(repo, 'mcp', 'authorize.mjs')).href);
  const yes = { found: true, active: true, associate: false, role: 'admin', stores: null, bargainLane: true, id: 'u-x', email: 'a@b.c' };
  ok(admitted(yes), 'an active Bargain Lane admin with every store is admitted');
  ok(admitted({ ...yes, role: 'superuser' }), 'so is a superuser');
  for (const [k, v, why] of [['found', false, 'not found'], ['active', false, 'suspended'], ['associate', true, 'an associate'],
    ['role', 'manager', 'a manager'], ['role', 'executive', 'an executive'], ['stores', ['BL1'], 'scoped to one store'],
    ['stores', [], 'no stores'], ['bargainLane', false, 'no Bargain Lane grant'], ['id', '', 'no id'], ['id', 'a:b', "an id with ':'"]]) {
    ok(!admitted({ ...yes, [k]: v }), `refused: ${why}`);
  }
  ok(!admitted(null) && !admitted({}), 'refused: nothing at all');
}

// ════ 9. Escaping, contrast, and nothing leaks ═════════════════════════════
{
  const realName = docs[CLAUDE].client_name;
  docs[CLAUDE].client_name = '"><img src=x onerror=alert(1)>';
  const { challenge } = await pkce();
  const b = browser();
  const html = await (await b.go(authorizeUrl(CLAUDE, challenge).url)).text();
  docs[CLAUDE].client_name = realName;
  ok(!html.includes('<img src=x'), 'a hostile client name is escaped');
  const h = hiddenOf(html);
  const mailHtml = await (await b.post({ step: 'send-code', email: '"><script>alert(1)</script>@x.com', ...h })).text();
  ok(!mailHtml.includes('<script>alert'), 'a hostile email is escaped');

  // DESIGN.md §2 tokens, as the page declares them, ≥ 4.5:1 in both themes.
  const lum = (hex) => { const c = hex.match(/[0-9a-f]{2}/gi).map(x => parseInt(x, 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const vars = (block) => Object.fromEntries([...block.matchAll(/--([a-z]+):(#[0-9a-f]{6})/gi)].map(m => [m[1], m[2]]));
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const dark = vars(css.match(/:root\{([^}]*)\}/)[1]);
  const light = { ...dark, ...vars(css.match(/prefers-color-scheme: light\)\{:root\{([^}]*)\}/)[1]) };
  for (const [name, t] of [['dark', dark], ['light', light]]) {
    for (const [fg, bg] of [['ink', 'panel'], ['dim', 'panel'], ['bad', 'panel'], ['onaccent', 'accent'], ['ink', 'field'], ['ink', 'bg']]) {
      const r = ratio(t[fg], t[bg]);
      ok(r >= 4.5, `${name}: ${fg} on ${bg} is ${r.toFixed(2)}:1`);
    }
  }
}
{
  const secrets = ['sess-u-admin', 'sess-u-mgr1', MCP_KEY, UP];
  const codes = db.prepare('SELECT otp_code FROM magic_links').all().map(r => r.otp_code);
  const sessionIds = db.prepare('SELECT id FROM sessions').all().map(r => r.id);
  const everything = seen.join('\n') + '\n' + logs.join('\n');
  for (const s of [...secrets, ...codes]) ok(!everything.includes(s), `never in a response or a log: ${s.slice(0, 8)}…`);
  ok(!sessionIds.some(id => everything.includes(id)), 'no stored session id appears in any response or log');
  ok(minted.length >= 2 && !minted.some(id => everything.includes(id)), `none of the ${minted.length} sessions the code sign-ins minted appears either`);
  const lookups = upstream.filter(u => u.url.includes('action=agent-identity'));
  ok(lookups.length > 3 && lookups.every(u => !u.url.includes('@') && !u.url.includes('%40')),
    `no identity lookup (sign-in or refresh, ${lookups.length} of them) put an email in its URL, which lands in logs`);
  const kvText = [...env.OAUTH_KV._map.values()].map(e => e.value).join('\n');
  ok(!kvText.includes('bgeorges@retjg.com') && !kvText.includes('howardbrian260@gmail.com'), 'no email is stored in KV in the clear');
}

console.log = realLog; console.error = realErr; console.warn = realWarn;
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
