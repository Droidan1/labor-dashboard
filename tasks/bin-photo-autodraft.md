# Bin-photo auto-draft (upload-triggered)

**Goal:** a manager submits bin photos; a ready-to-review draft appears in Drafts so
Brian only edits and posts.

## Decisions (Brian, 2026-08-18)
- Caption: **auto-generated** (same Opus 5 pipeline as the AI button).
- Grouping: **`photo_type='bins'` only** — retail photos never auto-draft.
- Cover: **auto-pick** newest active `bin_preview` thumbnail.
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
