# Retail Summary — L2/L3 Category Trend & Period Comparison

**Status:** preview stage. No app code changed.
**Ask (Brian, 2026-09-10):** "on the retail summary page under the different stores,
I want to add an option to view the L2 or L3 categories and be able to compare them
vs day by day, week by week, month to month, or quarter by quarter as a graph.
Show me a preview to review before we change code."

## What exists today (verified)

- Page `#page-weekly-summary`, lines 1527–1610. Three panes only:
  `#wrs-pane-summary`, `#wrs-pane-t13`, `#wrs-pane-store`.
- **No chart of any kind on this page.** The "graphs" are CSS `<div>` pace bars
  and heat-shaded table cells.
- Chart.js 4.4.0 + zoom plugin ARE loaded globally (index.html:26–28), unused here.
- `v1Sparkline(series,color,w,h)` (5682) + `attachSparkTooltip(...)` (5760) are the
  repo's hand-rolled inline-SVG chart precedent.
- `?action=weekly-t13&end=` already returns `perStoreL2Units`, `perStoreL2Net`,
  `perStoreL3Units`, `perStoreL3Net` over 13 weeks — units AND net, L2 AND L3, per store.
- `T13_L2_CATS` (18016) = 12 L2 categories. Full L2 set incl. non-merch is 15.
- Long ranges return `wrsData.lazy` and omit `l2Matrix` — the comment at 17969 says
  building it "would need per-date item KV over the whole range x all stores".

## Design decisions taken

- [x] Follow DESIGN.md §4.8 — one panel owning bar + chart + legend, not a bare chart.
- [x] **Inline SVG, not `<canvas>`.** Two gotchas die at once: no Chart.js instance to
      leak across the wholesale `innerHTML` re-render, and the PDF/CSV export
      (12806/12992) scrapes live DOM, where a canvas may not serialize.
- [x] Categorical palette validated with the dataviz validator against the repo's
      REAL surfaces — `#101826` (op-panel), `#0a0a0a` (oled), `#ffffff` (opl-panel).
      6 slots, all checks pass; light mode carries the documented sub-3:1 relief WARN,
      discharged by direct labels + the table view.
- [x] 12 categories > the 8-hue ceiling → top-N by value, tail folded into "Other".
      Never generate a 13th hue.
- [x] Panel derives its own window from the page range's END + granularity, exactly as
      the T13 tab already does. No second date picker.

## Open questions for Brian — see the preview

1. Placement: per-store tab, its own tab, or both.
2. Day granularity's window cap (per-day item KV is one read per store per day).
3. Whether month/quarter buckets may be summed from weeks (cheap, boundary-approximate)
      or must be true calendar months (needs day-level reads or a new rollup).

## Steps

- [x] Map the page, the data model, the design system
- [x] Validate the chart palette against real surfaces
- [x] Build `docs/retail-category-trend-preview.html` (verified: build.sh is an explicit
      allowlist and never copies docs/, so the preview cannot reach production)
- [ ] Publish preview + get Brian's answers on the six questions
- [ ] THEN implement

## Review — what the preview cost, and the four bugs it caught

Verified headlessly (Chromium via the global playwright), 37 checks, all passing:
every bucket x level x measure combination, both themes, 400 px, the crosshair,
the table twin, and the SECOND render (§4.8 trap 8). Script kept in the session
scratchpad; the checks worth keeping are listed below.

**Four defects found by looking at the render, not by reading the code** — none
of which a syntax check or a passing first render would have surfaced:

1. **`.ctl[hidden]` did nothing.** `display:flex` on the class outranks the UA's
   `[hidden]{display:none}`, so the L3-parent selector sat on the bar as an
   empty stub in L2 mode. Same family as §4.8 trap 1: a rule you assume the
   browser applies, silently outranked.
2. **The last x-axis label was clipped** by the viewBox — "Wk 36" rendered as
   "Wk 3". End labels now anchor inward.
3. **"Other" led the chart.** A sum of seven categories outranks every real one,
   so the fold bucket read as the top seller. It now defaults to off, one click
   away in the legend, and the panel legend says why.
4. **The quarter view reported every category down exactly −24.7%.** Q3 was 68
   days against three 92-day quarters. Six rows agreeing to four significant
   figures is never data. Buckets are now closed periods only; the one in
   progress is named in the status line and excluded.

A fifth was mine and not the design's: the synthetic L3 shares were fixed per
(store, L2), so every L3 moved in lockstep and the change strip printed one
number in six costumes. The shares now drift independently and renormalise per
day, which keeps L3 summing to its L2 exactly (measured drift: 0).

**Checks worth porting to the real implementation:**
- L3 totals equal their L2 total to the cent, per bucket (worker.js:2734).
- No bucket whose natural end is after the last closed day is ever plotted.
- Per-category deltas are not all equal — the tell for a length artefact.
- The second render, after a control change, not just first paint.
- BL12/BL16 gated by `wrsGateDates` so the shared merchant is not double-counted.


## Iteration 2 — "I want to be able to see all L2 and L3" (Brian, 2026-09-10)

The first pass drew the top 6 and folded the rest, and gated L3 behind picking one
parent L2. Both were wrong for the ask. What changed:

- **Grid view, now the default.** Small multiples — one panel per category, with its
  window total, its change and its shape. 12 panels at L2; **56 at L3**, grouped under
  all 12 parents. Nothing folds. This is dataviz's own answer past ~8 series: don't
  grow hues, facet.
- **"All L2s"** added to the L3 parent selector, so L3 spans the whole taxonomy rather
  than one branch.
- **Table shows every row**, L3 nested under its L2 with the §4.8 hierarchy treatment
  (level badge, indent, corner rule back to the parent).
- **Chart keeps a 6-line cap** — that is a colourblind-legibility limit and it now
  governs only *overlaying*, not *seeing*. Which six is a choice: click a Grid panel to
  promote it. A seventh is refused with a visible message, never a silent eviction.
- **Change strip ranks over every category**, not just the drawn ones, capped at 12 and
  captioned "top 12 of 56".

Verified headlessly: **57 checks**, all passing, including the 24 bucket × level × view
combinations.

**Defects this round, all caught by looking at the render:**

1. **`[hidden]` was ignored again.** I fixed `.ctl[hidden]` in round one, then wrote
   `lg.hidden = true` on a `display:flex` element and walked straight back into it.
   Fixed as a *class* of bug this time: one global `[hidden]{display:none!important}`.
2. **Grid sparklines were near-flat** — scaled from zero, a category moving between
   $70k and $80k draws a straight line. Now min–max per panel, with the non-zero
   baseline stated and a `Scale: Shared` toggle for when heights must be comparable.
3. **Labels collided.** `Other / unmapped` exists under all 12 parents and
   `FG BL SOFTLINES - APPAREL` / `Apparel` both shorten to "Apparel". Colliding
   siblings now fall back to the full cleaned path, and the movers strip names the L2
   parent since it lists rows outside their group.
4. **Feed strings leaked into labels** — `Bl stores`, `FG BL HAMILTON BEA…`. Cleaned:
   strip the feed prefix, drop noise segments, title-case.
5. **"Coffee & TEA"** — my "≤3 chars and all-caps means acronym" rule read TEA as one.
   Replaced with an explicit acronym set.

**Extra checks worth porting:** L3 keys must keep their parent (`Other / unmapped`
resolving to 12 distinct rows, not 1 — worker.js:2466); no two labels identical inside
one parent; the Chart cap refuses rather than evicts.


## Iteration 3 — "the graph should be a vs" (Brian, 2026-09-10)

The graph is now the comparison itself, not a trend with the change reported
underneath. **Vs** is the default view: two bars per category — this period over the
one before it — on one shared scale, sorted by the current period, with the comparator
spelled out on every row ("vs $69,182") the way a store card spells out "vs $budget".

The shape solves both asks at once. **Two marks, regardless of how many categories** —
so a Vs chart holds all 12 L2s, or all 56 L3s grouped under their parents, with no fold
and no colour ceiling. Colour here is emphasis, not identity: current takes the blue,
previous the de-emphasis grey, which leaves green/red free to mean direction — the same
thing they mean everywhere else in this app.

Views are now **Vs · Trend · Grid · Table**. The change strip is hidden in Vs, because
Vs already says it row by row and printing it twice underneath is noise.

**The panel legend is now view-aware.** It was explaining a change strip and line-series
colour rules while showing neither. §4.8 says every visual state gets a legend row; the
converse matters as much — a legend that describes things not on screen teaches the
reader to skim it.

Verified: **76 checks**, all passing, including the 32 bucket x level x view
combinations.

**Test bug worth recording** (not a product bug): the "bar length tracks value" check
read `.vs-cur.textContent`, which glues the value to the nested delta span — "$66,144"
and "-4.4%" became 661444.4. Diagnosed before touching the code; the geometry was
correct all along (66,144 -> 95.6% of a 69,182 max). **A failing assertion is a claim
about the test as much as about the code** — check which one is wrong before editing
either.


## Iteration 4 — "more like this graph" (Brian, 2026-09-10)

Brian sent a screenshot of the dashboard's **Sales Trend** card — TW/LW/Budget legend
pills, smooth green line with a soft fill, amber comparison line, dollar ticks,
Sun..Sat axis — and asked for the Vs graph to look like that. It now is that card.

- Colours are `CHART_COLORS` verbatim (index.html:8826): `#22c55e` current,
  `#f59e0b` previous. Line weights, point radii and the `rgba(34,197,94,0.12)` fill
  match the dashboard's dataset config; the curve uses **Chart.js's own splineCurve
  maths at tension 0.3**, so it bends the same way rather than merely looking smooth.
- Legend pills copy `legPill`/`solidSwatch` (index.html:8908) in shape, each carrying
  its running total, with the headline movement on the right.
- **The x-axis runs INSIDE the period** — that is what makes it a vs rather than a
  trend. Sun..Sat for a week, days 1..N for a month, the 13 weeks for a quarter.
- **Weeks now run Sunday to Saturday**, matching the dashboard card's own axis. They
  ran Monday to Sunday before, which was wrong against the app.
- The per-category rows stay underneath, now in the same two colours as the lines
  above them, and clicking one redraws the card for that category alone.

Verified: **89 checks**, all passing.

**Two things this round worth remembering:**

1. **The bars and the lines wore different colours.** The chart used the house
   green/amber while the bars underneath kept the blue/grey from the previous
   iteration — the same comparison told twice in two languages on one screen. Fixed,
   and there is now a check that reads the computed background of both and requires
   them to match the line strokes.
2. **The synthetic data hid the chart's whole point.** Twelve categories across six
   stores averaged out, so the two week lines sat on top of each other and the card
   looked like it had nothing to compare. Added a per-week factor and a chain-wide
   per-day shock — which is also how a real chain behaves, since weather or a promo
   moves every store and category on the same day. **A preview whose data cannot
   exercise the feature does not preview the feature.**

**Also caught:** a screenshot I read back was stale — the console said $330,092 while
the image showed $305,865. Re-captured to a fresh path rather than trusting it.
Worth knowing that a re-read of the same path can serve the previous render.

**What the card deliberately does NOT draw**, and why it is in the questions rather
than the code: the dashboard card's **budget** line (budget has no category
dimension — it is per store per day) and its **last-year** line (would need year-old
`items:` KV, and Clover only reaches back ~90 days). Two honest series beat four with
two invented.


## DECISIONS LOCKED — Brian, 2026-09-10

| # | Question | Answer |
|---|---|---|
| 1 | Where does it go | **Its own tab on the Retail Summary page** — not inside each store tab |
| 2 | What does "compare" mean | **Period over period.** Not last year |
| 3 | Per-category budget / last-year lines | **"Don't have that yet"** — neither line is drawn |
| 4 | Day compares two fortnights | Build as shown |
| 5 | Vs compares the last two closed periods | Build as shown |
| 6 | Grid sparklines on their own scale | Build as shown |
| 7 | L3 names cleaned for display | Build as shown |
| 8 | Should Auction appear | **No** |
| 9 | The period we are in | **Yes, also** — period-to-date, added this round |
| 10 | Day window of 14 | Build as shown |

### #9 — period to date, built and verified

`Compare: Last closed | To date`. The green line runs to the last closed day and
stops; the amber line runs the **whole** previous period so the target is visible.
**Both totals are clipped to the same span** and the pill says so ("same 6 days") —
a month-to-date measured against a whole month is the classic way this chart lies.
The caption carries the previous period's finished total. **Disabled for Day**: a day
has no closed sub-period to clip to, because item snapshots are per day, not per hour.

Two on-screen contradictions came with it and were fixed: the status line still said
the charted period "is left out", and the panel legend still asserted every bucket is
a closed period. Both are mode-aware now — **a legend that states the opposite of
what is on screen is worse than no legend.**

101 checks, all passing.

## BUILD PLAN — app implementation

### Phase 1 — SHIPPED 2026-09-10

**A correction to this plan before the results.** It said phase 1 "runs entirely off
`?action=weekly-t13`" and needed no backend work. That was wrong, and checking rather
than assuming caught it: **weekly-t13 is per WEEK**, so it cannot feed a chart whose
x-axis runs inside the period — which is the whole point of the Vs card. Phase 1
therefore includes one new worker action after all.

- [x] `?action=category-series&from=&to=&level=l2|l3[&store=]` — per-DATE L2/L3 net and
      qty. `buildStoreWeekly` already reads exactly these snapshots and merges them
      away; this merges per date instead. Registered in `ACTION_BUSINESS` (without it
      it is a hard 403 for everyone, superuser included), scoped by `allowedStores`,
      gated per date by `wrsGateDates`, and **refuses** past 840 store-days rather than
      half-answering. 29 assertions.
- [x] **The Categories tab** on the Retail Summary page, with the panel: L2/L3,
      Vs / Trend / Grid / Table, net + units, store chips, Compare closed/to-date.
      Inline SVG and CSS bars, never `<canvas>`.
- [x] **Collapsed `switchWrsTab` / `renderWrsActiveTab`** — 23 duplicated lines where
      every new tab had to be added twice. Adding this one would have been the third
      time that bit.
- [x] `CACHE_NAME` bumped to v184 and `scripts/fixtures/shell-cache.json` re-pinned.
- [ ] **Phase 2** — day, month and quarter buckets. They need a wider day-snapshot
      window than one request's subrequest budget allows, so the pills are present and
      disabled with the reason on hover rather than appearing to work.

### What the browser caught that the syntax check did not

`node --check` passed on a file with **`getTodayStr is not defined`** in it — the
helper is `etTodayStr`. Only loading the real page in Chromium with the API stubbed
surfaced it. Two more followed:

1. **Vs depended on the wrong feed.** Its category list came from the weekly rollups
   while its numbers came from the day series — two different windows, one of them
   deciding whether the other rendered. An empty week feed blanked a card whose own
   data had already arrived. Vs now derives its list from the payload it holds.
2. **It called `loadT13()`**, which owns `#wrs-pane-t13` and rewrites it, and returns
   early when the range picker has no end date. Borrowing a loader that owns another
   pane is §4.8 trap 7 wearing a different hat. It fetches the feed itself now.
3. **A modal for a soft limit.** Promoting a seventh Trend line opened `uiAlert`. The
   approved preview used an inline note; a modal to say "you already have six" is an
   interruption for something the user can simply retry.

Verified: 44 browser checks against the real `index.html`, plus **3,992 assertions
across 62 suites** in the repo's own runner, all passing.

### Original plan (kept for the record)

- [ ] **Frontend, phase 1 — the tab.** New `wrs-tab` in the strip at index.html:1591
      and a `#wrs-pane-trend` section. `switchWrsTab` (17425) and `renderWrsActiveTab`
      (17450) are near-identical duplicated logic — **both must be edited**, and the
      duplication is worth collapsing while in there.
- [ ] **Frontend, phase 1 — the panel**, off `?action=weekly-t13` alone: L2/L3, the
      week bucket, Vs / Trend / Grid / Table, net + units, store chips.
      Inline SVG and CSS bars, never `<canvas>`.
- [ ] **Worker, phase 1** — lift `LIMIT 13` (worker.js:18116) to a bounded `n`. Ceiling
      is the KV budget: 7 stores x n weeks gets, so n ~= 100.
- [ ] **Worker, phase 2** — a category-series action bucketing day snapshots into true
      calendar days, months and quarters, **refusing rather than truncating** when
      store-days would exceed ~840 subrequests.
- [ ] **Gate BL12/BL16** through the existing `wrsGateDates` — a new series that skips
      it double-counts the shared merchant.
- [ ] Bump `CACHE_NAME` in `sw.js` in the same commit, or installed phones keep
      serving the old bundle and the feature simply will not appear.

### Checks to port from the preview's suite

1. L3 totals equal their L2 total, per bucket (worker.js:2734).
2. No bucket whose natural end is after the last closed day is plotted — except in
   to-date mode, where BOTH sides are clipped to the same span.
3. Per-category deltas are not all equal — the tell for a length artefact.
4. The second render, after a control change, not just first paint.
5. `Other / unmapped` resolves to one row per parent, not one row overall.
6. The bars and the chart lines carry the same two colours.
7. Contrast computed in both themes at >= 4.5:1.
