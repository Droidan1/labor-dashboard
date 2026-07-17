-- Migration 010: Add interval_summary column to notification_preferences
-- Apply with: npx wrangler d1 execute labor-dashboard-db --remote --file=migration-010.sql

ALTER TABLE notification_preferences ADD COLUMN interval_summary TEXT NOT NULL DEFAULT 'off';
