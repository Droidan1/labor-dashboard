// Inventory Viewer delete — what counts as "deleted".
//
// 🛑 Every fault the Viewer's delete ever had was a false "Deleted": a 403 with no
// results, an empty results[] and an HTML error page each removed the row and said so.
// invDelOutcome is now the one place that decides, so it is run here over every answer
// the worker can give — and then over answers the REAL delete-clover-item handler
// produces (lib/worker-harness.mjs), so the two halves cannot drift apart silently.
//
// The browser half (the buttons, the modal, which store it sends, Stop) is
// scripts/browser-inventory-delete.mjs. It is not in this runner: it needs Chromium.
//
// The last block pins what the handler REFUSES: the cross-store `stores[]` form, a method
// or body it cannot read, and an item id that is not just an item id.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

// ── The function, extracted and RUN ─────────────────────────────────────────
const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const at = html.indexOf('  function invDelOutcome(store, status, data) {');
ok(at > 0, 'index.html declares invDelOutcome(store, status, data)');
// Ends at its own closing brace: two-space indent, the only such line in the function.
const src = at > 0 ? html.slice(at, html.indexOf('\n  }\n', at) + 4) : '';
ok(src.length > 400 && src.trimEnd().endsWith('}'), `the extraction is the whole function (${src.length} chars)`);
// If extraction or parsing fails, fall back to the DANGEROUS answer, so every fault
// assertion below fails loudly instead of the suite quietly testing nothing.
let invDelOutcome = () => ({ ok: true, why: '' });
try { invDelOutcome = new Function(`${src}\nreturn invDelOutcome;`)(); }
catch (e) { ok(false, 'invDelOutcome parses on its own: ' + e.message); }

console.log('What the Viewer counts as a delete');
{
  const o = invDelOutcome('BL1', 200, { results: [{ store: 'BL1', ok: true }] });
  ok(o.ok === true, 'HTTP 2xx and {store: BL1, ok: true} for BL1 is a delete');
}

// Every other answer is a failure, with a reason that says which one.
const FAULTS = [
  ['403, no results (the handler\'s own refusal)', 403, { error: 'Forbidden' }, /admin account\.$/],
  ['403 UNCLASSIFIED_ACTION', 403, { error: 'Forbidden', code: 'UNCLASSIFIED_ACTION' }, /deploy is missing/],
  ['403 NO_BUSINESS_ACCESS', 403, { error: 'Forbidden', code: 'NO_BUSINESS_ACCESS', business: 'bl' }, /no Bargain Lane access/],
  ['403 NO_FINANCIAL_ACCESS', 403, { error: 'Forbidden', code: 'NO_FINANCIAL_ACCESS' }, /\(NO_FINANCIAL_ACCESS\)/],
  ['401', 401, { error: 'Not authenticated' }, /session has expired/],
  ['2xx, empty results', 200, { results: [] }, /no result for BL1/],
  ['2xx, no results key', 200, { ok: true }, /no result for BL1/],
  ['2xx, body was not JSON', 200, null, /no result for BL1/],
  ['2xx, a result for ANOTHER store only', 200, { results: [{ store: 'BL2', ok: true }] }, /no result for BL1/],
  ['2xx, ok is truthy but not true', 200, { results: [{ store: 'BL1', ok: 'yes' }] }, /not known/],
  ['2xx, Clover refused (JSON message)', 200, { results: [{ store: 'BL1', ok: false, error: '{"message":"Item is locked"}' }] },
    /^Clover did not delete it: Item is locked$/],
  ['2xx, Clover refused (plain text)', 200, { results: [{ store: 'BL1', ok: false, error: 'Bad Gateway' }] },
    /^Clover did not delete it: Bad Gateway$/],
  ['2xx, Clover refused (no text)', 200, { results: [{ store: 'BL1', ok: false }] }, /^Clover did not delete it\.$/],
  ['400', 400, { ok: false, error: 'Invalid itemId or store(s)' }, /refused the request \(HTTP 400\): Invalid itemId/],
  ['500 with JSON', 500, { error: 'boom' }, /failed \(HTTP 500\): boom$/],
  ['500 HTML error page', 500, null, /failed \(HTTP 500\)\.$/],
  ['502 carrying an ok row', 502, { results: [{ store: 'BL1', ok: true }] }, /failed \(HTTP 502\)/],
];
for (const [name, status, data, want] of FAULTS) {
  const o = invDelOutcome('BL1', status, data);
  ok(o.ok === false, `${name}: not a delete (got ok=${JSON.stringify(o.ok)})`);
  ok(typeof o.why === 'string' && o.why.trim().length > 10 && want.test(o.why),
     `${name}: says why — ${JSON.stringify(o.why)}`);
}
// A long Clover body is cut, not pasted whole into the modal.
{
  const o = invDelOutcome('BL1', 200, { results: [{ store: 'BL1', ok: false, error: 'x'.repeat(5000) }] });
  ok(o.ok === false && typeof o.why === 'string' && o.why.length < 260,
     `a 5,000-char Clover body is cut to fit (${o.why && o.why.length} chars)`);
}
// Each refusal code, and each kind of fault, reads differently: two that collapse into
// one sentence send someone hunting the wrong problem.
{
  const whys = ['403, no results (the handler\'s own refusal)', '403 UNCLASSIFIED_ACTION', '403 NO_BUSINESS_ACCESS',
                '403 NO_FINANCIAL_ACCESS', '401', '2xx, empty results', '2xx, Clover refused (JSON message)', '400',
                '500 HTML error page']
    .map(n => FAULTS.find(f => f[0] === n)).map(([, s, d]) => invDelOutcome('BL1', s, d).why);
  ok(new Set(whys).size === whys.length, `nine different faults, nine different sentences (${new Set(whys).size})`);
}

// ── The contract with the REAL handler ──────────────────────────────────────
// Two merchants, as in production: each store is its own Clover merchant, and an item
// id exists in exactly one of them. The Clover stub answers the way the handler
// assumes — 404 for an id that is not there.
console.log('Against the real delete-clover-item handler');
blockNetwork();
const worker = await loadWorker(repo);
const { env } = makeEnv(repo);
Object.assign(env, { BL1_MERCHANT_ID: 'M-BL1', BL1_API_TOKEN: 't1', BL2_MERCHANT_ID: 'M-BL2', BL2_API_TOKEN: 't2' });
const held = { 'M-BL1': new Set(['X1', 'X2']), 'M-BL2': new Set(['Y1']) };
let asked = [], outbound = [], answer = null;
globalThis.fetch = async (u, init = {}) => {
  // What the runtime's fetch would actually send: the URL as PARSED, so dot segments are
  // already resolved. Every call is recorded; anything that is not a DELETE of one item
  // is answered 200, the way Clover would answer a delete of whatever it now points at.
  const url = new URL(String(u));
  const method = init.method || 'GET';
  outbound.push(`${method} ${url.pathname}${url.search}`);
  const m = url.pathname.match(/^\/v3\/merchants\/([^/]+)\/items\/([^/]+)$/);
  if (!m || method !== 'DELETE' || url.search) return new Response('', { status: 200 });
  asked.push(`${m[1]}/${m[2]}`);
  if (answer) return answer();
  if (!held[m[1]] || !held[m[1]].has(m[2])) return new Response('{"message":"Not Found"}', { status: 404 });
  held[m[1]].delete(m[2]);
  return new Response('', { status: 200 });
};
// The Viewer's own reading of the response: status, then JSON if there is any. A handler
// that THROWS is Cloudflare's 1101 page in production; here it is a status of 'threw',
// which every assertion below reads as the failure it is rather than crashing the suite.
const send = async (request, store) => {
  let status, data = null;
  try {
    const r = await worker.fetch(request, env, ctx);
    status = r.status;
    try { data = JSON.parse(await r.text()); } catch (_) {}
  } catch (e) { status = 'threw: ' + ((e && e.message) || e); }
  return { status, data, o: invDelOutcome(store, typeof status === 'number' ? status : 500, data) };
};
const del = (user, body, store = body && body.store) =>
  send(req('/?action=delete-clover-item', { user, method: 'POST', body }), store);
const raw = (user, method, bodyText) => send(new Request('https://api.retjghub.com/?action=delete-clover-item', {
  method, headers: { 'Content-Type': 'application/json', ...(user ? { Cookie: `session=sess-${user}` } : {}) },
  body: bodyText }), 'BL1');

{
  asked = [];
  const r = await del('u-su', { store: 'BL1', itemId: 'X1' });
  ok(r.o.ok === true, `a superuser's delete of a BL1 item reads as done (${r.status} ${JSON.stringify(r.data)})`);
  ok(asked.join() === 'M-BL1/X1', `…it asked BL1's merchant for exactly that item (${asked})`);
  ok(!held['M-BL1'].has('X1'), '…and the item is gone');
}
{
  const r = await del('u-su', { store: 'BL1', itemId: 'X1' });
  ok(r.o.ok === true, 'deleting it again reads as done: not-found is "already gone", right for a stale list');
}
{
  // 🛑 WHY THE STORE MATTERS. A BL1 item "deleted from BL2" — the old dropdown bug.
  asked = [];
  const r = await del('u-su', { store: 'BL2', itemId: 'X2' });
  ok(r.o.ok === true && held['M-BL1'].has('X2'),
     '🛑 the handler reports a wrong-store delete as done while the item is still in BL1 — '
     + 'so the Viewer must never send a store its rows did not come from');
  ok(asked.join() === 'M-BL2/X2', `…it only ever asked BL2's merchant (${asked})`);
}
{
  answer = () => new Response('{"message":"Internal error"}', { status: 500 });
  const r = await del('u-su', { store: 'BL1', itemId: 'X2' });
  answer = null;
  ok(r.status === 200 && r.o.ok === false && /Internal error/.test(r.o.why),
     `Clover refusing comes back as a 200 with ok:false for the store, and reads as a failure — ${JSON.stringify(r.o.why)}`);
  ok(held['M-BL1'].has('X2'), '…and nothing was deleted');
}
{
  const r = await del('u-admin', { store: 'BL2', itemId: 'Y1' });
  ok(r.o.ok === true && !held['M-BL2'].has('Y1'), `an admin may delete (${r.status})`);
}
for (const [user, name] of [['u-mgr1', 'a manager'], ['u-staff', 'staff'], [undefined, 'no session']]) {
  asked = [];
  const r = await del(user, { store: 'BL1', itemId: 'X2' }, 'BL1');
  ok(r.status >= 400 && r.o.ok === false, `${name} is refused, and it reads as a failure (${r.status} → ${JSON.stringify(r.o.why)})`);
  ok(asked.length === 0 && held['M-BL1'].has('X2'), `…and Clover is never asked`);
}
{
  const r = await del('u-su', { store: 'BL1' }, 'BL1');
  ok(r.status === 400 && r.o.ok === false && /HTTP 400/.test(r.o.why), `no itemId is a 400, read as a failure (${JSON.stringify(r.o.why)})`);
}

// ── What the handler refuses ─────────────────────────────────────────────────
// 🛑 { stores: [...], itemId } deleted ONE merchant's id in every store listed. Each other
// store answered not-found, which counts as done, so it reported deletes that never
// happened. Its only caller is gone (inventory-24); it is refused out loud, so a stale
// client is told instead of silently deleting nothing.
console.log('What the handler refuses');
for (const [name, body] of [
  ['stores[] alone', { stores: ['BL1', 'BL2'], itemId: 'X2' }],
  ['stores[] beside a store', { store: 'BL1', stores: ['BL2'], itemId: 'X2' }],
  ['an empty stores[]', { stores: [], itemId: 'X2' }],
]) {
  outbound = [];
  const r = await del('u-su', body, 'BL1');
  ok(r.status === 400 && r.data && r.data.code === 'ONE_STORE_PER_DELETE',
     `${name}: refused, 400 ONE_STORE_PER_DELETE (got ${r.status} ${JSON.stringify(r.data)})`);
  ok(r.o.ok === false && /one store/i.test(r.o.why), `${name}: the Viewer reads it as a failure that says why — ${JSON.stringify(r.o.why)}`);
  ok(outbound.length === 0 && held['M-BL1'].has('X2'), `${name}: Clover is never asked (${outbound})`);
}
// A request it cannot read is refused as JSON — not left to throw into Cloudflare's 1101.
{
  outbound = [];
  const g = await raw('u-su', 'GET');
  ok(g.status === 405, `GET is a 405 (got ${g.status})`);
  const j = await raw('u-su', 'POST', '{"store": "BL1", "itemId": ');
  ok(j.status === 400 && /JSON/.test((j.data && j.data.error) || ''), `a body that is not JSON is a 400 (got ${j.status} ${JSON.stringify(j.data)})`);
  const n = await raw('u-su', 'POST', 'null');
  ok(n.status === 400, `a JSON null body is a 400 (got ${n.status})`);
  ok(outbound.length === 0, `none of them reaches Clover (${outbound})`);
}
// 🛑 The id goes into Clover's URL, and the URL parser resolves dot segments — even
// percent-encoded ones — so items/../categories/C1 is a DELETE on a category. A Clover id
// is alphanumeric; anything else is refused before a URL is built.
for (const itemId of ['../categories/C1', '%2e%2e/categories/C1', 'X2/..', 'X2?expand=categories', 'X2#x', 'X 2', '']) {
  outbound = [];
  const r = await del('u-su', { store: 'BL1', itemId }, 'BL1');
  ok(r.status === 400 && r.o.ok === false, `itemId ${JSON.stringify(itemId)} is refused (got ${r.status})`);
  ok(outbound.length === 0 && held['M-BL1'].has('X2'), `…and Clover is never asked (${outbound})`);
}
{
  // The refusals must not have taken the ordinary path with them.
  outbound = [];
  const r = await del('u-su', { store: 'BL1', itemId: 'X2' });
  ok(r.status === 200 && JSON.stringify(r.data) === JSON.stringify({ results: [{ store: 'BL1', ok: true }] }),
     `an ordinary delete still answers { results: [{ store, ok }] } (got ${r.status} ${JSON.stringify(r.data)})`);
  ok(outbound.join() === 'DELETE /v3/merchants/M-BL1/items/X2' && !held['M-BL1'].has('X2'), `…having asked for exactly that item (${outbound})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
