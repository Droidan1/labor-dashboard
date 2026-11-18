# Live Item Sales & Bin Split — build plan (revised)

2026-11-17 · Brian Howard · Line numbers are `main` at 658a8d6. Revised from the PDF "RETJG HUB — Live Item Sales & Bin Split: Claude Code
Build Plan" after checking it against `worker.js`, `cli/reporting.mjs` and live data. What changed and
why is at the bottom.

## Goal

One MCP/CLI call answers "how are bins vs Christmas bins doing?" for today, week to date, the current
bin cycle, month to date or any range, by store, price or day, at any hour, without waiting for the
nightly run (03:55 UTC = 22:55 EST / 23:55 EDT).

**Periods (Brian, 2026-11-17):**

- **Week to date (`wtd`)** = the Hub week, **Sunday → Saturday**, through today.
- **Bin cycle (`cycle`)** = **Friday → Wednesday**, through today: from the most recent Friday on or before
  today, to today or that Wednesday, whichever is earlier. On a **Thursday** it is the cycle that just
  ended (last Friday → yesterday). Thursday sales sit outside every cycle; they are tiny (chain-wide bin
  net on Thu 2026-11-12 was $22) and still count in `wtd`, `mtd` and custom ranges.

**Done when:**

- [ ] `get_bin_split` returns today's numbers, at most 5 minutes old, for every open store (BL1, BL2, BL4,
      BL14, BL16), and BL8 as `closed`, not 0
- [ ] Ranges combine final saved days with a live pull, each store-day from exactly one source, and say
      which (`savedThrough`, `liveDays`, `missingDays`)
- [ ] Today's live total per store is within 2% of `get_today_sales` taken the same minute
- [ ] Nothing new writes anything except the `live-items:` cache key, proven by a test that drives
      `worker.fetch`
- [ ] The Christmas bin rule lives in a setting with a built-in default, not in scattered code
- [ ] `npm test` passes, and each new test fails without the change

## What already exists (verified 2026-11-17)

| Piece | Where | Status |
|---|---|---|
| One aggregation for every path | `aggregateItemSales` [worker.js:4070](../../worker.js) | Shared by the nightly run, sweep, repairs and live paths. **No refactor needed.** |
| Live item pull for today | `?action=items` (no date) [worker.js:32321](../../worker.js) | Exists, but has two gaps (see Rule 2 and 3). Leave it alone; build beside it. |
| Clover orders + line items | `fetchItemOrders` [worker.js:4968](../../worker.js) | Pages; returns `null` on a failed page. Filters on `createdTime`. |
| 429 retry | `cloverFetch` | Exists. |
| Nightly inputs | nightly cron (`55 3 * * *`, 03:55 UTC) [worker.js:32775](../../worker.js) | `fetchItemOrders` + `fetchRefundElements` + `fetchManualRefunds` + `fetchCrossDayOrdersForRefunds` + `fetchItemCategoryMap` + overrides + costs |
| Saved per-item record | D1 `item_day_lines`, read by `?action=item-lines` [worker.js:31308](../../worker.js) | What `get_item_mapping` reads. Rows carry `code`, `l2`, `qty`, `net`, `orders`. From 2026-10-14. |
| Range + store scope | `itemRangeScope` [worker.js:3969](../../worker.js) | Allowed stores; all stores ≤ 31 days, one store ≤ 92. |
| Agent door | `REPORTING_READ_THROUGH` [worker.js:18281](../../worker.js), `READ_THROUGH_PARAMS` [:18297](../../worker.js) | New actions and params must be listed or they are refused. |
| Business gate | action map [worker.js:5558](../../worker.js) | Fail-closed: an unlisted action is refused. |
| Closed stores | `STORE_CLOSED_FROM` [worker.js:6230](../../worker.js) | BL8 closed. BL16 uses BL12's Clover merchant (`WRS_CUTOVER`). |
| Tool table | `QUERIES` in `cli/reporting.mjs` | One entry serves the `retjg` CLI (Muse uses it, key `MORNING_BRIEFING_KEY`) and the MCP server (`mcp/worker.mjs` imports it). |

**🛑 When a saved day is final (corrected 2026-11-17, after Phase 1).** The `"55 3 * * *"` cron is
**03:55 UTC = 22:55 EST / 23:55 EDT** (Cloudflare crons are UTC; `wrangler.toml` says "11:55 PM ET"). So
the nightly run saves the ET day that is *ending*, and its sweep (`snapshotDayByClientTime`,
[worker.js:32831](../../worker.js)) then re-saves that day and the two before it. Day D's
`item_day_lines` row first appears at D's own nightly run, about 23:00 ET on D, and is rewritten on the
next two nights. The first draft of this plan said "03:55 ET" and described a partial row for the new
day: that was wrong. The PDF, and the reading rule at `cli/reporting.mjs:29` that every agent sees, say
"03:55 ET" too.

A saved row for day D is **final only if its `snapshot_time` is at or after D+1 03:55 UTC** (the start of
D's nightly run). A row written earlier, by a daytime repair or a manual re-snapshot, is not final.
Today is always live, even late in the evening once a row exists. Yesterday is normally final from
midnight, so it is pulled live only when its nightly run failed.

## Rules

1. **Never write live pulls into saved data.** The only new write is the KV key `live-items:<store>:<date>`.
   No `items:`, `item-hours:`, `item_day_lines`, discount record, `daily_sales` or payment archive writes.
   New code never calls `saveItemSalesSnapshot`, `fetchAggregateAndSnapshot` or `bankDiscountLines`.
   (`fetchItemCategoryMap` may refresh its own 24 h `item-cats:` copy, as it does for every caller: a
   cache, not saved history.)
2. **A failed Clover fetch is an error, not an empty day.** Any `null` from a fetch → the store reports
   `INCOMPLETE_FETCH` and nothing is cached. Never `|| []` (the existing `?action=items` does this at
   [worker.js:32358](../../worker.js); don't copy it).
   Known limit, found in Phase 1: only `fetchItemOrders` can report a failure. The refund and manual
   refund fetchers answer `[]` when Clover fails, the cross-day fetcher drops an order it couldn't
   fetch, and the category map answers what it got. The nightly run has the same blind spot; fixing
   it means an opt-in failure signal on those shared fetchers, a separate change.
3. **File items exactly as the nightly run does.** Same seven inputs as the nightly cron, including
   `fetchManualRefunds` and `fetchCrossDayOrdersForRefunds` (the existing live route skips both).
4. **Live only for today, or yesterday while its saved row is not final.** Never pull an older date live,
   even read-only. An older day with no final row goes in `missingDays`. (A day with
   `daily_sales.order_count = 0` is a real zero, as `item-lines` already treats it.)
5. **Eastern time.** Day = midnight ET to midnight ET. Live filters Clover `createdTime`; saved days are
   bucketed by `clientCreatedTime` (the sweep), so an order rung offline and synced late can sit on a
   different day. This is a known difference of well under 1%; the tool description says so.
6. **Read-only GET actions behind the existing agent door.** No new auth.

## Design

### Worker: two new GET actions

**`?action=live-items&store=` (optional store)** — today's per-item rows, live.

- `pullLiveItemDay(env, store, dateStr)`: the cron's inputs for `[startOfDay(date), startOfDay(date+1))`
  (open-ended for today), then `aggregateItemSales(..., lineSink)`. Returns
  `{ store, date, asOf, items: lineSink.items, other: lineSink.other, totals }`, where items have the same
  shape as `item_day_lines` rows.
- Cache: KV `live-items:<store>:<date>`, `{asOf, items, other, totals}`, `expirationTtl: 300`. `fresh=1`
  re-pulls only if the cached `asOf` is over 60 s old (no extra rate-limit state). Incomplete results are
  never cached.
- Stores pulled in parallel, at most 3 at a time. Closed stores (`STORE_CLOSED_FROM`) → `closed`, no
  Clover call.

**`?action=bin-split&from=&to=&store=`** — the stitched rows the tool groups.

- Scope via `itemRangeScope` (so the 31-day all-stores cap applies).
- For each store-day:
  - `date < today` and saved row final → **saved**, read per store-day from `item_day_lines` (selecting
    only the item fields the split needs). `item-lines` sums across days, so it is not reused and stays
    untouched (decided at Phase 2 start; replaces an earlier `readItemDayLines` extraction).
  - `date == today`, or `date == yesterday` with no final row → **live** (`pullLiveItemDay`, cached).
  - otherwise → `missingDays` (or a real zero, per Rule 4).
- Keeps only items with `l2 === "Bin Products"`, plus the items the config's `addToChristmas` matches
  (below), then classifies each into `group`, `subgroup` and `tier`.
- Returns rows at store × date × group × tier grain:
  `{ store, date, source: "saved"|"live", group, subgroup, tier, units, net, tickets }`
  plus `freshness: { savedThrough, liveAsOf: {store: iso}, liveDays, missingDays, closedStores }` and
  `config: { source: "default"|"kv"|"default (kv invalid)" }`.

Register both actions in the business map (`"bl"`) and `REPORTING_READ_THROUGH`; add `fresh` to
`READ_THROUGH_PARAMS`. `from`, `to`, `store`, `search`, `limit` are already allowed.

### Bin groups (`config:bin-groups`)

A built-in default in code, overridden by KV `config:bin-groups` when present and valid. Invalid JSON
falls back to the default and says so in `config.source`. Editing is by `wrangler kv key put` (Brian);
no editor in this build.

```json
{
  "christmas":      { "codePattern": "^BL-\\d+CBIN$", "nameContains": ["christmas bin"] },
  "extras":         { "names": ["Glass Case / Mystery Box", "Fill A Bag", "Ikea Bag"] },
  "addToChristmas": { "namePattern": "^\\$\\d+(\\.\\d{1,2})? XMAS$" }
}
```

- **christmas**, `subgroup: "bins"`: a Bin Products item whose code matches `codePattern` OR whose name
  contains a `nameContains` entry (any case).
- **christmas**, `subgroup: "xmas buttons"`: an item **outside** Bin Products whose name matches
  `addToChristmas.namePattern` (any case). Brian, 2026-11-17: these count as Christmas bins. Today that is
  the "$1 / $3 / $8 XMAS" register buttons, filed under L2 Seasonal (Clover category
  "FG BL SEASONAL - CHRISTMAS - GM"). Matched by name, not category, so anything else in that Clover
  category stays out. This only groups them in the split: the Retail Summary still counts them under
  Seasonal.
- **regular**: every other Bin Products item; `subgroup: "extras"` for `extras.names`, else `"bins"`.

**Tier** = the first `$N` or `$N.NN` in the item name (`$12 Bin` → `$12`, `$3 Christmas Bin` → `$3`,
`$0.50 Bin` → `$0.50`); none → `"no price"`. Not a fixed list: Christmas bins are $3/$2/$1, and $8, $10
and $3 regular bins exist.

**Tickets**: an item's `orders` count is exact for that item and day. It is **not** summed across tiers,
groups or totals: a ticket with a $6 bin and a Glass Case would count twice. Totals report units and net
only; the tool description says why.

### CLI / MCP: two entries in `QUERIES`

- **`get_bin_split`** (`cli: bin-split`) — args `period` (`today`|`wtd`|`cycle`|`mtd`|`custom`, default
  `today`), `from`, `to`, `storeId`, `groupBy` (`store`|`price`|`day`, default `store`). `request` turns
  `period` into `from`/`to` with `todayET()` (see Periods under Goal; `wtd` reuses the Sunday-start week
  the CLI already uses for `saturdayEnding`); `shape` groups the rows and adds totals, `freshness` and
  the resolved `period: { name, from, to }` so the answer says which dates it covers. An earlier cycle
  is a `custom` range.
- **`get_live_item_sales`** (`cli: live-items`) — args `storeId`, `search`, `limit`. Today's items, any
  category, filtered and limited in `shape` like `get_item_mapping`.
- Both descriptions: live figures are till sales before the overnight refund and discount settling and
  run slightly high; the live/saved day boundary differs for late-synced orders; tickets never add up.
- Add both to `READING_RULES` if a rule is needed (for example "bin-split `net` excludes non-item money").

## Phases

Branch `claude/live-item-sales`. Commit at the end of each phase with what changed and what was tested.

**Phase 0: confirm (no code)**
- [x] Re-check every row of "What already exists" and the sweep trap against current `main`. Only if
      something no longer holds: write it to `docs/live-items-notes.md`, stop and report.

**Phase 1: live item pull (worker)**
- [x] `pullLiveItemDay` with the cron's seven inputs; incomplete → error (Rules 2–3)
- [x] `?action=live-items` + KV cache + `fresh`; closed stores; 3-at-a-time
- [x] Gate entries: business map, `REPORTING_READ_THROUGH`, `READ_THROUGH_PARAMS` (`fresh`)
- [x] `scripts/test-live-items.mjs`, driving `worker.fetch` with a recording env and stubbed Clover:
  - the only write is `put live-items:*`; no D1 statement other than SELECT
  - a failed Clover page → `INCOMPLETE_FETCH`, nothing cached
  - same orders through the live helper and the cron's inputs give identical rows (golden fixture)
  - a cache hit makes no Clover call; `fresh=1` inside 60 s makes none either
- [ ] Tell Brian it's ready to deploy ahead (see Rollout) as soon as this phase is pushed

**Phase 2: bin split (worker)**
- [x] Per-day read of `item_day_lines` plus `daily_sales.order_count` (a 0 is a real zero day);
      days before a store's first record are reported as such, not missing; `item-lines` untouched
- [x] Final-row rule, stitching, `missingDays`, closed stores
- [x] `config:bin-groups` default + KV override + validation; tier parsing
- [x] Tests: a saved row for today is ignored; a row for D written before D+1 03:55 UTC (a daytime
      repair) is not final; yesterday with no final row (nightly failed) goes live; an old missing day is
      never pulled; the nightly time is pinned to `wrangler.toml`'s cron; the real-names table below;
      bad config falls back

**Phase 3: tools (CLI + MCP)**
- [x] Two `QUERIES` entries; extend `scripts/test-agent-queries.mjs` and
      `scripts/test-reporting-read-through.mjs`
- [x] Period dates tested for every weekday: `wtd` on Sun = Sun..Sun, on Sat = Sun..Sat; `cycle` on
      Fri = Fri..Fri, on Sun = Fri..Sun, on Wed = Fri..Wed, on Thu = previous Fri..Wed; `mtd` on the 1st
- [x] Correct the reading rule at `cli/reporting.mjs:29` ("after the 03:55 ET nightly run" → about
      23:00 ET, 03:55 UTC); every agent reads it in the MCP instructions
- [ ] `npm test` green; PR with the Testing results; do not merge or deploy

## Testing

| Check | Pass when |
|---|---|
| Bin grouping on real names | `$3 Christmas Bin` / `BL-3CBIN`, `$1 Christmas Bin` / `BL-1CBIN` → christmas/bins; `$12 Bin` / `BL-BIN-12`, `$12 bin item`, `$6 Bin` → regular/bins; `Glass Case / Mystery Box`, `Fill A Bag`, `Ikea Bag` → regular/extras; `$3 Halloween bin item` → regular, tier `$3`; `$3 XMAS`, `$8 XMAS`, `$1 XMAS` (L2 Seasonal) → christmas/xmas buttons, tiers `$3` `$8` `$1`; any other Seasonal item, including one in the same Clover category → left out |
| Back-check (prod, after deploy-ahead) | `get_bin_split` 2026-10-17 → 2026-11-16 = regular **141,173 units / $396,660.65**; Christmas **399 / $968.50** = bins **197 / $433.27** + xmas buttons **202 / $535.23** (all reproduced from `get_item_mapping` 2026-11-17; if `coverage.stale` lists a day, re-derive from it the same minute). Christmas bins began 2026-11-16 (one day in this range); the XMAS buttons run from 2026-10-23. |
| Live vs till | Each store's live `totals.netSales` (all items + non-item money, not bins only) within 2% of `get_today_sales` `salesSoFarToday`, same minute |
| Live vs saved, same night | A live pull just before the nightly run (22:45 EST / 23:45 EDT) is within 1% of the row that run saves, per store, Bin Products net |
| Write guard | `test-live-items.mjs` write assertions pass, and fail if the helper calls `saveItemSalesSnapshot` |
| Speed | All 5 stores cold < 10 s; cached < 0.5 s |
| Auth | Works with the agent key and MCP OAuth; missing or wrong key → 401 |

## Rollout

Claude does not run `wrangler`. Each command comes to Brian with an absolute path and the expected
upload size (see memory: deploy from main, not cwd).

1. **Deploy ahead (Brian), after Phase 1 is pushed.** The worker change is additive and read-only, so per
   CLAUDE.md it ships before review. It is inert until called. Run from the branch checkout, check it
   landed (3 clean passes), and **merge the same session** so a later deploy from `main` can't revert it.
2. Phase 2 the same way.
3. Claude runs the Testing checks against prod (all read-only) and puts the results in the PR.
4. Brian merges.
5. Brian deploys the MCP server: `npx wrangler deploy -c mcp/wrangler.toml` (worker first, then MCP),
   and reinstalls the CLI (ORIENT.md install line). Refresh the MCP connection in Claude.
6. Brian adds the bin vs Christmas bin line to Muse's morning brief (outside this repo).
7. One Fri–Wed cycle: each night, pull live just before the nightly run and compare with the row it
   saves; look into anything over 1%.

Staging is skipped on purpose: it runs no nightly snapshot cron (`[env.staging.triggers]` in
`wrangler.toml`), so its `item_day_lines` isn't kept up and the back-check and stitching can't be shown
there. Its Clover merchants are the prod registers anyway.

## Decisions

All decided by Brian, 2026-11-17:

- WTD = Sunday → Saturday; a bin cycle = Friday → Wednesday. Both are periods of `get_bin_split` (see
  Goal).
- The "$1 / $3 / $8 XMAS" buttons count as Christmas bins ($535.23 from Oct 23 to Nov 16, $430 of it at
  Battle Creek). They are the `xmas buttons` subgroup, so they can still be read apart from the bins.

## Out of scope

- A bin split card on the Hub dashboard / iOS widget (the `bin-split` action would feed it later)
- Real-time Clover webhooks into D1; changing the payment archive's 3-day delay
- Fixing the Christmas bin buttons at Coliseum (BL1) and Indy East (BL16) that have no Clover category
  (a Clover item fix: they sort into bins by name but carry no cost)
- An editor for `config:bin-groups`
- Fixing the existing `?action=items` gaps (Rule 2–3) — worth a separate small PR

## Kickoff prompt for Claude Code

```text
Read docs/plans/live-item-sales.md. It is the build plan for live item sales and the bin vs
Christmas bin split.

Work on a new branch: claude/live-item-sales. Add a dated entry for it at the top of tasks/todo.md.

Start with Phase 0. If everything in "What already exists" still holds, go straight on to Phase 1.
If anything doesn't, write it to docs/live-items-notes.md and stop.

Hard rules (the plan's Rules section has the detail):
- The only new write is the live-items:* KV cache key. Never call saveItemSalesSnapshot,
  fetchAggregateAndSnapshot or bankDiscountLines from new code.
- A failed Clover fetch is an error, never an empty day.
- Never pull a date older than yesterday live. Never treat today's saved row as final.
- Don't change the nightly cron or aggregateItemSales.
- Commit at the end of each phase and tell me what changed and what you tested.
- When Phase 1 is pushed, give me the deploy-ahead command (absolute path, expected upload size).
- If the code doesn't match the plan, stop and ask.

When all phases pass, open a PR with the Testing results. Don't merge, and don't run wrangler.
```

## What changed from the PDF

| PDF | Revised | Why |
|---|---|---|
| Phase 1: refactor the nightly job, prove it with a dry run of 2026-11-16 | Dropped | `aggregateItemSales` is already shared. A new dry-run flag tested against prod writes the snapshot if broken (Destructive Ops rule 3), and a re-pull can't match "line for line" anyway (sweep bucketing, Clover drift). |
| Saved day = "through yesterday" | Saved day = final row only | A day's row can be written before its nightly run (a daytime repair). The first draft's reason, a partial row for the new day, was wrong: the cron is 03:55 UTC. |
| Price tiers `$12 $9 $6 $4 $2 $1 $0.50` | Any `$N` in the name | Christmas bins are mostly `$3`, which would all land in "other". |
| Orders per group | Tickets per item only | Summing item ticket counts double-counts mixed tickets. |
| Write guard on `items:` keys | Test driving `worker.fetch`, all writes recorded | Snapshots also write `item-hours:`, `item_day_lines`, discounts, `daily_sales`. |
| `GET /api/live/items` | `?action=live-items`, `?action=bin-split` | The worker routes by `action`; the agent door and business gate refuse anything unlisted. |
| `wrangler deploy --env preview` | Deploy-ahead to prod (Brian) | There is no preview env; staging lacks the saved history; CLAUDE.md ships additive worker changes ahead. |
| "Refresh the MCP connection" | MCP deploy with `-c mcp/wrangler.toml` + CLI reinstall | The tools live in a separate worker. |
| `feature/live-item-sales` | `claude/live-item-sales` | Repo convention. |
| Rollout: preview cycle before prod, but prod deploy at step 5 | One order, cycle after merge | The PDF contradicted itself. |
