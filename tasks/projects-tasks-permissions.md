# Projects & Tasks — permissions game plan — 2026-08-04

> **STATUS (2026-08-04): the role and its enforcement are LIVE; the feature is not.**
> `staff` exists as a role and cannot see money. It is deliberately **not offered
> in the invite dropdown** — there is nothing for a staff user to do yet, so
> granting it would strand someone on a "nothing assigned to you" screen.
> Everything about projects and tasks themselves is still unbuilt.
>
> ⚠️ Provisional, like its sibling [`multi-business-permissions.md`](multi-business-permissions.md).
> Re-read "Open questions" before treating anything here as decided.

**Feature, in one line:** a store manager hands projects and tasks to assistant
managers and retail leads at their store.

---

## The framing — three questions, only two are permissions

This looks like one access problem. It is three, and conflating them is what makes
role lists metastasize:

| Question | Answered by | Mechanism |
|---|---|---|
| Can you get into Bargain Lane, and which stores? | **the grant** | already exists (`users.stores`, later `user_grants`) |
| Can you hand out work, or only do it? | **the role** | one new bundle — see below |
| Is *this particular task* yours? | **the task row** | ⚠️ **not a permission** — it's `tasks.assignee_id` |

🔑 **Never express "can I see this task" as a role.** Task visibility is row-level
and falls out of the task's own fields (assignee, store, creator). Try to encode
it in roles and you need a role per relationship.

---

## Decisions taken (Brian, 2026-08-04)

1. **An assistant manager sees sales, budget and margin exactly like a manager.**
   → So an assistant manager **is a Manager**. The difference is org-chart only.
2. **A store manager can invite their own staff, bounded.** Lowest role only, own
   stores only. Removes the owner as the hiring bottleneck.
3. **A task belongs to exactly one store.** No multi-store projects for now.

---

## Roles — add exactly one

**Job title ≠ role.** "Assistant Manager" and "Retail Lead" are HR titles; a role
is a capability bundle. Two titles only justify two roles if the bundles differ.
Per decision 1 they don't, so:

| | Role | Job titles that sit here |
|---|---|---|
| existing | `manager` | Store Manager, **Assistant Manager** |
| **NEW** | `staff` | **Retail Lead**, associates, seasonals |

Add a display-only `users.title` column for the org chart. It carries no
permission whatsoever — it exists so the Users page can say "Assistant Manager"
without inventing a role.

### What `staff` can and cannot do

| | `staff` |
|---|---|
| Open Bargain Lane at their granted store(s) | ✅ |
| See the store's task board, and their own assignments | ✅ |
| Complete, comment on, attach photos to a task | ✅ |
| Create a project, assign work to anyone | ❌ |
| **Sales, budget, pace, margin, item cost** | ❌ **never** |
| Inventory, supply-request costs, reports | ❌ |

🔑 **This is the first role that must see LESS than a manager, not just fewer
stores.** Every account today sees sales. Scope alone cannot express `staff` —
it is a narrower feature set, not a narrower store list.

✅ **ENFORCED 2026-08-04** (`main` faf1805, worker `34cbb7e6`). `canSeeFinancials()`
in both `worker.js` and `index.html`, checked once right after authentication.
Written as an **allowlist of what a non-financial role may reach** — 85 of 108
actions are closed to `staff` — because a gap in an allowlist costs a 403 while a
gap in a denylist leaks revenue. The six money pages are guarded in
`navigateToPage()`, and a role without financial access lands on a no-access page
rather than an empty dashboard. `scripts/test-financial-gate.js` covers it.

⚠️ Found while testing: `.sidebar .nav-item` (0,2,0) was beating Tailwind's
`.hidden` (0,1,0), so **every role-gated nav item had been visible to roles that
could not open it** — a pre-existing bug, fixed in the same change.

---

## Consequence: the landing rule needs a new branch

Today everyone who signs in lands on a sales dashboard. A retail lead must not.

> **Land on the highest surface your role allows in that business** — not "land on
> the dashboard."

For `staff` that is their task list. This slots into the grant-counting rule in
the sibling plan: one grant still means "straight in, no picker", but *where*
"in" points now depends on the role, not just the business.

---

## Bounded invite — the rules that MUST hold server-side

Decision 2 is the security-relevant part. Same principle as the sibling plan:
**nobody grants what they don't hold.** Enforce in the worker, not the UI:

- [ ] A manager may create **only** `role = 'staff'`. Never manager, never above.
- [ ] Only at stores **in their own grant** — intersect, never union.
- [ ] Cannot edit, suspend or view a user holding a role **at or above** their own.
- [ ] Cannot elevate an existing `staff` to any higher role.
- [ ] Cannot grant a store they do not themselves hold.
- [ ] The role dropdown and store list are both filtered by **the inviter's grant**,
      not merely by their role. (Precedent: `worker.js:5087-5089` already narrows
      the role list by inviter.)

**Offboarding:** a manager may suspend `staff` they can see. They may **not**
delete users — history stays.

**Edge case worth writing a test for:** if a manager's stores shrink, staff they
previously created at a dropped store keep their own grant, and the manager simply
loses the ability to edit them. Access is evaluated live from the grant, never
from "who created whom".

---

## Two smaller things this feature forces

1. **A scoped people list.** To assign a task, a manager needs "who works at my
   store". Today listing users is gated by `canAccessInventory` (admin/superuser
   only). Needs a new, narrower endpoint returning only users whose grant
   intersects the caller's stores — never the whole directory.
2. ~~**A migration that rebuilds `users`.**~~ ✅ **DONE** — `migration-029.sql`,
   applied to staging and production 2026-08-04. Dropped `district_manager`,
   added `executive` and `staff`, added `title`. Both plans' needs in one rebuild
   as intended. 🛑 It also turned up that **D1 cannot suppress `ON DELETE
   CASCADE`** — see the D1 note in [`multi-business-permissions.md`](multi-business-permissions.md)
   before rebuilding any other existing table.

---

## Task visibility, stated as data (not roles)

| Who | Sees |
|---|---|
| `staff` | tasks assigned to them, plus their store's board |
| `manager` | every task at their granted stores |
| `admin` / `superuser` | everything in the business |
| `executive` | ⏸ read-only — **decide** (see open questions) |

Assignable people = users whose grant includes **this task's store**. Derived from
existing grant data; no new permission concept.

---

## Open questions

0. 🔑 **What surface does `staff` actually get?** This is now the blocking
   question — the role exists and is safely gated, but until there is something
   for a staff user to open, granting it strands them. Projects & Tasks is that
   surface; nothing else is.
1. **Does an `executive` see the task board?** It is operational, not financial,
   and sits inside a business they are granted. Read-only yes is the obvious
   answer, but it has not been decided.
2. **Can `staff` see the whole store board, or only their own tasks?** The table
   above assumes the whole board. If tasks can carry sensitive notes, narrow it.
3. **Does `staff` get the app at all, or just the task surface?** They will have a
   real account, so this decides whether Projects & Tasks is a page in the app or
   effectively its own small app for them.
4. **Do managers need to assign to another store's staff?** Decision 3 says tasks
   are single-store, which implies no. Revisit if district-level work appears.

---

## Deliberately not decided

- Any UI, schema, or endpoint for the tasks feature itself — this is permissions only.
- Whether projects are a real entity or just a grouping label on tasks.
- Notifications on assignment (the push machinery exists; not scoped here).
