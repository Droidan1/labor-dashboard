# Why Retail + BIN don't reconcile to Net — investigation, 2026-08-10

Measured against production: D1 `daily_sales` and the KV `items:` snapshots for
**2026-08-09**, stores BL1 / BL2 / BL4. No code changed.

## Short answer

There are **two independent pipelines** computing "retail" and "bin" from the
same Clover orders, with different rules, and the store card renders a mix of
both. The dollars come from one; the metric tiles come from the other.

| | `aggregateSales` → D1 `daily_sales` | `aggregateItemSales` → KV `channels` |
|---|---|---|
| feeds | the **Retail / BIN / Auction dollars** | the **Cart / Items / Orders / ASP tiles** |
| "bin" means | item **NAME** matches `/\bbin\b/`, `fill a bag`, `glass case`, `ikea bag` | item **L2 category** `=== 'Bin Products'` |
| method | order net allocated **proportionally** by gross share | line items summed directly |
| refunds | included | **excluded** ("positive lines only") |
| non-item revenue | included (spread across both) | **dropped** |
| an order with both | split by value | counted in **both** order counts |

## ⚠️ Correction — the tiles DO NOT tie on the LIVE (today) card

A manager's 9:55 pm screenshot, 2026-08-09:

    BL1  retail 6,002.35 + bin 4,448.00 + auction 0.00 = 10,450.35   Net 10,442.34   GAP +8.01
    BL4  retail 2,400.25 + bin 2,264.35 + auction 0.00 =  4,664.60   Net  4,642.13   GAP +22.47

My first pass measured **stored** days and concluded the tiles tie by
construction. That holds only for the stored path. **The live path has no such
construction** — see below. The bug is live-only and repairs itself overnight,
which is exactly why yesterday's data looked clean.

### Root cause: Net and the channel tiles are computed by two different programs

| | Net ("TODAY'S NET") | Retail / BIN tiles |
|---|---|---|
| computed by | **the browser**, `fetchLiveCloverSales` in index.html | **the worker**, `aggregateItemSales` |
| from | raw `elements[]` re-aggregated client-side | line items, classified by L2 category |
| order gross | `order.total` | `payment.amount` |
| refunds | `totalNet -= refundCents` (cross-day only) | attributed per line item |

`binNet + retailNet` is the sum of **every** category's netSales (retail =
everything that isn't `Bin Products`), i.e. the item pipeline's own total. Net
is an independent re-derivation of the same quantity. Two programs, one
question, two answers.

The specific divergence that guarantees they differ: Clover **reduces
`order.total` for same-day refunds but leaves `payment.amount` intact.** The
worker was fixed for this ("Phase 2G", `pmtSumCents > 0 ? pmtSumCents :
order.total`). **The client was never fixed** — index.html still does
`const totalCents = order.total;` — so it takes the already-reduced figure and
then subtracts refunds again.

🔑 And the consistency step exists **only in the dead branch**:

```js
if (typeof data?.binNet === 'number' && ...) {
  binDollars    = data.binNet;      // preferred path — refunds NOT reconciled
  retailDollars = data.retailNet;
} else {
  // "keep the proportional refund subtraction the old code did,
  //  just to keep totals consistent"     ← only the FALLBACK does this
```

The comment says the subtraction is what keeps the totals consistent. It was
kept in the fallback and omitted from the branch that now always runs.

### Why it heals by morning

The nightly job (`fetchAggregateAndSnapshot`) adopts retail, bin **and total**
from the item pipeline via `binRetailOverride`, so all three come from one
source and the stored row ties. Verified — `sales:bl1:2026-08-09`, written
2026-08-10T03:56Z: total 10,442.86, retail 5,994.86, bin 4,448.00, gap **0.00**
(`totalBeforeRefunds` 10,480.35 − `refundsSubtracted` 37.49).

So: **wrong all day on the live card, correct by morning.** A manager watching
during the day sees numbers that never add up; anyone checking the next day
sees nothing wrong. That is why this has survived.

## On a STORED day, the three tiles do tie

    BL1  5,994.86 + 4,448.00 + 151.00 (auction) = 10,593.86 = Net  ✓
    BL2  3,615.88 + 2,529.00 +    0.00          =  6,144.88  ✓
    BL4  2,379.25 + 2,264.35 +    0.00          =  4,643.60  ✓

And it can never fail to, by construction — `aggregateSales` computes the
order's net first, then splits *that*:

```js
binNet    += adjustedOrderNet * (binItemTotal    / itemGross);
retailNet += adjustedOrderNet * (retailItemTotal / itemGross);
```

Retail + Bin ≡ Total identically. On BL1 the $151 that looks "missing" from
Retail + BIN is **Auction**, sitting in the third tile.

## Defect 1 — the four metric tiles do not share a denominator

🔑 **This is the one that makes the card look wrong.**

`ORDERS` is **every** order. `CART`, `ITEMS` and `ASP` are **retail-only** —
`aggregateSales` deliberately excludes bin-only orders from the cart average,
and `avgASP = retailNet / retailItemCount`.

So the tiles describe two different populations, and multiplying them is
meaningless:

| | CART | ORDERS shown | orders CART actually used | CART × ORDERS | Net |
|---|---|---|---|---|---|
| BL1 | $26.34 | 429 | **~228** | $11,301.68 | $10,442.86 |
| BL2 | $25.28 | 301 | **~143** | $7,608.14 | $6,144.88 |
| BL4 | $22.89 | 201 | **~104** | $4,601.32 | $4,643.60 |

`retail net ÷ CART` recovers ~228 / ~143 / ~104 — almost exactly the
`channels.retail.orders` of **229 / 148 / 105**. The cart average is over
retail orders; the tile beside it reports all orders.

## Defect 2 — the channel split drops two pieces of revenue

The filter's numbers reconcile to Net **only** once you add back what the item
pipeline never routes to a channel. Exact, all three stores:

    channels.retail + channels.bin + "Other / Non-Item" + refunds == Net

    BL1  10,402.39 + 77.96 + (−37.49)  = 10,442.86  ✓
    BL2   6,269.63 +  0.25 + (−125.00) =  6,144.88  ✓
    BL4   4,651.60 + 13.00 + (−21.00)  =  4,643.60  ✓

1. **Refunds are never applied to `_ch`.** Categories get them via
   `applyRefundsToAggregate`; the channel accumulator does not.
2. **`Other / Non-Item` never reaches a channel.** Custom-amount sales with no
   line items, service charges and line-item modifications are reconciled into
   the category table so the grand total ties — then `_ch`, built from line
   items only, silently omits them.

Note the sign flip: BL1 is $40 **under**, BL2 is $125 **over**. Whichever of the
two dominates that day decides the direction, so this cannot be eyeballed.

## Defect 3 — mixed baskets are counted in both channels

```js
for (const k of ['retail', 'bin']) {
  if (_ordCh[k].units > 0) { _ch[k].orders++; ... }
}
```

A basket with a bin item *and* a retail item increments **both** counters.
Orders with no classifiable line items increment **neither**.

| | total orders | retail + bin | over/under |
|---|---|---|---|
| BL1 | 432 | 229 + 213 = 442 | **+10** |
| BL4 | 203 | 105 + 115 = 220 | **+17** |
| BL2 | 302 | 148 + 153 = 301 | **−1** |

So tapping Retail then BIN and adding the order counts overshoots by ~2–8%.

## Defect 4 — two definitions of "bin", agreeing by luck

`isBinItem()` (name regex) vs `l2 === 'Bin Products'` (category). Nothing keeps
them in step. On 2026-08-09 they produced **identical** bin dollars at all three
stores — which is exactly what makes this dangerous: it looks settled, and the
first item whose name and category disagree moves the number in one pipeline
only. Related: [[sku-book-items]], where category assignment is already known to
be many-to-many and order-dependent.

## Proposed fix — smallest first

### Phase 0 — make the live card tie (fixes what the manager saw)

`binNet + retailNet` **is** the item pipeline's total, and it is the same number
the nightly job stores as `daily_sales.total`. So derive the live Net from it
instead of from the browser's own re-aggregation:

```js
const totalDollars = (worker returned binNet/retailNet)
  ? data.binNet + data.retailNet          // one source for all three tiles
  : totalNet / 100;                       // unchanged fallback
```

One expression. It makes the live card tie **and** makes the number shown during
the day equal the number stored overnight — killing the silent "it changed by
morning" drift as well. Net moves by the size of the gap (BL1 +$8.01,
BL4 +$22.47 at that moment), i.e. it becomes the figure the books already use.

**BUILT 2026-08-10.** `index.html` only — no worker change, no schema change.
`totalDollars` moved inside the branches; the preferred branch now derives it
from `binDollars + retailDollars`, the fallback keeps `totalNet / 100` (it
already reconciled its own split via the proportional subtraction).

`scripts/test-live-sales-reconcile.mjs` — **12 assertions**. No DOM harness
exists here, so it extracts `fetchLiveCloverSales` from `index.html` and runs
**the real function body**, stubbing only the network. Weaker than driving the
page (it cannot see that `renderCards` calls it) but not a restatement either —
the arithmetic under test is the shipped arithmetic.

Mutation-checked: restoring `totalDollars = totalNet / 100` reproduces the
manager's defect exactly — *"total 80 vs retail 50 + bin 40 = 90"*, a $10 gap
from the same-day refund counted twice, the same shape as BL1's $8.01.

⚠️ **The first draft of that test passed while asserting nothing.** The fixture
used `createdTime: 1000`, which is before local midnight, so the aggregation
loop skipped the order and every assertion ran against zeroes. Fixed by
timestamping the fixture inside today **and** adding two guards that make a
vacuous run impossible: `orderCount === 1`, and a case proving the client's own
re-aggregation genuinely disagrees with the worker split (80 ≠ 90) — if it ever
agrees, the fixture is not exercising the bug and the suite says so.

Full suite: 23 suites green. `sw.js` v69 → v70.

Not verified yet: the live card in a browser. Needs the frontend deployed, and
a live trading day to show a non-zero gap.

### Phase 1 — delete the duplicate aggregator — DONE 2026-08-10

**−108 lines from `index.html`.** The worker now aggregates once and returns a
finished `aggregate`; `fetchLiveCloverSales` renders it and computes nothing.

- Worker: `aggregateOrders` + `applyRefundsToAggregate` hoisted out of the
  snapshot-only block and returned. The item-pipeline split still wins on
  bin/retail, and `total` is derived from it (Phase 0), so the three can never
  disagree — now guarded on a non-zero split, since a failed item aggregation
  previously overwrote a good name-based split with zeroes.
- The **same object** is what gets snapshotted, so the stored `sales:` snapshot
  and the screen cannot drift. Previously the snapshot recomputed and stored a
  total that did not equal its own retail + bin.
- Client: `data.elements` and `refundCents` are no longer read by anything.
- 🔑 **The client's bin classifier is gone.** `BIN_PATTERNS` / `isBinItem` and
  `MAX_TXN_DURATION_MS` became unreachable and were removed — verified
  definition-only before deleting. That is the "one bin classifier" goal from
  Phase 3, achieved for the browser as a by-product. The worker still keeps its
  primary + fallback pair, correctly (see Phase 3).

`scripts/test-live-sales-reconcile.mjs` rewritten — **24 assertions**. The
reconciliation invariant moved to where the arithmetic now lives: driven through
`worker.fetch` with Clover stubbed. The client half asserts it stays a
pass-through — no order loop, no bin classification, no refund handling, no
`data.elements` — so a re-introduced aggregator fails the build.

Mutation-checked: drop the total derivation (3 failures, reproducing the
original defect exactly — *total 100 vs retail 54 + bin 36*), stop returning
`aggregate` (5 failures), let the client fabricate zeroes when `aggregate` is
absent (1 failure).

⚠️ **`elements` is still returned but nothing reads it.** Dropping it would cut
this response substantially — it carries every order of the day, with line
items, per store, on every dashboard load. Left in because the `?store=` route
may have consumers outside this repo; removing it is a deliberate follow-up, not
a silent one.

### Phase 2 — make the metric tiles honest — BUILT 2026-08-10

Brian's spec: **no selection → combined retail + bin; tap Retail → retail only;
tap BIN → bin only.** One population at a time, default is the honest combined
figure. All four tiles now come from the channel pipeline in every state, so
they always share a denominator.

- `_ch.mixed` counts orders holding BOTH retail and bin items. They sit in each
  channel's order total, so combined orders = `retail.orders + bin.orders −
  mixed`. Without it the divisor is too big and cart/items read low.
- The live `?store=` endpoint now returns `channels` — `aggregateItemSales`
  already computed it there, so **today costs no extra request**. Past ranges
  cost one `channel-range` per store.
- `mixed` added to the `items` snapshot payload and to `channel-range`.

⚠️ ~~Past days read slightly high until snapshots are rewritten.~~ **FIXED
2026-08-10 without a backfill** — see below.

#### Historical days: `combinedOrders`, resolved per day at the source

Seen live on the Yesterday view: BL1 read **442** combined orders against a true
**432**, dragging CART to $23.53 instead of $24.08. Cause: that snapshot
predates `mixed`, so it read 0 and combined became the naive sum.

The snapshots already carry `orderCount`, so no rewrite of stored history is
needed. `channel-range` now resolves the count **per day** and returns
`combinedOrders`:

- `mixed` recorded → `retail.orders + bin.orders − mixed` (exact).
- otherwise → that day's `orderCount`, **clamped** into
  `[max(retail, bin), retail + bin]`.
- neither → the naive sum, as before.

🔑 **Per day, not per range.** A range can span both snapshot generations; one
blended subtraction at the end would undercount the older days.

🔑 **The clamp is load-bearing, and measurement is why.** `orderCount` counts
*every* order, including ones with no classifiable line item — so it can
**exceed** both channel counts summed. Measured on BL2 2026-08-09: orderCount
302 vs retail+bin 301. Used raw it would inflate the divisor past what the
channels can contain. Verified against 7 real store-days; the clamp reproduces
the independently-measured overlaps (+10 BL1, +17 BL4).

`daysEstimated` is returned alongside, so it is visible how much of a range is
still on the estimate. It shrinks to 0 as snapshots are rewritten by the nightly
job. A deliberate backfill remains optional, not required.

🛑 **Coverage gap, measured:** deleting the `_ch.mixed++` increment leaves the
whole suite green — every fixture supplies `mixed` pre-computed and nothing runs
`aggregateItemSales`. Covered instead by the real-data check below.

### Phase 2 — original options (superseded by the spec above)

Requires **a business decision** (below), then it is a small change confined to
the tile group. Two coherent options; today's card is neither.

- **(a) All-channel.** CART/ITEMS/ASP become blended over all orders. Every tile
  then shares the ORDERS denominator, and CART × ORDERS ≈ Net. BL1's CART moves
  $26.34 → ~$24.34.
- **(b) Retail-only.** Keep today's CART/ITEMS/ASP and change ORDERS to the
  retail order count (~228 for BL1). Preserves the deliberate 2025 decision to
  exclude bin from avg cart, and matches what the Retail filter shows.

### Phase 2 — make the channel split reconcile

- Apply refunds to `_ch` the way categories already get them.
- Allocate the `Other / Non-Item` residual across channels proportionally by
  channel gross — the same proportional split `aggregateSales` already uses.
- Then `channels.retail + channels.bin == totals.netSales` exactly, and the
  filter ties to the tiles above it.

### Phase 3 — stop it recurring — DONE 2026-08-10 (with one premise corrected)

**`scripts/test-channel-invariants.mjs` — 19 assertions.** Drives
`worker.fetch` on `?action=items` with **Clover's HTTP responses stubbed** —
the platform, not the code — so it reaches the real `aggregateItemSales`.
Fixture covers every shape that has broken this: retail-only, bin-only, two
mixed baskets, a service-charge residual with no line item, and a refund.

🔑 **This closes the gap `test-channel-range.mjs` could not reach.** Deleting
`_ch.mixed++` leaves that suite green; here it fails 4 assertions. Mutation-
checked three ways:

| Mutation | Result |
|---|---|
| delete the `mixed` counter | 4 failures |
| `&&` → `\|\|` in the mixed condition | 4 failures |
| residual routed nowhere | 2 failures |

⚠️ **The identity `channels + residual + refunds == netSales` alone did NOT
catch the residual mutation** — both sides derive from the same accumulation,
so dropping revenue from each together keeps it satisfied. Fixed by adding an
**absolute anchor**: netSales must equal the exact total the fixture
constructs (172.50). A consistency check needs an absolute companion, or
revenue can leave through both doors at once.

🛑 **"One bin classifier — delete the second" was WRONG, and I checked before
acting on it.** `isBinItem()` and `l2 === 'Bin Products'` are not duplicates:

1. `aggregateOrders`'s name-based split is a **live fallback**, not dead code.
   `binRetailOverride` initialises to `null` at all three call sites and is set
   only inside a conditional — one site comments the fall-through explicitly
   ("fall through with binRetailOverride = null"). It runs whenever the item
   aggregation fails or returns nothing.
2. `isBinItem` is also a **Tier-2 name heuristic inside the category
   classifier** (worker.js ~2764, ~3014), assigning `Bin Products` when
   Clover's catalog does not know the item — a documented safety net.

Deleting either removes a safety net. The real exposure is silent *divergence*,
and the answer is detection, not deletion — there is already an
`[aggregator-drift]` warning for totals over $1; the channel split has no
equivalent. **Proposed instead:** extend that drift warning to bin/retail.

`mixed` in the payload: delivered in Phase 2.

## Still open

- **Route refunds and the `Other / Non-Item` residual into `_ch`**, so
  `channels.retail + channels.bin == netSales` exactly. This is the remaining
  cause of CART × ORDERS missing Net by $12.28 on BL1 and $21.26 on BL14. The
  attribution points are known: the refund loop already resolves each line
  item's `l2`, and the residual is computed per order so it can be split by
  that order's retail/bin gross share. Unattributable refunds (cross-day, or
  manual with no line items) need a deliberate rule — that is the open
  question, not the plumbing.
- **Phase 1** — delete the browser's duplicate aggregator (~100 lines in
  `fetchLiveCloverSales`). That duplication is why the `payment.amount` fix
  landed on one side only.
- **Backfill `mixed` into historical snapshots** so past days' combined ORDERS
  stop reading ~2–8% high. Requires rewriting item snapshots — through the
  Repair console with a health check, never blind.
