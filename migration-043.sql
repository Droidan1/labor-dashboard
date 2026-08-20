-- migration-043: Manifest Scorer — vendor manifests, their lines, and the caches.
--
-- A vendor sends a spreadsheet; this turns it into a scored decision. The tables here
-- cover the Hub-only slice: ingest, classification, our own ASP, and scoring against a
-- published criteria version. The retail-lookup columns exist but stay NULL until the
-- TinyFish slice fills them — declaring them now means that slice needs no migration and
-- an already-scored manifest keeps its shape.
--
-- ⚠️ SCORED-UNDER IS A PROMISE. `manifests.criteria_version` records which immutable
-- criteria version produced a verdict, and `scored_without_retail` records that the
-- verdict was reached with no street price — a manifest scored today is scored against
-- OUR average selling price, not retail, and must never be read back as though it were
-- the same test. Re-scoring is an explicit action that writes a new version stamp.
--
-- `item_cache` is keyed by the identifier as it appeared on the manifest (a UPC, a model
-- number, or a vendor SKU) with its type alongside, because a bare UPC key cannot hold
-- the model-numbered big-ticket lines the appliance test was full of.
--
-- Additive. Guarded, so this file IS safe to re-run.
-- Apply staging then prod:
--   npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-043.sql
--   npx wrangler d1 execute labor-dashboard-db         --remote --file=migration-043.sql

CREATE TABLE IF NOT EXISTS manifests (
  id                    TEXT PRIMARY KEY,       -- random hex
  vendor                TEXT NOT NULL,
  filename              TEXT,
  uploaded_by           TEXT,
  uploaded_at           TEXT NOT NULL,
  sell_as               TEXT NOT NULL DEFAULT 'each',   -- each | case
  units_per_case        INTEGER NOT NULL DEFAULT 12,
  criteria_version      INTEGER,                -- the version the verdict was reached under
  scored_at             TEXT,
  scored_without_retail INTEGER NOT NULL DEFAULT 1,     -- 1 until the retail slice lands
  status                TEXT NOT NULL DEFAULT 'draft',  -- draft|scored|approved|approved_edits|passed
  decision_note         TEXT,
  decided_by            TEXT,
  decided_at            TEXT,
  load_id               TEXT                    -- → buy tracker, later
);

CREATE INDEX IF NOT EXISTS idx_manifest_recent ON manifests(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_manifest_vendor ON manifests(vendor, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS manifest_lines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id     TEXT NOT NULL,
  row_no          INTEGER NOT NULL,
  identifier      TEXT,
  identifier_type TEXT,                         -- upc | model | vendor_sku | none
  description     TEXT,
  qty             REAL,
  uom             TEXT,
  cost            REAL,                         -- per the manifest's own unit
  msrp            REAL,                         -- identifies the item; NOT trusted as retail (R6)
  vendor_claimed_retail REAL,                   -- stored to contradict, never to use (R7)
  units_per_case  INTEGER,                      -- per-line override of the manifest default
  l2              TEXT,
  l3              TEXT,
  l3_source       TEXT,                         -- cache | claude | manual
  asp_l3          REAL,                         -- our average selling price, L28D
  velocity_l3     REAL,                         -- chain units/day, for days-to-clear
  suggested_price REAL,
  suggested_source TEXT,                        -- rule | manual
  -- Filled by the retail slice; NULL means "not looked up", never "no retail found".
  retail_price      REAL,
  retail_source     TEXT,
  retail_basis      TEXT,                       -- single|multipack_div_n|per_oz_scaled|same_line|msrp
  retail_confidence TEXT,
  retail_in_stock   INTEGER,
  retail_url        TEXT,
  flags           TEXT                          -- JSON array
);

CREATE INDEX IF NOT EXISTS idx_mline_manifest ON manifest_lines(manifest_id, row_no);
CREATE INDEX IF NOT EXISTS idx_mline_ident    ON manifest_lines(identifier);

-- A vendor's column layout, remembered so the second manifest from them maps itself.
CREATE TABLE IF NOT EXISTS vendor_templates (
  vendor                 TEXT PRIMARY KEY,
  column_map             TEXT NOT NULL,         -- JSON: canonical field → source header
  sell_as_default        TEXT,
  units_per_case_default INTEGER,
  updated_by             TEXT,
  updated_at             TEXT NOT NULL
);

-- What we have learned about an item, so the second manifest carrying it costs nothing
-- to classify and keeps any correction a human made.
CREATE TABLE IF NOT EXISTS item_cache (
  identifier      TEXT NOT NULL,
  identifier_type TEXT NOT NULL,
  brand           TEXT,
  title           TEXT,
  size            TEXT,
  l2              TEXT,
  l3              TEXT,
  l3_source       TEXT,                         -- claude | manual
  suggested_price_override REAL,
  -- Retail slice fills these.
  retail_price      REAL,
  retail_source     TEXT,
  retail_basis      TEXT,
  retail_confidence TEXT,
  retail_in_stock   INTEGER,
  retail_url        TEXT,
  fetched_at        TEXT,
  updated_by      TEXT,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (identifier, identifier_type)
);
