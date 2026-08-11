# Chief of Staff API — build plan for `API_WORK_ORDER.md`

Source work order: `/Users/brianhoward/Desktop/GSD/worker/API_WORK_ORDER.md` (11 Aug 2026)
Target system: `api.retjghub.com` = this repo's `worker.js` (12,991 lines), D1 `labor-dashboard-db`,
KV `SALES_SNAPSHOTS`.
Plan written: 2026-08-11. All data claims below were measured against **production D1**, not assumed.

---

## 0. Verdict per work item

| § | Item | Verdict | Why |
|---|---|---|---|
| 4.1 | `reportingStatus` | **Build now** — 1 session | Discriminator already stored (`snapshot_time`). No new source. |
| 4.2 | `store-history` | **Build now** — 1 session | Pure D1 read; `history_d1` handler is the pattern. |
| 4.3 | WTD / MTD / LY | **Build now** — 1 session | `week` column + `last_year_sales` both exist. |
| 4.6 | `stores` master | **Build after Brian supplies a roster** | Manager/sqft/opened-date exist **nowhere** in the system. |
| 4.7 | `afternoon-briefing` | **BUILT** — p95 still unmeasured against prod | Runs the cheap half of the live path: ~3 subrequests/store, six in parallel. |
| 4.5 | Real gross margin | **BUILT** — actual gated on coverage; `grossMarginPlan` null | Cost cascade + coverage counters already existed. No planned-margin source exists (all 62 sheet columns checked). |
| 4.4 | Category budgets | **Blocked — no source** | Budget in the Sheet is a single store-level daily number. No category plan exists anywhere. |
| 4.8 | Labour | **BUILT** — needs migration-037 + a backfill re-run | Sheet cols 9/10/21 now imported. Two prod steps still owed, see 2.G. |
| 4.9 | Inventory | **Blocked — no source** | No merchandise-inventory feed exists at all. ("Inventory" in this repo = supply requests.) |

Shipped to the branch: **4.1, 4.2, 4.3, 4.5, 4.7, 4.8** — every item that had a data source.
Blocked on a data source Brian must provide: **4.4, 4.6, 4.9.**

---

## 1. Findings that change the work order — read before building

### 1.1 §5's open question is already answered, and the work order's baseline is stale ⚠️

The work order's §2 sample says `netSales` is *"POS net, EXCLUDES manual auction"*. **That is no longer
true.** `worker.js:4440-4451` now defines:

```
netSales === posSales + auctionSales
```

with the comment recording *why*: the budget always assumed auction counted toward it, so a POS-only
`netSales` overstated every auction store's miss — chain-wide about **2× the real variance**.

So the §5 answer, in writing: **`budgetForSalesDate` INCLUDES auction revenue, and `netSales` now does
too.** Nothing to add; no `budgetPosOnly` or `totalSales` field is needed. §4.3 can proceed.

**Action:** re-issue the §2 baseline sample to the consuming app before anything else ships — it is
currently coded against a contract that changed underneath it.

### 1.2 Holland (BL8) has been dark for 18 days, and the API is reporting it as `$0` 🛑

This is not the hypothetical in §4.1. It is live right now:

```
BL8 last successful snapshot:  2026-07-24
Since then (2026-07-25 → 2026-08-10):  total = 0, order_count = NULL, snapshot_time = NULL, every day
```

Over the trailing 30 days BL8 is `total = 0` on **20 of 30 days**; every other trading store is
positive on 30 of 30. `snapshot_time IS NULL` means the nightly Clover fetch never wrote a row for
that store-day — a credential or connectivity failure, not a quiet store.

Every `morning-briefing` response since 25 July has carried `"netSales": 0` for Holland. §4.1 is
worth building for this reason alone, but **the outage itself needs fixing separately** — the field
will correctly say `no_data`, which does not put Holland's sales back.

### 1.3 Labour — CORRECTED 2026-08-11. The data exists; it is the importer that is behind

**This supersedes the original reading of this section, which said no labour data existed anywhere.**
That was inferred from D1 alone (`labor_pct = 0.0` in 1,434 rows, `NULL` in 556, a real value in 6).
Reading the source sheet directly — the same GViz URL `?action=backfill` fetches — shows otherwise:

| Sheet column | Field | State on 2026-08-11 |
|---|---|---|
| 10 (`B_LABOR`) | budgeted labour % | **populated for every day, including forward dates** — 0.098, 0.092, 0.141, 0.174 … |
| 9 | budgeted hours | populated for every day |
| 21 (`A_HOURS`) | actual hours | populated **through 2026-08-04**, blank after |
| 22 (`A_LABOR`) | actual labour % | populated **through 2026-08-04**, `0` after |

So `laborTargetPct` has a complete source right now, and `laborActualPct` / `laborHoursActual` have one
for every day up to 4 Aug. Brian's "I don't have labour numbers yet" is accurate about the **current
week** — hours entry stopped on the 4th — not about the history.

Two separate reasons the field is still null in the API:

1. **The importer never reads columns 9, 10 or 21 at all.** `worker.js:9032` is
   `COL = { WEEK:2, DATE:3, B_TOTAL:8, A_RETAIL:17, A_BINS:18, A_AUCTION:19, A_TOTAL:20, A_LABOR:22 }`.
   Budgeted labour %, budgeted hours and actual hours are simply not in the map, and
   `daily_sales.labor_hours` (migration-007) is `NULL` everywhere as a result.
2. **`?action=backfill` has not been re-run over the dates the sheet has since been filled in.** BL1
   for 2026-07-26 reads 0.0794 in the sheet and `0` in D1. It is a manual admin POST, so nothing
   re-runs it on its own.

**Revised verdict for §4.8:** not blocked on a payroll feed. `laborTargetPct` is deliverable now;
`laborActualPct` and `laborHoursActual` are deliverable for history and will resume as soon as hours
entry does. The work is: add the three columns to `COL`, write them, re-run the backfill, and keep
returning `null` (never `0`) for days nobody has entered.

### 1.4 Store master data does not exist anywhere

`business_units` has `code`, `name`, `active` for 6 stores — nothing else. The `users` table has **no
`name` column**, only `email`. So of §4.6's fields, only `storeId`, `name`, and `active` are derivable.

Deriving `managerEmail` from `user_grants` does not work either:

- **BL1 has four** manager grants (`jharvey@`, `alyson@`, `nmartinez@`, `howardbrian260@`)
- **BL8 has none**

The work order says `managerEmail` must be the real work address because it is used to tie a store
alert to that manager's correspondence — a wrong or arbitrary pick is worse than an absent one.

**Action:** §4.6 needs a curated `store_profile` table (new migration) that Brian fills in once:
manager name + email, city, state, square feet, opened date, closed date. Also decide whether closed
**BL12/Wyoming** appears with `active: false` — the work order asks for closed stores to stay visible,
and BL12 is in `daily_sales` (budgets through Dec 2026) but absent from `business_units`.

### 1.5 D1 holds future-dated rows with `total = 0` through 2026-12-26

Budgets are loaded for the whole year — every store has a `budget` for every date to 26 Dec 2026 —
but those same rows carry `total = 0` (not `NULL`), because the Sheet writes a zero.

This is a live trap for §4.2 and §4.3. A naive `SUM(total)` over a month-to-date window that runs past
today, or a `store-history` that does not clamp its end date, silently blends real sales with phantom
zeros. **Every new query must clamp to `date <= yesterday` and must treat `total = 0` as unknown
unless `snapshot_time` proves otherwise** (see 2.1).

### 1.6 Conventions this codebase has already settled — reuse, do not re-decide

- **Fiscal week: Sunday → Saturday.** The weekly digest cron (`worker.js:12844`) summarises "the
  Sun–Sat week that just ended". `daily_sales.week` is the authoritative stored week label; prefer
  `GROUP BY week` over deriving day-of-week arithmetic.
- **Year-over-year: date − 364 days** — same weekday, 52 weeks back (`index.html:5539` `lyDateOf`).
- **LY is `retail + bin` only, never net.** `last_year_sales` has no auction column, so the dashboard
  deliberately drops auction from the current-year side to compare like with like
  (`index.html:5545-5550`). §4.3's `lySalesForDate` must do the same and say so.
- **LY coverage:** 2024-12-26 → 2026-07-23, 6 stores, ~560 rows each. Sufficient for Aug 2026 (needs
  Aug 2025). It stops ~3 weeks short of today, so it will run out for dates after ~2027-07-22.

### 1.7 Repo mechanics that will bite

- **`ACTION_BUSINESS` is fail-closed.** Any new `action` must be added to the map at `worker.js:3642`
  or the business gate refuses it. A completeness test enumerates routed actions from source and will
  fail the build otherwise. Add `store-history`, `stores`, `afternoon-briefing`.
- **Handler placement.** `morning-briefing` is handled at `worker.js:6707`, *above* the session check,
  so external callers need no cookie. New key-gated endpoints go in the same block. Getting this
  wrong in the other direction has already happened once (an eBay read endpoint placed above the gate
  served buyer PII unauthenticated). Key-gated-and-above is correct **only** because these endpoints
  self-gate on `MORNING_BRIEFING_KEY`.
- **No test suite exists for morning-briefing.** `npm test` runs 26 suites / 639 assertions and none
  cover it. Per this repo's hard-won rule, a test that regex-extracts a function cannot see wiring —
  the new suite must drive `worker.fetch` with a stubbed `env`.
- **Deploy:** `bash scripts/build.sh`, deploy from a verified `main` checkout, bump `sw.js` cache only
  if `index.html` changed (it does not for 4.1–4.3, 4.5, 4.7).

---

## 2. Build plan

Ordered as the work order requests: independently shippable, delivered one at a time.

### Slice A — §4.1 `reportingStatus` + stop emitting `0` for unknown

> **BUILT 2026-08-11, not yet deployed.** `worker.js` +79/−8, `scripts/test-briefing-reporting-status.mjs`
> (56 assertions, 3 mutations proven to fail it). Full suite 695/27 green, up from 639/26.
> HEAD-vs-working-tree differential on real prod rows: 70 field values unchanged, 8 changed —
> 6 added `reportingStatus`, plus BL8's `netSales`/`posSales` 0 → null.
> Sample response: `tasks/sample-morning-briefing.json` (`grossMargin`/`categories` are empty there
> only because the test harness has no KV; prod populates both from the item snapshots).
> Labour confirmed with Brian 2026-08-11: **no numbers yet**, so §4.8 stays blocked and
> `laborActualPct` stays `null`.

**The discriminator already exists.** `daily_sales.snapshot_time` is written only when a Clover fetch
actually succeeded for that store-day. Measured: `NULL` on all 20 of BL8's dark days and all 30 of
closed BL12's, non-`NULL` on all 30 for every healthy store, and non-`NULL` on all 272
manual-override rows. Classification:

```
closed    → store-day is in the curated closure set (permanent closure, or a holiday calendar)
reported  → snapshot_time IS NOT NULL  OR  is_manual_override = 1  OR  auction > 0
no_data    → everything else (row missing, or snapshot_time NULL with no revenue evidence)
```

The `auction > 0` clause is not theoretical: 22 rows carry real auction revenue with no Clover
snapshot. Without it they would be flagged as an outage.

Consequences to implement alongside:

- `netSales` / `posSales` / `transactions` become `null` — not `0` — whenever status is `no_data`.
  Today `y.total ?? null` passes a stored `0` straight through, which is exactly the bug.
- `closed` returns `netSales: 0`, per spec.
- Default to `no_data` when uncertain, and say so in the handover.

**Closure set:** without a curated list, no day can honestly be called `closed`. Ship Slice A with the
set seeded from BL12's permanent closure only, and everything else defaulting to `no_data` — which is
the behaviour the spec explicitly prefers. A holiday calendar can land with Slice D.

Applies to `morning-briefing` **and every endpoint built after it** — build it as one shared helper
(`classifyReporting(row, dateStr, closures)`), not per-endpoint.

*Cost:* ~120 lines + a new `scripts/test-briefing-api.mjs`. Zero new tables. Zero latency change.

### Slice B — §4.2 `GET ?action=store-history`

> **BUILT 2026-08-11, not yet deployed.** `scripts/test-store-history.mjs` (69 assertions, 5 mutations
> proven to fail it, incl. the KV-read guard). Full suite 765/28.
> Built as specified below, plus three things the build forced:
> **(a)** the key gate was extracted into one shared block for the whole reporting family — a second
> hand-rolled copy is how an eBay read endpoint once served PII unauthenticated;
> **(b)** `reportedFigures()` now derives status + net/pos/auction/transactions in ONE place, so the
> two endpoints cannot drift on what a `no_data` day looks like;
> **(c)** that surfaced a live bug — `netSales` was shipping `5112.4400000000005` for BL14, because
> pos + auction is a float sum that was never rounded. Now `roundCents`-ed. Differential vs Slice A:
> 77 field values byte-identical, 1 changed (that number).
> `grossMargin` ships **present and null** — see the KV-ceiling reasoning below.
> Sample: `tasks/sample-store-history.json`. The `closed` branch that Slice A could not reach is
> tested here via `&storeId=BL12`.

Single D1 query over a clamped range, grouped in JS. Model on `history_d1` (`worker.js:8768`) but
key-gated, enveloped, and multi-store.

- `days` default 30, **clamp** to 400 (return the cap, never an error).
- End at **yesterday ET**, never today, and never a future date (see 1.5).
- Emit **every** date in the range for **every** store, filling gaps with `reportingStatus: "no_data"`
  and `null` figures. Do not let the row-absent case skip a day.
- Unknown `storeId` → `404`. Known-but-inactive → `200` with a full `no_data` series.
- `grossMargin` per day comes from the KV item snapshot. **Do not fetch 30 × 6 = 180 KV keys** — that
  will blow the 3 s budget and the subrequest budget. Either omit per-day margin from this endpoint,
  or gate it behind an explicit `&margin=1`. Recommend: omit, and let §4.5 serve margin on the
  briefing endpoints where the day count is 1.

*Latency:* one indexed D1 query over ≤400×7 rows ≈ 5 ms measured. Comfortably inside budget.

### Slice C — §4.3 WTD / MTD / LY on `morning-briefing`

> **BUILT 2026-08-11, not yet deployed.** `scripts/test-briefing-period-to-date.mjs` (81 assertions,
> 6 mutations proven to fail it). Full suite 846/29. Differential: 78 field values unchanged,
> 42 changed — all 42 are the 7 new fields × 6 stores. Nothing existing moved.
> Fiscal week **verified**, not assumed: prod weeks 30–33 of 2026 begin 07-19, 07-26, 08-02, 08-09 —
> every one a Sunday, exactly 7 days, identical dates for all 7 stores.
> Ships **7** fields, not the work order's 5: `wtdDaysReported` / `mtdDaysReported` were added
> because sales and budget cover only the days that can be vouched for, and the consumer has to be
> able to see the window is partial.
> 🔑 **`lySalesForDate` compares to `posSales`, NOT `netSales`** — it is retail + bin, and the
> prior-year import has no auction channel. Sample: `tasks/sample-morning-briefing.json`.
> The suite **freezes the clock**, because every case here is a calendar position; against the real
> clock the month-boundary straddle would be exercised on roughly one run in four.

Three additions per store, one extra D1 query each (or one combined query with `GROUP BY store`):

- `wtdSales` / `wtdBudget` — `GROUP BY week` using the stored `week` column, clamped to
  `date <= salesDate`. **Sunday-start**, inclusive of `salesDate`.
- `mtdSales` / `mtdBudget` — `substr(date,1,7) = salesDate[0:7]`, clamped the same way.
- `lySalesForDate` — `last_year_sales` at `salesDate − 364 days`, `retail + bin`, `null` when the row
  is absent. Auction-excluded on both sides.

**Both clamps are load-bearing** — without them December's zero-total budget rows join the sum.

Sum only days whose status is `reported`, and expose a `wtdDaysReported` count so the consumer can
tell a genuine WTD from one missing three of Holland's days. A WTD that silently omits dark days looks
like a sales collapse.

*Cost:* ~80 lines, +2 D1 queries.

### Slice D — §4.6 `GET ?action=stores` *(needs Brian first)*

1. Brian supplies the roster: manager name + work email, city, state, square feet, opened date, and
   BL12's closed date.
2. New migration creating `store_profile` (`store_id PK`, the above columns, `active`).
3. Endpoint reads `business_units LEFT JOIN store_profile`, so it degrades to name + active if a row
   is missing rather than 500-ing.
4. `Cache-Control: public, max-age=3600`.

Do **not** derive manager from `user_grants` (see 1.4).

### Slice E — §4.7 `GET ?action=afternoon-briefing`

> **BUILT 2026-08-11.** `scripts/test-afternoon-briefing.mjs` (48 assertions, 6 mutations proven to
> fail it). Full suite 1037/32. Built as described below: the light path (orders + refunds, no item
> categorisation), `allSettled` per store, 60 s cache, `expectedByNow` omitted.
> 🛑 **The one thing still unproven: real p95.** The suite guards the *cause* of latency — a
> subrequest count of ≤ 3 per store, which is what an added `fetchItemCategoryMap` would blow — but
> wall-clock against live Clover cannot be measured from here. **Time the first prod call.**
> ⚠️ `salesSoFarToday` is POS-ONLY while `todayBudget` assumes auction, so auction stores read
> ~2-4% light on pace. Stated, not silently corrected.
> Sample: `tasks/sample-afternoon-briefing.json` — **shape-accurate with SYNTHETIC sales** (the
> budgets are real prod values). Unlike the other two samples this one cannot be replayed from D1,
> because the endpoint's data only exists live in Clover.

The live intraday path already exists: `?store=<code>&since=<ts>` (`worker.js:12694`) live-fetches
Clover orders, refunds, and the item-category map for one store. **Six of those in one request is the
whole latency risk in this project.**

Recommendation: build a **light** variant that calls `fetchCloverOrders` + `aggregateOrders` only —
giving `salesSoFarToday` and `transactions` — and skips `fetchItemCategoryMap` / `aggregateItemSales`
entirely. §4.7 asks for no category or margin data, so the expensive half is not needed.

- `salesDate` = **today** ET; `asOf` = the true Clover cut-off with a real `-04:00` offset, not
  `Date.now()`.
- Not-yet-opened stores return `salesSoFarToday: 0` with `reportingStatus: "reported"` — a true zero.
  A store whose Clover call **fails** returns `null` + `no_data`. These two must not be conflated;
  that distinction is the entire point of §4.1.
- `expectedByNow`: no intraday curve exists in this system. Ship it **omitted** rather than emitting a
  flat pro-rata that the work order explicitly says overstates morning misses. If Brian wants it, an
  hourly curve is derivable from the `?action=hourly` data — that is its own slice.
- Cache 60–120 s. `Promise.allSettled` per store so one bad token cannot fail the response.

**Measure the p95 before declaring done.** If 6 stores exceed 3 s, fall back to serving from the
hourly KV snapshot and label `asOf` accordingly.

### Slice F — §4.5 real gross margin

> **BUILT 2026-08-11, not yet deployed.** `scripts/test-briefing-margin.mjs` (64 assertions, 5
> mutations proven to fail it). Full suite 910/30. Differential: 120 field values unchanged, 12
> changed — all 12 are the added `costCoverage` / `grossMarginPlan`.
> 🛑 **The work order's own margin heuristic is wrong for this business, and the suite pins that.**
> §4.5 says to treat anything ≥ 0.95 as unloaded cost data and ignore it. Bargain Lane buys by the
> lot, so a fully-costed category genuinely lands at 99% (Baby goods at a $1.17 unit cost). A
> mutation that adopts the ≥ 0.95 rule fails the suite on purpose. **The Chief of Staff app should
> gate on `costCoverage`, not on the margin's size.**
> `grossMarginPlan` ships present-and-null: no planned margin exists in any source system, confirmed
> by reading all 62 columns of the budget sheet.

The machinery is already there and is better than the work order assumes. `aggregateItemSales` runs a
cost cascade (item-master cost → L3 category cost → none) and **stores a per-category and total
`coverage: { item, category, none }` in dollars** in every KV snapshot.

So the honest rule is:

```
uncosted = coverage.none / (coverage.item + coverage.category + coverage.none)
grossMargin = uncosted > THRESHOLD ? null : gpmPct / 100
```

This replaces the current `0.999` placeholder with either a real margin or an explicit `null` — which
is what the consumer actually wants, since it discards anything ≥ 0.95 anyway. Also emit
`costCoverage` (the fraction that resolved to a real cost) so the consumer can see *why* a margin was
withheld.

`grossMarginPlan` has **no source**. Per the work order's own "both fields or both `null`", margin
stays `null` until Brian supplies planned margins. Recommend shipping the coverage-gated actual +
`costCoverage` anyway — it converts a silent lie into a measurable gap.

Note: `grossMargin` and every `categories[].netSales` are **POS-only** — auction has no item detail —
so they sum to `posSales`, not to `netSales`. Say this in the handover; it is already true today.

### Slice G — §4.8 labour

> **BUILT 2026-08-11.** `scripts/test-labour.mjs` (79 assertions, 5 mutations proven to fail it).
> Full suite 989/31. Differential: 132 field values unchanged, 18 changed — all 18 the new fields.
> Ships `laborActualPct`, `laborTargetPct`, `laborHoursActual`, `laborHoursScheduled`.

Three parts, only one of which is code that is already merged:

1. **`migration-037.sql`** — adds `budget_labor_pct` and `budget_labor_hours`. Purely additive.
2. **The importer now reads sheet columns 9, 10 and 21.** Each binds with `|| null`, because the
   sheet writes a literal `0` into every cell nobody filled in — which is currently *every* actual
   since 2026-08-04.
3. 🛑 **Two production steps still owed, and step 3 is a database mutation needing Brian's explicit
   go-ahead:**

```bash
npx wrangler d1 execute labor-dashboard-db --file=migration-037.sql --remote
```

then, **once per store** (`store=all` would issue ~5,000 subrequests against Cloudflare's 1,000 cap —
the handler's `store` param exists for exactly this):

```bash
for s in BL1 BL2 BL4 BL8 BL14 BL16; do curl -X POST "https://api.retjghub.com/?action=backfill&store=$s" -H "X-Snapshot-Secret: $SECRET"; done
```

**What that re-run changes, and nothing else:** `labor_pct` (~1,434 rows currently `0` → the sheet's
real fractions where it has them), and the three previously-`NULL` labour columns. `week` and
`budget` are rewritten from the sheet but should be identical. **Sales figures are untouched** —
`total`, `retail`, `bin`, `auction` and `order_count` all resolve existing-wins, and
`is_manual_override` rows are immutable throughout. Verified by the suite, not by reading.

🔑 The upsert must stay `COALESCE(excluded.labor_pct, labor_pct)` — *excluded first*. Every row
already holds `labor_pct = 0`, so the reverse ordering would pin all of them at zero forever and
make this whole slice inert. A mutation flipping it fails the suite.

### Blocked — §4.4, §4.9

Raise rather than build, as §7 instructs:

- **§4.4 category budgets** — the Sheet carries one store-level daily budget. A category plan would
  need a new column set per L2 category, per store, per day. Ask Brian whether category plans exist
  in any form.
- **§4.9 inventory** — no source of any kind. Needs a Clover stock export or a new feed.

---

## 3. Handover note — answers known today

The work order asks for these five. Four can be answered now:

| Question | Answer |
|---|---|
| Fiscal week start | **Sunday** (Sun–Sat). Verified against prod: 2026 weeks 30–33 begin 07-19, 07-26, 08-02, 08-09, each exactly 7 days, identical for all stores. The stored `daily_sales.week` label is authoritative; Sunday arithmetic is only the fallback |
| Year-over-year matching | **Day-of-week** — `salesDate − 364 days`. `retail + bin` only. **Compare `lySalesForDate` against `posSales`, not `netSales`** — the prior-year import has no auction channel, and putting an auction-inclusive figure against it overstates growth by ~4% chain-wide |
| Month-to-date basis | **Calendar month**, matching `?action=monthly-totals`. Not a fiscal 4-5-4 month |
| WTD/MTD day coverage | Sales and budget cover **exactly the days whose figures are vouched for**; a `no_data` day contributes to neither side. `wtdDaysReported` / `mtdDaysReported` report how many that was. Zero usable days → `null`, never `0` |
| Labour scheduled or actual | **ACTUAL WORKED hours**, not scheduled — and it is not payroll. The sheet computes worked hours × a flat blended rate ÷ net sales; the rate is recoverable from the sheet itself (**$14.40/hr through Feb 2026, $15.00/hr from March**), so treat it as a labour MODEL close to but not identical to payroll cost. `laborHoursScheduled` is the **budgeted** hours from the plan (col 9), not a scheduling-system figure. Actuals stop 2026-08-04; the target runs forward through December |
| Aged-inventory threshold | **N/A — no inventory source** |
| Gross margin | Reported only when **≥ 90% of net sales resolved to a real cost**; `costCoverage` ships alongside so a null is diagnosable. 🛑 Do NOT discard a margin for being ≥ 0.95 — this is a liquidation retailer and high margins are frequently genuine. Gate on `costCoverage` instead. `grossMarginPlan` is null: no source exists. Margin is POS-only and sums to `posSales`, not `netSales` |
| §5 auction / budget | **Budget INCLUDES auction; `netSales` now does too.** Already fixed in code; the work order's baseline sample is stale (see 1.1) |

Also worth stating in the handover: `grossMargin` and `categories[]` are POS-only and sum to
`posSales`, not `netSales`.

---

## 4. Verification protocol (per slice, before calling it done)

1. `npm test` green — 26 suites / 639 assertions baseline, plus the new `test-briefing-api.mjs`.
2. New tests drive **`worker.fetch`** with a stubbed `env`, never a regex-extracted function.
3. Prove the test is non-vacuous: break the code deliberately and watch the assertion fail.
4. Baseline regression: capture the current prod `morning-briefing` response **before** each deploy
   and diff — existing keys must be byte-identical, additions only.
5. Auth controls, two of them: no key → `401`; wrong key → `401`; valid key → `200`.
6. Time the full store set against the 3 s budget; record p95 for Slice E specifically.
7. Supply Brian one real sample response per endpoint, shape and field names exact.

**All endpoints are read-only `GET`.** None of this repo's destructive-operation rules apply — no
backfill, no KV overwrite of stored history, no D1 mutation. The only migration is Slice D's new
`store_profile` table, which is additive.

---

## 5. Suggested order and rough size

| Order | Slice | Blocked on | Size |
|---|---|---|---|
| 1 | Re-issue the §2 baseline (1.1) | — | minutes |
| 2 | **A** — `reportingStatus` | — | 1 session |
| 3 | **B** — `store-history` | — | 1 session |
| 4 | **C** — WTD/MTD/LY | — | 1 session |
| 5 | **F** — coverage-gated margin | — | ½ session |
| 6 | **E** — `afternoon-briefing` | — | 1 session + latency work |
| 7 | **D** — `stores` | Brian's roster | ½ session after data |
| — | 4.4 / 4.8 / 4.9 | new data sources | raise, don't build |

Separate and urgent, outside this work order: **fix the BL8/Holland feed** (1.2).
