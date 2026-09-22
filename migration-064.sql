-- migration-064: the receipt — line items for archived transactions.
--
-- 🛑 RUN THIS BEFORE DEPLOYING THE WORKER THAT WRITES IT. migration-063 could go either
-- way, because its reader tolerates the table not existing. This one is the write side:
-- bankTransactionsDay inserts here on every run, including the nightly cron. It catches
-- and reports the failure rather than losing the day's payments — but a worker live
-- against a database without this table banks every night with no receipt, and those days
-- have to be re-banked by hand before they age out of Clover. Migration first.
--
-- Apply (address databases by UUID; the staging one lives under [env.staging] and a bare
-- name does not resolve). STAGING FIRST — and note the UUIDs are not in the order you would
-- guess from the file, so they are labelled here rather than left to be matched by eye:
--   STAGING  npx wrangler d1 execute b40982c2-4009-4842-bc17-fa0977468b07 --remote -y --file=migration-064.sql
--   PROD     npx wrangler d1 execute 3fa911d7-31d6-438c-985f-7ac08c407d2d --remote -y --file=migration-064.sql
--
-- 🛑 Re-runnable. Every statement takes IF NOT EXISTS, unlike migration-059's ALTER TABLE
-- ADD COLUMN, which errored on the second run against production.
--
-- WHY THIS EXISTS. The Transactions drawer expands into the receipt — what was actually
-- sold, not just what was paid. Live days get that free: the orders already fetched for
-- the payments now carry `lineItems` too. Archived days do not, because migration-063
-- banked nothing item-level. Without this table every day past Clover's ~90-day window
-- opens to a drawer with no items, permanently, since there is no re-pull once a date
-- leaves that window. The 18-21 June edge is decaying now.

-- ── One row per line of a receipt ────────────────────────────────────────────
--
-- 🔑 KEYED ON THE ORDER, NOT THE PAYMENT. Clover has no notion of "which items this
-- payment covers": a split-tender order has one basket and several payments against it.
-- Measured on production before building this — of 115,798 orders carrying a payment,
-- 1,091 (0.94%) have more than one, worst case five; none is orphaned. Storing per payment
-- would duplicate those baskets and, worse, imply an attribution Clover never made. The
-- read path groups by order_id and hangs the same list off each of the order's payments,
-- labelled when there is more than one.
--
-- `seq` is the line's position in the merged receipt, so the primary key is stable across
-- a re-bank of identical data. It is also DERIVED, which is why bankTransactionsDay wipes
-- a store-day before rewriting it while payment_archive (keyed by Clover's own immutable
-- payment id) never deletes anything.
--
-- `name` and `price` are SNAPSHOTTED, like tender and employee in migration-063. An item
-- renamed or repriced in the catalogue next spring must not silently rewrite what a
-- customer bought in March.
CREATE TABLE IF NOT EXISTS payment_archive_items (
  store     TEXT NOT NULL,
  date      TEXT NOT NULL,          -- ET business date, YYYY-MM-DD
  order_id  TEXT NOT NULL,
  seq       INTEGER NOT NULL,       -- position in the merged receipt
  name      TEXT,                   -- as it read on the ticket, NULL if Clover held none
  qty       REAL,                   -- units; fractional for weighed goods (unitQty/1000)
  price     REAL,                   -- dollars, the LINE total after its line-level discount
  refunded  INTEGER NOT NULL DEFAULT 0,
  banked_at TEXT NOT NULL,
  PRIMARY KEY (store, date, order_id, seq)
);

-- No separate index, deliberately — and this is the one place it differs from
-- migration-063, which needed one because payment_archive's key is `id` alone. The primary
-- key above already builds an index on (store, date, order_id, seq), and both access paths
-- are a leftmost prefix of it: the day read (WHERE store = ? AND date = ? ORDER BY
-- order_id, seq) and the re-bank wipe (DELETE WHERE store = ? AND date = ?). A second
-- index would be dead weight on a table that takes ~400k rows per 90 days.
