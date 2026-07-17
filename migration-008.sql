-- Migration 008: Hybrid Notification System — Phase 1 Web Push tables
-- Apply with: npx wrangler d1 execute labor-dashboard-db --remote --file=migration-008.sql

-- push_subscriptions: one row per device per user (capped at 5 per user)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  user_agent  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_push_sub_user ON push_subscriptions(user_id);

-- notification_preferences: one row per user, created on first subscribe
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  push_enabled   INTEGER NOT NULL DEFAULT 1,
  daily_summary  INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- notification_log: audit trail for sent/failed pushes
CREATE TABLE IF NOT EXISTS notification_log (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  type        TEXT NOT NULL,        -- 'push' | 'email'
  event_type  TEXT NOT NULL,        -- 'daily-summary' | 'test'
  status      TEXT NOT NULL,        -- 'sent' | 'failed'
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_log_user ON notification_log(user_id, created_at DESC);
