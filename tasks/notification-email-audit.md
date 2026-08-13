# Notification & Email Reliability Audit — 2026-08-13

Triggered by: "some users not receiving morning emails, new users not receiving the
welcome email."

**Both reports are real. Neither is a delivery problem.** The morning email is a
recipient-list regression from the 2026-08-04/05 security fix. The welcome email is an
unretried, unrecorded single-shot send whose failures are invisible after the toast fades.

---

## 1. Morning email: 9 of 13 users were silently dropped on 2026-08-06

`notification_log`, prod, rows per day:

| Date range | daily-summary rows |
|---|---|
| 2026-07-25 → 2026-08-05 | 12–13 |
| 2026-08-06 → 2026-08-12 | **4** |

The drop is exact and permanent, and it lands right after `chainWideRecipients()`
(worker.js:5368) was introduced.

### Who is actually on the list now

`chainWideRecipients` keeps a user only if `allowedStores(u) === null` **and**
(`role === 'superuser'` or they hold a `bl` grant). `allowedUnits()` (worker.js:6851)
returns `null` only for `superuser` / `admin`; for anyone else on Bargain Lane it
returns `g.units || []` — an array, never null.

Against the 13 active prod users:

| Cohort | n | On the list? | Why |
|---|---|---|---|
| superuser | 1 | ✅ | role short-circuit |
| admin w/ `bl` grant | 3 | ✅ | `allowedStores` → null, has grant |
| admin w/ `ecom` grant only | 1 | ❌ | correct — must not see BL revenue |
| manager | 8 | ❌ | `allowedStores` → `["BL1"]` etc, non-null |

4 recipients. Matches the logged count exactly.

**The exclusion is correct security.** Before the fix, single-store managers were emailed
and pushed the whole chain's revenue — data the app itself refuses them. Re-adding them
to this list would re-open that leak.

**The bug is that nothing replaced it, and the UI still claims they're subscribed.**
`#notif-daily-summary-toggle` (index.html:2553) and `#notif-weekly-digest-toggle` have
**no role gate** — unlike `#notif-upload-alerts-row` / `#notif-ebay-alerts-row`, which are
gated at index.html:17779. All 8 managers see a checked box labelled *"Daily summary
email — 5 AM recap of all-store sales"* and receive nothing.

Copy is also stale: the cron is 8 AM ET, not 5 AM.

The intended fix is already named in the code (worker.js:5365-5367): *"Giving them a
store-scoped daily email is a feature, not this fix."*

Push is not a working fallback — only 5 of 13 users have any subscription, and only 2 of
the 8 affected managers.

---

## 2. Welcome email: failures are unretried and unrecorded

Two users invited, **neither has ever signed in**:

| Email | Invited | Re-invited | last_login | Login ever attempted? |
|---|---|---|---|---|
| kevin@retjg.com | 2026-07-27 | 2026-07-29 | never | **no** |
| contact@rejat.pro | 2026-08-07 | — | never | **no** |

"Login ever attempted" = zero `login-otp` rows in `magic_links`. `auth-login` writes one
on every sign-in attempt, so its absence means they never even tried — consistent with
never receiving the invite. Kevin is an **admin with a `bl` grant** who has been locked
out for three weeks and someone already tried `resend-invite` once.

For contrast, the login-OTP path works fine overall: 296 rows, 272 consumed.

### Why the failure is invisible

- `invite-user` (worker.js:9299-9308) catches the mailer error and returns **HTTP 200**
  with `{emailed: false, emailError}`. That is the right call — the account really was
  created, and throwing used to strand admins in an "already exists" loop.
- The UI does surface it (index.html:18344) — but only as a transient toast.
- **Nothing is persisted.** No `notification_log` row, no flag on the user. Once the
  toast is gone, "who never got their invite?" is unanswerable.
- **No retry.** One transient Resend 429/5xx = permanently no email.
- `invite-user` also writes a `magic_links` token the invite email never uses (deliberate
  — worker.js:7006-7013). 29 invite tokens exist, 10 "never used", but that number means
  nothing. It looks like a diagnostic and isn't.

---

## 3. `notification_log` reports success it did not verify

worker.js:5512 and 5678 hardcode `'sent'` for daily-summary and weekly-digest regardless
of what Resend returned. A run where every send 500s logs 4 × `'sent'`.

`sendEbayAlert` (worker.js:5981-5991) already does this correctly — real `status` plus the
`error` column. The pattern exists in this codebase; the two email dispatchers just don't
use it.

---

## 4. Nothing alerts when the email cron dies

`ctx.waitUntil(dispatchDailySummary(env, date).then(r => console.log(...)))`
(worker.js:13643) has **no `.catch()`**. `dispatchDailySummary` calls
`buildDailySummaryData` unguarded — if it throws, the whole run dies silently: no email,
no push, no alert, one unhandled rejection in the tail.

`dispatchCronFailureAlert` exists but covers only the nightly snapshot cron.

---

## 5. Deliverability

Every recipient is on Google Workspace (`bargainlane.com` and `retjg.com` are both Google
MX), so Gmail filtering gates all of it.

Auth is in decent shape:

- DKIM ✅ `resend._domainkey.retjghub.com`
- Return-Path SPF ✅ `send.retjghub.com` → `include:amazonses.com`
- DMARC `p=quarantine; adkim=r; aspf=r` — relaxed alignment, so DKIM `d=retjghub.com`
  carries it. Passing.

Gaps:

- **No `List-Unsubscribe` / `List-Unsubscribe-Post` headers** on the bulk daily/weekly
  mail (0 occurrences in worker.js). Gmail's bulk-sender rules weight this. The footer
  says "open Settings → Notifications" instead.
- No `reply_to`; `noreply@` From.
- Inconsistent From: `'RETJG HUB <noreply@retjghub.com>'` (invite) vs bare
  `'noreply@retjghub.com'` (daily, weekly, magic-link).
- Root `retjghub.com` has **zero TXT records** — no SPF at all. Not fatal (SPF checks the
  envelope domain) but a root `v=spf1 -all` is worth adding.
- DMARC `rua` → `dmarc_rua@onsecureserver.net` (GoDaddy aggregator). Nobody reads it.

---

## 6. Smaller findings

- **DST**: `0 12 * * *` and `0 11 * * 1` are EDT-pinned. In November they silently shift
  an hour. Manual fix, easy to forget. `dispatchIntervalSummary` already demonstrates the
  fix: gate on ET hour *inside* the handler.
- **No idempotency key** on any Resend call — a retry would duplicate.
- **Sequential sends**: blocking `await fetch` + per-user D1 queries per recipient. Fine
  at 13; will strain cron CPU as the list grows. Resend has a batch endpoint.
- **Inconsistent pref defaults**: daily/weekly default ON with no prefs row; interval uses
  an INNER JOIN and defaults to nothing. 3 of 13 users have no prefs row.
- **`magic_links` is never purged** — 325 rows, unbounded, live OTP codes in plaintext.
  Nothing deletes expired sessions either (only explicit logout, worker.js:7926).

---

## Recommendations, prioritized

### P0 — restore the missing mail
1. ✅ **DONE (built + tested locally, NOT deployed).** Store-scoped daily email for
   managers — see "What shipped" below.
2. ⬜ **Unblock kevin@retjg.com** — verify the address, resend, confirm the response.
   Invited 2026-07-27, re-invited 07-29, still never signed in.

### P0 — stop the UI claiming otherwise
3. ✅ **DONE.** The weekly-digest toggle is now admin/superuser-gated
   (`notif-weekly-digest-row`), because the weekly digest is still chain-wide only. The
   daily toggle stays visible to everyone — it is now true for everyone.
4. ✅ **DONE.** "5 AM recap of all-store sales, vs last week & budget" →
   "8 AM recap of yesterday's sales for your stores, vs budget". The old copy was wrong
   on the hour, wrong on the scope, and named a "vs last week" column the email has never
   had.

### P1 — make failures visible
5. Write real status + error to `notification_log` in both email dispatchers (copy
   `sendEbayAlert`).
6. `.catch()` on the email crons, wired to `dispatchCronFailureAlert`.
7. Persist invite-email failures so "who never got their invite" is a query.

### P1 — retries
8. Retry Resend on 429/5xx, 3 attempts with backoff, plus an `Idempotency-Key` so a retry
   can't duplicate. Highest-value single change for transient failures.

### P2 — deliverability
9. `List-Unsubscribe` + `List-Unsubscribe-Post` and a real `reply_to` on bulk mail.
10. One consistent friendly From across all four senders.
11. Root SPF record; point DMARC `rua` somewhere it gets read.

### P2 — hygiene
12. DST-proof the crons by gating on ET hour inside the handler (needs a send-once guard,
    which an honest `notification_log` gives you).
13. Purge `magic_links` and expired sessions on the nightly cron.
14. Batch sends as the list grows.

---

## What shipped (2026-08-13) — built and tested, **not yet deployed**

**worker.js**

- `storeScopedRecipients()` — the exact complement of `chainWideRecipients()`. Kept as a
  separate function on purpose: `test-cron-recipients.js` extracts the latter from source
  and asserts no store-scoped user is on it, and both statements must stay true.
  Fails closed on three gates (`canSeeFinancials`, `canAccessBusiness('bl')`, non-empty
  `allowedStores`), and **logs** anyone dropped for a missing grant rather than dropping
  them in silence — the failure mode this whole change repairs.
- `dispatchScopedDailySummaries()` — bodies built **once per distinct store set**, not per
  recipient. The 8 prod managers share 6 sets. Logs the real send status
  (`sent` / `failed` / `skipped`) under event_type `daily-summary-scoped`.
- `buildDailySummaryData`, `buildDailyCategoryData`, `buildWeeklyByDayData` take an
  optional `scopeStores` (default null = every store), so existing callers are unchanged.
- `buildSummaryEmailHtml` takes `totalsLabel` + `scopeLabel`; `renderCategoryTableHtml`
  and `renderWeeklyBreakdownHtml` take `scopeLabel`.
- `dispatchDailySummary` reads notification prefs in **one unfiltered query** instead of
  an `IN (?,?,…)` built from the recipient list — D1 caps bound params at 100, so the old
  shape was a latent hard failure as the team grew.

**index.html** — weekly-digest row gated to admin/superuser; daily-summary copy corrected.

**scripts/test-scoped-daily-summary.mjs** (new, 47 assertions) — drives the real
`worker.scheduled({cron:'0 12 * * *'})` and asserts on captured Resend payloads. Verified
non-vacuous by mutation: disabling scoping kills 8 assertions, removing the financial gate
kills 2, unwiring the dispatch kills 8, reverting the header labels kills 5.

### A bug the tests missed and rendering caught

The first pass scoped every **number** correctly but left two **labels** hardcoded:
`Category Sales · All Stores` and `Daily Breakdown · All Stores` rendered above a single
manager's figures. The test missed it because it seeded `week = NULL`, so
`buildWeeklyByDayData` returned null and that table never rendered at all. Only building
the email from real prod rows and reading it surfaced the mislabel.

🔑 Lesson: a table that does not render cannot be asserted on. Seed the data that makes
every section appear, or the assertions pass against nothing.

### Verified against real production data (read-only)

Rendering 2026-08-12 through the real cron path:

| Recipient | Total | Footer | Section header |
|---|---|---|---|
| superuser (chain) | $22,591.43 | All Stores | · All Stores |
| BL1 manager | $5,815.89 | Total | · Coliseum |
| BL1+BL4 manager | $9,323.65 | My Stores | · My Stores |
| BL14 manager | $4,948.20 | Total | · Battle Creek |

Every figure ties to the raw `daily_sales` rows. Holland (closed, $0) is omitted. No
scoped body contains the string "All Stores" anywhere.
