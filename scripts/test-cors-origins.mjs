// Who may read a credentialed response from this API.
//
// 🔑 WHY THIS SUITE EXISTS AT ALL. Nothing tested resolveCors before — 75 suites and
// not one of them sent an `Origin` header, so the CORS allowlist was the only
// security boundary in the worker with no coverage whatsoever. It got noticed
// because migration-068 made associate-reveal-pin return a live login code, which
// turned a pre-existing "any localhost page can read your user list" into "any
// localhost page can read an associate's code".
//
// 🛑 THE DEFAULT ENV HERE IS PRODUCTION-SHAPED. makeEnv() sets neither APP_ORIGIN
// nor API_ORIGIN, exactly as production leaves them unset. That is the right
// default for a guard like this, but it means a test that forgets to opt in to the
// staging shape silently only ever exercises production. Every case below states
// which shape it is in.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let assertions = 0, failures = 0;
const ok = (c, m) => { assertions++; if (!c) { failures++; console.error('  FAIL ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

blockNetwork();
const worker = await loadWorker(repo);

// An OPTIONS preflight is the cleanest probe: resolveCors runs and the handler
// returns those headers immediately, before any auth, so this measures the CORS
// decision itself rather than a decision plus a session.
async function preflight(origin, { staging = false } = {}) {
  const { env } = makeEnv(repo);
  // Production leaves these unset; staging sets both in [env.staging.vars].
  if (staging) { env.APP_ORIGIN = 'https://staging.retjghub.com'; env.API_ORIGIN = 'https://api-staging.retjghub.com'; }
  const r = await worker.fetch(new Request('https://api.retjghub.com/?action=list-users', {
    method: 'OPTIONS', headers: origin === null ? {} : { Origin: origin },
  }), env, ctx);
  return {
    allowOrigin: r.headers.get('Access-Control-Allow-Origin'),
    allowCreds: r.headers.get('Access-Control-Allow-Credentials'),
    vary: r.headers.get('Vary'),
  };
}

console.log('CORS origins');

// ── 1. The real hosts are allowed in BOTH shapes ───────────────────────────
// The fix must not cost the app its own front end, which is the failure mode of
// every over-tightened allowlist.
{
  for (const origin of ['https://www.retjghub.com', 'https://retjghub.com', 'https://staging.retjghub.com']) {
    for (const staging of [false, true]) {
      const h = await preflight(origin, { staging });
      const where = staging ? 'staging' : 'production';
      eq(h.allowOrigin, origin, `✅ ${origin} is allowed on ${where}`);
      eq(h.allowCreds, 'true', `...with credentials on ${where}`);
    }
  }
}

// ── 2. 🛑 Localhost is REFUSED in production ───────────────────────────────
// The point of the change. A page on the viewer's own machine must not be able to
// read a credentialed response — least of all associate-reveal-pin's.
{
  for (const origin of ['http://localhost:8788', 'http://localhost', 'https://localhost:3000',
                        'http://127.0.0.1:5500', 'http://127.0.0.1']) {
    const h = await preflight(origin);
    eq(h.allowOrigin, null, `🛑 ${origin} gets NO Allow-Origin in production`);
    eq(h.allowCreds, null, `🛑 ...and NO Allow-Credentials, which is the half that matters`);
  }
}

// ── 3. ...and still allowed on staging, so local dev survives ──────────────
// README.md documents `npx wrangler pages dev dist` on localhost:8788. A guard that
// refuses everyone passes section 2 perfectly and is still wrong.
{
  for (const origin of ['http://localhost:8788', 'http://127.0.0.1:5500']) {
    const h = await preflight(origin, { staging: true });
    eq(h.allowOrigin, origin, `✅ ${origin} still works against staging`);
    eq(h.allowCreds, 'true', `...with credentials, or the cookie never arrives`);
  }
}

// ── 4. Things that merely LOOK like localhost ──────────────────────────────
// 🛑 The regex is anchored at both ends. These are the shapes that would slip past
// a `startsWith`/`includes` version of the same check, and they must be refused in
// BOTH environments — on staging too, because an attacker can register a domain.
{
  for (const origin of [
    'http://localhost.evil.com',        // a subdomain of an attacker's domain
    'http://evil.com/localhost',        // path, not host
    'https://notlocalhost:8788',
    'http://localhost:8788.evil.com',
    'http://127.0.0.1.evil.com',
    'http://localhost:abc',             // not a numeric port
    'http://[::1]:8788',                // IPv6 loopback is NOT in the regex
  ]) {
    for (const staging of [false, true]) {
      const h = await preflight(origin, { staging });
      const where = staging ? 'staging' : 'production';
      eq(h.allowOrigin, null, `🛑 ${origin} is refused on ${where}`);
    }
  }
}

// ── 5. No Origin, and a junk Origin ────────────────────────────────────────
{
  const none = await preflight(null);
  eq(none.allowOrigin, null, 'a request with no Origin gets no Allow-Origin');
  const empty = await preflight('');
  eq(empty.allowOrigin, null, 'nor does an empty one');
  // 🛑 The empty string must never be echoed back as an allowed origin.
  ok(empty.allowOrigin !== '', '🛑 and an empty Origin is not echoed as allowed');
}

// ── 6. Vary: Origin, always ────────────────────────────────────────────────
// 🔑 Without it a shared cache can serve an allowed origin's response — headers and
// all — to a different origin, which would hand back the very grant this removes.
{
  for (const [origin, staging] of [['https://www.retjghub.com', false], ['http://localhost:8788', false],
                                   ['http://localhost:8788', true], [null, false]]) {
    const h = await preflight(origin, { staging });
    eq(h.vary, 'Origin', `Vary: Origin is set for ${JSON.stringify(origin)} (staging=${staging})`);
  }
}

// ── 7. The environment test is the one wrangler.toml actually makes ────────
// 🛑 A source check, and it says so. If someone adds APP_ORIGIN to the top-level
// [vars] in wrangler.toml, production becomes "not production" by this test and
// localhost is admitted again — silently, with every assertion above still green,
// because the suite sets env by hand. Pin the config, not just the code.
{
  const fs = await import('node:fs');
  const toml = fs.readFileSync(path.join(repo, 'wrangler.toml'), 'utf8');
  const topLevel = toml.slice(toml.indexOf('[vars]'), toml.indexOf('[env.staging]'));
  ok(!/^\s*APP_ORIGIN\s*=/m.test(topLevel),
     '🛑 APP_ORIGIN is NOT set in the top-level [vars] — production must stay unset');
  ok(/^\s*APP_ORIGIN\s*=/m.test(toml.slice(toml.indexOf('[env.staging.vars]'))),
     '🔑 ...and IS set under [env.staging.vars], which is what makes staging "not production"');

  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const at = src.indexOf('function resolveCors(');
  const fn = src.slice(at, src.indexOf('\n}', at));
  ok(/env && env\.APP_ORIGIN/.test(fn), 'resolveCors derives the environment from APP_ORIGIN');
  ok(/!isProd && LOCALHOST_RE\.test\(origin\)/.test(fn), '...and only then consults LOCALHOST_RE');
  ok(/resolveCors\(request, env\)/.test(src), '🛑 and the call site passes env — without it every env reads as production');
}

console.log(failures ? `\n${failures} of ${assertions} FAILED` : `\n${assertions} passed, 0 failed`);
process.exit(failures ? 1 : 0);
