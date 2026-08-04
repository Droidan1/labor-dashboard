# Multi-business permissions — plan — 2026-08-03

> **STATUS (2026-08-04): PARTLY BUILT.** The role half of step 1 is live in
> production; the grants half is not started. See "Build order" for exactly
> what shipped. Everything from step 2 onward is still plan only.
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

- [~] **1 · Tables + backfill.** **HALF DONE.**
      - [x] `users` rebuilt by `migration-029.sql` — roles widened to
            `(superuser, admin, executive, manager, staff)`, `title` column added,
            `district_manager` retired and folded into `manager`. Applied to
            **staging and production 2026-08-04**; every dependent row preserved.
            Prod held no district managers, so nobody's role moved.
      - [ ] `businesses`, `business_units`, `user_grants` — **not created.** The
            grant model does not exist yet; scoping is still `users.stores`.
      - 🛑 **Any future rebuild of an existing table must snapshot and restore its
            children** — see the D1 cascade note below. New tables are unaffected,
            so the three above can be created normally.
- [ ] **2 · Worker reads grants.** Resolve grants at session time and gate
      **every endpoint by `business_id`, not just by role.** 🔑 This is the
      security-relevant step: today a `role === 'admin'` check alone would happily
      serve any business's data to a Bargain-Lane-only admin.
- [ ] **3 · Users page edits grants.** Stack multiple grants per person; business
      picker for roles that span businesses, unit picker for roles scoped to units.
      ⚠️ The store checkboxes are currently **twelve literal `<label>` elements**
      hardcoded across the two modals (`index.html` ~2445 and ~2486) — and BL16
      sits before BL14 in source order. That block has to be rendered, not typed.
- [ ] **4 · Landing page.** Earns its place the day someone holds **two** grants.
      Until then the redirect does the job and the picker is dead code. **Build it last.**

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
