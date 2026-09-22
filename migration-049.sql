-- migration-049: lot buys — a load priced as a share of retail, with no per-line cost.
--
-- Three of the eight real manifests reviewed on 2026-08-20 have NO cost column at all:
-- both BStock furniture truckloads and Manifest # 07002. They are not broken files; they
-- are a different deal. You are quoted a PERCENTAGE OF RETAIL for the whole load, or a
-- single total against the load's extended retail — which is the same number stated two
-- ways. Manifest # 07002: $12,175.00 against $32,902.19 of retail, i.e. 37%.
--
-- Until now such a manifest could not be scored at all: every gate divides by a per-line
-- cost, and there wasn't one.
--
--   line cost per unit = that line's unit RETAIL x the rate
--
-- retail_pct  — the rate we pay, 0-100. The primary input; it is how the deal is quoted.
-- lot_cost    — a total for the load, for vendors who quote a lump sum instead. The worker
--               derives the rate from it and the load's extended retail, so both entry
--               styles converge on one number and neither is stored twice.
--
-- Only ever applied to a line with NO cost of its own. A manifest that carries real
-- per-line costs is untouched by this, whatever these columns say.
--
-- Both default to 0, so every existing manifest scores exactly as it does now.
--
-- Additive. A re-run reports "duplicate column name" and changes nothing.
-- Apply staging then prod:
--   npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-049.sql
--   npx wrangler d1 execute labor-dashboard-db         --remote --file=migration-049.sql

ALTER TABLE manifests ADD COLUMN retail_pct REAL NOT NULL DEFAULT 0;
ALTER TABLE manifests ADD COLUMN lot_cost   REAL NOT NULL DEFAULT 0;
