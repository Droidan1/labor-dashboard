CREATE TABLE IF NOT EXISTS bin_dumps (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  store          TEXT NOT NULL,
  barcode        TEXT,
  item_no        TEXT,
  pallet_name    TEXT,
  po             TEXT,
  units          INTEGER,
  created_by_tag TEXT,
  truck_no       TEXT,
  r2_key         TEXT,
  content_type   TEXT,
  logged_by      TEXT NOT NULL,
  logged_at      TEXT NOT NULL,
  edited_by      TEXT,
  edited_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_bin_dumps_store ON bin_dumps(store, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_bin_dumps_po ON bin_dumps(store, po, logged_at DESC);
