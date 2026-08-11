# Retail Reporting API — Handover Note

**Answers:** `API_WORK_ORDER.md` (Brian Howard, 11 Aug 2026), §6
**System:** `api.retjghub.com` — Cloudflare Worker `clover-sales-api`
**As of:** 2026-08-11 · main `67272a7` · worker version `fcc3053a`
**Auth:** unchanged — `x-api-key: <token>` header, `GET` only

Everything below was measured against production, not inferred from the spec.

---

## 1. The five questions §6 asks

| Question | Answer |
|---|---|
| **Fiscal week start** | **Sunday** (Sun–Sat). Verified: 2026 weeks 30–33 begin 07-19, 07-26, 08-02, 08-09 — each a Sunday, each exactly 7 days, identical across all stores. The stored week label is authoritative; Sunday arithmetic is only a fallback. |
| **Year-over-year matching** | **Day-of-week** — `salesDate − 364 days` (52 weeks, same weekday). Not calendar-date matched. |
| **Labour: scheduled or actual?** | **Actual worked hours** — but it is *not payroll*. See §2.4. |
| **Aged-inventory threshold** | **N/A** — no inventory source exists. §4.9 not built. |
| **§5 — does budget include auction?** | **Yes.** `budgetForSalesDate` includes auction revenue, and `netSales` now does too (`netSales === posSales + auctionSales`). The work order's §2 baseline sample, which said `netSales` excludes auction, was already out of date when it was written. |

One extra the spec didn't ask for but needs stating: **month-to-date is the calendar month**, not a fiscal 4-5-4 month.

---

## 2. Seven things that will silently corrupt your numbers

These are the ones where the API looks like it is answering your question but isn't.

### 2.1 `lySalesForDate` must be compared to `posSales`, never `netSales`

The prior-year import has **no auction channel at all** — it is retail + bin only. `netSales`
includes auction. Comparing them overstates growth for every auction store.

```
BL1 2026-08-10:   vs posSales  −29.5%      vs netSales  −27.7%
```

`daily_sales.total` equals `retail + bin` exactly, so `posSales` is the like-for-like side. This
API's own dashboard made this mistake once and overstated growth ~4% chain-wide.

### 2.2 Gate margin on `costCoverage` — **not** on the ≥ 0.95 rule

§4.5 says to treat any margin ≥ 0.95 as unloaded cost data and discard it. **That heuristic is wrong
for this business.** Bargain Lane is a liquidation retailer buying by the lot, so a fully-costed
category genuinely lands at 99% — Baby goods at a $1.17 unit cost is a real, verified example.

`costCoverage` is the fraction of net sales that resolved to an actual cost. It answers the question
the ≥0.95 rule is reaching for, without discarding true figures for being large:

```
grossMargin is emitted only when costCoverage >= 0.90, and is null below it.
costCoverage ships either way, so a null margin is diagnosable rather than mysterious.
```

Live example — the gate doing real work:

```
BL2  grossMargin 0.376  costCoverage 0.998   ← reported
BL1  grossMargin null   costCoverage 0.886   ← withheld, 1.4 points short
```

BL1's shortfall is a genuine known gap (uncategorised Clover items, ~97% concentrated in BL1), not
an API fault.

### 2.3 🛑 A DAILY gross margin is not a meaningful number for this business

This is the most important line in this document.

Bin merchandise is priced on a **declining scale through the week**, while its cost is a flat
per-unit figure. So the bin margin — and, because bins are 8–61% of a day's revenue, the whole
store's margin — is dominated by *which day of the price cycle you are looking at*, not by
performance.

South Bend, one ordinary week, from stored data:

```
          bin ASP    bin margin      STORE margin   bin share of revenue
Fri        $9.15         +76.2%           67.0%            61%
Sat        $5.89         +63.0%           60.4%            36%
Sun        $3.00         +27.3%           43.1%            41%
Mon        $2.00          −9.0%           37.6%            29%
Tue        $1.01        −116.6%           30.6%            17%
Wed        $0.52        −317.2%           26.8%             8%
─────────────────────────────────────────────────────────────────
WEEK BLENDED     bin +33.6%        STORE +48.3%
```

The store swings **26.8% → 67.0%** across one week while performing identically. A negative daily
bin margin is arithmetically correct and economically meaningless in isolation.

**Therefore:**

- **Do not compare `grossMargin` between stores unless they are on the same day.**
- **Do not trend `grossMargin` day over day.** You will be reading the bin calendar.
- **Do not alert on a negative category margin.** Late-week bins are supposed to look like that.
- Margin is only interpretable **blended over a full bin week**. The API does not currently emit a
  weekly margin — see §5.

For the avoidance of doubt: the flat bin cost is approximately **right**, not broken. Blended across
the week bins run **+33.6%**, which is a sane liquidation-bin margin.

### 2.4 `laborActualPct` is a model, not payroll

The source spreadsheet computes it as **actual worked hours × a flat blended rate ÷ net sales**. The
rate is recoverable from the sheet's own arithmetic: **$14.40/hr through Feb 2026, $15.00/hr from
March**. So it is close to, but not the same as, real payroll cost. `laborHoursScheduled` is the
**budgeted** hours from the plan, not a scheduling system's output.

### 2.5 WTD/MTD budgets cover only the days that reported

Sales and budget are summed over **exactly the same days** — the ones whose figures can be vouched
for. A `no_data` day contributes to neither side. `wtdDaysReported` / `mtdDaysReported` tell you how
many that was.

This matters because the alternative is worse: summing a full week's budget against partial sales
would have shown Holland — dark since 24 July — as a 100% miss. **Always read the `daysReported`
count before acting on a period figure.** Zero usable days returns `null`, never `0`.

### 2.6 `no_data` means *unverified*, not *definitely broken*

A genuine zero-sales day and a feed failure are **not distinguishable** in the stored data: when
Clover returns zero orders the nightly job skips the write entirely, leaving nothing behind either
way. Both report `no_data`. Treat it as "we cannot vouch for this figure", not as an outage alarm.

`closed` is only ever produced from a curated closure list, so a holiday closure reports `no_data`
rather than being guessed at.

### 2.7 `salesSoFarToday` is POS-only; `todayBudget` is not

Auction revenue arrives on a next-morning feed, so there is no intraday auction figure — while
`todayBudget` is a whole-revenue target that assumes auction. Auction stores therefore read roughly
**2–4% light on intraday pace**. Not corrected in the API, because silently inflating a live figure
would be worse than a documented offset.

Related: `grossMargin` and every `categories[].netSales` are **POS-only** and sum to `posSales`, not
to `netSales`.

---

## 3. Endpoints

### `GET ?action=morning-briefing`

Yesterday, per store. Cached 300 s. Live response, one store, unedited:

```jsonc
{
  "storeId": "BL2", "name": "South Bend", "salesDate": "2026-08-10",
  "reportingStatus": "reported",
  "netSales": 4364.39, "posSales": 4364.39, "auctionSales": null,
  "budgetForSalesDate": 4556, "todayBudget": 4841,
  "wtdSales": 10509.27, "wtdBudget": 11205, "wtdDaysReported": 2,
  "mtdSales": 52740.95, "mtdBudget": 56646, "mtdDaysReported": 10,
  "lySalesForDate": 4685.21,
  "laborActualPct": null, "laborTargetPct": 0.141,
  "laborHoursActual": null, "laborHoursScheduled": 50,
  "transactions": 238,
  "grossMargin": 0.376, "costCoverage": 0.998, "grossMarginPlan": null,
  "categories": [ { "name": "Bin Products", "netSales": 1282,
                    "grossMargin": -0.09, "costCoverage": 1, "units": 641 } ]
}
```

### `GET ?action=store-history&days=30[&storeId=BL1]`

Trailing daily series, newest first, **no gaps** — every date appears, missing ones as `no_data`
with `null` figures. `days` defaults to 30 and clamps to 400 (returns the cap, never an error).
Unknown `storeId` → `404`. Measured **0.10 s**.

The range **always ends yesterday**. Today is excluded (still being collected), and so is every
future date — the database holds budget rows through December with a literal `total = 0`, and an
unclamped range would serve months of phantom zeros as sales.

`grossMargin` is present and **always `null`** here: per-day margin lives in a separate store, and
one read per store-day is 2,400 reads at the 400-day cap — past the platform's request ceiling. A
field that worked at `days=30` and failed at `days=400` would be worse than an honest null. Use
`morning-briefing` for margin.

### `GET ?action=afternoon-briefing`

Today, live from the POS. Cached 60 s. Measured **1.5–2.8 s** (six stores, live).

`salesDate` is **today**, unlike the morning endpoint. `asOf` carries a real ET offset and is stamped
when the data was fetched, not when the request arrived.

Three cases that all used to look like `0`:

| | |
|---|---|
| POS answered, no orders yet | `salesSoFarToday: 0`, `reported` — a true zero |
| POS call failed | `null`, `no_data` |
| No credentials configured | `null`, `no_data` |

**`expectedByNow` is not emitted.** It needs an intraday curve and none exists; a flat pro-rata is
the thing the work order itself says overstates morning misses. A curve is derivable from stored
hourly data if it becomes worth building.

---

## 4. What is `null` today, and when it fills

| Field | State | Fills when |
|---|---|---|
| `laborActualPct`, `laborHoursActual` | `null` after **2026-08-04** | HR returns and enters hours — the importer now runs nightly, so no manual step |
| `laborTargetPct`, `laborHoursScheduled` | **populated through 2026-12-26** | — |
| `grossMarginPlan` | `null`, always | no planned-margin source exists anywhere (all 62 sheet columns checked) |
| `grossMargin` (BL1) | `null` | when uncategorised items push coverage above 0.90 |
| `grossMargin` (store-history) | `null`, by design | not planned; use `morning-briefing` |
| Holland, most fields | `no_data` | when its register starts recording sales again |

---

## 5. Not built

| § | Why |
|---|---|
| **4.4** category budgets | The plan carries one store-level daily number. No category-level plan exists in any source. |
| **4.6** `?action=stores` | Manager names, emails, square footage and opening dates exist **nowhere** in the system. Needs a curated roster. User grants cannot substitute — one store has four manager grants, another has none. |
| **4.9** inventory | No merchandise-inventory feed of any kind. |

**Recommended addition — a weekly blended margin.** Per §2.3 the daily figure cannot be compared or
trended, which leaves margin close to unusable for the consumer today. A `wtdGrossMargin` /
`wtdCostCoverage` pair, blended across the fiscal week to date, would make it meaningful. It is
affordable: 7 days x 6 stores of stored reads, against an endpoint currently answering in 0.35 s.

---

## 6. Known data problems this API is reporting faithfully

The API is correct in each case; the underlying data is not.

**Holland (BL8) has recorded no sales since 2026-07-24.** Its credentials are fine — the POS answers
normally and returns zero orders — so this is a register or store problem, not an integration one.
Its labour entry stopped the same day.

**Indy East (BL16)'s source tab is not laid out like the other five.** Its "actual hours" column is
filled forward with the *schedule*, and its actual-percentage column is never computed, so its
labour actuals are excluded from import entirely until the tab is brought into line. Its plan is
also computed at the stale $14.40 rate while the chain moved to $15.00 in March, leaving its target
~4% understated.

---

## 7. Changes to the previously-published contract

Existing consumers need **no code change** — every change is additive or a correction from a wrong
value to a truthful one. But two will look different on the day they land:

1. **A non-reporting store now returns `null`, not `0`.** Holland previously reported
   `netSales: 0` every day since 25 July; it now reports `null` with `reportingStatus: "no_data"`.
   Anything summing across stores must treat `null` as "exclude", not as zero.
2. **`netSales` includes auction revenue** (`posSales + auctionSales`). If you were adding
   `auctionSales` to `netSales` yourself, stop — you are double-counting.

Field-level: `reportingStatus`, `wtd*`, `mtd*`, `lySalesForDate`, `costCoverage`, `grossMarginPlan`,
`laborTargetPct`, `laborHoursActual`, `laborHoursScheduled` are new. `grossMargin` changed from a
placeholder `0.999` to either a real margin or `null`.

---

## 8. Operational notes

- The source spreadsheet is **hand-entered**, and until 2026-08-11 the only thing importing it was a
  manual admin request. That is why labour sat in the sheet from December and never reached the API.
  A **trailing 21-day import now runs nightly**, so retrospective entry lands on its own.
- The import can never overwrite POS-derived sales — those resolve existing-wins at every window
  size. An unreachable spreadsheet writes nothing at all rather than writing blanks.
- Backfilling more than 21 days back is still a manual, per-store operation.
- All business dates are **America/New_York**, including for the Michigan stores.
