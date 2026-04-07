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
