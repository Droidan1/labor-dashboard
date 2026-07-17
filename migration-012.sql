-- Migration 012: Add supply_notifications column to notification_preferences
-- Apply with: npx wrangler d1 execute labor-dashboard-db --remote --file=migration-012.sql

ALTER TABLE notification_preferences ADD COLUMN supply_notifications INTEGER NOT NULL DEFAULT 1;
