// Inventory Edit → update-clover-item: an item id is only an item id.
//
// 🛑 The handler pastes itemId into two Clover URLs: the POST that carries the patch, and,
// when l3 is sent, the ?expand=categories read. The URL parser resolves dot segments, even
// percent-encoded ones, so "../categories/C1" made the patch a POST to a category. Only a
// truthiness check stood in the way. Clover ids are letters and digits, and isCloverId() is
// now the one rule this handler and delete-clover-item share.
//
// This drives the REAL handler through lib/worker-harness.mjs. The Clover stub resolves each
// URL the way fetch does and records every call. So a request that should have been refused
// shows up as the call it would have made, instead of crashing the suite.
//
// The delete half of the rule is pinned in scripts/test-inventory-delete.mjs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

blockNetwork();
const worker = await loadWorker(repo);
const { env } = makeEnv(repo);
Object.assign(env, { BL1_MERCHANT_ID: 'M-BL1', BL1_API_TOKEN: 't1', BL2_MERCHANT_ID: 'M-BL2', BL2_API_TOKEN: 't2' });

// Two merchants, as in production. An item keeps what a patch sets, and its categories.
const held = {
  'M-BL1': new Map([['X1', { id: 'X1', name: 'Mixing bowl', price: 400, categories: [{ id: 'C9', name: 'Housewares' }] }]]),
  'M-BL2': new Map([['9TYC7GD7ZHJ3Y', { id: '9TYC7GD7ZHJ3Y', name: 'Lamp', price: 1200, categories: [] }]]),
};
const CATEGORIES = [{ id: 'C1', name: 'Toys' }, { id: 'C9', name: 'Housewares' }];
let outbound = [];
const lines = () => outbound.map(o => o.line);
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (u, init = {}) => {
  // What the runtime's fetch would actually send: the URL as PARSED, so dot segments are
  // already resolved. Every call is recorded. An item and the category list answer the way
  // Clover does. Anything else, including whatever a crafted id points at, is answered 200,
  // the way Clover answers a write it accepted.
  const url = new URL(String(u));
  const method = init.method || 'GET';
  outbound.push({ line: `${method} ${url.pathname}${url.search}`, body: init.body ? JSON.parse(init.body) : null });
  const m = url.pathname.match(/^\/v3\/merchants\/([^/]+)\/items\/([^/]+)$/);
  if (m) {
    const item = held[m[1]] && held[m[1]].get(m[2]);
    if (!item) return json({ message: 'Not Found' }, 404);
    if (method === 'POST') {
      const { categories, ...rest } = Object.assign(item, JSON.parse(init.body));
      return json(rest);
    }
    return json({ ...item, categories: { elements: item.categories } });
  }
  if (method === 'GET' && /^\/v3\/merchants\/[^/]+\/categories$/.test(url.pathname)) return json({ elements: CATEGORIES });
  return json({});
};

// A handler that THROWS is Cloudflare's 1101 page in production. Here it is a status of
// 'threw', which every assertion below reads as the failure it is rather than crashing.
const send = async (request) => {
  let status, data = null;
  try {
    const r = await worker.fetch(request, env, ctx);
    status = r.status;
    try { data = JSON.parse(await r.text()); } catch (_) {}
  } catch (e) { status = 'threw: ' + ((e && e.message) || e); }
  return { status, data };
};
const update = (user, body) => send(req('/?action=update-clover-item', { user, method: 'POST', body }));
const raw = (user, method, bodyText) => send(new Request('https://api.retjghub.com/?action=update-clover-item', {
  method, headers: { 'Content-Type': 'application/json', ...(user ? { Cookie: `session=sess-${user}` } : {}) },
  body: bodyText }));

console.log('An ordinary edit');
{
  outbound = [];
  const r = await update('u-su', { store: 'BL1', itemId: 'X1', name: 'Steel mixing bowl', priceCents: 450 });
  ok(r.status === 200 && r.data && r.data.ok === true && r.data.item && r.data.item.name === 'Steel mixing bowl',
     `a superuser's edit of a BL1 item answers ok with the item (got ${r.status} ${JSON.stringify(r.data)})`);
  ok(lines().join() === 'POST /v3/merchants/M-BL1/items/X1', `…in one POST to that item, and nothing else (${lines()})`);
  ok(JSON.stringify(outbound[0] && outbound[0].body) === JSON.stringify({ name: 'Steel mixing bowl', price: 450 }),
     `…carrying only the fields sent (${JSON.stringify(outbound[0] && outbound[0].body)})`);
}
{
  // With l3 the id reaches the second URL too: the read of the item's current categories.
  outbound = [];
  const r = await update('u-su', { store: 'BL1', itemId: 'X1', l3: 'Toys' });
  ok(r.status === 200 && r.data && r.data.ok === true && r.data.category && r.data.category.categoryId === 'C1',
     `adding a category answers ok and names it (got ${r.status} ${JSON.stringify(r.data)})`);
  ok(lines().join() === ['POST /v3/merchants/M-BL1/items/X1', 'GET /v3/merchants/M-BL1/items/X1?expand=categories',
                         'GET /v3/merchants/M-BL1/categories?limit=1000', 'POST /v3/merchants/M-BL1/category_items'].join(),
     `…and every call is to that item or its merchant's categories (${lines()})`);
  const link = outbound[3] && outbound[3].body && outbound[3].body.elements && outbound[3].body.elements[0];
  ok(link && link.item && link.item.id === 'X1' && link.category && link.category.id === 'C1',
     `…and the link it adds is C1 → X1 (${JSON.stringify(link)})`);
}
{
  // A real Clover id: thirteen capitals and digits.
  outbound = [];
  const r = await update('u-admin', { store: 'BL2', itemId: '9TYC7GD7ZHJ3Y', priceCents: 999 });
  ok(r.status === 200 && r.data && r.data.ok === true && held['M-BL2'].get('9TYC7GD7ZHJ3Y').price === 999,
     `an admin's edit of a real-shaped id in BL2 goes through (got ${r.status} ${JSON.stringify(r.data)})`);
  ok(lines().join() === 'POST /v3/merchants/M-BL2/items/9TYC7GD7ZHJ3Y', `…to that merchant and item only (${lines()})`);
}
for (const [user, name] of [['u-mgr1', 'a manager'], ['u-staff', 'staff'], [undefined, 'no session']]) {
  outbound = [];
  const r = await update(user, { store: 'BL1', itemId: 'X1', name: 'Not theirs to rename' });
  ok(typeof r.status === 'number' && r.status >= 400, `${name} is refused (got ${r.status})`);
  ok(outbound.length === 0, `…and Clover is never asked (${lines()})`);
}

console.log('What the handler refuses');
// 🛑 An id that is not just an id. Each is sent with name AND l3, so a handler that let it
// through would reach both URLs: the patch POST and the ?expand=categories read. The
// non-strings matter as much as the strings: `${[".."]}` is "..", and `${["X1"]}` is "X1".
const before = JSON.stringify([...held['M-BL1'].values()]);
for (const itemId of ['..', '../categories/C1', '%2e%2e/categories/C1', '.%2E', 'X1/..', 'X1/../../..',
                      'X1?expand=categories', 'X1#x', 'X 1', '', undefined, null, ['..'], ['X1'], 7, true, {}]) {
  outbound = [];
  const r = await update('u-su', { store: 'BL1', itemId, name: 'Renamed by a crafted id', l3: 'Toys' });
  ok(r.status === 400 && r.data && r.data.ok === false,
     `itemId ${JSON.stringify(itemId)} is refused with 400 (got ${r.status} ${JSON.stringify(r.data)})`);
  ok(outbound.length === 0, `…and Clover is never asked (${lines()})`);
}
ok(JSON.stringify([...held['M-BL1'].values()]) === before, 'no item was changed by any of them');
// A request it cannot read is refused as JSON, as delete-clover-item's is, rather than
// thrown into Cloudflare's 1101 page.
{
  outbound = [];
  const g = await raw('u-su', 'GET');
  ok(g.status === 405, `GET is a 405 (got ${g.status})`);
  const t = await raw('u-su', 'POST', '{"store": "BL1", "itemId": ');
  ok(t.status === 400 && /JSON/.test((t.data && t.data.error) || ''),
     `a body that is not JSON is a 400 (got ${t.status} ${JSON.stringify(t.data)})`);
  const n = await raw('u-su', 'POST', 'null');
  ok(n.status === 400 && /JSON/.test((n.data && n.data.error) || ''),
     `a JSON null body is a 400 (got ${n.status} ${JSON.stringify(n.data)})`);
  // JSON that is not an object is refused as the wrong body, not as a bad store or id.
  for (const text of ['"X1"', '7', 'true']) {
    const p = await raw('u-su', 'POST', text);
    ok(p.status === 400 && /JSON/.test((p.data && p.data.error) || ''),
       `a JSON body of ${text} is a 400 that says JSON (got ${p.status} ${JSON.stringify(p.data)})`);
  }
  const a = await raw('u-su', 'POST', '[]');
  ok(a.status === 400, `a JSON array body is a 400 (got ${a.status} ${JSON.stringify(a.data)})`);
  ok(outbound.length === 0, `none of them reaches Clover (${lines()})`);
}
{
  // The deploy probe's control. No itemId gets this answer from the old worker and the new,
  // which is how the probe proves its session reached this handler.
  const c = await update('u-su', { store: 'BL1' });
  ok(c.status === 400 && (c.data && c.data.error) === 'Invalid store or itemId',
     `no itemId is a 400 "Invalid store or itemId" (got ${c.status} ${JSON.stringify(c.data)})`);
}
{
  // The refusals must not have taken the ordinary path with them.
  outbound = [];
  const r = await update('u-su', { store: 'BL1', itemId: 'X1', name: 'Mixing bowl' });
  ok(r.status === 200 && r.data && r.data.ok === true && held['M-BL1'].get('X1').name === 'Mixing bowl',
     `an ordinary edit still goes through after all that (got ${r.status} ${JSON.stringify(r.data)})`);
  ok(lines().join() === 'POST /v3/merchants/M-BL1/items/X1', `…to that item only (${lines()})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
