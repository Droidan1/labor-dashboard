-- migration-093: Bin Preview + store settings for the Bargain Lane website pilot (Phase 1a).
-- Plan: docs/plans/bargainlane-website.md §4.1. Additive only (five new tables, no ALTER, no
-- foreign keys: a DROP of a parent cascades on D1 even with FKs off). Safe to run twice, but
-- 🛑 NOT after migration-094: it would bring back the one-per-day index that 094 replaced.
-- 🛑 NOT applied anywhere yet. Staging first, and only on Brian's say-so:
--   npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-093.sql
--   npx wrangler d1 execute labor-dashboard-db --remote --file=migration-093.sql

-- One row per store that has a public page. No row, or public = 0, means no page.
CREATE TABLE IF NOT EXISTS store_settings (
  store                 TEXT PRIMARY KEY,                       -- BL code
  tz                    TEXT NOT NULL DEFAULT 'America/New_York',
  profile_json          TEXT NOT NULL DEFAULT '{}',             -- displayName, address, phone, mapsUrl
  hours_json            TEXT NOT NULL DEFAULT '{}',             -- {"fri":{"open":"09:00","close":"21:00"}, ...}; a missing day is closed
  bin_prices_json       TEXT NOT NULL DEFAULT '{}',             -- {"fri":[{"from":"00:00","price":12},{"from":"14:00","price":9}], ...}
  preview_defaults_json TEXT NOT NULL DEFAULT '{}',             -- {"startDaysBefore":1,"startTime":"12:00"}
  public                INTEGER NOT NULL DEFAULT 0,             -- 1 = served at /public/v1/stores/<store>
  revision              INTEGER NOT NULL DEFAULT 1,             -- optimistic concurrency: a stale save is a 409
  updated_by            TEXT,
  updated_at            TEXT
);

-- A holiday or one-off day: replaces that date's hours and/or bin prices.
CREATE TABLE IF NOT EXISTS store_day_overrides (
  store            TEXT NOT NULL,
  date             TEXT NOT NULL,                               -- store-local YYYY-MM-DD
  closed           INTEGER NOT NULL DEFAULT 0,
  open             TEXT,                                        -- HH:MM, with close; NULL = the weekday's hours
  close            TEXT,
  bin_prices_json  TEXT,                                        -- NULL = the weekday's prices
  note             TEXT,                                        -- shown on the site ("Holiday hours")
  created_by       TEXT,
  created_at       TEXT NOT NULL,
  PRIMARY KEY (store, date)
);

-- A store's photos for one sale day. "scheduled", "live" and "expired" are never stored:
-- they are worked out from starts_at/ends_at on every read, so no cron shows or hides one.
CREATE TABLE IF NOT EXISTS bin_previews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  store         TEXT NOT NULL,
  sale_date     TEXT NOT NULL,                                  -- store-local YYYY-MM-DD
  photo_ids     TEXT NOT NULL DEFAULT '[]',                     -- JSON array of marketing_photos.id (bins, same store)
  caption       TEXT,
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','submitted','approved','rejected','pulled')),
  starts_at     TEXT,                                           -- UTC ISO, set at approval
  ends_at       TEXT,
  revision      INTEGER NOT NULL DEFAULT 1,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  submitted_by  TEXT,
  submitted_at  TEXT,
  reviewed_by   TEXT,
  reviewed_at   TEXT,
  review_note   TEXT,
  pulled_by     TEXT,
  pulled_at     TEXT,
  pull_reason   TEXT
);
-- At most one approved preview per store and sale day.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bin_previews_approved ON bin_previews(store, sale_date) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS idx_bin_previews_store ON bin_previews(store, status, ends_at);

-- Who did what to website content. Written in the same batch as the change it records.
CREATE TABLE IF NOT EXISTS content_audit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entity       TEXT NOT NULL,                                   -- bin_preview | store_settings | store_override
  entity_id    TEXT NOT NULL,
  action       TEXT NOT NULL,                                   -- save | submit | approve | reject | reschedule | pull | remove
  actor_id     TEXT,
  actor_email  TEXT,
  at           TEXT NOT NULL,
  detail_json  TEXT
);
CREATE INDEX IF NOT EXISTS idx_content_audit_entity ON content_audit(entity, entity_id, at);

-- One social draft per approved preview per channel. UNIQUE(preview_id, channel_key) is the
-- at-most-once guarantee: only the request that inserts the 'handing' row calls the adapter,
-- and a row whose outcome is unknown becomes 'needs_check' and is never sent again by itself.
CREATE TABLE IF NOT EXISTS social_drafts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  preview_id    INTEGER NOT NULL,
  channel_key   TEXT NOT NULL,                                  -- e.g. facebook:fortwayne, google:dupont
  status        TEXT NOT NULL CHECK (status IN ('handing','drafted','needs_check')),
  remote_id     TEXT,
  payload_hash  TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (preview_id, channel_key)
);
