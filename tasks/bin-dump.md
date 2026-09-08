# Bin Dump — pallet tag → log

**Goal:** a manager photographs a pallet tag, Claude reads seven fields off it, the
manager confirms them, and the pallet is logged with a timestamp into a week-grouped
log that stays editable.

## Decisions (Brian, 2026-09-08)
- **Its own page**, not a card on Inventory — Inventory is admin-only and the people
  dumping pallets are managers.
- **Current design language** (V1 Operator / DESIGN.md §4.8), not Inventory's older chrome.
- **Tag photo kept** in R2, openable from its log row.
- **Edit in place, marked as edited**, original timestamp preserved. Delete admin-only.
- **Units varies** — "some pallets have hundreds" — so the units total is a real number
  and the tile stays.
- Weeks **Sunday → Saturday** (`autoWeekOf`). After Submit, back to **Begin**.
- Seven fields only. Asked about "Pallet N of M"; answer was "that's all".

## The tag, and the trap in it

Brian's photo settled the layout. **Every value is right-aligned and printed one line
ABOVE its own label**, so a label pairs with its value *diagonally*:

```
PRM-10490-30                    50201   <- Item:
Item:
PALLET AMAZON IND8                      <- the pallet name
                                 5036   <- PO:
PO:
                                    1   <- # of Units:
# of Units:
                          Ranon Price   <- Created By:
Created By:
                                10490   <- Truck #:
Truck #:
```

🛑 **A prompt told to read "to the right of `PO:`" finds nothing on that line and takes
the next label's value — every field shifts by one.** Item becomes 5036, PO becomes 1,
units becomes "Ranon Price". Confident, plausible, entirely wrong. The prompt states the
geometry explicitly and the test suite pins the exact seven values off a fixture that has
this layout, so a regression to a horizontal read is a red test, not a silent corruption.

The value-above reading is not a guess: reading downward yields "# of Units: Ranon Price"
and "Created By: 10490". Only value-above puts all five in a sane field.

**The barcode is `PRM` + truck # + pallet index** (`PRM-10490-30`, footer "Pallet 30 of 30"),
and is NOT the item number (confirmed). That gives a free cross-check on the truck #.
It is a **soft flag only**, and only when the barcode actually matches `PRM-<digits>-<digits>`
— if the pattern does not hold on other tags it silently does nothing rather than nagging.

## Shape

### Storage — `migration-058.sql`
One table, `bin_dumps`. The week is **derived from `logged_at`**, never stored: the Flow
Calendar's weeks stop on 2026-12-26 and this must not stop with them.

🔑 `created_by_tag` (the name printed on the tag — who built the pallet) is a different
fact from `logged_by` (the app user who pressed Submit). Both are kept. Collapsing them
would lose the ability to ask either question.

### Worker — seven actions
| action | does |
|---|---|
| `bin-dump-scan` | photo in, seven fields out. **Stores nothing.** |
| `bin-dump-log` | writes the confirmed row + the photo to R2 |
| `bin-dump-recent` | the soft duplicate check, on its own so a slow answer never costs a submit |
| `bin-dump-list` | the log, newest first |
| `bin-dump-update` | edit a row; stamps `edited_by`/`edited_at` |
| `bin-dump-delete` | admin-only |
| `bin-dump-photo` | serves the tag image, re-checking store access |

**Why scan stores nothing.** The alternative — scan writes to R2 and returns a key —
saves one upload but creates a class of orphan: R2 objects with no D1 row, growing
forever, invisible, needing a purge job to ever go away. Two uploads of a downscaled
~250 KB JPEG is the cheaper price. It also makes `bin-dump-scan` a pure function of its
input, which is what makes it testable.

**Gating.** No new role machinery. `bin-dump-*` stays OUT of `NON_FINANCIAL_ACTIONS`, so
the existing financial gate already admits exactly `superuser / admin / executive /
manager` and refuses staff — the same way `shelf-count-save` is gated. Each handler then
re-checks `canAccessStore`, and refuses a store in `STORE_CLOSED_FROM` (no bins to dump
into). `district_manager` was retired by migration-029 and is not a valid role.

🛑 Every action must be registered in `ACTION_BUSINESS` or it is a hard 403 in production
(`UNCLASSIFIED_ACTION`). `scripts/test-business-gate.mjs` fails on an omission.

### Frontend — `#page-bin-dump`
Top-level page (`showOnlyPage` force-hides anything `id^="page-"`, so a sub-panel could
not use that prefix). Camera is `<input type="file" accept="image/*" capture="environment">`
— the native camera, which is what survives inside an installed PWA; the existing
`psShrink()` downscaler (1280 px, JPEG 0.82) runs before upload. Dialogs use
`uiConfirm`/`uiAlert`, never native `confirm()`, which freezes the installed app on iOS.

Three places must agree for a gated surface: `applyRoleUI`, the `navigateToPage` guard,
and the worker.

## Guards
- 🛑 A field the model cannot read comes back **null**, never a guess — a wrong unit count
  is invisible in a way a blank is not. Nulls surface as the red "not on the tag" state.
- 🛑 `bin-dump-log` re-validates every field server-side. The verify popup is a
  convenience, not a gate.
- ⚠️ Duplicate PO within the last hour at the same store → **soft warning**, never a block.
  A genuinely repeated PO happens.
- ⚠️ An unreadable photo opens the popup **empty and editable** rather than failing, so a
  torn tag can still be keyed by hand.

## Deploy order
**migration-058 FIRST, then the worker, then the frontend.** The worker writes a table
that must exist; the frontend calls actions an old worker would reject as
`UNCLASSIFIED_ACTION`. And `CACHE_NAME` in `sw.js` bumps with the frontend or installed
phones keep serving the old bundle.

## Status — built 2026-09-08, NOT deployed
- [x] `migration-058.sql`
- [x] `worker.js` — seven actions, `BIN_TAG_PROMPT`, `binDumpFields`, `binDumpWeekOf`,
      `binDumpTruckHint`, `binDumpStoreGuard`, all seven registered in `ACTION_BUSINESS`
- [x] `index.html` — `#page-bin-dump`, nav item, `NAV_BUSINESS`, `applyRoleUI`,
      `navigateToPage` guard + init hook, More-sheet row, bottom-nav gate
- [x] `scripts/test-bin-dump.mjs` — **93 assertions**
- [x] `sw.js` CACHE_NAME v168 → v169, and `scripts/fixtures/shell-cache.json` with it
- [x] Full repo suite **3504 assertions / 58 suites**, green

## Review — what the build turned up

**The week had to be anchored to Eastern, not UTC.** `autoWeekOf()` was the obvious
helper to reach for, and it is wrong here: a pallet dumped at 9pm ET on a Saturday is
01:00 UTC Sunday, so a UTC-derived week files it under a week the store had not begun
working. `binDumpWeekOf()` derives the ET calendar date first. Pinned by a test that
fails if it is reverted, and the suite passes under UTC, ET and Auckland.

**Two colours failed contrast, and only measuring found them.**
- `.bd-tag` "NOT FOUND" in dark was **4.45:1** — just under. Now `#f87171`, 5.78:1.
- The page heading was **2.28:1 in light**. `text-accent-green` (#22c55e) is 7.81:1 on
  the dark panel and unreadable on the light one. Bin Dump uses `#166534` (7.13:1) in
  light and keeps the accent in dark.
  ⚠️ **Every other page heading in the app has this same fault** — they all use
  `text-2xl font-brand text-accent-green`. Not fixed here; that is a separate change.

All 29 text elements on the page now measure ≥ 4.54:1 in both themes, taken from the
rendered page rather than from the stylesheet.

**Mutation-tested rather than trusted.** The suite went green first time, which is when
a suite deserves suspicion. Eight mutations, seven caught immediately; the eighth
(loosening the barcode shape guard) was caught once the mutation was written properly —
the first attempt hardcoded a value that happened to match, which is its own lesson.

**Driven in a real browser, not just parsed.** `node --check` cannot see whether a
helper landed at top level or whether a click is wired, so the page is loaded in
headless Chromium as a manager and driven end to end: store picker, week accordions
(collapsed AND reopened — the second render is where this repo's bugs live), the camera
input, the verify popup, submit, and editing a logged row. That caught the store picker
coming up empty, because `currentUser` is `let`-scoped and the harness had been setting
a different global.
