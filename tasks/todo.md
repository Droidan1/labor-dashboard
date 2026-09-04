# Daily Breakdown row: stop the sales figure painting over its budget (2026-09-04)

Follow-up to #189, which flagged this and deliberately left it alone.

## The fault

The row's middle column puts the day's figure and its `vs $budget` on one flex
line. The budget span is `whitespace-nowrap`, so it never shrinks; the figure's
box carries `min-w-0`, so it does — below its own content width. With
`flex-wrap: nowrap` the figure then overflows and paints on top of the budget.

Measured on the shipped markup against the BUILT stylesheet, Coliseum's week of
2026-08-16 (the widest figures in it):

| viewport | rows overlapping | worst |
|---|---:|---:|
| 360px | 7 of 7 | **57px** |
| 390px | 7 of 7 | 27px |
| 414px | 2 of 7 | 3px |
| 900px | 0 | — |

Identical in the auction card and the no-auction control, which is what placed
it in the shared middle column rather than in #189's new Auction column.

## The fix

`flex flex-wrap … gap-x-2 gap-y-0.5` in place of `flex … gap-2`, on BOTH
renderers of this row — `buildWeeklyTable` (store detail → Daily) and
`buildAllStoresWeeklyTable` (All Stores → Daily), which carry the identical
markup one tap apart. The budget drops to its own line instead of the figure
being squeezed, so no number is truncated. `gap-x-2` preserves the 8px
horizontal gap desktop already had — a wider gap would make this a silent
restyle of every row at every width.

Rejected: `truncate` on the figure. It resolves the overlap by turning
`$10,213.09` into `$10,213…`, which is worse than the bug on a money column.

## Review

Re-measured after the fix: **0 overlapping rows at 360 / 390 / 414 / 900px**,
both cards. Desktop renders identically to before — the wrap never engages
there. `scripts/test-daily-row-layout.mjs` (14 assertions) pins the invariant on
both renderers and was mutation-tested against three regressions — reverting the
line, dropping only `flex-wrap`, and widening the horizontal gap — all three
caught. Full suite 3,411 assertions across 57 suites, green; build clean; cache
v167 → v168.

Still open from #189: `getStoreMetrics.storeAuction` (`index.html:7164`) reads
`getTodayRow(...)?.aAuction`, which `loadStoreFromD1` always nulls on today's
row, so the hero's current-week auction chip reads $0 for today.

# Auction column on the store-detail Daily tab (2026-09-04)

## The ask

"Add the auction column to the daily tab" — the per-store day-by-day breakdown at
`buildWeeklyTable` (`index.html:7290`), panel `#sd-content-weekly`, reached from a store
card's "View Details →" then the **Daily** tab.

## What is wrong there today

The Daily tab is the only per-store day-by-day surface in the app, and it is the one place
auction is missing entirely. Its per-day figure is `r.aTotal`, which is `daily_sales.total`
— POS revenue only (`worker.js:2363-2366`). But `r.bTotal` is `daily_sales.budget`, which
**does** include auction (`docs/API_HANDOVER.md:20`). So every auction store is measured
against a target that assumes revenue the table refuses to count.

Measured over August 2026 (prod D1), pace against budget, POS-only vs net:

| store | POS-only | net (incl. auction) | understated by |
|---|---:|---:|---:|
| BL1 Coliseum | 76.4% | 82.2% | 5.8 pt |
| BL14 Battle Creek | 109.7% | 114.8% | 5.1 pt |
| BL16 Indy East | 86.1% | 88.3% | 2.2 pt |
| BL2 South Bend | 84.3% | 85.9% | 1.6 pt |

The same screen already contradicts itself: the store-detail hero's week total adds
`m.aAuction` (`index.html:8146`), the Daily tab's own **Week N Total** row does not
(`index.html:7336`). For an auction store the two disagree, and the day rows never sum to
the hero.

## The shape

Add the Auction column, and put the panel on the same revenue basis as the hero above it,
the store cards, the combined daily table (`index.html:7450`) and the daily email — all of
which already count POS + auction.

1. **`buildWeeklyTable` (`index.html:7290`)** — new 4th grid column between the sales block
   and the delta block. Per-day auction, `—` when there is none. Day figure becomes
   net = POS + auction, so the bar, the vs-budget line and the delta are measured against a
   budget that includes auction. `title` on the figure carries the POS/auction split.
2. **Week Total row (`index.html:7336`, `7407`)** — sums the auction column, so it matches
   the hero and the day rows sum to it.
3. **`_buildSdMonthSummary` (`index.html:7237`)** — same panel, directly above the day rows;
   its month total is `aTotal`-only against the same auction-inclusive budget.
4. **`renderDailySalesChart` (`index.html:7672`)** — the Chart tab sits next to Daily and
   plots the same days. Left alone it would plot a different number than the table for the
   same day. This-week, last-week and last-year series all move to net.

## Which auction field

`allStoreData` is built only by `loadStoreFromD1` (`index.html:4944`); `loadStore`, the
Sheets reader, is dead (defined at `4903`, called nowhere). `loadStoreFromD1` nulls
`aAuction` on today's row and keeps the value in `auctionRaw` — because the nulling exists
to stop double-counting against live Clover, and **auction is not a Clover channel**, so
today's auction is only reachable via `auctionRaw` (`index.html:4977-4985`). Read
`r.auctionRaw ?? r.aAuction`.

## Out of scope

- All Stores → Daily tab — already auction-inclusive (`index.html:7450`).
- Retail Summary, print report, WRS CSV.
- `getStoreMetrics.storeAuction` (`index.html:7164`) reads `getTodayRow(...)?.aAuction`,
  which `loadStoreFromD1` always nulls — so the hero's current-week auction chip is always
  $0 for today. Pre-existing, separate, and near-zero impact in practice (the Drive feeder
  posts yesterday's auction at ~06:00, so today's is null anyway). Noted, not fixed here.

## Steps

- [x] Auction column in the day row + net day figure + split tooltip
- [x] Week Total row includes auction
- [x] Month summary includes auction
- [x] Chart tab series move to net (this week / last week / last year)
- [x] Colours: reuse existing tokens only; verify ≥ 4.5:1 in BOTH themes by computing
      against the real ground, per DESIGN.md trap 3/5/6
- [x] Node test covering the row maths (net, auction fallback for today, week total)
- [x] `bash scripts/build.sh` clean; existing suite green

## Review

**Shipped.** `scripts/test-daily-auction-column.mjs`, 28 assertions; full suite
3,396 assertions across 56 suites, green. `bash scripts/build.sh` clean, and every
class the column uses was confirmed present in the BUILT `dist/tailwind.css`, not the
stale committed one — `sm:grid-cols-[60px_1fr_auto_auto]`, `min-w-[64px]`, `text-[9px]`,
`text-[12.5px]`, `tracking-[0.05em]` all compile.

**Verified against production numbers.** Rendered the real BL1 week 34 (2026-08-16 → 22)
straight out of prod D1 through the shipped `buildWeeklyTable`, screenshotted in both
themes at 900px and at 390px:

| | |
|---|---|
| POS Σ | $55,582.99 |
| auction Σ | $2,868.51 |
| week total rendered | **$58,451.50** — rows sum to the total row, and the total now equals the hero above it |

Dupont over the same week (no auction anywhere) renders byte-identically to before:
three grid tracks, no caption, no dash column.

**Mutation-tested** — the suite was re-run against five deliberately broken versions and
caught all five: `rowAuction` ignoring `auctionRaw`; the day figure reverting to POS-only;
the column gate stuck open; the week total dropping auction; the reported-day count
ignoring auction-only days.

**Contrast, computed not eyeballed**, against the four real row grounds per theme (panel,
hover, today's `accent-green/5`, total-row wash):

| | light | dark |
|---|---|---|
| caption `inkDim` | 5.63 | 5.32 |
| value `ink` | 18.05 | 13.89 |
| violet swatch (decorative, needs 3.0) | 4.06 | 3.89 |

The first draft used `inkDimmer` for the empty-day dash, copied from the delta cell beside
it. That measures **2.88 light / 2.77 dark** — DESIGN.md trap 5 exactly. Changed to
`inkDim`, which is what the sales cell's own dash in the same row already uses.

### Two things left alone, deliberately

1. **The pre-existing mobile overlap.** At 390px the sales figure and its `vs $budget`
   collide — in the auction card AND in the untouched no-auction control, so it predates
   this change and lives in the middle column, not the new one. The Auction column is
   responsive precisely so it does not add to that: a column from `sm` up, a line under
   the bar below it. Worth its own fix.
2. **`getStoreMetrics.storeAuction`** (`index.html:7164`) reads `getTodayRow(...)?.aAuction`,
   the field `loadStoreFromD1` always nulls on today's row — so the hero's current-week
   auction chip reads $0 for today. Near-zero impact (the Drive feeder posts yesterday's
   auction at ~06:00, so today's is null anyway) and a separate surface. `rowAuction()`
   is the helper that fixes it when someone picks it up.

# L3 rules: name a bracketed row without touching which L2 it books to (2026-09-03)

Follow-up to #186. Measured chain-wide over the 13 weeks to 2026-09-02, all six stores,
546 snapshots (none missing, no per-day truncation): **$68,778.71 net in `Other / unmapped`,
2.63% of $2,619,990.88.** By the tier that decided the L2, from `fallbackItems` gross:

| tier | name shape | gross | items |
|---|---|---:|---:|
| `im` | has IM# | $31,712.24 | 199 |
| `override` | no IM# | $15,385.75 | 25 |
| `heuristic` | no IM# | $14,298.25 | 70 |
| everything else | | $566.75 | 7 |

#186 covers the `override` slice (add an L3 to the entry that already decided the L2).
It cannot reach the other 74% without one item override per product — 276 of them.

**Adding an L3 to pattern rules would have fixed $30.00.** Pattern rules are Tier 6.5, AFTER
`IM_TO_L2` (Tier 5) and after the heuristic ladder (Tier 6). Every one of the 27 IM clusters is
already in the built-in `IM_TO_L2` (14160 Hardlines, 14279 Seasonal, 50375 Home, 10385
Softline - Apparel, …), so those lines resolve as `l2Source: "im"` and never reach the pattern
matcher at all. That was my error in recommending it; this plan replaces it.

## The shape

Decouple naming the row from the tier that won the L2. A new `l3Rules` list in
`item-overrides:global` is consulted ONLY when `l3Key` would fold into `Other / unmapped`,
and ONLY where the rule's L3 belongs to the line's own resolved L2.

    l3Rules: [ { type: "id"|"name"|"im-number"|"prefix"|"contains", value, l3 } ]

Two guards make it unable to do harm:
- it can only REPLACE a synthetic bracketed label, never a real Clover L3, never a raw item
  name on Custom Sales / Refund;
- the L2 is already decided when it runs, and a rule whose L3 belongs elsewhere is skipped —
  so no rule can move a dollar between L2s, whatever an admin types.

One IM rule covers every product name sharing that IM number: 27 clusters span 178 names.

## Plan
- [x] `l3Rules` schema + `matchL3Rule` (first match wins, mirrors matchOverridePattern)
- [x] Rescue pass after the `l3Key` chain, before the fallbackItems capture, so a rescued item
      drops off the editor list on its own
- [x] Same pass in the cross-day refund mirror
- [x] `costL3` sees the rescued L3, so the row and its cost name one category
- [x] POST validation: type in the set, value non-empty, L3 must EXIST; the L2 match is a
      READ-time condition (a rule is not bound to one L2), and GET reports each rule's owning L2
      so a rule that can never fire is visible rather than silent
- [x] Settings: "Also add rule" column on the Other / unmapped table (IM number or prefix),
      and a list of existing rules with a remove checkbox
- [x] `scripts/test-l3-rules.mjs` driving the real routes
- [x] sw.js bump, npm test green, commit, push, draft PR stacked on #186

## Review

- **`worker.js`** — `matchL3Rule` walks `l3Rules` first-match-wins and returns an L3, refusing any
  rule whose L3 does not belong to the L2 already chosen. The rescue pass sits immediately after the
  `l3Key` if-chain and fires ONLY when `normalizeL3Key(l3Key) === L3_OTHER`, so a real Clover L3, a
  name-matched L3, an override that already named one, and the raw item name Custom Sales / Refund
  keep are all structurally out of reach. Placing it before the `fallbackItems` capture means a
  rescued item records its real `l3Key` and drops off the admin's list with no extra bookkeeping.
  Same call in the cross-day refund mirror; `costL3` reads `ovL3 || ruleL3 || l3 || l3CostKey`.
- **`extractImNumber`** — the IM regex pair was written out three times and a fourth was needed. One
  copy now, because two of the three were the aggregator and its refund mirror: the pair whose
  duplicated precedence ladder is what let the l3Map bug live 53 days.
- **Validation split, deliberately.** POST checks the type, a non-blank value, and that the L3
  EXISTS. It does NOT check the L2, because a rule is not bound to one — it applies to whatever line
  matches. Refusing at write time would be wrong; silence would be worse, so GET returns
  `l3RuleOwners` and the editor prints the firing L2 per rule, or "never fires" when the L3 does not
  resolve at all.
- **`index.html`** — an "Also add rule" checkbox on each Other / unmapped row, offering the item's IM
  number (or a numeric prefix), which turns one L3 pick into a rule covering every sibling name. New
  rules are UNSHIFTED, not pushed: first match wins, so a rule just written for a specific product
  should beat a broad one added earlier. Plus an "L3 rules" table showing evaluation order, the
  match, the named L3, the firing L2, and a remove checkbox.
- **Verification** — `scripts/test-l3-rules.mjs`, 34 assertions on the real routes. Blocks 1-2 pin
  the correction this PR exists for: an im-number PATTERN rule does NOT change these rows, because
  Tier 6.5 sits after IM_TO_L2. Blocks 5-8 pin the safety properties (real L3 untouched, no
  cross-L2 movement, Custom Sales untouched, item override wins). 15 assertions fail against the
  branch base. Full suite **3367 across 55 suites, all passing**. The page driven in Chromium over a
  stubbed API: both renders list the rules in order with their firing L2, flag an unresolvable L3 as
  "never fires", offer IM 14160 on the appliance row and nothing on a name without one, and Save
  posts the new rule first, drops the one ticked for removal, keeps the untouched one, and writes the
  same L3 onto the item override — 16 assertions, no page errors.
- `sw.js` v164 -> v165, shell-cache fixture refreshed.

### Found while building, not fixed here
- **The target categories exist for the top offenders**: `APPLIANCES - BL STORES`,
  `FG BL HOME - RUGS`, `FG BL HOME - BEDDING & PILLOWS`. Those three cover the $4,640 rug item,
  the $3,820 bedding item and the $8,455 IM 14160 appliance cluster.
- **`FG BL SOFTLINES - ACCESSORIES` has a live sibling spelled `Accesories`** in L3_TO_L2. All three
  Softline L2s carry only two categories each, so $24,195 of unmapped Softline can be filed but only
  into a bucket barely finer than its L2. That is a Clover catalog gap, not a code one.
- **No re-snapshot**, same reasoning as #186: rules apply to snapshots written after the change, and
  the 13-week window reaches past Clover's ~90-day retention.

# Item overrides can assign an L3, not just an L2 (2026-09-03)

Reported: "why is some product going to Other / unmapped beside the right L3", then
"I want to start getting these items into an L3 for better reporting".

`Other / unmapped` is a remainder: `normalizeL3Key` folds every bracketed L3 row into it, and the
bracket is chosen from `l2Source` — HOW a line resolved — not from what it resolved to. So an
override / IM / heuristic / pattern hit can never reach a real L3 row, however well the admin knows
which category it belongs to. `ov.items` maps item -> **L2 only**, so there is no place to say.

Measured on BL1 · Consumable HBA, 13 wk (2026-06-04 .. 09-02), from the 91 KV snapshots:
`Other / unmapped` = **$1,029.03 / 590 u = 2.76%** of the L2, in six rows —
`[Heuristic]` $753.47 (Hemp Oil Foot Mask, 50401 Nail Polish), `[IM 10398]` $121.89 (nicorette,
meds), `[IM 10394]` $100.00 (wheelchair), `[Override]` $55.64 (item named "PAIN"),
`[IM 50028]` $3.50 (dry shampoo), `[Cross-day refund source]` -$5.47.

Tier 0 runs before every other tier, so extending the per-item override to carry an L3 fixes all
five bracket sources with one mechanism — including the three items that have no Clover catalog
item id at all, since `name:` keys need no itemId.

## Plan
- [x] `items` entry accepts `{l2, l3}` beside the legacy bare `"<L2>"` string; one reader for both
- [x] One lookup helper for the id:/name: precedence, so the aggregator and its refund mirror
      cannot drift apart again (the l3Map bug's root cause, per test-l3map-precedence.mjs)
- [x] Tier 0 in `aggregateItemSales` carries the override L3 into `l3Key`
- [x] Cost lookup prefers the override L3, so the row and its cost name the same category
- [x] The cross-day refund mirror honours the override L3 too
- [x] POST validation: L3 must EXIST and must belong to the SAME L2 the override assigns —
      otherwise L3 rows stop being a partition of their L2
- [x] GET returns `l3Options` (L2 -> [L3]) so the UI cannot offer an invalid pair
- [x] Settings: render the unmapped items (the endpoint already returned them; nothing rendered them),
      with Assign L2 + a dependent Assign L3 select
- [x] `scripts/test-item-override-l3.mjs` driving the real routes
- [x] sw.js cache bump, npm test green, commit, push, draft PR

## Review

- **`worker.js`** — `readItemOverride` reads an `items` entry in either shape (bare `"<L2>"` string
  or `{l2, l3}`), returning null for both "absent" and "bogus L2" so callers fall through exactly as
  the old inline `VALID_L2.has(...)` guard did. `lookupItemOverride` is the single id:-then-name:
  ladder, replacing the two hand-written copies in `aggregateItemSales` and its cross-day refund
  mirror — the same duplication that let the l3Map precedence bug live. Tier 0 now carries `ovL3`
  into `l3Key` (`ovL3 || "[Override] " + l2`), into the cross-day refund `l3Key`, and into `costL3`
  ahead of the Clover L3 so a row is costed from the category it is filed under.
- **Write guard** — `itemOverrideL3Error` refuses an L3 that does not exist AND one that belongs to a
  different L2. The second is the one membership checking cannot catch, and is the same shape as the
  `FG BL SOFTLINES - APPAREL` incident: a perfectly valid L2, just the wrong one. Without it, L3 rows
  would stop being a partition of their L2. Items are validated against the l3Map the SAME request is
  writing, so an admin can add a category and file an item under it in one save.
- **`l3OptionsByL2`** is built through `resolveL3ToL2`, so a category the l3Map re-homes is offered
  under the L2 the engine actually books it to. The editor showing one answer while the engine used
  another is precisely what hid that incident for 53 days.
- **`unmapped` / `unmappedItems`** — `fallbackItems` snapshot records now carry their `l3Key`, and the
  endpoint asks `normalizeL3Key` whether the item really lands in `Other / unmapped` instead of
  re-deriving it from `source`. That re-derivation was already wrong for `name` (it resolves to a real
  L3 via `l3CostKey`) and would have gone wrong again for an override carrying an L3. Pre-`l3Key`
  snapshots fall back to "every source but name was bracketed", which is what was true when they were
  written. An item bracketed on ANY day in range stays listed.
- **`index.html`** — new "Items in Other / unmapped" table, fed by `unmappedItems`; the endpoint has
  returned this data all along and nothing rendered it. Each row pre-selects the L2 the engine already
  resolved (the L2 is not in doubt for these rows, only the L3, and re-picking it invites a typo into a
  bucket that is currently right) and offers a dependent L3 select filled from `l3Options[l2]`, so an
  invalid pair cannot be constructed. The same L3 column is added to the Custom Sales table. Save
  writes `{l2, l3}` only when an L3 is picked, so the stored map stays diffable.
- **Verification** — `scripts/test-item-override-l3.mjs`, 35 assertions through the real routes with KV
  seeded. Run against HEAD's `worker.js`, 11 of them fail; against this branch the full suite is
  **3299 assertions across 54 suites, all passing**. The page itself was driven in Chromium against a
  stubbed API: both renders (DESIGN.md §4.8 trap 8) produce the rows, pre-select the L2, fill and
  enable the dependent L3, offer no cross-L2 category, label the item with no Clover id, and emit
  `{l2, l3}` vs. a bare string correctly — 16 assertions, no page errors.
- `sw.js` CACHE_NAME v163 → v164 and the shell-cache fixture refreshed (index.html changed).

### Not done, deliberately
- **No re-snapshot.** Overrides only affect snapshots written after the change. Re-pulling the 13-week
  window to relabel $1,029 would re-fetch days at/past Clover's ~90-day order retention (2026-06-04 is
  91 days back), which is rule 1 in CLAUDE.md and three incidents in MEMORY.md. Fix forward.
- **Cross-day refund rows still bracket without an override.** Giving them the Clover L3 too would move
  existing refund dollars out of `Other / unmapped` onto real rows — a separate, money-moving change.
- **The three BL1 IM one-offs have no Clover item id** (`10398-2_5 nicorette lozenge`,
  `10394 general wheelchair`, `50028 dry shampoo`). They are reachable only by `name:` key, which this
  supports; a catalog item would be the durable fix.
- **The `name:pain` override at BL1 needs an L3 adding**, not removing — it is now the mechanism, not
  the obstacle.

# Price Scan: a barcode that no allowlisted retailer indexes gets a junk identity (2026-09-02)

Reported: "a few products I scanned showed no data". Four barcodes scanned 1–2 Sept were cached with
a Walmart employee-portal page title (one.walmart.com "own-your-wellbeing") or a bare part number as
the product name, so every rescan re-priced the junk and never re-identified.

## Plan
- [x] Block intranet subdomains (one., wlfc.) in RETAIL_HOST_BLOCK
- [x] retailIdentify: only a result that actually carries the barcode digits may name the product
- [x] retailIdentify: drop the raw-page-title fallback when the normaliser declines
- [x] GTIN check digit validated at both doors (worker isPlausibleBarcode, index.html psScan) for 12/13/14 digits
- [x] Tests for each, existing scan stubs updated to carry the barcode in the snippet
- [x] npm test green
- [x] Backup, then clean the five prod item_cache rows (confirmed by user)
- [x] Commit, push, draft PR

## Review
- `worker.js`: `RETAIL_HOST_BLOCK` now refuses `one.`/`wlfc.`/`corporate.`/`careers.`; `retailMentionsCode`
  drops any identify result that does not print the barcode (title, snippet or URL, spaced digits
  joined, digit boundaries both sides); `retailIdentify` returns null instead of a raw page title when
  the normaliser declines; `gtinCheckOk` (12/13/14 only — a UPC-E's check belongs to its expanded form)
  is folded into `isPlausibleBarcode`, the scan door says "one digit is wrong" rather than quoting
  lengths, and a photo whose read code fails the check falls back to the name read off the same photo.
- `index.html`: `psScan` runs the identical `gtinCheckOk` before the round trip.
- `scripts/test-price-scan.mjs`: nine fabricated test barcodes renamed to valid check digits; identify
  stubs now carry the code (as real product-database URLs and retailer snippets do); three new blocks
  pin the intranet page, the declined normaliser, and the check digit at both doors (worker/screen
  text asserted identical). Run against HEAD's worker the new blocks fail; against this branch 664 pass.
- `sw.js` CACHE_NAME v156 → v157 and the shell-cache fixture refreshed (index.html changed).
- Prod `item_cache`, after a JSON backup of all five rows: deleted 895697005724, 062338995038,
  019200780513 (junk), 032187618549 (junk); moved the RID-X row from 019200780511 (invalid check
  digit, a retype) to 019200780513 (its real barcode). Confirmed by the user in chat first.
- Not done: no deploy. The worker change ships when the PR merges and deploys as usual.

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

---

# Firecrawl: one ceiling for two very different waits

Firecrawl's debug console flagged a Sep 1 Walmart scrape that died on our `timeout: 20000`
and suggested a config block. **Five of its six parameters are already exactly what we
send** — `formats`, `onlyMainContent`, `maxAge`, `location`, and we additionally send
`proxy: "auto"`. The only real suggestion is `timeout: 20000 → 120000`.

## Why not 120000

`AbortSignal.timeout(FIRECRAWL_BUDGET_MS + 5000)` has to stay the OUTER deadline — a scrape
is billed whether or not we are still listening, so Firecrawl must give up first. 120s makes
our abort 125s, on two surfaces that cannot take it:

- **Price Scan** — a manager is stood there holding the barcode.
- **Manifest drain** — `credits: 10` a batch, cron every minute. Ten escalations × 125s is
  twenty minutes inside one request.

One ceiling is serving a person and a cron job, and 20s is right for exactly one of them.
`ctx.scan` already tells them apart.

## Plan

- [x] Split: **20s scan** (unchanged), **45s manifest drain**. 45s clears the whole observed
      band — successes top out at 25.6s — where 120s only buys a single 54.9s outlier that
      failed with a 500 anyway.
- [x] Fix the `maxAge` comment. It claims a cached hit "costs less"; Firecrawl's docs say
      the opposite in as many words: *"Cached results still cost 1 credit per page. Caching
      improves speed, not credit usage."* The parameter is right, the stated reason is not.
- [x] Tests: the two ceilings, and that the abort stays the outer one in both.

## The abort is NOT broken — I was wrong

I reported that `AbortSignal` was failing to bound four calls logged at 33–55s. It is not.
Those are from **2026-08-20 and 08-24**, and `firecrawlScrape` carried **no client-side
abort at all** until `9eae9db` on 08-31 (`timeout: 30000` was the only bound, server-side).
`dae39fe` then fixed the inverted pair on 09-01.

Today's calls confirm it works: max **25000ms exactly** — the abort firing at
`20000 + 5000` — and nothing over it.

This also narrows the case for the change. Most of the 26 logged failures predate the
current ceiling and had a different cause, so "31% of spend lost to the timeout" was wrong.
Under the current code the sample is 11 calls, 2 failures, **one** of them our own abort —
the job Firecrawl debugged. The split is still right, on a much smaller evidence base.

## Review — Firecrawl ceilings

**Landed.** 2,700 assertions across 51 suites, all green (2,696 before; +4).

Reverting `worker.js` alone fails six of them, including the pre-existing deadline test —
which is the one that mattered most here. It already capped our wait at 40s *"because a
manager is holding the item"*, so a blanket 45s would have broken the very constraint it
exists to defend. It now checks the relationship for **both** ceilings: structurally
(Firecrawl gets `budgetMs`, we abort at `budgetMs + transit`, so it cannot invert), the
scan still inside 40s, the drain longer than the scan but inside 60s.

That test is the reason the split is safe rather than a guess. Worth keeping in mind next
time a vendor console suggests a number.

---

# Price Scan → print a 1×1 shelf sticker

Managers scan an item, the page decides a price, and today somebody re-keys that into a
label tool. The sticker carries a QR of `BL-50008-2_5` — `BL-{category code}-{price, dot
as underscore}` — which associates scan at the Clover POS.

## The thing that makes this tractable

`BL-50008` is **nowhere in this repo**. It lives in Clover, as the `code` on real items —
and the worker already speaks to exactly the endpoints needed:

    /items?filter=code=BL-50008-2_5&limit=5     already used, as the dup check in
                                                `create-clover-item`
    /items?expand=categories&limit=1000&offset= already used, full inventory
    /categories?limit=1000                      already used
    POST ?action=create-clover-item             already exists: {code, priceCents, l2, l3}

So there is **no mapping table to invent and no list to maintain**. The category → numeric
code map is derivable by listing Clover items and parsing `^BL-(\d+)-` grouped by category,
and "does this exact code exist" is one live call we already know how to make.

## Decisions taken

- **Print path: ZPL first, browser fallback.** Zebra Browser Print where it is installed
  (native ZPL, QR at printer resolution, no dialog); `@page { size: 1in 1in }` HTML print
  everywhere else, so a phone still works.
- **Unknown code: refuse and say why.** Print only when an exact Clover item exists for
  that category and price. No snapping, no silent price change, nothing unscannable.

## Plan

- [x] `sticker-code` helper — `BL-{code}-{price}` with `.` → `_`. Pure, unit-testable.
      🛑 The price format is the whole contract: `$2.50` → `2_5`, not `2_50`. Confirm
      against real Clover codes before writing the formatter, not after.
- [x] Category → numeric code, derived from Clover inventory and cached in KV.
      Never hand-maintained.
- [x] `?action=sticker-check` — given category + price, return `{ code, exists }` from the
      `filter=code=` lookup. One call, cacheable.
- [x] Scan page: a Print button that is DISABLED until the check passes, and names the
      missing code when it does not. The existing `create-clover-item` is the escape hatch.
- [x] ZPL template + the CSS-print fallback, both from one label model.
- [x] Tests: code formatting incl. the `2_5` vs `2_50` trap, refusal when absent,
      fallback selection.

## Answered — the contract is settled

1. **Price encoding.** `$2.50` → `2_5`, `$2.75` → `2_75`, `$10.00` → `10`. So: two decimal
   places, strip trailing zeros, drop the separator entirely if nothing is left.
   🛑 A whole-dollar price therefore carries **no underscore at all** — `BL-50008-10`, a
   different shape from `BL-50008-2_5`. Anything parsing these has to accept both.
2. **The code is per CATEGORY**, not per store. One map, no store dimension.
3. **A category with no `BL-` code refuses**, same as a missing price point.

## Review — worker half landed

**2,745 assertions across 51 suites, all green** (2,723 before; +22).

Shipped: `stickerPriceCode` / `stickerCode`, the Clover-derived category map cached in KV,
and `?action=sticker-check`. **Not yet built: the UI button, the ZPL template and the
CSS-print fallback.** That is the next piece, not a thing quietly dropped.

### The suite caught a production 403

`test-business-gate` asserts every routed action is classified, and `sticker-check` was
not — an unclassified action **403s in prod**. Added to the `bl` bucket beside `merch-scan`.
Worth noting how cheap that catch was: the endpoint was otherwise complete and tested, and
would have failed on first use with an error naming nothing useful.

### Refusal is the tested behaviour, not a side effect

Four distinct refusals, each named and each pinned: no category, no price, no category
code, and **Clover unreachable**. That last one is the one worth defending — an unanswered
Clover is not permission to print. A test also asserts nothing in the handler snaps or
rounds a price to make a label scan.

### Still open

- **The UI + printing half.** Print button gated on `printable`, ZPL via Zebra Browser
  Print, `@page { size: 1in 1in }` fallback.
- **The category map is still unverified in bulk**, though the approach is now confirmed:
  Brian reports `50008` = `FG BL CONSUMABLES - FOOD - PANTRY`, which is an L3 key verbatim,
  so `codes[l3]` matches Clover's category name directly and the `merchLabel()` fallback is
  belt-and-braces. One live run confirms the other ~30.

  🛑 **`50008` ALSO EXISTS IN `IM_TO_L2`, AS "Softline - Apparel".** Two numbering schemes,
  both five digits starting 50, colliding on this value. `IM_TO_L2` is the IM# rung of the
  costing ladder and has nothing to do with stickers. Wiring the sticker to it — which is
  tempting, since it is already there and already numeric — would print a pantry price
  under an apparel code, and it would still scan. It would just ring up the wrong item.

  ⏸ I asserted earlier that `50008` was CHEMICALS. That was invented, not read: the Clorox
  manifest had chemicals in mind and I paired the two, then repeated it until it read as a
  finding. It was never data. The derived map is unaffected — it reads Clover rather than
  any pairing I might hold — which is the one reason the error cost nothing.

## Review — UI + printing

**2,765 assertions across 51 suites, all green** (2,750 before; +15).

Print button on the scan card, disabled until `sticker-check` confirms the code; every
refusal shown in words. ZPL built client-side and sent to Zebra Browser Print over
loopback — no SDK script, no CDN, because a loopback origin counts as trustworthy even
from an https page.

### 🛑 The CSS-print fallback was NOT built, and that is a decision, not an omission

The chosen design was "ZPL with a browser fallback". Building it surfaced the reason it
cannot be done as specified: **this repo contains no QR encoder**, and the browser cannot
draw one. A `@page { size: 1in 1in }` label would carry the code as text and no QR — which
does not scan, and therefore fails in front of a customer with nothing on it to explain
why. That is the precise failure the whole feature is built to prevent, so shipping it as
a "fallback" would have contradicted the design it was part of.

When Browser Print is absent the screen now says so and names what to install. Refusing is
consistent with everything else here: we refuse a code we cannot verify, so we refuse a
label we cannot make scan.

To actually have a fallback, one of these has to be chosen — it is a dependency decision,
not a coding one:

- **Vendor a small QR encoder** into `index.html` (~4 KB minified). The repo currently has
  zero app-JS dependencies, so this is a real change of posture.
- **Encode server-side** in the worker and return an SVG. One implementation, unit-testable
  against published vectors, no client dependency — but it is ~300 lines of Reed-Solomon
  and masking, and a subtly wrong QR still *looks* fine.
- **Leave it.** Browser Print is a one-time install per machine, and the ZPL path is the
  one that produces the crisp sticker in the photo anyway.

### ✅ The ZPL geometry is verified

`^PW203`/`^LL203` was laid out to match the photographed sticker at 203 dpi on the
assumption the printer was a 203 dpi unit. It is: Browser Print reports
`ZTC ZD410-203dpi ZPL`, so 203 dots is exactly one inch. A label printed, and **the QR
scanned at the register** — the magnification (`^BQN,2,4`) resolves at one inch.

## Review — 2026-09-02

Working end to end on BL1, every link verified against real hardware and real data:

| Step | Verified by |
|---|---|
| category → number | `50002` derived from live Clover, no hardcoded table |
| price → code | `1_5`, matching 240 live underscore codes in the catalogue |
| code exists | found in the swept catalogue |
| ZPL → printer | label came off the ZD410 |
| QR → POS | **scanned at the register** |

The feature was correct on its first deploy. Roughly two hours went into discovering that,
because every layer between the failure and the screen discarded what it knew — four in the
app and two in the deploy commands. `tasks/lessons.md` carries the full account; the short
version is that `if (!resp.ok) return null` is a bug unless the caller can ask why.

Three real bugs surfaced along the way, all now fixed:

- **Clover has no `code` filter.** It 400s every such request. That broke the sticker
  existence check (#165, replaced by a catalogue sweep) and, far worse, `create-clover-item`
  (#168), whose duplicate guard read the reply only `if (dupResp.ok)` and had therefore
  never blocked a duplicate in its life.
- **CORS preflight on `POST /write`.** `application/json` is not a safelisted content type,
  so the browser sent an `OPTIONS` Browser Print does not answer, and the POST died before
  it left the browser. `text/plain` fixed it (#166); the body is still JSON.
- **A 1500 ms probe deadline** that a cold agent could not meet (#167).
- **An empty printer list read as a fact.** Reported from the floor after a clean merge and
  hard reload, with the probe byte-for-byte the build that had printed an hour earlier — so
  nothing had regressed. A single `{"printer":[]}` was taken as settled and named the printer
  as the cause. Now the probe asks twice, sends `cache: 'no-store'` so one empty answer
  cannot outlive the printer coming back, offers a device the agent lists but gives no uid
  rather than discarding it, and quotes what was counted instead of asserting a cause.
  This is MEMORY.md rule 4 reaching us from a second vendor.

### Still open

- **Whether the ZD410 was genuinely asleep** on the report above, or whether the agent was
  mid-enumeration. The retry and the new counts settle it on the next occurrence; until one
  happens, the cause is unproven and the fix is a fix for both.
- **`BL-10389-3_50`** — one item in Clover keeps a trailing zero where all 240 other
  underscore codes drop it. A $3.50 item in that category will refuse to print until that
  item is renamed. A data fix, not a code one; teaching the encoder two spellings of one
  price would be worse.
- **Only BL1 has been exercised.** The map is derived per store, so the others should work,
  but nothing has proven it.
- **Multi-label registration.** `^MNN` declares continuous media. If the 1x1 stock is
  die-cut with gaps, `^MNY` is correct and labels will otherwise creep out of position.
  One character, waiting on evidence rather than a guess.
- **Whether duplicates already exist in Clover** from the years the guard did nothing. A
  read-only scan would count items sharing a `code`; nobody has run it.


---

## Reprint becomes a tab, not a panel under the scan

> "add the reprint as a new tab on the page not the button"

The reprint history was a block hanging under `#ps-result`, appearing only once something
had been printed. A tab makes it a place you can go, which is what it was always for: a
peeled label means the item is already on the shelf, so reprinting is the case where you
have nothing to scan.

### Plan

- [x] Extend `.pr-tab` (Merch Products, next door) rather than invent a tab look. Same
      green, same shape; `.ps-lbl`'s 11px/.09em type, because it sits in `#ps-bar` beside it.
- [x] `#ps-tabs` toggled by `style.display`, never the `hidden` class — `#ps-tabs{display:flex}`
      is an ID selector and `.hidden` is one class, so `hidden` loses on specificity. This
      file already shipped that exact bug once on `.ps-row`.
- [x] `psApplyTab()` is the single authority for what the body shows, and it defers entirely
      while furniture mode is open. Two writers on one element is how the barcode controls
      stayed on screen last time.
- [x] Switching to Reprint calls `psStopScan()` — a camera left running behind a hidden
      panel is a battery and privacy problem, not a cosmetic one.
- [x] Empty state on the tab. A tab you can click that renders nothing reads as broken.
- [x] The tab is hidden for anyone `psCanOverride()` is false for, which is exactly who
      `psRecentLoad()` already refused to load for. Same gate, no widening.
- [x] Contrast computed against the real `#ps-bar` background in both themes.

### Still open

- **The reprint history is gated on `psCanOverride()`** — superuser/admin, the *price
  override* right. That is not obviously the right gate for "show me what I printed": the
  people printing shelf stickers are largely not admins, and `sticker-history` itself is
  only business-level on the worker. Left exactly as found, because widening who can see
  print history is a permissions decision, not a layout one.


---

## The reprint row, as photographed

> "fix the ui misalignment and add what the product name was and our price"

The tab shipped with the row broken, and the screenshot showed it: the code wrapped down a
three-character column while the Reprint button spanned the panel.

**`.ps-btn` is `width:100%`.** It is built for the full-width "Scan" and "Look it up"
buttons. Dropped into a flex row it demanded the whole width, `.ps-recent-main` collapsed,
and `.ps-recent-title` — which is `white-space:nowrap` — was clipped to nothing. The product
name looked absent. It was squeezed. The text that appeared to wrap was the sub-line, which
has no `nowrap`; that is the tell.

- [x] `.ps-recent-row .ps-btn{width:auto;flex:none}` — a button in a row sizes to its label.
- [x] `.ps-recent-row:first-child{border-top:none}` — with the heading gone, the first rule
      was a line under nothing. That is the stray line at the top of the screenshot.
- [x] Product name is the row's title, falling back to the category tail rather than
      repeating the code that is already in the sub-line.
- [x] Our price, right-aligned in tabular figures. `sticker-history` has returned `price`
      since the table was created and nothing ever drew it.
- [x] Formatted with the page-wide `psMoney`, not a second formatter. The first attempt
      declared one and the syntax check caught the collision — `psMoney` already existed.

### Still open

- [x] **The gate — decided and done.** The ask only bit if printing itself moved, because
  `sticker-check` was on the same `requireAdminAccess` as the history. Brian chose
  `canSeeFinancials`: superuser, admin, executive, manager, never staff — the gate
  `merch-scan` already requires to reach the screen at all. Applied to all three sticker
  actions and to the three front-end call sites, under a new `psCanPrint` so it can never
  again be confused with `psCanOverride`, which did not move.


---

## Sticker template editor (Admin Tools)

An admin surface for what the shelf sticker prints and where: font, size and position for each
text field, position and magnification for the QR, the corner `$` off or replaced with text,
and an optional street-price line.

- [x] Worker owns the model and the validation. A browser-side check guards a stale tab from
      nothing; the endpoint is what a replayed request or a curl reaches.
- [x] **A null template emits the old bytes exactly.** Pinned on three codes. Shipping this
      must not move a dot on any shelf until someone deliberately moves one.
- [x] The QR cannot be switched off and cannot go below magnification 4 — refused outright,
      not clamped. It is the only part of the label the register reads.
- [x] Coordinates and sizes clamp instead of failing a save; a slider that overshoots is not
      worth losing a layout over.
- [x] `^` and `~` stripped in both directions. An injected `^XZ` would otherwise end the label.
- [x] `migration-057.sql` adds `retail_cents`, so a reprint draws the same street price the
      original had rather than silently dropping the field.
- [x] Null street price draws **nothing** — not `$0.00`, not a dash. "No street price found"
      is a real scan outcome and every pre-migration row has none.
- [x] Live SVG preview at true 203-dot scale, labelled an approximation, with **Print test
      label** for ground truth. The preview samples the worst realistic case, not the prettiest.
- [x] Editing is superuser (it changes every label the chain prints); reading the template is
      the print gate, because everyone who prints needs it.

- [x] `migration-057.sql` applied to staging and production, verified each: column present,
      nullable, 5 existing prod rows intact, manifests and users untouched.
- [x] The panel names its faults. It shipped reporting a bare "Forbidden" for
      `UNCLASSIFIED_ACTION`, which means the WORKER IS BEHIND, not that anyone lacks a right.

### Still open
- **Deploy order is migration → worker → front end**, which is stricter than usual because the
  worker writes a column that does not exist yet.
- **The preview's width estimate is `chars × w × 0.6`.** Close enough to catch an overflow, not
  close enough to trust. Only a test label settles a tight layout.
- Image logos, per-store templates, saved presets and label sizes other than 1×1 in are all
  out of scope and none is needed for what was asked.


---

## Image corner mark + named templates

The corner slot takes a bitmap as well as text, the image is replaceable from Admin Tools,
and templates are now named and saved in multiples with one in use.

- [x] `^GFA` inline, packed in the browser (it has a canvas; the printer does not) and
      **validated on the worker**, which re-derives bytes-per-row and total from the declared
      geometry. A payload shorter than the count `^GFA` declares does not misdraw — it makes
      the printer wait for bytes that never arrive and the label stops.
- [x] The mark is one slot with two fillings — `mode: text | image` — not two overlapping
      fields that could both be set.
- [x] Image mode with no stored image draws **nothing**, and does not fall back to the `$`.
      The image lives on its own key and can be removed while a template still asks for it.
- [x] Threshold slider, because ZPL is one bit: there is no grey, so the cut *is* the
      rendering. The preview unpacks the stored hex rather than re-rasterising the source,
      so it shows what will actually print.
- [x] One image shared by every template — the corner slot is the same slot on all of them.
- [x] Named templates, capped at 10, one active. Deleting the active one falls back to
      another, or to the stock label.
- [x] **The legacy `sticker:template` key is still read** and carried across as a named item,
      so a layout saved before today is not silently discarded.
- [x] A null template still emits the old bytes exactly — pinned, unchanged.

### Still open

- [x] ~~Nothing is deployed.~~ **Shipped.** Worker deployed, front end merged as `553323c`,
      and confirmed working on the floor with Round 4's fixes on top.
- **The `$` badge is 74x74 = 740 bytes**, well under the 1,600-byte cap. A larger or wider
  mark is allowed up to 110x110 or 150x80.
- **Only the corner slot takes an image.** The banner layout was mocked and rejected: a
  circular badge does not stretch, and giving the top 50 dots to it pushes the price into
  the QR.

## Round 4 — the four bugs behind "the template isn't saving"

Reported: *"The template isn't saving and test printing isn't working. also allow the qr
code to be size 3"*. The worker validator was **not** the problem — it accepted the exact
on-screen template. Four separate faults, found by running the editor rather than reading it:

- [x] **`stSet` redrew the whole panel on every keystroke.** `stDraw` assigns
      `#st-fields.innerHTML`, destroying the focused input — typing `113` landed a `1`.
      Now only `mode` (which changes *which* controls exist) redraws; everything else
      refreshes the preview. `stCutSet` had the same fault: the threshold slider was
      replaced mid-drag. Its reading updates in place now.
- [x] **"Save as new" swapped the screen to the wrong template.** The editor resolved which
      row it had written from `active`, and a new template is not necessarily active. The
      worker now returns `savedId`; there is nothing left to infer.
- [x] **`^GFA` shipped without its `^FS`.** The graphic field never closed, so an image
      corner mark never printed — while a text mark printed perfectly beside it.
- [x] **`stickerText`'s `.trim()` ate the retail prefix's separator**, printing
      `Compare at$29.99`. Whitespace now collapses to single spaces but is never removed
      from the ends.
- [x] **QR magnification 3 is allowed**, worker and editor both (they are two independent
      floors; a `min="4"` input refuses 3 before any request is made). 2 is still refused.
      The editor states on screen that 3 is **not** the size proven at a register.

### Verified

- 3,185 assertions across 53 suites, all passing.
- Eight mutations applied and reverted one at a time — each fix reverted, each caught by a
  named failure, including the editor's own `min="3"`.
- The editor is now driven end to end in the suite: typing character by character, saving a
  first template, saving a second while the first is in use, and printing a test label.
- Contrast recomputed against the real panel backgrounds: `#8a5a00` on `#ffffff` = 5.93:1,
  `#f0b849` on `#101826` = 9.87:1.

### Shipped and confirmed

Worker deployed, front end merged as `553323c` (cache key `v160`). Reported working after a
hard reload: typing lands whole numbers, "Save as new" keeps the new template on screen, and
an image-mode corner mark prints — which is the `^FS` fix confirmed on real hardware, the one
thing no test here can prove.

### Still open

- **Magnification 3 has still never been read by a register.** The code allows it and the
  editor warns about it; nobody has held a mag-3 label under a scanner at a till. That is a
  physical check, and it is not covered by "everything is working" — the default is 4 and
  nothing has moved off it. Do it before any store commits a roll to 3.

## Round 5 — the printed code line can be just the number

Asked for: *"on the sticker I don't want it to print out BL-50008-2_50, we only need the
50008 number."* Chosen as a **template option**, not a hardcoded change, so it is reversible
without a deploy and one store can keep the long form if it ever wants it.

- [x] `code.show` — `"full"` (today's `BL-50008-2_5`) or `"number"` (`50008`). Default stays
      **full**, so no shelf changes until somebody picks it in the editor.
- [x] **The number was already there.** `sticker-check` has returned `category_code`
      alongside `code` all along; it was simply unused. Nothing parses the formatted string.
- [x] **The QR is never shortened.** Both the print and reprint paths keep sending the whole
      key to `^BQ`; only the human-readable `^FO10,116` line changes.
- [x] **A missing number falls back to the full code** — never an empty field, never the
      string `undefined`. A caller that has not been updated still prints something usable.
- [x] Editor gets a **Show** select on the Sticker code row, offering exactly the two values
      the worker will store; the preview and the test label both honour it.

### Why not split the string on its dashes

The price segment has three shapes, confirmed against real codes: `2_5` (trailing zero
dropped), `2_75`, and **`10` with no separator at all** for a round dollar amount. A regex
over the tail works until someone prices something at $10.00 — and that discovery happens on
a shelf. The number is handed over as a value instead.

### Verified

- 3,211 assertions across 53 suites.
- Seven mutations, each reverted one at a time and each caught by a named failure —
  including shortening the **QR itself**, which is the one that would still look right on
  the label and stop scanning at a till.
- Three older assertions were pinning the exact source text of the `psZpl(...)` calls, so
  wrapping one argument broke them. Rewritten to match a whitespace-flattened copy: the
  assertion is about which arguments are passed, not how they are laid out.

### Still open

- **Nobody has scanned a magnification-3 label at a till** (carried from Round 4). Unrelated
  to this change; the default is still 4.

## Round 6 — the Show select stored NaN

Reported: *"set it to number only, the preview isn't changing and then when I hit save changes
it reverts back."* One line, both symptoms.

- [x] `stSet` whitelisted the STRING properties and fell through to `Number()`, so `show`
      became `Number('number')` = **NaN**. NaN fails every `===` in the preview, JSON-encodes
      to `null`, the worker refuses `null` and substitutes the default, and the editor adopts
      the response — so the select snapped back. No error at any step.
- [x] Inverted it: `ST_NUMERIC = {x, y, h, w, mag}` is the **closed** set, and everything else
      is left as the string it already is. Adding a control no longer requires remembering.
- [x] New guard **derives** the control list from the rendered HTML and round-trips every one,
      asserting the stored type with `Object.is` (NaN is a number, so a looser check passes on
      the bug). It cannot go stale — a new control adds its own case.

### Verified

- 3,216 assertions across 53 suites.
- Three mutations, each caught by name: the original bug restored, a numeric property dropped
  from the set, and everything treated as a string. Each failure names the field and value.

## Round 7 — the preview drew text 28% short

Reported: *"what it prints doesn't match the preview, the placement doesn't match."* Three
defects in `stPreview`, all making the drawn glyphs disagree with the box drawn around them
and with the printer:

- [x] **SVG `font-size` is the EM size**; a digit's cap is ~0.72 of it. ZPL's `^A0N,h,w`
      makes `h` the CHARACTER height. `font-size="${h}"` drew every field ~28% short — 15
      dots on the price, 21 on the corner mark, on a 203-dot label. Position was right and
      size was not, which is exactly what reads as "it doesn't match".
- [x] **The advance came from `h`, the box from `w`.** The dashed rect is `len * w * 0.6`
      (correct — `w` is the ZPL width parameter) but the text's advance followed font-size,
      i.e. `h`. Identical while `h === w`, which is true of every default and false the
      moment anyone changes one, so it never showed.
- [x] **No `textLength`**, so the browser's own monospace decided the width — SF Mono on a
      Mac, Consolas on Windows. The same template previewed differently per machine.

Fixed by scaling font-size by the cap ratio, dropping the baseline a full `h` (so the cap
band lands exactly on `f.y .. f.y+h`), and pinning the advance with
`textLength` + `lengthAdjust="spacingAndGlyphs"`.

The caption no longer says a flat "Approximate": **positions and heights are exact** — they
are the same dots the printer is given — and **widths remain an estimate**, because the
printer's font is proportional and the preview's is not.

### Verified

- 3,223 assertions across 53 suites.
- Three mutations, each caught by name, plus a control edit that correctly does not fail.
- The definedness sweep now covers `ST_` constants as well as `st*` helpers — `ST_CAP` was
  invisible to a regex that only matched called functions, and a missing constant throws
  exactly like a missing function.

### And a second one the photo turned up

- [x] **`^GF` has no scale parameter.** It draws the bitmap at the size it was *packed* at
      and ignores the field's width and height entirely — so the preview scaling the image
      into `mk.w x mk.h` was drawing a size the printer will never produce. Change the mark's
      W/H after saving an image and the two diverge silently.
- [x] **The printed width is the PADDED width.** A row is whole bytes, so a 74-dot image
      occupies `ceil(74/8)*8 = 80`. The spare columns are blank so it *looks* like 74, but 80
      is what has to fit on the label — the overflow check was under-reporting by up to 7 dots.
- [x] The preview now draws the mark at its true printed footprint, and says so when the
      field's W/H disagree with the stored image (they move it; they cannot resize it —
      re-choosing the image re-packs it).

### Still open

- Nobody has scanned a magnification-3 label at a till (carried).
