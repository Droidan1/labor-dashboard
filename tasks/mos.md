# Mark Out of Stock (2026-09-10)

Merchandise that leaves the floor without being sold — expired food, damaged seasonal,
product taken for store use, theft. Brian was recording it in a spreadsheet: retail
sticker, item number, description, quantity, date, reason code, typed by hand.

Scan the sticker, say how many and why. Everything else is derived.

## What one scan produces

| Field | Where it comes from |
|---|---|
| Item number | the middle segment of the code |
| Item description | the learned code map, else the live Clover category map |
| Cost each | `category-costs:global`, keyed on that description |
| Retail each | the LAST segment of the code |
| Date and time | now, in Eastern |

Only quantity and reason are typed. Reason is required — a shrink figure you cannot
break down by cause is not worth keeping.

## The three things that were not obvious

**1. The description lookup fails on exactly the stock you are marking out.**

`stickerCategoryCodes` builds category-code → name by reading what Clover CURRENTLY
sells. That is right for printing a sticker and wrong for marking one out: a category
whose items have all gone drops out of the map, and that is the moment somebody scans
the last of it.

Measured against production before building, using Brian's own example sheet:

```
50038 -> FG BL CONSUMABLES - FOOD - CONDIMENTS    resolves at BL1
14279 -> nothing, at any store with a cached map
```

14279 is not a bad number — 14281 is Hardlines-Baby, 14160 is Appliances. Its stock is
spring/summer and this is September. **Six of the thirteen rows on that sheet would have
come back blank.**

So `sticker_codes` learns and never forgets: every code the app resolves is written down
permanently, and the first person to scan one nobody has named types it once. The rule
"a name a person typed outranks one a sweep guessed" is enforced by `mosResolve`
returning on the first row it finds — see the mutation note below.

**2. Cost is per CATEGORY, and the two cost maps collide.**

`fetchItemCosts` returns `items` (keyed by IM#) and `categories` (keyed by the full L3
name). Both contain five-digit keys beginning 50, and 50038 is valid in both — meaning
the per-item map would answer with an unrelated product's cost that still looks
plausible. `mosCostCents` takes the NAME, never a number, so it cannot reach the wrong
map: the signature is the guard, not a check inside it.

Real figures: condiments $0.25/unit, spring/summer $0.35/unit. 42 of the 46 categories
carrying sticker codes have a cost; the four without read **"no cost on file"**, never
$0.00 — zero would mean free merchandise and understate every total it lands in. A month
says how many of its lines are missing a cost rather than presenting a short total as
complete.

⚠️ It is a flat per-category rate, so it flattens: a $60 seasonal item and a $1 one both
cost $0.35. The month total is sound over many lines; one expensive line is not.

**3. Store Use is not shrink.** The month splits them instead of adding them up.

## The QR scanner

The existing camera scanner on Price Scan reads **EAN-13 and UPC-A only** — hand-written
because Safari has never had `BarcodeDetector`, and these are iPhones. QR is a different
problem: finder patterns, a perspective transform, BCH format decoding, masking, and
Reed-Solomon over GF(256). Not a size of thing to hand-roll for a shrink log, and a
subtle bug in the RS step decodes to the WRONG category rather than to nothing.

So `jsqr.min.js` is vendored (jsQR 1.4.0, Apache-2.0, 127KB / 45KB gzipped). Before
committing it, five real sticker codes were round-tripped through generated QR bitmaps at
error-correction level L — the level our ZPL prints:

```
BL-50038-1_5    mode=Alphanumeric+Byte   -> "BL-50038-1_5"
BL-50038-1      mode=Alphanumeric        -> "BL-50038-1"
BL-14279-60     mode=Alphanumeric        -> "BL-14279-60"
BL-50038-10     mode=Alphanumeric        -> "BL-50038-10"
BL-50038-3_25   mode=Alphanumeric+Byte   -> "BL-50038-3_25"
```

Codes containing `_` encode as Byte; whole-dollar codes as Alphanumeric. Both decode.

- **Precached but not script-tagged.** `sw.js` precaches it so the first scan works on
  bad warehouse wifi; `mosLoadDecoder()` injects it on demand so 127KB is not parsed at
  every app start by everyone who never opens the page.
- **`build.sh` is an allowlist** — a committed file not listed there is never deployed
  and 404s silently, which here would mean the Scan button failing in someone's hand.
  Pinned by a test.
- **Reed-Solomon proves a QR was read correctly, not that it was OURS.** The camera will
  happily read a carton label or a poster and return a valid string. `mosLooksLikeSticker`
  shape-checks every decode before it is trusted.
- The Photo button decodes a still with the same reader — no model call, no endpoint. A
  12-megapixel still is sharper than any preview frame, so a creased label that the live
  loop keeps missing usually reads first time from a photo.

## Decisions

| | |
|---|---|
| Reason required | Save stays disabled until one is picked |
| Months are grouping only | nothing to close; any row editable any time |
| Edit changes quantity and reason only | the sticker's own facts are not opinions; a wrong sticker is a delete |
| Delete is manager+ | absent from `ACTION_PAGE`, so no page grant reaches it at any level |
| Cost and price snapshotted at entry | a later cost import must not rewrite what last month came to |
| No CHECK on `reason` | SQLite cannot ALTER one, and migration-029 is the record of what a rebuild costs here |

`storeActionGuard` was `binDumpStoreGuard` until this change. MOS asks exactly the same
question, and a second page calling a bin-dump-named function is how a shared rule starts
getting copied instead of called. Its closed-store sentence is now the caller's, because
"there are no bins to dump into" is nonsense on a shrink screen.

## Verification

- **3,886 assertions across 60 suites**, including a new `scripts/test-mos.mjs` (129).
- **Ten mutations, ten caught** — but two survivors first, and neither was a hole:
  - Reading the colliding IM# map: my mutation indexed `items` with a category NAME,
    which can never hit. The bug is unreachable because of the signature.
  - Dropping `WHERE source <> 'user'` from the learn write: **the clause was dead code.**
    Its only caller passes `'clover'` after establishing there is no row, so it could
    never fire. A guard that cannot fire is not a second layer, it is a claim in the
    source that nothing checks — removed, with the real guard (the early return in
    `mosResolve`) mutated instead and caught.
  - 🔑 **A surviving mutation is not automatically a gap in the tests.** Check whether
    the mutation is a real bug before writing an assertion to catch it, or you end up
    pinning a behaviour that could never have broken.
- **51 browser assertions** in headless Chromium against the BUILT `dist/`, over four
  scenarios (manager in both themes, associate with edit, associate with view). Contrast
  computed against the real composited background on seven selectors in both themes.
  Not committed: Playwright is not a dependency.

## Still open

- **Nothing is applied to either database.** `migration-062.sql` has not run, so the page
  500s until it does. Deploy order is migration → worker → frontend.
- The learned map starts EMPTY. The first scan of any code teaches it, so early on people
  will be asked to name things more often than they will later.
- Only Bargain Lane. `ACTION_BUSINESS` maps all five actions to `bl`.
