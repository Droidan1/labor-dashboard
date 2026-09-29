-- migration-075: saved signs. Sign Studio's folders, by sign type and then by month.
--
-- Brian, 2026-09-29: "Let's create folders for managers to save signs. Have them organized by
-- sign type and then subfolders organized by date. Manager can only see their signs but admin
-- signs are saved to all stores in it's own folder that all managers see."
--
-- His answers, the same day:
--   - A manager sees ONLY the signs they saved, plus the shared All stores folder. District
--     managers are managers, so the same.
--   - Admins and superusers see ONLY All stores, and everything they save goes there.
--   - Date subfolders are by MONTH, in Eastern time.
--   - Opening a saved sign, changing it and saving makes a NEW sign. No saved row is ever
--     rewritten; the only later write is the soft delete.
--
-- ── Why each column is what it is ─────────────────────────────────────────────────────────
--
-- id           The CLIENT's crypto.randomUUID(), minted when the manager first taps Save and
--              reused on every retry. It is the idempotency key the PRD asks for, and it has
--              to be a database constraint, not a read-then-write check: see "Five copies in
--              one store" (tasks/lessons.md). The worker inserts with ON CONFLICT(id) DO
--              NOTHING and then re-reads the row, because D1's meta.changes is not trusted
--              in this codebase (worker.js, the ebay_cases sweep).
-- owner_id     users.id of the person whose session saved it: the ACCESS key. Not the email:
--              an account deleted and invited again gets a new id, so its old private signs
--              stay private. No FOREIGN KEY to users, and no ON DELETE CASCADE: rebuilding
--              users would take child rows with it (migration-029's header).
-- owner_email  Display only: "saved by" on All stores rows.
-- scope        'own' | 'all'. Decided by the WORKER from the saver's role, never read from a
--              request: manager → 'own', admin or superuser → 'all'. No CHECK constraint on an
--              enum-like column (migration-062's header); the worker is the gate.
-- template     'price' | 'pct' | 'uvt': the type folder.
-- saved_month  'YYYY-MM', Eastern, of saved_at: the month folder. Stored rather than derived,
--              because SQLite's date functions work in UTC, and 8pm Eastern on the last day of a
--              month is already the next month in UTC.
-- sign_json    The sign as the worker validated it (normalizeSign's exact shape).
-- design_version  The sign design the page was running when it was saved, for audit. A
--              reprint always uses the current design (PRD).
-- saved_at     ISO-8601 UTC.
-- deleted_at, deleted_by   Soft delete. A deleted sign leaves every list and count but stays
--              on the row, so a delete can be undone by hand and audited.
--
-- ── The indexes ──────────────────────────────────────────────────────────────────────────
--
-- One per folder family, each PARTIAL on live rows of its scope. SQLite uses a partial index
-- only when it can see that the query's WHERE implies the index's. The worker's queries spell
-- `scope = 'own'` / `scope = 'all'` and `deleted_at IS NULL` as literals, so that holds
-- whatever the engine does with bound values. (SQLite 3.51 re-plans a bound `scope = ?` once
-- the value is known, and uses the index then too. Measured 29 Sep; nothing here relies on
-- it.) saved_at is ASCENDING in both: the list's `ORDER BY saved_at DESC, rowid DESC` walks
-- the index backwards with no sort step. scripts/test-migration-075.mjs checks the plans.
--
-- ── Apply ────────────────────────────────────────────────────────────────────────────────
-- Address databases by UUID; the staging one lives under [env.staging] and a bare name does
-- not resolve. STAGING FIRST:
--   staging:     npx wrangler d1 execute b40982c2-4009-4842-bc17-fa0977468b07 --remote -y --file=migration-075.sql
--   production:  npx wrangler d1 execute 3fa911d7-31d6-438c-985f-7ac08c407d2d --remote -y --file=migration-075.sql
--
-- Confirm it landed (expects 11 rows, id first and deleted_by last):
--   npx wrangler d1 execute <uuid> --remote -y --json \
--     --command="SELECT name FROM pragma_table_info('saved_signs') ORDER BY cid"
-- and the two indexes (expects idx_saved_signs_all and idx_saved_signs_own; `sql IS NOT NULL`
-- leaves out sqlite_autoindex_saved_signs_1, the primary key's own index):
--   npx wrangler d1 execute <uuid> --remote -y --json \
--     --command="SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'saved_signs' AND sql IS NOT NULL ORDER BY name"
--
-- RE-RUNNABLE: every statement is IF NOT EXISTS, so a second run changes nothing.
--
-- 🔑 DEPLOY ORDER: THIS FIRST, THEN THE WORKER, THEN THE FRONTEND (CLAUDE.md rule 6). The new
-- worker's saved-sign actions read and write this table, and nothing calls them until the
-- frontend ships. A table the live worker never names is invisible to it, so applying this
-- while the current worker runs is safe.
--
-- 🔑 ADDITIVE ONLY. One new, empty table and its two indexes. No existing table or row is read,
-- rewritten or deleted.

CREATE TABLE IF NOT EXISTS saved_signs (
  id             TEXT PRIMARY KEY,
  owner_id       TEXT NOT NULL,
  owner_email    TEXT NOT NULL,
  scope          TEXT NOT NULL,
  template       TEXT NOT NULL,
  saved_month    TEXT NOT NULL,
  sign_json      TEXT NOT NULL,
  design_version INTEGER NOT NULL,
  saved_at       TEXT NOT NULL,
  deleted_at     TEXT,
  deleted_by     TEXT
);

-- A manager's own folders: counts per type and month, and one folder's signs, newest first.
CREATE INDEX IF NOT EXISTS idx_saved_signs_own
  ON saved_signs (owner_id, template, saved_month, saved_at)
  WHERE scope = 'own' AND deleted_at IS NULL;

-- All stores: the same, without an owner.
CREATE INDEX IF NOT EXISTS idx_saved_signs_all
  ON saved_signs (template, saved_month, saved_at)
  WHERE scope = 'all' AND deleted_at IS NULL;
