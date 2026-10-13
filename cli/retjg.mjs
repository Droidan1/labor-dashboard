#!/usr/bin/env node
// retjg — a read-only command line into the RETJG HUB reporting API, for agents
// (Claude Code, Codex, Muse) and people. The commands come from QUERIES in
// ./reporting.mjs, the same table the retjg-mcp server's tools come from, so
// the two cannot drift. It adds no data of its own and can write nothing.
//
// 🔑 The key goes in the X-API-Key header and never in the URL. The worker also
// accepts ?key=, but a URL lands in shell history, proxy logs and agent
// transcripts.
//
// Installed as this whole directory (ORIENT.md) so the import below resolves:
// /opt/homebrew/bin/retjg is a symlink to …/lib/retjg/retjg.mjs.
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { QUERIES, READING_RULES, UsageError, QueryError, checkArgs, argSpec } from './reporting.mjs';

const BASE = process.env.RETJG_API_URL || 'https://api.retjghub.com/';
const KEYCHAIN_SERVICE = process.env.RETJG_KEYCHAIN_SERVICE || 'retjg-api-key';

const flagOf = (name) => argSpec(name).flag;
const usageLine = (q) => {
  const flags = q.args.map(({ name, required }) => {
    const s = argSpec(name);
    const v = s.type === 'enum' ? s.values.join('|') : s.type === 'date' ? 'YYYY-MM-DD' : s.type === 'integer' ? 'N' : 'BL1';
    return required ? `--${s.flag} ${v}` : `[--${s.flag} ${v}]`;
  });
  return `  retjg ${[q.cli, ...flags].join(' ')}\n      ${wrap(q.description, '      ')}`;
};
function wrap(text, indent) {
  const out = [];
  let line = '';
  for (const word of text.split(' ')) {
    if ((line + ' ' + word).length > 92 - indent.length && line) { out.push(line); line = word; }
    else line = line ? line + ' ' + word : word;
  }
  if (line) out.push(line);
  return out.join('\n' + indent);
}

const HELP = `retjg — read-only sales and labor data for RETJG HUB (Bargain Lane stores).

Usage:
${QUERIES.map(usageLine).join('\n')}

Output is JSON on stdout. Errors are JSON on stderr. Exit 0 = ok, 1 = the API failed or
refused, 2 = bad usage or no key. Dates are Eastern time.

Key: RETJG_API_KEY, or the macOS Keychain item "${KEYCHAIN_SERVICE}". Store it once with
  security add-generic-password -a "$USER" -s ${KEYCHAIN_SERVICE} -w
API: ${BASE} (override with RETJG_API_URL)

Read before drawing conclusions. The numbers are right; the obvious reading often is not.
${READING_RULES.map(r => '  - ' + wrap(r, '    ')).join('\n')}
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
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  let res;
  try {
    res = await fetch(url, { headers: { 'X-API-Key': key }, signal: AbortSignal.timeout(60000) });
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
      ...(body && typeof body === 'object' && Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'error'))),
      ...(res.status === 401 && { hint: 'The API refused the key. Check RETJG_API_KEY or the Keychain item.' }),
    });
  }
  // A Cloudflare host answers an unknown path with the app's index.html and a
  // 200, so a wrong RETJG_API_URL looks like success unless the body is checked.
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail(1, { error: `Not a reporting API response from ${url.origin}`, body: text.slice(0, 200) });
  }
  return body;
}

// Every flag any command takes, as a string; each command then accepts only its own.
const FLAGS = Object.fromEntries([...new Set(QUERIES.flatMap(q => q.args.map(a => flagOf(a.name))))]
  .map(f => [f, { type: 'string' }]));
let parsed;
try {
  parsed = parseArgs({ allowPositionals: true, options: { ...FLAGS, help: { type: 'boolean', short: 'h' } } });
} catch (e) {
  process.stderr.write(e.message + '\n\n' + HELP);
  process.exit(2);
}
const { values: opts, positionals: [cmd, ...extra] } = parsed;

if (opts.help || cmd === 'help' || !cmd) {
  process.stdout.write(HELP);
  process.exit(cmd || opts.help ? 0 : 2);
}
const query = QUERIES.find(q => q.cli === cmd);
if (!query || extra.length) {
  process.stderr.write(`Unknown command: ${[cmd, ...extra].join(' ')}\n\n` + HELP);
  process.exit(2);
}

// Flags → the query's arguments. A flag this command does not take is refused.
const args = {};
const byFlag = Object.fromEntries(query.args.map(a => [flagOf(a.name), a.name]));
for (const [flag, value] of Object.entries(opts)) {
  if (flag === 'help' || value === undefined) continue;
  const name = byFlag[flag];
  if (!name) fail(2, { error: `retjg ${cmd} does not take --${flag}. It takes: ${Object.keys(byFlag).map(f => '--' + f).join(', ') || 'no flags'}` });
  args[name] = argSpec(name).type === 'integer' && /^-?\d+$/.test(value) ? Number(value) : value;
}
try {
  checkArgs(query, args);
} catch (e) {
  // The table names arguments as the MCP does (storeId); say them as flags here (--store).
  if (e instanceof UsageError) fail(2, { error: e.message.replace(/^(\w+)/, (m) => (argSpec(m) ? `--${argSpec(m).flag}` : m)) });
  throw e;
}

const key = apiKey();
if (!key) {
  fail(2, { error: `No API key. Set RETJG_API_KEY or add the Keychain item: security add-generic-password -a "$USER" -s ${KEYCHAIN_SERVICE} -w` });
}

let out;
try {
  out = query.shape(await call(key, query.request(args)), args);
} catch (e) {
  if (e instanceof QueryError) fail(1, { error: e.message, ...e.extra });
  throw e;
}
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
