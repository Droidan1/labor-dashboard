// update_supply_request (mcp/writes.mjs) and the main worker's agent door (worker.js
// AGENT_WRITE_ACTIONS), driven end to end: the real MCP worker → service binding → the
// real main worker over the harness's sqlite D1, with Resend captured.
//
// WHAT THIS PROTECTS. Brian (2026-10-30): an agent that sees his order confirmation
// records the cost and marks the request ordered, so the store manager is told. The MCP
// was read-only until now and the reporting key is shared (Chief of Staff, the CLI), so
// the things that matter are the doors: only the new key, only these two actions, only a
// superuser, only Claude's static-key connector (OAuth's consent says read-only). And
// the write must be the page's own: history, the manager's email, cost on the row.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadWorker, makeEnv, stubWorkersRuntime } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const say = console.log.bind(console);  // console.log is captured below
const ok = (c, m) => { if (c) pass++; else { fail++; say('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const UP = 'test-briefing-key', MCP = 'test-mcp-key', WK = 'test-agent-write-key';
const main = await loadWorker(repo);
const { db, env: mainEnv } = makeEnv(repo);
mainEnv.MORNING_BRIEFING_KEY = UP;
mainEnv.AGENT_WRITE_KEY = WK;
mainEnv.RESEND_API_KEY = 're_test';
db.exec(fs.readFileSync(path.join(repo, 'migration-011.sql'), 'utf8'));

// Resend captured; every other outbound fetch refused.
const emails = [];
globalThis.fetch = async (u, opts = {}) => {
  if (String(u) === 'https://api.resend.com/emails') {
    emails.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ id: 'em_' + emails.length }), { status: 200 });
  }
  throw new Error('outbound fetch blocked in harness: ' + String(u).slice(0, 80));
};
const pending = [];
const ctx = { waitUntil: (p) => { pending.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException: () => {} };
const settle = async () => { while (pending.length) await pending.shift(); };
const logs = [];
const realLog = console.log;
console.log = (...a) => { logs.push(a.map(String).join(' ')); };

// Users the door must refuse, beside the harness's admin and managers.
db.prepare(`INSERT INTO users (id,email,role,stores,status,created_at) VALUES ('u-su-off','gone@bargainlane.com','superuser',null,'suspended','2026-01-01')`).run();
db.prepare(`INSERT INTO users (id,email,role,stores,status,created_at,pin_hash) VALUES ('u-su-pin','pin@bargainlane.com','superuser',null,'active','2026-01-01','x')`).run();

const R1 = 'a'.repeat(32), R2 = 'b'.repeat(32), R3 = 'c'.repeat(32);
const ins = db.prepare(`INSERT INTO supply_requests (id, user_id, user_email, store, status, priority, invoice_number, cost, notes, submitted_at, updated_at)
  VALUES (?,?,?,?,?,'normal',?,?,?,?,?)`);
const now = new Date().toISOString();
ins.run(R1, 'u-mgr1', 'howardbrian260@gmail.com', 'BL1', 'pending', null, null, 'Mop heads please', now, now);
ins.run(R2, 'u-mgr2', 'alyson@bargainlane.com', 'BL4', 'ordered', 'OLD-1', 50, 'Tape', now, now);
ins.run(R3, 'u-mgr1', 'howardbrian260@gmail.com', 'BL1', 'under_review', null, null, 'Bags', now, now);
db.prepare(`INSERT INTO supply_request_items (id, request_id, category, item_name, quantity, unit) VALUES ('it1', ?, 'Cleaning', 'Mop head', 6, 'units')`).run(R1);
const row = (id) => db.prepare('SELECT status, cost, invoice_number FROM supply_requests WHERE id = ?').get(id);
const hist = (id) => db.prepare("SELECT type, changed_by_id, changed_by_email, old_status, new_status, note FROM supply_request_history WHERE request_id = ? ORDER BY rowid").all(id);

// ── The MCP worker, bound to the real main worker ──────────────────────────
await stubWorkersRuntime();
const { default: mcp, PROVIDER_OPTIONS } = await import(pathToFileURL(path.join(repo, 'mcp', 'worker.mjs')).href);
const upstream = [];
let failFulfillment = false, failReadBack = false, wrote = false;
const env = { MCP_KEY: MCP, REPORTING_API_KEY: UP, AGENT_WRITE_KEY: WK, MCP_KEY_USER: 'u-su',
  API: { fetch: async (r) => {
    const body = r.method === 'GET' ? null : await r.clone().text();
    upstream.push({ url: r.url, method: r.method, key: r.headers.get('X-API-Key'), wk: r.headers.get('X-Agent-Write-Key'),
      user: r.headers.get('X-Agent-User'), auth: r.headers.get('Authorization'), body });
    if (failFulfillment && r.url.includes('supply-request-fulfillment')) return new Response(JSON.stringify({ error: 'D1 down' }), { status: 500 });
    if (r.method === 'PATCH') wrote = true;
    if (failReadBack && wrote && r.method === 'GET') return new Response(JSON.stringify({ error: 'read down' }), { status: 500 });
    return main.fetch(r, mainEnv, ctx);
  } } };
let id = 1;
const seen = [];
async function rpc(method, params = {}, e = env) {
  const r = await mcp.fetch(new Request('https://mcp.retjghub.com/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + MCP },
    body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }),
  }), e, ctx);
  const text = await r.text();
  seen.push(text);
  return JSON.parse(text);
}
async function tool(args, e = env) {
  const res = (await rpc('tools/call', { name: 'update_supply_request', arguments: args }, e)).result;
  await settle();
  if (!res) return { noResult: true };
  return res.isError ? { isError: true, text: res.content[0].text } : JSON.parse(res.content[0].text);
}
const patches = (from) => upstream.slice(from).filter(u => u.method === 'PATCH');

// ── 1. Who is offered the tool ─────────────────────────────────────────────
{
  const names = (e) => rpc('tools/list', {}, e).then(b => b.result.tools.map(t => t.name));
  const all = await names(env);
  eq(all.length, 23, 'static key + MCP_KEY_USER + AGENT_WRITE_KEY → the 22 reads and the write');
  eq(all.at(-1), 'update_supply_request', 'the write tool is listed last');
  const t = (await rpc('tools/list')).result.tools.at(-1);
  eq(t.annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, 'and marked as a write');
  ok(!(await names({ ...env, MCP_KEY_USER: undefined })).includes('update_supply_request'), 'no MCP_KEY_USER → not offered');
  ok(!(await names({ ...env, AGENT_WRITE_KEY: undefined })).includes('update_supply_request'), 'no AGENT_WRITE_KEY → not offered');
  const n = upstream.length;
  const r = await rpc('tools/call', { name: 'update_supply_request', arguments: { requestId: R1, status: 'ordered' } }, { ...env, MCP_KEY_USER: undefined });
  eq(r.error?.code, -32602, 'calling it when not offered → unknown tool');
  eq(upstream.length, n, 'and nothing went upstream');

  // OAuth: the library has verified the token and hands oauthMcp the grant's props. Even a
  // superuser's grant, with writes configured, is read-only: the consent screen says so.
  const oauth = (method) => PROVIDER_OPTIONS.apiHandler.fetch(new Request('https://mcp.retjghub.com/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params: method === 'tools/call' ? { name: 'update_supply_request', arguments: { requestId: R1, status: 'ordered' } } : {} }),
  }), env, { props: { userId: 'u-su', role: 'superuser', email: 'bhoward@bargainlane.com' }, auth: { scope: ['mcp:read'], clientId: 'chatgpt' } }).then(x => x.json());
  const ol = await oauth('tools/list');
  eq(ol.result?.tools?.length, 22, 'an OAuth superuser is offered the 22 reads only');
  ok(ol.result?.tools?.every(x => x.annotations.readOnlyHint === true), 'all read-only');
  eq((await oauth('tools/call')).error?.code, -32602, 'and cannot call the write');
  eq(row(R1).status, 'pending', 'R1 untouched so far');
}

// ── 2. Marking a request ordered, with its cost ────────────────────────────
{
  const n = upstream.length;
  const out = await tool({ requestId: R1.toUpperCase(), status: 'ordered', cost: 42.499, invoiceNumber: '  INV-77 ', note: 'Ordered from Uline, arrives Tue' });
  eq(out.isError, undefined, 'succeeds: ' + (out.text || ''));
  eq(out.before, { status: 'pending', cost: null, invoiceNumber: null }, 'answer shows the values before');
  eq(out.after, { status: 'ordered', cost: 42.5, invoiceNumber: 'INV-77' }, 'and after (cost to cents, invoice trimmed)');
  eq([out.statusChanged, out.store, out.noteSaved], [true, 'BL1', true], 'status changed, store, note saved');
  ok(/howardbrian260@gmail\.com/.test(out.managerNotified), 'names who was notified');
  eq(out.items?.map(i => i.item_name), ['Mop head'], 'with the items');
  eq(row(R1), { status: 'ordered', cost: 42.5, invoice_number: 'INV-77' }, 'D1 row updated');
  const h = hist(R1);
  eq(h.length, 1, 'one history row (the note is not duplicated as a comment)');
  eq(h[0], { type: 'status_change', changed_by_id: 'u-su', changed_by_email: 'bhoward@bargainlane.com', old_status: 'pending', new_status: 'ordered', note: 'Ordered from Uline, arrives Tue' },
    'recorded as Brian, with the note as the message');
  eq(emails.length, 1, 'one email went out');
  eq(emails[0]?.to, 'howardbrian260@gmail.com', 'to the manager who asked');
  ok(/Ordered/.test(emails[0]?.html) && /Uline/.test(emails[0]?.html), 'saying Ordered, with the note');
  const p = patches(n);
  eq(p.map(x => new URL(x.url).searchParams.get('action')), ['supply-request-status', 'supply-request-fulfillment'], 'status first, then cost (the budget alert counts only ordered)');
  ok(p.every(x => x.wk === WK && x.user === 'u-su' && !x.key && !x.auth), 'writes carry the write key and the user, never the reporting or MCP key');
  ok(upstream.slice(n).filter(u => u.method === 'GET').every(x => x.key === UP && !x.wk), 'reads carry only the reporting key');
  eq(JSON.parse(p[1].body), { id: R1, cost: 42.5, invoice_number: 'INV-77' }, 'fulfillment body: id, cost, invoice (no note)');
  ok(logs.some(l => l.includes('"agent_write"') && l.includes('u-su')), 'the main worker logs each agent write by user id');
}

// ── 3. Again: nothing to tell the manager ──────────────────────────────────
{
  const out = await tool({ requestId: R1, status: 'ordered', cost: 42.5, note: 'dup' });
  eq([out.statusChanged, out.noteSaved], [false, true], 'same status → unchanged; the note is kept as a comment');
  ok(/did not change/.test(out.managerNotified), 'says the manager was not notified');
  eq(emails.length, 1, 'no second email');
  eq(hist(R1).map(x => x.type), ['status_change', 'comment'], 'no second status row; one comment');
}

// ── 4. Cost only, on a request that already had one ────────────────────────
{
  const out = await tool({ requestId: R2, cost: 61.2, invoiceNumber: 'NEW-2', note: 'Invoice came in higher' });
  eq([out.before.cost, out.after.cost, out.after.invoiceNumber, out.after.status], [50, 61.2, 'NEW-2', 'ordered'], 'cost and invoice replaced, status kept');
  eq(hist(R2), [{ type: 'comment', changed_by_id: 'u-su', changed_by_email: 'bhoward@bargainlane.com', old_status: null, new_status: null, note: 'Invoice came in higher' }], 'the note is a comment');
  eq(emails.length, 1, 'no email for a cost change');
}

// ── 4b. Agent text is untrusted: it came from an email ─────────────────────
{
  const out = await tool({ requestId: R2, status: 'on_hold', note: '<img src=x onerror=alert(1)> backordered & late' });
  eq(out.statusChanged, true, 'a status change with a markup note goes through');
  const html = emails.at(-1)?.html || '';
  ok(emails.length === 2 && emails.at(-1).to === 'alyson@bargainlane.com', 'the manager is emailed');
  ok(!html.includes('<img') && html.includes('&lt;img src=x onerror=alert(1)&gt; backordered &amp; late'), "the email shows the note as text, never as markup");
  const page = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  ok(!/\$\{req\.invoice_number(\|\|'')?\}/.test(page), 'index.html never interpolates a raw invoice_number');
  ok(page.includes("#${escapeHtml(req.invoice_number)}") && page.includes(`value="\${escapeHtml(req.invoice_number||'').replace(/"/g,'&quot;')}"`),
    'the request panel escapes it, and the Fulfillment input escapes quotes too');
  const again = await tool({ requestId: R2, status: 'on_hold' });
  ok(again.isError && /already on_hold; nothing was changed/.test(again.text), 'the same status alone is refused, saying nothing changed: ' + again.text);
  eq(emails.length, 2, 'and no email');
}

// ── 5. Refused before anything is written ──────────────────────────────────
{
  const n = upstream.length, before = JSON.stringify([row(R1), row(R2), row(R3)]);
  const cases = [
    [{}, /requestId/],
    [{ requestId: 'xyz', status: 'ordered' }, /32-character/],
    [{ requestId: R3 }, /at least one of status, cost or invoiceNumber/],
    [{ requestId: R3, note: 'only a note' }, /at least one/],
    [{ requestId: R3, cost: -1 }, /cost must be/],
    [{ requestId: R3, cost: '12' }, /cost must be/],
    [{ requestId: R3, cost: 1e9 }, /cost must be/],
    [{ requestId: R3, cost: true }, /cost must be/],
    [{ requestId: R3, status: 'fulfilled' }, /status must be one of/],
    [{ requestId: R3, status: 'ordered', storeId: 'BL1' }, /Unknown argument "storeId"/],
    [{ requestId: R3, invoiceNumber: 'x'.repeat(101) }, /at most 100/],
    [{ requestId: R3, invoiceNumber: '"><img src=x onerror=alert(1)>' }, /invoiceNumber may hold only/],
    [{ requestId: R3, invoiceNumber: '=HYPERLINK("http://x")' }, /invoiceNumber may hold only/],
    [{ requestId: R3, invoiceNumber: '-2+3' }, /invoiceNumber may hold only/],
    [{ requestId: R3, invoiceNumber: '@SUM(A1)' }, /invoiceNumber may hold only/],
    [{ requestId: R3, status: 'ordered', note: 7 }, /note must be a string/],
  ];
  for (const [args, re] of cases) {
    const out = await tool(args);
    ok(out.isError && re.test(out.text), `${JSON.stringify(args).slice(0, 60)} → ${re} (got ${out.text})`);
  }
  eq(patches(n).length, 0, 'none of those wrote');
  const missing = await tool({ requestId: 'd'.repeat(32), status: 'ordered' });
  ok(missing.isError && /No supply request has id d{32}.*get_supply_requests/.test(missing.text), 'an unknown id says so: ' + missing.text);
  eq(patches(n).length, 0, 'and writes nothing');
  eq(JSON.stringify([row(R1), row(R2), row(R3)]), before, 'D1 unchanged');
}

// ── 6. Status saved, cost failed: say exactly what happened ────────────────
{
  failFulfillment = true;
  const out = await tool({ requestId: R3, status: 'ordered', cost: 9 });
  failFulfillment = false;
  ok(out.isError && /status was set to ordered, but the cost and invoice were NOT saved \(.*500.*D1 down\)/.test(out.text), 'partial failure is spelled out: ' + out.text);
  eq(row(R3), { status: 'ordered', cost: null, invoice_number: null }, 'which is what D1 holds');
  const again = await tool({ requestId: R3, cost: 9, invoiceNumber: 'PO# 88/A-7_b.2' });
  eq([again.after?.cost, again.after?.invoiceNumber], [9, 'PO# 88/A-7_b.2'], 'and the suggested retry works (an ordinary PO number passes)');

  wrote = false; failReadBack = true;
  const saved = await tool({ requestId: R3, cost: 11, note: 'freight added' });
  failReadBack = false;
  ok(!saved.isError && saved.after === null && /Saved, but reading it back failed.*do not retry/.test(saved.readBack), 'a failed read-back after the writes is not an error: ' + JSON.stringify(saved).slice(0, 160));
  eq([row(R3).cost, saved.noteSaved, hist(R3).filter(h => h.note === 'freight added').length], [11, true, 1], 'the cost and the note were saved once');
}

// ── 7. The main worker's door, called directly ─────────────────────────────
{
  const door = (headers = {}, { method = 'PATCH', qs = '?action=supply-request-status', body = { id: R3, status: 'on_hold' }, e = mainEnv } = {}) =>
    main.fetch(new Request('https://api.retjghub.com/' + qs, {
      method, headers: { 'Content-Type': 'application/json', ...headers }, body: method === 'GET' ? undefined : JSON.stringify(body),
    }), e, ctx).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
  const good = { 'X-Agent-Write-Key': WK, 'X-Agent-User': 'u-su' };
  const before = JSON.stringify(row(R3)), hBefore = hist(R3).length;

  eq((await door({ ...good, 'X-Agent-Write-Key': 'wrong' })).status, 401, 'wrong write key → 401');
  eq((await door({ ...good, 'X-Agent-Write-Key': '' })).status, 401, 'empty write key → 401');
  eq((await door(good, { e: { ...mainEnv, AGENT_WRITE_KEY: undefined } })).status, 503, 'no AGENT_WRITE_KEY configured → 503, never open');
  eq((await door(good, { e: { ...mainEnv, AGENT_WRITE_KEY: '' } })).status, 503, 'an empty AGENT_WRITE_KEY → 503 (empty must not equal empty)');
  eq((await door({ ...good, 'X-Agent-Write-Key': UP }, { e: { ...mainEnv, AGENT_WRITE_KEY: UP } })).status, 503,
    'AGENT_WRITE_KEY set to the shared reporting key → 503, never open to its holders');
  const downDB = { prepare: (sql) => { if (/FROM users WHERE id = \?/.test(sql)) throw new Error('D1 down'); return mainEnv.DB.prepare(sql); } };
  eq((await door(good, { e: { ...mainEnv, DB: { ...mainEnv.DB, ...downDB } } })).status, 503, 'the user lookup failing → 503, not a 403 "not a superuser"');
  eq((await door(good, { method: 'GET' })).status, 405, 'GET → 405');
  eq((await door(good, { method: 'POST' })).status, 405, 'POST → 405');
  for (const u of ['u-admin', 'u-mgr1', 'u-exec', 'u-su-off', 'u-su-pin', 'nobody', '']) {
    eq((await door({ ...good, 'X-Agent-User': u })).status, 403, `X-Agent-User "${u}" → 403`);
  }
  const noUser = await door({ 'X-Agent-Write-Key': WK });
  eq(noUser.status, 403, 'no X-Agent-User → 403');
  eq((await door(good, { qs: '?action=supply-request-status&id=x' })).status, 400, 'any parameter but action → 400');
  eq((await door(good, { qs: '?action=supply-request-status&history_d1=true' })).status, 400, 'history_d1 → 400 (the read-through lesson)');
  // Other actions are not behind this door: the key opens nothing, the session gate answers.
  const del = await door(good, { method: 'DELETE', qs: '?action=supply-request-delete', body: { id: R3 } });
  eq([del.status, del.body?.code], [401, 'NO_SESSION'], 'supply-request-delete with the write key → no session');
  const bud = await door(good, { method: 'POST', qs: '?action=supply-budget-set', body: { store: 'BL1', year: 2026, month: 10, budget: 1 } });
  eq([bud.status, bud.body?.code], [401, 'NO_SESSION'], 'supply-budget-set with the write key → no session');
  // The shared reporting key never writes.
  const rep = await door({ 'X-API-Key': UP });
  eq(rep.status, 401, 'the reporting key cannot change a status');
  eq(JSON.stringify(row(R3)), before, 'D1 unchanged by every refusal');
  eq(hist(R3).length, hBefore, 'and no history written');
  ok(db.prepare("SELECT COUNT(*) n FROM supply_budgets").get().n === 0, 'and no budget written');
  const yes = await door(good);
  eq([yes.status, row(R3).status], [200, 'on_hold'], 'the right key and a superuser → the page handler runs');
}

// ── 8. MCP 2026-07-28 carries the caller the same way ──────────────────────
{
  const V = '2026-07-28', P = 'io.modelcontextprotocol/';
  const modern = (method, params = {}, e = env) => mcp.fetch(new Request('https://mcp.retjghub.com/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + MCP, 'MCP-Protocol-Version': V, 'Mcp-Method': method,
      ...(params.name && { 'Mcp-Name': params.name }) },
    body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params: { ...params, _meta: { [P + 'protocolVersion']: V, [P + 'clientCapabilities']: {} } } }),
  }), e, ctx).then(r => r.json());
  const list = await modern('tools/list');
  eq(list.result?.tools?.at(-1)?.name, 'update_supply_request', '2026 era: the static key is offered the write');
  eq((await modern('tools/list', {}, { ...env, MCP_KEY_USER: '' })).result?.tools?.length, 22, '2026 era: and not without MCP_KEY_USER');
  const res = await modern('tools/call', { name: 'update_supply_request', arguments: { requestId: R3, status: 'ordered' } });
  await settle();
  eq([res.result?.resultType, JSON.parse(res.result?.content?.[0]?.text || '{}').after?.status], ['complete', 'ordered'], '2026 era: the write runs');
}

// Neither key ever comes back to the agent.
ok(seen.every(t => !t.includes(WK) && !t.includes(UP)), 'no answer to the agent contains the write or reporting key');
ok(logs.every(l => !l.includes(WK)), 'no log line contains the write key');

console.log = realLog;
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
