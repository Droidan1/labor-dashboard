-- migration-063: the payment archive — transaction detail that outlives Clover.
--
-- Apply (address databases by UUID; the staging one lives under [env.staging] and a bare
-- name does not resolve). STAGING FIRST — and note the UUIDs are not in the order you would
-- guess from the file, so they are labelled here rather than left to be matched by eye:
--   STAGING  npx wrangler d1 execute b40982c2-4009-4842-bc17-fa0977468b07 --remote -y --file=migration-063.sql
--   PROD     npx wrangler d1 execute 3fa911d7-31d6-438c-985f-7ac08c407d2d --remote -y --file=migration-063.sql
--
-- 🛑 Re-runnable. Every statement takes IF NOT EXISTS, unlike migration-059's ALTER TABLE
-- ADD COLUMN, which errored on the second run against production.
--
-- WHY THIS EXISTS. Clover returns at most ~90 days of payment history and says so in terms
-- ("the results will not exceed 90 days", Get all payments). Until now nothing per-payment
-- was stored anywhere — daily_sales is one row per store-day and the KV item snapshot is
-- category-grain — so the Transactions tab was a live window on the last quarter and
-- everything older was simply gone. This table is the copy that survives.
--
-- 🔑 THE ONE FAILURE MODE THAT MATTERS. Once a date leaves Clover's window, whatever is in
-- here is all that will ever exist for it; there is no re-pull. So a day banked INCOMPLETELY
-- and recorded as complete is a permanent, unfixable loss of detail. That is why
-- completeness is a stored FACT (payment_archive_days.complete) rather than an assumption,
-- why it is earned by a cross-check against daily_sales rather than by the write succeeding,
-- and why a day already marked complete is never replaced by a fetch that returns fewer rows.

-- ── One row per transaction ──────────────────────────────────────────────────
--
-- 🔑 EVERY DISPLAY FIELD IS SNAPSHOTTED, NOT RESOLVED AT READ TIME. `tender` and `employee`
-- arrive from Clover as IDs and are resolved through /tenders and /employees at bank time.
-- Storing the resolved NAME looks redundant while those endpoints still answer — it is not.
-- An employee who leaves can be deleted from the merchant account, and a tender can be
-- renamed; neither must silently rewrite who rang a sale in March. The same trade
-- `sticker_prints.price_cents` and `mos_entries` already make.
--
-- id is Clover's own payment/refund/credit id, so re-banking a day is idempotent by
-- construction: the same transaction lands on the same primary key.
CREATE TABLE IF NOT EXISTS payment_archive (
  id            TEXT PRIMARY KEY,
  store         TEXT NOT NULL,
  date          TEXT NOT NULL,          -- ET business date, YYYY-MM-DD
  kind          TEXT NOT NULL,          -- payment | refund | manual | void
  order_id      TEXT,
  ts            INTEGER,                -- epoch ms, as Clover reports it
  amount        REAL,                   -- dollars; negative for refunds and credits
  tax           REAL,
  tip           REAL,
  tender        TEXT,                   -- resolved label, e.g. "Cash"
  tender_kind   TEXT,                   -- cash | card | gift | other
  employee      TEXT,                   -- resolved name
  customer      TEXT,
  source        TEXT,
  cash_tendered REAL,
  result        TEXT,
  reason        TEXT,
  refund_of     TEXT,                   -- the payment a refund reverses
  banked_at     TEXT NOT NULL
);

-- The tab reads one store-day at a time, newest first. That is the only access path.
CREATE INDEX IF NOT EXISTS idx_payment_archive_store_date ON payment_archive(store, date);

-- ── The completeness ledger ──────────────────────────────────────────────────
--
-- 🛑 THIS IS THE SAFETY MECHANISM, NOT BOOKKEEPING. `complete` is 1 only when the Clover
-- fetch came back whole AND the banked figures reconcile with daily_sales for that
-- store-day. A day at complete=0 is visibly partial: it can be re-banked while it is still
-- inside Clover's window, and it is never presented as the whole truth once it is not.
--
-- Clover degrades at its retention edge by returning FEWER rows rather than erroring — a
-- BL4 backfill once received 153 of a day's 241 orders and overwrote a complete snapshot
-- reporting written:1, errors:0. Nothing caught it because the count was non-zero. Hence a
-- cross-check on every write, and never a bare "it did not throw".
CREATE TABLE IF NOT EXISTS payment_archive_days (
  store        TEXT NOT NULL,
  date         TEXT NOT NULL,
  rows         INTEGER NOT NULL,        -- transactions banked, all kinds
  payments     INTEGER NOT NULL,        -- the payments tab's count
  gross        REAL NOT NULL,           -- sum of payment amounts, tax included
  net          REAL NOT NULL,           -- gross - tax - refunds; comparable to daily_sales.total
  expected_net REAL,                    -- daily_sales.total at bank time, or NULL if no row
  complete     INTEGER NOT NULL,        -- 1 only if the fetch was whole AND it reconciled
  note         TEXT,                    -- why it is not complete, when it is not
  banked_at    TEXT NOT NULL,
  PRIMARY KEY (store, date)
);
