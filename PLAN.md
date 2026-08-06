# PLAN — labor-dashboard (RETJG HUB)

_Direction and progress. Refreshed each session. Durable knowledge lives in [MEMORY.md](MEMORY.md); how to sit down and work here lives in [ORIENT.md](ORIENT.md)._

---

## Current State — 2026-08-05

**Multi-business permissions are STRUCTURALLY COMPLETE in production.** worker
`a5a4a26b`, main `9753de2`. All four build-order steps of
`tasks/multi-business-permissions.md` are built and live: grants, landing picker,
Users-page grant editor, superuser-only business membership, a **fail-closed
business gate** (86 actions; unclassified = refused), cron coverage, and
`allowedUnits(user, businessId)` replacing the hard-wired `'bl'`.

🛑 **Nothing structural blocks E-Commerce now — only SellerCloud credentials and
data.** See `tasks/sellercloud-api-brief.md`.

### eBay Cases (E-Commerce) — Slices 1, 2a, 2b-data DEPLOYED, inert

Prod worker `d87ee9a5`. Ingest (#142), business-aware sidebar (#143) and the
`?action=ebay-cases` read endpoint (#145) are all deployed but **inert**:
`EBAY_HANDLER_TOKEN` does not exist and `migration-034` is unapplied, so both
endpoints 401 before touching a table.

**Blocked on minting the token.** Remaining build: the Cases **page**.
Plan: `tasks/ebay-case-handler.md`.

### 🛑 Still open, in priority order

1. **Rotate the Clover tokens and `SNAPSHOT_SECRET`** — steps B and C below.
   Unchanged and still the oldest item. **Only Brian can run it.**
2. **Convert the regex-extraction test suites to drive `worker.fetch`.** They cost a
   fix twice on 2026-08-05 (the cron business check, and splitting `allowedStores`
   broke four suites at once). They cannot see wiring, and the tax compounds.
3. **Mint `EBAY_HANDLER_TOKEN`** and hand it to Raj out of band — the entire eBay
   integration waits on it. Then migration-034 → staging → one real POST → prod.
4. **Owed:** two-build before/after diff of Bargain Lane's sidebar vs main (#143
   merged without it, and it auto-deployed to prod).
5. **Boost's `migration-032` has never run against prod** — it lives on the `staging`
   branch with the Meta Boost feature and must be applied whenever that ships.

---

## Previous State — 2026-08-03

**Everything below is in production.** `main` @ `ab5ed43`, worker `6ae880b3`, sw `v66`.

The admin-tools plan (`tasks/admin-tools-plan.md`) is **complete — all four phases shipped**. The admin API went from 25 secret-only endpoints, six of which fired on a plain GET, to a role-gated surface with a purpose-built repair flow.

### 🛑 Do this first — live credentials are public

**`wrangler.toml` is tracked in the PUBLIC repo and carried every store's Clover API token plus `SNAPSHOT_SECRET` in plaintext from 2026-04-08 until 2026-08-03.** Verified world-readable unauthenticated at `raw.githubusercontent.com/Droidan1/labor-dashboard/main/wrangler.toml`. This is why `wrangler secret list` never showed `SNAPSHOT_SECRET` — it was never a secret.

Those tokens bypass this app entirely: they talk straight to `api.clover.com` as the merchant and can read all orders **and create, update, delete catalog items, reassign categories, and change prices**. Mitigating: **0 forks, 0 network, 1 watcher** — nobody cloned it through GitHub, and there are no Wayback captures.

Code is committed (`fb86f6c`) but **nothing is deployed** — shipping the stripped config before the secrets exist would remove all Clover access.

**A — move (no Clover involvement, no service change).** Values stay identical, so it cannot break anything:
```bash
bash scripts/migrate-secrets.sh          # sets 8 secrets x 2 envs, then verifies
npx wrangler deploy && npx wrangler deploy --env staging
```
Then confirm Clover still answers — `sales-diag` re-fetches live:
`?action=sales-diag&store=BL1&date=<a recent date>`

**B — rotate, in Clover.** Six unique merchant accounts back the seven store keys (BL16 reuses BL12's). One account at a time: issue a new token in Clover → `npx wrangler secret put BLn_API_TOKEN` (and `--env staging`) → verify that store with `sales-diag`. Only this step invalidates what's already public.

**C — rotate `SNAPSHOT_SECRET`**, using the dual-accept now deployed in code:
1. `npx wrangler secret put SNAPSHOT_SECRET_NEXT` — both values now work
2. Update `CONFIG.SNAPSHOT_SECRET` in `scripts/auction-drive-ingest.gs`. Watch for `legacy-secret-in-use` in `npx wrangler tail` — while that line still appears, something hasn't moved. Silence for a full day means the nightly feeder has migrated.
3. `npx wrangler secret put SNAPSHOT_SECRET` (new value), then `npx wrangler secret delete SNAPSHOT_SECRET_NEXT`

Verify any step with `?action=secret-check`, which reports `current` / `next` without doing anything.

**Repo visibility:** deliberately left public. Going private would stop new readers but invalidates nothing already copied, and Pages serves `www.retjghub.com` from this repo — on a Free plan that would take the dashboard offline. Rotation closes the exposure completely; visibility doesn't. Revisit afterwards if on a paid plan.

### Then

1. ~~🛑 **Rotate `SNAPSHOT_SECRET`.**~~ — now step C above. The old value sat in public page source for months, so removing it from the client stops future disclosure but does not un-publish it. **Two steps that must land together** — `wrangler secret put SNAPSHOT_SECRET` *and* `CONFIG.SNAPSHOT_SECRET` in `scripts/auction-drive-ingest.gs`. Rotate only the first and the nightly auction feeder stops silently. This is the last open item from Phase 2 and the only outstanding *security* work.
2. ❓ **BL8 took $0 on 12 of the last 30 days** (2026-07-20 → 08-02, with 07-23/24 trading normally). The item snapshot and `daily_sales` agree, so it is real, not a pipeline fault. Closed? Seasonal? Needs a human answer before anyone "fixes" it.
3. ❓ **~$21.6k of 30-day net sales resolve to no cost at all** (`coverage.none`), heaviest at BL1 ($6.6k) and BL16 ($6.3k). Broader than the bin-sales gap that drove the July L3 work. Worth a pass once someone decides how much precision is worth.

### Deliberately not doing

- **Merging the three costing panels** (Item Master Costs / L3 Category Costs / Custom Sales Categorization) into one "why isn't this costed" flow. They are confusing but they work, and the damage this project has actually suffered came from *repair* operations, not costing edits. Revisit after the Repair console has been used in anger.
- **Removing `sales-diag` or `clientdate-probe`.** Both survived Phase 4 on merit: `sales-diag` is the deep-dive that justified deleting the four `debug-*` endpoints, and `clientdate-probe` is the read-only preview for `resnapshot-clienttime`, which is live.

---

## Completed — Admin hardening (2026-08-03)

Full detail in `tasks/admin-tools-plan.md`. Summary:

| Phase | Shipped | What |
|---|---|---|
| 1 — stop the bleeding | `9ac0f51` / worker `fe96e33f` / sw v63 | 7 destructive endpoints made POST-only; duplicate `ingest`, `test-interval-summary`, `fb-publish-test` deleted |
| 2 — real auth | `5880e8b` / `420f3287` / v64 | `requireAdminAccess` (superuser writes, admin reads, secret for tooling); **secret removed from the client**; `manual-override` guard; admin page restyled |
| 3a — health check | `cc2ea37` / `718f1de0` / v65 | Read-only `repair-health`: stored snapshot vs D1, lists only dates a repair would improve |
| 3b — repair + restore | `28e6ec6` / `fe925fbb` / v66 | Backup → targeted repair (a **list**, never a range) → reversible restore |
| 4 — prune | `ab5ed43` / `6ae880b3` | 4 one-off `debug-*` endpoints removed (−422 lines); README de-staled |

**Verification standard used throughout:** 360 assertions across five suites, each driving the *real* exported handlers rather than reimplementations, and each comparing against the previous build so a passing run cannot be vacuous. The `rebuildItemSnapshot()` extraction — which touches the code path that has destroyed production data three times — is proven by a **byte-for-byte differential test** against the prior build.

---

## Completed — L3 categorisation & costing (2026-08-03, same session)

Chain-wide uncosted bin sales went **$127,418 → $1,378 (−98.9%)**, booking ~$122k of previously-missing COGS. Four bugs nobody had reported:

- An admin item-override silently discarded the L3, making overridden items **un-costable** (`$111,036`).
- `update-clover-item` could **never** recategorise — it passed a whole object as `category.id`, checked no response, and returned `ok: true` regardless. Its removal path never fired either.
- The cost editor could wipe all 58 category costs by loading on the wrong page.
- The backfill's zero-order guard was blind to **partial** Clover fetches (a magnitude guard now covers it).

Also established: `Sku Book Items` is a POS convenience page, not a category; the `|| "Hardlines"` default that hid two typos for months is gone.

---

## Backlog (unscheduled)

- **Content Studio redesign** — 7-phase plan, not started (`tasks/content-studio-redesign-plan.md`).
- **Multi-business permissions** — 🛑 **plan only, and explicitly provisional**; Brian said it changes as he learns more. Do not treat as a spec.
- **AI cover generation** — Slice 1 on staging, needs `OPENAI_API_KEY` in prod.
- **Marketing / Meta ads** — Phase 1 on staging; live API + cron pending.
- **FB post reach** — dashboard-published posts get ~0 organic reach; cause is the multi-photo `attached_media` method, not privacy.
