# Merchandising › Products

**What** — a searchable list of every product we know, with edit for admins. Two tabs:
**Scanned** and **From manifests**.

**Why here** — `item_cache` is a 383-row dataset that BOTH the Price Scan screen and the
Manifest Scorer read and write. A wrong category or a bad street price on one row is wrong
on both surfaces, so it earns a page of its own rather than a settings card.

## 🔑 The tabs need no migration

`item_cache` has NO provenance column — a scan and a manifest lookup write the same rows.
But manifest membership is derivable exactly, and retroactively:

```sql
EXISTS (SELECT 1 FROM manifest_lines ml WHERE ml.identifier = item_cache.identifier)
```

- **From manifests** = that predicate is true (21 of 383 today)
- **Scanned** = it is false — sound, because the only writers to `item_cache` are the scan
  endpoint and the manifest pipeline

⚠️ **The one imprecision, stated on the page**: a product that arrived BOTH ways files under
manifests. Making that exact needs a provenance column, which would only be right from the
day it lands — the existing 383 rows carry no record of how they arrived. Not worth a
migration for a distinction nobody has yet asked to see.

## Guards

- View and edit: **admin** (Brian's words: "a way for admins"). Managers already see cost
  and price on the scan screen, so widening later is one list, not a redesign.
- Edits write the SAME override columns the scan screen already writes
  (`retail_price_override`, `suggested_price_override`, `l3_source='manual'`), so a human's
  correction keeps beating the model's everywhere it is read.

## Checklist

- [ ] `GET  ?action=merch-products` — tab, search, paging
- [ ] `POST ?action=merch-product-save` — brand/title/size/l3 + the two overrides
- [ ] `#page-merch-products`, nav entry, `NAV_BUSINESS`, `applyRoleUI`, `navigateToPage`
- [ ] Tests: nav registry, guards, the tab partition, an edit that survives a re-scan
