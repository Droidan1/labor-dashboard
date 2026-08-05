# eBay Case Handler → RETJG HUB (2026-08-05)

**Status: SLICE 1 BUILT, PARKED.** Branch `claude/ebay-cases-ingest` (`fca518f`, off
`origin/main`) — ingest endpoint, D1 schema, 24 tests. **Not merged, not deployed,
`migration-034` unapplied, and `EBAY_HANDLER_TOKEN` does not exist yet.**
Held deliberately until Brian mints the token, so the first live POST can be
proven against **staging** rather than prod — no real POST has ever landed.

Still blocked on the same two decisions from Ryan/Brandon (below). Raj's side
remains built and waiting on us (`[Push] enabled=0`).

**The page is called "Cases"**, under the E-Commerce business — deliberately not
"Case Handler". Raj's bot is Handler; ours is the page. Naming ours after his
blurs the division of responsibility below, and "Cases" still reads correctly if
Amazon or Walmart cases ever arrive.

---

## What this is

Brandon Georges forwarded a thread on 2026-08-03. Shoes & Fashions' eBay account dropped
to **Below Standard**: 1.02% of cases closed by eBay instead of by us, against eBay's 0.30%
standard, ~3.4× over. eBay auto-killed the promoted listings campaigns, which drove most of
the traffic, and sales fell ~40% in two days. eBay re-evaluates on the 20th of each month.

**Rajat R** (`contact@rajat.pro`, external contractor) built "Handler" — a Node app on his
office PC that polls the eBay API every ~30 min across two accounts, classifies every open
case, and can auto-resolve one inside a narrow window. He asked where to host its dashboard.

**Decision: we ingest Handler's raw JSON and draw the page ourselves** — not an iframe of his
HTML. Raj has since removed the hosting path from his app entirely (`state/dashboard.html` is
still written to his disk each run, but there is no upload code, so a stale second copy cannot
appear).

## Division of responsibility (agreed with Raj)

| Handler (Raj) | RETJG HUB (us) |
|---|---|
| Polls eBay, classifies, auto-acts inside its window | The page, the alerting, the notification ledger |
| POSTs `state` + new `audit` lines each run | Staleness / dead-man's-switch detection |
| Owns thresholds + spend caps | Owns case assignment (`owner`) |

Raj has turned **off** his email digest (`digestTo=` empty, `suppressEmail=1`) and left
`owner`/`escalateTo` empty on both accounts. Notification is entirely ours.

## 🛑 The sequencing rule — do not get this backwards

**Push alerts must be live BEFORE `forcedShadow` flips.**

Both accounts read `mode=live` in the config and are held back *only* by `forcedShadow=true`.
The moment that flag flips, the bot acts at T-6h with **no human told before or after** —
Raj's email is off and our push does not exist. He tried to flip it on 2026-08-04 believing
our side was nearly ready; corrected, and he has agreed to wait for our explicit go.

Right now, nobody is being notified about these cases at all. Confirmed in the data:
`owner`, `lastNotifiedAt`, `notifiedVia` are null on all 194 records.

---

## The contract (agreed, not yet built)

```
POST https://api.retjghub.com/?action=ebay-handler-ingest
Header:  X-Handler-Token: <token>
Body:    { "state": {…handler-state.json verbatim…}, "audit": [ …lines since last 200… ] }
200   →  {"ok":true,"cases":N,"events":N}
```

- 🔑 **New dedicated secret. NOT `SNAPSHOT_SECRET`** — that one is hardcoded in the public
  client (`index.html:8871`) and gates 24 admin endpoints. An outside contractor gets a
  single-purpose, rotatable token.
- **Dedupe on `(ts, kind, account, caseType, caseId)` + a hash of the raw line.** Case IDs are
  only unique within `account::caseType`, and `run` lines carry no `caseId` at all. ⚠️ My first
  spec said `(ts, kind, caseId)`; **Raj's config still documents that narrower key at line 52**
  and needs correcting.
- Non-200 leaves his cursor untouched → next run re-sends. He also re-sends the whole audit
  file if it is ever rotated or truncated (detects shortening). Both make dedupe load-bearing.
- Upsert on the case key. Full snapshot every run, closed cases included.
- Volume: ~44 audit lines / ~11 KB per run; at 30-min polling ≈ 500 KB/day, ~15 MB/month.
- His client timeout is 60 s (`timeoutSeconds=60`); my spec said 30 s. Harmless, his is longer.

---

## Data model — measured from the live state file, 2026-08-04

**Top level:** `version`, `lastRunAt`, `lastSuccessfulRunAt`, `lastDigestSentAt`, `cases{}`,
`actionsByDay{}`, `accountStatus{}`, `itemCache{}`, `lastPush`.

- **Case key:** `account::caseType::caseId`. Stable across runs. `firstSeen`/`lastSeen` give
  change tracking free.
- **194 cases** — 41 open, 153 closed. Open by `_decision`: NEEDS_HUMAN 21, NOTIFY_OWNER 13,
  NUDGE_OWNER 7.
- **Staleness signal: use `lastSuccessfulRunAt`, not `lastRunAt`.** `lastRunAt` advances even
  on a run where every account failed to authenticate, which is exactly the case that must
  go red.
- **`effectiveMode` is the only mode field to read.** It folds per-account config, forced-shadow,
  and the global kill switch. Proven necessary: both accounts currently read `mode: "live"` with
  `forcedShadow: true`, so `effectiveMode: "SHADOW"`. Reading `mode` would have the page saying
  LIVE right now. `OFF` = kill switch, nothing is being polled.
- **Underscore fields are per-run scratch**, not persisted state: `_tier`, `_hoursLeft`,
  `_decision`, `_decisionReason`, `_changes`. Recompute hours from `respondByDate` — `_hoursLeft`
  drifts between runs. Confirmed by Raj.
- **Group by `_decision`, not `_tier`, and filter `isClosed` first.** Five closed cases still
  carry tier `ESCALATE` with `_decision: "NONE"` / "case is already closed".
- **`thresholds` ships in `accountStatus`** so our tiers can't drift from his when he tunes.
- **`title`/`sku`: 0 null of 194** (added at our request; resolved from the order, cached per
  line item in `itemCache`).
- **PII scope, verified:** `buyerUsername` and `buyerComments` only. `itemCache`'s 174 entries
  carry only `resolvedAt`/`title`/`sku`/`source` — the buyer name, email and address in the
  order lookup are discarded before caching. `buyerComments` arrives with raw HTML entities and
  is buyer-supplied → **escape on render**. Frequently null; don't assume a string.
- **Audit `kind`:** `run` (with `event: start|finish`), `decision`, `action`.
  ⚠️ **Zero `action` lines exist in production** (779 lines: 740 decision, 39 run). The Handler
  Actions surface would be built entirely against a synthetic sample.

### Decision & action vocabulary
`NEEDS_HUMAN` · `NOTIFY_OWNER` · `NUDGE_OWNER` · `NONE` — notify-only, no money moves.
`APPROVE_RETURN` · `ISSUE_REFUND` — the only two that call eBay. Refund is used **only** when
approving isn't available (typically item-not-received). Both carry an `amount`.

**Shadow-mode caveat:** in shadow the audit line is written with `dryRun: true` but the case
record is **not** marked `AUTO_ACTIONED`. Count `kind: "action"` entries and split on `dryRun`;
never infer from the case record alone.

---

## Findings worth not rediscovering

**1. 🔑 The escalation ladder never lands in business hours.**
All 194 deadlines fall at 06:59:59 or 07:00:00 UTC — eBay uses a fixed end-of-day boundary, so
every `respondByDate` is ~3am Eastern. Run the config against that: `autoActAtHours=6` fires at
~9pm ET, `escalateAtHours=24` fires at ~3am ET. Business hours are 8–17, Mon–Fri. **Both fixed
rungs land outside the workday every single time**, and a Monday deadline runs its whole ladder
on a Sunday. The assumption that a human gets a fair shot before the bot acts does not hold as
configured. Fix is to anchor the human-facing rungs to the last business hours before the
deadline, not to a fixed offset. Raised with Raj; needs Ryan.

**2. 🔑 "Past deadline" is not a preventable-loss number — it's the appeals backlog.**
Of the 41 open cases, **20 are `ebayState: ESCALATED` with `buyerCanEscalate: false`** — eBay
already owns the outcome, so they are appeal questions, not cases anyone can resolve. They sit
9–24 days past deadline. The genuinely actionable set is the other 21. **These must be two
separate lists in the UI**, or Meredith spends her morning on cases that cannot be saved. Raj
agrees; his dashboard sorted purely by urgency and did not distinguish them.

**3. `actionsByDay.amount` excludes approvals.** Sample shows `count: 2, amount: 41.58` from a
$38.50 `APPROVE_RETURN` + a $41.58 `ISSUE_REFUND`. Approvals *are* capped by count
(`globalMaxActionsPerDay=40`) but do not enter the dollar total. **Open question:** does
`maxRefundPerCase=150` gate approvals or only refunds? If only refunds, a $400 return can be
auto-approved while a $200 refund escalates. Not theoretical — 5 cases exceed $150, max $412.98
(nothing currently open is above $94.98). Never render "N actions, $X" as one figure.

**4. Per-account action cap is dead as configured.** `maxActionsPerDay=100` per account sits
above `globalMaxActionsPerDay=40` with two accounts, so the global always binds first.
(`maxRefundPerDay=1000` × 2 exactly equals `globalMaxRefundPerDay=2000` — coincident, never binds.)

---

## Open questions

### Blocking — Ryan / Brandon (asked 3×, unanswered)
- [ ] **Who gets a HUB login?** Meredith works these cases. Without an account this is a page
      for nobody. Kelli? Ryan? Brandon?
- [ ] **Who receives alerts, at which tier?** Does NUDGE (50% elapsed) warrant a phone buzz, or
      only OVERDUE? Push, email, or both? On the critical path — must ship before `forcedShadow`.
- [ ] **What role does Meredith get?** Current roles: superuser / admin / district_manager /
      manager. `admin` hands her the whole BL dashboard, inventory and user management. Likely
      needs a new role → ties to the multi-business question.
- [ ] **One-off, or the first tenant?** Brandon opened with "adding other companies."
      ✅ **De-risked as planned** — `business` is on all three tables in migration-034,
      default `'ecom'`. Also note the multi-business model went STRUCTURALLY COMPLETE in
      prod on 2026-08-05: `ecom` is a real business row, the landing picker renders it,
      grants are editable per business from the Users page, and access is gated
      fail-closed. Nothing structural blocks this now.

### Non-blocking — Raj
- [ ] **Auto-act failure behaviour.** Asked twice, still open. When Handler acts inside its window
      and eBay refuses: does it retry next run, and does it emit an `action` line with `ok: false`
      that reaches us? Every sample line is `ok: true` / `httpStatus: null` (stubbed call). A failed
      auto-act means the last safety net fired and missed → must be the loudest thing on the page.
- [ ] Does `maxRefundPerCase` gate approvals? (finding 3)
- [ ] Correct the stale dedupe key in his config comment (line 52).
- [ ] Confirm `owner`/`escalateTo` stay empty so there is one assignment source, not two.

---

## Build plan

### ✅ Slice 1 — ingest (built 2026-08-05, parked on `claude/ebay-cases-ingest`)

- [x] `?action=ebay-handler-ingest` — POST-only, token-gated, dedupe + upsert.
- [x] D1 schema `migration-034.sql`: `ebay_cases`, `ebay_actions`,
      `ebay_handler_state`. `business` column on all three, default `'ecom'`.
- [x] 24 assertions driving the real `worker.fetch`, shaped from the live state
      file. Mutation-tested 5/5 killed.
- [ ] **Brian: mint `EBAY_HANDLER_TOKEN`** (`wrangler secret put`, both envs) and
      hand it to Raj. Everything else is blocked on this.

🔑 **Two things learned building it that the spec above did not anticipate:**

1. **The endpoint sits ABOVE the auth gate**, self-gated on its own token.
   Handler has no session, so it would have 401'd at the session gate. The
   tempting fix — letting `X-Handler-Token` set `isAdminSecret` — would hand an
   external contractor all 24 admin endpoints, which is the exact thing the
   Security section forbids. Above the gate, the token reaches one handler.
2. **The business gate shipped after this doc was written** (2026-08-05,
   fail-closed: an unclassified action is REFUSED). Every routed action must be
   classified or it 403s. `ebay-handler-ingest` is listed as business-agnostic —
   not because it is, but because it returns before that gate, same as
   `auth-login`. A completeness test enumerates routed actions from source, so
   this cannot be forgotten for the Cases page's own endpoints.

⚠️ One mutation SURVIVED honestly: dropping the explicit unset-secret guard,
because `tok` already defaults to `""` so `"" !== undefined` still refuses. The
guard is belt-and-braces; it is not what holds the door.

### Remaining
- [ ] **Slice 2 — the Cases page.** ⚠️ Needs the sidebar to become BUSINESS-AWARE
      first: nav items are hardcoded Bargain Lane and toggled by role, not by
      business. `enterBusiness('ecom')` currently refuses because
      `dashboardPageFor('ecom')` has nowhere to send it — that stub is where this
      lands. Then: actionable vs appeals as two lists, account toggle,
      `effectiveMode` badge, staleness banner off `lastSuccessfulRunAt`. (~1–2 days)
- [ ] Push alerts + the notification ledger we now own. (~1 day)
- [ ] Staleness cron — the per-minute cron already exists; alert on age of last successful POST.
      This is why we declined healthchecks.io: same system draws the page and knows the data
      stopped, so "his machine died" and "the page is stale" are one alert. (~½ day)
- [ ] Tell Raj to flip `forcedShadow=0`. **Only after push is live.**

**~2½–3 days remaining** (Slice 1 done). Build in a fresh worktree off `origin/main` —
this repo is currently on `claude/flow-calendar-editor` with a dirty tree, and shipping
from the wrong branch has corrupted prod before (see `deploy-from-main-not-cwd` memory).

**Deploy order when the token exists:** merge → `migration-034` to STAGING → staging
worker → have Raj POST a real run at `api-staging.retjghub.com` → only then prod.

⚠️ **Integration is still unproven.** No real POST has ever landed; his client is tested
only against a local endpoint, and Slice 1's 24 assertions are a contract test against a
payload shaped from his state file — not proof the two sides agree. First live POST is
where the surprises will be, which is why it goes to staging first.

---

## 🛑 Security

- [ ] **Raj must rotate the eBay production `clientSecret`.** It was sent in plaintext in
      `handler.ini` (line 151, with `clientId`/`ruName` above it) and is now in Brian's inbox and
      Downloads. Flagged 2026-08-05. He handles the HUB token correctly — as a command that prints
      it, DPAPI-encrypted and machine-bound — so this is an oversight, not a pattern.
- Handler's state carries buyer usernames and comments. Authenticated endpoint only, never a
  public URL. Raj documented the same constraint in his config.
- 🔑 Do not give Raj `SNAPSHOT_SECRET` (see contract above).
- Related still-owed item: rotating the Clover tokens exposed in `wrangler.toml`
  (see `snapshot-secret-exposure` memory) — same class of mistake, unrelated incident.
