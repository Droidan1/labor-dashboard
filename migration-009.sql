-- Migration 009: Add weekly_digest column to notification_preferences
-- Apply with: npx wrangler d1 execute labor-dashboard-db --remote --file=migration-009.sql

ALTER TABLE notification_preferences ADD COLUMN weekly_digest INTEGER NOT NULL DEFAULT 1;
