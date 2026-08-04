-- migration-029: widen the user role set, and add a display-only job title.
--
-- WHY A TABLE REBUILD: `role` is constrained by a CHECK, and SQLite cannot
-- ALTER a CHECK in place. The whole table has to be recreated and copied.
-- This is the migration both permission plans converge on, so it does the
-- work for both at once rather than rebuilding `users` twice:
--   tasks/multi-business-permissions.md  → adds 'executive', retires 'district_manager'
--   tasks/projects-tasks-permissions.md  → adds 'staff', adds `title`
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🛑 WHY THIS FILE LOOKS LIKE THIS — four tables cascade off users:
--      sessions · push_subscriptions · notification_preferences · supply_requests
--    all declared ON DELETE CASCADE. `DROP TABLE users` runs an implicit
--    DELETE that FIRES those cascades, taking every session, push
--    subscription, notification preference and SUPPLY REQUEST with it —
--    including the `cost` the Budget tab sums.
--
--    Neither PRAGMA escape works on D1. Both were MEASURED, not assumed:
--      · `PRAGMA foreign_keys = OFF` — D1 rejects the file outright
--        (`D1_RESET_DO`, "import polling failed"). It is not settable.
--      · `PRAGMA defer_foreign_keys = true` — accepted, but does NOT stop the
--        cascade. It defers constraint *checking*; ON DELETE CASCADE is an
--        *action* and still fires. Proven on staging with a throwaway
--        parent/child pair: child rows went 1 → 0 either way.
--
--    So the child rows are snapshotted before the rebuild and restored after.
--    `CREATE TABLE ... AS SELECT` produces a plain table with no foreign key,
--    which is exactly what is needed to hold them across the DROP.
--
--    Do NOT add PRAGMA lines to this file, and do NOT add an explicit
--    BEGIN/COMMIT — D1 runs the file in its own transaction and an explicit
--    one makes it fail.
-- ══════════════════════════════════════════════════════════════════════════
--
-- ROLE CHANGES
--   district_manager → manager. They are the same role today: every permission
--   check that names district_manager also names manager and treats them
--   identically. The only difference was how many stores each was given, which
--   `stores` already carries. The distinction is preserved as a job title.
--   executive — reads everything in scope, changes nothing.
--   staff     — retail leads/associates: tasks only, never sales or cost.
--
-- `title` is DISPLAY ONLY and carries no permission.

-- ── 1. hold the child rows somewhere without a foreign key ────────────────
DROP TABLE IF EXISTS _m029_sessions;
DROP TABLE IF EXISTS _m029_push;
DROP TABLE IF EXISTS _m029_prefs;
DROP TABLE IF EXISTS _m029_supply;

CREATE TABLE _m029_sessions AS SELECT * FROM sessions;
CREATE TABLE _m029_push     AS SELECT * FROM push_subscriptions;
CREATE TABLE _m029_prefs    AS SELECT * FROM notification_preferences;
CREATE TABLE _m029_supply   AS SELECT * FROM supply_requests;

-- ── 2. rebuild users (the cascade empties the four child tables here) ─────
CREATE TABLE users_new (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL CHECK(role IN ('superuser','admin','executive','manager','staff')),
  stores     TEXT,        -- JSON array e.g. '["BL1","BL4"]', NULL = all stores
  status     TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  title      TEXT,        -- display only, e.g. 'Assistant Manager'. NO permission.
  created_at TEXT NOT NULL,
  last_login TEXT
);

INSERT INTO users_new (id, email, role, stores, status, title, created_at, last_login)
SELECT
  id,
  email,
  CASE WHEN role = 'district_manager' THEN 'manager' ELSE role END,
  stores,
  status,
  CASE WHEN role = 'district_manager' THEN 'District Manager' ELSE NULL END,
  created_at,
  last_login
FROM users;

DROP TABLE users;

ALTER TABLE users_new RENAME TO users;

-- ── 3. put the child rows back ────────────────────────────────────────────
INSERT INTO sessions                 SELECT * FROM _m029_sessions;
INSERT INTO push_subscriptions       SELECT * FROM _m029_push;
INSERT INTO notification_preferences SELECT * FROM _m029_prefs;
INSERT INTO supply_requests          SELECT * FROM _m029_supply;

DROP TABLE _m029_sessions;
DROP TABLE _m029_push;
DROP TABLE _m029_prefs;
DROP TABLE _m029_supply;

-- Verify after applying — every count must match what it was before:
--   SELECT role, COUNT(*) FROM users GROUP BY role;
--   SELECT (SELECT COUNT(*) FROM sessions) sessions,
--          (SELECT COUNT(*) FROM push_subscriptions) push,
--          (SELECT COUNT(*) FROM notification_preferences) prefs,
--          (SELECT COUNT(*) FROM supply_requests) supply,
--          (SELECT COALESCE(SUM(cost),0) FROM supply_requests WHERE status='ordered') cost;
--   SELECT COUNT(*) FROM sqlite_master WHERE name LIKE '_m029_%';  -- must be 0
