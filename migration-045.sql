-- migration-045: let the retail lookup finish on its own.
--
-- A 331-line manifest cannot be priced in one HTTP request, and asking a person to sit
-- through a dozen rounds of a progress bar is not a workflow. The PRD called for a queue
-- consumer; this is the same idea on the worker's existing every-minute tick.
--
-- 🔑 `auto_retail` is CONSENT, not a default. It is set when somebody presses "Look up
-- retail", and cleared when there is nothing left to price. A manifest nobody asked about
-- is never looked up, so uploading a file does not silently make the Hub call a third
-- party on your behalf.
--
-- Additive and guarded. Safe to re-run: SQLite has no ADD COLUMN IF NOT EXISTS, so a
-- second run reports "duplicate column name" and changes nothing.
-- Apply staging then prod:
--   npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-045.sql
--   npx wrangler d1 execute labor-dashboard-db         --remote --file=migration-045.sql

ALTER TABLE manifests ADD COLUMN auto_retail INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_manifest_auto ON manifests(auto_retail, uploaded_at);
