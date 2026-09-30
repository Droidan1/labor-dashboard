# Boost feature — prod cutover checklist

**Feature:** "Boost" button on Content Studio Published cards → promotes the existing
FB post as a Meta ad (campaign→ad set→ad), created **PAUSED** (no spend until set live
in Ads Manager). Built, adversarially reviewed (7 findings fixed), and verified on
**staging** (validation/gating only — the real post lives on prod). Nothing on prod yet.

- Branch: `claude/content-studio-redesign` · boost commit `4603f33`
- Ad account: `273307252412674` · Battle Creek page: `104574708111472` · draft to test: **4**
- Prod DB: `labor-dashboard-db` (`3fa911d7-31d6-438c-985f-7ac08c407d2d`)
- Prod worker: `clover-sales-api` · prod frontend: GitHub Pages (deploy-pages.yml on `main`)

---

## 1. Generate & set the `ads_management` token  ⬅️ the create path needs this
Existing `META_ACCESS_TOKEN` is **ads_read only** — it can read insights but **cannot create ads**.
Reuse the `AdsInsights` system user (Bargain Lane Business Portfolio `2997041790487404`,
app "Bargain Lane Reporting" `1025999603440093`):

- [ ] Business Settings → Users → System users → **AdsInsights** → Add assets → **Ad accounts** →
      `273307252412674` → turn on **Manage campaigns** (currently only "View performance")
- [ ] Add assets → **Pages** → Battle Creek `104574708111472` (+ any other store pages) → enable **Ads**/Manage
- [ ] **Generate new token** → app "Bargain Lane Reporting" → scopes: **`ads_management`** (+ `ads_read`,
      `pages_manage_ads`, `pages_read_engagement`) → expiration **Never** → copy it
- [ ] Approve the token request via **Business Settings → Requests** (second-admin / two-person rule)
- [ ] Sanity-check scope: `curl -s "https://graph.facebook.com/v25.0/me/permissions?access_token=TOKEN" | grep ads_management` → `"granted"`
- [ ] Set the secret (paste at the hidden prompt — don't put the token in chat/files):
      - [ ] staging: `npx wrangler secret put META_ADS_TOKEN --env staging`
      - [ ] prod:    `npx wrangler secret put META_ADS_TOKEN`

## 2. Apply migration-026 to the prod DB  ✅ DONE 2026-07-10
`marketing_boosts` table + `UNIQUE(draft_id)`. Must land **before** the worker deploy.
- [x] Run `migration-026.sql` against `labor-dashboard-db` (via the Cloudflare D1 API / MCP —
      `wrangler d1 execute --remote` prompts interactively and hangs in the agent env)
- [x] Verify: `marketing_boosts` exists + index `uq_boosts_draft`

## 3. Deploy the prod worker  ✅ DONE 2026-07-10 (version `295f3ee6`)
- [x] From the worktree: `npx wrangler deploy` (no `--env` = prod `clover-sales-api`)
- [x] Smoke-test: preview against draft 4 returned `eligible:true` + a `promotable_id`
      (after brief edge-propagation on the fresh deploy)

## 4. Land the Boost frontend on `main`
Branch has diverged from main (main carries the merge + the reconcile hotfix), so cherry-pick:
- [ ] Cherry-pick boost commit `4603f33` onto `origin/main` → push (triggers GitHub Pages)
- [ ] Confirm prod serves **sw v27** + `ctBoostDraft` at www.retjghub.com (allow Fastly ~10 min)

## 5. Preview test on prod (read-only — the real test)  ✅ DONE 2026-07-10
- [x] `POST ?action=boost-post {draft_id:4, preview:true}` → **`eligible:true`**, `promotable_id`
      resolved (== post_id; so the old MCP "post unavailable" was that hacky flow, not the id).

## 6. First real boost (paused)  🚧 BLOCKED — page advertiser permission
- [x] `META_ADS_TOKEN` set on prod
- [x] Ran create (`preview:false`) → failed at the **ad** step: **"No Advertiser Permission On Page"**
      (`subcode 1885499`). Teardown verified clean — no orphan campaign/ad set, no `marketing_boosts` row.
- [ ] **FIX:** Business Settings → Accounts → Pages → **Bargain Lane – Battle Creek** → Assign people →
      **AdsInsights** (system user ID `61590705842366`) → enable **Ads** task (or Full control) → Save.
- [ ] Re-run the create — no code/token change needed; draft 4 is un-recorded so it's retry-safe.
- [ ] Confirm a **PAUSED** campaign appears in Ads Manager (act `273307252412674`), nothing spending.
- [ ] (then do **step 4** above — land the Boost button on the prod frontend)

---

## Notes / rollback
- Everything is created **PAUSED** — no spend happens automatically at any point.
- One boost per draft (DB `UNIQUE(draft_id)` + record-or-roll-back). A failed record tears the
  ad objects back down, so no orphan/duplicate campaigns.
- To undo a boost: delete/archive its campaign in Ads Manager (and its `marketing_boosts` row to re-enable Boost).
- `STORE_GEO` currently seeds **BL8 / BL14 / BL16**; add a store's lat/lng there to enable boosting its posts.
- Worker rollback: `npx wrangler rollback`. Migration-026 is additive (safe to leave).
