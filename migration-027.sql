-- migration-027: Add published_at to marketing_drafts — a real publish timestamp
-- for the Content › Posts "Published" week folders (previously proxied by
-- updated_at). Additive + a one-time backfill of existing published rows from
-- their updated_at (the value the UI already grouped by), so old posts keep the
-- same week. Forward-only — run EXACTLY ONCE per DB. Apply staging then prod:
--   npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-027.sql
--   npx wrangler d1 execute labor-dashboard-db         --remote --file=migration-027.sql

ALTER TABLE marketing_drafts ADD COLUMN published_at TEXT;
UPDATE marketing_drafts SET published_at = COALESCE(updated_at, created_at)
  WHERE status = 'published' AND published_at IS NULL;
