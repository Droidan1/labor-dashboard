-- migration-023: post_type for folder organization on the Content page.
-- Drafts and cover thumbnails get a clean category so they can be auto-filed
-- into Post Type -> Month folders (Bin Preview / Weekly Promo / New Arrivals /
-- Event / Other). Free-text `topic` stays (it feeds the AI caption).
-- Apply staging: npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-023.sql
-- Apply prod:    npx wrangler d1 execute labor-dashboard-db --remote --file=migration-023.sql

ALTER TABLE marketing_drafts ADD COLUMN post_type TEXT;
ALTER TABLE marketing_thumbnails ADD COLUMN post_type TEXT;
