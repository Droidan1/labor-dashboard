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
