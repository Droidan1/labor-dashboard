# MEMORY — labor-dashboard (RETJG HUB)

_Durable knowledge: decisions with their reasons, and traps that have actually bitten. Direction lives in [PLAN.md](PLAN.md); the sit-down-and-work mental model lives in [ORIENT.md](ORIENT.md); per-session process lessons live in [tasks/lessons.md](tasks/lessons.md)._

_Deeper per-topic notes are in Claude's auto-memory at `~/.claude/projects/-Users-brianhoward-Desktop-labor-dashboard/memory/`. This file holds what belongs **with the code**._

---

## Domain facts (not derivable from the repo)

- 🔑 **This is a liquidation / bargain retailer.** Goods arrive by the lot, so a **99% gross margin is normal**, not a data error. Conventional retail intuition about "believable" margins does not apply. The real signal of a bad cost mapping is a **negative** margin — a refundable bottle deposit priced against a beverage cost read −710%, and that one is correctly mapped by name only, because a deposit has no COGS.
- 🔑 **`Sku Book Items` is not a product category.** Clover's POS renders one screen per category, so stores park high-frequency products in a category called `Sku Book Items` purely so cashiers can find them fast. **Never give it a category cost** — it is a grab-bag ($0.50 soda beside $200 baby gear). An item can legitimately be in *both* the sku book and its real category; `pickPrimaryCategory()` prefers the real one.
- **BL16 (Indy East) reuses closed BL12 (Wyoming)'s Clover account** — same credentials, one merchant, two store identities.

## Decisions, with reasons

- **Admin writes require a superuser *session*, not a secret** (2026-08-03). The previous gate was header equality against `SNAPSHOT_SECRET`, which the frontend published as a literal in `index.html` — so every destructive endpoint was reachable by anyone who read view-source. Session auth was only half the fix; **removing the secret from the client was the other half**. Keeping "session *or* secret" while still shipping the secret would have been theatre. Secret-only survives for three machine-facing endpoints.
- **403, never 401, for a wrong-role user.** In this codebase 401 means "no session" and the client bounces to login. An authenticated user with insufficient role must see a refusal, not a login page.
- **The admin gate is method-aware.** `item-costs`, `category-costs` and `item-overrides` each read on GET and write on POST behind a *single* guard. Gating those blocks wholesale at superuser breaks reads for admins; gating at admin leaves the writes open. The verb decides.
- **Repair takes a list of dates, never a range.** Re-pulling an *already healthy* old date **loses refunds** that have aged out of Clover's ~90-day window, so every unnecessary date in a range is a small permanent loss. `repair-run` refuses `start`/`end` outright and consumes the health check's output instead.
- **The health check reuses `BACKFILL_MIN_D1_RATIO`** rather than picking its own threshold, so a date it flags is exactly a date the repair will accept, and a date it omits is one the guard would refuse to overwrite. An independent threshold would let the screen recommend work the repair then silently declines.
- **A failed backup aborts the write.** Losing the undo is not an acceptable price for applying the repair. Restore likewise backs up what *it* replaces, so undoing a repair is itself reversible.
- **One implementation of each data-loss guard.** The per-date fetch/guard/write body lives in `rebuildItemSnapshot()`, shared by the backfill and the repair. Two copies of a guard drift, and drift is precisely how the losses these guards prevent come back.
- **`|| "Hardlines"` default removed** from sku-book resolution. Unmapped items now book as `Custom Sales` and are reported by `noncategorized-items`. That silent default is why two one-character typos mis-booked a soda can and a bath item chain-wide **for months** without anyone noticing.
- **Category assignment in Clover is additive by default.** An item belongs in both its real category *and* its sku-book page; stripping the latter would pull products off the cashier's screen. Pass `removeOtherCategories: true` for exclusive.

## Credentials

- 🛑 **`wrangler.toml` is tracked in a PUBLIC repo.** Anything written as a `[vars]` entry is world-readable at `raw.githubusercontent.com`. Every Clover API token and `SNAPSHOT_SECRET` sat there in plaintext **2026-04-08 → 2026-08-03**. Credentials belong in `wrangler secret put`, never in `[vars]`. Merchant IDs are fine as vars — they are account identifiers, not credentials.
- 🔑 **Secrets and vars both land on `env`**, so moving a name from one to the other needs **no code change**. Cloudflare does not document which wins if a name is both; move identical values so the answer cannot matter, and rotate only after the var is gone.
- 🔑 **`SNAPSHOT_SECRET` has two slots** (`SNAPSHOT_SECRET` + `SNAPSHOT_SECRET_NEXT`) so it can be rotated in three independently reversible steps instead of a synchronised flag-day. Use of the old value logs `legacy-secret-in-use` while a rotation is in progress — that is the signal that says whether the final step is safe. `?action=secret-check` reports which slot a value occupies.
- ⚠️ **The secret was compared in SEVEN places**, not the obvious two: the global auth gate, `requireAdminSecret`, and four hand-rolled `isAdminReq` checks in the brief/summary/digest endpoints. Any missed site breaks the moment you rotate. Everything now goes through `hasSnapshotSecret()`.
- 🔑 **Truthiness-check both slots before comparing.** An unset slot plus an absent header compares `undefined === undefined` and authenticates the entire internet.
- **Six unique Clover merchant accounts back seven store keys** — BL16 reuses BL12's (Indy took over Wyoming's register). Rotate by account, not by store, or you will rotate one twice and think you missed one.

## Traps that have actually bitten

- 🛑 **Backfills are not lossless.** They have destroyed real history three distinct ways. Two are now guarded (a clean empty Clover result; a *partial* fetch that returns fewer orders rather than zero). **Refund loss on old dates is inherent and cannot be guarded** — it is a property of Clover's retention window. Target only dates that can gain.
- 🛑 **Clover degrades at its retention edge by returning fewer orders, not an error.** A BL4 backfill got 153 of a day's 241 orders and overwrote a complete snapshot ($3,229.91 → $2,124.47) reporting `written:1, errors:0`. Nothing caught it because `orderCount` was non-zero. Hence the magnitude guard comparing every write against D1.
- **`wrangler deploy` reads `worker.js` from the current directory with zero branch awareness.** It reverted production once. Check the branch before deploying; ship from a clean worktree.
- **Deploy order is not fixed** — derive it from which side stops being backward-compatible. Adding a server guard the client must satisfy → frontend first. Removing the client's secret, or adding a client call to a new endpoint → worker first.
- **Worker deploys propagate gradually**, measured up to ~180 s, and mid-rollout consecutive requests hit a *mix* of old and new instances. A single check can read either. Poll on the whole condition and require consecutive clean passes.
- **Cloudflare cron day-of-week is 1–7 with 1 = Sunday**, not POSIX. `"0"` is rejected with a 400.
- **D1 caps bound parameters at 100 per query.** Never build `IN (?,?,…)` from an unbounded list — query by range bounds.
- **Native `confirm()` / `alert()` freeze the installed PWA.** Use `uiConfirm()` / `uiAlert()`.
- **A count of exactly 1000 from Clover means pagination, not a total.** A truncated category map cached for 24 h mis-costed a store's bins.
- **Viewport-pinned `fixed` elements must not live inside the `#main-scroll` overflow scroller** or they unpin on iOS.
- **The service worker serves the app shell stale-while-revalidate.** Bump `CACHE_NAME` in `sw.js` or installed apps keep the old bundle; open apps never self-update.

## Verification standards this project has settled on

- **Drive the real exported handler**, not a reimplementation. A test that re-derives the logic re-derives the bug.
- **Compare against the previous build** so a passing run cannot be vacuous — assert the change is *new*, not merely present.
- **Never verify a guard with a probe that performs the damage if the guard is absent.** Prefer a path that dies at input validation over one that dies at authorization.
- **Two controls on every removal/guard check**: a known-absent case (what does "not matched" look like?) and a known-present case (is the router still working at all?). Without the second, total breakage reads as total success.
- ⚠️ **A green suite proves consistency, not correctness.** Three classification bugs in the health check survived 60/60 assertions and died on first contact with production data — because the fixtures were written from the same wrong belief as the code. Run finished diagnostics against real data and read the output *critically*; a first run that reports a large alarming number is more likely mis-modelled than lucky.
- ⚠️ **Identical failure is identical.** A differential test where both builds error is green by construction. Assert something positive happened before believing an equivalence result.
