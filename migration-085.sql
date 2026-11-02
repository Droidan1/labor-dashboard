-- migration-085: the Live Sales business (phase 1 — add it, move no money).
--
-- Brian (2026-10-30): live sales — the online auction AND Whatnot — leave Bargain Lane for a business
-- of their own. Phase 1 only ADDS it: one business row, its four stores, and admin grants. Nothing
-- here touches channel_sales or daily_sales, so live sales stay inside Bargain Lane's totals (net
-- sales, labor %, budget, the Executive Summary) until the phase-2 cutover removes them there in one
-- release. Until then the landing picker must not add Live Sales into the group total.
--
-- Units are the stores with live sales: BL1 Coliseum (Whatnot, occasional auction), BL2 South Bend
-- (auction), BL14 Battle Creek (both), BL16 Indy East (auction). 🔑 `business_units.id` is a GLOBAL
-- primary key and 'BL1' etc. are already Bargain Lane's, so these take 'live-BLn' ids with the store
-- code in `code` — grants and set-user-grants match on `code`. Reusing 'BL1' as the id would make
-- INSERT OR IGNORE silently insert nothing and leave the card "not connected".
--
-- Grants: every active admin gets role 'admin' with units NULL (every unit), exactly like migration-033
-- did for E-Commerce, so admins can reach the business from the picker. Brian, 2026-10-30: superuser +
-- admins only in phase 1, no managers. The superuser holds no grants and sees every business already.
-- To walk it back for one person: DELETE FROM user_grants WHERE user_id = ? AND business_id = 'live';
--
-- Order matters (foreign keys): business, then units, then grants. Idempotent: INSERT OR IGNORE and
-- ON CONFLICT DO NOTHING, so a re-run writes zero rows. Additive only — no table is rebuilt, so the
-- D1 cascade trap (migration-029) does not apply.
--
-- Rollback, in reverse order:
--   DELETE FROM user_grants WHERE business_id = 'live';
--   DELETE FROM business_units WHERE business_id = 'live';
--   DELETE FROM businesses WHERE id = 'live';
--
-- Apply (prod): npx wrangler d1 execute labor-dashboard-db --remote --command="$(cat migration-085.sql)"
-- Confirm (read-only):
--   SELECT (SELECT COUNT(*) FROM businesses WHERE id='live') AS biz,
--          (SELECT COUNT(*) FROM business_units WHERE business_id='live') AS units,
--          (SELECT COUNT(*) FROM user_grants WHERE business_id='live') AS grants;
--   → 1 | 4 | number of active admins

INSERT OR IGNORE INTO businesses (id, name, unit_noun, source, active)
VALUES ('live', 'Live Sales', 'store', 'whatnot+auction', 1);

INSERT OR IGNORE INTO business_units (id, business_id, code, name, active) VALUES
  ('live-BL1',  'live', 'BL1',  'Coliseum',     1),
  ('live-BL2',  'live', 'BL2',  'South Bend',   1),
  ('live-BL14', 'live', 'BL14', 'Battle Creek', 1),
  ('live-BL16', 'live', 'BL16', 'Indy East',    1);

INSERT INTO user_grants (user_id, business_id, role, units)
SELECT u.id, 'live', 'admin', NULL
  FROM users u
 WHERE u.role = 'admin'
   AND u.status = 'active'
ON CONFLICT(user_id, business_id) DO NOTHING;
