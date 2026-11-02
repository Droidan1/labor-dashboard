-- migration-086: Whatnot financial-report ledger, for Live Sales "Money back" (2026-11-02).
--
-- Brian (2026-11-02): fill Money back with refunds, carrier adjustments and tips. Only Whatnot's
-- seller_financial_report carries them: one CSV row per ledger transaction, requested through
-- POST /reports (the token needs write:reports) and polled until its file is ready.
--
-- syncWhatnotLedger (worker.js, hourly cron) is the only writer. It keeps refund, carrier-
-- adjustment and tip rows only; sales (ORDER_EARNINGS) are already in whatnot_orders.
--
-- 🔒 No buyer data: the report names the buyer on tips and sales, and carries a free-text
-- message. Neither is stored.
--
-- amount is the report's signed transaction_amount in dollars: negative = money out (a refund,
-- a carrier charge), positive = money in (a tip, a carrier credit).
--
-- Additive: one new table. Either order with the worker is safe: the worker checks for this
-- table and skips the ledger (and the read returns no ledger rows) until it exists.
--   npx wrangler d1 execute labor-dashboard-db --remote --file=migration-086.sql
-- Confirm (expects whatnot_ledger):
--   npx wrangler d1 execute labor-dashboard-db --remote \
--     --command="SELECT name FROM sqlite_master WHERE type='table' AND name='whatnot_ledger'"
-- Rollback: DROP TABLE whatnot_ledger;  (and DELETE FROM whatnot_sync WHERE key = 'ledger';)

CREATE TABLE IF NOT EXISTS whatnot_ledger (
  id             TEXT PRIMARY KEY,   -- ledger_transaction_id
  type           TEXT NOT NULL,      -- ORDER_REFUND | ORDER_REFUND_SHIPPING_COSTS | APPEALED_ORDER_REFUND
                                     -- | APPEALED_ORDER_REFUND_SHIPPING_COSTS | CARRIER_ADJUSTMENT
                                     -- | CARRIER_ADJUSTMENT_REFUND | TIP
  completed_at   TEXT NOT NULL,      -- ISO UTC, transaction_completed_at_utc
  completed_date TEXT NOT NULL,      -- YYYY-MM-DD Eastern of completed_at
  amount         REAL NOT NULL,      -- signed dollars
  currency       TEXT,
  order_id       TEXT,               -- NULL for a carrier adjustment or a tip
  show_id        TEXT,               -- livestream_id; NULL when not tied to a show
  synced_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_whatnot_ledger_date ON whatnot_ledger(completed_date);
