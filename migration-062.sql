-- migration-062: Mark Out of Stock — the log, and the category-code map it needs.
--
-- MOS records merchandise leaving the floor without being sold: expired food, damaged
-- seasonal, product taken for store use, theft. One row per sticker code per entry.
--
-- Apply (address databases by UUID; the staging one lives under [env.staging] and a bare
-- name does not resolve):
--   npx wrangler d1 execute b40982c2-4009-4842-bc17-fa0977468b07 --remote -y --file=migration-062.sql
--   npx wrangler d1 execute 3fa911d7-31d6-438c-985f-7ac08c407d2d --remote -y --file=migration-062.sql
--
-- 🛑 Re-runnable. Both statements take IF NOT EXISTS, unlike migration-059's ALTER TABLE
-- ADD COLUMN, which errored on the second run against production.

-- ── The log ─────────────────────────────────────────────────────────────────
--
-- 🔑 COST AND PRICE ARE SNAPSHOTTED HERE, NOT RESOLVED AT READ TIME. Both are knowable
-- from elsewhere the moment a row is written — the price decodes from the sticker code,
-- the cost comes from `category-costs:global` in KV — so storing them looks redundant.
-- It is not. That KV map is re-imported by an admin whenever costs change (last import
-- 2026-08-25), and a category's cost moving must not silently rewrite what September's
-- shrink came to. A historical row keeps the figures that were true when the product
-- left the floor. `sticker_prints.price_cents` already makes this same trade.
--
-- 🔑 CENTS, as INTEGER. Money in REAL accumulates error across a SUM, and a shrink total
-- is exactly a SUM over many small numbers. unit_cost_cents is NULLABLE and null is a
-- real value meaning "no cost on file for this category" — 4 of the 46 categories that
-- carry sticker codes have none. It must never be stored as 0, which would read as free
-- merchandise and quietly understate every total it lands in.
--
-- ⚠️ NO CHECK CONSTRAINT ON `reason`, deliberately. SQLite cannot ALTER a CHECK in place,
-- so the four codes would be frozen behind a full table rebuild — and migration-029 is
-- the record of what that costs here: rebuilding a table that others reference fires an
-- implicit DELETE FROM through every ON DELETE CASCADE pointing at it. A fifth reason
-- code is a plausible Tuesday request. The worker validates the value instead, where
-- adding one is a single line.
CREATE TABLE IF NOT EXISTS mos_entries (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  store            TEXT    NOT NULL,          -- BL1 … BL16
  code             TEXT    NOT NULL,          -- normalised sticker: 'BL-50038-1_5'
  item_no          TEXT    NOT NULL,          -- the category code: '50038'
  description      TEXT,                      -- category name as resolved AT ENTRY TIME
  qty              INTEGER NOT NULL,
  unit_cost_cents  INTEGER,                   -- NULL = no cost on file. NEVER 0 for that.
  unit_price_cents INTEGER,                   -- decoded from the code's last segment
  reason           TEXT    NOT NULL,          -- Stolen | Damaged | Expired | Store Use
  logged_by        TEXT    NOT NULL,          -- name for an associate, email otherwise
  logged_at        TEXT    NOT NULL,          -- ISO 8601 UTC
  edited_by        TEXT,
  edited_at        TEXT
);

-- The log reads "this store, newest first", and the month accordions slice that same
-- ordering. One index serves both.
CREATE INDEX IF NOT EXISTS idx_mos_store_at ON mos_entries(store, logged_at DESC);

-- ── The category-code map, learned and never forgotten ──────────────────────
--
-- 🛑 THIS TABLE EXISTS BECAUSE THE LIVE MAP CANNOT NAME THE STOCK MOS IS FOR.
-- `stickerCategoryCodes` derives category code -> name by reading what Clover CURRENTLY
-- sells. That is correct for printing a sticker, and wrong for marking one out: a
-- category whose items have all left inventory drops out of the map entirely, and that
-- is the precise moment somebody scans the last of it into MOS.
--
-- Measured against production on 2026-09-10, from Brian's own example sheet:
--   50038 -> 'FG BL CONSUMABLES - FOOD - CONDIMENTS'   resolves at BL1
--   14279 -> nothing, at any store with a cached map
-- 14279 is not a bad number — 14281 is Hardlines-Baby and 14160 is Appliances, so it
-- sits in a live range. Its items are spring/summer, and this is September. Six of the
-- thirteen rows on that sheet would have come back blank.
--
-- So: every code the app ever resolves is written here and kept. `source` says how it
-- was learned, because those two facts age differently — a name Clover told us can be
-- refreshed from Clover, a name a person typed is the only record there is and must not
-- be overwritten by a sweep that happens not to see it.
--
-- 🔑 CHAIN-WIDE, NOT PER STORE. The worker's own comment on stickerCategoryCodes is
-- explicit that the category code is per CATEGORY and never per store; only the KV cache
-- is keyed by store, and that is a guard against one store's catalogue answering for
-- another's. A learned name is a fact about the category, so it has no store column.
CREATE TABLE IF NOT EXISTS sticker_codes (
  code        TEXT PRIMARY KEY,               -- '50038' — the category code alone
  description TEXT NOT NULL,
  source      TEXT NOT NULL,                  -- 'clover' (swept) | 'user' (taught once)
  taught_by   TEXT,                           -- who typed it, when source = 'user'
  first_seen  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
