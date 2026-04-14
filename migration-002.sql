-- Sale Scheduler — one row per item per schedule group.
-- Apply with: npx wrangler d1 execute labor-dashboard-db --file=migration-002.sql --remote

CREATE TABLE IF NOT EXISTS sale_schedules (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_group  TEXT    NOT NULL,   -- ULID; groups items scheduled in one submit
  store           TEXT    NOT NULL,   -- BL1..BL14
  item_id         TEXT    NOT NULL,   -- Clover item ID
  item_name       TEXT,                -- captured at schedule time for audit
  discount_kind   TEXT    NOT NULL,   -- 'percent' | 'amount'
  discount_value  REAL    NOT NULL,   -- 20 (for 20%) or 150 (for 150 cents off)
  original_price  INTEGER,             -- cents; filled at activation
  sale_price      INTEGER,             -- cents; filled at activation
  starts_at       TEXT    NOT NULL,   -- ISO-8601 UTC
  ends_at         TEXT    NOT NULL,   -- ISO-8601 UTC
  status          TEXT    NOT NULL,   -- pending|active|completed|cancelled|error
  activated_at    TEXT,
  reverted_at     TEXT,
  error_msg       TEXT,
  created_at      TEXT    NOT NULL,
  UNIQUE(store, item_id, schedule_group)
);

CREATE INDEX IF NOT EXISTS idx_sale_schedules_pending
  ON sale_schedules(status, starts_at);

CREATE INDEX IF NOT EXISTS idx_sale_schedules_active
  ON sale_schedules(status, ends_at);

CREATE INDEX IF NOT EXISTS idx_sale_schedules_group
  ON sale_schedules(schedule_group);
