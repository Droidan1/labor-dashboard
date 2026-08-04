-- migration-030: the grant model — businesses, their units, and who may reach them.
--
-- Step 1 of tasks/multi-business-permissions.md. Creates the tables and
-- backfills every existing user as a single Bargain Lane grant, so nothing
-- changes for anyone. The worker still reads users.role and users.stores at
-- this point; migration-030 only makes the grant data exist.
--
-- ✅ SAFE TO RUN — these are NEW tables. The D1 cascade trap
-- ([[d1-table-rebuild-cascade]], migration-029) only applies when REBUILDING an
-- existing table that others reference. Nothing is dropped here.
--
-- ⚠️ user_grants becomes the FIFTH table cascading off users, joining sessions,
-- push_subscriptions, notification_preferences and supply_requests. Any future
-- rebuild of `users` must snapshot and restore this one too.
--
-- ⚠️ `users.id` is TEXT ('usr_…'), not INTEGER. The schema sketch in the plan
-- doc said INTEGER; it was wrong. Foreign keys here are TEXT to match.

-- ── businesses ─────────────────────────────────────────────────────────────
-- Adding a business is an INSERT, not a deploy. `unit_noun` is what this
-- business calls its units — the schema stays generic, the UI reads specific.
CREATE TABLE IF NOT EXISTS businesses (
  id         TEXT PRIMARY KEY,          -- 'bl', 'ecom'
  name       TEXT NOT NULL,             -- 'Bargain Lane'
  unit_noun  TEXT NOT NULL,             -- 'store' | 'storefront' | 'channel'
  source     TEXT,                      -- 'clover' | 'sellercloud'
  active     INTEGER NOT NULL DEFAULT 1
);

-- ── business_units ─────────────────────────────────────────────────────────
-- Stores, storefronts, channels, accounts — all the same slot.
-- `id` is deliberately the store code so the users.stores backfill below is a
-- straight copy with no JSON rewriting. UNIQUE(business_id, code) catches a
-- collision if a future business ever reuses a code.
CREATE TABLE IF NOT EXISTS business_units (
  id          TEXT PRIMARY KEY,         -- 'BL1'
  business_id TEXT NOT NULL REFERENCES businesses(id),
  code        TEXT NOT NULL,            -- 'BL1'
  name        TEXT NOT NULL,            -- 'Coliseum'
  active      INTEGER NOT NULL DEFAULT 1,
  UNIQUE(business_id, code)
);

-- ── user_grants ────────────────────────────────────────────────────────────
-- The whole model: this person, in this business, with this role, over these
-- units. A user may hold several — that is what absorbs businesses nobody has
-- planned yet.
--
-- `superuser` is deliberately NOT a grantable role. It is a flag on the user
-- meaning every business, every unit, always; spelling that out as rows would
-- need backfilling every time a business is added. Grant resolution therefore
-- has to special-case superuser — a superuser holds ZERO grants and still sees
-- everything.
CREATE TABLE IF NOT EXISTS user_grants (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  role        TEXT NOT NULL CHECK(role IN ('admin','executive','manager','staff')),
  units       TEXT,                     -- JSON array of unit ids; NULL = all units
  PRIMARY KEY (user_id, business_id)
);

CREATE INDEX IF NOT EXISTS idx_user_grants_user ON user_grants(user_id);

-- ── seed: the one business that actually exists ────────────────────────────
-- E-Commerce is NOT seeded. It has no SellerCloud credentials, so it cannot
-- serve data and nobody could usefully be granted it. It gets one INSERT the
-- day it is real — which is the point of the design.
INSERT OR IGNORE INTO businesses (id, name, unit_noun, source, active)
VALUES ('bl', 'Bargain Lane', 'store', 'clover', 1);

-- Retired Wyoming (BL12) is deliberately absent: no user references it, and it
-- is not a store anyone manages. WRS still shows its frozen history, which
-- reads daily_sales directly and does not consult this table.
INSERT OR IGNORE INTO business_units (id, business_id, code, name) VALUES
  ('BL1',  'bl', 'BL1',  'Coliseum'),
  ('BL2',  'bl', 'BL2',  'South Bend'),
  ('BL4',  'bl', 'BL4',  'Dupont'),
  ('BL8',  'bl', 'BL8',  'Holland'),
  ('BL14', 'bl', 'BL14', 'Battle Creek'),
  ('BL16', 'bl', 'BL16', 'Indy East');

-- ── backfill: everyone becomes one Bargain Lane grant ──────────────────────
-- role carries over as-is, and users.stores maps straight onto units because
-- unit ids ARE the store codes. NULL stays NULL and still means "all units".
-- Superusers are excluded on purpose (see above).
INSERT OR IGNORE INTO user_grants (user_id, business_id, role, units)
SELECT id, 'bl', role, stores
  FROM users
 WHERE role <> 'superuser';

-- Verify after applying:
--   SELECT COUNT(*) FROM user_grants;                     -- = non-superuser users
--   SELECT COUNT(*) FROM users WHERE role <> 'superuser'; -- must match
--   SELECT g.role, COUNT(*) FROM user_grants g GROUP BY g.role;
--   -- every granted unit must exist:
--   SELECT COUNT(*) FROM user_grants g, json_each(g.units) j
--    WHERE g.units IS NOT NULL
--      AND j.value NOT IN (SELECT id FROM business_units);   -- must be 0
