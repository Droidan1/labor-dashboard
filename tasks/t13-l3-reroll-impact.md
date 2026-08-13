# T13 L3 rollout — predicted impact of the week-summary re-roll

Generated 2026-08-13, **before** running anything against production. Prod KV was
read but never written.

## Why a re-roll is needed

`week-summary:` KV values carry no `l3Qty` / `l3Net` (verified: all 84 stored keys
lack them), and `?action=weekly-t13` only live-builds on a *total* miss — an
L3-less summary yields an empty L3 map, not a rebuild. So T13 renders L2-only
until the trailing 13 weeks are re-rolled via Settings → **Rebuild Week Summaries**.

The re-roll re-aggregates the existing `items:<store>:<date>` snapshots. It does
**not** re-pull Clover, so it is not a backfill and carries no refund-loss risk.
It does overwrite stored history, which is why it needs explicit sign-off.

## How this was measured

- **BEFORE** — the 84 `week-summary:` values live in prod KV, read 2026-08-13.
- **AFTER** — the real `?action=rebuild-week-summaries` run through
  `scripts/lib/worker-harness.mjs` against the same 561 production `items:`
  snapshots. Same code path production will take.

`Auction` is excluded throughout: it is a synthetic row injected from
`D1.auction`, which the harness fixture sets to 0. Auction data is not changing,
so it cannot move.

## Result — the L2 shift is small and one-sided

| | |
|---|---|
| Stored entries that change | **26 of 84** |
| Chain net before | $2,667,519.71 |
| Chain net after | $2,675,563.57 |
| **Change** | **+$8,043.86 (+0.302%)** |
| Entries moving ≥ $1,000 | **1** |
| Entries moving < $500 | 25 |
| Entries created (no stored value yet) | 7 |

Almost all of the movement is one week at one store:

### Wk 21 · Coliseum — +$6,265.80 (rolled 2026-05-28)

| Category | Before | After | Change |
|---|---:|---:|---:|
| Softline - Apparel | $10,507.21 | $12,105.67 | +$1,598.46 |
| Consumable Food | $7,394.26 | $8,566.62 | +$1,172.36 |
| Softline - Shoes | $6,266.96 | $7,381.85 | +$1,114.89 |
| Consumable HBA | $2,789.63 | $3,435.37 | +$645.74 |
| Home | $4,016.97 | $4,537.17 | +$520.20 |
| *…8 more categories* | | | |

Units +1,765. Every category **gains** — the signature of a week whose summary
was rolled before its snapshots were complete, then repaired afterwards. The
re-roll moves the stored figure onto the repaired data.

Everything else is rounding-scale: the next largest is +$216.50, and 25 of the
26 changes are under $500. No entry loses more than $47.75.

## Full list of changes

| Wk | Store | Rolled | Net before | Net after | Change | Units |
|---:|---|---|---:|---:|---:|---:|
| 21 | Coliseum | 2026-05-28 | $66,321.18 | $72,586.98 | +$6,265.80 | +1,765 |
| 22 | Coliseum | 2026-06-04 | $64,858.50 | $65,075.00 | +$216.50 | -1 |
| 27 | Coliseum | 2026-07-07 | $57,868.53 | $58,084.53 | +$216.00 | 0 |
| 27 | Indy East | 2026-07-07 | $43,658.40 | $43,872.81 | +$214.41 | 0 |
| 30 | Coliseum | 2026-07-28 | $61,894.88 | $62,083.63 | +$188.75 | 0 |
| 24 | Coliseum | 2026-06-30 | $68,681.77 | $68,861.32 | +$179.55 | 0 |
| 29 | Coliseum | 2026-07-21 | $65,063.18 | $65,182.47 | +$119.29 | 0 |
| 23 | Coliseum | 2026-06-30 | $69,966.87 | $70,085.32 | +$118.45 | 0 |
| 25 | Indy East | 2026-06-30 | $33,156.60 | $33,272.16 | +$115.56 | 0 |
| 25 | Dupont | 2026-06-30 | $27,765.50 | $27,862.55 | +$97.05 | 0 |
| 28 | Battle Creek | 2026-07-14 | $31,539.35 | $31,596.35 | +$57.00 | 0 |
| 30 | Dupont | 2026-07-28 | $27,296.67 | $27,348.67 | +$52.00 | 0 |
| 21 | Dupont | 2026-05-28 | $29,163.88 | $29,116.13 | **-$47.75** | -1 |
| 25 | Coliseum | 2026-06-30 | $69,343.51 | $69,390.51 | +$47.00 | 0 |
| 28 | Coliseum | 2026-07-14 | $59,694.55 | $59,738.05 | +$43.50 | -3 |
| 28 | Dupont | 2026-07-14 | $24,149.41 | $24,189.41 | +$40.00 | 0 |
| 26 | Coliseum | 2026-06-30 | $60,748.06 | $60,778.91 | +$30.85 | 0 |
| 29 | Indy East | 2026-07-21 | $32,713.69 | $32,735.69 | +$22.00 | 0 |
| 24 | Holland | 2026-06-30 | $27,499.06 | $27,514.96 | +$15.90 | 0 |
| 26 | Indy East | 2026-06-30 | $53,517.42 | $53,531.42 | +$14.00 | 0 |
| 24 | Dupont | 2026-06-30 | $26,704.08 | $26,715.58 | +$11.50 | 0 |
| 27 | Dupont | 2026-07-07 | $25,777.78 | $25,786.28 | +$8.50 | 0 |
| 23 | Dupont | 2026-06-30 | $29,248.02 | $29,255.52 | +$7.50 | 0 |
| 26 | Dupont | 2026-06-30 | $26,576.45 | $26,581.45 | +$5.00 | 0 |
| 29 | Dupont | 2026-07-21 | $25,785.43 | $25,788.93 | +$3.50 | 0 |
| 22 | Dupont | 2026-06-01 | $25,638.90 | $25,640.90 | +$2.00 | 0 |

The other 58 stored entries are byte-identical on L2 and only gain L3.

## A bug this report caught

The first run of this comparison showed **BL12 (Wyoming) never changing and never
gaining L3**. Cause: `?action=rebuild-week-summaries` iterated `ALL_STORES`, which
is the six *operating* stores — but T13 charts `WRS_STORES`, which adds closed
Wyoming. BL12 is the **live** store for every week before the 2026-06-14 cutover
(Wk 21–24 here, $30.9k / $20.2k / $7.4k / $5.9k of real net).

Left alone, BL12's L2 numbers would keep being charted while its L3 stayed empty,
so on Wk 21–24 the combined card's L3 rows would silently stop summing to their L2
parent — the one invariant the feature rests on.

Fixed: the rebuild now covers `WRS_STORES`, in batches of 6 (each store costs 8
concurrent subrequests and Cloudflare caps that at 50; 7 at once would be 56).
Pinned by `scripts/test-t13-l3.mjs`, which fails if the list reverts to
`ALL_STORES`.

## Correction to an earlier estimate

An earlier figure of "BL12 Wk 21 ≈ $16.7k drift" was wrong. It came from summing
per-category *absolute* differences rather than comparing a real rebuild, and it
double-counted stores the gate zeroes. The measured worst case is **Wk 21
Coliseum, +$6,265.80**, and BL12's stored entries do not move at all — its
history is frozen.

## Shipped 2026-08-13 — one step left

- **Worker** — deployed from `main`, version `6766d6ab-9e70-4781-bd88-34d208d5bda0`, 100%.
  Bindings and all 6 crons re-verified on the deploy output. Three consecutive clean
  passes against prod (structured 401, not a 500; `auth-me` 200).
- **Frontend** — `main` `452746a`, Pages run `31750492068` green, and the live site
  verified by content: `sw.js` at `v77`, and `toggleT13AllL2` / `sumPerStoreL3` /
  `perStoreL3Units` / `l3RowsFor` / `t13ExpandedL2` / `Other / unmapped` all present in
  the served `index.html`, with pre-existing markers intact (not a partial tree).
- 🛑 **The re-roll has NOT run.** `?action=rebuild-week-summaries` is a POST, and
  `requireAdminAccess` requires `role === "superuser"` or the `X-Snapshot-Secret` header
  for any mutating method. Neither is available outside a signed-in browser session, so
  this step must be done by a superuser from **Settings → Rebuild Week Summaries**.

**Current state is clean and looks exactly like it did before.** All 84 non-gated
(store, week) entries have a stored, L3-less summary, so `perStoreL3*` comes back empty
and T13 renders no chevrons and no L3 rows. The 7 entries with no stored summary are
precisely the gated store-weeks (BL16 pre-cutover, BL12 post-cutover), which are zeroed
before KV is ever read — so nothing live-builds and nothing renders half-populated.

⏰ **That stops being true at 03:55 UTC (11:55 PM ET) tonight.** The daily snapshot cron
calls `rollupWeekSummariesIfReady`, which rewrites the *current* week only — so week 33
would gain L3 while weeks 21–32 stay without it. T13 would then show expandable rows whose
children are populated in the newest column and zero everywhere else, not summing to their
parent. Running the re-roll before then avoids that window entirely; running it afterwards
fixes it just the same.

## 2026-08-13 22:4x — first rebuild click wrote nothing, and why

Brian clicked **Rebuild Week Summaries**. Five KV reads over ~5 minutes — far past the
~60 s read-after-write window — all returned the same thing: 84 of 91 entries present,
**0 carrying `l3Qty`**, newest `snapshotTime` still `2026-08-13T03:57:49` (that morning's
cron). Checked the weeks the old query would actually have selected too: also untouched,
newest stamp there `2026-07-27`. So nothing was written anywhere.

**Nothing destructive ran.** `daily_sales` shows no historical re-snapshot — only 5 rows
for today at 22:58 UTC, which is normal live updating. No Clover re-pull was triggered.

Investigating turned up a real, pre-existing defect that would have made the click useless
even if it had reached the write path:

```sql
SELECT DISTINCT week FROM daily_sales WHERE date LIKE ? ORDER BY week DESC LIMIT 13
```

Wrong twice over:

1. **`week` is TEXT**, so `DESC` sorts lexicographically — `'9'` above `'52'` above `'33'`.
2. **`daily_sales` holds FUTURE rows**, because budget and labour land ahead of sales. On
   2026-08-13 it already contained every week out to **52 (2026-12-26)**, 49 rows each.

Run against production, that query returns

```
['9','8','7','6','52','51','50','5','49','48','47','46','45']
```

— not one of the 13 weeks T13 charts. The button says "re-rolls the trailing 13 weeks" and
would have reported success having rebuilt weeks nobody looks at. Casting to INTEGER would
not have helped either: that just picks 52…40, all future.

**Fixed** in worker `0154e2a7-ddc7-4c2e-a715-1d0a68d9f39b`: anchor on `MIN(date)` the way
`?action=weekly-t13` already does, cap at today (or an explicit `&end=`), and give each week
its own year from its start date so the KV key matches what `weekly-t13` reads back. The
response now returns `weekLabels` so a caller can see what was rebuilt instead of trusting a
bare count. `scripts/test-t13-l3.mjs` seeds all three hazards — a low week that sorts high as
text, plus future weeks that sort high as text *and* as integers — and fails if the old query
returns.

⚠️ **Still unexplained: why the click produced no write at all.** The wrong-week theory does
not cover it — that would have written the *wrong* keys, and those are untouched too. The
decisive evidence is the status text under the button (`Done — N summaries written…` vs
`Error: …`), which only the operator sees.

## Rollout order

1. Deploy the worker from `main`. Verify by content (`grep -q normalizeL3Key worker.js`)
   before deploying — a clean tree is relative to HEAD and cannot tell you HEAD is wrong.
2. Poll `?action=weekly-t13` until `perStoreL3Units` is present on **two consecutive**
   passes. Rollout is gradual (~180 s) and mid-rollout requests hit a mix of versions.
3. Run Settings → **Rebuild Week Summaries** (needs sign-off — see above).
   A KV read right after the write can return the old value for ~60 s; one stale
   read is not a failed write.
4. `bash scripts/build.sh`, deploy Pages, confirm sw `v77`.

The frontend goes last because that is the side that stops being backward
compatible: the unmodified `index.html` renders the new payload fine (extra fields
ignored, verified), but a new frontend against an old worker shows chevrons that
expand to nothing.
