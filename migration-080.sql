-- migration-080: store videos from Submit Photos (2026-10-19).
--
-- Brian (2026-10-19): two kinds of video, both for Facebook through Buffer:
--   store_walk  filmed SIDEWAYS, at least 3:00, posted as a normal Facebook video;
--   clip        filmed UPRIGHT, 3–90 s, posted as a Reel (Buffer posts any 9:16 video
--               as a Reel, and Reels stop at 90 s).
-- Recorded at 1080p; anything over 1 GB (Buffer's limit) is refused on the phone.
--
-- A video is uploaded in parts straight into R2 (multipart, through the worker, whose
-- request body is capped at 100 MB). The row exists from the first part, as
-- status='uploading', so an abandoned upload can be found and aborted; only 'new'
-- videos count toward the weekly store-walk target or can be posted.
--
--   duration_ms / width / height   as the phone read them (display orientation), checked
--                                  against the type's rules before any byte is sent
--   upload_id                      the R2 multipart upload, until it completes
--
-- Additive: a new table, nothing existing is touched.
--   npx wrangler d1 execute labor-dashboard-db --remote --file=migration-080.sql
-- If --file fails with "Authentication error [code: 10000]" (D1's /import endpoint, seen
-- 2026-10-19), run the same statements with --command="…" instead.
-- Confirm it landed (expects marketing_videos):
--   npx wrangler d1 execute labor-dashboard-db --remote \
--     --command="SELECT name FROM sqlite_master WHERE type='table' AND name='marketing_videos'"
CREATE TABLE IF NOT EXISTS marketing_videos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  store        TEXT    NOT NULL,
  video_type   TEXT    NOT NULL,                  -- 'store_walk' | 'clip'
  r2_key       TEXT    NOT NULL,
  content_type TEXT    NOT NULL,                  -- video/mp4 | video/quicktime | video/x-m4v
  bytes        INTEGER NOT NULL,
  duration_ms  INTEGER NOT NULL,
  width        INTEGER NOT NULL,
  height       INTEGER NOT NULL,
  uploader     TEXT,
  note         TEXT,
  status       TEXT    NOT NULL DEFAULT 'uploading', -- uploading | new | aborted | rejected
  upload_id    TEXT,
  created_at   TEXT    NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mktvideo_store_created ON marketing_videos(store, created_at);
