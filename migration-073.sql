-- migration-073: an opportunity buy carries its manifest, and a scan reads the price off it.
--
-- Brian, 2026-09-21: "in the Open a buy card add a feature for admin to unload a CSV manifest
-- with product barcode (upc), description, quantity, are price, and street price (MRSP). And
-- use this manifest for users when they scan a product from this PO this is where data will
-- come from."
--
-- The CSV machinery already exists — manifest-upload, csvParse, manifestFindHeader, the
-- vendor_templates column memory, the 4 MB / 5000-row caps. manifest_lines already holds
-- identifier / identifier_type / description / qty / cost / msrp, which is five of the six
-- fields he named. So this migration is not a new table; it is the four things the existing
-- one is missing before an OB manifest can drive a scan.
--
-- ── 1. `manifests.load_id` finally gets its consumer ───────────────────────────────────
--
-- 🔑 IT HAS BEEN DECLARED AND UNUSED SINCE migration-043, commented `-- → buy tracker,
-- later`. Nothing reads it, nothing writes it, every row is NULL. "Later" is now: load_id is
-- the PO, and it is what makes an OB manifest findable from a scan. No new column is needed
-- for the link, only the index — a scan cannot afford a full scan of every manifest ever
-- uploaded to find the one for this buy.
--
-- ── 2. Why the shelf price CANNOT go in `cost` or `suggested_price` ────────────────────
--
-- 🛑 THOSE TWO COLUMNS ALREADY MEAN SOMETHING ELSE, AND THE SCORER READS BOTH.
-- `cost` is what we would PAY the vendor; `suggested_price` is the scorer's own OUTPUT,
-- derived from asp_l3 and velocity under a criteria version. Brian was asked directly what
-- "our price" meant on his sheet and answered: what we SELL it for. Writing a shelf price
-- into `cost` would invert every margin the scorer computes, and writing it into
-- `suggested_price` would forge a verdict the scorer never reached — a number stamped
-- "scored under criteria vN" that no criteria version produced. Hence its own column.
--
-- `msrp` is reused as-is for street price: migration-043 already describes it as
-- "identifies the item; NOT trusted as retail (R6)", which is exactly the standing this
-- feature gives it too. It is shown to the user beside our price and never priced from.
--
-- ── 3. Why a canonical UPC is STORED rather than computed at match time ────────────────
--
-- 🔑 THE TWO SIDES SPELL A BARCODE DIFFERENTLY TODAY, AND THAT IS A SILENT MISS.
-- Manifest identifiers are stored exactly as the vendor's file spelled them. Scanned codes
-- go through merchCanonicalUpc, which strips non-digits and drops the leading zero a UPC-A
-- carries when encoded as EAN-13. So `0085239098745` on a spreadsheet and `085239098745`
-- off a scanner are the same can of beans and do not compare equal. A manifest lookup that
-- fails does not error — it reports "not on this manifest", which is the WRONG ANSWER
-- wearing the right words.
--
-- SQLite cannot call merchCanonicalUpc inside a WHERE, so the normalisation has to happen
-- on write. `ob_upc` holds merchCanonicalUpc(identifier); the scan canonicalises what it
-- read; the match is then plain equality on two values produced by the same function.
--
-- 🔑 Deliberately NOT merchIdForms(). That helper exists to tolerate item_cache rows written
-- before canonicalisation existed. `ob_upc` has no such rows — every value in it is written
-- by the new code — so the legacy spellings it fans out to can never occur here, and an
-- exact match is both simpler and stricter.
--
-- ── 4. Re-upload replaces, and one PO can never have two live manifests ────────────────
--
-- Brian: a second upload for the same PO REPLACES the first, and the replacement is
-- recorded. `superseded_at` is that record — NULL means live, a timestamp means an earlier
-- manifest kept as history. The old rows are never deleted; a price a user was shown last
-- week stays explicable.
--
-- 🔑 THE UNIQUE INDEX IS THE POINT, NOT THE SPEED. Two live manifests on one PO is the
-- failure that hands a user the wrong price with total confidence, and it is invisible —
-- both rows look fine on their own. A partial UNIQUE index makes it unrepresentable in the
-- database rather than merely unlikely in the handler. Ordinary scorer manifests keep
-- load_id NULL and are excluded from the index entirely, so none of them can collide.
--
-- ── Apply ──────────────────────────────────────────────────────────────────────────────
-- Address databases by UUID; the staging one lives under [env.staging] and a bare name does
-- not resolve. STAGING FIRST:
--   staging:     npx wrangler d1 execute b40982c2-4009-4842-bc17-fa0977468b07 --remote -y --file=migration-073.sql
--   production:  npx wrangler d1 execute 3fa911d7-31d6-438c-985f-7ac08c407d2d --remote -y --file=migration-073.sql
--
-- Confirm it landed (expects three rows: ob_price, ob_upc, superseded_at):
--   npx wrangler d1 execute <uuid> --remote -y --json --command="\
--     SELECT 'manifest_lines.' || name AS col FROM pragma_table_info('manifest_lines') \
--       WHERE name IN ('ob_price','ob_upc') \
--     UNION ALL \
--     SELECT 'manifests.' || name FROM pragma_table_info('manifests') WHERE name = 'superseded_at'"
--
-- 🛑 NOT RE-RUNNABLE. `ALTER TABLE ADD COLUMN` takes no IF NOT EXISTS; a second run errors
-- `duplicate column name: ob_price` and stops there. That error is harmless and means it is
-- already applied — check with the pragma above rather than re-running. The three indexes
-- below ARE guarded, so re-running the index half alone is safe.
--
-- 🔑 DEPLOY ORDER: THIS FIRST, THEN THE WORKER, THEN THE FRONTEND (CLAUDE.md rule 6).
-- The new worker INSERTs ob_price/ob_upc and SELECTs on superseded_at, so against a database
-- without them every OB manifest upload and every scan carrying a PO throws. That is the
-- incompatible direction. Columns the live worker never names are invisible to it, so
-- applying this while the current worker runs is safe.
--
-- 🔑 ADDITIVE ONLY. No existing row is read, rewritten or deleted. Every manifest already
-- uploaded keeps load_id NULL, ob_price NULL, ob_upc NULL and superseded_at NULL, which
-- leaves it live, un-POed and scored exactly as it is today.

-- What we SELL it for: the shelf price off Brian's manifest, in dollars, per unit.
-- 🛑 NOT a cost and NOT a scorer verdict — see section 2 above before reading it as either.
-- NULL on every scorer manifest and on any OB line whose sheet left the price blank; a NULL
-- here means "this line has no price", which the scan must say out loud rather than falling
-- back to a number from somewhere else.
ALTER TABLE manifest_lines ADD COLUMN ob_price REAL;

-- merchCanonicalUpc(identifier), so a scan can match without SQLite having to normalise.
-- NULL when the line's identifier is not a UPC at all (a model number or a vendor SKU), and
-- NULL on every line that predates this migration.
ALTER TABLE manifest_lines ADD COLUMN ob_upc TEXT;

-- When this manifest was replaced by a newer upload for the same PO. NULL = live.
-- The superseded rows stay queryable forever; this column only stops them being matched.
ALTER TABLE manifests ADD COLUMN superseded_at TEXT;

-- 🔑 THE INVARIANT, NOT AN OPTIMISATION: at most one LIVE manifest per purchase order.
-- Partial on both conditions, so the thousands of ordinary scorer manifests (load_id NULL)
-- are outside the index and cannot collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS idx_manifests_live_po
  ON manifests(load_id) WHERE load_id IS NOT NULL AND superseded_at IS NULL;

-- "Show me every manifest this buy has ever had", newest first — the buy page's history.
-- Separate from the unique index above because that one cannot serve an ordered read of the
-- superseded rows, which are precisely the ones it excludes.
CREATE INDEX IF NOT EXISTS idx_manifests_by_po
  ON manifests(load_id, uploaded_at DESC) WHERE load_id IS NOT NULL;

-- The scan's only hot path: this manifest, this barcode. Compound because the manifest is
-- always known first (the PO resolves it), and partial because a scorer manifest's lines
-- have no ob_upc and indexing them would cost size for rows no scan can ever reach.
CREATE INDEX IF NOT EXISTS idx_mline_ob_upc
  ON manifest_lines(manifest_id, ob_upc) WHERE ob_upc IS NOT NULL;
