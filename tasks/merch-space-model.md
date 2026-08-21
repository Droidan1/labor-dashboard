# Merchandising — space, demand and buy-quantity model

Captured from the Aug 20 2026 alignment conversation with Brian. This is the
requirements record; PRD-hub-merchandising-module.md predates it and is thinner.

## The decision chain (order matters)

1. **Cost gate** — vendor cost vs. what we realise for that L3. Is there margin?
2. **Competitive gate** — our price must beat Walmart / Target / Kroger / Dollar
   General. Margin on an item that never sells is not margin.
3. **Demand gate** — does this category actually move at this store?
4. **Quantity gate** — what physically fits, and how deep a backstock is sane.
5. **Allocation** — split across the six stores by their space and their velocity.

Cash is the gate. Space bounds the quantity. They are different jobs.

## Store geometry (confirmed, standard across all stores)

| Fact | Value |
|---|---|
| Gondola section width | 4 ft (48 in) |
| Shelf depth | 16 in |
| Shelves per section | 5 (4 shelves + 1 base) |
| **Facing space per section** | **20 linear ft (240 in)** |

Derived: `facing_inches = sections × 240`, `run_feet = sections × 4`.
Confirmed: "48 feet of HBA" = **12 sections** (12 × 4 ft), = 240 facing feet.

**Entry unit is SECTIONS**, not feet — it is what you can count walking the
floor, and it converts without ambiguity. Feet of run is derived, not entered.

## Space is a standing plan, not a weekly count

`shelf_counts` (migrations 041/042) records OBSERVED bays per store/week/category.
That is a measurement. Allocation needs a separate CAPACITY PLAN: sections per
store per L3, set once and revised. The gap between plan and count is its own
signal ("BL4 is running snacks 3 sections under plan").

## Facings, not "how many fit"

A section of HBA holds many different items. The question is never "how many bar
soaps fit in HBA" — it is "how many of this section's 240 facing inches does this
soap earn." Capacity is three-dimensional:

    across = facings                                  (facings x item_width <= shelf width)
    deep   = floor(16 / item_depth_in)                (16 in shelf depth)
    high   = clamp(1, floor(15 / item_height_in), stack_cap)   (15 in between shelves)
    units_on_shelf = across x deep x high

**`stack_cap` is a PRACTICAL limit, not a physical one.** 15 inches of clearance
would allow ~10 layers of flat-boxed soap, but nothing is merchandised that way —
it topples and it looks bad. Brian's own figure is 2-3 layers. Default the cap to
**3**, overridable per L3: boxed and canned goods stack, bottles and bags do not
(cap 1). The `clamp` floor of 1 also protects against tall items, where
`floor(15/height)` would otherwise return 0.

Worked example - bar soap, 3 in wide x 2 in deep x 1.5 in tall, given 4 facings:

    across = 4
    deep   = 16 / 2 = 8
    high   = min(floor(15/1.5), 3) = min(10, 3) = 3
    units  = 4 x 8 x 3 = 96          (32 without stacking - stacking triples it)
    space  = 4 x 3 in = 12 in, about 5% of one section

Whole-shelf and whole-section capacity for the same item:

    per shelf   = 16 facings x 8 deep x 3 high =   384
    per section = 384 x 5 shelves              = 1,920

## Facing share is the bridge from space to demand

For an item we have never carried there is no item-level velocity — and item-level
history is not in the snapshots anyway (they resolve to L3, not SKU). So estimate
it from the space it is given, which is the standard planogram assumption:

    expected_unit_velocity = L3_velocity x (item_facing_inches / L3_total_facing_inches)

This is what connects the two halves of the model. It self-corrects once real
sales land against the item.

## Item dimensions

Captured during the retail fetch we already run (Walmart/Target product pages
carry assembled dimensions). Zero extra API calls or credits. Falls back to the
L3 average once enough items in that L3 are measured.

## Pallet drops and floor stacks

- Used occasionally, mainly for CASE BUYS — water, pop, clean cases of cereal.
- **Shelf space first, then pallet drop.** Always.
- Business rule: customers shop the shelves before they shop a pallet drop.
- ⚠️ CONSEQUENCE (assumption — confirm with Brian): the same item turns SLOWER in
  a pallet drop than on shelf. Pallet capacity therefore cannot simply be added to
  shelf capacity to get total capacity; it needs a velocity haircut.
- Droppability is gated on the goods being case-packed and uniform. Partly
  inferable from `units_per_case` / `uom` already on manifest lines. Mixed-condition
  salvage returns cannot be dropped.

## Demand signals (data already exists)

Item snapshots are per store-day and carry `qty` by L3 plus basket-touch counts
(`l3Orders`). No new pipeline needed.

Raw units cannot answer "wrong product or wrong customer" — store size confounds
it. Three numbers separate them:

- units per 1,000 transactions (controls for store size)
- basket penetration — share of baskets containing the category (already computed)
- **store vs. chain on both** — this is the actual diagnostic

Read: Battle Creek hygiene at 2% penetration vs. 7% chain-wide on similar footage
→ assortment is wrong, customer is fine. ALL stores at 2% → the category does not
work for our customer; take the feet away.

## Known gaps in what is already built

1. **No freight, no defect allowance.** `landed_cost` is literally `cost × qty`.
   For salvage, freight + unsellable share runs 15–25% of true cost, so every
   criteria gate is currently passing things it should not.
2. **No allocation logic at all.** `max_per_store` exists as a criteria field and
   nothing computes it.
3. **Criteria v3 has `core` ticked on the chain-default row** — everything reads as
   core and the 60% floor is unmeasurable on Coverage.
4. **"Not sold at big box" renders as a blank**, reading as failure. It is a real
   answer: no competitor price to beat, but no proof of demand either — price off
   our own ASP and carry more risk. 212 of Alliance's 331 lines are import-prefix
   UPCs that genuinely are not sold at big box.
5. **CSV only** on manifest upload. Excel and PDF are common in salvage.

## Backlog beyond the current build

- Vendor scorecard — sell-through at 4/8/12 weeks and defect rate by vendor, fed
  back as a vendor-specific cost haircut. Needs buys tagged, so it trails.
- Sales per shelf foot per L3 per store — the metric that drives reallocation.
- Aging → **bin** as the disposition, not a markdown spiral. Specific to our format.
- Periodic price re-check on top movers — the discount position erodes silently.
- Cross-store transfers — downstream of allocation (needs per-store on-hand by buy).
