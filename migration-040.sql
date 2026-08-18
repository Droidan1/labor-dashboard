-- migration-040: Facebook comment review queue.
--
-- Comments on published bin posts are ingested here, get an AI-drafted reply, and
-- wait for a human to approve before anything is posted back to Facebook. Brian
-- chose a review queue for EVERY comment rather than any auto-send: a reply is a
-- public commitment made under the business's name, and the comment text itself is
-- untrusted input that a model would otherwise be reading and acting on.
--
-- status lifecycle:
--   new      -- ingested, no draft yet
--   drafted  -- a reply has been generated, awaiting review
--   replied  -- approved and posted to Facebook (reply_id set)
--   ignored  -- explicitly dismissed; never resurfaces
--
-- comment_id is Facebook's own id and is the dedupe key -- polling re-sees the same
-- comments every run, so the UNIQUE constraint is what keeps ingest idempotent.
--
-- Additive. The CREATE statements are guarded, so this file IS safe to re-run.
-- Apply staging then prod:
--   npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-040.sql
--   npx wrangler d1 execute labor-dashboard-db         --remote --file=migration-040.sql

CREATE TABLE IF NOT EXISTS fb_comments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id    TEXT NOT NULL UNIQUE,        -- Facebook comment id (dedupe key)
  store         TEXT NOT NULL,
  page_id       TEXT NOT NULL,
  post_id       TEXT NOT NULL,
  post_url      TEXT,
  parent_id     TEXT,                        -- set when the comment is itself a reply
  author_name   TEXT,
  author_id     TEXT,
  message       TEXT,
  created_time  TEXT,                        -- Facebook's timestamp for the comment
  status        TEXT NOT NULL DEFAULT 'new', -- new | drafted | replied | ignored
  draft_reply   TEXT,
  reply_source  TEXT,                        -- 'ai' | 'manual'
  reply_id      TEXT,                        -- Facebook id of OUR posted reply
  replied_at    TEXT,
  replied_by    TEXT,
  fetched_at    TEXT NOT NULL
);

-- The page lists one store at a time, newest first.
CREATE INDEX IF NOT EXISTS idx_fbcomment_store ON fb_comments(store, status, created_time);
-- Ingest checks "have I seen this post's comments" and the queue counts by status.
CREATE INDEX IF NOT EXISTS idx_fbcomment_post  ON fb_comments(post_id, created_time);
