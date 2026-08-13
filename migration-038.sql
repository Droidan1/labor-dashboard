-- migration-038: store the provider's message id on every email we log.
--
-- notification_log now records the real send outcome (sent / failed / skipped)
-- rather than a hardcoded 'sent', but the status alone still cannot answer the
-- question that actually gets asked: "did KEVIN get HIS email?"
--
-- 🔑 A 2xx from Resend means ACCEPTED, not DELIVERED. Bounces, complaints and
-- suppression-list hits all happen AFTER the API call succeeds, and are visible
-- only in Resend's own dashboard. Without the message id, looking one up means
-- scrolling their log by timestamp and guessing which of the twelve 12:00 UTC
-- sends belonged to which recipient. With it, every row here is a direct lookup.
--
-- This is exactly the gap that left kevin@retjg.com unexplained for 17 days:
-- 19 messages sent to that address, and no handle on any of them.
--
-- Purely additive: one ALTER TABLE ADD COLUMN, no table rebuilt, no DROP. The
-- D1 cascade trap (migration-029) does not apply — that one came from DROPping a
-- parent table, not from adding a column.
--
-- 🛑 ORDER IS LOAD-BEARING: apply this BEFORE deploying the worker that writes
-- it. logEmailAttempt()'s INSERT is deliberately .catch(() => {})'d so that
-- failing to write an audit row never fails the send it describes — which means
-- a missing column would silently discard EVERY notification_log row instead of
-- erroring. Migration first, worker second.
--
-- Rollback: SQLite cannot DROP COLUMN on these versions; leave it. It is
-- nullable and unread by anything if the feature is reverted.
ALTER TABLE notification_log ADD COLUMN provider_message_id TEXT;

-- Look up a specific message by provider id (support flow: Resend shows a bounce
-- for id X — who was that, and what were we sending them?).
CREATE INDEX IF NOT EXISTS idx_notif_log_provider_msg
  ON notification_log(provider_message_id);
