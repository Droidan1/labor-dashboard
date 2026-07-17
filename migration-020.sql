-- migration-020: Marketing intake (Slice 1a).
-- marketing_photos = one row per submitted photo (original stored in R2).
-- facebook_page_targets = store -> Facebook Page to publish to (reversed from
-- worker STORE_BY_PAGE; Coliseum + Dupont share the main brand page).
-- Apply staging: npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-020.sql
-- Apply prod:    npx wrangler d1 execute labor-dashboard-db --remote --file=migration-020.sql

CREATE TABLE IF NOT EXISTS marketing_photos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  store         TEXT NOT NULL,                 -- BL1..BL16
  photo_type    TEXT NOT NULL,                 -- retail|bins|event|team|other
  r2_key        TEXT NOT NULL,                 -- object key in the MEDIA bucket
  content_type  TEXT,
  bytes         INTEGER,
  uploader      TEXT,                          -- email of the submitting user
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'new',   -- new|drafted|published|rejected
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mktphoto_store ON marketing_photos(store, created_at);
CREATE INDEX IF NOT EXISTS idx_mktphoto_status ON marketing_photos(status, created_at);

CREATE TABLE IF NOT EXISTS facebook_page_targets (
  store       TEXT PRIMARY KEY,                -- BL code
  page_id     TEXT NOT NULL,
  page_name   TEXT
);
INSERT OR REPLACE INTO facebook_page_targets (store, page_id, page_name) VALUES
  ('BL1',  '113655020488471', 'Bargain Lane (Coliseum/Dupont)'),
  ('BL4',  '113655020488471', 'Bargain Lane (Coliseum/Dupont)'),
  ('BL2',  '264627006733058', 'Bargain Lane - South Bend'),
  ('BL8',  '222962777911366', 'B2 Outlet - Holland by Bargain Lane'),
  ('BL14', '104574708111472', 'Bargain Lane - Battle Creek'),
  ('BL16', '1000209416518542','Bargain Lane Indy');
