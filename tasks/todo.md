# Price Scan — print quantity, and a manual (no-lookup) mode (2026-09-21)

**Brian:** *"adding a qty option for printing stickers... then add a manual option that skips
the look up. So user can manual enter the street price and our price. Before they do this
user must at the L2 and L3 category for this product."*

Answers captured up front, because three of them change who can write to production:

| question | answer |
|---|---|
| manual is for | **both** — barcode optional. Sometimes the street price is already known; sometimes cost + margin dictate the price outright |
| manual shows | full result card (hero, GP%, Retail/Cost/ASP strip), print-only |
| price not in Clover | **create it at all stores**, free entry |
| who may create / save | **managers get both** — the Clover price point AND the Products override |
| new item's tax/hidden/cost | **copy a sibling** `BL-<same category>-*` item |
| partial store failure | print if *your* store succeeded, report the rest |
| typo guard | warn off-rung / out-of-range, still allow |
| quantity | both tabs, one job via `^PQ`, count recorded in history |

## What the code already gives us

- `stickerCode(cat, price)` → `BL-<catCode>-<priceCode>`, and `mosParseCode` is its exact
  inverse (`worker.js:12946`). The typo guard's "what does this category already carry"
  is `codes.filter(startsWith 'BL-<cat>-')` fed through `mosParseCode` — no new parsing.
- `stickerCategoryCodes` already caches **every** `BL-` string per store, so "does this price
  exist" and "what prices exist" are both KV reads, not Clover calls.
- The Clover item name is not something we invent. Production says every price point in a
  category shares one name — the L3 key verbatim:
  `FG BL CONSUMABLES - FOOD - PANTRY`, 10,437 sales spanning $0.00–$76.00.
- `merch-scan`'s pricing tail (`worker.js:24694-24725`) already computes asp / cost / critAt /
  ladder / GP from an l3. Manual needs exactly that block with the lookup cut out.

## 1 · Print quantity

- [ ] `psZpl(code, price, extras, tpl, qty)` appends `^PQ<qty>` before `^XZ` — **only when
      qty > 1**. `test-price-scan.mjs:2759` compares psZpl byte-for-byte against a legacy
      generator; qty 1 must stay identical to today, to the dot.
- [ ] Qty input beside Print on the scan result (`psStickerRow`) and on each Reprint row.
      Default 1, capped at 50, validated client AND worker side.
- [ ] `migration-069.sql`: `ALTER TABLE sticker_prints ADD COLUMN qty INTEGER` (nullable —
      every existing row is a single print and must stay readable).
- [ ] `sticker-printed` accepts and stores `qty`; Reprint rows show `×3`.
- [ ] ⚠️ `^PQ` on continuous media (`^MNN`) is **unverified on the real ZD410**. psZpl's own
      comment records that a stale UNVERIFIED warning is worse than none — so this ships
      flagged, and Brian test-prints qty 3 before it is called done.

## 2 · Manual mode

- [ ] New `?action=merch-categories` (GET, `canSeeFinancials`) returning the same
      `{categories:[{key,label,children}]}` shape the scan already rides along with. Manual
      needs the tree with no scan to hang it on.
- [ ] Mode link in `#ps-bar` beside Furniture; body take-over via the same `fnChrome`-style
      one-authority switch. **Not** a tab — Scan/Reprint are tabs, whole-body modes are links.
- [ ] Form order enforces Brian's rule: **L2 → L3 first**, prices disabled until both are set.
      Then optional barcode, optional description, Street price, Our price.
- [ ] New `?action=merch-manual-price` {l3, retail, price} → the merch-scan response shape.
      Refactor the shared pricing tail out of merch-scan so the two cannot drift; the ladder
      stays on the worker for the reason already written there.
- [ ] `psRender` reused unchanged — same hero, same strip, same GP chip, `price_basis:
      "set by hand"`.
- [ ] Barcode present → save to Products via `merch-scan-save`.

## 3 · Creating a missing price point

- [ ] New **narrow** `?action=sticker-create-price-point` {l3, price} — gated
      `canSeeFinancials`. Derives name and code itself, copies taxable/hidden/cost from a
      sibling, creates at `ALL_STORES`.
      🔑 **Deliberately NOT relaxing `create-clover-item`.** That endpoint takes an arbitrary
      name, code and category; handing it to managers is a far wider grant than Brian asked
      for. This one can only ever add a price to a category that already exists.
- [ ] `merch-scan-save` gate moves `requireAdminAccess` → `canSeeFinancials`. This is the
      one real privilege widening and it is deliberate: a manager can now set what an item
      is worth for every store, permanently.
- [ ] Confirm dialog before any create — MEMORY.md rule 7. Names the price, the category,
      the stores, and the two warnings (off-rung, out-of-range) when they apply.
- [ ] Per-store results; print proceeds if the caller's store succeeded.

## 4 · Verification

- [ ] `scripts/test-price-scan.mjs`: `^PQ` absent at qty 1 (legacy byte equality holds),
      present and correct above it; the qty cap; manual-mode markup; the new actions' gates;
      typo-guard range maths against a fixture holding a real ugly code list.
- [ ] Full `bash scripts/test.sh`. Note: this suite is **unseeded-random flaky** (recorded in
      the previous todo entry, lines 375-508) — a single red run gets re-run and read, never
      re-run away.
- [ ] Contrast checked in both themes by computation, not screenshot, per CLAUDE.md.

## Deploy order — derived from which side stops being backward-compatible

1. `migration-069.sql` — the worker writes `qty` and the column must exist first.
2. `wrangler deploy` the worker — the frontend calls three new actions; an older worker
   answers UNCLASSIFIED_ACTION, which `psStickerFault` already names correctly.
3. Merge → Pages rebuilds `index.html` on its own.

Brian runs 1 and 2. Auto-merge does not work on this repo; the PR needs his click.
