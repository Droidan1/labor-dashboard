-- migration-046: a lock so two cron ticks cannot process the same manifest at once.
--
-- The every-minute drainer does a batch of ten lines, and a batch takes longer than a
-- minute once each line needs a search, a parse and sometimes a fetch. The next tick then
-- starts while the previous is still running, queries for pending lines, gets the SAME
-- set — because the first has not written its results yet — and does the work twice.
-- Measured live: 44 searches for 34 distinct lines.
--
-- Mostly that wastes free calls. It is not only waste, though: two runs can both escalate
-- the same line to Firecrawl, and that spends real credits twice for one answer.
--
-- Additive. SQLite has no ADD COLUMN IF NOT EXISTS, so a re-run reports "duplicate column
-- name" and changes nothing.
-- Apply staging then prod:
--   npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-046.sql
--   npx wrangler d1 execute labor-dashboard-db         --remote --file=migration-046.sql

ALTER TABLE manifests ADD COLUMN retail_lock_until TEXT;
