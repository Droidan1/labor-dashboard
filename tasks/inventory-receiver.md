# Inventory Receiver — BOL → truck → pallets → down

**Goal:** a truck backs up to the dock, someone photographs its Bill of Lading, the app reads
the BOL number and who it shipped from, and every pallet that comes off is scanned against that
truck. When the trailer is empty, "Truck Down" closes it. Trucks are filed by month.

**Preview Brian reviewed before any code:** https://claude.ai/artifact/WzgsCVPWcmFeY3KRobu1s6

## Decisions (Brian, 2026-09-15)

- **A manager approves a duplicate on the spot** — not "a manager must be logged in", and not
  "a manager fixes it afterwards". An associate keeps the phone; a manager enters a six-digit
  PIN to approve that one pallet. Chosen knowing it is the most machinery of the three options.
- **Its own table, `truck_pallets`** — receiving a pallet off a truck is a different event from
  dumping it into a bin. `bin_dumps` is not touched and Bin Dump keeps working exactly as it does.
- **Filed by the month the truck was OPENED**, derived Eastern. A truck opened Sep 30 that comes
  down Oct 1 stays in September, and never moves.
- **One open truck per store at a time.** No truck picker on a pallet scan; a pallet cannot be
  filed against the wrong BOL because there is only one it could go to.

## 🛑 The gap this combination leaves, stated once

The duplicate rule the brief asked for is "the same rules as bin dump". Bin Dump's rule is
**same barcode, any store, 90 days** — over `bin_dumps`. With a separate table, the check
becomes **same barcode, any store, 90 days, over `truck_pallets`**: same window, same
cross-store reach, same redaction, but it **cannot see a pallet that was bin-dumped rather
than received**. A pallet logged through Bin Dump last week comes off a truck today and reads
as new.

It is one extra `SELECT` to close — `binDumpBarcodeMatches()` already exists and takes the
table as the only thing that would vary. **Not built unless Brian says so**, because a
false block ("this pallet was already logged" for a pallet that legitimately was, in a
different sense) is its own kind of wrong and he owns that call.

## The paperwork

**The BOL** (photo 2026-09-11, BOL 7679). Printed form, handwriting in three fields:

| field | value on the sample | where |
|---|---|---|
| `bol_no` | `7679` | top right — **the number Brian named** |
| `ship_from` | `RM1` | top left — **the other field Brian named** |
| `ship_from_addr` | `1450 Atlantic Ave, Rocky Mount NC 27801` | under the name |
| `ship_to` | `FW2` | Ship To block |
| `bol_date` | `9/11/2026` | top left of the header |
| `carrier` | `Arrive Logistics` | Carrier Name |
| `trailer_no` | `19353` | **handwritten** |
| `seal_no` | `4949941` | **handwritten**, and the hardest read on the form |
| `pallet_count` | `40` | **handwritten**, "40 pallets" in Additional Shipper Info |
| `pro_no` | *blank* | stays `null` — never guessed |

`bol_no` and `ship_from` are the two the verify popup puts at the top, at 19px, because those
are the two that identify the truck. The rest are there to be corrected, not studied.

⚠️ **`psShrink()` is 1280 px / JPEG 0.82**, tuned for a printed pallet tag. A BOL is a dense
form with handwriting; the seal number is four-plus digits in ballpoint. **Raise the long edge
for this one call** (1600–2000 px) and measure the read against a real photo before deciding
it is fine. A wrong digit in a seal number is exactly the "plausible and wrong" failure
`BIN_TAG_PROMPT` was rewritten to prevent.

**The pallet tag** is unchanged — the same eight fields, the same two formats, the same
order-based pairing rule. `BIN_TAG_PROMPT` and `binDumpFields()` are reused as-is, not forked.

## Shape

### Storage — `migration-065.sql`, `-066.sql`

```sql
CREATE TABLE trucks (
  id, store, bol_no, ship_from, ship_from_addr, ship_to, bol_date,
  carrier, trailer_no, seal_no, pro_no, pallet_count,   -- pallet_count = what the BOL claims
  r2_key, content_type,                                  -- the BOL photo
  opened_by, opened_at,                                  -- opened_at is what the month derives from
  closed_by, closed_at, close_note,
  edited_by, edited_at
);
CREATE TABLE truck_pallets (
  id, truck_id, store, <the 8 BIN_DUMP_FIELDS>,
  r2_key, content_type, logged_by, logged_at, edited_by, edited_at,
  dup_approved_by, dup_approved_at, dup_reason        -- null on a clean pallet
);
```

- 🔑 **The month is derived from `opened_at`, never stored** — same reasoning as
  `binDumpWeekOf()`, and Eastern-anchored for the same reason: a truck opened 9pm ET is
  01:00 UTC the next day, and on the 30th that is the wrong month, not just the wrong day.
- 🔑 **`pallet_count` is what the BOL CLAIMS**, not what was received. The count received is
  `COUNT(*)` over `truck_pallets`. Storing a received count would let the two disagree.
- 🔑 **One open truck per store** is `CREATE UNIQUE INDEX … ON trucks(store) WHERE closed_at IS NULL`
  — a partial index, so the database enforces it and not just the handler.
- 🔑 **The manager approval PIN needs its own column**, e.g. `users.approval_pin_hash`.
  🛑 **NOT `users.pin_hash`.** `pin_hash IS NOT NULL` is literally the definition of
  "associate" in `getAuthUser` (`worker.js:12907`); putting a PIN there turns every manager
  into an associate — 12-hour non-sliding sessions, passkey registration refused, and they
  become findable by the `associate-login` name lookup. Reuse `pinHash()` / `validPin()` /
  the lockout counter; do not reuse the column.

### Worker — eight actions, all registered in `ACTION_BUSINESS` as `"bl"`

| action | does |
|---|---|
| `truck-bol-scan` | BOL photo in, ten fields out. **Stores nothing.** |
| `truck-open` | writes the confirmed truck + the BOL photo to R2. Refuses if one is open. |
| `truck-current` | the open truck for a store, with its pallets |
| `truck-pallet-scan` | reuses `BIN_TAG_PROMPT` verbatim — no second prompt to drift |
| `truck-pallet-recent` | the duplicate pre-flight, on its own so a slow answer never costs a submit |
| `truck-pallet-log` | writes the pallet. 409 `DUPLICATE_BARCODE` unless approved. |
| `truck-down` | stamps `closed_by`/`closed_at`. Refuses a truck already down. |
| `truck-list` | trucks by month, `months` (number or `all`), `limit`, reports `truncated` |
| `truck-approve-dup` | manager name + PIN → a short-lived approval token for ONE barcode |
| `truck-photo` | serves a BOL or tag image, re-checking store access |

Carried over from Bin Dump without change, because each was learned the hard way:

- **Refuse before the R2 put.** A 409 after an upload leaves an object with no row forever.
- **`allow_duplicate !== true`** — strict identity. `'false'`, `0`, `''`, `null` all still refuse.
- **A blank barcode is not a duplicate of every other blank**, via an early return, not SQL.
- **Redact, don't exclude** — a match at a store the caller does not hold returns a date and
  nothing else. No store, no name, no pallet.
- **`limit + 1`** is the only honest way to report truncation.
- **The store comes from the ROW** on every write-back, never from the client.
- `storeActionGuard()` — renamed out of `binDumpStoreGuard` precisely so a third feature would
  call it instead of copying it. This is that third feature.

### Frontend — `#page-inventory-receiver`, prefix `ir-`

Its own `ir-*` classes. `.bd-*` are global (declared inside `#page-bin-dump`, not scoped to it),
so reusing them would mean a Bin Dump restyle silently restyling this page — the same reason
MOS has its own `mos-*`.

- Two tabs in the sticky header: **Receive** and **Trucks** (count badge).
- `#page-inventory-receiver [hidden]{display:none !important}` — load-bearing, same as Bin Dump.
- `uiConfirm` / `uiAlert`, never native `confirm()`.
- `_uiDialog` needs a `promptMode` for the PIN: today its input is hard-coded `type='text'`
  with no `inputmode`. The repo's own rule for six-digit codes is
  `type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6"` — **not** `type="number"`,
  which drops leading zeros.
- Nav: sidebar item, `NAV_BUSINESS` entry (`test-nav-registry.mjs` fails without it),
  `applyRoleUI` toggle, `navigateToPage` guard, init hook, **and the mobile More-sheet row** —
  skipping the last one makes the page unreachable on phones, which is where it will be used.

## Checklist

- [ ] `migration-065.sql` — `trucks`, `truck_pallets`, indexes, partial unique index
- [ ] `migration-066.sql` — `users.approval_pin_hash`, `approval_pin_failures`
- [ ] `BOL_PROMPT` — worked example from the real BOL, explicit `null`, self-check
      (a date must be a date, a carrier must be a company), ignore list
- [ ] `truckMonthOf()` — ET-derived, pinned by a test that passes under UTC, ET and Auckland
- [ ] The eight worker actions + `ACTION_BUSINESS` + `ACTION_PAGE` registration
- [ ] `truck-approve-dup` — lockout checked **before** the hash, identical failure body for
      every cause, failure counter on mismatch
- [ ] The page, both tabs, both modals, the month accordions
- [ ] Raise the downscale cap for the BOL and **measure the read on a real photo**
- [ ] `scripts/test-inventory-receiver.mjs` — assert on the prompt text itself, both tag
      fixtures, every duplicate refusal, and the refuse-before-put ordering
- [ ] `sw.js` CACHE_NAME bump + `scripts/fixtures/shell-cache.json` in the same commit

## Deploy order

**Migrations first, then the worker, then the frontend** — derived from which side stops being
backward-compatible: new tables are invisible to the old worker, but the new worker requires
them. Migrations are a manual `wrangler d1 execute`; a bare `wrangler deploy` targets
**production**, staging needs `-e staging`.

Merging to `main` deploys the frontend via Pages. It does **not** deploy the worker or run a
migration. Auto-merge does not work on this repo; the PR needs Brian's click.
