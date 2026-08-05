## Workflow Orchestration

### 1. Plan Node Default
	⁃	﻿﻿Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
	⁃	﻿﻿If something goes sideways, STOP and re-plan immediately - don't keep pushing
	⁃	﻿﻿Use plan mode for verification steps, not just building
	⁃	﻿﻿Write detailed specs upfront to reduce ambiguity
### 2. Subagent Strategy
	-          Use subagents liberally to keep main context window clean
	⁃	﻿Offload research, exploration, and parallel analysis to subagents
	⁃	﻿﻿For complex problems, throw more compute at it via subagents
	⁃	﻿﻿One tack per subagent for focused execution
### 3. Self-Improvement Loop
	⁃	﻿﻿After ANY correction from the user: update "tasks/lessons.md" with the pattern
	⁃	﻿﻿Write rules for yourself that prevent the same mistake
	⁃	﻿﻿Ruthlessly iterate on these lessons until mistake rate drops
	⁃	﻿﻿Review lessons at session start for relevant project
### 4. Verification Before Done
	⁃	﻿﻿Never mark a task complete without proving it works
	⁃	﻿﻿Diff behavior between main and your changes when relevant
	⁃	﻿﻿Ask yourself: "Would a staff engineer approve this?"
	⁃	﻿﻿Run tests, check logs, demonstrate correctness
### 5. Demand Elegance (Balanced)
	⁃	﻿﻿For non-trivial changes: pause and ask "is there a more elegant way?"
	⁃	﻿﻿If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
	⁃	﻿﻿Skip this for simple, obvious fixes - don't over-engineer
	⁃	﻿﻿Challenge your own work before presenting it
### 6. Autonomous Bug Fizing
	⁃	﻿﻿When given a bug report: just fix it. Don't ask for hand-holding
	⁃	﻿﻿Point at logs, errors, failing tests - then resolve them
	⁃	﻿﻿Zero context switching required from the user
	⁃	﻿﻿Go fix failing CI tests without being told how
## Task Management

1. **Plan First**: Write plan to "tasks/todo.md" with checkable items

2. **Verify Plan**: Check in before starting implementation

3. **Track Progress**: Mark items complete as you go

4. **Explain Changes**: High-level summary at each step

5. **Document Results**: Add review section to 'tasks/todo.md"

6. **Capture Lessons**: Update tasks/lessons.md" after corrections


## Core Principles
	⁃	﻿﻿**Simplicity First**: Make every change as simple as possible. Impact minimal code.
	⁃	﻿﻿**No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
	⁃	﻿﻿**Minimat Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

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
   consecutive clean passes.
6. **Derive deploy order from which side stops being backward-compatible** — not from last time.
7. **Database mutations and any KV overwrite of stored history require explicit confirmation**,
   with a summary of exactly what will be affected.
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
