// What agents can ask the RETJG HUB reporting API, defined ONCE.
//
// Each query names the worker action it calls, the arguments it takes, and how
// to trim the answer to what an agent can read in one go. The CLI
// (cli/retjg.mjs) turns QUERIES into commands; the MCP worker (mcp/worker.mjs)
// turns them into tools. Read-only by construction: every action here is a GET
// the worker's reporting gate admits (worker.js, REPORTING_ACTIONS and
// REPORTING_READ_THROUGH).
//
// 🔑 One table, two surfaces. The reading rules used to live in two copies
// pinned together by a test; with seventeen queries and their trimming, two copies
// would drift. The CLI is installed as this whole directory (ORIENT.md), which
// is what lets it import this file.
//
// Pure: no I/O. The only ambient input is the clock, for Eastern-time defaults.

// How to read the numbers. Every rule is a way to read a correct figure wrongly;
// sources are GSD/worker/API_HANDOVER.md §2 and the Retail Summary / Labor code.
export const READING_RULES = [
  'Money is plain USD. In get_yesterday_sales, get_today_sales and get_sales_history (CLI: yesterday, today, history) percentages and margins are fractions: 0.43 = 43%. Everywhere else, fields ending in Pct are percents: 43 = 43%.',
  'null means unknown, never zero. reportingStatus "no_data" = the figure is unverified, not an outage. "closed" = a real 0 (Holland, BL8, closed for good 2026-07-25).',
  'netSales = posSales (the till) + auctionSales (live sales: online auction + Whatnot).',
  'Compare lySalesForDate with posSales, never netSales: last year has no live sales.',
  'Do not compare or trend DAILY grossMargin. Bin prices fall through the week while bin cost is flat, so a store swings ~27% to ~67% in a normal week. Use wtdGrossMargin. A negative bin or category margin late in the week is expected, not a problem.',
  'grossMargin is null when costCoverage < 0.90. In history it is always null.',
  'Check wtdDaysReported / mtdDaysReported before using a WTD or MTD figure.',
  'laborActualPct is worked hours x a flat rate / sales, not payroll.',
  'today: salesSoFarToday is till only but todayBudget includes live sales, so stores with live sales read ~2-4% light on pace.',
  'Retail Summary, category and trailing-week figures cover complete days only: a day appears after the 03:55 ET nightly run. A day with no item snapshot is left out of category sales, not counted as 0.',
  'Category gpmPct, grossProfit and extCost are only as good as coverage (item = known item cost, category = estimated from a category cost, none = no cost). A high gpmPct with much "none" is not a real margin.',
  'Two labor percents exist and they differ: the Retail Summary laborPct is the source sheet\'s figure; the Labor tools compute hours x $15 / sales. Do not mix them.',
  'Labor: actualLaborPct is null until every selling day in the period has hours (see complete and hoursMissingDays). In the plan, basis "budget-only" means no trend could be computed (reason says why) and recommendedHours is the budget plus 40 ASM hours.',
  'BL12 (Wyoming) is closed; its Clover account and history continue as BL16 (Indy East) from 2026-06-14.',
  'Inventory money is USD per unit. In get_inventory_items, cost is the POS (Clover) item cost field, which most items leave empty: null there means none in the POS (counted in noCost), never free, and gpPct needs it. Sales margins (grossMargin, category gpmPct) come from the app\'s own item and category costs instead, so an item with no POS cost can still have a known margin in the sales tools.',
  'get_inventory_items reads the POS live (a few seconds) and lists at most limit rows, but its counts cover the whole catalog. Bin dump and truck totals cover every entry in the period even when only the newest rows are listed; complete false means the period hit the server cap and the totals are short.',
  'Out of stock: monthly totals always cover the whole period; moreRows means only the newest limit entries are listed. shrinkCost is the cost of Stolen, Damaged and Expired; storeUseCost is Store Use. linesWithoutCost and linesWithoutPrice mean those totals are short.',
];

// The caller can fix this: a bad or missing argument. CLI exit 2; MCP tool error.
export class UsageError extends Error {}
// The query ran and could not answer: an unknown store, an API refusal. CLI exit
// 1; MCP tool error. `extra` rides along in the CLI's JSON error.
export class QueryError extends Error {
  constructor(message, extra = {}) { super(message); this.extra = extra; }
}

// ── Eastern-time dates ─────────────────────────────────────────────────────
export const todayET = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
const addDays = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayOfWeek = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay();
const saturdayEnding = (iso) => addDays(iso, (6 - dayOfWeek(iso) + 7) % 7);
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5);
// The Labor page plans the week ending the Saturday AFTER this one, and shows
// Budget vs Actual for the week before that (index.html laborUpcomingSaturday,
// LABOR_TAB_WEEKS_BACK). Defaults here match it.
export const laborPlanWeek = (today = todayET()) => addDays(saturdayEnding(today), 7);

const round2 = (n) => Math.round(n * 100) / 100;
const upper = (s) => (s == null ? undefined : s.trim().toUpperCase());

// ── Arguments ──────────────────────────────────────────────────────────────
// One definition per argument: its type, its CLI flag, and what it means.
const ARG = {
  storeId: { type: 'string', flag: 'store', description: 'Store id, e.g. BL1 (see list_stores). Omit for every store.' },
  from: { type: 'date', flag: 'from', description: 'First day, YYYY-MM-DD, Eastern time.' },
  to: { type: 'date', flag: 'to', description: 'Last day, YYYY-MM-DD, Eastern time. Yesterday is the latest complete day.' },
  days: { type: 'integer', flag: 'days', min: 1, max: 400, description: 'Days back from yesterday. Default 30.' },
  level: { type: 'enum', flag: 'level', values: ['l2', 'l3'], description: 'l2 = the 12 main categories (default); l3 = their subcategories.' },
  end: { type: 'date', flag: 'end', description: 'A day in the last week to include, YYYY-MM-DD. Default yesterday.' },
  weeks: { type: 'integer', flag: 'weeks', min: 1, max: 110, description: 'How many weeks, newest last. Default 13.' },
  categories: { type: 'enum', flag: 'categories', values: ['none', 'l2', 'l3'], description: 'Add category units, net and orders per week: none (default), l2 or l3.' },
  bucket: { type: 'enum', flag: 'bucket', values: ['total', 'day', 'week', 'month'], description: 'Sum by: total (default), day, week (ending Saturday) or month.' },
  hourBucket: { type: 'enum', flag: 'bucket', values: ['hour', 'slot'], description: 'hour = sum each hour of day across the range (default); slot = each day and hour separately.' },
  grain: { type: 'enum', flag: 'grain', values: ['d', 'w', 'm'], description: 'd = days, w = weeks ending Saturday (default), m = months.' },
  week: { type: 'date', flag: 'week', description: 'The Saturday that ends the week to plan. Default: the week after this one, as the Labor page shows.' },
  // Inventory (2026-10-15)
  search: { type: 'string', flag: 'search', description: 'Only items whose name, code or category contains this text (any case).' },
  itemFilter: { type: 'enum', flag: 'filter', values: ['all', 'no-cost', 'duplicates', 'hidden'], description: 'all (default); no-cost = no cost on file; duplicates = a code or SKU used by more than one item; hidden = hidden in the POS.' },
  // 200: measured, about the most rows of the widest of these that fit in one MCP answer.
  limit: { type: 'integer', flag: 'limit', min: 1, max: 200, description: 'Most rows to list, newest or A-Z first. Default 100. Totals always cover everything.' },
  scheduleFilter: { type: 'enum', flag: 'filter', values: ['all', 'upcoming', 'active', 'past'], description: 'all (default), upcoming (not started), active (on sale now) or past (completed, cancelled or failed).' },
  dumpWeeks: { type: 'integer', flag: 'weeks', min: 1, max: 52, description: 'Weeks back from now. Default 8.' },
  truckMonths: { type: 'integer', flag: 'months', min: 1, max: 24, description: 'Months back from now. Default 6.' },
  mosMonths: { type: 'integer', flag: 'months', min: 1, max: 60, description: 'Months back from now. Default 3.' },
  truckId: { type: 'integer', flag: 'truck', min: 1, max: 2147483647, description: 'A truck id, from get_trucks.' },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (s) => DATE_RE.test(s) && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s;

// Validates against the query's argument list. Values arrive typed: the CLI
// turns digit-only flags into numbers before calling this.
export function checkArgs(query, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new UsageError('arguments must be an object');
  const names = query.args.map(a => a.name);
  for (const k of Object.keys(args)) {
    if (!names.includes(k)) throw new UsageError(`Unknown argument "${k}". This takes: ${names.join(', ') || 'nothing'}`);
  }
  for (const { name, required } of query.args) {
    const v = args[name], spec = ARG[name];
    if (v == null || v === '') {
      if (required) throw new UsageError(`${name} is required (${spec.description})`);
      continue;
    }
    if (spec.type === 'string' && typeof v !== 'string') throw new UsageError(`${name} must be a string, e.g. "BL1"`);
    if (spec.type === 'date' && !(typeof v === 'string' && isRealDate(v))) throw new UsageError(`${name} must be a date, YYYY-MM-DD`);
    if (spec.type === 'integer' && !(Number.isInteger(v) && v >= spec.min && v <= spec.max)) {
      throw new UsageError(`${name} must be a whole number from ${spec.min} to ${spec.max}`);
    }
    if (spec.type === 'enum' && !spec.values.includes(v)) throw new UsageError(`${name} must be one of: ${spec.values.join(', ')}`);
  }
  query.check?.(args);
  return args;
}

// The MCP inputSchema for a query.
export function inputSchema(query) {
  const properties = {};
  for (const { name } of query.args) {
    const s = ARG[name];
    properties[name] = s.type === 'integer' ? { type: 'integer', minimum: s.min, maximum: s.max, description: s.description }
      : s.type === 'enum' ? { type: 'string', enum: s.values, description: s.description }
      : s.type === 'date' ? { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: s.description }
      : { type: 'string', description: s.description };
  }
  const required = query.args.filter(a => a.required).map(a => a.name);
  return { type: 'object', properties, ...(required.length && { required }), additionalProperties: false };
}
export const argSpec = (name) => ARG[name];

// ── Trimming ───────────────────────────────────────────────────────────────
function onlyStore(body, store) {
  if (!store) return body;
  const id = upper(store);
  const stores = body.stores.filter(s => s.storeId === id);
  if (!stores.length) {
    const ids = body.stores.map(s => s.storeId);
    throw new QueryError(`Unknown store "${store}". Valid ids: ${ids.join(', ')}`, { stores: ids });
  }
  return { ...body, stores };
}

// Narrow a { STORE: … } map to one store, or keep them all.
function pickStores(map, store) {
  const all = map || {};
  if (!store) return all;
  const id = upper(store);
  if (!(id in all)) {
    throw new QueryError(`Unknown store "${store}". Valid ids: ${Object.keys(all).join(', ')}`, { stores: Object.keys(all) });
  }
  return { [id]: all[id] };
}

const CATEGORY_FIELDS = ['category', 'qty', 'pctQty', 'gross', 'discounts', 'refunds', 'netSales', 'asp',
  'cost', 'extCost', 'grossProfit', 'gpmPct', 'coverage'];
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o && k in o).map(k => [k, o[k]]));

function shapeSummary(b, a) {
  const id = upper(a.storeId);
  const stores = Object.fromEntries(Object.entries(pickStores(b.stores, a.storeId)).map(([s, v]) => [s, v?.totals ?? null]));
  const matrix = (b.company?.l2Matrix || []).map(r => (id ? { l2: r.l2, netSales: r.byStore?.[id] ?? null }
    : { l2: r.l2, byStore: r.byStore, total: r.total }));
  return {
    from: b.from, to: b.to,
    ...(b.lazy && { note: 'Range over 120 days: totals only. qty and asp are null and there is no category matrix; use get_store_categories for one store.' }),
    ...(!id && { company: b.company?.totals ?? null }),
    stores,
    categoriesByStore: matrix,
  };
}

function shapeStoreCategories(b, a) {
  const l3 = a.level === 'l3';
  return {
    store: b.store, from: b.from, to: b.to,
    totals: b.totals,
    categoryTotals: b.itemSales?.totals ?? null,
    orderCount: b.itemSales?.orderCount ?? null,
    categories: (b.itemSales?.categories || []).map(c => ({
      ...pick(c, CATEGORY_FIELDS),
      ...(l3 && { l3: (c.l3Rows || []).map(r => ({ l3: r.l3, ...pick(r, CATEGORY_FIELDS.filter(k => k !== 'category')) })) }),
    })),
  };
}

const WEEK_METRICS = ['netSales', 'qty', 'transactions', 'asp', 'laborPct', 'budget'];
function shapeWeeks(b, a) {
  const id = upper(a.storeId);
  const ids = Object.keys(pickStores(b.stores, a.storeId));
  const mode = a.categories || 'none';
  const at = (series, i) => Object.fromEntries(WEEK_METRICS.map(m => [m, series?.[m]?.[i] ?? null]));
  return {
    weeks: (b.dates || []).map((d, i) => {
      const row = { week: d.week, start: d.start, end: d.end, stores: Object.fromEntries(ids.map(s => [s, at(b.stores[s], i)])) };
      if (!id) row.total = at(b.total, i);
      if (mode === 'l2') {
        row.categories = id
          ? { units: b.perStoreL2Units?.[i]?.[id] ?? null, net: b.perStoreL2Net?.[i]?.[id] ?? null, orders: b.perStoreL2Orders?.[i]?.[id] ?? null }
          : { units: b.l2Units?.[i] ?? null, net: b.l2Net?.[i] ?? null };
      }
      if (mode === 'l3') {
        row.categories = id
          ? { units: b.perStoreL3Units?.[i]?.[id] ?? null, net: b.perStoreL3Net?.[i]?.[id] ?? null, orders: b.perStoreL3Orders?.[i]?.[id] ?? null }
          : { unitsByStore: b.perStoreL3Units?.[i] ?? null, netByStore: b.perStoreL3Net?.[i] ?? null };
      }
      return row;
    }),
  };
}

// category-series and category-hours share one shape:
//   l2: { STORE: { key: { L2: [net, qty] } } }   l3: { STORE: { key: { L2: { L3: [net, qty] } } } }
// with key a date (series) or a YYYY-MM-DDTHH slot (hours). Sum into buckets,
// per store and for the chain.
function sumCategories(b, level, keyFor) {
  const src = (level === 'l3' ? b.l3 : b.l2) || {};
  const add = (into, leaf, [net, qty]) => {
    const cur = into[leaf] || (into[leaf] = { net: 0, qty: 0 });
    cur.net += Number(net) || 0;
    cur.qty += Number(qty) || 0;
  };
  const stores = {}, chain = {};
  for (const [store, byKey] of Object.entries(src)) {
    const periods = {};
    for (const [key, cats] of Object.entries(byKey || {})) {
      const bucket = keyFor(key);
      for (const target of [periods[bucket] || (periods[bucket] = {}), chain[bucket] || (chain[bucket] = {})]) {
        for (const [l2, v] of Object.entries(cats || {})) {
          if (level === 'l3') {
            const l3s = target[l2] || (target[l2] = {});
            for (const [l3, pair] of Object.entries(v || {})) add(l3s, l3, pair);
          } else add(target, l2, v);
        }
      }
    }
    stores[store] = { keysWithData: Object.keys(byKey || {}).length, periods };
  }
  const roundAll = (o) => {
    for (const v of Object.values(o)) {
      if (!v || typeof v !== 'object') continue;
      if ('net' in v && 'qty' in v) v.net = round2(v.net);
      else roundAll(v);
    }
    return o;
  };
  return { stores: roundAll(stores), chain: roundAll(chain) };
}

const DAY_KEY = { total: () => 'total', day: (d) => d, week: (d) => saturdayEnding(d), month: (d) => d.slice(0, 7) };
function shapeCategorySales(b, a) {
  const bucket = a.bucket || 'total';
  const { stores, chain } = sumCategories(b, b.level, DAY_KEY[bucket]);
  for (const s of Object.values(stores)) { s.daysWithData = s.keysWithData; delete s.keysWithData; }
  return {
    from: b.from, to: b.to, level: b.level, bucket, storeDays: b.storeDays,
    stores: pickStores(stores, a.storeId),
    ...(!a.storeId && { chain }),
  };
}

function shapeCategoryHours(b, a) {
  const bucket = a.hourBucket || 'hour';
  const { stores, chain } = sumCategories(b, b.level, bucket === 'hour' ? (slot) => slot.slice(11, 13) : (slot) => slot);
  for (const s of Object.values(stores)) { s.slotsWithData = s.keysWithData; delete s.keysWithData; }
  return {
    from: b.from, to: b.to, level: b.level, bucket, days: b.days,
    source: b.source, missing: b.missing,
    stores: pickStores(stores, a.storeId),
    ...(!a.storeId && { chain }),
  };
}

// ── Inventory ──────────────────────────────────────────────────────────────
const dollars = (cents) => (cents == null ? null : round2(Number(cents) / 100));
const num = (v) => Number(v) || 0;
// { group: { field: Σ fn(row) } } over rows grouped by row[key].
function totalsBy(rows, key, fields) {
  const out = {};
  for (const r of rows) {
    const t = out[r[key]] || (out[r[key]] = Object.fromEntries(Object.keys(fields).map(f => [f, 0])));
    for (const [f, fn] of Object.entries(fields)) t[f] += fn(r);
  }
  return out;
}
const dropMedia = ({ content_type, r2_key, photo_url, ...rest }) => rest;

// The Inventory Viewer: the Clover catalog, 1,000 items a page. Codes are matched the
// way the page matches them (code, else SKU, trimmed, any case).
const dupKey = (i) => String(i.code || i.sku || '').trim().toLowerCase();
function shapeInventory(pages, a) {
  const all = pages.flatMap(b => b.elements || []);
  const seen = new Map();
  for (const i of all) { const k = dupKey(i); if (k) seen.set(k, (seen.get(k) || 0) + 1); }
  const dup = new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  const q = (a.search || '').trim().toLowerCase();
  const filter = a.itemFilter || 'all';
  const matched = all
    .filter(i => filter === 'all' || (filter === 'no-cost' && !i.cost) || (filter === 'hidden' && i.hidden) || (filter === 'duplicates' && dup.has(dupKey(i))))
    .filter(i => !q || [i.name, i.code, i.category].some(v => String(v || '').toLowerCase().includes(q)))
    .sort((x, y) => (filter === 'duplicates' ? dupKey(x).localeCompare(dupKey(y)) : 0) || String(x.name).localeCompare(String(y.name)));
  const limit = a.limit || 100;
  return {
    store: upper(a.storeId), items: all.length,
    hidden: all.filter(i => i.hidden).length,
    noCost: all.filter(i => !i.cost).length,
    duplicateCodes: dup.size,
    matched: matched.length, listed: Math.min(limit, matched.length),
    rows: matched.slice(0, limit).map(i => ({
      name: i.name, code: i.code, ...(i.sku && i.sku !== i.code && { sku: i.sku }),
      price: dollars(i.price), cost: i.cost ? dollars(i.cost) : null,
      gpPct: i.price && i.cost ? Math.round((i.price - i.cost) / i.price * 1000) / 10 : null,
      category: i.category || null,
      ...((i.categories || []).length > 1 && { alsoIn: i.categories.filter(c => c !== i.category) }),
      hidden: !!i.hidden, taxable: !!i.defaultTaxRates,
      ...(dup.has(dupKey(i)) && { duplicateCode: true }),
      modified: i.modifiedTime ? new Date(i.modifiedTime).toISOString() : null,
    })),
  };
}

// list-sale-schedules reads at most 200 ITEM rows, so a store with more is cut there.
const SCHEDULE_ROWS_CAP = 200;
function shapeSchedules(b, a) {
  const groups = b.groups || [];
  const itemRows = groups.reduce((n, g) => n + (g.items || []).length, 0);
  const limit = a.limit || 100;
  return {
    store: upper(a.storeId), filter: a.scheduleFilter || 'all',
    complete: itemRows < SCHEDULE_ROWS_CAP, schedulesFound: groups.length, listed: Math.min(limit, groups.length),
    schedules: groups.slice(0, limit).map(g => ({
      scheduleGroup: g.scheduleGroup, status: g.status,
      ...(g.discountKind === 'percent' ? { discountPct: g.discountValue } : { discountOff: dollars(g.discountValue) }),
      startsAt: g.startsAt, endsAt: g.endsAt, createdAt: g.createdAt,
      items: (g.items || []).map(i => ({
        name: i.name, itemId: i.id, originalPrice: dollars(i.originalPrice), salePrice: dollars(i.salePrice),
        status: i.status, activatedAt: i.activatedAt, revertedAt: i.revertedAt, ...(i.errorMsg && { error: String(i.errorMsg).slice(0, 120) }),
      })),
    })),
  };
}

// Totals over EVERY row the server returned; only the listing is cut to `limit`.
function shapeBinDumps(b, a) {
  const rows = b.rows || [];
  return {
    weeks: b.weeks, complete: !b.truncated,
    totals: {
      byStore: totalsBy(rows, 'store', { entries: () => 1, units: r => num(r.units) }),
      byWeek: totalsBy(rows, 'week', { entries: () => 1, units: r => num(r.units) }),
    },
    listed: Math.min(a.limit || 100, rows.length),
    rows: rows.slice(0, a.limit || 100).map(dropMedia),
  };
}

// List rows carry what tells trucks apart; addresses and edit stamps stay in get_truck,
// or a default listing of 100 uses most of one answer.
const TRUCK_LIST_FIELDS = ['id', 'store', 'bol_no', 'ship_from', 'bol_date', 'carrier', 'trailer_no', 'seal_no', 'pro_no',
  'pallet_count', 'received', 'units', 'opened_by', 'opened_at', 'closed_by', 'closed_at', 'close_note',
  'dup_approved_by', 'dup_reason', 'dup_approved', 'has_photo', 'month'];
function shapeTrucks(b, a) {
  const rows = b.rows || [];
  const byStore = totalsBy(rows, 'store', {
    trucks: () => 1, onDock: r => (r.closed_at ? 0 : 1), palletsReceived: r => num(r.received),
    units: r => num(r.units),
    // Two different approvals: a repeated BOL let through (on the truck), and a repeated
    // pallet tag let through (on its pallets, counted by the server as dup_approved).
    bolDuplicatesApproved: r => (r.dup_approved_by ? 1 : 0), palletDuplicatesApproved: r => num(r.dup_approved),
  });
  return {
    months: b.months, complete: !b.truncated, totals: { byStore },
    listed: Math.min(a.limit || 100, rows.length),
    rows: rows.slice(0, a.limit || 100).map(r => pick(r, TRUCK_LIST_FIELDS)),
  };
}

function shapeTruck(b, a) {
  if (!b.truck) return { store: upper(a.storeId), truck: null, note: 'No truck is open at this store.' };
  const pallets = (b.pallets || []).map(dropMedia);
  return {
    truck: dropMedia(b.truck),
    palletsReceived: pallets.length, units: pallets.reduce((s, p) => s + num(p.units), 0),
    pallets,
  };
}

// The server totals the whole period itself (mos-list), so only the listing is cut.
function shapeOutOfStock(b) {
  return {
    range: b.range, moreRows: !!b.truncated,
    months: (b.months || []).map(m => ({
      month: m.month, lines: m.lines, units: m.units,
      cost: dollars(m.cost_cents), retail: dollars(m.retail_cents),
      shrinkCost: dollars(m.shrink_cents), storeUseCost: dollars(m.store_use_cents),
      linesWithoutCost: m.lines_without_cost, linesWithoutPrice: m.lines_without_price,
    })),
    rows: (b.rows || []).map(({ unit_cost_cents, unit_price_cents, ...r }) => ({
      ...r, unitCost: dollars(unit_cost_cents), unitPrice: dollars(unit_price_cents),
    })),
  };
}

// ── Running a query ────────────────────────────────────────────────────────
// One request, or for a query with `next`, every page (its shape then gets the
// list of page bodies). The CLI and the MCP server both run queries through here.
const MAX_PAGES = 20;
export async function runQuery(query, args, fetchJson) {
  let params = query.request(args);
  if (!query.next) return query.shape(await fetchJson(params), args);
  const pages = [];
  while (params) {
    if (pages.length === MAX_PAGES) throw new QueryError(`More than ${MAX_PAGES} pages; refusing to read further.`);
    const body = await fetchJson(params);
    pages.push(body);
    params = query.next(body, params);
  }
  return query.shape(pages, args);
}

// ── The queries ────────────────────────────────────────────────────────────
// args: in order; `required` where the call cannot be answered without it.
// request(args) → the worker query. shape(body, args) → what the agent gets.
const opt = (name) => ({ name });
const req = (name) => ({ name, required: true });

export const QUERIES = [
  {
    name: 'list_stores', cli: 'stores', title: 'List stores',
    description: 'Store ids and names.',
    args: [],
    request: () => ({ action: 'morning-briefing' }),
    shape: (b) => b.stores.map(s => ({ storeId: s.storeId, name: s.name })),
  },
  {
    name: 'get_yesterday_sales', cli: 'yesterday', title: "Yesterday's sales",
    description: 'Yesterday (Eastern time) per store: net, till and live sales; budget; WTD and MTD with budgets; '
      + "last year's same day; labor; transactions; gross margin and categories.",
    args: [opt('storeId')],
    request: () => ({ action: 'morning-briefing' }),
    shape: (b, a) => onlyStore(b, a.storeId),
  },
  {
    name: 'get_today_sales', cli: 'today', title: "Today's sales so far",
    description: "Today so far, live from the POS: sales, transactions and today's budget. Takes a few seconds.",
    args: [opt('storeId')],
    request: () => ({ action: 'afternoon-briefing' }),
    shape: (b, a) => onlyStore(b, a.storeId),
  },
  {
    name: 'get_sales_history', cli: 'history', title: 'Daily sales history',
    description: 'One row per store per day, newest first, ending yesterday. No gaps: a day with no '
      + 'trustworthy figure appears as no_data with nulls.',
    args: [opt('storeId'), opt('days')],
    request: (a) => ({ action: 'store-history', days: a.days, storeId: upper(a.storeId) }),
    shape: (b) => b,
  },
  {
    name: 'get_retail_summary', cli: 'summary', title: 'Retail Summary',
    description: 'The Retail Summary page for a date range: company and per-store net sales, retail / bin / live '
      + 'split, qty, transactions, ASP, budget and variance, labor %, and net sales by main category per store.',
    args: [req('from'), req('to'), opt('storeId')],
    request: (a) => ({ action: 'weekly-summary', from: a.from, to: a.to }),
    shape: shapeSummary,
  },
  {
    name: 'get_store_categories', cli: 'categories', title: 'Store category detail',
    description: "One store's category detail for a date range, as on its Retail Summary tab: qty, gross, discounts, "
      + 'refunds, net, ASP, cost, extended cost, gross profit, GPM % and cost coverage per category; level l3 adds subcategories.',
    args: [req('storeId'), req('from'), req('to'), opt('level')],
    check: (a) => { if (daysBetween(a.from, a.to) > 366 || daysBetween(a.to, a.from) > 366) throw new UsageError('from and to must be at most 366 days apart'); },
    request: (a) => ({ action: 'weekly-store-detail', store: upper(a.storeId), from: a.from, to: a.to }),
    shape: shapeStoreCategories,
  },
  {
    name: 'get_trailing_weeks', cli: 'weeks', title: 'Trailing weeks (T13)',
    description: 'The Retail Summary T13 tab: per week (ending Saturday) and store, net sales, qty, transactions, ASP, '
      + 'labor % and budget; optionally category units, net and orders per week.',
    args: [opt('end'), opt('weeks'), opt('storeId'), opt('categories')],
    // Measured live 2026-10-13: l3 for every store over 13 weeks is ~290k characters (~83k tokens).
    check: (a) => { if (a.categories === 'l3' && !a.storeId) throw new UsageError('categories l3 needs a storeId: subcategories for every store at once is too large for one answer'); },
    request: (a) => ({ action: 'weekly-t13', end: a.end || addDays(todayET(), -1), weeks: a.weeks }),
    shape: shapeWeeks,
  },
  {
    name: 'get_category_sales', cli: 'category-sales', title: 'Category sales over time',
    description: 'The Retail Summary Categories tab: net sales and units per category, per store and chain, summed '
      + 'over the range or by day, week or month. Compare two periods by calling it twice. At most 840 store-days.',
    args: [req('from'), req('to'), opt('level'), opt('storeId'), opt('bucket')],
    request: (a) => ({ action: 'category-series', from: a.from, to: a.to, level: a.level || 'l2', store: upper(a.storeId) }),
    shape: shapeCategorySales,
  },
  {
    name: 'get_category_sales_by_hour', cli: 'category-hours', title: 'Category sales by hour',
    description: 'Net sales and units per category by hour of day (Eastern), per store and chain. At most 7 days. '
      + 'May read the POS live, so it can be slow; days it could not fetch are listed in missing.',
    args: [req('from'), req('to'), opt('level'), opt('storeId'), opt('hourBucket')],
    check: (a) => { if (Math.abs(daysBetween(a.from, a.to)) > 6) throw new UsageError('from and to must be at most 7 days apart'); },
    request: (a) => ({ action: 'category-hours', from: a.from, to: a.to, level: a.level || 'l2', store: upper(a.storeId) }),
    shape: shapeCategoryHours,
  },
  {
    name: 'get_labor', cli: 'labor', title: 'Labor budget vs actual',
    description: 'The Labor page Budget vs Actual tab: budget and actual sales, budget and actual hours, and budget '
      + 'and actual labor % per day, week or month, chain and per store. Defaults to the weeks the page shows.',
    args: [opt('grain'), opt('from'), opt('to'), opt('storeId')],
    check: (a) => { if ((a.from == null) !== (a.to == null)) throw new UsageError('give both from and to, or neither'); },
    request: (a) => {
      const grain = a.grain || 'w';
      let { from, to } = a;
      if (!from) {
        to = addDays(laborPlanWeek(), -7);
        from = grain === 'd' ? addDays(to, -13) : grain === 'w' ? addDays(to, -55) : to.slice(0, 4) + '-01-01';
      }
      return { action: 'labor', grain, from, to, store: upper(a.storeId) };
    },
    shape: (b) => b,
  },
  {
    name: 'get_labor_plan', cli: 'labor-plan', title: 'Labor plan',
    description: 'The Labor page Planning tab: recommended hours for a week from the trailing 4-week sales trend, '
      + 'trending hours, the difference, projected sales and budget labor %, per store and chain.',
    args: [opt('week'), opt('storeId')],
    check: (a) => { if (a.week && dayOfWeek(a.week) !== 6) throw new UsageError('week must be a Saturday (the last day of the week)'); },
    request: (a) => ({ action: 'labor-plan', week: a.week || laborPlanWeek(), store: upper(a.storeId) }),
    shape: (b) => b,
  },
  // ── Inventory (2026-10-15): Viewer, Schedule Sale, Bin Dump, Receiver, Mark Out of Stock ──
  {
    name: 'get_inventory_items', cli: 'items', title: 'Inventory items (Viewer)',
    description: "The Inventory Viewer: one store's POS catalog with price, POS cost (often empty; sales margins use the app's own costs), GP %, category and hidden flag, "
      + 'plus counts of items, hidden, no-cost and duplicate codes. Search or filter it; reads the POS live, a few seconds.',
    args: [req('storeId'), opt('search'), opt('itemFilter'), opt('limit')],
    request: (a) => ({ action: 'inventory-items', store: upper(a.storeId), offset: 0 }),
    next: (b, p) => (b.hasMore ? { ...p, offset: p.offset + 1000 } : null),
    shape: shapeInventory,
  },
  {
    name: 'get_sale_schedules', cli: 'sale-schedules', title: 'Sale schedules',
    description: 'Inventory › Schedule Sale: the timed sales set up for one store, each with its discount, start and '
      + 'end, status, and the items with their original and sale prices, newest first. complete false: the store has more than the 200 item rows the page reads.',
    args: [req('storeId'), opt('scheduleFilter'), opt('limit')],
    request: (a) => ({ action: 'list-sale-schedules', store: upper(a.storeId), filter: a.scheduleFilter || 'all' }),
    shape: shapeSchedules,
  },
  {
    name: 'get_bin_dumps', cli: 'bin-dumps', title: 'Bin dumps',
    description: 'Inventory › Bin Dump: pallets dumped into the bins, newest first, with tag fields (barcode, item, '
      + 'pallet, PO, units, truck) and who logged them, plus entries and units per store and per week.',
    args: [opt('storeId'), opt('dumpWeeks'), opt('limit')],
    request: (a) => ({ action: 'bin-dump-list', store: upper(a.storeId) || 'ALL', weeks: a.dumpWeeks || 8, limit: 5000 }),
    shape: shapeBinDumps,
  },
  {
    name: 'get_trucks', cli: 'trucks', title: 'Trucks received',
    description: 'Inventory Receiver › Trucks: trucks per store, newest first (BOL, ship from, carrier, pallets the '
      + 'BOL claims vs received, units, opened and taken down by whom, duplicate approvals), plus per-store totals.',
    args: [opt('storeId'), opt('truckMonths'), opt('limit')],
    request: (a) => ({ action: 'truck-list', store: upper(a.storeId) || 'ALL', months: a.truckMonths || 6, limit: 2000 }),
    shape: shapeTrucks,
  },
  {
    name: 'get_truck', cli: 'truck', title: 'One truck and its pallets',
    description: "One truck's BOL and every pallet received off it: give truckId (from get_trucks), or storeId for "
      + 'the truck open on that dock now.',
    args: [opt('truckId'), opt('storeId')],
    check: (a) => { if ((a.truckId == null) === (a.storeId == null)) throw new UsageError('give exactly one of truckId (CLI --truck) or storeId (CLI --store)'); },
    request: (a) => (a.truckId != null ? { action: 'truck-detail', id: a.truckId } : { action: 'truck-current', store: upper(a.storeId) }),
    shape: shapeTruck,
  },
  {
    name: 'get_out_of_stock', cli: 'out-of-stock', title: 'Mark Out of Stock log',
    description: 'Inventory › Mark Out of Stock: items marked out (Stolen, Damaged, Expired, Store Use) with qty, unit '
      + 'cost and price and who logged them, newest first, plus monthly totals of cost, retail, shrink and store use.',
    args: [opt('storeId'), opt('mosMonths'), opt('limit')],
    request: (a) => ({ action: 'mos-list', store: upper(a.storeId) || 'ALL', months: a.mosMonths || 3, limit: a.limit || 100 }),
    shape: shapeOutOfStock,
  },
];
