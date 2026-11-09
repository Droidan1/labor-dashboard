// create_clover_item / update_clover_item / delete_clover_item (mcp/writes.mjs) and the agent
// door's three Clover actions (worker.js AGENT_WRITE_ACTIONS), driven end to end: the real MCP
// worker → service binding → the real main worker and the Inventory Viewer's own handlers, over
// a STUBBED Clover. No request here reaches the real Clover API: every outbound fetch that is
// not the stub is refused.
//
// WHAT THIS PROTECTS. Brian (2026-11-09): after the shoe reprice found last week's sale buttons
// on all five registers, the agent may change POS items itself, with his OK. These tools change
// what a register charges, so what matters is: only Claude's static key is offered them (OAuth
// says read-only), only the agent key and a superuser open the door, a call without confirm
// writes NOTHING, a confirm writes exactly what the preview showed, one store per Clover call,
// and every store is read back.
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
const { env: mainEnv } = makeEnv(repo);
mainEnv.MORNING_BRIEFING_KEY = UP;
mainEnv.AGENT_WRITE_KEY = WK;

// ── A stub Clover: one catalog per merchant ────────────────────────────────
const MERCHANT = { BL1: 'M1', BL2: 'M2', BL4: 'M4', BL8: 'M8', BL14: 'M14', BL16: 'M16' };
for (const [s, m] of Object.entries(MERCHANT)) { mainEnv[`${s}_MERCHANT_ID`] = m; mainEnv[`${s}_API_TOKEN`] = 'tok-' + m; }
const SHOES = 'FG BL SOFTLINES - SHOES', DECOR = 'FG BL HOME - DECOR';
const shops = {};
for (const m of Object.values(MERCHANT)) {
  const shop = shops[m] = { n: 0, cats: [{ id: 'CS' + m, name: SHOES }, { id: 'CD' + m, name: DECOR }, { id: 'CK' + m, name: 'Sku Book Items' }], items: new Map() };
  const add = (name, code, price, cat, over = {}) => {
    const id = 'I' + m + 'X' + (++shop.n);
    shop.items.set(id, { id, name, code, sku: code, price, hidden: false, defaultTaxRates: true, priceType: 'FIXED', cats: [cat], ...over });
    return id;
  };
  add('MASSIVE SHOE SALE', '9001', 800, 'CS' + m);
  add('Premium shoes', '9002', 1500, 'CS' + m);
  add('Sneaker', '9003', 1200, 'CS' + m, { cats: ['CS' + m, 'CK' + m] });   // also on the Sku Book page
  add('Brass Lamp', '5001', 1999, 'CD' + m, { cost: 600 });
  if (m !== 'M16') add('Clearance Bin', '7001', 500, 'CD' + m);   // none at BL16
  if (m === 'M2') add('Clearance Bin', '7002', 300, 'CD' + m);    // two at BL2
  // A category the Hub has no main category for (not in L3_TO_L2), spelled the POS's way.
  if (m === 'M1' || m === 'M2') { shop.cats.push({ id: 'CN' + m, name: 'FG BL NEW BITS' }); add('Odd bit', '6001', 100, 'CN' + m); }
  // BL16's catalogue runs past one 1,000-item page, with a button on the second.
  if (m === 'M16') { for (let k = 0; k < 1500; k++) add('Filler ' + k, 'F' + k, 100, 'CD' + m); add('Deep Item', '8001', 900, 'CD' + m); }
}
const itemAt = (store, name) => [...shops[MERCHANT[store]].items.values()].find(i => i.name === name);
const shape = (shop, i) => ({ id: i.id, name: i.name, code: i.code, sku: i.sku, price: i.price, ...(i.cost != null && { cost: i.cost }),
  hidden: i.hidden, defaultTaxRates: i.defaultTaxRates, priceType: i.priceType, modifiedTime: 1,
  categories: { elements: i.cats.map(id => shop.cats.find(c => c.id === id)).filter(Boolean) } });
const clover = [];
const failPatch = new Set();   // merchants whose item POST answers 500
const failCreate = new Set();  // merchants whose new-item POST answers 500
let emptyRead = null;          // { m, skip }: after `skip` catalogue reads at m, one comes back EMPTY (Clover returning less)
globalThis.fetch = async (u, init = {}) => {
  const url = new URL(String(u));
  if (url.hostname !== 'api.clover.com') throw new Error('outbound fetch blocked in harness: ' + String(u).slice(0, 80));
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  clover.push({ method, path: url.pathname, search: url.search, body });
  const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  const [, , , m, kind, id] = url.pathname.split('/');
  const shop = shops[m];
  if (!shop) return J({ message: 'Unknown merchant' }, 401);
  if (kind === 'items' && !id) {
    if (method === 'POST') {
      if (failCreate.has(m)) return J({ message: 'Clover is down' }, 500);
      const nid = 'N' + m + 'X' + (++shop.n);
      shop.items.set(nid, { id: nid, name: body.name, code: body.code, sku: body.sku, price: body.price, cost: body.cost,
        hidden: !!body.hidden, defaultTaxRates: !!body.defaultTaxRates, priceType: body.priceType || 'FIXED', cats: [] });
      return J(shape(shop, shop.items.get(nid)));
    }
    const off = Number(url.searchParams.get('offset') || 0), lim = Number(url.searchParams.get('limit') || 100);
    if (emptyRead && emptyRead.m === m && url.searchParams.get('expand') === 'categories') {
      if (emptyRead.skip-- <= 0) { emptyRead = null; return J({ elements: [] }); }
    }
    return J({ elements: [...shop.items.values()].slice(off, off + lim).map(i => shape(shop, i)) });
  }
  if (kind === 'items' && id) {
    const it = shop.items.get(id);
    if (!it) return J({ message: 'Not found' }, 404);
    if (method === 'GET') return J(shape(shop, it));
    if (method === 'DELETE') { shop.items.delete(id); return J({}); }
    if (failPatch.has(m)) return J({ message: 'Clover is down' }, 500);
    for (const k of ['name', 'code', 'sku', 'price', 'cost', 'hidden', 'defaultTaxRates']) if (k in body) it[k] = body[k];
    return J(shape(shop, it));
  }
  if (kind === 'categories') {
    if (method === 'POST') { const c = { id: 'CNEW' + (++shop.n), name: body.name }; shop.cats.push(c); return J(c); }
    return J({ elements: shop.cats });
  }
  if (kind === 'category_items') {
    for (const e of body.elements) {
      const it = shop.items.get(e.item.id);
      if (!it) return J({ message: 'Not found' }, 404);
      if (url.searchParams.get('delete') === 'true') it.cats = it.cats.filter(c => c !== e.category.id);
      else if (!it.cats.includes(e.category.id)) it.cats.push(e.category.id);
    }
    return J({ elements: body.elements });
  }
  return J({ message: 'stub has no route for ' + url.pathname }, 404);
};
const writesSince = (n) => clover.slice(n).filter(c => c.method !== 'GET');
const pending = [];
const ctx = { waitUntil: (p) => { pending.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException: () => {} };
const logs = [];
const realLog = console.log;
console.log = (...a) => { logs.push(a.map(String).join(' ')); };

// ── The MCP worker, bound to the real main worker ──────────────────────────
await stubWorkersRuntime();
const { default: mcp, PROVIDER_OPTIONS } = await import(pathToFileURL(path.join(repo, 'mcp', 'worker.mjs')).href);
const writes = await import(pathToFileURL(path.join(repo, 'mcp', 'writes.mjs')).href).catch(() => ({}));
const upstream = [];
const env = { MCP_KEY: MCP, REPORTING_API_KEY: UP, AGENT_WRITE_KEY: WK, MCP_KEY_USER: 'u-su',
  API: { fetch: async (r) => {
    upstream.push({ url: r.url, method: r.method, key: r.headers.get('X-API-Key'), wk: r.headers.get('X-Agent-Write-Key'),
      user: r.headers.get('X-Agent-User'), auth: r.headers.get('Authorization') });
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
async function tool(name, args, e = env) {
  const res = (await rpc('tools/call', { name, arguments: args }, e)).result;
  if (!res) return { noResult: true };
  return res.isError ? { isError: true, text: res.content[0].text } : JSON.parse(res.content[0].text);
}
// Preview, then confirm with the preview's token: the only way a write happens.
async function previewThenConfirm(name, args) {
  const pv = await tool(name, args);
  if (!pv.confirmToken) return { isError: true, text: 'preview gave no confirmToken: ' + JSON.stringify(pv).slice(0, 300) };
  return tool(name, { ...args, confirm: true, confirmToken: pv.confirmToken });
}
const NAMES = ['create_clover_item', 'update_clover_item', 'delete_clover_item'];
const OPEN = ['BL1', 'BL2', 'BL4', 'BL14', 'BL16'];

// ── 1. Who is offered the tools ────────────────────────────────────────────
{
  const list = (await rpc('tools/list')).result.tools;
  eq(list.slice(-3).map(t => t.name), NAMES, 'the static key (with MCP_KEY_USER and AGENT_WRITE_KEY) is offered the three Clover writes');
  const ann = Object.fromEntries(list.filter(t => NAMES.includes(t.name)).map(t => [t.name, t.annotations]));
  ok(NAMES.every(n => ann[n]?.readOnlyHint === false && ann[n]?.openWorldHint === true), 'each marked as a write to an outside system');
  eq([ann.delete_clover_item?.destructiveHint, ann.delete_clover_item?.idempotentHint], [true, true], 'delete: destructive, idempotent');
  ok(list.filter(t => NAMES.includes(t.name)).every(t => t.inputSchema.additionalProperties === false && t.inputSchema.properties.confirm?.type === 'boolean'),
    'strict schemas, each with confirm');
  ok(list.filter(t => NAMES.includes(t.name)).every(t => /without confirm first.*only after they say yes.*confirmToken/i.test(t.description)),
    'each description tells the agent to preview, show the user, and confirm only after a yes');
  const names = async (e) => (await rpc('tools/list', {}, e)).result.tools.map(t => t.name);
  ok(!(await names({ ...env, AGENT_WRITE_KEY: undefined })).some(n => NAMES.includes(n)), 'no AGENT_WRITE_KEY → not offered');
  ok(!(await names({ ...env, MCP_KEY_USER: undefined })).some(n => NAMES.includes(n)), 'no MCP_KEY_USER → not offered');

  // OAuth: even a superuser's grant is read-only (the consent screen says so).
  const oauth = (method, params = {}) => PROVIDER_OPTIONS.apiHandler.fetch(new Request('https://mcp.retjghub.com/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }),
  }), env, { props: { userId: 'u-su', role: 'superuser', email: 'bhoward@bargainlane.com' }, auth: { scope: ['mcp:read'], clientId: 'chatgpt' } }).then(x => x.json());
  const ol = await oauth('tools/list');
  ok(ol.result?.tools?.length > 0 && !ol.result.tools.some(t => NAMES.includes(t.name)), 'an OAuth caller is not offered them');
  const n = upstream.length, c = clover.length;
  for (const name of NAMES) {
    const r = await oauth('tools/call', { name, arguments: { storeId: 'BL1', itemId: itemAt('BL1', 'Sneaker').id, confirm: true } });
    eq(r.error?.code, -32602, `OAuth calling ${name} → unknown tool`);
  }
  eq([upstream.length - n, clover.length - c], [0, 0], 'and nothing went upstream or to Clover');
}

// ── 2. The main worker's door, called directly ─────────────────────────────
{
  const door = (action, body, headers = {}, { method = 'POST', qs = '', e = mainEnv } = {}) =>
    main.fetch(new Request(`https://api.retjghub.com/?action=${action}${qs}`, {
      method, headers: { 'Content-Type': 'application/json', ...headers }, body: method === 'GET' ? undefined : JSON.stringify(body),
    }), e, ctx).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
  const good = { 'X-Agent-Write-Key': WK, 'X-Agent-User': 'u-su' };
  const sneaker = itemAt('BL1', 'Sneaker');
  const bodies = {
    'create-clover-item': { store: 'BL1', name: 'Door test', code: 'D1', priceCents: 100, taxable: true, hidden: true, l2: 'Softline - Shoes', l3: SHOES },
    'update-clover-item': { store: 'BL1', itemId: sneaker.id, priceCents: 1 },
    'delete-clover-item': { store: 'BL1', itemId: sneaker.id },
  };
  const c = clover.length;
  for (const [action, body] of Object.entries(bodies)) {
    const none = await door(action, body);
    eq([none.status, none.body?.code], [401, 'NO_SESSION'], `${action}: no key → the session gate's 401`);
    const rep = await door(action, body, { 'X-API-Key': UP });
    eq(rep.status, 401, `${action}: the shared reporting key → 401`);
    const wrong = await door(action, body, { ...good, 'X-Agent-Write-Key': 'wrong' });
    // 🔑 The deploy probe: the new worker's door answers {"error":"Unauthorized"} with no code; the old
    // worker never opens the door for this action, so its session gate adds "code":"NO_SESSION". Harmless
    // either way: the key is wrong, so nothing can be written.
    eq([wrong.status, wrong.body], [401, { error: 'Unauthorized' }], `${action}: a wrong agent key → the door's own 401 (no code)`);
    for (const u of ['u-admin', 'u-mgr1', 'u-su-off', 'nobody', '']) {
      eq((await door(action, body, { ...good, 'X-Agent-User': u })).status, 403, `${action}: X-Agent-User "${u}" → 403`);
    }
    for (const m of ['PATCH', 'GET', 'DELETE']) eq((await door(action, body, good, { method: m })).status, 405, `${action}: ${m} → 405`);
    eq((await door(action, body, good, { qs: '&store=BL1' })).status, 400, `${action}: any parameter but action → 400`);
    eq((await door(action, body, good, { e: { ...mainEnv, AGENT_WRITE_KEY: UP } })).status, 503, `${action}: agent key = reporting key → 503`);
    // The store and field rules hold at the door too, not only in the MCP.
    for (const store of ['BL8', 'all', 'bl1', 'BL12', undefined]) {
      eq((await door(action, { ...body, store }, good)).body?.error, 'Store not open to agent changes', `${action}: store ${store} → refused at the door`);
    }
    eq((await door(action, [body], good)).status, 400, `${action}: a body that is not an object → 400`);
  }
  for (const [action, extra] of [['create-clover-item', { costCents: 200 }], ['update-clover-item', { removeOtherCategories: true }],
    ['update-clover-item', { taxable: false }], ['update-clover-item', { currentCategoryId: 'X' }], ['delete-clover-item', { stores: ['BL1'] }]]) {
    const r = await door(action, { ...bodies[action], ...extra }, good);
    eq([r.status, r.body?.error], [400, `Unsupported field: ${Object.keys(extra)[0]}`], `${action} + ${Object.keys(extra)[0]} → refused at the door`);
  }
  eq(writesSince(c).length, 0, 'no refusal wrote anything to Clover');

  // Through the door, the handler itself runs: a non-Clover id dies at its isCloverId (400), before Clover.
  const c2 = clover.length;
  const bad = await door('update-clover-item', { store: 'BL1', itemId: '../categories/C1', priceCents: 1 }, good);
  eq([bad.status, bad.body?.error], [400, 'Invalid store or itemId'], 'the right key + a superuser reach update-clover-item, which refuses ../categories/C1');
  const badDel = await door('delete-clover-item', { store: 'BL1', itemId: '..', }, good);
  eq(badDel.status, 400, 'and delete-clover-item refuses ".."');
  eq(clover.length - c2, 0, 'without a single Clover request');
  ok(logs.some(l => l.includes('"agent_write":"update-clover-item"') && l.includes('"store":"BL1"') && l.includes('"itemId":"../categories/C1"') && l.includes('"priceCents":1')),
    'the door logs the action, user, store, item and the fields asked for');
}

// ── 3. Refused before any request leaves the MCP worker ────────────────────
{
  const sneaker = itemAt('BL1', 'Sneaker').id;
  const create = { storeIds: ['BL1'], name: 'X', code: 'X1', price: 5, l2: 'Softline - Shoes', l3: SHOES, taxable: true };
  const cases = [
    ['update_clover_item', { storeId: 'BL1', itemId: sneaker, price: -1 }, /price must be a number of dollars from 0.01/],
    ['update_clover_item', { storeId: 'BL1', itemId: sneaker, price: 0 }, /price must be/],
    ['update_clover_item', { storeId: 'BL1', itemId: sneaker, price: 10000 }, /price must be/],
    ['update_clover_item', { storeId: 'BL1', itemId: sneaker, price: '15' }, /price must be/],
    ['update_clover_item', { storeId: 'BL1', itemId: sneaker, price: 15.005 }, /whole cents/],
    ['update_clover_item', { storeId: 'BL8', itemId: sneaker, price: 15 }, /BL8 \(Holland\) closed for good/],
    ['update_clover_item', { storeIds: ['bl8'], matchName: 'Sneaker', price: 15 }, /BL8 \(Holland\) closed/],
    ['update_clover_item', { storeId: 'BL99', itemId: sneaker, price: 15 }, /Unknown store "BL99"/],
    ['update_clover_item', { storeId: 'BL1', itemId: '../categories/C1', price: 15 }, /itemId must be a POS item id/],
    ['update_clover_item', { storeId: 'BL1', itemId: sneaker, price: 15, store: 'BL1' }, /Unknown argument "store"/],
    ['update_clover_item', { storeId: 'BL1', itemId: sneaker }, /at least one change/],
    ['update_clover_item', { storeId: 'BL1', itemId: sneaker, storeIds: ['BL1'], matchName: 'Sneaker', price: 1 }, /Target one item/],
    ['update_clover_item', { storeIds: ['BL1'], price: 1 }, /matchName is required/],
    ['update_clover_item', { storeIds: ['all', 'BL1'], matchName: 'Sneaker', price: 1 }, /"all" stands alone/],
    ['update_clover_item', { storeId: 'BL1', itemId: sneaker, name: '<script>x</script>' }, /may not contain/],
    ['update_clover_item', { storeId: 'BL1', itemId: sneaker, hidden: 'yes' }, /hidden must be true or false/],
    ['update_clover_item', { storeId: 'BL1', itemId: sneaker, price: 1, confirm: 'true' }, /confirm must be true or false/],
    ['create_clover_item', { ...create, storeIds: ['BL8'] }, /BL8 \(Holland\) closed/],
    ['create_clover_item', { ...create, storeIds: [] }, /storeIds must be a list/],
    ['create_clover_item', { ...create, code: undefined }, /code is required/],
    ['create_clover_item', { ...create, taxable: undefined }, /taxable is required/],
    ['create_clover_item', { ...create, code: '=HYPERLINK(1)' }, /code may hold only/],
    ['create_clover_item', { ...create, name: 'x'.repeat(128) }, /at most 127/],
    ['create_clover_item', { ...create, cost: 2 }, /Unknown argument "cost"/],
    ['create_clover_item', { ...create, l2: 'Bogus L2' }, /l2 must be one of: Softline - Apparel/],
    ['update_clover_item', { storeId: 'BL1', itemId: sneaker, price: 1, confirmToken: 'abc' }, /confirmToken goes with confirm: true/],
    ['update_clover_item', { storeId: 'BL1', itemId: sneaker, price: 1, confirm: true, confirmToken: 7 }, /confirmToken must be the string/],
    ['create_clover_item', { ...create, extra: 1 }, /Unknown argument "extra"/],
    ['delete_clover_item', { storeId: 'BL1', itemId: '..' }, /itemId must be/],
    ['delete_clover_item', { storeId: 'BL8', itemId: sneaker }, /BL8 \(Holland\) closed/],
    ['delete_clover_item', { storeIds: ['BL1'], itemId: sneaker }, /Unknown argument "storeIds"/],
  ];
  const n = upstream.length;
  for (const [name, args, re] of cases) {
    const out = await tool(name, args);
    ok(out.isError && re.test(out.text), `${name} ${JSON.stringify(args).slice(0, 70)} → ${re} (got ${out.text})`);
  }
  eq(upstream.length - n, 0, 'none of those sent a single request to the main worker');
}

// ── 4. The shoe change: preview writes nothing ─────────────────────────────
{
  const n = clover.length;
  const pv = await tool('update_clover_item', { storeIds: ['all'], matchName: 'massive shoe sale', name: 'Shoes', price: 15 });
  eq(pv.isError, undefined, 'preview answers: ' + (pv.text || ''));
  ok(/PREVIEW: nothing was changed.*confirm: true/.test(pv.preview), 'says it is a preview and how to confirm');
  eq(pv.stores?.map(s => s.store), OPEN, '"all" = the five open stores, BL8 left out');
  ok(pv.stores?.every(s => JSON.stringify(s.changes) === JSON.stringify({ name: { from: 'MASSIVE SHOE SALE', to: 'Shoes' }, price: { from: 8, to: 15 } })),
    'each store shows exactly the fields that change, before → after');
  ok(pv.stores?.every(s => s.itemId === itemAt(s.store, 'MASSIVE SHOE SALE').id), 'with that store\'s own item id');
  ok(pv.stores?.every(s => !('item' in s) && !('items' in s)), 'and not the catalog read');
  eq(writesSince(n).length, 0, 'ZERO Clover writes for a preview');
  eq(itemAt('BL1', 'MASSIVE SHOE SALE')?.price, 800, 'BL1 still $8');
  const pf = await tool('update_clover_item', { storeIds: ['all'], matchName: 'massive shoe sale', name: 'Shoes', price: 15, confirm: false });
  eq([pf.preview && true, writesSince(n).length], [true, 0], 'confirm: false is a preview too');
  ok(/^[0-9a-f]{16}$/.test(pv.confirmToken || '') && pf.confirmToken === pv.confirmToken, 'a preview hands back a confirmToken, the same for the same plan');
  const args = { storeIds: ['all'], matchName: 'massive shoe sale', name: 'Shoes', price: 15 };
  const bare = await tool('update_clover_item', { ...args, confirm: true });
  ok(bare.isError && /confirm true needs the confirmToken/.test(bare.text), 'confirm without a token writes nothing: ' + bare.text);
  const other = await tool('update_clover_item', { ...args, price: 16, confirm: true, confirmToken: pv.confirmToken });
  ok(other.isError && /no longer match the preview/.test(other.text), "another preview's token (a $16 plan with the $15 token) writes nothing");
  // Someone reprices BL2's button between the preview and the yes: the user's yes was for $8 → $15.
  itemAt('BL2', 'MASSIVE SHOE SALE').price = 900;
  const drift = await tool('update_clover_item', { ...args, confirm: true, confirmToken: pv.confirmToken });
  ok(drift.isError && /no longer match the preview/.test(drift.text) && !/confirmToken[":]+ *[0-9a-f]{16}/.test(drift.text), 'a store that changed since the preview → nothing written, no new token handed over');
  itemAt('BL2', 'MASSIVE SHOE SALE').price = 800;
  eq(writesSince(n).length, 0, 'none of those wrote');
}

// ── 5. Confirm: one Clover write per store, a failing store reported alone ──
{
  const n = clover.length, l = logs.length;
  const ids = Object.fromEntries(OPEN.map(s => [s, itemAt(s, 'MASSIVE SHOE SALE').id]));
  failPatch.add('M4');
  const out = await previewThenConfirm('update_clover_item', { storeIds: ['all'], matchName: 'massive shoe sale', name: 'Shoes', price: 15 });
  failPatch.delete('M4');
  eq(out.isError, undefined, 'the confirm answers per store: ' + (out.text || ''));
  const by = Object.fromEntries((out.stores || []).map(s => [s.store, s]));
  const posts = writesSince(n);
  eq(posts.map(p => [p.method, p.path]), OPEN.map(s => ['POST', `/v3/merchants/${MERCHANT[s]}/items/${ids[s]}`]),
    'exactly one item POST per store, one store at a time, in order');
  ok(posts.every(p => JSON.stringify(p.body) === JSON.stringify({ name: 'Shoes', price: 1500 })), 'each sending only the two changed fields, price in cents');
  eq(by.BL4?.ok, false, 'BL4 (Clover 500) is reported as failed');
  ok(/500/.test(by.BL4?.error || '') && /Clover is down/.test(by.BL4?.error || ''), 'with what Clover said: ' + by.BL4?.error);
  eq([by.BL4?.took, by.BL4?.after?.price], [false, 8], 'and read back: it did not take, still $8');
  for (const s of ['BL1', 'BL2', 'BL14', 'BL16']) {
    eq([by[s]?.ok, by[s]?.took, by[s]?.after?.name, by[s]?.after?.price], [true, true, 'Shoes', 15], `${s} succeeded, read back as Shoes $15`);
  }
  eq(itemAt('BL16', 'Shoes')?.price, 1500, 'Clover holds the new price');
  const mine = logs.slice(l).filter(x => x.includes('"mcp_clover_write"')).map(x => JSON.parse(x));
  eq(mine.length, 5, 'the MCP logs one line per store');
  eq([mine[0].before.price, mine[0].after.price, mine[0].before.name, mine[0].after.name], [8, 15, 'MASSIVE SHOE SALE', 'Shoes'], 'with before → after');
  ok(logs.slice(l).filter(x => x.includes('"agent_write":"update-clover-item"')).length === 5, 'and the door logs each of the five writes');

  // The same call again is refused whole: the other four hold no "MASSIVE SHOE SALE" any more.
  const n2 = clover.length;
  const again = await tool('update_clover_item', { storeIds: ['all'], matchName: 'massive shoe sale', name: 'Shoes', price: 15, confirm: true });
  ok(again.isError && /Nothing was written: BL1: No item at BL1 named "massive shoe sale"/.test(again.text) && !/BL4:/.test(again.text),
    'repeating the chain-wide call writes nothing, naming the stores that no longer match: ' + again.text);
  eq(writesSince(n2).length, 0, 'not even BL4');
  const bl4 = await previewThenConfirm('update_clover_item', { storeIds: ['BL4'], matchName: 'massive shoe sale', name: 'Shoes', price: 15 });
  eq([bl4.stores?.[0]?.ok, bl4.stores?.[0]?.took], [true, true], 'retrying the failed store alone works: ' + (bl4.text || ''));
  eq(writesSince(n2).map(p => p.path), [`/v3/merchants/M4/items/${ids.BL4}`], 'and writes BL4 only');
  const deep = await tool('update_clover_item', { storeIds: ['BL16'], matchName: 'deep item', price: 10 });
  eq(deep.stores?.[0]?.changes, { price: { from: 9, to: 10 } }, 'an item on the second 1,000-item page is found (the read pages)');
}

// ── 6. Refusals: ambiguous names, missing names, no-ops ────────────────────
{
  const n = clover.length;
  const pv = await tool('update_clover_item', { storeIds: ['all'], matchName: 'Clearance Bin', price: 2 });
  const by = Object.fromEntries((pv.stores || []).map(s => [s.store, s]));
  ok(/2 items at BL2 named "Clearance Bin"/.test(by.BL2?.refused?.[0] || ''), 'two matches at BL2 → refused');
  eq(by.BL2?.candidates?.map(c => c.price).sort(), [3, 5], 'listing both candidates');
  ok(/No item at BL16 named "Clearance Bin"/.test(by.BL16?.refused?.[0] || ''), 'no match at BL16 → refused');
  eq(by.BL1?.changes, { price: { from: 5, to: 2 } }, 'the other stores preview normally');
  const cf = await tool('update_clover_item', { storeIds: ['all'], matchName: 'Clearance Bin', price: 2, confirm: true });
  ok(cf.isError && /Nothing was written: BL2: .*BL16: /.test(cf.text), 'a confirm with refused stores writes nothing anywhere: ' + cf.text);
  eq(writesSince(n).length, 0, 'not even at the stores that passed');
  eq(itemAt('BL1', 'Clearance Bin').price, 500, 'BL1 unchanged');

  ok(!pv.confirmToken, 'a preview with a refused store hands back no token');
  const noop = await tool('update_clover_item', { storeIds: ['BL1', 'BL2'], matchName: 'Sneaker', price: 12, confirm: true });
  ok(noop.isError && /Nothing would change at BL1, BL2/.test(noop.text), 'a no-op is refused, saying so: ' + noop.text);
  const clash = await tool('update_clover_item', { storeId: 'BL1', itemId: itemAt('BL1', 'Sneaker').id, code: '9002' });
  ok(/Code 9002 is already used here by "Premium shoes"/.test(clash.stores?.[0]?.refused?.[0] || ''), 'a code another item uses is refused');
  const nocat = await tool('update_clover_item', { storeId: 'BL1', itemId: itemAt('BL1', 'Sneaker').id, l3: 'FG BL SOFTLINES - SOCKS' });
  ok(/never creates a category/.test(nocat.stores?.[0]?.refused?.[0] || ''), 'a category the store does not have is refused');
  const gone = await tool('update_clover_item', { storeId: 'BL2', itemId: itemAt('BL1', 'Sneaker').id, price: 1 });
  ok(/No item .* at BL2\. An item id belongs to one store/.test(gone.stores?.[0]?.refused?.[0] || ''), "another store's id is refused");
  eq(writesSince(n).length, 0, 'none of those wrote');
}

// ── 7. Hide, and add a category ────────────────────────────────────────────
{
  const prem = itemAt('BL1', 'Premium shoes');
  const n = clover.length;
  const pv = await tool('update_clover_item', { storeId: 'bl1', itemId: prem.id, hidden: true, l3: 'sku book items' });
  eq(pv.stores?.[0]?.changes, { hidden: { from: false, to: true }, categories: { from: [SHOES], to: [SHOES, 'Sku Book Items'] } }, 'hide + add a category, previewed in the store\'s spelling');
  eq(pv.stores?.[0]?.refused, undefined, 'a category other items at the store are in passes (any case)');
  eq(writesSince(n).length, 0, 'preview: nothing written');
  const out = await tool('update_clover_item', { storeId: 'bl1', itemId: prem.id, hidden: true, l3: 'sku book items', confirm: true, confirmToken: pv.confirmToken });
  eq([out.stores?.[0]?.ok, out.stores?.[0]?.took, out.stores?.[0]?.after?.hidden], [true, true, true], 'hidden, and read back: ' + (out.text || ''));
  eq(out.stores?.[0]?.after?.categories, [SHOES, 'Sku Book Items'], 'in the existing category, beside its own');
  ok(!writesSince(n).some(p => p.path.endsWith('/categories')), 'no category was created');
  eq(itemAt('BL1', 'Premium shoes').price, 1500, 'the price was not touched');
  ok(logs.some(l => l.includes('"agent_write":"update-clover-item"') && l.includes('"l3":"Sku Book Items"')), 'the handler was sent the store\'s own spelling');

  // Clover returns less on the read-back: say so, never "did not take".
  const sneaker = itemAt('BL1', 'Sneaker');
  emptyRead = { m: 'M1', skip: 2 };   // the preview's read, the confirm's read, then the read-back
  const shortOut = await previewThenConfirm('update_clover_item', { storeId: 'BL1', itemId: sneaker.id, price: 11 });
  emptyRead = null;
  const s0 = shortOut.stores?.[0] || {};
  eq([s0.ok, s0.took, s0.after], [true, null, null], 'a short read-back: written, took unknown (null), not false');
  ok(/listed 0 items where \d+ were expected/.test(s0.readBack || ''), 'and the answer says the read looks short: ' + s0.readBack);

  // The patch is saved, then the category step fails: the answer says part of it was saved.
  const sk = itemAt('BL1', 'Brass Lamp');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => (String(u).includes('/category_items') && !String(u).includes('delete=true')
    ? new Response(JSON.stringify({ message: 'category service down' }), { status: 503 }) : realFetch(u, init));
  const part = await previewThenConfirm('update_clover_item', { storeId: 'BL1', itemId: sk.id, price: 21, l3: SHOES });
  globalThis.fetch = realFetch;
  const p0 = part.stores?.[0] || {};
  eq([p0.ok, p0.took, p0.after?.price], [false, false, 21], 'patch saved, category failed: ok false, read back at the new price');
  ok(/part of it was saved/.test(p0.note || ''), 'and the answer says part of it was saved: ' + p0.note);
}

// ── 8. Create ──────────────────────────────────────────────────────────────
let created;
{
  const args = { storeIds: ['BL1', 'BL14'], name: 'Spring/Summer Shoe Clearance', code: '9100', price: 5, l2: 'Softline - Shoes', l3: SHOES, taxable: true };
  const n = clover.length;
  const pv = await tool('create_clover_item', args);
  eq(pv.isError, undefined, 'create preview: ' + (pv.text || ''));
  eq(pv.create, { name: 'Spring/Summer Shoe Clearance', code: '9100', price: 5, l2: 'Softline - Shoes', taxable: true, hidden: false }, 'shows the item to be created');
  eq(pv.stores?.map(s => [s.store, s.willCreate, s.category]), [['BL1', true, SHOES], ['BL14', true, SHOES]], 'at each store, in that store\'s category');
  eq(writesSince(n).length, 0, 'preview: nothing written');
  ok(/^[0-9a-f]{16}$/.test(pv.confirmToken || ''), 'with a confirmToken');
  const out = await tool('create_clover_item', { ...args, confirm: true, confirmToken: pv.confirmToken });
  eq(out.stores?.map(s => [s.store, s.ok, s.took]), [['BL1', true, true], ['BL14', true, true]], 'created at both, and read back');
  eq(mainEnv.SALES_SNAPSHOTS._map.has('item-costs:global'), false, "no write to the Hub's item-master cost map");
  eq(out.mapping, undefined, 'a category the Hub already maps: no mapping written or claimed');
  ok(out.stores?.every(s => /^N/.test(s.itemId || '') && s.after?.itemId === s.itemId), 'each with its new item id');
  const w = writesSince(n);
  eq(w.map(p => p.path.replace(/M\d+/, 'M')), ['/v3/merchants/M/items', '/v3/merchants/M/category_items', '/v3/merchants/M/items', '/v3/merchants/M/category_items'],
    'one item + one category link per store, one store at a time; no category created');
  ok(!w.some(p => p.path.includes('M2/') || p.path.includes('M8/')), 'only the stores asked for');
  created = Object.fromEntries((out.stores || []).map(s => [s.store, s.itemId]));

  const dup = await tool('create_clover_item', { ...args, storeIds: ['BL14', 'BL2'] });
  ok(/Code 9100 is already used by "Spring\/Summer Shoe Clearance"/.test(dup.stores?.[0]?.refused?.[0] || '') && dup.stores?.[1]?.willCreate === true,
    'a code already used at a store is refused there in the preview');
  const n2 = clover.length;
  const dupc = await tool('create_clover_item', { ...args, storeIds: ['BL14', 'BL2'], confirm: true });
  ok(dupc.isError && /Nothing was written: BL14/.test(dupc.text), 'and the confirm writes nothing');
  const nocat = await tool('create_clover_item', { ...args, code: '9101', l3: 'FG BL SOFTLINES - SOCKS', confirm: true, confirmToken: pv.confirmToken });
  ok(nocat.isError && /never creates a category/.test(nocat.text), 'a category a store lacks: nothing written');
  const taxw = await tool('create_clover_item', { ...args, storeIds: ['BL2'], code: '9102', taxable: false });
  ok(/taxable is false, but 3 of the 3 items/.test(taxw.stores?.[0]?.warnings?.join(' ') || ''), 'a tax setting unlike the category\'s is flagged');
  eq(writesSince(n2).length, 0, 'none of those wrote');

  // An unmapped category typed in another case: the store's spelling is sent, so the mapping lands under it.
  const nb = await previewThenConfirm('create_clover_item', { storeIds: ['BL1', 'BL2'], name: 'Odd bit 2', code: '6002', price: 1, l2: 'Hardlines', l3: 'fg bl new bits', taxable: true });
  eq(nb.stores?.map(s => s.ok), [true, true], 'created in the unmapped category: ' + (nb.text || ''));
  const ov = await mainEnv.SALES_SNAPSHOTS.get('item-overrides:global', 'json');
  eq(ov?.l3Map, { 'FG BL NEW BITS': 'Hardlines' }, 'the one chain-wide mapping is keyed by the POS spelling');
  ok(/"FG BL NEW BITS" had no main category in the Hub; it now books to "Hardlines"/.test(nb.mapping || ''), 'and the answer says so: ' + nb.mapping);

  // One store's create fails partway: reported alone, the others still created.
  failCreate.add('M14');
  const mid = await previewThenConfirm('create_clover_item', { storeIds: ['BL1', 'BL14', 'BL2'], name: 'Sock bin', code: '9200', price: 2, l2: 'Softline - Shoes', l3: SHOES, taxable: true });
  failCreate.delete('M14');
  eq(mid.stores?.map(s => [s.store, s.ok, s.took]), [['BL1', true, true], ['BL14', false, false], ['BL2', true, true]], 'BL14 failed alone, BL1 and BL2 created');
  ok(/Clover is down/.test(mid.stores?.[1]?.error || ''), "with Clover's reason: " + mid.stores?.[1]?.error);
}

// ── 9. Delete ──────────────────────────────────────────────────────────────
{
  const n = clover.length;
  const pv = await tool('delete_clover_item', { storeId: 'BL14', itemId: created.BL14 });
  ok(/PREVIEW/.test(pv.preview) && pv.item?.name === 'Spring/Summer Shoe Clearance' && /Prefer update_clover_item with hidden: true/.test(pv.prefer), 'delete previews the item and prefers hiding');
  eq(writesSince(n).length, 0, 'preview: nothing deleted');
  const wrongStore = await tool('delete_clover_item', { storeId: 'BL2', itemId: created.BL1 });
  ok(wrongStore.isError && /No item .* at BL2, so nothing was deleted\. An item id belongs to one store/.test(wrongStore.text), "another store's id is an error, not \"already gone\": " + wrongStore.text);
  const out = await tool('delete_clover_item', { storeId: 'BL14', itemId: created.BL14, confirm: true, confirmToken: pv.confirmToken });
  eq([out.deleted, out.before?.code], [true, '9100'], 'deleted, read back as gone');
  eq(writesSince(n).map(p => [p.method, p.path]), [['DELETE', `/v3/merchants/M14/items/${created.BL14}`]], 'one DELETE, at that store only');
  const again = await tool('delete_clover_item', { storeId: 'BL14', itemId: created.BL14, confirm: true, confirmToken: pv.confirmToken });
  ok(again.isError && /nothing was deleted.*If it was deleted a moment ago, it is gone/.test(again.text), 'again: an error that says it may already be gone');
  eq(writesSince(n).length, 1, 'and nothing sent');
  // A short read-back after a delete is not proof it is gone.
  const lamp = itemAt('BL2', 'Brass Lamp');
  emptyRead = { m: 'M2', skip: 2 };
  const sd = await previewThenConfirm('delete_clover_item', { storeId: 'BL2', itemId: lamp.id });
  emptyRead = null;
  eq(sd.deleted, null, 'deleted with a short read-back → deleted: null, not true');
  ok(/may be short/.test(sd.readBack || ''), 'saying the read looks short');
  ok(itemAt('BL1', 'Spring/Summer Shoe Clearance'), 'BL1\'s item of the same code is untouched');
}

// ── 10. Pins ───────────────────────────────────────────────────────────────
{
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const all = JSON.parse((/const ALL_STORES = (\[[^\]]*\])/.exec(src) || [])[1] || '[]');
  eq(writes.CLOVER_STORES, all.filter(s => s !== 'BL8'), 'CLOVER_STORES = worker.js ALL_STORES without BL8');
  const l2 = ((/const VALID_L2 = new Set\(\[([\s\S]*?)\]\)/.exec(src) || [])[1] || '').match(/"[^"]+"/g)?.map(x => JSON.parse(x)) || [];
  eq(writes.L2_NAMES, l2, 'L2_NAMES = worker.js VALID_L2');
  ok(seen.every(t => !t.includes(WK) && !t.includes(UP)), 'no answer to the agent contains the write or reporting key');
  ok(logs.every(l => !l.includes(WK)), 'no log line contains the write key');
  ok(upstream.filter(u => u.method === 'POST').every(u => u.wk === WK && u.user === 'u-su' && !u.key && !u.auth), 'writes carry the write key and the user only');
  ok(upstream.filter(u => u.method === 'GET').every(u => u.key === UP && !u.wk), 'reads carry the reporting key only');
  ok(!clover.some(c => c.path.includes('/M8/')), 'BL8\'s POS was never touched');
}

console.log = realLog;
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
