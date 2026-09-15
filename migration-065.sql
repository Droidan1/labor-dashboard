-- migration-065: Inventory Receiver — trucks, and the pallets received off them.
--
-- A truck arrives, someone photographs its Bill of Lading, and every pallet that comes
-- off the trailer is scanned against that BOL until the trailer is empty.
--
-- 🛑 RUN THIS BEFORE DEPLOYING THE WORKER. Every `truck-*` action reads or writes one of
-- these two tables; there is no tolerant read path. A worker live against a database
-- without them fails every receive with a 500, at the dock, with a trailer waiting.
--
-- Apply (address databases by UUID; the staging one lives under [env.staging] and a bare
-- name does not resolve). STAGING FIRST — the UUIDs are labelled rather than left to be
-- matched by eye, because they are not in the order the file would suggest:
--   staging:     npx wrangler d1 execute b40982c2-4009-4842-bc17-fa0977468b07 --remote -y --file=migration-065.sql
--   production:  npx wrangler d1 execute 3fa911d7-31d6-438c-985f-7ac08c407d2d --remote -y --file=migration-065.sql
--
-- 🛑 Re-runnable. Every statement takes IF NOT EXISTS, unlike migration-059's ALTER TABLE
-- ADD COLUMN, which errored on its second run against production.
--
-- 🔑 WHY THIS IS NOT `bin_dumps`. Receiving a pallet off a trailer and dumping one into a
-- bin are different OPERATIONS (Brian, 2026-09-15: "they have nothing to do with the bin
-- dump page, they are operations and procedures"). A barcode present in both tables is a
-- pallet that was received and later dumped — the normal life of a pallet, not a double
-- count. The duplicate check here reads `truck_pallets` and nothing else, and that is a
-- decision, not an omission; `scripts/test-inventory-receiver.mjs` pins it so.

-- ── The truck ───────────────────────────────────────────────────────────────
--
-- 🔑 THE MONTH IS DERIVED FROM `opened_at`, NEVER STORED, and derived in EASTERN. A truck
-- opened 9pm ET on the 30th is 01:00 UTC on the 1st, so a UTC-derived month files it under
-- a month the store had not begun working — the same fault `binDumpWeekOf()` exists to
-- avoid, one calendar unit up. Deriving it also means a truck opened Sep 30 that comes
-- down Oct 1 stays in September and never moves, which is what Brian asked for.
--
-- 🔑 `pallet_count` IS WHAT THE BOL CLAIMS, not what was received. The count received is
-- COUNT(*) over truck_pallets. Storing a received count would create two numbers that can
-- disagree, and the disagreement between claimed and received IS the signal — it is how a
-- short truck is spotted at all.
--
-- ⚠️ EVERY FIELD OFF THE PAPERWORK IS NULLABLE, on purpose, including `bol_no`. A torn or
-- glare-blown header must still be openable; NOT NULL would push the code toward writing
-- '' to get past it, and '' claims "read, and empty", which is a different fact from "not
-- read". The worker requires at least one identifying field, where the rule can be stated
-- in a sentence a person can read.
--
-- ⚠️ TEXT, not INTEGER, for bol_no / trailer_no / seal_no / pro_no. They are identifiers,
-- not quantities: leading zeros are significant and arithmetic on them is meaningless.
-- `pallet_count` is the one that is genuinely a count.
CREATE TABLE IF NOT EXISTS trucks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  store           TEXT    NOT NULL,       -- BL1 … BL16, the store receiving it
  bol_no          TEXT,                   -- top right of the form. The number Brian names first.
  ship_from       TEXT,                   -- top left. 'RM1'. The other number he names.
  ship_from_addr  TEXT,
  ship_to         TEXT,
  bol_date        TEXT,                   -- ISO when parseable, else NULL. Never a guess.
  carrier         TEXT,
  trailer_no      TEXT,
  seal_no         TEXT,                   -- handwritten on every sample seen. The hardest read.
  pro_no          TEXT,
  pallet_count    INTEGER,                -- what the BOL CLAIMS. NULL when not printed.
  r2_key          TEXT,                   -- the BOL photo, in the MEDIA bucket
  content_type    TEXT,
  opened_by       TEXT    NOT NULL,       -- name for an associate, email otherwise
  opened_at       TEXT    NOT NULL,       -- ISO 8601 UTC. The MONTH derives from THIS.
  closed_by       TEXT,                   -- set by Truck Down
  closed_at       TEXT,                   -- NULL means still on the dock
  close_note      TEXT,
  dup_approved_by TEXT,                   -- a manager let a repeated bol_no through
  dup_approved_at TEXT,
  dup_reason      TEXT,
  edited_by       TEXT,
  edited_at       TEXT
);

-- 🛑 ONE OPEN TRUCK PER STORE, ENFORCED HERE AND NOT ONLY IN THE HANDLER. A partial unique
-- index is the whole reason a pallet scan needs no truck picker: there is exactly one truck
-- it could belong to, so a pallet cannot be filed against the wrong BOL. Two people opening
-- a truck at the same moment is a real race on a dock with two phones, and a handler check
-- loses it. This does not.
CREATE UNIQUE INDEX IF NOT EXISTS idx_trucks_one_open ON trucks(store) WHERE closed_at IS NULL;

-- The Trucks tab reads "this store, newest first"; the month accordions slice that ordering.
CREATE INDEX IF NOT EXISTS idx_trucks_store_opened ON trucks(store, opened_at DESC);

-- The duplicate-BOL check. Store-prefixed, unlike the barcode index below, because that
-- check IS store-scoped: BOL numbers are a shipper's sequence and repeat freely across
-- shippers, so crossing stores here would block on numbers that have nothing to do with
-- each other.
CREATE INDEX IF NOT EXISTS idx_trucks_bol ON trucks(store, bol_no, opened_at DESC);

-- ── The pallets ─────────────────────────────────────────────────────────────
--
-- The eight tag fields are BIN_DUMP_FIELDS, unchanged and in that order. The tag is the
-- same piece of cardboard, read by the same prompt; only the operation around it differs.
--
-- 🔑 `created_by_tag` (printed on the tag — who BUILT the pallet) and `logged_by` (the app
-- user who scanned it in) are different facts, and both are kept. Collapsing them answers
-- neither question later.
--
-- 🔑 `store` IS DENORMALISED FROM THE TRUCK. The duplicate lookup is `WHERE barcode = ? AND
-- logged_at >= ?` across every store and then redacts by store; carrying the store on the
-- row keeps that off a join in the one query that runs on every single scan. The invariant
-- is that it is copied from trucks.store at insert and never updated — a pallet cannot move
-- stores, because a truck cannot.
--
-- 🔑 `dup_approved_by` NON-NULL IS THE RECORD THAT A BLOCK WAS OVERRIDDEN, and `dup_reason`
-- is why. This is the row someone reads in a month when a unit count looks doubled, so the
-- reason is stored rather than merely required.
CREATE TABLE IF NOT EXISTS truck_pallets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  truck_id        INTEGER NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
  store           TEXT    NOT NULL,       -- copied from trucks.store at insert; never updated
  barcode         TEXT,                   -- text under the barcode: PRM-10490-30 / P-082626-725979
  item_no         TEXT,                   -- pairs with "Item:". An identifier, never a quantity.
  pallet_name     TEXT,                   -- may wrap two lines on the tag; joined with single spaces
  sup_ref         TEXT,                   -- second tag format only
  po              TEXT,                   -- "PO:" or "WO:" — one label per tag, never both
  units           INTEGER,                -- the one tag field that is genuinely a count
  created_by_tag  TEXT,                   -- "Created By:" AS PRINTED. Not a dashboard user.
  truck_no        TEXT,                   -- first tag format only. NOT the trucks.id.
  r2_key          TEXT,                   -- the tag photo
  content_type    TEXT,
  logged_by       TEXT    NOT NULL,
  logged_at       TEXT    NOT NULL,       -- ISO 8601 UTC. An edit never moves this.
  dup_approved_by TEXT,                   -- a manager let a repeated barcode through
  dup_approved_at TEXT,
  dup_reason      TEXT,
  edited_by       TEXT,
  edited_at       TEXT
);

-- 🛑 NOT STORE-PREFIXED, deliberately, and for the same reason idx_bin_dumps_barcode is not:
-- the duplicate lookup crosses stores, so a store-first index would not serve it. One pallet
-- cannot be in two places, and a match at a store the caller does not hold still has to stop
-- them — redacted down to a date, but stopping them.
CREATE INDEX IF NOT EXISTS idx_truck_pallets_barcode ON truck_pallets(barcode, logged_at DESC);

-- The open truck's own list, newest first.
CREATE INDEX IF NOT EXISTS idx_truck_pallets_truck ON truck_pallets(truck_id, logged_at DESC);
