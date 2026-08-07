-- migration-036: the fields Raj's own dashboard showed, which we were dropping.
--
-- Handler has been sending all of these since Slice 1; the ingest simply never
-- bound them, so `?action=ebay-cases` could describe a case only as an id, a
-- title and an amount. Raj's table showed the two things that actually tell you
-- what to DO — what the buyer complained about, and what eBay is waiting on —
-- and a link straight into the case on eBay.
--
-- Purely additive: five ALTER TABLE ADD COLUMN, no table rebuilt, no DROP. The
-- D1 cascade trap (migration-029) does not apply — that came from DROPping a
-- parent table, not from adding a column.
--
-- Coverage measured on the live state file, 37 open cases:
--   buyer_reason      37/37    activity_due      34/37
--   item_id           37/37    ebay_url          34/37
--   available_actions 34/37
-- The gaps are real (three cases carry no activityDue at all), so every one of
-- these is nullable and the page falls back rather than printing "undefined".

-- What the BUYER said was wrong: ARRIVED_DAMAGED, NOT_AS_DESCRIBED, WRONG_SIZE…
ALTER TABLE ebay_cases ADD COLUMN buyer_reason TEXT;

-- What EBAY is waiting on: SELLER_APPROVE_REQUEST, SELLER_PROVIDE_LABEL,
-- SELLER_PROVIDE_RMA. This is the single most actionable field in the payload —
-- it is eBay telling you what it wants next.
ALTER TABLE ebay_cases ADD COLUMN activity_due TEXT;

-- 🔑 Handler computes the deep link itself, and its scheme is NOT uniform:
-- RETURN goes to /rt/ReturnDetails?returnId=…, while CASE and INQUIRY go to
-- /itm/<itemId>. Storing his URL rather than inferring a pattern from the
-- RETURN rows is what stops 14 of 37 links being wrong.
ALTER TABLE ebay_cases ADD COLUMN ebay_url TEXT;

-- Fallback for the ~3 cases with no ebayUrl, and useful on its own.
ALTER TABLE ebay_cases ADD COLUMN item_id TEXT;

-- JSON array. eBay's own list of what is currently LEGAL on the case
-- (SELLER_ISSUE_REFUND, SELLER_VOID_LABEL…). Worth storing beyond display:
-- it is the most likely explanation for the HTTP 400s the auto-act path hit.
ALTER TABLE ebay_cases ADD COLUMN available_actions TEXT;
