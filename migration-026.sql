-- migration-026: record Meta "Boost" ads created from published bin-post drafts.
-- One row per boost (campaign→adset→ad, created PAUSED). Lets the app show a
-- draft's boost state and refuse to double-boost the same post. Additive.
--   Staging: npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-026.sql
--   Prod:    npx wrangler d1 execute labor-dashboard-db         --remote --file=migration-026.sql

CREATE TABLE IF NOT EXISTS marketing_boosts (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id           INTEGER,
  store              TEXT,
  ad_account_id      TEXT,
  campaign_id        TEXT,
  adset_id           TEXT,
  ad_id              TEXT,
  object_story_id    TEXT,          -- the promotable post id used in the creative
  daily_budget_cents INTEGER,
  status             TEXT,           -- 'paused' (always created paused)
  created_by         TEXT,
  created_at         TEXT NOT NULL
);

-- UNIQUE so the DB itself enforces one boost per draft, even if the app-level
-- guard SELECT races. The endpoint tears down the just-created ad objects when
-- this INSERT fails, so a lost race never leaves untracked/duplicate campaigns.
CREATE UNIQUE INDEX IF NOT EXISTS uq_boosts_draft ON marketing_boosts(draft_id);
