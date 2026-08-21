-- migration-042: Merchandising criteria become THREE levels — chain, L2, L3.
--
-- migration-041 keyed criteria on L3 alone, which put 82 rows on the page: every
-- Clover category, nearly all of them carrying the chain defaults unchanged. Brian's
-- call after seeing it is that the table should show the 10 L2 categories, and a
-- specific L3 should get a row only when it needs to break from its parent.
--
-- So a cell now resolves by walking UP: the L3's own value, else its L2's, else the
-- chain default. `level` says which kind of row it is and `category` carries the key:
--
--   level='chain'  category IS NULL                    -- one row per field
--   level='l2'     category='Consumable Food'          -- an L2 bucket from L3_TO_L2
--   level='l3'     category='FG BL CONSUMABLES - ...'  -- a specific Clover category
--
-- shelf_counts.l3 becomes shelf_counts.category for the same reason: what a manager is
-- asked to count follows wherever the `core` flag was set, which may now be an L2.
--
-- ⚠️ THIS DROPS AND RECREATES. Safe ONLY because both tables are empty — verified 0 rows
-- on prod and staging immediately before applying, and nothing has been published, so
-- there is no criteria version anyone's manifest was scored under. It would NOT be safe
-- to re-run this once v1 exists; it would take the published history with it.
--
-- Apply staging then prod:
--   npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-042.sql
--   npx wrangler d1 execute labor-dashboard-db         --remote --file=migration-042.sql

DROP TABLE IF EXISTS merch_criteria;
DROP TABLE IF EXISTS shelf_counts;

CREATE TABLE IF NOT EXISTS merch_criteria (
  version    INTEGER NOT NULL,
  level      TEXT NOT NULL,                -- chain | l2 | l3
  category   TEXT,                         -- NULL at chain level
  field      TEXT NOT NULL,
  value      TEXT,
  note       TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

-- One chain default per field per version. Partial, because SQLite treats NULLs as
-- distinct and a plain UNIQUE over a nullable column would not dedupe the chain row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_merchcrit_chain
  ON merch_criteria(version, field) WHERE level = 'chain';
-- One value per category per field. L2 names and L3 keys cannot collide, so the level
-- does not need to be part of the key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_merchcrit_cat
  ON merch_criteria(version, category, field) WHERE level <> 'chain';
-- Resolving a version reads every row for it.
CREATE INDEX IF NOT EXISTS idx_merchcrit_version ON merch_criteria(version, level, category);

CREATE TABLE IF NOT EXISTS shelf_counts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  store       TEXT NOT NULL,
  week_ending TEXT NOT NULL,               -- YYYY-MM-DD, Sunday-anchored
  category    TEXT NOT NULL,               -- an L2, an L3, or an '__other__:<L2>' bucket
  bays        REAL NOT NULL,               -- end cap counts as 1 bay
  entered_by  TEXT,
  entered_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shelfcount_store ON shelf_counts(store, week_ending, category, id);
CREATE INDEX IF NOT EXISTS idx_shelfcount_week  ON shelf_counts(week_ending, store);
