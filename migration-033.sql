-- migration-033: give every existing admin an explicit E-Commerce grant.
--
-- Replaces a hidden branch with real rows. businessesFor() briefly listed every
-- business for `admin` as well as `superuser` (2026-08-05) so admins could reach
-- the landing picker. That was a widening: `admin` is a PER-BUSINESS role, so it
-- handed an admin of Bargain Lane sight of a business they held no grant for.
-- The branch is now gone; this preserves what those admins could already see,
-- but as grants that are auditable and revocable PER PERSON.
--
-- ⚠️ Numbered 033, not 032. The `staging` branch carries a Meta Boost migration
-- renumbered to 032 (it collided with main's 026). Taking 032 here would create
-- the same collision a second time.
--
-- ⚠️ CONSEQUENCE, accepted deliberately (Brian, 2026-08-05): these admins WILL
-- see real E-Commerce figures the day SellerCloud connects. To walk it back for
-- one person: DELETE FROM user_grants WHERE user_id = ? AND business_id = 'ecom';
--
-- Role is 'admin' within E-Commerce, mirroring their Bargain Lane role. units is
-- NULL, meaning "every unit" — E-Commerce has no business_units yet, so today it
-- resolves to nothing regardless.
--
-- Idempotent: ON CONFLICT DO NOTHING, so re-running writes zero rows. Scoped by
-- a subquery on users.role rather than hardcoded ids, so it cannot drift from
-- who is actually an admin at the time it runs.

INSERT INTO user_grants (user_id, business_id, role, units)
SELECT u.id, 'ecom', 'admin', NULL
  FROM users u
 WHERE u.role = 'admin'
   AND u.status = 'active'
ON CONFLICT(user_id, business_id) DO NOTHING;
