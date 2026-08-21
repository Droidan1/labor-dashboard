# What eight real manifests actually look like

Analysed 2026-08-20 from ~/Documents/Opportunity buys. This is the evidence base for the
ingest layer; every claim below was run through the real `manifestGuessMap`, not guessed.

## The files

| File | Shape | Identifier | Our cost is… |
|---|---|---|---|
| WI / PA Food List (.xlsx + csv) | 2 blank rows, header row 3, **second header mid-file** | `UPC` (dashed) | `Unit Price` — *not* `Unit Wholesale` |
| UPDATED FOOD LIST (.xlsx) | clean header row 1, ragged row lengths | UPC unnamed / trailing | `CASE PRICE` |
| Clorox Arlington (.xlsx) | **8-row marketing preamble in col F**, subtotal rows interleaved | `Universal Id` | `Sale Price` — *not* `Wholesale` |
| BStock Furniture ×2 (.csv) | clean single header | `UPC` | **none — lot buy** |
| Manifest # 07002 (.csv) | 3-row preamble, **2 empty leading columns** | **none at all** | **none per line; `Price Cost $12,175` at the bottom** |
| MIDWEST Estimate 1195 (.pdf) | invoice layout, letterhead + bill-to | `Product or service` + `SKU` | `Rate` (per case) |
| Kind list (.xlsx) | clean | `UPC` | `Price per unit` |

## What the CURRENT mapper does with them — measured

    WI/PA Food      qty=Case Pack  units_per_case=Case QTY   ← EXACTLY SWAPPED
                    cost=UNMAPPED
    Clorox          identifier=UNMAPPED   cost=Wholesale     ← WRONG COLUMN
    UPDATED FOOD    identifier=UNMAPPED   cost=UNMAPPED
    BStock          cost=UNMAPPED  (correct — there is none)
    Manifest 7002   identifier=UNMAPPED   cost=UNMAPPED  (correct — lot buy)

**Cost is wrong or missing on 5 of 5.** That is the headline.

## Defects, worst first

1. **`qty` and `units_per_case` swap on the food lists.** `qty`'s `/^cases?\b/i` matches
   "Case Pack" and claims it before `units_per_case` is even considered; `units_per_case`
   then takes "Case QTY", which is the availability. 56 cases of 18 becomes 18 cases of 56.
   Field order in MANIFEST_HINTS decides this, and it is currently wrong.

2. **`Wholesale` is claimed as cost.** On Clorox, `Wholesale` is the reference value and
   `Sale Price` is what we pay — $1,668.38 vs $900.93 on one line. Mapping the wrong one
   makes a good buy look 85% more expensive and it would be rejected.

3. **Excel serial dates.** `BIUB` / `EXP DATE` / `Expiration Date` arrive as integers:
   `46508` is **2027-05-01**. xlsxRows returns the raw number because knowing it is a date
   needs styles.xml. For a buyer whose whole game is dating, the most important column in
   the file is currently a meaningless integer.

4. **No expiry field exists at all.** `manifest_lines` has no dating column, yet every food
   manifest carries one and the PDF puts "BB 05/23/2026" inside the description. A buy 30
   days out and one 12 months out are different buys at the same price.

5. **A second header mid-file.** WI Food List row 28 starts a "Price Reduced - Closer Date"
   section and row 29 repeats the header. Those rows currently become line items.

6. **Subtotal rows.** Clorox interleaves per-container subtotals with blank description and
   only numbers. They parse as line items.

7. **`Universal Id` matches no identifier pattern.** Nor does the PDF's "Product or service".

8. **Lot buys cannot be represented.** Manifest 07002 and both BStock files have no per-line
   cost — 07002 has ONE number, `Price Cost $12,175` against `$32,902` ext retail (37%).
   BStock has only retail. Today these are unusable.

9. **Condition grades are uncaptured.** Clorox `Sort` = Pristine Case / Pristine Each /
   Grade B; BStock has `Condition`. Grade B is priced at 25% of wholesale vs 54% for
   pristine — a 2× swing the scorer cannot see.

10. **PDF description cells are multi-line**: product name, pack spec and "BB 05/2026" are
    separate lines inside one cell, and the BB date must be lifted out of it.

## What already works on these files
- `manifestFindHeader` locates the header under all the preambles here, including Clorox's
  8 rows and the 2 blank rows on the food lists.
- `xlsxRows` reads all three workbooks: shared strings, sparse columns, first-sheet-by-order.
