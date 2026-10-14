// The emailed 6-digit sign-in code cannot be guessed.
//
// WHAT THIS PROTECTS. auth-login emails a code alongside the link, and
// auth-verify-otp turns a right code into a session. It used to check codes
// with no limit on wrong guesses, and to make them with Math.random(): anyone
// who knew a user's email could ask for a code and try the ~900k possibilities
// in its 15 minutes. Phase 2 (OAuth for agents) signs people in through it too.
//
// 🔑 The race is the real test. "Check the code, then count the miss" lets a
// burst of parallel guesses all pass the check before any count lands; here 50
// guesses go at once with the right code among them, and it must still fail.
// The harness interleaves requests at every await, as a Worker under load does.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
// The harness's magic_links is a minimal stand-in; production's (migration-004)
// also has used_at, which every sign-in path reads.
db.exec('ALTER TABLE magic_links ADD COLUMN used_at TEXT');
blockNetwork();
// Sending the email is not what is under test: answer Resend, block the rest.
env.RESEND_API_KEY = 'test-resend-key';
const blocked = globalThis.fetch;
globalThis.fetch = async (u, init) => (String(u).startsWith('https://api.resend.com/')
  ? new Response(JSON.stringify({ id: 'test' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  : blocked(u, init));

const EMAIL = 'bgeorges@retjg.com'; // an active email-login user in the harness
const post = (action, body) => worker.fetch(new Request(`https://api.retjghub.com/?action=${action}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}), env, ctx);
async function login(email = EMAIL) {
  const r = await post('auth-login', { email });
  eq(r.status, 200, 'auth-login answers 200');
  return db.prepare('SELECT token, otp_code FROM magic_links WHERE email = ? ORDER BY rowid DESC LIMIT 1').get(email);
}
const verify = (otp, email = EMAIL) => post('auth-verify-otp', { email, otp });
const wrongFor = (code) => String(code === '123456' ? 654321 : 123456);
const sessions = () => db.prepare('SELECT COUNT(*) n FROM sessions').get().n;
// auth-login sends at most one code a minute per email (test-auth-login-throttle.mjs).
// Moving every code's timestamps back stands in for "a minute later" here.
const age = (seconds) => {
  for (const r of db.prepare('SELECT token, expires_at FROM magic_links').all()) {
    db.prepare('UPDATE magic_links SET expires_at = ? WHERE token = ?')
      .run(new Date(Date.parse(r.expires_at) - seconds * 1000).toISOString(), r.token);
  }
};

// ── 1. Codes come from the CSPRNG, not Math.random ─────────────────────────
{
  const realRandom = Math.random;
  Math.random = () => 0.5; // the old code would make 550000, every time
  let a, b;
  // Each sample is a first send (rows cleared): the throttle is not under test here.
  try { a = (await login()).otp_code; db.exec('DELETE FROM magic_links'); b = (await login()).otp_code; }
  finally { Math.random = realRandom; }
  ok(/^[1-9]\d{5}$/.test(a) && /^[1-9]\d{5}$/.test(b), `codes are six digits with no leading zero (the login box is type=number): ${a}, ${b}`);
  ok(!(a === '550000' && b === '550000') && a !== b, 'codes do not follow Math.random');
  // One code in ten would start with 0 if the range slipped to 000000-999999,
  // which two samples cannot see. A hundred can (missed with p ≈ 3e-5).
  const many = [];
  for (let i = 0; i < 100; i++) { db.exec('DELETE FROM magic_links'); many.push((await login()).otp_code); }
  ok(many.every(c => /^[1-9]\d{5}$/.test(c)), `100 codes, none with a leading zero (first bad: ${many.find(c => !/^[1-9]\d{5}$/.test(c))})`);
  ok(new Set(many).size > 90, `100 codes are (nearly) all different: ${new Set(many).size}`);
  db.exec('DELETE FROM magic_links');
}

// ── 2. The right code still signs in ───────────────────────────────────────
{
  const { otp_code } = await login();
  const r = await verify(otp_code);
  eq(r.status, 200, 'the right code → 200');
  ok(/session/i.test(r.headers.get('Set-Cookie') || ''), 'and sets a session cookie');
  eq((await verify(otp_code)).status, 401, 'a used code cannot be used again');
  db.exec('DELETE FROM magic_links');
}

// ── 3. Five misses and the code is dead, even for the right code ───────────
{
  const { token, otp_code } = await login();
  for (let i = 1; i <= 5; i++) eq((await verify(wrongFor(otp_code))).status, 401, `wrong guess ${i} → 401`);
  const before = sessions();
  const r = await verify(otp_code);
  eq(r.status, 401, 'after 5 misses the RIGHT code is refused');
  ok(/too many wrong codes/i.test((await r.json()).error || ''), 'and the message says so');
  eq(sessions(), before, 'no session was created');
  eq(db.prepare('SELECT otp_attempts FROM magic_links WHERE token = ?').get(token).otp_attempts, 5, 'the code stopped counting at 5');

  // The emailed LINK is a 32-byte token nobody can guess, so it still works: a
  // stranger burning someone's code cannot lock them out.
  const link = await worker.fetch(new Request(`https://api.retjghub.com/?action=auth-verify&token=${token}`), env, ctx);
  ok(link.status === 302 && /session/i.test(link.headers.get('Set-Cookie') || ''), 'the link in the same email still signs in');
  db.exec('DELETE FROM magic_links');
}

// ── 4. Four misses still leave the right code usable ───────────────────────
{
  const { otp_code } = await login();
  for (let i = 0; i < 4; i++) await verify(wrongFor(otp_code));
  eq((await verify(otp_code)).status, 200, 'four misses, then the right code → 200 (the limit is 5 guesses in all)');
  db.exec('DELETE FROM magic_links');
}

// ── 5. Fifty guesses at once, the right one among them ─────────────────────
{
  const { token, otp_code } = await login();
  const guesses = Array.from({ length: 50 }, (_, i) => (i === 30 ? otp_code : String(100000 + i)));
  const before = sessions();
  const results = await Promise.all(guesses.map(g => verify(g)));
  ok(results.every(r => r.status === 401), 'none of 50 parallel guesses got in, though one was right');
  ok(results.every(r => !r.headers.get('Set-Cookie')), 'and none set a cookie');
  eq(sessions(), before, 'no session was created');
  eq(db.prepare('SELECT otp_attempts FROM magic_links WHERE token = ?').get(token).otp_attempts, 5, 'exactly 5 guesses were ever weighed');
  db.exec('DELETE FROM magic_links');
}

// ── 6. One live code per email, and a miss counts against every live code ──
{
  // Since 2026-10-14 a new code retires the older ones (auth-login), so asking for
  // many codes no longer multiplies the odds of a guess. Their links still work.
  const first = await login();
  age(61);
  const second = await login();
  ok(second.otp_code && second.token !== first.token, 'a minute later, a second code is sent');
  eq((await verify(first.otp_code)).status, 401, 'the code from the earlier email no longer signs in');
  eq((await verify(second.otp_code)).status, 200, 'the newest one does');
  db.exec('DELETE FROM magic_links');
}
{
  // Several live codes can still exist (rows made before the change); a miss still
  // counts against all of them.
  const exp = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const codes = ['111111', '222222', '333333'];
  codes.forEach((c, i) => db.prepare('INSERT INTO magic_links (token, email, expires_at, otp_code) VALUES (?, ?, ?, ?)').run('legacy-' + i, EMAIL, exp, c));
  for (let i = 0; i < 5; i++) await verify('100000');
  let anyIn = false;
  for (const c of codes) if ((await verify(c)).status === 200) anyIn = true;
  ok(!anyIn, 'five misses kill every outstanding code, not just one');
  age(61);
  const fresh = await login();
  eq((await verify(fresh.otp_code)).status, 200, 'a code requested afterwards works');
  db.exec('DELETE FROM magic_links');
}

// ── 7. Other emails and bad input are unaffected ───────────────────────────
{
  const mine = await login();
  for (let i = 0; i < 5; i++) await verify('100000', 'lead@bargainlane.com');
  eq((await verify(mine.otp_code)).status, 200, 'misses for another email do not touch this one');
  eq((await verify('123456', 'nobody@example.com')).status, 401, 'a guess for an email with no code is a plain 401');
  eq((await post('auth-verify-otp', { email: EMAIL })).status, 400, 'a missing code is still a 400');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
