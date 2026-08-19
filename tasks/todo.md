# Merchandising — Phase 1 (Buy Criteria + Shelf Counts)

Plan doc: `~/.claude/plans/clever-honking-finch.md`.
Source PRD: `~/Downloads/PRD-hub-merchandising-module.md` (v3, Aug 19 2026).

The first surface of a new **Merchandising** section on the Bargain Lane side. Long term it
holds buy decisions, store allocation and store layout; this pass ships the section shell plus
the two things everything else depends on:

1. **Buy Criteria** — the versioned table that *defines core*. Every later surface reads it.
2. **Shelf Count** — weekly manager-entered bay counts. Ratios need ~2 weeks of history before
   they mean anything, so the form ships now even though nothing reads it yet.

## The one thing to know before reading the code

**The PRD's "L2" is this repo's `L3`.** `L3_TO_L2` (worker.js:160) has 15 coarse L2 buckets and
89 L3s. The PRD's core list — snacks, candy, drinks, condiments, coffee & tea — is *entirely*
L3, all inside the single L2 `Consumable Food`. Keying on the repo's L2 would collapse the core
flag to one boolean over all food.

So: **PRD "L2" → code `l3`**, **PRD "group" → code `l2`**. Confirmed with Brian this session.

## Build

- [x] `migration-041.sql` — `merch_criteria`, `merch_criteria_versions`, `shelf_counts`
- [x] Worker: criteria read/draft/publish/discard/log
- [x] Worker: shelf-count save + read
- [x] Register the 7 new actions in `ACTION_BUSINESS` (worker's fail-closed gate — caught by the test)
- [x] `index.html`: Merchandising nav group + `NAV_BUSINESS` registration
- [x] `index.html`: Buy Criteria page
- [x] `index.html`: Shelf Count page (mobile-first)
- [x] `scripts/test-merch-criteria.mjs` — 55 assertions
- [x] `node scripts/test-nav-registry.mjs` green
- [x] `bash scripts/test.sh` green — 1615 assertions, 44 suites

## Deploy (not started — needs Brian's go-ahead per CLAUDE.md rule 7)

- [ ] migration-041 → staging, then prod
- [ ] Worker deploy **first**, then frontend (client calls new endpoints)
- [ ] Verify on staging with a manager-role account

## Out of scope this pass

Coverage scorecard/heatmap · Manifest Scorer · TinyFish · UPC database · Claude classification ·
suggested pricing · vendor coverage · buy-tracker handoff.

## Review

**Shipped (uncommitted, not deployed).** Backend + both pages, verified in a browser.

| File | What |
|---|---|
| `migration-041.sql` | `merch_criteria`, `merch_criteria_versions`, `shelf_counts` (new) |
| `worker.js` | +7 actions, merch helpers, 7 entries in `ACTION_BUSINESS` |
| `index.html` | Merchandising nav group, 2 pages, `uiPrompt`, 6 `NAV_BUSINESS` entries |
| `scripts/test-merch-criteria.mjs` | 69 assertions (new) |
| `scripts/lib/worker-harness.mjs` | D1 shim now reports `run().meta.changes` |

**Two design calls worth remembering:**

1. **Copy-on-draft.** Opening a draft copies the whole live version forward, so every
   version is a self-contained snapshot. That is what makes "scored under v7" true a year
   later without replaying history, and it means immutability is *structural* — the draft
   endpoint has no version parameter, so it cannot target a published version at all.
2. **The change log is a diff, not a table.** Derived by comparing consecutive published
   versions. A stored log can drift out of sync with the values it describes; a derived
   one cannot.

**Found while building, folded back into the PRD:**
- The PRD's "L2" is the Hub's L3 (the reason the whole feature is keyed on `l3`).
- 6 stores, not 7. Wyoming is closed; the acceptance sample now uses Holland.
- Energy drinks is already its own L3, so open question 4 is partly answered by the data.
- **Cereal and laundry have no L3 to attach to** — cereal's nearest is `FOOD - BREAKFAST`;
  Tide lands in `CHEMICALS`/`HOUSEKEEPING`. Both need a decision before v1 covers them.
- Open question 2a is re-marked **blocking for v1**: publish with `min_margin_per_unit`
  blank and the % test governs alone, so the first manifest warns on staples you'd buy.

**Access — settled by role, not by person (Brian, this session):**

> "Any admin and superuser can read criteria — let's not worry about who, just focus on
> the superuser and admin role."

| Role | Read criteria | Write / publish | Shelf Count |
|---|---|---|---|
| superuser | ✅ | ✅ | ✅ |
| admin | ✅ | ✅ | ✅ |
| district_manager | ❌ | ❌ | ✅ |
| manager | ❌ | ❌ | ✅ |
| executive | ❌ | ❌ | — |
| staff | ❌ | ❌ | — |

This is what the code already did; what changed is that it is now stated as a role rule in
the comments and pinned per role in the tests, rather than justified by who holds which
account. `executive` is deliberately not special-cased — no read-only Merchandising surface
exists yet, and Coverage is where that question actually lands.

Managers keep the Merchandising group in the nav solely so they can reach Shelf Count; Buy
Criteria is hidden from them and refused by both the router and the worker.

**Left alone deliberately:** the committed root `tailwind.css` is stale relative to
`tailwind.config.js` (it renders `accent-green` as `#3BB54A`; a fresh build gives
`#22c55e`). Not regenerated here — `build.sh` writes `dist/tailwind.css` at deploy time, so
production is unaffected, and committing a rebuild would be a 13KB colour diff across the
whole app that has nothing to do with this change.
