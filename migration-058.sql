-- One row per pallet dumped into the bins, read off its printed tag.
--
-- 🔑 THE WEEK IS NOT STORED. It is derived from logged_at with autoWeekOf(), the same
-- Sunday-start helper the marketing auto-draft groups by. marketing_drafts.auto_week
-- stores its week because a UNIQUE index needs a column to be unique ON; this table has
-- no such need, and a stored week is a second copy of the timestamp that can disagree
-- with it. It also keeps this feature clear of the Flow Calendar, whose retail weeks run
-- out on 2026-12-26 — a log that stops grouping at the end of F26 would be a strange
-- thing to have shipped.
--
-- 🔑 created_by_tag AND logged_by ARE DIFFERENT FACTS. created_by_tag is the name printed
-- on the tag — whoever built the pallet, upstream, often not a Bargain Lane employee.
-- logged_by is the dashboard user who pressed Submit. "Who made this pallet" and "who
-- received it" are both real questions and collapsing them into one column would answer
-- neither.
--
-- 🔑 Every tag field is TEXT, including the ones that look numeric. The item number,
-- PO and truck # are identifiers, not quantities: nothing adds them up, and leading
-- zeros are meaningful on a printed label. units is the one genuine number — it is
-- summed per week — so it alone is INTEGER.
--
-- 🛑 EVERY TAG FIELD IS NULLABLE ON PURPOSE. The model returns null for anything it
-- cannot read rather than guessing, because a wrong unit count is invisible in a way a
-- blank never is. A NOT NULL here would push the code toward writing '' or 0 to satisfy
-- the constraint, which is exactly the invented value the whole design avoids. Only the
-- provenance columns — store, logged_by, logged_at — are required, because a row that
-- cannot say where it came from is not worth keeping.
--
-- Apply:
--   npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-058.sql
--   npx wrangler d1 execute labor-dashboard-db         --remote --file=migration-058.sql
--
-- Additive: a new table, nothing altered, nothing backfilled.
CREATE TABLE IF NOT EXISTS bin_dumps (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  store          TEXT NOT NULL,     -- BL1..BL16
  barcode        TEXT,              -- text under the big barcode, e.g. PRM-10490-30
  item_no        TEXT,              -- bold, top right; pairs with "Item:"
  pallet_name    TEXT,              -- the italic line under "Item:"
  po             TEXT,
  units          INTEGER,           -- the one field that is a quantity
  created_by_tag TEXT,              -- "Created By:" AS PRINTED — not a dashboard user
  truck_no       TEXT,
  r2_key         TEXT,              -- the tag photo, in the MEDIA bucket
  content_type   TEXT,
  logged_by      TEXT NOT NULL,     -- users.email — who pressed Submit
  logged_at      TEXT NOT NULL,     -- ISO 8601 UTC. The week is derived from THIS.
  edited_by      TEXT,              -- set on a later correction; logged_at never moves
  edited_at      TEXT
);

-- The log is always "this store's pallets, newest first", and the week grouping is done
-- by walking that same ordering. One index serves both.
CREATE INDEX IF NOT EXISTS idx_bin_dumps_store ON bin_dumps(store, logged_at DESC);

-- The duplicate check asks "was this PO logged at this store recently?" on every submit.
-- Without this it is a scan of the store's whole history to answer a question that only
-- looks back an hour.
CREATE INDEX IF NOT EXISTS idx_bin_dumps_po ON bin_dumps(store, po, logged_at DESC);
