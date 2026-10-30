-- migration-084: Whatnot Seller API mirror (2026-10-30).
--
-- Brian (2026-10-30): pull Whatnot into the Hub through the Seller API — every item sold per
-- show, show analytics, and products — read-only, with the Bargain Lane Live recap email kept
-- as the source of live-sales dollars and the API cross-checking it.
--
-- syncWhatnot (worker.js, hourly cron) is the only writer. Nothing here feeds channel_sales or
-- daily_sales: the cross-check READS channel_sales and never writes it.
--
-- 🔒 No buyer data. The token carries no read:customers scope and the sync stores no buyer
-- field; buyer counts come from show analytics.
--
-- Money columns are REAL dollars, as channel_sales and daily_sales hold them. Whatnot sends
-- decimal strings ("12.50") with a currency; every Bargain Lane amount is USD.
--
-- Additive: new tables only. Apply BEFORE the worker that reads them (its sync and reads
-- check for whatnot_sync and answer "not set up" until it exists, so either order is safe,
-- but nothing syncs until both have landed).
--   npx wrangler d1 execute labor-dashboard-db --remote --file=migration-084.sql
-- Confirm (expects six whatnot_ tables):
--   npx wrangler d1 execute labor-dashboard-db --remote \
--     --command="SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'whatnot_%' ORDER BY name"

-- One row per show. store/show_date are the recap feeder's rule (whatnotStoreFor): the show's
-- start in Eastern time, before 3:30 PM = BL1 (Fort Wayne = Coliseum), else BL14.
CREATE TABLE IF NOT EXISTS whatnot_shows (
  id                 TEXT PRIMARY KEY,   -- Whatnot show UUID
  title              TEXT,
  status             TEXT,               -- scheduled | live | stopped | ended | cancelled
  scheduled_start_at TEXT,               -- ISO, from /shows
  started_at         TEXT,               -- ISO, analytics start_time once known
  show_date          TEXT,               -- YYYY-MM-DD Eastern, of started_at else scheduled_start_at
  store              TEXT,               -- BL1 | BL14
  updated_at         TEXT,               -- Whatnot's updated_at
  synced_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_whatnot_shows_date ON whatnot_shows(show_date, store);

-- GET /analytics/shows/{id}. calculation_status NOT_ENDED / PENDING / WILL_NOT_BE_CALCULATED
-- come back with null metrics; a row with sales IS NOT NULL is final and is not re-fetched.
CREATE TABLE IF NOT EXISTS whatnot_show_analytics (
  show_id                TEXT PRIMARY KEY,
  calculation_status     TEXT,
  sales                  REAL,
  estimated_earnings     REAL,
  orders_count           INTEGER,
  average_order_value    REAL,
  giveaway_orders_count  INTEGER,
  giveaway_spend         REAL,
  impressions            INTEGER,
  clickthrough_rate      REAL,
  buyers                 INTEGER,
  first_time_buyers      INTEGER,
  returning_buyers       INTEGER,
  stream_minutes         REAL,
  max_concurrent_viewers INTEGER,
  total_views            INTEGER,
  distinct_viewers       INTEGER,
  average_rating         REAL,
  fetched_at             TEXT NOT NULL
);

-- GET /orders. Re-read for 3 days after the newest stored order, so a cancel is picked up.
CREATE TABLE IF NOT EXISTS whatnot_orders (
  id               TEXT PRIMARY KEY,
  show_id          TEXT,               -- NULL = not sold in a show (profile shop)
  status           TEXT,
  transaction_type TEXT,               -- auction | buy_it_now | …
  created_at       TEXT NOT NULL,
  order_date       TEXT,               -- YYYY-MM-DD Eastern of created_at (dates a no-show order)
  updated_at       TEXT,
  subtotal         REAL,
  shipping         REAL,
  tax              REAL,
  total            REAL,
  discount         REAL,
  currency         TEXT,
  items_synced     INTEGER NOT NULL DEFAULT 0,  -- 1 once /orders/{id}/items has been read
  synced_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_whatnot_orders_show ON whatnot_orders(show_id);
CREATE INDEX IF NOT EXISTS idx_whatnot_orders_created ON whatnot_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_whatnot_orders_pending ON whatnot_orders(items_synced) WHERE items_synced = 0;

-- GET /orders/{id}/items. show_id is copied from the order so the reads need no join.
CREATE TABLE IF NOT EXISTS whatnot_order_items (
  id                 TEXT PRIMARY KEY,
  order_id           TEXT NOT NULL,
  show_id            TEXT,
  product_id         TEXT,
  variant_id         TEXT,
  sku                TEXT,
  title              TEXT,
  quantity           INTEGER,
  unit_price         REAL,
  price_includes_tax INTEGER,
  synced_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_whatnot_items_order ON whatnot_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_whatnot_items_show ON whatnot_order_items(show_id);
CREATE INDEX IF NOT EXISTS idx_whatnot_items_product ON whatnot_order_items(product_id);

-- GET /products/{id}, read once per product an item names, for its Whatnot category.
-- found = 0: Whatnot answered 404 (the listing was deleted), so it is not asked again.
CREATE TABLE IF NOT EXISTS whatnot_products (
  id            TEXT PRIMARY KEY,
  title         TEXT,
  category_id   TEXT,
  category_name TEXT,
  external_id   TEXT,
  found         INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT,
  synced_at     TEXT NOT NULL
);

-- Sync bookkeeping: cursors, the last run's result, and which cross-check gaps were pushed.
CREATE TABLE IF NOT EXISTS whatnot_sync (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL
);
