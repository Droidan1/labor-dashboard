# Bin-photo auto-draft (upload-triggered)

**Goal:** a manager submits bin photos; a ready-to-review draft appears in Drafts so
Brian only edits and posts.

## Decisions (Brian, 2026-08-18)
- Caption: **auto-generated** (same Opus 5 pipeline as the AI button).
- Grouping: **`photo_type='bins'` only** — retail photos never auto-draft.
- Cover: **auto-pick** newest active `bin_preview` thumbnail — and *only* that (see 2026-08-26).
- Trigger: **on upload, NOT a cron.** ("can this not run a schedule but when a manager
  uploads bin photos?")

## Why upload-triggered beat the cron
Built the Thursday cron first, then replaced it. The upload trigger is better on every axis
that matters here:

| | Thursday cron | On upload |
|---|---|---|
| Latency | draft waits until 19:00 ET | appears as the batch lands |
| Off-day uploads (Wed 191, Fri 83 since June) | missed entirely | handled |
| Cloudflare `1=Sunday` DOW trap | live hazard | gone |
| DST (`0 23` shifts an hour in Nov) | live hazard | gone |
| Flow Calendar dependency (F26 ends 2026-12-26) | hard cliff | gone — week is derived from the date |
| Authorization | had to re-derive the store list (crons bypass request gates) | **inherits `allowedStores()` from the request path** |

That last row is the big one: [[cron-bypasses-request-gates]] describes exactly the class of bug
the cron version had to hand-avoid. The upload path never has it, because the store comes from a
request that already passed the gate.

## Burst safety — the one hard problem
A Thursday batch is **~30 separate `photo-upload` requests** (one photo per request, measured:
BL1 did 29 in ~2 minutes on 08-13). Naive "append to the draft" would be 30 racing
read-modify-writes. Two properties avoid it:

1. **Idempotent create** — `INSERT ... ON CONFLICT DO NOTHING` against
   `uq_drafts_auto_week(store, auto_week) WHERE origin='photos'`. Exactly one request in the
   burst wins; only the winner pays for a caption.
2. **Recompute, never append** — `photo_ids` is rebuilt from `marketing_photos` with
   `json_group_array` on every upload, so concurrent writers converge instead of clobbering.

`auto_week` is the **Sunday** starting the retail week, derived from the upload date — not the
Flow Calendar's `retail_week`, so nothing breaks when F26 runs out on 2026-12-26.

## Guards
- 🛑 Photo-list sync is gated on `status='draft'` — a **scheduled/publishing/published** post is
  never mutated by a later upload.
- 🛑 The caption fill only writes where the caption is **still empty**, so an edit of Brian's is
  never overwritten.
- ⚠️ Caption runs in `ctx.waitUntil` — the manager's upload never waits on a model call, and a
  caption failure costs a caption, not the draft or the upload.

## Files
`migration-039.sql` · `worker.js` (`autoWeekOf`, `ensureAutoDraftForPhotos`,
`fillAutoDraftCaption`, hook in `photo-upload`) · `scripts/test-bin-photo-autodraft.mjs`

## Status — built 2026-08-18, NOT deployed
Suite **1518 assertions / 42 suites**, green; the new suite is **30 assertions** driving the real
`worker.fetch(?action=photo-upload)`, including 30-sequential and 12-concurrent burst cases.

`buildCaption` was extracted from the `draft-generate-caption` handler so the endpoint and this
path share one implementation — prompts verified **SHA-256 identical** before/after, which
mattered because that handler shipped four times the same day.

### Deploy order
**migration-039 FIRST, then the worker.** The worker writes `auto_week` on every bins upload; that
column has to exist first. The migration is inert without the worker.

### Open
- ⚠️ First live exercise of `buildCaption` on a non-request path happens on the next real bins
  upload.
- 🔑 Retail photos still need the manual composer (Brian's call).
- 🔑 A bins photo uploaded *after* that week's post is published is orphaned: the sync skips
  published posts and the unique index blocks a second draft for the week. Correct, but worth
  knowing.


## Fix — bin cover, bin text (2026-08-26)

**Reported:** the auto-drafts' text and cover were still the Flow Calendar's, not the bins'.

**What live drafts showed.** All five auto-drafts of 2026-08-20 carried cover 3 (the
"Dig for Deals" Dollar Days price-ladder graphic) and captions describing *that graphic* —
every one opened "Six days, six prices", recited $10 → $6 → $3 → $2 → $1 → 50¢ and tagged
#DollarDays. "Dollar Days"/"Double Dip" is `marketing_flow.dd_loyalty`, the calendar's
**DD / loyalty** column.

**Root cause.** Not the `marketing_flow` query — that is already gated off for `bin_preview`.
The promo arrived **through the cover image**: `buildCaption` attaches the cover and instructs
the model to match the caption to what it promotes, "day-by-day pricing" included. The bin
photos were never sent to the model at all.

**Changed**
- `ensureAutoDraftForPhotos` — cover is the newest active `bin_preview` **or none**. The
  any-post-type fallback is gone: it could hand a bin post a weekly-promo/event cover, which
  then became the post's subject.
- `buildCaption` — takes `photoIds`. Given photos it sends *those* (small thumb first, ≤4,
  ≤5 MB, PNG/JPEG/GIF/WebP) and **no cover**, and tells the model they are this week's bins,
  a sample of a larger batch, with no price/day/offer printed on them. Given none, the cover is
  the subject exactly as before — the manual composer path is unchanged in behaviour.
- `r2ImageBlock()` extracted; the shared system prompt now says "images" where it said "cover
  graphic", so its order-of-authority rule is true for both callers.

**Suite** 41 assertions (was 30). Mutation-tested one site at a time: restoring the cover
fallback fails the no-fallback assertion; captioning from the cover again fails four
prompt-content assertions. Full repo suite 2263/49 green.

### ⚠️ Known: the caption still sees the batch's FIRST photo
The fill fires on the upload that *creates* the draft, and a Thursday batch is ~30 more
requests behind it, so the model usually gets one photo (capped at 4 when more have landed).
That is the price of Brian's upload-triggered design and it is still bin text. If one photo
proves too thin a sample, the follow-up is to fill from the every-minute tick once
`updated_at` has been quiet for ~2 minutes — the photo sync bumps `updated_at`, so
"the batch has settled" needs no new column, and it would retry a failed caption too.

### Which bin cover — now pinned, not guessed (2026-08-26, same day)
"Newest active `bin_preview`" is a guess, and a promo graphic filed under Bin Preview wins it
purely by being new — thumbnail 7 "Doubledip" was about to. Asked to fix that **without deleting
the cover**, so the pick became explicit:

- **`content_settings.auto_draft_cover_id`** holds the pinned cover. No migration — that table
  is already a key/value store (it holds `brand_guide`), and this is one account-wide choice,
  not a property of each cover.
- **Order:** pinned cover (if still active) → newest active `bin_preview` → none. A stale pin
  logs and falls through to the guess: a coverless post is worse than an older cover, and
  falling back *within* the bin folder is not the cross-type surprise this all started with.
- **A pin may name any active cover, any `post_type`.** The guess stays bin-only. The
  difference is that a pin is a choice and "newest" is not.
- **Validated when SET, not when used** — `?action=content-setting` refuses a pin naming a
  cover that does not exist or was removed. A pin resolved lazily would surface as a coverless
  post on a Thursday, with nothing to point at.
- **UI:** an `AUTO` badge on each tile in the Content page's Thumbnails tab, mirroring the
  delete badge already there. Tapping it moves the pin; tapping the pinned one clears it.

Nothing is deleted and nothing is retagged: "Doubledip" stays exactly where it is, usable in
the composer, and simply stops being chosen by default.

⚠️ **Deploy order: worker FIRST.** The new UI POSTs a settings key the old worker rejects as
"Unknown setting"; a worker that accepts the key before any UI can set it is harmless.
