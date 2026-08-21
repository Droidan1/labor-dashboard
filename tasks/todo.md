# Merchandising items 1–3 — Aug 20 2026

Order comes from the Aug 20 alignment conversation. See tasks/merch-space-model.md
for the requirements record.

## 1a. Criteria `core` is inverted in the live version  ⚠️ DB MUTATION — NEEDS CONFIRMATION

Live version is **v4**. It reads:
- chain default `core` = **1**  → everything inherits "core"
- the nine food L3s explicitly `core` = **0**  → food reads as NOT core
- Softline Apparel / Shoes = 1

That is backwards. v2 had it right. Effect today: the 60% core floor on Coverage
is unmeasurable and food — the actual core — is excluded from it.

- [x] Build v5 from v4: chain default 1→0, nine food L3s 0→1, Softline unchanged
- [x] Get Brian's explicit confirmation on the exact diff (CLAUDE.md rule 7)
- [x] Publish v5 with a note
- [x] Verify Coverage now shows a measurable core share

## 1b. "Not sold at big box" is a real answer, not a blank

`retailPriceLine` already separates "not looked up" (budget) from "no retail", but
"no retail" conflates two very different outcomes:
  - search found nothing at any allowed retailer  → genuinely NOT CARRIED at big box
  - retailer pages existed but no price survived   → the tool could not read it

Only the first is an answer. Today both render as an empty cell reading as failure.

- [x] Split the miss into `not at big box` vs `no price found`
- [x] Surface as an explicit verdict, not a blank
- [x] Cost test note says the basis is our ASP *because* nothing is carried at big box
- [x] Test coverage in scripts/test-retail-lookup.mjs

## 2. Freight and defect are missing from the cost basis

`landed_cost` is literally `SUM(cost * qty)` — invoice cost. Zero freight handling
in the worker. For salvage, freight + unsellable share runs 15–25% of true cost,
so every criteria gate is currently passing lines it should not.

    effective_cost = (cost + freight_per_unit) / (1 - defect_pct)

Freight amortises **per unit** for now (qty is on every line). Upgrade path once
item dimensions land: amortise by cubic volume, which is what actually drives
freight.

- [x] migration-048: `freight_cost`, `defect_pct` on manifests
- [x] `manifestEffectiveCost()` helper
- [x] manifestScore uses effective cost for the cost + margin + breakeven tests
- [x] landed_cost query reflects freight
- [x] UI inputs on the manifest page, and show effective vs invoice cost
- [x] Tests

## 3. Velocity and penetration by store and L3

Data already exists: item snapshots are per store-day, `mergeItemSnapshots` returns
`qty` by L3 plus `l3Orders` (basket-touch counts) and `orderCount`.

Raw units cannot separate "wrong product" from "wrong customer" — store size
confounds it. Three numbers do:
  - units per 1,000 transactions   (controls for store size)
  - basket penetration %           (share of baskets containing the L3)
  - store vs chain on both         ← the actual diagnostic

Read: one store low vs chain → assortment. ALL stores low → the category does not
work for our customer; take the feet away.

⚠️ Basket-touch counts sum to MORE than orderCount (one basket touches several
categories). Penetration is a share of baskets, NOT a mix that totals 100%.

- [x] `merch-velocity` action, per store per L3, window selectable
- [x] Page + nav id, registered in NAV_BUSINESS (fail-closed gate)
- [x] Follow DESIGN.md §4.8 — panel owns bar + table + legend
- [x] Tests

## Verification gates (every item)
- [x] `bash scripts/test.sh` green
- [x] `node scripts/test-nav-registry.mjs` for any new nav id
- [x] Grep worker.js/index.html to confirm each edit ACTUALLY landed (patches have
      silently failed before — verify the artifact, never a paraphrase)
- [x] Bump sw.js CACHE_NAME on any frontend commit
- [ ] Worker deploys before frontend

---

## Review — Aug 20 2026

**Suite: 1963 assertions across 48 suites, all passing** (was 1915/47).

### 1b — a retail miss now names itself
Three outcomes used to collapse into one blank cell:
- `not at big box` — no approved retailer carries it. A real answer: nothing to undercut,
  but no proof of demand either, so the cost test falls back to our ASP and says so.
- `no price found` — an approved retailer DOES carry it, we failed to read a price. Our
  failure, and must never be reported as absence from retail.
- `marketplace only` — on their domain, sold by a third party. Distinct and actionable.

`sawApproved` is seeded from the SEARCH results, not the parsed candidates: a Walmart page
appearing in search is itself evidence the item is carried, even when the parser reads no
price off it. Deciding from candidates alone produced false "not at big box" for items
Walmart plainly stocks — the worst error available here, since it tells a buyer there is
no competition when there is.

**Two bugs the suite caught during the change, both real:**
1. `isDone` matched only the literal `"no retail"`. Lines settled under any new reason were
   re-offered forever — the drainer spun instead of draining. Fixed with
   `RETAIL_SETTLED_FLAGS`, which deliberately excludes `not looked up` (never asked) and
   deliberately includes `lookup failed` (retrying inside the drainer never terminates).
2. The re-run flag stripper carried its own hardcoded copy of the flag list. Any flag the
   run can SET but not CLEAR sticks forever, so a later successful run still shows the old
   failure. Replaced with `RETAIL_OWNED_FLAGS`.

### 2 — freight and defect in the cost basis
`effective_cost = (invoice + freight_per_unit) / (1 - defect/100)`, clamped at 95%.
Freight amortises per unit over the SAME denominator the lines are priced in — a different
denominator would mis-state every effective cost silently. Both default to 0, so nothing
already scored moves. Load-level `landed_cost` now carries freight; defect removes sellable
units rather than adding cash, so it is priced per unit, not there.

Frozen once a manifest is decided — moving the basis under a recorded verdict rewrites
history. Bad input is refused (400), never silently clamped.

### 3 — velocity and basket reach
`merch-velocity`, per store per category, windows 7/28/91/364. Rates computed server-side
so every surface divides the same way.

⚠️ **Two key spaces.** `l3Rows` carries the RAW Clover L3, `l3Orders` is normalised. Joined
unnormalised it yields units with no baskets and baskets with no units — every ratio wrong,
nothing thrown. `merchVelocityRows` normalises before joining.

⚠️ **An L2's baskets are its own, never the sum of its children's.** One basket touching
three L3s in the same L2 is ONE basket for the L2. Summing reports penetration over 100%.

Units are never tinted against the chain: the biggest store always sells the most, and
painting store size as performance is the exact confusion the page exists to remove.

### Intentionally left alone
- `cost_vs_std` still compares INVOICE cost to category standard cost. Whether our book
  cost already includes freight is unknown, so making it effective could double-count.
- The inline `color:#6b6453` sub-labels elsewhere in the manifest table measure **3.03:1**
  on the dark panel — below AA. Fixed only in the cell that was already being edited
  (`.mf-sub`, 5.88:1 light / 5.75:1 dark). ~43 other instances remain; orthogonal cleanup.
- A NON-core category can never have a shelf count, so it can never have a per-section
  rate. Fine today; the capacity plan in tasks/merch-space-model.md should cover everything.

### 1a — criteria v5 PUBLISHED to prod, 2026-08-21T00:02Z
Authorised by Brian in session. Backed up first (60 rows, verified non-empty before any
write — rule 2). Built as a new version copying v4, exactly as merchEnsureDraft +
merch-criteria-draft + merch-criteria-publish would; **v4 left completely intact**, so
rollback is `DELETE FROM merch_criteria(_versions) WHERE version=5` and v4 becomes live
again on its own (live = highest PUBLISHED version).

**11 cells changed, 7 untouched, verified by diffing v4 against v5:**
- chain default `core` 1 → 0
- nine food L3s `core` 0 → 1
- chain default `min_margin_per_unit` 30 → 0.30

Downstream, confirmed rather than assumed: BL1's two shelf counts (Breakfast 7, Canned
Goods 14) were ORPHANED under v4 because those categories read as non-core. Both are core
under v5, so the counts now count.

### Not done
- Nothing deployed. Order: migration-048 → worker → frontend (sw v109).
- Staging is many deploys behind: migrations 042–048 all unapplied there.
