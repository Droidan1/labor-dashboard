-- migration-015: Generic channel sales sink (auction today; eon, labor next).
--
-- One row per (channel, store, date) — a daily rollup that folds into each
-- store's displayed total while preserving the channel dimension underneath,
-- so "how much of Coliseum was auction vs POS vs eon?" stays answerable.
--
-- Feeders write here:
--   • Drive file-drops (auction) → Google Apps Script  → POST ?action=ingest
--   • Live APIs (future eon/labor) → worker cron        → POST ?action=ingest
--
-- Idempotent: UNIQUE(channel, store, date) → re-sent files upsert, never
-- double-count. Mirrors the daily_sales UNIQUE(store, date) pattern.
--
-- Apply with: npx wrangler d1 execute labor-dashboard-db --file=migration-015.sql --remote
--   (staging: add  --env staging  and use labor-dashboard-db-staging)

CREATE TABLE IF NOT EXISTS channel_sales (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel     TEXT NOT NULL,        -- 'auction' | 'eon' | 'labor' | …
  store       TEXT NOT NULL,        -- 'BL1'.. (mapped by the feeder); future locations allowed
  date        TEXT NOT NULL,        -- YYYY-MM-DD — the sale/business date, NOT the file drop date
  total       REAL,                 -- summed sale $ for the day (auction: sum of Hammer Sale)
  count       INTEGER,              -- line/order count (auction: sold lots)
  meta        TEXT,                 -- JSON for channel-specific extras (nullable)
  source_file TEXT,                 -- provenance, e.g. the zip filename
  ingested_at TEXT NOT NULL,        -- ISO timestamp of last write
  UNIQUE(channel, store, date)
);

CREATE INDEX IF NOT EXISTS idx_channel_sales_date
  ON channel_sales(date, channel);

CREATE INDEX IF NOT EXISTS idx_channel_sales_store
  ON channel_sales(store, date);
