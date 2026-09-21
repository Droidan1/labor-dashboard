# Opportunity buys — tracking a buy by PO — design note

> Status: **Future feature** · specified, not built
> Captured 2026-09-21 from a design conversation with Brian. Every file:line below was
> read on that date against `main` at `82254d4`.

## What Brian asked for

> *"One of the things we want to do is being able to track an opportunity buy (OB)... We
> want to add a new L4, this will be our PO. Every PO is assigned to every opportunity buy,
> so it's unique."*

> *"Let's not worry about the different cost for OB's, just ignore I said that for now.
> **My biggest problem is tracking those items.**"*

> *"What if we add the PO on the end of the BL number, so `BL-5008-2-99999`?"*

Cost is explicitly out of scope. The goal is to be able to ask, of a purchase order:
what came in on it, where did it go, and how much of it has sold.

## The one constraint that decides everything

**The register only ever sees the Clover item.** A sale reaches us as a line on an order,
and what we keep of that line is this — `migration-064.sql:44`:

```sql
CREATE TABLE IF NOT EXISTS payment_archive_items (
  store, date, order_id, seq,
  name,      -- as it read on the ticket
  qty, price, refunded, banked_at,
  PRIMARY KEY (store, date, order_id, seq)
);
```

No `item_id`. No `code`. No `sku`. No `ALTER TABLE payment_archive_items` exists in any of
the 69 migrations. Worse, the banking fetch does not even expand `lineItems.item`
(`worker.js:1872`), so the id is not in the payload to drop.

And the surviving `name` is **the L3 key verbatim** — `worker.js:23443`, `const name = l3;`
— which every price point in the category shares. The `BL-` string goes to Clover's
`code` and `sku` (`worker.js:19654`) and is stored nowhere else.

Two conclusions follow, and the whole design hangs off them:

1. **To attribute a sale to a PO, OB items must carry a PO-distinct code.** If two buys
   share one Clover item, no amount of reporting can separate them afterwards. Brian's
   instinct to put the PO in the code is not decoration — it is the *only* channel that
   reaches the register.
2. **Sell-through by PO cannot be backfilled, ever.** Clover retention is 90 days and
   `worker.js:2131` is blunt: *"Once a date leaves Clover's window there is no re-pull:
   whatever is banked is all that will ever exist."* CLAUDE.md rule 1 forbids re-pulling
   healthy dates regardless. **OB sales history begins the day the archive change deploys.**

## What the code already gives us, ranked by usefulness

1. **The PO already enters the system.** `truck_pallets.po` (`migration-065.sql:117`) and
   `bin_dumps.po` (`migration-058.sql:40`) are populated at receiving from the printed
   pallet tag (`"PO:"` or `"WO:"`). They are free-text, nullable and unindexed, and
   **nothing joins on them** — but the number is already being typed in, by the right
   person, at the right moment. A PO picker should offer these, not a blank box.
2. **`manifests.load_id`** (`migration-043.sql:39`) is declared with the comment
   `-- → buy tracker, later` and appears in **no** worker or client code — the hook was
   anticipated and never wired.
3. **`sticker_prints`** (`migration-056.sql:26`, + `retail_cents` in 057, `qty` in 069)
   already has exactly the right grain — `store, l3, price_cents, code, title, qty,
   printed_by, printed_at`. It is one nullable column short of being a per-PO ledger.
4. **The Price Scan page is the natural capture point.** At the moment of pricing it
   already knows store, L2, L3, price, retail, user and quantity, and can already create
   a Clover item at all six stores (`sticker-create-price-point`, `worker.js:23356`).
5. **The sticker can already print a PO.** `number_po` shipped 2026-09-21 and renders
   `50008-99999` (`psZpl`, `index.html:24162`). It is inert until something supplies a PO.
6. **Per-PO cost is not expressible and is out of scope anyway.** `l3UnitCost`
   (`worker.js:11079`) takes a category name and no item identity at all.

## Four approaches

### A — PO as a fourth code segment: `BL-50008-2_5-99999` (Brian's proposal)

This is the only approach that can ever support sell-through, for the reason above. It is
also the one with a real blast radius. The grammar today is two segments, anchored:

```js
// worker.js:12989  mosParseCode — and worker.js:12978 mosNormalizeCode, same shape
/^BL-(\d{1,10})(?:-(\d+(?:_\d{1,2})?))?$/
```

A four-segment code **fails closed** — `null`, no throw. That sounds safe and is not:

- `mos-lookup` and `mos-log` return HTTP 400 `BAD_CODE` (`worker.js:24604`, `24637`).
  An OB item could not be marked down or written off at all.
- The camera gate `MOS_CODE_RE` (`index.html:28469`) is anchored too, and a non-matching
  decode is **silently skipped** (`28470`, gates at `28559`, `28637`). To a user that is
  not "invalid code", it is *"this scanner is broken."*
- `siblingRe` is prefix-only (`worker.js:23489`), so an OB item **can be chosen as the
  sibling** whose `hidden`/`taxable`/`cost` a new ordinary item inherits.
- The sibling-price filter (`worker.js:23412`) passes 4-segment codes through
  `startsWith` and then drops them at `mosParseCode`. OB prices vanish from the
  price-range warning and from `existing_prices` — **silently weakening the duplicate
  check that already cost us five duplicate items on 2026-09-21.**

Twelve parse sites in all, plus `scripts/test-mos.mjs` and `scripts/test-price-scan.mjs`.
One thing that does *not* break: the category learner captures `/^BL-(\d+)-/`
(`worker.js:13176`), so a PO is never mistaken for a category number.

### B — PO in the third slot: `BL-50008-99999`

**Do not.** It matches the existing regex and silently yields `priceCents: 9999900` — a
**$99,999.00 shelf sticker**. This is already true today for any hand-typed code of that
shape; it is the one failure mode with no error attached.

### C — Clover tags, labels or attributes

Brian asked this directly. The answer is no, for a reason that has nothing to do with
effort: **it does not solve the problem.** All 28 Clover URLs in the repo resolve to
`items`, `category_items`, `categories`, `orders`, `refunds`, `credits` — tags, labels,
attributes, `item_stocks` and `item_groups` are never touched, and no helper exists. But
even if they were, a tag lives on the *item*, and the sales archive carries no item
identity, so sales-by-tag is exactly as impossible as sales-by-code. It would be a whole
new Clover surface to build and maintain in exchange for the catalogue half only — which
approach D gives us without touching Clover at all.

### D — First-class OB tables, no code change (recommended start)

A `ob_buys` table plus a nullable `po` on `sticker_prints`, captured by an OB mode on the
Price Scan page. This answers *"what is in this buy, how many labels went out, to which
stores, by whom"* on day one, with **zero** impact on the code grammar, MOS, the scanner
or the duplicate check. It does not answer sell-through — nothing can, until A ships.

The honest framing: **D and A are not alternatives, they are phases.** D is the part that
is cheap and safe; A is the part that is expensive and unavoidable if sell-through is
really wanted.

## Recommended phased build

### Phase 1 — the buy exists (~2 days)

- `migration-070.sql` (069 is the highest today; 032 is absent, do not reuse it):
  - `ob_buys` — `po TEXT PRIMARY KEY, label TEXT, vendor TEXT, received_on TEXT,
    note TEXT, status TEXT NOT NULL DEFAULT 'open', created_by TEXT, created_at TEXT`.
  - `ALTER TABLE sticker_prints ADD COLUMN po TEXT;` — NULL for every existing row, and
    deliberately not backfilled: a print that happened before the concept existed has no
    PO, and inventing one would be a lie in a ledger.
  - `CREATE INDEX idx_sticker_prints_by_po ON sticker_prints(po, printed_at DESC);` —
    the existing index is `(printed_by, printed_at)`, so a per-PO query is a full scan
    without this.
- Worker: `ob-buys` (list/create/close), and `po` accepted and stored by
  `sticker-printed` (`worker.js:23141`). Gate at `canSeeFinancials` to match every other
  sticker and merch endpoint; gate create/close at `canAccessInventory`.
- Client: an **OB mode** on Price Scan, in the existing `psChrome(mode)` switch. Pick a PO
  first, then scan or price by hand exactly as today; every print in that session carries
  the PO. Offer recently-seen `truck_pallets.po` values in the picker rather than a blank
  box.
- Report: one buy → its items, stores, units printed, first and last print.

### Phase 2 — OB items are distinct in Clover (~3 days)

Only worth starting if Phase 3 is actually wanted, because this is the phase that pays
Approach A's price.

- Extend the grammar with an **explicit marker** so a PO can never occupy the price slot:

  ```js
  //                        category          price (optional)        PO (optional, marked)
  /^BL-(\d{1,10})(?:-(\d+(?:_\d{1,2})?))?(?:-P(\d{1,12}))?$/
  ```

  `BL-50008-2_5-P99999` → category 50008, $2.50, PO 99999.
  `BL-50008-P99999` → category and PO, no price — parseable, and *not* $99,999.
  This does not fix hand-typed `BL-50008-99999` (still mis-reads as a price today), but
  it guarantees the new form can never be confused with one.

  Run against both, 2026-09-21 — every existing shape parses **identically**, which is the
  property that matters most, since a regression here moves prices on shelves:

  | code | current | proposed |
  |---|---|---|
  | `BL-50008-2_5` | $2.50 | $2.50 |
  | `BL-50008-10` | $10.00 | $10.00 |
  | `BL-50008` | no price | no price |
  | `BL-50008-2_5-99999` | rejected | rejected |
  | `BL-50008-99999` | **$99,999.00** | **$99,999.00** (pre-existing, see B) |
  | `BL-50008-2_5-P99999` | rejected | cat 50008, $2.50, **PO 99999** |
  | `BL-50008-P99999` | rejected | cat 50008, no price, **PO 99999** |
  | `BL-50008-P99999-P888` | rejected | rejected |
  | `BL-50008-2_5-P` | rejected | rejected |

- Fix all twelve parse sites, not only the regex pair. In particular
  **`worker.js:23412` must stop dropping OB codes**, or Phase 2 re-opens the duplicate
  hazard from 2026-09-21 on its own.
- Update `scripts/test-mos.mjs:73-117, 465-470` and
  `scripts/test-price-scan.mjs:1867-1930, 2165-2198, 3819-3850`.
- The sticker's `number_po` option stops being inert at this point.

### Phase 3 — sell-through (~3 days, and it starts from zero)

- `ALTER TABLE payment_archive_items ADD COLUMN code TEXT;`
- Expand `lineItems.item` on the banking fetch (`worker.js:1872`) so the code is in the
  payload at all. Watch the payload size and Clover rate limits.
- **Add the code to the line merge key.** Today it is
  `JSON.stringify([li.name ?? null, unitCents, refunded])` (`worker.js:1944`) — two OB
  items from different POs share a name and can share a price, so without this they merge
  into one archive row and the PO split is lost at the last step.
- Then: sale → `code` → PO → `ob_buys`. Sell-through, units remaining, days-to-sell.

## ⚠️ Things to be careful about

**The duplicate-item hazard is the sharp one.** `worker.js:23412` filters
`startsWith('BL-' + cat + '-')` and then drops anything `mosParseCode` refuses. Ship
4-segment codes without fixing that line and `existing_prices` goes quietly incomplete —
which is the precise mechanism that put five copies of one item in one store on
2026-09-21. Phase 2 must change that filter in the same commit that widens the grammar.

**A silently-skipped scan reads as broken hardware.** If OB stickers ship before
`MOS_CODE_RE` is widened, the camera will simply keep scanning and the user will report
the scanner, not the code.

**Do not put the PO in the item name.** It is tempting — the name is the one field that
*is* archived — but the name is `l3` verbatim and Tier 3 of the attribution ladder
(`worker.js:3924`) matches on it exactly. Changing it drops OB sales through to the
heuristic tiers and corrupts category reporting to buy a PO column.

**Refunds stay approximate.** Clover's `/refunds` returns no line references even with
expansion — *"empirically confirmed against the live API"* (`worker.js:4266`) — so they
are apportioned by gross share. Per-PO sell-through inherits that, and cross-day refunds
fall to a generic `"Refund"` bucket (`worker.js:4321`). Say so on the report rather than
implying a precision we do not have.

**Consider bounding the price.** A five-digit price code with no underscore is almost
always a PO or a typo. A ceiling in `mosParseCode` would have made approach B loud
instead of silent. Cheap, and independent of everything above.

## Open questions

1. **Is sell-through actually required, or is the catalogue half enough?** Phase 1 alone
   answers "what is in this buy and where did it go." If that is the real need, Phases 2
   and 3 never have to happen and the grammar stays two segments.
2. Does a person need to read the PO off the sticker, or only scan it? `number_po` exists
   either way, but it is what forces the PO into the printed text at all.
3. Should a PO be pickable from `truck_pallets.po`, or typed fresh? The receiving data is
   there but is free-text and unvalidated.
4. What closes a buy — a date, a manual action, or selling out?
5. Do OB items at the same category and price across two POs become two permanent Clover
   items, and who prunes them when a buy is done?
6. Should `manifests.load_id` finally be wired to `ob_buys.po`, given the comment says
   that was always the intent?
7. Per-PO cost is out of scope today, but `ob_buys` could hold a lot cost for a manual
   margin figure without touching `l3UnitCost` at all. Worth doing while the table is new?

## Related work referenced

- `worker.js:12915-13000` — `stickerPriceCode`, `stickerCode`, `mosNormalizeCode`, `mosParseCode`.
- `worker.js:23356-23539` — `sticker-create-price-point`, the sibling-copy write path.
- `worker.js:3824-3993` — the line-item attribution ladder and its `l2Source` tiers.
- `worker.js:1870-2294` — the banking path, from Clover fetch to `payment_archive_items`.
- `migration-056/057/069` — `sticker_prints` and its columns.
- `migration-058`, `migration-065` — the existing `po` columns at receiving.
- `index.html:24162` — `psZpl` and the `number_po` show mode.
