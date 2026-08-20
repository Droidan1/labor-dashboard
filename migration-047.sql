-- migration-047: record whether a retail price was seen on a physical shelf.
--
-- Walmart and Target both host third-party sellers on their own domain, sometimes at
-- multiples of real retail. Being on the retailer's site is not proof the retailer sells
-- it. Something a STORE stocks is — whoever fulfils the online order, a shelf price is a
-- price a customer can walk up and pay.
--
-- Kept beside retail_in_stock rather than folded into it: "the warehouse has one" and
-- "the shop down the road has one" are different facts, and only the second settles the
-- third-party question.
--
-- Additive. A re-run reports "duplicate column name" and changes nothing.
-- Apply staging then prod:
--   npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-047.sql
--   npx wrangler d1 execute labor-dashboard-db         --remote --file=migration-047.sql

ALTER TABLE manifest_lines ADD COLUMN retail_in_store INTEGER;
ALTER TABLE item_cache     ADD COLUMN retail_in_store INTEGER;
