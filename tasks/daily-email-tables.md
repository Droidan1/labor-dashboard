# Daily Sales Summary email — 3 new tables + app parity

Status: **SHIPPED TO PROD 2026-07-15** — main `4ee6468`, worker version `a4922cdd`. Verified end-to-end against real prod data via `?action=preview-daily-summary`. App (GitHub Pages) live with auction change. Follow-up shipped: small L2 categories fold into "Other", negative $ shows `-$X`. (Mid-way a stale wrangler.toml regressed prod config — MEDIA/BL16/cron — caught + fixed by redeploying the git-tracked config; see [[prod-deploy-mechanics]] / tasks/lessons.md.)
Owner: Brian. Covered day in mockups = Tue Jul 14 (email sends AM of Jul 15 for "yesterday").

## Locked spec (confirmed with boss via 3 preview rounds)

**Table 1 — By Store** (CORRECTED against real main base)
- Real prod columns: `Store | Retail | BIN | Auction | Total | vs Budget`. Total already = total+auction.
- Change = **insert one `Budget $` column** between Total and vs Budget → `Store | Retail | BIN | Auction | Total | Budget $ | vs Budget`.
- Keep the channel split (Retail/BIN/Auction) — boss confirmed. No vs LW exists. Header stays "Total".
- Budget already on `data.stores[].budget` + `data.totals.budget`; render `_fmtDollars(budget)`.
- Store list on main: BL1 Coliseum, BL2 South Bend, BL4 Dupont, BL8 Holland, BL14 Battle Creek, BL16 Indy East.

**Table 2 — Category Sales · All Stores (NEW)**
- Columns: `Category | Units | Net Sales | ASP`.
- Consolidated L2 for the day across all 6 stores: read KV `items:<store>:<date>` ×6 → `mergeItemSnapshots()` (already sorts by net desc).
- Append **Auction** row: net $ only (= SUM daily_sales.auction for the day), Units + ASP = "—".
- Total row: units, net (incl auction) = Total Sales, blended ASP = item-based `(net−auction)/qty`.

**Table 3 — Daily Breakdown · All Stores (NEW), styled like the app**
- App card layout: date badge, big actual, progress bar, `vs $budget`, variance $.
- **Actual = total + auction** per day (so it reconciles with Tables 1 & 2).
- **Month-to-date header** + **Week-to-date footer**, both with **budget prorated to reported days** (the same days that have actual sales, through the covered day). Not full-period budget.
- Future days = **pending "—"** (deviation from the app's literal $0.00/−budget, to stay consistent with to-date totals).
- "N of 7 days reported" computed correctly (count of days with actual sales).

**App parity (index.html)**
- Include auction in the on-screen **combined Daily Breakdown** so app matches email.
- Auction already client-side as `aAuction` (index.html:3062, from history_d1 `auction`) — scoped change, no worker/endpoint change.

## Data facts (verified)
- Email = server-rendered in worker.js; recipients = active users with `notification_preferences.daily_summary=1`; sent via Resend; cron `0 10 * * *` (5 AM ET) for **yesterday**. Manual trigger: `POST ?action=send-daily-summary&date=YYYY-MM-DD` (superuser/admin-secret).
- L2 per-store/day already cached nightly in KV `items:<store>:<date>` (cron `55 3 * * *`) → 6 KV reads, **zero** Clover calls at email time.
- Weekly-by-day = one D1 range query over `daily_sales` (7 days × 6 stores). No `IN(...)` param blowup (range bounds).
- `daily_sales.budget` present for future days too (ingested ahead) → pending days have budget, null total.
- ALL_STORES = BL1,BL2,BL4,BL8,BL12,BL14. STORE_LABELS on this branch still show BL12=Wyoming (prod may be Indy East BL16).

## Build tasks
### worker.js (email) — DONE
- [x] Table 1: inserted `Budget` column (header/rows/footer) between Total and vs Budget. No vs LW on main; header kept as "Total"; Total already = total+auction.
- [x] NEW `buildDailyCategoryData(env, date)`: 6× KV `items:` reads → `mergeItemSnapshots` → auction row from `SUM(auction)`.
- [x] NEW `renderCategoryTableHtml` (email-safe `<table>`).
- [x] NEW `buildWeeklyByDayData(env, date)`: retail week via `daily_sales.week`+`resolveWeekDates`; per-day `SUM(total/auction/budget)`; reported/today/pending; WTD + MTD budget-to-date.
- [x] NEW `renderWeeklyBreakdownHtml` + `_barHtml` — nested tables + table-cell bars (Outlook-safe), MTD header + WTD footer.
- [x] `buildSummaryEmailHtml(data, brief, categoryData, weeklyData)`; dispatch fetches both best-effort, builds HTML once.
- [x] NEW read-only `GET ?action=preview-daily-summary&date=` (superuser/admin-secret) — renders HTML without sending.

### index.html (app parity) + sw.js — DONE
- [x] `buildAllStoresWeeklyTable` (real line ~5470): day sales = `posSales + (r.aAuction ?? 0)`. Today's live row unaffected (aAuction null).
- [x] `CACHE_NAME` v26 → v27.

### Verify
- [x] Node render-test against the REAL worker code (mock data) — all assertions pass; visually confirmed in browser, matches approved v4. `scratchpad/render-output.html`.
- [ ] Deploy worker to **staging**; `GET ?action=preview-daily-summary&date=<recent>` to verify the DATA path (real KV categories + D1 weekly). Render proven; data path not yet.
- [ ] Confirm app combined breakdown matches email numbers.

## Status
- 3 files changed (+280/−4): worker.js, index.html, sw.js. Staged clean (partial worktree checkout → other files untouched, no phantom deletions in the staged set).
- NOT committed (awaiting go). NOT deployed. Deploy target = branch off `origin/main` (`claude/daily-email-tables`).
