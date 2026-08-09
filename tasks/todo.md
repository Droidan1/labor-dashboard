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

---

# Reachability fix — DONE, and it is NOT the migration

Mapped with 8 agents (4 readers → 3 independent designs → 1 referee) before writing code.
**The premise I opened with was wrong, and the map is what caught it.**

## 🔑 Reachability was never gated on units

`enterBusiness()` is blocked by `if (!b || !b.connected) return;` — and `connected` is the
server's answer to *"does this business's SOURCE SYSTEM have active units"*
(worker.js:5901), being read as *"does this app have a screen for this business"*. Those are
different questions and E-Commerce's honest answers differ: no sales feed, real Cases page.

Seeding `business_units` would have forced the first boolean true to get the second — fixing
today's symptom by widening tomorrow's bug, and dragging in every blocker below. **So there
is no migration.** The fix splits the overloaded flag:

```js
function businessHasSurface(id) { return dashboardPageFor(id) !== 'landing'; }
```

Derived from the page map, so a business becomes enterable exactly when it gains a front
door — no second flag, no schema change, no deploy-order hazard. Every existing assertion
(`E-Commerce is NOT connected`, `has 0 units`, `ecom exposes no units yet`) stays green
**and stays true**.

## 🛑 Two live defects in 98449d0, found by the map and reproduced before fixing

Both were dormant only because `enterBusiness` bailed early — my own Slice 2b work armed them.

1. **`applyBusinessNav` only ever ADDED `hidden`**, and `applyRoleUI` — its only un-hider —
   runs exactly once, at boot. Measured: entering E-Commerce and returning to Bargain Lane
   left BL's whole sidebar hidden. Only Settings and Switch business survived. No Dashboard,
   no Retail Summary, no Users, no Admin Settings, until a hard reload.
2. **The boot router is `if (landing !== 'dashboard') navigateToPage(landing, false)`**, and
   `applyBusinessNav` is reachable only from `navigateToPage`/`enterBusiness` — so it never
   ran at boot for anyone landing on the dashboard. Measured: a superuser sticky on Bargain
   Lane saw the **eBay Cases item in Bargain Lane's sidebar**.

⚠️ **My earlier sidebar check missed both because it re-ran `applyRoleUI` before each
switch — it reset the very state it was measuring.** The lesson is in
`scripts/test-nav-registry.mjs`'s header so the next harness pins it.

Fix keeps the original one-way invariant literally: `bizhid` is stamped ONLY on an item that
was visible when we hid it, so a ROLE-hidden item is never marked and can never be revealed.
Verified: `nav-users` hidden by role stays hidden across business round trips.

## Also fixed — each one activated by making entry work

- **`landingPageFor` returned the literal `'dashboard'` for any single-business user**, so
  the first E-Commerce-only account would have booted onto Bargain Lane's dashboard, a page
  it holds no grant for. Now `dashboardPageFor(biz[0].id)`. Verified: routes to `ebay-cases`.
- **The landing card printed Bargain Lane's figures for any connected business** — `fig` is
  bound once outside the loop and interpolated unconditionally, down to
  `lpTile(b.unitNoun + 's', String(fig.storeCount))` reading "storefronts / 6". Replaced
  `connected` with a per-business `FIGURES` registry; the money block now reads `f.*`, and
  `chOf(f)` gives it its own channel mix. A business with no entry prints no numbers.
- **The hero said "N of M reporting" counting connected businesses.** Now counts businesses
  that actually contribute to the total — "1 of 2", which is the honest number.
- **Mobile had no E-Commerce navigation at all** (every bottom-bar tab is Bargain Lane's).
  Added the More-sheet row, its sidebar-mirroring gate, and `morePages['ebay-cases']`.
- **`gate('bn-submit-photos', mgrBar)`** read role without the sidebar mirror every other tab
  uses, so a non-admin inside E-Commerce got Bargain Lane's centred Submit Photos button.
- **Swipe-back assumed Bargain Lane's dashboard is everyone's home** — the back rail never
  appeared inside E-Commerce, and an exhausted back stack threw you across the business
  boundary. Now `homePage()` derives it from the active business.
- `sw.js` cache `v66 → v67`, so installed PWAs pick up the new shell.

## Verified

`scripts/test-nav-registry.mjs`, 17 assertions, mutation-checked 5 ways (unclassified nav
id, typo'd business id, front door missing from the `pages` array, a More-sheet gate
mirroring a nonexistent nav id, a registry orphan) — all killed. It finally gives
`navBusinessAudit()`'s rule a caller.

Full journey driven in a real browser through the actual boot path (`checkAuth` → real
`applyRoleUI` → `landingPageFor` → `renderLanding`), **without re-running `applyRoleUI`
between switches**:

picker → Enter E-Commerce → eBay Cases, `activeBusiness='ecom'`, sidebar = eBay Cases only,
More-sheet row visible → Switch business → picker → Enter Bargain Lane → **full BL sidebar
restored** → repeats stably. E-Commerce's card contains zero dollar figures; Bargain Lane's
still shows its money. An E-Commerce-only account routes to `ebay-cases`.

Full suite green (14/43/33/47/20/17 + 6 assert-style).

## 🛑 Still NOT reachable in production, by prerequisite

Everything above is client-side. Before the Enter button should ship:
**migration-034 applied, `EBAY_HANDLER_TOKEN` set, and one real ingest landed.** Otherwise
`?action=ebay-cases` fails and the page renders its red error banner — an error screen, not
a feature.

## Deliberately not changed

- **No migration, no `business_units` rows.** See above.
- **`?action=ebay-cases` does no unit-level scoping** — it filters on `business='ecom'` plus
  a *caller-supplied* `&account=`. Harmless today (every ecom grant has `units NULL`), but it
  is why seeding units is not a free action: the Users page would start offering
  "restrict to one eBay account" while the endpoint ignores it, and those rows carry
  `buyer_username`/`buyer_comments`. A control that looks enforced and is not is worse than
  no control. Fix the endpoint **before** any unit seeding.
- **`set-user-grants` uppercases submitted unit codes** while `ebay_cases.account` is stored
  verbatim from Handler — so `'shoes'` would be saved as `'SHOES'` and never match. Same
  prerequisite.
- **No client DOM test harness.** No `node_modules` and no network here, so jsdom could not
  be added or tried. All routing above is verified by hand in a browser, not in CI. This is
  the largest remaining risk and the honest follow-up.

---

# Unit scoping on `?action=ebay-cases` — DONE

The business gate decides WHETHER you reach E-Commerce. This is the separate question of
WHICH storefronts inside it, and the answer used to be "all of them".

## What was wrong

`?action=ebay-cases` filtered on `business = 'ecom'` plus a **caller-supplied** `&account=`.
A scoped user who simply omitted that parameter received every account's rows — including
`buyer_username` and `buyer_comments`, the two columns migration-034 records as the verified
PII scope. A query parameter the caller chooses had been standing in for a boundary.

## Changes (worker.js only)

1. **`?action=ebay-cases` scopes to granted storefronts.** `allowedUnits(currentUser,'ecom')`
   → `scopeSql`/`scopeBinds`, applied to the `ebay_cases` query **and** the `ebay_actions`
   query. Empty grant → ` AND 1 = 0` (nothing, not everything; `IN ()` is a syntax error and
   one code path means the response shape cannot drift). >50 units → 500 rather than a
   truncated list, since D1 caps bound params at 100 and a silently shortened `IN` would hide
   cases from someone entitled to them.
2. **`handler.account_status` scoped.** 🛑 Found AFTER the test was green — see below.
3. **`allowedUnits`: NULL units = every unit, for non-`bl` businesses.** That is what
   `set-user-grants` writes for "no restriction" and what migration-030's schema declares.
   ⚠️ **Bargain Lane keeps its legacy NULL-means-nothing reading** — its grants were
   backfilled from `users.stores`, where NULL meant "never scoped", and
   `test-cron-recipients.js` pins that an executive is excluded rather than assumed
   chain-wide. Widening that decides who receives chain-wide revenue by email; not a side
   effect of scoping another business.
4. **`loadGrants` fails CLOSED on unparseable units JSON** (`[]`, not `null`). Now that
   `null` means "every unit", parsing garbage into it would widen access on precisely the
   input we understand least.
5. **`set-user-grants` no longer uppercases unit codes.** They are compared verbatim against
   `ebay_cases.account`, which Handler writes lowercase — `'shoes'` became `'SHOES'` and
   matched nothing. Membership validation is unchanged and is the real check.

## 🔑 The `account_status` leak, and why the test missed it

`ebay_handler_state.account_status` is a JSON blob **keyed by account**, carrying each
storefront's poll health. Scoping the two row queries left it whole: a manager scoped to
`shoes` still learned that `fashion` exists, that it had 7 queue errors, and that its last
fetch failed.

**The scoping test was green when this was true.** Its blanket assertion
`!body.includes('fashion')` was **vacuous** — the fixture sent `accountStatus: {}`, so the
field that leaks was never populated. A throwaway probe using the real payload shape found
it in about a minute. Fixture is now populated and there is a dedicated assertion on the
parsed keys.

⚠️ **Lesson: never leave a fixture empty for a field an absence-assertion is watching.**
A blanket "this string appears nowhere" check is only as strong as the fixture behind it.

## Verified

`scripts/test-ebay-cases-scope.mjs` — 39 assertions through the REAL ingest → read round
trip. 🔑 Every scoped case uses a **`manager`**: `allowedUnits` short-circuits to "every
unit" for admin *and* superuser, so a test written with an admin passes vacuously. There is
an explicit assertion pinning that short-circuit so it cannot change silently.

Mutation-checked 10 ways — cases query unscoped, actions query unscoped, `account_status`
unscoped, empty units failing open, corrupt JSON failing open, NULL-semantics reversed,
`toUpperCase` restored, and `allow` forced to null (trusting `&account=` as the boundary).
All killed. The `account_status` mutation was re-run with checksums after a first attempt
produced output inconsistent with a one-line change; the clean run differs by exactly 2
lines and fails exactly 2 assertions.

Also confirmed by hand: `ebay-cases` and the token-gated ingest are the **only** readers of
these tables, and the `scheduled()` path does not touch them — so the "cron bypasses request
gates" trap does not apply here.

Full suite green (14/43/39/33/47/20/17 + 6 assert-style), including every test pinning
Bargain Lane's legacy grant behaviour.

## Still not changed

- **No `business_units` rows for ecom.** Enforcement now exists ahead of the data, which is
  the right order — the endpoint will honour units the moment any exist.
- `effectiveMode` is derived across all accounts (worst-case wins) and is still returned
  whole. It is business-level operational state, not per-account data.

---

# Test infrastructure: the suite that never ran

## The bug

`scripts/test-migration-029.js` had `const REPO = process.argv[2];` with no `|| '.'`
fallback — the one file out of 21 missing it. Run with no argument (which is how the suite
is run), `REPO` was `undefined` and the first `path.join` threw before a single assertion.
The suite had been contributing **zero** coverage while appearing in the suite list. Not a
regression; it fails identically on a clean checkout of main.

Migrations live in the **repo root**, not `./migrations/`. Fixed by matching the sibling
convention exactly: `process.argv[2] || '.'` — used by all 8 other argv-taking suites.

## The assertions pass — migration-029 is sound

18/18, and load-bearing, not vacuous. Mutation-checked: deleting the four restore
`INSERT`s from `migration-029.sql` (leaving the snapshots, so `DROP TABLE users` fires the
cascade and nothing puts the rows back) fails exactly the four cascade assertions —
`sessions 2 → 0`, `push 1 → 0`, `prefs 1 → 0`, `supply 1 → 0` — and exits 1. The migration
file was restored and verified byte-clean against git.

## One latent vacuous pass, inside 029 itself

Lines 103–105 were `if (extras.push) ok(...)` — a seed failure silently **deleted** three
of the suite's assertions and it still printed "all assertions passed" and exited 0. Those
three are the whole point of the file. Added one assertion pinning that all three
cascade-target tables actually seeded, so a skip is now a failure. No assertion weakened.

## Audit of the other 20 suites

None crash and none pass vacuously. Every collection-derived assertion count already has
an emptiness guard: `test-business-gate.mjs` asserts `routed.length > 100`,
`test-nav-registry.mjs` asserts `!!navBizBlock` and `registry >= 10`, and
`test-financial-gate.js`'s ratio check fails loudly at zero rather than skipping. Every
`grab()` source-extraction helper `process.exit(1)`s on a missed match. All files the
suites read exist.

⚠️ **Lesson: a defensive `if` around an assertion is a silent assertion-deleter.**
Guard the precondition with its own assertion instead — a skipped check must be as loud as
a failed one.

## `npm test` now exists — and the old loop was worse than it looked

`scripts/test.sh`, wired to `npm test`. The ad-hoc
`for f in scripts/test-*; do node "$f"; done` exits with the **last** suite's status, so a
failure in any earlier suite was swallowed entirely — measured: a hard-failing first suite
followed by a passing last suite exits **0**.

The runner fails on a non-zero exit *and* on a suite that exits 0 having asserted nothing —
the exact shape 029 had. Both paths verified with synthetic suites: a crasher reproducing
the `REPO` bug is caught with its stack trace, and a suite looping over an empty array
while printing "all assertions passed" is caught as EMPTY. Both drive the exit code to 1.

## Verified

512 assertions across 21 suites, all green. Test-infrastructure only — no worker, client,
migration or schema change, and nothing deployed.
