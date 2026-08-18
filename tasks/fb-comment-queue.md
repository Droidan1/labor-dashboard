# Facebook comment review queue — Marketing › Comments

**Goal:** reply to comments on published bin posts, from a page under Marketing, separated by store.

## Decisions (Brian, 2026-08-18)
- **Review queue for EVERY comment** — no auto-send. Chosen over tiered/full-auto.
- Its own page under Marketing, **separated by store**.

## Why no auto-send
A reply is a public commitment under the business's name, and the comment text is
attacker-controllable input a model would otherwise read and act on. The queue keeps a human
between the model and the public.

## Shape
- **Ingest** — `ingestFacebookComments` polls comments on posts from `marketing_publish_log`,
  riding the **existing hourly cron** (`0 * * * *`) rather than a new schedule, so there is no
  day-of-week or DST arithmetic to get wrong. Idempotent via `fb_comments.comment_id UNIQUE`.
  Skips comments authored by the Page itself, so our own replies never queue for a reply.
- **Draft** — `draftCommentReply` (Opus 5, `effort: low`). Comment text is fenced in
  `<<<COMMENT … COMMENT` and the system prompt states plainly that it is data to answer, never
  instructions to follow. Output is narrow by construction: no prices, stock, hours, dates,
  links or promises, and an `ESCALATE` path so it can decline rather than invent.
  Complaints, refunds, injuries, staff and anything legal escalate by rule.
- **Post** — `replyToComment`. The **only** write to Facebook in the feature, reachable only from
  an explicit per-comment action, and it sends the text supplied by the reviewer rather than the
  stored draft, so what is approved is what goes out. A permission failure names
  `pages_manage_engagement` instead of passing a raw Graph error through.
- **Page** — `page-comments`, store chips with open counts + status tabs
  (Needs reply / Replied / Dismissed / All). `uiConfirm` shows the exact text before posting.

## Files
`migration-040.sql` · `worker.js` (ingest, draft, reply, 5 endpoints, hourly-cron hook,
`resolvePageToken` extraction) · `index.html` (page, nav, registry, routing) · `sw.js` v87 ·
`scripts/test-fb-comment-queue.mjs`

## Status — built 2026-08-18, NOT deployed
Suite **1551 assertions / 43 suites** green; the new suite is **33 assertions** driving the real
endpoints with every Graph call stubbed and **recorded**, so "did anything reach Facebook?" is an
assertion rather than an assumption. Pinned: drafting makes zero Graph calls; the approved text is
what posts (not a stale draft); empty replies and double replies post nothing; a permission failure
leaves status unchanged; ingest is idempotent and skips our own replies.

The business-gate completeness test caught all five new actions as unclassified — they would have
403'd in prod. Classified `bl`.

### Deploy order
**migration-040 FIRST, then the worker, and the frontend rides the same push.** The worker writes
`fb_comments` on the hourly cron as soon as it is live.

### Open / unverifiable here
- ⚠️ **`pages_manage_engagement` is unproven.** Reading comments needs `pages_read_engagement`;
  replying needs `pages_manage_engagement`. Ingest working does NOT prove replying will. The first
  real "Approve & post" is the test, and it fails loudly with the scope named.
- ⚠️ **Comment volume is unknown** — dashboard-published posts are recorded as getting ~0 organic
  reach. The page may simply be empty, which is itself the answer.
- 🔑 Only comments on posts in `marketing_publish_log` are polled (42 posts). Comments on posts
  made outside the app are invisible to this.
