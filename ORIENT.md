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

## Key links

- **Prod app:** https://www.retjghub.com  · **Prod API:** https://api.retjghub.com  · **Staging API:** https://api-staging.retjghub.com
- **Repo:** github.com/Droidan1/labor-dashboard (default branch `main`)
- **Deep knowledge:** the per-topic notes in Claude's auto-memory (`~/.claude/projects/-Users-brianhoward-Desktop-labor-dashboard/memory/`) — deploy mechanics, marketing pipeline, staging infra, etc.

## Recent changes — 2026-07-21

- **Floating labeled bottom nav → shipped to prod** (`main` @ `111c815`, sw `v36`). The mobile bar is now a **floating frosted-glass island** (12px insets, backdrop-blur, 20px radius, labels under icons, green active icon + halo) for **all roles**. Layouts: **managers/DMs** get a centered green **Submit** squircle with Supply beside it (basic users: same minus Supply); **admins/superusers** get **Dashboard · Retail · Content · Flow · More**, with **Inventory, Supply and Submit Photos moved into the More sheet**. Retail's icon is now a shopping bag (its old calendar clashed with Flow Calendar's). Role gating still keys off `isAdminBar = vis('nav-inventory')` in `syncBottomNav`, now guarded by `window.__bnRoleReady` so a cold boot can't flash the wrong bar (fixed an admin boot-race where Submit appeared briefly). Supersedes the same-day centered-Submit ship (`cef1c76`) — that layout lives on inside the floating bar.
- **Discovered/corrected:** the whole Submit Photos pipeline was **already in production** (shipped 2026-07-05), _not_ staging-only.
- **Added `.claude/launch.json`** with the two dev servers above (Frontend :8080, Worker API :8787).
- **Deleted branches** `claude/marketing-intake` and `claude/nav-float` (local + remote) — each fully merged into `main` first.
