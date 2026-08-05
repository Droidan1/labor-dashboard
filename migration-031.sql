-- migration-031: seed the E-Commerce business row.
--
-- Purely additive: one INSERT OR IGNORE into `businesses`. No table is rebuilt,
-- so the D1 cascade trap that bit migration-029 does not apply here. Rollback is
-- `DELETE FROM businesses WHERE id = 'ecom';` — safe while it has no units and
-- no grants, which is exactly the state this migration leaves it in.
--
-- Why seed it before SellerCloud is connected: the landing page renders from
-- this table. With only 'bl' present the picker can never show a second card, so
-- the multi-business layout would stay unexercised until the day it matters
-- most. Seeding it now makes "E-Commerce exists but isn't connected yet" a real,
-- visible state rather than a hypothetical.
--
-- 🔑 It gets NO business_units and NO user_grants. Both are deliberate:
--    - 0 units  → the card renders as "not connected" (unitCount drives that).
--    - 0 grants → nobody's grant count changes, so every existing user still
--      holds exactly one grant and still routes straight to the BL dashboard.
--      Only the superuser (who holds no grants and sees all businesses) reaches
--      the picker. Connecting SellerCloud later is an INSERT, not a migration.
--
-- id is 'ecom' to match the example in migration-030's own schema comment.

INSERT OR IGNORE INTO businesses (id, name, unit_noun, source, active)
VALUES ('ecom', 'E-Commerce', 'storefront', 'sellercloud', 1);
