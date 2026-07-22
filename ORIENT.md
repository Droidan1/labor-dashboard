# ORIENT — labor-dashboard (Bargain Lane / RETJG Hub)

_Orientation for a human sitting down after time away. Not a file index — a mental model + the operations you actually run._

## What this is

An installable **PWA sales + labor dashboard** for the Bargain Lane / RETJG retail stores, pulling live data from **Clover POS** (multiple store merchant accounts). Managers see daily sales vs budget, weekly retail summaries, inventory, supply requests; admins additionally get marketing tooling (Meta ad reporting, a promo Flow Calendar, a photo-intake → caption → Facebook publish pipeline) and a Morning Brief. Role-gated: `superuser` / `admin` / `district_manager` / `manager` / basic.

## Codebase shape (the mental model)

- **Frontend = one giant static file.** `index.html` (~985 KB, ~15.5k lines) is the entire single-page app: markup for every "page" (toggled by `navigateToPage()` / `#page-*` divs), all CSS in `<style>` blocks + Tailwind utility classes, and all logic in a handful of inline `<script>` blocks (vanilla JS, no framework, no bundler). There is **no build step for the app JS** — you edit `index.html` directly.
- **Tailwind is precompiled.** `tailwind.css` is generated from `tailwind.input.css` + `tailwind.config.js` by `scripts/build.sh` (`npx tailwindcss --minify`). The build scans `index.html`, so newly-used utility classes only exist after a rebuild. Custom component styles live in `index.html`'s `<style>`, not Tailwind.
- **Backend = one Cloudflare Worker.** `worker.js` + `wrangler.toml` (worker name **`clover-sales-api`**). Bindings: **D1** (`labor-dashboard-db`, historical/structured data + `migration-*.sql`), **KV** (`SALES_SNAPSHOTS`, daily snapshots), **R2** (`bl-marketing-media`, manager photo submissions + generated assets). Cron triggers do EOD rollups, the sale scheduler (every minute), hourly push summaries, and the weekly digest.
- **The app talks to the deployed API, not localhost.** `index.html`'s `WORKER_BASE` is hardwired to `https://api.retjghub.com/` — so even the local static server hits **prod** data unless you point it elsewhere.

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

**Verify a UI change without prod creds** — fetch the deployed `index.html` and grep for your markers (the app requires login and the bottom nav is `lg:hidden`, so you can't render the logged-in nav headlessly). Headless Chrome rendering of an extracted markup + the real `tailwind.css` is the pattern used for nav/layout checks.

## Known weirdness (the traps)

- **The 985 KB `index.html` breaks `git worktree` full checkout** with `fatal: mmap failed`. Use `git worktree add --no-checkout … && git -C <wt> checkout HEAD -- index.html tailwind.css`. That leaves other files as phantom "deletions" in the worktree — commit with `git commit --only index.html` so you don't commit those deletions.
- **Stale feature branches.** Long-lived branches drift far behind `main` (e.g. `marketing-intake` was ~29 commits behind). **Don't merge them into main** — cherry-pick / re-apply the single commit you want and diff against `origin/main` first. Watch for main-side changes the branch predates (e.g. the bottom-nav DOM **hoist**, and the **"Weekly" → "Retail"** tab rename) that turn a "clean" cherry-pick into a conflict.
- **Bottom nav is mobile-only** (`#bottom-nav`, `lg:hidden`) and is **hoisted out of `#main-scroll` up to `#app`** so `position:fixed` stays pinned on iOS. Viewport-pinned fixed elements must not live inside `#main-scroll`.
- **Cloudflare cron day-of-week is 1–7 with 1 = Sunday** (not POSIX 0=Sun); `"0"` is rejected.
- **D1 caps bound params at 100/query** — never `IN (?,?,…)` from an unbounded list; query by range bounds.
- **PWA dialogs** — native `confirm()`/`alert()` freeze the installed PWA; use `uiConfirm()` / `uiAlert()`.
- **Submitted photos have thumbnails now.** A photo is served full-res from `?action=photo&id=N`, but grids/peeks/tiles/preview must request **`?action=photo&id=N&size=thumb`** to get the small (~320 px) derivative — otherwise you're loading multi-MB originals into 78 px boxes. The thumb key is **derived** (`thumbKeyOf` = original R2 key with a `.thumb.jpg` suffix, no DB column); `size=thumb` falls back to the original when a thumb is missing. New uploads generate the thumb **client-side** at submit (`spMakeThumb`, canvas, EXIF-oriented); Cloudflare Image Resizing is **not** available here (app is on GitHub Pages, R2 is private). All existing photos were backfilled.
- **Floating-nav bottom clearance must include the safe-area inset.** The nav sits at `bottom: calc(12px + env(safe-area-inset-bottom))`, so any content padding meant to clear it must add `env(safe-area-inset-bottom)` too — a fixed `pb-24` under-clears on Android gesture-nav phones and hides the last element (this is what buried the Supply Submit button). `#main-scroll` now uses `calc(7rem + env(safe-area-inset-bottom))` on mobile.

## Key links

- **Prod app:** https://www.retjghub.com  · **Prod API:** https://api.retjghub.com  · **Staging API:** https://api-staging.retjghub.com
- **Repo:** github.com/Droidan1/labor-dashboard (default branch `main`)
- **Deep knowledge:** the per-topic notes in Claude's auto-memory (`~/.claude/projects/-Users-brianhoward-Desktop-labor-dashboard/memory/`) — deploy mechanics, marketing pipeline, staging infra, etc.

## Recent changes — 2026-07-22

A heavy day on the **Content** (Content Studio composer) and photo pipeline, all shipped to prod (`main` advanced `111c815` → **`17c0484`**, sw **`v36` → `v41`**). Newest last:

- **Content page: photo-type sub-folders + upload alerts** (`main` @ `0283d52`, sw `v37`, `migration-026`). Inside each week photo-folder, submitted photos now group into **Retail / Bins / Event / Other** sub-folders (by the existing `marketing_photos.photo_type` — no data migration). When a **non-admin** submits photos, admins/superusers get a **web push** (reuses the `sendWebPush` path the hourly Sales Update uses), gated by a per-admin **"Photo upload alerts"** toggle in Settings › Notifications (`notification_preferences.upload_alerts`, default on).
- **Notification tap → the exact folder** (`main` @ `6f3ce9b`, sw `v38`). The upload push deep-links straight to that store's **week › type** folder on the Content page (`cf_store`/`cf_date`/`cf_type` → `ctDeepLinkToFolder`), not just the page. Also fixed a cold-start deep-link gap (the boot router only handled `?view=`).
- **Content page performance overhaul** (`main` @ `ee85194` → `f61e3c9`, sw `v39` → `v40`). Root cause of the slow/sluggish composer + failed previews + "can't view all photos": full-res images used as thumbnails and a per-image session `UPDATE`. Phase 1 (frontend): the live preview is a **swipeable carousel** of the cover + every selected photo; selecting a photo updates tiles **in place** (no picker rebuild); `decoding="async"`, parallel loads, deferred Thumbnails grid. Phase 2: **client-generated ~320 px thumbnails** served via `size=thumb` (see traps) — ~300× fewer bytes. Phase 3: session-expiry `UPDATE` throttled to ~once/day (was every request incl. every image) + `Cache-Control: immutable`. **Backfilled all 433 existing photos** (0 failed).
- **Supply page (and all pages): mobile scroll fix** (`main` @ `17c0484`, sw `v41`). On Android gesture-nav phones the floating nav hid the bottom of the form (notably the Supply **Submit** button) → "can't scroll down." Fix: `#main-scroll` bottom padding is now safe-area-aware (see traps); also hardened `navigateToPage` to reset a leaked `body.style.overflow` scroll-lock.
- **Deleted branches** (all fully merged into `main` first): `claude/content-subfolders-upload-notif`, `claude/notif-folder-deeplink`, `claude/content-perf-phase1`, `claude/content-perf-phase23`, `claude/supply-scroll-fix`.

## Recent changes — 2026-07-21

- **Floating labeled bottom nav → shipped to prod** (`main` @ `111c815`, sw `v36`). The mobile bar is now a **floating frosted-glass island** (12px insets, backdrop-blur, 20px radius, labels under icons, green active icon + halo) for **all roles**. Layouts: **managers/DMs** get a centered green **Submit** squircle with Supply beside it (basic users: same minus Supply); **admins/superusers** get **Dashboard · Retail · Content · Flow · More**, with **Inventory, Supply and Submit Photos moved into the More sheet**. Retail's icon is now a shopping bag (its old calendar clashed with Flow Calendar's). Role gating still keys off `isAdminBar = vis('nav-inventory')` in `syncBottomNav`, now guarded by `window.__bnRoleReady` so a cold boot can't flash the wrong bar (fixed an admin boot-race where Submit appeared briefly). Supersedes the same-day centered-Submit ship (`cef1c76`) — that layout lives on inside the floating bar.
- **Discovered/corrected:** the whole Submit Photos pipeline was **already in production** (shipped 2026-07-05), _not_ staging-only.
- **Added `.claude/launch.json`** with the two dev servers above (Frontend :8080, Worker API :8787).
- **Deleted branches** `claude/marketing-intake` and `claude/nav-float` (local + remote) — each fully merged into `main` first.
