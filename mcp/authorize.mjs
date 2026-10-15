// /authorize for retjg-mcp's OAuth (phase 2a, 2026-10-13): ChatGPT or Claude asks to
// read RETJG HUB data, and an owner or admin signs in with their RETJG HUB account
// and says yes. The OAuth machinery (discovery, codes, tokens, refresh, revocation) is
// @cloudflare/workers-oauth-provider; this file is only who-are-you and may-they.
//
// 🔑 Identity always comes from the main worker, over the API service binding:
//   - a browser already signed in to retjghub.com sends its `session` cookie here
//     (Domain=retjghub.com), and auth-me says who that is;
//   - otherwise the emailed 6-digit code (auth-login → auth-verify-otp, 5 tries,
//     migration-077) mints a session, auth-me reads it, and auth-logout deletes it
//     at once. 🛑 That session is NEVER handed to the browser: the user asked to
//     connect an assistant, not to sign in to the app, and a 7-day full-power app
//     session must not outlive one use or land in ChatGPT's sign-in window.
// Then agent-identity (key-gated) says whether they may connect: admitted().
//
// 🛑 Only two clients exist: ChatGPT and Claude, by their Client ID Metadata Document
// URLs. Any other client_id is refused BEFORE the library fetches its document, here
// and at the token endpoint (worker.mjs), so nobody can register a look-alike client
// and show a signed-in admin a consent page that sends the code to their own server,
// or make this worker fetch arbitrary URLs. Dynamic registration is off.

import { AuthorizationError } from '@cloudflare/workers-oauth-provider';

export const ALLOWED_CLIENTS = new Map([
  ['https://chatgpt.com/oauth/client.json', 'ChatGPT'],
  ['https://claude.ai/oauth/mcp-oauth-client-metadata', 'Claude'],
]);
// 🛑 Only accounts that already see every store: the data path reads with REPORTING_API_KEY
// (every store), so admitting anyone narrower would hand them the whole chain. Managers are
// deliberately not admitted (Brian, 2026-10-14: managers do not use agent access).
export const AGENT_ROLES = new Set(['superuser', 'admin']);
export const SCOPES = ['mcp:read', 'offline_access'];

const ORIGIN = 'https://mcp.retjghub.com';
const API = 'https://api.retjghub.com/';
const SESSION_RE = /(?:^|;\s*)session=([^;]+)/;
const SET_SESSION_RE = /(?:^|[,;]\s*)session=([^;,\s]+)/;

// One rule, applied at sign-in and again at every token refresh (worker.mjs).
// stores === null means every store; an admin is a per-business role, so Bargain
// Lane must be granted too. The library refuses a userId containing ':'.
export function admitted(who) {
  return !!who && who.found === true && who.active === true && who.associate === false
    && AGENT_ROLES.has(who.role) && who.stores === null && who.bargainLane === true
    && typeof who.id === 'string' && who.id !== '' && !who.id.includes(':');
}

// Throws when the main worker cannot answer (including its 503 on a failed database
// read), so a caller can tell "refused" from "unreachable": the refresh check must not
// revoke anyone over an outage. By { id } (the hourly refresh) or { email } (sign-in);
// the email goes in a header, never the URL, which lands in logs.
export async function agentIdentity(env, { id, email }) {
  const r = await env.API.fetch(new Request(`${API}?action=agent-identity${id ? `&id=${encodeURIComponent(id)}` : ''}`, {
    headers: { 'X-API-Key': env.REPORTING_API_KEY, ...(!id && { 'X-Agent-Email': email }) },
  }));
  if (r.status !== 200) throw new Error(`agent-identity answered ${r.status}`);
  return r.json();
}

async function emailForSession(env, sid) {
  if (!sid) return null;
  const r = await env.API.fetch(new Request(`${API}?action=auth-me`, { headers: { Cookie: `session=${sid}` } }));
  if (r.status !== 200) return null;
  const me = await r.json().catch(() => null);
  return me && me.authenticated === true && typeof me.email === 'string' ? me.email : null;
}

const post = (env, action, body, cookie) => env.API.fetch(new Request(`${API}?action=${action}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
  body: JSON.stringify(body),
}));

async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── The handler ────────────────────────────────────────────────────────────
export async function authorize(request, env, ctx) {
  const url = new URL(request.url);
  if (url.pathname !== '/authorize') {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    if (request.method === 'GET') return await start(request, env, url.search);
    if (request.method !== 'POST') return message(405, 'Method not allowed', 'Start again from ChatGPT or Claude.');
    return await step(request, env, ctx);
  } catch (e) {
    if (e instanceof AuthorizationError) return message(400, 'This sign-in has expired', 'Start again from ChatGPT or Claude.');
    console.log(JSON.stringify({ event: 'mcp_authorize_error', message: String(e && e.message).slice(0, 120) }));
    return message(500, 'Something went wrong', 'Start again from ChatGPT or Claude.');
  }
}

async function step(request, env, ctx) {

  // A cross-site form post never carries our Origin; the consent handle's SameSite
  // cookie is the real guard, this is a second one. 🛑 It works only because pages
  // send Referrer-Policy: same-origin — with no-referrer a browser posts Origin: null
  // and this would refuse every real Allow (fresh-eyes review, 2026-10-13).
  const origin = request.headers.get('Origin');
  if (origin && origin !== ORIGIN) return message(403, 'Not allowed', 'This form can only be sent from this page.');

  const form = await request.formData();
  const field = (k) => String(form.get(k) || '');
  const q = field('q'), handle = field('handle'), action = field('step');
  const authReq = await parse(env, q);
  if (authReq instanceof Response) return authReq;
  const view = { handle, q, authReq };

  {
    if (action === 'deny') {
      const d = await env.OAUTH_PROVIDER.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: secure(d.headers) });
    }
    if (action === 'allow') {
      const email = await emailForSession(env, (request.headers.get('Cookie') || '').match(SESSION_RE)?.[1]);
      if (!email) return render(env, { ...view, state: 'email', error: 'You are not signed in to RETJG HUB in this browser. Use your email instead.' });
      return grant(request, env, view, email);
    }
    if (action === 'send-code') {
      const email = field('email').trim().toLowerCase();
      if (!email.includes('@')) return render(env, { ...view, state: 'email', error: 'Enter the email you sign in to RETJG HUB with.' });
      // One email per address per minute, so this page cannot be used to flood an
      // inbox. KV's 60-second minimum TTL is the window; best effort by design.
      const throttle = `retjg:code-sent:${await sha256hex(email)}`;
      if (!(await env.OAUTH_KV.get(throttle))) {
        await env.OAUTH_KV.put(throttle, '1', { expirationTtl: 60 });
        // In the background: auth-login does its database write and the email only
        // for a real account, so awaiting it would let the response time say whether
        // the address has one. Its status is logged, never shown.
        const sending = post(env, 'auth-login', { email })
          .then(r => { if (r.status !== 200) console.log(JSON.stringify({ event: 'mcp_code_send_failed', status: r.status })); })
          .catch(() => console.log(JSON.stringify({ event: 'mcp_code_send_failed', status: 'unreachable' })));
        if (ctx && ctx.waitUntil) ctx.waitUntil(sending); else await sending;
      }
      return render(env, { ...view, state: 'code', email });
    }
    if (action === 'verify') {
      const email = field('email').trim().toLowerCase();
      const code = field('code').trim();
      const failed = () => render(env, { ...view, state: 'code', email,
        error: "That code didn't work. Codes expire after 15 minutes and allow 5 tries; send a new one if you need to." });
      const r = await post(env, 'auth-verify-otp', { email, otp: code }).catch(() => null);
      if (!r || r.status !== 200) return failed();
      const sid = (r.headers.get('Set-Cookie') || '').match(SET_SESSION_RE)?.[1];
      if (!sid) return failed();
      let who;
      try { who = await emailForSession(env, sid); }
      finally { await post(env, 'auth-logout', {}, `session=${sid}`).catch(() => {}); }
      if (!who) return failed();
      return grant(request, env, view, who);
    }
    return render(env, { ...view, state: 'email' });
  }
}

// The original authorization request, re-parsed and re-validated on every step:
// allowlisted client first, then the library (exact redirect URI, PKCE S256, resource).
async function parse(env, search) {
  const params = new URLSearchParams(search);
  if (!ALLOWED_CLIENTS.has(params.get('client_id') || '')) {
    return message(400, "This sign-in link isn't from ChatGPT or Claude", 'Only those two assistants can connect to RETJG HUB.');
  }
  try {
    const authReq = await env.OAUTH_PROVIDER.parseAuthRequest(new Request(`${ORIGIN}/authorize${search}`));
    if (!ALLOWED_CLIENTS.has(authReq.clientId)) throw new Error('client changed');
    return authReq;
  } catch (e) {
    return message(400, 'This sign-in link is not valid', 'Start again from ChatGPT or Claude.');
  }
}

async function start(request, env, search) {
  const authReq = await parse(env, search);
  if (authReq instanceof Response) return authReq;
  const { handle, headers } = await env.OAUTH_PROVIDER.beginConsent(authReq);
  const email = await emailForSession(env, (request.headers.get('Cookie') || '').match(SESSION_RE)?.[1]);
  let who = null;
  if (email) { try { who = await agentIdentity(env, { email }); } catch { who = null; } }
  return render(env, { handle, q: search, authReq, state: who ? (admitted(who) ? 'signed-in' : 'refused') : 'email', who }, headers);
}

async function grant(request, env, view, email) {
  let who;
  try { who = await agentIdentity(env, { email }); }
  catch { return message(503, 'RETJG HUB is not answering', 'Try again in a minute.'); }
  if (!admitted(who)) return render(env, { ...view, state: 'refused', who: who.found ? who : { email } });
  const requested = view.authReq.scope || [];
  const scope = ['mcp:read', ...(requested.includes('offline_access') ? ['offline_access'] : [])];
  const approved = await env.OAUTH_PROVIDER.approveConsent(request, view.handle, { scope });
  if (approved.request.clientId !== view.authReq.clientId || approved.request.redirectUri !== view.authReq.redirectUri) {
    return message(400, 'This sign-in has expired', 'Start again from ChatGPT or Claude.');
  }
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: approved.request, userId: who.id, scope,
    // props are encrypted at rest; metadata is not, so no email there.
    props: { userId: who.id, email: who.email, role: who.role },
    metadata: { client: ALLOWED_CLIENTS.get(approved.request.clientId) },
  });
  const headers = secure(approved.headers);
  headers.set('Location', redirectTo);
  console.log(JSON.stringify({ event: 'mcp_oauth_granted', user: who.id, client: ALLOWED_CLIENTS.get(approved.request.clientId) }));
  return new Response(null, { status: 302, headers });
}

// ── The page ───────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function secure(headers = new Headers()) {
  const h = new Headers(headers);
  // 🛑 No form-action: browsers apply it to the 302 that follows a form post, which
  // would block the redirect back to chatgpt.com / claude.ai.
  h.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
  h.set('X-Frame-Options', 'DENY');
  h.set('Cache-Control', 'no-store');
  // 🛑 same-origin, not no-referrer: no-referrer makes a browser send Origin: null on
  // this page's own form posts, which the Origin check refuses. same-origin still
  // sends nothing to chatgpt.com / claude.ai on the redirect.
  h.set('Referrer-Policy', 'same-origin');
  h.set('X-Content-Type-Options', 'nosniff');
  return h;
}

// DESIGN.md §2: Operator dark is primary, Operator light under prefers-color-scheme.
// Values repeated as this page's own variables: it is served by retjg-mcp, not the app.
const STYLE = `
:root{--bg:#0a0f1a;--panel:#101826;--border:rgba(255,255,255,0.10);--ink:#e7ecf3;--dim:#8893a7;--bad:#ef4444;--accent:#22c55e;--onaccent:#0a0f1a;--field:#0a0f1a}
@media (prefers-color-scheme: light){:root{--bg:#f4f3ee;--panel:#ffffff;--border:rgba(20,17,10,0.14);--ink:#14110a;--dim:#6b6453;--bad:#c0392b;--accent:#22c55e;--onaccent:#14110a;--field:#fafaf6}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 Geist,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:440px;margin:48px auto;padding:0 16px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:24px}
h1{font-size:20px;margin:0 0 8px}p{margin:0 0 12px}.dim{color:var(--dim)}.bad{color:var(--bad)}
label{display:block;font-size:13px;color:var(--dim);margin:12px 0 4px}
input[type=email],input[type=text]{width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--field);color:var(--ink);font:inherit}
.row{display:flex;gap:8px;margin-top:16px}button{font:inherit;font-weight:600;padding:10px 16px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--ink);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--onaccent)}
details{margin-top:16px}summary{cursor:pointer;color:var(--dim)}
`;

function shell(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta name="color-scheme" content="dark light"><title>${esc(title)}</title><style>${STYLE}</style></head>`
    + `<body><main><div class="card">${body}</div></main></body></html>`;
}

function message(status, title, detail) {
  return new Response(shell(title, `<h1>${esc(title)}</h1><p class="dim">${esc(detail)}</p>`),
    { status, headers: secure(new Headers({ 'Content-Type': 'text/html; charset=utf-8' })) });
}

async function render(env, { handle, q, authReq, state, who, email, error }, consentHeaders) {
  const d = await env.OAUTH_PROVIDER.describeConsent(authReq);
  const client = esc(d.clientName || ALLOWED_CLIENTS.get(authReq.clientId));
  const hidden = `<input type="hidden" name="handle" value="${esc(handle)}"><input type="hidden" name="q" value="${esc(q)}">`;
  const form = (step, inner, button, primary = true) =>
    `<form method="post" action="/authorize">${hidden}<input type="hidden" name="step" value="${step}">${inner}`
    + `<div class="row"><button type="submit"${primary ? ' class="primary"' : ''}>${button}</button></div></form>`;
  const deny = form('deny', '', 'Deny', false);
  const emailForm = (value = '') => form('send-code',
    `<label for="email">Your RETJG HUB email</label><input id="email" type="email" name="email" autocomplete="email" required value="${esc(value)}">`,
    'Email me a code');
  let body = `<h1>Connect ${client} to RETJG HUB</h1>`
    + `<p class="dim">${client}${d.clientDomain ? ` (${esc(d.clientDomain)})` : ''} wants read-only access to Bargain Lane sales, `
    + `Retail Summary, Labor and Inventory data for every store, including item costs and the names of staff who logged entries. It will be sent back to <strong>${esc(d.redirectHost)}</strong>.</p>`
    + `<p class="dim">Only continue if you just started connecting ${client} yourself. If someone sent you this link, close this page.</p>`
    + (d.redirectIsLoopback ? `<p class="bad">This sends access to an app on this computer, not to ${client}'s website.</p>` : '');
  if (error) body += `<p class="bad">${esc(error)}</p>`;
  if (state === 'signed-in') {
    body += `<p>Signed in as <strong>${esc(who.email)}</strong>.</p>` + form('allow', '', 'Allow') + deny
      + `<details><summary>Use a different account</summary>${emailForm()}</details>`;
  } else if (state === 'refused') {
    body += `<p class="bad"><strong>${esc(who && who.email)}</strong> can't connect AI assistants yet: owner and admin accounts only.</p>`
      + `<p class="dim">Sign in with a different account:</p>` + emailForm() + deny;
  } else if (state === 'code') {
    body += `<p>If <strong>${esc(email)}</strong> has an account, we've emailed a 6-digit code. It works for 15 minutes.</p>`
      + form('verify', `<input type="hidden" name="email" value="${esc(email)}"><label for="code">Code</label>`
        + `<input id="code" type="text" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required>`, 'Allow')
      + form('send-code', `<input type="hidden" name="email" value="${esc(email)}">`, 'Send a new code', false) + deny;
  } else {
    body += `<p class="dim">Sign in with the account you use for RETJG HUB.</p>` + emailForm(email) + deny;
  }
  const headers = secure(consentHeaders);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(shell(`Connect ${d.clientName || 'an assistant'} to RETJG HUB`, body), { status: 200, headers });
}
