-- migration-079: Content Studio publishes through Buffer (2026-10-19).
--
-- marketing_publish_log.buffer_post_id: the Buffer post a draft was handed to. The row
--   stays status='queued' (post_id NULL) until syncBufferPosts sees Buffer send it, then
--   becomes 'published' with Facebook's post id and URL. Buffer has no idempotency key,
--   so this id is what stops the scheduler handing the same draft over twice.
-- marketing_drafts.photos_curated: 1 once a person has saved the draft's photo list.
--   The bin auto-draft refills photo_ids from the week's uploads on every upload; a
--   curated draft is left alone, so a trim to Buffer's 10-image limit sticks.
--
-- Additive. MUST land before the worker that reads these columns: the bin auto-draft's
-- recompute names photos_curated on every bins upload.
--   npx wrangler d1 execute labor-dashboard-db --remote --file=migration-079.sql
-- Confirm it landed (expects buffer_post_id and photos_curated):
--   npx wrangler d1 execute labor-dashboard-db --remote \
--     --command="SELECT name FROM pragma_table_info('marketing_publish_log') WHERE name='buffer_post_id' UNION ALL SELECT name FROM pragma_table_info('marketing_drafts') WHERE name='photos_curated'"
ALTER TABLE marketing_publish_log ADD COLUMN buffer_post_id TEXT;
ALTER TABLE marketing_drafts ADD COLUMN photos_curated INTEGER NOT NULL DEFAULT 0;
