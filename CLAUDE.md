## Workflow Orchestration

### 1. Plan Mode Default
	⁃	﻿﻿Enter plan mode for architectural decisions and anything under Destructive Operations; otherwise write the plan and start
	⁃	﻿﻿If the plan's assumption proves wrong, update the plan before continuing - don't keep pushing
	⁃	﻿﻿Include how you'll verify in the plan
	⁃	﻿﻿Write detailed specs upfront to reduce ambiguity
### 2. Subagent Strategy
	-          Use subagents when a search or read would flood the main context window
	⁃	﻿Offload research, exploration, and parallel analysis to subagents
	⁃	﻿﻿One task per subagent for focused execution
### 3. Self-Improvement Loop
	⁃	﻿﻿After ANY correction from the user: update "tasks/lessons.md" with the pattern
	⁃	﻿﻿Write rules for yourself that prevent the same mistake
	⁃	﻿﻿Before adding a lesson, extend an existing one if it covers the same pattern
	⁃	﻿﻿At session start, read the lesson headings and open the ones that touch the task
### 4. Verification Before Done
	⁃	﻿﻿Never mark a task complete without proving it works
	⁃	﻿﻿Diff behavior between main and your changes when relevant
	⁃	﻿﻿Done = `npm test` passes; new behaviour has a test or `scripts/browser-*.mjs` check that fails without the change; UI changes pass the checks under UI work, in both themes; a deploy meets Destructive Operations rule 5
### 5. Autonomous Bug Fixing
	⁃	﻿﻿When given a bug report: just fix it. Don't ask for hand-holding
	⁃	﻿﻿Point at logs, errors, failing tests - then resolve them
	⁃	﻿﻿Zero context switching required from the user
	⁃	﻿﻿Go fix failing CI tests without being told how
## Task Management

1. **Plan First**: Add the plan as a new dated entry at the top of tasks/todo.md (it's a newest-first log — never overwrite it), with checkable items

2. **Verify Plan**: Check in before implementing only when the plan includes a Destructive Operations step or a product decision the request doesn't settle; otherwise proceed

3. **Track Progress**: Mark items complete as you go

4. **Explain Changes**: Once, at the end of the run, in the Reporting format below

5. **Document Results**: Add review section to tasks/todo.md

6. **Capture Lessons**: Update tasks/lessons.md after corrections

## Reporting

End every long run (anything unattended, or more than a few steps) with a report under exactly
these three headings, in this order. Write "None" under an empty heading.

- **Blocked on me**: everything waiting on the user, such as a merge click, a `wrangler` deploy
  or migration, a Destructive Operations rule 7 confirmation, a credential, or a product
  decision. Give the exact ask for each and what it unblocks.
- **Changed**: files, commits, PR links, deploys and data writes, each with how it was verified.
- **Found**: problems noticed but not fixed, each with `file:line` and why it was left.

## Core Principles
	⁃	﻿﻿**Simplicity First**: Make every change as simple as possible. Impact minimal code.
	⁃	﻿﻿**No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
	⁃	﻿﻿**Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

## UI work

Read [DESIGN.md](DESIGN.md) before building or restyling a surface, and extend what is
there rather than deriving a new look. In particular, **any dense/tabular Merchandising
surface follows §4.8** (panel + bar + legend, the three cell states, the level badges) —
the Coverage heatmap and the Manifest Scorer's tables are meant to look like Buy Criteria,
not like six different tables. §4.8 also lists the six rendering traps this repo has
already shipped broken once; check them before saying a table is done.

Verify a colour change in BOTH themes by computing contrast against the real background
(≥ 4.5:1), never by looking at a screenshot — and never against the local `tailwind.css`,
which is stale and carries no `dark:` variants.

## Design Context

Users: store managers, district managers and admins of a liquidation retail chain, often on
phones as an installed PWA. Jobs: sales vs budget, labor, inventory and receiving,
merchandising, marketing. Direction: DESIGN.md §1, V1 "Operator" (operational, dense). Fonts,
palette and tokens are fixed by DESIGN.md §2 in both themes: extend them, don't pick new ones.

## Pull requests

🛑 **Auto-merge does not work on this repo, and there is no window in which it does.**
Brian asked for it as the default on 2026-09-08; it was tried twice and refused twice.
`main` is **unprotected**, so no status check is *required*, so a PR never reaches the
`blocked` state GitHub's auto-merge exists to wait on — it goes straight from `unstable`
(the two Cloudflare Pages builds still running) to `clean`, and the API refuses both:

    unstable -> "required checks are failing"   (nothing was failing; they were running)
    clean    -> "already in clean status ... you can merge directly"

Do not keep retrying this on a hunch about timing. **The precondition is branch
protection on `main` with the two `Cloudflare Pages` checks marked required** — a repo
setting only Brian can change, and one that would also stop him pushing straight to
`main`. Until that exists, every PR needs his merge click, and saying so is the correct
answer rather than trying again.

⚠️ **Merging is not deploying — except for the frontend.** Pages rebuilds `main`
automatically, so a merged `index.html` change reaches www.retjghub.com with no
further step. The worker and every migration still need an explicit `wrangler` run, and
the Destructive Operations rules below apply to those in full and are not softened by
this. Claude does not run `wrangler deploy` or a migration: ask for each one under
**Blocked on me**. Ask for a backward-compatible worker change to be deployed as soon as it
is pushed, before review: it is inert until a frontend calls it, and shipping it first means
a merge can never put the frontend ahead of its worker.

Approving a PR remains out of scope.

## Destructive Operations (this repo has lost production data three times)

<rules>
1. **Never re-pull a date that is already healthy.** Clover's order retention is ~90 days and
   decays continuously, so a re-pull of a good day silently drops refunds that have aged out.
   Use the Repair console's health check to pick dates. Never a blind range.
2. **Back up before overwriting, and treat a failed backup as a failed write.** Losing the undo
   is not an acceptable price for applying a fix.
3. **Never verify a guard with a probe that performs the damage if the guard is absent.** Prefer
   a path that dies at input validation over one that dies at authorization.
4. **Assume Clover degrades by returning LESS, not by erroring.** A non-zero `orderCount` is not
   evidence of a complete fetch. Cross-check every write against D1.
5. **Confirm a deploy actually landed, everywhere.** Worker rollout is gradual (~180 s observed)
   and mid-rollout requests hit a mix of old and new. Poll on the full condition; require
   3 consecutive clean passes.
6. **Derive deploy order from which side stops being backward-compatible** — not from last time.
7. **In production, database mutations and any KV overwrite of stored history require
   explicit confirmation**, with a summary of exactly what will be affected. A probe that writes
   (even an additive `ALTER`) counts; check schema read-only instead, e.g.
   `PRAGMA table_info(<table>)`. Before citing this rule, grep what the code actually writes:
   an in-memory cache is not stored history.
</rules>

See [MEMORY.md](MEMORY.md) for the incidents behind each of these.

## Skill Restrictions (this repo only)

The `Leonxlnx/taste-skill` pack is installed globally at `~/.claude/skills/`, so all 13 of its
skills appear in the skill list here. **Do not invoke any of them on labor-dashboard.** They are
for future greenfield projects only.

Skills: `design-taste-frontend`, `design-taste-frontend-v1`, `full-output-enforcement`,
`gpt-taste`, `high-end-visual-design`, `image-to-code`, `minimalist-ui`, `industrial-brutalist-ui`,
`redesign-existing-projects`, `stitch-design-taste`, `brandkit`, `imagegen-frontend-web`,
`imagegen-frontend-mobile`.

Why they are blocked here:
1. **Scope**: `design-taste-frontend` lists "dashboards / dense product UI / admin panels" and
   "data tables" as explicitly OUT OF SCOPE. That is this project.
2. **Stack**: they assume React/Next.js, Server Components, Tailwind v4, `motion/react`. This repo
   is a vanilla ~14.7k-line `index.html` + `worker.js`, Tailwind v3, `bash scripts/build.sh`.
3. **`full-output-enforcement` conflicts with Core Principles above** — it bans brevity and demands
   full-file output, which contradicts "Simplicity First" / "Minimal Impact" and would push toward
   reproducing all of `index.html` instead of targeted edits.
4. **`stitch-design-taste` generates `DESIGN.md`** and would clobber this repo's own tracked
   `DESIGN.md` (the living redesign spec).

If a genuinely new standalone marketing or landing surface is ever built in a separate repo,
`design-taste-frontend` is worth using there.
