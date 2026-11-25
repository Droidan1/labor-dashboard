-- migration-094: retail highlights on the store page (website pilot, Phase 2 slice 1b, 2026-11-25).
-- Plan: docs/plans/bargainlane-website.md §7, slice 1b. A bin preview and a retail highlight are the
-- same reviewed thing with a different kind of photo, so they share bin_previews.
--
-- What it changes, and nothing else:
--   1. bin_previews gains `kind` ('bins' | 'retail'). Every existing row becomes 'bins'.
--   2. "At most one approved preview per store and day" becomes per kind, so a bin preview and a
--      retail highlight can both be approved for the same day. The old index is replaced.
-- No row is rewritten or deleted. The old worker keeps working on this schema (it never sets `kind`,
-- so its rows are 'bins', and bins stay one-per-day), so this runs BEFORE the new worker.
--
-- 🛑 Not re-runnable: SQLite has no ADD COLUMN IF NOT EXISTS. A second run stops at the ALTER having
--    changed nothing. 🛑 Don't re-run migration-093 after this: it would re-create the old index and
--    block a retail highlight on a day that has an approved bin preview (a refusal, not data loss).
-- Staging, then prod, only on Brian's say-so:
--   npx wrangler d1 execute labor-dashboard-db-staging --remote --command="$(cat migration-094.sql)"
--   npx wrangler d1 execute labor-dashboard-db --remote --command="$(cat migration-094.sql)"

ALTER TABLE bin_previews ADD COLUMN kind TEXT NOT NULL DEFAULT 'bins' CHECK (kind IN ('bins','retail'));

DROP INDEX IF EXISTS uq_bin_previews_approved;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bin_previews_approved_kind ON bin_previews(store, kind, sale_date) WHERE status = 'approved';
