# FG BL SOFTLINES - APPAREL is booking to "Softline - Accessories"

Reported by Brian 2026-08-11 from the BL14 (Battle Creek) dashboard Item Sales drill-down.
Investigated same day. **Root cause is one wrong value in production KV, not code.**

---

## 1. Root cause

Production KV `item-overrides:global` contains:

```
l3Map["FG BL SOFTLINES - APPAREL"] = "Softline - Accessories"
```

The aggregator consults the admin `l3Map` **before** the built-in `L3_TO_L2`:

| where | line | answer |
|---|---|---|
| `ov.l3Map[l3]` — admin override, checked first | [worker.js:2727](worker.js:2727) | `Softline - Accessories` ❌ |
| `L3_TO_L2[l3]` — built-in, checked second | [worker.js:2732](worker.js:2732) | `Softline - Apparel` ✅ |

That precedence is deliberate (the comment at :2728 says overrides exist so admins can
correct mis-categorized Clover categories). Here the override is *itself* wrong, so it
overrides a correct built-in with a wrong answer.

**Why the row still reads "FG BL SOFTLINES - APPAREL":** the override sets
`l2Source = "clover-l3"`, and the L3-key resolver at [worker.js:2827](worker.js:2827)
passes the real Clover category string through verbatim for that source. So the row keeps
its true name while being filed under the wrong parent — exactly what the screenshot shows.

The same precedence is mirrored in the cross-day refund-attribution loop
([worker.js:3005](worker.js:3005)), so refunds follow the money into the wrong bucket too.

### This is the ONLY wrong encoding

Per the Hamilton Beach lesson — count a fact's encodings before fixing one. This fact is
encoded in three places; two are already correct:

| # | location | value | |
|---|---|---|---|
| 1 | `L3_TO_L2` [worker.js:239](worker.js:239) | `Softline - Apparel` | ✅ |
| 2 | `ISR_L3_TO_L2` [index.html:11386](index.html:11386) | `Softline - Apparel` | ✅ |
| 3 | prod KV `item-overrides:global.l3Map` | `Softline - Accessories` | ❌ |

A full sweep of the production `l3Map` (22 entries) against the built-in map (89 keys,
parse proven non-vacuous) found **exactly one conflict** — this one. 17 entries agree
redundantly, 4 are novel keys not in the built-in map.

---

## 2. Scope — yes, all stores

The KV key is `item-overrides:global`. It is **global; every store shares it**
([worker.js:2403](worker.js:2403)). So this is structurally chain-wide, and measurement
confirms it.

Swept all 6 stores × 2026-04-01 → 2026-08-11 (906 KV snapshot keys, 900 present):

| store | days | qty | net mis-filed | first | last |
|---|---:|---:|---:|---|---|
| BL14 | 45 | 513 | $5,781.78 | 2026-06-19 | 2026-08-10 |
| BL1 | 11 | 484 | $4,563.61 | 2026-06-21 | 2026-08-10 |
| BL4 | 25 | 274 | $2,175.25 | 2026-06-19 | 2026-08-10 |
| BL8 | 23 | 136 | $1,746.01 | 2026-06-19 | 2026-07-18 (store closed) |
| BL16 | 14 | 34 | $536.36 | 2026-06-24 | 2026-08-10 |
| BL2 | 8 | 12 | $156.50 | 2026-06-19 | 2026-08-05 |
| **total** | **126** | **1,453** | **$14,959.51** | | |

**100% of it landed under `Softline - Accessories`. Not one row landed correctly.**

**Start date is 2026-06-19, and it is a category rollout, not a code change.** Zero
occurrences of the L3 in 474 snapshots from 2026-04-01 → 2026-06-18. Before that date
apparel reached the dashboard by *other* routes that use the built-in map and were always
correct — `"Apparel"` (name match, $310,725 in that window),
`"[Name match] FG BL SOFTLINES - APPAREL"` ($860.28), `"[Heuristic] Softline - Apparel"`.
The bad override sat inert until Clover items actually acquired that category on 06-19.

Volume through the category is *growing* as stores re-tag items (BL4: $15 on 07-15 → $0 on
08-01 → $447.12 on 08-10), which is why it only became visible now.

### Not affected
- **D1**: category/item data is KV-only. No `category_sales`-style table exists. KV is the
  single store of record.
- **The two source maps** (see table above) — both already correct, no code edit needed there.

---

## 3. Why it happened, and why nothing caught it

Three separate defects. The bad value is the symptom; these are what let it in and hide.

**3a. Neither write path rejects a conflicting value.** Both validate only that the L2 is a
member of `VALID_L2` — and `"Softline - Accessories"` is perfectly valid. Neither compares
against the built-in map:
- `POST ?action=item-overrides` — [worker.js:10459](worker.js:10459). Fed by the Settings
  override editor, which writes whatever the dropdown holds
  ([index.html:12052](index.html:12052)).
- `POST ?action=create-clover-item` — [worker.js:10777](worker.js:10777). This one is worse: it
  writes `overrides.l3Map[l3] = l2` as a **silent side effect** of creating one inventory
  item. Pick the wrong L2 in that form once and you permanently re-bucket an entire
  category for all six stores, with no warning and no mention in the response beyond a
  `l3Mapped: true` flag. This is the most likely origin.

**3b. Two subsystems disagree on precedence for the same fact.** The aggregator lets the
override win ([:2727](worker.js:2727), [:3005](worker.js:3005)). The category-cost editor
lets the built-in win ([worker.js:10573-10576](worker.js:10573)). So the cost editor
*displays* this category under `Softline - Apparel` while the aggregator *books* it to
`Softline - Accessories` — the UI actively contradicts the engine, which is why an admin
reviewing the editor would see nothing wrong.

**3c. `l3Map` has zero test coverage.** `test-category-mapping.mjs` and
`test-isr-category-mirror.mjs` both compare source literals to source literals. Neither can
observe a KV value, so no existing test could fail on this. The bug lives entirely in data.

---

## 4. The fix

### Phase 1 — stop the bleeding (data, prod KV) ✅ DONE 2026-08-11 20:10 ET

Backed up to `~/Desktop/labor-dashboard-backups/item-overrides-global.20260811T201050.json`
(outside the public repo — it is prod data), backup validated to parse and contain the bad
key before any write. Deleted the one key; `l3Map` 22 → 21, `items` (54) and `patterns` (1)
byte-identical, every other l3Map entry identical, zero remaining conflicts vs the built-in
map. Read back from prod and re-verified.

Behaviour proven, not assumed: drove `worker.fetch` on `?action=items-hour` with the real
before/after prod maps seeded into KV. With the old map an item categorised
`FG BL SOFTLINES - APPAREL` booked to `{"Softline - Accessories":[...]}`; with the current
map it books to `{"Softline - Apparel":[...]}`. 4/4 assertions passed.

Today (2026-08-11) self-heals: the live view recomputes per request, and the nightly rollup
(`55 3 * * *` = 11:55 PM ET) calls `fetchItemOverrides` fresh at run time
([worker.js:13593](worker.js:13593)), so tonight's stored snapshot is written correctly.
**Phase 2's repair range is therefore 2026-06-19 → 2026-08-10.**

<details><summary>original Phase 1 plan</summary>

Delete the single key `l3Map["FG BL SOFTLINES - APPAREL"]` from `item-overrides:global`.
Deleting (rather than correcting to `Softline - Apparel`) is right: it falls through to the
built-in map, leaving **one** source of truth instead of two that must be kept in sync.

- Back up the current KV value to a timestamped file first. A failed backup = a failed write.
- Re-read and diff after the write; confirm 22 → 21 entries and zero remaining conflicts.
- Fixes live/today and every future night immediately. No deploy required.
</details>

### Phase 2 — repair stored history WITHOUT re-pulling Clover ✅ DONE 2026-08-12 00:26 ET

**126 snapshots re-parented; $14,959.51 / 1,453 units moved. Fully verified against prod.**
Backups: `~/Desktop/labor-dashboard-backups/apparel-reparent-20260812T002630/` (one file per
key, original contents, validated readable before any write).

Verified after the fact against those backups, key by key: every grand total, the `totals`
block, `channels`, `orderCount`, and **every untouched category byte-identical**; the moved
row's own numbers unchanged; exactly one such row per day, under `Softline - Apparel`, none
left behind. A re-run now reports *"Nothing to repair"* across all 318 candidate snapshots —
idempotent, and independent confirmation the repair is complete.

🛑 **The apply run exposed a real defect in the verifier — worth reading before writing any
other KV repair.** It read back immediately and reported **44 failures**, then printed
`restore from <backupDir>`. Every write had landed; a re-read minutes later showed 126/126
correct. **KV is eventually consistent, and a stale read is indistinguishable from a failed
write — but the remediations are opposite.** Following the tool's own advice would have
reverted a correct repair using the backups taken moments earlier.

Fixed in the script: verification now polls the full condition and requires **two
consecutive clean passes** (20s apart, up to 8 attempts), and only mentions restore once the
retries are exhausted. This is CLAUDE.md rule 5 generalised from Worker rollout to KV.

<details><summary>original Phase 2 plan and dry-run notes</summary>

Script: [scripts/repair-softline-apparel-parent.mjs](scripts/repair-softline-apparel-parent.mjs).
Dry run by default; `--apply` backs up, writes, reads back and re-verifies. Deliberately not
named `test-*` so `scripts/test.sh` never globs it — it talks to production.

Dry run 2026-08-11: **126 snapshots change, $14,959.51 / 1,453 units moved, all invariants
hold, grand totals unchanged on every day.** Independently reproduces the totals measured
during the investigation, per store, to the cent. One edge case: BL4 2026-08-10's
`Softline - Accessories` bucket is emptied entirely by the move and is dropped rather than
left as a zero row.

Guards it carries: refuses to run if the prod `l3Map` still holds a conflicting override
(otherwise the nightly rollup re-breaks every day it fixes); refuses to touch a snapshot
whose own L2 arithmetic doesn't hold; destination L2 is read from `worker.js`'s `L3_TO_L2`
rather than hardcoded, with a non-vacuous parse guard; idempotent by construction (the
post-move stray check is the same predicate the planner selects on).

**Two false alarms came from the checking tool, not the data — both fixed:**
1. The sum invariant was asserted chain-wide, but `Other / Non-Item` is a residual bucket
   holding a total with **zero** `l3Rows` by design ([worker.js:3193](worker.js:3193)) and
   already violated it in 368 snapshots. It now applies only to the two touched buckets;
   untouched categories are held to byte-identity instead, which is stricter.
2. The "other disagreements" report flagged 338 `Sku Book Items` rows as mis-parented. They
   are correct — sku-book items route through `SKU_BOOK_TO_L2` to a real L2 while keeping
   that L3 label ([worker.js:2700](worker.js:2700)). Excluded, with the reason recorded.

With both fixed, **no other category in range disagrees with the engine's map.**
</details>

**Do not re-snapshot.** CLAUDE.md rule #1 — 2026-06-19 is ~54 days back and Clover's ~90-day
order retention decays continuously, so re-pulling these 126 store-days would silently drop
refunds that have aged out. It is also unnecessary.

The stored snapshots already hold the correct L3 row with correct amounts under the wrong
parent. So the repair is a **pure local re-parenting transform** of the stored JSON — zero
Clover calls, lossless:

> for each affected `items:<store>:<date>`: move the `FG BL SOFTLINES - APPAREL` l3Row out
> of the `Softline - Accessories` category into `Softline - Apparel` (creating that L2 if
> absent), subtracting its metrics from the old parent and adding to the new, then recompute
> `asp`, `gpmPct`, `pctQty` and drop any L2 left empty.

This is exact because the invariant holds: **L2 totals equal the sum of their `l3Rows`
across all 1,154 Softline buckets checked, on all six fields** (qty, gross, discounts,
refunds, netSales, cost) to the cent. Verified before proposing this, not assumed.

- Write the transform as a dry-run-first script; print a per-day before/after diff.
- Back up every touched key before writing.
- Re-verify the sum invariant after the write, and confirm each day's grand total is
  unchanged (money only moves between two L2 buckets; no total may shift).

### Phase 3 — make it impossible to recur ✅ BUILT 2026-08-12, not yet deployed

All five items done; `npm test` green at **1,152 assertions across 34 suites**.

1. **One precedence rule.** New `resolveL3ToL2(l3, ovL3Map)` ([worker.js:2437](worker.js:2437))
   is now the only encoding. Three call sites converted: the aggregator
   ([:2766](worker.js:2766)), the cross-day refund mirror ([:3040](worker.js:3040)), and the
   category-cost editor catalog ([:10645](worker.js:10645)) — the last of which had the
   OPPOSITE precedence and was why the UI never contradicted itself visibly.
2. **409 on conflicting writes** ([worker.js:10520](worker.js:10520)), naming both answers.
   Only NEW or CHANGED conflicts are refused — the editor re-sends the whole merged map on
   every save, so rejecting pre-existing entries would make unrelated saves impossible.
   `force: true` remains as the deliberate escape hatch.
3. **`create-clover-item` is additive only** ([worker.js:10855](worker.js:10855)). It can add
   a novel L3 key but never shadow a built-in, and returns `l3MapSkipped` explaining where
   sales will actually book. Surfaced in the UI as a yellow notice
   ([index.html:16115](index.html:16115)) so the admin isn't left believing their L2 applied.
4. **`scripts/test-l3map-precedence.mjs`** — 25 assertions driving `worker.fetch` on real
   routes with KV seeded. **Mutation-tested: all three guards, when disarmed, are caught**
   (4, 3 and 2 assertion failures respectively). Note it deliberately avoids the wording
   `"<n> passed"` — `test.sh` counts PASS lines *and* that tally and sums them, so a suite
   emitting both reporters is double-counted.
5. **Conflict report** folded into `?action=item-overrides` GET as a `conflicts` array rather
   than a new action — a new action would need a `ACTION_BUSINESS` classification and a
   business-gate completeness-test entry for no added value.

⚠️ Correction to §3a above: the endpoint is `create-clover-item`, not `create-item`. It **is**
classified in `ACTION_BUSINESS` ([worker.js:3688](worker.js:3688)) and **is** called from
[index.html:16069](index.html:16069) — an earlier note here claiming it was unreachable came
from grepping the wrong action name.

<details><summary>original Phase 3 plan</summary>

1. **Reject conflicting `l3Map` writes.** In both write paths, if `L3_TO_L2[l3]` exists and
   differs from the submitted L2, refuse with 409 and an error naming *both* answers. The
   legitimate "correct a bad built-in" case stays available behind an explicit
   `force: true` in the body — so shadowing becomes a deliberate act, never a slip.
2. **`create-item` must never shadow.** That endpoint should only ever *add* a novel L3 key.
   If the L3 is already in the built-in map it writes nothing, and says so in the response.
   A silent global re-bucketing must not be a side effect of adding one item.
3. **Resolve the precedence contradiction.** Make the cost editor's catalog use the same
   precedence as the aggregator, so the UI shows what the engine actually does. One helper
   — `resolveL3ToL2(l3, ovL3Map)` — called by the aggregator, the refund mirror, and the
   editor, so the rule is encoded once instead of three times.
4. **Add `scripts/test-l3map-precedence.mjs`.** Drive `worker.fetch` on `?action=items-hour`
   with Clover stubbed and KV seeded — the harness already stubs `SALES_SNAPSHOTS`
   ([worker-harness.mjs:157](scripts/lib/worker-harness.mjs:157)) — following the
   `test-category-mapping.mjs` pattern. Assert:
   - an l3Map entry conflicting with the built-in map is refused without `force`
   - a novel l3Map entry still maps as before (no regression on `Indy Products`)
   - `create-item` does not write l3Map for a built-in L3
   - `FG BL SOFTLINES - APPAREL` books to `Softline - Apparel`
5. **Add a conflict report.** A read-only admin action listing every `l3Map` key that
   disagrees with the built-in map, so this class of drift is visible instead of silent.
</details>

### Phase 4 — optional cleanup

17 of the 22 `l3Map` entries merely restate the built-in map. They change no behavior today
and are pure future drift surface. Recommend pruning them once Phase 3's guard is live.
Behavior-neutral by construction, and Phase 3's test proves it.

---

## 5. Order of operations

Phase 1 and 2 are data-only and need no deploy. Phase 3 is code. Derive deploy order from
which side stops being backward-compatible (CLAUDE.md rule 6): Phase 3 only *tightens* a
write path and adds a read-only report, so nothing client-side breaks — worker first, then
client. But Phase 1 must land **before** Phase 3's guard, or the guard's conflict check will
start refusing writes while the offending value is still resident.

**Recommended: 1 → 2 → 3 → 4**, with Phase 1 and 2 each confirmed separately.
