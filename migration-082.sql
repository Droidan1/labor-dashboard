-- migration-082: the weekly RETAIL auto-draft (2026-10-21).
--
-- Bin photos already build one draft per store per week (origin='photos', migration-039's
-- uq_drafts_auto_week). Retail photos now build their own: the Friday "new arrivals" post
-- the 2026-10-13 meeting set (Thursday bins, Friday retail). origin='retail', and this
-- index is what makes a burst of ~20 uploads create exactly ONE of them
-- (INSERT … ON CONFLICT DO NOTHING has nothing to conflict on without it).
--
-- The worker checks for this index and skips the retail draft until it exists, so the
-- worker and this migration can land in either order.
--
-- Additive and idempotent.
--   npx wrangler d1 execute labor-dashboard-db --remote --command="CREATE UNIQUE INDEX IF NOT EXISTS uq_drafts_auto_week_retail ON marketing_drafts(store, auto_week) WHERE origin = 'retail';"
-- Confirm it landed (expects uq_drafts_auto_week_retail):
--   npx wrangler d1 execute labor-dashboard-db --remote \
--     --command="SELECT name FROM sqlite_master WHERE type='index' AND name='uq_drafts_auto_week_retail'"
CREATE UNIQUE INDEX IF NOT EXISTS uq_drafts_auto_week_retail
  ON marketing_drafts(store, auto_week) WHERE origin = 'retail';
