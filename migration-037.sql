-- migration-037: the labour PLAN, which the importer has never read.
--
-- daily_sales already has labor_pct (actual %) and labor_hours (actual hours,
-- NULL in every row). What it has never had is the plan side, so there was
-- nothing to compare an actual against and the briefing API's laborTargetPct
-- had no source.
--
-- The data was in the budget sheet the whole time. The importer's COL map
-- reads 8 of the sheet's 62 columns and these two were not among them:
--
--   col 9   budgeted hours          populated for EVERY day, including
--                                   forward-dated rows through December
--   col 10  budgeted labour %       likewise — 0.098, 0.092, 0.141, 0.174 …
--
-- Measured on the BL1 tab 2026-08-11. Holland's tab carries the plan too, even
-- though nobody has entered an actual for it since 2026-07-24.
--
-- Stored as FRACTIONS (0.098 = 9.8%), matching how the sheet holds them and how
-- labor_pct is already stored. Nullable, because "nobody planned this day" has
-- to stay distinguishable from "planned at zero" — the API contract forbids
-- sending 0 to mean unknown.
--
-- Purely additive: two ALTER TABLE ADD COLUMN, no table rebuilt, no DROP. The
-- D1 cascade trap (migration-029) does not apply — that came from DROPping a
-- parent table, not from adding a column.
--
-- Apply with:
--   wrangler d1 execute labor-dashboard-db --file=migration-037.sql --remote
--
-- NOTE: applying this migration alone changes nothing visible. The columns stay
-- NULL until `?action=backfill` is re-run, which is what actually reads the
-- sheet. That is a deliberate second step, not an oversight.

-- Budgeted labour % for the day, as a fraction (sheet column 10).
ALTER TABLE daily_sales ADD COLUMN budget_labor_pct REAL;

-- Budgeted hours for the day (sheet column 9).
ALTER TABLE daily_sales ADD COLUMN budget_labor_hours REAL;
