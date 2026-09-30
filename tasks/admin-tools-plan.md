# Admin tools — review & plan (2026-08-03)

**Status: ALL FOUR PHASES SHIPPED TO PROD 2026-08-03. Plan complete.**
Phase 1 — main `9ac0f51`, worker `fe96e33f`, sw v63.
Phase 2 — main `5880e8b`, worker `420f3287`, sw v64.
Phase 3a (health check) — main `cc2ea37`, worker `718f1de0`, sw v65.
Phase 3b (backup + repair + restore) — main `28e6ec6`, worker `fe925fbb`, sw v66.
Phase 4 (prune) — main `ab5ed43`, worker `6ae880b3`.
⏸ Still owed: **rotate SNAPSHOT_SECRET** (worker secret + Apps Script, together). ⏸ One follow-up owed: **rotate SNAPSHOT_SECRET** (see below).

Sources: full endpoint inventory (workflow agent, verified by hand on the high-severity
items), UI panel map, and the gap list from a full day of repairing L3/costing data.

---

## 1. What exists today

**The admin page** (`#page-admin-settings`, index.html:2410, 32.5k chars, 8 panels, 21 buttons):

| panel | purpose |
|---|---|
| Announcement | push/preview/clear a banner |
| Admin Tools | re-snapshot, rebuild week summaries, backfill 13w, manual sales/labor override |
| Item Sales Reconciliation | compare item KV totals vs D1 |
| Item Master Costs | import/edit IM# → cost |
| L3 Category Costs | edit per-L3 $/unit |
| Custom Sales Categorization | assign uncategorized items to an L2 |
| Custom Sales items | list of the above |
| Uncategorized L3 categories | map unknown Clover L3 → L2 |

**The admin API**: **25 `requireAdminSecret` endpoints** plus several session-gated ones.

🔑 **The two have diverged badly.** 8 panels vs ~30 endpoints. The endpoints with no UI are
the *dangerous* ones; the panels cover the things that rarely break.

---

## 2. Problems found

### 🛑 P1 — Six destructive endpoints fire on a plain GET

Verified by hand at these lines — no `request.method` guard:

| action | line | what a GET does |
|---|---|---|
| `refresh-item-cats` | 7640 | deletes the cached category map for a store (or ALL) |
| `backfill-items-snapshots` | 8473 | **rewrites a whole date range** — the endpoint that destroyed 81 BL1 days |
| `resnapshot-clienttime` | 9766 | rewrites daily_sales + item snapshots |
| `rebuild-week-summaries` | 10833 | overwrites up to 20 weeks of summary KV |
| `items-snapshot` | 8152 | overwrites one day's item snapshot |
| `snapshot` | 7832 | writes items KV + upserts D1 |

A GET is what a browser address bar, a prefetch, a link preview, a crawler, or a
mis-pasted URL does. **This is the single highest-risk item on the admin surface.**

### 🛑 P2 — "Superuser-only" is not real

All 25 use `requireAdminSecret` — header equality against `SNAPSHOT_SECRET`, **no role
check**. The frontend sends that secret from a literal in the public client
(`index.html`, view-source). So every destructive admin endpoint is reachable by anyone
who reads the page source. This is the long-parked `SNAPSHOT_SECRET` item; today's work
makes its blast radius concrete.

### P3 — The repair tools a superuser actually needs don't exist

Everything I had to do by hand today, none of which has UI:

| operation | today |
|---|---|
| back up KV before a destructive write | ✗ nothing — I wrote scripts |
| find which dates actually need repair | ✗ script |
| re-snapshot a date range | ✗ curl only |
| reconcile snapshots vs D1 | ✗ script |
| restore a damaged snapshot | ✗ script |
| delete an item override | ✗ read-modify-write by hand |
| see an item's full Clover categories | ✗ didn't exist until today |

### P4 — Dead and one-off code

- **Duplicate `ingest` handler**: identical blocks at 7755 and 8075; the second is
  unreachable.
- **4 `debug-*` endpoints** (`debug-revenue-mismatch`, `debug-residuals`,
  `debug-manual-refunds`, `debug-refunds`) — one-off diagnostics from past incidents.
- **`fb-publish-test`** — a Slice-0 spike that posts to Facebook and accepts a token in
  the request body.
- **`test-interval-summary`** — fires **real push notifications** to real subscribers.

### P5 — Three separate "make this costable" tools

Item Master Costs, L3 Category Costs, and Custom Sales Categorization are three panels
solving one question: *why is this line not costed, and how do I fix it?* Today proved a
superuser needs to move between them constantly — the answer might be an IM# cost, a
category cost, a Clover category, or an override.

---

## 3. Options

### A. Safety only (smallest)
Method-guard the six GET-destructive endpoints; delete the dead `ingest` duplicate.
*~1 day. Removes the worst risk, changes no UI.*

### B. Safety + prune
A, plus remove the 4 `debug-*`, `fb-publish-test`, `test-interval-summary`.
*~1.5 days. Smaller surface, nothing to relearn.*

### C. Safety + prune + one Repair console  ← **recommended**
B, plus a single new panel that does the repair loop end to end:
**check → back up → repair only what needs it → verify.**
Replaces curl for the operations that actually caused damage.
*~4–5 days.*

### D. Full consolidation
C, plus merge the three costing panels into one "why isn't this costed" flow.
*~8–10 days. Best end state, biggest change.*

### E. Fix the auth model
Add a real role check to admin endpoints instead of the published secret.
*Independent of A–D; can be done any time. ~2 days.*

---

## 4. Recommended plan (option C + E)

**Phase 1 — Stop the bleeding** ✅ **SHIPPED PROD 2026-08-03** (main `9ac0f51`, worker `fe96e33f`, sw v63)
1. ✅ Method-guarded **seven** endpoints (POST only) — the six above plus the Sheets
   `backfill`, kept per Brian's answer to Q1 but guarded anyway.
2. ✅ Deleted the duplicate `ingest` block — both copies were byte-identical (3,955 chars).
3. ✅ Removed `test-interval-summary` and `fb-publish-test`.

Frontend: 7 call sites converted GET → POST. `worker.js` net **+7 / −190**.
🔑 **Deploy order matters** — frontend to main FIRST, wait for Pages, then `wrangler deploy`.
The reverse breaks the admin page in the gap; frontend-first is harmless because POST to an
unguarded endpoint already works.

**Live proof**: a GET to a guarded action now returns exactly what a *nonexistent* action
returns (`{"error":"Please specify a store"}` from the generic fall-through) — it does not
execute. POST reaches the real handler and returns its own distinct validation error.
Probed with no `store` param so the only reachable path was validation, never a write.
An unguarded admin action (`category-costs`) still answers on GET, proving dispatch is intact.
🛑 Worker propagation took **~180 s** — verifying sooner reads the OLD code.

**Phase 2 — Real auth** ✅ **SHIPPED PROD 2026-08-03** (main `5880e8b`, worker `420f3287`, sw v64)
4. ✅ New `requireAdminAccess(request, currentUser, isAdminSecret, corsJson)`:
   secret → allowed (cron/tooling); superuser session → may MUTATE; admin-or-superuser
   session → may READ. **Method-aware**, because `item-costs`, `category-costs` and
   `item-overrides` each read on GET and write on POST behind a single guard — gating
   those at superuser breaks reads for admins, gating at admin leaves the writes open.
   Returns **403, not 401**: 401 means "no session" here and bounces the client to login.
5. ✅ 15 endpoints moved to it. 7 stay secret-only (no browser caller): the Apps Script
   `ingest` feeder and six no-UI diagnostics.
6. ✅ **The secret left the client.** All 30 `X-Snapshot-Secret` headers removed, the
   `const` deleted, and the **raw inline copy** at the old line 9837 deleted — that one was
   a bare string, not the identifier, so an identifier-only sweep would have left it live.
   11 call sites gained `credentials:'include'`; without it the cookie is not sent
   cross-origin to api.retjghub.com and they would have 401'd. Verified live: 30 → 0.
7. ✅ Fixed a **Phase 1 miss** — `manual-override` had no method guard and wrote
   `daily_sales` with the sticky `is_manual_override=1` flag on any HTTP verb.

🔑 **DEPLOY ORDER IS THE REVERSE OF PHASE 1** — worker first, then frontend. The new client
sends no secret, so it needs a worker that already accepts sessions. Worker-first is safe
because the old client's secret still works, which also covers stale PWAs and the
stale-while-revalidate service worker cache.

🛑 **STILL OWED — rotate `SNAPSHOT_SECRET`.** Removing the literal stops *future* disclosure
but the old value is already published in view-source history and any archived/cached copy
of the page. Rotation is Brian's to run because it is two steps that must land together:
`wrangler secret put SNAPSHOT_SECRET`, and updating `CONFIG.SNAPSHOT_SECRET` in
`scripts/auction-drive-ingest.gs` — rotate without the second and the nightly auction feeder
silently stops.

**UI** — the admin page was the last surface on the pre-redesign chrome. Moved onto the V1
"Operator" palette every other page uses: 6 cards off `bg-white`/`dark:bg-gray-800` +
`shadow-sm` onto `opl-panel`/`op-panel` with hairline borders, form controls onto the
flow-calendar string, 20 focus rings added where keyboard focus was invisible on
`dark:bg-gray-700`, 3 elements that had **no dark variant at all** fixed, both bare tables
given a shell, `px-6` → `px-4 sm:px-6` for phones. Classes only — all 61 ids and 22 onclick
handlers byte-identical, verified live.

**Phase 3 — One Repair console** (replaces the Admin Tools panel)
5. ✅ **SHIPPED 2026-08-03 — Health check** — per store: snapshot total vs D1, dates short, uncosted $. Read-only,
   safe to run any time. This is the reconciliation I scripted four times today.
6. ✅ **SHIPPED 2026-08-03 — Repair** — an explicit LIST, never a range, it shows *which dates would change and why*, backs
   up automatically, runs only those dates, then re-verifies. Never a blind range.
7. ✅ **SHIPPED 2026-08-03 — Restore** — one click back, and the restore is itself reversible.

**Phase 4 — Prune** ✅ **SHIPPED 2026-08-03** (main `ab5ed43`, worker `6ae880b3`)
⚠️ The condition as written — "once the health check covers their use" — turned out to be
**false**. `repair-health` compares two stored numbers and never re-fetches from Clover; these
endpoints re-pull raw orders. It covers none of them. The removals stand on two *different*
arguments: `debug-manual-refunds`/`debug-refunds` were spent API-discovery scaffolding, and
`debug-revenue-mismatch`/`debug-residuals` are narrow views of what `sales-diag` dumps in full.
Removed all four (−422 lines). Kept `sales-diag`, `clientdate-probe`, `ingest`; secret-only
7 → 3. README de-staled in the same change.

**Deliberately NOT doing:** merging the three costing panels (option D). They're confusing
but they work, and today's damage came from repair operations, not from costing edits.
Revisit after Phase 3 has been used in anger.

---

## 5. Removal list

| item | why |
|---|---|
| duplicate `ingest` (worker.js:8075) | dead code, unreachable |
| `test-interval-summary` | fires real push notifications on demand |
| `fb-publish-test` | Slice-0 spike, accepts a token in the body |
| `debug-revenue-mismatch`, `debug-residuals`, `debug-manual-refunds`, `debug-refunds` | one-off incident tools; keep only if Phase 3 doesn't replace them |
| `backfill` (Google Sheets import, 7938) | verify it's still needed — the sheet era may be over |

---

## 6. Open questions for Brian — ANSWERED 2026-08-03

1. **Sheets `backfill`** — *"fix it for now just in case we need it but today I don't use it."*
   → kept, and method-guarded as a 7th endpoint in Phase 1.
2. **Repair console** — *"superuser only."* → Phase 3 gates on superuser, not admin.
3. **`debug-*` endpoints** — *"I am not sure, investigate the last time this been used."*
   → **Findings below.** Decision stays parked until Phase 4.
4. **Announcement panel** — still to confirm.

### Q3 findings — the four `debug-*` endpoints

| endpoint | added | callers |
|---|---|---|
| `debug-refunds` | 2026-05-12 `f2263fb` — cross-day refund diagnosis | none |
| `debug-residuals` | 2026-05-12 `589614e` — Other/Non-categorized investigation | none |
| `debug-manual-refunds` | 2026-05-13 `0f0eb51` | none |
| `debug-revenue-mismatch` | 2026-05-14 `679855d` — aggregation mismatch | none |

**Zero callers anywhere** — not in `index.html`, not in `sw.js`, not in `scripts/`. Each
appears in `worker.js` only at its own definition. All four are one-off diagnostics from a
single week of refund/aggregation debugging in May 2026, driven by hand with curl.

⚠️ **What I cannot answer**: whether *you* have curled one recently. That needs Cloudflare
request logs, which aren't retained retroactively — I can't reconstruct it after the fact.

**Recommendation**: leave them until Phase 3. They are read-only, so unlike the six
write endpoints they carry no damage risk, and the Phase 3 health check is designed to
replace exactly what they do. Delete them in Phase 4 once it does. If you want certainty
before then, the cheap move is to add a log line to each and check back in a month.
