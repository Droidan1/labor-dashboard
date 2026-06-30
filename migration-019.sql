-- Marketing: page-based store attribution.
-- Capture the Facebook Page each campaign's boosted post came from, so we can
-- attribute campaigns to stores by page (reliable) instead of by parsing the
-- truncated post text in the campaign name.
ALTER TABLE meta_ad_insights ADD COLUMN page_id TEXT;
