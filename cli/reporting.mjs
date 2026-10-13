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
// pinned together by a test; with eleven queries and their trimming, two copies
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
];
