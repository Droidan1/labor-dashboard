-- migration-022: post topic on drafts. The composer sets what a post is ABOUT
-- (e.g. "weekly bin preview", "this week's promo") so the AI caption isn't
-- always framed as the Flow Calendar promo.
-- Apply staging: npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-022.sql
-- Apply prod:    npx wrangler d1 execute labor-dashboard-db --remote --file=migration-022.sql

ALTER TABLE marketing_drafts ADD COLUMN topic TEXT;
