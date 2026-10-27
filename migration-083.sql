-- migration-083: Google Business Profile posts beside Facebook (2026-10-27).
--
-- Brian (2026-10-27): a per-post "Also post to Google" switch, on by default, for the three
-- stores whose Google listing is connected in Buffer (Coliseum, Dupont, South Bend); the
-- cover graphic as Google's one image; no button.
--
-- marketing_drafts.google           1 / 0 from the switch; NULL = never set = on for those stores
-- marketing_publish_log.channel_id  the Buffer channel a row handed the post to
-- marketing_publish_log.service     'facebook' | 'googlebusiness'
-- A draft now has a hand-off per destination, and each is guarded and retried on its own:
-- a retry skips the destinations already done. Rows written before this have both NULL
-- and are read as the store's Facebook hand-off.
--
-- Additive. MUST land before the worker: it writes channel_id/service on every hand-off
-- (without them a publish is refused before anything is sent) and draft-save writes google.
--   npx wrangler d1 execute labor-dashboard-db --remote --command="ALTER TABLE marketing_drafts ADD COLUMN google INTEGER; ALTER TABLE marketing_publish_log ADD COLUMN channel_id TEXT; ALTER TABLE marketing_publish_log ADD COLUMN service TEXT;"
-- (--command, not --file; on "[code: 7403]" run `npx wrangler login` first.)
ALTER TABLE marketing_drafts ADD COLUMN google INTEGER;
ALTER TABLE marketing_publish_log ADD COLUMN channel_id TEXT;
ALTER TABLE marketing_publish_log ADD COLUMN service TEXT;
