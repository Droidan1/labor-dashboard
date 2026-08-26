-- migration-051: a human's retail price, kept where a lookup cannot reach it.
--
-- item_cache.retail_price is written by the retail lookup and overwritten unconditionally
-- on every run:
--
--     ON CONFLICT ... DO UPDATE SET retail_price = excluded.retail_price
--
-- So an admin correcting a price on the Price Scan screen would see it save, and lose it
-- the moment any manifest containing that UPC was looked up again. Same shape as the
-- l3Map override incident and the stale vendor template: a human decision quietly losing
-- to an automated one.
--
-- retail_price_override    -- what a person typed. The lookup never touches this column,
--                             and every read prefers it over retail_price.
-- retail_override_by/_at   -- who and when. A wrong override is sticky, so it has to be
--                             attributable and reversible rather than anonymous.
--
-- suggested_price_override already exists and is already respected; this is the matching
-- field for the retail figure, which had none.
--
-- Additive. A re-run reports "duplicate column name" and changes nothing.
-- Apply staging then prod:
--   npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-051.sql
--   npx wrangler d1 execute labor-dashboard-db         --remote --file=migration-051.sql

ALTER TABLE item_cache ADD COLUMN retail_price_override REAL;
ALTER TABLE item_cache ADD COLUMN retail_override_by    TEXT;
ALTER TABLE item_cache ADD COLUMN retail_override_at    TEXT;
