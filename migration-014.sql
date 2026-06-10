-- migration-014: Meta ad insights for the Marketing reporting page.
-- One row per (account, level, entity, window). Populated in Phase 1 via MCP
-- backfill; in Phase 2 via the worker calling the Meta Marketing API on cron.
-- Apply with: npx wrangler d1 execute labor-dashboard-db --file=migration-014.sql --remote

CREATE TABLE IF NOT EXISTS meta_ad_insights (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id     TEXT NOT NULL,        -- '273307252412674' | '900771016120912'
  account_name   TEXT,
  level          TEXT NOT NULL,        -- 'account' | 'campaign'
  entity_id      TEXT NOT NULL,        -- account id or campaign id
  entity_name    TEXT,
  objective      TEXT,
  window         TEXT NOT NULL,        -- 'mtd' | 'last_60d'
  date_start     TEXT,
  date_stop      TEXT,
  spend          REAL,
  impressions    INTEGER,
  reach          INTEGER,
  clicks         INTEGER,
  link_clicks    INTEGER,
  cpc            REAL,
  cpm            REAL,
  ctr            REAL,
  frequency      REAL,
  purchases      INTEGER,              -- nullable; null today (no conversion data)
  purchase_value REAL,                 -- nullable
  roas           REAL,                 -- nullable
  fetched_at     TEXT NOT NULL,
  UNIQUE(account_id, level, entity_id, window)
);

CREATE INDEX IF NOT EXISTS idx_meta_window
  ON meta_ad_insights(window, level, account_id);
