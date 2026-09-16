## A request that never arrived is not a request that was refused (2026-09-16)

Confirming that production had stopped granting CORS to `localhost`. The probe was a one-liner:
send an `OPTIONS` with an `Origin` header, `grep` the response for the two
`Access-Control-Allow-*` headers, and treat their absence as "refused".

Against production it was right. Against staging it reported that localhost was **refused** —
which would have been the over-tightening bug the whole test suite exists to prevent, and I
came within one command of reporting a broken deploy.

Staging had refused nothing. The agent proxy blocks `*.workers.dev` and
`api-staging.retjghub.com`, so the request never left the container. `grep` on the output of a
failed connection prints nothing, and **nothing is exactly what a successful refusal prints
too.** One empty string, two opposite meanings, no way to tell them apart downstream.

The second bug in the same probe was quieter and more instructive. `sed 's/.*: *//'` is greedy,
so pulling the value out of

    Access-Control-Allow-Origin: https://www.retjghub.com

strips to the last `: ` — the one inside `https://` — and yields `//www.retjghub.com`. The
positive assertion compared that against the full URL and failed, for ten consecutive passes,
while every underlying fact in the same line was correct. **That failure was the system
working**: the check refused to confirm a deploy rather than pass on a value it had misread.

<rules>
1. **Assert that the probe REACHED the thing before interpreting what it said.** A status line,
   a byte count, any positive evidence of contact. Absence-of-X is only meaningful once
   presence-of-response is established, and network failures are absence-shaped.
2. **`grep` as a parser erases the difference between "no match" and "no input".** When the
   two mean opposite things, capture the whole response and branch on it explicitly.
3. **A URL in a header value contains your delimiter.** `.*:` is greedy and `://` is a colon.
   Anchor to the first separator (`^[^:]*: *`) whenever the value may contain one.
4. **Prefer a probe that can tell old from new WITHOUT auth.** Most of this worker's surface
   answers `401 NO_SESSION` to real, new and nonsense actions alike, so no unauthenticated
   request distinguishes a deployed version — which is why earlier deploys could only be
   confirmed from the control plane. A CORS preflight runs before the auth gate and does
   discriminate. When designing a change, notice whether anything about it will be observable
   after shipping.
5. **A verification that fails closed on its own bug is not a nuisance.** Ten RESET lines that
   turned out to be a bad `sed` are cheaper than one confirmation built on a misparse. Read
   them before assuming the deploy is wrong — and before assuming the check is.
</rules>

## The cross-store test passed because the fixture picked the wrong store (2026-09-16)

`verifyApproval` handed a RAW D1 row to `canAccessStore`. `users.stores` arrives from D1 as
the string `'["BL14"]'`, the row carries no `grants`, so `allowedUnits` fell through to
`return user.stores || []` and returned **the string**. Then:

```js
allowed.includes(store)      // String.prototype.includes — a SUBSTRING test
'["BL14"]'.includes('BL1')   // true
```

A manager scoped only to BL14 passed every BL1 store check, including the one guarding the
duplicate-pallet override.

**There was already a test for exactly this.** `test-inventory-receiver.mjs` asserts *"a
manager from another store cannot approve at this one"* — and it passed, for months, while
the fault was live. Its fixture scoped that manager to **BL4**, and `'["BL4"]'.includes('BL1')`
is false. BL1 is the only store code in `ALL_STORES` that is a prefix of another (BL14, BL16),
so BL4 is one of the four stores that cannot expose the bug and BL14/BL16 are the two that can.
The assertion was right, the fixture was a coin flip, and it landed tails.

**The asymmetry was the finding again.** Five call sites reach `canAccessStore`. Three —
`getAuthUser`, `truckReviewRecipients`, the cron recipient builders — parse `stores` first, and
`truckReviewRecipients` even carries a comment naming this exact trap. Two did not. When three
independent authors remember a defensive step and two forget, it is not three good memories and
two lapses: **the helper is the bug**. So the fix normalises inside `allowedUnits` rather than
patching the two callers that happened to be found.

**And the fix broke five suites that the full run caught and the targeted run did not.** I first
wrote the normaliser as a module-scope `unitList()`. `test-authme-scope`, `test-business-gate`,
`test-grant-scoping`, `test-privilege-guards` and `test-cron-recipients` do not import worker.js —
they **extract functions by regex and `new Function` them**, naming each dependency by hand
(*"allowedStores depends on grantFor — extract both, or it throws at call time"*). A new
module-scope helper is not in that hand-written list, so all five threw `ReferenceError` the
moment they called it. Moving the normaliser inside `allowedUnits` fixed all five.

<rules>
1. **A negative test is only as good as the fixture that exercises it.** "A manager from another
   store" is not one case — with prefix-shaped identifiers it is two, and only one of them bites.
   When identifiers can be prefixes of each other, the fixture must use a PREFIX, not just a
   different value.
2. **Assert the positive alongside the negative.** The refusal proves the hole is closed; only
   "the BL14 manager can still approve AT BL14" proves the fix is not just a blanket denial.
   A guard that refuses everyone passes every negative test ever written.
3. **Three sites defending and two not is a HELPER bug.** Fix the primitive, not the instances
   the audit happened to reach — the next caller has not been written yet.
4. **A backstop nothing can reach needs a source pin and an honest label.** `canAccessStore`'s
   `Array.isArray` refusal is unreachable once `allowedUnits` normalises: deleting it leaves the
   suite green. That is a real finding about the test, not a reason to drop the guard — pin the
   text and say in the assertion why it is a source check.
5. **Run the FULL suite before believing a change to a shared primitive.** Every permission
   decision in this app goes through `allowedUnits`. The targeted suite was green while five
   others were throwing at import.
6. **Adding a module-scope helper is not free in this repo.** Five suites hand-encode worker.js's
   dependency graph by regex. Before hoisting anything a permission primitive calls, grep
   `scripts/test-*` for `new Function` and check whether that primitive is extracted.
</rules>

## The test named after the dangerous thing was testing something else (2026-09-16)

Storing associate codes encrypted so an admin can read them back. The single most dangerous
line in the whole change is the IV:

```js
const iv = crypto.getRandomValues(new Uint8Array(12));
```

AES-GCM reuses its keystream when `(key, IV)` repeats, so two codes encrypted under one IV
leak their XOR — and across a six-digit domain that is the entire secret. I knew that, and I
wrote a test for it: create two associates with the SAME code, assert their ciphertexts
differ.

**It passes with the IV hard-coded to twelve zero bytes.** Because the other defence in the
same function is the AAD — the user id — and two associates have different ids, so the tag
differs even when the keystream is identical. The assertion was named for IV uniqueness and
was actually measuring AAD binding. A second test, for AAD binding, measured the same thing.
One property had two tests and the other had none, and the tally read 183 green either way.

What caught the mutation was a `grep` for `getRandomValues` in the source — the weakest check
I had, doing the real work for the most dangerous line in the change.

The fix is one variable: re-set **the same code** on **the same associate** twice. That holds
the AAD constant, so the IV is the only thing left that can vary, and zeroing it goes red.

<rules>
1. **Name the variable you are actually holding constant.** A test for property X must vary
   ONLY X. If a second defence in the same function also changes between your two samples,
   you are measuring that one, and its name on the assertion is a lie.
2. **Two defences in one function need two fixtures that differ in one thing each.** Same
   user + same input isolates the nonce; different users + same input isolates the binding.
   The pair that varies both proves neither.
3. **If a grep is the only thing that catches a mutation, the behavioural test is wrong.**
   Not missing — wrong. It ran, it passed, and it was pointed somewhere else. Treat a
   source-grep catch as a failure report about the test beside it.
4. **Mutate the line you are most afraid of, not the ones that are easy to mutate.** The IV
   was the one line where a silent pass costs everything, and it was the ninth mutation I
   thought to try rather than the first.
</rules>

## 34 assertions passed and it still looked broken (2026-09-15)

The Items-sold receipt. Before Brian ever saw it I had: 4316 unit assertions green, contrast
computed against the composited background in all three themes (worst 5.65:1), and a scripted
behaviour pass — opens folded, aria flips, caveat appears, next row re-folds. All of it passed.
All of it was true. Then he asked for a preview, I rendered an actual picture, and two defects
were obvious in under a second:

1. **"Items sold (9.5)"** — the heading summed raw quantities, and a 1.5 lb bag of beads makes
   a nine-item basket read as nine and a half. A weighed line is ONE item however much it
   weighs; the weight belongs in the row, not in a count of things.
2. **`1.5 ×` wrapped onto two lines** — the qty column was 54px with no `nowrap`, so the `×`
   fell under the `1.5`. Every integer quantity fit, so nothing I had exercised showed it.

Neither is subtle. Both survived because **everything I checked, I checked as a number.**
Contrast is a number. `aria-expanded` is a string. Row counts are numbers. Nothing I ran
rendered a fractional quantity and looked at the result, and the two suites that touch this
code path (`test-transactions.mjs`, `test-payment-archive.mjs`) assert on the JSON the worker
returns — where `qty: 1.5` is simply correct.

**The rule.** Numeric verification is necessary and not sufficient. When a change draws
something, RENDER IT AND LOOK before saying it is done — and render the awkward case, not the
tidy one. A fixture of `1 × Widget` would have proved nothing here; the basket had to hold a
fraction, a merged line, a refunded line and a nameless line at the same time.

**What was actually missing.** This repo had no way to render a surface at all — 71 suites,
none of them opening a browser. So I wrote `scripts/check-receipt-render.mjs`: behaviour plus
contrast against the real composited background, deliberately NOT named `test-*.mjs`, because
`test.sh` globs that and every other suite is pure Node — putting a browser in that glob would
fail the whole suite on any machine without Chromium.

**And a check is guilty until proven to bite.** Three of its first five failures were its own
bugs, not the app's: a wrong expected count, a wrap probe reading cell height (which tracks the
row, not the text), and a caveat measured on a row that has no caveat. After fixing those I
broke `dist/index.html` on purpose twice — a 1.74:1 colour and a wrapping qty cell — and
confirmed each failure was caught before trusting the green.

## `cat >` on a tracked file I had never read (2026-09-15)

CLAUDE.md says to write the plan to `tasks/todo.md`, so I wrote it — with `cat > tasks/todo.md`,
without reading the file first. `todo.md` is not a scratchpad. It is a **newest-first append log**,
21 entries and 2262 lines of why every previous decision was made, and I replaced all of it with
a 43-line plan. `git diff --stat` showed `2278 deletions` and that is the only reason I noticed.

Nothing was lost: it was uncommitted, `git checkout HEAD -- tasks/todo.md` brought it back, and
the new entry went on the front where the convention puts it. But the guard was luck — I happened
to read the stat line before committing.

**The rule.** A redirect (`>`) onto a path that already exists is an overwrite, and an overwrite
of a tracked file needs the same look-before-you-write as a database mutation. Read the head of it
first; if it has content, append or prepend rather than replace. `>>` and a prepend are cheap; the
history is not reconstructible from anywhere else.

**Why the instinct failed.** "Write the plan to todo.md" reads like an instruction to create a
file. It is an instruction to add an entry to one. The same shape appears in `tasks/lessons.md`,
`DESIGN.md` and `MEMORY.md` — every long-lived document in this repo is a log, and none of them
should ever be the target of a `>`.

## A find-and-replace would have broken dark mode (2026-09-15)

Fixing inkDimmer-as-text. `.eb-chev` and `.eb-sec-chev` write `color:#9c9484` and have **no
`.dark` rule at all** — so they paint the light-theme grey in *both* themes, where on a dark
ground it happens to read fine (~7:1). The mechanical fix, swapping `#9c9484` → `#6b6453`
everywhere, would have fixed light (3.01 → 5.88) and taken dark from fine to **1.9:1**.

They did not need a swap. They needed a dark counterpart they never had.

The tell was in the audit, not the code: I listed every `#9c9484` site and every
`rgb(var(--op-inkDimmer))` site, and these two appeared in the first list with no partner in
the second. Every other site came as a light/dark pair.

**The second half of the same audit.** Grepping the class name found 162 utility sites. The
same colour was ALSO hand-written in `<style>` blocks 13 more times, where no class-name
search reaches it — and among those, two were `barColor` **fills**, not text, and one was the
`.mc-lvl` level badge that DESIGN.md prescribes inkDimmer for on purpose. So the population
was: 162 + 13 candidates, of which 3 had to be left alone for three different reasons.

The check that settled it was not a grep at all — it was a sweep for any element whose
**computed colour** is an inkDimmer value and which paints text. That finds hand-written
sites, variable-driven sites and utility sites alike, and it reported 0 in all three themes.

<rules>
1. **A colour written without a dark partner is not the same bug as one written with two.**
   Before swapping a value, check whether the site has a counterpart in the other theme. If
   it does not, the single value is doing double duty and swapping it breaks one side.
2. **An asymmetry in the audit lists IS the finding.** Two entries in the light list with no
   match in the dark list was the whole answer, sitting in output I had already printed.
3. **Grep the class, then sweep the computed value.** The class name finds the utilities; only
   the computed colour finds what someone hand-wrote — and only rendering tells you which of
   those are text and which are fills.
4. **Not every use of the wrong-looking token is wrong.** The level badge and the pace bars
   keep inkDimmer, for reasons the design doc states. Fixing them would have been the same
   carelessness as missing the others.
</rules>

## I swept the surface, not the diff — and found three more defects than I reported (2026-09-15)

**Context:** I had flagged one contrast bug on Item Sales — `text-accent-green` at 2.18:1 on
the light bar — discovered while building Transactions, because I had *copied* the class from
Item Sales. Brian said "fix the item sales contrast issue". Singular.

It was not singular. Rendering Item Sales with real data and sweeping **every** text element
against its real composited background found **four** failures, of which mine was one:

| element | light | dark |
|---|---|---|
| `text-accent-green` — Live / Refresh / Grand Total | 2.18 | pass |
| `text-op-warn` — the `−$20.00 disc` pill | 1.99 | pass |
| `text-op-bad` — the `−$40.00 ref` pill | 3.30 | **4.34** |
| `text-*-inkDimmer` — the `›` disclosure chevron | 3.01 | 2.99 |

I would have reported one and shipped a surface still carrying three, because the one I knew
about was the one I had personally touched. **The bug I introduce is the bug I look for.**

`text-op-bad` is the interesting one: it fails in BOTH themes, because a saturated red on a
red wash is low-contrast whichever way the ground goes. No amount of theme-swapping finds
that — only measuring against the *composited* background does.

**Scope, and where I drew the line.** Three of the four are app-wide, not Item Sales': 164
`text-accent-green`, 96 `text-op-bad`, 32 `text-op-warn`. I fixed those with four CSS rules
overriding the TEXT utilities per theme on specificity — the technique the pure-black block
already uses — rather than editing 292 markup sites. One rule cannot typo, cannot miss a site
added tomorrow, and leaves `bg-`/`border-`/`ring-` untouched, which matters: there the accent
IS the surface and is doing its job.

The fourth I deliberately did NOT globalise. `text-*-inkDimmer` runs to 74/89 sites and
darkening all of them is a visible design change, not a correctness fix — so the chevron was
fixed where it was found and the rest was reported as a decision, not absorbed.

<rules>
1. **Sweep the SURFACE, not the diff.** A check built from what you changed can only confirm
   what you changed. Render the real thing with real data and measure everything on it.
2. **A single reported defect is a sample, not a census.** When someone asks you to fix "the"
   issue, find out whether it is one.
3. **Measure against the composited background, not the token.** `#ef4444` looks fine until
   it sits on `bg-op-bad/10` — its own tint is what makes it fail.
4. **One rule beats N edits when the defect is in a utility, not in the markup.** But only
   after proving no site depends on the old value: I checked every class list pairing these
   with a dark fill before touching anything.
5. **Correctness fixes globalise; aesthetic ones ask.** Retinting an unreadable red is the
   first. Darkening every dim label in the app is the second.
</rules>

## A deploy CAN be verified against the served bytes — `/content` is 405, `/content/v2` is 200 (2026-09-15)

**Context:** deploying the worker for the Transactions endpoint. The working belief going in
was that this API token cannot read the deployed script, so a deploy is verified by *version
identity* — wrangler's printed Version ID matching the active version at 100% — and not by
grepping what is actually being served.

That belief is half right. `GET /accounts/{acc}/workers/scripts/{name}/content` does answer
**405**. But the versioned endpoint does not:

    workers/scripts/clover-sales-api/content      -> HTTP 405,     134 bytes
    workers/scripts/clover-sales-api/content/v2   -> HTTP 200, 907,780 bytes

`content/v2` returns the real bundle, and greps against it turn "the right version is active"
into "the running code contains this symbol". Both were confirmed here, plus the 20 secrets
and 11 other bindings that survived the upload — a dropped `BL*_API_TOKEN` would break every
Clover fetch and is invisible to a version check.

Note `.../versions/{id}?include_modules=true` is NOT the way in: it returns ~4 KB of metadata
(etag, handlers, bindings) and no module content. Grepping *that* for my own symbols printed
six confident MISSING lines — about a metadata blob, not about the deploy.

**And the grep that mattered most failed on its spelling.** `["transactions","bl"]` returned
nothing; the bundle writes `["transactions", "bl"]`, with a space. That entry is the single
thing that makes the endpoint reachable at all — without it the fail-closed business gate
403s every session call — so an empty grep there looked exactly like a broken deploy.

<rules>
1. **One 405 does not close the question.** Try the versioned sibling (`content/v2`) before
   concluding a capability is unavailable to this token.
2. **Check the size of what came back before grepping it.** 4 KB cannot be an 886 KB worker.
   A MISSING against the wrong payload is a fact about the probe.
3. **Verify bindings, not just code.** A deploy that silently dropped a secret passes every
   version-identity check and fails on the first Clover call.
4. Same family as "a colour has more than one spelling": before believing an empty grep,
   print how the thing is actually written in the file you are searching.
## `cat > file` on a tracked file I had never read (2026-09-15)

**Context:** CLAUDE.md says to write the plan to `tasks/todo.md`. I did, with a heredoc:
`cat > tasks/todo.md <<'EOF'`. `tasks/todo.md` already existed and held **1855 lines** — this
project's accumulated, reverse-chronological work log, carrying the dated entry and lessons
of every task before this one. The heredoc replaced all of it with a 38-line plan.

**Root cause:** I read "write plan to `tasks/todo.md`" as *create* and never checked whether
the file had contents. The instruction names an output path; I treated that as a statement
that the path was mine to fill.

**What caught it, and what did not.** Not me reading my own work. I ran `git status --short`,
saw ` M tasks/todo.md`, and read that as confirmation the change was small — it says a file
changed, not that 1855 lines left it. I then committed, pushed, and opened a PR, three more
chances to look at a diff I never looked at. It surfaced only when
`mcp__github__pull_request_read` came back with `"additions":38,"deletions":1855` while I was
checking something else entirely.

**Restoration was clean** — the content was one `git show f277bd5:tasks/todo.md` away, and
the fix was to prepend the new entry instead, taking the diff to 52 insertions and 0
deletions. That is luck about *this* file being committed, not a reason to relax the rule.

<rules>
1. **Read a file before overwriting it, even when an instruction names it as the output.**
   "Write the plan to X" does not mean X is empty. One `wc -l` costs nothing.
2. **`cat > file` is a delete.** For anything tracked in git, prefer `>>`, or read-then-
   rewrite. Reserve truncating redirects for files created in this session.
3. **Read the diffstat, not the status line.** Run `git diff --stat` before every commit, and
   treat any deletion count you cannot account for line-by-line as a bug until proven
   otherwise.
4. **An accumulating log is the repo's memory.** `tasks/todo.md` and `tasks/lessons.md` exist
   so a future session inherits what this one learned. Destroying one costs more than the
   task that destroyed it was worth.
</rules>

## A colour has more than one spelling, and I only searched for one (2026-09-10)

**Context:** Pure black shipped. Brian opened it on his phone and the bottom nav bar was
still navy on a black page — the exact "navy patch on a black screen" I had warned about in
the PR, in the most-looked-at chrome on mobile.

**Root cause:** `.dark .bn-float` sets `background: rgba(16,24,38,.64)`. That is
`op-panel #101826` written in decimal. I had swept the file for the five token hexes and
re-pointed 160 of them to `rgb(var(--op-*))`, and my closing check was a grep for those same
hexes returning clean. It did return clean. `rgba(16,24,38,.64)` was never in the search
space, so "no hits" meant "no hits for the spelling I chose", not "no copies left".

Searching decimal afterwards found **six** more sites, not one: the bottom bar, both mobile
hint pills, the sparkline dot halo, and three OFFLINE pill borders — and one of those four
pill borders I had already converted by hand, so the file was left inconsistent in a way that
should itself have been a clue.

**Why the tests did not catch it.** 54 browser assertions passed. Every one of them measured
a surface I had *changed*; none swept for surfaces that should have changed and did not. A
suite built from the diff can only confirm the diff.

<rules>
1. **Auditing a value means searching every spelling of it.** A CSS colour has at least
   three: `#101826`, `rgb(16 24 38)`, `rgba(16,24,38,.64)`. Enumerate the token's decimal
   channels and grep those too, before declaring a sweep complete.
2. **A clean grep only proves the pattern is absent.** State the pattern to yourself and ask
   what it cannot match. "No hits" is evidence about the query, not about the file.
3. **Inconsistency in your own edits is a signal.** I converted one of four identical
   `rgba(136,147,167,0.35)` borders by hand and left three. That asymmetry meant my
   mechanical pass had a blind spot; I read it as a tidy-up I had not got to.
4. **For a theme change, assert on what should NOT be left behind.** The useful test is not
   "the surfaces I edited are black" but "no element still computes to the old theme's
   panel colour". Sweep the rendered page for the outgoing value.
</rules>

## `getComputedStyle` during a `transition` returns the colour you just left (2026-09-10)

**Context:** Verifying the pure-black theme. 54 browser assertions, six failing — `body` and
every app bar reported the LIGHT background in dark and oled mode, while the settings cards
next to them reported correctly. I spent six probes hunting a cascade bug that did not exist:
specificity was right (`html.oled .dark\:…` is (0,2,1) vs Tailwind's (0,2,0)), the variable
resolved (`--op-bg` = `10 15 26` on body), CDP listed the dark rule last as the winner, and
replaying the rule's own `cssText` on a fresh div produced the correct colour.

**Root cause:** `<body class="… transition-colors">`. Tailwind's `transition-colors` is a
150 ms transition on `background-color`. `getComputedStyle` returns the **interpolated**
value, so reading it synchronously after a class change reads t=0 — the pre-change colour.
The settings cards have no transition class, which is exactly why they looked fine and made
the failure look selective and cascade-shaped.

**The disproof I should have run first:** set a plain, unmistakable value inline and read it
back. `body.style.cssText = 'background-color: rgb(255 0 0)'` returned `rgb(244, 243, 238)`.
An inline literal cannot lose a cascade fight, so at that instant the problem was provably
the *measurement*, not the CSS. That one line was available from the first failure and would
have replaced every probe after it.

<rules>
1. **Before measuring a colour you just changed, settle the transition** — wait past the
   duration, or disable transitions for the measurement. Prefer waiting: it tests the real
   thing. A synchronous read after a class toggle is measuring the old frame.
2. **When a probe disagrees with the spec, suspect the probe.** Specificity, variable
   resolution and CDP's own cascade all said the rule won. Three independent sources agreeing
   against one measurement means the measurement is wrong.
3. **Falsify with a value that cannot be produced any other way.** Pure red, inline. If the
   read-back is not red, stop reasoning about CSS and go fix the harness.
4. **A failure that skips some elements is a clue about those elements, not about the rule.**
   "Cards fine, body and app bars wrong" was the whole answer — `transition-colors` is on the
   second set and not the first. I read it as "tokens broken, literals fine" because that
   split also fit, and never checked which split was real.
</rules>

## A surviving mutation is not automatically a hole in the tests (2026-09-10)

Mutation-testing the MOS suite, eight of ten mutations were caught and two survived. The
reflex is to write assertions until they die. Both would have been wrong to chase.

**Survivor 1 — "read the colliding IM# cost map".** I mutated `mosCostCents` to try
`costs.items[description]` before `costs.categories[description]`. It survived because
`items` is keyed by IM# and `description` is a category NAME, so the added lookup could
never hit. My mutation was a no-op, not an undetected bug. The real protection is that
the function is only ever handed a name — the SIGNATURE is the guard. Mutating the call
site to pass `parsed.itemNo` instead did fail, six assertions.

**Survivor 2 — "let a sweep overwrite a name a person typed".** I removed
`WHERE sticker_codes.source <> 'user'` and nothing broke. Investigating: the only caller
that passes `'clover'` runs after establishing there is no row at all, so the clause
could never fire. **It was dead code.** Worse than dead — it was a claim in the source
that the rule was enforced there, when the rule actually lives in an early return three
functions away. I deleted it and mutated the early return instead: five assertions.

Rules:

1. **Before writing an assertion to kill a survivor, prove the mutation is a real bug.**
   Read the mutated code in context and ask what input would now behave differently. If
   there is none, the mutation was semantically equivalent and the suite is fine.
2. **A survivor sometimes indicts the CODE, not the test.** An unreachable guard passes
   mutation testing by definition. That is a reason to delete it, not to test it.
3. **Then mutate the thing that actually carries the rule.** Both of these had a real
   guard elsewhere, and both of those guards were caught immediately once aimed at.
4. Same family as "grepping a name is not testing a behaviour": the question is always
   what would have to change for the behaviour to be wrong, not what text is present.

## Playwright matches routes LAST-REGISTERED-FIRST (2026-09-10)

The browser probe for MOS reported 41 of 52 assertions failing — every nav item hidden,
every page unrouted, `currentPage` reading "dashboard" for an associate who should have
landed elsewhere. It looked exactly like the boot race, and none of it was real.

```js
await page.route('**/api.retjghub.com/**', stub);   // registered first
await page.route('**/*', (r) => r.continue());      // registered second — WINS
```

Playwright evaluates handlers in reverse registration order, so the catch-all shadowed
the stub and every request went to the real network, which the egress proxy blocks. The
app then failed auth and sat on its default section.

1. **Do not register a catch-all `continue()` route.** Unrouted requests continue on
   their own; the handler only exists to shadow the ones above it.
2. Two probe bugs in the same file, both previously recorded here in other forms:
   `offsetParent` is null inside a positioned ancestor (so the whole sidebar read as
   hidden), and `currentUser` / `currentPage` are module-scoped inside the app's IIFE —
   index.html even carries a comment saying `window.currentPage` is always undefined.
   Read the DOM: which `[id^="page-"]` lacks `hidden`.
3. **When a probe reports EVERYTHING broken, suspect the probe.** A real regression is
   usually narrow. A one-page debug script printing what the page actually did — which
   API calls fired, what class the element carries — found all three in one run.

## `cmp` on a Cloudflare worker bundle compares the envelope, not the code (2026-09-09)

Verifying the staging deploy, I fetched the deployed script twice and ran `cmp`. It said
the two differed — which reads exactly like "you are mid-rollout, the old code is still
being served", the thing rule 5 exists to catch. Both fetches had the **same byte count**
and the **same grep counts for every string I cared about**, which should have been the
tell.

`GET /accounts/{id}/workers/scripts/{name}` returns `multipart/form-data`, and the
**boundary is regenerated per request**. `cmp -l | wc -l` said 116 differing bytes: two
boundary strings of ~58 characters. The script was byte-identical.

Rules:

1. **Hash the body, not the response.** `grep -v '^--[0-9a-f]\{40,\}' | sha256sum` strips
   the boundary lines; that hash was stable across three passes and matched staging's.
2. **When a probe reports a difference, ask what part of the response is allowed to
   differ** before believing it. Boundaries, timestamps, request ids and ETags all move on
   their own.
3. Two contradicting signals — "identical size and content greps" versus "cmp says no" —
   mean one of the probes is wrong, not that reality is ambiguous. Resolve it before
   reporting either.
4. Same family as the fixed-width context grep and the `offsetParent` mistakes: the probe
   answered a question next to the one asked.

## A surviving mutation meant TWO copies of one rule, not a weak test (2026-09-09)

Mutation-testing the new page gate: I broke `canUsePage` so any page grant admitted any
level — a view-only associate could log pallets — and the suite stayed green. The
instinct is "the test is weak, add an assertion". It was the wrong instinct.

The suite was fine. The **financial gate had its own copy of the comparison**:

```js
// gate, worker.js:~13906
const pageOk = !!pageReq && pageLevel(currentUser, pageReq[0]) >= PAGE_LEVELS[pageReq[1]];
// handler, worker.js:~12335
function canUsePage(user, isAdminSecret, page, level) { ... pageLevel(user, page) >= ... }
```

Breaking one left the other holding, so nothing observable changed. Adding assertions
would have papered over the real finding.

Rules:

1. **When a mutation survives, first ask what else is enforcing the rule.** A second
   enforcement point is the likeliest answer, and it is a defect in its own right, not
   depth. The copy that drifts is always the one that says yes.
2. **Fix it by deleting the copy, not by strengthening the test.** The gate now calls the
   same `canUsePage` the handlers do; the mutation then failed three assertions.
3. This is [[one-right-two-jobs]] seen from the other side: that lesson was one right
   doing two jobs, this is one right written down twice. Same cure — one function.
4. A mutation that makes a suite **crash** still counts as caught (non-zero exit), but read
   the error: it should be a cascade from a real assertion failing, not the harness
   tripping over its own fixture.

## The documented cause was wrong, and my first fix inherited the error (2026-09-08)

**What happened:** Brian's `git fetch` died with `fatal: mmap failed: Operation canceled`.
ORIENT.md already had an entry for this, blaming the 985 KB `index.html`, so I read
"mmap" + "big files" as a memory ceiling and prescribed
`core.packedGitWindowSize=32m core.packedGitLimit=128m pack.threads=1`. It failed
identically — same message, same point in index-pack, on a *smaller* pack than the first
attempt (288 objects vs 322).

**Root cause:** iCloud Drive. The repo lived in `~/Desktop/labor-dashboard`, which is
inside Desktop & Documents sync. git writes a pack into `.git/objects/pack/` and then
`mmap`s it to index it; iCloud hands back a placeholder rather than bytes, and that
surfaces as `ECANCELED` — "Operation canceled", which is not what a memory ceiling says.
A plain `git clone` into `~/dev` resolved 3910 objects and 2552 deltas first try.

**The tell I walked past:** the errno. Out of memory is `ENOMEM`; address-space
exhaustion is `ENOMEM` too. `ECANCELED` from `mmap` means something took the mapping
away, which is a *storage* fact, not a memory one. I pattern-matched on the word "mmap"
and on a note in our own docs instead of reading what the error actually said.

<rules>
1. **When a fix derived from the documented cause fails, suspect the documented cause.**
   Not the size of the fix. I turned the same knob harder on a smaller input and expected
   a different result; the second failure was the evidence that the model was wrong, and
   I should have re-diagnosed there rather than at the third attempt.
2. **Read the errno, not the syscall.** `mmap failed` names where it broke.
   `Operation canceled` names why, and it excluded the entire theory I was working from.
3. **A note in our own docs is a hypothesis with a good reputation, not a finding.** The
   ORIENT.md entry was written from a symptom that reproduced under a big checkout, and
   the file size was correlated, not causal. It has now been corrected in place — an entry
   that names the wrong cause is worse than none, because it aims the next person at the
   same dead end and lends it authority.
4. **Ask where the repo lives before debugging git on macOS.** `~/Desktop` and
   `~/Documents` are iCloud-synced by default. One `pwd` would have settled this before
   any of the tuning.
</rules>

## A backgrounded `git merge` finished AFTER I changed branches, and silently overwrote the tree (2026-08-21)

**Context:** `git merge main` into `staging` kept timing out (this repo's `index.html` is
1.3 MB and `worker.js` 836 KB, and the merge spans 25+36 commits). I relaunched it as a
background job so a timeout could not kill it, then — believing it dead because HEAD had
not moved and no `MERGE_HEAD` existed — switched to `main` and carried on working.

The job was still alive. It completed minutes later and wrote **staging's** content into a
working tree that was checked out to **main**. Every git command still reported
`branch: main`, `HEAD: 86b44e0`, clean-ish status. Only `grep -c merch-velocity worker.js`
returning `0` — for code I had verified as present twenty minutes earlier — exposed it.

**Root cause:** a background git process holds no lock across its whole run and does not
re-check the branch before writing. Branch state is read at start and applied at the end.
Anything that moves HEAD in between produces a tree belonging to neither branch, with no
marker anywhere saying so.

**What made it recoverable:** the work was already committed and pushed. `origin/main`
still had `86b44e0`, so `git restore --source=HEAD --staged --worktree .` rebuilt the tree
exactly. Had the work been uncommitted it would simply have been gone.

**Rules:**
1. **Never background a git command that writes the working tree or index** (`merge`,
   `rebase`, `checkout`, `stash`, `pull`). Background reads (`log`, `fetch`, `fsck`) only.
   If a merge is too slow to run in the foreground, that is a signal to make it smaller,
   not to detach it.
2. **Absence of `MERGE_HEAD` does not mean the merge is dead.** Check for a live process
   (`pgrep -fl "git merge"`) before concluding anything, and before touching the branch.
3. **After any interrupted git operation, verify by CONTENT, not by branch name.** Grep the
   working tree for a symbol unique to the branch you expect. `git status` said "main" for
   twenty minutes while the tree was staging's.
4. **Commit and push before starting a long merge.** It converts "lost work" into "one
   restore command".

**Also seen in the same session, and worth knowing:**
- An interrupted merge leaves debris in *two* forms: modified tracked files AND newly
  created untracked ones. `git restore` fixes the first; the second silently blocks the
  next `git checkout` with "untracked working tree files would be overwritten". Move those
  aside rather than deleting — they may be a branch's real content.
- `git merge` failed once with a bare `fatal: stash failed` and succeeded on a plain retry.
  Do not build a theory on a single transient git failure; retry once first.
- `timeout` does not exist on macOS. `gtimeout` (coreutils) or a `perl -e 'select'` loop.

# Lessons

## Deploying main's worker to a named env SILENTLY REVERTS whatever only lives on that env's branch (2026-08-19)

**Context:** Asked to "update staging". I ran `npx wrangler deploy --env staging` from a
`main` checkout as step one. That deployed **main's** `worker.js` to the staging worker —
and `boost-post`, the Meta Boost endpoint, exists ONLY on the `staging` branch. I took the
feature off staging without noticing, and only caught it a minute later while inspecting
the branch diff for an unrelated reason.

**Root cause:** `--env staging` selects the staging *bindings*, not the staging *code*. The
code is whatever is in the working tree. `wrangler deploy --env X` from the wrong branch is
a silent revert of everything unique to X, and nothing in the output hints at it — the
bindings all print correctly, which reads like success.

**Rules:**
1. **Check out the environment's branch BEFORE deploying to that environment.** For a named
   env with its own branch, `git checkout <branch>` is part of the deploy, not a preamble.
2. **Before deploying to any env, diff the two sides for endpoints that exist on only one:**
   `git diff origin/main origin/<branch> -- worker.js | grep -E '^[-+].*action.*==='`. If
   that is non-empty, deploying either side over the other loses something.
3. **Sync the branch first, deploy second.** The correct order was: merge main into staging,
   resolve, test, THEN deploy the merged result once. I deployed twice and the first one
   was a regression.

**And the merge itself hid a second bug that only the test suite caught.** Three conflicts
resolved by hand, but a FOURTH hunk auto-merged wrongly: it replaced main's upload-vocabulary
check (`["retail","bins","event","team","other"]`) with staging's `MARKETING_POST_TYPES`
(`["bin_preview","weekly_promo",...]`). Two different taxonomies with no overlapping member
for "bins", so every bin-photo upload silently became `"other"` and no draft was ever
created. Git reported no conflict because the two branches had edited *different* lines.

4. **A clean `git merge` on these giant files is not evidence of a correct merge.** Run the
   full suite after every merge, and pay attention to which side a test came from — the one
   that went red (`test-bin-photo-autodraft`) exists only on main, so it had never run
   against staging's code before. A green auto-merge plus a red main-only test is the exact
   signature of a silently-dropped main behaviour.
5. **Where two constants share a purpose but not a vocabulary, say so at BOTH sites.** The
   restored line now carries a comment naming the other taxonomy and why they must not be
   swapped, because the next merge will present the same choice.


## Never let a colour be INHERITED, and never sign off a UI change in one theme (2026-08-19)

**Context:** Brian opened the just-shipped Buy Criteria page in dark mode on production and
the table was unreadable — "Chain default" and every column header were dark grey on
near-black. I had verified the page only in light mode and called it done.

**Root cause — two mistakes, one habit.**

1. **I set no `color` at all** on `#mc-tbl`, its `th`, `td` or `.mc-cat`. They inherited,
   and what they inherited was correct in light and invisible in dark (measured ~1.07:1
   against `op-bg`). An unset colour is not neutral — it is a value you did not choose and
   therefore did not check.
2. **The one colour I did set was a number I made up.** `#9aa0a6` for inherited cells,
   picked by eye against a white background. The repo has a whole palette for this in
   `tailwind.config.js` — `op.*` for dark, `opl.*` for light, in ink / inkDim / inkDimmer
   pairs — and I used none of it.

**Rules:**
1. **Every colour gets both themes, explicitly.** In a `<style>` block that means a rule
   and a `.dark` rule, side by side. Writing one without the other is the bug.
2. **Use the palette, never a hand-picked hex.** Light `opl.ink #14110a` / `inkDim #6b6453`
   / `inkDimmer #9c9484`; dark `op.ink #e7ecf3` / `inkDim #8893a7` / `inkDimmer #5a6478`.
   A `<style>` block cannot use the Tailwind class names, so duplicate the token VALUE and
   say in a comment that it is a token — do not invent a nearby grey.
3. **Verify in BOTH themes before saying done.** `document.documentElement.classList
   .toggle('dark')` and re-measure. Do not eyeball it: compute the contrast ratio against
   the real background (`op-bg #0a0f1a` / `opl-bg #f4f3ee`) and require ≥ 4.5:1. Doing this
   caught a second problem the screenshot did not show — `inkDimmer` measures 2.71:1 in
   light, so the "inherited" cells needed `inkDim` instead.
4. **The local server serves a STALE `tailwind.css`** whose `dark:` variants are missing
   entirely (it also lacks `max-w-2xl`). `build.sh` regenerates into `dist/` at deploy
   time, so production is right and local dev is wrong. A dark-mode check against the
   local stylesheet proves nothing — pull the shipped CSS, or measure inline-`<style>`
   colours against the known token background.

**Same-pattern watch:** any generated markup with a `font-semibold`/`text-sm` class list
and no `text-*` colour is this bug waiting to happen. Shelf Count's row label had it too
(`<div class="font-semibold text-sm truncate">`) and was fixed in the same pass.


## Measure scroll geometry on the ACTUAL scroller — `#app` is `min-h-screen`, so the DOCUMENT scrolls (2026-08-19)

**Context:** Verifying the new Shelf Count page on a 375px viewport. I set
`#main-scroll.scrollTop = scrollHeight`, measured the Save button against
`#bottom-nav`, saw it fully behind the nav, and told the user "real bug — Save is
unreachable on a phone." It was not a bug.

**Root cause:** `#app` is `min-h-screen flex` (index.html:658), not `h-screen`. A tall
page therefore grows `#app` past the viewport and the **document** scrolls; `#main-scroll`
(`flex-1 overflow-y-auto`) has `clientHeight === scrollHeight` and nothing to scroll. My
`scrollTop` assignment was a no-op, so I measured the un-scrolled position and read it as
"cannot reach". Scrolling `window` instead put Save at 612–660 against a nav top of 732 —
72px of clearance, exactly what `#main-scroll { padding-bottom: calc(7rem + env(...)) }`
(index.html:529) is there to provide.

**Rules:**
1. Before asserting an element is unreachable, prove the scroller actually moved:
   assert `scrollTop > 0`, or that `scrollHeight > clientHeight` on the box you scrolled.
   `atBottom === true` is meaningless on a box with nothing to scroll.
2. `min-h-screen` ≠ `h-screen`. With `min-h-screen`, an inner `overflow-y-auto` child is
   inert and the document is the scroller. Check which one moves before measuring.
3. **Differential check first.** The cheap disproof was to run the same measurement on an
   existing page with a bottom button (Supply Request's Submit). If the established
   pattern "fails" too, the harness is wrong, not the new code. I reached for a fix before
   reaching for that comparison.
4. The synthetic admin-page harness (hide `#login-page`, force `#app` to `display:flex`)
   reproduces DOM and behaviour faithfully but NOT layout — forcing `display` leaves `#app`
   unconstrained. Trust it for wiring and role gating; distrust it for geometry.

**Related:** `currentUser` is a top-level `let` (index.html:18168), so the harness must set
it with a BARE assignment — `window.currentUser = …` does not reach the binding and every
role guard silently returns early.


## Cross-store SUMs over daily_sales MUST filter `store IN (ALL_STORES)` — BL12 duplicates Indy's budget (2026-07-17)

**Context:** User: "we are adding Indy budget amount twice in the month to date amount."
Correct. `buildWeeklyByDayData`'s per-day + MTD aggregates did
`SELECT SUM(budget) ... FROM daily_sales WHERE date ...` with **no store filter**.

**Root cause:** `daily_sales` still holds rows for the **retired BL12 (Wyoming)** carrying an
exact duplicate of **BL16 (Indy East)**'s budget with **zero sales** (Jul 1–16: BL12 budget
$64,985 / total $0; BL16 budget $64,985 / total $76,395). So unfiltered `SUM(budget)` =
$578,331 vs correct $513,346 — Indy's budget counted twice. **Sales looked fine** (BL12 total
is 0/null), which is exactly why only the budget was wrong and it was easy to miss.

**Why Table 1 was immune:** `buildDailySummaryData` iterates `for (const store of ALL_STORES)`,
so BL12 is skipped. Only *cross-store aggregates* (which never see a store column) are exposed.
Note `getWrsRange` (worker.js ~55) already handled this with an explicit BL12/BL16 `WRS_CUTOVER`
split — the codebase knew about this trap; my new code didn't.

**Rules:**
1. Any aggregate over `daily_sales` that spans stores MUST include `AND store IN (${ALL_STORES…})`.
   Never assume the table contains only live stores — retired BL12 rows persist.
2. **Verification rule (the real miss):** when two tables in one artifact show the same metric,
   assert they're EQUAL. I had `$29,932` (Table 1 budget) and `$33,738` (Breakdown budget) in my
   own verified output and only cross-checked the *sales* figure, not the *budget*. Cross-check
   EVERY shared number, not the one that happens to match.


## Never deploy the worker with a wrangler.toml copied from the main-repo working dir (2026-07-15)

**Context:** Shipping the daily-email tables from a partial git worktree (created with
`--no-checkout` because a full checkout hit `mmap failed` on the big files). The worktree
had no `wrangler.toml`, so I `cp`'d it from `/Users/brianhoward/Desktop/labor-dashboard/`
— but that working copy is a **stale 90-line version** on the `flow-calendar-editor`
branch. Deploying it silently **regressed prod config**: dropped the `MEDIA` R2 binding,
dropped `BL16` (Indy East) Clover creds, and changed the daily-summary cron `0 12`→`0 10`.

**Root cause:** `wrangler.toml` IS git-tracked at origin/main (119 lines, correct), but
the branch working copy had drifted. I trusted the on-disk file over the tracked one.

**Rule:** When deploying the worker from a worktree missing `wrangler.toml`, restore it
from git: `git show origin/main:wrangler.toml > wrangler.toml`. **Never** copy the
main-repo working file. After EVERY `wrangler deploy`, read back the printed bindings
(MEDIA, BL16_*) and the 6 crons before trusting it. Also: push the deployed worker.js to
`main` so main == prod and a later main-based deploy can't revert it. Fixed by redeploy
with the tracked config (version a4922cdd).


## Don't call a CSS transition class "inert" without checking classList toggles (2026-07-07)

**Context:** Diagnosing the mobile bottom nav (`#bottom-nav`) floating mid-content on
iOS. I told the user its `transition-transform duration-300` class was "inert — no JS
drives it," after grepping only for `#bottom-nav.style.transform`. That was **wrong**:
`onScroll()` (index.html ~14683) toggles `translate-y-full` on it (hide on scroll-down,
reveal on scroll-up). The transform IS driven — via a **class toggle**, not inline style —
and that self-transform of a `position:fixed` element is a compositor-layer trigger that
aggravates the iOS bug.

**Lesson:** To decide whether a `transition-*` / animation class is live, grep for BOTH
`classList.(add|remove|toggle)('<the-class>')` AND `.style.<prop>` on that element — a
Tailwind `transition-transform` is usually driven by a utility-class toggle
(`translate-y-full`, `translate-x-0`, `opacity-0`, …), not by `.style.transform`.

**Root cause fixed:** `#bottom-nav` was `position:fixed` but nested inside `#main-scroll`
(an `overflow-y:auto` subscroller). iOS/WebKit intermittently mis-composites a fixed
element inside a non-root scroller during momentum/rubber-band scroll → it strands
mid-content. Fix = hoisted the nav out to be a direct child of `#app` (sibling of
`#main-scroll`), so its containing block is the viewport. Verified via DOM parse
(ancestors = `['app']`) and by confirming `#app`/`body` carry no
transform/filter/will-change/contain.

**Same-pattern watch:** `#more-scrim`, `#more-sheet`, `#swipe-rail`, `#swipe-label`,
`#ptr-hint` are STILL fixed-inside-`#main-scroll`. Lower risk (transient and/or shown only
while scroll is locked), but if any must pin to the viewport during scroll, hoist it too.
Verification note (reaffirmed): the dashboard needs the remote worker + auth, so a static
desktop preview can't drive it — and the iOS compositor glitch can't be reproduced on
desktop; on-device confirmation is the final step.

## Auditing period-LABELS after a selector/picker refactor (2026-07-03)

**Bug:** After the week/day-chip picker was replaced by the date-range picker
(commit `7078013`, default preset "Today"), the "Weekly" All-Stores Budget card
showed *today's* total, not the week's. Root cause: the refactor retargeted the
card's actual/budget sum from `r.week === selectedWeek` to `rowInSel(r)` (the
selected range), but left the label hardcoded "Weekly" and left the sibling
Monthly block anchored to the calendar month. With preset "Today" the range
collapses to one day → "Weekly" == today.

**Lesson — when refactoring a global selector, audit EVERY consumer that renders a
fixed period label.** A value summed over the *new* range under an *old* fixed
label ("Weekly", "Monthly", "This Week", "MTD") is a silent mislabel. The
refactor changes the data source but not the label string, so it looks fine in
code review and only shows wrong at runtime.

**How to catch it fast:**
- Grep the fixed period words (`Weekly`, `Monthly`, `This Week`, `WTD`, `MTD`) and
  check each one's *value* is computed on a matching period, not `rowInSel`/
  `dateRange`.
- **Cross-check siblings.** The Monthly block was correct (anchored to the month
  of the range end); the Weekly block wasn't. A half-migrated pair is the tell.
- Prefer the already-correct pattern in the file: `isCurrentWeek ? 'This Week' :
  \`Week ${selectedWeek}\`` (used at ~line 5835/8223) — don't hardcode the label.

**Same-class instances found & fixed in the same pass:** the shared
`_buildChartCardHTML` "This Week" stat tile (store-detail + all-stores chart
cards) mislabeled a *past* selected week as "This Week"; now threaded a `twLabel`
param from `isCurrentWeek`.

**Verification pattern that worked:** modeled OLD (`rowInSel`) vs NEW
(`r.week === selectedWeek`) over synthetic multi-day week data in a standalone
node script and asserted OLD==today / NEW==full-week / today-counted-once. A
static preview was useless here (dashboard needs the remote worker + auth), so a
data-model reproduction was the right proof.

## Boot race: role-gated UI decided before auth resolved (2026-07-21)
**Bug (user-reported):** admins sometimes opened the app to a 4-icon bottom nav
WITH the Submit (upload) button — manager layout flashed/stuck for admins.
**Root cause:** `syncBottomNav` inferred the role by mirroring sidebar
visibility (`vis('nav-inventory')`). Before `checkAuth()`/`applyRoleUI`
resolve, EVERY role-gated sidebar item is hidden, which is indistinguishable
from "non-admin" — so any pre-auth `navigateToPage` produced the manager bar.
Nothing re-synced after `applyRoleUI`, so the wrong bar could persist until
the next navigation, making it timing-dependent ("sometimes").
**Fix pattern (generalize):** mirror-based gating inherits the mirror's BOOT
state. Any UI keyed off another element's visibility must (1) hold a
conservative default until an explicit `roleReady` flag flips, and (2) be
re-synced BY `applyRoleUI` itself, not wait for the next user action.
**Test pattern:** extract the real inline IIFE from index.html and run it in
node `vm` with a stub DOM (scratchpad navprev/test_race.js) — replays
boot → auth-lands sequences per role without a browser.

## Brace-matching source extractors MUST skip comments (2026-07-31)

**Context:** Building a node harness for the supply-request purge by extracting the
real handler source out of `worker.js`/`index.html` — the pattern this project uses
constantly (sendInviteEmail, the SW fetch handler, the boot-race IIFE, print builder).

**Bug:** my `braceBlock()` tracked string literals but not comments. A code comment
containing **`isn't`** presented a lone apostrophe, the scanner entered
"inside a string" mode and never left, so brace counting stopped and the extractor
swallowed the **rest of the file** — silently returning ~10 unrelated functions
glued on. It surfaced only as a downstream `Unexpected token ')'`.

**Why it nearly passed:** my sanity checks were `length > 400` and "contains
`env.DB.batch`". An over-capture passes both trivially. Under-capture is loud;
over-capture is silent — extra `if` blocks that never match are simply inert, so a
harness can go green while testing a blob you did not intend.

**Rules:**
1. A brace matcher over real source must handle **four** states, not one:
   `//` line comments, `/* */` block comments, quoted strings (with `\` escapes),
   and template literals. Shared correct implementation:
   `scratchpad/extract.mjs` — copy it, don't rewrite it.
2. **Bound the extraction on BOTH sides.** Assert `length < someMax` and that the
   slice does NOT contain a symbol you know lives outside it (e.g. the next
   endpoint's action string). "Not too short" is only half a check.
3. Print `slice(-40)` of every extracted block once and eyeball that it ends where
   you meant. Cheap, catches this instantly.

**Same-pattern watch:** every existing harness in this project that hand-rolls a
brace matcher has this flaw. They happened to extract functions whose comments have
no apostrophes.


## `node:sqlite` beats a hand-stubbed D1 (2026-07-31)

**Context:** verifying the supply-request purge endpoints, which delete across three
tables and depend on FK-cascade behavior, ISO-vs-space date sorting, and `IN (?,?)`
binding.

**Finding:** node v24 on this box ships **`node:sqlite`** (`DatabaseSync`). A ~15-line
D1 shim (`prepare`/`bind`/`all`/`first`/`run`/`batch`) over it lets a harness run the
**real SQL** against the **real schema loaded verbatim from `migration-011.sql`** —
no query-string pattern matching, no re-implemented semantics. 65 assertions,
including exact 29-day/31-day boundary behavior I would never have trusted from a stub.

**Rule:** when the thing under test is SQL, load the real migration into
`node:sqlite` rather than stubbing `env.DB`. Set **`PRAGMA foreign_keys = OFF`**
deliberately, so the test proves the code's explicit deletes work without cascade
help — D1's FK enforcement is not something to assume either way. (Prod showing zero
orphans proves only that nobody has deleted yet, not that cascade fires.)

**Also:** D1/SQLite rejects a long `UNION ALL` probe with
`too many terms in compound SELECT` — split diagnostic queries into batches of ~4.

## The zero-order guard does NOT catch a PARTIAL Clover fetch (2026-08-03)

**What happened:** re-snapshotting BL4 over 2026-05-05→08-02, the oldest date came
back from Clover with **153 of its 241 orders** and overwrote a complete snapshot.
`netSales` fell $3,229.91 → $2,124.47 against a D1 truth of $3,229.91. The endpoint
reported `written=16, skipped=0, errors=0`.

**Why the guard missed it:** `backfill-items-snapshots` only consults D1 *inside*
`if (itemData.orderCount === 0)` (worker.js ~8454). At 153 orders the branch never
runs, so the independent `d1Totals` lookup — which the endpoint **already loads for
the entire range** — is never compared. The guard was built for the 7/28 failure
(a clean empty array) and Clover degrades at the ~90-day retention edge by returning
*fewer* orders, not zero.

**Aggravating factor — this was predicted and then walked into.** I identified this
exact gap before deploying, the user chose "fix the guard first", the work then
pivoted to an unrelated bug, and I ran the backfill anyway with the guard unchanged.
Same shape as the 7/28 note: *finding a landmine and documenting it is not the same
as not stepping on it.*

**What saved it:** the full key-range backup (sha256 per key) taken before the first
write. One date damaged, restored byte-exact, read back and hash-verified. Total
recovery. **Never run this endpoint without that backup.**

**Rules:**
1. **Guard on MAGNITUDE, not just zero.** Compare computed `netSales` against
   `d1Totals[store|date]` on EVERY write and refuse when it falls materially short
   (a ratio, not equality — item-line net and headline total differ legitimately;
   measure the healthy-day ratio first to pick the threshold).
2. **Spot-check the FIRST chunk before letting the rest run.** Checking one date from
   chunk 1 caught this after 48 dates instead of 90. Cheap, and it bounds the damage.
3. **The oldest dates in a window are the dangerous ones.** Degradation at the
   retention edge is gradual, so a range that "works" at its recent end can still be
   corrupting its old end. Verify oldest-first.
4. `written=N, skipped=0, errors=0` still verifies nothing. Reconcile against D1.

## Wait for propagation before verifying a worker deploy (2026-08-03)

**What happened:** shipped the backfill magnitude guard, `wrangler deploy` returned
version `cd6a1a8d`, and I immediately re-ran the operation the guard was built to
stop. It wrote anyway — `written=1`, guard silent — and re-damaged the same date.

**The trap:** this is indistinguishable from a broken fix. I spent a diagnostic pass
verifying the D1 query returned the right row, the `store|date` key format matched,
`aggregateItemSales` really returns `totals.netSales`, the guard was inside the date
loop and before the write, and the version was active at 100%. **All of it checked
out, because none of it was wrong.** Re-running the identical call a few minutes
later: `written=0, skipped=1, ratio 0.3619`, snapshot sha256 byte-identical.

**Rules:**
1. After `wrangler deploy`, give the worker time before testing the changed path.
2. **If a just-shipped fix appears inert, RE-TEST before you diagnose.** One repeat
   call is cheaper than an hour of tracing correct code.
3. When the verification itself is destructive, this matters doubly — the failed
   verification damaged production data a second time. Have the restore ready
   before you verify, not after.

**Related measurement:** Clover's ~90-day retention decays hour to hour — the same
2026-05-05 fetch returned **153 → 89 → 87** orders across one afternoon. A date at
the edge degrades while you are working on it, so "how short was it" is not a stable
number.

## Read the third-party API reference before probing it (2026-08-03)

**What happened:** removing an item from a Clover category. I guessed
`DELETE /categories/{catId}/items/{itemId}` → 405. Guessed
`DELETE /category_items` → 405. Then looked it up: the real call is
**`POST /v3/merchants/{mId}/category_items?delete=true`** with the same element
body as the assign. Not an HTTP DELETE at all.

Two wrong guesses cost two full deploy-and-probe cycles on production.

**Rules:**
1. For an unfamiliar third-party endpoint, **read the reference first**. One doc
   lookup is faster and cheaper than a deploy, a propagation wait, and a probe.
2. **Capture the upstream status and response body on failure.** A bare
   `ok: false` gave me nothing; `405 DELETE not allowed` instantly ruled out auth
   and bad IDs and pointed straight at the method. That one diagnostic commit is
   what ended the guessing.
3. Symmetry is a weak prior. `POST /category_items` creates an association, so
   `DELETE /category_items` *looks* obvious — and is wrong. Clover overloads POST
   with `?delete=true`.

**Related:** the same session's propagation lesson applies — after each of these
deploys I had to wait before probing, so a wrong guess costs far more than the
edit itself.

---

## Verify a security guard with a probe that CANNOT do damage if the guard failed
**2026-08-03 — Phase 1 admin hardening**

I shipped POST-only guards on seven endpoints that previously executed on a plain
GET, including `backfill-items-snapshots` — the one that destroyed 81 days of BL1
history in July. Then I had to prove the guard held on production.

The obvious test is circular: "GET the endpoint and see if it runs." If the deploy
silently failed, that probe *performs the destructive write I was trying to prevent.*
A verification step must never be able to cause the harm it is checking for.

**What worked** — three of the seven validate `?store=` before touching anything, so
I probed them with the param omitted. The only reachable code path was the validation
error. That made the test both safe and sharp:

| | guarded (correct) | unguarded (deploy failed) |
|---|---|---|
| GET | generic fall-through, same as a nonexistent action | the handler's own `Missing store param` |
| POST | handler's own validation error | same |

A control probe (`?action=no-such-action-xyz`) confirmed the guarded GET response was
byte-identical to a nonexistent action, and a second control (`category-costs`, left
unguarded) confirmed dispatch still worked at all — otherwise "everything falls through"
would look identical to "I broke the router."

**Rules:**
1. **Design the probe so a FAILED guard is still harmless.** Prefer a path that dies
   at input validation over one that dies at authorization.
2. **Two controls, always**: a known-absent case (what does "not matched" look like?)
   and a known-present case (is the system still routing at all?). Without the second,
   a total breakage reads as a total success.
3. **A global auth gate can mask everything.** My first probe returned 401 for all seven
   guarded actions — and also for `stores` and `health`. The session check fires before
   dispatch, so the test proved nothing. Check your discriminator actually reaches the
   code under test before believing the result.
4. **Order the deploy so the gap is safe.** Frontend first, then worker: POST to an
   unguarded endpoint already works, so the intermediate state is harmless. The reverse
   leaves the admin page broken until Pages catches up.
5. Worker propagation was **~180 s** here — far longer than the usual few seconds.
   Poll for the expected change rather than sleeping a fixed guess.

---

## A green unit suite says the logic is consistent, not that it's right
**2026-08-03 — Repair console health check**

I shipped a read-only health check with 60/60 assertions passing, covering every
status bucket, the threshold boundary, the arithmetic, ordering and truncation.
Then I pointed it at production and it was wrong three separate ways.

1. **Today.** It reported five stores "missing" — every one dated today, whose
   snapshot the nightly cron simply hadn't written yet. Headline: **$19,233
   recoverable, all of it phantom**, and acting on it would have re-snapshotted
   unfinished days, the exact needless re-pull that loses refunds.
2. **"No row" vs "row holding zero"** — conflated. They look identical downstream
   and mean different things: a cron that never ran vs one that wrote a zero.
3. **Both records agreeing on zero** — reported as "cannot judge". BL8 had 12 such
   days. Two independent sources agreeing a store took no money is a *closed day*.
   I had invented a data-integrity problem out of a business fact.

Every one of these is a **modelling** error — a wrong belief about what the data
means — and unit tests can't find those, because I write the fixtures from the
same wrong belief. My fixtures asserted a snapshot-less day is "missing" because
that is what I thought. The test agreed with me and proved nothing.

There's a tell for this category: **all three bugs made the tool report a problem
that did not exist.** A diagnostic whose first real run finds a large, alarming
number is more likely mis-modelled than lucky — real systems are usually boringly
fine. $19,233 across five stores, all conveniently dated today, should have read
as suspicious before it read as a finding.

**Rules:**
1. **Run a finished diagnostic against production and read the output critically
   BEFORE trusting it.** Ask "is this plausible?" not "did it return 200?".
   Cheap here precisely because the tool was read-only by construction.
2. **Interrogate the alarming result first.** If a first run reports a big number,
   assume the tool before assuming the data. Check whether the flagged rows share
   something — all one store, all one date, all today. Mine shared *today*.
3. **"Absent" is at least three states**: not yet produced, produced-then-lost, and
   legitimately nothing. Collapsing them into one bucket guarantees a wrong call.
4. **Two independent sources agreeing is evidence, not ambiguity.** Snapshot $0 +
   D1 $0 + 0 orders is the strongest possible signal the day sold nothing.
5. 🛑 **Never write a fixture on today's date.** The `pending` rule reclassified my
   static fixtures and the suite would have failed once a day, forever. Pin them to
   a window that can never be "now".
6. A test suite that passed before AND after a real bug was found is not vindicated
   by its own green — add the regression and treat the coverage claim as reduced.

---

## An equivalence test between two builds proves nothing until the fixtures reach the code
**2026-08-03 — extracting rebuildItemSnapshot()**

To share the two data-loss guards between the backfill and the new Repair console
I extracted the per-date body into one function. That code path has permanently
destroyed production history three times, so I wrote a differential test: drive
the REAL handler in the old build and the new one through identical fixtures and
compare the responses.

It passed 12/12 immediately. It was worthless. I had guessed the Clover credential
env var names, so `fetchItemOrders` returned `null` in **both** builds and every
scenario produced `{"error":"no credentials"}`. Two builds failing identically is
perfect equivalence and zero coverage — the guards I was trying to protect never
executed once.

The real names were `${store}_MERCHANT_ID` / `${store}_API_TOKEN`. With those in
place the guards fired and the comparison started meaning something — and
immediately found a real difference: the extracted function returned detail keys
in a different order, so responses differed byte-wise. Cosmetic, but I only got to
see it because the test was finally doing work.

**Rules:**
1. **Before believing an equivalence result, prove the fixtures reached the code
   under test.** Assert something positive — a write happened, a guard note
   appeared, a non-zero total came back. "Both sides agree" must never be the only
   assertion.
2. **Identical failure is identical.** Any differential test where both sides error
   is green by construction. Treat an all-green first run of a differential suite
   as suspicious, not as success.
3. **Don't guess integration names — grep them.** One `grep -n "async function
   fetchItemOrders" -A4` would have shown `env[\`${store}_MERCHANT_ID\`]` and saved
   the whole detour.
4. **Compare byte-for-byte, then fix the code to match, not the test.** Preserving
   the original key order made the refactor a provable no-op. Relaxing the
   comparison would have hidden the one real difference the test found.
5. When extracting shared code, the extraction is the risk — not the new caller.
   Test that the OLD caller still behaves identically before testing the new one.

---

## Poll on the whole condition, not one member of it
**2026-08-03 — verifying the Phase 4 endpoint removals**

I deleted four endpoints, deployed, and waited for propagation with a loop that
polled `debug-refunds` until it fell through. It did, so I ran the verification —
which reported two of the four as **"STILL LIVE"**.

They weren't. Cloudflare rolls a new version across instances gradually, so
consecutive curls land on a mix of old and new. My loop had confirmed one member
of the set and I generalised to the set. Re-polling on all four, and then
confirming three passes in a row, showed all four gone.

The failure mode is the interesting part: this produced a **false alarm about my
own deployment**, on a change whose entire purpose was removing things. Had I
believed it, the next move would have been to re-deploy or start hunting a
non-existent bug in the deletion.

**Rules:**
1. **Poll on exactly the assertion you are about to make.** If the claim is "all
   four are gone", the wait condition is "all four are gone" — not "one is gone".
2. **On a gradually-rolled deploy, require N consecutive clean passes**, not one.
   A single pass can be served entirely by updated instances by luck.
3. **A mixed old/new reading looks exactly like a partial failure.** Before
   diagnosing a half-applied change, re-run the check — non-determinism across
   repeats is the tell.
4. This is the second propagation trap in one session (the first: verifying ~180s
   too early and reading old code). Both cost real time. Treat "did the deploy
   actually land, everywhere?" as its own explicit step, never an assumption.

---

## `head -1` on a list you did not check the order of
**2026-08-04 — promoting a Worker version to production**

Migrating credentials to Worker secrets needed a specific version promoted. I
did:

    VID=$(npx wrangler versions list | grep -oE '<uuid>' | head -1)
    npx wrangler versions deploy "$VID"@100

`wrangler versions list` is **oldest-first**. `head -1` handed me a build from
that morning, and I deployed it to production — silently reverting three phases
of work for the several minutes it took to notice. Nothing alerted; the smoke
test I ran even passed, because the thing I was testing (Clover access) worked
fine in the old build too.

Two compounding errors:
1. **I assumed an ordering I never checked.** One `--format` with timestamps
   would have shown it. I only looked *after* the deploy misbehaved.
2. **My smoke test could not detect the failure.** It checked Clover access,
   which was healthy in both versions. A verification that passes on the wrong
   artifact is not a verification.

**Rules:**
1. **Never `head -1` / `tail -1` a tool's list output without confirming the
   sort order**, ideally in the same command — print the timestamp you are
   selecting on and eyeball it before acting.
2. **Prefer selecting by identity over position.** I *had* the version ID from
   the upload step's own output; I threw it away and re-derived it by position.
   Capture the id the creating command gives you and use that.
3. **A deploy check must assert something UNIQUE TO THE NEW ARTIFACT.** Test a
   feature that exists only in the version you meant to ship, not a capability
   both versions share. Here `?action=secret-check` was the right probe and
   `sales-diag` was the useless one.
4. Record a rollback target *before* deploying (I did — that part worked, and
   made the recovery a single command).

---

## curl probes that silently answer a different question (2026-08-09)

**Twice in one session** a `curl` verification reported a false negative because
the request never carried what I thought it carried. Both times my first
instinct was to believe the probe and blame the system under test.

1. **`$(cat)` inside `curl -H`** — the substitution competes with curl for
   stdin, so the header went out empty and every call 401'd. I told Brian prod
   was holding a different token. It wasn't; the probe was.
2. **Missing `-L` on a redirecting host** — `staging.retjghub.com/index.html`
   302s to `/`. Without `-L`, grep ran against the redirect body, so *every*
   marker read absent. I nearly reported the staging deploy as not landed while
   `sw.js` was already serving the new build.

**What made #2 catchable was the shape of the failure, not the failure itself.**
The poll printed `old-gone=1 new-css=0 staging-api=0`. Those cannot all be true
of any real build of this app: the old rule and the new rule can't both be
missing, and the app always references *some* API host. Three independent
assertions disagreeing in an impossible way means the probe is wrong.

**Rules:**
1. **Assert one thing that must be TRUE of any healthy response**, alongside the
   thing you're testing for. A probe made only of "X is absent" checks passes
   perfectly against an empty body, a redirect, an error page, or a login wall.
   Here the load-bearing control was `api-staging.retjghub.com` — always present,
   independent of the change.
2. **Check `%{http_code}`, `%{size_download}` and `%{url_effective}`** on the
   first call of any new probe. `url_effective` is what exposed the redirect in
   about two seconds after two minutes of polling nothing.
3. **An impossible combination of results is a bug in the probe**, not a
   discovery about production. Read the response body before forming a theory.
4. Prod and staging do **not** serve identically. The same probe passed on prod
   and failed on staging purely on redirect behaviour. Verifying environment A
   says nothing about whether the probe is valid for environment B.

---

# Read a file before Write overwrites it — `tasks/todo.md` is not scratch space

**2026-08-10, channel-filter work.** CLAUDE.md says "write plan to tasks/todo.md",
so I called Write on it directly. It was a **tracked file holding the active eBay
Cases Slice 2b plan** — ~420 lines of build notes, mutation results and a
sidebar-diff table. Write overwrote all of it. Recovered with
`git checkout HEAD -- tasks/todo.md` only because it was committed; had it been
one of this repo's many untracked `tasks/*.md` files, it would have been gone.

The tell was there before I wrote: the session-start `git status` listed nine
untracked `tasks/*.md` files and `todo.md` was **not** among them — meaning it
was tracked, meaning it existed and had content.

**Rules:**
1. **Write on a path you have not Read is an overwrite, not a create.** Read it
   (or `git show HEAD:<path>`) first, every time, even when a convention names
   the file for you. Edit is the safe default; Write is for files you know are new.
2. **A convention that names a fixed path ("write the plan to tasks/todo.md")
   assumes that path is yours.** In a repo with concurrent workstreams it is not.
   Use a task-specific name — `tasks/<feature>.md`, matching the eight other
   named plan docs already there — and leave `todo.md` to whoever is using it.
3. **`git status` at session start already tells you what is tracked.** A file
   absent from the untracked list is a file with committed content.

---

# One domain fact, three encodings, two answers — Hamilton Beach

**2026-08-10, Retail Summary L2 mapping.** Brian: "hamilton beach mapping is
[supposed] to be under Home L2." It was — in one of the three places the repo
encodes that fact:

| Site | Answer |
|---|---|
| `L3_TO_L2["FG BL HAMILTON BEACH"]` | Home ✅ |
| `L3_TO_L2["Hamilton Beach"]` | **Hardlines** ❌ |
| `HAMILTON BEACH` token inside the Hardlines name heuristic (×2 loops) | **Hardlines** ❌ |

So the same physical product booked to a different L2 depending only on which
Clover category string the store attached, and an item with no category at all
got a third answer. Nothing errored — the money just landed in the wrong bucket.
This is the same shape as the `|| "Hardlines"` silent default and the two
`SKU_BOOK_TO_L2` typo keys: **a categorization mistake is invisible by
construction, because every branch produces a plausible category.**

The wrong entry was also physically parked between the two Softlines lines,
nowhere near its sibling in the Home block — which is how it survived every
prior read of that table.

**Rules:**
1. **When told a mapping is wrong, grep the VALUE and the KEY case-insensitively
   across the whole repo before editing.** `grep "Hamilton Beach"` found one
   site; `grep -i hamilton` found four. The heuristic regexes hold the same
   domain facts as the lookup tables and are never where you look first.
2. **`aggregateItemSales` encodes each fact twice** — the main line-item loop and
   the cross-day refund-attribution mirror (~line 3010) are copy-pasted
   ladders. A fix applied to one and not the other makes refunds book to a
   different L2 than the sale they reverse.
3. **Keep the key next to its siblings.** A `"Hamilton Beach": "Home"` sitting in
   the Softlines block is a future bug; grouping is the only structure that table has.
4. **Mutation-test a mapping fix, one site at a time.** Reverting the table entry
   killed 2 assertions and reverting the regexes killed 3 *different* ones —
   that separation is the proof each site is independently covered. A single
   combined revert would not have shown it.
5. **`L3_TO_L2` is mirrored client-side as `ISR_L3_TO_L2` (index.html).** It
   drifts — it was 17 keys behind. Any change to one needs the other, and the
   diff is worth running as a check, not a read.

## The exact SKU is the worst price source a closeout buyer has (2026-08-26)

**Correction:** "When I scanned the Pringles UPC it found it for $7.27 at walmart.com and
priced at $4.00 but when I looked up an average 5.5oz Pringles can they go for $2.39 at
Krogers."

I fixed the wrong thing twice before finding it. First the size was missing from the price
query — real, but not this. Then I assumed a parse error and started reading the decider.
There was no parse error. Walmart genuinely lists that can: single $9.49, 2-pack $16.00,
3-pack $22.00. $22.00 / 3 = $7.33. Every rule fired correctly and the arithmetic was right.

**The premise was wrong.** It is a limited edition big box no longer stocks, so everyone
still listing it is a reseller. That is not an edge case in this business — it is the
definition of the inventory. Closeout is *what big box stopped carrying*, so the exact SKU
is systematically the worst price source we have, and it fails in the expensive direction.

<rules>
1. **When every rule fired correctly and the answer is still wrong, stop debugging the
   rules.** Check the premise. Two fixes went into the pipeline before I asked whether
   $9.49 might simply be what that listing says.
2. **Reproduce against the live source before theorising.** One free search settled in
   seconds what an hour of reading retailDecide would not have: the listings were real.
3. **Price the shelf equivalent, not the SKU.** Brand + size, variant dropped, is what a
   customer's actual alternative costs — and it corroborates across retailers where a
   discontinued SKU has one inflated listing.
4. **A substituted number must say it was substituted.** A retail that looks found but was
   derived is worse than no retail, because nobody re-checks it.
</rules>

⚠️ **The manifest scorer has the same defect.** It matters more there, not less: a manifest
is nothing but discontinued items, and an inflated retail makes a bad buy look good.

## A prompt gate you can read is not the only way context gets in (2026-08-26)

**Correction:** "the text and thumbnail still looks at the flow calendar and doesn't ignore it
and use bin thumbnail with bin text."

`buildCaption` already refused the Flow Calendar for `bin_preview` —
`MARKETING_FLOW_POST_TYPES` is `weekly_promo` + `event`, the `marketing_flow` query is skipped,
and the gate is commented with the New Arrivals post that caused it. Reading the function, the
week is provably absent. Every live auto-draft still came back about the week's promo: five
stores, five captions opening "Six days, six prices", reciting a $10 → 50¢ ladder and tagging
#DollarDays — which is `marketing_flow.dd_loyalty`, the calendar's own **DD / loyalty** column.

The promo did not come through the query. It came through the **picture**. The auto-draft
attaches a branded cover and the prompt says *"Match the caption to what it actually promotes —
its theme, headline, and any recurring schedule, day-by-day pricing, or offer printed on it."*
The model did exactly as told. The bin photos the manager had just uploaded were never sent.

<rules>
1. **When you gate a context source, enumerate every channel that carries it.** An image is an
   input. So is a filename, a topic string, and a list of "recent published captions". Grepping
   for the table name finds one of four.
2. **The model's subject is whatever it can SEE, not what the text calls the subject.** `topic:
   "this week's bin photos"` lost to an attached graphic every single time.
3. **A "graceful" fallback can change the subject.** `bin_preview cover, else any active one`
   reads like degrading to a worse picture; it actually hands a bin post the week's promo and
   captions it accordingly. Prefer no cover to someone else's cover.
4. **Read the produced artefacts, not the code, when asked whether a rule holds.** Five captions
   in D1 settled in one query what re-reading the gate would have confirmed forever.
</rules>

## Gate the deploy on the push, not on your intention (2026-08-26)

Twice in one session a teammate's PR merged into `worker.js` between my last fetch and my
deploy, and both times I deployed a build that did not contain it. The second time I had
already written "pushing first would have caught it" — and then put the push and the
deploy in the same command separated by newlines, so the deploy ran anyway when the push
was rejected.

<rules>
1. **`git push && wrangler deploy`** — never on separate lines, never `;`. The push is the
   thing that discovers the remote has moved; a deploy that does not depend on it learns
   nothing.
2. **After rebasing onto someone else's worker.js change, assert their ADDED LINES are
   present in your tree** before redeploying. `git diff <base>..origin/main -- worker.js`,
   collect the `+` lines, check every one is in the file. A clean `git status` proves
   nothing — it is relative to HEAD, and HEAD was the problem.
3. **Then assert `HEAD == origin/main`** and `git diff HEAD -- worker.js` is empty, so the
   bytes deployed are the bytes on main.
</rules>

## A global selector needs a label per CONSUMER, not one per page (2026-09-01)

**Reported:** "Can you fix the dates, they don't match up" — Labor / Hours tab, the header
week nav reading **Aug 30 – Sep 5** directly above a grid titled **Week of Aug 23 – Aug 29**.

**Bug:** the Labor header holds one week nav shared by three tabs whose panes deliberately
render *two different weeks* — Planning forecasts the upcoming week, Budget vs Actual and
Hours report the week before it. `initLabor()` wrote `#labor-week-label` from
`laborState.week` (the planned week) unconditionally, and `laborSetTab()` never touched it,
so two of three tabs shipped a nav naming a week neither pane showed. `#labor-fresh`
("Trailing 4 wks · thru …") had the same shape: written only by Planning's renderer,
never hidden, so Planning's *inputs* stayed pinned over the other two panes.

**Lesson — this is the 2026-07-03 mislabel lesson with the arrow reversed.** There, one
label was left behind when the *value* moved to a new range. Here the value was always
right and the label was never per-tab to begin with. The tell is the same either way: a
label rendered from page-level state while the thing under it derives from a *shifted* copy
of that state. An intentional offset between panes is not an excuse for the chrome to pick
one of them — it is exactly why the chrome has to follow the active pane.

<rules>
1. **When N panes derive different periods from one selector, the selector's label is a
   function of the active pane** — `laborHeaderWeek()` — never of the raw state. Sync it
   from the tab switcher, not only from init.
2. **Define a shifted period ONCE.** `laborState.week - 7` was open-coded in
   `laborActRange()` and `laborHoursWeek()`; both now call `laborReportedWeek()`, so the
   label cannot drift from the panes.
3. **A chip written by one tab's renderer must be hidden by the others.** Grep for ids set
   inside a single `*Render()` and shown in shared chrome.
4. **`hidden sm:inline-flex` is hidden-then-shown.** Adding `hidden` to it does nothing at
   sm+ — drop the `sm:` variant instead. Verify against the built CSS, not `tailwind.css`.
</rules>

**Verification pattern that worked (same as 2026-07-03):** the page needs the remote worker
+ auth, so a screenshot proves nothing. `scripts/test-labor-week-label.mjs` lifts the real
functions out of `index.html` by name and drives them; the negative control — a scratch copy
with the old one-line header behaviour restored — reproduces the screenshot exactly
(`expected "Aug 23 – Aug 29", got "Aug 30 – Sep 5"`) and fails 9 assertions.

## An entry surface opens on the period you HAVE data for (2026-09-01)

**Correction:** I fixed the Labor week-nav mislabel, noticed Hours opened on the week *in
progress* (a Tuesday → five of seven columns blank, press `‹` to get to work), flagged it as
"a product call, not a bug fix" and left it. Brian: "make hours default to the last closed
week." He was right and I should not have needed asking.

**Lesson — a reporting view and an ENTRY view do not want the same anchor.** Budget vs Actual
reports pace, so the week in progress is the useful default. Hours entry transcribes numbers
that only exist once the week has ended and payroll has run, so the week in progress is the
one week you can never key. When a surface exists to be *filled in*, its default period is the
most recent one whose source data is complete — not "now", and not whatever the neighbouring
tab uses. "It matches the tab next to it" is symmetry, not a reason.

<rules>
1. **Ask what the source of truth is and when it lands.** Paylocity closes weekly; that fact,
   not the calendar, sets the default. Same shape as any month-end or settlement-lagged feed.
2. **A default that always needs one click is a bug, not a preference.** If the first thing
   you would do on opening a surface is navigate, the default is wrong.
3. **Assert a relative default against a CALENDAR, not against the offset that produced it.**
   `laborWeekFor('hours')` is pinned to "the most recent Saturday strictly before today" over
   all seven weekdays — the Saturday case is the one an offset gets wrong, since the week
   ending today has not closed.
4. **When N surfaces derive periods from one selector, put the offsets in ONE table**
   (`LABOR_TAB_WEEKS_BACK`) that the panes, their fetches and the nav label all read. Adding
   a third distinct week was then one number, and the nav could not fall out of step.
</rules>

## A frontend change is not shipped until CACHE_NAME moves (2026-09-01)

**What happened:** I merged the Labor week-nav change, watched the Pages deploy go green, and
reported it deployed. It was — to the CDN. But `sw.js` serves the app shell
**stale-while-revalidate**, and I never bumped `CACHE_NAME` (still `dashboard-cache-v139`,
last touched by an unrelated commit). `MEMORY.md:55` says this in one line: *"Bump
`CACHE_NAME` in `sw.js` or installed apps keep the old bundle; open apps never self-update."*
21 of the last 25 commits touching `index.html` bump it. Mine did not.

Without the bump the documented update path never fires: `sw.js` is byte-identical, so no new
worker installs, `activate()` never purges the old cache, and the `controllerchange` reload
never runs. An installed app serves the OLD `index.html` on its next launch and only picks up
the new one the launch after that — silently, with no reload. Brian would have opened Labor,
seen the old dates, and reasonably concluded the fix did not work.

<rules>
1. **Touching `index.html` means bumping `CACHE_NAME` in the same commit.** It is a
   one-line edit and it is the difference between deployed and delivered. Check it before
   opening the PR, not after the merge.
2. **"The deploy is green" is not "users have it."** A green Pages run proves the CDN has
   the bytes. The service worker sits between the CDN and the user and is a second, separate
   cache with its own invalidation. Verify the LAST hop, not the first.
3. **Re-read `MEMORY.md` before saying a frontend change has shipped.** The rule was already
   written down; I had read the file for the destructive-ops rules and skipped past this line
   because it was not about the task in front of me.
4. **When egress policy blocks verifying prod, say so and check what you CAN reach.** Both
   `www.retjghub.com` and the artifact host returned 403 CONNECT here. The proxy README says
   report a policy denial rather than route around it — so report it, then reason from the
   repo (the SW strategy) instead of asserting the deploy is fine because a job was green.
</rules>

## The fallback string that ate the status code (2026-09-02)

**What happened:** Brian scanned a LIFEWTR bottle to test the new sticker button and got
`This cannot be printed yet.` That sentence was not any of the four refusals I had designed —
it was the `||` fallback in `psStickerCheck`:

```js
: psEsc(a.detail || 'This cannot be printed yet.');
```

Every real refusal carries a `detail`, so the fallback could only ever fire on a body that was
not a refusal at all. And on this worker there are four such bodies — `UNCLASSIFIED_ACTION`,
`NO_BUSINESS_ACCESS`, `NEED_ADMIN`, `NO_FINANCIAL_ACCESS`, plus a thrown handler's
`{ error }` — all of which answer with no `detail`. `psStickerCheck` never looked at `r.ok`,
so it rendered all five as the same dead sentence. An undeployed worker, a missing grant and
a Clover outage were indistinguishable on screen.

I had spent real care on the refusals — four named reasons, each saying which part was
missing, tests pinning all four — and then wrote the fault path as a `||` default. The
premise of the whole feature ("a refusal always names what is missing") stopped at the
boundary of the cases I had thought of.

Second hole, found while looking: `stickerCategoryCodes` had no `try`. `cloverFetch` awaits
`fetch()` directly, so an unreachable Clover **throws** rather than returning a non-ok
response, and the `if (!r?.ok) break` guard never sees it. It escaped to the 500 handler —
so the endpoint's own `"clover unreachable"` refusal, written for exactly this, could not be
reached from the map read. Only the existence check could produce it.

<rules>
1. **A fault is not a refusal, and must never be rendered as one.** If a response can carry a
   reason, then a response WITHOUT one is a different kind of event. Branch on that, do not
   `||` past it.
2. **Check `r.ok` before reading a body as a domain answer.** `await r.json()` on a 403 gives
   a perfectly valid object that means nothing you designed.
3. **Never write a default message that discards the status code.** If the fallback fires, it
   is firing on a case I did not anticipate — which is exactly when the status and the server's
   own `error` text are the only information anyone has.
4. **`await fetch()` inside a helper THROWS; a `!resp.ok` guard does not catch it.** Every
   caller of `cloverFetch` that treats "Clover is down" as a handled outcome needs a `try`,
   not just an ok-check. Grep the other call sites before assuming they are fine.
5. **Design the error path with the same care as the success path.** I enumerated four
   refusals and zero faults. Enumerate both, and write a test that asserts no branch renders
   blank.
</rules>

**Repeat offence:** #162 also shipped 116 lines of `index.html` without bumping `CACHE_NAME`
— the exact mistake the 2026-09-01 lesson above was written about, one day later. Reading a
lesson is not the same as running it. Before opening ANY PR that touches `index.html`, run
`git diff --name-only origin/main | grep -q index.html && git diff --name-only origin/main | grep -q sw.js` —
if index.html is in the diff and sw.js is not, the PR is not ready.

## Four layers, one mistake, ninety minutes (2026-09-02)

**What happened:** the sticker feature worked correctly on the first deploy. The category
map derived `50002` for Beverages from live Clover with no hardcoded table, `$1.50` encoded
to `1_5` matching 240 real codes, and `BL-50002-1_5` existed on the shelf system. It still
took roughly ninety minutes and four deploys to find that out, because **every layer between
the failure and the screen threw away what it knew**:

| Layer | What it discarded | What the screen said |
|---|---|---|
| `psStickerCheck` | the HTTP status, via `a.detail \|\| 'This cannot be printed yet.'` | "This cannot be printed yet." |
| `stickerCategoryCodes` | a thrown fetch, escaping as a 500 | "This cannot be printed yet." |
| `stickerCodeExists` | Clover's 400 and its body, via `if (!r?.ok) return null` | "Clover did not answer" |
| my own shell command | curl's error and grep's result, via `-s` and `-q` | nothing at all |

The actual cause was one line: Clover has no `code` filter, and answers
`400 {"message":"'code' is not a supported field for this filter."}` to every such request.
The moment one layer was made to repeat what Clover said, the bug was obvious in a single
scan.

<rules>
1. **A fault is not a refusal.** If a response can carry a reason, a response WITHOUT one is
   a different kind of event. Branch on it. Never `||` past it into a friendly sentence.
2. **Check `r.ok` before reading a body as a domain answer.** `await r.json()` on a 403
   returns a perfectly valid object that means nothing you designed.
3. **`if (!resp.ok) return null` is a bug unless the caller can ask why.** Return
   `{ value }` or `{ value: null, why }`. The person holding the scanner has no console.
4. **`await fetch()` inside a helper THROWS; an ok-check does not catch it.** Every caller
   treating "the API is down" as handled needs a `try`, not just `if (!r.ok)`.
5. **Chain deploy steps with `&&`, never newlines, and never with `-s` or `-q`.** I handed
   over four newline-separated lines; the `git pull` failed, zsh ran the next line anyway,
   and `wrangler` cheerfully deployed a checkout two commits stale while reporting success.
   A silent guard is worse than no guard — it looks like it ran.
6. **Reuse is not evidence of correctness.** I justified the broken filter in a commit
   message as "reuses the same `filter=code=` lookup that create-clover-item already uses as
   its duplicate check." That lookup had never worked either. Copying a pattern from
   elsewhere in the repo copies its bugs, and citing the precedent makes the bug look
   deliberate. `create-clover-item` still creates the duplicates it exists to prevent.
7. **Probe with the real key, not the display label.** I tested `sticker-check` with
   `l3: 'Beverages'` — what the UI renders — when `l3` is `FG BL CONSUMABLES - FOOD -
   BEVERAGES`. The truthful "no category code" reply sent us hunting a join bug that did not
   exist. Read how a field is keyed before hand-crafting a request against it.
8. **`raw.githubusercontent.com` caches branch refs for minutes.** A `main` URL fetched
   right after a merge can hand back the previous commit. Use the commit SHA; it is
   immutable and cannot be stale.
</rules>

**The cost was not the bug, it was the silence.** Four separate deploys went out to learn
things that one honest error message would have said the first time.

---

## An empty answer is a fault, not a fact

The sticker feature printed successfully, was merged, and was hard-reloaded — and then the
screen said *"Zebra Browser Print is running, but reports no printer attached."* The probe
was byte-for-byte the code that had printed an hour earlier. Nothing had regressed.

The defect was that a **single** `{"printer":[]}` was treated as settled fact, and the
sentence built from it named the printer as the cause. So the answer to a transient was a
trip to the back room to check a cable that was fine.

This is [MEMORY.md](../MEMORY.md) rule 4 — *"assume Clover degrades by returning LESS, not by
erroring"* — arriving from a completely different vendor. I had the rule, I had written a
test suite around it for Clover, and I did not carry it across the loopback boundary to
Zebra. The rule is not about Clover. It is about **every** remote that answers.

<rules>
1. **A well-formed empty result is the weakest evidence there is.** It looks identical
   whether the thing is absent, still starting, asleep, or was never asked properly. Ask
   again before building a sentence on it, and say in the sentence how many times you asked.
2. **Any probe of live device or service state must be `cache: 'no-store'`.** A runtime
   `fetch` is not covered by the page's hard reload. An agent that sends no freshness headers
   lets the browser heuristically cache a 200 — so one empty answer can outlive the printer
   coming back, and every retry replays it.
3. **Do not reject a thing the remote listed because a field you do not own is missing.**
   The remote's own refusal is better evidence than a client-side guess. Prefer the
   well-formed entry, fall back to the one that is there, and let the write speak.
4. **"It worked before and the code has not changed" is a finding, not a dead end.** It
   rules out regression and points straight at what the code assumes about the world. Check
   the diff FIRST — three commits and one `git log -S` cost a minute and stopped me from
   "fixing" code that was fine.
5. **Report the count, not the conclusion.** "Answered twice, both times with no printer
   attached (1 non-printer device seen)" tells the next person whether the agent is
   enumerating at all. "No printer attached" tells them to go find a cable.
6. **Mutation-test a guard the same session you add it.** Three one-line mutations proved the
   retry, the no-store and the uid fallback each fail loudly when removed. A green suite
   proves the code runs; only a red one proves the test is load-bearing.
</rules>


---

## One right wearing two jobs

The shelf-sticker feature was invisible to the people whose job it is. Every sticker action —
check, record, history — ran through `requireAdminAccess`, which resolves to
`canAccessInventory`: **superuser and admin only**. The front end matched it with
`psCanOverride`, the right to change what an item is worth for every store, forever.

Nobody decided that printing a label required the authority to reprice the chain. It was
inherited, once, from whatever was nearby when the endpoint was written — and then copied
three more times because the first one looked deliberate.

<rules>
1. **Name the right after the job, not after the nearest existing helper.** `psCanPrint` and
   `psCanOverride` can share an implementation today and diverge tomorrow; `psCanOverride`
   doing double duty cannot be changed for one caller without silently changing the other.
2. **A gate copied from the handler above it is not a decision.** Ask what the action
   actually exposes. A sticker carries a code and a retail price the scan already showed;
   it is not the override it was gated like.
3. **Check the whole chain before claiming who can do what.** `requireAdminAccess` does not
   mean "admin" — it resolves through `allowAdminMutation` to `canAccessInventory`. I nearly
   described the gate from its name. Two greps settled it.
4. **When widening a permission, test the direction you did NOT go.** My first suite proved
   managers could print and staff could not — and passed unchanged when I mutated
   `psCanOverride` into `canSeeFinancials`, which would have handed price overrides to every
   manager. Widening tests catch under-widening; only a pin on the untouched right catches
   over-widening.
5. **`ok(/functionName/.test(src))` proves a name, not a behaviour.** It passed while the
   body did the opposite of what the assertion was named for. Pin the role list, and run the
   function.
6. **A probe that throws must fail, not crash.** Building a function that reaches for a free
   variable succeeds; calling it throws. Wrap the call, and compare against `false` rather
   than truthiness, or a dead suite reads as a passing one.
</rules>

**The tell was in the screenshot.** A tab that renders for almost nobody looks identical to a
tab that works. It took a user saying "everyone who prints" to surface a gate nobody had
chosen.


---

## Grepping a name is not testing a behaviour

Twice in one day, a mutation walked straight through a green suite.

`psCanOverride` redefined as `canSeeFinancials` — which would have handed price overrides to
every manager — passed a suite whose assertion was `ok(/psCanOverride/.test(html))`. And
`retail: … ? null : …` mutated to `? 0 :` passed an assertion that read
`ok(/r\.retail_cents === null/.test(hist))`, because the *condition* was untouched; only the
value it returned changed. That one would have printed **"Compare at $0.00"** on a shelf.

Both assertions were about the right lines. Neither was about the right thing.

<rules>
1. **If the thing under test is a value, produce the value.** Extract the real expression and
   run it. `new Function('r', 'return (' + expr + ')')` over a matched source range costs three
   lines and cannot be fooled by an edit that leaves the surrounding text intact.
2. **A regex over source can only ever pin syntax.** It is fine for "this call site passes the
   template" and useless for "this returns null". Know which one you are writing.
3. **Mutate in the direction you did NOT go.** Both gaps were found by mutating toward the
   dangerous outcome — widening a right, filling in a null — not by breaking the happy path.
4. **Anchor slices on the handler, not the action name.** Every sticker action name appears
   FIRST in the `ACTION_BUSINESS` registry hundreds of lines above its handler, so slicing
   between bare names produced empty strings and six assertions passed against nothing. Only
   an unrelated typo in a label revealed it. Anchor on
   `url.searchParams.get("action") === "x"`, and assert the slice is non-empty.
5. **A stale warning is worse than none.** `⏸ THE GEOMETRY IS UNVERIFIED` sat above psZpl long
   after a real ZD410 had verified it and the QR had scanned at the register. The next person
   to read it re-runs a check that is already done.
</rules>


---

## A new surface does not inherit the old surface's honesty

The sticker editor shipped and immediately reported **"Could not load the template: Forbidden."**
The response carried `code: "UNCLASSIFIED_ACTION"` — which does not mean *you may not*. It means
**this worker predates the feature** and the fix is a deploy, not a permission.

`psStickerFault` has said exactly that sentence, on the same page, since the day it was written:
*"the worker half of the deploy is missing."* The new panel used `j.error || \`HTTP ${r.status}\``
and read straight past it — so a two-word answer sent someone hunting a role problem that did
not exist.

This is the third time in one session that a refusal discarded what it already knew. The first
two were `catch (_)` swallowing three distinct failures, and a bound `e` that went unused.

<rules>
1. **When you add a panel, ask what the existing panels do with a 403 — and copy it.** The
   mapper was 100 lines away. A new surface starts with none of the hard-won error handling
   around it unless you go and get it.
2. **`j.error` is the generic half of the response. `j.code` is the useful half.** If a worker
   bothers to return a code, showing only the error is throwing away the diagnosis.
3. **Every distinct code deserves a distinct sentence — assert that.** The test that catches a
   collapse is `new Set(messages).size === codes.length`, not five separate greps.
4. **Scope a find-and-replace and count first.** `if (!r.ok) throw new Error(j.error || …)`
   appears fourteen times in this file. A blanket replace would have rewritten eleven unrelated
   features. Slice to the block, assert the count is what you expect, and diff before trusting.
</rules>


---

## A syntax check is not a structure check

I inserted three new helpers into `worker.js` using an anchor that sat **inside**
`sanitizeStickerTemplate`, splitting the function in half and nesting the helpers within it.

`node --check` passed. It is legal JavaScript — nested function declarations are fine — so
nothing complained. But the helpers were now scoped to that function, invisible to the request
handlers that call them, and **every template read would have thrown `ReferenceError` in
production**.

What caught it was the test suite's structural extraction:
`/function sanitizeStickerTemplate\(body\) \{[\s\S]*?\n\}/` grabbed up to the first
`\n}`, which was now the middle of the function, and `new Function` refused to parse it.

<rules>
1. **Anchor an insertion on a boundary you have SEEN, not one you assume.** I anchored on
   `return {\n    tpl: {` believing it followed the function. It was inside it. Two lines of
   `sed` before the edit would have shown that.
2. **After inserting a top-level declaration, assert it IS top level.** A regex anchored on
   `^function name(` costs one line and catches the whole class. It is now in the suite for
   all four sticker helpers.
3. **`node --check` proves parseability, nothing more.** It cannot see scope, reachability, or
   whether a function ended up somewhere useless. Structural extraction in tests can, and did.
4. **A cap that cannot bind is decoration.** `STICKER_MARK_MAX_BYTES = 4000` with a 150-dot
   side limit was unreachable: the largest possible pack is 2,850. It read as protection and
   enforced nothing — the same shape as the Clover duplicate guard that sat broken for years.
   Compute the extreme case and check your limit is on the near side of it.
5. **Then make the comment match the numbers.** My first fix claimed 113x113 and 150x85 were
   allowed. Both are refused at 1,600 bytes. A comment with wrong arithmetic in it is worse
   than none, and I had written that exact lesson earlier the same day.
</rules>


---

## A block rewrite takes whatever was inside the block

Rewriting the sticker editor, I replaced everything from `let stTpl = null` to
`window.stTest = stTest;`. Two helpers — `stTextW` and `stQrDots` — lived inside that range
and were not in my replacement. The **calls to them survived**, in `stPreview`.

So `stPreview()` threw `ReferenceError` on its first line. And because `stDraw()` sets the
control rows' `innerHTML` *before* calling `stPreview()`, the panel rendered perfectly and the
preview simply never appeared. **A half-working surface is harder to notice than a broken
one** — everything you look at first works.

Nothing caught it: `node --check` passes, the inline-script check passes (the code parses
fine, it just references something absent), and every assertion I had was grep-shaped.

<rules>
1. **Before replacing a range, list what is defined inside it.** One `grep -n` for
   `const|let|function` between the two boundaries would have shown both helpers.
2. **Rewrite the whole unit or patch surgically — never a range chosen by convenience.** I
   picked the start line because it was easy to match, not because it was a boundary of
   anything.
3. **Assert that every helper a module calls is defined.** Six lines: collect
   `/\bst[A-Z]\w*(?=\()/` from the block, check each has a declaration somewhere. It catches
   the whole class, not this instance.
4. **Then run the function.** The definedness check finds a missing helper; only executing
   `stPreview` against a fake DOM proves it still produces an `<svg>`. Both are in the suite
   now, and both were verified by deleting each helper again and watching them fail.
5. **Render order hides errors.** If A populates the visible thing and then calls B, a throw
   in B is invisible. When something renders "mostly", check the console before believing it.
</rules>

## "It isn't saving" was four different bugs, and none of them was the save

The user reported the sticker template not saving and test printing not working. My first
instinct was the worker validator, so I extracted it and ran the exact on-screen values
through it. It **accepted them** — the payload was fine, and had always been fine. Every
assertion I had was about that payload.

What was actually wrong sat on either side of it:

1. **`stSet` called `stDraw()` on every `oninput`.** `stDraw` assigns `#st-fields.innerHTML`,
   which destroys the input the caret is in. Typing `113` into a coordinate box landed the
   `1` and threw the other two characters on the floor. Same bug in `stCutSet`, so the
   threshold slider was destroyed under the finger dragging it.
2. **After "Save as new", the editor picked which template to show from `active`.** A new
   template is not necessarily the active one, so the screen swapped to the *other* template
   the instant the save succeeded — while printing "Saved". The work was on the server the
   whole time and the screen threw it away.
3. **`^GFA` was emitted with no `^FS`.** `^FS` ends a field definition and commits it. It was
   the only line on the label without one, so an image mark never printed. Text-mode
   templates printed fine right beside it, which is why it read as "test printing is broken".
4. **`stickerText`'s `.trim()` ate the retail prefix's trailing space**, printing
   `Compare at$29.99` on a shelf. The prefix is concatenated straight onto `$29.99`, so that
   space is the separator — the one character a trim is guaranteed to remove.

<rules>
1. **When a report says "X isn't working", verify X is where the failure is before fixing X.**
   Ten minutes proving the validator accepted the payload told me the bug was somewhere else
   and saved me from "hardening" a function that was already correct.
2. **A test that inspects the payload cannot see whether the number reached the payload.**
   Drive the UI: type character by character, click the button, read what came back. Both
   1 and 2 above are invisible to every possible assertion about the request body.
3. **`innerHTML =` on an `oninput` handler is always a bug.** It destroys the element the
   event came from. Redraw only what changed structure; move the rest.
4. **Never infer identity from a neighbouring field.** The client guessed "which row did I
   just write" from `active`. The server knew; it just wasn't saying. One `savedId` field
   ended the guess. If the caller has to infer it, the API is missing it.
5. **When one line in a generated format is built differently from its siblings, check the
   terminator.** Four `^FO...^FS` lines and one `^FO...` — the odd one out was the bug, and
   it was visible in the test's own expected string, which had been written to match.
6. **Don't slice a fixed number of characters out of source to test it.** `worker.slice(at,
   at + 1200)` failed a test because I added a five-line comment inside the handler. The
   same trap passes silently in the other direction, pulling the *next* handler into view.
   Slice to a real boundary.
</rules>

## A whitelist of the wrong half, and a default that fails silently

I added a `Show` select to the sticker template editor and wired it to `stSet('code','show',…)`.
`stSet` listed the STRING properties and fell through to `Number()`:

```js
const v = prop === 'on' ? !!raw
  : ['text', 'prefix', 'font', 'mode'].includes(prop) ? raw : Number(raw);
```

`show` was not in that list, so the value became `Number('number')` = **NaN**. What followed
was four silent steps and no error anywhere:

1. `NaN === 'number'` is false, so the preview never redrew — it looked like the control did nothing.
2. `JSON.stringify` turns NaN into `null`.
3. The worker's `["full","number"].includes(String(null))` is false, so it substituted the default.
4. The editor adopts the response, so the select **snapped back to Full code**.

The user saw "the preview isn't changing and when I hit save it reverts" — two symptoms, one
missing string in a list, and every test I had passed.

The tests I had written the day before were the right SHAPE — they drove the editor by typing
into fields — but they only exercised the controls that existed when I wrote them. A new
control is exactly what a hand-kept list forgets.

<rules>
1. **Whitelist the closed set, not the open one.** The numeric properties are `x, y, h, w, mag`
   and there will not be a sixth. The string ones grow every time a feature is added. I named
   the growing half, so adding to it required remembering — which is the definition of a
   latent bug.
2. **`Number()` is not a safe default.** It cannot fail; it returns NaN, which is a number, is
   falsy in `===` against everything, and JSON-serialises to null. Coercion that can't fail
   loudly should never be the fall-through branch.
3. **Derive the list of things to test from the artefact, not from memory.** The new guard
   scrapes `stSet('x','y'` out of the rendered HTML and round-trips every one. It cannot go
   stale, because adding a control adds a case automatically.
4. **Assert the stored TYPE, not just presence.** NaN is a number. Any check of the form "is
   it a number" passes on the bug. `Object.is(got, want)` catches it.
5. **"It reverts on save" usually means the server rejected it and you adopted the answer.**
   Adopting the server's response is right — it is how clamping stays honest — but it also
   means a client-side corruption presents as a server-side refusal, and you will go looking
   in the wrong file. Check what the client actually put on the wire first.
</rules>

## I told Brian production was down, from an inference, while holding a five-second check

Bin Dump's `sup_ref` column needed `migration-059.sql` on two D1 databases. Across one session
I made the same mistake twice, escalating each time:

1. Brian's deploy grew the worker by ~235 bytes. I said the deployed build was "almost certainly"
   the older one, reasoning that #196's prompt rewrite was ~2.5 KB. When I finally measured, the
   real diff was 1210 bytes, **791 of them comments the bundler strips** — the arithmetic never
   supported the confidence I gave it.
2. His `d1 execute` runs had all failed, so I concluded the column did not exist, and wrote:
   *"Bin Dump is broken in production right now."* It was not. Production already had the column.
   The `ALTER` returned `duplicate column name: sup_ref` — the all-clear — on the first try.

The second is the bad one, and not because the guess was wrong. Earlier in the same session I had
looked at Brian's screenshot and correctly written that it was consistent with **two** states
(old worker + no column, or new worker + column), because a logged pallet rendering in the Log tab
rules out only the mismatch. Then, with no new evidence, I collapsed that disjunction to the
alarming branch and reported it as fact. I had already done the careful reasoning and then
discarded it.

What makes it avoidable: the migration is **its own probe**. One additive, nullable `ALTER` that
either applies or says `duplicate column name`. Both outcomes are safe, and between them they
name the state exactly. The right move was "run this, it will tell you which state you are in" —
which costs nothing if the column exists — not "you are in this state, here is how to fix it."

<rules>
1. **Never state the live state of production as fact from an inference.** Say what you have
   ("your migration runs failed, so the column may be missing") and what would settle it. A
   sentence about prod that a person will act on needs a primary source, not a chain of reasoning.
2. **When a safe, self-diagnosing probe exists, run it BEFORE narrating a diagnosis.** CLAUDE.md
   rule 3 forbids verifying a guard with a probe that does the damage; the corollary is that a
   probe which is harmless in *both* outcomes should come first, not after the conclusion.
3. **Once you have enumerated two consistent states, you may not later pick one for free.**
   Write the disjunction down and re-read it. Collapsing it silently is how a hedge becomes a
   claim between two messages.
4. **Weigh the two error costs before raising an alarm.** "Run this, it may already be done"
   costs a command. "Your app is down" costs someone dropping what they are doing mid-shift.
   Asymmetric costs mean asymmetric evidence bars.
5. **Never put a trailing `#` comment on a shell command you hand someone.** Interactive zsh does
   not set `INTERACTIVE_COMMENTS`, so `--file=x.sql   # staging` passes `#` and `staging` as
   arguments. My annotation is what made both of his migration runs fail. Put the label on its
   own line, above the command.
</rules>

### Addendum, same day: the limitation I asserted was also unchecked

The whole reason the guessing above was necessary was that I believed this session could not
reach D1. I said so to Brian more than once and wrote it into three check-in notes as a
standing fact:

> This session has no credentials for D1 or the deployed worker and cannot verify either
> directly. Do not state live production state as fact from inference.

Then he asked me to run the staging migration, I finally looked, and `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID` were both sitting in the environment the entire time. One
read-only query settled in four seconds a question I had spent the afternoon reasoning about
— and it turned out the migration was already applied on **both** databases, so the alarm I
raised had no factual basis in either direction.

This is the same error as rule 1, pointed inward. I was careful about claims regarding the
*world* and completely uncritical about a claim regarding *myself*, even though the second
was far cheaper to check and was the thing forcing all the inference.

<rules>
6. **Check your own capabilities before declaring them absent.** "I can't reach X" is a factual
   claim about the environment, not a property of being an assistant. `env | grep -i TOKEN`,
   `which wrangler`, one read-only call — seconds, against an afternoon of reasoning built on
   the assumption.
7. **A stated limitation propagates further than a stated fact.** A wrong claim about
   production gets corrected the moment somebody looks. A wrong claim about what you cannot do
   ends up in the notes you hand your successor, who then does not try either. Mine survived
   three check-ins.
8. **When someone asks you to do the thing you said you could not do, look before answering.**
   The request is evidence: they may know something about your access that you do not.
</rules>

## The button was in the DOM, the assertion passed, and nobody could click it (2026-09-14)

Brian: *"when selecting the date the apply button doesn't display."*

The Apply button was in the markup. It had always been in the markup. The two-range
picker's browser suite — 43 checks — passed on every one of them, because every check
asked whether an element **existed**, matched text, or fired a handler. Not one asked
whether it was **on the screen**.

It was not. Placement guessed the popover's height once, at open time:

    top = Math.min(box.bottom + 6, Math.max(8, innerHeight - 430))

430 was a fair guess for the popover that constant was written for. The popover I then
shipped stacks a preset list on top of *two* month grids on top of the footer: 861px. A
CSS `max-height: 86vh` looks like a viewport clamp and is not one — 86% of the viewport,
measured downward from a top of 226px, ends 100px past the bottom of a 900px screen. So
the box hung off the bottom, the footer was the last thing inside a scrolling column, and
at 1512x820 the Apply button sat at y 878–925 with the screen ending at 820 **at every
possible scroll position**. Not "hard to reach". Unreachable.

Three separate things had to be true for me not to notice, and all three were mine:

1. I changed the popover's content without re-checking its geometry. The 430 was correct
   when written; I invalidated it and never looked at it.
2. My assertions tested existence, and I read them as testing visibility. `count()===1`
   and `innerText` are satisfied by an element parked 100px below the fold.
3. I screenshotted the tab, not the **open popover**, so the one artifact that would have
   shown it was never produced. I have a note three lessons up that a screenshot caught a
   bug 28 passing assertions missed. I did not take the screenshot.

The sibling picker on the same page had the answer the whole time: `#wrs-chip-panel` shows
the preset list **or** the calendar, never both stacked, which is why its footer has never
fallen off. I did not look at how the neighbour solved the same problem before inventing
my own arrangement of the same parts.

<rules>
9. **"Exists in the DOM" is not "visible to a human". Assert geometry.** For anything a user
   must click, check `getBoundingClientRect()` against `innerWidth/innerHeight` AND
   `elementFromPoint` at its centre. An element can pass every text and count assertion from
   entirely off-screen. The assertion to write is the one a person would make with their eyes.
10. **A magic pixel constant is a dependency on content you are about to change.** Any literal
   that encodes "how tall this thing is" (`innerHeight - 430`) breaks silently the moment the
   content grows, and breaks in the direction of invisibility, which is the direction nobody
   reports for weeks. Measure after render — `scrollHeight`, `offsetWidth` — or don't place it.
11. **`max-height: Nvh` is not a viewport clamp for a positioned element.** It bounds the box's
   height, not where the box ends. A 86vh box that starts at 226px still overhangs. Clamp the
   *edge*: `Math.min(desiredTop, innerHeight - margin - height)`.
12. **Actions that live at the bottom of a scrolling container must be sticky.** Otherwise their
   visibility is a function of scrollTop — and if that container also re-renders via innerHTML,
   scrollTop resets to 0 on every interaction, so the user is thrown back to the top each time
   they click the very thing they came to click.
13. **Before inventing a layout, read how the neighbouring surface solved it.** Two other range
   pickers ship in this file. Both avoid this failure, one of them by construction. CLAUDE.md
   already says extend what is there; the cost of not looking was a shipped-broken control.
</rules>

## The comment said it could not affect budget, and it was the only thing that did (2026-09-16)

Brian: "we removed Holland from the frontend but were supposed to keep the budget untouched
— its budget came out of the all stores budget." It had, from all seven chain figures, the
day it shipped.

The change that did it (3315888) was careful in exactly the wrong place. It left the
worker's `ALL_STORES` alone, wrote a paragraph in the commit message explaining why that
mattered, added a 17-assertion test pinning BL8 **in** `ALL_STORES` and **out** of the
frontend `STORES`, and put a 🔑 comment above the roster reading "THIS LIST DOES NOT DECIDE
BUDGET. Chain financials scope to ALL_STORES in worker.js."

Every one of those statements is true. None of them is load-bearing. `ALL_STORES` scopes
what the **worker** computes — briefings, emails, notifications, Retail Summary. The
dashboard's All Stores Budget card calls none of it: it sums budget **in the browser** out
of `allStoreData`, which is filled by `STORES.map(loadStoreFromD1)`. `STORES` was the budget
scope, the comment said it wasn't, and the test only ever compared the two lists to
themselves.

The tell was in the previous session's own review note, offered as proof of success:

> "the per-store history read and the live Clover poll are driven straight off `STORES`, and
> both now fan out to exactly five stores with no BL8."

That dropped D1 read *is* the bug. The evidence that the change worked and the evidence
that it broke something were the same sentence, and the difference between them is a
question nobody asked: the budget has to come from somewhere — where does it come from?

<rules>
14. **A comment asserting a non-relationship is a claim, and claims get tested.** "This list
   does not decide X" is a testable statement. If it is worth writing a 🔑 on, it is worth
   one assertion. Unpinned, it does not merely fail to help — it actively stops the next
   person looking, which is worse than silence.
15. **Test the relationship, not the two things.** `BL8 ∈ ALL_STORES` and `BL8 ∉ STORES` both
   passed straight through the bug. The assertion that catches it is
   `STORES + BUDGET_ONLY_STORES === ALL_STORES` — one that names both sides and fails when
   they drift. Two independent assertions about two lists say nothing about the gap between.
16. **Before removing a store/user/tenant from a roster, grep what SUMS over it.** Not what
   renders it — what sums it. `for (const s of ROSTER)` that touches a money field is a
   scope decision wearing a loop's clothes. Ask where every figure on the screen is computed
   — worker or browser — before trusting a claim about which one owns it.
17. **"The fan-out got smaller" is evidence of a smaller fan-out and nothing else.** It is
   the proof that a roster changed; it is never the proof the change was harmless. Each
   dropped call was fetching something. Say what, out loud, before calling it a cleanup.
18. **Restore a figure to a total, and check what is displayed UNDER that total.** A chain
   number with a per-store breakdown beneath it must gain a row when it gains a store, or
   the report visibly fails to add up and you have traded one bug for a more embarrassing one.
19. **An exact 2× in a test is a selector bug until proven otherwise.** The All Stores rows
   summed to double their own footer; the page was right and `> div` was matching the header
   and the total row. Check what the selector matched before you go looking at the code.
</rules>


## The test fixture said `5036`; the warehouse said `RM1 - TJX` (2026-09-16)

Bin Dump warned on a repeated PO. The floor read that as "duplicate pallet" and it was
wrong 19 times out of 19 — `po = 'RM1 - TJX'` spanned 20 rows carrying 20 distinct
barcodes. The check had been shipped, tested and reviewed, and `test-bin-dump.mjs` covered
it: log a pallet, ask again, assert the PO is found. That test passed the whole time the
feature was useless, because **both tag fixtures gave `po` a number** — `5036` and `14373`.
On format A `PO:` really is a purchase order. On format B the same field is printed `WO:`
and carries a receiving method that every TJX pallet has carried for good. The fixture
encoded the assumption the feature was built on instead of testing it.

The second half: the barcode check arrived LATER (migration-060) and made the PO check
redundant wherever a barcode exists — which is everywhere. It was suppressed only when the
barcode had already prompted, so a CLEAN barcode still fell through to the weaker question.
Nobody re-asked what the old check was still for once a better one sat above it.

I also nearly believed the wrong cause. The dialog says "Duplicate pallet", the report said
"duplicate", and the barcode guard is the thing that says that — so the barcode guard is
where I started. One `GROUP BY barcode HAVING COUNT(*) > 1` against production returned
zero rows and killed that theory in one query, before I had read a line of it closely.

<rules>
20. **A fixture that only ever holds the well-behaved value tests the assumption, not the
   code.** `po: '5036'` is the case the feature was designed around; `po: 'RM1 - TJX'` is
   the case it meets all day. When a field is free text off a printed form, put the real
   ugly string in the fixture — pulled from production, not invented — or the suite will
   stay green through a 0%-precision guard.
21. **One field, two tag formats, two meanings — check what the OTHER format puts there.**
   `PO:` and `WO:` were folded into one column on purpose and that was right for storage.
   It is not automatically right for a WHERE clause: a field that identifies a truck on one
   format and names a category on the other cannot carry an identity query for both.
22. **When you add a stronger check, say out loud what the weaker one is still for.** The
   barcode check superseded the PO check and nobody wrote down that it had. What survived
   was a guard with no remaining job, firing on every good pallet — and this repo's own
   comment already says what that costs: it "trains people to click through it".
23. **Ask the database which guard fired before reading the guard.** The user's word
   ("duplicate") pointed at the barcode check; the data pointed at the PO check. A
   one-line aggregate over the real table separated them before any code reading, and would
   have saved the reading that went the wrong way first.
</rules>


## Verifying a deploy means grepping for the code you did NOT write (2026-09-16)

The Bin Dump worker deploy. This repo already knows to pull the deployed bundle from the
Cloudflare API and grep it — that is how the 2026-09-15 rollback was caught, after an
unpulled checkout put production 40 minutes behind main. So I did that, found `AND po = ?`
at 0 and `barcode_matches` present, and could have stopped there feeling thorough.

That check only proves MY change shipped. The incident it descends from was never about
the change that was being deployed — it was about `fetchTransactionOrders`,
`payment_archive` and `bank-transactions` vanishing, features the deployer was not
touching and therefore not looking at. A bundle built from a stale checkout contains your
new work and is missing somebody else's; grepping only your own markers returns all-green
on exactly the deploy that caused the incident.

Two smaller things fell out of the same pass. One marker came back 0 and I nearly reported
it as a regression — `truck-review-email` was a name I had invented; the code says
`truck_review_email`. A zero means "this string is absent", which is one of "the feature is
gone" or "you guessed the identifier wrong", and only the source can say which. And I
briefly read live-vs-local count differences (4 vs 3, 9 vs 11) as signal when `grep -c`
counts LINES and a bundler re-joins them, so the two numbers were never comparable.

<rules>
24. **Before `wrangler deploy`, diff the file you are deploying against the branch you
   think you are on.** `git diff <deploying> origin/main -- worker.js` coming back empty
   is the one check that would have prevented the 40-minute rollback, and it costs a
   second. Deploying from a feature branch is fine; deploying from one that is BEHIND is
   the incident.
25. **Grep the deployed bundle for features you did not touch.** Your own markers being
   present proves your change shipped and says nothing about what left with it. Pick three
   or four of the most recent unrelated features and confirm they are still in there.
26. **A marker at 0 is not a finding until you have grepped the source for the same
   string.** "Absent from production" and "I guessed the identifier" are indistinguishable
   from the bundle alone, and shipping the first as a conclusion is a false alarm about a
   rollback — the most expensive kind.
27. **`grep -c` counts lines, not occurrences.** Comparing a count from multi-line source
   against one from a bundled single-line artifact compares formatting. For bundle
   verification the only meaningful question is presence vs absence.
28. **Say which probes you could NOT run.** Every probe in this deploy hit `401
   NO_SESSION`, which proves routing and JSON and nothing about the authenticated path.
   That is worth stating out loud rather than letting "18 clean passes" imply the
   behaviour was exercised end to end.
</rules>
