-- migration-076: how many units of an opportunity buy each store got.
--
-- Brian, 2026-10-02: "add a edit button so users can edit, units and stores and then add a
-- Reports tab. this will show all POs data and add units and units sold per store." His answers
-- to the preview the same day:
--   - Editing is for admins and superusers, like opening and closing a buy (obRequireEdit).
--   - A buy's total units become the stores added up once any store has units.
--   - The stores are the open ones: BL1, BL2, BL4, BL14, BL16 (BL8 Holland is closed).
--
-- Sales by store already exist (migration-072 put the item code on archived sales, and a buy's
-- codes carry its PO). What did not exist is the other half of "sold over units": how many units
-- each store was sent. That is this table.
--
-- ── Why each column is what it is ─────────────────────────────────────────────────────────
--
-- po          ob_buys.po, normalised by obPo (TEXT, never a number: "00412" is not 412).
-- store       A store code from ALL_STORES that is not closed. The worker is the gate; no CHECK
--             (migration-062's header).
-- units       Units this store got from this buy, a whole number above zero. A store the buy
--             did not go to has NO row: "not in this buy" and "zero units" are different
--             answers, and the report says "—" for one and would say 0 % for the other.
-- updated_by  The editor's email, for audit.
-- updated_at  ISO-8601 UTC.
--
-- PRIMARY KEY (po, store): one number per store per buy. An edit REPLACES a buy's rows, so a
-- store taken out of the buy is deleted rather than left at zero.
--
-- No FOREIGN KEY to ob_buys: on D1, a rebuild of the parent fires ON DELETE CASCADE whatever
-- PRAGMA says (memory: d1-table-rebuild-cascade), and a buy is never deleted anyway.
--
-- ── Apply ────────────────────────────────────────────────────────────────────────────────
-- 🛑 BY NAME, NOT UUID. wrangler 4.80 reads the argument as a database NAME: the UUID form this
-- header first gave failed on 2026-10-02 with "Couldn't find DB with name '3fa911d7-…'". The
-- staging database lives under [env.staging], so it needs --env staging. STAGING FIRST:
--   staging:     wrangler d1 execute labor-dashboard-db-staging --env staging --remote -y --file=migration-076.sql
--   production:  wrangler d1 execute labor-dashboard-db --remote -y --file=migration-076.sql
--
-- Confirm it landed (expects 5 rows: po, store, units, updated_by, updated_at):
--   wrangler d1 execute labor-dashboard-db --remote --json \
--     --command="SELECT name FROM pragma_table_info('ob_buy_stores') ORDER BY cid"
--
-- RE-RUNNABLE: IF NOT EXISTS, so a second run changes nothing.
--
-- 🔑 DEPLOY ORDER: THIS FIRST, THEN THE WORKER, THEN THE FRONTEND (CLAUDE.md rule 6). The new
-- worker reads and writes this table; a table the live worker never names is invisible to it, so
-- applying this while the current worker runs is safe. (The new worker also treats a missing
-- table as "no units set" rather than failing, so the order is a safeguard, not a cliff.)
--
-- 🔑 ADDITIVE ONLY. One new, empty table. No existing table or row is read, rewritten or deleted.

CREATE TABLE IF NOT EXISTS ob_buy_stores (
  po          TEXT NOT NULL,
  store       TEXT NOT NULL,
  units       INTEGER NOT NULL,
  updated_by  TEXT,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (po, store)
);
