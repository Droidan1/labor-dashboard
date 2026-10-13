# Weekly marketing intake — spec + manager instructions (2026-10-13)

Source: the 2026-10-13 marketing meeting. RETJG HUB is the intake; Buffer queues and publishes.
This file covers **step one only** (intake). Buffer is step two, tracked in `tasks/todo.md`.

## What exists today (measured 2026-10-13)

| Fact | Where |
|---|---|
| Submit Photos takes images only, one request per file, ≤15 MB, downscaled to 2048 px on the phone | `index.html:4458`, `19472`; `worker.js:17158-17161` |
| Type chips: retail / bins / event / other; defaults to **retail** | `index.html:19381`, `19411` |
| Store picker lists **every** store and defaults to BL1 for everyone; a manager who forgets to change it gets a silent 403 | `index.html:19394`; `worker.js:17152` |
| **Associates cannot open the page** (not in `GRANTABLE_PAGES`) | `index.html:36060`, `13317` |
| The note is stored but **never reaches the caption AI** (`buildCaption` does not read it) | `worker.js:7316-7464` |
| No video support anywhere; the worker buffers the whole upload, so a 3-minute video cannot go through the photo path | `worker.js:17159` |
| Bin uploads auto-draft a weekly post; retail triggers nothing | `worker.js:17189` |
| A week is **Sunday–Saturday, Eastern** (the bin auto-draft's definition) | `worker.js:7617`, `5680` |
| 8 AM store-scoped Executive Summary email + push already reaches managers | `worker.js:6827`, `6888` |

Last 6 weeks of uploads (prod, read-only): retail photos in only 5 of ~36 store-weeks and **none in the last
3 weeks**; bins every week (8–82 per store), almost always from **one person** per store. 23% of photos carry a
note, and some are real caption facts ("Vcf furniture will be $10 each", "Appliance restock at 2pm on friday").

## Changes (proposed)

1. **Weekly targets with progress bars** on Submit Photos, per store, reset each Sunday (ET):
   Retail photos `n / 20` · Bin photos `n / 20` · Store-walk video `n / 1`. Counts every uploader at the store,
   so several people across shifts fill one bar. Reuses the labor pace bar (red < 30%, amber, green at 100%).
2. **Admin control for the targets** (one chain-wide set; per-store overrides later only if asked).
   Stored in the existing admin `content_settings` table (`worker.js:17361` whitelist).
3. **Video upload** for the store walk: phone video as-is, chunked straight to R2 through the worker
   (R2 multipart; no new credentials), with the length read on the phone and anything under 3:00 refused
   with a plain message before upload starts.
4. **Type is chosen, not defaulted**: no preselected chip, so nothing lands as "retail" by accident;
   store-walk video is its own choice.
5. **Store picker preselects the user's own store** and lists only stores they hold.
6. **Associates can submit** (the meeting's "SM means anyone").
7. **Keep the note, relabel it** "Price, sale or restock info (optional)", and feed it to the caption AI.
8. ~~**Morning check**~~ (dropped by Brian 2026-10-13): one line per store in the 8 AM Executive Summary —
   `Marketing this week: Retail 6/20 · Bins 14/20 · Store walk 0/1` — so the morning call reads straight off it.

Delivered as three PRs: (1) targets + bars + admin control + picker/type/associate fixes + note; (2) video;
(3) morning line. (1) and (3) need no new storage beyond a settings key; (2) needs a migration.

## Decisions (Brian, 2026-10-13)

- Retail target **20**; bins 20; one store walk of at least 3:00.
- Week stays **Sunday–Saturday ET**, shown as **due Thursday** (end of day).
- **Associates can upload.**

## Manager instructions (send once (1) and (2) are live)

> **Subject: New weekly marketing targets in RETJG HUB**
>
> Starting this week, every store has three marketing targets, tracked live on the **Submit Photos** page:
>
> 1. **20 retail photos**: new arrivals, featured products, end caps, seasonal.
> 2. **20 bin photos**: full bins on bin day, plus anything that stands out.
> 3. **One store-walk video, at least 3 minutes**: walk the sales floor slowly, holding the phone upright.
>
> **Anyone on your team can upload.** The bars count every upload for your store, so split it across shifts.
> They reset every Sunday.
>
> **Pick the right type** (Retail, Bins, or Store walk) before you submit. If you know a price, a sale, or a
> restock time, add it in the info box. The AI writes the post from it.
>
> **Take good photos**: good light, product filling the frame, no customers' faces, and only what is
> actually on our floor.
>
> **You don't post any of this yourself.** These uploads become your store's weekly posts. Keep doing your
> daily stories as you do now.
>
> The bars on Submit Photos show where your store stands, and we'll go over it on the morning call.
