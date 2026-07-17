-- migration-021: Bin post composer (Slice 1b/1c).
-- marketing_thumbnails = admin-provided premade cover images (in R2).
-- marketing_drafts = a composed post (thumbnail cover + selected bin photos + caption).
-- marketing_publish_log = published FB post record.
-- Apply staging: npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-021.sql
-- Apply prod:    npx wrangler d1 execute labor-dashboard-db --remote --file=migration-021.sql

CREATE TABLE IF NOT EXISTS marketing_thumbnails (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT,
  r2_key        TEXT NOT NULL,
  content_type  TEXT,
  bytes         INTEGER,
  uploaded_by   TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mktthumb_active ON marketing_thumbnails(active, created_at);

CREATE TABLE IF NOT EXISTS marketing_drafts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  store          TEXT NOT NULL,
  thumbnail_id   INTEGER,
  photo_ids      TEXT,                                  -- JSON array of marketing_photos ids
  caption        TEXT,
  caption_source TEXT,                                  -- 'manual' | 'ai'
  status         TEXT NOT NULL DEFAULT 'draft',         -- draft|approved|published|rejected
  created_by     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_mktdraft_status ON marketing_drafts(status, created_at);

CREATE TABLE IF NOT EXISTS marketing_publish_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id    INTEGER,
  store       TEXT,
  page_id     TEXT,
  post_id     TEXT,
  post_url    TEXT,
  response    TEXT,
  status      TEXT,
  created_at  TEXT NOT NULL
);
