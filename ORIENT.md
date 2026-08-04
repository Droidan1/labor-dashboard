# ORIENT — labor-dashboard (Bargain Lane / RETJG Hub)

_Orientation for a human sitting down after time away. Not a file index — a mental model + the operations you actually run._

## What this is

An installable **PWA sales + labor dashboard** for the Bargain Lane / RETJG retail stores, pulling live data from **Clover POS** (multiple store merchant accounts). Managers see daily sales vs budget, weekly retail summaries, inventory, supply requests; admins additionally get marketing tooling (Meta ad reporting, a promo Flow Calendar, a photo-intake → caption → Facebook publish pipeline) and a Morning Brief. Role-gated: `superuser` / `admin` / `district_manager` / `manager` / basic.

## Codebase shape (the mental model)

- **Frontend = one giant static file.** `index.html` (~1.08 MB, ~17.7k lines) is the entire single-page app: markup for every "page" (toggled by `navigateToPage()` / `#page-*` divs), all CSS in `<style>` blocks + Tailwind utility classes, and all logic in a handful of inline `<script>` blocks (vanilla JS, no framework, no bundler). There is **no build step for the app JS** — you edit `index.html` directly.
- **Tailwind is precompiled.** `tailwind.css` is generated from `tailwind.input.css` + `tailwind.config.js` by `scripts/build.sh` (`npx tailwindcss --minify`). The build scans `index.html`, so newly-used utility classes only exist after a rebuild. Custom component styles live in `index.html`'s `<style>`, not Tailwind.
- **Backend = one Cloudflare Worker.** `worker.js` (~11.3k lines) + `wrangler.toml` (worker name **`clover-sales-api`**). Bindings: **D1** (`labor-dashboard-db`, historical/structured data + `migration-*.sql`), **KV** (`SALES_SNAPSHOTS`, daily snapshots), **R2** (`bl-marketing-media`, manager photo submissions + generated assets). Cron triggers do EOD rollups, the sale scheduler (every minute), hourly push summaries, and the weekly digest. It is **one giant `if (action === "…")` chain** inside `fetch()` — an unmatched action falls through to the generic sales handler rather than 404ing, which is why a removed endpoint answers `{"error":"Please specify a store"}`.
- **The app talks to the deployed API, not localhost.** `index.html`'s `WORKER_BASE` is hardwired to `https://api.retjghub.com/` — so even the local static server hits **prod** data unless you point it elsewhere.
- **Two records of every day, and they check each other.** KV `items:<store>:<date>` holds the item-level snapshot (categories, L3 rows, costs); D1 `daily_sales` holds one row per store/date with the day's total. They are built from different code paths, so disagreement between them is the signal the whole Repair console is built on.

## Auth (changed 2026-08-03 — the old model is gone)

- Every request below the auth gate needs a **session cookie** (`Domain=retjghub.com`, so it's shared between www. and api.). Roles: `superuser` / `admin` / `district_manager` / `manager` / basic.
- **Admin endpoints: `requireAdminAccess`** — a superuser session may **write**, an admin session may **read**, and `X-Snapshot-Secret` still passes for cron/tooling. It's **method-aware** because several actions read on GET and write on POST behind one guard. It returns **403, not 401** — 401 means "no session" here and bounces the client to login.
- 🔑 **The client no longer ships the secret.** It used to be a literal in `index.html` (public via view-source), which made all 22 admin endpoints effectively open. Only **3** endpoints are secret-only now, all machine-facing: `ingest` (Apps Script feeder), `sales-diag`, `clientdate-probe`.
- ⏸ **The old secret value is still burned** — it sat in public page source for months. Rotating it means `wrangler secret put SNAPSHOT_SECRET` **and** `CONFIG.SNAPSHOT_SECRET` in `scripts/auction-drive-ingest.gs`, together, or the nightly auction feeder stops silently.

## Most common operations

**Run locally** (`.claude/launch.json` defines these):
- **Frontend** — `npx serve -l 8080 .` → http://localhost:8080 (needs a real HTTP origin; the service worker + PWA manifest break over `file://`). Talks to the live prod API.
- **Worker API** — `npx wrangler dev --port 8787` (may prompt `wrangler login`; relies on D1/KV/R2 bindings + secrets not in `wrangler.toml`).

**Deploy:**
- **Prod app** (www.retjghub.com) — push to **`main`** → GitHub Pages Action (`.github/workflows/deploy-pages.yml`) runs `scripts/build.sh` and publishes (~30 s). CNAME pins the domain.
- **Staging app** — Cloudflare Pages builds **any non-`main` branch**; `build.sh` rewrites the API base to `api-staging.retjghub.com` for non-main builds. (There is also a dedicated `staging` branch.)
- **Worker** — **manual** `npx wrangler deploy` (no CI). Same worker code serves prod; staging worker is separate.
- **D1 migrations** — **manual** `npx wrangler d1 execute labor-dashboard-db --remote --file migration-0XX.sql`.
- **Force-refresh installed PWAs** — bump `CACHE_NAME` in `sw.js` (service worker is network-first but open apps won't self-update otherwise).

**Verify a UI change without prod creds** — fetch the deployed `index.html` and grep for your markers (the app requires login and the bottom nav is `lg:hidden`, so you can't render the logged-in nav headlessly). Headless Chrome rendering of an extracted markup + the real `tailwind.css` is the pattern used for nav/layout checks. For an admin-page change specifically: serve the repo, then in the console hide `#login-page`, set `#app` to `display:flex` (boot hides it when auth fails), unhide `#page-admin-settings`, and stub `window.fetch` for the endpoint you're exercising.

**Fix a suspect day's numbers** (Settings → Admin → *Repair console*, superuser only):
1. **Health check** — pick store + range, run it. Read-only: it compares the stored KV snapshot against D1 and never touches Clover, so it's safe any time. It lists only the dates a repair would actually improve, using the *same* threshold the backfill guard uses.
2. **Repair** — acts on that list, never a range. Backs up each date before overwriting; a backup that fails aborts that date's write. Re-runs the health check afterwards so the result is verified, not asserted.
3. **Restore** — one click back, and the restore is itself reversible. Backups keep for 90 days.

🛑 **Do not reach for a date range.** Re-pulling an *already healthy* old date **loses refunds** that have aged out of Clover's ~90-day window — every unnecessary date is a small permanent loss. That's why `repair-run` refuses `start`/`end` outright.

## Known weirdness (the traps)

- **The 985 KB `index.html` breaks `git worktree` full checkout** with `fatal: mmap failed`. Use `git worktree add --no-checkout … && git -C <wt> checkout HEAD -- index.html tailwind.css`. That leaves other files as phantom "deletions" in the worktree — commit with `git commit --only index.html` so you don't commit those deletions.
- **Stale feature branches.** Long-lived branches drift far behind `main` (e.g. `marketing-intake` was ~29 commits behind). **Don't merge them into main** — cherry-pick / re-apply the single commit you want and diff against `origin/main` first. Watch for main-side changes the branch predates (e.g. the bottom-nav DOM **hoist**, and the **"Weekly" → "Retail"** tab rename) that turn a "clean" cherry-pick into a conflict.
- **Bottom nav is mobile-only** (`#bottom-nav`, `lg:hidden`) and is **hoisted out of `#main-scroll` up to `#app`** so `position:fixed` stays pinned on iOS. Viewport-pinned fixed elements must not live inside `#main-scroll`.
- **Cloudflare cron day-of-week is 1–7 with 1 = Sunday** (not POSIX 0=Sun); `"0"` is rejected.
- **D1 caps bound params at 100/query** — never `IN (?,?,…)` from an unbounded list; query by range bounds.
- **PWA dialogs** — native `confirm()`/`alert()` freeze the installed PWA; use `uiConfirm()` / `uiAlert()`.
- **Deploy order is not fixed — derive it each time** from *which side stops being backward-compatible*. Adding a server guard the client must satisfy → **frontend first** (a POST to an unguarded endpoint already works). Removing the secret from the client, or adding a client call to a new endpoint → **worker first** (the new client needs a server that already accepts it). Getting this backwards leaves the admin page broken for the whole Pages build window.
- **Worker deploys propagate gradually** — measured up to **~180 s**, and during the rollout consecutive requests hit a *mix* of old and new instances. Verifying too early reads old code; verifying once can read a lucky instance. Poll on the full condition you're about to assert, and require a few consecutive clean passes.
- **`aggregateItemSales` is the one true costing path.** L2/L3 resolution ladder: override → Clover L3 → `l3Map` → `L3_TO_L2` → name-match → IM# → heuristic → pattern → `Custom Sales`. `Sku Book Items` is **not a category** — it's a Clover POS convenience page (one screen per category, so stores park high-frequency products there). Never give it a category cost; `pickPrimaryCategory()` prefers an item's real category over it.
- **This is a liquidation retailer** — goods arrive by the lot, so a 99% gross margin is normal, not a bug. The signal of a bad cost mapping is a **negative** margin (e.g. a refundable bottle deposit priced against a beverage cost).

## Key links

- **Prod app:** https://www.retjghub.com  · **Prod API:** https://api.retjghub.com  · **Staging API:** https://api-staging.retjghub.com
- **Repo:** github.com/Droidan1/labor-dashboard (default branch `main`)
- **Deep knowledge:** the per-topic notes in Claude's auto-memory (`~/.claude/projects/-Users-brianhoward-Desktop-labor-dashboard/memory/`) — deploy mechanics, marketing pipeline, staging infra, etc.

## Recent changes — 2026-08-03

**Admin surface hardened end to end (4 phases, all in prod).** The admin API had drifted to ~25 endpoints against 8 UI panels, and the endpoints with no UI were the dangerous ones.

- **Phase 1** (`9ac0f51`) — seven destructive endpoints executed on a plain **GET**, including `backfill-items-snapshots`, the one that destroyed 81 days of BL1 history in July. Now POST-only. Deleted a duplicate `ingest` handler, `test-interval-summary` (fired real push notifications on demand) and `fb-publish-test`.
- **Phase 2** (`5880e8b`) — real auth, see the Auth section above. The secret left the client entirely; `manual-override` (a Phase 1 miss) got its guard. Admin page restyled onto the app's V1 palette — it was the last surface still on the pre-redesign chrome.
- **Phase 3** (`cc2ea37`, `28e6ec6`) — the **Repair console**: health check, then backup / targeted repair / restore. See "Most common operations".
- **Phase 4** (`ab5ed43`) — removed four one-off `debug-*` endpoints (−422 lines). `sales-diag` covers the same ground and survives. README de-staled in the same change.

**Worth knowing:** the health check's first run against production reported **$19,233 recoverable — all of it phantom**, because it counted *today* (whose snapshot the nightly cron hasn't written yet) as missing data. Three classification bugs like that surfaced only from real data, with a green unit suite. Current reading is **$0 recoverable, nothing needs repair**.

⏸ Two things it surfaced that are yours, not code: **BL8 took $0 on 12 of 30 days** (2026-07-20 → 08-02; both records agree, so it's real — closed?), and **~$21.6k of 30-day sales resolve to no cost at all**, heaviest at BL1 and BL16.

## Recent changes — 2026-07-21

- **Centered "Submit" mobile-nav button → shipped to prod** (`main` @ `cef1c76`). On mobile, Submit Photos moved from the "More" sheet to a dedicated **center** button (soft-green tinted squircle + upload icon) for **non-admins** (managers / district managers / basic). **Admins/superusers unchanged** — a `display:contents` fallback collapses the layout back to today's flat, even 5-tab bar; they still reach Submit Photos via More. Layout keyed off `isAdminBar = vis('nav-inventory')` in `syncBottomNav`.
- **Discovered/corrected:** the whole Submit Photos pipeline was **already in production** (shipped 2026-07-05), _not_ staging-only.
- **Added `.claude/launch.json`** with the two dev servers above (Frontend :8080, Worker API :8787).
- **Deleted branch `claude/marketing-intake`** (local + remote) — its only unique commit was the nav change, now on `main` via `cef1c76`.
