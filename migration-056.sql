-- What was actually printed, so a peeled or jammed label can be replaced without
-- rescanning the item off the shelf.
--
-- 🔑 THE ROW STORES THE QUESTION, NOT THE ANSWER. It keeps store + l3 + price_cents —
-- the three inputs sticker-check consumes — rather than treating the printed `code` as
-- the thing to reprint. The code is recorded too, but only so the list can show what came
-- out last time. A reprint re-derives and re-verifies from the inputs, which means:
--
--   * a category renumbered in Clover reprints under its NEW number, not the stale one
--   * a code deleted since is refused, exactly as a fresh scan would be
--   * a price the store no longer carries is refused rather than reprinted
--
-- Reprinting a stored code verbatim would be faster and would, sooner or later, put a
-- sticker on a shelf that no longer resolves at the register. That is the one outcome
-- this whole feature exists to prevent, and a convenience feature must not reintroduce it.
--
-- 🛑 price_cents, NOT price. The ZPL renders $1.50 and the code encodes 1_5; both come
-- from one number, and a float that stringifies as 1.4999999 breaks the code, not just
-- the display.
--
-- Apply:
--   npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-056.sql
--   npx wrangler d1 execute labor-dashboard-db         --remote --file=migration-056.sql
--
-- Additive: a new table, nothing altered, nothing backfilled.
CREATE TABLE IF NOT EXISTS sticker_prints (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  store       TEXT NOT NULL,
  l3          TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  code        TEXT NOT NULL,      -- what was printed, for the list. NOT the reprint input.
  title       TEXT,               -- the item as scanned, so the row is recognisable
  printed_by  TEXT NOT NULL,      -- users.email
  printed_at  TEXT NOT NULL       -- ISO 8601 UTC
);

-- The list is always "my recent prints, newest first". One index serves it.
CREATE INDEX IF NOT EXISTS idx_sticker_prints_by_user
  ON sticker_prints(printed_by, printed_at DESC);
