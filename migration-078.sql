-- migration-078: item_day_lines — the app's own per-ITEM record, one row per store-day.
--
-- Brian (2026-10-16): "pull inventory numbers before it goes to L2 and L3 categories".
-- aggregateItemSales resolves every receipt line to an L2/L3 and then keeps only the
-- category totals (KV items:<store>:<date>). This keeps the items too: for each item, its
-- Clover category, the L2/L3 the app filed it under, HOW it was matched, and its qty,
-- gross, line and order discounts, refunds, net and cost. Written by saveItemSalesSnapshot
-- beside the items: snapshot and stamped with the same snapshot_time.
--
-- ONE ROW PER STORE-DAY, items as a JSON array. A day is replaced by a single
-- INSERT OR REPLACE, so it can never be half-written, and costs one row write; per-item
-- rows would be ~1,600 writes per store-day (delete + insert), 24 times a night, split
-- across batches that are not one transaction. Range reads aggregate with json_each.
--
--   items_json  [{ itemId, name, code, cloverCategory, l2, l3, source, qty, gross,
--                  lineDiscounts, orderDiscounts, refunds, net, cost, costSource, orders }]
--   other_json  { nonItem, crossDayRefunds, unattributedRefunds, manualRefunds }
--               — what reaches no item. Σ items.net + Σ other == net (the day's netSales).
--
-- Additive: a new table, nothing existing is touched.
--   npx wrangler d1 execute labor-dashboard-db --remote --file=migration-078.sql
-- Confirm it landed (expects one row, item_day_lines):
--   npx wrangler d1 execute labor-dashboard-db --remote \
--     --command="SELECT name FROM sqlite_master WHERE type='table' AND name='item_day_lines'"
CREATE TABLE IF NOT EXISTS item_day_lines (
  store         TEXT    NOT NULL,
  date          TEXT    NOT NULL,      -- ET business date, YYYY-MM-DD (the items: key's date)
  snapshot_time TEXT    NOT NULL,      -- equals items:<store>:<date>.snapshotTime it was written beside
  item_count    INTEGER NOT NULL,
  net           REAL    NOT NULL,      -- the day's netSales, for reconciling without parsing
  items_json    TEXT    NOT NULL,
  other_json    TEXT    NOT NULL,
  PRIMARY KEY (store, date)
);
