CREATE TABLE IF NOT EXISTS daily_sales (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  store        TEXT NOT NULL,
  date         TEXT NOT NULL,
  total        REAL,
  retail       REAL,
  bin          REAL,
  order_count  INTEGER,
  avg_cart     REAL,
  avg_items    REAL,
  avg_txn_sec  INTEGER,
  snapshot_time TEXT,
  UNIQUE(store, date)
);

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key_cose TEXT NOT NULL,
  sign_count  INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL,
  last_used   TEXT,
  device_name TEXT DEFAULT 'This device'
);
