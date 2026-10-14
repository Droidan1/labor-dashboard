// auth-login: how often a sign-in code can be sent, and that only the newest works.
//
// WHAT THIS PROTECTS. The emailed 6-digit code now leads to a 30-day chain-wide
// OAuth token (retjg-mcp, phase 2a). auth-login had no limit, so anyone could flood
// an inbox, and one email could hold many live codes at once — and every guess is
// weighed against all of them, so asking for N codes multiplied the odds by N.
//
// 🔑 The burst is the real test: 20 requests at once must still create ONE code.
// "Count, then insert" lets them all pass the count; the cap has to live in the
// insert itself. The harness interleaves requests at every await, as a Worker does.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

// A clock the test moves. new Date(arg) still behaves normally.
const RealDate = globalThis.Date;
let nowMs = RealDate.parse('2026-10-14T13:00:00Z');
class Clock extends RealDate {
  constructor(...a) { return a.length === 0 ? new RealDate(nowMs) : new RealDate(...a); }
  static now() { return nowMs; }
}
globalThis.Date = Clock;
const later = (s) => { nowMs += s * 1000; };

const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
db.exec('ALTER TABLE magic_links ADD COLUMN used_at TEXT'); // production has it (migration-004)
blockNetwork();
env.RESEND_API_KEY = 'test-resend-key';
const blocked = globalThis.fetch;
const mails = [];
globalThis.fetch = async (u, init) => (String(u).startsWith('https://api.resend.com/')
  ? (mails.push(JSON.parse(init.body).to), new Response('{"id":"m"}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
  : blocked(u, init));

const EMAIL = 'bgeorges@retjg.com';
const post = (action, body) => worker.fetch(new Request(`https://api.retjghub.com/?action=${action}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}), env, ctx);
const login = (email = EMAIL) => post('auth-login', { email });
const codes = (email = EMAIL) => db.prepare('SELECT token, otp_code FROM magic_links WHERE email = ? AND otp_code IS NOT NULL ORDER BY rowid').all(email);
const sentTo = (email = EMAIL) => mails.filter(t => (Array.isArray(t) ? t : [t]).includes(email)).length;
const verify = (otp, email = EMAIL) => post('auth-verify-otp', { email, otp });
const link = (token) => worker.fetch(new Request(`https://api.retjghub.com/?action=auth-verify&token=${token}`), env, ctx);

// ── 1. One code per minute, and a throttled request looks the same ─────────
{
  const first = await login();
  eq([first.status, await first.json()], [200, { ok: true }], 'the first request sends a code');
  eq([codes().length, sentTo()], [1, 1], 'one code, one email');
  later(10);
  const again = await login();
  eq([again.status, await again.json()], [200, { ok: true }], 'a second request inside a minute answers exactly the same');
  eq([codes().length, sentTo()], [1, 1], 'but creates and sends nothing');
}

// ── 2. A new code retires the old one; the old LINK still works ────────────
{
  later(61);
  const [old] = codes();
  await login();
  eq([codes().length, sentTo()], [2, 2], 'after a minute, a second code is sent');
  const [, fresh] = codes();
  eq((await verify(old.otp_code)).status, 401, 'the older code no longer signs in');
  const r = await link(old.token);
  ok(r.status === 302 && /session/i.test(r.headers.get('Set-Cookie') || ''), 'but the link in that older email still does (a link cannot be guessed)');
  eq((await verify(fresh.otp_code)).status, 200, 'and the newest code works');
}

// ── 3. At most 5 an hour ───────────────────────────────────────────────────
{
  db.exec('DELETE FROM magic_links'); mails.length = 0;
  for (let i = 0; i < 7; i++) { await login(); later(61); }
  eq([codes().length, sentTo()], [5, 5], 'seven requests a minute apart: five codes in the hour, not seven');
  later(3600);
  await login();
  eq(codes().length, 6, 'an hour later, another is allowed');
}

// ── 4. At most 10 a day ────────────────────────────────────────────────────
{
  db.exec('DELETE FROM magic_links'); mails.length = 0;
  for (let h = 0; h < 4; h++) { for (let i = 0; i < 5; i++) { await login(); later(61); } later(3600); }
  eq(codes().length, 10, 'four hours of trying: ten codes in the day, not twenty');
  later(24 * 3600);
  await login();
  eq(codes().length, 11, 'the next day, another is allowed');
}

// ── 5. A burst creates exactly one ─────────────────────────────────────────
{
  db.exec('DELETE FROM magic_links'); mails.length = 0;
  later(25 * 3600);
  const all = await Promise.all(Array.from({ length: 20 }, () => login()));
  ok(all.every(r => r.status === 200), 'twenty requests at once all answer 200');
  eq([codes().length, sentTo()], [1, 1], 'and exactly one code is created and sent');
}

// ── 6. Unknown, associates and other people ────────────────────────────────
{
  later(25 * 3600);
  const n = mails.length;
  const u = await login('nobody@example.com');
  eq([u.status, await u.json()], [200, { ok: true }], 'an unknown email gets the same answer');
  eq([codes('nobody@example.com').length, mails.length], [0, n], 'and nothing is created or sent');
  for (let i = 0; i < 3; i++) await login();
  await login('howardbrian260@gmail.com');
  eq(sentTo('howardbrian260@gmail.com'), 1, "one person's throttle does not touch another's");
  // Invites (resend-invite) write magic_links rows with no code; they must not count.
  db.prepare("INSERT INTO magic_links (token, email, expires_at) VALUES ('invite-1', ?, ?)").run('owner@retjg.com', new RealDate(nowMs + 7 * 864e5).toISOString());
  await login('owner@retjg.com');
  eq(sentTo('owner@retjg.com'), 1, 'an invite row does not count as a code sent');
}

globalThis.Date = RealDate;
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
