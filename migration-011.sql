-- Migration 011: Supply Request System
-- Apply with: npx wrangler d1 execute labor-dashboard-db --remote --file=migration-011.sql

-- Request header: one row per submission
CREATE TABLE IF NOT EXISTS supply_requests (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_email      TEXT NOT NULL,
  store           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',   -- pending | under_review | on_hold | ordered
  priority        TEXT NOT NULL DEFAULT 'normal',    -- normal | urgent
  invoice_number  TEXT,
  cost            REAL,
  notes           TEXT,
  submitted_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Line items per request
CREATE TABLE IF NOT EXISTS supply_request_items (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL REFERENCES supply_requests(id) ON DELETE CASCADE,
  category    TEXT NOT NULL DEFAULT 'Other',   -- Cleaning | Office | Fixtures | Safety | Other
  item_name   TEXT NOT NULL,
  quantity    INTEGER NOT NULL DEFAULT 1,
  unit        TEXT NOT NULL DEFAULT 'units',   -- boxes | packs | rolls | units | cases | bags
  notes       TEXT
);

-- Audit trail: status changes AND comments on a request
CREATE TABLE IF NOT EXISTS supply_request_history (
  id               TEXT PRIMARY KEY,
  request_id       TEXT NOT NULL REFERENCES supply_requests(id) ON DELETE CASCADE,
  type             TEXT NOT NULL DEFAULT 'status_change',  -- status_change | comment
  changed_by_id    TEXT NOT NULL,
  changed_by_email TEXT NOT NULL,
  old_status       TEXT,
  new_status       TEXT,
  note             TEXT,
  changed_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Monthly budget per store, set by superuser
CREATE TABLE IF NOT EXISTS supply_budgets (
  store   TEXT    NOT NULL,
  year    INTEGER NOT NULL,
  month   INTEGER NOT NULL,
  budget  REAL    NOT NULL DEFAULT 0,
  PRIMARY KEY (store, year, month)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_supply_requests_store     ON supply_requests(store);
CREATE INDEX IF NOT EXISTS idx_supply_requests_user      ON supply_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_supply_requests_status    ON supply_requests(status);
CREATE INDEX IF NOT EXISTS idx_supply_request_items_req  ON supply_request_items(request_id);
CREATE INDEX IF NOT EXISTS idx_supply_request_history_req ON supply_request_history(request_id);
