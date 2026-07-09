-- migration-025: generic key/value app settings. First use: the AI "brand guide"
-- text that steers gpt-image-1 cover-thumbnail generation (Content Studio, AI covers).
-- Additive. Apply staging then prod:
--   npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-025.sql
--   npx wrangler d1 execute labor-dashboard-db         --remote --file=migration-025.sql

CREATE TABLE IF NOT EXISTS content_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT
);
