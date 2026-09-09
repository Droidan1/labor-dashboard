# Bin Dump — pallet tag → log

**Goal:** a manager photographs a pallet tag, Claude reads the fields off it, the manager
confirms them, and the pallet is logged with a timestamp into a week-grouped log that
stays editable.

## Decisions (Brian)

**2026-09-08, the original brief**
- **Its own page**, not a card on Inventory — Inventory is admin-only and the people
  dumping pallets are managers.
- **Current design language** (V1 Operator / DESIGN.md §4.8), not Inventory's older chrome.
- **Tag photo kept** in R2, openable from its log row.
- **Edit in place, marked as edited**, original timestamp preserved.
- **Units varies** — "some pallets have hundreds" — so the units total is a real number
  and the tile stays.
- Weeks **Sunday → Saturday**. After Submit, back to **Begin**.
- Asked about "Pallet N of M"; answer was "that's all".

**2026-09-08, after using it**
- **The log is a TAB at the top of the page**, not a drop-down card at the bottom. Scan
  and Log are the two tabs; the Log tab carries a count badge.
- **Managers may delete, at their own store only.** The first cut was admin-only; Brian
  widened it. Superuser/admin reach every store, everyone else only stores they hold.
- **A second tag format exists.** `WO:` is the same field as `PO:` — one label per tag,
  never both — so the column reads **PO / WO**. That format also carries **`Sup. Ref:`**,
  which is now an eighth field.
- **Tap the tag photo to open it full-screen and zoom.** 82px settles that a photo
  exists and nothing else.

**2026-09-09**
- **The same barcode must not be logged twice.** Brian's three calls, asked before
  building: **block with a deliberate override** (a dead end gets worked around by typing
  a fake barcode, which corrupts the record silently), **across all stores** (one pallet
  cannot be in two places), **within 90 days** (not forever — truck numbers cycle).

## The tag, and the trap in it

Labels run down the LEFT, each ending in a colon. Their values are **right-aligned on the
far side**, and the two **do not line up**.

🛑 **THE RULE IS ORDER, NOT DIRECTION.** The first version of this document — and the
first prompt — said every value prints one line *above* its label. That was true of the
first tag sampled and **exactly backwards on the second**, where each value prints
slightly *below*. The two are mirror images, so any rule naming a direction is right on
one tag and actively misleading on the other. What holds on both is that the **Nth
right-aligned value belongs to the Nth label**.

```
   Tag A (2026-09-08)                Tag B (2026-08-26)
   PRM-10490-30                      P-082626-725979
   Item:                             Item:
                    50201                             50007
   PALLET AMAZON IND8                FG BL CONSUMABLES - FOOD -
                     5036            SNACKS
   PO:                               Sup. Ref:
                        1                              mix
   # of Units:                       WO:
              Ranon Price                            14373
   Created By:                       # of Units:
                    10490                              362
   Truck #:                          Created By:
                                                    Oo Aung
```

Pair by position instead and **every field shifts by one** — item becomes the PO, units
becomes a person's name. Confident, plausible, entirely wrong, and invisible to everything
downstream. `BIN_TAG_PROMPT` states the ordering rule, shows both tags side by side, and
ends with a meaning check: `created_by_tag` must be a name and `units` must be a count, so
a slipped pairing catches itself. `scripts/test-bin-dump.mjs` pins the exact values off
**both** fixtures — anything asserted against only one of them proves less than it looks.

**The formats differ in which fields exist.** Tag A has `PO:` and a truck number; tag B has
`WO:`, a `Sup. Ref:`, no truck at all, and a pallet name that **wraps onto two lines** and
must be joined with single spaces. Anything a tag does not carry stays null.

**The barcode comes in more than one shape** — `PRM-10490-30` and `P-082626-725979` — and
is never the item number. Where it matches `PRM-<truck>-<index>` it gives a free
cross-check on the truck number, as a **soft flag only**; on any other shape it silently
does nothing rather than nagging.

## Shape

### Storage — `migration-058.sql`, then `-059`, then `-060`
One table, `bin_dumps`. The week is **derived from `logged_at`**, never stored: the Flow
Calendar's weeks stop on 2026-12-26 and this must not stop with them.

🔑 `created_by_tag` (the name printed on the tag — who built the pallet) is a different
fact from `logged_by` (the app user who pressed Submit). Both are kept. Collapsing them
would lose the ability to ask either question.

`migration-059.sql` adds the nullable `sup_ref` column. SQLite has no
`ADD COLUMN IF NOT EXISTS`, so it is **not re-runnable** — a second run errors with
`duplicate column name: sup_ref`, which is harmless and is in fact the cleanest way to
ask whether it has already been applied.

`migration-060.sql` adds `idx_bin_dumps_barcode ON bin_dumps(barcode, logged_at DESC)`.
🔑 **Not store-prefixed**, unlike `idx_bin_dumps_po`: the duplicate lookup deliberately
crosses stores, so a store-first index would not serve it. Unlike -059 this one **is**
re-runnable — `CREATE INDEX` takes `IF NOT EXISTS` where `ALTER TABLE ADD COLUMN` does
not. Verified in use, not merely present: the planner reports
`SEARCH bin_dumps USING INDEX idx_bin_dumps_barcode (barcode=? AND logged_at>?)` on both
databases, so both halves of the composite earn their place.

### Worker — seven actions
| action | does |
|---|---|
| `bin-dump-scan` | photo in, eight fields out. **Stores nothing.** |
| `bin-dump-log` | writes the confirmed row + the photo to R2 |
| `bin-dump-recent` | both duplicate checks in one trip, on its own so a slow answer never costs a submit |
| `bin-dump-list` | the log, newest first |
| `bin-dump-update` | edit a row; stamps `edited_by`/`edited_at`, never `logged_at` |
| `bin-dump-delete` | manager+, and only at a store the caller holds |
| `bin-dump-photo` | serves the tag image, re-checking store access |

`BIN_DUMP_FIELDS` is the one list all three of scan, log and edit agree on:
`barcode, item_no, pallet_name, sup_ref, po, units, created_by_tag, truck_no`.

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

🔑 **Delete re-derives the store FROM THE ROW**, not from anything the client sent, then
runs the same store guard — with `allowClosed: true`, because a closed store's history
must still be correctable. The client-side `bdCanDelete()` only decides whether the button
is *offered*; the boundary is the worker.

🛑 Every action must be registered in `ACTION_BUSINESS` or it is a hard 403 in production
(`UNCLASSIFIED_ACTION`). `scripts/test-business-gate.mjs` fails on an omission.

### Frontend — `#page-bin-dump`
Top-level page (`showOnlyPage` force-hides anything `id^="page-"`, so a sub-panel could
not use that prefix). Two tabs, **Scan** and **Log**, in the sticky header. Camera is
`<input type="file" accept="image/*" capture="environment">` — the native camera, which is
what survives inside an installed PWA; the existing `psShrink()` downscaler (1280 px,
JPEG 0.82) runs before upload. Dialogs use `uiConfirm`/`uiAlert`, never native
`confirm()`, which freezes the installed app on iOS.

Three places must agree for a gated surface: `applyRoleUI`, the `navigateToPage` guard,
and the worker.

🛑 `#page-bin-dump [hidden]{display:none !important}` is **load-bearing**. Bin Dump styles
several things `display:flex` by class, and a bare class rule beats the `[hidden]`
attribute — which is how an empty green status pill shipped to production under the Begin
button. Anything on this page that hides via the attribute depends on that override
existing; a test fails if either half is changed alone.

### The tag viewer
Tapping the thumbnail in the edit popup opens the photo full-screen: zoom in/out buttons
with a live percentage, pinch, wheel, drag to pan, double-tap to toggle, Fit, and
Escape/backdrop to close. Confirmed working on a real phone.

Everything that decides whether it is usable is in two **pure** functions, both sliced out
of `index.html` and executed by the test suite:

- `bdLbClamp` bounds translation by the **overhang**, so an axis with nothing to spare
  pins to zero and the picture stays centred rather than being flung into a corner.
- `bdLbZoomAt` re-scales about a point and leaves whatever is under that point exactly
  where it is. Without it, pinching drags the tag out from under your fingers.

🛑 Geometry is measured with `offsetWidth`, never `getBoundingClientRect()`: the rect of a
scaled element is the **scaled** box, so feeding it back would multiply the scale into the
pan bounds on every gesture. `z-index: 60` puts the viewer above the edit modal (50) and
below the `uiConfirm` overlays (80), so a delete confirmation still lands on top. The
chrome is dark in **both** themes deliberately — a photograph judged against a light
surround reads differently.

### Exporting to CSV
The Log tab's **Export CSV** asks which range first — **this week / last 8 weeks /
everything** — and every one of them FETCHES. Building the file from the rows already on
screen would make "Everything" quietly mean the 8 weeks the log view holds, which is the
whole reason the picker exists.

🔑 `bin-dump-list` takes `weeks=all` to lift the time bound. 52 is the numeric maximum and
stops being "everything" the moment this table is a year old, so `all` is a distinct value
rather than a large number. "This week" asks for **two** weeks and narrows by WEEK KEY —
`weeks=1` is the last seven days, a different set on any day that is not Sunday.

🛑 **The row cap is reported, never silently applied.** The query asks for `limit + 1`,
which is what distinguishes "there were exactly `limit` rows" from "there were more and you
are not seeing them"; a length check alone cannot. A truncated export raises a **modal**,
not a status line — somebody who misses it hands over a partial file and nothing downstream
ever says so.

🛑 Export messages go to `#bd-log-status`, NOT `bdSetStatus`. `#bd-status` lives inside the
**scan** pane, which is hidden whenever the log is open — the original "Nothing to export
yet." message had this fault and was never once seen.

🔑 The file leads with a **UTF-8 BOM**, like `downloadWrsAsCsv`. Without it Excel renders a
pallet name containing an en-dash as mojibake, which reads as bad data rather than a bad
encoding and gets "corrected" by hand.

The three-way prompt is `uiChoose`, added to `_uiDialog` rather than given its own overlay —
the same reason the other three share it: native `confirm()` freezes the installed app on
iOS. Cancelling a chooser resolves **null**, not `false`, because `false` is a legitimate
choice value and the two must never collide.

## Guards
- 🛑 A field the model cannot read comes back **null**, never a guess — a wrong unit count
  is invisible in a way a blank is not. Nulls surface as the red "not on the tag" state.
- 🛑 `bin-dump-log` re-validates every field server-side. The verify popup is a
  convenience, not a gate.
- 🛑 **Duplicate BARCODE within 90 days, at ANY store → blocked**, with a deliberate
  override. A barcode is one physical pallet, so a repeat means its units are about to be
  counted into the bins twice. `bin-dump-log` and `-update` return **409
  `DUPLICATE_BARCODE`** unless `allow_duplicate` is *literally* `true` — truthiness is not
  consent, and a test pins that `"false"`, `0`, `""` and `null` all still refuse.
  🔑 **The worker is the boundary.** The popup only asks; the client pre-flights via
  `bin-dump-recent` purely to avoid uploading a 250 KB photo that is about to be refused,
  and retries once on a 409 for the race it structurally cannot see — two people unloading
  the same truck at the same moment.
  🔑 **Cross-store, but redacted.** A match at a store the caller does not hold comes back
  as a date and nothing else: no store, no name, no pallet. Enough to stop them, nothing
  leaked.
  🛑 **The refusal precedes the R2 put**, so a blocked submit leaves no object with no row
  pointing at it. Asserted twice — behaviourally against the mock bucket, and against the
  source ordering, which is also checked in the deployed bundle.
  🛑 A blank barcode is **not** a duplicate of every other blank, or a torn tag becomes
  unloggable. The early return that guarantees this cannot be caught behaviourally (SQL's
  `= NULL` matches nothing either way), so it is pinned at the source with that reason.
- ⚠️ Duplicate PO/WO within **six hours** at the same store → **soft warning**, never a
  block. Six hours is one receiving session: a truck of 30 pallets is unloaded over hours.
  One PO covers all 30 pallets, so repeating is normal — which is exactly why the barcode
  check above had to be a separate, harder rule. Skipped when the barcode question was
  already asked: one pallet, one interruption.
- ⚠️ An unreadable photo opens the popup **empty and editable** rather than failing, so a
  torn tag can still be keyed by hand.
- ⚠️ Editing never touches `logged_at`. A correction is a correction, not a re-receipt —
  moving the timestamp would silently move the pallet into a different week.

## Deploy order
**Migration FIRST, then the worker, then the frontend.** Derive it from which side stops
being backward-compatible: adding a nullable column is invisible to the old worker, but
the new worker *requires* it. And `CACHE_NAME` in `sw.js` bumps with the frontend, with
`scripts/fixtures/shell-cache.json` in the same commit, or installed phones keep serving
the old bundle for a launch.

🛑 **This was violated once.** `migration-059` failed to run (see below) while
`wrangler deploy` succeeded, putting a worker that reads `sup_ref` in front of a database
that might not have had it. It turned out production already had the column, so nothing
broke — but the window was real and the ordering is not optional.

⚠️ A bare `wrangler deploy` targets the **top-level** environment, which binds
`env.DB = labor-dashboard-db` — **production**. Staging lives under `[env.staging]` and
needs `-e staging`. Wrangler warns about this; the warning is worth reading.

## Status — shipped 2026-09-08

| PR | what |
|---|---|
| #192 | the feature: table, seven actions, the page |
| #193 | docs |
| #194 | the log moved to a tab |
| #195 | delete, for managers at their own store |
| #196 | the second tag format — `sup_ref`, `PO / WO`, order-based pairing |
| #197 | "1 unit" not "1 units"; a `tasks/lessons.md` entry |
| #198 | the full-screen zoomable tag viewer |
| #199, #200 | this document, and the lessons behind it |
| #201 | the duplicate-barcode block, `migration-060`, the DUP badge |

- `scripts/test-bin-dump.mjs` — **209 assertions**
- Full repo suite — **3620 assertions / 58 suites**, green
- `sw.js` CACHE_NAME at **v176**, fixture in step

**Databases.** `migration-058` applied to staging (1.74 MB) and production (5.10 MB).
`migration-059` is **applied on BOTH**, verified 2026-09-08 by reading the schema rather
than inferring it — `pragma_table_info('bin_dumps')` returns the same 16 columns ending in
`sup_ref` on each, at the sizes above:

```
STAGING     | cols: 16 | sup_ref: YES | 1.74 MB | idx_bin_dumps_barcode: YES
PRODUCTION  | cols: 16 | sup_ref: YES | 5.10 MB | idx_bin_dumps_barcode: YES
```

`migration-060` was applied to both on 2026-09-09, after a read-only check confirmed
neither already had the index.

🔑 **A Claude Code remote session can query D1 directly** — `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` are in its environment, and `npx wrangler d1 execute <uuid>
--remote -y --json --command="..."` works. So the schema is a thing to **check**, never to
deduce from whether a migration command errored. Address databases by **UUID**: the staging
one lives under `[env.staging]` and a bare name does not resolve, and a UUID cannot be
confused for the other database the way a name can.

**Worker.** Version `c8fce7f8` for #192, later `217c7f9a`. Deploy output verified each
time to still carry the `MEDIA` binding, `BL16_MERCHANT_ID` and all **6** crons — the
three things a past deploy silently dropped. Rollout confirmed by polling to three
consecutive passes, because a single hit mid-rollout proves nothing.

✅ **The first live scan of a real pallet tag read all seven fields correctly.** That is
the one thing the whole suite could not prove: every test before it ran against a fixture
derived from a single photograph, so a green suite only ever showed the code was
self-consistent about a layout nobody had checked against a camera.

✅ **Both tag formats now read correctly against a real camera.** Tag A on the first live
scan; tag B confirmed 2026-09-09, which is what the order-based prompt rewrite existed for
and the one thing the fixtures could never prove.

✅ **The duplicate block works in production**, confirmed 2026-09-09 from the data rather
than the dialog: 7 rows, 7 barcodes, **0 repeated**. The refused submit wrote nothing.

⚠️ **Still unmeasured: variance.** Both tags were photographed flat in good light. What is
not yet known is how the read holds up on a creased or torn tag, under glare, at a slant,
or on a pallet whose unit count runs to hundreds. The failure to watch for is not a blank —
blanks are visible and get typed — but a value that is wrong and plausible. If one appears,
the fix is `BIN_TAG_PROMPT` and a worker redeploy, not a rebuild.

## Review — what the build turned up

**The week had to be anchored to Eastern, not UTC.** `autoWeekOf()` was the obvious
helper to reach for, and it is wrong here: a pallet dumped at 9pm ET on a Saturday is
01:00 UTC Sunday, so a UTC-derived week files it under a week the store had not begun
working. `binDumpWeekOf()` derives the ET calendar date first. Pinned by a test that
fails if it is reverted, and the suite passes under UTC, ET and Auckland.

**The prompt rule was wrong, and only a second photograph found it.** Everything —
prompt, tests, this document — asserted that values print one line *above* their labels.
It was a correct generalisation from a sample of one, and the second tag inverted it. The
lesson is not "look at more tags"; it is that a rule naming a *direction* was the wrong
shape of rule for the evidence available. Ordering was derivable from the first tag alone
and would have survived both.

**Two colours failed contrast, and only measuring found them.**
- `.bd-tag` "NOT FOUND" in dark was **4.45:1** — just under. Now `#f87171`, 5.78:1.
- The page heading was **2.28:1 in light**. `text-accent-green` (#22c55e) is 7.81:1 on
  the dark panel and unreadable on the light one. Bin Dump uses `#166534` (7.13:1) in
  light and keeps the accent in dark.
  ⚠️ **Every other page heading in the app has this same fault** — they all use
  `text-2xl font-brand text-accent-green`. Not fixed here; that is a separate change.

All text on the page measures ≥ 4.5:1 in both themes, taken from the rendered page rather
than from the stylesheet. The viewer's chrome measures 14.98:1 and 5.74:1.

**Two defects shipped because nobody looked at the resting state.** An empty green status
pill sat under the Begin button in production — `.bd-status{display:flex}` beat `[hidden]`
— and a legend swatch rendered as a white block in dark mode because its colour was an
inline style, which cannot carry a `.dark` variant. Both were visible on first paint. Both
survived a green suite.

**Mutation-tested rather than trusted.** Every green suite in this feature was attacked
before being believed. The tag reader: eight mutations, seven caught immediately, the
eighth only once the mutation itself was written properly. The viewer: nine mutations,
nine caught. Three of the tag reader's own tests were found to be passing for the wrong
reason this way — a "staff cannot delete" case that passed via the store guard rather than
the role, a spoofed-store case that never sent a store, and an assertion that left the
actionable half of the string unpinned.

**Driven in a real browser, not just parsed.** `node --check` cannot see whether a helper
landed at top level or whether a click is wired, so the page is loaded in headless
Chromium and driven end to end. That caught the store picker coming up empty
(`currentUser` is `let`-scoped and the harness had been setting a different global), and
later confirmed the viewer's pinch, pan, clamp and anchor behaviour — including one case
where the *test* was wrong, not the code: at fit an image shorter than the stage has no
vertical overhang, so the clamp correctly pins it centred and overrides the anchor.

⚠️ **The browser runs are not committed.** Playwright is not a dependency of this repo and
adding one would break `scripts/test.sh`. They are a verification tool, not a regression
net; the committed protection is the Node-level suite.
