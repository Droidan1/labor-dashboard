-- migration-050: condition grade per line.
--
-- Identical product at two grades is two different buys, and the scorer could not see the
-- difference. Clorox's Arlington sheet prices Grade B at 25% of wholesale against 54% for
-- pristine cases -- a 2x swing on the same item -- and BStock's furniture truckloads are
-- 208 USED_GOOD against 21 NEW. Nothing in manifest_lines recorded any of it.
--
-- condition_raw   -- exactly what the vendor's column said, kept verbatim. Vendors do not
--                    agree on vocabulary ("Grade B/Each", "USED_GOOD", "Pristine Cases"),
--                    and the raw string is the only thing guaranteed not to be a lossy
--                    interpretation of their own sheet.
-- condition_grade -- normalised to one of new | repack | grade_b | damaged | used, or NULL
--                    when nothing unambiguous could be read. NULL means "not stated",
--                    never "new" -- assuming pristine because a vendor was silent is the
--                    expensive direction to be wrong in.
--
-- Deliberately NOT wired to a price haircut. What a grade is worth is Brian's number, not
-- a default this migration should invent. Captured, counted and shown; the money decision
-- stays with the buyer until there is a figure to apply.
--
-- Additive. A re-run reports "duplicate column name" and changes nothing.
-- Apply staging then prod:
--   npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-050.sql
--   npx wrangler d1 execute labor-dashboard-db         --remote --file=migration-050.sql

ALTER TABLE manifest_lines ADD COLUMN condition_raw   TEXT;
ALTER TABLE manifest_lines ADD COLUMN condition_grade TEXT;
