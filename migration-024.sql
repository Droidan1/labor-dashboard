-- migration-024: Scheduling for marketing bin-post drafts (Content Studio, Phase 5).
-- Adds auto-publish scheduling to the existing marketing_drafts row — one row moves
-- through statuses: draft|approved -> scheduled -> publishing -> published (or schedule_error).
-- SQLite has NO "ADD COLUMN IF NOT EXISTS": run EXACTLY ONCE per DB (matches the
-- migration-0xx convention). Additive/forward-only — SQLite has no DROP COLUMN.
--
-- Apply STAGING first, then PROD, and BEFORE deploying any code that READS these
-- columns (Phase 6). Phase 5's publishDraft() refactor does not read them, so it is
-- safe to deploy the Phase 5 worker before this runs — but run it before Phase 6.
--   Staging: npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-024.sql
--   Prod:    npx wrangler d1 execute labor-dashboard-db         --remote --file=migration-024.sql

ALTER TABLE marketing_drafts ADD COLUMN scheduled_at     TEXT;                       -- UTC ISO to auto-publish at; NULL = unscheduled
ALTER TABLE marketing_drafts ADD COLUMN publish_live     INTEGER NOT NULL DEFAULT 1; -- 1 = publish LIVE (schedule default), 0 = stage unpublished
ALTER TABLE marketing_drafts ADD COLUMN origin           TEXT;                       -- NULL | 'flow' (drives the "· from Flow" tag)
ALTER TABLE marketing_drafts ADD COLUMN flow_fiscal_year TEXT;                        -- provenance when origin='flow'
ALTER TABLE marketing_drafts ADD COLUMN flow_retail_week INTEGER;                     -- provenance when origin='flow'
ALTER TABLE marketing_drafts ADD COLUMN publish_attempts INTEGER NOT NULL DEFAULT 0;  -- retry cap (cron)
ALTER TABLE marketing_drafts ADD COLUMN claimed_at       TEXT;                        -- set when cron flips scheduled->publishing (stale-claim reaper key)
ALTER TABLE marketing_drafts ADD COLUMN next_attempt_at  TEXT;                        -- backoff gate; NULL = eligible now
ALTER TABLE marketing_drafts ADD COLUMN schedule_error   TEXT;                        -- last failure reason, shown on the card

-- Due-query index: the cron scans scheduled rows by (status, scheduled_at).
CREATE INDEX IF NOT EXISTS idx_drafts_due ON marketing_drafts(status, scheduled_at);

-- One flow-seeded post per (store, fiscal_year, retail_week) — dedupes re-seeding a Flow week.
CREATE UNIQUE INDEX IF NOT EXISTS uq_drafts_flow_week
  ON marketing_drafts(store, flow_fiscal_year, flow_retail_week) WHERE origin = 'flow';
