-- Furniture pricing from a photo.
--
-- WHY — furniture arrives with no barcode, so there is no key to look anything up by and
-- pricing it is guesswork that takes too long. The picture becomes the key: what we
-- charged for a piece is remembered against its photo, so the same piece arriving again —
-- at this store or another — holds its price instead of being re-guessed.
--
-- 🔑 THE MATCH IS OVER TEXT, NOT PIXELS. There is no cheap way to search images by
-- likeness. There IS a cheap way to search what they are: a vision call writes each photo
-- down as attributes on upload, and a new photo is described the same way and matched
-- against those. Milliseconds, and free.
--
-- 🛑 A MATCH IS A SUGGESTION, NEVER A DECISION. The screen puts the old photo beside the
-- new one and the manager confirms. A wrong match prices the wrong item and nothing
-- downstream would catch it — the same reason the barcode scanner insists on reading a
-- code twice before it believes it.
--
-- Apply:
--   npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-052.sql
--   npx wrangler d1 execute labor-dashboard-db         --remote --file=migration-052.sql
--
-- Re-runnable. Additive only: no existing table is touched.

CREATE TABLE IF NOT EXISTS furniture_pieces (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  r2_key       TEXT NOT NULL,          -- the photo, in the MEDIA bucket
  content_type TEXT,
  l3           TEXT NOT NULL,          -- FG BL FURNITURE - ...
  descriptor   TEXT,                   -- one human line: "grey fabric armchair, wooden legs"
  attributes   TEXT,                   -- lowercase, space-separated, what the match runs over
  condition    TEXT,                   -- new | like_new | good | fair | damaged
  price        REAL NOT NULL,
  store        TEXT,
  -- Which earlier piece this was matched to, if any. Kept so a price that has been
  -- carried forward five times can be traced back to the one somebody actually decided.
  matched_id   INTEGER,
  priced_by    TEXT,
  priced_at    TEXT NOT NULL
);

-- The match is always scoped to one category, so that is the leading column.
CREATE INDEX IF NOT EXISTS idx_furniture_l3 ON furniture_pieces (l3, priced_at DESC);
CREATE INDEX IF NOT EXISTS idx_furniture_matched ON furniture_pieces (matched_id);

-- What an admin sets: three points per category per condition — the low, the one we
-- usually get, and the high. Three rather than one so a manager can flex without leaving
-- the guide, and `usual` is what is offered first.
CREATE TABLE IF NOT EXISTS furniture_bands (
  l3         TEXT NOT NULL,
  condition  TEXT NOT NULL,
  low        REAL,
  usual      REAL,
  high       REAL,
  updated_by TEXT,
  updated_at TEXT,
  PRIMARY KEY (l3, condition)
);
