-- migration-092: one product photo per E-Commerce SKU (2026-11-18).
--
-- Brian (2026-11-18): add product photos to the Items tab. Order lines carry none, so the photo is
-- the catalog's ImageUrl. The probe that day showed the read-only login gets it, and the photos
-- open with no login from Sellercloud's image host, so the page can show them directly.
--
-- syncSellercloud looks up SKUs that have no row here yet, 50 to a catalog call, and writes one
-- row each — once per SKU, soon after it first sells, because one-of-a-kind items leave the
-- catalog once sold (4 of the 10 latest SKUs on 2026-11-18). A SKU the catalog does not have gets
-- in_catalog 0 and no photo; the write never blanks a stored one. ?action=ecom-items joins it.
--
-- Additive: one new table, nothing existing is touched. Re-runnable (IF NOT EXISTS). Either order
-- with the worker is safe: without the table the sync skips photos and the read leaves them out.
CREATE TABLE IF NOT EXISTS ecom_products (
  sku         TEXT PRIMARY KEY,                -- Sellercloud ProductID, as on ecom_order_items.sku
  image_url   TEXT,                            -- https on Sellercloud's image host; NULL = no photo
  in_catalog  INTEGER NOT NULL DEFAULT 1,      -- 0 when the last lookup found no such product
  checked_at  TEXT    NOT NULL
);
