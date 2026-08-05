# Multi-business permissions — plan — 2026-08-03

> **STATUS (2026-08-05): ALL FOUR STEPS BUILT AND LIVE.** worker `a5a4a26b` ·
> main `9753de2` · 7 more PRs. The landing picker, the Users-page grant editor,
> superuser-only business membership, the **fail-closed business gate**, the cron
> path, and `allowedUnits(user, businessId)` all shipped to production.
> 🛑 **Nothing structural now blocks E-Commerce — only SellerCloud credentials
> and data.** See "What shipped 2026-08-05" below.
>
> _Previous status (2026-08-04): steps 1–3 largely built._
> worker `be734899` · main `12b9095` · 10 PRs merged in one day.
> The grant model is in production and the worker reads it. Step 4 is
> deliberately untouched. See "Build order" for exactly what is and is not done,
> and read "What the review found" before adding any endpoint.
>
> ⚠️ **This plan is expected to change.** It was written before we know which
> businesses are actually being added or what the owner wants the Hub to become.
> The *shape* below is chosen precisely because it survives being wrong about
> those things — but the role names, the landing rules, and the build order are
> all still open. Re-read the "Deliberately not decided" section before treating
> any of this as settled.

**Goal:** let RETJG Hub hold more than one business without the permission model
collapsing, while knowing almost nothing about what those businesses will be.

---

## Why this came up

The app is currently Bargain Lane with a Hub-shaped name around it. E-Commerce
(SellerCloud) is the first real second business — see
[`tasks/sellercloud-api-brief.md`](sellercloud-api-brief.md). The moment there
are two, "what can this person do" and "which part of the company can they do it
in" stop being the same question, and the current four-role ladder can only
answer one of them.

---

## The one thing that was measured, not assumed

**`district_manager` and `manager` are already the same role.**

Every permission check in the codebase that names `district_manager` also names
`manager`, and treats them identically. There is no capability one has that the
other doesn't:

| Location | What it does |
|---|---|
| `worker.js:5088` | grantable-role list — both, together |
| `index.html:6214` | allowed-roles list — both |
| `index.html:13553` | supply-request nav visibility — both |
| `index.html:13934` | "select at least one store" validation — both |

The only difference today is **how many stores each was given.** So the moment
locations become an explicit selection on a grant, District Manager stops
existing — it's a Manager with three stores instead of one.

**This plan removes a role. It does not add one.**

---

## The model — one row

A **grant**:

> *this person* — *in this business* — *with this role* — *over these units*

A person may hold **several**. That single fact is what absorbs the unknowns:
different roles in different businesses becomes expressible, and adding a
business is an `INSERT`, not a design change.

### "unit" is deliberately a nothing-word

The fourth column is the generic slot. Each business supplies its own display
noun via `unit_noun`, so the schema is generic and the UI is specific:

| Business | `unit_noun` | Units are… |
|---|---|---|
| Bargain Lane | `store` | BL1 Coliseum, BL2 South Bend, … |
| E-Commerce | `storefront` | SellerCloud Companies (not synced yet) |
| *(anything else)* | `channel` / `account` / `facility` | whatever it wants |

A grant stays valid even when a business's units aren't known yet — "Admin on
E-Commerce, all storefronts" means the right thing before and after first sync.

---

## Roles — three, plus a flag

| Role | Scope | Can |
|---|---|---|
| **Admin** | per business | operate + configure that business, invite people into it |
| **Executive** *(new)* | per business | read only — sales, budget, pace. Changes nothing. |
| **Manager** | per business, per unit | day-to-day — dashboard, supply requests, photos |
| *superuser* | **not a grant** | a flag on the user meaning all businesses, all units, always |

`district_manager` is retired (folds into Manager — see above).

**Executive is the only genuinely new capability shape.** It also covers the
"someone who can view other businesses the superuser picks" case — that's an
Executive with a narrow scope, not a separate role.

### ✅ Financial gating — SHIPPED 2026-08-04

The role table above says *what* each role does; the enforcement is one gate.
`FINANCIAL_ROLES = {superuser, admin, executive, manager}`. The gate sits in
`worker.fetch` immediately after the auth gate and returns `403 NO_FINANCIAL_ACCESS`.

⚠️ **Manager KEEPS financial access.** Only `staff` — and any unrecognised role —
is gated. So this shipped as a **latent** control: it changes nothing for anyone
who exists in production today, and starts mattering the first time a `staff`
user is created. That is why it was safe to ship ahead of the feature that needs
it, and also why nobody would notice if it broke. It has a request-level test
(`scripts/test-request-scoping.mjs`); keep it that way.

🔑 **It is an allowlist, not a denylist.** `NON_FINANCIAL_ACTIONS` names the 23
actions that stay open (auth, passkeys, push, photos, announcements); the other
**85 of the 108 routed actions are closed by default** — counted from the source,
2026-08-04. A new money-touching endpoint is
protected the moment it is written — the failure mode of forgetting is a 403, not
a leak. That direction is the whole point; do not invert it.

Two things it does **not** cover, both found the hard way:
- 🛑 **Cron.** `scheduled()` never passes through `fetch`, so no scheduled sender
  is gated by it. Each one must check `canSeeFinancials()` itself.
- **The client.** `index.html` mirrors this with its own `canSeeFinancials()` and
  a `FINANCIAL_PAGES` guard in `navigateToPage`, plus `landingPageFor()` so a
  non-financial user lands somewhere they can actually use. That is UX, not
  security — the worker gate is the real one.

---

## Schema

```sql
-- one row per business. adding a business is an INSERT, not a deploy.
CREATE TABLE businesses (
  id          TEXT PRIMARY KEY,   -- 'bl', 'ecom'
  name        TEXT NOT NULL,      -- 'Bargain Lane'
  unit_noun   TEXT NOT NULL,      -- 'store' | 'storefront' | 'channel'
  source      TEXT,               -- 'clover' | 'sellercloud'
  active      INTEGER DEFAULT 1
);

-- stores, storefronts, channels, accounts — all the same slot.
CREATE TABLE business_units (
  id          TEXT PRIMARY KEY,   -- 'BL1'
  business_id TEXT NOT NULL REFERENCES businesses(id),
  code        TEXT NOT NULL,      -- 'BL1'
  name        TEXT NOT NULL,      -- 'Coliseum'
  active      INTEGER DEFAULT 1
);

-- the grant. a user may hold several — that is the whole point.
CREATE TABLE user_grants (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  business_id TEXT NOT NULL REFERENCES businesses(id),
  role        TEXT NOT NULL,      -- admin | executive | manager
  units       TEXT,               -- JSON array of unit ids; NULL = all
  PRIMARY KEY (user_id, business_id)
);

-- every existing user becomes one Bargain Lane grant. nothing changes for them.
INSERT INTO user_grants (user_id, business_id, role, units)
SELECT id, 'bl',
       CASE WHEN role = 'district_manager' THEN 'manager' ELSE role END,
       stores
  FROM users WHERE role <> 'superuser';
```

---

## Where people land after sign-in

Counting grants answers it.

| Grants held | What happens |
|---|---|
| 0 | a plain "no access yet — ask an admin" screen. Invited-but-not-granted is a real state. |
| **1** | **straight into that business's dashboard. No picker, ever.** Units narrow what they see inside it. |
| 2+ | the picker, showing only granted businesses. Switcher also lives in the sidebar. |
| superuser | the picker, showing everything. |

**A Bargain Lane user has one grant, so they go straight to the Bargain Lane
dashboard** — today and after five businesses exist. (User's call, 2026-08-03.)

---

## Build order

Sequenced so the risky part lands while nothing is visible, and the visible part
lands when it's already true.

- [x] **1 · Tables + backfill — DONE.** `migration-030` created `businesses`,
      `business_units`, `user_grants` and backfilled every user as one Bargain Lane
      grant. Applied to **staging and production 2026-08-04**; 11 grants, scope
      carried over with **zero** role/unit mismatches, idempotency proven by a
      second run writing 0 rows. Purely additive, so the D1 cascade trap below did
      not apply — rollback is dropping three tables.
      ⚠️ `user_grants` is now the **fifth** table cascading off `users`.
      **Verified in prod 2026-08-05:** 1 business, 12 users, **11 grants** — the
      12th is the superuser, who correctly holds *no* grant, because superuser is
      a flag meaning "all businesses" and not a row. 3 admins + 8 managers.
- [~] **2 · Worker reads grants — HALF DONE.**
      - [x] Grants resolved once per request in `getAuthUser`; `allowedStores()`
            reads the `bl` grant. Proven behaviour-preserving before shipping —
            12 real users, 72 per-store decisions, **zero differences** — and
            verified live in prod with a grant deliberately disagreeing with the
            column (the grant won).
      - [x] A transitional fallback to `users.stores` that logs `grant_fallback`.
            **Remove once that line has been silent for a while.**
      - [ ] **Gate every endpoint by `business_id`.** NOT started, and correctly so:
            `canAccessBusiness()` exists but has **zero call sites**, because with
            one business there is nothing to disambiguate. This becomes real work
            the day a second business exists — and it is the security-relevant half.
- [~] **3 · Users page edits grants — HALF DONE.**
      - [x] `invite-user` and `update-user` write the grant alongside the columns.
            🔑 `update-user` re-reads from the DB rather than trusting the request
            body: `role` and `stores` are independent optional fields, so building
            the grant from the body would blank whichever the UI did not send.
      - [x] The store picker renders from one `USER_STORES` list (was twelve
            hardcoded `<label>`s), so a per-business unit picker is a data change.
      - [ ] Multiple grants per person, business picker, per-business role. Nothing
            to build until a second business exists.
- [ ] **4 · Landing page — NOT STARTED, still correctly last.** Every user holds
      exactly one grant, so the picker would be dead code for all 12 of them.
      🛑 **The blocker is not code.** E-Commerce needs SellerCloud credentials —
      a team endpoint, a read-only integration user, and its password. See
      [`sellercloud-api-brief.md`](sellercloud-api-brief.md) (now tracked on main).

## What shipped 2026-08-05

- **Step 4 — landing page.** Portfolio picker: group hero, per-business cards with
  live figures, sticky session selection, mobile switcher. Superuser + admins reach
  it; the 8 managers hold one grant and route straight to the dashboard, unchanged.
- **Step 2's `business_id` gating — the long-deferred half.** `canAccessBusiness()`
  went from **zero call sites** to gating **86** actions. Fail-closed: 25 agnostic,
  86 mapped, anything unclassified **refused**.
  🔑 Fail-closed is only safe with a completeness test that enumerates routed actions
  FROM SOURCE — it immediately caught `boost-post`, routed only on `staging`.
  🛑 Three actions must **NOT** be gated, found by an adversarial pass over all 111:
  `auth-me` (circular — it is how the client learns its businesses; gating breaks
  login for everyone), `grant-options` and `user-grants`/`set-user-grants`
  (self-filtering).
- **Step 3 — grant editor.** Users page edits grants per business (role + units),
  rendered from `businesses`/`business_units`.
- **Conferring a business is superuser-only.** Admins edit role/units inside
  businesses a person already holds. 🔑 The add/remove check is scoped to businesses
  the caller can SEE — otherwise an admin blind to E-Commerce omits it, and reading
  that omission as a removal 403s them out of editing the user entirely.
- **`allowedUnits(user, businessId)`** replaced the hard-wired `'bl'`; `allowedStores`
  is a thin wrapper so all 21 call sites are untouched. 🔑 The `users.stores` fallback
  is Bargain-Lane-ONLY — a generic one would hand a bl-only manager BL's store list
  when asked about E-Commerce.
- **Cron.** `chainWideRecipients()` now requires Bargain Lane access. The gate covers
  requests only; cron needed it written separately — the third time that has bitten.

⚠️ **The admin widening.** Admins were briefly listed as seeing every business so they
could reach the picker, then closed the same day. The 3 admins now hold explicit,
revocable `ecom` grants (migration-033) rather than inheriting from a branch. **They
will see real E-Commerce figures the day SellerCloud connects** — accepted deliberately.

### What the review found — read before adding an endpoint

An adversarial multi-agent review on 2026-08-04 found **seven** holes, all
predating the grant work and all live in production. Every one had passed every
test. They are fixed, but the shapes recur:

| hole | shape |
|---|---|
| `store-scores`, `ly-sales` | returned every store's figures — never called `allowedStores()` |
| fall-through `?store=` | read AND overwrote any store — the final `else` branch of `fetch`, reached by any unrecognised `?action=` too |
| `update-user` | any admin could assign `role: 'superuser'` and self-promote |
| daily summary, weekly digest | chain-wide sales emailed to all 8 scoped managers — **cron never passes the request-path gate** |
| interval push | a third hand-rolled copy of `allowedStores()`, and no financial check |
| `.sidebar .nav-item` | CSS specificity (0,2,0) beat `.hidden` (0,1,0), so gated nav items stayed visible |

🔑 **Four rules that fall out of those:**
1. **Every store-parameterised route calls `canAccessStore()`** — including
   fall-through and non-`?action=` routes. Two of the seven were routes nobody
   thought of as endpoints.
2. **Never hand-roll scoping.** There were three copies; there are now **zero** —
   `allowedStores()` has exactly **one** definition and **21** call sites
   (verified 2026-08-05). Add a call site; never a copy.
3. **Anything on a cron re-checks role AND scope itself** — the gate
   protects *requests*, not the app.
4. **Any endpoint that writes `role` needs an allowlist**, and `'superuser'`
   belongs in none of them.

⚠️ **The tests did not catch any of this, and could not.** They extracted pure
functions with regexes or grepped source, so they tested policy and never wiring.
Mutation testing measured a ~25% kill rate; deleting the financial gate outright
left the whole suite green. `scripts/test-request-scoping.mjs` and
`test-interval-summary.mjs` now drive the real `worker.fetch` / `worker.scheduled`.
**Adding a store-scoped endpoint means adding a case there.**

### 🛑 D1 cannot suppress ON DELETE CASCADE (measured 2026-08-04)

Rebuilding a table that other tables reference is not a normal migration on D1.
`DROP TABLE parent` runs an implicit `DELETE` that fires every child's
`ON DELETE CASCADE`, and **neither PRAGMA escape works**:

| attempted | result on D1 |
|---|---|
| `PRAGMA foreign_keys = OFF` | file rejected outright — `D1_RESET_DO`, "import polling failed" |
| `PRAGMA defer_foreign_keys = true` | accepted, **child rows still deleted** |
| neither | child rows deleted |

`defer_foreign_keys` defers constraint *checking*; `CASCADE` is an *action* and
fires regardless. Proven on staging with a throwaway parent/child pair (child
went 1 → 0 every way) and reproduced against local sqlite.

The working pattern is in `migration-029.sql`: snapshot each child into a plain
table via `CREATE TABLE … AS SELECT` (no foreign key, so it survives the DROP),
rebuild, restore, drop the snapshots. Also: **do not put `PRAGMA` or an explicit
`BEGIN`/`COMMIT` in a D1 migration file** — D1 runs it in its own transaction and
an explicit one makes the whole file fail.

`scripts/test-migration-029.js` harnesses this against real sqlite with foreign
keys enforced. Reuse it as the template for the next rebuild.

### Rule that must survive into the implementation

**Nobody can grant what they don't hold.** An Admin scoped to Bargain Lane must
not be able to make someone an Executive over E-Commerce. Both the role dropdown
and the business list need filtering by *the inviter's own grant*, not just their
role. There's precedent — the app already conditionally shows the Admin option
(`worker.js:5087-5089`) and hides Superuser in the edit modal.

---

## Open questions

1. **What is an E-Commerce day-to-day operator called?** "Manager" currently
   carries a retail connotation. Either the word broadens, or we accept
   per-business role names.
2. **Does an Executive see cost / margin?** Sales and pace, clearly yes. Item
   costs and GPM are a different sensitivity — decide before anyone is invited,
   not after they've seen it.
3. **Do E-Commerce units come from SellerCloud Companies or channels?** Open
   question #2 in `sellercloud-api-brief.md`; it decides what `business_units`
   holds for `ecom`.
4. **Does anything actually need per-unit permissions outside Bargain Lane?**
   If not, `units` may stay `NULL` for every non-BL grant for a long time.

---

## Deliberately not decided

These are open on purpose. Do **not** treat the plan as specifying them:

- Which businesses exist beyond Bargain Lane and E-Commerce.
- Whether the owner wants a group roll-up view at all (an earlier "Jay Group"
  card was a placeholder and was dropped).
- Whether Admin should be splittable (e.g. someone who configures but can't
  invite).
- Any UI beyond the previews — no components, tokens, or routes are committed.

---

## Previews this came from

Concept previews only; nothing in them is production code.

1. Four landing-page concepts — <https://claude.ai/code/artifact/78281a49-0642-4548-adf9-882e8c679671>
2. Concept 2 refined + role/scope model — <https://claude.ai/code/artifact/193cdc22-f016-4639-86d2-ed249c0df683>
3. Users page granting business scope — <https://claude.ai/code/artifact/de06f84e-8989-4d8c-8ad4-a43ddb6f9439>
4. **The grant model + sandbox + schema** — <https://claude.ai/code/artifact/f99601c5-b50e-40f5-ae74-d491512b2f9f>

User picked **concept 2 (Portfolio)** for the landing page, with Bargain Lane and
E-Commerce only, and auction folded back into Bargain Lane's channel mix.

⚠️ In preview 2 the group total was initially wrong — auction was summed
*alongside* Bargain Lane when it is a channel *inside* it, inflating the chain
figure by $2,428. Same class of double-count as the vs-last-year like-for-like
bug. Whatever ships must never add a channel to its own parent.
