-- migration-044: retail lookup log.
--
-- Every call the retail lookup makes to an outside service, recorded. This exists for
-- three reasons, in order of how much they matter:
--
--   1. COST IS OBSERVABLE. Search and Fetch are free on TinyFish's current tiers, but the
--      Agent endpoint is metered. A log per call is what makes "this manifest cost $0"
--      a fact rather than an assumption, and it is what a per-manifest budget cap counts.
--   2. A LOOKUP THAT FOUND NOTHING IS DIFFERENT FROM ONE THAT NEVER RAN. Without a row,
--      a NULL retail price cannot tell those apart — and one means "no first-party
--      stockist", the other means "we ran out of budget".
--   3. RATE LIMITS ARE PER KEY (30 searches/min). The log is how a later run knows what
--      the last one already spent.
--
-- Additive and guarded, so this file IS safe to re-run.
-- Apply staging then prod:
--   npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-044.sql
--   npx wrangler d1 execute labor-dashboard-db         --remote --file=migration-044.sql

CREATE TABLE IF NOT EXISTS lookup_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id TEXT,
  line_id     INTEGER,
  provider    TEXT NOT NULL,   -- tinyfish_search | tinyfish_fetch | tinyfish_agent | claude
  detail      TEXT,            -- the query or URL, for working out why a line failed
  credits     REAL NOT NULL DEFAULT 0,
  ok          INTEGER NOT NULL DEFAULT 1,
  status      INTEGER,         -- HTTP status when there was one
  ms          INTEGER,
  at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lookuplog_manifest ON lookup_log(manifest_id, at);
CREATE INDEX IF NOT EXISTS idx_lookuplog_at       ON lookup_log(at);
