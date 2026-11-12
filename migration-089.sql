-- migration-089: discount detail — which button, on what, rung by whom (2026-11-12).
--
-- Brian (2026-11-12): a Discounts & Returns page and agent reads, so "why did October discounts
-- jump" never needs clover.com. The hub already knew each store-day's discount DOLLARS (the items:
-- snapshot, and item_day_lines from 2026-10-14) but kept no discount NAME, button or employee.
-- Returns need nothing new: payment_archive already banks every refund and manual refund.
--
-- Written by aggregateItemSales' line sink, in the same pass that books the Retail Summary's
-- discounts, so Σ value_cents for a store-day equals that day's discounts. Two writers:
--   - saveItemSalesSnapshot, beside item_day_lines (the nightly sweep of today + 2 prior days,
--     and the items-snapshot endpoint);
--   - ?action=bank-discounts, the backfill, which writes ONLY these tables.
--
-- Additive: three new tables, nothing existing is touched. Re-runnable (IF NOT EXISTS). Either
-- order with the worker is safe — the writer logs and carries on without the tables and the
-- readers answer 503 JSON — but apply it first, or the nights before it bank nothing.
--   STAGING  npx wrangler d1 execute labor-dashboard-db-staging --env staging --remote --command="$(cat migration-089.sql)"
--   PROD     npx wrangler d1 execute labor-dashboard-db --remote --command="$(cat migration-089.sql)"
-- Confirm (read-only; expects the three names):
--   npx wrangler d1 execute labor-dashboard-db --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'discount_%'"
-- Rollback: DROP TABLE discount_lines; DROP TABLE discount_days; DROP TABLE discount_classes;

-- ── One row per discount, per category it landed on ─────────────────────────
--
-- An ITEM-level discount sits on one receipt line, so its row is that line (line_id, line_name,
-- item_id set). An ORDER-level discount is spread over the order's lines by their share of the
-- post-line-discount subtotal — the rule the Retail Summary already uses — and summed per L2/L3,
-- so a 10% off a 30-line basket is a few rows, not thirty. `lines` says how many lines a row covers.
--
-- app_id is Clover's id for that one application of a discount (one press of the button), so
-- COUNT(DISTINCT app_id) counts uses. value_cents is integer cents, positive, so sums are exact.
-- name, employee and approver are SNAPSHOTTED, like payment_archive: a button renamed or an
-- employee deleted next month must not rewrite who discounted what in October.
CREATE TABLE IF NOT EXISTS discount_lines (
  store         TEXT    NOT NULL,
  date          TEXT    NOT NULL,      -- ET business date (the order's clientCreatedTime), YYYY-MM-DD
  app_id        TEXT    NOT NULL,      -- Clover discount element id: one application
  l2            TEXT    NOT NULL,      -- as the hub filed the line(s)
  l3            TEXT    NOT NULL,
  level         TEXT    NOT NULL,      -- item | order
  order_id      TEXT    NOT NULL,
  ts            INTEGER,               -- epoch ms, the order's clientCreatedTime
  button_id     TEXT,                  -- the register's discount (inventory Discount id), NULL if typed in
  name          TEXT,                  -- as rung
  name_key      TEXT    NOT NULL,      -- lower-cased, trimmed name: joins discount_classes
  percentage    REAL,                  -- whole percent, for a % discount
  fixed_cents   INTEGER,               -- the flat amount, for a $ discount
  value_cents   INTEGER NOT NULL,      -- dollars this row took off, in cents
  lines         INTEGER NOT NULL,      -- receipt lines this row covers
  line_id       TEXT,                  -- item level only
  line_name     TEXT,
  item_id       TEXT,
  employee_id   TEXT,                  -- who took the order
  employee      TEXT,
  approver_id   TEXT,                  -- who approved the discount, when Clover says
  approver      TEXT,
  snapshot_time TEXT    NOT NULL,
  PRIMARY KEY (store, date, app_id, l2, l3)
);

-- ── The ledger: is this store-day whole? ────────────────────────────────────
--
-- expected_cents is the discount total the day's items: snapshot already holds. The nightly
-- writer computes both in one pass, so they match by construction; the backfill re-reads Clover
-- weeks later and is compared against what was snapshotted at the time. complete = 1 only when
-- they agree. Clover thins old days out rather than erroring, so this is the check that notices.
CREATE TABLE IF NOT EXISTS discount_days (
  store          TEXT    NOT NULL,
  date           TEXT    NOT NULL,
  snapshot_time  TEXT    NOT NULL,
  apps           INTEGER NOT NULL,     -- distinct applications
  rows           INTEGER NOT NULL,
  total_cents    INTEGER NOT NULL,
  expected_cents INTEGER,              -- NULL when there was nothing to compare against
  complete       INTEGER NOT NULL,
  note           TEXT,
  source         TEXT    NOT NULL,     -- nightly | backfill
  PRIMARY KEY (store, date)
);

-- ── Planned or manual: an editable mapping, not code ────────────────────────
--
-- Keyed by name, not Clover's discount id: the same button has a different id at every
-- merchant. A name with no row here reads as "unclassified" until an admin sets it.
CREATE TABLE IF NOT EXISTS discount_classes (
  name_key   TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  class      TEXT NOT NULL CHECK (class IN ('planned', 'manual')),
  updated_by TEXT,
  updated_at TEXT NOT NULL
);
