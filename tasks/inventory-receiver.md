# Inventory Receiver — BOL → truck → pallets → down

**Goal:** a truck backs up to the dock, someone photographs its Bill of Lading, the app reads
the BOL number and who it shipped from, and every pallet that comes off is scanned against that
truck. When the trailer is empty, "Truck Down" closes it. Trucks are filed by month.

**Preview Brian reviewed before any code:** https://claude.ai/artifact/WzgsCVPWcmFeY3KRobu1s6

## Decisions (Brian, 2026-09-15)

- 🔑 **Receiving is a different OPERATION from bin dumping.** Brian's correction, and it is the
  load-bearing one: *"they have nothing to do with the bin dump page, they are operations and
  procedures."* The original brief said "the same rules for duplicates as bin dump"; that was a
  misspeak and is retracted. The two features share a tag reader and nothing else.
- **A manager approves a duplicate on the spot** — not "a manager must be logged in", and not
  "a manager fixes it afterwards". An associate keeps the phone; a manager enters a six-digit
  PIN to approve that one pallet. Chosen knowing it is the most machinery of the three options.
- **Its own table, `truck_pallets`** — because receiving a pallet off a trailer and dumping one
  into a bin are different events, not because it is cheaper. `bin_dumps` is untouched and Bin
  Dump keeps working exactly as it does.
- **Duplicate pallet = same barcode, any truck, any store, 90 days — within `truck_pallets`.**
  The same window and reach as Bin Dump's rule, deliberately, but over the receiving table only.
- **Duplicate BOL = blocked**, with the same manager override. Two half-received trucks carrying
  one BOL number is worse than an interruption.
- **Its own page grant.** `inventory-receiver` joins `GRANTABLE_PAGES`, independent of Bin Dump's:
  the people who unload trucks are not necessarily the people who dump bins, and Brian wants to
  hand out one without the other.
- **Filed by the month the truck was OPENED**, derived Eastern. A truck opened Sep 30 that comes
  down Oct 1 stays in September, and never moves.
- **One open truck per store at a time.** No truck picker on a pallet scan; a pallet cannot be
  filed against the wrong BOL because there is only one it could go to.

## 🔑 Why the check does NOT also read `bin_dumps`

A barcode appearing in both tables is **correct, not a double count** — the pallet was received
off a trailer and later dumped into a bin, which is the normal life of a pallet. Joining the two
would manufacture a false block on a legitimate pallet every time the process worked. The
separation is the feature.

## ⚠️ What the 90-day window will eventually do, recorded now

`PRM-<truck>-<index>` barcodes are only as unique as truck numbers, **and truck numbers cycle** —
this is the documented reason Bin Dump's window is 90 days and not forever. Over a long enough
horizon a cycled barcode will collide with a genuinely different pallet and the block will fire
on a pallet that is not a duplicate.

That is survivable here only because the manager override exists: the release valve is a manager
PIN and a reason, not a dead end someone works around by typing a fake barcode. **If the override
starts getting used routinely with reasons like "different pallet, same code", the window is too
wide** — and that is a number to shorten, not a guard to remove.

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
| `truck-open` | writes the confirmed truck + the BOL photo to R2. Refuses if one is open, and refuses a `bol_no` already received at this store unless approved. |
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
  The same applies to a blank `bol_no` — a torn header must not make every torn header a repeat.
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
- 🔑 **`GRANTABLE_PAGES` is a closed list** (today `bin-dump` and `mos`). Adding
  `inventory-receiver` is one entry there **plus** its actions in the worker's `ACTION_PAGE` —
  `scripts/test-associate.mjs` pins the two against each other, because a page in one and not
  the other is a 403 with nothing on screen to explain it.

## Checklist — built 2026-09-15

- [x] `migration-065.sql` — `trucks`, `truck_pallets`, indexes, and the partial unique
      index that enforces one open truck per store in the DATABASE, not the handler
- [x] `migration-066.sql` — `users.approval_pin_hash`, `approval_pin_failures`
- [x] `BOL_PROMPT` — worked example from the real BOL, explicit `null`, self-check, ignore list
- [x] `truckMonthOf()` — ET-derived; the suite's clock is pinned to 9pm ET on the 30th
      (01:00 UTC on the 1st) so a UTC month is visibly the wrong MONTH, not the wrong day
- [x] Eleven worker actions + `ACTION_BUSINESS` + `ACTION_PAGE` registration
- [x] `inventory-receiver` grantable on both sides (`GRANTABLE_PAGES` derives from `ACTION_PAGE`)
- [x] Duplicate barcode: any truck, any store, 90 days, `truck_pallets` only — pinned
      behaviourally in BOTH directions and at the source
- [x] Duplicate `bol_no` at the same store → blocked on `truck-open`, same override
- [x] The page, both tabs, the modals, the month accordions
- [x] `psShrink` parameterised; the BOL goes at 1800px / q0.88
- [x] `scripts/test-inventory-receiver.mjs` — **144 assertions**
- [x] `scripts/browser-inventory-receiver.mjs` — **50 assertions** in a real browser
- [x] `sw.js` CACHE_NAME → **v199**, fixture in the same commit
- [x] Full suite **4544 assertions across 74 suites**, green

### Three things built differently from the plan above

**The approval is inline, not a token.** The plan had `truck-approve-dup` mint a
short-lived token for one barcode. Verifying the manager's name and PIN in the SAME
request that writes the row is simpler and strictly stronger: there is no token
lifecycle, no expiry window, and nothing to replay against a different pallet.

**A failed approval is still a 409, with the approval's verdict nested inside.** The outer
status answers "did the pallet go on?" — no, it is still a duplicate. The inner
`approval.code` answers "why not?". The client needs both to tell "we have not asked a
manager yet" from "a manager typed the wrong code", and collapsing them loses that.

**The shared tag helpers were renamed before the second caller arrived** — `BIN_DUMP_FIELDS`
→ `PALLET_TAG_FIELDS`, `binDumpFields` → `palletTagFields`, `binDumpText` → `tagText`,
`binDumpTruckHint` → `palletTagTruckHint`. This repo already wrote that lesson down on
`storeActionGuard`. The alternative was a second copy of "what a pallet tag field is",
and two copies drift.

### What is NOT done, and is not code

- [ ] **Nobody has an approval PIN yet.** `approval_pin_hash` is NULL for every account,
      so the duplicate override currently has no one to approve it. Setting the first
      codes is an admin action on real accounts and is Brian's to make, not a migration's.
- [ ] **The BOL read has never met a real camera.** Every assertion in the suite runs
      against a fixture derived from one photograph. A green suite proves the code is
      self-consistent about a layout nobody has checked against a lens — exactly what
      Bin Dump's own notes say a green suite could not prove. The failure to watch for is
      not a blank but a **plausible wrong digit in the seal number**, and the fix for one
      is `BOL_PROMPT` plus a worker redeploy, not a rebuild.

## Deploy order

**Migrations first, then the worker, then the frontend** — derived from which side stops being
backward-compatible: new tables are invisible to the old worker, but the new worker requires
them. Migrations are a manual `wrangler d1 execute`; a bare `wrangler deploy` targets
**production**, staging needs `-e staging`.

Merging to `main` deploys the frontend via Pages. It does **not** deploy the worker or run a
migration. Auto-merge does not work on this repo; the PR needs Brian's click.

## Deployed — 2026-09-15

Order was **migrations → worker → frontend**, except that the frontend went FIRST by
accident of process: merging #239 makes Pages rebuild `main`, so the page was live on
www.retjghub.com before either migration ran. Harmless here — the page cannot write, and
every `truck-*` call was refused by the fail-closed action gate as `UNCLASSIFIED_ACTION`,
which the client maps to "That action is not available on this deployment." Worth knowing
for the next feature: **merging IS deploying, for the frontend, and it does not wait.**

### Databases — schema READ, not inferred from a command not erroring

Both were clean before: neither table existed, neither column existed.

```
                trucks  truck_pallets  approval cols | users  associates  bin_dumps
  STAGING       24 cols     20 cols          2       |   4        0           0
  PRODUCTION    24 cols     20 cols          2       |  17        3          26
```

🔑 **`associates` is the number that mattered.** It counts `pin_hash IS NOT NULL`, which
is what `getAuthUser` uses to decide someone is an associate. It read 3 on production
before migration-066 and 3 after — proof that adding `approval_pin_hash` reclassified
nobody. `users` (17) and `bin_dumps` (26) also unchanged; the migrations are additive and
the counts say so rather than the diff merely implying it.

✅ **The partial unique index genuinely enforces**, confirmed on STAGING by inserting a
second open truck at one store and being refused by the database:
`UNIQUE constraint failed: trucks.store`. Both probe rows deleted, table back to 0.
🛑 Not repeated on production — the guard was already proven, and a probe that performs
the damage if the guard is absent is exactly what this repo's rules forbid.

### Worker

| env | version | crons |
|---|---|---|
| staging (`-e staging`) | `0878c1ed-83fe-4860-a5f0-85552c320219` | 2 |
| production (bare `deploy`) | `ec9a820a-7c5a-4d09-8e02-2ab49a82cc00` | **6** |

Deploy output checked for the three things a past deploy silently dropped — `MEDIA`
binding, `BL16_MERCHANT_ID`, and all six production crons (`55 3 * * *`, `* * * * *`,
`0 12 * * *`, `0 11 * * 1`, `0 * * * *`, `30 10 * * *`). All present on both.

Rollout confirmed by reading the DEPLOYED BUNDLE back from the Cloudflare API three
times, identical each pass: `truck-pallet-log` ×3, `BOL_PROMPT` ×2, `approval_pin_hash`
×4, `truckBarcodeMatches` ×5, 963,268 bytes. `api.retjghub.com` answers
`401 NO_SESSION` on `?action=truck-current` — the worker boots and refuses cleanly.

⚠️ **What was NOT verified, and could not be.** No pre-auth action differs between the
old worker and the new one, so there is no unauthenticated HTTP probe that distinguishes
them — the bundle read above is proof the deployed VERSION carries the code, not a
sample of what a logged-in phone gets from a given edge. The end-to-end path has
therefore never been exercised by a real session.

### Still outstanding, and neither is code

- [ ] **Nobody has an approval PIN.** `approval_pin_hash` is NULL on all 17 production
      accounts, so a duplicate barcode or repeated BOL currently has no one who can
      approve it — the block is a dead end until a manager is given a code.
- [ ] **The BOL read has still never met a real camera.** Watch the seal number.

## Deployed — 2026-09-16, the approval code and the desktop camera fix

Two follow-ups shipped after the first deploy, both from Brian using it.

**The camera fix (#241).** `Receive Truck` did nothing on a desktop.
`capture="environment"` does not mean *prefer* the camera — it means rear camera and
nothing else, so a browser with none to satisfy it presents no picker at all and the
button reads as dead. `syncCameraCapture()` now sets the attribute from
`(pointer: coarse)` at the moment the picker opens. Bin Dump had the identical latent
bug and got the same call; on a phone it is a no-op, so the path that works could not
regress. Frontend only — merging was the whole deploy.

**The approval code (#242).** The override shipped with nobody able to use it.
`set-approval-pin`, gated on `canAccessInventory` — already exactly superuser-or-admin,
so no new role machinery. Worker versions: staging `169a04a7`, production `1fce16c4`.

Deploy output carried the `MEDIA` binding, `BL16_MERCHANT_ID` and all six production
crons. Rollout confirmed by reading the deployed bundle back three times, identical each
pass — 966,159 bytes, `set-approval-pin` ×2, `approval_pin_hash` ×8, `NOT_AN_APPROVER`
×1 — and `api.retjghub.com` answers `401 NO_SESSION` on the new action, so it boots and
refuses before the handler. No migration: `066` was already applied, and the columns
were re-read on both databases before deploying rather than assumed.

⚠️ **Merging deployed the frontend BEFORE the worker, twice now.** Pages publishes `main`
on merge and does not wait, so the Users page offered a Set code button against a worker
with no such action for the minutes in between. Harmless both times — the fail-closed
action gate refuses cleanly — but the safe order is a thing to arrange, not to be lucky
about. For a change that adds a worker action, deploying the worker BEFORE merging is
the correct order, and is possible: a new action is additive and the old frontend never
calls it.

### Still outstanding

- [ ] **Nobody has an approval code yet.** The door exists now; somebody still has to
      walk through it. Until at least one manager per store has one, a duplicate barcode
      or a repeated BOL is a dead end at the dock.
- [ ] **The BOL read has still never met a real camera.** Watch the seal number.


---

## The truck review email — built 2026-09-16

Brian asked for it, saw a preview, and answered four questions:

| | |
|---|---|
| **Who** | Superusers, admins, and the managers of **that store**. `blaccounting@retjg.com` later. |
| **When** | Automatic, on Truck Down. Not a button. |
| **What** | **Exceptions in the body.** Every pallet in an attached PDF, and the BOL photo attached. |
| **Clean trucks** | Yes — one green line instead of the amber block. |

He confirmed the second and third after seeing it render: *"Keep the BOL photo attached,
exception list looks right, build it."*

### No migration

Nothing new is stored. The email is derived from `trucks` + `truck_pallets` + the R2
object that is already there, and the audit row goes into the existing `notification_log`
under `event_type = 'truck-review'`.

### What counts as an exception

Five kinds, all of them signed off before any code was written:

1. **Short or over** against the BOL's `pallet_count`.
2. **A duplicate barcode a manager approved** — named, with who approved it and the reason
   they typed. This is the one nobody would otherwise find out about.
3. **A duplicate Bill of Lading a manager approved** — the same event one level up.
4. **A tag that did not fully read** — missing barcode, item #, PO or units. Summarised
   past three, because an email listing thirty of them hides the duplicate above them.
5. **No pallet count on the BOL at all** — which is common on these handwritten forms, and
   is NOT the same fact as a balanced truck.

🔑 `sup_ref` and `truck_no` are deliberately **not** checked. Each appears on only one of
the two tag formats, so their absence is the format, not a failed read.

### 🔑 Why the PDF is hand-written

`wrangler.toml` has no Browser Rendering binding and `worker.js` is one hand-edited file
with zero imports and no bundler, so `pdf-lib` and headless Chrome are both off the table.
PDF is a byte format: a table of text in a base-14 font needs no font embedding and no
compression, and the BOL photo goes in as its own JPEG bytes through `DCTDecode` — no
decode, no re-encode, which the suite proves by pulling the bytes back out and comparing
them. A 37-pallet sheet with the photo is **~85 KB** over three pages.

### Three things that were wrong and none of which errored

- **UTF-8 leaking into a WinAnsi string.** `TextEncoder` emits UTF-8, so `·` went in as
  `0xC2 0xB7` and every middot printed as `Â·` — while `/Length`, itself counted in bytes,
  still agreed with itself, so the file opened clean. Content streams are Latin-1 now.
  The test asserts the WinAnsi byte is **present** as well as that no UTF-8 pair is, so it
  cannot pass vacuously if the separators are ever "simplified" back to hyphens.
- **A 30pt column overlap.** `UNITS` ended at x=538 and `BUILT BY` started at x=508,
  mangling both; the `DUP OK` badge had no column at all and drew through the builder's
  name. The columns are boxes now and `truckSheetColumns()` throws on an overlap.
- **An off-by-one xref.** `firstImageObj + images.length` declared a phantom final object
  at offset 0 pointing back at the file header. Lenient readers ignore it; strict ones
  call the file corrupt.

None of these is visible in a diff and none throws. All three are pinned.

### 🛑 Recipients fail closed

Two gates, both the ones the daily cron already uses, for the same reason: an
E-Commerce-only admin must not be emailed Bargain Lane's receiving (`canAccessBusiness`),
and a BL14 manager must not be emailed a BL1 truck (`canAccessStore`). `pin_hash IS NOT
NULL` excludes associates, whose addresses are synthetic — read as a boolean so the hash
never enters the process. A role the filter does not recognise is simply not on the list.

### 🛑 Fire-and-forget, deliberately

`ctx.waitUntil`, after the `UPDATE`. A truck that is down is down; a Resend outage must not
turn "the trailer is empty" into a 500 at the dock. Every outcome still lands in
`notification_log` through `logEmailAttempt`, and the frontend says *"review email on its
way"* rather than *"sent"* — the response genuinely cannot know what Resend said.

### Still outstanding

- [ ] **Nobody has an approval code yet**, so the duplicate exception has never fired for
      real. Unchanged from 2026-09-15.
- [ ] **The BOL read has still never met a real camera.** Watch the seal number.
- [ ] `blaccounting@retjg.com` is one line in `truckReviewRecipients`, when Brian wants it.

### A fourth, caught on the last read-through

The body said *"plus the Bill of Lading itself"* whenever the photo merely was not
oversized — so a truck whose BOL was never photographed promised a page the attachment
does not have, and somebody would have gone looking for it. `pdfCanEmbed()` is now the one
predicate the sheet builder and that sentence both use, and the email names which of the
four states it is in: in the sheet, attached separately, too large, or never taken.

### Deployed — 2026-09-16, the review email

`npx wrangler deploy` (bare = production; staging needs `-e staging`). Version
`21d84c86-2f08-45c0-bea5-ab6a741f44cb`, 973.92 KiB uploaded / 216.95 KiB gzipped, bindings
confirmed as production (`labor-dashboard-db`, `bl-marketing-media`). **No migration** —
this change adds no columns.

Confirmed the way rule 5 asks for, not by trusting the exit code:

- **The stored bundle was read before and after.** Before: `notifyTruckDown`,
  `truckReviewRecipients`, `buildTruckReviewEmailHtml`, `pdfCanEmbed`, `truckSheetColumns`,
  `pdfLatin1`, `b64FromBytes`, `DCTDecode`, `truck-review` — **zero occurrences of every
  one**, at 966,160 bytes. After: all present, at 997,481 bytes.
- **Six consecutive clean passes at the edge**, 12s apart, on `api.retjghub.com`.
  🛑 The probe is `?action=truck-down` with **no session**, which dies at authentication
  and returns `401 NO_SESSION`. It was chosen precisely because it cannot perform the
  operation if the guard is missing — taking a real truck down would close a real truck
  and mail real people. It still proves the thing that matters: every new top-level const
  (the two Helvetica width tables, `TRUCK_SHEET_COLS`, `PDF_COLORSPACE`) evaluates at
  module scope, so a bad one would 500 *every* request on that edge, not just this action.
- `RESEND_API_KEY` is present in the production secret list, so sends are real rather than
  silently recorded as `skipped`.

⚠️ **There is one truck open on the dock: BL1, BOL 7679, 40 claimed, ZERO pallets scanned**,
opened 13:48 UTC 2026-09-16 by `bhoward@bargainlane.com`, with a BOL photo. It looks like
the camera test from earlier today. Taking it down now sends a real review email to **9
people** (1 superuser, 4 admins with a `bl` grant, 4 BL1 managers) saying *40 pallets short
of the 40 on the Bill of Lading* — correct behaviour, real inboxes. One admin is excluded
by the business gate, which is the gate doing its job.

`notification_log` has **0** rows at `event_type = 'truck-review'`, so nothing has fired yet.

---

## The BL1 test truck, deleted 2026-09-16 — and its backup

Brian opened one truck during the camera test and asked for it removed rather than taken
down, because Truck Down on it would have mailed nine people to say it came up 40 short.

🛑 **BACKED UP BEFORE THE DELETE, and this IS the backup.** One row, no pallets, and the
photo left in place — so the statement below restores it exactly, still pointing at a live
R2 object. There is no `truck-delete` action in the worker (by design, the same reason
`truck-pallet-delete` is absent from `ACTION_PAGE`), so this was raw SQL against D1.

**State read immediately before the delete** — matching what Brian confirmed against:

| | |
|---|---|
| `trucks` | 1 row total, and this was it |
| `truck_pallets` | **0 rows**, so the `ON DELETE CASCADE` had nothing to take |
| `notification_log` at `truck-review` | **0** — no email had ever fired |
| R2 | `bol/BL1/2026-09/93cebecc-d155-4cd0-9eea-5c0d7d1a0ed2.jpg`, 424,785 bytes |

```sql
-- Restores the deleted truck exactly. The r2_key below was NOT deleted, so this
-- statement brings back a row whose photo is still there.
INSERT INTO trucks (id, store, bol_no, ship_from, ship_from_addr, ship_to, bol_date,
  carrier, trailer_no, seal_no, pro_no, pallet_count, r2_key, content_type,
  opened_by, opened_at, closed_by, closed_at, close_note,
  dup_approved_by, dup_approved_at, dup_reason, edited_by, edited_at)
VALUES (1, 'BL1', '7679', 'RM1', '1450 Atlantic Ave, Rocky Mount NC 27801', 'FW2',
  '2026-09-11', 'Arrive Logistics', '19353', NULL, NULL, 40,
  'bol/BL1/2026-09/93cebecc-d155-4cd0-9eea-5c0d7d1a0ed2.jpg', 'image/jpeg',
  'bhoward@bargainlane.com', '2026-09-16T13:48:50.012Z', NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL);
```

⚠️ **The photo is deliberately still in R2.** Deleting it is a second irreversible act
nobody asked for, and it is the only real-camera BOL read this project has — see below.

### 🔑 What the first real camera read actually did

This row is the answer to the question that has been open since 2026-09-15. Eight of the
ten fields read correctly off a real photograph: `bol_no` 7679, `ship_from` RM1 and its
full address, `ship_to` FW2, `bol_date` parsed to `2026-09-11`, `carrier` Arrive Logistics,
`trailer_no` 19353, `pallet_count` 40 — **including the handwritten "40 pallets"**.

**`seal_no` came back NULL.** That is the field flagged as the hardest read, and it is the
one that missed — the prompt's instruction to return null for the whole field rather than a
half-read seal number did exactly what it was written to do. It did not invent `494994` or
`4949941`; it declined. `pro_no` is genuinely blank on the form, so that NULL is correct.

So the read is good and the refusal is honest. The seal number is the one field a person
still has to type.

## A truck can be opened after it comes down — `truck-detail` (2026-09-18)

**Brian:** *"on the inventory receiver there is no way to view the truck after it's done, can
you change that"*

### The gap was structural, not a missing click handler

The Trucks tab rendered one summary ROW per truck and stopped. Nothing opened it, and nothing
could have: **`truck-current` is the only action that has ever returned a pallet list, and its
WHERE clause is `closed_at IS NULL`** — so the one truck it can never answer with is a truck
that has come down, which is every truck on that tab. `truck-list` carries counts and no
pallets; the CSV export is truck-level (`bol_no … close_note`). The moment `truck-down`
stamped `closed_at`, what came off that trailer left the app — including for the person
reading the review email it had just triggered.

### `truck-detail`

`GET ?action=truck-detail&id=<id>` → one truck in **any** state plus its pallets.

- **Not `truck-current` with an optional id.** Widening it would cost it the property the
  partial unique index buys: it returns at most one row, *without* an id, because only one
  truck per store is open. Two questions, two actions.
- **The store is read from the ROW, then guarded** — `storeActionGuard(truck.store, …,
  { allowClosed: true })`. An id is the only thing the caller supplies, so unlike every other
  read on this page there is no store parameter on the wire that could look wrong; §28 of the
  suite exists because that is exactly the shape a missing guard hides in.
- Lookup → guard → answer, the order `truck-pallet-update` and `-delete` already use.
- `ACTION_BUSINESS` `"bl"` + `ACTION_PAGE` `["inventory-receiver", "view"]` — the same tier as
  the list that produced the id.
- The pallet SELECT is **column-for-column what `truck-current` selects**, so one client
  function draws both screens.

### Frontend

A `View` button per truck row, and `#ir-det`: the BOL and its route, the photo, received
against what the BOL claimed, a facts grid (store, month, BOL date, carrier, trailer, seal,
pro, who opened it, who took it down, the note), and the pallet table.

- `irPalletTableHtml(pallets, opts)` extracted from `irRenderPallets`; the dock passes
  `{ edit: true }`, the read-back `{ withDate: true }`. Two copies of a pallet row drift —
  the same reason the tag helpers were renamed for a second caller rather than forked.
- `irTruckStatusHtml` likewise, so the table and the modal cannot disagree about "2 short".
  The modal recomputes `received` from the rows on screen, never from the list row.
- 🛑 **Read-only, deliberately. No Edit, no Delete.** The review email naming what this truck
  came up short of has already gone out; a row quietly changed afterwards makes that email
  wrong with nothing on either side saying so. Correcting a pallet stays on the dock, before
  Truck Down. `truck-pallet-update` would permit it — this is a product decision, not a limit.
- Escape closes the photo viewer first and the modal second; a tab switch closes the modal.
- A second `View` while the first is still in flight cannot paint truck A into a modal
  captioned truck B (`irState.detailId`).

### Verified

`4894 assertions across 76 suites` green (was 4864; §27–30 add 30, including the pair that
proves `truck-current` goes empty on the same database where `truck-detail` still answers).
`browser-inventory-receiver.mjs` **86** (was 50): the row is *clicked*, not called, in both
themes; contrast computed against what the browser really paints — new text runs 5.74–18.85:1.

### Not done, and not code

- [ ] Nothing is deployed. The worker needs `wrangler deploy` (prod) / `-e staging`; no
      migration is involved — `truck-detail` only reads tables migration-065 already made.
      Merging to `main` ships the frontend on its own via Pages, and the page will call an
      action the old worker does not know, which fails closed as `UNCLASSIFIED_ACTION` →
      *"That action is not available on this deployment."* **So deploy the worker first.**
