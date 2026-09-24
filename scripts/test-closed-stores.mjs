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

// ── The Repair console's two rosters. ──────────────────────────────────────
//
// This page drifted the same way twice, and the second one shipped: a literal
// ['BL1','BL2','BL4','BL8','BL12','BL14'] that named RETIRED Wyoming and left out
// Indy East. Being wrong in both directions is what made it invisible — the list
// was still six long, so nothing looked short.
//
// The two rosters mean different things and the distinction is the whole point:
//   RC_STORES     = the worker's ALL_STORES. What `store=all` actually touches.
//   RC_STORES_WRS = the worker's WRS_STORES (ALL_STORES + frozen BL12). What T13
//                   charts, so what a basket-count backfill has to cover.
// Pinning only one of them would make the other's next drift look like a fix.
console.log('\n── Repair console rosters ──');

const parseList = (m) => m ? m[1].split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : null;
const workerAll = parseList(worker.match(/const ALL_STORES = \[([^\]]+)\]/)) || [];
const rcStores = parseList(html.match(/const RC_STORES\s*=\s*\[([^\]]+)\]/));
ok(rcStores && rcStores.length > 0, 'index.html declares RC_STORES');
ok((rcStores || []).join(',') === workerAll.join(','),
  `🔑 RC_STORES matches the worker's ALL_STORES exactly, order included `
  + `(frontend ${(rcStores || []).join(',')} vs worker ${workerAll.join(',')})`);

// The re-snapshot's cache eviction is the one consumer, and a literal there is
// the bug coming back — it evicts per store, so a roster it disagrees with
// leaves that store rendering pre-re-snapshot numbers until a reload.
ok(/const affectedStores = store === 'all' \? RC_STORES :/.test(html),
  'the re-snapshot evicts itemSalesCache over RC_STORES, not a literal');

// WRS_STORES is DERIVED in both files, so the "+ BL12" cannot outlive ALL_STORES.
ok(/const RC_STORES_WRS = \[\.\.\.RC_STORES, 'BL12'\];/.test(html),
  "RC_STORES_WRS is derived as [...RC_STORES, 'BL12'] — not a seventh literal");
ok(/const WRS_STORES\s*=\s*\[\.\.\.ALL_STORES, "BL12"\];/.test(worker),
  'and mirrors how the worker derives WRS_STORES, so the two orders agree');
ok(/const stores = RC_STORES_WRS;/.test(html),
  '🔑 the basket-count backfill covers BL12 — it is live pre-cutover and T13 charts '
  + 'it, so skipping it leaves BL12 L2 rows with no L3 beneath them');

// 🛑 The tempting wrong fix. WRS_STORE_KEYS is the same seven codes in the same
// order, and applyRoleUI SPLICES IT IN PLACE down to the signed-in user's grants.
// Reaching for it here would give a store-scoped admin a silently short backfill
// that still reports success.
ok(/WRS_STORE_KEYS\.splice\(0, WRS_STORE_KEYS\.length,/.test(html),
  'WRS_STORE_KEYS is still narrowed in place by the grant logic (the reason not to borrow it)');
const bcoBody = html.slice(html.indexOf('async function runBackfillCategoryOrders('),
                           html.indexOf('async function runBackfillCategoryOrders(') + 4000);
ok(!/WRS_STORE_KEYS/.test(bcoBody),
  'and the backfill does not borrow it');
// The shape of the bug, not just the one string it wore: any roster literal that
// names retired BL12 while leaving out BL16 is the same mistake. Comment lines are
// skipped deliberately — a note may quote an old literal on purpose (the one above
// confirmDelete did, until cross-store delete was removed), and that record is worth
// more than the strictness.
const bl12NoBl16 = html.split('\n')
  .filter(l => !/^\s*(\/\/|\*|<!--)/.test(l))
  .filter(l => /\[\s*'BL1'[^\]]*'BL12'[^\]]*\]/.test(l) && !/'BL16'/.test(l));
ok(bl12NoBl16.length === 0,
  `no live BL12-without-BL16 roster literal survives in index.html, found ${bl12NoBl16.length}`
  + `${bl12NoBl16.length ? ': ' + bl12NoBl16.map(x => x.trim()).join(' | ') : ''}`);

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
