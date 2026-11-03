-- migration-087: Whatnot show end time and picture, for Live Sales' Show calendar (2026-11-03).
--
-- Brian (2026-11-03): a calendar of every Whatnot show, done and scheduled, each one clickable,
-- built as previewed. A show's panel says when it ran (start – end) and carries the show's picture.
-- /shows returns both (ended_at, thumbnail.url); the Hub did not keep them.
--
-- syncWhatnotShows (worker.js, hourly cron) is the only writer, on its next pass over each show.
-- Shows already stored get them when Whatnot next changes them; until then the panel shows the
-- stream length from analytics and no picture.
--
-- Additive: two nullable columns. Either order with the worker is safe: the worker checks for
-- thumbnail_url (PRAGMA table_info) and writes and reads without both until it exists.
--   npx wrangler d1 execute labor-dashboard-db --remote --command="$(cat migration-087.sql)"
-- Confirm (expects ended_at and thumbnail_url, read-only):
--   npx wrangler d1 execute labor-dashboard-db --remote --command="PRAGMA table_info(whatnot_shows)"
-- Rollback: ALTER TABLE whatnot_shows DROP COLUMN thumbnail_url; ALTER TABLE whatnot_shows DROP COLUMN ended_at;
-- 🛑 Not idempotent (SQLite has no ADD COLUMN IF NOT EXISTS): a second run fails with
--    "duplicate column name" and changes nothing.

ALTER TABLE whatnot_shows ADD COLUMN ended_at TEXT;        -- ISO UTC, /shows ended_at; NULL until the show ends
ALTER TABLE whatnot_shows ADD COLUMN thumbnail_url TEXT;   -- https only, /shows thumbnail.url (images.whatnot.com)
