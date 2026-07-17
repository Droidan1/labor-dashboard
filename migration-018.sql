-- Add campaign created_time so the Marketing campaigns table can sort by day
-- (newest→oldest). Populated by fetchMetaInsights via the Meta /campaigns edge.
ALTER TABLE meta_ad_insights ADD COLUMN created_time TEXT;
