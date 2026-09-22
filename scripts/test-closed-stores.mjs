// Which stores the dashboard DRAWS, versus which it COUNTS.
//
// Holland (BL8) closed 2026-07-25 and Wyoming (BL12) 2026-06-15. They are handled
// differently on purpose, and the difference is easy to erase by accident:
//
//   BL12 shares its Clover merchant with BL16 — the register was physically moved.
//   It is out of the worker's ALL_STORES because polling it would fetch Indy East's
//   register and write it under 'BL12', silently doubling Indy. Its date gate
//   (wrsGateDates) splits the shared history between the two codes.
//
//   BL8 has its own merchant that simply returns nothing. It stays IN ALL_STORES
//   because its BUDGET is deliberately still carried — see the note in
//   STORE_CLOSED_FROM: the company plan was never revised for the closure, so the
//   shortfall is a real miss the chain is meant to feel. That was Brian's call on
//   2026-08-11 and the comment says in terms not to undo it without asking.
//
// So the frontend roster answers "draw a card and poll it", and ALL_STORES answers
// "count it". This test pins that separation, because the tempting one-line "tidy
// up" — dropping BL8 from ALL_STORES — would quietly move chain budget attainment
// by 13 points (measured: August 77.9% -> 91.3%).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const worker = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');

console.log('\n── Closed stores · drawn vs counted ──');

// ── The worker still COUNTS Holland. This is the load-bearing half.
const allStores = (worker.match(/const ALL_STORES = \[([^\]]+)\]/) || [])[1] || '';
ok(/"BL8"/.test(allStores),
  '🔑 BL8 is STILL in the worker’s ALL_STORES — its budget is carried on purpose');
ok(!/"BL12"/.test(allStores), 'BL12 is not, because polling it would double-count Indy East');
ok(/BL8: '2026-07-25'/.test(worker), 'BL8 has its closure date in STORE_CLOSED_FROM');
ok(/BL12: '2026-06-15'/.test(worker), 'and so does BL12');
ok(/ITS BUDGET IS DELIBERATELY LEFT IN PLACE/.test(worker),
  'the reason the budget stays is still written down where the next person will look');

// ── The frontend no longer DRAWS it.
const roster = (html.match(/const STORES = \[([\s\S]*?)\];/) || [])[1] || '';
ok(roster.length > 0, 'found the dashboard roster');
ok(!/BL8/.test(roster), 'BL8 is out of the dashboard roster — no card, no per-store fetch');
ok(!/BL12/.test(roster), 'BL12 was already out');
const stores = (roster.match(/"/g) || []).length / 2;
const colors = ((html.match(/const COLORS = \[([^\]]+)\]/) || [])[1] || '').split(',').length;
ok(stores === 5, `five trading stores remain (${stores})`);
ok(colors === stores,
  `COLORS stays index-parallel to STORES (${colors} vs ${stores}) — a mismatch silently mis-colours cards`);

// ── But it still SHOWS the history.
const wrsKeys = (html.match(/const WRS_STORE_KEYS\s*=\s*\[([^\]]+)\]/) || [])[1] || '';
ok(/BL8/.test(wrsKeys) && /BL12/.test(wrsKeys),
  'both closed stores stay in WRS_STORE_KEYS, so the numbers they earned stay readable');
ok(/BL8:'Holland'/.test(html.replace(/\s/g, '')), 'and Holland keeps its name');

// ── The badge is derived, not hardcoded to one store.
ok(/const CLOSED_STORES = \{[^}]*BL8[^}]*BL12[^}]*\}/.test(html),
  'CLOSED_STORES lists both, mirroring the worker');
ok(/CLOSED_STORES\[storeKey\] \?/.test(html),
  'the "Closed · historical" badge is derived from it');
ok(!/storeKey === 'BL12' \?/.test(html),
  'and no longer hardcoded to BL12 — the next closure is one line, not a code change');

// ── Guardrails that must not move.
const psList = ((html.match(/const PS_STORES\s*=\s*\[([^\]]+)\]/) || [])[1] || '').replace(/[\s']/g, '');
ok(psList === 'BL1,BL2,BL4,BL8,BL14,BL16',
  `PS_STORES is untouched (${psList}) — scripts/test-price-scan.mjs pins it to ALL_STORES, order included`);
ok(/BL8/.test((html.match(/const SR_ALL\s*=\s*\[([^\]]+)\]/) || [])[1] || ''),
  'SR_ALL keeps BL8 — it drives the supply-request table columns, and dropping it would hide historical requests');

// ── Drawn vs COUNTED, the half that went unpinned and broke. ────────────────
//
// The original version of this file asserted BL8 in ALL_STORES and BL8 out of STORES,
// and passed all the way through the bug: on 2026-09-15 Holland's budget vanished from
// the All Stores Budget card while every assertion above stayed green. What was never
// pinned is that ALL_STORES is not the frontend's budget scope at all. Chain budget is
// summed IN THE BROWSER out of allStoreData, which is filled per store in the frontend
// rosters — so STORES alone decided budget, and the comment above it said the opposite.
//
// These assertions pin the relationship itself, not the two lists in isolation.
console.log('\n── Chain budget scope ──');

const budgetOnly = (html.match(/const BUDGET_ONLY_STORES = \[([\s\S]*?)\];/) || [])[1] || '';
ok(budgetOnly.length > 0, 'the frontend has a budget-only roster at all');
ok(/BL8/.test(budgetOnly), '🔑 BL8 is in it — the dashboard COUNTS Holland even though it does not DRAW it');
ok(!/BL12/.test(budgetOnly),
  'BL12 is NOT — its budget duplicates BL16 (shared merchant), so counting it double-counts Indy East');

const codes = (s) => [...s.matchAll(/"(BL\d+)\//g)].map(m => m[1]);
const finScope = [...codes(roster), ...codes(budgetOnly)].sort();
const workerScope = (allStores.match(/BL\d+/g) || []).sort();
ok(finScope.length > 0 && JSON.stringify(finScope) === JSON.stringify(workerScope),
  `🔑 STORES + BUDGET_ONLY_STORES === the worker's ALL_STORES `
  + `(frontend ${finScope.join(',')} vs worker ${workerScope.join(',')}) — `
  + `the dashboard and the morning briefing must budget for the same stores`);
ok(codes(roster).length === 5 && codes(budgetOnly).length === 1,
  'five drawn, one counted-only');

// ── Every chain budget figure folds them in. ────────────────────────────────
// One fold per surface that sums budget across stores. Each of these was $34.5k a week
// light; a new one that forgets is what this section exists to catch.
const fnBody = (name) => {
  const i = html.indexOf(`function ${name}(`);
  if (i < 0) return '';
  const j = html.indexOf('\n  function ', i + 1);
  return html.slice(i, j < 0 ? html.length : j);
};
const folds = (name) => (fnBody(name).match(/budgetOnly(Total|Rows)\(/g) || []).length;

ok(fnBody('renderDashboard').length > 2000, 'found renderDashboard to inspect');
ok(folds('renderDashboard') >= 4,
  `renderDashboard folds the budget-only stores into all four of its chain figures `
  + `— hero today, Weekly, Monthly and the historical branch (${folds('renderDashboard')})`);
ok(folds('buildAllStoresWeeklyTable') >= 1, 'the per-day chain table folds them in');
ok(folds('_asWeekTotals') >= 0 && /BUDGET_ONLY_STORES/.test(fnBody('_asWeekTotals')),
  'the All Stores page totals fold them in');
ok(folds('renderAllStoresDailyChart') >= 1, "the daily chart's budget line folds them in");
ok(folds('bargainLaneFigures') >= 2,
  'the landing hero folds them into both today and month-to-date');

// The All Stores page shows a per-store breakdown UNDER its chain total, so a store
// that joins the total must join the breakdown — otherwise the rows visibly fail to
// add up to the hero above them.
ok(/perStore\.push\(\{ store: s, code, label, sales: 0, budget: storeBudget, closed: true \}\)/.test(html),
  'a counted-only store gets a row in the All Stores breakdown, marked closed');
ok(/\$\{s\.closed \?/.test(html), 'and the row renders a Closed badge');

// ── Loaded, but never polled. ──────────────────────────────────────────────
ok(/const histRoster = STORES\.concat\(BUDGET_ONLY_STORES\);/.test(html),
  'history loads for the budget-only stores — without the D1 read there are no budget rows to sum');
ok(/Promise\.all\(histRoster\.map/.test(html), 'and the history fan-out uses that roster');
ok(/\$\{loaded\}\/\$\{histRoster\.length\}/.test(html),
  'the progress counter counts against the same roster, so it cannot read "6/5"');
ok(/const cloverPromise = Promise\.all\(STORES\.map/.test(html),
  '🔑 the LIVE CLOVER fan-out still uses STORES alone — a closed merchant returns nothing '
  + 'and that poll is the expensive half of a load');

// ── A closed store's budget is still somebody's budget. ────────────────────
ok(/BUDGET_ONLY_STORES\.splice\(0, BUDGET_ONLY_STORES\.length,/.test(html),
  'the budget-only roster narrows to the user grant alongside STORES — a store-scoped '
  + 'manager must not find a closed store in their totals');

// ── The comment that said the opposite is gone. ────────────────────────────
ok(!/THIS LIST DOES NOT DECIDE BUDGET/.test(html),
  'the inverted comment above STORES is gone — it claimed the list could not affect budget');
ok(/THIS LIST IS HALF THE BUDGET SCOPE/.test(html),
  'and says what is actually true, naming the other half');

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
