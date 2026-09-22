# Associates: a name, a six-digit code, and the pages an admin ticked (2026-09-09)

## The ask

> "I want to add a new role. This role will be associate… admin only, and for now only
> for the bargain Lane business. This user will be given a six-digit login that if they
> forget, there will be an option for them to ask to reset, but only the admin can reset.
> The permissions for this user will be very limited. and will be set by the admin. For
> example, they will be able to view and use the bin dump page, but will not be able to
> view any other page, even the dashboard… Add a button for associate login."
> — Brian, 2026-09-09

Floor workers have no company email, share warehouse phones, and are about to get pages
they use every shift. Until now the only way into the HUB was an emailed magic link, an
emailed OTP or a passkey, and every role that could open Bin Dump could also open store
financials.

## What shipped

**One new kind of account.** Created only from the Users page by an admin or superuser,
with a name, a six-digit code, at least one store, and per page **None / View / Edit**.
They sign in from a new **Associate login** button on the login card, land on the first
page they hold, and can reach nothing else.

**The DB role is `staff`; the label everywhere a human looks is "Associate".** `staff`
was already in both CHECK constraints, already outside `FINANCIAL_ROLES` — so ~85 money
actions were already closed to it — and `tasks/projects-tasks-permissions.md` already
reserved it for "Retail Lead, associates, seasonals". Adding a literal `'associate'`
value would have meant the migration-029 table rebuild, with its `ON DELETE CASCADE`
trap across five child tables, to buy nothing.

**`pin_hash IS NOT NULL` is the discriminator, not the role.** Every guard asks that
question through one `isAssociate()` helper, so the day a `staff` user signs in by email
instead, the 12-hour session and the passkey refusal keep applying to code-login
accounts only — one line, in one place.

### The gate

The worker's three gates keep their order (auth → financial → business). The financial
gate learned exactly one more way to say yes: *the action serves a page this account
holds, at the level that action needs.*

```
ACTION_PAGE:  bin-dump-list, bin-dump-photo            → bin-dump, view
              bin-dump-scan, -recent, -log, -update    → bin-dump, edit
              bin-dump-delete                          → ABSENT, deliberately
```

`bin-dump-delete` is missing on purpose: removing a logged pallet stays a manager's undo
(Brian, 2026-09-08), so no page grant can reach it at any level. `GRANTABLE_PAGES` — the
closed set an admin may tick — is *derived* from that map, so a page with no actions
behind it cannot become a checkbox that grants nothing.

The gate and the seven handlers call **one** `canUsePage()`. They did not, at first, and
mutation testing is what said so: see "What the mutations found" below.

### The code

- Stored as `HMAC-SHA256(PIN_PEPPER, code)`, hex. Not the code, and not a bare digest —
  six digits is a million candidates, so a plain SHA-256 reverses in seconds from a
  database dump, which is the threat. The pepper is a `wrangler secret`, so it is not in
  the dump at all.
- **No pepper, no login and no code-setting** — 500 "not configured", never an
  unpeppered hash quietly downgrading every stored code.
- Ten wrong codes locks the account until an admin sets a new one. The counter is a **D1
  column**, not a KV key: `UPDATE … + 1` is atomic against one primary, where KV is
  eventually consistent across edges and would let a distributed guesser walk straight
  past the limit it appeared to enforce.
- A new code **deletes their sessions**. Otherwise the phone that prompted the reset
  keeps working and the reset has achieved nothing.
- Generated with `crypto.getRandomValues` **and rejection sampling** — `% 1000000` on one
  draw makes the first ~967,000 codes very slightly likelier, and this is the only secret
  an associate has. Obvious codes (`123456`, repeated digits…) are refused at creation.
- The admin sees it once, when they set it. There is no "look it up"; the recovery path
  is a new code.

### Why the login takes a name as well as the code

The first draft was code-only, POS style. With no account named, the only lockouts that
can exist are per-IP — an attacker just rotates — or global, which means any one phone
spamming wrong codes locks **every** associate out. A name gives you an account to lock.
It also removes the code-uniqueness rule, the "that code is already in use" oracle it
would have handed an admin, and the KV counter. The phone remembers the name, so day to
day it is still just six digits.

Every failure answers identically — wrong code, unknown name, suspended account — so the
login card cannot be used as a directory of who works here. A malformed code dies at
input validation, before anything is looked up or counted, so it can neither probe nor
burn somebody's remaining attempts.

### Forgetting the code

"Forgot your code?" records the request and nothing else; the Associates panel shows
**WANTS A NEW CODE · 2h ago**. It always answers ok, and re-asking inside an hour is a
no-op so the badge shows when they first asked. An associate cannot reset their own code
— that was the ask, and it is also what keeps this endpoint safe to leave unauthenticated.

### The shell

`auth-me` now carries `name`, `pages` and `associate`, so the client and the worker agree
on one fact rather than each deciding what `staff` means.

The sidebar is built by **subtraction**: hide every `.nav-item` and group, then reveal
only the granted pages. A list of things to hide would need editing every time a page is
added anywhere in the app, and the day someone forgot, an associate would find a page
nobody meant to give them. Settings is among the hidden — it offers passkey enrolment
(which the worker refuses for them) and notification toggles that can never fire for an
account that sees no money. Dark mode and **Sign out** both stay: on a shared phone,
signing out is the thing that has to be one tap away.

`landingPageFor` sends them to the first page they hold in registry order — the same page
every morning — or to `no-access`, which now says who they are signed in as.

## What looking at it turned up

Four things that were already true and would have shipped as bugs:

1. **`loadAll()` would have painted an error over the associate's page.** It runs for
   every landing, and it fetches all six stores with `?history_d1=true` — a request
   carrying no `action` at all, which the financial gate refuses. Every fetch 403s and
   the run ends by writing "Failed to load: … Data may be incomplete." into
   `#error-banner`, a body-level sibling of `#app` that sits **above** whichever page is
   open. Fixed by returning right after the shell reveal for anyone without financial
   access — after, because that reveal is the only thing besides `showLoginPage` that
   hides the splash.
2. **The bottom bar lost its highlight ~800ms after every load, for everybody.**
   `setTimeout(init, 800)` and `setTimeout(init, 2200)` call `syncBottomNav()` with no
   page, meaning "re-gate the rows, leave the active tab alone" — but the function
   computed `morePages[undefined]`, so `activeTab` came out `undefined` and every tab went
   dim until the next tap. A pre-existing bug, found by driving the boot path in a real
   browser, fixed in one line.
3. **A bl grant with no units reaches nothing.** `allowedUnits` reads NULL units for
   Bargain Lane as *no* stores, deliberately (migration-030's backfill). An associate
   saved without a store would sign in perfectly and then find every store guard refusing
   them, so both the endpoint and the editor require at least one — and the panel says
   "No stores — they cannot log anything" rather than the comfortable lie "All stores".
4. **The synthetic address was an oracle.** `assoc_<id>@associate.invalid` exists only
   because `users.email` is `NOT NULL UNIQUE`. Left alone, `auth-login` would have
   accepted it, tried to mail `.invalid`, and answered differently from an address nobody
   has. Every email-login lookup now carries `AND pin_hash IS NULL`, and `resend-invite`
   404s for one.

Also: `test-privilege-guards.js` sliced update-user's handler as a fixed 3,000 characters,
so adding a guard at the top of it silently truncated the region and the `A < B` ordering
assertions started comparing against `indexOf`'s `-1`. It read as a failure this time; with
the operands the other way round it would have read as a **pass**. The region is now the
whole handler, and both halves must be found before they are ordered.

## What the mutations found

Ten deliberate breakages; every one turns something red.

| # | Mutation | Caught by |
|---|---|---|
| 1 | any page grant admits any level | `test-associate` (3 failures) — **after** the fix below |
| 2 | `>=` → `>` on the level check | `test-associate` (7) |
| 3 | login stops filtering to associates | `test-associate` (1) |
| 4 | a new code no longer deletes sessions | `test-associate` (2) |
| 5 | associates readmitted to the email login | `test-associate` (1) |
| 6 | the lockout is removed | `test-associate` (2) |
| 7 | the `loadAll` early return is removed | browser probe |
| 8 | associates not filtered out of the Users table | browser probe |
| 9 | the sidebar subtraction is removed | browser probe (6) |
| 10 | `navigateToPage`'s associate guard is removed | browser probe (4) |

**Mutation 1 survived the first time**, and that is the useful part. The financial gate
had its own copy of the level comparison, so breaking `canUsePage` left the outer copy
holding and nothing went red. Two copies of one rule is how a gate and its handler come
to disagree, and the copy that disagrees quietly is always the one that says yes. The
gate now calls the same helper, and the mutation is caught.

## Verification

- `bash scripts/test.sh` — **3,786 assertions across 59 suites, green**, including the
  new `scripts/test-associate.mjs` (131). It creates the account through
  `associate-save` and signs in through `associate-login`, using the cookie the worker
  actually sets; nothing inserts a user row by hand, because a fixture that skipped the
  endpoints would pass while the endpoints were broken.
- **75 browser assertions** in headless Chromium across six scenarios: an associate with
  edit, with view, with nothing; a manager (the regression case); the login card; and the
  Users page as an admin. Not committed — Playwright is not a dependency of this repo and
  there is no `node_modules` here — so what it proves is written down above.
  `offsetParent` is not what it asks: it is null for `position: fixed` and for everything
  inside the sidebar at phone widths, so it answers a media-query question, not the role
  question. It reads the `hidden` class the app actually toggles, and uses
  `Element.checkVisibility()` for the handful of assertions that really are about pixels.

## Deploy order

Derived from which side stops being backward-compatible (rule 6). The new worker's
`getAuthUser` selects `u.name, u.pages`, so the migration must land first; the frontend
calls actions the worker must already serve, so it lands last.

1. `npx wrangler secret put PIN_PEPPER --env staging`, then production
   (`openssl rand -hex 32`). A secret, never `[vars]` — `wrangler.toml` is a public file.
   **Rotating it invalidates every code**, so it is set once and left alone.
2. `migration-061.sql`, staging then production, each with Brian's explicit go (rule 7).
   Not re-runnable: `ALTER TABLE ADD COLUMN` takes no `IF NOT EXISTS`, as migration-059
   proved on production.
3. Worker deploy; confirm it landed by grepping the deployed bundle for `associate-login`
   (rule 5 — poll on the whole condition, require consecutive clean passes).
4. Frontend PR merges last. Pages rebuilds `main` on its own; `CACHE_NAME` is at **v178**.

## What actually landed, 2026-09-09/10

Steps 1-3 are **done on both environments**; only the frontend merge is outstanding.

| Step | Staging | Production |
|---|---|---|
| `PIN_PEPPER` secret | ✅ set (`clover-sales-api-staging`) | ✅ set (`clover-sales-api`) |
| `migration-061.sql` | ✅ applied, 5 columns confirmed by `pragma_table_info` | ✅ applied, same |
| Worker deploy | ✅ `562451bb-b101-457b-86c9-b4ab0d03c57f` | ✅ `ef0ff3e9-dbd2-4202-b8ef-128e1d43737b` |
| Frontend | — | ✅ #205 merged as `49ed4f4`; Pages built `main` (`55d223df`) |

**Fully live at www.retjghub.com as of 2026-09-10 00:10 UTC.** Installed PWAs pick the new
shell up on next launch — `CACHE_NAME` moved to v178 and `_headers` serves `sw.js` and
`index.html` with `Cache-Control: no-cache`.

A **different random pepper per environment**, deliberately: they are different databases,
and a code minted against one should not validate against the other.

Production was backed up before the migration — the 14 user rows to
`users-prod-backup-20260909T235909Z.json` in the session scratchpad, checked for row count
before the ALTERs ran (rule 2: a failed backup is a failed write). Afterwards: **14 users,
0 associates, 0 with pages, 0 failures** — no row was read, rewritten or touched, which is
all an `ADD COLUMN` can do. Production holds 5 admins, 8 managers and 1 superuser and no
`staff` at all, so the financial gate's new clause changes nothing for anyone today.

Both deploys verified by fetching the deployed script from the Cloudflare API and grepping
the bundle: `associate-login`, `associate-save`, `PIN_PEPPER`, `canUsePage`, `ACTION_PAGE`,
`NEED_PAGE_EDIT` and `u.name, u.pages` all present; `bin-dump-log`, `DUPLICATE_BARCODE`,
`FINANCIAL_ROLES`, `binDumpStoreGuard` and `auth-verify-otp` all still present, so nothing
was reverted. **Three consecutive identical body hashes** on production (rollout is ~180s
observed), and the production hash equals staging's — the same code is on both.

🔑 **Comparing the fetched bundles with `cmp` reported a difference when there was none.**
The Cloudflare API returns the script as `multipart/form-data` with a **random boundary per
request**: 116 differing bytes, exactly two boundary strings, identical content. Hash the
body with the boundary lines stripped, not the response.

⚠️ **The live HTTP endpoints were NOT exercised from this session.** The egress proxy denies
`api-staging.retjghub.com` and `api.retjghub.com` by policy, so the evidence here is the
deployed bundle plus the 131-assertion suite driving the real `worker.fetch`. The first
real request against the deployed worker will be a human one.

## Still open

- **No associate exists yet.** Nothing about this has been exercised by a real request:
  the session that built and deployed it could not reach the worker's hostname, so the
  first sign-in will be the first live test. What to check, in order: create one from
  Users → Associates, confirm the code works on a phone, confirm the sidebar shows only
  Bin Dump, confirm the dashboard is unreachable by URL, and confirm the Log records the
  name rather than an email address.
- The second `GRANTABLE_PAGES` entry is free when it is wanted: `submit-photos` is already
  reachable for `staff` server-side, so it costs one registry line and no worker change.
- Rate limiting still does not exist anywhere else in this app. The associate login is the
  only endpoint in it that counts failures.
