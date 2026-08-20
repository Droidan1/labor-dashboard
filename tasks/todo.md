# Manifest Scorer — slice 1 (Hub-only)

Plan: PRD §5.2. Decisions taken with Brian this session:

| Decision | Choice |
|---|---|
| First slice | **Hub-only** — no external lookups. Everything here runs on data already in the Hub. |
| File format | **CSV to start.** The worker is one file with no imports; xlsx needs a real library and changes the deploy shape. |
| Retail lookup | Later slice. TinyFish access exists; no UPC provider yet, so that stays behind an interface. |

## The honesty problem this slice has to solve

Every criterion in §5.3 is written against **street retail**, and this slice has none.
It must NOT quietly substitute our ASP and call it retail — that is the same error R6 and
R7 exist to stop vendors making. So: compute cost as a share of **our ASP**, label it as
that everywhere it appears, and mark the verdict as scored without retail. When the
lookup lands, the same fields switch to retail and the label changes.

## What IS computable from the Hub today

- **L3/L2 classification** — Claude API, already wired in this worker.
- **Our ASP per L3** — `l3Net / l3Qty` over L28D from the `items:<store>:<date>` snapshots.
- **Velocity per L3** — units/day chain-wide from the same snapshots, which makes
  **days-to-clear** and therefore `cash_back_days` a real number, not a guess.
- **Shelf-now** — the Coverage read, so a rollup row can say what the floor gives that
  category today.
- **Criteria** — the published version, scored per §5.3's warn-not-fail logic.

## Build

- [x] `migration-043.sql` — manifests, manifest_lines, vendor_templates, item_cache
- [x] CSV parse + column mapper, per-vendor template remembered
- [x] Sell-as (each/case) — all downstream maths in the chosen unit
- [x] Claude L3 classification, batched, cached by identifier, manual override persists
- [x] ASP + velocity per L3 from snapshots
- [x] Suggested price (ASP + L2 rounding rule) and days-to-clear
- [x] Score against the live criteria version; verdict with edit asks
- [x] Rollup by category, with shelf-now
- [x] Lines table with flags and filters
- [x] Mark decision
- [x] Tests
- [x] DESIGN.md §4.8 followed (panel + bar + legend); check the second render

## Deliberately not in this slice

Retail lookup (R1–R8) · UPC database · pack-size parser · price caps off retail ·
facings-per-4ft · export one-slide · buy-tracker handoff · xlsx.

## Review

Shipped to prod. Worker `0e45801a`, migration-043 applied, suite 1754/46.

**The design decision that shapes everything here:** the score is computed on READ, not
stored. Criteria move and our own ASP moves, so a stored verdict would go stale while
still looking authoritative. What IS stored is the version a *decision* was taken under —
`criteria_version` plus `scored_without_retail` — because "we approved this" only means
something alongside what it was measured against.

**What the tests caught that reading the code would not have:**

- Header guessing was anchored (`/^desc/`), so "Item Description" — which is how real
  vendor files are labelled — never matched. Now matched by contains, and checked against
  four realistic layouts.
- The `.99` rounding rule was written as an unreadable ternary and was wrong: $3.42 came
  out $3.99 rather than $2.99. Rewritten as "nearest price ending in .99" and unit-tested
  across eleven cases.

**Deliberately refused:** the model may only return a category copied exactly from our
list. A free-text answer would invent categories matching no criteria row and no sales
history, and the line would score against the chain default while looking correctly
classified. An invented category is dropped, and the line stays visibly unclassified.

**Also refused:** the model never overwrites a human's category. `item_cache.l3_source`
is checked in the upsert's WHERE clause, not in application code.

## Next slice

Retail lookup (R1–R8) via TinyFish — Brian has access; no UPC provider yet, so that stays
behind an interface. When it lands, `costPctAsp` gains a retail sibling and the
`withoutRetail` banner comes off. Nothing else in the pipeline moves.
