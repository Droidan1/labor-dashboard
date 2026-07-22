-- migration-026: Add upload_alerts column to notification_preferences.
-- Backs the "Photo upload alerts" toggle (Settings › Notifications, admin/superuser):
-- push admins/superusers when a store submits new photos. Default ON.
-- Additive/forward-only — SQLite has no ADD COLUMN IF NOT EXISTS; run EXACTLY
-- ONCE per DB. Apply staging then prod:
--   npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-026.sql
--   npx wrangler d1 execute labor-dashboard-db         --remote --file=migration-026.sql

ALTER TABLE notification_preferences ADD COLUMN upload_alerts INTEGER NOT NULL DEFAULT 1;
