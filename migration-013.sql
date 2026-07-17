-- migration-013: Capture avg_asp column (average selling price)
--
-- avg_asp was added to the production daily_sales table manually and was
-- never recorded as a migration, causing schema drift (a fresh DB built
-- from migrations lacked the column). This migration backfills that gap so
-- the migration set reproduces production.
--
-- Apply with:
--   wrangler d1 execute labor-dashboard-db --file=migration-013.sql --remote

ALTER TABLE daily_sales ADD COLUMN avg_asp REAL;
