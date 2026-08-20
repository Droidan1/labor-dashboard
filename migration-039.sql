-- migration-039: auto-draft bin photos into a reviewable post, on upload.
--
-- When a manager submits bin photos, the worker ensures ONE draft exists for that
-- store for that week and keeps its photo list in sync. Two things make that safe
-- under a burst of uploads (a single Thursday batch is ~30 separate requests):
--
--   1. auto_week + the partial unique index below make the create idempotent —
--      exactly one of N concurrent uploads wins the INSERT, the rest no-op.
--   2. photo_ids is RECOMPUTED from marketing_photos on every upload rather than
--      appended to, so concurrent writers converge instead of clobbering.
--
-- auto_week is the Sunday that starts the retail week ('YYYY-MM-DD'), derived from
-- the upload date. Deliberately NOT the Flow Calendar's retail_week: the flow table
-- only runs to 2026-12-26, and an upload-triggered feature must not silently stop
-- working when the calendar runs out. Sunday-anchored matches how the Content page
-- already groups photos into week folders.
--
-- Additive — no row is modified or deleted. NOT idempotent: the two CREATE INDEX
-- statements are guarded, but ALTER TABLE ADD COLUMN is not, so a second run fails
-- with "duplicate column name: auto_week". Forward-only, run EXACTLY ONCE per DB.
-- Apply staging then prod:
--   npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-039.sql
--   npx wrangler d1 execute labor-dashboard-db         --remote --file=migration-039.sql

ALTER TABLE marketing_drafts ADD COLUMN auto_week TEXT;   -- 'YYYY-MM-DD' (Sunday), when origin='photos'

CREATE UNIQUE INDEX IF NOT EXISTS uq_drafts_auto_week
  ON marketing_drafts(store, auto_week) WHERE origin = 'photos';

-- The per-upload photo lookup is the hot path now: once per uploaded photo.
CREATE INDEX IF NOT EXISTS idx_mktphoto_type_created
  ON marketing_photos(store, photo_type, created_at);
