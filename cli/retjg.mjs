#!/usr/bin/env node
// retjg — a read-only command line into the RETJG HUB reporting API, for agents
// (Claude Code, Codex) and people. It wraps the three endpoints behind
// MORNING_BRIEFING_KEY (worker.js, "Reporting API"), adds no data of its own
// and can write nothing.
//
// 🔑 The key goes in the X-API-Key header and never in the URL. The worker also
// accepts ?key=, but a URL lands in shell history, proxy logs and agent
// transcripts.
//
// The interpretation rules in HELP are condensed from the API's handover doc
// (GSD/worker/API_HANDOVER.md §2). They are here because an agent reads --help
// and nothing else, and every one of them is a way to read a correct number
// wrongly.
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const BASE = process.env.RETJG_API_URL || 'https://api.retjghub.com/';
const KEYCHAIN_SERVICE = process.env.RETJG_KEYCHAIN_SERVICE || 'retjg-api-key';

const HELP = `retjg — read-only sales data for RETJG HUB (Bargain Lane stores).

Usage:
  retjg stores                              store ids and names
  retjg yesterday [--store BL1]             yesterday per store: sales, budget, WTD/MTD,
                                            last year, labor, margin, categories
  retjg today [--store BL1]                 today so far, live from the POS (~2-3 s)
  retjg history [--days 30] [--store BL1]   one row per day ending yesterday, newest first
                                            (--days caps at 400)

Output is JSON on stdout. Errors are JSON on stderr. Exit 0 = ok, 1 = the API failed or
refused, 2 = bad usage or no key.

Key: RETJG_API_KEY, or the macOS Keychain item "${KEYCHAIN_SERVICE}". Store it once with
  security add-generic-password -a "$USER" -s ${KEYCHAIN_SERVICE} -w
API: ${BASE} (override with RETJG_API_URL)

Read before drawing conclusions. The numbers are right; the obvious reading often is not.
  - Money is plain USD. Percentages and margins are fractions: 0.43 = 43%.
  - null means unknown, never zero. reportingStatus "no_data" = the figure is unverified,
    not an outage. "closed" = a real 0 (Holland, BL8, closed for good 2026-07-25).
  - netSales = posSales (the till) + auctionSales (live sales: online auction + Whatnot).
  - Compare lySalesForDate with posSales, never netSales: last year has no live sales.
  - Do not compare or trend DAILY grossMargin. Bin prices fall through the week while bin
    cost is flat, so a store swings ~27% to ~67% in a normal week. Use wtdGrossMargin.
    A negative bin or category margin late in the week is expected, not a problem.
  - grossMargin is null when costCoverage < 0.90. In history it is always null.
  - Check wtdDaysReported / mtdDaysReported before using a WTD or MTD figure.
  - laborActualPct is worked hours x a flat rate / sales, not payroll.
  - today: salesSoFarToday is till only but todayBudget includes live sales, so stores
    with live sales read ~2-4% light on pace.
`;

function fail(code, body) {
  process.stderr.write(JSON.stringify(body) + '\n');
  process.exit(code);
}

function apiKey() {
  if (process.env.RETJG_API_KEY) return process.env.RETJG_API_KEY.trim();
  if (process.platform !== 'darwin') return '';
  try {
    return execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

async function call(key, params) {
  const url = new URL(BASE);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url, { headers: { 'X-API-Key': key }, signal: AbortSignal.timeout(30000) });
  } catch (e) {
    fail(1, { error: `Could not reach ${url.origin}: ${e.message}` });
  }
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  if (!res.ok) {
    fail(1, {
      status: res.status,
      error: body?.error || text.slice(0, 200),
      ...(res.status === 401 && { hint: 'The API refused the key. Check RETJG_API_KEY or the Keychain item.' }),
    });
  }
  // A Cloudflare host answers an unknown path with the app's index.html and a
  // 200, so a wrong RETJG_API_URL looks like success unless the body is checked.
  if (!body || !Array.isArray(body.stores)) {
    fail(1, { error: `Not a reporting API response from ${url.origin}`, body: text.slice(0, 200) });
  }
  return body;
}

function onlyStore(body, store) {
  if (!store) return body;
  const id = store.trim().toUpperCase();
  const stores = body.stores.filter(s => s.storeId === id);
  if (!stores.length) fail(1, { error: `Unknown store "${store}"`, stores: body.stores.map(s => s.storeId) });
  return { ...body, stores };
}

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: { store: { type: 'string' }, days: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
  });
} catch (e) {
  process.stderr.write(e.message + '\n\n' + HELP);
  process.exit(2);
}
const { values: opts, positionals: [cmd, ...extra] } = args;

const COMMANDS = ['stores', 'yesterday', 'today', 'history'];
if (opts.help || cmd === 'help' || !cmd) {
  process.stdout.write(HELP);
  process.exit(cmd || opts.help ? 0 : 2);
}
if (!COMMANDS.includes(cmd) || extra.length) {
  process.stderr.write(`Unknown command: ${[cmd, ...extra].join(' ')}\n\n` + HELP);
  process.exit(2);
}
if (opts.days != null && !/^[1-9]\d*$/.test(opts.days)) fail(2, { error: '--days must be a positive whole number' });

const key = apiKey();
if (!key) {
  fail(2, { error: `No API key. Set RETJG_API_KEY or add the Keychain item: security add-generic-password -a "$USER" -s ${KEYCHAIN_SERVICE} -w` });
}

let out;
if (cmd === 'stores') {
  const body = await call(key, { action: 'morning-briefing' });
  out = body.stores.map(s => ({ storeId: s.storeId, name: s.name }));
} else if (cmd === 'yesterday') {
  out = onlyStore(await call(key, { action: 'morning-briefing' }), opts.store);
} else if (cmd === 'today') {
  out = onlyStore(await call(key, { action: 'afternoon-briefing' }), opts.store);
} else {
  out = await call(key, { action: 'store-history', days: opts.days, storeId: opts.store?.trim().toUpperCase() });
}
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
