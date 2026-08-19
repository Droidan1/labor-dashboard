-- migration-041: Merchandising — buy criteria (versioned) + weekly shelf counts.
--
-- First tables of the Merchandising section (PRD-hub-merchandising-module.md). Two
-- independent things that will later meet on the Coverage scorecard:
--
--   1. buy criteria -- the versioned, per-category thresholds a buy is scored against,
--      and the source of the `core` flag that defines what "60% of the floor" means.
--   2. shelf counts -- what each store actually has on the floor this week, in bays.
--
-- ⚠️ `l3` here is the PRD's "L2". This repo's L2 is the 15-bucket Clover taxonomy
-- (Consumable Food, Seasonal, Hardlines...); the categories purchasing actually argues
-- about -- snacks, candy, coffee & tea -- are L3, all inside `Consumable Food`. Keying
-- on L2 would collapse the core flag to one boolean over all food. The Food/HBA/Household
-- grouping the PRD wants is derived from L3_TO_L2 at read time, not stored.
--
-- VERSIONING: a version with published_at IS NULL is the open DRAFT. Publishing stamps
-- published_at and the version becomes IMMUTABLE -- a manifest scored under v7 must still
-- read v7's numbers a year later, so writes to a published version are refused rather than
-- silently branched. There is no separate change-log table: the log is a diff between
-- consecutive versions, which cannot drift out of sync with the values themselves.
--
-- INHERITANCE: a row with l3 IS NULL is the chain default. A category inherits every field
-- it has no row for. Field-per-row rather than a wide table is what makes both the
-- inheritance and the diff trivial, and lets a new criterion ship without a migration.
--
-- shelf_counts is APPEND-ONLY: latest row per (store, week_ending, l3) wins. A corrected
-- count adds a row, never updates one -- the prior entry is the record of what the manager
-- first reported.
--
-- Additive. The CREATE statements are guarded, so this file IS safe to re-run.
-- Apply staging then prod:
--   npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-041.sql
--   npx wrangler d1 execute labor-dashboard-db         --remote --file=migration-041.sql

CREATE TABLE IF NOT EXISTS merch_criteria_versions (
  version      INTEGER PRIMARY KEY,
  published_at TEXT,                       -- NULL = the open draft
  published_by TEXT,
  note         TEXT,                       -- required to publish; why the thresholds moved
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merch_criteria (
  version    INTEGER NOT NULL,
  l3         TEXT,                         -- NULL = chain default row
  field      TEXT NOT NULL,                -- core | max_cost_pct_retail | min_margin_per_unit |
                                           -- price_cap_pct_retail | rounding |
                                           -- max_breakeven_sellthru | max_per_store |
                                           -- cash_back_days | note
  value      TEXT,
  note       TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

-- One value per (version, category, field). l3 IS NULL participates as its own key here
-- because SQLite treats NULLs as distinct in a UNIQUE index -- so the chain-default row is
-- de-duped by the partial index below instead.
CREATE UNIQUE INDEX IF NOT EXISTS idx_merchcrit_cell
  ON merch_criteria(version, l3, field) WHERE l3 IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_merchcrit_default
  ON merch_criteria(version, field) WHERE l3 IS NULL;
-- Resolving one version reads every row for it, in category order.
CREATE INDEX IF NOT EXISTS idx_merchcrit_version ON merch_criteria(version, l3);

CREATE TABLE IF NOT EXISTS shelf_counts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  store       TEXT NOT NULL,
  week_ending TEXT NOT NULL,               -- YYYY-MM-DD, Sunday-anchored
  l3          TEXT NOT NULL,               -- a Clover L3, or the '__other_food__' bucket
  bays        REAL NOT NULL,               -- end cap counts as 1 bay
  entered_by  TEXT,
  entered_at  TEXT NOT NULL
);

-- The form reads one store's current week and prefills from the week before.
CREATE INDEX IF NOT EXISTS idx_shelfcount_store ON shelf_counts(store, week_ending, l3, id);
-- The scorecard reads every store for a week at once.
CREATE INDEX IF NOT EXISTS idx_shelfcount_week  ON shelf_counts(week_ending, store);
