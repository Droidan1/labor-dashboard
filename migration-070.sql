-- migration-070: a purchase order becomes a thing you can name, and a print can say
-- which buy it came from.
--
-- Brian, 2026-09-21: "being able to track an opportunity buy (OB)... Every PO is assigned
-- to every opportunity buy, so it's unique." And, narrowing it: "Let's not worry about the
-- different cost for OB's... My biggest problem is tracking those items."
--
-- This is Phase 1 of docs/feature-opportunity-buys.md. It answers "what is in this buy,
-- where did it go, how many labels went out" and deliberately does NOT answer sell-through,
-- which the design note explains cannot be answered until an OB item's CODE carries the PO
-- and payment_archive_items carries the code. Neither is true yet, and neither is here.
--
-- ── Why the PO hangs off sticker_prints and not a new link table ───────────────────────
--
-- 🔑 sticker_prints ALREADY HAS THE RIGHT GRAIN. It records store, l3, price_cents, code,
-- title, qty, printed_by and printed_at — one row per press of Print. "What is in buy X" is
-- a DISTINCT over its rows and "how many labels went out" is a SUM of its qty. A separate
-- ob_items table would duplicate all of that to add one column, and would then have to be
-- kept in step with the print history it was copied from. One nullable column is the whole
-- change.
--
-- ── Why NULL is a real value here, exactly as in migration-069 ─────────────────────────
--
-- 🛑 EVERY EXISTING ROW WAS PRINTED BEFORE BUYS EXISTED, AND NULL IS HOW IT SAYS SO. Do not
-- backfill it with anything. There is no PO those rows belong to; inventing one would put a
-- buy's name on stock that never came in on it, in the one table that is supposed to be the
-- record of what happened. NULL means "not part of a tracked buy", which is the truth for
-- 100% of the table today and for every ordinary print forever after.
--
-- ── Apply ──────────────────────────────────────────────────────────────────────────────
-- Address databases by UUID; the staging one lives under [env.staging] and a bare name does
-- not resolve. STAGING FIRST:
--   staging:     npx wrangler d1 execute b40982c2-4009-4842-bc17-fa0977468b07 --remote -y --file=migration-070.sql
--   production:  npx wrangler d1 execute 3fa911d7-31d6-438c-985f-7ac08c407d2d --remote -y --file=migration-070.sql
--
-- Confirm it landed (expects `ob_buys`, then one row `po`):
--   npx wrangler d1 execute <uuid> --remote -y --json \
--     --command="SELECT name FROM sqlite_master WHERE type='table' AND name='ob_buys'"
--   npx wrangler d1 execute <uuid> --remote -y --json \
--     --command="SELECT name FROM pragma_table_info('sticker_prints') WHERE name = 'po'"
--
-- 🛑 THE ALTER IS NOT RE-RUNNABLE. `ALTER TABLE ADD COLUMN` takes no IF NOT EXISTS, as
-- migration-059 proved on production: a second run errors with `duplicate column name: po`.
-- That error is harmless and means the column is already there — check with the pragma above
-- rather than re-running. The CREATE TABLE and CREATE INDEX are both IF NOT EXISTS and are
-- safe on their own, so a partial application re-run fails only on the ALTER, which is the
-- statement you want to have already succeeded.
--
-- 🔑 DEPLOY ORDER: THIS FIRST, THEN THE WORKER, THEN THE FRONTEND. Derived from which side
-- stops being backward-compatible (CLAUDE.md rule 6), not from last time. The new worker
-- INSERTs `po` and SELECTs it back and reads ob_buys, so against a database without them
-- every sticker-printed and every ob-buy-* call throws — that is the incompatible direction,
-- and it is why the database cannot go second. A table and a column the live worker never
-- names are invisible to it, so this is safe to apply while the current worker runs.
--
-- 🔑 ADDITIVE ONLY. No existing row is read, rewritten or deleted. Every existing column
-- keeps its value and the new one arrives NULL everywhere. Rollback is to leave it: D1's
-- SQLite cannot DROP a column added by this old-style ALTER, and an unread NULL column costs
-- nothing. Reverting the worker alone fully undoes the behaviour.

-- ── The buy itself ─────────────────────────────────────────────────────────────────────
--
-- The PO is the primary key because Brian's own framing is that it is unique per buy:
-- "Every PO is assigned to every opportunity buy, so it's unique." Making it the key means
-- the database refuses a second buy under one PO rather than leaving two half-buys to be
-- noticed later. It is typed by hand — the POs on receiving pallet tags are different
-- numbers, confirmed 2026-09-21 — so it is TEXT, not INTEGER: leading zeros survive and a
-- PO like "OB-2026-11" is as valid as "99999".
CREATE TABLE IF NOT EXISTS ob_buys (
  po          TEXT PRIMARY KEY,               -- as it reads on the paperwork
  label       TEXT,                           -- "November toy buy" — what a person calls it
  vendor      TEXT,
  received_on TEXT,                           -- YYYY-MM-DD, the day it landed
  units       INTEGER,                        -- units bought AS DECLARED. Never a print count.
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'closed'
  opened_by   TEXT NOT NULL,                  -- users.email
  opened_at   TEXT NOT NULL,                  -- ISO 8601 UTC. An edit never moves this.
  closed_by   TEXT,
  closed_at   TEXT
);

-- Open buys first, then most recently opened. The picker on Price Scan reads exactly this
-- order, so the buy someone is working today is the one at the top.
CREATE INDEX IF NOT EXISTS idx_ob_buys_status ON ob_buys(status, opened_at DESC);

-- ── The link ───────────────────────────────────────────────────────────────────────────
--
-- Which buy this label was printed against. NULL for every ordinary print, then and now.
ALTER TABLE sticker_prints ADD COLUMN po TEXT;

-- 🔑 sticker_prints' only existing index is (printed_by, printed_at DESC), built for
-- "my recent prints". Every question this feature asks is "this buy's prints", which that
-- index cannot serve at all — the buy page would full-scan the print history on every load.
CREATE INDEX IF NOT EXISTS idx_sticker_prints_by_po ON sticker_prints(po, printed_at DESC);
