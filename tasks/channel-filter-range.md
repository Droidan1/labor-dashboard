# Channel filter (Retail / BIN) — make it follow the selected range

Reported: tapping **Retail** or **BIN** on a store card no longer changes the
Cart / Items / Orders / ASP tiles. Screenshot showed a "YESTERDAY NET" card.

## Findings

### Bug 1 — reported: store-card tiles inert off-today

`index.html` picked `chTile` (has `onclick`) vs `tile` (inert markup) on
`isTodayOnly = dateRange.presetId === 'today'`. On a Yesterday view the tiles
rendered with no handler at all — nothing to click.

Introduced deliberately by `b936be5` (Jun 4): `loadCardChannel` hardcoded today
with no `&date=`, so a tap on a past day would have swapped the matrix to
*today's* split beside that day's dollars. The gate froze the symptom.

### Bug 2 — found during review, live in prod: the hero had that exact mismatch

`b936be5`'s message says *"The hero strip is always 'today,' so it's unaffected."*
The code disagrees. `todayRetail` / `todayBin` are summed from `storeHist`
filtered by the **selected range** (index.html ~5078) — the names are vestigial.
But the hero tiles were *unconditionally* clickable and `loadDashChannel` always
fetched today.

So on a Yesterday view, tapping hero Retail showed **today's** cart/items/ASP
next to **yesterday's** dollars. No error, just the wrong period. Also, the
`dash-matrix-label` read "Matrix · Today" on every range.

🔑 The lesson: `b936be5` fixed the two surfaces asymmetrically — one frozen, one
left broken — because the commit reasoned about the hero from its variable names
instead of its data flow. Same bug, opposite treatments, and the message asserted
the wrong one confidently.

### The premise that justified the gate no longer held

`?action=items` accepts `&date=` and serves the KV snapshot; those snapshots
carry `channels` (added `37d310b`, Jun 3). Verified against prod KV rather than
assumed:

    items:bl1:2026-08-09 → retail { net 5954.39, units 1269, orders 229 }
                           bin    { net 4448.00, units 1484, orders 213 }

`bin.net` 4448 is exactly the $4,448.00 on the card in the bug report.

## What changed

**worker.js** — new read-only action:

    ?action=channel-range&store=BL1&from=YYYY-MM-DD&to=YYYY-MM-DD

Reads `items:<store>:<date>` across the range and returns **raw sums** of
`channels.{retail,bin}.{net,units,orders}`. Follows the `item-l2-totals` idiom
including its 366-day cap. Gated by `canAccessStore`; registered
`["channel-range", "bl"]` in `ACTION_BUSINESS` (fail-closed — unregistered is a
403). No Clover call, no write.

One request per tap regardless of range length: a 12-month range is 366 KV reads
in the worker, versus 366 browser round-trips if the client looped.

**index.html**

- `isTodayOnly` gone; the tiles are clickable on every range.
- Both surfaces now share `fetchStoreChannels()` — `channel-range` for the past
  portion + the live `?action=items` for today when the range includes it,
  mirroring how the cards already blend stored + live dollars.
- Caches re-keyed by **range** (`from..to[+live]`), not by single date.
- `ensureDashChannel` / `ensureCardChannel` — a range change with a filter still
  active refetches instead of showing the previous range's split. **This was a
  bug in the first draft of this very fix:** `applyDashChannel()` alone would
  have left the hero tiles on "—" permanently after any range change.
- In-flight range key per surface, so renders (frequent) don't each spawn a
  fetch, and a slow load for an old range can't clobber a newer one.
- 🔑 `chDerive` re-derives averages from **summed** totals. Averaging the per-day
  averages weights a quiet Tuesday like a busy Saturday.
- Label tracks the range instead of always saying "Today".

**sw.js** — `CACHE_NAME` v68 → v69 so installed PWAs pick the new index.html up.

## Verified

`scripts/test-channel-range.mjs` — **27 assertions**, driving the real
`worker.fetch`.

**Mutation-checked**, because a green suite proves nothing on its own:

| Mutation | Result |
|---|---|
| sums overwritten instead of accumulated (`+=` → `=`) | 4 failures |
| `canAccessStore` check removed (6 → 5 occurrences) | 1 failure — "a BL1 manager is refused BL2, got 200" |
| `["channel-range","bl"]` removed from `ACTION_BUSINESS` | everything 403s |
| 366-day cap removed | 1 failure |
| `isTodayOnly` gate reintroduced in index.html | 1 failure |

⚠️ The cap mutation **first appeared to survive**. It had not applied: a
non-global `perl -0pi -e s///` replaced the *first* `dates.length > 366` in the
file, which belongs to `item-l2-totals`, ~270 lines earlier. Confirming the
occurrence count changed *in the right region* is what caught it. A mutation that
fails to mutate reports PASS — exactly the trap in
`tests-must-drive-real-entrypoints`.

**Real production data** — five real BL1 snapshots (Aug 5–9) pulled from prod KV
and driven through the real `worker.fetch`, checked against an independent
hand-computation from the same files:

    RETAIL  net $29,352.32  units 7,740  orders 1,212   ✓ match
    BIN     net $13,958.10  units 4,005  orders   665   ✓ match
    days 5/5   (Aug 6 had zero bin sales — contributes nothing, skews nothing)

Aug 6's closed-bin day is the case the sums handle and an average-of-averages
would not.

`scripts/test-request-scoping.mjs` — extended per this repo's standing rule that
a new store-scoped endpoint gets a case there, not only in its own file:
`channel-range` added to the financial-gate loop (staff → 403) and to the
per-store refusal loop (BL1 manager refused BL2/BL8, allowed BL1).

**Full suite: 22 suites, all green, zero non-zero exits.** Run individually —
`npm test` / `scripts/test.sh` are on branch `claude/sweet-heyrovsky-69ede1`
(PR #152) and have **not** been merged to main, contrary to what the memory note
claimed; that note is now corrected.

Syntax: `worker.js` parses as ESM; all 4 `index.html` script blocks parse.

A `cachedFetch` failure is swallowed per-channel (`.catch(() => {})`) and
`cachedFetch` never caches a non-ok response, so a worker that does not yet know
this action degrades to a zero contribution rather than an exception.

## NOT verified — needs a deploy

The **browser round-trip**. `WORKER_BASE` is hardcoded to prod
`api.retjghub.com`, and `?action=channel-range` does not exist there yet, so the
client path cannot be exercised locally. Staging KV holds no `items:` snapshots
for BL1 (checked — zero keys under `items:bl1:2026-08`), so staging would answer
with zeroes unless seeded.

## Deploy order

🔑 **Worker first, then frontend.** The new frontend calls an action the old
worker does not have; the old frontend never calls it. Derived from which side
stops being backward-compatible, not from last time.

## Deploy record — worker SHIPPED 2026-08-10

Branch `claude/channel-filter-range`, commit `285f941` (branched off `main`
`6ff5d8f`, which equalled `origin/main` exactly).

Pre-flight, run in the SAME shell as the deploy: cwd asserted, branch asserted,
`worker.js`/`wrangler.toml` clean, and the diff vs `origin/main` asserted at
**exactly +68/−0** — a non-zero deletion count would mean a revert. Five recent
feature symbols confirmed present (`fallbackItems`, `rebuildItemSnapshot`,
`canAccessBusiness`, `requireAdminAccess`, `chainWideRecipients`).
`wrangler.toml` byte-identical to `origin/main`.

**Version `2c63c7ee-e4ba-4f7d-b3c3-0993de7a2bd8`, at 100% rollout.** Printed
bindings eyeballed per the wrangler.toml trap: prod KV `8f6062a7…`,
`labor-dashboard-db`, `bl-marketing-media`, `BL16_MERCHANT_ID`, and all six
crons (`55 3`, `* * * * *`, `0 12`, `0 11 * * 1`, `0 * * * *`, `30 10`).

**Deployed-artifact check** — pulled the live bundle back from Cloudflare:
`["channel-range","bl"]` present in `ACTION_BUSINESS`, the route present, both
input guards present. Control: `fallbackItems` ×12 in the same bundle, proving
it is a real current build and not a stale or partial artifact.

🛑 **An unauthenticated probe proves NOTHING here** and was not counted as
evidence: `?action=channel-range` and `?action=definitely-not-a-real-action-xyz`
both return the identical `401 NO_SESSION`, because the auth gate fires before
routing. This is the masked-probe trap from [[admin-endpoint-hardening]]; the
bundle inspection is what actually establishes the deploy.

### Still owed

- **Authenticated round-trip + the click path.** Blocked: needs a logged-in
  session, and the frontend is deliberately not deployed yet.
- ⚠️ **Prod worker is now AHEAD of `main`.** Per [[deploy-from-main-not-cwd]] the
  divergence is itself the hazard — a later `main`-based deploy silently reverts
  this. Merge the same session.
