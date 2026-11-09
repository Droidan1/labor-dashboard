// What an agent may change in RETJG HUB, each through the main worker's agent door
// (worker.js AGENT_WRITE_ACTIONS) and the page's OWN handler for it:
//
// - update_supply_request (Brian, 2026-10-30): a supply request's status and what it cost,
//   so an agent that sees the order confirmation in his email can record it and the store
//   manager is told it was ordered. The Supply Request page's two handlers (Save Status,
//   Save Fulfillment) run, so history, the requester's push + email and the 80% budget
//   alert are exactly what a click does.
// - create_clover_item, update_clover_item, delete_clover_item (Brian, 2026-11-09, after the
//   shoe reprice found last week's sale buttons on all five registers): the Inventory
//   Viewer's create / update / delete handlers. Each PREVIEWS unless confirm is true.
//
// 🔑 Not in cli/reporting.mjs: that table is read-only by construction and is what the
// CLI (and the reporting key every holder shares) is built from.
import { QUERIES, UsageError, QueryError, argSpec, runQuery } from '../cli/reporting.mjs';

const STATUSES = argSpec('supplyStatus').values;
const MAX_COST = 100_000;
// 🛑 An agent copies this from a vendor's email, so it is untrusted text. Letters, digits and
// a little punctuation only, starting with a letter, digit or #: no markup for the pages that
// show it, and no leading = + - @ for the Reports tab's CSV export (spreadsheet formulas).
const INVOICE_RE = /^[A-Za-z0-9#][A-Za-z0-9 #._\/-]{0,99}$/;

export const WRITE_TOOLS = [{
  name: 'update_supply_request',
  title: 'Update a supply request',
  description: 'Change one supply request as the Supply Request page does: its status, and what the order cost '
    + '(with the invoice or order number). Setting a status notifies the store manager who asked, by push and email, '
    + 'with note as the message; status ordered tells them it was ordered. Typical use, once the order is placed: '
    + 'status ordered, cost (USD, this request\'s share of the order) and invoiceNumber. An ordered request with a cost '
    + 'counts against its store\'s monthly supply budget. Check the request with get_supply_request first, and change '
    + 'only what the user asked for: the answer shows the values before and after.',
  inputSchema: {
    type: 'object',
    properties: {
      requestId: { type: 'string', pattern: '^[0-9a-fA-F]{32}$', description: argSpec('requestId').description },
      status: { type: 'string', enum: STATUSES, description: 'The new status. ordered is the last step.' },
      cost: { type: 'number', minimum: 0, maximum: MAX_COST, description: 'What this request cost, USD (rounded to cents). Replaces any cost already on it.' },
      invoiceNumber: { type: 'string', pattern: INVOICE_RE.source, description: 'The invoice or order number: letters, digits, spaces and # . _ / -, up to 100. Replaces any already on it.' },
      note: { type: 'string', maxLength: 1000, description: 'With a status change: the message the store manager gets. Otherwise it is saved as a comment with the cost or invoice. Not on its own.' },
    },
    required: ['requestId'],
    additionalProperties: false,
  },
  // Not idempotent: a note saved as a comment is added again each time.
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}];

export function checkUpdate(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new UsageError('arguments must be an object');
  const known = Object.keys(WRITE_TOOLS[0].inputSchema.properties);
  for (const k of Object.keys(args)) {
    if (!known.includes(k)) throw new UsageError(`Unknown argument "${k}". This takes: ${known.join(', ')}`);
  }
  const { requestId, status, cost, invoiceNumber, note } = args;
  if (typeof requestId !== 'string' || !/^[0-9a-f]{32}$/i.test(requestId)) {
    throw new UsageError('requestId must be the 32-character id from get_supply_requests');
  }
  if (status != null && !STATUSES.includes(status)) throw new UsageError(`status must be one of: ${STATUSES.join(', ')}`);
  if (cost != null && !(typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 && cost <= MAX_COST)) {
    throw new UsageError(`cost must be a number of dollars from 0 to ${MAX_COST}`);
  }
  const text = (v, name, max) => {
    if (v == null) return undefined;
    if (typeof v !== 'string') throw new UsageError(`${name} must be a string`);
    const t = v.trim();
    if (t.length > max) throw new UsageError(`${name} is at most ${max} characters`);
    return t || undefined;
  };
  const out = {
    id: requestId.toLowerCase(),  // stored lowercase (randomHex)
    status: status ?? undefined,
    cost: cost == null ? undefined : Math.round(cost * 100) / 100,
    invoice: text(invoiceNumber, 'invoiceNumber', 100),
    note: text(note, 'note', 1000),
  };
  if (out.invoice !== undefined && !INVOICE_RE.test(out.invoice)) {
    throw new UsageError('invoiceNumber may hold only letters, digits, spaces and # . _ / -, starting with a letter, digit or #');
  }
  if (out.status === undefined && out.cost === undefined && out.invoice === undefined) {
    throw new UsageError('give at least one of status, cost or invoiceNumber');
  }
  return out;
}

const GET_ONE = QUERIES.find(q => q.name === 'get_supply_request');
const snapshot = (r) => ({ status: r.status, cost: r.cost ?? null, invoiceNumber: r.invoice_number ?? null });

// read(params) → a reporting GET's body; write(action, body) → the agent door's PATCH body.
// Both throw QueryError/ToolError-style errors the caller turns into a tool error.
export async function updateSupplyRequest(args, { read, write }) {
  const u = checkUpdate(args);
  const getOne = () => runQuery(GET_ONE, { requestId: u.id }, read);
  let before;
  try { before = await getOne(); }
  catch (e) {
    if (/ 404:/.test(e.message)) throw new QueryError(`No supply request has id ${u.id}. Find it with get_supply_requests.`);
    throw e;
  }

  const fulfil = u.cost !== undefined || u.invoice !== undefined;
  if (u.status !== undefined && u.status === before.status && !fulfil) {
    throw new QueryError(`The request is already ${u.status}; nothing was changed and the manager was not notified.`);
  }

  // Status first: the budget alert (fulfillment handler) counts only ORDERED requests,
  // so recording the cost after the status lets an order that crosses 80% raise it.
  let statusChanged = false;
  if (u.status !== undefined) {
    const r = await write('supply-request-status', { id: u.id, status: u.status, ...(u.note && { note: u.note }) });
    statusChanged = !r.unchanged;
  }
  // A note rides with a real status change (it is the manager's message); otherwise it
  // is saved as a comment with the cost. The status handler drops it on "unchanged".
  let noteSaved = !!u.note && statusChanged;
  if (fulfil) {
    const body = { id: u.id };
    if (u.cost !== undefined) body.cost = u.cost;
    if (u.invoice !== undefined) body.invoice_number = u.invoice;
    if (u.note && !statusChanged) body.note = u.note;
    try { await write('supply-request-fulfillment', body); noteSaved = !!u.note; }
    catch (e) {
      if (u.status === undefined) throw e;
      throw new QueryError(`The status was ${statusChanged ? 'set to ' + u.status : 'already ' + u.status}, `
        + `but the cost and invoice were NOT saved (${e.message}). Call again with only cost and invoiceNumber`
        + `${u.note && !statusChanged ? ' (and the note, which was not saved either)' : ''}.`);
    }
  }

  // Everything is saved by now. A failed read-back must not look like a failed write,
  // or a retry would save the note twice.
  let after = null, readBack;
  try { after = await getOne(); } catch (e) { readBack = `Saved, but reading it back failed (${e.message}); do not retry, check with get_supply_request.`; }
  return {
    requestId: u.id, store: before.store,
    before: snapshot(before), after: after && snapshot(after),
    ...(readBack && { readBack }),
    statusChanged,
    // notifySupplyStatusChange in worker.js: only on a real change, only to the requester, and
    // in the background, so delivery is not known here.
    managerNotified: statusChanged
      ? `the app is emailing ${before.user_email} (and pushing, if they turned push on); delivery is not confirmed here`
      : 'no: the status did not change',
    ...(u.note && { noteSaved }),
    items: (after || before).items,
  };
}

// ── Clover items (2026-11-09) ──────────────────────────────────────────────
// 🛑 These change what the registers charge. So:
// - Every call without confirm is a PREVIEW: it reads, checks, and says exactly what would
//   be written at each store, and hands back a confirmToken (a hash of that write plan).
// - A write needs confirm: true AND that token. The confirm builds the plan again from a
//   fresh read; if any store fails a check, or the plan is not the one previewed (an item
//   renamed, repriced or added since), nothing is written anywhere. So a write can neither
//   skip the preview nor differ from what the user was shown.
// - Stores are written one at a time, so one store's failure is reported beside the others'
//   results; each is read back, and that read (not the write's reply) decides "took".
// 🛑 Clover degrades by returning LESS (CLAUDE.md rule 4), and a short page reads as the end of
// the catalogue. A read-back with fewer items than expected says so instead of concluding.

// The stores whose POS an agent may change: worker.js ALL_STORES without BL8 (pinned to it by
// scripts/test-agent-clover-write.mjs; the agent door refuses any other store too). "all"
// means these, never the handler's own "all", which includes BL8.
export const CLOVER_STORES = ['BL1', 'BL2', 'BL4', 'BL14', 'BL16'];
const CLOSED = { BL8: 'BL8 (Holland) closed for good on 2026-07-25' };
// worker.js VALID_L2, pinned to it by the same test. Only consulted when l3 has no mapping yet.
export const L2_NAMES = ['Softline - Apparel', 'Softline - Shoes', 'Softline - Accessories', 'Home', 'Furniture', 'Hardlines',
  'Consumable Food', 'Consumable HBA', 'Consumable Other', 'Seasonal', 'Bin Products', 'Gift Cards',
  'Sku Book Items', 'Custom Sales', 'Refund'];
const MAX_DOLLARS = 9999.99;
// worker.js isCloverId (letters and digits only: a / or .. would retarget Clover's URL), capped.
const ITEM_ID_RE = /^[A-Za-z0-9]{1,32}$/;
// Codes are Clover codes and SKUs: letters, digits and . _ / -. Our cap, not Clover's.
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,39}$/;
// 🛑 Agent text goes onto the register, receipts and Hub pages: no markup, no control characters.
const TEXT_BAD = /[<>\u0000-\u001f\u007f]/;
const PREFER_HIDE = 'Prefer update_clover_item with hidden: true unless this item was created by mistake: '
  + 'hiding takes it off the register and keeps the item, its id and its sales history.';
const PREVIEW = 'PREVIEW: nothing was changed. Show the user each store\'s change below and ask. Only after they say yes, '
  + 'call again with the same arguments, confirm: true and this confirmToken.';
const CONFIRM_DESC = 'Leave out (or false) to preview: reads, checks, says what would change at each store and returns a confirmToken, '
  + 'writing nothing. true (with confirmToken) = write it, only after showing the user the preview and hearing yes.';
const TOKEN_DESC = 'With confirm true: the confirmToken from the preview the user said yes to. If the stores have changed since, '
  + 'nothing is written; preview again.';
const PROTOCOL = ' Call without confirm first, show the user the preview for every store, and only after they say yes call again '
  + 'with confirm true and the preview\'s confirmToken. Change only what the user asked for.';

const usd = (c) => (c == null ? null : Math.round(Number(c)) / 100);
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
// How the handlers match: a code is in use if it is any item's code OR sku, exactly (cloverCodeInUse);
// a category by name, trimmed, any case (resolveCloverCategory).
const usesCode = (i, code) => String(i.code || '') === code || String(i.sku || '') === code;
const inCategory = (i, l3) => (i.categories || []).some(c => same(c, l3));
const view = (i) => ({
  itemId: i.id, name: i.name, code: i.code || i.sku || '', price: usd(i.price), cost: i.cost ? usd(i.cost) : null,
  hidden: !!i.hidden, taxable: !!i.defaultTaxRates, categories: i.categories || [],
  ...(i.priceType && i.priceType !== 'FIXED' && { priceType: i.priceType }),
});

// Every item at one store, through the Viewer's read (get_inventory_items' request and paging).
const INVENTORY = QUERIES.find(q => q.name === 'get_inventory_items');
const ALL_ITEMS = { ...INVENTORY, shape: (pages) => pages.flatMap(b => b.elements || []) };
const readItems = (store, read) => runQuery(ALL_ITEMS, { storeId: store }, read);
// A read-back listing fewer items than the store should now hold.
const short = (got, want) => (got < want
  ? `The read-back listed ${got} items where ${want} were expected, so it may be short (the POS can return less); check with get_inventory_items before trying again.`
  : undefined);

// The confirm token: a hash of exactly what would be written, and of the values it replaces.
async function tokenOf(plan) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(plan)));
  return [...new Uint8Array(d)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function checkToken(given, plan) {
  if (given !== await tokenOf(plan)) {
    throw new QueryError('Nothing was written: '
      + (given ? 'the stores no longer match the preview this confirmToken came from (an item changed since). '
        : 'confirm true needs the confirmToken from the preview the user said yes to. ')
      + 'Preview again without confirm, show the user, and confirm with the new token after they say yes.');
  }
}

function known(args, tool) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new UsageError('arguments must be an object');
  const names = Object.keys(tool.inputSchema.properties);
  for (const k of Object.keys(args)) {
    if (!names.includes(k)) throw new UsageError(`Unknown argument "${k}". This takes: ${names.join(', ')}`);
  }
}
const need = (args, names) => { for (const k of names) if (args[k] == null) throw new UsageError(`${k} is required`); };
function oneStore(s, name = 'storeId') {
  if (typeof s !== 'string') throw new UsageError(`${name} must be a store id string, e.g. "BL1"`);
  const id = s.trim().toUpperCase();
  if (CLOSED[id]) throw new UsageError(`${CLOSED[id]}; its POS takes no changes.`);
  if (!CLOVER_STORES.includes(id)) throw new UsageError(`Unknown store "${s}". Open stores: ${CLOVER_STORES.join(', ')}`);
  return id;
}
function storeList(v) {
  if (!Array.isArray(v) || !v.length) {
    throw new UsageError(`storeIds must be a list, e.g. ["BL1", "BL4"], or ["all"] for every open store (${CLOVER_STORES.join(', ')})`);
  }
  if (v.some(s => typeof s === 'string' && s.trim().toUpperCase() === 'ALL')) {
    if (v.length > 1) throw new UsageError('"all" stands alone in storeIds');
    return [...CLOVER_STORES];
  }
  return [...new Set(v.map(s => oneStore(s, 'each storeId')))];
}
function dollars(v, name, min) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > MAX_DOLLARS) {
    throw new UsageError(`${name} must be a number of dollars from ${min} to ${MAX_DOLLARS}`);
  }
  const c = Math.round(v * 100);
  if (Math.abs(v * 100 - c) > 1e-6) throw new UsageError(`${name} must be whole cents, e.g. 15 or 14.99`);
  return c;
}
function words(v, name, max) {
  if (typeof v !== 'string') throw new UsageError(`${name} must be a string`);
  const t = v.trim();
  if (!t) throw new UsageError(`${name} is empty`);
  if (t.length > max) throw new UsageError(`${name} is at most ${max} characters`);
  if (TEXT_BAD.test(t)) throw new UsageError(`${name} may not contain < > or control characters`);
  return t;
}
function flag(v, name) {
  if (typeof v !== 'boolean') throw new UsageError(`${name} must be true or false`);
  return v;
}
function itemCode(v) {
  const t = words(v, 'code', 40);
  if (!CODE_RE.test(t)) throw new UsageError('code may hold only letters, digits and . _ / -, starting with a letter or digit, up to 40');
  return t;
}
function itemId(v) {
  if (typeof v !== 'string' || !ITEM_ID_RE.test(v)) throw new UsageError('itemId must be a POS item id (letters and digits), from get_inventory_items');
  return v;
}
function confirmArgs(args) {
  const confirm = args.confirm == null ? false : flag(args.confirm, 'confirm');
  if (args.confirmToken != null && typeof args.confirmToken !== 'string') throw new UsageError('confirmToken must be the string from the preview');
  if (args.confirmToken != null && !confirm) throw new UsageError('confirmToken goes with confirm: true');
  return { confirm, token: args.confirmToken };
}
// A confirm with a store that fails a check writes nothing anywhere.
function refuseAll(plans) {
  const bad = plans.filter(p => p.refused);
  if (!bad.length) return;
  throw new QueryError('Nothing was written: ' + bad.map(p => `${p.store}: ${p.refused.join(' ')}`).join(' | ')
    + ' Drop those stores or fix the arguments, show the user the new preview, then confirm.');
}
const logWrite = (o) => console.log(JSON.stringify({ event: 'mcp_clover_write', ...o }));
// What a store's preview shows (the catalog read stays out of the answer).
const shown = ({ item, count, body, ...p }) => p;

const STORE_IDS = { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: CLOVER_STORES.length + 1,
  description: `Store ids, e.g. ["BL1", "BL4"], or ["all"] for every open store (${CLOVER_STORES.join(', ')}). BL8 (Holland) is closed.` };
const STORE_ID = { type: 'string', description: 'One store id, e.g. "BL1". An item id belongs to one store.' };
const ITEM_ID = { type: 'string', pattern: ITEM_ID_RE.source, description: 'The POS item id: itemId in get_inventory_items, at that store.' };
const PRICE = { type: 'number', minimum: 0.01, maximum: MAX_DOLLARS, description: 'Register price, USD, whole cents.' };
const L3 = { type: 'string', maxLength: 100, description: 'A POS category as get_inventory_items shows it, e.g. "FG BL SOFTLINES - SHOES" (any case). '
  + 'It must already hold items at each store: these tools never create a category.' };
const CONFIRM = { confirm: { type: 'boolean', description: CONFIRM_DESC }, confirmToken: { type: 'string', description: TOKEN_DESC } };
const WRITES_POS = { readOnlyHint: false, openWorldHint: true };

const CREATE = {
  name: 'create_clover_item',
  title: 'Create a POS item (register button)',
  description: 'Create a new item on the POS (Clover) at one or more stores, as the Inventory page does. '
    + 'Per store, the preview says whether the code is free there (it must be), that the category exists there, and any item '
    + 'that already has the name. The answer gives each store\'s new itemId. No cost is set here: set the POS cost afterwards '
    + 'with update_clover_item if wanted. To change or retire an existing button use update_clover_item instead.' + PROTOCOL,
  inputSchema: {
    type: 'object',
    properties: {
      storeIds: STORE_IDS,
      name: { type: 'string', minLength: 1, maxLength: 127, description: 'The name on the register and receipt.' },
      code: { type: 'string', pattern: CODE_RE.source, description: 'Item code / SKU (required, as on the Inventory page). The same code at every store; it must be unused at each.' },
      price: PRICE,
      l2: { type: 'string', enum: L2_NAMES, description: 'The main category l3 belongs to. Used only if the Hub has no main category for l3 yet; it then becomes l3\'s main category at every store.' },
      l3: L3,
      taxable: { type: 'boolean', description: 'Charge the default sales tax. Required: check what the category\'s other items use (taxable in get_inventory_items).' },
      hidden: { type: 'boolean', description: 'Create it hidden, off the register. Default false.' },
      ...CONFIRM,
    },
    required: ['storeIds', 'name', 'code', 'price', 'l2', 'l3', 'taxable'],
    additionalProperties: false,
  },
  // A second identical call is refused by the duplicate-code guard, not repeated.
  annotations: { ...WRITES_POS, destructiveHint: false, idempotentHint: false },
};

const UPDATE = {
  name: 'update_clover_item',
  title: 'Change or hide a POS item',
  description: 'Change an existing POS (Clover) item, as the Inventory page does: its name, price, cost, code or category, or '
    + 'hide it (hidden: true takes it off the register and is the normal way to retire a button). Target one item with '
    + 'storeId + itemId, or the same button at several stores with storeIds + matchName (its exact current name, any case; '
    + 'it must match exactly one item at each store, or that store is refused with the candidates). Only fields that differ '
    + 'are written; the preview shows before → after for each.' + PROTOCOL,
  inputSchema: {
    type: 'object',
    properties: {
      storeId: STORE_ID,
      itemId: ITEM_ID,
      storeIds: STORE_IDS,
      matchName: { type: 'string', minLength: 1, maxLength: 127, description: 'The item\'s current name, exactly (any case), at each of storeIds.' },
      name: { type: 'string', minLength: 1, maxLength: 127, description: 'New name.' },
      price: { ...PRICE, description: 'New register price, USD, whole cents.' },
      cost: { type: 'number', minimum: 0.01, maximum: MAX_DOLLARS, description: 'New POS unit cost (Clover\'s cost field), USD, whole cents.' },
      code: { type: 'string', pattern: CODE_RE.source, description: 'New code / SKU; it must be unused by any other item at that store.' },
      hidden: { type: 'boolean', description: 'true = hide (off the register); false = show it again.' },
      l3: { ...L3, description: L3.description + ' ADDS this category; the item keeps the ones it has.' },
      ...CONFIRM,
    },
    additionalProperties: false,
  },
  // It overwrites the old values; the same call twice leaves the same state.
  annotations: { ...WRITES_POS, destructiveHint: true, idempotentHint: true },
};

const DELETE = {
  name: 'delete_clover_item',
  title: 'Delete a POS item',
  description: 'Delete one item from one store\'s POS (Clover) for good. ' + PREFER_HIDE + ' One store and one item per call: '
    + 'an item id belongs to one store, so use that store\'s itemId from get_inventory_items.' + PROTOCOL,
  inputSchema: {
    type: 'object',
    properties: { storeId: STORE_ID, itemId: ITEM_ID, ...CONFIRM },
    required: ['storeId', 'itemId'],
    additionalProperties: false,
  },
  annotations: { ...WRITES_POS, destructiveHint: true, idempotentHint: true },
};

// ── create_clover_item ─────────────────────────────────────────────────────
export function checkCreate(args) {
  known(args, CREATE);
  need(args, CREATE.inputSchema.required);
  const l2 = words(args.l2, 'l2', 60);
  if (!L2_NAMES.includes(l2)) throw new UsageError(`l2 must be one of: ${L2_NAMES.join(', ')}`);
  return {
    stores: storeList(args.storeIds),
    name: words(args.name, 'name', 127),
    code: itemCode(args.code),
    priceCents: dollars(args.price, 'price', 0.01),
    l2,
    l3: words(args.l3, 'l3', 100),
    taxable: flag(args.taxable, 'taxable'),
    hidden: args.hidden == null ? false : flag(args.hidden, 'hidden'),
    ...confirmArgs(args),
  };
}

async function planCreate(c, store, read) {
  let items;
  try { items = await readItems(store, read); }
  catch (e) { return { store, refused: [`Could not read ${store}'s items (${e.message}).`] }; }
  const refused = [], warnings = [];
  const clash = items.find(i => usesCode(i, c.code));
  if (clash) refused.push(`Code ${c.code} is already used by "${clash.name}" (itemId ${clash.id}${clash.hidden ? ', hidden' : ''}); to change that button use update_clover_item.`);
  const cat = items.filter(i => inCategory(i, c.l3));
  // The store's own spelling goes to the handler: the Hub's category maps are exact-case.
  const category = cat.length ? cat[0].categories.find(x => same(x, c.l3)) : undefined;
  if (!cat.length) {
    refused.push(`No item at ${store} is in category "${c.l3}". This tool never creates a category: check the exact name with get_inventory_items, or create it on the Inventory page.`);
  } else {
    const taxed = cat.filter(i => i.defaultTaxRates).length;
    if (c.taxable ? taxed * 2 < cat.length : taxed * 2 > cat.length) {
      warnings.push(`taxable is ${c.taxable}, but ${taxed} of the ${cat.length} items in ${category} here are taxable.`);
    }
  }
  const named = items.filter(i => same(i.name, c.name));
  if (named.length) warnings.push(`Already named "${c.name}" here: ${named.map(i => i.id + (i.hidden ? ' (hidden)' : '')).join(', ')}.`);
  return { store, category, count: items.length,
    body: { store, name: c.name, code: c.code, priceCents: c.priceCents, taxable: c.taxable, hidden: c.hidden, l2: c.l2, l3: category },
    ...(refused.length && { refused }), ...(warnings.length && { warnings }) };
}

export async function createCloverItem(args, { read, write }) {
  const c = checkCreate(args);
  const item = { name: c.name, code: c.code, price: usd(c.priceCents), l2: c.l2, taxable: c.taxable, hidden: c.hidden };
  const plans = [];
  for (const s of c.stores) plans.push(await planCreate(c, s, read));
  const token = await tokenOf(plans.map(p => p.body));
  if (!c.confirm) {
    return { preview: PREVIEW, create: item, stores: plans.map(p => ({ ...shown(p), willCreate: !p.refused })),
      mappingNote: `l2 is used only if the Hub has no main category for the category yet; then it becomes that category's main category at every store.`,
      ...(!plans.some(p => p.refused) && { confirmToken: token }) };
  }
  refuseAll(plans);
  await checkToken(c.token, plans.map(p => p.body));

  const stores = [];
  let mapping;
  for (const p of plans) {
    const { store } = p;
    const r = { store };
    try {
      const out = await write('create-clover-item', p.body);
      const row = (out.results || []).find(x => x.store === store) || {};
      r.ok = row.ok === true;
      if (row.itemId) r.itemId = row.itemId;
      if (!r.ok) r.error = String(row.error || 'no detail').slice(0, 300);
      if (row.categoryCreated) r.categoryCreated = true;
      mapping = mapping || out.l3MapSkipped || (out.l3Mapped && `"${p.category}" had no main category in the Hub; it now books to "${c.l2}" at every store.`) || undefined;
    } catch (e) { r.ok = false; r.error = e.message; }
    try {
      const items = await readItems(store, read);
      const it = items.find(i => (r.itemId && i.id === r.itemId) || usesCode(i, c.code));
      r.after = it ? view(it) : null;
      const lacking = !it && short(items.length, p.count + (r.ok ? 1 : 0));
      r.took = lacking ? null : !!it && it.name === c.name && it.price === c.priceCents && !!it.hidden === c.hidden
        && !!it.defaultTaxRates === c.taxable && inCategory(it, c.l3);
      if (lacking) r.readBack = lacking;
      if (!r.ok && it) r.note = 'The write reported an error, but an item with this code IS there now: check it before trying again.';
    } catch (e) { r.readBack = `Could not read it back (${e.message}); check with get_inventory_items before trying again.`; }
    logWrite({ tool: CREATE.name, store, itemId: r.itemId || null, before: null, after: r.after ?? null, ok: r.ok, ...(r.error && { error: r.error }) });
    stores.push(r);
  }
  return { create: item, stores, ...(mapping && { mapping }) };
}

// ── update_clover_item ─────────────────────────────────────────────────────
const CHANGEABLE = ['name', 'price', 'cost', 'code', 'hidden', 'l3'];
export function checkUpdateItem(args) {
  known(args, UPDATE);
  const one = args.storeId != null || args.itemId != null;
  const many = args.storeIds != null || args.matchName != null;
  if (one === many) {
    throw new UsageError('Target one item with storeId + itemId, or the same button at several stores with storeIds + matchName (its exact name).');
  }
  if (one) need(args, ['storeId', 'itemId']); else need(args, ['storeIds', 'matchName']);
  if (!CHANGEABLE.some(k => args[k] != null)) throw new UsageError(`Give at least one change: ${CHANGEABLE.join(', ')}`);
  return {
    stores: one ? [oneStore(args.storeId)] : storeList(args.storeIds),
    itemId: one ? itemId(args.itemId) : undefined,
    matchName: many ? words(args.matchName, 'matchName', 127) : undefined,
    name: args.name == null ? undefined : words(args.name, 'name', 127),
    priceCents: args.price == null ? undefined : dollars(args.price, 'price', 0.01),
    costCents: args.cost == null ? undefined : dollars(args.cost, 'cost', 0.01),
    code: args.code == null ? undefined : itemCode(args.code),
    hidden: args.hidden == null ? undefined : flag(args.hidden, 'hidden'),
    l3: args.l3 == null ? undefined : words(args.l3, 'l3', 100),
    ...confirmArgs(args),
  };
}

const brief = (i) => ({ itemId: i.id, name: i.name, price: usd(i.price), hidden: !!i.hidden });
async function planUpdate(u, store, read) {
  let items;
  try { items = await readItems(store, read); }
  catch (e) { return { store, refused: [`Could not read ${store}'s items (${e.message}).`] }; }
  let item;
  if (u.itemId) {
    item = items.find(i => i.id === u.itemId);
    if (!item) return { store, refused: [`No item ${u.itemId} at ${store}. An item id belongs to one store; find it with get_inventory_items.`] };
  } else {
    const hits = items.filter(i => same(i.name, u.matchName));
    if (hits.length !== 1) {
      const like = hits.length ? hits : items.filter(i => String(i.name || '').toLowerCase().includes(u.matchName.toLowerCase()));
      return { store, refused: [`${hits.length ? hits.length + ' items' : 'No item'} at ${store} named "${u.matchName}"; give storeId + itemId for this store.`],
        candidates: like.slice(0, 10).map(brief) };
    }
    item = hits[0];
  }
  const refused = [], warnings = [], changes = {};
  const body = { store, itemId: item.id };
  const set = (k, from, to, field, value) => { if (from !== to) { changes[k] = { from, to }; body[field] = value; } };
  if (u.name !== undefined) set('name', item.name, u.name, 'name', u.name);
  if (u.priceCents !== undefined) set('price', usd(item.price), usd(u.priceCents), 'priceCents', u.priceCents);
  if (u.costCents !== undefined) set('cost', item.cost ? usd(item.cost) : null, usd(u.costCents), 'costCents', u.costCents);
  if (u.code !== undefined) {
    set('code', item.code || item.sku || '', u.code, 'code', u.code);
    const clash = changes.code && items.find(i => i.id !== item.id && usesCode(i, u.code));
    if (clash) refused.push(`Code ${u.code} is already used here by "${clash.name}" (itemId ${clash.id}).`);
  }
  if (u.hidden !== undefined) set('hidden', !!item.hidden, u.hidden, 'hidden', u.hidden);
  if (u.l3 !== undefined && !inCategory(item, u.l3)) {
    const home = items.find(i => inCategory(i, u.l3));
    if (!home) refused.push(`No item at ${store} is in category "${u.l3}". This tool never creates a category.`);
    const category = home ? home.categories.find(x => same(x, u.l3)) : u.l3;
    changes.categories = { from: item.categories || [], to: [...(item.categories || []), category] };
    body.l3 = category;
  }
  if (changes.price && item.priceType && item.priceType !== 'FIXED') {
    warnings.push(`This item's price type is ${item.priceType}, so the register may not charge the price set here.`);
  }
  return { store, itemId: item.id, name: item.name, changes, item, count: items.length, body,
    ...(!Object.keys(changes).length && { unchanged: 'Already so; nothing to write here.' }),
    ...(refused.length && { refused }), ...(warnings.length && { warnings }) };
}

export async function updateCloverItem(args, { read, write }) {
  const u = checkUpdateItem(args);
  const plans = [];
  for (const s of u.stores) plans.push(await planUpdate(u, s, read));
  if (plans.every(p => !p.refused && p.unchanged)) {
    throw new QueryError('Nothing would change at ' + plans.map(p => p.store).join(', ') + ': every field asked for already has that value. Nothing was written.');
  }
  // The values replaced are part of the plan: a confirm after someone else changed them is refused.
  const planned = plans.filter(p => !p.unchanged).map(p => ({ body: p.body, changes: p.changes }));
  const token = await tokenOf(planned);
  if (!u.confirm) return { preview: PREVIEW, stores: plans.map(shown), ...(!plans.some(p => p.refused) && { confirmToken: token }) };
  refuseAll(plans);
  await checkToken(u.token, planned);

  const stores = [];
  for (const p of plans) {
    if (p.unchanged) { stores.push(shown(p)); continue; }
    const r = { store: p.store, itemId: p.itemId, changes: p.changes };
    try { await write('update-clover-item', p.body); r.ok = true; }
    catch (e) { r.ok = false; r.error = e.message; }
    let after = null;
    try {
      const items = await readItems(p.store, read);
      const it = items.find(i => i.id === p.itemId);
      after = it ? view(it) : null;
      r.after = after;
      const lacking = !it && short(items.length, p.count);
      r.took = lacking ? null : !!it && (!p.changes.name || it.name === u.name) && (!p.changes.price || it.price === u.priceCents)
        && (!p.changes.cost || it.cost === u.costCents) && (!p.changes.code || usesCode(it, u.code))
        && (!p.changes.hidden || !!it.hidden === u.hidden) && (!p.changes.categories || inCategory(it, u.l3));
      if (lacking) r.readBack = lacking;
      // The handler patches the fields first and the category second, so a failure can follow a save.
      if (!r.ok && after && JSON.stringify(after) !== JSON.stringify(view(p.item))) {
        r.note = 'The write reported an error, but part of it was saved: compare after with changes. A retry sends only what still differs.';
      }
    } catch (e) { r.readBack = `Could not read it back (${e.message}); check with get_inventory_items before trying again.`; }
    logWrite({ tool: UPDATE.name, store: p.store, itemId: p.itemId, before: view(p.item), after, ok: r.ok, ...(r.error && { error: r.error }) });
    stores.push(r);
  }
  return { stores };
}

// ── delete_clover_item ─────────────────────────────────────────────────────
export function checkDelete(args) {
  known(args, DELETE);
  need(args, DELETE.inputSchema.required);
  return { store: oneStore(args.storeId), itemId: itemId(args.itemId), ...confirmArgs(args) };
}

export async function deleteCloverItem(args, { read, write }) {
  const d = checkDelete(args);
  const before = await readItems(d.store, read);
  const item = before.find(i => i.id === d.itemId);
  // 🛑 Not a success: the id may be another store's copy of the button, which is still on that
  // store's register. (The handler's "404 = done" is for an item it was asked about at its own store.)
  if (!item) {
    throw new QueryError(`No item ${d.itemId} at ${d.store}, so nothing was deleted. An item id belongs to one store: find ${d.store}'s own `
      + `id with get_inventory_items. If it was deleted a moment ago, it is gone.`);
  }
  const plan = { store: d.store, itemId: d.itemId, item: view(item) };
  if (!d.confirm) return { preview: PREVIEW, store: d.store, item: view(item), prefer: PREFER_HIDE, confirmToken: await tokenOf(plan) };
  await checkToken(d.token, plan);

  const out = await write('delete-clover-item', { store: d.store, itemId: d.itemId });
  const row = (out.results || []).find(x => x.store === d.store) || {};
  if (row.ok !== true) throw new QueryError(`${d.store} refused the delete: ${String(row.error || 'no detail').slice(0, 300)}. Nothing was deleted.`);
  let deleted = null, readBack;
  try {
    const after = await readItems(d.store, read);
    const gone = !after.some(i => i.id === d.itemId);
    readBack = gone ? short(after.length, before.length - 1) : undefined;
    deleted = readBack ? null : gone;
  } catch (e) { readBack = `Deleted, but reading the store back failed (${e.message}); check with get_inventory_items.`; }
  logWrite({ tool: DELETE.name, store: d.store, itemId: d.itemId, before: view(item), after: null, ok: true });
  return { store: d.store, itemId: d.itemId, before: view(item), deleted,
    ...(deleted === false && { note: 'The POS answered ok but still lists the item; check it with get_inventory_items.' }),
    ...(readBack && { readBack }) };
}

WRITE_TOOLS.push(CREATE, UPDATE, DELETE);
const RUNNERS = {
  update_supply_request: updateSupplyRequest,
  create_clover_item: createCloverItem,
  update_clover_item: updateCloverItem,
  delete_clover_item: deleteCloverItem,
};
// read(params) → a reporting GET's body; write(action, body) → the agent door's reply.
export const runWrite = (name, args, io) => RUNNERS[name](args, io);
