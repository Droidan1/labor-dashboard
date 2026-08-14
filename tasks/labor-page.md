# Labor page — replaces the Retail Payroll Planning sheet

Created 2026-08-14. Builds on: `daily_sales` already carrying labour columns, the
existing `?action=manual-override` endpoint, and the nightly Google-Sheet importer.
Preview approved: `scratchpad/labor-page-preview.html` (3 tabs, store picker,
admin/manager scoping).

Decisions already made by Brian:
- The page **replaces** the Retail Payroll Planning sheet outright.
- Actual hours are **entered in the dashboard**, not typed into the sheet.
- Historical hours in the sheet are correct and must be preserved.
- Holland is **off this page** entirely (all three tabs).
- Admin enters hours for **all stores**; the Hours tab is **hidden from managers**.

---

## Success criteria (the evals)

1. An admin opens **Labor → Planning** and sees, per store, recommended hours for
   the upcoming week, the trending pace, and the gap — matching the pinned numbers
   in Phase 2 to the hour.
2. A store manager opens the same page and sees **only their store**, no store
   picker, and **no Hours tab**.
3. **Budget vs Actual** shows budget and actual sales, hours, and labour % at
   daily / weekly / monthly grain, with both sides valued at $15.00/hr.
4. An admin pastes a 5×7 block from Paylocity into the **Hours** grid, hits save
   once, and every changed cell lands in `daily_sales` in a single request.
5. A value outside 25–250% of that store-day's budget hours **cannot be saved
   without a second confirm** — pasting the real `3127` from Coliseum's sheet row
   is blocked at the gate.
6. A store-week with < 4 usable trailing weeks shows **budget-only with the reason
   on screen**, never a trend. Indy East demonstrates this on day one.
7. After Phase 0, the nightly importer writes **no actual hours**, and every
   labour hour already in D1 is byte-identical to before the change.

---

## Assumptions (correct me before I build)

- **$15.00/hr is a single named constant in the worker.** The sheet hardcodes it
  into ~400 cells per tab and stepped 14.40 → 15.00 on 2026-02-15; that is exactly
  why the Summary tab is still wrong. One constant, one place. Historic labour %
  is recomputed from stored hours at the current rate, not read from the sheet.
- **`labor_pct` becomes derived, never imported.** Columns K/W of the sheet stop
  being read. This permanently kills the 14.40-vs-15.00 drift.
- **Weights are 10/20/30/40** over the four trailing complete weeks, oldest→newest.
- **A usable week = actual sales > 0 AND actual hours > 0.** Below four usable
  weeks → budget-only. No renormalising the weights over fewer weeks (that would
  have given Indy East a recommendation off a single week).
- **ASM allocation is +40 hrs/store/week**, added on top of budget hours from
  column J, matching the planning sheet. This lifts budget labour % from the
  sheet's flat 14.00% target to 14.8–16.2% per store, and adds 200 hrs/week
  chain-wide to the recommendation. Kept deliberately — see Open decisions for
  where the constant should live.
- **Weeks are Sunday→Saturday**, matching both sheets.
- **Budget still comes from the sheet** (columns I and J). Only actual hours move.
- **Build on a branch off main; ship behind the existing role gates.**

---

## Phase 0 — Freeze the sheet as the hours source  ⚠️ do this first

The importer currently writes `labor_hours` nightly. Until it stops, anything
entered in the dashboard gets overwritten the same night.

- [ ] In the sheet importer, stop reading `A_HOURS` (col 21) and `A_LABOR` (col 22)
      for **all** stores — pass null, do not delete the column map.
- [ ] Keep `B_TOTAL` (I), `B_HOURS` (J), `B_LABOR` (K) and the actual **sales**
      columns flowing. The budget still lives in the sheet.
- [ ] `LABOUR_ACTUALS_EXCLUDED` (BL16) becomes dead once actuals stop importing —
      leave the constant and its comment in place, note it is now moot.

**Why this is safe, and the proof:** the upsert is
`labor_hours = CASE WHEN is_manual_override=1 THEN labor_hours ELSE COALESCE(excluded.labor_hours, labor_hours) END`
(worker.js:7964). A null incoming value keeps the stored one. No backfill, no
migration, nothing rewritten. 🛑 **This repo has lost production data to backfills
three times — do not "re-sync history to be safe".** The history is already in D1:

| Store | Days with hours | Through |
|---|---|---|
| BL2 South Bend | 216 | 2026-08-04 |
| BL14 Battle Creek | 210 | 2026-08-04 |
| BL4 Dupont | 189 | 2026-08-04 |
| BL1 Coliseum | 185 | 2026-08-04 |
| BL16 Indy East | **0** | — |

**Verify:** snapshot `SELECT store, COUNT(*), SUM(labor_hours) FROM daily_sales
WHERE labor_hours > 0 GROUP BY store` before and after a cron run. Identical, or
back it out.

---

## Phase 1 — Worker: read endpoint

- [ ] `GET ?action=labor&scope=<all|BLn>&grain=<d|w|m>&from=&to=`
      returning per store per period: budget sales, actual sales, budget hours,
      actual hours. Labour % computed, never stored.
- [ ] Scope through `allowedStores(user)` (worker.js:7294) — a manager asking for
      `scope=all` gets their store, not a 403 and not the chain.
- [ ] Exclude BL8 (Holland) and BL12 (Wyoming) from this endpoint's store set.
- [ ] 🛑 **Classify the action in `ACTION_BUSINESS` (worker.js:3779) as `bl`.**
      The gate is fail-closed — an unclassified action is REFUSED, and
      `scripts/test-business-gate.mjs` enumerates routed actions from source and
      will fail the build if this is skipped.
- [ ] A period is `complete` only if every in-scope store has hours for every day
      that had sales. Incomplete periods return a flag, not a labour %.

**Verify:** `scripts/test-labor-endpoint.mjs` driving `worker.fetch` with a stubbed
D1 — 🔑 not by regex-extracting the handler; a test that greps source cannot see
wiring, and wiring is what enforces scoping.

---

## Phase 2 — Worker: recommendation engine

- [ ] Pure function: `(trailing4, budgetWeek) → { weightedVar, projSales,
      trendLaborPct, recHours, trendHours, delta, basis }` where `basis` is
      `trend` or `budget-only` plus a human reason.
- [ ] Usable-week rule and the < 4 fallback.
- [ ] `?action=labor-plan&scope=` returns it per store plus a chain roll-up over
      trended stores only.

**Verify:** unit tests pinning these exactly, week ending 2026-08-22, col J + 40 ASM:

| Store | Budget hrs (J+40) | Budget labour % | Weighted var | Projected sales | Recommended | Trending | Δ |
|---|---|---|---|---|---|---|---|
| Coliseum | 719 | 14.83% | +1.50% | $73,835 | **730** | 721 | +9 |
| South Bend | 395 | 15.57% | −6.32% | $35,653 | **370** | 379 | −9 |
| Dupont | 298 | 16.16% | −5.63% | $26,105 | **281** | 231 | +50 |
| Battle Creek | 347 | 15.82% | +17.59% | $38,692 | **408** | 415 | −7 |
| Indy East | 345 | 15.83% | — | — | **345** budget-only | — | — |
| Chain (4 trended) | | | | $174,285 | **1,789** | 1,746 | **+43** |

⚠️ Assert the ASM is actually applied: without it every store's budget labour %
collapses to a flat 14.00% and the chain recommendation drops to 1,626 (−120 vs
trend instead of +43). A test that pins 14.00% is testing the ASM being *missing*.
Plus a case where a zero-sales week appears mid-window and must be rejected
(Holland's outage shape) — that path currently produces a 66-hour recommendation.

---

## Phase 3 — Client: page shell + Planning tab

- [ ] `#page-labor` following the existing page pattern; header, freshness pill,
      week chip, store `<select>`, tab bar.
- [ ] Planning tab: hero tiles, by-store table with click-to-drill, trailing
      4-week detail, needs-attention panel.
- [ ] Store picker admin-only; manager view forces their store and hides it.

## Phase 4 — Client: Budget vs Actual tab

- [ ] Daily / Weekly / Monthly segmented control, default Weekly.
- [ ] Over/under column is `actual − budget` (positive = over = red). ⚠️ Opposite
      sign convention to Planning's Δ — keep the column headings explicit.
- [ ] Incomplete periods render a **"hours pending"** chip, never a labour %.

## Phase 5 — Client: Hours grid (admin only)

- [ ] Stores × 7 days, budget printed under each input, blanks amber.
- [ ] Paste handler: TSV block fills right and down from the focused cell.
- [ ] Live per-store and chain totals + labour % as you type.
- [ ] Sanity gate: outside 25–250% of that cell's budget → red ring, button
      becomes "Review & save", second confirm required.
- [ ] Save posts **all changed cells in one** `?action=manual-override` call.
- [ ] Do **not** set `is_manual_override=1` — nothing overwrites hours any more,
      and the flag should keep meaning "someone corrected Clover-derived sales".
- [ ] No "fill from budget" button. It would fabricate a week of plausible data
      in one click.

## Phase 6 — Nav, permissions, retire the sheet

- [ ] Nav entry for Labor, gated in `applyRoleUI` the same way Marketing is.
- [ ] Hours tab admin/superuser only, client **and** server.
- [ ] Tell whoever maintains the planning sheet to stop the weekly copy/paste.
- [ ] Note in MEMORY.md that the sheet's Summary tab remains on 14.40 and will
      disagree with the page by ~4% for anything after 2026-02-15.

---

## Deploy order

Worker before client, every phase. Derived, not copied: the client is the side
that starts depending on something new (`?action=labor`, `labor-plan`), so the
worker must be able to answer before the client asks. Phase 0 is worker-only and
backward compatible with the current client, so it can ship on its own.

🔑 Deploy from a checkout that is actually on the merged branch — assert on
content (`grep -q "action=labor" worker.js`) before `wrangler deploy`, not on a
clean tree. A clean check is relative to HEAD and cannot tell you HEAD is wrong.

---

## Not doing

- Backfilling the 83 store-days with sales but no hours, or Indy East's 121
  missing days. They surface as amber cells; fill them from Paylocity or don't.
- Fixing the sheet's stale tabs (Coliseum 8 weeks, Indy ~9). The page replaces it.
- Touching the six `2026-04-31` rows carrying $45,685 — real bug, separate task.
- Reporting on Holland anywhere.

---

## Open decisions

1. ~~Where does the +40 ASM allocation live?~~ **Decided 2026-08-14: a single
   named constant in the worker** — `ASM_HOURS_PER_STORE_WEEK = 40`. One place,
   applied once in the recommendation path. Revisit if a store ever runs two ASMs
   or none, at which point it becomes a per-store config row.
2. **Holland's hours have nowhere to be entered** once Phase 0 lands. Fine if the
   store is paused; if it is trading, it needs a grid row even while staying off
   the reporting tabs.
3. **Indy East history** — recover 121 selling days from Paylocity, or start clean?
4. **Rate changes.** $15.00 as a constant is right today, but the rate has moved
   once already. If it moves again, historic labour % silently restates. Worth a
   dated rate table now, or accept the restatement and note it?
