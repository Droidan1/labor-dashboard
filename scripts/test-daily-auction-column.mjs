// Contract test for the Auction column on the store-detail Daily tab.
//
// `buildWeeklyTable` is extracted from index.html rather than reimplemented, so
// the bytes under test are the bytes that ship. Only the leaf formatters are
// stubbed — `fmtDollar` becomes a parseable marker so an assertion can name an
// exact figure instead of matching locale-formatted currency. The arithmetic,
// the column gate and the total row are all the real code.
//
// What this is defending:
//
//   daily_sales.total is POS revenue only; daily_sales.budget INCLUDES auction
//   (docs/API_HANDOVER.md §1). The Daily tab used to put the first against the
//   second, so every auction store read under budget every day — 5.8 points of
//   pace for Coliseum across August 2026. The rows now carry net, which is also
//   what the hero above them, the store cards, the combined daily table and the
//   daily email have always carried.
//
// The cheap wrong version of each assertion below renders a plausible screen:
// a column of em-dashes for the two stores that never auction, a total that
// does not equal its own rows, or today showing no auction because `aAuction`
// is deliberately null on today's row and only `auctionRaw` survives.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const slice = (fromAnchor, toAnchor) => {
  const from = html.indexOf(fromAnchor);
  const to = html.indexOf(toAnchor, from + 1);
  ok(from > 0 && to > from, `found ${JSON.stringify(fromAnchor.trim().slice(0, 40))} in index.html`);
  return html.slice(from, to);
};

const rowAuctionSrc = slice("  // A store-day's auction dollars", '  function sumRows(rows) {');
const buildSrc = slice('  function buildWeeklyTable(storeName) {', '  function buildAllStoresWeeklyTable() {');

// ── Harness ────────────────────────────────────────────────────────────────
// A dollar renders as «123.45» so a test can pull exact figures back out.
// Titles are stripped first: the net figure carries its POS/auction split in a
// `title`, and those numbers are not what the row displays.
const MONEY = /«(-?\d+\.\d\d)»/g;
const moneyIn = (s) => [...s.replace(/ title="[^"]*"/g, '').matchAll(MONEY)].map(m => Number(m[1]));

// Every row — day rows and the total row — opens with the same grid div, so
// splitting on it is the only reliable way to cut one row out of the markup.
const rowsOf = (out) => out.split('<div class="grid items-center').slice(1);
const dayRows = (out) => rowsOf(out).slice(0, -1);
const totalRowOf = (out) => rowsOf(out).at(-1);

const build = (ctx) => new Function('ctx', `
  const { allStoreData, selectedWeek, currentWeek, liveCloverData, sdWeekFilter,
          escapeHtml, fmtDollar, fmtPct, normalizeLaborPct, LABOR_TARGET,
          _buildSdSelectors, _buildSdMonthSummary } = ctx;
  ${rowAuctionSrc}
  ${buildSrc}
  return buildWeeklyTable;
`)(ctx);

const D = (s) => new Date(s + 'T12:00:00');
const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

// A store-week. `rows` are given as plain objects; auctionRaw defaults to
// aAuction the way loadStoreFromD1 sets them for any date that is not today.
const render = (rows, { week = 40, current = 99, live = null } = {}) => {
  const norm = rows.map(r => ({
    date: D(r.d), week,
    aTotal: r.pos ?? null, bTotal: r.budget ?? null, aLabor: r.labor ?? null,
    aAuction: r.aAuction !== undefined ? r.aAuction : (r.auction ?? null),
    auctionRaw: r.auctionRaw !== undefined ? r.auctionRaw : (r.auction ?? null),
  }));
  return build({
    allStoreData: { S: norm },
    selectedWeek: week, currentWeek: current, sdWeekFilter: null,
    liveCloverData: live ? { S: live } : {},
    escapeHtml: (s) => String(s),
    fmtDollar: (v) => `«${Number(v).toFixed(2)}»`,
    fmtPct: (v) => `${Number(v).toFixed(1)}%`,
    normalizeLaborPct: (v) => v,
    LABOR_TARGET: 14.1,
    _buildSdSelectors: () => '',
    _buildSdMonthSummary: () => '',
  })('S');
};

console.log('\n── Daily tab · Auction column ──');

// 1 ── The column exists only for a week that actually has auction.
{
  const withAuction = render([
    { d: '2026-08-20', pos: 1000, auction: 963, budget: 2000 },
    { d: '2026-08-21', pos: 1100, auction: null, budget: 2000 },
  ]);
  const without = render([
    { d: '2026-08-20', pos: 1000, budget: 2000 },
    { d: '2026-08-21', pos: 1100, budget: 2000 },
  ]);

  ok(withAuction.includes('sm:grid-cols-[60px_1fr_auto_auto]'), 'auction week gets a 4th grid track from sm up');
  ok(withAuction.includes('hidden sm:flex flex-col items-end'), 'the auction cell is the column at sm and up');
  ok(withAuction.includes('sm:hidden flex items-center'), 'and folds to a line under the bar on a phone');
  ok(withAuction.includes('>Auction<'), 'auction week labels the column');
  ok(withAuction.includes('grid-cols-[60px_1fr_auto] sm:'), 'a phone keeps 3 tracks even in an auction week');

  ok(/grid-cols-\[60px_1fr_auto\](?! sm:)/.test(without), 'a week with no auction keeps 3 tracks at every width');
  ok(!without.includes('Auction'), 'a week with no auction shows no auction column at all');

  // The two stores that never run an auction must see no change whatsoever.
  eq(rowsOf(without).length, 3, 'no-auction week renders 2 day rows + 1 total row');
}

// 2 ── The day figure is net, and it is the FIRST money on its row.
{
  const out = render([{ d: '2026-08-20', pos: 1000, auction: 963, budget: 2000 }]);
  const row = dayRows(out)[0];
  const nums = moneyIn(row);
  eq(nums[0], 1963, 'the day figure is POS + auction');
  eq(nums[1], 2000, 'the budget is next to it, unchanged');
  ok(nums.includes(963), 'the auction cell carries the auction dollars');
  ok(row.includes('title="POS «1000.00» + auction «963.00»"'), 'the net figure says what it is made of');
}

// 3 ── The rows sum to the total row. This is the invariant that was broken:
//      the hero above this table has always included auction and the total
//      below it did not, so the same screen showed two week totals.
{
  const out = render([
    { d: '2026-08-20', pos: 1000, auction: 963, budget: 2000 },
    { d: '2026-08-21', pos: 1100, auction: 227.51, budget: 2000 },
    { d: '2026-08-22', pos: 1200, auction: null, budget: 2000 },
  ]);
  const row = totalRowOf(out);
  const t = moneyIn(row);
  eq(t[0], 3300 + 1190.51, 'week total = Σ(POS + auction)');
  eq(t[1], 6000, 'week budget is untouched');
  // The auction total is printed twice — once in the phone line, once in the
  // sm+ column — so assert on the figures rather than a position, and pin that
  // the two copies cannot drift apart.
  eq(t.filter(v => v === 1190.51).length, 2, 'Σ of the auction column shows in both the phone line and the column');
  ok(row.includes('−«1509.49»'), 'the delta is net-vs-budget, and renders as a shortfall');
  ok(row.includes('3 of 3 days reported'), 'all three days count as reported');
}

// 4 ── Today: loadStoreFromD1 nulls aAuction on today's row and keeps the value
//      in auctionRaw, because the nulling exists to stop a double-count against
//      live Clover and auction is not a Clover channel. Reading aAuction here
//      would silently drop today's auction.
{
  const out = render(
    [{ d: todayKey, pos: null, aAuction: null, auctionRaw: 415, budget: 2000 }],
    { week: 40, current: 40, live: { total: 1500 } },
  );
  const nums = moneyIn(dayRows(out)[0]);
  eq(nums[0], 1915, "today's figure is live POS + auctionRaw");
  ok(nums.includes(415), "today's auction cell reads auctionRaw, not the nulled aAuction");
}

// 5 ── An auction-only day. classifyReportingStatus (worker.js) calls auction > 0
//      `reported`, and the row now shows a figure, so the day count has to agree
//      with the rows above it.
{
  const out = render([
    { d: '2026-08-20', pos: null, auction: 288, budget: 2000 },
    { d: '2026-08-21', pos: null, auction: null, budget: 2000 },
  ]);
  const t = totalRowOf(out);
  eq(moneyIn(t)[0], 288, 'an auction-only day still totals');
  ok(t.includes('1 of 2 days reported'), 'an auction-only day counts as reported; an empty one does not');
}

// 6 ── A day with neither POS nor auction stays a dash — a real gap must not
//      render as $0.00, which reads as "the store took nothing".
{
  const out = render([
    { d: '2026-08-20', pos: 1000, auction: 100, budget: 2000 },
    { d: '2026-08-21', pos: null, auction: null, budget: 2000 },
  ]);
  const second = dayRows(out)[1];
  ok(!moneyIn(second).includes(0), 'an empty day plots no zero');
  ok(second.includes('—'), 'an empty day renders a dash');
}

// 7 ── The SECOND render. The month/week selectors re-render this panel in place
//      (index.html calls buildWeeklyTable into #sd-content-weekly again), so
//      stepping from an auction week to a quiet one has to drop the 4th grid
//      track — a stale template leaves the delta cell parked in a dead column.
{
  const weeks = [
    { d: '2026-08-20', pos: 1000, auction: 963, budget: 2000, week: 34 },
    { d: '2026-08-27', pos: 1100, budget: 2000, week: 35 },
  ];
  const mk = (week) => {
    const norm = weeks.map(r => ({
      date: D(r.d), week: r.week,
      aTotal: r.pos ?? null, bTotal: r.budget ?? null, aLabor: null,
      aAuction: r.auction ?? null, auctionRaw: r.auction ?? null,
    }));
    return build({
      allStoreData: { S: norm },
      selectedWeek: week, currentWeek: 99, sdWeekFilter: null,
      liveCloverData: {},
      escapeHtml: (s) => String(s),
      fmtDollar: (v) => `\u00ab${Number(v).toFixed(2)}\u00bb`,
      fmtPct: (v) => `${Number(v).toFixed(1)}%`,
      normalizeLaborPct: (v) => v,
      LABOR_TARGET: 14.1,
      _buildSdSelectors: () => '',
      _buildSdMonthSummary: () => '',
    })('S');
  };

  ok(mk(34).includes('sm:grid-cols-[60px_1fr_auto_auto]'), 'week 34 (has auction) draws the column');
  ok(/grid-cols-\[60px_1fr_auto\](?! sm:)/.test(mk(35)), 're-rendering into week 35 drops the column');
  ok(!mk(35).includes('Auction'), 'and drops its caption with it');
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
