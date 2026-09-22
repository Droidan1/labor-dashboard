-- What a furniture piece IS, recorded alongside how it is built.
--
-- WHY — the ten furniture categories group by construction (READY TO ASSEMBLE, UPHOLSTERY,
-- CASEGOODS) or by vendor (WAYFAIR, BAILEY'S, COMPTON'S). Exactly one of them, MATTRESSES,
-- names an item. So nothing in the taxonomy says whether a thing is a dining chair or a
-- bookcase, and those are not one price.
--
-- 🔑 THIS COLUMN DRIVES NOTHING YET, ON PURPOSE. Inventing twenty item types and a hundred
-- and ten price bands today would be guessing: the first four pieces photographed were
-- three office chairs and an armchair, which tells us nothing about what actually comes
-- through the door. The vision call already describes each piece, so naming the type costs
-- nothing extra — record it for a few weeks and the list writes itself from real stock.
--
-- The category a manager picks stays the dimension that reports, prices and bands. This
-- sits underneath it.
--
-- Apply:
--   npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-053.sql
--   npx wrangler d1 execute labor-dashboard-db         --remote --file=migration-053.sql
--
-- Additive. Existing rows keep NULL, which is honest — nobody asked what they were.
ALTER TABLE furniture_pieces ADD COLUMN item_type TEXT;

-- Read as "what did we see, and how often" once there is enough to look at.
CREATE INDEX IF NOT EXISTS idx_furniture_type ON furniture_pieces (item_type, priced_at DESC);
