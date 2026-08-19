# Lessons

## Never let a colour be INHERITED, and never sign off a UI change in one theme (2026-08-19)

**Context:** Brian opened the just-shipped Buy Criteria page in dark mode on production and
the table was unreadable — "Chain default" and every column header were dark grey on
near-black. I had verified the page only in light mode and called it done.

**Root cause — two mistakes, one habit.**

1. **I set no `color` at all** on `#mc-tbl`, its `th`, `td` or `.mc-cat`. They inherited,
   and what they inherited was correct in light and invisible in dark (measured ~1.07:1
   against `op-bg`). An unset colour is not neutral — it is a value you did not choose and
   therefore did not check.
2. **The one colour I did set was a number I made up.** `#9aa0a6` for inherited cells,
   picked by eye against a white background. The repo has a whole palette for this in
   `tailwind.config.js` — `op.*` for dark, `opl.*` for light, in ink / inkDim / inkDimmer
   pairs — and I used none of it.

**Rules:**
1. **Every colour gets both themes, explicitly.** In a `<style>` block that means a rule
   and a `.dark` rule, side by side. Writing one without the other is the bug.
2. **Use the palette, never a hand-picked hex.** Light `opl.ink #14110a` / `inkDim #6b6453`
   / `inkDimmer #9c9484`; dark `op.ink #e7ecf3` / `inkDim #8893a7` / `inkDimmer #5a6478`.
   A `<style>` block cannot use the Tailwind class names, so duplicate the token VALUE and
   say in a comment that it is a token — do not invent a nearby grey.
3. **Verify in BOTH themes before saying done.** `document.documentElement.classList
   .toggle('dark')` and re-measure. Do not eyeball it: compute the contrast ratio against
   the real background (`op-bg #0a0f1a` / `opl-bg #f4f3ee`) and require ≥ 4.5:1. Doing this
   caught a second problem the screenshot did not show — `inkDimmer` measures 2.71:1 in
   light, so the "inherited" cells needed `inkDim` instead.
4. **The local server serves a STALE `tailwind.css`** whose `dark:` variants are missing
   entirely (it also lacks `max-w-2xl`). `build.sh` regenerates into `dist/` at deploy
   time, so production is right and local dev is wrong. A dark-mode check against the
   local stylesheet proves nothing — pull the shipped CSS, or measure inline-`<style>`
   colours against the known token background.

**Same-pattern watch:** any generated markup with a `font-semibold`/`text-sm` class list
and no `text-*` colour is this bug waiting to happen. Shelf Count's row label had it too
(`<div class="font-semibold text-sm truncate">`) and was fixed in the same pass.


## Measure scroll geometry on the ACTUAL scroller — `#app` is `min-h-screen`, so the DOCUMENT scrolls (2026-08-19)

**Context:** Verifying the new Shelf Count page on a 375px viewport. I set
`#main-scroll.scrollTop = scrollHeight`, measured the Save button against
`#bottom-nav`, saw it fully behind the nav, and told the user "real bug — Save is
unreachable on a phone." It was not a bug.

**Root cause:** `#app` is `min-h-screen flex` (index.html:658), not `h-screen`. A tall
page therefore grows `#app` past the viewport and the **document** scrolls; `#main-scroll`
(`flex-1 overflow-y-auto`) has `clientHeight === scrollHeight` and nothing to scroll. My
`scrollTop` assignment was a no-op, so I measured the un-scrolled position and read it as
"cannot reach". Scrolling `window` instead put Save at 612–660 against a nav top of 732 —
72px of clearance, exactly what `#main-scroll { padding-bottom: calc(7rem + env(...)) }`
(index.html:529) is there to provide.

**Rules:**
1. Before asserting an element is unreachable, prove the scroller actually moved:
   assert `scrollTop > 0`, or that `scrollHeight > clientHeight` on the box you scrolled.
   `atBottom === true` is meaningless on a box with nothing to scroll.
2. `min-h-screen` ≠ `h-screen`. With `min-h-screen`, an inner `overflow-y-auto` child is
   inert and the document is the scroller. Check which one moves before measuring.
3. **Differential check first.** The cheap disproof was to run the same measurement on an
   existing page with a bottom button (Supply Request's Submit). If the established
   pattern "fails" too, the harness is wrong, not the new code. I reached for a fix before
   reaching for that comparison.
4. The synthetic admin-page harness (hide `#login-page`, force `#app` to `display:flex`)
   reproduces DOM and behaviour faithfully but NOT layout — forcing `display` leaves `#app`
   unconstrained. Trust it for wiring and role gating; distrust it for geometry.

**Related:** `currentUser` is a top-level `let` (index.html:18168), so the harness must set
it with a BARE assignment — `window.currentUser = …` does not reach the binding and every
role guard silently returns early.


## Cross-store SUMs over daily_sales MUST filter `store IN (ALL_STORES)` — BL12 duplicates Indy's budget (2026-07-17)

**Context:** User: "we are adding Indy budget amount twice in the month to date amount."
Correct. `buildWeeklyByDayData`'s per-day + MTD aggregates did
`SELECT SUM(budget) ... FROM daily_sales WHERE date ...` with **no store filter**.

**Root cause:** `daily_sales` still holds rows for the **retired BL12 (Wyoming)** carrying an
exact duplicate of **BL16 (Indy East)**'s budget with **zero sales** (Jul 1–16: BL12 budget
$64,985 / total $0; BL16 budget $64,985 / total $76,395). So unfiltered `SUM(budget)` =
$578,331 vs correct $513,346 — Indy's budget counted twice. **Sales looked fine** (BL12 total
is 0/null), which is exactly why only the budget was wrong and it was easy to miss.

**Why Table 1 was immune:** `buildDailySummaryData` iterates `for (const store of ALL_STORES)`,
so BL12 is skipped. Only *cross-store aggregates* (which never see a store column) are exposed.
Note `getWrsRange` (worker.js ~55) already handled this with an explicit BL12/BL16 `WRS_CUTOVER`
split — the codebase knew about this trap; my new code didn't.

**Rules:**
1. Any aggregate over `daily_sales` that spans stores MUST include `AND store IN (${ALL_STORES…})`.
   Never assume the table contains only live stores — retired BL12 rows persist.
2. **Verification rule (the real miss):** when two tables in one artifact show the same metric,
   assert they're EQUAL. I had `$29,932` (Table 1 budget) and `$33,738` (Breakdown budget) in my
   own verified output and only cross-checked the *sales* figure, not the *budget*. Cross-check
   EVERY shared number, not the one that happens to match.


## Never deploy the worker with a wrangler.toml copied from the main-repo working dir (2026-07-15)

**Context:** Shipping the daily-email tables from a partial git worktree (created with
`--no-checkout` because a full checkout hit `mmap failed` on the big files). The worktree
had no `wrangler.toml`, so I `cp`'d it from `/Users/brianhoward/Desktop/labor-dashboard/`
— but that working copy is a **stale 90-line version** on the `flow-calendar-editor`
branch. Deploying it silently **regressed prod config**: dropped the `MEDIA` R2 binding,
dropped `BL16` (Indy East) Clover creds, and changed the daily-summary cron `0 12`→`0 10`.

**Root cause:** `wrangler.toml` IS git-tracked at origin/main (119 lines, correct), but
the branch working copy had drifted. I trusted the on-disk file over the tracked one.

**Rule:** When deploying the worker from a worktree missing `wrangler.toml`, restore it
from git: `git show origin/main:wrangler.toml > wrangler.toml`. **Never** copy the
main-repo working file. After EVERY `wrangler deploy`, read back the printed bindings
(MEDIA, BL16_*) and the 6 crons before trusting it. Also: push the deployed worker.js to
`main` so main == prod and a later main-based deploy can't revert it. Fixed by redeploy
with the tracked config (version a4922cdd).


## Don't call a CSS transition class "inert" without checking classList toggles (2026-07-07)

**Context:** Diagnosing the mobile bottom nav (`#bottom-nav`) floating mid-content on
iOS. I told the user its `transition-transform duration-300` class was "inert — no JS
drives it," after grepping only for `#bottom-nav.style.transform`. That was **wrong**:
`onScroll()` (index.html ~14683) toggles `translate-y-full` on it (hide on scroll-down,
reveal on scroll-up). The transform IS driven — via a **class toggle**, not inline style —
and that self-transform of a `position:fixed` element is a compositor-layer trigger that
aggravates the iOS bug.

**Lesson:** To decide whether a `transition-*` / animation class is live, grep for BOTH
`classList.(add|remove|toggle)('<the-class>')` AND `.style.<prop>` on that element — a
Tailwind `transition-transform` is usually driven by a utility-class toggle
(`translate-y-full`, `translate-x-0`, `opacity-0`, …), not by `.style.transform`.

**Root cause fixed:** `#bottom-nav` was `position:fixed` but nested inside `#main-scroll`
(an `overflow-y:auto` subscroller). iOS/WebKit intermittently mis-composites a fixed
element inside a non-root scroller during momentum/rubber-band scroll → it strands
mid-content. Fix = hoisted the nav out to be a direct child of `#app` (sibling of
`#main-scroll`), so its containing block is the viewport. Verified via DOM parse
(ancestors = `['app']`) and by confirming `#app`/`body` carry no
transform/filter/will-change/contain.

**Same-pattern watch:** `#more-scrim`, `#more-sheet`, `#swipe-rail`, `#swipe-label`,
`#ptr-hint` are STILL fixed-inside-`#main-scroll`. Lower risk (transient and/or shown only
while scroll is locked), but if any must pin to the viewport during scroll, hoist it too.
Verification note (reaffirmed): the dashboard needs the remote worker + auth, so a static
desktop preview can't drive it — and the iOS compositor glitch can't be reproduced on
desktop; on-device confirmation is the final step.

## Auditing period-LABELS after a selector/picker refactor (2026-07-03)

**Bug:** After the week/day-chip picker was replaced by the date-range picker
(commit `7078013`, default preset "Today"), the "Weekly" All-Stores Budget card
showed *today's* total, not the week's. Root cause: the refactor retargeted the
card's actual/budget sum from `r.week === selectedWeek` to `rowInSel(r)` (the
selected range), but left the label hardcoded "Weekly" and left the sibling
Monthly block anchored to the calendar month. With preset "Today" the range
collapses to one day → "Weekly" == today.

**Lesson — when refactoring a global selector, audit EVERY consumer that renders a
fixed period label.** A value summed over the *new* range under an *old* fixed
label ("Weekly", "Monthly", "This Week", "MTD") is a silent mislabel. The
refactor changes the data source but not the label string, so it looks fine in
code review and only shows wrong at runtime.

**How to catch it fast:**
- Grep the fixed period words (`Weekly`, `Monthly`, `This Week`, `WTD`, `MTD`) and
  check each one's *value* is computed on a matching period, not `rowInSel`/
  `dateRange`.
- **Cross-check siblings.** The Monthly block was correct (anchored to the month
  of the range end); the Weekly block wasn't. A half-migrated pair is the tell.
- Prefer the already-correct pattern in the file: `isCurrentWeek ? 'This Week' :
  \`Week ${selectedWeek}\`` (used at ~line 5835/8223) — don't hardcode the label.

**Same-class instances found & fixed in the same pass:** the shared
`_buildChartCardHTML` "This Week" stat tile (store-detail + all-stores chart
cards) mislabeled a *past* selected week as "This Week"; now threaded a `twLabel`
param from `isCurrentWeek`.

**Verification pattern that worked:** modeled OLD (`rowInSel`) vs NEW
(`r.week === selectedWeek`) over synthetic multi-day week data in a standalone
node script and asserted OLD==today / NEW==full-week / today-counted-once. A
static preview was useless here (dashboard needs the remote worker + auth), so a
data-model reproduction was the right proof.

## Boot race: role-gated UI decided before auth resolved (2026-07-21)
**Bug (user-reported):** admins sometimes opened the app to a 4-icon bottom nav
WITH the Submit (upload) button — manager layout flashed/stuck for admins.
**Root cause:** `syncBottomNav` inferred the role by mirroring sidebar
visibility (`vis('nav-inventory')`). Before `checkAuth()`/`applyRoleUI`
resolve, EVERY role-gated sidebar item is hidden, which is indistinguishable
from "non-admin" — so any pre-auth `navigateToPage` produced the manager bar.
Nothing re-synced after `applyRoleUI`, so the wrong bar could persist until
the next navigation, making it timing-dependent ("sometimes").
**Fix pattern (generalize):** mirror-based gating inherits the mirror's BOOT
state. Any UI keyed off another element's visibility must (1) hold a
conservative default until an explicit `roleReady` flag flips, and (2) be
re-synced BY `applyRoleUI` itself, not wait for the next user action.
**Test pattern:** extract the real inline IIFE from index.html and run it in
node `vm` with a stub DOM (scratchpad navprev/test_race.js) — replays
boot → auth-lands sequences per role without a browser.

## Brace-matching source extractors MUST skip comments (2026-07-31)

**Context:** Building a node harness for the supply-request purge by extracting the
real handler source out of `worker.js`/`index.html` — the pattern this project uses
constantly (sendInviteEmail, the SW fetch handler, the boot-race IIFE, print builder).

**Bug:** my `braceBlock()` tracked string literals but not comments. A code comment
containing **`isn't`** presented a lone apostrophe, the scanner entered
"inside a string" mode and never left, so brace counting stopped and the extractor
swallowed the **rest of the file** — silently returning ~10 unrelated functions
glued on. It surfaced only as a downstream `Unexpected token ')'`.

**Why it nearly passed:** my sanity checks were `length > 400` and "contains
`env.DB.batch`". An over-capture passes both trivially. Under-capture is loud;
over-capture is silent — extra `if` blocks that never match are simply inert, so a
harness can go green while testing a blob you did not intend.

**Rules:**
1. A brace matcher over real source must handle **four** states, not one:
   `//` line comments, `/* */` block comments, quoted strings (with `\` escapes),
   and template literals. Shared correct implementation:
   `scratchpad/extract.mjs` — copy it, don't rewrite it.
2. **Bound the extraction on BOTH sides.** Assert `length < someMax` and that the
   slice does NOT contain a symbol you know lives outside it (e.g. the next
   endpoint's action string). "Not too short" is only half a check.
3. Print `slice(-40)` of every extracted block once and eyeball that it ends where
   you meant. Cheap, catches this instantly.

**Same-pattern watch:** every existing harness in this project that hand-rolls a
brace matcher has this flaw. They happened to extract functions whose comments have
no apostrophes.


## `node:sqlite` beats a hand-stubbed D1 (2026-07-31)

**Context:** verifying the supply-request purge endpoints, which delete across three
tables and depend on FK-cascade behavior, ISO-vs-space date sorting, and `IN (?,?)`
binding.

**Finding:** node v24 on this box ships **`node:sqlite`** (`DatabaseSync`). A ~15-line
D1 shim (`prepare`/`bind`/`all`/`first`/`run`/`batch`) over it lets a harness run the
**real SQL** against the **real schema loaded verbatim from `migration-011.sql`** —
no query-string pattern matching, no re-implemented semantics. 65 assertions,
including exact 29-day/31-day boundary behavior I would never have trusted from a stub.

**Rule:** when the thing under test is SQL, load the real migration into
`node:sqlite` rather than stubbing `env.DB`. Set **`PRAGMA foreign_keys = OFF`**
deliberately, so the test proves the code's explicit deletes work without cascade
help — D1's FK enforcement is not something to assume either way. (Prod showing zero
orphans proves only that nobody has deleted yet, not that cascade fires.)

**Also:** D1/SQLite rejects a long `UNION ALL` probe with
`too many terms in compound SELECT` — split diagnostic queries into batches of ~4.

## The zero-order guard does NOT catch a PARTIAL Clover fetch (2026-08-03)

**What happened:** re-snapshotting BL4 over 2026-05-05→08-02, the oldest date came
back from Clover with **153 of its 241 orders** and overwrote a complete snapshot.
`netSales` fell $3,229.91 → $2,124.47 against a D1 truth of $3,229.91. The endpoint
reported `written=16, skipped=0, errors=0`.

**Why the guard missed it:** `backfill-items-snapshots` only consults D1 *inside*
`if (itemData.orderCount === 0)` (worker.js ~8454). At 153 orders the branch never
runs, so the independent `d1Totals` lookup — which the endpoint **already loads for
the entire range** — is never compared. The guard was built for the 7/28 failure
(a clean empty array) and Clover degrades at the ~90-day retention edge by returning
*fewer* orders, not zero.

**Aggravating factor — this was predicted and then walked into.** I identified this
exact gap before deploying, the user chose "fix the guard first", the work then
pivoted to an unrelated bug, and I ran the backfill anyway with the guard unchanged.
Same shape as the 7/28 note: *finding a landmine and documenting it is not the same
as not stepping on it.*

**What saved it:** the full key-range backup (sha256 per key) taken before the first
write. One date damaged, restored byte-exact, read back and hash-verified. Total
recovery. **Never run this endpoint without that backup.**

**Rules:**
1. **Guard on MAGNITUDE, not just zero.** Compare computed `netSales` against
   `d1Totals[store|date]` on EVERY write and refuse when it falls materially short
   (a ratio, not equality — item-line net and headline total differ legitimately;
   measure the healthy-day ratio first to pick the threshold).
2. **Spot-check the FIRST chunk before letting the rest run.** Checking one date from
   chunk 1 caught this after 48 dates instead of 90. Cheap, and it bounds the damage.
3. **The oldest dates in a window are the dangerous ones.** Degradation at the
   retention edge is gradual, so a range that "works" at its recent end can still be
   corrupting its old end. Verify oldest-first.
4. `written=N, skipped=0, errors=0` still verifies nothing. Reconcile against D1.

## Wait for propagation before verifying a worker deploy (2026-08-03)

**What happened:** shipped the backfill magnitude guard, `wrangler deploy` returned
version `cd6a1a8d`, and I immediately re-ran the operation the guard was built to
stop. It wrote anyway — `written=1`, guard silent — and re-damaged the same date.

**The trap:** this is indistinguishable from a broken fix. I spent a diagnostic pass
verifying the D1 query returned the right row, the `store|date` key format matched,
`aggregateItemSales` really returns `totals.netSales`, the guard was inside the date
loop and before the write, and the version was active at 100%. **All of it checked
out, because none of it was wrong.** Re-running the identical call a few minutes
later: `written=0, skipped=1, ratio 0.3619`, snapshot sha256 byte-identical.

**Rules:**
1. After `wrangler deploy`, give the worker time before testing the changed path.
2. **If a just-shipped fix appears inert, RE-TEST before you diagnose.** One repeat
   call is cheaper than an hour of tracing correct code.
3. When the verification itself is destructive, this matters doubly — the failed
   verification damaged production data a second time. Have the restore ready
   before you verify, not after.

**Related measurement:** Clover's ~90-day retention decays hour to hour — the same
2026-05-05 fetch returned **153 → 89 → 87** orders across one afternoon. A date at
the edge degrades while you are working on it, so "how short was it" is not a stable
number.

## Read the third-party API reference before probing it (2026-08-03)

**What happened:** removing an item from a Clover category. I guessed
`DELETE /categories/{catId}/items/{itemId}` → 405. Guessed
`DELETE /category_items` → 405. Then looked it up: the real call is
**`POST /v3/merchants/{mId}/category_items?delete=true`** with the same element
body as the assign. Not an HTTP DELETE at all.

Two wrong guesses cost two full deploy-and-probe cycles on production.

**Rules:**
1. For an unfamiliar third-party endpoint, **read the reference first**. One doc
   lookup is faster and cheaper than a deploy, a propagation wait, and a probe.
2. **Capture the upstream status and response body on failure.** A bare
   `ok: false` gave me nothing; `405 DELETE not allowed` instantly ruled out auth
   and bad IDs and pointed straight at the method. That one diagnostic commit is
   what ended the guessing.
3. Symmetry is a weak prior. `POST /category_items` creates an association, so
   `DELETE /category_items` *looks* obvious — and is wrong. Clover overloads POST
   with `?delete=true`.

**Related:** the same session's propagation lesson applies — after each of these
deploys I had to wait before probing, so a wrong guess costs far more than the
edit itself.

---

## Verify a security guard with a probe that CANNOT do damage if the guard failed
**2026-08-03 — Phase 1 admin hardening**

I shipped POST-only guards on seven endpoints that previously executed on a plain
GET, including `backfill-items-snapshots` — the one that destroyed 81 days of BL1
history in July. Then I had to prove the guard held on production.

The obvious test is circular: "GET the endpoint and see if it runs." If the deploy
silently failed, that probe *performs the destructive write I was trying to prevent.*
A verification step must never be able to cause the harm it is checking for.

**What worked** — three of the seven validate `?store=` before touching anything, so
I probed them with the param omitted. The only reachable code path was the validation
error. That made the test both safe and sharp:

| | guarded (correct) | unguarded (deploy failed) |
|---|---|---|
| GET | generic fall-through, same as a nonexistent action | the handler's own `Missing store param` |
| POST | handler's own validation error | same |

A control probe (`?action=no-such-action-xyz`) confirmed the guarded GET response was
byte-identical to a nonexistent action, and a second control (`category-costs`, left
unguarded) confirmed dispatch still worked at all — otherwise "everything falls through"
would look identical to "I broke the router."

**Rules:**
1. **Design the probe so a FAILED guard is still harmless.** Prefer a path that dies
   at input validation over one that dies at authorization.
2. **Two controls, always**: a known-absent case (what does "not matched" look like?)
   and a known-present case (is the system still routing at all?). Without the second,
   a total breakage reads as a total success.
3. **A global auth gate can mask everything.** My first probe returned 401 for all seven
   guarded actions — and also for `stores` and `health`. The session check fires before
   dispatch, so the test proved nothing. Check your discriminator actually reaches the
   code under test before believing the result.
4. **Order the deploy so the gap is safe.** Frontend first, then worker: POST to an
   unguarded endpoint already works, so the intermediate state is harmless. The reverse
   leaves the admin page broken until Pages catches up.
5. Worker propagation was **~180 s** here — far longer than the usual few seconds.
   Poll for the expected change rather than sleeping a fixed guess.

---

## A green unit suite says the logic is consistent, not that it's right
**2026-08-03 — Repair console health check**

I shipped a read-only health check with 60/60 assertions passing, covering every
status bucket, the threshold boundary, the arithmetic, ordering and truncation.
Then I pointed it at production and it was wrong three separate ways.

1. **Today.** It reported five stores "missing" — every one dated today, whose
   snapshot the nightly cron simply hadn't written yet. Headline: **$19,233
   recoverable, all of it phantom**, and acting on it would have re-snapshotted
   unfinished days, the exact needless re-pull that loses refunds.
2. **"No row" vs "row holding zero"** — conflated. They look identical downstream
   and mean different things: a cron that never ran vs one that wrote a zero.
3. **Both records agreeing on zero** — reported as "cannot judge". BL8 had 12 such
   days. Two independent sources agreeing a store took no money is a *closed day*.
   I had invented a data-integrity problem out of a business fact.

Every one of these is a **modelling** error — a wrong belief about what the data
means — and unit tests can't find those, because I write the fixtures from the
same wrong belief. My fixtures asserted a snapshot-less day is "missing" because
that is what I thought. The test agreed with me and proved nothing.

There's a tell for this category: **all three bugs made the tool report a problem
that did not exist.** A diagnostic whose first real run finds a large, alarming
number is more likely mis-modelled than lucky — real systems are usually boringly
fine. $19,233 across five stores, all conveniently dated today, should have read
as suspicious before it read as a finding.

**Rules:**
1. **Run a finished diagnostic against production and read the output critically
   BEFORE trusting it.** Ask "is this plausible?" not "did it return 200?".
   Cheap here precisely because the tool was read-only by construction.
2. **Interrogate the alarming result first.** If a first run reports a big number,
   assume the tool before assuming the data. Check whether the flagged rows share
   something — all one store, all one date, all today. Mine shared *today*.
3. **"Absent" is at least three states**: not yet produced, produced-then-lost, and
   legitimately nothing. Collapsing them into one bucket guarantees a wrong call.
4. **Two independent sources agreeing is evidence, not ambiguity.** Snapshot $0 +
   D1 $0 + 0 orders is the strongest possible signal the day sold nothing.
5. 🛑 **Never write a fixture on today's date.** The `pending` rule reclassified my
   static fixtures and the suite would have failed once a day, forever. Pin them to
   a window that can never be "now".
6. A test suite that passed before AND after a real bug was found is not vindicated
   by its own green — add the regression and treat the coverage claim as reduced.

---

## An equivalence test between two builds proves nothing until the fixtures reach the code
**2026-08-03 — extracting rebuildItemSnapshot()**

To share the two data-loss guards between the backfill and the new Repair console
I extracted the per-date body into one function. That code path has permanently
destroyed production history three times, so I wrote a differential test: drive
the REAL handler in the old build and the new one through identical fixtures and
compare the responses.

It passed 12/12 immediately. It was worthless. I had guessed the Clover credential
env var names, so `fetchItemOrders` returned `null` in **both** builds and every
scenario produced `{"error":"no credentials"}`. Two builds failing identically is
perfect equivalence and zero coverage — the guards I was trying to protect never
executed once.

The real names were `${store}_MERCHANT_ID` / `${store}_API_TOKEN`. With those in
place the guards fired and the comparison started meaning something — and
immediately found a real difference: the extracted function returned detail keys
in a different order, so responses differed byte-wise. Cosmetic, but I only got to
see it because the test was finally doing work.

**Rules:**
1. **Before believing an equivalence result, prove the fixtures reached the code
   under test.** Assert something positive — a write happened, a guard note
   appeared, a non-zero total came back. "Both sides agree" must never be the only
   assertion.
2. **Identical failure is identical.** Any differential test where both sides error
   is green by construction. Treat an all-green first run of a differential suite
   as suspicious, not as success.
3. **Don't guess integration names — grep them.** One `grep -n "async function
   fetchItemOrders" -A4` would have shown `env[\`${store}_MERCHANT_ID\`]` and saved
   the whole detour.
4. **Compare byte-for-byte, then fix the code to match, not the test.** Preserving
   the original key order made the refactor a provable no-op. Relaxing the
   comparison would have hidden the one real difference the test found.
5. When extracting shared code, the extraction is the risk — not the new caller.
   Test that the OLD caller still behaves identically before testing the new one.

---

## Poll on the whole condition, not one member of it
**2026-08-03 — verifying the Phase 4 endpoint removals**

I deleted four endpoints, deployed, and waited for propagation with a loop that
polled `debug-refunds` until it fell through. It did, so I ran the verification —
which reported two of the four as **"STILL LIVE"**.

They weren't. Cloudflare rolls a new version across instances gradually, so
consecutive curls land on a mix of old and new. My loop had confirmed one member
of the set and I generalised to the set. Re-polling on all four, and then
confirming three passes in a row, showed all four gone.

The failure mode is the interesting part: this produced a **false alarm about my
own deployment**, on a change whose entire purpose was removing things. Had I
believed it, the next move would have been to re-deploy or start hunting a
non-existent bug in the deletion.

**Rules:**
1. **Poll on exactly the assertion you are about to make.** If the claim is "all
   four are gone", the wait condition is "all four are gone" — not "one is gone".
2. **On a gradually-rolled deploy, require N consecutive clean passes**, not one.
   A single pass can be served entirely by updated instances by luck.
3. **A mixed old/new reading looks exactly like a partial failure.** Before
   diagnosing a half-applied change, re-run the check — non-determinism across
   repeats is the tell.
4. This is the second propagation trap in one session (the first: verifying ~180s
   too early and reading old code). Both cost real time. Treat "did the deploy
   actually land, everywhere?" as its own explicit step, never an assumption.

---

## `head -1` on a list you did not check the order of
**2026-08-04 — promoting a Worker version to production**

Migrating credentials to Worker secrets needed a specific version promoted. I
did:

    VID=$(npx wrangler versions list | grep -oE '<uuid>' | head -1)
    npx wrangler versions deploy "$VID"@100

`wrangler versions list` is **oldest-first**. `head -1` handed me a build from
that morning, and I deployed it to production — silently reverting three phases
of work for the several minutes it took to notice. Nothing alerted; the smoke
test I ran even passed, because the thing I was testing (Clover access) worked
fine in the old build too.

Two compounding errors:
1. **I assumed an ordering I never checked.** One `--format` with timestamps
   would have shown it. I only looked *after* the deploy misbehaved.
2. **My smoke test could not detect the failure.** It checked Clover access,
   which was healthy in both versions. A verification that passes on the wrong
   artifact is not a verification.

**Rules:**
1. **Never `head -1` / `tail -1` a tool's list output without confirming the
   sort order**, ideally in the same command — print the timestamp you are
   selecting on and eyeball it before acting.
2. **Prefer selecting by identity over position.** I *had* the version ID from
   the upload step's own output; I threw it away and re-derived it by position.
   Capture the id the creating command gives you and use that.
3. **A deploy check must assert something UNIQUE TO THE NEW ARTIFACT.** Test a
   feature that exists only in the version you meant to ship, not a capability
   both versions share. Here `?action=secret-check` was the right probe and
   `sales-diag` was the useless one.
4. Record a rollback target *before* deploying (I did — that part worked, and
   made the recovery a single command).

---

## curl probes that silently answer a different question (2026-08-09)

**Twice in one session** a `curl` verification reported a false negative because
the request never carried what I thought it carried. Both times my first
instinct was to believe the probe and blame the system under test.

1. **`$(cat)` inside `curl -H`** — the substitution competes with curl for
   stdin, so the header went out empty and every call 401'd. I told Brian prod
   was holding a different token. It wasn't; the probe was.
2. **Missing `-L` on a redirecting host** — `staging.retjghub.com/index.html`
   302s to `/`. Without `-L`, grep ran against the redirect body, so *every*
   marker read absent. I nearly reported the staging deploy as not landed while
   `sw.js` was already serving the new build.

**What made #2 catchable was the shape of the failure, not the failure itself.**
The poll printed `old-gone=1 new-css=0 staging-api=0`. Those cannot all be true
of any real build of this app: the old rule and the new rule can't both be
missing, and the app always references *some* API host. Three independent
assertions disagreeing in an impossible way means the probe is wrong.

**Rules:**
1. **Assert one thing that must be TRUE of any healthy response**, alongside the
   thing you're testing for. A probe made only of "X is absent" checks passes
   perfectly against an empty body, a redirect, an error page, or a login wall.
   Here the load-bearing control was `api-staging.retjghub.com` — always present,
   independent of the change.
2. **Check `%{http_code}`, `%{size_download}` and `%{url_effective}`** on the
   first call of any new probe. `url_effective` is what exposed the redirect in
   about two seconds after two minutes of polling nothing.
3. **An impossible combination of results is a bug in the probe**, not a
   discovery about production. Read the response body before forming a theory.
4. Prod and staging do **not** serve identically. The same probe passed on prod
   and failed on staging purely on redirect behaviour. Verifying environment A
   says nothing about whether the probe is valid for environment B.

---

# Read a file before Write overwrites it — `tasks/todo.md` is not scratch space

**2026-08-10, channel-filter work.** CLAUDE.md says "write plan to tasks/todo.md",
so I called Write on it directly. It was a **tracked file holding the active eBay
Cases Slice 2b plan** — ~420 lines of build notes, mutation results and a
sidebar-diff table. Write overwrote all of it. Recovered with
`git checkout HEAD -- tasks/todo.md` only because it was committed; had it been
one of this repo's many untracked `tasks/*.md` files, it would have been gone.

The tell was there before I wrote: the session-start `git status` listed nine
untracked `tasks/*.md` files and `todo.md` was **not** among them — meaning it
was tracked, meaning it existed and had content.

**Rules:**
1. **Write on a path you have not Read is an overwrite, not a create.** Read it
   (or `git show HEAD:<path>`) first, every time, even when a convention names
   the file for you. Edit is the safe default; Write is for files you know are new.
2. **A convention that names a fixed path ("write the plan to tasks/todo.md")
   assumes that path is yours.** In a repo with concurrent workstreams it is not.
   Use a task-specific name — `tasks/<feature>.md`, matching the eight other
   named plan docs already there — and leave `todo.md` to whoever is using it.
3. **`git status` at session start already tells you what is tracked.** A file
   absent from the untracked list is a file with committed content.

---

# One domain fact, three encodings, two answers — Hamilton Beach

**2026-08-10, Retail Summary L2 mapping.** Brian: "hamilton beach mapping is
[supposed] to be under Home L2." It was — in one of the three places the repo
encodes that fact:

| Site | Answer |
|---|---|
| `L3_TO_L2["FG BL HAMILTON BEACH"]` | Home ✅ |
| `L3_TO_L2["Hamilton Beach"]` | **Hardlines** ❌ |
| `HAMILTON BEACH` token inside the Hardlines name heuristic (×2 loops) | **Hardlines** ❌ |

So the same physical product booked to a different L2 depending only on which
Clover category string the store attached, and an item with no category at all
got a third answer. Nothing errored — the money just landed in the wrong bucket.
This is the same shape as the `|| "Hardlines"` silent default and the two
`SKU_BOOK_TO_L2` typo keys: **a categorization mistake is invisible by
construction, because every branch produces a plausible category.**

The wrong entry was also physically parked between the two Softlines lines,
nowhere near its sibling in the Home block — which is how it survived every
prior read of that table.

**Rules:**
1. **When told a mapping is wrong, grep the VALUE and the KEY case-insensitively
   across the whole repo before editing.** `grep "Hamilton Beach"` found one
   site; `grep -i hamilton` found four. The heuristic regexes hold the same
   domain facts as the lookup tables and are never where you look first.
2. **`aggregateItemSales` encodes each fact twice** — the main line-item loop and
   the cross-day refund-attribution mirror (~line 3010) are copy-pasted
   ladders. A fix applied to one and not the other makes refunds book to a
   different L2 than the sale they reverse.
3. **Keep the key next to its siblings.** A `"Hamilton Beach": "Home"` sitting in
   the Softlines block is a future bug; grouping is the only structure that table has.
4. **Mutation-test a mapping fix, one site at a time.** Reverting the table entry
   killed 2 assertions and reverting the regexes killed 3 *different* ones —
   that separation is the proof each site is independently covered. A single
   combined revert would not have shown it.
5. **`L3_TO_L2` is mirrored client-side as `ISR_L3_TO_L2` (index.html).** It
   drifts — it was 17 keys behind. Any change to one needs the other, and the
   diff is worth running as a check, not a read.
