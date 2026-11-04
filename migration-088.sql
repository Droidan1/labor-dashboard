-- migration-088: Whatnot shipment per order item, for the shipments count (2026-11-04).
--
-- Brian (2026-11-04): the Whatnot API is the only source of Whatnot sales, and the Executive Summary's
-- daily Whatnot PDF keeps its Shipments tile. Whatnot puts `shipment_id` on each order item, which the
-- hourly sync already reads (/orders/{id}/items) but did not keep. Shipments = distinct shipment_id
-- over the items of orders not cancelled or failed.
--
-- syncWhatnotItems (worker.js) is the only writer: new items get it as they are read; items read
-- before this migration, of orders from 2026-11-01 on, are read again, 100 orders an hour. '' = read,
-- and Whatnot gave none (never NULL afterwards, so nothing is read twice).
--
-- Additive: one nullable column and an index. Either order with the worker is safe: the worker checks
-- for the column (PRAGMA table_info) and reads shipments as null until it exists.
--   npx wrangler d1 execute labor-dashboard-db --remote --command="$(cat migration-088.sql)"
-- Confirm (read-only; expects shipment_id last):
--   npx wrangler d1 execute labor-dashboard-db --remote --command="PRAGMA table_info(whatnot_order_items)"
-- Rollback: DROP INDEX idx_whatnot_items_shipment; ALTER TABLE whatnot_order_items DROP COLUMN shipment_id;
-- 🛑 Not idempotent (SQLite has no ADD COLUMN IF NOT EXISTS): a second run fails on the duplicate
--    column and changes nothing.

ALTER TABLE whatnot_order_items ADD COLUMN shipment_id TEXT;   -- Whatnot shipment id; '' = none given
CREATE INDEX IF NOT EXISTS idx_whatnot_items_shipment ON whatnot_order_items(shipment_id);
