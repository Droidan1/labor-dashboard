-- migration-029: widen the user role set, and add a display-only job title.
--
-- WHY A TABLE REBUILD: `role` is constrained by a CHECK, and SQLite cannot
-- ALTER a CHECK in place. The whole table has to be recreated and copied.
-- This is the migration both permission plans converge on, so it does the
-- work for both at once rather than rebuilding `users` twice:
--   tasks/multi-business-permissions.md  → adds 'executive', retires 'district_manager'
--   tasks/projects-tasks-permissions.md  → adds 'staff', adds `title`
--
-- 🛑 FOUR TABLES CASCADE-DELETE FROM users:
--      sessions · push_subscriptions · notification_preferences · supply_requests
--    With foreign keys enforced, `DROP TABLE users` runs an implicit DELETE
--    that FIRES THOSE CASCADES — taking every session, push subscription,
--    notification preference and SUPPLY REQUEST with it, including the `cost`
--    values the Budget tab sums.
--
--    ⚠️ `PRAGMA defer_foreign_keys` DOES NOT PREVENT THIS. It defers constraint
--    *checking*; ON DELETE CASCADE is an *action* and still fires immediately.
--    Measured, not assumed: with defer_foreign_keys the harness recorded
--    sessions 2→0, push_subscriptions 1→0, notification_preferences 1→0.
--
--    The documented SQLite table-rebuild procedure is used instead:
--    `PRAGMA foreign_keys = OFF` OUTSIDE any transaction, rebuild, then ON.
--    Do not wrap the PRAGMAs in the transaction — they are no-ops inside one.
--
-- ROLE CHANGES
--   district_manager → manager. They are the same role today: every permission
--   check that names district_manager also names manager and treats them
--   identically (worker.js validRoles, the allowed-roles list, supply-request
--   nav visibility, store validation). The only difference was how many stores
--   each was given, which is already carried by `stores`. The old distinction
--   is preserved as a job title so nothing is lost from the org chart.
--
--   executive — reads everything in scope, changes nothing.
--   staff     — retail leads/associates: tasks only, never sales or cost.
--
-- `title` is DISPLAY ONLY and carries no permission. It exists so two job
-- titles can share one capability bundle instead of forcing a new role.

PRAGMA foreign_keys = OFF;

BEGIN;

CREATE TABLE users_new (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL CHECK(role IN ('superuser','admin','executive','manager','staff')),
  stores     TEXT,        -- JSON array e.g. '["BL1","BL4"]'; NULL = all stores
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

COMMIT;

PRAGMA foreign_keys = ON;

-- The UNIQUE on email is recreated by the table definition above; the implicit
-- index comes with it. No other index existed on users.
--
-- Verify after applying (all four must be non-zero if they were before):
--   SELECT role, COUNT(*) FROM users GROUP BY role;
--   SELECT COUNT(*) FROM sessions;
--   SELECT COUNT(*) FROM push_subscriptions;
--   SELECT COUNT(*) FROM notification_preferences;
--   SELECT COUNT(*), SUM(cost) FROM supply_requests WHERE status='ordered';
