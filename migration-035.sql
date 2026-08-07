-- migration-035: eBay case alerts — the notification ledger we own.
--
-- Raj turned Handler's own email off (`digestTo=` empty, `suppressEmail=1`) and
-- left `owner`/`escalateTo` empty on both accounts, on the agreement that the HUB
-- does the notifying. It did not, and nobody has been told anything — including
-- about 26 failed auto-refunds. This is the schema half of closing that.
--
-- Purely additive: two ALTER TABLE ADD COLUMN, no table rebuilt, no DROP. The D1
-- cascade trap (migration-029) does not apply — that one came from DROPping a
-- parent table, not from adding a column.
--
-- Rollback: SQLite cannot DROP COLUMN on these versions; leave them. Both are
-- nullable/defaulted and unread by anything if the feature is reverted.

-- ── Which tier a case was last alerted at ──────────────────────────────────
-- 🔑 THE DEDUPE, and it is load-bearing rather than defensive. Handler POSTs the
-- FULL state every ~30 minutes — every open case, every run. With 20 cases
-- currently NEEDS_HUMAN that is ~48 runs x 20 = ~960 pushes a day if we alert on
-- what we see rather than on what CHANGED.
--
-- `last_notified_at` alone is not enough: a case must be able to alert AGAIN when
-- it escalates (needs-human -> entering the auto-act window), but never twice for
-- the same tier. So we store the tier, and compare.
--
-- Raj's own handler reaches the same conclusion for its digest: "Each case can
-- only do this once: it is marked as reported in the state file."
ALTER TABLE ebay_cases ADD COLUMN notified_tier TEXT;

-- ── Per-user opt-out, following the established pattern ────────────────────
-- Mirrors supply_notifications (012) and upload_alerts (026): default ON, so a
-- user who has never touched the setting still gets told. Defaulting OFF would
-- make the whole feature silently inert for everyone, which is the failure this
-- migration exists to end.
ALTER TABLE notification_preferences ADD COLUMN ebay_alerts INTEGER NOT NULL DEFAULT 1;
