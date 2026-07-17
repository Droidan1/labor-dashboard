# Bargain Lane Operator Dashboard

Internal operator dashboard for the **Bargain Lane** thrift-store group
(6 locations: BL1 Coliseum · BL2 South Bend · BL4 Dupont · BL8 Holland
· BL12 Wyoming · BL14 Battle Creek). Store managers and HQ use it to
track live sales vs. budget, retail vs. bin vs. auction revenue, hourly
sales, weekly pacing, item-level sales, and supply requests.

> **Companion doc:** [`DESIGN.md`](./DESIGN.md) covers the V1 dashboard
> redesign — colors, fonts, component patterns, interaction recipes.
> This file covers what the system **is** and how to **run / deploy /
> reconcile** it.

---

## 1 · What the dashboard does

| Page | Purpose |
|---|---|
| **Dashboard** | Live "today vs. budget" for all stores. Hero total + pace + channel mix + matrix KPIs + 6 store cards (each with hourly sparkline, channel split, cart/items/orders/ASP). Day-of-week drill via the Viewing Week bar. |
| **Weekly Retail Summary** | Per-week store totals, T13 (trailing 13 weeks) view, item-sales breakdown by L2 category. Optional PDF export. |
| **Store Detail** | One store's daily breakdown for the selected week — daily sales chart, hourly drill-down, item sales by category/L3. |
| **Inventory** | Item catalog + stock view (admin / superuser). |
| **Supply Request** | Managers submit restock requests; admins triage and fulfill. |
| **Users** | Invite/edit/delete users; manage roles + per-user store assignments (admin). |
| **Admin Settings** | Item overrides, item costs, manual snapshot/backfill triggers, debug tools (superuser only). |
| **Settings** | Push-notification preferences, dark-mode, account passkeys. |

The app is a **single 10k-line `index.html`** (vanilla JS + Tailwind)
served as a static site, plus a single **Cloudflare Worker**
(`worker.js`) that handles auth, Clover API integration, D1 reads/writes,
KV snapshots, push notifications, and ~30 admin actions.

---

## 2 · How to run it locally

The frontend and worker run independently. For most UI work you can
get away with just the frontend + the **staging API** as the backend.

### 2.1 Frontend only (against staging worker — easiest)

```bash
npm install
npm run build                  # produces dist/ — runs scripts/build.sh
npx wrangler pages dev dist    # serves on http://localhost:8788
```

Set `CF_PAGES_BRANCH=staging` before `npm run build` and the build
will rewrite the API base in `dist/index.html` from
`https://api.retjghub.com` to `https://api-staging.retjghub.com`, so
your local app talks to the staging worker (which uses isolated D1 /
KV and won't touch prod data):

```bash
CF_PAGES_BRANCH=staging npm run build
npx wrangler pages dev dist
```

Auth still works against the staging worker — log in with
`bhoward@bargainlane.com` via magic link (Resend sends to the real
inbox); a session cookie is set for `localhost`/`retjghub.com`.

### 2.2 Frontend + local worker

Useful when you're changing `worker.js`.

```bash
npm install                                # tailwind dev dep
npx wrangler dev                           # runs worker.js on :8787 with local D1
# in another tab:
CF_PAGES_BRANCH=staging npm run build
npx wrangler pages dev dist --port 8788
```

Then in the served `index.html` (or via DevTools), point `WORKER_BASE`
at `http://localhost:8787/`. The local worker uses an empty D1 by
default — apply schema + migrations the first time:

```bash
npx wrangler d1 execute labor-dashboard-db --local --file=schema.sql
for f in migration-*.sql; do
  npx wrangler d1 execute labor-dashboard-db --local --file=$f
done
```

### 2.3 Quick "just look at the redesign"

The staging environment is always live at
[`https://staging.retjghub.com`](https://staging.retjghub.com). Log in
with the same email — full data flow, no local setup. Use this for
design review.

---

## 3 · Data flow

```
                          ┌───────────────────────────┐
                          │ Clover POS (per-store     │
                          │ merchant_id + API token)  │
                          └──────────┬────────────────┘
                                     │  /v3/merchants/.../orders
                                     │  (real-time)
                                     ▼
┌──────────────────┐         ┌────────────────────┐
│ Google Sheets    │ admin   │  Cloudflare Worker │
│ (budget, labor,  │ ── ───▶│  clover-sales-api  │
│  auction)        │ action  │  worker.js         │
└──────────────────┘ =backfill└──────────┬─────────┘
                                         │
                       ┌─────────────────┼──────────────────┐
                       ▼                 ▼                  ▼
                 ┌───────────┐   ┌──────────────┐    ┌────────────┐
                 │ Cloudflare│   │ Cloudflare KV│    │ Push (VAPID)│
                 │ D1        │   │ SALES_       │    │ + Email     │
                 │ daily_    │   │ SNAPSHOTS    │    │ (Resend)    │
                 │ sales,    │   │ sales:*,     │    └────────────┘
                 │ users,    │   │ items:*,     │
                 │ sessions, │   │ webauthn:*   │
                 │ supply_*  │   └──────────────┘
                 └─────┬─────┘
                       │
                       ▼
                 ┌────────────────────┐
                 │  index.html (PWA)  │
                 │  served by         │
                 │  GitHub Pages →    │
                 │  www.retjghub.com  │
                 └────────────────────┘
```

**Read paths the dashboard uses:**

| What | Source | Notes |
|---|---|---|
| Today's live totals | Worker → Clover orders API | Per-store `fetchLiveCloverSales`. Real-time. |
| Historical totals | D1 `daily_sales` table | Written by snapshot cron + Sheets backfill. |
| Item sales (per L2 category) | KV `items:<store>:<date>` | Written by snapshot cron's item-aggregation step. |
| Hourly sparkline | Worker → Clover orders API | `?action=hourly` — fresh fetch per render (cached 5 min). |
| Weekly summary | KV `wks:<store>:<week>` | Rolled up by end-of-day cron. |
| Budgets / labor / auction | Google Sheets → D1 | Imported via `?action=backfill`. |

**Write paths:**

| When | What runs | Writes |
|---|---|---|
| Every minute | `crons: "* * * * *"` — sale scheduler | Activates pending sales, reverts expired ones. |
| Hourly (top of hour) | `crons: "0 * * * *"` | Hourly snapshot push notifications. |
| Daily 11:55 PM ET (`crons: "55 3 * * *"`) | End-of-day rollup | Per-store snapshot → D1 + KV `sales:` + `items:` + week rollup. |
| Daily 6 AM ET (`crons: "0 10 * * *"`) | Daily summary email | Email digest via Resend. |
| Sunday 7 AM ET (`crons: "0 11 * * 1"`) | Weekly digest | Email digest via Resend. |
| Manual | `?action=backfill` | Pulls Sheets → upserts D1 (manual-override rows preserved). |
| Manual | `?action=snapshot&store=...&date=...` | Re-fetches Clover for a store/day, writes D1 + KV. |

> **Note on staging:** the staging worker
> (`clover-sales-api-staging`) has **crons disabled** (`crons = []`
> under `[env.staging.triggers]` in `wrangler.toml`) to prevent
> double-firing notifications. Staging data is whatever it was the
> last time someone manually triggered `?action=snapshot` on it.

---

## 4 · Required environment variables

All configured per worker environment in Cloudflare. The non-secret
ones live in `wrangler.toml` `[vars]` (or `[env.staging.vars]`); the
secret ones are set via `wrangler secret put`.

### 4.1 Bindings (declared in `wrangler.toml`)

| Binding | Type | Purpose |
|---|---|---|
| `DB` | D1 | `labor-dashboard-db` (prod) / `labor-dashboard-db-staging` |
| `SALES_SNAPSHOTS` | KV | `sales:`, `items:`, `wks:`, `webauthn:` keys |

### 4.2 Vars (non-secret, in `wrangler.toml`)

| Var | Purpose |
|---|---|
| `BL1_MERCHANT_ID`, `BL1_API_TOKEN` | Clover credentials per store — one pair each for BL1/BL2/BL4/BL8/BL12/BL14 |
| `SNAPSHOT_SECRET` | Admin gate — required as `X-Snapshot-Secret` header on every admin/debug action |
| `VAPID_SUBJECT` | e.g. `mailto:noreply@retjghub.com` — required by the Web Push spec |
| `APP_ORIGIN` (staging only) | `https://staging.retjghub.com` — used for WebAuthn origin checks + magic-link redirects |
| `API_ORIGIN` (staging only) | `https://api-staging.retjghub.com` — used for magic-link verify URLs |

Production reads `APP_ORIGIN` / `API_ORIGIN` as unset → falls back to
`https://www.retjghub.com` / `https://api.retjghub.com`.

> **Security note:** `wrangler.toml` is committed with live Clover
> tokens and `SNAPSHOT_SECRET` in plain text. That predates this work;
> rotating those into `wrangler secret` and scrubbing the repo is a
> separate hardening task on the backlog.

### 4.3 Secrets (must be set per env via `wrangler secret put`)

| Secret | Used by | Set on prod | Set on staging |
|---|---|:--:|:--:|
| `RESEND_API_KEY` | Magic-link, daily/weekly digest, supply-request notifications | ✅ | ✅ |
| `VAPID_PUBLIC_KEY` | Web Push (advertised to clients) | ✅ | ⚠️ optional |
| `VAPID_PRIVATE_KEY` | Web Push (server signs envelopes) | ✅ | ⚠️ optional |

To set/rotate a secret:

```bash
npx wrangler secret put RESEND_API_KEY                  # prod
npx wrangler secret put RESEND_API_KEY --env staging    # staging
```

---

## 5 · Role definitions

Source of truth: `users.role` column with
`CHECK(role IN ('superuser','admin','district_manager','manager'))`
plus a `stores` JSON array (`NULL` = all stores).

| Role | Stores | Page access |
|---|---|---|
| **superuser** | all | Everything, incl. Admin Settings (item overrides, item costs, manual snapshot/backfill, debug endpoints). |
| **admin** | all | Same as superuser **except** Admin Settings. Can manage users. |
| **district_manager** | assigned (`stores` array) | Dashboard, Weekly Retail Summary, Supply Request, Settings. Read-only on assigned stores. |
| **manager** | assigned (`stores` array) | Dashboard, Weekly Retail Summary, Supply Request, Settings. Read-only on assigned stores. |

Frontend gating (`index.html:9720-9726`) hides the corresponding
sidebar/bottom-nav items by role. **The worker also enforces role on
data endpoints** — never rely on the frontend alone for permissions.

Account status: `users.status` is `active` or `suspended`. Suspended
accounts can't log in (`auth-verify` rejects).

---

## 6 · Deployment

### 6.1 Production

Two pieces deploy independently.

**Worker (`clover-sales-api` → `https://api.retjghub.com`)**

```bash
# from the main branch checkout, after merging changes into main:
npx wrangler deploy
```

This deploys `worker.js` + the cron schedules + bindings + vars defined
in `wrangler.toml`. Secrets are persisted server-side and don't need
to be re-set per deploy.

**Frontend (`www.retjghub.com`)**

Currently served by **GitHub Pages** from the `main` branch (the `CNAME`
file points at `www.retjghub.com`). Pushing to `main` updates production
within a minute. There's also a **Cloudflare Pages** project
(`labor-dashboard`) wired to `main`, parked unused until a future cutover.

### 6.2 Staging

Worker: `clover-sales-api-staging` → `https://api-staging.retjghub.com`
Frontend: Cloudflare Pages project `labor-dashboard-staging` → `https://staging.retjghub.com`

```bash
# from the staging branch:
npx wrangler deploy --env staging
```

Pushing the `staging` branch to GitHub also triggers a Cloudflare Pages
build of the frontend automatically (build command: `npm run build`,
output: `dist`, branch `staging` is the project's production branch).

### 6.3 Schema migrations

D1 migrations live as `migration-NNN.sql` at the repo root. Apply in
order to a fresh DB; on existing DBs, only apply migrations that haven't
run yet (D1 doesn't track migration state — track manually).

```bash
# Apply to prod:
npx wrangler d1 execute labor-dashboard-db --remote --file=migration-014.sql

# Apply to staging:
npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-014.sql
```

> **Always test on staging first.** Staging D1 was bootstrapped from a
> one-time prod export; schema drift between the two should be
> rare-to-nonexistent.

### 6.4 Cutover path (when the redesign goes live)

The current redesign lives entirely on the `staging` branch. To
promote it:

1. Open a PR `staging` → `main`. Review the full diff.
2. Merge — GitHub Pages auto-rebuilds `main`. (Or: switch
   `www.retjghub.com` to the `labor-dashboard` Cloudflare Pages
   project, which lets you preview the merged main on
   `labor-dashboard.pages.dev` before flipping DNS.)
3. `npx wrangler deploy` from `main` to push any worker changes.
4. Done. Rollback = `git revert` + redeploy.

---

## 7 · Known limitations

- **Production frontend is still served by GitHub Pages**, not
  Cloudflare Pages. Fine, but the Cloudflare Pages project is wired up
  whenever you want to move it.
- **Production worker has cron triggers; staging does not.** Staging
  data ages over time unless someone manually invokes
  `?action=snapshot` against it.
- **Bin/Retail classification is by line-item *name regex*** (`/\bbin\b/i`,
  `/\bfill a bag\b/i`, `/\bglass case\b/i`) in
  `fetchLiveCloverSales`. The KV item snapshot uses a separate
  **L2-category** classification. The two paths can disagree on edge
  cases; see the `[aggregator-drift]` log line in the worker for warnings.
- **`avg_asp` was previously buggy** (divided by order count, not
  item count). Fixed via PR #113; D1 backfilled across 2026-01-18 →
  2026-05-20. Rows older than that may still hold the old values; some
  dates with single-qty items legitimately show ASP ≈ Cart.
- **Per-channel budgets don't exist.** Only one whole-day `budget`
  column on `daily_sales`. "vs budget" comparisons are total-only.
  Adding per-channel budgets requires source-data changes (Sheets) +
  migration + worker ingest + frontend wiring.
- **Push notifications** require an HTTPS origin + Service Worker +
  VAPID secrets — only work on prod (and on staging if you set the
  VAPID secrets there).
- **Live Clover fetch is per-store, sequential per dashboard render**
  (~6 HTTP calls). Mitigated by `cachedFetch` (5-min TTL). A batched
  worker endpoint would cut this if it becomes a perf issue.
- **Service worker (`sw.js`)** can pin users to a stale build.
  `_headers` is generated by the Pages build with `Cache-Control:
  no-cache` for `sw.js` and `index.html` to keep this manageable; if
  someone reports stale UI, ask them to refresh twice.
- **Single-file `index.html`** (~10k lines). No build step beyond
  Tailwind compilation. Refactoring into modules is a known piece of
  future work; not blocking anything today.

---

## 8 · Backfill & data reconciliation

All admin endpoints are gated by:

```
X-Snapshot-Secret: <SNAPSHOT_SECRET>
```

Replace `<host>` below with `api.retjghub.com` (prod) or
`api-staging.retjghub.com` (staging).

### 8.1 Re-snapshot a single store/day

Re-fetches Clover orders for that day, recomputes everything, writes to
D1 + KV `sales:` + KV `items:`. Idempotent; respects `is_manual_override`.

```bash
curl -H "X-Snapshot-Secret: $SECRET" \
  "https://<host>/?action=snapshot&store=BL1&date=2026-05-20"

# or all stores in one call:
curl -H "X-Snapshot-Secret: $SECRET" \
  "https://<host>/?action=snapshot&store=ALL&date=2026-05-20"
```

### 8.2 Loop snapshots over a date range (range backfill)

Used to fix the ASP regression. Loops sequentially with a small
politeness delay; logs progress.

```bash
DATES=$(python3 -c '
import datetime as dt
d, end = dt.date(2026,5,1), dt.date(2026,5,20)
while d <= end:
    print(d.isoformat()); d += dt.timedelta(days=1)
')
for date in $DATES; do
  curl -sS -H "X-Snapshot-Secret: $SECRET" \
    "https://<host>/?action=snapshot&store=ALL&date=$date" > /dev/null \
    && echo "$date ok" || echo "$date FAIL"
  sleep 0.25
done
```

Each call takes ~3–12s. 100 days ≈ 10–20 min.

### 8.3 Reconcile from Google Sheets

Pulls budget / labor / auction / week labels from the source Sheet and
upserts D1. Cron-authoritative columns (Clover-sourced) are only filled
when null; Sheet-authoritative columns (budget, auction, labor) always
win. `is_manual_override = 1` rows are protected from any change.

```bash
# All stores:
curl -H "X-Snapshot-Secret: $SECRET" "https://<host>/?action=backfill"

# Filter to one store to stay under the Worker subrequest limit:
curl -H "X-Snapshot-Secret: $SECRET" "https://<host>/?action=backfill&store=BL1"
```

### 8.4 Other admin actions worth knowing

| Endpoint | What |
|---|---|
| `?action=backfill-items-snapshots&store=BLx&from=YYYY-MM-DD&to=YYYY-MM-DD` | Re-rolls KV `items:` snapshots over a date range. |
| `?action=rebuild-week-summaries` | Re-rolls the trailing-13-week summary KV entries. Run after a re-snapshot backfill. |
| `?action=refresh-item-cats` | Forces the worker to refresh its per-store Clover item-category cache. Run if newly-added items aren't being classified. |
| `?action=items-snapshot&store=BLx&date=YYYY-MM-DD` | One-off item-snapshot write (without touching D1). |
| `?action=sales-diag&store=BLx&date=YYYY-MM-DD` | Read-only diagnostics — explains how the worker reconciled Clover totals for that day. |
| `?action=noncategorized-items&store=BLx` | Lists items missing an L2 category — input for the override list. |
| `?action=item-overrides`, `?action=item-costs` | Read/write the override/cost lookup tables (used by item-snapshot aggregation). |
| `?action=debug-revenue-mismatch&store=BLx&date=YYYY-MM-DD` | Compares `aggregateOrders` total vs. payment-based total to find drift. |

All require `X-Snapshot-Secret`. All are safe to retry; the write
endpoints are idempotent (UPSERT semantics on D1, overwrite on KV).

### 8.5 Recovery scenarios

| Symptom | Fix |
|---|---|
| Today's dashboard numbers look off vs. Clover dashboard | `?action=snapshot&store=BLx&date=<today>` to re-fetch + recompute |
| A whole past day is wrong / missing | Same, with `date=<that day>` |
| Multiple days wrong | Loop snapshots (§8.2) |
| Budget / auction / labor wrong | `?action=backfill&store=BLx` to re-import from Sheets |
| Item Sales tab empty for a date | `?action=snapshot&store=BLx&date=<date>` (the snapshot action writes the item snapshot too) — or just `?action=items-snapshot` for that one piece |
| Weekly Retail Summary's T13 looks stale after a snapshot backfill | `?action=rebuild-week-summaries` |
| New Clover items not classified | `?action=refresh-item-cats`, then re-snapshot affected days |
| Push notifications not arriving | Check `VAPID_*` secrets are set on the worker; check `notification_preferences` row for the user; check `webauthn_credentials` (passkey login is required for full push permissioning on some browsers) |

---

## 9 · Repo layout

```
.
├── README.md             ← you are here
├── DESIGN.md             ← redesign spec (V1 Operator, tokens, components)
├── index.html            ← the dashboard (single 10k-line PWA)
├── sw.js                 ← service worker (push, offline shell)
├── manifest.json         ← PWA manifest
├── worker.js             ← Cloudflare Worker (API + crons + auth)
├── wrangler.toml         ← worker config (bindings + vars + crons)
├── package.json          ← npm scripts (build runs tailwindcss)
├── tailwind.config.js    ← V1 design tokens
├── tailwind.input.css    ← @tailwind base/components/utilities
├── tailwind.css          ← prebuilt CSS (also rebuilt by build.sh)
├── schema.sql            ← initial D1 schema
├── migration-NNN.sql     ← incremental schema migrations
├── scripts/build.sh      ← Cloudflare Pages build: copies static
│                           assets to dist/, runs tailwindcss, rewrites
│                           API base on non-main branches
├── html/                 ← per-store reference pages
├── docs/                 ← internal preview/notification mockups
└── CNAME                 ← GitHub Pages domain (www.retjghub.com)
```

---

## 10 · Contact / on-call

Owner: `bhoward@bargainlane.com` (superuser).

For data discrepancies that aren't covered by §8.5, the
`?action=sales-diag&store=BLx&date=YYYY-MM-DD` endpoint is the
right first stop — it returns a JSON breakdown of how the worker
reconciled totals for that day from Clover orders, payments, refunds,
and manual entries.
