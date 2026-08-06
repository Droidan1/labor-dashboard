# Slice 2b — the eBay Cases page

Branch `claude/ebay-cases-page`, off `origin/main` @ `255c3b9` (main == that commit exactly).
Worktree, per the `deploy-from-main-not-cwd` rule.

Plan doc: `tasks/ebay-case-handler.md`. Slices 1, 2a and 2b-data are already merged and
deployed (worker `d87ee9a5`) — **and inert**: `EBAY_HANDLER_TOKEN` does not exist and
migration-034 is unapplied, so both endpoints 401/return empty before touching a table.
This slice adds the page that draws the data, not the data.

## Scope decision (Brian, this session)

**"Page only, wire later."** Build and verify the page; leave *reachability* for a
follow-up. Not touched here: `businesses.unit_count` / the `connected` flag, the landing
card, migration to seed ecom units.

### Why reachability is a separate problem — found during review

`businessesFor()` derives `connected` from `unit_count > 0` (worker.js:5901) and
migration-031 seeds E-Commerce with **zero** `business_units`, deliberately.
`enterBusiness()` returns early on a non-connected business (index.html:16718) and is the
only way into a business. So E-Commerce cannot be entered today.

The naive fix is a bug: seeding units flips `connected`, and the landing card's connected
branch is hardcoded to `bargainLaneFigures()` (index.html:16925) — E-Commerce would render
**Bargain Lane's** net, pace and channel mix under its own name. Fixing that means giving
the card a third state, which is a landing-page change, not a Cases-page change.

## Build

- [ ] `#page-ebay-cases` markup — sticky header, account chips, alert rail, KPIs,
      two lists, recent-actions table.
- [ ] `nav-ebay-cases` sidebar item + `NAV_BUSINESS['nav-ebay-cases'] = 'ecom'`
      (first non-`bl` entry; `navBusinessAudit()` fails on an unmapped id).
- [ ] `applyRoleUI` — show it when the user actually holds E-Commerce, mirroring the
      worker's business gate rather than inventing a role rule while "what role does
      Meredith get" is still unanswered.
- [ ] `navigateToPage` — register `ebay-cases` in the `pages` array, guard it the same
      way, init hook.
- [ ] `dashboardPageFor('ecom')` → `ebay-cases` instead of bouncing to the picker.
- [ ] `initEbayCases()` + render module.
- [ ] `scripts/test-ebay-cases-page.mjs` — drives the real `worker.fetch`, then the real
      render functions.

## The five data facts the page must not get wrong

Each was measured off Raj's real files; each has a cheap wrong version.

1. **`effectiveMode` is null.** It is absent from the real state file — the endpoint
   returns null on purpose. Render "unknown", **never** guess. Both accounts read
   `mode:"live"` while `forcedShadow` holds them in shadow, so a page that guessed would
   be wrong in the most dangerous direction — claiming a bot is acting when it is not,
   or the reverse.
2. **Staleness is `last_successful_run_at`, never `last_run_at`.** The latter advances
   even on a run where every account failed to authenticate — exactly the run that must
   go red.
3. **Recompute hours-left from `respond_by`.** Handler's `_hoursLeft` is per-run scratch
   and drifts between runs.
4. **Never blend actionable + appeals into one figure.** `actionableAmount` excludes
   appeals because appeals are not money anyone can still save. 20 appeals vs 23
   actionable on live data.
5. **`buyer_comments` is buyer-supplied and arrives with raw HTML entities.** Decode then
   escape — escaping alone renders `&amp;amp;`, decoding alone is an XSS hole.

Plus: `title` is null on all 193 real cases → fall back to sku, then case id.
And a failed auto-act (`ok = 0`) is the loudest thing on the page — it means the last
safety net fired and missed.

## Review

All build items done. `index.html` only — no worker, no schema, no migration.

### Verified

`scripts/test-ebay-cases-page.mjs` — 43 assertions, driving BOTH real entry points: a
Handler-shaped payload in through `?action=ebay-handler-ingest`, out through
`?action=ebay-cases`. Nothing hand-inserted into D1.

**Mutation-checked**, because a passing suite proves nothing on its own:

| Mutation in worker.js | Result |
|---|---|
| `actionableAmount` sums all open rows (blends appeals) | 2 failures |
| `effectiveMode` falls back to `"LIVE"` | 2 failures |
| drop the `is_closed = 0` filter | 5 failures |
| staleness reads `last_run_at` | 2 failures |

Then the render, driven in the browser against the real functions with a Handler-shaped
fixture — not a restatement of them:

- `effectiveMode: null` → "Mode unknown", dashed pill. Never guesses.
- Staleness "9h" computed off `lastSuccessfulRunAt`.
- Failed auto-act banner renders **first**, above staleness.
- `$149.98` at stake vs `$41.58` "not recoverable" — separate tiles, separate labels.
- `title: null` → falls back to sku (`NAM-10`), then to case id (`Case 5002`).
- Urgency recomputed from `respond_by`: "30h past deadline", "4h left", "21d past deadline".
- **XSS**: `<img src=x onerror=alert(1)>` renders as literal text;
  `document.querySelectorAll('#page-ebay-cases img').length === 0`.
- **Entities**: `Wrong size &amp; late` displays as `Wrong size & late`, not `&amp;`.
- Account chips stay complete under filtering (the reason the page fetches unfiltered).

### 🔑 The sidebar diff owed from #143, now actually done

Measured, not argued, across four scenarios:

| Session | After `applyRoleUI` alone | After `applyBusinessNav` |
|---|---|---|
| superuser in **BL** | eBay Cases **visible** | eBay Cases **gone** — identical to main |
| superuser in **ECOM** | all BL items | only eBay Cases + Settings + Switch |
| BL-only admin in BL | no eBay Cases | no eBay Cases — identical to main |
| ecom-only manager | + marketing/supply (role) | only eBay Cases + Settings |

The first row is the finding: `applyRoleUI` alone **would** leak the item into Bargain
Lane's sidebar. It is `applyBusinessNav` that removes it, and `navigateToPage` calls it on
every navigation — so the ordering is load-bearing, not incidental. Anything that ever
calls `applyRoleUI` without a following `navigateToPage` reintroduces this.
`navBusinessAudit()` returns `[]`.

Full suite green (14/43/33/47/20 + 6 assert-style). `test-migration-029.js` errors, but it
takes a repo path in `process.argv[2]` and fails identically on pristine `origin/main`.

### Not verified

**Compiled CSS.** The committed `tailwind.css` is stale — `dark:bg-op-panel` is used 132×
in `index.html` and is absent from it — and the real build (`npx tailwindcss`) cannot run
here: no `node_modules`, no network. Every class I used is either an existing token
(`rounded-card`, `p-card`, `op-panel`, `opl-inkDimmer`, `accent-green`) or a bespoke `.eb-*`
rule defined inline in the page, and `tailwind.config.js` has `content: ['./index.html']`,
so they will compile. Screenshots above are against the stale sheet; **dark mode is
unverified**.

### Left alone deliberately

- `connected` / `unit_count`, the landing card, and any ecom `business_units` seed — the
  deferred reachability decision. **E-Commerce is still not enterable, so no user can reach
  this page yet.**
- Push alerts and the notification ledger. Still the blocking sequencing rule: they must be
  live **before** `forcedShadow` flips. This page displays `owner`/`last_notified_at` but
  writes neither.
- Case assignment, and any write path. The page is read-only.

### Next

1. The reachability decision (see top of this file) — one migration + a landing-card fix.
2. `EBAY_HANDLER_TOKEN` + `migration-034`, or the page renders its empty state forever.
3. Push alerts, then tell Raj to flip `forcedShadow=0`. Not before.
