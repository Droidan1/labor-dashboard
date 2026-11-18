-- migration-091: the products in each E-Commerce order (2026-11-18).
--
-- Brian (2026-11-18) chose the View Details Items tab as a product table (Option A). ecom_orders
-- (migration-090) keeps one row per order; this keeps that order's lines, written by the same
-- syncSellercloud pass in the same batch: the order's stored lines are replaced by the ones
-- Sellercloud just sent. An order that comes back with no lines keeps the lines already stored.
-- ?action=ecom-items reads it.
--
-- No buyer data. Cost columns are NULL unless Sellercloud sends a cost above zero: the probe on
-- 2026-11-18 found none on 106 lines, so margin stays hidden until it does.
--
-- Additive: one new table and two indexes, nothing existing is touched. Re-runnable (IF NOT EXISTS).
-- Either order with the worker is safe: without the table the sync still writes the orders and
-- reports lines as skipped, and the read answers "not set up".
CREATE TABLE IF NOT EXISTS ecom_order_items (
  order_id      INTEGER NOT NULL,             -- ecom_orders.order_id
  line_no       INTEGER NOT NULL,             -- position in the order, from 1
  line_id       INTEGER,                      -- Sellercloud's order-item ID, as sent
  company_id    INTEGER NOT NULL,             -- Sellercloud CompanyID as sent (163-167, 169)
  unit          INTEGER NOT NULL,             -- the card it counts on: 169 (Poshmark) → 163
  order_date    TEXT    NOT NULL,             -- the order's YYYY-MM-DD, as in ecom_orders
  sku           TEXT,                         -- ProductID
  name          TEXT,                         -- DisplayName, else ProductName
  qty           INTEGER NOT NULL DEFAULT 0,
  qty_returned  INTEGER NOT NULL DEFAULT 0,
  line_total    REAL    NOT NULL DEFAULT 0,   -- the line's sale, shipping not included
  refunded      REAL    NOT NULL DEFAULT 0,
  site_cost     REAL,                         -- per unit; NULL when Sellercloud sends none
  average_cost  REAL,
  last_cost     REAL,
  synced_at     TEXT    NOT NULL,
  PRIMARY KEY (order_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_ecom_items_unit_date ON ecom_order_items (unit, order_date);
CREATE INDEX IF NOT EXISTS idx_ecom_items_sku ON ecom_order_items (unit, sku);
