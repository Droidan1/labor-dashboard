<!--
Content Studio redesign — implementation plan.
Source: Claude Design handoff "App page redesign" (Content Page.dc.html) + a 4-phase planning
workflow (token mapping / scheduling backend / responsive+preview → 2 phasing drafts → 3-adversary
premortem → synthesis). Grounded in the origin/main snapshot (index.html ~11319–11688, worker.js
~5699–6070, wrangler.toml). Base implementation off origin/main, not claude/flow-calendar-editor.
Status: AWAITING APPROVAL before any code changes.
-->

# Content Studio — Redesign + Scheduling Implementation Plan

## 1. Objective & success criteria

**Objective.** Rebuild the admin-only Content page as "Content Studio" — a two-column composer with a live post preview, a Compose/Thumbnails/Posts tab structure, and a Drafts/Scheduled/Published pipeline board — using the app's own design language (`op-*`/`opl-*`/`accent-green` tokens, Geist + Lilita One, both themes, no shadows), NOT the mock's Archivo/#2FD566/dark-only styling. Then add real scheduling: an operator can schedule a composed draft to auto-publish LIVE to its Facebook Page at an ET wall-clock time, and seed drafts "from Flow."

**Success criteria (testable):**
1. As an admin, Content opens to a Compose tab: composer on the left, a live Instagram-style preview on the right that repaints on every store/cover/photo/caption change; Thumbnails and Posts tabs switch panes; counts (`Thumbnails · N`, `Posts · N`) are live.
2. Every existing action still works byte-for-byte: upload/delete thumbnail, save/edit/delete draft, AI caption, manual publish (staged + live).
3. Both light and dark themes render correctly at desktop (≥1024), tablet, and mobile (<1024, inline non-sticky preview); the page body never scrolls horizontally; the fixed bottom nav never covers the last pipeline card.
4. Composing survives navigation and a PWA cache-bump reload without silently losing an in-progress caption.
5. A draft with a cover (or ≥1 photo) can be scheduled for a near-future ET time and auto-publishes **exactly once** to Facebook via the every-minute cron; overlapping ticks, mid-publish worker eviction, and ambiguous-FB-outcome retries never produce a duplicate post.
6. Scheduling a past time or an image-less draft is rejected; a permanently failing schedule lands terminally in `schedule_error` with the reason shown on its card and a notification fired; unschedule returns it to Drafts.
7. `processSaleSchedules` (the live Clover price flipper) is proven **not** to run on staging, so the staging every-minute cron is safe to enable.
8. Seeding a Flow week creates one correctly-attributed draft per selected store, is idempotent on re-click, and captions (if generated) reflect the **target** week, not today's week.

---

## 2. Design-language translation

The mock is 100% dark-only with hardcoded inline hex. **Rule: no inline hex in the port** — build from token pairs, and for every `dark:` value add the light literal (the `opl` palette has **no** `border`/`warn`/`good` sibling, so those are literals).

| Redesign element | App recipe (dark / light) |
|---|---|
| Page bg `#0A0F1C` | **inherit from body** `bg-opl-bg dark:bg-op-bg` — never set a local fill |
| Card / preview / pipeline card `#0F1626` | `bg-opl-panel dark:bg-op-panel` + `border border-[rgba(20,16,8,0.08)] dark:border-op-border rounded-card` |
| Input/select fill | `bg-white dark:bg-[rgba(255,255,255,0.04)] border-gray-200 dark:border-op-border rounded-xl px-3 py-2.5 focus:ring-1 focus:ring-accent-green` |
| Wordmark "CONTENT" (Archivo italic) | `font-brand text-accent-green uppercase tracking-wide` (Lilita One) — drop the italic wordmark; keep a small `STUDIO` pill `text-[10.5px] font-extrabold text-accent-green bg-accent-green/12 border border-accent-green/30 rounded-md px-2 py-0.5` |
| Tabs (2.5px underline) | `border-b-2 border-accent-green text-accent-green` active / `border-transparent text-opl-inkDim dark:text-op-inkDim` inactive (app 2px) |
| Green tints `#2FD566`/rgba(47,213,102,.12–.15) | `accent-green` for text/dots/tints (`bg-accent-green/10`–`/15`) |
| **Filled buttons** `#2FD566` | keep the app button green `bg-[#3BB54A] hover:bg-[#32a040] text-white` — matches every other button |
| Ink on green `#04220D` | `text-[#06210f]` |
| Ink ramp `#E7ECF4/#7C8698/#4E586B` | `op-ink/op-inkDim/op-inkDimmer` dark ↔ `opl-ink/opl-inkDim/opl-inkDimmer` light |
| Scheduled amber `#EAB308` | `accent-amber`/`op-warn` (#f59e0b); in **light mode** on cream, add a `bg-accent-amber/10` chip tint so it clears contrast |
| Selected tile outline | `border-2 border-accent-green` swap + unselected `opacity-70`; ✓/number badge `bg-accent-green text-[#06210f]` |
| Radii 16/10-11/7-8px | `rounded-card` / `rounded-xl` / `rounded-lg` |
| `box-shadow` glows & drop shadows | **removed** — DESIGN.md §2.4 (border + tinted bg only) |
| Fonts Archivo / mono | Geist (`font-geist`) for body/UI; uppercase `tracking-wide` labels (app has no mono UI) |

Semantic colors are theme-independent: `accent-green` = selected/live/published, `accent-amber` = scheduled, neutral `inkDim` = drafts. The IG preview card must NOT stay navy in light mode — it uses panel/border tokens like every other card; only the cover art (a real uploaded image) is theme-independent.

---

## 3. What is reused vs rebuilt

**Reused unchanged** (all `index.html` ~11319–11688; all worker endpoints): `ctPopulateStores`, `ctPopulateStoreFilter`, `ctLoadThumbs`, `ctLoadPhotos`, `ctLoadDrafts`, `ctUploadThumb`, `ctDeleteThumb`, `ctDeleteDraft`, `ctPublishDraft`, `ctSetTopic`, `ctOnTypeChange` (body), `ctStoreLabel`. Endpoints `?action=` `thumbnails`/`thumbnail`/`thumbnail-upload`/`thumbnail-delete`/`marketing-photos`/`photo`/`draft-save`/`drafts`/`draft-delete`/`draft-generate-caption`/`publish-draft` keep working.

**Lightly edited** (keep body, add calls): `initContent` (~6549 wiring; add idempotency guard + `ctSetTab('compose')` + caption listener + `ctRenderPreview`); `ctPickThumb`/`ctTogglePhoto` (append `ctRenderPreview`); `ctResetComposer`/`ctEditDraft` (sync chips + charcount + preview, route post_type through `ctPostType`); `ctOnTypeChange`/`ctSaveDraft` (read `ctPostType`, not `el('ct-posttype').value` @ ~11542).

**Rewritten (render-only, logic preserved):** `ctRenderThumbPicker` → 78px picker row; `ctRenderPhotoPicker` → 78px row + numbered order badges; **`ctRenderThumbGrid` → flat gallery** (⚠ it currently calls `ctRenderFolders` @ 11427 — must be rewritten in the same change that retires folders); `ctRenderPosts`+`ctDraftItem`+`ctPublishedItem` → `ctRenderPipeline`+`ctPipelineCard`.

**New (frontend):** `ctTab`+`ctSetTab`; `ctPostType`+`ctRenderTypeChips`+`ctPickType`; `ctRenderPreview`+`ctUpdateCaptionUI`; `ctSchedulePopover`+`ctSchedule`/`ctUnschedule`; `ctScheduleViaFlow`.

**Dead code to delete (Phase 4, only after grepping call sites):** `ctGroupByTypeMonth` (11342), `ctRenderFolders` (11362), `ctMonthLabel`. **Keep** `ctFillTypeSelect` — it still feeds the `#ct-thumb-type` upload select (`ctUploadThumb` @ ~11463).

**New (backend):** `publishDraft()` (extracted), `processScheduledPosts()`, `reapStalePublishing()`, `failSchedule()`; endpoints `draft-schedule`, `draft-unschedule`, `flow-schedule-week`, temporary `run-scheduled-tick`.

---

## 4. Scheduling backend design

### migration-021.sql (additive; apply once per DB, STAGING then PROD, before any code reads the columns)

```sql
-- migration-021: Scheduling for marketing bin-post drafts. One row moves through statuses.
-- SQLite has NO "ADD COLUMN IF NOT EXISTS" — run exactly once per DB (matches migration-019 convention).
ALTER TABLE marketing_drafts ADD COLUMN scheduled_at     TEXT;                       -- UTC ISO to auto-publish at; NULL = unscheduled
ALTER TABLE marketing_drafts ADD COLUMN publish_live     INTEGER NOT NULL DEFAULT 1; -- 1 = publish LIVE (schedule default), 0 = stage unpublished
ALTER TABLE marketing_drafts ADD COLUMN origin           TEXT;                       -- NULL | 'flow' (drives "· from Flow")
ALTER TABLE marketing_drafts ADD COLUMN flow_fiscal_year TEXT;
ALTER TABLE marketing_drafts ADD COLUMN flow_retail_week INTEGER;
ALTER TABLE marketing_drafts ADD COLUMN publish_attempts INTEGER NOT NULL DEFAULT 0; -- retry cap
ALTER TABLE marketing_drafts ADD COLUMN claimed_at       TEXT;                       -- set when cron flips scheduled->publishing (reaper key)
ALTER TABLE marketing_drafts ADD COLUMN next_attempt_at  TEXT;                       -- backoff gate; NULL = eligible now
ALTER TABLE marketing_drafts ADD COLUMN schedule_error   TEXT;                       -- last failure reason (shown on card)

CREATE INDEX IF NOT EXISTS idx_drafts_due ON marketing_drafts(status, scheduled_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_drafts_flow_week
  ON marketing_drafts(store, flow_fiscal_year, flow_retail_week) WHERE origin = 'flow';
```

**Status vocab** (enforced in worker, no SQLite enum): existing `draft|approved|published` + new `scheduled`, `publishing` (transient cron claim), `schedule_error` (terminal). **Board mapping:** `draft/approved` → Drafts; `scheduled/publishing/schedule_error` → Scheduled; `published` → Published. **Why one table, not `marketing_schedules`:** `publish-draft` already reads `marketing_drafts` by id and advances its `status` (@ ~5938) — a second table would create two sources of truth. No `DROP COLUMN` in SQLite, so there is no clean rollback; treat the migration as forward-only.

### Cron — piggyback the existing every-minute trigger (no new trigger)

`scheduled()` @ ~9890 already has `if (event.cron === "* * * * *") { ctx.waitUntil(processSaleSchedules(env, new Date())); return; }`. Add a **second independent** `ctx.waitUntil(processScheduledPosts(env, new Date()));` before the `return`, so a failure in one can't abort the other. `scheduled_at` is a UTC instant compared UTC-to-UTC (like `sale_schedules.starts_at` @ ~1398) — no DST logic in the cron.

`processScheduledPosts(env, now)` (PER_TICK=5, MAX_ATTEMPTS=3), plus the idempotency mitigations folded in from all three premortems:

1. **Reaper first** — `reapStalePublishing`: `SELECT id FROM marketing_drafts WHERE status='publishing' AND claimed_at < <now-5min>`. For each, check `marketing_publish_log` for a successful `post_id` (the log is written @ ~5935 **before** the status UPDATE — confirmed): if found → set `status='published'`; else reset to `scheduled` (respecting attempt cap). Fixes the zombie-`publishing` row left by a mid-tick eviction.
2. **Due query** — `status='scheduled' AND scheduled_at IS NOT NULL AND scheduled_at<=nowIso AND publish_attempts<MAX AND (next_attempt_at IS NULL OR next_attempt_at<=nowIso) ORDER BY scheduled_at ASC LIMIT PER_TICK`.
3. **Max-lateness guard** — if `now > scheduled_at + N hours` → `failSchedule(..., 'expired', terminal=true)` instead of publishing stale content.
4. **Atomic claim** (sole concurrent-tick guard): `UPDATE ... SET status='publishing', claimed_at=?, publish_attempts=publish_attempts+1 WHERE id=? AND status='scheduled'`; `if (claim.meta.changes !== 1) continue;`.
5. **Reconcile-before-publish** — before calling FB, re-check `marketing_publish_log` for a prior successful `post_id` for this `draft_id`; if present, mark `published` and skip. This is the **only** guard against an ambiguous-outcome duplicate (FB committed but response lost).
6. **Publish via a distinct cron wrapper** that hardcodes `published: true` (never inherit the manual button's `published===false` default) → `publishDraft(env,{draftId, published:true})`.
7. **failSchedule** — classify errors: transient (429/5xx/network) → reset to `scheduled` with `next_attempt_at = now + backoff(2/10/30m)`; terminal (no image, bad token) or attempts≥MAX → `status='schedule_error'`, set `schedule_error`, **fire a notification** via the app's existing push path (no human is watching at fire time).

**`publishDraft(env,{draftId,published,token}) → {ok,postId,postUrl,error}`** — extract the body of the `publish-draft` handler (@ ~5855–5945) verbatim; the HTTP route becomes a thin wrapper mapping the result to a `Response`. One correctness fix during extraction: the success `UPDATE marketing_drafts SET status=…` currently uses `.catch(()=>{})` (@ ~5938) — in the shared function, do **not** swallow it silently; on UPDATE failure after a successful FB post, retry the UPDATE (the log row already proves success, so the reaper will reconcile if it still fails).

### Endpoints (all gated `requireInventoryAccess` — same gate as `draft-save`)

- **POST `?action=draft-schedule`** `{id, et_wall_clock, tz, publish_live?}`. **Server-side ET→UTC** (do not trust the browser): convert `et_wall_clock`+`tz='America/New_York'` via `Intl` on the worker, echo the resolved instant back. Validate: draft exists; status NOT IN `('published','publishing')`; parsed time is in the future; draft has `thumbnail_id` OR non-empty `photo_ids` (fail fast — publish requires ≥1 image @ ~5900). Set `status='scheduled'`, `scheduled_at`, `publish_live=(x===false?0:1)`, clear `schedule_error`/`next_attempt_at`.
- **POST `?action=draft-unschedule`** `{id}`. Only from `scheduled`/`schedule_error` (refuse `publishing`/`published`) — **using the same conditional-UPDATE claim** (`WHERE id=? AND status IN(...)`, require `changes===1`), not a precheck. Reset to `draft`, clear `scheduled_at`/`schedule_error`/`claimed_at`/`next_attempt_at`; **keep** `origin`/`flow_*` provenance.
- **GET `?action=drafts`** — the board fetches **`status=all`** and partitions client-side (as `ctRenderPosts` already does @ 11631). ⚠ Do **not** source the Scheduled lane from `status=scheduled`: that handler is an **exact** match (`d.status = ?` @ ~5738) and would hide `publishing`/`schedule_error` rows — exactly the error/retry cards the operator needs. The Scheduled lane is sorted `scheduled_at ASC` **client-side**. Revisit the shared `LIMIT 300` (@ ~5741, `ORDER BY updated_at DESC`): months of `published` history can crowd out due rows — Phase 6 adds per-lane caps / a "show more" on Published.
- **Manual-path guards** — `draft-save` (~5717) and `draft-delete` (~5759) refuse mutation when `status='publishing'`; the manual `publish-draft` route refuses `status IN('publishing','published')` and routes through the same atomic claim so a manual click + cron claim in the same minute can't double-post. On `draft-save` of a `scheduled` row, **re-validate images** (auto-unschedule or reject) so an edit-to-zero-images can't send the cron into per-tick failure.
- **Asset-deletion TOCTOU** — guard `thumbnail-delete`/`photo-delete` (and store re-map) to refuse/warn when the asset is referenced by a `status='scheduled'` draft. (Simpler than byte-snapshotting; the BL12→BL16 store churn makes this real.)
- **Temporary POST `?action=run-scheduled-tick`** (admin-gated) — calls `processScheduledPosts(env,new Date())` on demand for staging verification; removed before prod.

### "from Flow" hook — contract

Operator-initiated only, fires **synchronously** inside **POST `?action=flow-schedule-week`** `{fiscal_year?, retail_week, stores?[], publish_time?, publish_live?, generate_caption?}` (new sibling of `flow-week-upsert` @ ~5983). It does **not** hook `flow-week-upsert` (editing the calendar must not spawn posts), and the cron is origin-agnostic (only publishes already-scheduled rows). Data flow per chosen store (fan-out): `store` ← each in `stores[]` (default = Page-mapped stores); `topic` ← `[special_event, weekly_theme, product_focus]` joined; `post_type` ← inferred (`special_event`→`event`, storewide/weekend→`weekly_promo`, else `bin_preview`); `origin='flow'`, `flow_fiscal_year`, `flow_retail_week`; `scheduled_at` ← default (Monday of `week_start` 08:00 ET → UTC, overridable). **Insert one row per store in a loop** (~19 cols × N stores blows past D1's 100-param cap in a single multi-row INSERT). **Dedupe** via `uq_drafts_flow_week` → catch the constraint error → friendly "already seeded." **Caption caveat (confirmed):** `draft-generate-caption` looks up `marketing_flow` by **today's** date (`week_start<=today AND week_end>=today` @ ~5801) — if `generate_caption` seeds a **future** week it would write this week's copy. **Must parameterize** the caption lookup by `fiscal_year`+`retail_week` before wiring it in. Default landing lane: **Drafts** (a Flow week has no image; publish requires one) — landing directly in Scheduled requires auto-assigning a per-store cover + pre-generating the caption (product decision, §7).

---

## 5. Phased plan

Sequencing reconciles Plan A (visual value first) with Plan B (risk-first) and the adversaries' ordering fix: **the status-partitioned pipeline board ships before any endpoint can create scheduled rows**, so the legacy `ctRenderPosts` never renders a `scheduled` row in the Drafts lane with a live Publish button. Every `index.html` phase **bumps `sw.js` `CACHE_NAME`** (installed PWAs are network-first but open apps only force-refresh on a bump) — treat "index.html changed ⇒ CACHE_NAME bumped" as a release gate.

Base all work off **origin/main** — the current tree (`claude/flow-calendar-editor`) predates the Content page; the authoritative source is the `origin-main-*` snapshots.

### ⭐ Phase 1 — Studio shell: widen + Compose/Thumbnails/Posts tabs — FIRST SHIPPABLE INCREMENT
- [ ] **Goal:** reorganize into the Studio shell + tab structure with zero change to composer logic or endpoints — the navigation win, near-zero risk.
- [ ] Widen both `max-w-3xl` wrappers (header inner ~L1512, body ~L1518) to `max-w-7xl` (or `max-w-[1180px]`); keep `mx-auto px-4 sm:px-6` and `pt-[calc(env(safe-area-inset-top)+1rem)]` verbatim.
- [ ] Header: keep `font-brand` accent-green "CONTENT"; add `STUDIO` pill; subtitle "Draft the post here, watch it take shape on the right."
- [ ] `ctTab` state + `ctSetTab(name)` toggling `.hidden` on three wrapper divs (mirror `mkSetTab` @ ~10959); Compose/Thumbnails·N/Posts·N tabs; author correct default `.hidden` so first paint is right pre-JS; `initContent` explicitly calls `ctSetTab('compose')`; counts refresh inside `ctLoadThumbs`/`ctLoadDrafts` completion. Mobile: tab row as a sticky sub-bar below the safe-area header, `flex overflow-x-auto`.
- [ ] Re-parent existing markup into panes; do NOT alter any `ctLoad*`/`ctRender*`/`ctSaveDraft`/`ctPublishDraft`.
- **Files:** `index.html`, `sw.js`. **Shippable:** yes. **Size:** M.
- **Verify:** admin opens Content → tabs switch, counts correct; every existing action works; both themes; mobile bottom nav clears last card; reinstall PWA shows new UI.

### Phase 2 — Hero: 2-col grid + live preview + composer-state safety
- [ ] **Goal:** the headline redesign — a live Facebook/Instagram-style preview in app tokens — plus the guards that stop the richer composer from losing work.
- [ ] Compose pane → `grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-6 lg:gap-8`; cap content ~1180px + **380px** rail (not 410) so the form isn't crushed in the 1024–1200 sidebar-squeeze band; consider gating 2-col at `xl` if the form track falls below ~360px.
- [ ] Right cell `self-start lg:sticky`; drive the sticky offset from a measured CSS var (`--content-header-h` via `ResizeObserver`), not a magic `top-24`. Add `max-height: calc(100vh - var(--content-header-h) - 1rem); overflow-y:auto`. Non-sticky inline below the caption at `<lg`.
- [ ] `ctRenderPreview()` from `op-*/opl-*` tokens, no inline hex, no shadow; every `dark:` paired with a light literal. **Persistent DOM:** create the cover `<img>` once, swap `.src` only when `ctSelThumb` changes — never on caption input (avoids decode flicker + keystroke race on mobile Safari). Label it "Instagram-style preview — posts to Facebook."
- [ ] `ctUpdateCaptionUI()` + char counter: advisory/non-blocking, FB limit (~63k) not IG 2,200 (2,200 as an IG soft note if shown); a single `#ct-caption input` listener repaints only the caption line + counter.
- [ ] Hook `ctRenderPreview` into `ctPickThumb`, `ctTogglePhoto`, `ctLoadPhotos`, `ctResetComposer`, `ctEditDraft`, `ctAiCaption`; call once in `initContent`.
- [ ] **Composer-state safety:** make `initContent` idempotent (guard the unconditional `ctResetComposer` behind first-init or `!dirty`); persist in-progress store/thumb/photos/caption to `localStorage`, rehydrate on return; reset only after a successful save/publish. **Defer the `controllerchange` auto-reload** (@ ~15088) when the composer is dirty — show a soft "Update ready — refresh" banner instead of a hard reload.
- **Files:** `index.html`, `sw.js`. **Shippable:** yes. **Size:** L.
- **Verify:** change store/cover/photos/caption → preview updates live, caption typing never touches the cover `<img>`; sticky preview never hides its footer at 1024×640; navigate away mid-caption and back → caption preserved; a simulated cache bump shows the banner, not a wipe; both themes.

### Phase 3 — Composer controls: type chips, 78px picker rows, order badges, upload
- [ ] **Goal:** finish the composer surface, all driving the live preview, with the post-type migration done safely.
- [ ] Replace `<select id=ct-posttype>` with `ctRenderTypeChips` (`flex flex-wrap gap-2`, all **5** `CT_POST_TYPES`) + `ctPickType` + `ctPostType` state. **Route ALL post_type reads/writes through `ctPostType`** — update `ctResetComposer` (~11523), `ctEditDraft` (~11651), `ctOnTypeChange` (~11562), `ctSaveDraft` (~11542) in this same phase, or editing a draft silently persists a blank type. Keep the separate `#ct-thumb-type` select intact.
- [ ] Rewrite `ctRenderThumbPicker`/`ctRenderPhotoPicker` (render-only): `flex-wrap` grid on narrow tracks, single-row `overflow-x-auto` only where width allows; selected `border-2 border-accent-green`, unselected `opacity-70`; photo tiles show numbered order badges (insertion order in `ctSelPhotos`, drives preview carousel dots); `#ct-photo-count` → "N of M selected." Cover row gets inline "＋ Upload new" + dashed add-tile wrapping the existing hidden `#ct-thumb-file`.
- [ ] Action row: keep Save draft green `#3BB54A`; add an **inert** "Schedule…" stub (wired in Phase 6); AI button verbatim.
- **Files:** `index.html`, `sw.js`. **Shippable:** yes. **Size:** M.
- **Verify:** pick each chip → topic pre-fills and type persists through save/edit; upload via link + dashed tile; badges reflect selection order; existing drafts edit/publish unchanged; both themes.

### Phase 4 — Pipeline board (Drafts / Scheduled / Published) on existing data
- [ ] **Goal:** replace the type→month folders with the 3-lane board; Scheduled renders as an empty state — completing the visual redesign with **no backend**.
- [ ] `ctRenderPipeline` + `ctPipelineCard`: `grid grid-cols-1 lg:grid-cols-3`; column header squared status dot + caps label + live count; compact card = 36–40px cover + truncating title + status-colored meta. **Enumerate and preserve every existing per-card action** (Publish, Edit, Delete, "View post ↗" @ 11609–11623) before retiring `ctDraftItem`/`ctPublishedItem`.
- [ ] **Rewrite `ctRenderThumbGrid` to a flat gallery in this same change** — it calls `ctRenderFolders` (@ 11427), so deleting folders without this throws and blanks the Thumbnails tab. Then delete `ctGroupByTypeMonth`/`ctRenderFolders`/`ctMonthLabel`; keep `ctFillTypeSelect`.
- [ ] `loading="lazy"` + fixed dimensions on all pipeline/gallery/preview thumbnails; **paginate the Published lane** (most-recent ~20 + "show more").
- [ ] Point `ct-store-filter` (@ 1576, currently `onchange="ctRenderPosts()"`) at the new render; filter narrows all lanes.
- **Files:** `index.html`, `sw.js`. **Shippable:** yes. **Size:** M.
- **Verify:** drafts/published land in correct lanes with accurate counts; publish moves a card Drafts→Published; delete removes it; every old action reachable; empty Scheduled lane renders cleanly; Thumbnails gallery + upload work; store filter narrows all lanes; 1-col on mobile; both themes. **Full visual redesign is now live end-to-end on existing endpoints.**

### Phase 5 — Scheduling foundation: migration-021 + `publishDraft()` extraction + staging-safe cron harness (invisible)
- [ ] **Goal:** land the least-reversible schema and the shared publish function; make staging able to exercise the cron without touching prod Clover.
- [ ] Create `migration-021.sql` (§4). Apply **once** to staging DB, then prod DB; verify with `PRAGMA table_info(marketing_drafts)`. Rule: migrate a DB before any code reading the new columns ships to that env.
- [ ] Extract `publishDraft()` from ~5855–5945; HTTP route becomes a thin wrapper. Behavior-preserving; do not swallow the success status UPDATE (§4).
- [ ] **Prod-gate `processSaleSchedules` using `env.API_ORIGIN && env.API_ORIGIN.includes('staging')`** (@ 4854) — **not** `env.name` (undefined at runtime → fails open → the live price flipper runs on staging against real Clover tokens). Log a line proving the gate is active on staging.
- [ ] Enable staging verification: add `'* * * * *'` to `env.staging.triggers` (~L78, safe **only after** the prod-gate) or rely on the temporary `?action=run-scheduled-tick`. Prod needs **no** trigger change (already @ L17). Staging shares real Page tokens — verify against a sandbox `facebook_page_targets` mapping or `publish_live=0`.
- **Files:** `migration-021.sql`, `worker.js`, `wrangler.toml`. **Shippable:** yes (invisible). **Size:** M.
- **Verify:** `table_info` shows 9 new columns + both indexes on both DBs; manual `publish-draft` posts identically (regression); `?action=drafts` still returns rows; staging logs prove `processSaleSchedules` is **skipped** while the every-minute tick fires.

### Phase 6 — Scheduling engine: endpoints + idempotent cron + Schedule popover + scheduled cards
- [ ] **Goal:** make the Scheduled lane real, with a hard no-double-post guarantee.
- [ ] Endpoints `draft-schedule`, `draft-unschedule` (§4), server-side ET→UTC with confirm-back; board → `status=all` + client partition; manual-path guards + scheduled-row image re-validation + asset-delete guards.
- [ ] `processScheduledPosts` with reaper, reconcile-before-publish, atomic claim, distinct `published:true` wrapper, backoff via `next_attempt_at`, max-lateness guard, terminal `schedule_error` + notification (§4). Wire the second `ctx.waitUntil` @ ~9890.
- [ ] UI: wire "Schedule…" → `ctSchedulePopover` (app tokens: `datetime-local min=now`, "Publish live" toggle **default ON** with explicit "will publish LIVE" copy, Confirm) → `POST draft-schedule`. Scheduled cards: ET time via `Intl`, amber SCHEDULED chip, `· from Flow` when `origin==='flow'`, error badge + unschedule/retry for `schedule_error`. Populate the Scheduled lane, sorted `scheduled_at ASC`.
- **Files:** `worker.js`, `index.html`, `sw.js`. **Shippable:** yes. **Size:** L.
- **Verify (staging via tick/prod-gated cron):** schedule a draft-with-cover for now+2min → **exactly one** FB post, `status→published`; a second/overlapping tick does **not** double-post; simulate eviction (row `publishing`, old `claimed_at`) → reaper reconciles via `marketing_publish_log`, no duplicate; past-time / image-less rejected; unschedule → Drafts; after MAX_ATTEMPTS a `schedule_error` card + notification. **Then apply migration-021 to prod, deploy.**

### Phase 7 — Schedule via Flow: seed drafts from a marketing_flow week
- [ ] **Goal:** turn a Flow week into per-store drafts tagged "· from Flow," reusing Phase 6.
- [ ] `?action=flow-schedule-week` (§4): **per-store loop insert** (D1 100-param), inferred `post_type`, `origin`/`flow_*`, default `scheduled_at`; **caption parameterized by `fiscal_year`+`retail_week`** (not today); `uq_drafts_flow_week` → "already seeded." Land in Drafts by default (product decision §7). Resolve unschedule/dedupe interaction.
- [ ] Do **not** hook `flow-week-upsert`; the seed is a point-in-time snapshot.
- [ ] UI: "Schedule via Flow" entry (Flow calendar and/or Content) picking week + stores; seeded cards read "· from Flow"; operator finishes cover/caption then Schedules via Phase 6.
- **Files:** `worker.js`, `index.html`, `sw.js`. **Shippable:** yes. **Size:** M.
- **Verify:** seed a week → one `origin='flow'` draft per selected store; re-seed → dedupe message, no duplicate; generated caption reflects the **target** week; a seeded draft finishes + schedules through Phase 6; editing the source week afterward does not mutate seeded drafts.

---

## 6. Cross-cutting risks & mitigations

| Risk | Mitigation (and where enforced) |
|---|---|
| **Double-post** (overlapping ticks / eviction / ambiguous FB outcome) | Atomic claim (`changes===1`) + reconcile-before-publish against `marketing_publish_log` + stale-`publishing` reaper keyed on `claimed_at`. All three required. (Ph6) |
| **Prod-gate fails open** → live Clover price flip on staging | Gate with `env.API_ORIGIN.includes('staging')` (@ 4854), never `env.name`; log the active gate; assert `processSaleSchedules` skipped on staging. (Ph5) |
| **Staging "verification" posts to the real Page** (shared tokens) | Verify against a sandbox `facebook_page_targets` mapping or `publish_live=0`; never treat staging as sandboxed. (Ph5–6) |
| **Migration/deploy ordering on prod** breaks `?action=drafts` (`SELECT d.*`) | Migrate DB, `PRAGMA` verify, **then** deploy code that reads columns. Forward-only. (Ph5) |
| **Scheduled lane invisible** (exact-match `status=scheduled`; shared `LIMIT 300`) | Board fetches `status=all`, partitions + sorts client-side; per-lane caps / paginate Published. (Ph4/Ph6) |
| **`ctRenderFolders` shared by Thumbnails** | Rewrite `ctRenderThumbGrid` to a flat gallery in the same commit that deletes folders; grep call sites first. (Ph4) |
| **Composer work loss** (initContent resets every visit; PWA auto-reload) | Idempotent `initContent` + localStorage autosave; defer `controllerchange` reload when dirty. (Ph2) |
| **Silent LIVE-publish reversal** (scheduled = live vs manual staged default) | Explicit "will publish LIVE" copy + `publish_live` toggle; cron wrapper hardcodes `published:true`; verify the FB post is actually live. (Ph6) |
| **Terminal failure unseen** (token revoked, permanently broken row) | `publish_attempts<MAX` cap → terminal `schedule_error` + notification via existing push path; card shows reason + retry. (Ph6) |
| **Transient outage → permanent loss** | `next_attempt_at` exponential backoff (2/10/30m) + error classification; max-lateness guard drops stale posts to `schedule_error('expired')`. (Ph6) |
| **Asset deleted after scheduling** (TOCTOU) | Guard thumbnail/photo delete + store re-map against `scheduled` references; re-validate images on `draft-save` of a scheduled row. (Ph6) |
| **Wrong Flow caption** (today-based lookup) + **D1 100-param** on fan-out | Parameterize caption by fy+week; insert one row per store in a loop. (Ph7) |
| **CACHE_NAME drift** (installed PWAs pinned to old shell) | Bump `sw.js` on every index.html phase; treat as a release gate. (Ph1–7) |
| **Resource coupling** (publisher shares the 50-op sale-scheduler tick) | PER_TICK=5 + a hard total-subrequest budget; if breached, split the publisher to its own cron. (Ph6) |

---

## 7. Open questions for the user

1. **Flow landing lane:** seed "from Flow" into **Drafts** (safe — no image yet; operator adds cover/caption then Schedules) or **directly into Scheduled** as the mock depicts (needs auto-assigned cover + pre-generated caption)? Recommend Drafts first.
2. **Default publish day/time per Flow week:** Monday of `week_start` @ 08:00 ET? Per-store configurable? Account-wide time?
3. **Which stores does a Flow week seed** — all Page-mapped stores automatically, or an operator multi-select?
4. **Confirm scheduled posts publish LIVE** (`published=true`), reversing the manual button's safe/staged default.
5. **"Schedule…" scope:** a general `datetime-local` picker on any draft (recommended), Flow-only seeding, or both?
6. **Retry/notification policy:** MAX_ATTEMPTS=3 with 2/10/30m backoff then terminal `schedule_error` — acceptable? Which channel for the terminal-failure alert (existing push, email, both)?
7. **Unschedule vs dedupe:** unscheduling a flow-origin post keeps `origin='flow'` (one-click re-schedule, re-seed stays blocked) or fully detaches to a plain draft (re-seed allowed)?
8. **Capability loss:** the board drops type→month folder browsing. Accept, or retain a type/month filter on the Posts tab?
9. **Layout width:** confirm ~1180px content + 380px preview rail (vs the mock's 1320/410) given the persistent 256px sidebar squeezes the form in the 1024–1200 band.
10. **Char counter:** confirm it stays advisory/non-blocking and reflects the Facebook limit (preview is IG-styled but posts to a FB Page feed).
