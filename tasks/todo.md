# Retail lookup: unit semantics + free Fetch scoping

Follow-on from the TinyFish Agent review. The Agent stays OFF; these are the free fixes
that have to land before "needs agent" means anything.

## The one underlying defect

The retail path does not know whether a manifest line's numbers are **per shelf unit** or
**per case**, and it guesses differently in three places:

| Place | Guess it makes | What it broke |
|---|---|---|
| `retailIsBigTicket` | `cost` is per unit | Clorox pallets ($103–$4,786/line) classed big-ticket → searched Best Buy / Lowe's / Home Depot instead of Walmart / Target / Kroger |
| `targetPack` (`retailDecide`) | the description's count is our pack | multiplied retail by 15 on a `sell_as:"each"` sheet → S.O.S pads priced $392.55 |
| `retailPackSize` | — | cannot read the vendor's `N/size` case notation at all (`9/32fo` → 1) |

The scorer already has the right model at `worker.js:17652` — `sell_as` + `units_per_case`.
The retail path just never got it.

Measured on prod (`Clorox Update - Arlington, TX`, 41 lines): 27 flagged `needs agent`,
8 priced, **4 of those 8 wrong** — three unrelated products all priced off one Home Depot
75-count wipes page at $0.26 ($19.50 ÷ 75 = the price of one wipe).

## Plan

- [x] **1. Unit model.** `retailUnitsPerLine(line, manifest)` — the SAME formula as the
      scorer: `sell_as === "case" ? (line.units_per_case || manifest.units_per_case || 12) : 1`.
      Thread it from `retailRunManifest` through `ctx` into `retailPriceLine`/`retailDecide`.
- [x] **2. `retailIsBigTicket`** — category first (L2 is already resolved and free), then a
      **per-unit** cost. `msrp` is already per unit (the scorer multiplies it by units), so
      it is not divided.
- [x] **3. `retailPackSize(text, { vendor: true })`** — learn `9/32fo`, `12/15ct`, `18/3x75ct`.
      🛑 Opt-in, and NEVER applied to a retailer's listing title: Home Depot and Lowe's write
      fractional dimensions the same way ("3/4 in. x 10 ft.") and reading that as a 3-pack
      divides a real price by three.
- [x] **4. `targetPack` respects `sell_as`** — use the unit model, fall back to the parser
      only when a caller has no manifest context (the scan path stays at 1, unchanged).
- [x] **5. `retailFetch` selector scoping** — `include_selectors` / `exclude_selectors` are
      new since the Aug 2026 integration and free. Aimed at the failure the code already
      documents at `worker.js:8348`: a Target page returning 820 chars of nav chrome and no price.
- [x] **6. Tests** for each, in `scripts/test-retail-lookup.mjs`.
- [x] **7. Full suite green**, then commit + push + draft PR.

## Not in scope

- Funding the TinyFish Agent. Still off; still flagged, not billed.
- Re-running the Clorox manifest against prod (that is a write, and Brian's call).
- The 4 wrong prices sitting in D1 — they are on a **draft** manifest, so nothing has been
  bought against them. They clear on the next run once this lands.

## Review

**Landed.** 2,643 assertions across 51 suites, all green (was 2,623 before; +20 new).

### What changed

| | |
|---|---|
| `retailUnitsPerLine(line, manifest)` | new — the scorer's own `sell_as`/`units_per_case` formula, so both halves of the screen finally agree what a line's cost means |
| `retailIsBigTicket(line, unitsPerLine)` | L2 category first, then a **per-unit** cost. `msrp` deliberately not divided |
| `retailPackSize(text, { vendor })` | learns `9/32fo`, `12/15ct`, `18/3x75ct`. Opt-in, and never applied to a retailer's title |
| `targetPack` | `units_per_case` first, vendor-aware description second. Scan still pinned to 1 |
| `retailFetch` | sends `exclude_selectors` — free, and can only remove noise |

### Two things found while doing it, both fixed

1. **I conflated the two questions the scorer keeps apart.** My first cut drove `targetPack`
   off `sell_as`, which is the *cost* question. The existing R2 tests caught it immediately
   — "a 6-ct line priced off a 6-pack is the PACK price, not the bar price". `units_per_case`
   answers "what are we buying"; `sell_as` answers "is cost per case". They are not the same
   number and merging them broke eight assertions.
2. **A pre-existing dimension bug in the older `NxM` rule.** "5/16 x 4 in." read as a
   16-pack and "3/4 x 10 ft" as a 4-pack. Not caused by this work, but this work makes it
   *reachable* — Hardlines now goes to the sellers that actually stock it, so there is
   finally a price there to multiply. Guarded, with the atomic-group note explaining why
   the obvious `\b` fix breaks `6X12OZ`.

### Proof it works

Reverting `worker.js` alone (keeping the new tests) fails **11** of the new assertions —
they are regression tests, not restatements. Notably `12/15ct` returns 45 instead of 36 on
the old code, which is the exact mechanism behind the live $392.55.

### Still open — not code

- **The Clorox manifest is mis-mapped.** `sell_as: "each"` with per-line costs of $103–$4,786
  and `$103.02 / 102 = $1.0100`, `$250.48 / 248 = $1.0100` — that column is an *extended*
  line total, not a per-each cost. These fixes stop the routing damage; they cannot make a
  mis-mapped column mean something else. Worth a remap before the next run.
- **Nothing has been re-run against prod.** The 4 wrong prices are still in D1 on a draft
  manifest. Clearing them is a write, and per the repo rules that is Brian's call.
- **The Agent stays off.** Once routing is right, re-measure how many lines genuinely still
  need it. Expectation: close to zero.

---

# Manifest mapping: make the cost basis a fact, not a default

`worker.js:17591` — `sell_as` is taken from the caller, else the template default, else
`"each"`, and **never looks at which column was mapped to `cost`**. Two of the four saved
vendor templates are wrong because of it:

| Vendor | mapped cost column | true basis | `sell_as` today |
|---|---|---|---|
| Alliance | `Unit Price` | per unit | `each` ✓ |
| Kind | `Price per unit` | per unit | `each` ✓ |
| WI Food | `Case Price` | **per case** | `each` ✗ |
| Clorox | `Sale Price` | **extended line total** | `each` ✗ |

Clorox is the one no `sell_as` value can express: `each` reads $900.93/unit, `case` reads
$75.08, the truth is $7.57. Decision taken: **normalise at import** — divide by qty, store
a per-unit cost, keep the original on the line as a flag.

Each basis maps onto a path that is already correct downstream, so the scorer's money math
is not touched:

    unit      → store verbatim,          sell_as = each   (today's behaviour)
    case      → store verbatim,          sell_as = case   (scorer already ÷ units_per_case)
    extended  → cost ÷ qty at write time, sell_as = each

## Plan

- [x] `migration-055.sql` — `manifests.cost_basis`, `vendor_templates.cost_basis_default`
- [x] `MANIFEST_COST_BASIS` — header → `unit｜case｜extended`, and **`null` when the header
      does not name its unit**. "Sale Price" is genuinely ambiguous; guessing it from the
      name is how this happened. Unknown keeps today's behaviour and says so.
- [x] Upload derives the basis and sets `sell_as` from it; reports `cost_basis` + source
- [x] `manifestWriteLines` divides an extended cost by qty, flags the line with the original
- [x] No qty → cannot divide → flag, never guess
- [x] Remap accepts a corrected `cost_basis`, persists it, re-normalises; template remembers it
- [x] Mapping screen: "Sells as each/case" → "Cost is per unit / per case / line total"
- [x] Tests, full suite, then push

## Not in scope

- Re-running or rewriting the existing Clorox manifest in D1. That is a database mutation
  and needs explicit confirmation with a summary of what it would touch.

## Review — cost basis

**Landed.** 2,671 assertions across 51 suites, all green (2,643 before; +28 new).

### Precedence, and the one ordering that matters

    upload:  caller  >  remembered  >  column  >  legacy sell_as  >  'unit'
    remap:   caller  >  column      >  stored  >  legacy sell_as  >  'unit'

**A remembered answer beats the header on upload, and that is load-bearing.** A vendor can
name a column "Unit Cost" and quote cases in it; if the header could override what someone
told us last time, the correction could never stick. The existing suite caught me getting
this backwards — `test-manifest-scorer` asserts a saved `sell_as` survives the next upload,
and my first cut let the header win. **On remap the column wins instead**, because whoever
is remapping is editing the mapping right now, so the column they just picked is fresher
than a basis stored against the mapping they are replacing.

### A gap the tests found

`MANIFEST_HINTS.cost` had no extended forms at all — "Extended Cost" was never mapped as a
cost column, so the basis could never have been detected no matter how good the classifier
was. Added late in the list (a sheet with both "Unit Price" and "Extended Cost" means the
first), and each pattern names cost/price/amount rather than matching "Extended" alone —
a bare `/^ext/` would take **"Extended Retail"**, which is MSRP's column, and price the
load off the retail we are supposed to be beating.

### Proof

Reverting `worker.js` alone fails the new assertions immediately — with no `cost_basis` in
the response and "Extended Cost" unmapped, the suite aborts at the first fixture.

### Still open

- **Clorox is not auto-fixed, by design.** "Sale Price" does not name a unit, and guessing
  one from a name that does not carry it is exactly how this happened. The mapping screen
  now says so in those words and offers the control. Correcting that vendor means a remap
  (a database write) and is not done here.
