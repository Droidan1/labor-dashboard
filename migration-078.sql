-- Shared public website content and Buffer delivery records.
-- Apply to staging first. Existing marketing photos/drafts remain authoritative.
CREATE TABLE IF NOT EXISTS website_campaigns (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  department TEXT NOT NULL,
  discount INTEGER NOT NULL CHECK(discount BETWEEN 1 AND 99),
  stores TEXT NOT NULL,
  photo_id INTEGER REFERENCES marketing_photos(id),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','archived')),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_website_campaign_window ON website_campaigns(status, starts_at, ends_at);
CREATE TABLE IF NOT EXISTS website_photo_sets (
  id TEXT PRIMARY KEY,
  store TEXT NOT NULL,
  title TEXT NOT NULL,
  photo_ids TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','archived')),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_website_photo_window ON website_photo_sets(store, status, starts_at, ends_at);
CREATE TABLE IF NOT EXISTS website_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS buffer_channels (
  store TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  service TEXT NOT NULL CHECK(service IN ('facebook','instagram','googlebusiness','threads')),
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(store, channel_id)
);
CREATE TABLE IF NOT EXISTS buffer_outbox (
  id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE,
  draft_id INTEGER NOT NULL REFERENCES marketing_drafts(id),
  channel_id TEXT NOT NULL,
  store TEXT NOT NULL,
  text TEXT NOT NULL,
  assets TEXT NOT NULL,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','submitting','scheduled','failed','needs_review','cancelled')),
  buffer_post_id TEXT,
  last_error TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(draft_id, channel_id, due_at)
);
CREATE INDEX IF NOT EXISTS idx_buffer_outbox_status ON buffer_outbox(status, created_at);
