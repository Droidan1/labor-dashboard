# Bin-photo auto-draft: bin cover + bin text (2026-08-26)

> **Carried over from the Aug 20 Merchandising plan** (the only item there still open):
> `- [ ] Worker deploys before frontend`. Still open, and it matters here — worker deploys
> are manual (`npx wrangler deploy`, no CI), and nothing in this change reaches production
> until one runs.

**Reported:** "the text and thumbnail still looks at the flow calendar and doesn't ignore it
and use bin thumbnail with bin text."

## What production actually shows (prod D1, read-only)
The five auto-drafts of 2026-08-20 (`created_by='auto:bin-photos'`, BL14/BL16/BL2/BL4/BL1):
- every one got `thumbnail_id = 3` — the "Dig for Deals" Dollar-Days price-ladder cover
  (same byte count as thumbnail 1, uploaded 2026-07-09);
- every caption is a description of **that graphic**, not of the bins: all five open
  "Six days, six prices…" and recite $10 → $6 → $3 → $2 → $1 → 50¢, and tag #DollarDays.

"Dollar Days" / "Double Dip" is Flow Calendar vocabulary — `marketing_flow.dd_loyalty`,
rendered in the calendar as the **DD / loyalty** column. So the promo really is driving both
the picture and the words.

## Root cause — the cover is the vector, not the `marketing_flow` query
`buildCaption` already refuses the Flow week for `bin_preview` (`MARKETING_FLOW_POST_TYPES`
is `weekly_promo` + `event` only). The promo gets in **through the picture**: the auto-draft
attaches a branded cover and the prompt says *"Match the caption to what it actually
promotes — its theme, headline, and any recurring schedule, day-by-day pricing, or offer
printed on it."* The model does exactly that. The bin photos the manager just uploaded are
never shown to it at all.

Second, smaller defect: the cover pick falls back to the newest active thumbnail **of any
post type** when no `bin_preview` cover exists — so a weekly-promo or event cover can become
a bin post's cover, and then its subject. `tasks/bin-photo-autodraft.md` specifies
"auto-pick newest active `bin_preview` thumbnail"; the fallback is not in the spec.

## Plan
- [x] Cover: newest active `bin_preview` only — drop the any-post-type fallback.
- [x] `buildCaption`: take `photoIds`; when given, attach those photos (small thumbs first,
      ≤4, ≤5 MB, PNG/JPEG/GIF/WebP) as the post's subject and do **not** attach the cover.
- [x] Prompt: say the attached images are this week's bins, a sample of a larger batch;
      write about the mix; nothing is printed on a bin photo, so state no price/day/offer.
- [x] Shared system prompt: say "images" rather than "cover graphic" so the authority rule
      is true for both callers (the manual composer still only ever sends a cover).
- [x] `fillAutoDraftCaption`: pass the draft's `photo_ids`, not `thumbnail_id`.
- [x] Extract `r2ImageBlock()` — the cover loader duplicated for photos otherwise.
- [x] Tests: cover never crosses post types; the caption request carries the photos and no
      cover; existing burst/idempotency assertions still hold.

## Known consequence (unchanged trigger)
The caption is still written by the **upload that creates the draft**, so the model usually
sees the batch's **first** photo (a Thursday batch is ~30 separate requests). That is by
design — Brian chose upload-triggered over a cron. Follow-up if the sample proves too thin:
fill the caption from the every-minute tick once the batch has settled (no new photo for
~2 min), which would show it the whole batch and also retry a failed caption.

## Not code
Thumbnail 7 "Doubledip" is tagged `post_type='bin_preview'` and is now the newest active one,
so it is what the next auto-draft will pick up as its cover. If that is a Double Dip promo
graphic rather than a bin cover, retag or deactivate it — code cannot tell a promo graphic
from a bin cover, only which folder it was filed in.

## Verification gates
- [x] `bash scripts/test.sh` green — **2263 assertions across 49 suites**, run again after
      the rebase onto `origin/main` (11 of those are new here: 30 -> 41 in this suite).
- [x] `node scripts/test-bin-photo-autodraft.mjs .` — 41 assertions (was 30).
- [x] Mutation-tested one site at a time (lessons.md rule): restoring the cover fallback
      fails 1 assertion; captioning from the cover again fails 4 *different* ones.
- [x] `node --check` on worker.js as a module (it is ESM — plain `node --check` lies).
- [ ] **Worker deploy** — `npx wrangler deploy`. No frontend change, so nothing to sequence
      against and no `sw.js` bump needed; the worker goes out alone.
- [ ] Verify on the next real bins upload: the draft's cover comes from the Bin Preview
      folder, and the caption talks about what is in the photos.

## Review — Aug 26 2026

**The Flow Calendar was never being queried.** `MARKETING_FLOW_POST_TYPES` already excludes
`bin_preview`, so re-reading `buildCaption` would have confirmed the gate holds forever. The
promo reached the caption **through the cover image** — the auto-draft attached a branded
graphic and the prompt told the model to match the caption to the pricing printed on it. It
did. The bin photos were never sent.

Three changes, each at a different site:
1. **The cover can only be a bin cover.** The `else any active one` fallback is gone — it
   could hand a bin post the week's promo cover, and a cover is not decoration here, it is
   what the model is shown.
2. **The photos are the subject.** `buildCaption` takes `photoIds`, sends the small thumbs
   (≤4, ≤5 MB), and sends no cover when it has photos — gated on what the caller *asked for*,
   so an unreadable photo degrades to no image rather than back to the promo.
3. **The shared prompt tells the truth.** "Cover graphic" → "images" in the order-of-authority
   rule, since one caller now attaches photos. The manual composer's behaviour is unchanged:
   it sends no `photoIds`, so it takes the cover branch exactly as before.

Two things this does **not** fix, both flagged in `tasks/bin-photo-autodraft.md`: the caption
still sees the batch's first photo (upload-triggered by design), and no code can tell whether
a cover filed under Bin Preview is a bin cover or that week's promo graphic.

## Follow-up — pin the auto-draft cover (2026-08-26, same day)

**Asked:** "Can you fix this without deleting the doubleDip thumbnail?"

Yes — the problem was never that cover, it was that the pick was a *guess* ("newest active
`bin_preview`"), so any promo graphic filed in that folder wins it by being new. Made the pick
explicit instead, with no migration and no data touched:

- [x] `content_settings.auto_draft_cover_id` — the existing key/value table, already holding
      `brand_guide`. No schema change.
- [x] `ensureAutoDraftForPhotos`: pinned cover (if still active) → newest active `bin_preview`
      → none. A stale pin logs and falls through rather than posting coverless.
- [x] Pin validated at `?action=content-setting` when set — a pin naming a missing or removed
      cover is refused there, not discovered on a Thursday.
- [x] `?action=thumbnails` returns `auto_draft_cover_id` so the UI can show which is pinned.
- [x] `AUTO` badge per tile in the Thumbnails tab, mirroring the delete badge beside it.
- [x] `sw.js` CACHE_NAME → **v122** (frontend commit). Rebasing onto main landed on v121,
      which main's own frontend commit had already taken — same name, so an installed PWA
      that cached v121 would never fetch the AUTO badge.
- [x] Suite 41 → 50 assertions; mutation-tested: ignoring the pin fails 2 assertions,
      dropping the set-time validation fails a different 1. Full suite **2283 / 49** green.
- [x] `bash scripts/build.sh` after `npm ci` — every new utility (`left-1.5`, `h-7`, `px-2`,
      `tracking-wide`, `font-black`) compiles into `dist/tailwind.css`.
- [x] Contrast, computed not eyeballed: pinned `#06210f` on `#22c55e` = **7.5:1**. The
      unpinned badge started as `text-white/80` on `bg-black/60`, which composites to
      **4.34:1** over a light cover — under the gate — so it is plain `text-white` (**5.7:1**
      worst case). Both badges carry their own background, so neither depends on the theme.

### ⚠️ Deploy order — worker FIRST, then frontend
The new UI POSTs a settings key the current worker rejects as "Unknown setting", so a frontend
that lands first has a dead AUTO button. The worker is backward-compatible on its own: with no
pin set it behaves exactly as it does today.

### Then set it
The pin starts empty, which means today's behaviour — newest active `bin_preview`, i.e.
"Doubledip". It only changes once someone taps AUTO on the cover they actually want.
