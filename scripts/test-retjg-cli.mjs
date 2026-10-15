// cli/retjg.mjs — the read-only command line agents use to reach the reporting API.
//
// WHY END TO END. The CLI is a thin layer, so everything that can go wrong with
// it is wiring: the header name the worker's gate reads, the query params each
// handler reads, whether the key leaks into a URL, whether a missing key still
// fires a request. A test of the CLI against a stub server would encode my
// belief about the worker's contract, which is exactly what could be wrong. So
// the real CLI runs as a subprocess against the REAL worker (worker.fetch behind
// a local HTTP server); only the platform is stubbed, as everywhere else.
//
// ⚠️ The CLI must run with execFile (async), never execFileSync: the server is in
// this process, so a blocking call would wait forever on a server that cannot
// answer.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, blockNetwork, applyMigrationAlters } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(repo, 'cli', 'retjg.mjs');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const KEY = 'test-briefing-key';
const todayET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const _y = new Date(todayET + 'T12:00:00Z');
_y.setUTCDate(_y.getUTCDate() - 1);
const yesterdayET = _y.toISOString().slice(0, 10);

const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
env.MORNING_BRIEFING_KEY = KEY;
blockNetwork();

db.exec('DELETE FROM daily_sales');
db.prepare(`INSERT INTO daily_sales (store, date, total, auction, budget, order_count, snapshot_time)
            VALUES (?, ?, ?, ?, ?, ?, ?)`)
  .run('BL2', yesterdayET, 4364.39, null, 4556, 238, yesterdayET + 'T07:55:00Z');

// Inventory (2026-10-15): one truck, and a 1,001-item BL2 catalog so `items` needs two
// Clover pages. Clover is stubbed in THIS process, where the worker runs.
db.exec(fs.readFileSync(path.join(repo, 'migration-065.sql'), 'utf8'));
applyMigrationAlters(db, repo);
const truckId = db.prepare(`INSERT INTO trucks (store, bol_no, opened_by, opened_at) VALUES ('BL2', 'BOL-CLI', 'Sam', ?)`)
  .run(new Date().toISOString()).lastInsertRowid;
env.BL2_MERCHANT_ID = 'M2';
env.BL2_API_TOKEN = 'clover-token-bl2';
const blockedFetch = globalThis.fetch;
globalThis.fetch = async (u, init) => {
  const s = String(u);
  if (!s.startsWith('https://api.clover.com/v3/merchants/M2/items?')) return blockedFetch(u, init);
  const offset = Number(new URL(s).searchParams.get('offset'));
  const elements = Array.from({ length: offset === 0 ? 1000 : 1 }, (_, i) => ({ id: `I${offset + i}`, name: `Item ${offset + i}`, code: `C${offset + i}`, price: 100 }));
  return new Response(JSON.stringify({ elements }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

// Every request the worker sees, so the tests can assert on what the CLI SENT.
const seen = [];
const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/html/')) {
    // What a Cloudflare host returns for a path it does not have: the app shell, 200.
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end('<!doctype html><title>RETJG HUB</title>');
  }
  seen.push({ url: req.url, headers: req.headers });
  const r = await worker.fetch(new Request('https://api.retjghub.com' + req.url, {
    method: req.method, headers: req.headers,
  }), env, ctx);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(await r.text());
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// A Keychain service that cannot exist, so a key the developer stored in their
// real Keychain can never make a "no key" case pass by accident.
const NO_KEYCHAIN = 'retjg-test-absent-' + process.pid;

function run(args, { key = KEY, base = BASE } = {}) {
  const childEnv = { PATH: process.env.PATH, HOME: process.env.HOME, RETJG_API_URL: base, RETJG_KEYCHAIN_SERVICE: NO_KEYCHAIN };
  if (key != null) childEnv.RETJG_API_KEY = key;
  return new Promise(resolve => {
    execFile(process.execPath, [CLI, ...args], { env: childEnv, timeout: 30000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr });
    });
  });
}
const json = (s) => { try { return JSON.parse(s); } catch { return null; } };

// ── Usage errors exit 2 and send nothing ─────────────────────────────────
{
  const h = await run(['--help']);
  eq(h.code, 0, '--help exits 0');
  ok(h.stdout.includes('retjg yesterday') && h.stdout.includes('Compare lySalesForDate with posSales'),
    '--help lists the commands AND the interpretation rules agents need');
  eq((await run([])).code, 2, 'no command exits 2');
  eq((await run(['sales'])).code, 2, 'unknown command exits 2');
  eq((await run(['history', '--days', '0'])).code, 2, '--days 0 is refused');
  eq((await run(['history', '--days', 'ten'])).code, 2, '--days that is not a number is refused');
  eq((await run(['yesterday', '--colour'])).code, 2, 'unknown flag exits 2');
  eq(seen.length, 0, 'no usage error reached the API');
}

// ── No key: refused locally, before any request ──────────────────────────
{
  const r = await run(['yesterday'], { key: null });
  eq(r.code, 2, 'no key exits 2');
  ok(/RETJG_API_KEY/.test(r.stderr) && /security add-generic-password/.test(r.stderr), 'no-key error says how to add one');
  eq(seen.length, 0, 'no request is sent without a key');
}

// ── Wrong key: the worker's gate refuses it ──────────────────────────────
{
  const r = await run(['yesterday'], { key: 'not-the-key' });
  eq(r.code, 1, 'wrong key exits 1');
  eq(json(r.stderr)?.status, 401, 'wrong key reports the 401');
  ok(/refused the key/.test(json(r.stderr)?.hint || ''), 'wrong key carries a hint');
}

// ── yesterday ────────────────────────────────────────────────────────────
{
  const before = seen.length;
  const r = await run(['yesterday']);
  eq(r.code, 0, 'yesterday exits 0 with the right key — so the header the CLI sends is the one the gate reads');
  const body = json(r.stdout);
  eq(body?.salesDate, yesterdayET, 'yesterday covers yesterday ET');
  eq(body?.stores?.length, 6, 'yesterday returns every store');
  eq(body?.stores?.find(s => s.storeId === 'BL2')?.netSales, 4364.39, 'yesterday carries the stored figure through');
  const sent = seen[before];
  eq(new URL(sent.url, BASE).searchParams.get('action'), 'morning-briefing', 'yesterday calls morning-briefing');
  eq(sent.headers['x-api-key'], KEY, 'the key travels in X-API-Key');

  const one = json((await run(['yesterday', '--store', ' bl2 '])).stdout);
  eq(one?.stores?.length, 1, '--store narrows yesterday to one store');
  eq(one?.stores?.[0]?.storeId, 'BL2', '--store is case- and space-insensitive');

  const bad = await run(['yesterday', '--store', 'BL99']);
  eq(bad.code, 1, 'unknown --store exits 1');
  ok(json(bad.stderr)?.stores?.includes('BL2'), 'unknown --store lists the valid ids');
}

// ── stores ───────────────────────────────────────────────────────────────
{
  const r = json((await run(['stores'])).stdout);
  ok(Array.isArray(r) && r.length === 6, 'stores lists every store');
  ok(r?.some(s => s.storeId === 'BL2' && s.name === 'South Bend'), 'stores pairs ids with names');
  ok(r?.every(s => Object.keys(s).join() === 'storeId,name'), 'stores returns only id and name');
}

// ── history ──────────────────────────────────────────────────────────────
{
  const before = seen.length;
  const r = await run(['history', '--days', '5', '--store', 'bl2']);
  eq(r.code, 0, 'history exits 0');
  const q = new URL(seen[before].url, BASE).searchParams;
  eq(q.get('action'), 'store-history', 'history calls store-history');
  eq(q.get('days'), '5', 'history passes --days');
  eq(q.get('storeId'), 'BL2', 'history passes --store upper-cased');
  const body = json(r.stdout);
  eq(body?.stores?.length, 1, 'history returns the one store');
  eq(body?.stores?.[0]?.days?.length, 5, 'history returns --days rows');
  eq(body?.stores?.[0]?.days?.[0]?.date, yesterdayET, 'history ends yesterday');

  const all = await run(['history']);
  eq(new URL(seen.at(-1).url, BASE).searchParams.has('days'), false, 'history without --days leaves the default to the API');
  eq(json(all.stdout)?.stores?.length, 6, 'history without --store returns every store');

  const bad = await run(['history', '--store', 'BL99']);
  eq(bad.code, 1, 'history with an unknown store exits 1');
  eq(json(bad.stderr)?.status, 404, 'history reports the API 404');
}

// ── today ────────────────────────────────────────────────────────────────
{
  const before = seen.length;
  const r = await run(['today', '--store', 'BL1']);
  eq(r.code, 0, 'today exits 0');
  eq(new URL(seen[before].url, BASE).searchParams.get('action'), 'afternoon-briefing', 'today calls afternoon-briefing');
  const body = json(r.stdout);
  eq(body?.salesDate, todayET, 'today covers today ET');
  eq(body?.stores?.length, 1, '--store narrows today');
  // The harness has no Clover credentials and blocks the network, so the
  // worker cannot vouch for a figure: null + no_data, never a fake 0.
  eq(body?.stores?.[0]?.salesSoFarToday, null, 'today passes an unverified figure through as null');
}

// ── The Retail Summary and Labor commands (shared table, cli/reporting.mjs) ─
{
  const before = seen.length;
  const r = await run(['labor-plan', '--week', '2026-10-17', '--store', 'bl2']);
  eq(r.code, 0, 'labor-plan exits 0');
  const q = new URL(seen[before].url, BASE).searchParams;
  eq([q.get('action'), q.get('week'), q.get('store')].join(), 'labor-plan,2026-10-17,BL2', 'labor-plan maps --week and --store to the worker\'s params');
  ok(json(r.stdout)?.byStore?.BL2, 'labor-plan prints the plan for the store');

  const s = await run(['summary', '--from', '2026-10-01', '--to', '2026-10-02']);
  eq(s.code, 0, 'summary exits 0');
  ok(json(s.stdout)?.stores && json(s.stdout)?.company, 'summary prints company and store totals');

  const n = seen.length;
  const missing = await run(['categories', '--from', '2026-10-01', '--to', '2026-10-02']);
  eq(missing.code, 2, 'categories without --store exits 2');
  ok(/--store is required/.test(missing.stderr), 'and names the missing flag as a flag');
  const foreign = await run(['labor', '--days', '5']);
  eq(foreign.code, 2, 'a flag the command does not take exits 2');
  ok(/does not take --days/.test(foreign.stderr), 'and says which flag');
  eq((await run(['weeks', '--weeks', '0'])).code, 2, '--weeks 0 is refused');
  eq((await run(['labor-plan', '--week', '2026-10-16'])).code, 2, 'a --week that is not a Saturday is refused');
  eq(seen.length, n, 'no refused command reached the API');
}

// ── Inventory commands ───────────────────────────────────────────────────
{
  const h = await run(['--help']);
  ok(h.stdout.includes('retjg items --store BL1 [--search TEXT]'), '--help shows items, with TEXT for a search (not a store id)');
  const n = seen.length;
  const r = await run(['items', '--store', 'bl2', '--limit', '2']);
  const out = json(r.stdout);
  eq(r.code, 0, 'retjg items exits 0');
  eq(JSON.stringify([out?.items, out?.rows?.length]), '[1001,2]', 'and reads BOTH Clover pages (1,001 items), listing 2');
  eq(seen.slice(n).map(s => new URL(s.url, BASE).searchParams.get('offset')).join(), '0,1000', 'as two requests, offset 0 then 1000');
  const none = await run(['truck']);
  eq(none.code, 2, 'retjg truck with neither flag exits 2');
  ok(/--truck/.test(none.stderr) && /--store/.test(none.stderr), 'and names the two flags it takes');
  const one = json((await run(['truck', '--truck', String(truckId)])).stdout);
  eq(one?.truck?.bol_no, 'BOL-CLI', 'retjg truck --truck N reads that truck');
}

// ── The key never appears in a URL ───────────────────────────────────────
ok(seen.length > 0 && seen.every(s => !new URL(s.url, BASE).searchParams.has('key') && !s.url.includes(KEY)),
  `the key was never put in a URL (${seen.length} requests checked)`);

// ── A wrong or unreachable API URL fails loudly ──────────────────────────
{
  const html = await run(['yesterday'], { base: BASE + 'html/' });
  eq(html.code, 1, 'an HTML 200 (wrong RETJG_API_URL) exits 1, not 0');
  ok(/Not a reporting API response/.test(html.stderr), 'an HTML 200 is reported as the wrong host');

  const down = await run(['yesterday'], { base: 'http://127.0.0.1:1/' });
  eq(down.code, 1, 'an unreachable API exits 1');
  ok(/Could not reach/.test(down.stderr), 'an unreachable API says so');
}

server.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
