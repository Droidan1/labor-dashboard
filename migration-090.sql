-- migration-090: E-Commerce orders mirrored from Sellercloud (2026-11-18).
--
-- Brian (2026-11-18): E-Commerce gets a dashboard like Bargain Lane's, one card per Sellercloud
-- company. syncSellercloud (worker.js) copies Sellercloud's orders here every 15 minutes for
-- yesterday and today, and re-reads 35 days nightly so later refunds, returns and status changes
-- land. ?action=ecom-overview reads it.
--
-- One row per Sellercloud order, written by UPSERT only: a fetch that comes back short can update
-- or add rows but never removes one. No buyer data — no names, emails or addresses — is stored.
--
-- Additive: one new table and one index, nothing existing is touched. Re-runnable (IF NOT EXISTS).
-- Either order with the worker is safe: without the table the sync logs and stops, and the read
-- answers "not set up".
CREATE TABLE IF NOT EXISTS ecom_orders (
  order_id       INTEGER PRIMARY KEY,          -- Sellercloud order ID
  company_id     INTEGER NOT NULL,             -- Sellercloud CompanyID as sent (163-167, 169)
  unit           INTEGER NOT NULL,             -- the card it counts on: 169 (Poshmark) → 163
  order_date     TEXT    NOT NULL,             -- YYYY-MM-DD of TimeOfOrder, Sellercloud's own day
  order_time     TEXT,                         -- TimeOfOrder as sent (it carries no time zone)
  status_code    INTEGER,                      -- 2 InProcess, 3 Completed, 100 Problem, 200 OnHold, -1 Canceled …
  source         INTEGER,                      -- OrderSource, the channel (1/2 eBay …)
  grand_total    REAL    NOT NULL DEFAULT 0,   -- what the buyer paid, shipping included
  shipping       REAL    NOT NULL DEFAULT 0,
  units          INTEGER NOT NULL DEFAULT 0,
  units_returned INTEGER NOT NULL DEFAULT 0,
  refunded       REAL    NOT NULL DEFAULT 0,
  synced_at      TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ecom_orders_date_unit ON ecom_orders (order_date, unit);
