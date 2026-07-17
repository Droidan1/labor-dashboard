-- migration-007: Manual override support for daily_sales
--
-- Use case: when Clover's cloud loses data (sync outages, device issues),
-- admins need to enter actual sales/labor numbers manually. Once flagged,
-- those rows are protected from being overwritten by the cron snapshot
-- or Sheet backfill.
--
-- Apply with:
--   wrangler d1 execute labor-dashboard-db --file=migration-007.sql --remote

ALTER TABLE daily_sales ADD COLUMN labor_hours REAL;
ALTER TABLE daily_sales ADD COLUMN is_manual_override INTEGER DEFAULT 0;
