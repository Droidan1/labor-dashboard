# Bargain Lane website + Hub publishing: reviewed plan (2026-11-23)

Status (2026-11-25): **Phase 1a live in production** (#418: migration-093 + worker). **Phase 1b part 1 live** (#419: the Hub's
Marketing › Bin Preview page, admins and superusers only). **Part 2 built:** the Dupont page, in the private repo
`Droidan1/bargainlane-site`, not deployed. **Part 3:** the click-through demo below.
Nothing was changed in staging, production, Buffer or DNS.

---

## 1. Phase 0: what the Hub already has

| Need | In the Hub today? | Use it / gap |
|---|---|---|
| Staff sign-in, roles, store scoping | Yes. Session cookie on `retjghub.com`. `allowedStores()` / `canAccessStore()`. Fail-closed business gate: every new `?action=` must be declared in `ACTION_BUSINESS`, or it gets a 403. | Reuse as is. |
| A reviewer / approver role | **No.** Content Studio drafts, scheduling and publishing are admin/superuser only (`requireInventoryAccess`). Managers can upload but can't see drafts. | New rule (see §4.3). |
| Audit of who approved or pulled | **No.** `marketing_publish_log` has no actor column. `marketing_drafts` records only `created_by`. | New table. |
| Phone photo upload | Yes. `photo-upload`: phone downscale to 2048 px, R2 `marketing/{store}/{type}/…`, 15 MB cap. | Reuse. |
| Bin preview drafts | Partly. Every `bins` upload auto-creates one Facebook draft per store per *upload week* (`ensureAutoDraftForPhotos`). There is no sale date, no submit/approve/pull, and no website window. | Reuse the burst-safe pattern, not the table (see §4.2). |
| Public images | Yes. `/p/<id>-<uuid>.<ext>` was built for Buffer. 🛑 **A bins photo is public from the moment it is uploaded, not when it is approved**, and the link never expires. | Website must use an approval-checked image route. |
| Public JSON for a website | **None.** The only key-gated reads use `MORNING_BRIEFING_KEY`, which covers every store and includes financials. Never give that key to a site. | New public route. |
| CORS for another domain | No. `ALLOWED_ORIGINS` is the three `retjghub.com` hosts, with credentials. It is also the passkey origin list, so **don't add bargainlane.com there.** | Public route sends its own `Access-Control-Allow-Origin: *` with no credentials, or the site fetches server-side. |
| Store hours, address, phone | **None** (addresses appear only in a code comment). | New store settings. |
| Bin price schedule | **None as data.** It exists only in cover graphics and Clover item names. | New store settings. |
| Holiday overrides | **None.** A code comment says there is no holiday calendar. | New table. |
| Flash sales / campaigns | Free text in the Flow Calendar (which ends 2026-12-26) and a Sign Studio sign type. The sale scheduler changes **Clover prices**, not content. | Phase 2: new entity, same review flow. |
| Buffer | Live. Hub to Buffer with an at-most-once guard: a `handing` log row is written *before* every `createPost`, and a retry adopts only a matching live post. Fake Buffer exists in `test-buffer-publish.mjs`. Dupont's channels: **the Fort Wayne Facebook page shared with Coliseum**, plus Google Dupont. All 8 Buffer channel slots are used (no Instagram). | Reuse the guard pattern in a mock adapter. |
| Time zones | Every store is `America/New_York`, hard-coded in about 30 places. `etWallClockToUtc(wall, tz)` already takes a zone. | Add a per-store `tz` field, defaulting to New York. |
| Sign Studio | `saved_signs`, scoped by owner. | Phase 3 only. |
| Read-only MCP | It has a few writes (supply status and Clover items), each behind a preview plus `confirmToken`, and no content writes. | Phase 3: draft-only tools through the same agent door. |

Dupont = **BL4**. Open stores: BL1 Coliseum, BL2 South Bend, BL4 Dupont, BL14 Battle Creek, BL16 Indy East. BL8 Holland is closed but still in `ALL_STORES`, so the site needs its own list of open stores.

### Earlier work found: branch `feature/shared-website-buffer` (Oct 14–15, never merged)
The design-review session built a backend sketch: `website_campaigns`, `website_photo_sets`, a public `/website/content` feed, `website-control.html`, and a `buffer_outbox`. It has 92 test assertions. **Don't merge or rebase it:**
- It is about 70 PRs behind main.
- Its `migration-078` number is already taken on main (`item_day_lines`).
- It builds a **second** Buffer delivery path beside the live one (migration-079/083). Two paths for one draft is how double posts happen, and its own doc warns about exactly that.
- Approval is admin-only. It has no hours, holidays or sale date.

**Harvest these ideas:** revision numbers for concurrent edits, rejecting skipped or repeated DST hours, a public-field allowlist, and the site clearing prices and offers when the feed fails instead of showing stale ones.

### Current bargainlane.com
- WordPress + Elementor + Astra, with the Rank Math sitemap. **17 URLs total**, no store pages.
- Rewards are Mylty (`start.mylty.co/login?id=23410`). Auction is BidFTA.
- Bin prices conflict across sources:
  - live site: $10 / $6 / $3 / $2 / $1 / $0.50;
  - mockup ("Sept 30 prices"): Fri $12 before 2 PM, $9 after, then $6 / $4 / $2 / $1 / $0.50.

  These go in settings as data, so the pilot uses test values. **Real values are needed before launch.**

---

## 2. Decision: where the website lives

**Recommendation: the publishing backend goes in the Hub; the website goes in its own repo.**

- **Backend in the Hub** (worker.js, a migration, Hub screens in index.html). Reasons:
  - Approvals, store permissions, photos and Buffer already live in the Hub worker.
  - Hub sessions and passkeys are pinned to `retjghub.com`, so a separate backend would have to re-implement auth.
  - Drafts never leave the Hub.
- **Website in a new repo** (e.g. `bargainlane-site`, kept *outside* iCloud Desktop): a small Cloudflare Worker that server-renders pages from the Hub's public JSON. Reasons:
  - **Different release rhythm.** Marketing copy tweaks shouldn't ride the Hub's deploy guard, its 2 MB worker or its `CACHE_NAME` bumps.
  - **The Hub's GitHub Pages owns www.retjghub.com** (one CNAME), and the Hub's service worker caches everything on its origin. A public site there would be served stale.
  - **SEO and launch needs:** server-rendered hours and prices are visible to Google, and the 17 WordPress URLs and QR redirects live naturally in a worker.
  - **No CORS change needed:** server-side fetch. Expiry is enforced on every render.
  - **Failure isolation:** if the Hub is down, the site shows a neutral fallback, never stale prices.
  - Same Cloudflare stack, so there's no new vendor.
- **The contract between them** is one versioned, read-only route: `GET /public/v1/stores/<code>`.

Rejected options:
- **Site inside the Hub repo** (`site/` folder): one PR could change both sides, but it collides with the Pages/CNAME/service-worker setup and mixes customer and staff release cycles.
- **A separate backend worker on the same D1:** a second deploy surface for no gain at this traffic.

The repo is public either way. That's fine for site code, which has no secrets.

---

## 3. Changes to the original plan

1. **"Work from the Hub repo":** yes for the backend; the site gets its own repo (§2).
2. **Scope discipline:** Phase 1 is about two sessions of work. Split it:
   - **1a:** server, data and tests. Covers all six required verifications. Locally provable.
   - **1b:** the Hub screens, the Dupont site page, and a click-through local demo.
3. **Buffer "drafts" vs today's model.** On 2026-10-13 the Hub was set to keep the schedule and Buffer to post at that time. Buffer *drafts* (`saveToDraft`) move scheduling into Buffer. The pilot only creates mock drafts, so this costs nothing now. **Decide before Phase 2's real Buffer test.**
4. **Overlap with the existing bins auto-draft.** Every Dupont `bins` upload already creates a Content Studio Facebook draft. Once Bin Preview also makes social drafts, Dupont would get two. Recommendation: Bin Preview becomes the single owner of social posts for pilot stores, and the auto-draft skips them. That is a one-line guard, made in Phase 2 before Dupont goes live.
5. **Emergency pull must stop the images too.** The website must use an approval-checked image route, not `/p/` (§4.4).
6. **QR inventory:** the current sitemap shows no QR destinations. Marketing has to list what's printed (Phase 3).

---

## 4. Phase 1 design (pilot: Dupont only)

### 4.1 Data: `migration-093.sql` (additive, re-runnable, applied only to local/test databases in this pass)
- `store_settings`
  - Columns: `store` (PK), `tz` (default `America/New_York`), `profile_json` (display name, address, phone, maps URL), `hours_json` (open and close per weekday), `bin_prices_json`, `preview_defaults_json`, `revision`, `updated_by`, `updated_at`.
  - `bin_prices_json` holds tiers per weekday, each `{from:"HH:MM", price}`. The Friday change is `[{from:"00:00",price:12},{from:"14:00",price:9}]`.
- `store_day_overrides`
  - Columns: `store`, `date`, `closed`, `open`, `close`, `bin_prices_json` (nullable), `note`, `created_by`, `created_at`.
  - PK is `(store, date)`. This is the holiday override for hours and/or prices.
- `bin_previews`
  - Columns: `id`, `store`, `sale_date`, `photo_ids` (JSON), `caption`, `status`, `starts_at`, `ends_at` (UTC, computed from store-local wall time), `revision`, `submitted_by/at`, `reviewed_by/at`, `pulled_by/at`, `pull_reason`, `created_at`.
  - `status` is one of `draft | submitted | approved | rejected | pulled`. "Scheduled", "live" and "expired" are worked out from the time window, never stored, so no cron is needed to show or hide one.
  - A unique index stops two live previews for the same store and sale date.
- `content_audit`: `entity`, `entity_id`, `action`, `actor_id`, `actor_email`, `at`, `detail_json`. Covers who submitted, approved, rescheduled, pulled, or edited settings.
- `social_drafts`
  - Columns: `id`, `preview_id`, `channel_key`, `status` (`handing | drafted | error | needs_check`), `remote_id`, `payload_hash`, `attempts`, `created_at`, `updated_at`.
  - **`UNIQUE(preview_id, channel_key)`** is the at-most-once guarantee.

### 4.2 Hub actions (all declared `"bl"` in `ACTION_BUSINESS`; all refuse the leaked `X-Snapshot-Secret`)
| Action | Who | Does |
|---|---|---|
| `bin-preview-save` | Manager of that store, or a reviewer | Creates or edits a draft: photos already uploaded through `photo-upload`, sale date, caption. Uses `expectedRevision` (409 if stale). |
| `bin-preview-submit` | Same | draft → submitted |
| `bin-previews` | Manager: own stores. Reviewer: all of them | List, store-scoped on the server |
| `bin-preview-review` | Reviewer | Approve (with optional start/end; defaults come from store settings), reject with a note, or reschedule. Approval queues the social drafts. |
| `bin-preview-pull` | Reviewer | Emergency unpublish with a reason. Takes effect on the next public read (≤60 s with cache). |
| `store-settings` / `store-settings-save` / `store-override-save` | Read: managers of that store. Write: reviewers | Hours, prices, overrides. Every write is audited. |

### 4.3 Permissions (server-enforced)
- **Submit** = a user whose `allowedStores` includes the store.
- **Review / pull / edit settings** = admin or superuser with Bargain Lane access. This matches who publishes today. A narrower "content reviewer" grant can come later.
- Managers can never approve, even for their own store.

### 4.4 Public read (Hub worker, path-based, returns before the auth gate, next to `/p/`)
- `GET /public/v1/stores/BL4` (GET and HEAD only; any other store returns 404; open stores only) returns:
  - profile;
  - today's hours with any override applied;
  - **the bin price in effect right now**, resolved in the store's local time;
  - the week's schedule;
  - the active preview: only `approved` and `starts_at ≤ now < ends_at`.
- **It never returns** drafts, names, emails, R2 keys or internal notes. Fields come from an explicit allowlist.
- `GET /public/v1/img/<previewId>/<photoId>.<ext>` checks again that the preview is active, so a pull or expiry stops the images too. 🛑 It never carries the photo's R2 UUID: that UUID is the permanent `/p/` link.
- Headers: `Cache-Control: public, max-age=60` and `Access-Control-Allow-Origin: *` without credentials.
- `/p/` stays as it is for Buffer.

### 4.5 Social drafts (mock adapter only)
On approval, the Hub works out the intended channels from a channel map: Dupont = `facebook:fortwayne` + `google:dupont`. For each one:
1. `INSERT … ON CONFLICT DO NOTHING` a `handing` row. Only the request that wins the insert calls the adapter.
2. Call `adapter.createDraft()`. In this pass that is the **mock**, which records each call; there is no Buffer code path.
3. Store `remote_id` → `drafted`.

A retry whose earlier row is `drafted` does nothing. One stuck in `handing` longer than 10 minutes becomes `needs_check` and is **never** sent again automatically. This is the live path's guard, reused as a pattern.

### 4.6 Screens
- **Hub (index.html, DESIGN.md §4.8 styling, both themes):** one "Bin Preview" page. The manager view is Upload → pick sale date → Submit, using the existing phone uploader. The reviewer view is a queue with a phone-sized preview card and Approve / Schedule / Pull. There is also a small "Store settings" panel.
- **Site (new repo):** the Dupont store page only, phone-first, in the Fresh Finds look:
  1. today's bin price and when it changes;
  2. hours today (including a holiday notice);
  3. Directions button;
  4. the active bin preview gallery;
  5. a Rewards link to Mylty.

  It falls back to a neutral page when the feed fails.

---

## 5. How success is measured (written before the code)

Each check runs against the real `worker.fetch` in the node harness with a pinned clock. No network, no Cloudflare.

| # | Check | Pass condition |
|---|---|---|
| E1 | Start / expiry | An approved preview is absent 1 s before `starts_at`, present at `starts_at`, absent at `ends_at`. Images follow the same rule. |
| E2 | Wrong-store denial | A BL2 manager gets 403 on save/submit/list for BL4, and gets 403 on review even for BL2. |
| E3 | Draft privacy | Draft, submitted and rejected previews never appear in `/public/v1`. Their image route returns 404. The response contains no emails or R2 keys (checked against an allowlist). |
| E4 | Emergency pull | After a pull the preview and its images are gone on the next read. `content_audit` has the actor and reason. |
| E5 | Price override | Friday 13:59 local → $12 and 14:00 → $9 (test values). A holiday override for that date replaces both hours and price. A DST-change week resolves correctly. |
| E6 | No duplicate draft | Approving twice, two concurrent approvals, and a retry after a "lost" adapter response each produce exactly one mock call per channel. A stuck `handing` row → `needs_check`, with zero re-sends. |
| E7 | Gate completeness | `npm test`, including `test-business-gate.mjs`, stays green with the new actions declared. The leaked secret is refused on review/pull. |
| E8 | UI | Playwright (`scripts/browser-bin-preview.mjs`, stubbed API) at 390 px and 1440 px, light and dark, contrast ≥ 4.5:1 measured. The site page gets the same checks in its repo. |

**Demo (1b), built 2026-11-25:** `scripts/demo-site-pilot.mjs` runs the real Hub worker (harness: sqlite D1, in-memory
R2) serving the built app, and the Dupont page from the site repo reading it, all in one process with made-up data.
Every outside call is refused, and sign-in is a demo-only persona page (no auth code changes).

    bash scripts/build.sh < /dev/null
    node scripts/demo-site-pilot.mjs            # this computer only: open http://127.0.0.1:8788/demo
    node scripts/demo-site-pilot.mjs --lan      # also a phone on the same Wi-Fi (it prints the address)
    node scripts/demo-site-pilot.mjs --check    # the flow below, headless; exit 1 on any failure

`SITE_DIR` points at the site repo (default `~/Projects/bargainlane-site`); `--check` needs playwright-core and Chrome.
Seeded: Dupont's page switched on with a sample address and test prices, 8 generated bin photos, and one preview for
tomorrow waiting for review. Previews there start 2 days before their sale day, so an approval shows at once.

The run-through:
1. Sign in as **Alex, Bargain Lane admin**. Bin Preview opens with "1 waiting for review".
2. Open it and **Approve**. Open the Dupont page: the sneak peek and its 3 photos are there.
3. Back in the Hub, **Pull from site** with a reason. Reload the Dupont page: the photos are gone and their links 404.
4. Change a bin price or add a holiday in **Store page settings**, save, reload the Dupont page.
5. Sign in as **Dee, Dupont manager**: no Bin Preview (admins only until the website exists).

---

## 6. Order of work

**1a: server and tests (first session)**
1. Fresh worktree off `origin/main`. Not this checkout: it holds the unmerged hourly-push fix.
2. Write `scripts/test-bin-preview.mjs` with E1–E7 failing.
3. Add `migration-093.sql`, the store-settings resolver (hours, price tiers, overrides, tz), the preview actions with audit, the public route and image route, and the social-draft guard with the mock adapter.
4. Run `npm test` until it's green. Add `.dev.vars` and `.env` to `.gitignore`.
5. Open a PR. Nothing is deployed: the migration and worker stay unapplied until Brian asks.

**1b: screens, site and demo (second session)**
6. Hub Bin Preview page, store settings panel, and the Playwright check (E8).
7. Create the `bargainlane-site` repo locally with no remote until approved: the Dupont page, its tests, and a fixture copy of the v1 JSON.
8. Demo script. Write up how to run it, what passed and what didn't.

---

## 7. Backlog (not in this pass)

**Phase 2**
- Home, Deals, Bargain Bins, Stores, Rewards pages.
- Flash Sales using the same review flow: eligible stores, window, images, auto-expiry.
- The auto-draft skip for pilot stores (§3.4) and the Buffer draft-vs-schedule decision (§3.3).
- Real Buffer adapter, tested in a designated test channel **after separate approval**.
- Staging rollout. 🛑 Staging is not a sandbox: it holds live Clover/Buffer/Meta credentials and runs the every-minute cron. Review it before any deploy there.
- Pilot one full Fri→Wed bin cycle and one flash sale at Dupont.

**Phase 3**
- Inventory the 17 WordPress URLs plus QR destinations, then redirects and the sitemap.
- Accessibility and mobile audit; a rollback plan (the DNS flip is reversible).
- Launch approval.
- After launch: Sign Studio assets, AI captions, and MCP draft-only tools through the agent door.

**Out of v1:** checkout, a rewards rebuild, unattended social publishing.

---

## 8. Decisions for Brian (the pilot proceeds on the defaults)

1. **Repo split** as in §2. Default: yes. Create the GitHub repo later, on your OK.
2. **Reviewers** = admins and superusers. District managers aren't reviewers yet.
3. **Default preview window** = noon the day before the sale date until close on the sale date, with the reviewer able to change it. Should it run through the cycle (Wednesday) instead?
4. **Real bin prices and Friday cutover time** are needed before launch, not for the pilot.
5. **Buffer drafts vs Hub-scheduled posts** (§3.3), before Phase 2's Buffer test.

## 9. Problems found in passing (not fixed)
- 🛑 The burned `X-Snapshot-Secret` passes `requireInventoryAccess`, so whoever has it can call `publish-draft` today. Rotation is already owed (ORIENT.md: Auth).
- `/p/` links work from upload onward, not from approval. That's fine for Buffer, but nothing may treat "has a /p/ link" as "approved".
- `drafts` and `publish-draft` don't check the store. That's safe only while they stay admin-only.
- Stale docs:
  - ORIENT.md still lists `district_manager` (retired in migration-029);
  - README says staging has no crons (it has two);
  - README says localhost sign-in works, but the cookie is pinned to `Domain=retjghub.com; Secure`.
