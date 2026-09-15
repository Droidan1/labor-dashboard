# Items sold, inside the transaction drawer (2026-09-15)

Brian: *"When a user clicks on a transaction can we add the items sold as clickable an option?"*
Answers to the two clarifying questions:
- **The items list is the click.** Detail drawer as now, plus an `Items sold (N)` row that
  expands into the receipt. Items are listed only — no navigation anywhere else.
- **Archive them too.** New table + re-run the 534-store-day backfill, so old transactions
  keep their items.

## What makes this non-obvious

Line items belong to the **order**, not to the payment. Measured against production D1:

| | |
|---|---|
| orders with a payment | 115,798 |
| of those, split-tender | 1,091 (**0.94 %**) — worst case 5 payments on one order |
| payments with no order | 0 |

So 99 % of the time the order's items *are* that transaction's items, unambiguously. The
remaining 0.94 % must be **labelled**, never quietly presented as one payment's basket.

## Plan

- [x] `fetchTransactionOrders` — widen the expand to carry `lineItems` + `lineItems.discounts`
- [x] `buildItemsByOrder` / `buildOrderItems` — pure; merge identical lines, apply the
      line-level discount so the price shown is the price charged
- [x] `attachTransactionItems` — one function, shared by the live path and the archive path,
      so the client cannot tell which source a row came from
- [x] `itemsNote` for the three cases where the list is not "what this payment bought":
      split tender, a void, a refund
- [x] `migration-064.sql` — `payment_archive_items`, keyed on `(store, date, order_id, seq)`
- [x] Bank the items alongside the payments; read them back in `readArchivedDay`
- [x] Frontend: expandable `Items sold (N)` row in `_txnDetailHTML`, both themes measured
- [x] Tests: extend `test-transactions.mjs` and `test-payment-archive.mjs`
- [x] `CACHE_NAME` v197 → v198 + re-pin the shell-cache fixture
- [ ] **Present** the migration and the re-backfill to Brian — both are database mutations
      (CLAUDE.md rule 7), so neither runs without his explicit go-ahead

## Review

Built and tested; **nothing has been run against a database**.

**What shipped in code.** `fetchTransactionOrders` now expands `lineItems,lineItems.discounts`
on the orders it was already fetching, so live days cost no extra Clover call. Three pure
functions do the work — `buildOrderItems` (merge, discount, weigh), `buildItemsByOrder`,
`attachTransactionItems` — and the third is called by BOTH the live path and the archive read,
so a banked day and a live day come back in the same shape. The drawer grows one expandable
`Items sold (N)` row; it opens folded, and a different transaction opens folded again.

**The three things that could have made this dishonest, and what was done instead.**

| | |
|---|---|
| A split-tender order's basket shown as one payment's | the caveat opens **with** the list, naming the payment count |
| A discounted line shown at shelf price | line-level discounts applied, both the `amount` and `percentage` spellings |
| A refund's basket read as "what came back" | labelled as the original order; `refunded` lines carry a badge |

And two silences kept silent: a refund whose original order was rung on an earlier day, and a
custom-amount sale with no line items, both carry **no** `items` key rather than an empty basket.

**Where it differs from migration-063 on purpose.** `payment_archive` never deletes, because its
key is Clover's own payment id and a leftover row is a real transaction Clover has stopped
returning. `payment_archive_items` is keyed on a DERIVED `(order_id, seq)`, so a re-bank whose
merge came out differently would leave contradictions rather than old truth — it wipes the
store-day first, in the same D1 batch as the first insert. The items write is also wrapped:
if the table is missing the day's **payments still bank** and the failure is named in
`needsAttention`. Losing a day's payments to protect its receipt would be the wrong trade.

**Proof.**

- `bash scripts/test.sh` — **4316 assertions across 71 suites, all passing** (27 of them new:
  15 on the live receipt, 12 on the archived one).
- `node scripts/check-receipt-render.mjs` — **34 assertions**, a new browser check (behaviour +
  contrast) that did not exist before. Deliberately not named `test-*.mjs`: `test.sh` globs that
  and every other suite is pure Node.
- Rendered through the real `index.html` in Chromium, all three themes, contrast **computed
  against the composited background** rather than eyeballed:
  light worst **5.88:1**, dark worst **5.65:1**, pure black worst **6.35:1**. All ≥ AA.
- Behaviour checked in the same pass: no Items row until a transaction is open, opens folded,
  `aria-expanded` flips, the caveat appears with the list, the next row re-folds, and a
  single-payment order shows no caveat.

**Two defects that all of that missed.** Brian asked for a preview; rendering an actual picture
showed both in a second. `Items sold (9.5)` — the heading summed raw quantities, so a 1.5 lb
weighed line made a nine-item basket read as nine and a half. And `1.5 ×` wrapped onto two lines,
because the qty column was 54px with no `nowrap` and every integer quantity fit. Everything I had
verified, I had verified as a NUMBER. Fixed: a weighed line counts as one item however much it
weighs, and the qty cell is 62px and `nowrap`. `tasks/lessons.md` carries the rule.

# The payment archive — transaction detail that outlives Clover (2026-09-15)

Brian: **"persist the payments so history outlives the 90 days"**. Built, tested, NOT applied.

## ⏸ NOTHING HAS BEEN RUN. Two things need Brian's explicit go (rule 7)

1. **`migration-063.sql`** — creates two tables. Additive; touches no existing table.
   ```
   STAGING  npx wrangler d1 execute b40982c2-4009-4842-bc17-fa0977468b07 --remote -y --file=migration-063.sql
   PROD     npx wrangler d1 execute 3fa911d7-31d6-438c-985f-7ac08c407d2d --remote -y --file=migration-063.sql
   ```
   🔑 Those UUIDs are **not** in the order the file suggests — `3fa911d7` is PROD. Labelled in
   the migration header for exactly that reason.
2. **The one-time backfill** that seeds the archive with the ~90 days Clover still holds.
   Dry run by default; `&dry=0` writes. Suggested: one store at a time.

## The asymmetry the whole design turns on

Once a date leaves Clover's window there is **no re-pull**. So a day banked incompletely and
recorded as complete is permanent and unfixable, while a complete day recorded as incomplete
costs one re-bank. Every judgement leans the second way.

| guard | what it prevents |
|---|---|
| A failed Clover page banks **nothing** | a permanently truncated day |
| Completeness is **earned** by reconciling against `daily_sales` (±5%) | the retention-edge failure where Clover returns fewer rows and the count is merely non-zero |
| A day already `complete=1` is **refused a thinner replacement** | a re-bank quietly losing detail |
| Dry run is the **default** | an accidental write |
| Range refused past 400 store-days | a silent truncation |

`payment_archive_days.complete` is a stored fact, not an assumption. A day at `complete=0` is
visibly partial, is listed under `needsAttention`, and can be re-banked while Clover still has it.

## Two things found by reading the code, not by planning

1. **The nightly bank runs at `todayStr − 3`, not yesterday.** The clientCreatedTime sweep in
   the same cron re-snapshots today + 2 prior days, so `daily_sales` for anything newer can
   still move when an offline-rung order syncs late. Reconciling against a total that has not
   settled would mark good days unreconciled. Three days back it is final — and still 87 days
   inside Clover's window.
2. **A range IS allowed here, unlike `repair-run`.** That rule exists because re-pulling a
   healthy date *overwrites* a good snapshot with one that has lost aged-out refunds. Nothing
   is overwritten here: the archive starts empty, the row key is Clover's own payment id, and
   a complete day is refused a thinner replacement.

## Deploy order — and why it does not actually matter

Migration first, then worker. But `readArchivedDay` **tolerates the tables not existing**:
without that, a worker reaching prod before the hand-run migration would turn every
out-of-window request into a 500 instead of a clean refusal. Found because
`test-transactions.mjs` (which does not apply the migration) started throwing — so that suite
now doubles as the proof of the un-migrated path.

## Verified — 4,286 repo assertions across 71 suites + 88 browser assertions

`scripts/test-payment-archive.mjs` (35, new) drives the real worker with Clover stubbed:
POST-only and superuser-only; dry-run default writes nothing; a clean day banks and
reconciles; re-banking does not duplicate; **a failed page banks nothing**; under-reporting
against `daily_sales` lands at `complete=0` with the drift recorded; an empty fetch against a
trading day is never complete; a complete day refuses a thinner fetch unless forced; the
archive serves a date past retention with names resolved **at bank time**; an unbanked
out-of-window date still refuses by name and says where the archive starts; and a date inside
the window is still read live.

Frontend: an archived day says so and drops the "read live" wording; an unreconciled one gets
a banner separating what is wrong (this list) from what is not (the day's total).
`CACHE_NAME` v196 → v197.

# inkDimmer as text — fixed everywhere it was one (2026-09-15)

Brian: **"fix the inkdimmer text sites too"** — the ~74/89 I had reported and deliberately
held back on #228 as a design decision. Done, and the sweep found more than the utilities.

## Two populations, not one

| | sites | fixed by |
|---|---|---|
| Tailwind utilities `text-opl-inkDimmer` ×74, `dark:text-op-inkDimmer` ×88 | 162 | two CSS rules |
| Hand-written `<style>` blocks — print footer, coach step, price-scan step/elapsed, manifest & criteria close buttons, eBay chevrons | 13 | edited in place |

The second population is the one a grep for the *class name* never finds. It writes the same
colour as `#9c9484` or `rgb(var(--op-inkDimmer))` directly.

## What was deliberately NOT changed

- **`.mc-lvl`, the level badge.** DESIGN.md §4.8 prescribes inkDimmer for it by name, and its
  border carries the meaning. Asserted in the suite that it still reads `#9c9484`.
- **The two pace-bar fills** (`barColor` / `sBarColor`) — not text at all.
- **The `--op-inkDimmer` token itself**, asserted still `90 100 120`. Borders and badges keep
  the level; only *text* moved off it.
- `--mdd` in `#page-mos` is a **dead variable** — nothing reads it. Left alone.

## Two catches worth keeping

1. **`.eb-chev` / `.eb-sec-chev` had no dark rule at all** — they painted `#9c9484` in *both*
   themes, which happens to read fine on a dark ground. Swapping the single value to inkDim
   would have **broken dark mode** (1.9:1). They needed a dark counterpart added, not a swap.
   A blind find-and-replace would have shipped that.
2. **I first excluded pure black and then undid it.** OLED already passed (5.24–6.08, because
   that theme re-points the token to `#8a8a8a`), so `html.dark:not(.oled)` looked like the
   minimal-impact choice. It was the wrong kind of clever: it left three themes behaving
   differently for one token, and every hand-written site would have needed its own carve-out.
   Bringing OLED along only raises its contrast (5.73 → 8.33). One rule, one meaning.

## Verified — 4,251 repo assertions + 83 browser assertions

The decisive one is a sweep for **any element painting an inkDimmer value as text**, by
computed colour rather than by class — so it catches the hand-written sites too:

    light  0        dark  0        oled  0

Plus: each utility asserted to resolve per theme; `.mc-lvl` and the token asserted unchanged;
Item Sales 44/44 AA in three themes; Transactions 37 behaviour + 19 contrast still clean.
`CACHE_NAME` v195 → v196.

# Item Sales contrast — fixed, and it was four defects, not one (2026-09-15)

Brian: **"fix the item sales contrast issue"**. Done — but the surface had **four** failures,
not the one I had reported. Found by rendering Item Sales with real data and sweeping every
text element against its real composited background, rather than checking the thing I knew about.

| element | light | dark | fix |
|---|---|---|---|
| `text-accent-green` — Live / Refresh / Grand Total | 2.18 | pass | green-800 in light |
| `text-op-warn` — the `disc` pill | 1.99 | pass | amber-800 in light |
| `text-op-bad` — the `ref` pill | 3.30 | **4.34** | red-800 light, red-400 dark |
| `text-*-inkDimmer` — the `›` chevron | 3.01 | 2.99 | inkDim (local) |

`text-op-bad` fails in **both** themes — a saturated red on its own red wash is low-contrast
whichever way the ground goes.

## Four CSS rules, not 292 markup edits

```
html:not(.dark) .text-accent-green { color: #166534; }
html:not(.dark) .text-op-bad       { color: #a5281a; }
html:not(.dark) .text-op-warn      { color: #92400e; }
.dark           .text-op-bad       { color: #f87171; }
```

Same specificity technique as the pure-black block above them: Tailwind emits
`.text-accent-green` at (0,1,0), `html:not(.dark) .text-accent-green` is (0,2,1) and wins
without `!important` or load-order luck. A rule cannot typo across 292 sites and cannot miss
the site someone adds tomorrow.

🔑 **TEXT ONLY.** `bg-accent-green` ×127, `border-` ×89, `ring-` ×92, `bg-op-bad` ×29,
`bg-op-warn` ×23 are all untouched and asserted untouched — there the colour is the surface,
not the ink. Checked first that no site puts this text on a dark ground in light mode: the
only three class lists pairing `text-op-bad` with `bg-op-panel` write it
`bg-opl-panel dark:bg-op-panel`, i.e. white in light.

Also deleted `.txn-accent`, the local class added with Transactions — the global rule gives
the identical pair, and two mechanisms for one rule is one too many.

## ⏸ NOT fixed, and it is a decision for Brian

`text-opl-inkDimmer` / `dark:text-op-inkDimmer` used as TEXT runs to **74 / 89 sites** and
measures 2.71–3.01 light, 2.71–3.33 dark. DESIGN.md §4.8 trap 5 already says inkDimmer is for
borders and badges and `inkDim` is the muted-but-readable step — so the spec agrees it is
wrong. But darkening every dim label in the app is a **visible design change**, not just a
correctness fix, so only the two Item Sales chevrons were changed. The rest is his call.

## Verified — 4,251 repo assertions + 78 browser assertions

- **Item Sales with real data, all three themes**: all 44 text elements ≥ AA. This is the
  check that found the three extra defects; the app-wide sweep could not reach them, because
  Item Sales only exists in the DOM once it has data.
- **App-wide, 28 pages revealed, all three themes**: every rendered `text-accent-green` /
  `text-op-bad` / `text-op-warn` ≥ AA, each utility asserted to resolve to its intended value
  per theme, and every fill/border asserted UNCHANGED.
- **Transactions** (which lost `.txn-accent`): 37 behaviour + 19 contrast, still clean.
- `CACHE_NAME` v194 → v195.

# Worker deployed to production (2026-09-15)

Brian: **"deploy the worker"**. Done — `clover-sales-api` version **17f16db4-61d1-444a-9221-1333d023c898**
(was `56f0ab46`, 2026-09-14).

## What shipped

Two commits, not one. `worker.js` had **two** changes since the last deploy:
- `82ab7c9` — the Transactions endpoint (this branch).
- `97648eb` — `backfill-item-hours` from PR #224, merged to main and never deployed.

Checked before deploying that the backfill appears **nowhere in `scheduled()`** — it is
POST-only and guarded, so the deploy makes it *reachable*, not *running*. Nothing writes at
deploy time: no migration, no KV write, no D1 write.

## Verified (CLAUDE.md rule 5 — poll the full condition, consecutive clean passes)

1. Active version `17f16db4` at **100%**, three consecutive polls.
2. **Deployed bytes grepped** — `content/v2`, 907,780 B: `fetchTransactionOrders`,
   `fetchCloverLabelMap`, `buildTransactions`, `txnTenderKind`, `TXN_RETENTION_DAYS`,
   `BEYOND_RETENTION`, `BEFORE_STORE_CUTOVER`, `INCOMPLETE_FETCH` all present, and
   `["transactions", "bl"]` confirmed inside `ACTION_BUSINESS`.
3. **All 20 secrets survived**, including all seven `BL*_API_TOKEN` and `SNAPSHOT_SECRET`.
4. Live API answers `401 NO_SESSION` — serving, not 500ing.

🔑 Item 2 is new capability: the repo believed served bytes could not be read because
`/content` is 405. `/content/v2` is **200**. Recorded in lessons.md.

## Not verified, and cannot be from here

The auth gate returns 401 before the business gate, so **every** action — real, fake, or
old — answers `401 NO_SESSION` unauthenticated. There is no probe that exercises the endpoint
without a logged-in session. **The first real store-day is the functional test**, and the two
columns to look at are **Tender Type** and **Employee**: those resolve through the new
`/tenders` and `/employees` label maps, which is the part no fixture could prove.

## Frontend followed, same day

#226 merged as `fd362f4` at 14:49:57Z. Both publishers succeeded:
- **GitHub Pages Action** run #363 — success 14:50:24Z. This is the one that serves
  **www.retjghub.com** (CNAME).
- **Cloudflare Pages** production deploy for `fd362f4` — success.

So the full chain is live in the right order: worker first, then frontend.

⚠️ **The served frontend bytes could NOT be grepped from this session.** The egress proxy
answers `403` to CONNECT for `www.retjghub.com` and for `*.pages.dev`, while
`api.retjghub.com` and `api.cloudflare.com` are allowed. So the frontend is confirmed by
*both deploy pipelines reporting success on the merge commit*, not by reading what is served
— a weaker check than the worker got. Worth knowing the asymmetry before relying on it:
the worker can be byte-verified (`content/v2`), the frontend currently cannot.

# Transactions tab — BUILT (read-only, no Authorizations) (2026-09-15)

Brian, on the preview: **"cut the authorizations tab and build it read-only"**. Both done.

## What shipped

**Worker** — one new `?action=transactions&store=&date=`, store-scoped and read-only.
- `fetchTransactionOrders` — orders with `expand=payments,customers`. Deliberately NOT
  filtered to `state=locked` (unlike `fetchItemOrders`): that filter keeps a day's TOTAL
  honest, but a voided payment is exactly what the Voids tab is for and can sit on an order
  that never locked. Returns `null` on a failed page, never a truncated array.
- `fetchCloverLabelMap(store, env, resource)` — `/tenders` and `/employees`, because a
  payment carries `tender.{id}` and `employee.{id}`, never "Cash" and a person's name.
  24 h KV cache; a partial map is served but **never cached**, so the gap cannot freeze in.
- `buildTransactions(...)` — pure, no fetch/env/clock, so the whole classification is
  driven from fixtures.
- Guards: `canAccessStore` → 403 · malformed/future date → 400 · **`BEYOND_RETENTION` → 422**
  · `BEFORE_STORE_CUTOVER` (BL16) → 422 · `INCOMPLETE_FETCH` → 502 · `["transactions","bl"]`
  in `ACTION_BUSINESS`, without which the fail-closed business gate 403s every session call.

**Frontend** — a fourth tab after Item Sales, lazy-loaded (every open is a live Clover read).
Reuses the Item Sales day strip via its `onClickPrefix`, with a new `showWeek` opt-out: a
whole-week transactions view would be seven live days and thousands of rows, and Clover's own
screen is per-day. `CACHE_NAME` v193 → v194.

## Three things worth remembering

1. **The BL16 guard was dead code where I first put it.** Behind the retention wall it could
   never fire — the 90-day window start has been later than the 2026-06-14 cutover since
   2026-09-12 and only moves further out. Moved it *ahead* of the wall, where it is both
   reachable and the stronger claim: that date is not BL16's data at any retention.
   The failing assertion was the signal; the reflex to "fix the test" would have buried it.
2. **`text-accent-green` is 2.18:1 on the light bar.** I copied it from Item Sales for the
   Live/Refresh affordances. DESIGN.md §2.1 says in terms that accent-green is unusable as
   TEXT in light. Now a `.txn-accent` pair: green-800 light (6.9:1), accent dark (7.81:1).
   ⚠️ **Item Sales still has this defect** — same copy, unfixed, because fixing it is a
   separate change and not this one's to widen. Worth its own pass.
3. **The shell-cache suite caught the missing `CACHE_NAME` bump**, exactly as designed.

## Verification — 4,251 assertions across 70 suites, plus 49 browser assertions

- `scripts/test-transactions.mjs` (39, new) drives the REAL worker with Clover stubbed:
  guards, classification of both void spellings, id→name resolution, refund/credit sign,
  totals excluding voids, **`payment.amount` never `order.total`** (Clover reduces the order
  for a same-day refund; reading it would double-deduct), incomplete fetch ≠ empty day,
  D1 and KV untouched, and a partial label map not cached.
- Browser (30): tab order, lazy load, per-tab column re-render (§4.8 trap 8), detail drawer,
  and every refusal rendering its own sentence rather than an empty table.
- Contrast (19): **light, dark AND pure black**, four tabs each, measured against real
  composited backgrounds. Includes the sweep `lessons.md` asks for — in OLED, assert nothing
  is left computing the ordinary dark theme's `op-panel`/`op-panelHi`. Clean.

## Deploy order — WORKER FIRST

Derived, not remembered: the client gains a call to an endpoint that does not exist yet, so
the worker must already accept it (ORIENT.md). `npx wrangler deploy`, confirm the rollout
(~180 s, poll for consecutive clean passes), then merge for Pages. **No migration, no KV
write, no D1 write** — nothing to back up and nothing to undo.

## Follow-up: a 200 is not proof, and neither is my reasoning about the gate

Prompted by the staging Pages preview. I reasoned that an old worker would fall through the
`if (action === …)` chain to the generic sales handler and answer **200** with a sales
payload, which the client would read as `rows || []` and render as "No payments on this day"
— a false empty day over a trading day.

**I probed it instead of shipping the reasoning, and it was wrong.** The business gate is
fail-closed and runs *before* routing, so an action the worker has never heard of gets
**403 `UNCLASSIFIED_ACTION`** and never reaches the fall-through at all. Measured:

    action=transactions-not-real  -> 403 {"error":"Forbidden","code":"UNCLASSIFIED_ACTION"}

Both now handled, for their real reasons:
- `UNCLASSIFIED_ACTION` gets its own sentence — "this build is ahead of the API", not a bare
  "Forbidden" that reads like a permissions problem. **This is what the staging preview
  actually shows** until the staging worker is deployed.
- The shape check (`rows` is an array and `counts` exists) stays as defence in depth for the
  narrower window ORIENT.md records: a *classified* action whose handler is gone still falls
  through and answers 200.

<rules>
1. **A fall-through router is not reachable until you know what runs before it.** I described
   the chain correctly and forgot the gate three checks upstream of it.
2. **Probe the claim you are about to write into a comment.** One harness call settled this;
   the comment would otherwise have documented a path that cannot occur.
</rules>

## Still open

- Persisting payments so history outlives Clover's ~90 days is deliberately NOT in this
  change. Read-only first; the archive is a separate decision.

# Store-level Transactions tab (Clover parity) — feasibility + preview (2026-09-15)

Brian: "Is there a way to add transactions details for each store? Similar to what Clover
provides… a manager can go to their store card and click view and then next to item sales,
there would be transactions. Review what we can view from the API, see if this is possible.
If this is possible, create me a preview."

**Verdict: possible.** Preview only — no app code changed. `docs/` is excluded from
`scripts/build.sh`, so nothing here reaches production.

## What the API actually gives (verified against Clover's own docs, not assumed)

`GET /v3/merchants/{mId}/payments` exists and is never called today
(`grep -c` for payments/employees/tenders/customers/authorizations in `worker.js` → **0**).
Its documented response carries `id, order.id, tender.{href,id}, amount, cashbackAmount,
employee.id, createdTime, clientCreatedTime, modifiedTime, offline, result, note`.

| Clover column | Source | Cost |
|---|---|---|
| Time | `payment.createdTime` | free |
| Type | endpoint + `result` / `voided` | free |
| Amount | `payment.amount` — **never `order.total`** (MEMORY.md:56) | free |
| Tender Type | `payment.tender.id` → `/v3/tenders` join | 1 cacheable lookup |
| Employee | `payment.employee.id` → `/v3/employees` join | 1 cacheable lookup |
| Customer | `order.customers` via `expand=customers` on orders | orders path only |
| Payment Source | `payment.offline` + device/ecom | free |
| Payment ID / Order ID / Invoice no. | `payment.id`, `payment.order.id` | free |
| Tips / Taxes | `payment.tipAmount`, `payment.taxAmount` | free |

Tabs map onto endpoints, three of which the worker **already calls**:
Payments → `/payments` (new) · Refunds → `/refunds` (`fetchRefundElements`, exists) ·
Manual Refunds → `/credits` (`fetchManualRefunds`, exists) · Voids → `result !== 'SUCCESS'`
(already filtered) · Authorizations → `/authorizations` (new; pre-auths, ~always empty here).

## The hard constraint

🛑 **~90 days, and it is Clover's, not ours.** Clover documents the cap explicitly for
*Get all payments* ("the results will not exceed 90 days… even if the search query exceeds a
90-day span"). Nothing per-payment has ever been stored — D1 `daily_sales` is one row per
store-day and KV `items:` is category-grain — so this is a **live, read-only** view and
older transactions are genuinely unrecoverable. The page must say so rather than render an
empty table that reads like "no sales".

## Plan (not started — waiting on Brian's review of the preview)

- [x] Confirm the Clover surface exists and what it returns
- [x] Confirm nothing per-transaction is persisted today
- [x] Build the preview (`docs/store-transactions-preview.html`), both themes, §4.8 panel
- [ ] Brian reviews → then: worker `?action=transactions`, `ACTION_BUSINESS` entry, tab wiring
- [ ] Decide: persist a per-payment table so history survives the 90-day window?

## Non-negotiables carried into the build (house rules, not preferences)

1. `["transactions", "bl"]` in `ACTION_BUSINESS` (`worker.js:4237`) or the business gate
   403s every session call — verified at `worker.js:14521-14537`.
2. `canAccessStore(currentUser, store)` → 403. Store-scoped, like `items-hour`.
3. `cloverFetchWithRetry`, never bare `fetch` — a 429 read as "no data" has zeroed real
   revenue in this repo before.
4. A failed page is **not** the end of the list — return null, never a truncated array.
5. Write nothing to KV or D1. `sales-diag` is the read-only precedent.
6. BL16 and BL12 share one merchant ID — apply the `wrsGateDates` cutover or BL16 shows
   Wyoming's pre-2026-06-14 rows.
7. Refuse an over-wide range with a 413, never truncate silently.
## Verification of the preview (49 assertions, all green)

Run headless against the real file, both themes, all five tabs:

- **Behaviour (33)** — rows render; the second render of every tab rebuilds its own header
  (§4.8 trap 8); the status line survives a re-render (trap 7); store/date/role/search all
  repaint; the detail drawer opens, foots its receipt to the payment total, and closes.
- **Contrast (both themes × five tabs, drawer open)** — every text element measured against
  its **real composited** background, walking ancestors through translucent layers. Clean at
  AA throughout. The harness proves itself first with the inline-red check from lessons.md,
  and waits out the 200 ms transition before reading any colour.
- **§4.8 traps + responsive (16)** — explicit `type` on every input (trap 1); sticky header
  and sticky first column both opaque and still pinned after a horizontal scroll (trap 2);
  `.panel` declares its own colour (trap 3); `color-scheme` stated per theme (trap 4); no
  horizontal overflow at 390 px.

Two defects the screenshots caught that the assertions did not, both now fixed:
`box-shadow` on a `<td>` outlined **every cell** of the selected row instead of the row, and
the detail grid's 1 px gap painted hairline as a solid block across the last row's unused
cells. A third came from re-reading §4.8 rather than from any test: past the retention wall
the hero printed **$0.00** and the tab counts **0**, directly under a banner saying the data
could not be retrieved — the panel contradicting itself. Absent data now reads `—`.

# Pure black follow-up: nav bar left navy, dark status bar reverted (2026-09-10)

Brian, after merging: "revert dark back to green and look at the nav bar on mobile that
didn't change color."

- [x] **`theme-color` reverted for dark** — back to `#3BB54A`. Only pure black changes the
      browser/PWA chrome now (`#000000`). Light was never touched. Dark's navy bar was a
      side effect of making the tag theme-following; the tag only ever needed to change for
      pure black, where a green bar over a black app defeats the point.
- [x] **The mobile bottom bar was still navy** — `.dark .bn-float` wrote
      `background: rgba(16,24,38,.64)`, which is `op-panel #101826` in decimal. The sweep
      that shipped pure black searched the five token **hexes** and came back clean, because
      `rgba(16,24,38,…)` was never in the search space. Now `rgb(var(--op-panel) / .64)`, and
      its border follows `--op-borderHi` so it strengthens on black like every other border.
- [x] **Five more sites with the same defect**, found by searching the decimal spelling:
      both mobile hint pills (`#swipe-label`, `#ptr-hint`, op-panel at 92%), the sparkline
      tooltip dot halo (op-bg at 90%), and three OFFLINE pill borders (op-inkDim at 35%) —
      a fourth had already been converted by hand, which left the file inconsistent and
      should itself have been the clue.
- [x] **New sweep test**: walk every element in pure black and flag any that still computes
      a dark-theme token value. One hit, and it is correct — the Dark swatch on the
      Accessibility page, which is meant to be a literal sample of `#0a0f1a`. This is the
      check that would have caught the nav bar; the 54 assertions could not, because every
      one of them measured a surface the diff had already touched.
- [x] 61 browser assertions pass (54 + 7 for the bar, its border and the hint pills).
- [x] `CACHE_NAME` v180 → v181.

Lesson recorded: a colour has more than one spelling, and a clean grep only proves the
pattern is absent.

# Pure black (OLED) theme + Settings → Accessibility page (2026-09-10)

Brian: "add a pure black mode (different than dark mode). Add this inside the settings page
under a new page called accessibility. Give me a preview of how this will look before you
build it."

Preview published (interactive, three-way theme switch over the real screens):
https://claude.ai/code/artifact/36407a1f-0f86-4e48-a605-3eaed559ded6

**Built and verified 2026-09-10.** Brian approved the preview and said to build the defaults.

## Approach

Pure black is **additive**, not a third branch: `<html class="dark oled">`. `dark` stays on, so
all 2,847 `dark:` utilities keep resolving (`:is(.dark *)`) and all nine JS sites that ask
`classList.contains('dark')` keep answering yes. We only retint.

## Palette (measured, not eyeballed — ratios vs the real composited ground)

| Token | dark | pure black | why |
|---|---|---|---|
| bg | `#0a0f1a` | `#000000` | OLED pixels off |
| panel | `#101826` | `#0a0a0a` | |
| panelHi | `#16203a` | `#161616` | |
| ink | `#e7ecf3` | `#f2f2f2` | 17.68:1 on panel |
| inkDim | `#8893a7` | `#a8a8a8` | 8.33:1 |
| inkDimmer | `#5a6478` | `#8a8a8a` | **2.99 → 5.73**; today's value fails AA |
| border | `rgba(255,255,255,.06)` | `rgba(255,255,255,.14)` | .06 on #000 = 1.10:1, cards dissolve |
| borderHi | `rgba(255,255,255,.10)` | `rgba(255,255,255,.22)` | |
| sidebar | `#070b14` | `#000000` | |
| glass | `rgba(22,32,58,.55)` | `rgba(10,10,10,.72)` | |

accent-green / bad / warn unchanged — all three already pass ≥4.5:1 on `#0a0a0a`.

## Tasks

- [x] `tailwind.config.js` — `op.*` are now `rgb(var(--op-x) / <alpha-value>)`; the three rgba
      tokens stay plain `var()` since a fixed alpha and `<alpha-value>` cannot coexist. Verified
      in the compiled CSS: `background-color: rgb(var(--op-panel) / var(--tw-bg-opacity, 1))`.
      1,680 of 2,847 rules retint from 24 lines of `:root` + `html.oled`.
- [x] Override layer for the literal half — 21 rules covering the `dark:*-gray-*` backgrounds,
      borders, divides and hovers. **Grey TEXT deliberately not overridden**: a darker ground
      can only raise its contrast, and measuring confirmed it (gray-400 7.01→7.80,
      gray-500 3.68→4.10, gray-300 12.07→13.44). Border alphas are picked for parity with the
      edge each draws today, measured against its own card: gray-700 on a gray-800 card is 1.42
      and white at 14% on `#0a0a0a` is also 1.42; 600 → 1.94 vs 1.91; 500 → 3.04 vs 3.01.
- [x] The 232 hand-written `.dark <sel>{}` rules — 160 pasted copies of five token hexes
      re-pointed to `rgb(var(--op-*))`, so they follow all three themes from one place. The
      always-dark surfaces (sidebar tooltip, coach-marks, bin-dump lightbox) went with them:
      `:root` holds the dark values, so light is untouched and only `oled` shifts them.
- [x] JS colour sites → `window.themeColors()`, a three-way table for the colours CSS variables
      cannot reach (canvas paints). Wired: 3 Chart.js renderers + `_uiDialog`. **The 5 Marketing
      sites were left alone on purpose** — every dark-side value there is a light pastel that
      improves on a darker ground (measured: 8.22→9.15, 7.99→8.90, …, none below 4.5:1) and its
      grid is already white-alpha, so it self-adapts. Churn that fixes nothing.
- [x] Inline-style colours (LIVE/OFFLINE pills, pace bars, role dots, sparkline tooltip) use
      `rgb(var(--op-*))` directly — an inline style resolves variables, so no accessor needed.
- [x] `#page-accessibility` with the store-detail back-button header at `max-w-3xl`.
      Real radiogroup semantics: one tab stop, arrow keys move and select.
- [x] Settings nav row (chevron-right) + `morePages['accessibility']` + the stale `_pages` list
      + a `syncThemeControls()` hook on entry so the radios can't come back stale.
- [x] Boot script applies `oled` alongside `dark` pre-paint; `theme-color` now follows the theme
      (`#3BB54A` light / `#0a0f1a` dark / `#000000` pure black) instead of being pinned to green.
- [x] Two-way sidebar switch keeps its binary sun/moon animation and remembers the flavour via
      a new `darkFlavor` key. Going light does not erase it.
- [x] **54 browser assertions** over pre-paint boot, token plumbing, the override layer, control
      sync, switch memory, contrast in all three themes, and routing. All pass.
- [x] `CACHE_NAME` v179 → v180 in the same commit.

## Open questions — all answered

Brian: "go ahead and build it with the defaults." So: the sidebar switch stays two-way and
remembers; the page carries theme only; the JS-painted colours follow.

## Notes

- No `prefers-color-scheme` anywhere in the app, so there is no "system" option to extend.
- Print export is a `@media print` stylesheet with fixed light literals — theme-independent,
  needs no change.
- The committed root `tailwind.css` is stale and has no `dark:` variants; `build.sh` regenerates
  into `dist/`. Verify contrast against token values, never against the local stylesheet.

# Mark Out of Stock (2026-09-10)

Brian: "add a new page — MOS. Scan a QR code or manually input a BL sticker code, then 3
fields get auto generated... user then will input QTY. This is done every month so we
need to keep track of this too." Then: "add one more auto field (cost) on the item with a
monthly total cost MOS'ed", and answers settling the scan (real QR), the category
(right), the price (keep), the reason (required) and the month (grouping only).

- [x] `migration-062.sql` — `mos_entries` + the `sticker_codes` learned map
- [x] Worker: `mos-lookup`, `-log`, `-list`, `-update`, `-delete`; cost from the
      per-category map; the learn-and-remember write-through
- [x] `jsqr.min.js` vendored, allowlisted in build.sh, precached in sw.js, loaded on demand
- [x] The page: QR scanner, five auto fields, required reason, monthly log with cost
      totals, CSV export, teach-a-code prompt
- [x] `scripts/test-mos.mjs` (129 assertions) + ten mutations, ten caught
- [x] 51 browser assertions over four scenarios, contrast in both themes
- [x] CACHE_NAME v178 -> v179
- [x] **Apply `migration-062.sql`** to staging, then production — done 2026-09-10; both
      tables created, every neighbouring row count unchanged
- [x] Deploy the worker to both — staging `9df48b9d`, production `b3df90ac`, verified by
      bundle over three consecutive identical hashes
- [x] **Merge PR #207** — Brian's click; that is the last step
- [x] Scan a real sticker and confirm the flow end to end

Full write-up in [mos.md](mos.md). Two findings worth reading before the deploy: the
description lookup cannot name stock that has left Clover (which is what MOS is for), and
the cost is a flat per-category rate, so a single expensive line is not to be quoted.

# Associate role: a six-digit login and per-page permissions (2026-09-09)

Brian: a new "associate" account for Bargain Lane, made by an admin, that signs in with a
six-digit code and can open only the pages the admin ticked — Bin Dump today, more later —
and nothing else, not even the dashboard. Plus an "Associate login" button on the login
card and a way to ask for a reset that only an admin can action.

## Plan

- [x] `migration-061.sql` — additive only: `users.name`, `pin_hash`, `pin_failures`,
      `pin_reset_requested_at`, `pages`. Reuse the existing `staff` role rather than
      rebuilding the table for a new CHECK value.
- [x] Worker: `ACTION_PAGE` / `canUsePage` / `requirePage`, the financial gate's one new
      way to say yes, the seven Bin Dump guards, peppered HMAC codes, per-account lockout.
- [x] Worker: `associate-login`, `associate-reset-request`, `associate-save`; refuse
      associates on every email-login, invite, passkey-register and user-write path.
- [x] Client: `GRANTABLE_PAGES` registry, `applyAssociateNav`, page checks in
      `navigateToPage` / `landingPageFor`, Bin Dump view-vs-edit, the login card's two new
      blocks, the Associates panel and its modal, the bottom bar's missing ids.
- [x] `scripts/test-associate.mjs` (131 assertions) + mutation testing.
- [x] `CACHE_NAME` → v178, fixture updated.
- [x] `wrangler secret put PIN_PEPPER` — set on staging and production (a different random
      value each; they are different databases).
- [x] Apply `migration-061.sql` to staging, then production. Backed up production's 14 user
      rows first; afterwards 14 users, 0 associates, 0 pages, 0 failures.
- [x] Deploy the worker to both. Verified by grepping the deployed bundle, three consecutive
      identical body hashes on production, old surface intact.
- [x] **Merge PR #205** — merged by Brian as `49ed4f4`; Pages built `main` (`55d223df`).
      The whole feature is live at www.retjghub.com.
- [x] Create the first associate and confirm the flow on a real phone. Nothing here has
      been exercised by a live request yet.

## Found while deploying, NOT part of this change

`scripts/test-daily-auction-column.mjs` goes red every evening between 8pm and midnight
Eastern, on `main` as much as on this branch. It is a timezone inconsistency in
`buildWeeklyTable` (`index.html:7899`), which computes **two** notions of today and then
uses the wrong one:

```js
const todayStr = new Date().toDateString();                     // the DEVICE's timezone
const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })…;  // ET
…
const isToday = isCurrentWeek && r.date && r.date.toDateString() === todayStr;
```

Row dates are built as **local noon** (`new Date(dateStr + "T12:00:00")`, `loadStoreFromD1`),
so on any device set to Eastern the two agree and the Daily tab is correct — which is every
device in the business. On a device whose local date differs from ET (a UTC box, or someone
travelling) today's row stops being "today": it loses the live Clover figure and the
highlight. In the test container, which runs UTC, that is true for four hours a day.

Proposed fix, one line, comparing ET on both sides rather than mixing the two:

```js
const etDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
const isToday = isCurrentWeek && r.date && etDay(r.date) === todayKey;
```

Deliberately **not** done here — it changes a shipped dashboard surface for every user and
has nothing to do with associates. It does not affect CI (this repo's only checks are the
two Cloudflare Pages builds). Worth its own small PR.

## Review

Full suite **3,786 assertions across 59 suites, green**, plus 75 browser assertions in
headless Chromium over six scenarios. Ten mutations, ten caught — one of them only after
the fix it prompted: the financial gate held its own copy of the level comparison, so
breaking the shared helper changed nothing. Both now call one `canUsePage`.

Four latent bugs found on the way, all pre-existing and all fixed: `loadAll()` would have
painted a store-loading error banner over the associate's page; the bottom bar quietly
lost its active tab ~800ms after **every** load for **every** user; a Bargain Lane grant
with no units reaches nothing, so an associate saved without a store would sign in and
then be refused everywhere; and the synthetic `@associate.invalid` address was a live
oracle on `auth-login`. `test-privilege-guards.js` was also comparing against `indexOf`'s
`-1` — a fixed 3,000-character window that truncated the moment a guard was added.

Nothing is applied to either database and `PIN_PEPPER` is unset, so the feature is inert
until both happen. That is the correct failure: without the pepper an associate cannot be
created at all. Full write-up in [associates.md](associates.md).
# Today's auction is dropped on six surfaces, not one (2026-09-04)

## The ask

"Fix the auction chip" — the store-detail hero's current-week auction chip, flagged in
#189 and #190 as still open.

## What it actually is

`loadStoreFromD1` (`index.html:4989`) nulls `aAuction` on TODAY's row and keeps the value
in `auctionRaw`, because the nulling exists to stop a double-count against live Clover —
and auction is not a Clover channel, so live never supplies it and `auctionRaw` is the only
field where today's auction survives. Its own comment says exactly that.

Six call sites read `aAuction` off a row they have already identified as today's. Every one
of them therefore reads `null` and silently drops today's auction:

| # | site | surface |
|---|---|---|
| 1 | `5663` `computeNotifications` | pace / milestone alerts undercount today |
| 2 | `6047` All Stores headline, live branch | chain auction total misses today |
| 3 | `6274` combined budget card | month-to-date actual misses today (the live boost after it adjusts only `aTotal`) |
| 4 | `6891` `renderCards` | store card's Net **and** its Auction tile |
| 5 | `7176` `getStoreMetrics.storeAuction` | the hero chip — and the hero's week total |
| 6 | `8474` `buildHourlyCard` | Hourly Snapshot sales |

Site 4's comment is the tell: *"Today's stored auction is nulled in loadStoreFromD1, so this
is the only source"* — correct intent, sitting directly above a read of the nulled field.

`index.html:24021` already does it right (`auctionRaw`, with a comment saying why), so the
correct pattern is known in this codebase and was applied in exactly one place.

## Why not just the chip

After #189 the Daily tab DOES pick up today's auction, via `rowAuction()`. Fixing only the
hero would leave the store card's Auction tile, the chain headline, the hourly card and the
pace alerts each reporting a different number for the same day — the exact failure #189 and
#190 were about. One defect, one fix, six call sites.

## Impact

Latent for the Drive feeder: 145 auction rows, **zero** posted on the same day as the sale
(141 later, 4 next morning), so the feed never populates today. Reachable through the manual
override, which is demonstrably in use — 52 `is_manual_override` rows carry auction,
$25,353.79. A manager entering today's auction sees it on the Daily tab and nowhere else.

## Deliberately NOT touched

- `4882` `sumRows` — excludes today by design so live can be added on top. Changing it
  double-counts.
- `6068` hist branch — `histSkipToday` (`5946`) already filters today's row out whenever the
  selection includes today, so today never reaches it.
- `7520` `buildAllStoresWeeklyTable` — documented "today keeps its live-POS behavior".
  Arguably now inconsistent with the per-store Daily tab, but it is a deliberate documented
  choice and changing it is a behaviour decision, not this bug fix.
- `5981`, `6898`, `6925`, `8212`, `8227`, `24028` — read `sumRows` results or explicitly skip
  today.

## Steps

- [x] Route all six through the existing `rowAuction()` helper
- [x] Static invariant test: every `.aAuction` read is either `rowAuction`'s own fallback,
      or in an allowlist that names why it is safe — so the next one cannot ship quietly
- [x] Mutation-test that guard
- [x] Full suite green; build clean; cache bump

## Review

**Shipped.** All six now call `rowAuction()`; the four deliberate direct reads keep reading
`aAuction` and are named in the guard's allowlist with their reason.

`scripts/test-today-auction-reads.mjs` (15 assertions) enforces the rule rather than the six
instances of it: every direct `.aAuction` read must be a listed safe shape, the six fixed
sites must still delegate, and `rowAuction` must still prefer `auctionRaw`. The allowlist is
itself checked for staleness — an entry that stops matching real code fails, because a stale
justification is how the next one slips through.

**Mutation-tested, six ways, all caught:** reverting each of the hero chip, the store card,
the Hourly Snapshot and the pace alerts; adding a *brand-new* `todayRow.aAuction` read
elsewhere in the file; and making `rowAuction` itself stop preferring `auctionRaw`.

Also parsed all four inline `<script>` blocks (1,152 KB) to prove six edits spread across six
regions left the file syntactically whole — the extraction-based tests only cover the regions
they slice.

Full suite 3,427 assertions across 58 suites, green. `bash scripts/build.sh` clean. Cache
v168 → v169.

### What this does and does not change today

Nothing visibly, most days. The Drive feeder has never posted an auction row on the same day
as the sale (145 rows: 141 later, 4 next morning), so today's auction is normally absent and
`null` was the right answer by accident. It changes what happens when someone enters today's
auction by hand — a path in real use, 52 `is_manual_override` rows carrying $25,353.79. Before
this, that figure appeared on the Daily tab (via #189) and on no other surface.


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

---

# Categories tab — two date ranges instead of fixed buckets

Decision taken (Brian, 2026-09-10): **B defaults to the same span of the previous
period, boundary-anchored** ("same span, prev period"). The other six preview
questions stand as built-as-shown.

## Why

Two explicit ranges are answered by `category-series`, the per-day feed, so the
weekly-rollup path leaves this tab entirely. That removes the 108-week wall
(quarter-over-quarter works on existing data) and the "a month means two things"
split, because one feed is left.

## Plan

### 1. State and data  ⬅ the core
- [x] Replace `ctState.bucket` / `ctState.ptd` with `ctA`, `ctB`, `ctBPinned`,
      `ctRule` ('aligned' | 'rolling'), `ctGran` ('auto'|'day'|'week'|'month').
- [x] `ctAutoB(a)` — aligned uses `a.prevStart`; rolling and any custom range use
      the n days immediately before A.
- [x] Fetch TWO `category-series` payloads, one per range. Each has its own
      840 store-day budget; compute store-days client-side and refuse BEFORE
      asking rather than taking a 413.
- [x] Bucket days into the x-axis by granularity; label part-covered END buckets
      by what they hold ("Jul 1–4"), never as a whole week/month.

### 2. Controls
- [x] Two range chips (A green = CHART_COLORS.tw, B amber = .lw), ⇄ pin toggle,
      Match length when lengths differ.
- [x] `Compare to` pills (aligned default) and `X-axis` pills (auto default).
- [x] Presets fill BOTH chips. Reuse `RANGE_PRESETS` + `resolvePreset`; extend
      them with `prevStart` so aligned has a boundary to anchor on.
- [x] Calendar: extract the two-month grid pair into a renderer that takes a host,
      so the page picker and the CT picker share one calendar rather than two.
      The page picker's behaviour must not change.

### 3. Views
- [x] Vs — unchanged shape, now A vs B over the chosen granularity.
- [x] Trend — range A for the top 6; click a category to chart A vs B for it.
- [x] Grid — one panel per category, A vs B, own-scale with the baseline stated.
- [x] Table — A total, B total, Δ, Δ%.

### 4. Removal (all Categories-tab-local)
- [x] `CT_WEEKS_FOR`, `ctWeekly`, `ctWeeksKey`, `ctWeeksShort`, `ctWeeksThin`,
      `ctWeeksHonoured`, `ctResetWeekly`, the `weekly-t13` fetch, the version-guard
      render branch, the short-history caption, the week-derived caveat.
- [x] KEEP the worker's `weeksWindow` echo and the `weekday 6` grouping — the T13
      tab reads `weekly-t13` directly and both are load-bearing there.

### 5. Verification
- [x] Browser harness rewritten against the real `index.html`: both rules, pin,
      match-length, budget refusal before request, four views, part-covered
      labelling, the page-level range picker still works untouched.
- [x] Repo suite (worker) must stay at 4,025 — nothing here touches worker.js.
- [x] `CACHE_NAME` bump + `shell-cache.json` re-pin.

## Review

Landed. The move that made it small: `ctVsWindow()` already returned
`{points:[{label,cur,prv}]}` and every chart consumed that shape, so replacing how
the two periods are CHOSEN left the whole drawing layer untouched. What was a
rewrite became a swap of the data layer underneath it.

**Two feeds became one.** Nothing on this tab asks `weekly-t13` any more — the
harness asserts zero such requests. So the version guard and the short-history
caption from phases 3 and 4 are gone with it. The worker fixes behind them stay:
the T13 tab reads that endpoint directly and was the surface actually reading the
wrong year's numbers.

**The budget is spent before it is asked for.** Two ranges are two requests, each
with its own 840 store-day allowance, which is why two quarters are affordable
where 108 weeks of rollups were not. A range that would not fit is refused
client-side with its arithmetic and sends nothing — asserted by counting requests,
not by reading the message.

**One calendar, not two.** `_wrsMonthGridHTML` took a click-handler parameter and
the Categories picker renders the app's real calendar. `resolvePreset` learned
quarters; `RANGE_PRESETS` was deliberately NOT touched, so the page-level picker's
list is unchanged — there is a regression check on exactly that.

### Two mistakes worth keeping

**The legend lied for a fourth time.** The rows survived the rewrite and went on
saying "Green is this week, amber is the one before it" over two arbitrary spans,
plus a to-date row for a mode that no longer exists. It is derived from the live
ranges now, and the harness asserts the legend against the chips in all four views.

**A failed script reported success.** Five substitutions printed `ok` and then a
TypeError aborted the run before the write, so none of them persisted — and the
browser suite passed, because the file was unchanged. `grep` for the symbol that
should have been deleted is what caught it. Print-then-write is not evidence;
check the file.

**And one near-miss:** `cat > tasks/todo.md` truncated 1,441 lines of existing
plan. Restored from HEAD and appended. Append to a tracked file, never truncate it.

## Categories range popover — Apply button off-screen (2026-09-14)

Reported by Brian: "when selecting the date the apply button doesn't display."

- [x] Reproduce with real geometry rather than guessing at the cause
- [x] Root-cause it: three compounding faults, not one
- [x] Fix placement: measure after render, clamp both edges, flip up when roomier
- [x] Make the footer sticky so Apply never depends on scroll position
- [x] Preserve scrollTop across the innerHTML re-render
- [x] Match the two sibling pickers' "— now pick end" confirmation
- [x] Verify: 36 geometry checks across 6 viewports x 2 chips, both themes
- [x] Lock it: scripts/test-ct-range-popover.mjs (22 assertions)
- [x] Prove the test fails on the pre-fix file (20 of 22 fail)
- [x] Bump CACHE_NAME v188 -> v189 and re-record the shell-cache fixture
- [x] Capture the lesson in tasks/lessons.md (rules 9–13)

### Review

The button was never missing from the DOM — it was parked below the bottom of the
screen, and at 1512x820 **no scroll position revealed it** (footer y 878–925, viewport
ends 820). Three faults compounded:

1. `top = Math.min(box.bottom + 6, Math.max(8, innerHeight - 430))` guessed a 430px
   popover. The real content is ~861px: preset list + two stacked month grids + footer.
2. The CSS `max-height: 86vh` reads like a viewport clamp but bounds the box's *height*,
   not where it *ends* — 86vh from a top of 226px overhangs a 900px screen by 100px.
3. `ctRenderPop()` replaces innerHTML, resetting scrollTop to 0 on every date click, so
   the user was thrown back to the top each time they picked a date.

Fix: `ctPlacePop()` runs after every render (height changes with the grids and with every
pick), sizes from the room that actually exists below — or above — the chip, and clamps
the top against both screen edges using the measured height. The footer is sticky and
opaque in both themes. No magic constants remain.

Measured before -> after, Apply button inside the viewport:

    1440x900    no -> yes      1440x700    no -> yes
    1512x820    no -> yes      390x844     no -> yes
    1280x1000   no -> yes      1400x1400  yes -> yes

Full suite: 4048 assertions across 64 suites, all passing. The two-range browser suite
(43 checks) still passes, so the Categories tab's behaviour is unchanged — only its
geometry moved. Frontend only; nothing to deploy beyond the Pages rebuild on merge.

## Hour-by-hour categories (2026-09-14)

Brian: "Can we add hour by hour?" → sourced **live now + banked going forward**, x-axis capped at **7 days**.

### What the research established

- **Nothing hourly is persisted.** D1 is store-day (`daily_sales`, `channel_sales`, `last_year_sales`);
  KV is store-day (`items:`, `sales:`) or store-week (`week-summary:`). No hour dimension anywhere.
- **But the ingest already has the timestamp in scope and throws it away.** Inside
  `aggregateItemSales`, the per-order loop (worker.js:2963) wraps the line-item L2/L3 walk
  (worker.js:3042), so at the exact moment it knows "this $X is Softlines / Womens Tops" it also
  holds `order.createdTime` and `order.clientCreatedTime`. Grepping the whole function body for
  either: zero matches. Read as a filter predicate, then dropped.
- **`?action=items-hour` already proves the aggregation works per hour** — it narrows Clover to a
  1-hour window and runs the same `aggregateItemSales`. It is one store / one date / one hour.
- `fetchItemOrders` pages at limit 1000, so a whole store-DAY is usually ONE call. Bucketing one
  day-fetch in memory is ~24x cheaper than 24 hour-window fetches.
- **Frontend blocker:** the bucket primitive bottoms out at one day. `ctCuts` emits
  `{key, days:[ymd...]}`; `ctVsWindow` collapses to `[firstYmd,lastYmd]`; `ctDayValue` steps
  `t += CT_DAY_MS` and indexes `ctDaily.l2[store][ymd]`. Nothing below a day is expressible.
- **`ctState.gran` is absent from `ctDailyKey`**, so today every granularity re-buckets the same
  payload for free. Hour breaks that invariant: it needs a different payload, so it must refetch.

### Plan

**Phase 1 — worker: `category-hours` (live), read-banked-if-present**
- [x] `ctHourSlot` key format `YYYY-MM-DDTHH`, ET, from `clientCreatedTime ?? createdTime`
      (same precedence `snapshotDayByClientTime` already uses, so a late offline order lands
      on the hour the register rang it, not the hour it synced)
- [x] `buildItemHourBuckets(elements, refunds, manualRefunds, ...)` — partition by ET hour,
      run the EXISTING `aggregateItemSales` once per non-empty hour. No aggregator changes.
- [x] New action `category-hours&from&to&level[&store]`, same response shape as
      `category-series` but slot-keyed; `slots[]` instead of `dates[]`
- [x] Prefer banked `item-hours:<store-lc>:<date>` when present (a no-op until phase 3)
- [x] `CATEGORY_HOURS_MAX_DAYS = 7`, refused with its arithmetic like the store-day guard
- [x] Register in `ACTION_BUSINESS` ("bl") — the business gate is fail-closed
- [x] `wrsGateDates` per store, so BL12/BL16 never double-count the shared merchant
- [x] Tests: slot format, ET/DST correctness, refund attribution, budget refusal, gate

**Phase 2 — frontend: Hour on the x-axis**
- [x] Generalise the bucket primitive from "date list" to "slot list" — `ctDayValue` sums an
      explicit list instead of re-deriving by stepping. Removes date arithmetic from the value
      path; hour slots then fall out with no special-casing.
- [x] `'hour'` in `ctGranFor` / `ctCuts` / the X-axis pill, enabled only within the 7-day cap
      and greyed with the reason otherwise
- [x] Add `gran` to `ctDailyKey` — hour needs a DIFFERENT payload, so it must refetch where
      day/week/month do not. This is the one invariant the feature breaks; make it explicit.
- [x] Table view: 168 columns needs horizontal scroll (DESIGN.md §4.8 overflow rule)
- [x] Labels/legend/status derive the unit noun from granularity — "hours", not "weeks"
- [x] Tests: geometry + bucket count + refetch-on-gran-change + both themes

**Phase 3 — bank hours going forward**
- [x] Write `item-hours:<store-lc>:<date>` from the nightly cron and the clientCreatedTime sweep
- [x] 🔑 A NEW key. It never touches `items:` — no stored history is overwritten, so this is
      outside the failure class in MEMORY.md entirely.
- [x] A failed hour-bank must NOT fail the day snapshot; log and continue
- [x] Tests: bank-then-read round trip, and that the day snapshot survives a bank failure

### Deploy order
Worker first (the frontend depends on the new action; the reverse is not true), verified per
CLAUDE.md rule 5. Phase 3 is additive-write and can follow independently.

### Review — hour-by-hour, both halves (2026-09-14)

Worker (#220) and frontend landed on one branch because pushes are restricted to
`claude/hopeful-goldberg-x2yg5a`, so they could not be split into two PRs.

**The skew is survivable anyway.** `category-hours` is registered in the fail-closed
`ACTION_BUSINESS` registry, so a worker that predates it answers 403 `UNCLASSIFIED_ACTION`,
and `ctFetchRange` already turns exactly that code into "The worker half of this deploy is
missing — the API does not know this endpoint yet." Day/Week/Month are untouched (they still
read `category-series`), so only the Hour pill degrades, and it degrades honestly rather than
drawing something wrong. Still: deploy the worker promptly after merge.

**Two real bugs the tests caught, neither of which a passing assertion would have shown:**

1. *Cross-hour refund attribution.* A refund rung at 18:00 against a 09:30 sale needs that
   order to know what it reverses, and it lives in another bucket. Every bucket now gets the
   whole day as its lookup pool MINUS its own orders — the extras loop appends to
   `orderLineItemMap` rather than replacing, so an order in both lists doubles the basis.
2. *Every grain change became a round trip.* I added `ctDailyKey = ''` to the grain setter,
   which is both unnecessary (the grain is already in the key) and harmful — it destroyed the
   property that Day/Week/Month re-cut in memory for free. A browser check that counts
   requests caught it; no static assertion would have.

**And one the screenshot caught:** the status line read "the same 1 days of the previous
period". Pre-existing, but an Hour axis makes single-day ranges the normal case, so it stopped
being rare enough to ignore. Now `ctPlural`.

Verification: 59 worker assertions, 31 frontend invariant assertions (23 of 31 fail against
the pre-Hour file), 25 browser checks across both themes with zero page errors, and the
two-range suite still passes so day/week/month behaviour is unchanged. Full suite 4140 across
66 suites. CACHE_NAME v189 → v190.

**Left deliberately undone:** auto-granularity still never picks Hour. A one-day range draws a
one-point chart by default, and hours would fix that — but auto is the path everything takes
without asking, and hours cost a live Clover read per store-day. Worth revisiting once enough
days are banked that the cost is a KV read.

## Auto picks Hour for a single day (2026-09-14)

Brian: "yes make auto pick hour for a single day" — reversing the call I made when hours
shipped, where auto deliberately never chose them because they cost a live Clover read.

- [x] `ctGranFor`: auto returns 'hour' when the range is exactly one day
- [x] 🔑 Guard on the COMPARISON range too. An unpinned B always matches A's length, but a
      PINNED B need not — one day against a pinned month is 24 slots against 720, over the
      7-day cap. Without the guard, picking a one-day range would turn a chart that used to
      draw into a budget refusal caused by a setting nobody touched.
- [x] Checked for circularity first: `ctRangeB` → `ctAutoB` → `ctDays`/`ctPrevStart`, never
      back into `ctGranFor`, so reading B inside it is safe.
- [x] Inverted the invariant test that asserted the opposite, and added the pinned-B guard
- [x] Browser: auto-hour with the grain pill still reading Auto; explicitly choosing Hour
      afterwards refetches nothing because it is the same grain
- [x] CACHE_NAME v190 → v191

### Review

One-line behaviour change, one real trap. The trap was the pinned B: auto must never select
a grain the loader would then refuse, or the panel refuses on a setting the person did not
touch. `ctGranFor` now measures B before returning 'hour'.

The existing test asserted "auto never selects hour by itself", which was correct when
written and is now deliberately false — inverted rather than deleted, so the reversal is
recorded in the suite rather than silently dropped.

Verification: 34 frontend invariants, 32 browser checks across both themes (including the
pinned-B guard falling back to the day series with no refusal and the chart still drawing),
two-range suite still green, full suite 4143 across 66. Screenshot confirms the Auto pill
stays selected while the axis is hours.

Frontend only — no worker change, so Pages carries it on merge with nothing to deploy.

## Two ways the comparison could mislead in silence (2026-09-14)

Brian hit a screen where every row read ▲ 0.0% and asked why auto was not working. Auto WAS
working — the range was 4 days, and auto picks Hour only at exactly one. The actual problem
was that the comparison range had been pinned onto the same dates as the range being shown,
so the panel was comparing a period against itself. He spotted it himself, then asked for
both fixes.

- [x] The pin toggle beside the comparison chip was labelled **⇄** — the universal SWAP
      icon — on a button that PINS. It invited exactly the click it does not perform, and
      the state it leaves behind is invisible until the numbers look wrong. Now reads
      "Pinned", matching the text "Match length" button beside it, with a tooltip that
      describes both states.
- [x] Nothing said when the two ranges were identical. Every row reads 0.0% and the
      comparison series draws exactly under the current one, so it cannot even be seen.
      The status line already calls out short history, part-covered end buckets, unequal
      lengths and the rolling fallback — this was the gap, and it is the one someone
      actually hit. Reported FIRST, because it subsumes every other reading of the chart.
- [x] Keyed on the DATES matching, not on ctBPinned — so it stays true however the state
      is reached — but it names the pin as the cause only when the pin is the cause.
- [x] scripts/test-ct-compare-honesty.mjs (16 assertions; 10 fail against the prior file)
- [x] CACHE_NAME v191 → v192

### Review

Neither of these was a bug in the sense of wrong output. Both were the panel declining to
explain a state it had let someone reach — which is the same failure mode as the legend that
lied four times and the Apply button nobody could see. The pattern worth keeping: when a
control can put the page into a state that looks fine and means nothing, the status line is
where that gets said.

Verification: 16 invariants, 18 browser checks over both themes (button label, tooltip flip
on state, warning raised by pinning B onto A's dates, warning cleared and B moving back off A
when unpinned), two-range and hours suites both still green, full suite 4160 across 67.

Frontend only — Pages carries it on merge, nothing to deploy.

## Holland (BL8) off the dashboard roster (2026-09-15)

Brian: "gate BL8 like BL12", after I flagged BL8 reporting $0 for eight weeks.

### What the research changed about the ask

I had to correct myself twice here, and both corrections mattered.

1. **BL8 was already ~70% gated.** `STORE_CLOSED_FROM.BL8 = '2026-07-25'` already existed —
   with exactly the cutover date I was about to propose — and already drives reporting
   status, refuses writes with a 409, and excludes BL8 from Bin Dump, Markdown/OOS, Shelf
   Count and Labor, each with its own comment.
2. **The "phantom budget" I flagged as a distortion is a deliberate decision.** The comment
   in `STORE_CLOSED_FROM` records Brian's call of 2026-08-11: the company plan was never
   revised for the closure, so the $813,563 shortfall is a real miss the chain is meant to
   carry, and it says in terms not to undo it without asking. My framing of "77.9% is wrong,
   91.3% is right" had it backwards — 77.9% is the intended number.

So the full BL12 treatment was the one change the codebase explicitly warns against. Brian
chose dashboard cleanup only, budget untouched.

### Why the two closed stores are handled differently

BL12's register was physically MOVED to BL16 and shares its Clover merchant, so polling it
would fetch Indy East and write it under 'BL12' — silently doubling Indy. Its absence from
ALL_STORES is the only thing preventing that. BL8 has its own merchant that simply returns
nothing, so there is no double-count hazard and no successor to gate dates against.

- [x] Remove BL8 from the frontend `STORES` roster — no card, no per-store D1 read, no live
      Clover poll every load, and the store counts read 5 instead of 6
- [x] Drop the matching `COLORS` entry so the arrays stay index-parallel
- [x] Generalise the "Closed · historical" badge from the `'BL12'` literal to a
      `CLOSED_STORES` map mirroring the worker — the next closure is one line
- [x] scripts/test-closed-stores.mjs (17 assertions; 5 fail against the prior file)
- [x] CACHE_NAME v192 → v193

### Deliberately NOT touched

- `worker.js ALL_STORES` — carries the budget. This is the whole point.
- `PS_STORES` — `scripts/test-price-scan.mjs` pins it to ALL_STORES byte-for-byte, order
  included. Editing one without the other fails that test immediately.
- `WRS_STORE_KEYS` — keeps Holland's history readable in the Retail Summary.
- `SR_ALL` — drives the supply-request table's columns; dropping BL8 would hide historical
  BL8 requests rather than tidy anything.
- The admin/repair pickers (repair console, re-snapshot, ISR, overrides) — you need those to
  inspect a closed store's history.

### Review

Four failed test runs before this went green, and every one was my fixture, not the feature:
the stub never authenticated, so `navigateToPage` refused to open the page, so wrsData stayed
null, so `renderWrsStore` returned at its first guard and the badge was never rendered. The
pane was empty rather than wrong, which should have told me sooner — a broken fixture that
looks like a broken feature. The fix was a real `auth-me` payload.

The strongest evidence the roster actually changed is the request log, not the card count:
the per-store history read and the live Clover poll are driven straight off `STORES`, and both
now fan out to exactly five stores with no BL8. A stale card could hide; a request cannot.

Verification: 17 invariants, 12 browser checks, all four existing browser suites still green,
full suite 4178 across 68. Frontend only — nothing to deploy beyond the Pages rebuild.

## Hour backfill — banking the window before the nightly bank (2026-09-15)

Brian: "do the backfill". Hours exist only in Clover's raw orders, ~90 days of retention,
decaying daily. Nightly banking started 2026-09-15; everything before it is a window closing
a day at a time.

### The endpoint that already existed, and why it must NOT be used

`?action=resnapshot-clienttime` walks a date range and calls `snapshotDayByClientTime`, which
banks hours as of this week's change — so it looks like the tool for the job. It is not. It
also **re-writes `daily_sales` and the `items:` snapshot**. Pointing it at ~90 healthy days is
precisely the re-pull that has cost this repo data three times: Clover returns LESS as it
ages, so refunds that have aged out would vanish from days that were correct when written.

### The guard that makes a backfill safe

The same decay makes a naive hours-only backfill wrong in a quieter way: an old day can come
back short, and banking it leaves the hourly view disagreeing with the daily view everyone
else reads — silently, because each looks fine alone.

So the endpoint **reconciles before it writes**. For each store-day it sums the hour buckets
it just computed and compares them against the existing day snapshot; a day that does not
match to the cent is SKIPPED and reported, never banked. This is the same check that proved
the nightly bank correct this morning (15 of 15 store-days, delta 0.00). A day Clover can no
longer reproduce is a day we decline to bank.

- [x] `?action=backfill-item-hours&store=&start=&end=[&dry=1]`, admin-gated
- [x] Writes `item-hours:` ONLY — never `items:`, never D1. Asserted by a test that greps the
      handler for day-snapshot writers and for `DB.prepare`.
- [x] Stamps `daySnapshotTime` from the snapshot it reconciled against, so the reader's
      freshness check treats a backfilled bank exactly like a nightly one
- [x] Skips days already banked, at zero Clover cost
- [x] `dry=1` previews without writing — asserted, because a preview that writes is not one
- [x] `BACKFILL_HOURS_MAX_STORE_DAYS = 120` per invocation; the caller walks the window in
      chunks, because the subrequest ceiling is per invocation
- [x] Registered in the fail-closed ACTION_BUSINESS registry
- [x] scripts/test-backfill-item-hours.mjs — 33 assertions

### Still to do (needs the worker deployed first)

- [ ] Merge + deploy the worker
- [ ] Dry-run the whole window, store by store, and read the reconcile rate
- [ ] Run it for real in chunks, and report how far back the window actually reaches
